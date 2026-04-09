/**
 * 搜索推文工具模块（X API v2）。
 * - recent：`/tweets/search/recent`，约最近 7 天
 * - all：`/tweets/search/all`，全量归档（需开发者账户具备对应产品/权限）
 * - 鉴权：recent/all 统一使用 OAuth 2.0 Application-Only Bearer
 *
 * 关键文档结论（来自 Search all Posts OpenAPI）：
 * 1) 路径虽然文案叫 Posts，但实际仍是 `/2/tweets/search/all`。
 * 2) all 接口支持 `max_results: 10~500`；query 最小长度 1，最大可到 4096。
 * 3) all 支持 `start_time/end_time/since_id/until_id/sort_order/pagination_token` 等扩展参数。
 * 4) 鉴权若使用 User Context，常见 403:
 *    `unsupported-authentication`，提示需 OAuth 2.0 Application-Only。
 *
 * 本地连通性自测（真实请求 X API）：`npx tsx scripts/tools/search-tweets.ts`（需已配置 `.env`）
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type { TwitterApi } from 'twitter-api-v2';

const searchTweetFields = ['created_at', 'public_metrics', 'author_id'] as const;
const searchExpansions = ['author_id'] as const;
const searchUserFields = ['username', 'name', 'profile_image_url'] as const;

/**
 * recent search 的 max_results 约束（官方常见限制）。
 * - 小于 10 会被判为非法参数
 * - 大于 100 会被服务端拒绝
 */
export const SEARCH_RECENT_MAX_RESULTS_MIN = 10;
export const SEARCH_RECENT_MAX_RESULTS_MAX = 100;

/**
 * full-archive(all) 的 max_results 约束（OpenAPI 明确 10~500）。
 * 这与 recent 的上限不同，all 可一次拉取更多数据。
 */
export const SEARCH_ALL_MAX_RESULTS_MIN = 10;
export const SEARCH_ALL_MAX_RESULTS_MAX = 500;

export type SearchTweetsMode = 'recent' | 'all';

export type SearchTweetsResult = {
  data: unknown[];
};

type SearchApiClient = Pick<TwitterApi, 'v2'>;

/**
 * 从 twitter-api-v2 的返回结构中提取帖子数组。
 *
 * 兼容原因：
 * - 不同版本/分页器对象可能把数据放在 `tweets`、`data` 或 `data.data`。
 * - 统一在这里兜底，避免上层业务依赖具体 SDK 返回形态。
 */
export function tweetsFromSearchResult(result: unknown): unknown[] {
  if (!result || typeof result !== 'object') return [];
  const r = result as { tweets?: unknown[]; data?: unknown };
  if (Array.isArray(r.tweets)) return r.tweets;
  if (Array.isArray(r.data)) return r.data;
  const env = r.data;
  if (env && typeof env === 'object' && Array.isArray((env as { data?: unknown[] }).data)) {
    return (env as { data: unknown[] }).data;
  }
  return [];
}

/**
 * 将调用方传入的 `requested` 归一化为合法 `max_results`。
 *
 * 设计目的：
 * - 避免 `count=1` 之类参数直接触发 400。
 * - 把异常输入（NaN/Infinity/小数）收敛到可控整数范围。
 */
export function clampSearchMaxResults(
  requested: number,
  mode: SearchTweetsMode = 'recent',
): number {
  const min =
    mode === 'recent' ? SEARCH_RECENT_MAX_RESULTS_MIN : SEARCH_ALL_MAX_RESULTS_MIN;
  const max =
    mode === 'recent' ? SEARCH_RECENT_MAX_RESULTS_MAX : SEARCH_ALL_MAX_RESULTS_MAX;
  const n = Number.isFinite(requested) ? Math.floor(requested) : min;
  return Math.min(max, Math.max(min, n));
}

/**
 * 统一搜索入口：`recent` 或 `all`。
 *
 * 入参说明：
 * - `client`：应为 App-only Bearer 创建的客户端（至少具备 `v2` 子客户端）
 * - `query`：X 查询语法，需满足接口最小长度要求
 * - `requestedMaxResults`：调用意图值，会经过 clamp 后映射到真实请求
 * - `mode`：`recent` 走 `/tweets/search/recent`，`all` 走 `/tweets/search/all`
 *
 * 注意：
 * - 这里仅封装“单次请求”，不做自动翻页。
 * - 若要拉取更多结果，应在上层根据 `meta.next_token` 继续请求。
 */
