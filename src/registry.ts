import { fileURLToPath } from "url";
import { config } from "./config.js";
import { Hono } from "hono";
import getRSS from "./utils/getRSS.js";
import { deduplicateArticles } from "./utils/deduplicate.js";
import {
  scoreNewsItem,
  scoreNewsBatch,
  formatNewsInput,
  updateManualScoreItem,
} from "./utils/scorer.js";
import type { ScoreInputItem, ManualScoreInput } from "./utils/scorer.js";
import {
  getScoreRecordByHash,
  getScoreRecordById,
  queryScoreRecords,
  rowToScoreResult,
} from "./utils/scoreDb.js";
import logger from "./utils/logger.js";
import path from "path";
import fs from "fs";

const app = new Hono();

// 模拟 __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 路由数据
let allRoutePath: Array<string> = [];
const routersDirName: string = "routes";

// 排除路由
const excludeRoutes: Array<string> = [];

// 建立完整目录路径
const routersDirPath = path.join(__dirname, routersDirName);

// 递归查找函数
const findTsFiles = (dirPath: string, allFiles: string[] = [], basePath: string = ""): string[] => {
  // 读取目录下的所有文件和文件夹
  const items: Array<string> = fs.readdirSync(dirPath);
  // 遍历每个文件或文件夹
  items.forEach((item) => {
    const fullPath: string = path.join(dirPath, item);
    const relativePath: string = basePath ? path.posix.join(basePath, item) : item;
    const stat: fs.Stats = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      // 如果是文件夹，递归查找
      findTsFiles(fullPath, allFiles, relativePath);
    } else if (
      stat.isFile() &&
      (item.endsWith(".ts") || item.endsWith(".js")) &&
      !item.endsWith(".d.ts")
    ) {
      // 符合条件
      allFiles.push(relativePath.replace(/\.(ts|js)$/, ""));
    }
  });
  return allFiles;
};

// 获取全部路由
if (fs.existsSync(routersDirPath) && fs.statSync(routersDirPath).isDirectory()) {
  allRoutePath = findTsFiles(routersDirPath);
} else {
  console.error(`📂 The directory ${routersDirPath} does not exist or is not a directory`);
}

// 注册全部路由
for (let index = 0; index < allRoutePath.length; index++) {
  const router = allRoutePath[index];
  // 是否处于排除名单
  if (excludeRoutes.includes(router)) {
    continue;
  }
  const listApp = app.basePath(`/${router}`);
  // 返回榜单
  listApp.get("/", async (c) => {
    // 是否采用缓存
    const noCache = c.req.query("cache") === "false";
    // 限制显示条目
    const limit = c.req.query("limit");
    // 是否输出 RSS
    const rssEnabled = c.req.query("rss") === "true";
    // 获取路由路径
    const { handleRoute } = await import(`./routes/${router}.js`);
    const listData = await handleRoute(c, noCache);
    // 限制单信源最多只返回 30 条（如果传了更小的 limit 则以更小的为准）
    const maxLimit = limit ? Math.min(parseInt(limit, 10), 30) : 30;
    if (Array.isArray(listData?.data)) {
      // 构造当前路由及子分类唯一标识（忽略 cache / limit / rss 等控制参数）
      const rawQueries = c.req.query();
      const subQuery = Object.keys(rawQueries)
        .filter((k) => !["cache", "limit", "rss"].includes(k) && rawQueries[k] !== undefined)
        .sort()
        .map((k) => `${k}=${rawQueries[k]}`)
        .join("&");
      const routeKey = subQuery ? `${router}?${subQuery}` : router;

      listData.data = deduplicateArticles(listData.data, routeKey, {
        noCache,
        maxItems: maxLimit,
      });
      listData.total = listData.data.length;
    }
    // 是否输出 RSS
    if (rssEnabled || config.RSS_MODE) {
      const rss = getRSS(listData);
      if (typeof rss === "string") {
        c.header("Content-Type", "application/xml; charset=utf-8");
        return c.body(rss);
      } else {
        return c.json({ code: 500, message: "RSS generation failed" }, 500);
      }
    }
    return c.json({ code: 200, ...listData });
  });
  // 请求方式错误
  listApp.all("*", (c) => c.json({ code: 405, message: "Method Not Allowed" }, 405));
}

