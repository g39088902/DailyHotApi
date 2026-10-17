<div align="center">

<img alt="DailyHot Logo" height="120" src="./public/favicon.png" width="120"/>

# DailyHotApi · 全网情报聚合与 AI 智能降噪中枢

<p align="center">
  <strong>基于 Hono + DeepSeek AI + 原生 SQLite 构建的高性能实时资讯与智能打分引擎</strong>
</p>

<p align="center">
  <a href="https://github.com/imsyy/DailyHotApi/actions"><img src="https://img.shields.io/github/actions/workflow/status/imsyy/DailyHotApi/docker.yml?branch=master&style=flat-square&logo=github" alt="Build Status" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?style=flat-square&logo=node.js" alt="Node.js Version" /></a>
  <a href="https://hono.dev/"><img src="https://img.shields.io/badge/Framework-Hono%20v4-E36002?style=flat-square&logo=hono" alt="Hono Framework" /></a>
  <a href="https://www.deepseek.com/"><img src="https://img.shields.io/badge/AI%20Engine-DeepSeek-4D6BFE?style=flat-square" alt="DeepSeek AI" /></a>
  <a href="https://nodejs.org/api/sqlite.html"><img src="https://img.shields.io/badge/Database-node%3Asqlite-003B57?style=flat-square&logo=sqlite" alt="SQLite Inside" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/imsyy/DailyHotApi?style=flat-square" alt="License" /></a>
  <a href="https://hub.docker.com/r/imsyy/dailyhot-api"><img src="https://img.shields.io/docker/pulls/imsyy/dailyhot-api?style=flat-square&logo=docker" alt="Docker Pulls" /></a>
</p>

<p align="center">
  <a href="#-为什么选择-dailyhotapi">核心价值</a> •
  <a href="#-杀手级特性">核心特性</a> •
  <a href="#-高价值信源矩阵">信源矩阵</a> •
  <a href="#-api-接口一览">API 文档</a> •
  <a href="#-极速上手">快速开始</a> •
  <a href="#-生产环境部署">部署指南</a>
</p>

</div>

---

## 💡 为什么选择 DailyHotApi？

在信息严重过载的今天，传统资讯聚合往往面临三大痛点：

1. **信噪比极低**：主流热榜充斥着买榜营销、娱乐八卦、情绪煽动与家长里短，高价值的宏观经济与前沿工程进展被淹没；
2. **多源采集复杂脆弱**：各大平台反爬严格、格式迥异，自行开发维护成本高昂且极易因源站改版而失效；
3. **算法黑盒与信息茧房**：推荐系统通常以“停留时长”为导向，而非以“高价值知识密度”为目标，缺乏可被用户掌控的量化过滤机制。

**DailyHotApi** 彻底重塑了资讯聚合的定义：
> 它不仅仅是一个抓取接口，更是一套**面向工程师、投资人与深度思考者**的 **「信源聚合 + DeepSeek AI 智能评分 + 原生 SQLite 毫秒级缓存 + 人机协同反馈闭环」** 的下一代实时情报中枢。

---

## 🔥 杀手级特性

### 🧠 1. DeepSeek 智能五层打分漏斗（0~100 分）
内置经过真实工业反馈深度校准的智能打分引擎，输入新闻即可按严苛的五层漏斗模型给出 0~100 整数分及 25 字精炼评语：
- **`L1` (90~100分) 满分标杆·必看**：现场工程实操、关键破坏性变更预警（如核心芯片/边缘算力参数、Linux运维重大变动）、宏观核心经济周期。
- **`L2` (75~89分) 深度高价值**：核心主力大模型（DeepSeek/Gemini 等）正式发版、重大基础科学突破、中欧/中美产业与地缘关键硬核数据。
- **`L3/L4` (60~74分) 行业脉搏与高阶审美**：全球 AI 产业博弈深度观察、开发者高效工具流、硬核科幻与科学探索。
- **`Uncertain` (40~59分) 反茧房调剂**：大厂常规业务调整、轻度趣味生活，保持信息视野的广度。
- **`L5` (0~39分) 刚性负向过滤**：坚决剔除论坛情绪口水、脱离落地的显存噱头玩具库、虚假公关辞令与琐碎闲聊。

### ⚡ 2. Node.js 22 原生 SQLite 毫秒级缓存与持久化
- 采用 Node 22 原生内置的 `node:sqlite`（`DatabaseSync`），**无需任何外部数据库服务，无需本地 C++ 原生编译**，极速启动。
- 采用文本指纹 MD5 哈希建立持久索引，评分记录一次生成、永久复用，避免重复打分造成的 Token 浪费与响应延迟。
- 提供 `/score/cache` 批量查询端点，**毫秒级**返回数百条新闻的历史评分。

### 🎯 3. 人机协同主动校准（Human-in-the-Loop）
- 提供 `/score/manual` 评分修正接口与全网已读状态持久化。
- 允许用户在前端滑动调整分数并沉淀真实样本，为后续 Prompt 自动微调与偏好演进奠定数据资产。

