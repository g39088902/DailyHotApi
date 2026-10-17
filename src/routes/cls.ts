import type { RouterData } from "../types.js";
import { get } from "../utils/getData.js";
import { getTime } from "../utils/getTime.js";
import crypto from "crypto";

export const handleRoute = async (_: undefined, noCache: boolean) => {
  const listData = await getList(noCache);
  const routeData: RouterData = {
    name: "cls",
    title: "财联社",
    type: "电报",
    description: "财联社 - 7x24小时电报快讯",
    link: "https://www.cls.cn/telegraph",
    total: listData.data?.length || 0,
    ...listData,
  };
  return routeData;
};

const getSign = (params: Record<string, string>): string => {
  const sortedKeys = Object.keys(params).sort();
  const rawStr = sortedKeys.map((k) => `${k}=${params[k]}`).join("&");
  const sha1 = crypto.createHash("sha1").update(rawStr).digest("hex");
  return crypto.createHash("md5").update(sha1).digest("hex");
};

interface CLSRollItem {
  id: number;
  title?: string;
  brief?: string;
  content?: string;
  ctime: number;
  reading_num?: number;
  shareurl?: string;
  images?: string[];
  img?: string;
}

interface CLSResponse {
  errno: number;
  msg: string;
  data: {
    roll_data: CLSRollItem[];
  };
}

const getList = async (noCache: boolean) => {
  const params: Record<string, string> = {
    app: "CailianpressWeb",
    os: "web",
    rn: "30",
    sv: "8.7.9",
  };

  params.sign = getSign(params);
  const query = new URLSearchParams(params).toString();
  const url = `https://www.cls.cn/v1/roll/get_roll_list?${query}`;

  const result = await get<CLSResponse>({
    url,
    noCache,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://www.cls.cn/telegraph",
    },
  });

  const list = result.data?.data?.roll_data || [];

  return {
    ...result,
    data: list.map((v) => {
      // 提取标题，优先用title，若没有则从brief或content截取
      let title = v.title?.trim();
      let desc = (v.brief || v.content || "").trim();

      if (!title && desc) {
        const titleMatch = desc.match(/【(.*?)】/);
        if (titleMatch) {
          title = titleMatch[1];
        } else {
          title = desc.slice(0, 40);
        }
      }

      return {
        id: v.id,
        title: title || "无标题",
        desc,
        cover: v.img || (v.images && v.images[0]) || undefined,
        hot: v.reading_num,
        timestamp: getTime(v.ctime * 1000),
        url: `https://www.cls.cn/detail/${v.id}`,
        mobileUrl: v.shareurl || `https://m.cls.cn/detail/${v.id}`,
      };
    }),
  };
};
