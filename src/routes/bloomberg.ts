import type { RouterData, ListContext, Options, RouterResType } from "../types.js";
import { get } from "../utils/getData.js";
import { getTime } from "../utils/getTime.js";
import { parseRSS } from "../utils/parseRSS.js";
import { translateTexts } from "../utils/translator.js";
import { deduplicateArticles } from "../utils/deduplicate.js";

const typeMap: Record<string, string> = {
  world: "全球头条",
  markets: "金融市场",
  politics: "政经热点",
  technology: "科技资讯",
};

const feedMap: Record<string, string> = {
  markets: "https://feeds.bloomberg.com/markets/news.rss",
  politics: "https://feeds.bloomberg.com/politics/news.rss",
  world: "https://news.google.com/rss/search?q=site:bloomberg.com/news&ceid=US:en&hl=en-US&gl=US",
  technology: "https://news.google.com/rss/search?q=site:bloomberg.com/technology&ceid=US:en&hl=en-US&gl=US",
};

export const handleRoute = async (c: ListContext, noCache: boolean) => {
  const type = c.req.query("type") || "world";
  const listData = await getList({ type }, noCache);
  const routeData: RouterData = {
    name: "bloomberg",
    title: "彭博社",
    type: typeMap[type] || "全球头条",
    description: "彭博社（Bloomberg）全球商业、金融与宏观经济资讯，支持 AI 智能中文翻译",
    params: {
      type: {
        name: "资讯分类",
        type: typeMap,
      },
    },
    link: "https://www.bloomberg.com/",
    total: listData?.data?.length || 0,
    ...listData,
  };
  return routeData;
};

const getList = async (options: Options, noCache: boolean): Promise<RouterResType> => {
  const { type = "world" } = options;
  const url = feedMap[type] || feedMap.world;

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
    const rawTitle = (v.title || "").replace(/\s*-\s*Bloomberg$/i, "").trim();
    return {
      id: v.guid || i,
      title: rawTitle,
      desc: v.contentSnippet?.replace(/\s*Bloomberg$/i, "").trim() || rawTitle,
      author: v.author,
      timestamp: getTime(v.pubDate || 0),
      hot: undefined,
      url: v.link || "",
      mobileUrl: v.link || "",
    };
  });

  const rawItems = deduplicateArticles(mappedItems, `raw:bloomberg:${type}`, {
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
