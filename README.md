# x-publisher

面向 OpenClaw 的 X 自动化技能项目：  
**搜索走 App-only Bearer**，**发帖走 OAuth 2.0 User Context**，并支持“宿主模型自动总结 -> 自动发布”的两段式编排。

---

## 1. 当前能力

| 模块 | 路径 | 作用 |
|------|------|------|
| 鉴权与客户端 | `scripts/x-client.ts` | `createAppOnlyClient()`（搜索）、`TwitterClient.create()`（发帖/用户态） |
| 搜索推文 | `scripts/tools/search-tweets.ts` | recent/all 搜索封装（App-only）+ 测试落盘 |
| 趋势获取 | `scripts/tools/get-trends.ts` | `GET /2/trends/by/woeid/{woeid}` |
| 发帖 | `scripts/tools/create-post.ts` | `createPost(...)`（User Context） |
| 趋势采集流水线 | `scripts/find-trend.ts` | 美国 Top1 趋势 -> 搜索 10 条 -> 写缓存 |
| 宿主模型编排器 | `scripts/pipeline.ts` | `--collect` 生成模型输入，`--publish --text` 发布 |

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
│   ├── x-client.ts
│   ├── pipeline.ts
│   ├── find-trend.ts
│   └── tools/
│       ├── search-tweets.ts
│       ├── get-trends.ts
│       └── create-post.ts
└── data/
    └── cache/
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
| `HTTPS_PROXY` / `HTTP_PROXY` | 可选代理 |

---

## 4. 自动化执行（宿主模型）

本项目推荐由 OpenClaw 宿主模型执行“两段式”：

1. **采集输入**
   ```bash
   npx tsx scripts/pipeline.ts --collect
   ```
   结果会输出并写入 `data/cache/pipeline/pending-latest.json`（含 `modelInput`）。

2. **宿主模型总结**
   - 读取 `modelInput`
   - 生成 1 条中文推文正文（100~140 字，不加 emoji/hashtag，不编造）

3. **发布**
   ```bash
   npx tsx scripts/pipeline.ts --publish --text "这里粘贴宿主模型生成的中文推文"
   ```

发布后会写审计文件到 `data/cache/pipeline/host-publish-*.json`。

---

## 5. 单功能测试命令

- 搜索测试：`npx tsx scripts/tools/search-tweets.ts`
- 趋势测试：`npx tsx scripts/tools/get-trends.ts`
- 发帖测试：`npx tsx scripts/tools/create-post.ts`
- 趋势采集+缓存：`npx tsx scripts/find-trend.ts`

---

## 6. 说明

- `search all` 需要 full-archive 权限；无权限会返回 403。  
- `pipeline.ts` 不直接调用第三方模型 API，总结由宿主模型完成（见 `SKILL.md` 自动化规范）。

---

## 7. License

Apache-2.0
