---
name: x-intelligent-publisher
description: >-
  Fetches tweets from X (search/timeline/trends), filters and rewrites by
  preferences and style templates, then posts. Use for OpenClaw X 自动发帖、推文流水线。
metadata:
  openclaw:
    emoji: "📰"
    requires:
      env:
        - X_OAUTH2_ACCESS_TOKEN
    primaryEnv: X_OAUTH2_ACCESS_TOKEN
    install:
      - id: npm
        kind: node
        label: npm install（仓库根目录）
---

# X 自动发帖（x-publisher）

三步 CLI，均在**仓库根目录**执行（需先 `npm install`）。

## 1. 采集

- **推荐**：`search` 得到可加工的推文数组（写入 `data/cache/fetched-tweets.json`）。
- `timeline`：同上，需 `--user` 为**数字用户 ID**。
- `trending`：返回趋势话题结构，**不是**推文数组；要加工需再根据话题用 `search` 采推文。

```bash
npx tsx scripts/fetch-tweets.ts --source search --topic "AI -is:retweet lang:en" --count 20
```

## 2. 加工

读取 `config/preferences.json` 与 `config/style-templates.json`，输出 `data/cache/processed-tweets.json`（字段含 `processedText`）。

```bash
npx tsx scripts/process-tweet.ts -i data/cache/fetched-tweets.json -s professional
```

风格：`professional` | `casual` | `humorous` | `thread`。无 `OPENAI_API_KEY` 时用简单规则降级。

## 3. 发布

```bash
npx tsx scripts/publish-tweet.ts -i data/cache/processed-tweets.json --index 0 --dry-run
```

去掉 `--dry-run` 即真实发帖。遵守 X 开发者条款；自动化前建议人工确认正文。

## 身份验证（OAuth 2.0）

在 `.env` 中配置 **`X_OAUTH2_ACCESS_TOKEN`**（用户授权得到的 Bearer access token，需包含发帖/读推等对应 scope）。也可不填 access token，改为配置 **`X_CLIENT_ID`** + **`X_OAUTH2_REFRESH_TOKEN`**（授权时含 `offline.access`），保密应用另配 **`X_CLIENT_SECRET`**，运行时会先刷新再请求。

OAuth 2.0 用户上下文主要面向 **API v2**；`trending` 走 v1，若平台返回认证错误，请改用 `search` 采集。

## 与 Clawbird 的关系

若已安装 **clawbird** 插件，搜帖/发帖也可用其工具；本技能提供**可脚本化、落盘缓存**的整条流水线，便于批处理与自定义 `preferences` / `style-templates`。
