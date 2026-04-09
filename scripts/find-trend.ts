/**
 * 趋势到内容的最小流水线（基于现有工具）：
 * 1) 获取美国（WOEID=23424977）当前最热趋势（Top 1）
 * 2) 使用全量搜索抓取该趋势的 10 条推文
 * 3) 将结果落盘到 data/cache
 *
 * 依赖模块：
 * - `tools/get-trends.ts`：按 WOEID 拉趋势
 * - `tools/search-tweets.ts`：full-archive 搜索
 * - `x-client.ts`：App-only Bearer 客户端
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAppOnlyClient } from './x-client.js';
import { getTrendsByWoeid } from './tools/get-trends.js';
import { searchAllTweets } from './tools/search-tweets.js';

/** 美国的 WOEID（United States） */
const US_WOEID = 23424977;
/** 需求要求：全局搜索返回 10 条 */
const HOT_TWEETS_COUNT = 10;

type FindTrendResult = {
  woeid: number;
  trendName: string;
  searchQuery: string;
  tweets: unknown[];
  savedFile: string;
  fetchedAt: string;
};

/**
 * 生成紧凑时间戳，用于缓存文件名，便于按时间定位结果。
 */
function timestampForFile(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

/**
 * 运行完整流程并写入缓存文件。
 */
export async function findUsTopTrendAndSave(): Promise<FindTrendResult> {
  const client = createAppOnlyClient();

  // Step 1: 只取 Top 1 趋势。
  const trends = await getTrendsByWoeid(client, US_WOEID, 1);
  const topTrend = trends.data[0]?.trend_name?.trim();
  if (!topTrend) {
    throw new Error('未获取到美国趋势 Top 1（trend_name 为空）');
  }

  // Step 2: 全局搜索该趋势（去掉转推，减少噪声）。
  const query = `"${topTrend}" -is:retweet`;
  const searched = await searchAllTweets(client, query, HOT_TWEETS_COUNT);

  // Step 3: 落盘缓存。
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const cacheDir = path.join(__dirname, '../data/cache/us-top-trend');
  await fs.mkdir(cacheDir, { recursive: true });

  const fetchedAt = new Date().toISOString();
  const fileName = `${timestampForFile()}.json`;
  const filePath = path.join(cacheDir, fileName);

  const payload: FindTrendResult = {
    woeid: US_WOEID,
    trendName: topTrend,
    searchQuery: query,
    tweets: searched.data,
    savedFile: filePath,
    fetchedAt,
  };

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return payload;
}

function isRunAsMainScript(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/**
 * 测试主函数：
 * - 执行完整流程
 * - 在终端打印趋势名、推文数、缓存文件路径
 */
async function main(): Promise<void> {
  const result = await findUsTopTrendAndSave();
  console.log('findUsTopTrendAndSave success');
  console.log(`trend: ${result.trendName}`);
  console.log(`query: ${result.searchQuery}`);
  console.log(`tweets: ${result.tweets.length}`);
  console.log(`savedFile: ${result.savedFile}`);
}

if (isRunAsMainScript()) {
  main().catch((e) => {
    console.error('find-trend failed:', e);
    process.exitCode = 1;
  });
}