### 🌐 4. 全球财经与硬核科技顶级信源聚焦
- 彻底剔除垃圾娱乐八卦，全面接入彭博社（Bloomberg）、路透社（Reuters）、金十数据（Jin10 7x24）、财联社（CLS 7x24）、界面新闻、Hacker News、V2EX、GitHub Trending 等优质源。
- 统一输出标准化数据格式（`RouterData`），字段规范、结构清晰。

### 🔄 5. 国际头条并发 AI 极速汉化
- 针对彭博社、路透社、Hacker News 等海外英文信源，内置 DeepSeek 批量流式翻译引擎（3条打包并发 + 文本哈希级缓存），跨越语言障碍，零阅读门槛。

### 📦 6. JSON 与 RSS 双模交付
- 既是高性能 RESTful API，又支持原生导出 RSS 2.0 订阅源，无缝接入各类 RSS 阅读器（NetNewsWire、Follow 等）或自动化工作流（n8n、Dify、企微/飞书机器人）。

---

## 📊 高价值信源矩阵

> 服务自带请求节流与 30 条去重机制，确保每次拉取皆为最新高密度条目。

| 信源名称 | 路由标识 (`name`) | 分类标签 | 典型子榜单 / 参数 (`type`) | 数据特色 |
| :--- | :--- | :--- | :--- | :--- |
| **金十数据** | `jin10` | 宏观财经 | `flash` (7x24全球快讯), `important` (重点要闻) | 外汇、大宗商品、央行决议即时情报 |
| **财联社** | `cls` | 财经电报 | `telegraph` (7x24电报快讯) | 国内 A 股、产业政策秒级一手内参 |
| **彭博社** | `bloomberg` | 全球商业 | `world` (全球要闻), `markets` (市场动态) | 全球宏观走势，支持 AI 极速中文翻译 |
| **路透社** | `reuters` | 国际宏观 | `world`, `business`, `technology`, `markets` | 国际地缘政经深度报道，支持 AI 翻译 |
| **界面新闻** | `jiemian` | 深度商业 | `news` (快报要闻), `hot` (热榜推荐) | 商业快讯与高价值深度报道 |
| **Hacker News** | `hackernews` | 极客前沿 | 默认热门 (Popular) | 全球硬核极客社区热议技术话题 |
| **GitHub** | `github` | 开源动向 | 每日 Trending / 精选 | 全球高星开源项目风向标 |
| **V2EX** | `v2ex` | 程序员社区 | `hot` (最热主题), `latest` (最新主题) | 开发者一手技术讨论与职场生态 |
| **少数派** | `sspai` | 数字生活 | 热门文章 | 效率工具、工作流与硬核数字生活 |
| **IT之家** | `ithome` | 数码前沿 | 热榜 / 喜加一 (`ithome-xijiayi`) | 数码科技动态与正版限免福利 |
| **稀土掘金** | `juejin` | 技术架构 | 热榜 | 泛前端、后端架构与云原生实践 |
| **36氪** | `36kr` | 科技创投 | 热榜 | 创投资讯与新兴商业模式追踪 |

<details>
<summary>👉 查看更多集成信源（共 30+ 源）</summary>

| 站点 | 类别 | 调用名称 |
| :--- | :--- | :--- |
| 哔哩哔哩 | 热门榜 | `bilibili` |
| 抖音 | 热点榜 | `douyin` |
| 快手 | 热点榜 | `kuaishou` |
| 豆瓣讨论小组 | 讨论精选 | `douban-group` |
| NGA 论坛 | 热帖精选 | `ngabbs` |
| 澎湃新闻 | 热榜 | `thepaper` |
| 今日头条 | 热榜 | `toutiao` |
| 腾讯新闻 | 热点榜 | `qq-news` |
| 极客公园 | 创新前沿 | `geekpark` |
| 果壳网 | 科学探索 | `guokr` |
| NodeSeek | 主机极客 | `nodeseek` |
| 全球主机交流 | 讨论精选 | `hostloc` |
| 虎嗅网 | 24小时 | `huxiu` |
| 中国地震台 | 地震速报 | `earthquake` |
| 中央气象台 | 气象预警 | `weatheralarm` |

</details>

---

## 📡 API 接口一览

### 1. 抓取资讯榜单
```http
GET /{name}?limit=30&cache=true&rss=false
```
**参数说明**：
- `name`：信源路由标识（如 `cls`、`jin10`、`bloomberg`）
- `type`：部分信源子类型（如 `type=markets`、`type=important`）
- `limit`：返回条目限制（默认 30 条）
- `cache`：是否采用缓存（`false` 强制拉取最新）
- `rss`：设为 `true` 输出标准 RSS 2.0 XML 格式

### 2. AI 智能评分接口
```http
POST /score
Content-Type: application/json
```
**单条或批量评分请求体**：
```json
{
  "items": [
    {
      "title": "DeepSeek 发布新一代轻量模型，推理提速 300%",
      "desc": "全新架构在多项逻辑测试中表现优异...",
      "source": "前沿科技"
    }
  ],
  "sort": true
}
```
**响应体示例**：
```json
{
  "code": 200,
  "message": "评分成功",
  "total": 1,
  "data": [
    {
      "score": 86,
      "layer": "L2",
      "reason": "核心大模型重大版本迭代，推理大幅优化",
      "fromCache": false
    }
  ]
}
```

