# Solution AI Mate Arena Companion

这是 `解决方案AI助手` 的本地 Chrome 伴侣扩展 MVP。

## 使用方式

1. 打开 Chrome 扩展管理页：`chrome://extensions`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本目录：`companion-extension`
5. 在 `http://127.0.0.1:5173/arena` 点击底部发送按钮

## 当前能力

- 支持本地网站和扩展通信
- 支持 Claude / Gemini / GPT / DeepSeek / 豆包 / 千问 / Kimi / 元宝 / Grok 九个目标页面
- 可打开或复用已登录页面
- 发送按钮会直接提交到浏览器伴侣，并自动提交到已登录 AI 网页
- 生成完成后回收回答，并把文本返回到 `/arena` 的对应模型卡片

## 后续增强

- 使用原 `ai-arena-extension` 的选择器兜底策略提升稳定性
