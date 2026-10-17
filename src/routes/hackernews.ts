import type { ListItem, RouterData } from "../types.js";
import { get } from "../utils/getData.js";
import { load } from "cheerio";
import { translateTexts } from "../utils/translator.js";

export const handleRoute = async (_: undefined, noCache: boolean) => {
  const listData = await getList(noCache);
  const routeData: RouterData = {
    name: "hackernews",
    title: "Hacker News",
    type: "Popular",
    description: "News about hacking and startups",
    link: "https://news.ycombinator.com/",
    total: listData.data?.length || 0,
    ...listData,
  };
  return routeData;
};

const getList = async (noCache: boolean) => {
  const baseUrl = "https://news.ycombinator.com";
  const result = await get<string>({
    url: baseUrl,
    noCache,
    headers: {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
  });

  try {
    const $ = load(result.data);
    const stories: ListItem[] = [];

    $(".athing").each((_, el) => {
      const item = $(el);
      const id = item.attr("id") || "";
      const title = item.find(".titleline a").first().text().trim();
      const url = item.find(".titleline a").first().attr("href");

      // 获取分数并转换为数字
      const scoreText = $(`#score_${id}`).text().match(/\d+/)?.[0];
      const hot = scoreText ? parseInt(scoreText, 10) : undefined;

      if (id && title) {
        stories.push({
          id,
          title,
          hot,
          timestamp: undefined,
          url: url || `${baseUrl}/item?id=${id}`,
          mobileUrl: url || `${baseUrl}/item?id=${id}`,
        });
      }
    });

    // 使用 DeepSeek 批量翻译标题（直接替换 title 为翻译后的结果）
    if (stories.length > 0) {
      const titles = stories.map((s) => s.title);
      const translatedTitles = await translateTexts({
        texts: titles,
        targetLang: "zh-CN",
        sourceLang: "en",
        noCache,
      });
      stories.forEach((story, index) => {
        story.title = translatedTitles[index] || story.title;
      });
    }

    return {
      ...result,
      data: stories,
    };
  } catch (error) {
    throw new Error(`Failed to parse HackerNews HTML: ${error}`);
  }
};

