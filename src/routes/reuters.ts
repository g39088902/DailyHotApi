import type { RouterData, ListContext, Options, RouterResType } from "../types.js";
import { get } from "../utils/getData.js";
import { getTime } from "../utils/getTime.js";
import { parseRSS } from "../utils/parseRSS.js";
import { translateTexts } from "../utils/translator.js";
import { deduplicateArticles } from "../utils/deduplicate.js";

const typeMap: Record<string, string> = {
  latest: "最新要闻",
  world: "国际世界",
  business: "商业财经",
  technology: "科技资讯",
  markets: "金融市场",
};

const queryMap: Record<string, string> = {
  latest: "site:reuters.com",
  world: "site:reuters.com/world/",
  business: "site:reuters.com/business/",
  technology: "site:reuters.com/technology/",
  markets: "site:reuters.com/markets/",
};

export const handleRoute = async (c: ListContext, noCache: boolean) => {
  const type = c.req.query("type") || "latest";
  const listData = await getList({ type }, noCache);
  const routeData: RouterData = {
    name: "reuters",
    title: "路透社",
    type: typeMap[type] || "最新要闻",
    description: "路透社（Reuters）全球新闻资讯，支持 AI 智能中文翻译",
    params: {
      type: {
        name: "分类",
        type: typeMap,
      },
    },
    link: "https://www.reuters.com/",
    total: listData?.data?.length || 0,
    ...listData,
  };
  return routeData;
};

const getList = async (options: Options, noCache: boolean): Promise<RouterResType> => {
  const { type = "latest" } = options;
  const q = queryMap[type] || queryMap.latest;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&ceid=US:en&hl=en-US&gl=US`;

  const result = await get<string>({
    url,
    noCache,
    headers: {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  });

  const list = await parseRSS(result.data);

  // 先清洗并在翻译前执行跨分类英文标题去重，限制最多保留 30 条不重复内容
  const mappedItems = list.map((v, i) => {
    const rawTitle = (v.title || "").replace(/\s*-\s*Reuters$/i, "").trim();
    return {
      id: v.guid || i,
      title: rawTitle,
      desc: v.contentSnippet?.replace(/\s*Reuters$/i, "").trim() || rawTitle,
      author: v.author,
      timestamp: getTime(v.pubDate || 0),
      hot: undefined,
      url: v.link || "",
      mobileUrl: v.link || "",
    };
  });

  const rawItems = deduplicateArticles(mappedItems, `raw:reuters:${type}`, {
    noCache,
    maxItems: 30,
  });

  // 使用 DeepSeek 批量翻译标题与简介
  if (rawItems.length > 0) {
    const titles = rawItems.map((item) => item.title);
    const descs = rawItems.map((item) => item.desc || "");

    // 收集所有需要翻译的文本（标题 + 简介）
    const allTexts = [...titles, ...descs];
    const translatedTexts = await translateTexts({
      texts: allTexts,
      targetLang: "zh-CN",
      sourceLang: "en",
      noCache,
    });

    const translatedTitles = translatedTexts.slice(0, titles.length);
    const translatedDescs = translatedTexts.slice(titles.length);

    rawItems.forEach((item, index) => {
      item.title = translatedTitles[index] || item.title;
      if (item.desc) {
        item.desc = translatedDescs[index] || item.desc;
      }
    });
  }

  return {
    ...result,
    data: rawItems,
  };
};
