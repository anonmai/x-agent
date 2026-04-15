import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAI } from 'openai';
import { config } from '../config.js';

// 确保data目录存在
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data');


interface Tweet {
  id: string;
  text: string;
  created_at: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
  author_id?: string;
}

interface SummarizeInput {
  tweets: Tweet[];
  trendName: string;
}

interface SummarizeResult {
  summary: string;
  summaryPath: string;
}

// 翻译趋势名为英文，避免乱码问题
async function translateTrendName(trendName: string): Promise<string> {
  try {
    // 初始化OpenAI客户端（用于调用DeepSeek API）
    const openai = new OpenAI({
      apiKey: config.deepseek.apiKey,
      baseURL: config.deepseek.baseURL,
    });
    
    // 调用DeepSeek API进行翻译
    const response = await openai.chat.completions.create({
      model: config.deepseek.model,
      messages: [
        {
          role: 'system',
          content: '你是一个专业的翻译助手，擅长将各种语言翻译成简洁的英文。'
        },
        {
          role: 'user',
          content: `请将以下趋势名翻译成英文，保持简洁，只返回翻译结果，不要添加任何解释：${trendName}`
        }
      ],
      temperature: 0.3,
      max_tokens: 100,
    });
    
    let translated = response.choices[0]?.message?.content || trendName;
    // 清理翻译结果，确保适合作为文件名
    translated = translated.replace(/[^a-zA-Z0-9]/g, '_').trim();
    return translated || trendName;
  } catch (error) {
    console.error('Error translating trend name:', error);
    // 翻译失败时使用原始趋势名
    return trendName;
  }
}

export async function summarizeTweets(input: SummarizeInput): Promise<SummarizeResult> {
  // 确保data目录存在
  const summariesDir = path.join(dataDir, 'summaries');
  await fs.mkdir(summariesDir, { recursive: true });
  
  // 翻译趋势名
  const translatedTrendName = await translateTrendName(input.trendName);
  
  // 生成唯一的文件名
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const trendSafeName = translatedTrendName.replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `${trendSafeName}_${timestamp}`;
  const tweetsCachePath = path.join(config.cache.directory, `${fileName}_tweets.json`);
  const summaryPath = path.join(summariesDir, `${fileName}_summary.md`);
  
  try {
    // 保存推文到缓存
    await fs.writeFile(tweetsCachePath, JSON.stringify(input.tweets, null, 2));
    
    // 准备提示词
    const prompt = `请对以下关于"${input.trendName}"的推文进行总结。总结要求：
1. 不漏掉关键信息
2. 保持客观中立
3. 结构清晰，层次分明
4. 适当新增必要的背景信息
5. 以Markdown格式输出

推文内容：
${input.tweets.map(tweet => `- ${tweet.text}`).join('\n')}`;
    
    // 初始化OpenAI客户端（用于调用DeepSeek API）
    const openai = new OpenAI({
      apiKey: config.deepseek.apiKey,
      baseURL: config.deepseek.baseURL,
    });
    
    // 调用DeepSeek API进行总结
    const response = await openai.chat.completions.create({
      model: config.deepseek.model,
      messages: [
        {
          role: 'system',
          content: '你是一个专业的内容总结助手，擅长对社交媒体内容进行分析和总结。'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });
    
    const summary = response.choices[0]?.message?.content || '';
    
    // 保存总结到文件
    await fs.writeFile(summaryPath, summary);
    
    // 删除缓存的推文文件
    await fs.unlink(tweetsCachePath);
    
    return {
      summary,
      summaryPath
    };
  } catch (error) {
    console.error('Error summarizing tweets:', error);
    
    // 清理缓存文件
    try {
      if (await fs.access(tweetsCachePath).then(() => true).catch(() => false)) {
        await fs.unlink(tweetsCachePath);
      }
    } catch (cleanupError) {
      console.error('Error cleaning up cache:', cleanupError);
    }
    
    throw error;
  }
}

// 测试函数
async function main(): Promise<void> {
  try {
    const testTweets: Tweet[] = [
      {
        id: '123456789',
        text: '今天天气真好，适合出去散步！',
        created_at: new Date().toISOString(),
        public_metrics: {
          retweet_count: 10,
          reply_count: 5,
          like_count: 20,
          quote_count: 2
        }
      },
      {
        id: '987654321',
        text: '今天的阳光特别明媚，心情也跟着好了起来。',
        created_at: new Date().toISOString(),
        public_metrics: {
          retweet_count: 8,
          reply_count: 3,
          like_count: 15,
          quote_count: 1
        }
      }
    ];
    
    const result = await summarizeTweets({
      tweets: testTweets,
      trendName: '好天气'
    });
    
    console.log('Summary generated successfully:');
    console.log(result.summary);
    console.log('Summary saved to:', result.summaryPath);
  } catch (error) {
    console.error('Test failed:', error);
    process.exitCode = 1;
  }
}

// 仅在直接执行时运行测试
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
