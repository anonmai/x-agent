/**
 * X（Twitter）API 薄封装：使用 OAuth 2.0 用户上下文（User Access Token / Bearer）。
 * 对外暴露采集（搜索、时间线）、发帖、发串等方法。
 * 额外能力：
 * 1) 支持从 .env 读取代理（HTTPS_PROXY/HTTP_PROXY）并强制走代理请求
 * 2) 支持 refresh token 刷新 access token 后，自动回写到 .env 持久化
 */

/* --------------------------------------------------------------------------
 * 依赖
 * - twitter-api-v2：官方风格的 Node 客户端（本仓库仅使用 v2）
 * - https-proxy-agent：为 SDK 注入 httpAgent，确保请求走代理
 * - dotenv：加载项目根目录 .env（X_OAUTH2_*、X_CLIENT_* 等）
 * - fs/promises：刷新 token 后回写 .env（持久化）
 * - path / url：在 ESM 模块中计算 __dirname，以便定位 ../../.env
 * -------------------------------------------------------------------------- */
import { TwitterApi, TwitterApiReadWrite } from 'twitter-api-v2';
import { HttpsProxyAgent } from 'https-proxy-agent';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

/* --------------------------------------------------------------------------
 * 代理配置
 * - 优先读取 HTTPS_PROXY，其次 HTTP_PROXY
 * - 若存在代理地址，则给 twitter-api-v2 注入 httpAgent（强制走代理）
 * -------------------------------------------------------------------------- */
const proxyUrl = process.env.HTTPS_PROXY?.trim() || process.env.HTTP_PROXY?.trim();
const httpAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

/* --------------------------------------------------------------------------
 * 将最新 token 回写到 .env
 * - 更新或新增 X_OAUTH2_ACCESS_TOKEN
 * - 如果刷新接口返回了新的 refresh token，则更新或新增 X_OAUTH2_REFRESH_TOKEN
 * - 这样下次进程重启后仍能使用最新 token，避免反复过期
 * -------------------------------------------------------------------------- */
async function persistTokensToEnv(accessToken: string, refreshToken?: string) {
  let content = '';
  try {
    content = await fs.readFile(envPath, 'utf-8');
  } catch {
    // .env 不存在时创建新内容
  }

  const lines = content ? content.split(/\r?\n/) : [];
  let hasAccess = false;
  let hasRefresh = false;

  const nextLines = lines.map((line) => {
    if (line.startsWith('X_OAUTH2_ACCESS_TOKEN=')) {
      hasAccess = true;
      return `X_OAUTH2_ACCESS_TOKEN=${accessToken}`;
    }
    if (line.startsWith('X_OAUTH2_REFRESH_TOKEN=')) {
      hasRefresh = true;
      if (refreshToken) return `X_OAUTH2_REFRESH_TOKEN=${refreshToken}`;
    }
    return line;
  });

  if (!hasAccess) nextLines.push(`X_OAUTH2_ACCESS_TOKEN=${accessToken}`);
  if (refreshToken && !hasRefresh) nextLines.push(`X_OAUTH2_REFRESH_TOKEN=${refreshToken}`);

  await fs.writeFile(envPath, nextLines.join('\n'), 'utf-8');
}


/* --------------------------------------------------------------------------
 * 从环境变量解析「当前可用的 OAuth 2.0 Access Token」
 * 1) 若已配置 X_OAUTH2_ACCESS_TOKEN，直接返回（最常见）
 * 2) 否则若配置了 X_CLIENT_ID + X_OAUTH2_REFRESH_TOKEN，调用 refreshOAuth2Token 换新 access
 *    （保密应用需同时配置 X_CLIENT_SECRET；公开应用可只配 clientId）
 *    刷新成功后会把新 token 回写 .env，并同步到当前 process.env
 * 3) 以上都不满足则抛错，提示用户检查 .env
 * -------------------------------------------------------------------------- */
