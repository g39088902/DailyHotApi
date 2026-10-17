import { serve } from "@hono/node-server";
import { config } from "./config.js";
import logger from "./utils/logger.js";
import { getScoreDb } from "./utils/scoreDb.js";
import app from "./app.js";

// 防止异步打分/网络请求意外异常导致服务崩溃退出
process.on("uncaughtException", (err) => {
  logger.error(`[Process] Uncaught Exception: ${err?.stack || err}`);
});

process.on("unhandledRejection", (reason) => {
  logger.error(`[Process] Unhandled Rejection: ${reason instanceof Error ? reason.stack : reason}`);
});

// 启动服务器
const serveHotApi: (port?: number) => void = (port: number = config.PORT) => {
  try {
    getScoreDb();
    const apiServer = serve({
      fetch: app.fetch,
      port,
    });
    logger.info(`🔥 DailyHot API successfully runs on port ${port}`);
    logger.info(`🔗 Local: 👉 http://localhost:${port}`);
    return apiServer;
  } catch (error) {
    logger.error(error);
  }
};

if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "docker") {
  serveHotApi(config.PORT);
}

export default serveHotApi;
