import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '../.env');
dotenv.config({ path: envPath });

export interface Config {
  // Twitter API 配置
  twitter: {
    appBearerToken: string;
    oauth2AccessToken: string;
    oauth2RefreshToken: string;
    clientId: string;
    clientSecret?: string;
  };
  
  // DeepSeek API 配置
  deepseek: {
    apiKey: string;
    baseURL: string;
    model: string;
  };
  
  // 趋势配置
  trends: {
    woeid: number;
    maxTrends: number;
    selectedTrendIndex: number;
  };
  
  // 搜索配置
  search: {
    maxResults: number;
    mode: 'recent' | 'all';
  };
  
  // 缓存配置
  cache: {
    directory: string;
  };
  
  // 日志配置
  log: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}

export const config: Config = {
  twitter: {
    appBearerToken: process.env.X_APP_BEARER_TOKEN || process.env.X_BEARER_TOKEN || '',
    oauth2AccessToken: process.env.X_OAUTH2_ACCESS_TOKEN || '',
    oauth2RefreshToken: process.env.X_OAUTH2_REFRESH_TOKEN || '',
    clientId: process.env.X_CLIENT_ID || '',
    clientSecret: process.env.X_CLIENT_SECRET,
  },
  
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  },
  
  trends: {
    woeid: Number(process.env.TRENDS_WOEID || 1),
    maxTrends: Number(process.env.TRENDS_MAX || 20),
    selectedTrendIndex: Number(process.env.TRENDS_SELECTED_INDEX || 0),
  },
  
  search: {
    maxResults: Number(process.env.SEARCH_MAX_RESULTS || 50),
    mode: (process.env.SEARCH_MODE || 'recent') as 'recent' | 'all',
  },
  
  cache: {
    directory: process.env.CACHE_DIRECTORY || path.join(__dirname, '../cache'),
  },
  
  log: {
    level: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
  },
};

// 验证配置
export function validateConfig(): void {
  if (!config.twitter.appBearerToken) {
    throw new Error('Missing Twitter App Bearer Token');
  }
  
  if (!config.twitter.oauth2AccessToken && (!config.twitter.clientId || !config.twitter.oauth2RefreshToken)) {
    throw new Error('Missing Twitter OAuth2 configuration');
  }
  
  if (!config.deepseek.apiKey) {
    throw new Error('Missing DeepSeek API Key');
  }
}
