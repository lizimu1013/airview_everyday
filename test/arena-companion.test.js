import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as companion from "../public/arena-companion.js";
import { AI_SERVICES, buildRunPlan, isAllowedSiteOrigin, isReusableServiceTab } from "../companion-extension/background-core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const { ARENA_SERVICE_IDS, createArenaCompanionTask, mapPromptsToServices, mergeCompanionResultsIntoActive } = companion;

test("companion service catalog matches the upstream AI Arena nine-service roster", () => {
  assert.deepEqual(ARENA_SERVICE_IDS, ["claude", "gemini", "chatgpt", "deepseek", "doubao", "qwen", "kimi", "yuanbao", "grok"]);
  assert.deepEqual(Object.keys(AI_SERVICES), ARENA_SERVICE_IDS);
});

test("mapPromptsToServices assigns default prompts to the original flagship trio", () => {
  const prompts = [
    { roleName: "方案架构师", text: "architect prompt" },
    { roleName: "技术专家", text: "tech prompt" },
    { roleName: "反方挑战者", text: "critic prompt" },
  ];

  assert.deepEqual(mapPromptsToServices(prompts).map((item) => item.service), ["claude", "gemini", "chatgpt"]);
});

test("createArenaCompanionTask always creates a browser auto-submit task", () => {
  const active = {
    title: "AI Coding 方案研判",
    question: "AI Coding 对方案工作有什么价值？",
    context: "来自公开资讯的材料",
    rounds: [
      {
        num: 1,
        responses: [
          { roleName: "方案架构师", text: "architect prompt" },
          { roleName: "技术专家", text: "tech prompt" },
          { roleName: "反方挑战者", text: "critic prompt" },
        ],
      },
    ],
  };

  const task = createArenaCompanionTask(active, { autoSubmit: false });

  assert.equal(task.title, "AI Coding 方案研判");
  assert.equal(task.autoSubmit, true);
  assert.equal(task.prompts.length, 3);
  assert.equal(task.prompts[0].service, "claude");
  assert.equal(task.prompts[0].prompt, "architect prompt");
});

test("createArenaCompanionTask respects selected AI services", () => {
  const active = {
    title: "多平台验证",
    rounds: [
      {
        responses: [
          { roleName: "DeepSeek", text: "deepseek prompt" },
          { roleName: "千问", text: "qwen prompt" },
          { roleName: "Kimi", text: "kimi prompt" },
        ],
      },
    ],
  };

  const task = createArenaCompanionTask(active, {
    services: ["deepseek", "qwen", "kimi"],
  });

  assert.deepEqual(
    task.prompts.map((prompt) => prompt.service),
    ["deepseek", "qwen", "kimi"],
  );
});

test("mergeCompanionResultsIntoActive writes collected AI webpage answers back to the round", () => {
  const active = {
    title: "市场洞察",
    isPromptPack: true,
    rounds: [
      {
        num: 1,
        type: "prompt",
        responses: [
          { service: "claude", roleName: "Claude · 架构", providerStatus: "prompt", text: "claude prompt" },
          { service: "gemini", roleName: "Gemini · 技术", providerStatus: "prompt", text: "gemini prompt" },
          { service: "chatgpt", roleName: "GPT · 反方", providerStatus: "prompt", text: "gpt prompt" },
        ],
      },
    ],
  };

  const merged = mergeCompanionResultsIntoActive(active, {
    results: [
      { ok: true, service: "claude", serviceName: "Claude", status: "completed", text: "Claude answer", tabId: 11 },
      { ok: true, service: "gemini", serviceName: "Gemini", status: "completed", text: "Gemini answer", tabId: 12 },
      { ok: true, service: "chatgpt", serviceName: "GPT", status: "submitted", text: "", tabId: 13 },
    ],
  });

  const responses = merged.rounds[0].responses;
  assert.equal(responses[0].text, "Claude answer");
  assert.equal(responses[0].providerStatus, "response");
  assert.equal(responses[0].companionStatus, "completed");
  assert.equal(responses[0].tabId, 11);
  assert.equal(responses[1].text, "Gemini answer");
  assert.equal(responses[1].providerStatus, "response");
  assert.equal(responses[2].text, "gpt prompt", "services without collected text should keep the original prompt visible");
  assert.equal(responses[2].companionStatus, "submitted");
});

