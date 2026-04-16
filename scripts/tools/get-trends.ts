/**
 * Get Trends by WOEID（X API v2）工具模块。
 *
 * 参考文档：
 * - Endpoint: GET /2/trends/by/woeid/{woeid}
 * - Query:
 *   - max_trends: 1~50（默认 20）
 *   - trend.fields: trend_name,tweet_count（可选）
 * - 鉴权：BearerToken（本仓库约定使用 App-only Bearer）
 *
 * 说明：
 * - 本模块只封装“按 WOEID 拉取趋势”的一次请求，不做分页或缓存。
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type { TwitterApi } from 'twitter-api-v2';
import { isRunAsMainScript } from '../utils.js';

/** max_trends 文档约束下限 */
export const TRENDS_MIN_RESULTS = 1;
/** max_trends 文档约束上限 */
export const TRENDS_MAX_RESULTS = 50;
/** max_trends 文档默认值 */
export const TRENDS_DEFAULT_RESULTS = 20;

/**
 * 单条趋势对象（按文档的 trend.fields 提取常用字段）。
 */
export type TrendItem = {
  trend_name?: string;
  tweet_count?: number;
};

/**
 * 趋势接口响应结构（仅定义本模块会用到的字段）。
 */
export type TrendsByWoeidResult = {
  data: TrendItem[];
};

type TrendsApiClient = Pick<TwitterApi, 'v2'>;

/**
 * 将调用方请求值归一化到合法区间 [1, 50]。
 * - 非数字或无穷值 -> 默认 20
 * - 小数 -> 向下取整
 */
export function clampMaxTrends(requested: number): number {
  const n = Number.isFinite(requested) ? Math.floor(requested) : TRENDS_DEFAULT_RESULTS;
  return Math.min(TRENDS_MAX_RESULTS, Math.max(TRENDS_MIN_RESULTS, n));
}

/**
 * 从 SDK 返回值中提取 `data` 数组，做结构兜底。
 */
function trendsFromResponse(result: unknown): TrendItem[] {
  if (!result || typeof result !== 'object') return [];

  const direct = (result as { data?: unknown }).data;
  if (Array.isArray(direct)) return direct as TrendItem[];

  const nested = (result as { data?: { data?: unknown } }).data?.data;
  if (Array.isArray(nested)) return nested as TrendItem[];

  return [];
}

/**
 * 按 WOEID 获取趋势。
 *
 * @param client App-only Bearer 客户端（建议通过 createAppOnlyClient() 构建）
 * @param woeid 位置 ID（Where On Earth ID）
 * @param requestedMaxTrends 期望返回条数，将被归一化到 [1, 50]
 */
export async function getTrendsByWoeid(
  client: TrendsApiClient,
  woeid: number,
  requestedMaxTrends: number = TRENDS_DEFAULT_RESULTS,
): Promise<TrendsByWoeidResult> {
  const maxTrends = clampMaxTrends(requestedMaxTrends);

  // 使用 v2 通用 get 调用文档路径：/2/trends/by/woeid/{woeid}
  const result = await client.v2.get(`trends/by/woeid/${woeid}`, {
    max_trends: maxTrends,
    'trend.fields': ['trend_name', 'tweet_count'].join(','),
  });

  return { data: trendsFromResponse(result) };
}

/**
 * 本地自测入口：
 * 1) 创建 App-only 客户端
 * 2) 请求指定 WOEID 的趋势
 * 3) 将结果以可读方式打印到终端
 *
 * 可选环境变量：
 * - TRENDS_WOEID（默认 1）
 * - TRENDS_MAX（默认 20，实际会 clamp 到 1~50）
 */
async function main(): Promise<void> {
  const { createAppOnlyClient } = await import('../x-client.js');
  const woeid = Number.parseInt(process.env.TRENDS_WOEID ?? '1', 10);
  const requested = Number.parseInt(
    process.env.TRENDS_MAX ?? String(TRENDS_DEFAULT_RESULTS),
    10,
  );

  const client = createAppOnlyClient();
  const { data } = await getTrendsByWoeid(client, woeid, requested);

  console.log(
    `GetTrendsByWoeid success: woeid=${woeid}, requested=${requested}, received=${data.length}`,
  );

  if (!data.length) {
    console.log('No trends returned.');
    return;
  }

  data.forEach((trend, idx) => {
    const name = trend.trend_name ?? '(unknown)';
    const count =
      typeof trend.tweet_count === 'number' ? trend.tweet_count.toString() : 'n/a';
    console.log(`${idx + 1}. ${name} (tweet_count=${count})`);
  });
}

/**
 * CLI 入口守卫：仅在直接执行本文件时运行 main()。
 */
if (isRunAsMainScript()) {
  main().catch((e) => {
    console.error('getTrendsByWoeid failed:', e);
    process.exitCode = 1;
  });
}
