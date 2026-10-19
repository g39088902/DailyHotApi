import { DatabaseSync } from "node:sqlite";
import { createClient, type Client } from "@libsql/client";
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
  is_read: number;
  read_at: string | null;
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

export interface SaveNewsReadStatusParams {
  id?: number;
  newsHash?: string;
  source?: string;
  title?: string;
  desc?: string;
  url?: string;
  formattedText?: string;
  isRead?: boolean;
}

export interface QueryScoreRecordsParams {
  onlyUserModified?: boolean;
  onlyRead?: boolean;
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

let libsqlClient: Client | null = null;
let localDbInstance: DatabaseSync | null = null;
let initPromise: Promise<void> | null = null;

/**
 * 初始化数据库连接（支持远程 sqld 与本地 node:sqlite）
 */
export const initScoreDb = async (): Promise<void> => {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    if (config.LIBSQL_URL) {
      logger.info(`🌐 [Database] Connecting to remote sqld at ${config.LIBSQL_URL}...`);
      libsqlClient = createClient({
        url: config.LIBSQL_URL,
        authToken: config.LIBSQL_AUTH_TOKEN || undefined,
      });

      // 初始化表结构与索引
      await libsqlClient.execute(`
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
          is_read INTEGER NOT NULL DEFAULT 0,
          read_at TEXT DEFAULT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      await libsqlClient.execute(`CREATE INDEX IF NOT EXISTS idx_news_scores_user_modified ON news_scores(is_user_modified);`);
      await libsqlClient.execute(`CREATE INDEX IF NOT EXISTS idx_news_scores_created_at ON news_scores(created_at DESC);`);
      await libsqlClient.execute(`CREATE INDEX IF NOT EXISTS idx_news_scores_source ON news_scores(source);`);
      await libsqlClient.execute(`CREATE INDEX IF NOT EXISTS idx_news_scores_is_read ON news_scores(is_read);`);

      logger.info(`✅ [Database] Remote sqld database initialized successfully at ${config.LIBSQL_URL}`);
    } else {
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
          is_read INTEGER NOT NULL DEFAULT 0,
          read_at TEXT DEFAULT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_news_scores_user_modified ON news_scores(is_user_modified);
        CREATE INDEX IF NOT EXISTS idx_news_scores_created_at ON news_scores(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_news_scores_source ON news_scores(source);
        CREATE INDEX IF NOT EXISTS idx_news_scores_is_read ON news_scores(is_read);
      `);

      localDbInstance = db;
      logger.info(`🗄️ [SQLite] Local database initialized at ${dbPath}`);
    }
  })();

  return initPromise;
};

/**
 * 获取本地 SQLite 数据库实例（用于仅本地运行场景）
 */
export const getScoreDb = (): DatabaseSync | Client => {
  if (libsqlClient) {
    return libsqlClient;
  }
  if (localDbInstance) {
    return localDbInstance;
  }
  if (!config.LIBSQL_URL) {
    const dbPath = path.resolve(process.cwd(), config.SQLITE_DB_PATH || "./data/scores.sqlite");
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    localDbInstance = new DatabaseSync(dbPath);
    return localDbInstance;
  }
  // 如果配置了远程 sqld 但尚未完成 initScoreDb，立即初始化
  initScoreDb().catch((err) => {
    logger.error(`❌ [Database] Failed to initialize sqld client: ${err?.message}`);
  });
  return libsqlClient!;
};

/**
 * 确保数据库已初始化
 */
const ensureDb = async (): Promise<void> => {
  if (!libsqlClient && !localDbInstance) {
    await initScoreDb();
  }
};

/**
 * 统一执行查询并返回单条记录
 */
const queryOne = async (sql: string, args: any[] = []): Promise<any | null> => {
  await ensureDb();
  if (libsqlClient) {
    const res = await libsqlClient.execute({ sql, args });
    if (!res.rows || res.rows.length === 0) return null;
    return res.rows[0];
  }
  const db = localDbInstance!;
  const stmt = db.prepare(sql);
  const row = stmt.get(...args);
  return row ?? null;
};

/**
 * 统一执行查询并返回多条记录
 */
const queryRows = async (sql: string, args: any[] = []): Promise<any[]> => {
  await ensureDb();
  if (libsqlClient) {
    const res = await libsqlClient.execute({ sql, args });
    return res.rows ? [...res.rows] : [];
  }
  const db = localDbInstance!;
  const stmt = db.prepare(sql);
  const rows = stmt.all(...args);
  return rows ?? [];
};

/**
 * 统一执行写入/更新语句
 */
const executeSql = async (sql: string, args: any[] = []): Promise<void> => {
  await ensureDb();
  if (libsqlClient) {
    await libsqlClient.execute({ sql, args });
  } else {
    const db = localDbInstance!;
    if (args.length > 0) {
      db.prepare(sql).run(...args);
    } else {
      db.exec(sql);
    }
  }
};

