---
name: x-intelligent-publisher
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

本技能支持“宿主模型自动化编排”：先抓取趋势和推文，再由 OpenClaw 宿主模型完成中文总结，最后自动发帖。

## 能力概览

- **`scripts/x-client.ts`**：`createAppOnlyClient()`（搜索用 App-only Bearer）；`TwitterClient.create()`（User Context，401 refresh 回写 `.env`）。
- **`scripts/find-trend.ts`**：获取美国 Top1 趋势并抓取 10 条推文，写入缓存。
- **`scripts/pipeline.ts`**：两段式编排器（collect -> host model summarize -> publish）。
- **`scripts/tools/creat-post.ts`**：`createPost(...)` 发帖能力（User Context）。

## 身份验证

在 `.env` 至少配置 **`X_APP_BEARER_TOKEN`**（搜索接口）。发帖/用户态接口需配置 **`X_OAUTH2_ACCESS_TOKEN`**，或 **`X_CLIENT_ID` + `X_OAUTH2_REFRESH_TOKEN`**（及保密应用的 **`X_CLIENT_SECRET`**）。详见 `.env.example`。

## OpenClaw 自动化执行规范（重点）

执行任务“基于趋势自动总结并发布”时，必须按以下流程：

1. **采集阶段（工具动作）**
   - 运行：`npx tsx scripts/pipeline.ts --collect`
   - 读取终端中 `MODEL_INPUT_START` 和 `MODEL_INPUT_END` 之间的内容（或读取 `data/cache/pipeline/pending-latest.json` 中的 `modelInput`）。

2. **总结阶段（宿主模型动作，不调用外部 OpenAI SDK）**
   - 使用 OpenClaw 宿主模型直接总结，严格遵守：
     - 只输出 1 条中文推文正文；
     - 100~140 字；
     - 不编造、不过度推断；
     - 不使用 emoji，不加 hashtag，不加解释文本；
     - 若信息冲突，采用保守表述（如“多条消息显示…”）。

3. **发布阶段（工具动作）**
   - 把上一步模型产出的正文作为参数发布：
     - `npx tsx scripts/pipeline.ts --publish --text "<模型生成的中文推文>"`

4. **失败处理**
   - 若发布失败，不要重复生成；优先复用同一条正文重试一次。
   - 若错误为鉴权/权限问题，先提示检查 `X_OAUTH2_ACCESS_TOKEN` 或 refresh 配置。

### 约束
- 禁止在自动流程中直接调用第三方模型 API（例如脚本内 OpenAI SDK）完成总结。
- 总结任务必须由 OpenClaw 宿主模型能力执行。
