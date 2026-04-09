/**
 * X API 客户端层（auth + transport）：
 *
 * 目标：
 * 1) 统一加载环境变量与代理配置；
 * 2) 提供两种鉴权客户端：
 *    - App-only Bearer：用于只读搜索（recent/all）；
 *    - OAuth2 User Context：用于发帖/用户态接口；
 * 3) 在 User Context 模式下处理 access token 过期（401）并自动 refresh 一次；
 * 4) refresh 成功后把新 token 回写 `.env`，避免下次进程启动继续使用旧 token。
 *
 * 边界：
 * - 本文件不承载具体业务 API（如 search 参数拼装、发帖文案等）；
 * - 仅负责“拿到正确客户端 + 保证鉴权可用”。
 */

import { TwitterApi, TwitterApiReadWrite } from 'twitter-api-v2';
import { HttpsProxyAgent } from 'https-proxy-agent';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '../.env');
dotenv.config({ path: envPath });

// 全局代理：优先 HTTPS_PROXY，再回退 HTTP_PROXY。
// 注入到 twitter-api-v2 后，所有请求会统一经过该代理出口。
const proxyUrl = process.env.HTTPS_PROXY?.trim() || process.env.HTTP_PROXY?.trim();
const httpAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

/**
 * 将 refresh 后的新 token 持久化到 `.env`。
 *
 * 行为：
 * - 更新或追加 `X_OAUTH2_ACCESS_TOKEN`；
 * - 若 refresh 返回了新的 refresh token，则更新或追加 `X_OAUTH2_REFRESH_TOKEN`；
 * - 如果 `.env` 不存在，则按最小内容创建。
 *
 * 备注：
 * - 这里只做 KEY=VALUE 级别的替换，不解析复杂注释或引号语义；
 * - 对本仓库当前 `.env` 结构已足够稳定。
 */
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

/**
 * 解析可用的 OAuth 2.0 User Context access token。
 *
 * 优先级：
 * 1) 已有 `X_OAUTH2_ACCESS_TOKEN` 且非强制刷新 -> 直接使用；
 * 2) 否则若具备 `X_CLIENT_ID + X_OAUTH2_REFRESH_TOKEN` -> 调用 refresh 获取新 token；
 * 3) 以上都不满足 -> 抛出配置错误。
 *
 * `forceRefresh=true` 用于 401 兜底场景，强制跳过现有 access token。
 */
async function resolveOAuth2AccessToken(forceRefresh = false): Promise<string> {
  const direct = process.env.X_OAUTH2_ACCESS_TOKEN?.trim();
  if (direct && !forceRefresh) return direct;

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
    await persistTokensToEnv(accessToken, nextRefreshToken);
    process.env.X_OAUTH2_ACCESS_TOKEN = accessToken;
    if (nextRefreshToken) process.env.X_OAUTH2_REFRESH_TOKEN = nextRefreshToken;
    return accessToken;
  }

  throw new Error(
    '缺少 OAuth 2.0 配置：请设置 X_OAUTH2_ACCESS_TOKEN，或同时设置 X_CLIENT_ID 与 X_OAUTH2_REFRESH_TOKEN（保密类型应用还需 X_CLIENT_SECRET）',
  );
}

/**
 * 解析 App-only Bearer（搜索接口使用）。
 *
 * 支持变量：
 * - `X_APP_BEARER_TOKEN`（推荐）
 * - `X_BEARER_TOKEN`（兼容旧命名）
 *
 * 注意：这是应用身份 token，不代表用户身份，不能替代用户态写接口鉴权。
 */
function resolveAppOnlyBearerToken(): string {
  const appBearer =
    process.env.X_APP_BEARER_TOKEN?.trim() || process.env.X_BEARER_TOKEN?.trim();
  if (appBearer) return appBearer;

  throw new Error(
    '缺少 App-only Bearer：请设置 X_APP_BEARER_TOKEN（或兼容变量 X_BEARER_TOKEN）',
  );
}

/**
 * App-only 客户端（OAuth 2.0 Application-Only / Bearer）。
 * 用于 recent/all search 等只读接口。
 */
export function createAppOnlyClient(): TwitterApi {
  const appBearer = resolveAppOnlyBearerToken();
  return new TwitterApi(appBearer, httpAgent ? { httpAgent } : undefined);
}

export class TwitterClient {
  private constructor(private rw: TwitterApiReadWrite) {}

  /**
   * User Context 的 401 兜底重试：
   * - 先执行一次业务请求；
   * - 若报 401 且具备 refresh 条件，则刷新 token 并重建客户端后重试一次；
   * - 仅重试一次，避免错误配置导致无限循环。
   *
   * 建议把所有用户态 v2 调用包在该方法里，以提升长时运行稳定性。
   */
  async withAuthRetry<T>(fn: (rw: TwitterApiReadWrite) => Promise<T>): Promise<T> {
    const run = () => fn(this.rw);
    try {
      return await run();
    } catch (error) {
      const status = (error as { code?: number })?.code;
      const canRefresh =
        Boolean(process.env.X_CLIENT_ID?.trim()) &&
        Boolean(process.env.X_OAUTH2_REFRESH_TOKEN?.trim());
      if (status !== 401 || !canRefresh) throw error;

      const newAccessToken = await resolveOAuth2AccessToken(true);
      this.rw = new TwitterApi(
        newAccessToken,
        httpAgent ? { httpAgent } : undefined,
      ).readWrite;
      return await run();
    }
  }

  /**
   * 暴露底层 readWrite 客户端。
   * 若希望自动处理 401 刷新，优先使用 `withAuthRetry` 包裹业务调用。
   */
  get readWrite(): TwitterApiReadWrite {
    return this.rw;
  }

  /** 从环境变量构建 User Context 客户端（必要时自动 refresh）。 */
  static async create(): Promise<TwitterClient> {
    const accessToken = await resolveOAuth2AccessToken();
    return TwitterClient.fromAccessToken(accessToken);
  }

  /** 使用外部已获取的 access token 直接构建 User Context 客户端。 */
  static fromAccessToken(accessToken: string): TwitterClient {
    return new TwitterClient(
      new TwitterApi(accessToken, httpAgent ? { httpAgent } : undefined).readWrite,
    );
  }
}
