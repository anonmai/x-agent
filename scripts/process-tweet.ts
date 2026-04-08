#!/usr/bin/env tsx

import { Command } from 'commander';
import { StyleEngine } from './utils/style-engine.js';
import { logger } from './utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const program = new Command();

program
  .requiredOption('-i, --input <path>', '输入 JSON 文件路径')
  .option('-s, --style <type>', '风格: professional/casual/humorous/thread', 'professional')
  .option('-o, --output <path>', '输出文件路径')
  .parse(process.argv);

const options = program.opts();

async function main() {
  try {
    logger.info(`🎨 开始加工推文，风格: ${options.style}`);
    
    // 读取原始推文
    const rawData = await fs.readFile(options.input, 'utf-8');
    let tweets: unknown = JSON.parse(rawData);
    if (tweets && typeof tweets === 'object' && !Array.isArray(tweets)) {
      const d = (tweets as { data?: unknown }).data;
      if (Array.isArray(d)) tweets = d;
    }
    if (!Array.isArray(tweets)) {
      throw new Error('输入须为推文数组 [...]，或含 data 数组的对象');
    }
    
    // 读取偏好配置
    const prefsPath = path.join(__dirname, '../config/preferences.json');
    const preferences = JSON.parse(await fs.readFile(prefsPath, 'utf-8'));
    
    // 读取风格模板
    const templatesPath = path.join(__dirname, '../config/style-templates.json');
    const templates = JSON.parse(await fs.readFile(templatesPath, 'utf-8'));
    
    // 初始化风格引擎
    const engine = new StyleEngine(preferences, templates);
    
    // 筛选和加工
    const filteredTweets = engine.filterByPreferences(tweets);
    const processedTweets = await engine.applyStyle(filteredTweets, options.style);
    
    // 保存结果
    const outputPath = options.output || path.join(__dirname, '../data/cache/processed-tweets.json');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(processedTweets, null, 2));
    
    logger.success(`✅ 已加工 ${processedTweets.length} 条推文，保存到 ${outputPath}`);
    
    // 输出预览
    if (processedTweets.length > 0) {
      logger.info('\n📝 预览第一条:');
      console.log('─'.repeat(50));
      console.log(processedTweets[0].processedText);
      console.log('─'.repeat(50));
    }
  } catch (error) {
    logger.error('❌ 加工失败:', error);
    process.exit(1);
  }
}

main();