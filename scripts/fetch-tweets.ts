#!/usr/bin/env tsx

import { Command } from 'commander';
import { TwitterClient } from './utils/x-client.js';
import { logger } from './utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const program = new Command();

program
  .option('-s, --source <type>', '数据源: trending/search/timeline', 'trending')
  .option('-c, --count <number>', '获取数量', '20')
  .option('-t, --topic <string>', '搜索关键词')
  .option('-u, --user <string>', '用户ID（用于timeline）')
  .parse(process.argv);

const options = program.opts();

async function main() {
  const client = await TwitterClient.create();
  const count = parseInt(options.count);
  
  logger.info(`📡 开始采集推文，来源: ${options.source}`);
  
  try {
    let raw: unknown;
    switch (options.source) {
      case 'trending':
        raw = await client.getTrendingTopics();
        break;
      case 'search':
        if (!options.topic) {
          throw new Error('搜索模式需要指定 --topic 参数');
        }
        raw = await client.searchTweets(options.topic, count);
        break;
      case 'timeline':
        if (!options.user) {
          throw new Error('Timeline 模式需要指定 --user 参数');
        }
        raw = await client.getUserTimeline(options.user, count);
        break;
      default:
        throw new Error(`未知的数据源: ${options.source}`);
    }

    const toStore =
      options.source === 'search' || options.source === 'timeline'
        ? (raw as { data?: unknown[] }).data ?? []
        : raw;

    const outputPath = path.join(__dirname, '../data/cache/fetched-tweets.json');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(toStore, null, 2));

    const n = Array.isArray(toStore) ? toStore.length : 1;
    logger.success(`✅ 已写入 ${outputPath}（条目数: ${n}）`);
  } catch (error) {
    logger.error('❌ 采集失败:', error);
    process.exit(1);
  }
}

main();