/**
 * 自动编排器（宿主模型版）：
 * 趋势 -> 搜索 -> 交给宿主模型总结 -> 发布
 *
 * 设计原则：
 * - 本脚本不直接调用 OpenAI/第三方模型；
 * - “总结为中文推文”这一步由 OpenClaw 宿主模型在执行 skill 时完成；
 * - 本脚本只做确定性动作：采集、结构化输入、发布、落盘审计。
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { findUsTopTrendAndSave } from './find-trend.js';
import { TwitterClient } from './x-client.js';
import { createPost } from './tools/creat-post.js';

type TweetCandidate = {
  id?: string;
  text?: string;
  public_metrics?: {
    retweet_count?: number;
    reply_count?: number;
    like_count?: number;
    quote_count?: number;
    impression_count?: number;
  };
};

type PublishOutput = {
  fetchedAt: string;
  trendName: string;
  sourceCacheFile: string;
  sourceTweetCount: number;
  generatedText: string; // 由宿主模型生成并传入
  postedTweetId: string;
  postedAt: string;
};

type CollectOutput = {
  fetchedAt: string;
  trendName: string;
  sourceCacheFile: string;
  sourceTweetCount: number;
  candidates: TweetCandidate[];
  modelInput: string;
};

/**
 * 从搜索结果中提取“可给模型消费”的文本候选，最多取前 10 条。
 */
function extractTweetCandidates(tweets: unknown[], max: number = 10): TweetCandidate[] {
  const normalized = tweets
    .map((t) => (t && typeof t === 'object' ? (t as TweetCandidate) : undefined))
    .filter((t): t is TweetCandidate => Boolean(t))
    .filter((t) => typeof t.text === 'string' && t.text.trim().length > 0);

  return normalized.slice(0, max);
}

/**
 * 将候选推文转换为结构化文本，输入给大模型。
 */
function buildModelInput(trendName: string, tweets: TweetCandidate[]): string {
  const lines = tweets.map((t, i) => {
    const metrics = t.public_metrics ?? {};
    return [
      `${i + 1}. id=${t.id ?? 'n/a'}`,
      `text=${t.text ?? ''}`,
      `metrics={retweets:${metrics.retweet_count ?? 'n/a'}, likes:${metrics.like_count ?? 'n/a'}, replies:${metrics.reply_count ?? 'n/a'}, quotes:${metrics.quote_count ?? 'n/a'}, impressions:${metrics.impression_count ?? 'n/a'}}`,
    ].join('\n');
  });

  return [
    `trend=${trendName}`,
    'tweets:',
    ...lines,
  ].join('\n\n');
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
 * 采集阶段：获取趋势和候选推文，生成给“宿主模型”的结构化输入。
 */
export async function collectForHostModel(): Promise<CollectOutput> {
  const trendResult = await findUsTopTrendAndSave();
  const candidates = extractTweetCandidates(trendResult.tweets, 10);
  if (!candidates.length) {
    throw new Error('趋势搜索结果中没有可用于总结的推文文本');
  }

  return {
    fetchedAt: trendResult.fetchedAt,
    trendName: trendResult.trendName,
    sourceCacheFile: trendResult.savedFile,
    sourceTweetCount: candidates.length,
    candidates,
    modelInput: buildModelInput(trendResult.trendName, candidates),
  };
}

/**
 * 发布阶段：接收“宿主模型已生成的中文推文”，执行真实发帖并落盘。
 */
export async function publishFromHostSummary(
  generatedText: string,
  collect: CollectOutput,
): Promise<PublishOutput> {
  const text = generatedText.trim();
  if (!text) throw new Error('发布内容为空，请传入宿主模型生成的中文推文正文');

  // 简单长度兜底：避免过长内容直接触发接口错误（字符数由 X 侧最终校验）
  if (text.length > 280) {
    throw new Error(`发布内容过长（${text.length} 字符），请压缩到 280 以内`);
  }

  const userClient = await TwitterClient.create();
  const posted = await createPost(userClient, { text });

  const now = new Date();
  const output: PublishOutput = {
    fetchedAt: collect.fetchedAt,
    trendName: collect.trendName,
    sourceCacheFile: collect.sourceCacheFile,
    sourceTweetCount: collect.sourceTweetCount,
    generatedText: text,
    postedTweetId: posted.id,
    postedAt: now.toISOString(),
  };

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const cacheDir = path.join(__dirname, '../data/cache/pipeline');
  await fs.mkdir(cacheDir, { recursive: true });
  const filename = `host-publish-${now.toISOString().replace(/[:.]/g, '-')}.json`;
  const outPath = path.join(cacheDir, filename);
  await fs.writeFile(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log('publishFromHostSummary success');
  console.log(`trend: ${output.trendName}`);
  console.log(`source: ${output.sourceCacheFile}`);
  console.log(`generatedText: ${output.generatedText}`);
  console.log(`postedTweetId: ${output.postedTweetId}`);
  console.log(`saved: ${outPath}`);

  return output;
}

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

/**
 * 两段式 CLI：
 * 1) collect：采集并输出模型输入（宿主模型读取此输入进行总结）
 *    npx tsx scripts/pipeline.ts --collect
 * 2) publish：把宿主模型生成的中文正文发布出去
 *    npx tsx scripts/pipeline.ts --publish --text "这里是中文推文正文"
 */
async function main(): Promise<void> {
  const collectOnly = process.argv.includes('--collect');
  const publish = process.argv.includes('--publish');
  const text = getArgValue('--text');

  if (collectOnly) {
    const collect = await collectForHostModel();

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const cacheDir = path.join(__dirname, '../data/cache/pipeline');
    await fs.mkdir(cacheDir, { recursive: true });
    const pendingPath = path.join(cacheDir, 'pending-latest.json');
    await fs.writeFile(pendingPath, JSON.stringify(collect, null, 2), 'utf-8');

    console.log('collectForHostModel success');
    console.log(`trend: ${collect.trendName}`);
    console.log(`source: ${collect.sourceCacheFile}`);
    console.log(`candidates: ${collect.sourceTweetCount}`);
    console.log(`pending: ${pendingPath}`);
    console.log('MODEL_INPUT_START');
    console.log(collect.modelInput);
    console.log('MODEL_INPUT_END');
    return;
  }

  if (publish) {
    if (!text) {
      throw new Error('缺少 --text 参数：请传入宿主模型生成的中文推文正文');
    }

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pendingPath = path.join(__dirname, '../data/cache/pipeline/pending-latest.json');
    const pendingRaw = await fs.readFile(pendingPath, 'utf-8');
    const collect = JSON.parse(pendingRaw) as CollectOutput;
    await publishFromHostSummary(text, collect);
    return;
  }

  // 默认行为：为了避免误发帖，默认只执行 collect。
  console.log('No explicit mode provided, fallback to --collect.');
  const collect = await collectForHostModel();
  console.log(`trend: ${collect.trendName}`);
  console.log(`source: ${collect.sourceCacheFile}`);
  console.log(`candidates: ${collect.sourceTweetCount}`);
  console.log('MODEL_INPUT_START');
  console.log(collect.modelInput);
  console.log('MODEL_INPUT_END');
}

if (isRunAsMainScript()) {
  main().catch((e) => {
    console.error('pipeline failed:', e);
    process.exitCode = 1;
  });
}
