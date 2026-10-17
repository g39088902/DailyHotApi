import type { ListItem } from "../types.js";
import { config } from "../config.js";
import logger from "./logger.js";

interface TitleOwnerEntry {
  routeKey: string;
  expireAt: number;
}

// 记录全局归一化标题归属的路由标识及过期时间，用于跨分类/跨信源去重
// 同一 routeKey 重复请求（如页面刷新）时，由于 routeKey 相同，不会误删自身已有的文章
const globalTitleOwners = new Map<string, TitleOwnerEntry>();

// 记录每个 routeKey 当前持有的归一化标题集合，便于该路由刷新时释放旧标题
const routeOwnedTitles = new Map<string, Set<string>>();

// 常见尾部来源后缀正则（如 "- Reuters", "- Bloomberg", "| 界面新闻" 等）
const TRAILING_SOURCE_REGEX =
  /\s*[-—–_|｜·]\s*(Reuters|Bloomberg|NYTimes|The\s+New\s+York\s+Times|Hacker\s+News|V2EX|路透社?|彭博社?|纽约时报|界面新闻|界面快报|财联社|金十数据|新浪新闻|新浪财经|腾讯新闻|澎湃新闻|36氪|IT之家|虎嗅网?|少数派|今日头条|稀土掘金|哔哩哔哩|bilibili)\s*$/i;

/**
 * 归一化文章标题：
 * 1. NFKC Unicode 标准化（全角转半角等）
 * 2. 移除尾部常见媒体来源后缀
 * 3. 转小写
 * 4. 忽略所有中英文标点符号、特殊符号与空白字符
 */
export const normalizeTitle = (title?: string): string => {
  if (!title || typeof title !== "string") return "";

  let text = title.normalize("NFKC").trim();
  if (!text) return "";

  // 移除尾部来源后缀
  text = text.replace(TRAILING_SOURCE_REGEX, "").trim();

  // 转小写
  text = text.toLowerCase();

  // 移除所有标点符号(P)、符号(S)、分隔符/空白(Z)及空白字符(\s)
  const stripped = text.replace(/[\p{P}\p{S}\p{Z}\s]+/gu, "");
  return stripped || text;
};

/**
 * 清理已过期的全局标题记录
 */
const purgeExpiredOwners = (now: number) => {
  for (const [normTitle, entry] of globalTitleOwners.entries()) {
    if (entry.expireAt <= now) {
      globalTitleOwners.delete(normTitle);
      const ownedSet = routeOwnedTitles.get(entry.routeKey);
      if (ownedSet) {
        ownedSet.delete(normTitle);
        if (ownedSet.size === 0) {
          routeOwnedTitles.delete(entry.routeKey);
        }
      }
    }
  }
};

/**
 * 释放指定 routeKey 先前持有的标题记录
 */
const releaseRouteOwnedTitles = (routeKey: string) => {
  const ownedSet = routeOwnedTitles.get(routeKey);
  if (!ownedSet) return;
  for (const normTitle of ownedSet) {
    const owner = globalTitleOwners.get(normTitle);
    if (owner && owner.routeKey === routeKey) {
      globalTitleOwners.delete(normTitle);
    }
  }
  routeOwnedTitles.delete(routeKey);
};

export interface DeduplicateOptions {
  /** 是否强制刷新缓存 */
  noCache?: boolean;
  /** 跨路由去重状态保留时长（秒），默认与 CACHE_TTL 一致 */
  ttlSeconds?: number;
  /** 最大保留条数（达到该条数后停止收集，避免未返回给前端的尾部文章占用全局去重名额） */
  maxItems?: number;
}

/**
 * 对文章列表进行去重（支持单次列表内去重 + 跨分类/跨信源全局近期去重）
 * @param items 待去重的文章数组
 * @param routeKey 当前路由及分类唯一标识（如 "reuters?type=world"）
 * @param options 去重配置项
 */
export const deduplicateArticles = <T extends Pick<ListItem, "title"> & Partial<Pick<ListItem, "id" | "url" | "desc">>>(
  items: T[],
  routeKey: string,
  options: DeduplicateOptions = {},
): T[] => {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const now = Date.now();
  const ttlMs = (options.ttlSeconds ?? config.CACHE_TTL) * 1000;
  const maxItems = options.maxItems && options.maxItems > 0 ? options.maxItems : Infinity;

  // 1. 清理过期记录，并释放当前 routeKey 上一轮持有的标题（保证当前 routeKey 刷新或重请求时幂等）
  purgeExpiredOwners(now);
  releaseRouteOwnedTitles(routeKey);

  const localSeenTitles = new Set<string>();
  const newOwnedSet = new Set<string>();
  const deduplicated: T[] = [];

  for (const item of items) {
    if (deduplicated.length >= maxItems) {
      break;
    }

    const rawTitle = item?.title || item?.desc || "";
    const normTitle = normalizeTitle(rawTitle);

    // 无有效标题的内容直接跳过
    if (!normTitle) {
      continue;
    }

    // 2. 单次列表内部按归一化标题去重
    if (localSeenTitles.has(normTitle)) {
      continue;
    }

    // 3. 跨分类 / 跨信源去重：如果已被其他未过期的 routeKey 占用，则过滤掉
    const existingOwner = globalTitleOwners.get(normTitle);
    if (existingOwner && existingOwner.expireAt > now && existingOwner.routeKey !== routeKey) {
      continue;
    }

    // 保留该文章并登记归属
    localSeenTitles.add(normTitle);
    newOwnedSet.add(normTitle);
    globalTitleOwners.set(normTitle, {
      routeKey,
      expireAt: now + ttlMs,
    });
    deduplicated.push(item);
  }

  if (newOwnedSet.size > 0) {
    routeOwnedTitles.set(routeKey, newOwnedSet);
  }

  const removedCount = Math.min(items.length, maxItems) - deduplicated.length;
  if (removedCount > 0 || items.length !== deduplicated.length) {
    logger.info(
      `🧹 [Deduplicate] Route "${routeKey}": kept ${deduplicated.length} unique item(s) from ${items.length} fetched.`,
    );
  }

  return deduplicated;
};
