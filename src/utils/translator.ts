import axios from "axios";
import { config } from "../config.js";
import { getCache, setCache } from "./cache.js";
import logger from "./logger.js";
import crypto from "crypto";

export interface TranslateOptions {
  texts: string[];
  targetLang?: string;
  sourceLang?: string;
  cacheTtl?: number;
  noCache?: boolean;
}

/**
 * 计算文本哈希作为缓存 key 的一部分
 */
const hashText = (text: string): string => {
  return crypto.createHash("md5").update(text).digest("hex").slice(0, 16);
};

/**
 * 翻译单个或多个文本
 * @param texts 需要翻译的文本数组
 * @param targetLang 目标语言，默认 "zh-CN"（简体中文）
 * @param sourceLang 源语言，默认 "en"（英语）
 * @returns 对应顺序翻译后的纯文本数组
 */
export const translateTexts = async (options: TranslateOptions): Promise<string[]> => {
  const { texts, targetLang = "zh-CN", sourceLang = "en", cacheTtl = config.CACHE_TTL, noCache = false } = options;

  if (!texts || texts.length === 0) {
    return [];
  }

  const apiKey = config.DEEPSEEK_API_KEY;
  if (!apiKey) {
    logger.warn("⚠️ [Translator] DEEPSEEK_API_KEY is not configured, returning original texts.");
    return texts;
  }

  const results: string[] = new Array(texts.length);
  const pendingIndices: number[] = [];
  const pendingTexts: string[] = [];

  // 1. 检查单条缓存，避免重复翻译消耗 token
  for (let i = 0; i < texts.length; i++) {
    const originalText = texts[i];
    if (!originalText || !originalText.trim()) {
      results[i] = originalText;
      continue;
    }

    const cacheKey = `translate:${targetLang}:${hashText(originalText)}`;
    if (!noCache) {
      const cached = await getCache(cacheKey);
      if (cached && typeof cached.data === "string") {
        results[i] = cached.data;
        continue;
      }
    }

    pendingIndices.push(i);
    pendingTexts.push(originalText);
  }

  // 全部命中缓存
  if (pendingIndices.length === 0) {
    return results;
  }

  // 2. 将待翻译文本切片并并发调用 DeepSeek API 进行翻译（每批最多 3 条）
  const CHUNK_SIZE = 3;
  const chunks: { chunkIndices: number[]; chunkTexts: string[] }[] = [];
  for (let offset = 0; offset < pendingIndices.length; offset += CHUNK_SIZE) {
    chunks.push({
      chunkIndices: pendingIndices.slice(offset, offset + CHUNK_SIZE),
      chunkTexts: pendingTexts.slice(offset, offset + CHUNK_SIZE),
    });
  }

  await Promise.all(
    chunks.map(async ({ chunkIndices, chunkTexts }) => {
      try {
        const prompt = `You are a professional translator for global news, finance, technology headlines, and summaries.
Translate the following array of ${sourceLang} texts into natural, fluent, and accurate ${targetLang}.
Strict rules:
1. Return ONLY a valid JSON array of strings matching the exact length and order of the input.
2. Keep financial/technical terms, ticker symbols, company/brand names, and proper nouns in their standard recognized form (or original English if commonly untranslated).
3. Do not include markdown code blocks, explanatory comments, or quotes outside the array.

Input JSON:
${JSON.stringify(chunkTexts)}`;

        const response = await axios.post(
          `${config.DEEPSEEK_BASE_URL.replace(/\/+$/, "")}/chat/completions`,
          {
            model: config.DEEPSEEK_MODEL,
            messages: [
              {
                role: "system",
                content: "You are an accurate, concise translator. You only output valid JSON arrays.",
              },
              {
                role: "user",
                content: prompt,
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

        let content = response?.data?.choices?.[0]?.message?.content?.trim() || "";

        // 去除可能的 markdown 代码块包装
        if (content.startsWith("```")) {
          content = content.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
        }

        let translatedList: string[] = [];
        try {
          translatedList = JSON.parse(content);
        } catch {
          logger.error(`❌ [Translator] Failed to parse DeepSeek response as JSON: ${content}`);
        }

        const now = new Date().toISOString();

        for (let k = 0; k < chunkIndices.length; k++) {
          const originalIdx = chunkIndices[k];
          const translated = translatedList[k] || chunkTexts[k];
          results[originalIdx] = translated;

          // 写入缓存（即使单条写入缓存异常也不影响已翻译结果）
          try {
            const cacheKey = `translate:${targetLang}:${hashText(chunkTexts[k])}`;
            await setCache(cacheKey, { data: translated, updateTime: now }, cacheTtl);
          } catch (cacheErr) {
            logger.warn(
              `⚠️ [Translator] Failed to cache translation item: ${cacheErr instanceof Error ? cacheErr.message : "Unknown error"}`,
            );
          }
        }

        logger.info(`🌐 [Translator] Successfully translated batch of ${chunkIndices.length} items with DeepSeek.`);
      } catch (error) {
        logger.error(`❌ [Translator] DeepSeek translation error: ${error instanceof Error ? error.message : "Unknown error"}`);
        // 当前批次翻译失败降级为原文
        for (let k = 0; k < chunkIndices.length; k++) {
          const originalIdx = chunkIndices[k];
          results[originalIdx] = chunkTexts[k];
        }
      }
    }),
  );

  return results;
};
