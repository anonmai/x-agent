#!/usr/bin/env tsx

import { Command } from 'commander';
import { TwitterClient } from './utils/x-client.js';
import { logger } from './utils/logger.js';
import fs from 'fs/promises';

const program = new Command();

program
  .requiredOption('-i, --input <path>', '加工结果 JSON（含 processedText 的数组）')
  .option('--index <n>', '发第几条（从 0 开始）', '0')
  .option('--dry-run', '只打印正文，不调用 API', false)
  .parse(process.argv);

const options = program.opts();

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

main().catch((e) => {
  logger.error('❌ 发布失败:', e);
  process.exit(1);
});