export async function searchTweets(
  client: SearchApiClient,
  query: string,
  requestedMaxResults: number,
  mode: SearchTweetsMode = 'recent',
): Promise<SearchTweetsResult> {
  const maxResults = clampSearchMaxResults(requestedMaxResults, mode);
  const paginator =
    mode === 'recent'
      ? await client.v2.search(query, {
          max_results: maxResults,
          sort_order: 'relevancy',
          'tweet.fields': [...searchTweetFields],
          expansions: [...searchExpansions],
          'user.fields': [...searchUserFields],
        })
      : await client.v2.searchAll(query, {
          max_results: maxResults,
          sort_order: 'relevancy',
          'tweet.fields': [...searchTweetFields],
          expansions: [...searchExpansions],
          'user.fields': [...searchUserFields],
        });
  return { data: tweetsFromSearchResult(paginator) };
}

/**
 * 近期搜索包装器（近 7 天）。
 * 等价于 `searchTweets(..., 'recent')`。
 */
export async function searchRecentTweets(
  client: SearchApiClient,
  query: string,
  requestedMaxResults: number,
): Promise<SearchTweetsResult> {
  return searchTweets(client, query, requestedMaxResults, 'recent');
}

/**
 * 全量归档搜索包装器。
 * 等价于 `searchTweets(..., 'all')`。
 */
export async function searchAllTweets(
  client: SearchApiClient,
  query: string,
  requestedMaxResults: number,
): Promise<SearchTweetsResult> {
  return searchTweets(client, query, requestedMaxResults, 'all');
}

// 以下为测试代码

/**
 * 判断当前文件是否被“直接执行”。
 * - true：例如 `npx tsx scripts/tools/search-tweets.ts`
 * - false：被其它模块 `import` 时
 *
 * 这样可让本文件同时具备：
 * 1) 库函数模块（导出搜索函数）
 * 2) 可手动运行的诊断脚本（main）
 */
function isRunAsMainScript(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const { createAppOnlyClient } = await import('../x-client.js');
  const query = 'Openclaw -is:retweet';
  const count = 10;
  const client = createAppOnlyClient();

  try {
    // 仅做“接口连通性”验证：只测 all，方便定位 full-archive 权限/鉴权问题。
    const { data } = await searchAllTweets(client, query, count);
    console.log('searchAllTweets ok, count:', data.length);
    const first = data[0] as {
      id?: string;
      text?: string;
      public_metrics?: {
        retweet_count?: number;
        reply_count?: number;
        like_count?: number;
        quote_count?: number;
        bookmark_count?: number;
        impression_count?: number;
      };
    } | undefined;
    if (first) {
      console.log('first tweet id:', first.id ?? '(no id)');
      console.log('first tweet text:', first.text ?? '(no text)');
      const m = first.public_metrics;
      console.log(
        'first tweet metrics:',
        JSON.stringify(
          {
            retweets: m?.retweet_count ?? 'n/a',
            likes: m?.like_count ?? 'n/a',
            replies: m?.reply_count ?? 'n/a',
            quotes: m?.quote_count ?? 'n/a',
            bookmarks: m?.bookmark_count ?? 'n/a',
            impressions: m?.impression_count ?? 'n/a',
          },
          null,
          2,
        ),
      );
    }
  } catch (e) {
    // 403 常见原因：
    // 1) 使用了 User Context token（而非 App-only Bearer）
    // 2) 账号/项目未开通 full-archive 权限
    // 3) 额度不足或策略限制
    console.error('searchAllTweets failed:', e);
    process.exitCode = 1;
  }
}

/**
 * CLI 入口守卫：
 * 仅在“直接执行本文件”时运行 main()，避免被 import 时自动发起网络请求。
 * catch 兜底用于打印未处理异常并设置失败退出码，便于脚本/CI 感知失败。
 */
if (isRunAsMainScript()) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
