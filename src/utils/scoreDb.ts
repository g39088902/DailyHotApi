import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import logger from "./logger.js";
import type { ScoreLayer, ScoreResult } from "../types.js";

export interface NewsScoreRow {
  id: number;
  news_hash: string;
  source: string;
  title: string;
  desc_text: string;
  url: string;
  formatted_text: string;
  ai_score: number;
  ai_layer: string;
  ai_reason: string;
  ai_model: string;
  user_score: number | null;
  user_layer: string | null;
  user_reason: string | null;
  is_user_modified: number;
  user_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaveAiScoreParams {
  newsHash: string;
  source?: string;
  title?: string;
  desc?: string;
  url?: string;
  formattedText: string;
  aiScore: number;
  aiLayer: ScoreLayer;
  aiReason: string;
  aiModel?: string;
}

export interface SaveUserManualScoreParams {
  id?: number;
  newsHash?: string;
  source?: string;
  title?: string;
  desc?: string;
  url?: string;
  formattedText?: string;
  userScore?: number | null;
  userLayer?: ScoreLayer | null;
  userReason?: string | null;
  reset?: boolean;
  aiScore?: number;
  aiLayer?: ScoreLayer;
  aiReason?: string;
}

export interface QueryScoreRecordsParams {
  onlyUserModified?: boolean;
  source?: string;
  limit?: number;
  offset?: number;
}

const VALID_LAYERS = new Set<ScoreLayer>(["L1", "L2", "L3", "L4", "L5", "Uncertain"]);

/**
 * 根据分数推断默认分层
 */
export const inferLayerFromScore = (score: number): ScoreLayer => {
  if (score >= 90) return "L1";
  if (score >= 75) return "L2";
  if (score >= 60) return "L4";
  if (score >= 40) return "Uncertain";
  return "L5";
};

let dbInstance: DatabaseSync | null = null;

/**
 * 获取或初始化 SQLite 数据库单例连接
 */
export const getScoreDb = (): DatabaseSync => {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = path.resolve(process.cwd(), config.SQLITE_DB_PATH || "./data/scores.sqlite");
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS news_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      news_hash TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      desc_text TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      formatted_text TEXT NOT NULL,
      ai_score INTEGER NOT NULL,
      ai_layer TEXT NOT NULL DEFAULT 'Uncertain',
      ai_reason TEXT NOT NULL DEFAULT '',
      ai_model TEXT NOT NULL DEFAULT '',
      user_score INTEGER DEFAULT NULL,
      user_layer TEXT DEFAULT NULL,
      user_reason TEXT DEFAULT NULL,
      is_user_modified INTEGER NOT NULL DEFAULT 0,
      user_updated_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_news_scores_user_modified ON news_scores(is_user_modified);
    CREATE INDEX IF NOT EXISTS idx_news_scores_created_at ON news_scores(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_news_scores_source ON news_scores(source);
  `);

  dbInstance = db;
  logger.info(`🗄️ [SQLite] News score database initialized at ${dbPath}`);
  return dbInstance;
};

/**
 * 将数据库行转换为对外返回的 ScoreResult
 * 若用户手动修正过分数，则主字段 score / layer / reason 优先采用用户修正值，同时保留 aiScore 与 userScore
 */
export const rowToScoreResult = (row: NewsScoreRow, fromCache: boolean): ScoreResult => {
  const isUserModified = Boolean(row.is_user_modified) && typeof row.user_score === "number";
  const aiLayer: ScoreLayer = VALID_LAYERS.has(row.ai_layer as ScoreLayer)
    ? (row.ai_layer as ScoreLayer)
    : "Uncertain";
  const userLayer: ScoreLayer | null =
    row.user_layer && VALID_LAYERS.has(row.user_layer as ScoreLayer)
      ? (row.user_layer as ScoreLayer)
      : isUserModified && typeof row.user_score === "number"
        ? inferLayerFromScore(row.user_score)
        : null;

  const effectiveScore = isUserModified ? (row.user_score as number) : row.ai_score;
  const effectiveLayer: ScoreLayer = isUserModified && userLayer ? userLayer : aiLayer;
  const effectiveReason =
    isUserModified && row.user_reason && row.user_reason.trim()
      ? row.user_reason
      : row.ai_reason;

  return {
    id: row.id,
    newsHash: row.news_hash,
    score: effectiveScore,
    layer: effectiveLayer,
    reason: effectiveReason,
    aiScore: row.ai_score,
    aiLayer,
    aiReason: row.ai_reason,
    userScore: row.user_score,
    userLayer,
    userReason: row.user_reason,
    isUserModified: Boolean(row.is_user_modified),
    userUpdatedAt: row.user_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fromCache,
  };
};

/**
 * 按 news_hash 查询评分记录
 */
export const getScoreRecordByHash = (newsHash: string): NewsScoreRow | null => {
  if (!newsHash) return null;
  const db = getScoreDb();
  const stmt = db.prepare("SELECT * FROM news_scores WHERE news_hash = ? LIMIT 1");
  const row = stmt.get(newsHash) as unknown as NewsScoreRow | undefined;
  return row ?? null;
};

/**
 * 按主键 ID 查询评分记录
 */
export const getScoreRecordById = (id: number): NewsScoreRow | null => {
  if (!Number.isInteger(id) || id <= 0) return null;
  const db = getScoreDb();
  const stmt = db.prepare("SELECT * FROM news_scores WHERE id = ? LIMIT 1");
  const row = stmt.get(id) as unknown as NewsScoreRow | undefined;
  return row ?? null;
};

/**
 * 写入或更新 AI 评分记录（若已存在用户手动修正字段，则完整保留用户的修正数据）
 */
export const saveAiScoreRecord = (params: SaveAiScoreParams): NewsScoreRow => {
  const db = getScoreDb();
  const now = new Date().toISOString();
  const source = (params.source || "").trim();
  const title = (params.title || "").trim();
  const desc = (params.desc || "").trim();
  const url = (params.url || "").trim();
  const aiModel = (params.aiModel || config.DEEPSEEK_MODEL || "").trim();

  const stmt = db.prepare(`
    INSERT INTO news_scores (
      news_hash, source, title, desc_text, url, formatted_text,
      ai_score, ai_layer, ai_reason, ai_model,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?
    )
    ON CONFLICT(news_hash) DO UPDATE SET
      source = CASE WHEN excluded.source != '' THEN excluded.source ELSE news_scores.source END,
      title = CASE WHEN excluded.title != '' THEN excluded.title ELSE news_scores.title END,
      desc_text = CASE WHEN excluded.desc_text != '' THEN excluded.desc_text ELSE news_scores.desc_text END,
      url = CASE WHEN excluded.url != '' THEN excluded.url ELSE news_scores.url END,
      formatted_text = excluded.formatted_text,
      ai_score = excluded.ai_score,
      ai_layer = excluded.ai_layer,
      ai_reason = excluded.ai_reason,
      ai_model = excluded.ai_model,
      updated_at = excluded.updated_at
  `);

  stmt.run(
    params.newsHash,
    source,
    title,
    desc,
    url,
    params.formattedText,
    params.aiScore,
    params.aiLayer,
    params.aiReason,
    aiModel,
    now,
    now,
  );

  const saved = getScoreRecordByHash(params.newsHash);
  if (!saved) {
    throw new Error("Failed to read back saved AI score record from SQLite");
  }
  return saved;
};

/**
 * 保存或重置用户手动修正的评分（供将来 AI 自动调整推荐逻辑使用）
 */
export const saveUserManualScore = (params: SaveUserManualScoreParams): NewsScoreRow | null => {
  const db = getScoreDb();
  const now = new Date().toISOString();

  // 1. 先尝试通过 id 或 newsHash 查找已有记录
  let existing: NewsScoreRow | null = null;
  if (typeof params.id === "number" && Number.isInteger(params.id) && params.id > 0) {
    existing = getScoreRecordById(params.id);
  }
  if (!existing && params.newsHash) {
    existing = getScoreRecordByHash(params.newsHash);
  }

  // 是否是撤销/重置手动打分
  const isReset = params.reset === true || params.userScore === null;

  if (existing) {
    if (isReset) {
      const resetStmt = db.prepare(`
        UPDATE news_scores
        SET user_score = NULL,
            user_layer = NULL,
            user_reason = NULL,
            is_user_modified = 0,
            user_updated_at = NULL,
            updated_at = ?
        WHERE id = ?
      `);
      resetStmt.run(now, existing.id);
      return getScoreRecordById(existing.id);
    }

    if (typeof params.userScore !== "number" || Number.isNaN(params.userScore)) {
      throw new Error("请提供有效的修正分数 userScore（0~100 整数）");
    }

    const clampedScore = Math.max(0, Math.min(100, Math.round(params.userScore)));
    const resolvedLayer: ScoreLayer =
      params.userLayer && VALID_LAYERS.has(params.userLayer)
        ? params.userLayer
        : inferLayerFromScore(clampedScore);
    const resolvedReason =
      typeof params.userReason === "string"
        ? params.userReason.trim()
        : existing.user_reason;

    const updateStmt = db.prepare(`
      UPDATE news_scores
      SET user_score = ?,
          user_layer = ?,
          user_reason = ?,
          is_user_modified = 1,
          user_updated_at = ?,
          updated_at = ?,
          source = CASE WHEN ? != '' THEN ? ELSE source END,
          title = CASE WHEN ? != '' THEN ? ELSE title END,
          desc_text = CASE WHEN ? != '' THEN ? ELSE desc_text END,
          url = CASE WHEN ? != '' THEN ? ELSE url END
      WHERE id = ?
    `);

    const source = (params.source || "").trim();
    const title = (params.title || "").trim();
    const desc = (params.desc || "").trim();
    const url = (params.url || "").trim();

    updateStmt.run(
      clampedScore,
      resolvedLayer,
      resolvedReason ?? null,
      now,
      now,
      source,
      source,
      title,
      title,
      desc,
      desc,
      url,
      url,
      existing.id,
    );

    return getScoreRecordById(existing.id);
  }

  // 2. 若数据库中尚无该条记录，且不是 reset 操作，并且提供了有效新闻内容与 newsHash，则直接插入一条带用户修正的新记录
  if (isReset) {
    return null;
  }

  if (!params.newsHash || !params.formattedText) {
    return null;
  }

  if (typeof params.userScore !== "number" || Number.isNaN(params.userScore)) {
    throw new Error("请提供有效的修正分数 userScore（0~100 整数）");
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(params.userScore)));
  const resolvedLayer: ScoreLayer =
    params.userLayer && VALID_LAYERS.has(params.userLayer)
      ? params.userLayer
      : inferLayerFromScore(clampedScore);
  const resolvedReason =
    typeof params.userReason === "string" ? params.userReason.trim() : null;

  const initialAiScore =
    typeof params.aiScore === "number" && !Number.isNaN(params.aiScore)
      ? Math.max(0, Math.min(100, Math.round(params.aiScore)))
      : clampedScore;
  const initialAiLayer: ScoreLayer =
    params.aiLayer && VALID_LAYERS.has(params.aiLayer) ? params.aiLayer : resolvedLayer;
  const initialAiReason =
    typeof params.aiReason === "string" && params.aiReason.trim()
      ? params.aiReason.trim()
      : "用户直接手动打分（未经过AI初评）";

  const insertStmt = db.prepare(`
    INSERT INTO news_scores (
      news_hash, source, title, desc_text, url, formatted_text,
      ai_score, ai_layer, ai_reason, ai_model,
      user_score, user_layer, user_reason, is_user_modified, user_updated_at,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, 1, ?,
      ?, ?
    )
  `);

  insertStmt.run(
    params.newsHash,
    (params.source || "").trim(),
    (params.title || "").trim(),
    (params.desc || "").trim(),
    (params.url || "").trim(),
    params.formattedText,
    initialAiScore,
    initialAiLayer,
    initialAiReason,
    config.DEEPSEEK_MODEL || "",
    clampedScore,
    resolvedLayer,
    resolvedReason,
    now,
    now,
    now,
  );

  return getScoreRecordByHash(params.newsHash);
};

/**
 * 查询 SQLite 中的新闻评分记录列表（支持只筛选用户手动修正过的记录，供 AI 自动调优读取）
 */
export const queryScoreRecords = (
  params: QueryScoreRecordsParams = {},
): { total: number; items: NewsScoreRow[] } => {
  const db = getScoreDb();
  const conditions: string[] = [];
  const bindValues: Array<string | number> = [];

  if (params.onlyUserModified) {
    conditions.push("is_user_modified = 1");
  }
  if (params.source && params.source.trim()) {
    conditions.push("source = ?");
    bindValues.push(params.source.trim());
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(params.limit || 100, 500));
  const offset = Math.max(0, params.offset || 0);

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM news_scores ${whereClause}`);
  const countRow = countStmt.get(...bindValues) as { total?: number } | undefined;
  const total = Number(countRow?.total ?? 0);

  const listStmt = db.prepare(`
    SELECT * FROM news_scores
    ${whereClause}
    ORDER BY CASE WHEN is_user_modified = 1 THEN user_updated_at ELSE updated_at END DESC, id DESC
    LIMIT ? OFFSET ?
  `);
  const items = listStmt.all(...bindValues, limit, offset) as unknown as NewsScoreRow[];

  return { total, items };
};
