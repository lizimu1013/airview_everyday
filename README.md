# AI HOT 时间轴

一个按时间轴展示 AI 热点新闻的页面。数据来自 [AI HOT](https://aihot.virxact.com/) 的公开 REST API，本地 `server.js` 负责代理请求、补浏览器 User-Agent、短缓存和静态文件服务。

## 运行

```bash
npm start
```

默认地址：

```text
http://127.0.0.1:5173
```

可通过环境变量改端口：

```bash
PORT=8080 npm start
```

## 功能

- 自动读取 AI HOT 精选实时条目
- 新增全部动态页：`/all`，使用全量信息流并支持信源类型筛选
- 新增通信论文雷达：`/communication`，扫描可访问论文源并生成不超过 10 篇精读候选
- 5 分钟自动刷新，支持手动刷新
- 按模型、产品、行业、论文、技巧分类筛选
- 支持服务端关键词搜索
- 按今天、昨天等日期分组的纵向时间轴
- 每条新闻展示时间、来源、精选分、摘要、标签、原文链接，并尽量从原文 `og:image`/`twitter:image` 补全封面图
- 新增电视大屏页签：`/?view=screen`
- 大屏页在一个 16:9 首屏内展示焦点新闻、最新动态、高分信号和分类头条

## 数据源说明

AI HOT 的公开 API 目前是测试版，适合内部展示和轻量轮询。摘要由上游 LLM 生成，正式引用时应打开卡片里的原文链接核对。

AI HOT 公共接口不直接返回图片字段。本服务会在后端按条目原文 URL 抓取页面元信息，优先使用 `og:image`、`twitter:image` 和 JSON-LD 图片，并做短超时、并发限制和缓存；无法访问或没有图片元信息的原文会继续以纯文本卡片展示。

## 论文雷达环境变量

通信论文雷达不会把模型 API Key 写入仓库或前端。生产环境通过 systemd 的 `/etc/airview-aihot.env` 注入：

```text
PAPER_RADAR_BASE_URL=https://api.muchu.cloud/v1
PAPER_RADAR_MODEL=gpt-5.4-mini
PAPER_RADAR_API_KEY=...
```

如需纳入 Google Scholar Alert，可追加公开可访问的 RSS：

```text
GOOGLE_SCHOLAR_ALERT_FEEDS=https://...
```
