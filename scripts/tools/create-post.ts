/**
 * Create Post（X API v2）工具模块。
 *
 * 参考文档（Create Post）：
 * - Endpoint: POST /2/tweets
 * - 典型入参：text（必填），reply / quote_tweet_id / media / poll 等（按需扩展）
 * - 鉴权：需要用户身份（OAuth 2.0 User Context）
 *
 * 本模块目标：
 * 1) 提供最小可复用的发帖函数 `createPost(...)`；
 * 2) 提供可直接运行的本地测试入口 `main()`；
 * 3) 保持与仓库现有鉴权层（scripts/x-client.ts）一致。
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type { TwitterApiReadWrite } from 'twitter-api-v2';
import { TwitterClient } from '../x-client.js';

/**
 * 发帖请求参数（当前实现的最小子集）。
 * - `text`：帖子正文（X 侧会做长度/内容规则校验）
 * - `replyToTweetId`：可选，作为回复发出
 */
export type CreatePostInput = {
  text: string;
  replyToTweetId?: string;
};

/**
 * 发帖返回结构（保留最常用字段）。
 */
export type CreatePostResult = {
  id: string;
  text: string;
};

/**
 * 将业务输入转换成 v2.tweet 所需参数。
 * 目前仅支持“纯文本”与“回复”两种场景，方便后续继续扩展。
 */
function toTweetPayload(input: CreatePostInput): {
  text: string;
  options?: { reply: { in_reply_to_tweet_id: string } };
} {
  const text = input.text.trim();
  if (!text) throw new Error('text 不能为空');

  if (!input.replyToTweetId) return { text };

  return {
    text,
    options: { reply: { in_reply_to_tweet_id: input.replyToTweetId } },
  };
}

/**
 * 调用 X API 创建帖子。
 *
 * 说明：
 * - 本函数要求 User Context 客户端（代表某个用户）；
 * - 内部通过 `withAuthRetry` 自动处理一次 401 刷新重试。
 */
export async function createPost(
  client: TwitterClient,
  input: CreatePostInput,
): Promise<CreatePostResult> {
  const payload = toTweetPayload(input);

  const result = await client.withAuthRetry(async (rw: TwitterApiReadWrite) => {
    if (payload.options) {
      return await rw.v2.tweet(payload.text, payload.options);
    }
    return await rw.v2.tweet(payload.text);
  });

  return {
    id: result.data.id,
    text: payload.text,
  };
}

/**
 * 判断当前文件是否被“直接执行”，而不是被 import。
 * 这样可避免把库函数引入时误触发真实发帖。
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

/**
 * 本地测试入口：
 * - 使用 `TwitterClient.create()` 构建 User Context 客户端
 * - 调用 createPost
 * - 将结果打印到终端
 *
 * 测试数据策略：
 * - 为了让测试可追踪、可复现，正文与回复目标都在 main 内显式定义
 * - 不从环境变量读取测试内容
 *
 * 安全提示：
 * - 这是“真实发帖”测试，不是 dry-run。
 */
async function main(): Promise<void> {
  const client = await TwitterClient.create();
  const text = `[x-publisher test] ${new Date().toISOString()}`;
  const replyToTweetId: string | undefined = undefined;

  const created = await createPost(client, { text, replyToTweetId });
  console.log('createPost success');
  console.log(`id: ${created.id}`);
  console.log(`text: ${created.text}`);
}

/**
 * CLI 入口守卫：仅在直接执行本文件时运行测试。
 */
if (isRunAsMainScript()) {
  main().catch((e) => {
    console.error('createPost failed:', e);
    process.exitCode = 1;
  });
}
