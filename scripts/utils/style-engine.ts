import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

interface Preferences {
  interests: string[];
  avoidTopics: string[];
  preferredAccounts: string[];
  language: string;
}

interface StyleTemplates {
  [key: string]: {
    tone: string;
    maxLength: number;
    useEmoji: boolean;
    prompt: string;
  };
}

export class StyleEngine {
  private openai?: OpenAI;
  private preferences: Preferences;
  private templates: StyleTemplates;

  constructor(preferences: Preferences, templates: StyleTemplates) {
    this.preferences = preferences;
    this.templates = templates;
    
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  filterByPreferences(tweets: any[]): any[] {
    // 实现基于偏好的筛选逻辑
    return tweets.filter(tweet => {
      const text = tweet.text || tweet.full_text || '';
      
      // 检查是否包含感兴趣的话题
      const hasInterest = this.preferences.interests.some(
        interest => text.toLowerCase().includes(interest.toLowerCase())
      );
      
      // 检查是否包含避免的话题
      const hasAvoided = this.preferences.avoidTopics.some(
        topic => text.toLowerCase().includes(topic.toLowerCase())
      );
      
      return hasInterest && !hasAvoided;
    });
  }

  async applyStyle(tweets: any[], style: string): Promise<any[]> {
    const template = this.templates[style];
    if (!template) {
      throw new Error(`未知的风格: ${style}`);
    }

    const processed = [];
    
    for (const tweet of tweets) {
      const originalText = tweet.text || tweet.full_text || '';
      
      let processedText: string;
      
      if (this.openai) {
        // 使用 OpenAI 进行风格转换
        processedText = await this.applyAIStyle(originalText, template);
      } else {
        // 使用基础规则转换
        processedText = this.applyBasicStyle(originalText, template);
      }
      
      processed.push({
        ...tweet,
        originalText,
        processedText,
        style,
        timestamp: new Date().toISOString(),
      });
    }
    
    return processed;
  }

  private async applyAIStyle(text: string, template: any): Promise<string> {
    const response = await this.openai!.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: template.prompt,
        },
        {
          role: 'user',
          content: `请将以下内容转换为指定风格:\n\n${text}`,
        },
      ],
      max_tokens: template.maxLength,
    });
    
    return response.choices[0].message.content || text;
  }

  private applyBasicStyle(text: string, template: any): string {
    // 基础风格转换（无 AI）
    let result = text;
    
    if (template.useEmoji) {
      result = this.addEmojis(result);
    }
    
    if (result.length > template.maxLength) {
      result = result.substring(0, template.maxLength - 3) + '...';
    }
    
    return result;
  }

  private addEmojis(text: string): string {
    const emojiMap: Record<string, string> = {
      'AI': '🤖',
      'good': '👍',
      'great': '🎉',
      'love': '❤️',
      'news': '📰',
    };
    
    let result = text;
    for (const [word, emoji] of Object.entries(emojiMap)) {
      if (result.toLowerCase().includes(word.toLowerCase())) {
        result += ` ${emoji}`;
      }
    }
    
    return result;
  }
}