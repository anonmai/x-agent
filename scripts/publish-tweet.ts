#!/usr/bin/env tsx

/**
 * 本脚本：把 process-tweet 生成的 processedText 发布到 X。\n+ * 为了安全起见，默认建议先用 --dry-run 预览内容，再去掉该参数做真实发布。\n+ */

/* --------------------------------------------------------------------------
 * 依赖导入
 * - commander：解析命令行参数（输入文件、选择第几条、是否 dry-run）
 * - TwitterClient：封装 X API（OAuth 2.0 用户上下文）
 * - logger：统一日志输出
 * - fs/promises：异步读取 JSON 文件
 * -------------------------------------------------------------------------- */
import { Command } from 'commander';
import { TwitterClient } from './utils/x-client.js';
import { logger } from './utils/logger.js';
import fs from 'fs/promises';

/* --------------------------------------------------------------------------
 * 命令行参数
 * - -i/--input：必填，加工后的 JSON 文件（数组，每项至少有 processedText 字段）
 * - --index：可选，发数组里的第几条（0 基索引），默认 0
 * - --dry-run：可选，只打印要发布的正文，不调用 X API
 * -------------------------------------------------------------------------- */
const program = new Command();

program
  .requiredOption('-i, --input <path>', '加工结果 JSON（含 processedText 的数组）')
  .option('--index <n>', '发第几条（从 0 开始）', '0')
  .option('--dry-run', '只打印正文，不调用 API', false)
  .parse(process.argv);

const options = program.opts();

/* --------------------------------------------------------------------------
 * 主流程（异步）
 * 1) 读取加工结果 JSON
 * 2) 选择要发布的那一条（--index）
 * 3) 校验正文存在且不超过 280 字
 * 4) 如果是 dry-run 就只打印；否则调用 X API 发帖
 * -------------------------------------------------------------------------- */
async function main() {
  const raw = await fs.readFile(options.input, 'utf-8');
  const list = JSON.parse(raw) as Array<{ processedText?: string }>;
  const idx = parseInt(String(options.index), 10);
  if (!Array.isArray(list) || list.length === 0 || idx < 0 || idx >= list.length) {
    logger.error('❌ 输入须为非空数组，且 index 在范围内');
    process.exit(1);
  }
  const rawText = list[idx].processedText;
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text) {
    logger.error('❌ 该条缺少 processedText');
    process.exit(1);
  }
  if (text.length > 280) {
    logger.error(`❌ 正文超过 280 字（当前 ${text.length}）`);
    process.exit(1);
  }
  if (options.dryRun) {
    logger.info('dry-run 正文：');
    console.log(text);
    return;
  }
  const client = await TwitterClient.create();
  const res = await client.postTweet(text);
  logger.success(`✅ 已发布 id: ${res.data?.id ?? 'unknown'}`);
}

/* --------------------------------------------------------------------------
 * 入口：执行 main，并把未捕获异常统一打印后退出
 * -------------------------------------------------------------------------- */
main().catch((e) => {
  logger.error('❌ 发布失败:', e);
  process.exit(1);
});