test("buildRunPlan maps all upstream AI Arena services to their web chat URLs", () => {
  const plan = buildRunPlan({
    id: "task-1",
    prompts: ARENA_SERVICE_IDS.map((service) => ({ service, prompt: `${service} prompt` })),
  });

  assert.deepEqual(plan.map((item) => item.service), ARENA_SERVICE_IDS);
  assert.equal(plan.find((item) => item.service === "doubao").url, "https://www.doubao.com/chat");
  assert.equal(plan.find((item) => item.service === "qwen").url, "https://www.qianwen.com");
  assert.equal(plan.find((item) => item.service === "grok").url, "https://grok.com");
});

test("companion opens fresh task tabs instead of reusing old conversations", () => {
  assert.equal(isReusableServiceTab(AI_SERVICES.chatgpt, "https://chatgpt.com/"), true);
  assert.equal(isReusableServiceTab(AI_SERVICES.chatgpt, "https://chatgpt.com/c/old-chat"), false);
  assert.equal(isReusableServiceTab(AI_SERVICES.claude, "https://claude.ai/new"), true);
  assert.equal(isReusableServiceTab(AI_SERVICES.claude, "https://claude.ai/chat/old-chat"), false);
  assert.equal(isReusableServiceTab(AI_SERVICES.deepseek, "https://chat.deepseek.com/a/chat/s/old-chat"), false);
});

test("companion dispatches every selected service to a fresh tab before reading answers", async () => {
  const background = await readFile(join(repoRoot, "companion-extension/background.js"), "utf8");

  assert.match(background, /createTaskTab/, "background should create a fresh task tab for each selected model");
  assert.doesNotMatch(background, /chrome\.tabs\.query/, "background should not hide work in an already-open root tab");
  assert.match(background, /openAndSubmitPrompt/, "dispatch should be separated from answer readback");
  assert.match(background, /submittedResults = await Promise\.all/, "all selected models should be dispatched before readback waits");
  assert.match(background, /readSubmittedResult/, "readback should run after dispatch");
});

test("isAllowedSiteOrigin only accepts local Solution AI Mate origins", () => {
  assert.equal(isAllowedSiteOrigin("http://127.0.0.1:5173"), true);
  assert.equal(isAllowedSiteOrigin("http://localhost:5173"), true);
  assert.equal(isAllowedSiteOrigin("https://example.com"), false);
});

test("arena page exposes original AI Arena workbench affordances", async () => {
  const app = await readFile(join(repoRoot, "public/app.js"), "utf8");
  const css = await readFile(join(repoRoot, "public/styles.css"), "utf8");
  const companionSource = await readFile(join(repoRoot, "public/arena-companion.js"), "utf8");

  for (const text of ["折叠到顶", "日简洁", "状态日志", "模型实力榜", "同时提问", "AI接力棒", "@ 单发"]) {
    assert.match(app, new RegExp(text), `public/app.js should include ${text}`);
  }
  for (const tab of ["members", "tasks", "stats", "templates", "settings"]) {
    assert.match(app, new RegExp(`"${tab}"`), `right panel should expose ${tab} tab`);
  }
  assert.match(app, /data-rp-tab/, "right panel tabs should be interactive");
  assert.match(app, /data-arena-service="\$\{escapeHtml\(service\.id\)\}"/, "arena UI should render service buttons");
  for (const service of ARENA_SERVICE_IDS) {
    assert.match(companionSource, new RegExp(`id: "${service}"`), `arena service catalog should include ${service}`);
  }
  assert.match(app, /contenteditable="true"/, "arena input should be a chat-style contenteditable editor");
  assert.match(css, /\.arena-service-card/, "arena CSS should style upstream-like service cards");
  assert.match(css, /\.arena-task-menu/, "arena CSS should style the task picker menu");
});