/**
 * 将数据库原始对象映射为严格契约的 NewsScoreRow
 */
const mapDbRow = (row: any): NewsScoreRow => {
  return {
    id: Number(row.id),
    news_hash: String(row.news_hash || ""),
    source: String(row.source || ""),
    title: String(row.title || ""),
    desc_text: String(row.desc_text || ""),
    url: String(row.url || ""),
    formatted_text: String(row.formatted_text || ""),
    ai_score: Number(row.ai_score ?? -1),
    ai_layer: String(row.ai_layer || "Uncertain"),
    ai_reason: String(row.ai_reason || ""),
    ai_model: String(row.ai_model || ""),
    user_score: row.user_score !== null && row.user_score !== undefined ? Number(row.user_score) : null,
    user_layer: row.user_layer ? String(row.user_layer) : null,
    user_reason: row.user_reason ? String(row.user_reason) : null,
    is_user_modified: Number(row.is_user_modified || 0),
    user_updated_at: row.user_updated_at ? String(row.user_updated_at) : null,
    is_read: Number(row.is_read || 0),
    read_at: row.read_at ? String(row.read_at) : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
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
    isRead: Boolean(row.is_read),
    readAt: row.read_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fromCache,
  };
};

/**
 * 按 news_hash 查询评分记录
 */
export const getScoreRecordByHash = async (newsHash: string): Promise<NewsScoreRow | null> => {
  if (!newsHash) return null;
  const row = await queryOne("SELECT * FROM news_scores WHERE news_hash = ? LIMIT 1", [newsHash]);
  return row ? mapDbRow(row) : null;
};

/**
 * 批量按 news_hash 检索评分记录（优化单次往返，大幅提升远程 sqld 批量缓存速查性能）
 */
export const getScoreRecordsByHashes = async (hashes: string[]): Promise<Map<string, NewsScoreRow>> => {
  const result = new Map<string, NewsScoreRow>();
  const cleanHashes = [...new Set(hashes.filter(Boolean))];
  if (cleanHashes.length === 0) return result;

  const chunkSize = 50;
  for (let i = 0; i < cleanHashes.length; i += chunkSize) {
    const chunk = cleanHashes.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await queryRows(`SELECT * FROM news_scores WHERE news_hash IN (${placeholders})`, chunk);
    for (const r of rows) {
      const mapped = mapDbRow(r);
      result.set(mapped.news_hash, mapped);
    }
  }

  return result;
};

/**
 * 按主键 ID 查询评分记录
 */
export const getScoreRecordById = async (id: number): Promise<NewsScoreRow | null> => {
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await queryOne("SELECT * FROM news_scores WHERE id = ? LIMIT 1", [id]);
  return row ? mapDbRow(row) : null;
};

/**
 * 写入或更新 AI 评分记录（若已存在用户手动修正字段，则完整保留用户的修正数据）
 */
export const saveAiScoreRecord = async (params: SaveAiScoreParams): Promise<NewsScoreRow> => {
  const now = new Date().toISOString();
  const source = (params.source || "").trim();
  const title = (params.title || "").trim();
  const desc = (params.desc || "").trim();
  const url = (params.url || "").trim();
  const aiModel = (params.aiModel || config.DEEPSEEK_MODEL || "").trim();

  await executeSql(
    `
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
    `,
    [
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
    ],
  );

  const saved = await getScoreRecordByHash(params.newsHash);
  if (!saved) {
    throw new Error("Failed to read back saved AI score record from database");
  }
  return saved;
};

/**
 * 保存或重置用户手动修正的评分（供将来 AI 自动调整推荐逻辑使用）
 */
