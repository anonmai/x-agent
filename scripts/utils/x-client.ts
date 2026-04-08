import { TwitterApi } from 'twitter-api-v2';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function resolveOAuth2AccessToken(): Promise<string> {
  const direct = process.env.X_OAUTH2_ACCESS_TOKEN?.trim();
  if (direct) return direct;

  const refreshToken = process.env.X_OAUTH2_REFRESH_TOKEN?.trim();
  const clientId = process.env.X_CLIENT_ID?.trim();
  if (refreshToken && clientId) {
    const clientSecret = process.env.X_CLIENT_SECRET?.trim();
    const base = new TwitterApi(
      clientSecret
        ? { clientId, clientSecret }
        : { clientId },
    );
    const { accessToken } = await base.refreshOAuth2Token(refreshToken);
    return accessToken;
  }

  throw new Error(
    '缺少 OAuth 2.0 配置：请设置 X_OAUTH2_ACCESS_TOKEN，或同时设置 X_CLIENT_ID 与 X_OAUTH2_REFRESH_TOKEN（保密类型应用还需 X_CLIENT_SECRET）',
  );
}

/**
 * X API 用户上下文：OAuth 2.0 User Access Token（Bearer）。
 * 发帖、搜索、时间线等 v2 接口均走该令牌；v1 趋势接口可能仍受平台限制，失败时请改用 search。
 */
export class TwitterClient {
  private constructor(private readonly rw: TwitterApi) {}

  /** 从环境变量创建：优先 X_OAUTH2_ACCESS_TOKEN，否则用 refresh_token 换取 access_token */
  static async create(): Promise<TwitterClient> {
    const accessToken = await resolveOAuth2AccessToken();
    return TwitterClient.fromAccessToken(accessToken);
  }

  static fromAccessToken(accessToken: string): TwitterClient {
    return new TwitterClient(new TwitterApi(accessToken).readWrite);
  }

  async getTrendingTopics(woeid: number = 1) {
    return await this.rw.v1.trendsByPlace(woeid);
  }

  async searchTweets(query: string, count: number = 20) {
    const result = await this.rw.v2.search(query, {
      max_results: count,
      'tweet.fields': ['created_at', 'public_metrics', 'author_id'],
      expansions: ['author_id'],
      'user.fields': ['username', 'name', 'profile_image_url'],
    });
    return result;
  }

  async postTweet(text: string) {
    return await this.rw.v2.tweet(text);
  }

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

  async getUserTimeline(userId: string, count: number = 20) {
    return await this.rw.v2.userTimeline(userId, {
      max_results: count,
      'tweet.fields': ['created_at', 'public_metrics'],
    });
  }
}
