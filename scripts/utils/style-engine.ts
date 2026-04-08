/**
 * 风格引擎：根据 preferences.json 过滤推文，再按 style-templates.json 中的风格改写正文。
 * 若配置了 OPENAI_API_KEY 则走 Chat Completions；否则用简单规则（截断 + 可选表情映射）。
 */

/* --------------------------------------------------------------------------
 * 依赖
 * - openai：可选，用于 LLM 改写
 * - dotenv：从项目根 .env 加载 OPENAI_API_KEY 等
 * - path / url：定位 .env 路径（ESM 下需自行算 __dirname）
 * -------------------------------------------------------------------------- */
import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

/* --------------------------------------------------------------------------
 * 类型定义（与 config/preferences.json、config/style-templates.json 结构对应）
 * - Preferences：兴趣词、避雷词、偏好账号、语言（当前筛选逻辑主要用 interests / avoidTopics）
 * - StyleTemplates：每种风格名对应 tone、最大 token/长度、是否加表情、系统 prompt 等
 * -------------------------------------------------------------------------- */
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

/* --------------------------------------------------------------------------
 * StyleEngine 类
 * -------------------------------------------------------------------------- */
export class StyleEngine {
  private openai?: OpenAI;
  private preferences: Preferences;
  private templates: StyleTemplates;

  /* ----- 构造函数：注入配置；若存在 OPENAI_API_KEY 则初始化 OpenAI 客户端 ----- */
  constructor(preferences: Preferences, templates: StyleTemplates) {
    this.preferences = preferences;
    this.templates = templates;

    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  /* ----- 按偏好过滤：正文须至少命中一项 interest，且不能命中 avoidTopics 中任一词（子串匹配、不区分大小写）----- */
  filterByPreferences(tweets: any[]): any[] {
    return tweets.filter((tweet) => {
      const text = tweet.text || tweet.full_text || '';

      const hasInterest = this.preferences.interests.some((interest) =>
        text.toLowerCase().includes(interest.toLowerCase()),
      );

      const hasAvoided = this.preferences.avoidTopics.some((topic) =>
        text.toLowerCase().includes(topic.toLowerCase()),
      );

      return hasInterest && !hasAvoided;
    });
  }

  /* ----- 逐条套用风格：根据风格名取模板，有 OpenAI 则 AI 改写，否则基础规则；输出带 originalText / processedText 等字段 ----- */
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
        processedText = await this.applyAIStyle(originalText, template);
      } else {
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

  /* ----- 调用 OpenAI：system 用模板里的 prompt，user 传入待改写正文；max_tokens 取自模板 ----- */
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

  /* ----- 无 AI 时的降级：可选按关键词追加表情，再按 maxLength 截断并加省略号 ----- */
  private applyBasicStyle(text: string, template: any): string {
    let result = text;

    if (template.useEmoji) {
      result = this.addEmojis(result);
    }

    if (result.length > template.maxLength) {
      result = result.substring(0, template.maxLength - 3) + '...';
    }

    return result;
  }

  /* ----- 简单表情映射：若正文包含预设英文词，则在末尾拼接对应 emoji（可多次命中则多次追加）----- */
  private addEmojis(text: string): string {
    const emojiMap: Record<string, string> = {
      AI: '🤖',
      good: '👍',
      great: '🎉',
      love: '❤️',
      news: '📰',
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
