---
name: x-publisher
description: >-
  OpenClaw-hosted auto publishing skill for X API v2. Search uses App-only Bearer;
  posting uses OAuth 2.0 User Context. Summary generation must use host model ability.
metadata:
  openclaw:
    emoji: "📰"
    requires:
      env:
        - X_APP_BEARER_TOKEN
        - X_OAUTH2_ACCESS_TOKEN
    primaryEnv: X_APP_BEARER_TOKEN
    install:
      - id: npm
        kind: node
        label: npm install（仓库根目录）
---

# X 集成（x-publisher）

本技能支持完整的自动化流程：先抓取趋势和推文，再使用 DeepSeek 模型完成总结和生成推文，最后自动发帖。

---

## 能力概览

- **`scripts/x-client.ts`**：`createAppOnlyClient()`（搜索用 App-only Bearer）；`TwitterClient.create()`（User Context，401 refresh 回写 `.env`）。
- **`scripts/tools/get-trends.ts`**：获取指定地区的趋势数据。
- **`scripts/tools/search-tweets.ts`**：搜索与趋势相关的推文。
- **`scripts/tools/summarize-tweets.ts`**：使用 DeepSeek 模型总结推文，保存为 Markdown。
- **`scripts/tools/generate-post.ts`**：使用 DeepSeek 模型基于总结生成短推文。
- **`scripts/tools/create-post.ts`**：`createPost(...)` 发帖能力（User Context）。
- **`scripts/find-trend.ts`**：趋势发现、推文搜索、总结和生成的完整流程。
- **`scripts/pipeline.ts`**：完整的自动化流水线，从趋势发现到发布。

## 身份验证

在 `.env` 至少配置以下变量：

- **`X_APP_BEARER_TOKEN`**（搜索接口）
- **`X_OAUTH2_ACCESS_TOKEN`**（发帖接口）
- **`DEEPSEEK_API_KEY`**（模型接口）

发帖/用户态接口也可配置 **`X_CLIENT_ID`** **+** **`X_OAUTH2_REFRESH_TOKEN`**（及保密应用的 **`X_CLIENT_SECRET`**）用于 token 刷新。详见 `.env.example`。

## 自动化执行流程

执行任务“基于趋势自动总结并发布”时，使用以下命令：

```bash
npx tsx scripts/pipeline.ts
```

执行流程：

1. **发现趋势**：获取当前流行趋势
2. **搜索推文**：搜索与趋势相关的推文
3. **总结推文**：使用 DeepSeek 模型对推文进行总结，保存到 `data/summaries/` 目录
4. **生成推文**：使用 DeepSeek 模型基于总结生成短推文
5. **发布推文**：发布生成的推文到 Twitter
6. **审计记录**：保存执行结果到 `data/audit/` 目录

## 配置说明

通过 `.env` 文件可配置以下参数：

| 配置项                     | 说明                  | 默认值                           |
| ----------------------- | ------------------- | ----------------------------- |
| `TRENDS_WOEID`          | 趋势地区 ID             | 1（全球）                         |
| `TRENDS_MAX`            | 最大趋势数               | 20                            |
| `TRENDS_SELECTED_INDEX` | 选中的趋势索引             | 0                             |
| `SEARCH_MAX_RESULTS`    | 搜索结果数量              | 50                            |
| `SEARCH_MODE`           | 搜索模式（recent/all）    | recent                        |
| `DEEPSEEK_BASE_URL`     | DeepSeek API 基础 URL | <https://api.deepseek.com/v1> |
| `DEEPSEEK_MODEL`        | DeepSeek 模型名称       | deepseek-chat                 |

## 常见地区 WOEID

- 1: 全球
- 23424977: 美国
- 23424975: 英国
- 23424856: 日本
- 23424803: 中国
- 23424938: 加拿大
- 23424848: 澳大利亚

## 失败处理

- 若发布失败，系统会自动处理错误并尝试恢复
- 若错误为鉴权/权限问题，会提示检查相关配置
- 执行过程中的错误会被记录到控制台，便于调试

## 注意事项

- `search all` 需要 full-archive 权限；无权限会返回 403
- 推文总结会保存到 `data/summaries/` 目录，作为长久保存资料
- 执行结果会保存到 `data/audit/` 目录，便于后续查看和分析

