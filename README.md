# x-publisher

面向 OpenClaw 的 X 自动化技能项目：
**搜索走 App-only Bearer**，**发帖走 OAuth 2.0 User Context**，并支持“DeepSeek 模型自动总结 -> 自动生成推文 -> 自动发布”的完整自动化流程。

---

## 1. 当前能力

| 模块 | 路径 | 作用 |
|------|------|------|
| 鉴权与客户端 | `scripts/x-client.ts` | `createAppOnlyClient()`（搜索）、`TwitterClient.create()`（发帖/用户态） |
| 搜索推文 | `scripts/tools/search-tweets.ts` | recent/all 搜索封装（App-only）+ 测试落盘 |
| 趋势获取 | `scripts/tools/get-trends.ts` | `GET /2/trends/by/woeid/{woeid}` |
| 发帖 | `scripts/tools/create-post.ts` | `createPost(...)`（User Context） |
| 推文总结 | `scripts/tools/summarize-tweets.ts` | 使用 DeepSeek 模型总结推文，保存为 Markdown |
| 推文生成 | `scripts/tools/generate-post.ts` | 使用 DeepSeek 模型基于总结生成短推文 |
| 趋势处理 | `scripts/find-trend.ts` | 趋势发现、推文搜索、总结和生成的完整流程 |
| 自动化流水线 | `scripts/pipeline.ts` | 完整的自动化流程，从趋势发现到发布 |

---

## 2. 目录结构

```text
x-publisher/
├── README.md
├── SKILL.md
├── skill.json
├── openclaw.plugin.json
├── package.json
├── package-lock.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── scripts/
│   ├── config.ts                 # 配置管理
│   ├── x-client.ts               # Twitter API 客户端
│   ├── pipeline.ts               # 自动化流水线
│   ├── find-trend.ts             # 趋势处理主逻辑
│   └── tools/
│       ├── search-tweets.ts      # 搜索推文工具
│       ├── get-trends.ts         # 获取趋势工具
│       ├── create-post.ts        # 发布推文工具
│       ├── summarize-tweets.ts   # 推文总结工具
│       └── generate-post.ts      # 推文生成工具
├── data/
│   ├── summaries/                # 推文总结（长久保存）
│   └── audit/                    # 审计记录
└── cache/                        # 临时缓存
```

---

## 3. 环境准备

```bash
cp .env.example .env
npm install
```

必需变量（详见 `.env.example`）：

| 变量 | 用途 |
|------|------|
| `X_APP_BEARER_TOKEN` | 搜索/趋势（App-only） |
| `X_OAUTH2_ACCESS_TOKEN` | 发帖（User Context） |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` / `X_OAUTH2_REFRESH_TOKEN` | User Context 刷新兜底 |
| `DEEPSEEK_API_KEY` | DeepSeek 模型 API 密钥 |
| `HTTPS_PROXY` / `HTTP_PROXY` | 可选代理 |

---

## 4. 自动化执行（DeepSeek 模型）

本项目支持完整的自动化流程，使用 DeepSeek 模型进行总结和生成推文：

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

---

## 5. 配置说明

通过 `.env` 文件可配置以下参数：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `TRENDS_WOEID` | 趋势地区 ID | 1（全球） |
| `TRENDS_MAX` | 最大趋势数 | 20 |
| `TRENDS_SELECTED_INDEX` | 选中的趋势索引 | 0 |
| `SEARCH_MAX_RESULTS` | 搜索结果数量 | 50 |
| `SEARCH_MODE` | 搜索模式（recent/all） | recent |
| `DEEPSEEK_BASE_URL` | DeepSeek API 基础 URL | https://api.deepseek.com/v1 |
| `DEEPSEEK_MODEL` | DeepSeek 模型名称 | deepseek-chat |
| `CACHE_DIRECTORY` | 缓存目录 | ./cache |
| `LOG_LEVEL` | 日志级别 | info |

---

## 6. 单功能测试命令

- 搜索测试：`npx tsx scripts/tools/search-tweets.ts`
- 趋势测试：`npx tsx scripts/tools/get-trends.ts`
- 发帖测试：`npx tsx scripts/tools/create-post.ts`
- 推文总结测试：`npx tsx scripts/tools/summarize-tweets.ts`
- 推文生成测试：`npx tsx scripts/tools/generate-post.ts`
- 趋势处理测试：`npx tsx scripts/find-trend.ts`

---

## 7. 说明

- `search all` 需要 full-archive 权限；无权限会返回 403。
- 推文总结会保存到 `data/summaries/` 目录，作为长久保存资料。
- 执行结果会保存到 `data/audit/` 目录，便于后续查看和分析。

---

## 8. License

Apache-2.0
