import chalk from 'chalk';

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