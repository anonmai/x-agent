#!/usr/bin/env tsx
/**
 * 本脚本：从 X（Twitter）拉取数据并写入本地 JSON，供后续 process-tweet 加工。
 * 第一行 #!/usr/bin/env tsx 表示用 tsx 直接执行 TypeScript，无需先编译。
 */

/* --------------------------------------------------------------------------
 * 依赖导入
 * - commander：解析命令行参数（如 --source、--topic）
 * - TwitterClient：封装 X API（OAuth 2.0）
 * - logger：统一打日志
 * - fs/promises：异步读写文件
 * - path / url：拼路径、在 ESM 下得到当前文件所在目录
 * -------------------------------------------------------------------------- */
import { Command } from 'commander';
import { TwitterClient } from './utils/x-client.js';
import { logger } from './utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

/* --------------------------------------------------------------------------
 * 当前脚本文件所在目录（ES 模块里没有 CommonJS 的 __dirname，需自己算）
 * -------------------------------------------------------------------------- */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* --------------------------------------------------------------------------
 * 命令行配置：定义可选/默认参数，再解析 process.argv
 * - source：从哪采（搜索 / 某用户时间线）
 * - count：条数（传给 API 的期望数量，实际以平台限制为准）
 * - topic：搜索关键词（仅 search 需要）
 * - user：timeline 用：数字用户 ID，或 @用户名 / 用户名（会调 v2 查 ID）
 * -------------------------------------------------------------------------- */
const program = new Command();
program
  .option('-s, --source <type>', '数据源: search/timeline', 'search')
  .option('-c, --count <number>', '获取数量', '20')
  .option('-t, --topic <string>', '搜索关键词')
  .option('-u, --user <string>', 'timeline：用户数字ID 或 @用户名')
  .parse(process.argv);
const options = program.opts();

/* --------------------------------------------------------------------------
 * 查找网络连接失败的可能原因
 * -------------------------------------------------------------------------- */
type NetworkLikeError = {
  code?: string;
  errno?: string;
  syscall?: string;
  address?: string;
  port?: number;
  cause?: unknown;
};

function logNetworkHint(error: unknown) {
  const e = error as NetworkLikeError;
  const cause = e?.cause as NetworkLikeError | undefined;
  const code = e?.code || cause?.code || e?.errno || cause?.errno;
  const syscall = e?.syscall || cause?.syscall;
  const address = e?.address || cause?.address;
  const port = e?.port || cause?.port;

  logger.warn(
    `网络诊断: code=${code ?? 'unknown'} syscall=${syscall ?? 'unknown'} target=${address ?? 'unknown'}:${port ?? 'unknown'}`,
  );
  logger.warn(
    `代理设置: HTTPS_PROXY=${process.env.HTTPS_PROXY ? 'set' : 'unset'}, HTTP_PROXY=${process.env.HTTP_PROXY ? 'set' : 'unset'}`,
  );
  logger.warn(
    '若持续失败，请检查代理是否可用（端口监听/认证/放行 api.x.com:443）。',
  );
}

async function resolveTimelineUserId(
  client: TwitterClient,
  userArg: string,
): Promise<string> {
  const s = userArg.trim();
  if (/^\d+$/.test(s)) return s;
  const username = s.replace(/^@/, '');
  const res = await client.userByUsername(username);
  const id = res.data?.id;
  if (!id) throw new Error(`未找到用户: ${username}`);
  logger.info(`已解析 @${username} → 用户 ID: ${id}`);
  return id;
}

function buildTimestampDirName(date = new Date()): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

/* --------------------------------------------------------------------------
 * 主流程（异步）
 * 1. 用环境变量里的 OAuth 2.0 配置创建 X 客户端
 * 2. 按 source 分支调用不同 API，得到原始响应 raw
 * 3. 把「要落盘的内容」整理成 toStore（search/timeline 只存推文数组，便于下一步处理）
 * 4. 确保目录存在，写入 JSON 文件
 * -------------------------------------------------------------------------- */
async function main() {
  const client = await TwitterClient.create();
  const requestedCount = parseInt(options.count, 10);
  const safeCount = Number.isFinite(requestedCount) ? requestedCount : 20;

  logger.info(`📡 开始采集推文，来源: ${options.source}`);

  try {
    /* ----- 根据数据源调用不同接口，结果先放在 raw（类型未知，因三种返回结构不同）----- */
    let raw: unknown;
    switch (options.source) {
      case 'search':
        if (!options.topic) {
          throw new Error('搜索模式需要指定 --topic 参数');
        }
        // X recent search: max_results 取值范围通常是 [10, 100]
        if (safeCount < 10 || safeCount > 100) {
          logger.warn(
            `search 模式下 --count=${safeCount} 非法，已自动调整到 10（允许范围 10~100）`,
          );
        }
        raw = await client.searchTweets(options.topic, Math.min(100, Math.max(10, safeCount)));
        break;
      case 'timeline':
        if (!options.user) {
          throw new Error('Timeline 模式需要指定 --user 参数（数字 ID 或 @用户名）');
        }
        // v2 user timeline: max_results 取值范围通常是 [5, 100]
        if (safeCount < 5 || safeCount > 100) {
          logger.warn(
            `timeline 模式下 --count=${safeCount} 非法，已自动调整到 5（允许范围 5~100）`,
          );
        }
        {
          const userId = await resolveTimelineUserId(client, options.user);
          raw = await client.getUserTimeline(
            userId,
            Math.min(100, Math.max(5, safeCount)),
          );
        }
        break;
      default:
        throw new Error(`未知的数据源: ${options.source}（仅支持 search/timeline）`);
    }

    /* ----- 规范化要写入磁盘的结构 -----
     * v2 的 search / userTimeline 返回对象里，推文列表在 .data 里；
     * 加工脚本期望「推文数组」，所以这里统一取出 data。
     * `as { data?: unknown[] }` 是类型断言：告诉 TypeScript raw 上可能有 data 字段。
     * -------------------------------------------------------------------------- */
    const toStore = (raw as { data?: unknown[] }).data ?? [];

    /* ----- 按采集时间分目录写入 -----
     * 例如：data/cache/fetched-tweets/20260408-183522/fetched-tweets.json
     * mkdir(..., { recursive: true })：父目录不存在则逐级创建
     * JSON.stringify(..., null, 2)：格式化成带缩进的 JSON 字符串
     * -------------------------------------------------------------------------- */
    const timestampDir = buildTimestampDirName();
    const outputPath = path.join(
      __dirname,
      `../data/cache/fetched-tweets/${timestampDir}.json`,
    );
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(toStore, null, 2));

    const n = Array.isArray(toStore) ? toStore.length : 1;
    logger.success(`✅ 已写入 ${outputPath}（条目数: ${n}）`);
  } catch (error) {
    logger.error('❌ 采集失败:', error);
    //logNetworkHint(error);
    process.exit(1);
  }
}

/* 启动主函数；main 返回 Promise，未写 await 时顶层的 rejected 可能Unhandled，此处 main() 一般足够 */
main();