test("arena blocks stale companion versions and surfaces per-service errors", async () => {
  const app = await readFile(join(repoRoot, "public/app.js"), "utf8");
  const css = await readFile(join(repoRoot, "public/styles.css"), "utf8");
  const aiPage = await readFile(join(repoRoot, "companion-extension/ai-page.js"), "utf8");

  assert.match(app, /MIN_COMPANION_VERSION = "0\.2\.4"/, "page should know the required companion version");
  assert.match(app, /companionNeedsReload/, "page should detect stale companion extensions");
  assert.match(app, /item\.error/, "per-service companion errors should be rendered");
  assert.match(css, /\.arena-version-warning/, "stale extension warnings should be styled");
  assert.match(aiPage, /dispatchEnter/, "content script should fall back to Enter submission");
  assert.match(aiPage, /waitForPromptAccepted/, "content script should verify that web pages accepted a submission");
  assert.match(aiPage, /submitted_unconfirmed/, "content script should keep reading answers after an unconfirmed submit");
});

test("browser companion reads generated web answers back after submission", async () => {
  const app = await readFile(join(repoRoot, "public/app.js"), "utf8");
  const companionSource = await readFile(join(repoRoot, "public/arena-companion.js"), "utf8");
  const background = await readFile(join(repoRoot, "companion-extension/background.js"), "utf8");
  const aiPage = await readFile(join(repoRoot, "companion-extension/ai-page.js"), "utf8");
  const readme = await readFile(join(repoRoot, "companion-extension/README.md"), "utf8");

  assert.match(companionSource, /mergeCompanionResultsIntoActive/, "page helper should merge collected answers into active rounds");
  assert.match(companionSource, /240_000/, "page should wait long enough for webpage generation and readback");
  assert.match(app, /mergeCompanionResultsIntoActive/, "arena should apply companion readback results to the visible board");
  assert.match(background, /SAM_AI_READ_RESPONSE/, "background worker should ask content scripts for generated answers");
  assert.match(background, /readResponseAfterSubmit/, "background worker should poll until answers are stable");
  assert.match(background, /submitted_unconfirmed/, "background should read back pages even when submit acceptance is not detected");
  assert.match(aiPage, /SAM_AI_READ_RESPONSE/, "content script should expose a response readback message");
  assert.match(aiPage, /RESPONSE_SELECTORS/, "content script should maintain per-service answer selectors");
  assert.match(aiPage, /fallbackResponseFromPageText/, "content script should fall back to page text when service selectors change");
  assert.match(readme, /生成完成后回收回答/, "extension README should document answer readback");
});

test("arena send button is mandatory browser companion submission", async () => {
  const app = await readFile(join(repoRoot, "public/app.js"), "utf8");
  const readme = await readFile(join(repoRoot, "README.md"), "utf8");

  assert.match(app, /await runArenaCompanion\(\)/, "main arena send should immediately submit to the browser companion");
  assert.doesNotMatch(app, /data-companion-autosubmit/, "auto-submit should not be an optional checkbox");
  assert.doesNotMatch(app, /data-companion-run/, "browser companion submission should not be a second optional button");
  assert.doesNotMatch(app, /模式：只填入输入框/, "draft-only mode should not be offered");
  assert.match(readme, /点击发送后会立即提交到浏览器伴侣/, "README should document mandatory companion submission");
});

test("arena is documented and rendered as browser companion only", async () => {
  const files = ["public/app.js", "README.md", "src/arena/arena-service.js"];
  const forbidden = [
    /ARENA_API_KEY/,
    /ARENA_BASE_URL/,
    /ARENA_MODEL/,
    /API 圆桌/,
    /modelConfigured/,
    /allowLocalFallback/,
    /local_fallback/,
    /Prompt 模式/,
    /\/run\b/,
    /\/summary\b/,
    /本地降级/,
  ];

  for (const file of files) {
    const content = await readFile(join(repoRoot, file), "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(content, pattern, `${file} should not contain ${pattern}`);
    }
  }
});
