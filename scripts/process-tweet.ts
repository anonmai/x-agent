#!/usr/bin/env tsx
/**
 * 本脚本：读取 fetch-tweets 产出的 JSON，按「用户偏好」过滤，再按选定「风格」生成可发帖文案，写入新 JSON。
 * 通常接在 fetch-tweets.ts 之后、publish-tweet.ts 之前。
 */

/* --------------------------------------------------------------------------
 * 依赖导入
 * - commander：解析命令行（输入文件、风格、输出路径）
 * - StyleEngine：业务核心——按偏好筛选 + 套用风格模板（可选调用 OpenAI）
 * - logger：日志
 * - fs / path / url：读配置与写结果、在 ESM 下得到 __dirname
 * -------------------------------------------------------------------------- */
import { Command } from 'commander';
import { StyleEngine } from './utils/style-engine.js';
import { logger } from './utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

/* --------------------------------------------------------------------------
 * 当前脚本所在目录（ESM 模块中需手动从 import.meta.url 推导）
 * -------------------------------------------------------------------------- */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* --------------------------------------------------------------------------
 * 命令行参数
 * - input：必填，上游 JSON（推文数组，或带 data 数组的 v2 包装对象）
 * - style：选用哪种风格键（与 config/style-templates.json 里的键一致）
 * - output：可选；不填则默认写到 data/cache/processed-tweets.json
 * -------------------------------------------------------------------------- */
const program = new Command();

program
  .requiredOption('-i, --input <path>', '输入 JSON 文件路径')
  .option('-s, --style <type>', '风格: professional/casual/humorous/thread', 'professional')
  .option('-o, --output <path>', '输出文件路径')
  .parse(process.argv);

const options = program.opts();

/* --------------------------------------------------------------------------
 * 主流程（异步）
 * 1. 读入推文 JSON 并规范成「数组」
 * 2. 读 preferences.json、style-templates.json
 * 3. 用 StyleEngine 过滤 + 风格化
 * 4. 写出 JSON，并在终端预览第一条的 processedText
 * -------------------------------------------------------------------------- */
async function main() {
  try {
    logger.info(`🎨 开始加工推文，风格: ${options.style}`);

    /* ----- 1) 读取输入文件并解析为 JSON ----- */
    const rawData = await fs.readFile(options.input, 'utf-8');
    let tweets: unknown = JSON.parse(rawData);

    /* ----- 若文件是「整包 API 响应」形态（含 .data 数组），则只取 data，与 fetch-tweets 只存数组的写法对齐 ----- */
    if (tweets && typeof tweets === 'object' && !Array.isArray(tweets)) {
      const d = (tweets as { data?: unknown }).data;
      if (Array.isArray(d)) tweets = d;
    }
    if (!Array.isArray(tweets)) {
      throw new Error('输入须为推文数组 [...]，或含 data 数组的对象');
    }

    /* ----- 2) 读取「智能体喜好」：兴趣词、避雷词、语言等 ----- */
    const prefsPath = path.join(__dirname, '../config/preferences.json');
    const preferences = JSON.parse(await fs.readFile(prefsPath, 'utf-8'));

    /* ----- 3) 读取「风格模板」：每种风格对应的 prompt、长度、是否用表情等 ----- */
    const templatesPath = path.join(__dirname, '../config/style-templates.json');
    const templates = JSON.parse(await fs.readFile(templatesPath, 'utf-8'));

    /* ----- 4) 实例化引擎，把配置注入 ----- */
    const engine = new StyleEngine(preferences, templates);

    /* ----- 5) 先按偏好过滤，再异步按风格改写（内部可能调 OpenAI，或规则降级）----- */
    const filteredTweets = engine.filterByPreferences(tweets);
    const processedTweets = await engine.applyStyle(filteredTweets, options.style);

    /* ----- 6) 将结果写入磁盘（默认或 -o 指定路径）----- */
    const outputPath = options.output || path.join(__dirname, '../data/cache/processed-tweets.json');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(processedTweets, null, 2));

    logger.success(`✅ 已加工 ${processedTweets.length} 条推文，保存到 ${outputPath}`);

    /* ----- 7) 控制台打印第一条成品，便于人工检查再发 publish ----- */
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