### 3. 毫秒级 SQLite 批量查缓存
```http
POST /score/cache
Content-Type: application/json
```
> 不触发任何外部 AI 调用，直接根据文本哈希检索本地数据库，毫秒级返回已有评分。

### 4. 用户手动修正评分（沉淀校准数据）
```http
POST /score/manual
Content-Type: application/json

{
  "newsHash": "a1b2c3d4e5f67890",
  "userScore": 95,
  "userLayer": "L1",
  "userReason": "与当前机器人车载总线项目直接相关"
}
```

### 5. 已读状态同步接口
- `POST /score/read`：标记单条或批量新闻为已读/未读（持久化存入 SQLite）。
- `GET /score/read?limit=5000`：获取全量已读新闻的哈希集合，供多端快速过滤。

---

## 🚀 极速上手

### 方案 A：Docker 快速启动（推荐）

通过 Docker Compose 一键启动：
```yaml
# docker-compose.yml
version: "3.8"
services:
  dailyhot-api:
    image: imsyy/dailyhot-api:latest
    container_name: dailyhot-api
    restart: always
    ports:
      - "6688:6688"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=6688
      - DEEPSEEK_API_KEY=your_deepseek_api_key_here
      - DEEPSEEK_BASE_URL=https://api.deepseek.com
      - DEEPSEEK_MODEL=deepseek-flash
```
```bash
docker-compose up -d
```
启动后访问 `http://localhost:6688/` 即可看到服务欢迎页，访问 `http://localhost:6688/all` 查看所有活跃路由。

---

### 方案 B：本地克隆与运行

#### 1. 环境准备
确保机器已安装 **Node.js >= 20.0.0** 与 **pnpm**。

#### 2. 安装与配置
```bash
# 克隆仓库
git clone https://github.com/imsyy/DailyHotApi.git
cd DailyHotApi

# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env
```

编辑 `.env` 文件填入关键项：
```env
PORT=6688
CACHE_TTL=3600
REQUEST_TIMEOUT=6000
ALLOWED_DOMAIN="*"

# DeepSeek 智能打分与翻译配置
DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
DEEPSEEK_BASE_URL="https://api.deepseek.com"
DEEPSEEK_MODEL="deepseek-flash"

# SQLite 本地缓存路径（Node 22 原生驱动，开箱即用）
SQLITE_DB_PATH="./data/scores.sqlite"
```

#### 3. 运行服务
```bash
# 开发模式（热重载）
pnpm dev

# 编译与生产启动
pnpm build
pnpm start
```

---

## ⚙️ 生产环境部署方案

| 部署环境 | 推荐操作 | 备注 |
| :--- | :--- | :--- |
| **Docker** | `docker run -d --restart always -p 6688:6688 -v $(pwd)/data:/app/data dailyhot-api` | 生产标准环境，数据目录挂载持久化 SQLite |
| **PM2** | `npm i pm2 -g && sh ./deploy.sh` | 传统 Linux 服务器无缝多进程守护 |
| **Vercel** | 点击一键部署按钮克隆至个人仓库 | 无服务器 Serverless 运行（建议禁用本地文件写入） |
| **Zeabur / Railway** | 绑定 Git 仓库直接一键托管部署 | 云原生极简容器托管 |

---

## 🛠️ 技术栈一览

- **Runtime & Language**：Node.js >= 20、TypeScript 5、ES Modules
- **Core Framework**：[Hono](https://hono.dev/)（超高性能现代轻量级 Web 框架）
- **Storage & Caching**：Node 原生 `node:sqlite`（零编译 SQLite）、Redis / NodeCache 双级缓存
- **AI Engine**：DeepSeek LLM API（支持打分与批量并发翻译）
- **Scraping & Parsing**：Axios、Cheerio、RSS-Parser、Feed

---

## 🛣️ 路线图 (Roadmap)

- [x] **第一阶段**：重构并接入核心财经（财联社、金十数据、界面新闻）与科技源；
- [x] **第二阶段**：引入 DeepSeek 五层智能打分引擎与并发翻译能力；
- [x] **第三阶段**：引入 Node.js 22 原生 SQLite 持久化缓存与人机协同手动打分接口；
- [x] **第四阶段**：实现全网已读状态持久化与跨端同步 API；
- [ ] **第五阶段**：支持接入华尔街见闻、雪球、FT中文网等更多高阶财经信源；
- [ ] **第六阶段**：基于用户积累的历史打分记录，自动微调生成专属私有 Prompt / 模型权重。

---

## 🤝 鸣谢与生态项目

- 前端界面仓库：[DailyHot 前端看板](https://github.com/imsyy/DailyHot)
- 启发与支持项目：[RSSHub](https://github.com/DIYgod/RSSHub)

## 📄 开源许可证

本项目基于 [MIT License](./LICENSE) 协议开源。欢迎提交 Issue 与 Pull Request 共同构建更高信噪比的情报生态！