async function resolveOAuth2AccessToken(): Promise<string> {
  const direct = process.env.X_OAUTH2_ACCESS_TOKEN?.trim();
  if (direct) return direct;

  const refreshToken = process.env.X_OAUTH2_REFRESH_TOKEN?.trim();
  const clientId = process.env.X_CLIENT_ID?.trim();
  if (refreshToken && clientId) {
    const clientSecret = process.env.X_CLIENT_SECRET?.trim();
    const base = new TwitterApi(
      clientSecret ? { clientId, clientSecret } : { clientId },
      httpAgent ? { httpAgent } : undefined,
    );
    const { accessToken, refreshToken: nextRefreshToken } =
      await base.refreshOAuth2Token(refreshToken);
    // 刷新成功后将 token 持久化，避免下次启动继续使用旧值
    await persistTokensToEnv(accessToken, nextRefreshToken);
    // 同步更新当前进程环境变量，确保本次运行立即生效
    process.env.X_OAUTH2_ACCESS_TOKEN = accessToken;
    if (nextRefreshToken) process.env.X_OAUTH2_REFRESH_TOKEN = nextRefreshToken;
    return accessToken;
  }

  throw new Error(
    '缺少 OAuth 2.0 配置：请设置 X_OAUTH2_ACCESS_TOKEN，或同时设置 X_CLIENT_ID 与 X_OAUTH2_REFRESH_TOKEN（保密类型应用还需 X_CLIENT_SECRET）',
  );
}

/* --------------------------------------------------------------------------
 * TwitterClient
 * - 内部持有 readWrite 子客户端：可调用需要「用户写权限」的 v2 接口（如发帖）
 * - 构造函数私有：外部请用 create() 或 fromAccessToken()，避免漏配令牌
 * - 仅保留 v2 搜索/发帖/时间线能力
 * -------------------------------------------------------------------------- */
export class TwitterClient {
  /** readWrite 子客户端：具备发推等写操作所需的 v1/v2 入口 */
  private constructor(private readonly rw: TwitterApiReadWrite) {}

  /* ----- 异步工厂：先 resolveOAuth2AccessToken()，再构造实例 ----- */
  static async create(): Promise<TwitterClient> {
    const accessToken = await resolveOAuth2AccessToken();
    return TwitterClient.fromAccessToken(accessToken);
  }

  /* ----- 同步工厂：调用方自己已有 access token 字符串时（测试或外部注入）----- */
  static fromAccessToken(accessToken: string): TwitterClient {
    return new TwitterClient(
      new TwitterApi(accessToken, httpAgent ? { httpAgent } : undefined).readWrite,
    );
  }

  /* ----- v2：近期搜索；返回含 data / includes 等，fetch-tweets 脚本会再取 .data 落盘 ----- */
  async searchTweets(query: string, count: number = 20) {
    const result = await this.rw.v2.search(query, {
      max_results: count,
      'tweet.fields': ['created_at', 'public_metrics', 'author_id'],
      expansions: ['author_id'],
      'user.fields': ['username', 'name', 'profile_image_url'],
    });
    return result;
  }

  /* ----- v2：发单条推文 ----- */
  async postTweet(text: string) {
    return await this.rw.v2.tweet(text);
  }

  /* ----- v2：发串推——除第一条外，后续每条作为上一条的 reply，形成线程 ----- */
  async postThread(tweets: string[]) {
    let lastTweetId: string | undefined;

    for (const text of tweets) {
      const result = await this.rw.v2.tweet(
        text,
        lastTweetId ? { reply: { in_reply_to_tweet_id: lastTweetId } } : {},
      );
      lastTweetId = result.data.id;
    }
  }

  /* ----- v2：指定用户 ID 的时间线（非用户名；用户名需先查 ID）----- */
  async getUserTimeline(userId: string, count: number = 20) {
    return await this.rw.v2.userTimeline(userId, {
      max_results: count,
      'tweet.fields': ['created_at', 'public_metrics'],
    });
  }
}
