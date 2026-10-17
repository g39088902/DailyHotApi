import type { Context } from "hono";
import type { ResponseType } from "axios";

// Context
export type ListContext = Context;

// 评分层级与结果类型
export type ScoreLayer = "L1" | "L2" | "L3" | "L4" | "L5" | "Uncertain";

export interface ScoreResult {
  id?: number;
  newsHash?: string;
  score: number;
  layer: ScoreLayer;
  reason: string;
  aiScore?: number;
  aiLayer?: ScoreLayer;
  aiReason?: string;
  userScore?: number | null;
  userLayer?: ScoreLayer | null;
  userReason?: string | null;
  isUserModified?: boolean;
  userUpdatedAt?: string | null;
  isRead?: boolean;
  readAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  fromCache?: boolean;
}

// 榜单数据
export interface ListItem {
  id: number | string;
  title: string;
  cover?: string;
  author?: string;
  desc?: string;
  hot: number | undefined;
  timestamp: number | undefined;
  url: string;
  mobileUrl: string;
  score?: number;
  layer?: ScoreLayer;
  reason?: string;
  newsHash?: string;
  aiScore?: number;
  userScore?: number | null;
  isUserModified?: boolean;
  isRead?: boolean;
  readAt?: string | null;
  fromCache?: boolean;
}

// 路由接口数据
export interface RouterResType {
  updateTime: string | number;
  fromCache: boolean;
  data: ListItem[];
  message?: string;
}

// 路由数据
export interface RouterData extends RouterResType {
  name: string;
  title: string;
  type: string;
  description?: string;
  params?: Record<string, string | object>;
  total: number;
  link?: string;
}

// 请求类型
export interface Get {
  url: string;
  headers?: Record<string, string | string[]>;
  params?: Record<string, string | number>;
  timeout?: number;
  noCache?: boolean;
  ttl?: number;
  originaInfo?: boolean;
  responseType?: ResponseType;
}

export interface Post {
  url: string;
  headers?: Record<string, string | string[]>;
  body?: string | object | Buffer | undefined;
  timeout?: number;
  noCache?: boolean;
  ttl?: number;
  originaInfo?: boolean;
}

// 参数类型
export interface Options {
  [key: string]: string | number | undefined;
}
