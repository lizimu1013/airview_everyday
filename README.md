# 解决方案AI助手 | Solution AI Mate

面向解决方案工作的 AI 助手，用于辅助方案洞察、信息整理、内容生成、技术分析和工作提效。页面通过时间轴、信息库、大屏和论文精读视图，把可用于方案工作的公开信息线索整理成可浏览的工作台。

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

- 自动读取解决方案相关实时条目
- 信息库页面：`/all`，使用全量信息流并支持信源类型筛选
- 论文精读页面：`/communication`，扫描可访问论文源并生成不超过 10 篇精读候选
- 5 分钟自动刷新，支持手动刷新
- 按模型、产品、行业、论文、技巧分类筛选
- 支持服务端关键词搜索
- 按今天、昨天等日期分组的纵向时间轴
- 每条新闻展示时间、来源、精选分、摘要、标签、原文链接，并尽量从原文 `og:image`/`twitter:image` 补全封面图
- 电视大屏页签：`/?view=screen`
- 大屏页在一个 16:9 首屏内展示焦点线索、最新动态、高分信号和分类头条

## 数据源说明

当前公开数据接口适合内部展示和轻量轮询。摘要由上游 LLM 生成，正式引用时应打开卡片里的原文链接核对。

当前公开接口不直接返回图片字段。本服务会在后端按条目原文 URL 抓取页面元信息，优先使用 `og:image`、`twitter:image` 和 JSON-LD 图片，并做短超时、并发限制和缓存；无法访问或没有图片元信息的原文会继续以纯文本卡片展示。

## 论文精读环境变量

论文精读助手不会把模型 API Key 写入仓库或前端。生产环境通过 systemd 的 `/etc/airview-aihot.env` 注入：

```text
PAPER_RADAR_BASE_URL=https://api.muchu.cloud/v1
PAPER_RADAR_MODEL=gpt-5.4-mini
PAPER_RADAR_API_KEY=...
```

如需纳入 Google Scholar Alert，可追加公开可访问的 RSS：

```text
GOOGLE_SCHOLAR_ALERT_FEEDS=https://...
```
