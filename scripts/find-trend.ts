import { createAppOnlyClient, TwitterClient } from './x-client.js';
import { getTrendsByWoeid } from './tools/get-trends.js';
import { searchRecentTweets } from './tools/search-tweets.js';
import { summarizeTweets } from './tools/summarize-tweets.js';
import { generatePost } from './tools/generate-post.js';
import { createPost } from './tools/create-post.js';
import { config, validateConfig } from './config.js';

interface TrendResult {
  trendName: string;
  tweets: unknown[];
  summary: string;
  post: string;
  postId: string;
}

export async function findAndProcessTrend(): Promise<TrendResult> {
  // 验证配置
  validateConfig();
  
  try {
    console.log('=== 开始趋势发现和处理 ===');
    
    // 1. 获取趋势
    console.log('步骤1: 获取当前趋势');
    const appOnlyClient = createAppOnlyClient();
    const trendsResult = await getTrendsByWoeid(
      appOnlyClient,
      config.trends.woeid,
      config.trends.maxTrends
    );
    
    if (trendsResult.data.length === 0) {
      throw new Error('未获取到趋势数据');
    }
    
    // 选择指定索引的趋势
    const selectedTrend = trendsResult.data[config.trends.selectedTrendIndex];
    if (!selectedTrend || !selectedTrend.trend_name) {
      throw new Error('选中的趋势无效');
    }
    
    const trendName = selectedTrend.trend_name;
    console.log(`选中的趋势: ${trendName}`);
    
    // 2. 搜索相关推文
    console.log('步骤2: 搜索相关推文');
    const searchResult = await searchRecentTweets(
      appOnlyClient,
      trendName,
      config.search.maxResults
    );
    
    if (searchResult.data.length === 0) {
      throw new Error('未搜索到相关推文');
    }
    
    console.log(`搜索到 ${searchResult.data.length} 条相关推文`);
    
    // 3. 总结推文
    console.log('步骤3: 总结推文内容');
    const summaryResult = await summarizeTweets({
      tweets: searchResult.data as any[],
      trendName
    });
    
    console.log('推文总结完成');
    
    // 4. 生成短推文
    console.log('步骤4: 生成短推文');
    const postResult = await generatePost({
      summaryPath: summaryResult.summaryPath
    });
    
    console.log('生成的推文:', postResult.post);
    console.log('推文长度:', postResult.post.length);
    
    // 5. 发布推文
    console.log('步骤5: 发布推文');
    const twitterClient = await TwitterClient.create();
    const createResult = await createPost(twitterClient, {
      text: postResult.post
    });
    
    console.log('推文发布成功，ID:', createResult.id);
    
    console.log('=== 趋势处理完成 ===');
    
    return {
      trendName,
      tweets: searchResult.data,
      summary: summaryResult.summary,
      post: postResult.post,
      postId: createResult.id
    };
  } catch (error) {
    console.error('处理趋势时出错:', error);
    throw error;
  }
}

// 主函数
async function main(): Promise<void> {
  try {
    await findAndProcessTrend();
  } catch (error) {
    console.error('执行失败:', error);
    process.exitCode = 1;
  }
}

// 仅在直接执行时运行
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
