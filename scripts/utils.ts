import path from 'path';
import { fileURLToPath } from 'url';

/**
 * 判断当前文件是否被直接运行（而非作为库被 import）。
 * 
 * 通过比较 Node.js 入口文件路径与当前模块路径来判断。
 * 
 * @returns 如果当前文件是被直接运行的脚本，返回 true；否则返回 false
 */
export function isRunAsMainScript(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// 测试代码
if (isRunAsMainScript()) {
  console.log('Test: utils.ts is being run directly - function returned true');
}
