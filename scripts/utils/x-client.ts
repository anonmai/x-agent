/**
 * X（Twitter）API 薄封装：使用 OAuth 2.0 用户上下文（User Access Token / Bearer）。
 * 对外暴露采集（搜索、时间线、趋势）、发帖、发串等方法；令牌从环境变量解析。
 */

/* --------------------------------------------------------------------------
 * 依赖
 * - twitter-api-v2：官方风格的 Node 客户端，封装 v1 / v2 请求
 * - dotenv：加载项目根目录 .env（X_OAUTH2_*、X_CLIENT_* 等）
 * - path / url：在 ESM 模块中计算 __dirname，以便定位 ../../.env
 * -------------------------------------------------------------------------- */
import { TwitterApi, TwitterApiReadWrite } from 'twitter-api-v2';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const proxyUrl =
  process.env.HTTPS_PROXY?.trim() ||
  process.env.HTTP_PROXY?.trim() ||
  process.env.ALL_PROXY?.trim() ||
  process.env.SOCKS_PROXY?.trim();

function buildHttpAgent(url?: string) {
  if (!url) return undefined;
  const lower = url.toLowerCase();
  if (lower.startsWith('socks://') || lower.startsWith('socks5://') || lower.startsWith('socks4://')) {
    return new SocksProxyAgent(url);
  }
  return new HttpsProxyAgent(url);
}

const httpAgent = buildHttpAgent(proxyUrl);

/* --------------------------------------------------------------------------
 * 从环境变量解析「当前可用的 OAuth 2.0 Access Token」
 * 1) 若已配置 X_OAUTH2_ACCESS_TOKEN，直接返回（最常见）
 * 2) 否则若配置了 X_CLIENT_ID + X_OAUTH2_REFRESH_TOKEN，调用 refreshOAuth2Token 换新 access
 *    （保密应用需同时配置 X_CLIENT_SECRET；公开应用可只配 clientId）
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
    const { accessToken } = await base.refreshOAuth2Token(refreshToken);
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
 * - v1 趋势、v2 搜索/发帖等说明见各方法注释
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

  /* ----- v1：某地趋势（非推文正文）；部分应用在 OAuth 2.0 用户令牌下可能受限，失败可改用 search ----- */
  async getTrendingTopics(woeid: number = 1) {
    return await this.rw.v1.trendsByPlace(woeid);
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
