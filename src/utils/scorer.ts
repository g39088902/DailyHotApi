import axios from "axios";
import crypto from "crypto";
import { config } from "../config.js";
import logger from "./logger.js";
import {
  getScoreRecordByHash,
  saveAiScoreRecord,
  saveUserManualScore,
  rowToScoreResult,
  type SaveUserManualScoreParams,
} from "./scoreDb.js";
import type { ScoreLayer, ScoreResult } from "../types.js";
import { SCORE_PROMPT } from "./scorePrompt.js";

export { SCORE_PROMPT };

export interface ScoreInputItem {
  id?: string | number;
  newsHash?: string;
  title?: string;
  desc?: string;
  text?: string;
  content?: string;
  news?: string;
  source?: string;
  url?: string;
  mobileUrl?: string;
  [key: string]: unknown;
}

export interface ScoreOptions {
  cacheTtl?: number;
  noCache?: boolean;
  forceRescore?: boolean;
  concurrency?: number;
}

const VALID_LAYERS = new Set<ScoreLayer>(["L1", "L2", "L3", "L4", "L5", "Uncertain"]);

/**
 * 计算规范化新闻文本的唯一哈希（用于 SQLite 唯一索引与缓存键）
 */
export const hashNewsText = (text: string): string => {
  return crypto.createHash("md5").update(text).digest("hex");
};

/**
 * 去除简单 HTML 标签并清理多余空白
 */
