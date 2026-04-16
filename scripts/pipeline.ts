/**
 * 自动编排器（DeepSeek模型版）：
 * 趋势 -> 搜索 -> DeepSeek模型总结 -> DeepSeek模型生成推文 -> 发布
 *
 * 设计原则：
 * - 本脚本直接调用 DeepSeek API 进行总结和生成推文；
 * - 完整的自动化流程，无需宿主模型干预；
 * - 包含错误处理、日志记录和落盘审计。
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { findAndProcessTrend } from './find-trend.js';
import { config } from './config.js';
import { isRunAsMainScript } from './utils.js';


type PipelineOutput = {
  trendName: string;
  postedTweetId: string;
  postedAt: string;
  generatedText: string;
  summaryPath: string;
  dryRun: boolean;
};

/**
 * 完整的趋势处理流水线：
 * 1. 发现当前趋势
 * 2. 搜索相关推文
 * 3. 使用DeepSeek模型总结推文
 * 4. 使用DeepSeek模型生成短推文
 * 5. 发布推文
 * 6. 落盘审计
 */
export async function runPipeline(dryRun = false): Promise<PipelineOutput> {
  // 执行趋势处理
  const result = await findAndProcessTrend(dryRun);
  
  // 落盘审计
  const now = new Date();
  const output: PipelineOutput = {
    trendName: result.trendName,
    postedTweetId: result.postId,
    postedAt: now.toISOString(),
    generatedText: result.post,
    summaryPath: `${result.trendName}_${now.toISOString().replace(/[:.]/g, '-')}_summary.md`,
    dryRun: dryRun,
  };
  
  // 确保审计目录存在
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const auditDir = path.join(__dirname, '../data/audit');
  await fs.mkdir(auditDir, { recursive: true });
  
  // 保存审计记录
  const filename = `pipeline-${now.toISOString().replace(/[:.]/g, '-')}.json`;
  const outPath = path.join(auditDir, filename);
  await fs.writeFile(outPath, JSON.stringify(output, null, 2), 'utf-8');
  
  console.log('runPipeline success');
  console.log(`trend: ${output.trendName}`);
  console.log(`postedTweetId: ${output.postedTweetId}`);
  console.log(`generatedText: ${output.generatedText}`);
  console.log(`saved: ${outPath}`);
  
  return output;
}

/**
 * CLI 入口：
 * 执行完整的趋势处理流水线
 * npx tsx scripts/pipeline.ts
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  
  try {
    await runPipeline(dryRun);
  } catch (error) {
    console.error('Pipeline failed:', error);
    process.exitCode = 1;
  }
}

if (isRunAsMainScript()) {
  main().catch((e) => {
    console.error('pipeline failed:', e);
    process.exitCode = 1;
  });
}
