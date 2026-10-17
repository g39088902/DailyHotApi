import type { RouterData, ListContext, Options, ListItem } from "../types.js";
import { get } from "../utils/getData.js";
import { load } from "cheerio";

export const handleRoute = async (c: ListContext, noCache: boolean) => {
  const type = c.req.query("type") || "news";
  const listData = await getList({ type }, noCache);
  const routeData: RouterData = {
    name: "jiemian",
    title: "界面新闻",
    type: type === "hot" ? "热榜推荐" : "快讯要闻",
    description: "界面新闻 - 只服务于独立思考的人群",
    params: {
      type: {
        name: "资讯分类",
        type: {
          news: "快讯要闻",
          hot: "热榜推荐",
        },
      },
    },
    link: "https://www.jiemian.com/",
    total: listData.data?.length || 0,
    ...listData,
  };
  return routeData;
};

const getList = async (options: Options, noCache: boolean) => {
  const { type } = options;
  // type=news 使用快报栏目(lists/4.html)，type=hot 使用界面移动端首页推荐
  const url = type === "hot" ? "https://m.jiemian.com/" : "https://m.jiemian.com/lists/4.html";

  const result = await get<string>({
    url,
    noCache,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
      Referer: "https://m.jiemian.com/",
    },
  });

  const $ = load(result.data);
  const items: ListItem[] = [];

  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const title = $(el).text().trim().replace(/\s+/g, " ");

    if (href.includes("/article/") && title.length > 5) {
      if (!items.find((x) => x.title === title)) {
        const idMatch = href.match(/article\/(\d+)/);
        const articleId = idMatch ? idMatch[1] : href;
        const fullMobileUrl = href.startsWith("http") ? href : `https://m.jiemian.com${href}`;
        const pcUrl = `https://www.jiemian.com/article/${articleId}.html`;

        items.push({
          id: articleId,
          title,
          hot: undefined,
          timestamp: undefined,
          url: pcUrl,
          mobileUrl: fullMobileUrl,
        });
      }
    }
  });

  return {
    ...result,
    data: items,
  };
};
