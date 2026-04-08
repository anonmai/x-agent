/**
 * 轻量日志封装：统一在终端用颜色 + 图标区分级别，供 fetch / process / publish 等脚本复用。
 */

/* --------------------------------------------------------------------------
 * chalk：给终端字符串上色（蓝/绿/黄/红/灰），便于肉眼区分日志类型
 * -------------------------------------------------------------------------- */
import chalk from 'chalk';

/* --------------------------------------------------------------------------
 * logger 对象：导出若干方法，每个方法接收任意个参数并打印到 console
 * - info：一般信息（蓝色）
 * - success：成功（绿色）
 * - warn：警告（黄色）
 * - error：错误（红色；仍用 console.log，与 console.error 区分可按需再改）
 * - debug：调试；仅当环境变量 DEBUG 存在时输出（灰色），避免生产刷屏
 * -------------------------------------------------------------------------- */
export const logger = {
  info: (...args: any[]) => {
    console.log(chalk.blue('ℹ'), ...args);
  },

  success: (...args: any[]) => {
    console.log(chalk.green('✅'), ...args);
  },

  warn: (...args: any[]) => {
    console.log(chalk.yellow('⚠️'), ...args);
  },

  error: (...args: any[]) => {
    console.log(chalk.red('❌'), ...args);
  },

  debug: (...args: any[]) => {
    if (process.env.DEBUG) {
      console.log(chalk.gray('🐛'), ...args);
    }
  },
};