const cleanHtml = (input: string): string => {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export interface ExtractedNewsMeta {
  source: string;
  title: string;
  desc: string;
  url: string;
  formattedText: string;
  newsHash: string;
}

/**
 * 从输入字符串或新闻对象提取标准化元数据与待评分文本
 */
export const extractNewsMetadata = (item: string | ScoreInputItem): ExtractedNewsMeta => {
  if (typeof item === "string") {
    const formattedText = cleanHtml(item);
    return {
      source: "",
      title: formattedText.slice(0, 120),
      desc: "",
      url: "",
      formattedText,
      newsHash: formattedText ? hashNewsText(formattedText) : "",
    };
  }

  if (!item || typeof item !== "object") {
    return {
      source: "",
      title: "",
      desc: "",
      url: "",
      formattedText: "",
      newsHash: "",
    };
  }

  const rawDesc = typeof item.desc === "string" ? item.desc.slice(0, 500) : "";
  const title = typeof item.title === "string" ? cleanHtml(item.title) : "";
  const desc = rawDesc ? cleanHtml(rawDesc) : "";
  const source =
    typeof item.source === "string"
      ? item.source.trim()
      : typeof item._sourceLabel === "string"
        ? item._sourceLabel.trim()
        : "";
  const url =
    typeof item.url === "string" && item.url.trim()
      ? item.url.trim()
      : typeof item.mobileUrl === "string" && item.mobileUrl.trim()
        ? item.mobileUrl.trim()
        : "";

  const directText = item.text || item.content || item.news;
  if (typeof directText === "string" && directText.trim() && !title) {
    const cleanedDirect = cleanHtml(directText);
    return {
      source,
      title: cleanedDirect.slice(0, 120),
      desc,
      url,
      formattedText: cleanedDirect,
      newsHash: cleanedDirect ? hashNewsText(cleanedDirect) : "",
    };
  }

  const parts: string[] = [];
  if (source) {
    parts.push(`【来源】${source}`);
  }
  if (title) {
    parts.push(`【标题】${title}`);
  }
  if (desc && desc !== title) {
    parts.push(`【摘要】${desc}`);
  }

  let formattedText = parts.join("\n");
  if (!formattedText && typeof directText === "string") {
    formattedText = cleanHtml(directText);
  }

  return {
    source,
    title,
    desc,
    url,
    formattedText,
    newsHash: formattedText ? hashNewsText(formattedText) : "",
  };
};

/**
 * 将输入的字符串或新闻对象规范化为待评分文本
 */
export const formatNewsInput = (item: string | ScoreInputItem): string => {
  return extractNewsMetadata(item).formattedText;
};

/**
 * 解析模型返回的 JSON 字符串并校验字段
 */
const parseScoreResponse = (rawContent: string): ScoreResult | null => {
  let content = rawContent.trim();
  if (!content) return null;

  // 去除可能的 markdown 代码块包装
  if (content.startsWith("```")) {
    content = content.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  }

  // 若前后仍有额外字符，尝试提取第一个 JSON 对象
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    content = content.slice(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(content);
    const rawScore = Number(parsed?.score);
    if (Number.isNaN(rawScore)) {
      return null;
    }

    const score = Math.max(0, Math.min(100, Math.round(rawScore)));
    const rawLayer = typeof parsed?.layer === "string" ? (parsed.layer.trim() as ScoreLayer) : "Uncertain";
    const layer: ScoreLayer = VALID_LAYERS.has(rawLayer) ? rawLayer : "Uncertain";
    const reason = typeof parsed?.reason === "string" ? parsed.reason.trim() : "";

    return {
      score,
      layer,
      reason,
    };
  } catch {
    return null;
  }
};

/**
 * 对单条新闻进行喜好度预测打分：
 * 1. 先检查 SQLite 数据库是否已有该条新闻的打分记录（若有则直接返回，不再请求 AI）
 * 2. 若无缓存（或显式指定 forceRescore），请求 DeepSeek AI 打分并将结果持久化存入 SQLite
 */
export const scoreNewsItem = async (
  input: string | ScoreInputItem,
  options: ScoreOptions = {},
): Promise<ScoreResult> => {
  const { forceRescore = false } = options;
  const meta = extractNewsMetadata(input);
  const { formattedText, newsHash } = meta;

  if (!formattedText || !newsHash) {
    return {
      score: 0,
      layer: "Uncertain",
      reason: "新闻内容为空",
      fromCache: false,
    };
  }

  // 1. 优先查询 SQLite 持久化数据库缓存
  if (!forceRescore) {
    try {
      const dbRecord = getScoreRecordByHash(newsHash);
      if (dbRecord) {
        return rowToScoreResult(dbRecord, true);
      }
    } catch (dbErr) {
      logger.warn(
        `⚠️ [Scorer] SQLite lookup error: ${dbErr instanceof Error ? dbErr.message : "Unknown error"}`,
      );
    }
  }

  // 2. 数据库无缓存，请求 AI 进行评分
  const apiKey = config.DEEPSEEK_API_KEY;
  if (!apiKey) {
    logger.warn("⚠️ [Scorer] DEEPSEEK_API_KEY is not configured.");
    throw new Error("DEEPSEEK_API_KEY is not configured");
  }

  const response = await axios.post(
    `${config.DEEPSEEK_BASE_URL.replace(/\/+$/, "")}/chat/completions`,
    {
      model: config.DEEPSEEK_MODEL,
      messages: [
        {
          role: "user",
          content: `${SCORE_PROMPT}\n${formattedText}`,
        },
      ],
      temperature: 0.1,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 45000,
    },
  );

  const rawContent = response?.data?.choices?.[0]?.message?.content || "";
  const parsed = parseScoreResponse(rawContent);

  if (!parsed) {
    logger.error(`❌ [Scorer] Failed to parse DeepSeek score response as JSON: ${rawContent}`);
    throw new Error("Failed to parse model response as valid score JSON");
  }

  // 3. 将 AI 打分结果持久化写入 SQLite 数据库
  try {
    const savedRow = saveAiScoreRecord({
      newsHash,
      source: meta.source,
      title: meta.title,
      desc: meta.desc,
      url: meta.url,
      formattedText,
      aiScore: parsed.score,
      aiLayer: parsed.layer,
      aiReason: parsed.reason,
      aiModel: config.DEEPSEEK_MODEL,
    });

    logger.info(
      `🎯 [Scorer] Scored & saved to SQLite (${parsed.score} | ${parsed.layer}): ${formattedText.slice(0, 40)}...`,
    );

    return rowToScoreResult(savedRow, false);
  } catch (dbSaveErr) {
    logger.error(
      `❌ [Scorer] Failed to save score to SQLite: ${dbSaveErr instanceof Error ? dbSaveErr.message : "Unknown error"}`,
    );
    return {
      ...parsed,
      newsHash,
      aiScore: parsed.score,
      aiLayer: parsed.layer,
      aiReason: parsed.reason,
      isUserModified: false,
      fromCache: false,
    };
  }
};

export interface ManualScoreInput extends ScoreInputItem {
  recordId?: number;
  newsHash?: string;
  userScore?: number | null;
  score?: number | null;
  userLayer?: ScoreLayer | null;
  layer?: ScoreLayer | null;
  userReason?: string | null;
  reason?: string | null;
  comment?: string | null;
  feedback?: string | null;
  reset?: boolean;
  aiScore?: number;
  aiLayer?: ScoreLayer;
  aiReason?: string;
}

/**
 * 接收用户手动修正单条新闻分数的逻辑封装
 */
export const updateManualScoreItem = (payload: ManualScoreInput): ScoreResult => {
  const meta = extractNewsMetadata(payload);
  const recordId =
    typeof payload.recordId === "number"
      ? payload.recordId
      : typeof payload.id === "number"
        ? payload.id
        : typeof payload.id === "string" && /^\d+$/.test(payload.id)
          ? parseInt(payload.id, 10)
          : undefined;

  const targetHash =
    typeof payload.newsHash === "string" && payload.newsHash.trim()
      ? payload.newsHash.trim()
      : meta.newsHash;

  const rawScore = payload.userScore !== undefined ? payload.userScore : payload.score;
  let userScore: number | null | undefined;
  if (rawScore === null) {
    userScore = null;
  } else if (typeof rawScore === "number") {
    userScore = rawScore;
  } else if (typeof rawScore === "string" && (rawScore as string).trim() !== "") {
    userScore = Number(rawScore);
  } else {
    userScore = undefined;
  }

  const rawLayer = (payload.userLayer ?? payload.layer) as ScoreLayer | null | undefined;
  const rawReason =
    payload.userReason ?? payload.reason ?? payload.comment ?? payload.feedback ?? undefined;

  const saveParams: SaveUserManualScoreParams = {
    id: recordId,
    newsHash: targetHash || undefined,
    source: meta.source,
    title: meta.title,
    desc: meta.desc,
    url: meta.url,
    formattedText: meta.formattedText || undefined,
    userScore,
    userLayer: rawLayer,
    userReason: typeof rawReason === "string" ? rawReason : null,
    reset: payload.reset === true || rawScore === null,
    aiScore: typeof payload.aiScore === "number" ? payload.aiScore : undefined,
    aiLayer: payload.aiLayer,
    aiReason: typeof payload.aiReason === "string" ? payload.aiReason : undefined,
  };

  const updatedRow = saveUserManualScore(saveParams);
  if (!updatedRow) {
    throw new Error(
      "未找到对应的新闻评分记录，请提供有效的 id / newsHash，或提供完整的新闻内容（如 title、desc、source）以创建记录",
    );
  }

  logger.info(
    `✏️ [Scorer] User manually updated score (id=${updatedRow.id}, ai=${updatedRow.ai_score} -> user=${updatedRow.user_score}): ${updatedRow.title || updatedRow.formatted_text.slice(0, 40)}`,
  );

  return rowToScoreResult(updatedRow, true);
};

/**
 * 批量对多条新闻进行喜好度预测打分（带并发控制与单条降级保护）
 */
export const scoreNewsBatch = async <T extends string | ScoreInputItem>(
  items: T[],
  options: ScoreOptions = {},
): Promise<Array<(T extends string ? { text: string } : T) & ScoreResult>> => {
  if (!items || items.length === 0) {
    return [];
  }

  const concurrency = Math.max(1, Math.min(options.concurrency || 5, 10));
  const results = new Array(items.length);
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      const item = items[idx];
      try {
        const scoreRes = await scoreNewsItem(item, options);
        if (typeof item === "string") {
          results[idx] = {
            text: item,
            ...scoreRes,
          };
        } else {
          results[idx] = {
            ...item,
            ...scoreRes,
          };
        }
      } catch (error) {
        logger.error(
          `❌ [Scorer] Batch item #${idx} score error: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        const fallback: ScoreResult = {
          score: 50,
          layer: "Uncertain",
          reason: "评分失败降级[待复核]",
          fromCache: false,
        };
        if (typeof item === "string") {
          results[idx] = {
            text: item,
            ...fallback,
          };
        } else {
          results[idx] = {
            ...item,
            ...fallback,
          };
        }
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);

  return results;
};
