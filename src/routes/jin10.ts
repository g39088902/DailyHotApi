import type { RouterData, ListContext, Options, RouterResType } from "../types.js";
import { get } from "../utils/getData.js";
import { getTime } from "../utils/getTime.js";

const typeMap: Record<string, string> = {
  flash: "全球快讯",
  important: "重点要闻",
};

export const handleRoute = async (c: ListContext, noCache: boolean) => {
  const type = c.req.query("type") || "flash";
  const listData = await getList({ type }, noCache);
  const routeData: RouterData = {
    name: "jin10",
    title: "金十数据",
    type: typeMap[type] || "全球快讯",
    description: "金十数据 - 专业金融快讯与全球宏观资讯，7x24小时财经快讯",
    params: {
      type: {
        name: "资讯分类",
        type: typeMap,
      },
    },
    link: "https://www.jin10.com/",
    total: listData.data?.length || 0,
    ...listData,
  };
  return routeData;
};

interface Jin10FlashItem {
  id: string;
  time: string;
  type: number;
  important: number;
  data: {
    title?: string;
    content?: string;
    pic?: string;
    vip_title?: string;
    vip_desc?: string;
    source?: string;
    source_link?: string;
  };
}

interface Jin10Response {
  status: number;
  data: Jin10FlashItem[];
}

const getList = async (options: Options, noCache: boolean): Promise<RouterResType> => {
  const { type = "flash" } = options;
  const baseUrl = "https://flash-api.jin10.com/get_flash_list?channel=-9999";
  const headers = {
    "x-app-id": "bVBF4FyRTn5NJF5n",
    "x-version": "1.0.0",
    handleError: "1",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };

  // 获取第一页
  const result = await get<Jin10Response>({
    url: `${baseUrl}&max_time=`,
    noCache,
    headers,
  });

  let rawList: Jin10FlashItem[] = result.data?.data || [];

  // 如果请求的是重点要闻，金十单页只有20多条快讯（通常仅含2-3条重大消息）
  // 因此自动向下顺延翻页收集，确保返回充足（20-30条）的当日重大要闻
  if (type === "important") {
    let importantItems = rawList.filter((item) => item.important === 1);
    let lastTime = rawList.length > 0 ? rawList[rawList.length - 1].time : "";
    let pageCount = 1;

    while (importantItems.length < 20 && pageCount < 8 && lastTime) {
      try {
        const nextRes = await get<Jin10Response>({
          url: `${baseUrl}&max_time=${encodeURIComponent(lastTime)}`,
          noCache,
          headers,
        });
        const nextPageData = nextRes.data?.data || [];
        if (nextPageData.length === 0) break;

        const newImportants = nextPageData.filter((item) => item.important === 1);
        importantItems.push(...newImportants);
        lastTime = nextPageData[nextPageData.length - 1].time;
        pageCount++;
      } catch {
        break;
      }
    }
    rawList = importantItems;
  }

  // 过滤掉纯广告或无内容项
  rawList = rawList.filter((item) => {
    const title = item.data?.title || item.data?.vip_title;
    const content = item.data?.content || item.data?.vip_desc;
    return Boolean(title || content);
  });

  return {
    ...result,
    data: rawList.slice(0, 50).map((v) => {
      let rawTitle = (v.data?.title || v.data?.vip_title || "").trim();
      let rawContent = (v.data?.content || v.data?.vip_desc || "").trim();

      // 如果没有标题，从内容中提取【...】作为标题，或者截取前40个字
      if (!rawTitle && rawContent) {
        const match = rawContent.match(/^【(.*?)】/);
        if (match) {
          rawTitle = match[1];
          rawContent = rawContent.replace(/^【.*?】/, "").trim();
        } else {
          rawTitle = rawContent.length > 40 ? `${rawContent.slice(0, 40)}...` : rawContent;
        }
      }

      return {
        id: v.id,
        title: rawTitle,
        desc: rawContent || rawTitle,
        timestamp: getTime(v.time),
        hot: v.important === 1 ? 9999 : undefined,
        url: `https://flash.jin10.com/detail/${v.id}`,
        mobileUrl: `https://m.jin10.com/flash/${v.id}`,
      };
    }),
  };
};