// 个性化新闻喜好度评分接口（GET 单条评分，优先检查 SQLite 缓存）
app.get("/score", async (c) => {
  try {
    const forceRescore =
      c.req.query("force") === "true" || c.req.query("rescore") === "true";
    const input: ScoreInputItem = {
      title: c.req.query("title"),
      desc: c.req.query("desc"),
      source: c.req.query("source"),
      url: c.req.query("url"),
      text: c.req.query("text"),
      content: c.req.query("content"),
      news: c.req.query("news"),
    };

    if (!formatNewsInput(input)) {
      return c.json(
        {
          code: 400,
          message: "请提供待评分新闻内容（支持 title、desc、text、content 或 news 参数）",
        },
        400,
      );
    }

    const result = await scoreNewsItem(input, { forceRescore });
    return c.json({
      code: 200,
      message: "评分成功",
      ...result,
      data: result,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logger.error(`❌ [GET /score] ${msg}`);
    return c.json({ code: 500, message: `评分失败: ${msg}` }, 500);
  }
});

// 个性化新闻喜好度评分接口（POST 支持单条或批量评分与降序排列，优先检查 SQLite 缓存）
app.post("/score", async (c) => {
  try {
    let body: any;
    const contentType = c.req.header("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await c.req.json();
    } else {
      const rawText = await c.req.text();
      try {
        body = JSON.parse(rawText);
      } catch {
        body = { text: rawText };
      }
    }

    const queryForceRescore =
      c.req.query("force") === "true" || c.req.query("rescore") === "true";
    const querySort = c.req.query("sort") === "true";

    // 判断是否为批量评分请求
    const batchItems: Array<string | ScoreInputItem> | null = Array.isArray(body)
      ? body
      : Array.isArray(body?.items)
        ? body.items
        : Array.isArray(body?.texts)
          ? body.texts
          : Array.isArray(body?.data)
            ? body.data
            : null;

    if (batchItems !== null) {
      const forceRescore =
        queryForceRescore || body?.force === true || body?.rescore === true || body?.forceRescore === true;
      const shouldSort = querySort || body?.sort === true;
      const concurrency = typeof body?.concurrency === "number" ? body.concurrency : undefined;

      const scoredList = await scoreNewsBatch(batchItems, { forceRescore, concurrency });
      if (shouldSort) {
        scoredList.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      }

      return c.json({
        code: 200,
        message: "评分成功",
        total: scoredList.length,
        data: scoredList,
      });
    }

    // 单条评分请求
    const forceRescore =
      queryForceRescore || body?.force === true || body?.rescore === true || body?.forceRescore === true;
    const input = typeof body === "string" ? body : (body as ScoreInputItem);

    if (!formatNewsInput(input)) {
      return c.json(
        {
          code: 400,
          message: "请提供待评分新闻内容（支持单条 { title, desc, text } 或批量 { items: [...] }）",
        },
        400,
      );
    }

    const result = await scoreNewsItem(input, { forceRescore });
    return c.json({
      code: 200,
      message: "评分成功",
      ...result,
      data: typeof input === "object" && input !== null ? { ...input, ...result } : result,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logger.error(`❌ [POST /score] ${msg}`);
    return c.json({ code: 500, message: `评分失败: ${msg}` }, 500);
  }
});

// 接收用户手动修正分数的通用处理器（支持单条或批量修正、支持重置，供将来 AI 自动调整推荐逻辑使用）
const handleManualScoreUpdate = async (c: any) => {
  try {
    let body: any = {};
    const contentType = c.req.header("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await c.req.json();
    } else {
      const rawText = await c.req.text();
      if (rawText.trim()) {
        body = JSON.parse(rawText);
      }
    }

    const batchItems: ManualScoreInput[] | null = Array.isArray(body)
      ? body
      : Array.isArray(body?.items)
        ? body.items
        : Array.isArray(body?.data)
          ? body.data
          : null;

    if (batchItems !== null) {
      const results = batchItems.map((item) => updateManualScoreItem(item));
      return c.json({
        code: 200,
        message: "批量用户评分修正已保存",
        total: results.length,
        data: results,
      });
    }

    const result = updateManualScoreItem(body as ManualScoreInput);
    return c.json({
      code: 200,
      message: result.isUserModified ? "用户评分修正已保存" : "已重置为 AI 原始评分",
      ...result,
      data: result,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logger.error(`❌ [Manual Score Update] ${msg}`);
    return c.json({ code: 400, message: `保存手动评分失败: ${msg}` }, 400);
  }
};

// 注册用户手动修正评分接口（支持 POST / PUT / PATCH 多种调用方式）
app.post("/score/manual", handleManualScoreUpdate);
app.put("/score/manual", handleManualScoreUpdate);
app.patch("/score/manual", handleManualScoreUpdate);
app.post("/score/feedback", handleManualScoreUpdate);
app.put("/score", handleManualScoreUpdate);
app.patch("/score", handleManualScoreUpdate);

// 查询 SQLite 中存储的新闻打分与用户修正记录接口（供将来 AI 自动调整推荐逻辑或后台分析调用）
const handleQueryScoreRecords = (defaultOnlyModified: boolean) => (c: any) => {
  try {
    const idParam = c.req.query("id");
    const hashParam = c.req.query("newsHash") || c.req.query("hash");

    if (idParam && /^\d+$/.test(idParam)) {
      const row = getScoreRecordById(parseInt(idParam, 10));
      if (!row) {
        return c.json({ code: 404, message: "未找到对应的评分记录" }, 404);
      }
      return c.json({
        code: 200,
        data: {
          ...rowToScoreResult(row, true),
          source: row.source,
          title: row.title,
          desc: row.desc_text,
          url: row.url,
          formattedText: row.formatted_text,
          aiModel: row.ai_model,
        },
      });
    }

    if (hashParam) {
      const row = getScoreRecordByHash(hashParam.trim());
      if (!row) {
        return c.json({ code: 404, message: "未找到对应的评分记录" }, 404);
      }
      return c.json({
        code: 200,
        data: {
          ...rowToScoreResult(row, true),
          source: row.source,
          title: row.title,
          desc: row.desc_text,
          url: row.url,
          formattedText: row.formatted_text,
          aiModel: row.ai_model,
        },
      });
    }

    const modifiedQuery = c.req.query("modified");
    const onlyUserModified =
      modifiedQuery !== undefined
        ? modifiedQuery === "true" || modifiedQuery === "1"
        : defaultOnlyModified;

    const source = c.req.query("source") || undefined;
    const limit = c.req.query("limit") ? parseInt(c.req.query("limit"), 10) : 100;
    const offset = c.req.query("offset") ? parseInt(c.req.query("offset"), 10) : 0;

    const { total, items } = queryScoreRecords({
      onlyUserModified,
      source,
      limit,
      offset,
    });

    const formattedItems = items.map((row) => ({
      ...rowToScoreResult(row, true),
      source: row.source,
      title: row.title,
      desc: row.desc_text,
      url: row.url,
      formattedText: row.formatted_text,
      aiModel: row.ai_model,
    }));

    return c.json({
      code: 200,
      total,
      count: formattedItems.length,
      onlyUserModified,
      data: formattedItems,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logger.error(`❌ [GET /score/records] ${msg}`);
    return c.json({ code: 500, message: `查询评分记录失败: ${msg}` }, 500);
  }
};

app.get("/score/records", handleQueryScoreRecords(false));
app.get("/score/manual", handleQueryScoreRecords(true));
app.get("/score/feedback", handleQueryScoreRecords(true));

// 获取全部路由
app.get("/all", (c) =>
  c.json(
    {
      code: 200,
      count: allRoutePath.length,
      routes: allRoutePath.map((path) => {
        // 是否处于排除名单
        if (excludeRoutes.includes(path)) {
          return {
            name: path,
            path: undefined,
            message: "This interface is temporarily offline",
          };
        }
        return { name: path, path: `/${path}` };
      }),
    },
    200,
  ),
);

export default app;
