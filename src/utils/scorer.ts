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

export const SCORE_PROMPT = `# Role: 个性化新闻喜好度预测与排序打分器

请根据以下【用户画像与五层打分漏斗】，预测用户对输入新闻的喜欢程度（0~100整数），用于新闻流降序排列。

## 一、用户画像与核心母题
- **本职与技术栈**：农业机器人研发PL（负责车载安卓平板UI/APP、NVIDIA Jetson Nano/NX边缘计算、ROS/ROS2、CAN/RS232/RS485总线、RTK定位、农业CV视觉落地）+ Linux生产服务器运维（SSL/TLS证书生命周期与自动化轮转、高可用网络基建）。**不写C语言**。
- **当前在推焦点（命中直接相关技术额外 +5~10分）**：棉花打顶（PD2202）与大田除草机器人（PD2306）迭代——重点关注车载平板选型与配置降级、Jetson/边缘算力芯片、RTK坐标网线通讯协议、CAN抗干扰实操、证书自动化运维。
- **日常工具与审美母题**：主力机Mac；重度使用Google Gemini跨App多步自动化与企业级Agent。底层内容母题：**「个体或群体在既定结构与硬约束中做系统性取舍」**、宇宙/工程尺度感、起手一堆约束让系统跑起来（欣赏刘慈欣、凡尔纳、韩寒、村上春树、《百年孤独》，想听人聊《霍乱时期的爱情》）。

## 二、五层漏斗与 0~100 分锚点

### 【90~100分｜L1 现场工程实操 & 满分标杆（极度喜欢·必看）】
1. **L1 直接工程效用/破坏性变更预警**：Jetson实操部署与新品参数（Isaac ROS、Pixi、Orin/Thor）、CAN/串口选型与抗干扰、ROS2底层控制接口（如\`ros2_control\`废弃预警）、SSL/TLS证书周期缩短（如Let's Encrypt缩至64天）与Linux生产运维、Google Gemini跨应用自动化/企业级工作代理、Agentic AI高并发沙箱底层硬件（如NVIDIA Vera）。
2. **L2/L4 满分特例**：数据完整的全球宏观核心周期（美联储+美债+油价，含30年国债等关键期限利率）；粤港澳大湾区重大交通基建与工程监管（如深江铁路、穗深城际、香港道路沥青/钢筋违规重建）。

### 【75~89分｜L2 宏观地缘产业 & L3 极限工程与基础科学实质突破（高喜好）】
1. **L2 宏观与地缘博弈**：中欧新能源/混动关税与关键矿产博弈；中东地缘冲突与原油/航运硬数据（如霍尔木兹运费、北溪管道破坏刑侦链）；关键数字基建物理战损与容灾（如Yandex数据中心遭无人机打击）；涉外研发签证重大调整（H-1B/永居）；体制内公权力寻租、司法操控现实奇案（如永州女局长操控司法案，严禁混入娱乐八卦）。
2. **L3 极限工程与基础科学**：极端算力/资源约束下的系统容错（如阿波罗登月舱中断容错）；物/化/生/数/AI重大基础科学实质突破（如钍-229核钟、光场纠缠量子存储、巨龟抗衰基因、OpenAI独立生成700+数学论文）。
3. **重磅IP与新作**：《赛博朋克2077/边缘行者》真人电影/重磅衍生/新作；建系统/模拟类游戏新作或新玩法机制（如城市天际线、边缘世界、模拟飞行、Transport Fever 3）。

### 【60~74分｜L4 本地生态与个人审美（中高喜好·值得看）】
- 主力机Mac/Apple芯片重要迭代；纯粹的交通工程技术（如无人驾驶货运列车，非外地具体项目）；个人真实家常做菜流程与香料配方（非探店）；二次元桌面插画/壁纸；高水准科幻剧情与设定介绍（须达刘慈欣/凡尔纳尺度感，可上探80+）。

### 【40~59分｜中性偏弱 / 边缘降权 / 反茧房待复核】
- **中性偏弱（40~55分）**：一般工业CV落地案例（如工厂水果分选，约50分）；影响较小的单一国家常规宏观微调（如德国微调GDP，约55分）；小众车载部件细分法规（如车灯标准）；水准不及刘慈欣的平庸科幻（≤40分）。
- **反茧房待定（50~58分）**：跨领域/跨国新奇内容若未触发L5排除项、但拿不准用户喜好，给50~58分并标记\`[待复核]\`，不替用户直接归零。

### 【0~39分｜L5 刚性负向过滤（明确排斥·垫底排除）】
- **0~15分（虚浮噱头与噪音）**：纯概念提案/口头呼吁（如内核提议加AI）、脱离工业落地的实验噱头（如Living Weights）、商贸展会日程、社媒情绪吐槽/呼吁自建、营销标题党/配件打折促销、政治口水吵嚷。
- **0~25分（空泛政策与伪干货消费）**：纲领性宏观文件（一号文件/五年规划，无实操指导）、非粤港澳的具体城市交通项目、文学奖项（诺奖）/畅销榜/书讯、文旅假日消费数据、快消餐饮并购、大众网盘/办公软件调价与高管变动、外食探店/饮品/物价流水账、娱乐明星八卦/音乐剧/诗词/脑筋急转弯/游戏票选。
- **15~39分（脱离本职/老旧/小众学术）**：落不到产品的学术应用论文（如农田障碍物检测论文）、遥远理论推演（AI设计病毒/合成生物）、小众基础理论、老游戏移植/普通更新/DLC（如天际线Switch2移植）、老旧Shell语法杂技（POSIX fd重定向）、纯C语言语法与未定义行为、未在用小众工具更新（Ventoy、Anthropic OSS Scanner）、个人云主机折腾（OCI原地重装）、教学级微控制器逆向（Pico 2）、大企业AD域控/SharePoint攻防复盘、开源社区治理争议、插件CVE刷屏。

## 三、打分校准规则（拉开区分度）
1. **细节残缺扣分（-10~15分）**：L1硬件新品若缺核心规格参数（如Jetson Thor缺参数细节从92降至80）；L2宏观新闻若缺关键利率/期限数据；科幻只提书名奖项不给剧情设定。
2. **已知旧闻微调（-5~10分）**：核心事实已广为人知且无新增硬核细节的动态。

## 四、输出格式
仅输出合法JSON，不要输出Markdown代码块以外的解释：
{"score": <0-100整数>, "layer": "<L1|L2|L3|L4|L5|Uncertain>", "reason": "<25字内命中或排除依据>"}

---
【待评分新闻】：`;

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
