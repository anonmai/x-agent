import fs from 'fs/promises';
import { OpenAI } from 'openai';
import { config } from '../config.js';

interface GeneratePostInput {
  summaryPath: string;
  style?: string;
}

interface GeneratePostResult {
  post: string;
}

export async function generatePost(input: GeneratePostInput): Promise<GeneratePostResult> {
  try {
    // 读取总结文件
    const summary = await fs.readFile(input.summaryPath, 'utf-8');
    
    // 准备提示词
    const style = input.style || '简洁明了，吸引人，符合Twitter风格';
    const prompt = `请基于以下总结，生成一篇适合在Twitter上发布的短推文。要求：
1. 长度不超过280字符，最好在250字符以上
2. ${style}
3. 主要介绍Trend的核心内容
4. 在开头加上[Trend名称]，其中这个Trend名称是总结中提到的趋势名称
5. 不要使用任何标签
6. 适当加入相关公众言论
7. 禁止敏感的宗教、政治、极端言论

总结内容：
${summary}`;
    
    // 初始化OpenAI客户端（用于调用DeepSeek API）
    const openai = new OpenAI({
      apiKey: config.deepseek.apiKey,
      baseURL: config.deepseek.baseURL,
    });
    
    // 调用DeepSeek API生成推文
    const response = await openai.chat.completions.create({
      model: config.deepseek.model,
      messages: [
        {
          role: 'system',
          content: '你是一个专业的社交媒体内容创作者，擅长将长文本总结为简洁有力的推文。'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 300,
    });
    
    let post = response.choices[0]?.message?.content || '';
    
    // 确保推文长度不超过280字符
    if (post.length > 280) {
      post = post.substring(0, 277) + '...';
    }
    
    return {
      post
    };
  } catch (error) {
    console.error('Error generating post:', error);
    throw error;
  }
}

// 测试函数
async function main(): Promise<void> {
  try {
    // 创建测试总结文件
    const testSummary = `# 好天气趋势总结

## 概述
今天全国大部分地区天气晴朗，阳光明媚，适合户外活动。

## 网友反应
- 许多网友表示心情愉悦，计划外出散步或进行户外活动
- 部分地区温度适宜，非常适合春游
- 大家纷纷在社交媒体上分享自己看到的美景

## 影响
- 户外商家生意兴隆
- 公园和景区人流量增加
- 人们的户外活动时间明显增加`;
    
    const testSummaryPath = 'test_summary.md';
    await fs.writeFile(testSummaryPath, testSummary);
    
    const result = await generatePost({
      summaryPath: testSummaryPath
    });
    
    console.log('Post generated successfully:');
    console.log(result.post);
    console.log('Post length:', result.post.length);
    
    // 清理测试文件
    await fs.unlink(testSummaryPath);
  } catch (error) {
    console.error('Test failed:', error);
    process.exitCode = 1;
  }
}

// 仅在直接执行时运行测试
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