export const saveUserManualScore = async (params: SaveUserManualScoreParams): Promise<NewsScoreRow | null> => {
  const now = new Date().toISOString();

  // 1. 先尝试通过 id 或 newsHash 查找已有记录
  let existing: NewsScoreRow | null = null;
  if (typeof params.id === "number" && Number.isInteger(params.id) && params.id > 0) {
    existing = await getScoreRecordById(params.id);
  }
  if (!existing && params.newsHash) {
    existing = await getScoreRecordByHash(params.newsHash);
  }

  // 是否是撤销/重置手动打分
  const isReset = params.reset === true || params.userScore === null;

  if (existing) {
    if (isReset) {
      await executeSql(
        `
        UPDATE news_scores
        SET user_score = NULL,
            user_layer = NULL,
            user_reason = NULL,
            is_user_modified = 0,
            user_updated_at = NULL,
            updated_at = ?
        WHERE id = ?
        `,
        [now, existing.id],
      );
      return await getScoreRecordById(existing.id);
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

    const source = (params.source || "").trim();
    const title = (params.title || "").trim();
    const desc = (params.desc || "").trim();
    const url = (params.url || "").trim();

    await executeSql(
      `
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
      `,
      [
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
      ],
    );

    return await getScoreRecordById(existing.id);
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

  await executeSql(
    `
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
    `,
    [
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
    ],
  );

  return await getScoreRecordByHash(params.newsHash);
};

/**
 * 保存或更新单条新闻的已读状态（支持评分完成前先落库已读状态，后续 AI 评分不会覆盖 is_read）
 */
export const saveNewsReadStatus = async (params: SaveNewsReadStatusParams): Promise<NewsScoreRow | null> => {
  const now = new Date().toISOString();
  const isRead = params.isRead !== undefined ? Boolean(params.isRead) : true;
  const isReadVal = isRead ? 1 : 0;
  const readAtVal = isRead ? now : null;

  let existing: NewsScoreRow | null = null;
  if (typeof params.id === "number" && Number.isInteger(params.id) && params.id > 0) {
    existing = await getScoreRecordById(params.id);
  }
  if (!existing && params.newsHash) {
    existing = await getScoreRecordByHash(params.newsHash);
  }

  if (existing) {
    const source = (params.source || "").trim();
    const title = (params.title || "").trim();
    const desc = (params.desc || "").trim();
    const url = (params.url || "").trim();

    await executeSql(
      `
      UPDATE news_scores
      SET is_read = ?,
          read_at = CASE WHEN ? = 1 THEN COALESCE(read_at, ?) ELSE NULL END,
          updated_at = ?,
          source = CASE WHEN ? != '' THEN ? ELSE source END,
          title = CASE WHEN ? != '' THEN ? ELSE title END,
          desc_text = CASE WHEN ? != '' THEN ? ELSE desc_text END,
          url = CASE WHEN ? != '' THEN ? ELSE url END
      WHERE id = ?
      `,
      [
        isReadVal,
        isReadVal,
        readAtVal,
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
      ],
    );

    return await getScoreRecordById(existing.id);
  }

  // 若数据库中尚无该条记录，且传入了有效的 newsHash 与 formattedText，则预先插入一条占位记录（ai_score = -1 表示尚未完成 AI 评分）
  if (!params.newsHash || !params.formattedText) {
    return null;
  }

  await executeSql(
    `
    INSERT INTO news_scores (
      news_hash, source, title, desc_text, url, formatted_text,
      ai_score, ai_layer, ai_reason, ai_model,
      is_read, read_at,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      -1, 'Uncertain', '', '',
      ?, ?,
      ?, ?
    )
    `,
    [
      params.newsHash,
      (params.source || "").trim(),
      (params.title || "").trim(),
      (params.desc || "").trim(),
      (params.url || "").trim(),
      params.formattedText,
      isReadVal,
      readAtVal,
      now,
      now,
    ],
  );

  return await getScoreRecordByHash(params.newsHash);
};

/**
 * 获取所有已读新闻的 newsHash 列表（供前端初始化同步跨端已读状态）
 */
export const getAllReadNewsHashes = async (limit = 5000): Promise<string[]> => {
  const safeLimit = Math.max(1, Math.min(limit, 20000));
  const rows = await queryRows(
    `
    SELECT news_hash FROM news_scores
    WHERE is_read = 1
    ORDER BY COALESCE(read_at, updated_at) DESC
    LIMIT ?
    `,
    [safeLimit],
  );
  return rows.map((r: any) => String(r.news_hash)).filter(Boolean);
};

/**
 * 查询数据库中的新闻评分记录列表（支持只筛选用户手动修正过或已读的记录，供 AI 自动调优读取）
 */
export const queryScoreRecords = async (
  params: QueryScoreRecordsParams = {},
): Promise<{ total: number; items: NewsScoreRow[] }> => {
  const conditions: string[] = [];
  const bindValues: Array<string | number> = [];

  if (params.onlyUserModified) {
    conditions.push("is_user_modified = 1");
  }
  if (params.onlyRead !== undefined) {
    conditions.push("is_read = ?");
    bindValues.push(params.onlyRead ? 1 : 0);
  }
  if (params.source && params.source.trim()) {
    conditions.push("source = ?");
    bindValues.push(params.source.trim());
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(params.limit || 100, 500));
  const offset = Math.max(0, params.offset || 0);

  const countRow = await queryOne(`SELECT COUNT(*) as total FROM news_scores ${whereClause}`, bindValues);
  const total = Number(countRow?.total ?? 0);

  const rows = await queryRows(
    `
    SELECT * FROM news_scores
    ${whereClause}
    ORDER BY CASE WHEN is_user_modified = 1 THEN user_updated_at ELSE updated_at END DESC, id DESC
    LIMIT ? OFFSET ?
    `,
    [...bindValues, limit, offset],
  );

  const items = rows.map((r: any) => mapDbRow(r));
  return { total, items };
};
