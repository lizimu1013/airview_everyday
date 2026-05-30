import { ARENA_SERVICES, ARENA_SERVICE_IDS, createArenaCompanionTask, mergeCompanionResultsIntoActive } from "./arena-companion.js";

const queryParams = new URLSearchParams(window.location.search);
const routePath = window.location.pathname.replace(/\/+$/, "") || "/";
const initialView =
  queryParams.get("view") === "screen"
    ? "screen"
    : routePath === "/communication"
      ? "radar"
      : routePath === "/arena"
        ? "arena"
        : routePath === "/about"
          ? "about"
          : "timeline";

const state = {
  view: initialView,
  feed: initialView === "screen" ? "selected" : routePath === "/all" ? "all" : "selected",
  source: "all",
  category: "all",
  query: "",
  items: [],
  radar: null,
  arena: {
    templates: null,
    sessions: [],
    active: null,
    draft: null,
    selectedRoles: [],
    selectedServices: [],
    activeTab: "members",
    task: "ask",
    taskStyle: "collab",
    taskMenuOpen: false,
    companion: {
      checked: false,
      connected: false,
      status: "检测中",
      version: "",
      autoSubmit: true,
      lastRun: null,
    },
    loading: false,
    status: "",
    error: "",
  },
  loading: false,
  radarLoading: false,
  refreshMs: 5 * 60 * 1000,
};

const categories = {
  "ai-models": "模型",
  "ai-products": "产品",
  industry: "行业",
  paper: "论文",
  tip: "技巧",
  uncategorized: "其他",
};

const categoryFull = {
  "ai-models": "模型发布/更新",
  "ai-products": "产品发布/更新",
  industry: "行业动态",
  paper: "论文研究",
  tip: "技巧与观点",
  uncategorized: "其他",
};

const ARENA_TASKS = [
  { id: "ask", name: "同时提问", style: "collab", templateId: "solution-insight", desc: "所有 AI 同时回答同一个问题，适合快速横向比较。" },
  { id: "debate", name: "自由辩论", style: "free", templateId: "solution-insight", desc: "鼓励不同 AI 互相质疑，适合判断争议问题。" },
  { id: "brainstorm", name: "群策群力", style: "collab", templateId: "solution-insight", desc: "让 AI 各自补齐视角，适合生成解决方案初稿。" },
  { id: "judge", name: "裁判总结", style: "collab", templateId: "customer-brief", desc: "把多方观点压缩为结论、风险和下一步。" },
  { id: "ppt", name: "PPT 工坊", style: "collab", templateId: "ppt-material", desc: "拆出标题、红腰带、图示建议和证据点。" },
  { id: "relay", name: "AI接力棒", style: "collab", templateId: "tech-research", desc: "让不同 AI 按顺序接力完善同一份方案。" },
];

const MIN_COMPANION_VERSION = "0.2.4";

const els = {
  page: document.querySelector(".page"),
  hero: document.querySelector(".hero"),
  toolbar: document.querySelector(".toolbar"),
  summaryStrip: document.querySelector(".summary-strip"),
  pageEyebrow: document.querySelector("#pageEyebrow"),
  pageTitle: document.querySelector("#pageTitle"),
  pageCopy: document.querySelector("#pageCopy"),
  topbarTitle: document.querySelector("#topbarTitle"),
  clockTime: document.querySelector("#clockTime"),
  clockDate: document.querySelector("#clockDate"),
  totalCount: document.querySelector("#totalCount"),
  topScore: document.querySelector("#topScore"),
  sourceCount: document.querySelector("#sourceCount"),
  lastUpdated: document.querySelector("#lastUpdated"),
  connectionState: document.querySelector("#connectionState"),
  navLinks: document.querySelectorAll(".nav-links a"),
  sourceTabs: document.querySelector("#sourceTabs"),
  categoryTabs: document.querySelector("#categoryTabs"),
  searchInput: document.querySelector("#searchInput"),
  refreshButton: document.querySelector("#refreshButton"),
  timelineList: document.querySelector("#timelineList"),
  screenBoard: document.querySelector("#screenBoard"),
  radarBoard: document.querySelector("#radarBoard"),
  arenaBoard: document.querySelector("#arenaBoard"),
  aboutBoard: document.querySelector("#aboutBoard"),
  themeToggle: document.querySelector("#themeToggle"),
  viewLinks: document.querySelectorAll("[data-view-link]"),
  feedLinks: document.querySelectorAll("[data-feed-link]"),
};

function setTheme(mode) {
  const theme = mode === "dark" ? "dark" : "light";
  document.body.classList.toggle("theme-dark", theme === "dark");
  if (els.themeToggle) {
    els.themeToggle.lastElementChild.textContent = theme === "dark" ? "暗色 / 亮色" : "亮色 / 暗色";
  }
  try {
    window.localStorage.setItem("solution-ai-mate-theme", theme);
  } catch {
    // Theme persistence is optional.
  }
}

function initTheme() {
  let theme = "light";
  try {
    theme = window.localStorage.getItem("solution-ai-mate-theme") || "light";
  } catch {
    theme = "light";
  }
  setTheme(theme);
}

function formatClock() {
  const now = new Date();
  els.clockTime.textContent = now.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  els.clockDate.textContent = now.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function formatTime(value) {
  if (!value) return "--:--";
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDateLabel(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const suffix = date.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
  if (sameDay(date, today)) return `今天 · ${suffix}`;
  if (sameDay(date, yesterday)) return `昨天 · ${suffix}`;
  return suffix;
}

function toRelativeTime(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  if (hours < 48) return "昨天";
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function scoreFor(item) {
  const text = [item.title, item.summary, item.source, item.category].join(" ");
  const signals = [
    "OpenAI",
    "Anthropic",
    "Google",
    "DeepSeek",
    "Qwen",
    "Claude",
    "Gemini",
    "Sora",
    "Runway",
    "Hugging Face",
  ];
  const signalScore = signals.filter((signal) => text.includes(signal)).length * 5;
  const freshness = item.publishedAt
    ? Math.max(0, 20 - Math.floor((Date.now() - new Date(item.publishedAt).getTime()) / 3600000))
    : 0;
  return Math.min(99, 62 + signalScore + freshness);
}

function sortByTime(items) {
  return [...items].sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
}

function sortByScore(items) {
  return [...items].sort((a, b) => {
    const scoreDelta = scoreFor(b) - scoreFor(a);
    if (scoreDelta) return scoreDelta;
    return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
  });
}

function classifySource(item) {
  const source = item.source || "";
  const url = item.url || "";
  if (/^X[:：]/.test(source) || /(^|\/\/|\.)x\.com\//i.test(url) || /(^|\/\/|\.)twitter\.com\//i.test(url)) {
    return "social";
  }
  if (
    /RSS/i.test(source) ||
    /TechCrunch|The Verge|The Decoder|IT之家|HuggingFace Daily Papers|MarkTechPost|VentureBeat|MIT Technology Review|Wired|ZDNet|InfoQ|机器之心|量子位|36氪/i.test(
      source,
    )
  ) {
    return "media";
  }
  return "firsthand";
}

function filterItems(items) {
  if (state.feed !== "all" || state.source === "all") return items;
  return items.filter((item) => classifySource(item) === state.source);
}

function groupByDay(items) {
  return items.reduce((groups, item) => {
    const key = item.publishedAt ? new Date(item.publishedAt).toLocaleDateString("zh-CN") : "时间未知";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
    return groups;
  }, new Map());
}

function sourceInitial(source = "") {
  const cleaned = source.replace(/^X[:：]/, "").trim();
  return cleaned.slice(0, 1).toUpperCase() || "A";
}

function tagsFor(item) {
  const tags = [categoryFull[item.category] || categoryFull.uncategorized];
  const text = `${item.title || ""} ${item.summary || ""}`;
  const signals = ["OpenAI", "Claude", "Gemini", "DeepSeek", "Qwen", "Sora", "MCP", "Agent", "RAG"];
  signals.forEach((signal) => {
    if (text.includes(signal) && tags.length < 4) tags.push(signal);
  });
  return tags;
}

function focusLine(item) {
  const category = categoryFull[item.category] || categoryFull.uncategorized;
  const source = item.source || "公开信源";
  if (!item.summary) return `来自 ${source} 的 ${category} 动态，建议打开原文查看完整上下文。`;
  return `来自 ${source}，属于 ${category}。适合快速判断这条动态对产品、技术或行业判断的影响。`;
}

function imageFor(item) {
  return item.imageUrl || item.image || item.cover || item.thumbnail || "";
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function applyView() {
  const isScreen = state.view === "screen";
  const isRadar = state.view === "radar";
  const isArena = state.view === "arena";
  const isAbout = state.view === "about";
  document.body.classList.toggle("is-screen", isScreen);
  document.body.classList.toggle("arena-fullscreen", isArena);
  els.page.classList.toggle("screen-mode", isScreen);
  els.page.classList.toggle("radar-mode", isRadar);
  els.page.classList.toggle("arena-mode", isArena);
  els.hero.hidden = isScreen || isArena;
  els.toolbar.hidden = isScreen || isRadar || isArena || isAbout;
  els.summaryStrip.hidden = isScreen || isRadar || isArena || isAbout;
  els.timelineList.hidden = isScreen || isRadar || isArena || isAbout;
  els.screenBoard.hidden = !isScreen;
  els.radarBoard.hidden = !isRadar;
  els.arenaBoard.hidden = !isArena;
  els.aboutBoard.hidden = !isAbout;
  els.sourceTabs.hidden = isScreen || isRadar || isArena || isAbout || state.feed !== "all";

  if (isArena) {
    els.pageEyebrow.textContent = "AI 圆桌";
    els.pageTitle.textContent = "AI圆桌派";
    els.pageCopy.textContent = "保留 AI Arena 的选手卡槽、聊天主区和模板控制台，用在方案洞察场景里。";
    els.topbarTitle.textContent = "AI 圆桌";
  } else if (isAbout) {
    els.pageEyebrow.textContent = "团队介绍";
    els.pageTitle.textContent = "关于我们";
    els.pageCopy.textContent = "解决方案系统仿真团队在 AI 辅助研发和方案情报整理方向的一次实践。";
    els.topbarTitle.textContent = "关于我们";
  } else if (isRadar) {
    els.pageEyebrow.textContent = "论文精读";
    els.pageTitle.textContent = "解决方案AI助手 · 论文精读";
    els.pageCopy.textContent = "聚焦 AI Agent、AI Coding、RAG 与无线通信网络方向，筛选可转化为方案工作的每日精读候选。";
    els.topbarTitle.textContent = "论文精读";
  } else {
    els.pageEyebrow.textContent = state.feed === "all" ? "信息库" : "方案精选";
    els.pageTitle.textContent = state.feed === "all" ? "解决方案AI助手 · 信息库" : "解决方案AI助手 · Solution AI Mate";
    els.pageCopy.textContent =
      state.feed === "all"
        ? "汇总可用于方案洞察、技术分析和内容生成的信息线索，按发布时间持续更新。"
        : "面向解决方案工作的 AI 助手，辅助方案洞察、信息整理、内容生成、技术分析和工作提效。";
    els.topbarTitle.textContent = state.feed === "all" ? "全部 AI 动态" : "精选";
  }

  if (isScreen) {
    els.topbarTitle.textContent = "大屏展示";
  }

  els.navLinks.forEach((link) => link.classList.remove("active"));
  if (isScreen || isRadar || isArena || isAbout) {
    els.viewLinks.forEach((link) => {
      if (link.dataset.viewLink === state.view) link.classList.add("active");
    });
  } else {
    els.feedLinks.forEach((link) => {
      if (link.dataset.feedLink === state.feed) link.classList.add("active");
    });
  }
}

function setConnection(ok, label = "实时同步") {
  els.connectionState.classList.toggle("error", !ok);
  els.connectionState.lastChild.textContent = label;
}

async function fetchHot() {
  if (state.loading) return;
  state.loading = true;
  setConnection(true, "同步中");

  const params = new URLSearchParams({
    mode: state.feed,
    take: state.view === "screen" ? "80" : state.feed === "all" ? "100" : "64",
  });
  if (state.view !== "screen") {
    if (state.category !== "all") params.set("category", state.category);
    if (state.query.trim().length >= 2) params.set("q", state.query.trim());
  }

  try {
    const response = await fetch(`/api/hot?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "数据请求失败");
    state.items = Array.isArray(data.items) ? data.items : [];
    render();
    setConnection(true, "实时同步");
  } catch (error) {
    setConnection(false, "同步失败");
    renderError(error);
  } finally {
    state.loading = false;
  }
}

async function fetchRadar(refresh = false) {
  if (state.radarLoading) return;
  state.radarLoading = true;
  setConnection(true, "扫描中");
  els.radarBoard.innerHTML = `<div class="empty">正在扫描可访问论文源并生成方案精读候选。</div>`;

  try {
    const response = await fetch(`/api/paper-radar${refresh ? "?refresh=1" : ""}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "论文精读候选生成失败");
    state.radar = data;
    renderRadar(data);
    setConnection(true, data.cached ? "候选缓存" : "实时同步");
  } catch (error) {
    setConnection(false, "扫描失败");
    renderRadarError(error);
  } finally {
    state.radarLoading = false;
  }
}

function readArenaDraft() {
  try {
    const raw = window.localStorage.getItem("solution-ai-mate-arena-draft");
    if (!raw) return null;
    window.localStorage.removeItem("solution-ai-mate-arena-draft");
    const draft = JSON.parse(raw);
    if (!draft || typeof draft !== "object") return null;
    return draft;
  } catch {
    return null;
  }
}

async function fetchArenaJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "AI 圆桌请求失败");
  return data;
}

async function initArena() {
  if (state.arena.loading) return;
  state.arena.loading = true;
  state.arena.status = "加载中";
  state.arena.error = "";
  setConnection(true, "加载圆桌");
  renderArena();

  try {
    const [templates, sessions] = await Promise.all([
      fetchArenaJson("/api/arena/templates"),
      fetchArenaJson("/api/arena/sessions"),
    ]);
    state.arena.templates = templates;
    state.arena.sessions = sessions.sessions || [];
    state.arena.draft = readArenaDraft();
    if (!state.arena.selectedRoles.length) {
      state.arena.selectedRoles = templates.defaults?.roles || ["architect", "technologist", "critic"];
    }
    if (!state.arena.selectedServices.length) {
      state.arena.selectedServices = ARENA_SERVICE_IDS.slice(0, 3);
    }
    state.arena.status = "浏览器伴侣";
    setConnection(true, "浏览器伴侣");
  } catch (error) {
    state.arena.error = error instanceof Error ? error.message : String(error);
    setConnection(false, "圆桌失败");
  } finally {
    state.arena.loading = false;
    renderArena();
    refreshArenaCompanion();
  }
}

function selectedArenaRoles(root) {
  const checked = [...root.querySelectorAll("[data-arena-role]:checked")].map((input) => input.value);
  return checked.slice(0, 3);
}

function arenaRoleById(id) {
  return state.arena.templates?.roles?.find((role) => role.id === id);
}

function arenaTemplateById(id) {
  return state.arena.templates?.templates?.find((template) => template.id === id);
}

function arenaTaskById(id) {
  return ARENA_TASKS.find((task) => task.id === id) || ARENA_TASKS[0];
}

function compareVersions(left = "", right = "") {
  const a = String(left).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = String(right).split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff) return diff;
  }
  return 0;
}

function companionNeedsReload() {
  const companion = state.arena.companion;
  return Boolean(companion.connected && companion.version && compareVersions(companion.version, MIN_COMPANION_VERSION) < 0);
}

function arenaServiceById(id) {
  return ARENA_SERVICES.find((service) => service.id === id);
}

function arenaServiceLogo(service, kind = "brands") {
  if (!service?.id) return "";
  const file = service.id === "chatgpt" && kind === "brands" ? "openai.svg" : `${service.id}.${kind === "heroes" ? "webp" : "svg"}`;
  return `/arena-assets/${kind}/${file}`;
}

function arenaRoleHatByIndex(index) {
  const roles = state.arena.templates?.roles || [];
  return roles[index % Math.max(roles.length, 1)] || { id: `role-${index}`, name: "综合裁判", duty: "综合比较各方回答，给出可执行结论。", format: "结论 / 理由 / 风险 / 下一步" };
}

function buildArenaPromptPack(payload) {
  const services = payload.services.map(arenaServiceById).filter(Boolean);
  const roles = services.map((_, index) => arenaRoleById(payload.roles[index]) || arenaRoleHatByIndex(index));
  const template = arenaTemplateById(payload.templateId) || state.arena.templates?.templates?.[0] || {};
  const task = arenaTaskById(payload.taskId);
  const modeName = payload.mode === "free" ? "自由辩论" : "群策群力";
  const modeRule =
    payload.mode === "free"
      ? "请明确指出其他观点可能存在的问题，并给出独立立场。"
      : "请吸收其他角色的亮点，补充遗漏，目标是共同得到更完整的方案。";
  const base = [
    `原始问题：${payload.question}`,
    "",
    `背景材料：${payload.context || "无补充材料"}`,
    "",
    `当前任务：${task.name}。${task.desc}`,
    `任务模板：${template.name || "方案洞察"}。${template.prompt || ""}`,
    `圆桌模式：${modeName}。${modeRule}`,
    "输出要求：中文、结构化、面向解决方案经理，区分事实 / 推断 / 待验证项，不要编造来源。",
  ].join("\n");

  return {
    id: `prompt-${Date.now()}`,
    title: payload.question,
    question: payload.question,
    context: payload.context,
    taskId: payload.taskId,
    mode: payload.mode,
    templateId: payload.templateId,
    roles,
    services,
    sourceItem: payload.sourceItem,
    isPromptPack: true,
    rounds: [
      {
        num: 1,
        type: "prompt",
        mode: payload.mode,
        responses: services.map((service, index) => {
          const role = roles[index] || arenaRoleHatByIndex(index);
          return {
            roleId: role.id,
            roleName: `${service.name} · ${role.name}`,
            service: service.id,
            serviceName: service.name,
            providerStatus: "prompt",
            model: service.name,
            text: [
              `你是 ${service.name}，本轮请戴上「${role.name}」角色帽。${role.duty}`,
              `建议输出格式：${role.format}`,
              "",
              base,
            ].join("\n"),
          };
        }),
        createdAt: new Date().toISOString(),
      },
    ],
    summary: {
      generatedBy: "browser-companion",
      text: [
        "## 使用方式",
        "- 当前 AI 圆桌只通过浏览器伴侣运行。",
        "- 点击底部发送按钮会立即生成 Prompt，并提交给浏览器伴侣。",
        "- 浏览器伴侣会把已选 AI 的 Prompt 发给对应的已登录网页，自动点击发送，并在生成完成后回收回答。",
      ].join("\n"),
    },
    warnings: [{ type: "companion_only", message: "浏览器伴侣模式：已生成可发送到扩展的多 AI Prompt。" }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function refreshArenaCompanion() {
  const client = window.SolutionArenaCompanion;
  if (!client) {
    state.arena.companion = {
      ...state.arena.companion,
      checked: true,
      connected: false,
      status: "未安装",
      version: "",
    };
    renderArena();
    return;
  }

  try {
    const result = await client.ping();
    state.arena.companion = {
      ...state.arena.companion,
      checked: true,
      connected: Boolean(result.connected),
      status: result.connected ? "已连接" : "未连接",
      version: result.version || "",
    };
  } catch {
    state.arena.companion = {
      ...state.arena.companion,
      checked: true,
      connected: false,
      status: "未安装",
      version: "",
    };
  }
  renderArena();
}

async function runArenaCompanion() {
  const active = state.arena.active;
  if (!active?.isPromptPack) {
    state.arena.error = "请先生成多 AI Prompt，再发送给浏览器伴侣。";
    renderArena();
    return;
  }

  if (companionNeedsReload()) {
    state.arena.error = `浏览器伴侣扩展仍是 v${state.arena.companion.version}，请在 chrome://extensions 里重新加载 companion-extension，刷新本页后再发送。`;
    renderArena();
    return;
  }

  const client = window.SolutionArenaCompanion;
  if (!client) {
    state.arena.error = "没有检测到浏览器伴侣扩展，请先加载 companion-extension。";
    renderArena();
    return;
  }

  state.arena.loading = true;
  state.arena.error = "";
  state.arena.status = "发送到浏览器伴侣";
  renderArena();

  try {
    const services = active.services?.map((service) => service.id) || state.arena.selectedServices;
    const task = createArenaCompanionTask(active, { services });
    const result = await client.runTask(task);
    state.arena.companion.lastRun = result;
    state.arena.active = mergeCompanionResultsIntoActive(state.arena.active, result);
    const collected = (result.results || []).filter((item) => item.text).length;
    state.arena.status = `伴侣已回收 ${collected}/${(result.results || []).length || 0}`;
  } catch (error) {
    state.arena.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.arena.loading = false;
    renderArena();
  }
}

function arenaPayloadFromForm(root) {
  const sourceItem = state.arena.draft?.sourceItem || null;
  const chatInput = root.querySelector("#arenaChatInput")?.innerText?.trim() || "";
  const questionInput = root.querySelector("#arenaQuestion")?.value.trim() || "";
  const task = arenaTaskById(state.arena.task);
  return {
    question: chatInput || questionInput,
    context: root.querySelector("#arenaContext")?.value.trim() || state.arena.draft?.context || "",
    templateId: root.querySelector("#arenaTemplate")?.value || task.templateId,
    taskId: task.id,
    mode: state.arena.taskStyle || task.style,
    roles: state.arena.selectedRoles.length
      ? state.arena.selectedRoles
      : state.arena.selectedServices.map((_, index) => arenaRoleHatByIndex(index).id),
    services: state.arena.selectedServices,
    sourceItem,
  };
}

function cacheArenaDraftFromBoard(root) {
  const question = root.querySelector("#arenaChatInput")?.innerText?.trim();
  const context = root.querySelector("#arenaContext")?.value?.trim();
  const templateId = root.querySelector("#arenaTemplate")?.value;
  state.arena.draft = {
    ...(state.arena.draft || {}),
    ...(question ? { question } : {}),
    ...(context ? { context } : {}),
    ...(templateId ? { templateId } : {}),
  };
}

async function runArenaFromForm(root) {
  const payload = arenaPayloadFromForm(root);
  if (!payload.question) {
    state.arena.error = "请先输入要讨论的问题。";
    renderArena();
    return;
  }
  if (payload.services.length < 2) {
    state.arena.error = "请先在右侧添加至少 2 个 AI 选手。";
    renderArena();
    return;
  }

  state.arena.draft = { ...payload };

  state.arena.loading = false;
  state.arena.error = "";
  state.arena.active = buildArenaPromptPack(payload);
  state.arena.status = "浏览器伴侣";
  setConnection(true, "浏览器伴侣");
  renderArena();
  await runArenaCompanion();
}

async function loadArenaSession(id) {
  state.arena.loading = true;
  state.arena.error = "";
  state.arena.status = "读取记录";
  renderArena();
  try {
    const data = await fetchArenaJson(`/api/arena/sessions/${id}`);
    state.arena.active = data.session;
    state.arena.status = "记录已读取";
  } catch (error) {
    state.arena.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.arena.loading = false;
    renderArena();
  }
}

function saveArenaDraft(draft) {
  try {
    window.localStorage.setItem("solution-ai-mate-arena-draft", JSON.stringify(draft));
  } catch {
    // Draft handoff is a convenience; direct navigation still works without it.
  }
}

function sendItemToArena(item) {
  if (!item) return;
  saveArenaDraft({
    question: `请围绕这条动态做方案研判：${item.title || "未命名线索"}`,
    context: [
      `标题：${item.title || "未知"}`,
      `摘要：${item.summary || "暂无摘要"}`,
      `来源：${item.source || "未知信源"}`,
      `分类：${categoryFull[item.category] || item.category || "未分类"}`,
      `发布时间：${formatDateTime(item.publishedAt)}`,
      `原文：${item.url || item.link || ""}`,
    ].join("\n"),
    sourceItem: {
      title: item.title,
      summary: item.summary,
      source: item.source,
      category: item.category,
      publishedAt: item.publishedAt,
      url: item.url || item.link,
    },
  });
  window.location.href = "/arena";
}

function render() {
  if (state.view === "about") {
    applyView();
    return;
  }

  const items = filterItems(sortByTime(state.items));
  const sources = new Set(items.map((item) => item.source).filter(Boolean));
  const topScore = items.reduce((max, item) => Math.max(max, scoreFor(item)), 0);

  els.totalCount.textContent = items.length || "--";
  els.sourceCount.textContent = sources.size || "--";
  els.topScore.textContent = topScore || "--";
  els.lastUpdated.textContent = new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  applyView();
  if (state.view === "screen") {
    renderScreen(items);
  } else {
    renderTimeline(items);
  }
}

function renderRadar(report) {
  const items = asArray(report.items).slice(0, 10);
  const topReads = asArray(report.topReads);
  const saveOnly = asArray(report.saveOnly);
  const filteredReasons = asArray(report.filteredReasons);
  const sourceNotes = asArray(report.sourceNotes);

  const chips = (values) => asArray(values).map((value) => `<span>${escapeHtml(value)}</span>`).join("");
  const listItems = (values) =>
    asArray(values)
      .map((value) => `<li>${escapeHtml(value)}</li>`)
      .join("") || "<li>暂无</li>";

  const paperHtml =
    items
      .map((item, index) => {
        const score = Number(item.relevanceScore || item.relevance_score || 0);
        const worth = Boolean(item.worthDeepRead ?? item.worth_deep_read ?? item.worthRead);
        const link = item.link || item.url || "#";
        const title = item.title || "标题未知";
        const authors = item.authors || "作者未知";
        const institutions = item.institutions || "机构未知或需原文确认";
        const summary = item.summary || item.abstract || "摘要信息不足，需打开原文确认。";
        const contribution = item.contribution || item.possibleContribution || item.possible_contribution || "需原文确认。";
        const reason = item.deepReadReason || item.deep_read_reason || item.reason || "需结合原文判断。";
        const directions = item.transferDirections || item.transfer_directions || [];
        const keywords = item.keywords || [];

        return `
          <article class="radar-paper">
            <header>
              <span class="radar-rank">${String(index + 1).padStart(2, "0")}</span>
              <span class="radar-score">相关性 ${score || "--"}/5</span>
              <span class="radar-worth ${worth ? "yes" : "no"}">${worth ? "值得精读" : "收藏观察"}</span>
            </header>
            <h2><a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a></h2>
            <p class="radar-authors">${escapeHtml(authors)} · ${escapeHtml(institutions)}</p>
            <p class="radar-summary">${escapeHtml(summary)}</p>
            <div class="radar-tags">${chips(keywords)}</div>
            <dl>
              <dt>可能贡献</dt>
              <dd>${escapeHtml(contribution)}</dd>
              <dt>精读理由</dt>
              <dd>${escapeHtml(reason)}</dd>
              <dt>可转化方向</dt>
              <dd class="radar-tags">${chips(directions) || "<span>需确认</span>"}</dd>
            </dl>
            <div class="entry-actions">
              <a class="origin-link" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">查看论文</a>
              <button class="arena-send-button" data-arena-paper="${index}" type="button">三方精读</button>
            </div>
          </article>
        `;
      })
      .join("") || `<div class="empty">今天没有从可访问来源中筛出足够相关的论文。</div>`;

  els.radarBoard.innerHTML = `
    <section class="radar-overview">
      <div>
        <span>候选源</span>
        <strong>${escapeHtml(String(report.candidateCount ?? "--"))}</strong>
      </div>
      <div>
        <span>入选</span>
        <strong>${items.length || "--"}</strong>
      </div>
      <div>
        <span>生成</span>
        <strong>${escapeHtml(formatDateTime(report.generatedAt || report.scannedAt))}</strong>
      </div>
      <button class="radar-refresh" data-radar-refresh type="button">刷新</button>
    </section>

    <section class="radar-notes">
      <div>
        <h2>今日精读</h2>
        <ol>${listItems(topReads)}</ol>
      </div>
      <div>
        <h2>收藏观察</h2>
        <ol>${listItems(saveOnly)}</ol>
      </div>
      <div>
        <h2>过滤原因</h2>
        <ol>${listItems(filteredReasons)}</ol>
      </div>
    </section>

    <section class="radar-sources">
      ${sourceNotes.map((note) => `<span>${escapeHtml(note)}</span>`).join("")}
    </section>

    <section class="radar-list">
      ${paperHtml}
    </section>
  `;
}

function renderRadarError(error) {
  els.radarBoard.innerHTML = `
    <div class="empty">
      论文精读助手暂不可用：${escapeHtml(error instanceof Error ? error.message : String(error))}
    </div>
  `;
}

function formatArenaText(value = "") {
  return escapeHtml(value)
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>")
    .replace(/<\/ul>\s*<ul>/g, "")
    .replace(/\n/g, "<br>");
}

function renderArena() {
  const templates = state.arena.templates?.templates || [];
  const roles = state.arena.templates?.roles || [];
  const defaults = state.arena.templates?.defaults || {};
  const draft = state.arena.draft || {};
  const active = state.arena.active;
  const selectedRoleIds = state.arena.selectedRoles.length ? state.arena.selectedRoles : defaults.roles || ["architect", "technologist", "critic"];
  const selectedRoles = new Set(selectedRoleIds);
  const selectedServiceIds = state.arena.selectedServices.length ? state.arena.selectedServices : ARENA_SERVICE_IDS.slice(0, 3);
  const selectedServices = selectedServiceIds.map(arenaServiceById).filter(Boolean);
  const currentTask = arenaTaskById(state.arena.task);
  const templateId = draft.templateId || currentTask.templateId || defaults.templateId || "solution-insight";
  const question = draft.question || "";
  const context = draft.context || "";
  const mode = state.arena.taskStyle || draft.mode || currentTask.style || defaults.mode || "collab";
  const companion = state.arena.companion;
  const needsReload = companionNeedsReload();

  const htmlFromText = (value = "") => escapeHtml(value).replace(/\n/g, "<br>");
  const roleInitial = (role) => (role?.shortName || role?.name || "AI").slice(0, 2);
  const activeRoles = selectedServices.map((_, index) => arenaRoleById(selectedRoleIds[index]) || arenaRoleHatByIndex(index));
  const roleStatus = (service, role, index) => {
    const response = active?.rounds?.at(-1)?.responses?.find((item) => item.service === service.id || item.roleId === role.id);
    if (response?.providerStatus === "response") return "已回收";
    if (response?.companionStatus === "submitted" || response?.companionStatus === "submitted_unconfirmed") return "已发送";
    if (response?.companionStatus === "failed") return "失败";
    if (response?.providerStatus === "prompt") return "待发送";
    if (response) return "草稿";
    return index === 0 ? "主辩" : index === 1 ? "补充" : "观察";
  };

  const taskMenuHtml = ARENA_TASKS.map(
    (task) => `
      <button class="${task.id === currentTask.id ? "active" : ""}" data-task-pick="${escapeHtml(task.id)}" type="button">
        <strong>${escapeHtml(task.name)}</strong>
        <span>${escapeHtml(task.desc)}</span>
      </button>
    `,
  ).join("");

  const roleOptions = roles
    .map(
      (role) => `
        <button class="arena-role-hat ${selectedRoles.has(role.id) ? "selected" : ""}" data-role-hat="${escapeHtml(role.id)}" type="button">
          <b>${escapeHtml(roleInitial(role))}</b>
          <span>
            <strong>${escapeHtml(role.name)}</strong>
            <small>${escapeHtml(role.duty)}</small>
          </span>
        </button>
      `,
    )
    .join("");

  const templateOptions = templates
    .map((template) => `<option value="${escapeHtml(template.id)}" ${template.id === templateId ? "selected" : ""}>${escapeHtml(template.name)}</option>`)
    .join("");

  const sessionsHtml =
    state.arena.sessions
      .slice(0, 10)
      .map(
        (session) => `
          <button class="arena-session-link" data-arena-session="${escapeHtml(session.id)}" type="button">
            <strong>${escapeHtml(session.title || "未命名圆桌")}</strong>
            <span>${escapeHtml(formatDateTime(session.updatedAt))} · ${session.hasSummary ? "已总结" : "未总结"}</span>
          </button>
        `,
      )
      .join("") || `<div class="arena-muted">暂无历史记录</div>`;

  const selectedServiceCards =
    selectedServices
      .map((service, index) => {
        const role = activeRoles[index] || arenaRoleHatByIndex(index);
        return `
          <article class="arena-joined-service">
            <img class="arena-brand-logo" src="${escapeHtml(arenaServiceLogo(service))}" alt="">
            <div>
              <strong>${escapeHtml(service.name)}</strong>
              <span>${escapeHtml(role.name)} · ${escapeHtml(roleStatus(service, role, index))}</span>
            </div>
            <button data-remove-service="${escapeHtml(service.id)}" type="button" aria-label="移除 ${escapeHtml(service.name)}">×</button>
          </article>
        `;
      })
      .join("") || `<div class="arena-muted">从下方添加 AI 选手</div>`;

  const serviceGridHtml = ARENA_SERVICES.map((service) => {
    const selected = selectedServiceIds.includes(service.id);
    return `
      <button class="arena-service-card ${selected ? "selected" : ""}" data-arena-service="${escapeHtml(service.id)}" type="button">
        <img class="arena-brand-logo" src="${escapeHtml(arenaServiceLogo(service))}" alt="">
        <span>
          <strong>${escapeHtml(service.name)}</strong>
          <small>${escapeHtml(service.desc)}</small>
        </span>
      </button>
    `;
  }).join("");

  const roundsHtml =
    active?.rounds
      ?.map(
        (round) => `
          <section class="arena-round">
            <header>
              <span>Round ${escapeHtml(String(round.num))}</span>
              <strong>${round.type === "prompt" ? "Prompt 预演" : round.type === "initial" ? "初始分析" : "追问辩论"}</strong>
            </header>
            <div class="arena-message-list">
              ${(round.responses || [])
                .map((response, responseIndex) => {
                  const service = arenaServiceById(response.service) || selectedServices[responseIndex] || ARENA_SERVICES[responseIndex % ARENA_SERVICES.length];
                  const metaText =
                    response.providerStatus === "response"
                      ? "网页回答"
                      : response.companionStatus === "submitted" || response.companionStatus === "submitted_unconfirmed"
                        ? "等待回收"
                        : response.companionStatus === "partial"
                          ? "部分回收"
                          : response.companionStatus === "failed"
                            ? "提交失败"
                            : "浏览器伴侣";
                  const copyButton = `<button class="arena-msg-action" data-copy-response="${responseIndex}" data-round="${round.num}" type="button">${
                    response.providerStatus === "response" ? "复制回答" : "复制 Prompt"
                  }</button>`;
                  return `
                    <article class="arena-message ai">
                      <div class="arena-message-avatar logo"><img src="${escapeHtml(arenaServiceLogo(service))}" alt=""></div>
                      <div class="arena-message-body">
                        <div class="arena-message-meta">
                          <strong>${escapeHtml(response.roleName)}</strong>
                          <span>${escapeHtml(metaText)}</span>
                          ${copyButton}
                        </div>
                        <div class="arena-rich-text">${formatArenaText(response.text || "")}</div>
                        <div class="arena-message-tools">
                          <button type="button" disabled>跳原页</button>
                          <button type="button" disabled>重提取</button>
                          <button type="button" disabled>重发</button>
                          <button type="button" disabled>跳过本轮</button>
                        </div>
                      </div>
                    </article>
                  `;
                })
                .join("")}
            </div>
          </section>
        `,
      )
      .join("") || "";

  const summaryHtml = active?.summary
    ? `
      <section class="arena-message ai arena-summary">
        <div class="arena-message-avatar">裁</div>
        <div class="arena-message-body">
        <header>
          <span>使用说明</span>
          <strong>${escapeHtml(active.summary.generatedBy || "summary")}</strong>
        </header>
        <div class="arena-rich-text">${formatArenaText(active.summary.text || "")}</div>
        </div>
      </section>
    `
    : "";

  const warningsHtml =
    active?.warnings?.length
      ? `<div class="arena-warnings">${active.warnings.map((warning) => `<span>${escapeHtml(warning.message || warning.type)}</span>`).join("")}</div>`
      : "";
  const companionLastRunHtml = companion.lastRun?.results?.length
    ? `
      <div class="arena-companion-results">
        ${companion.lastRun.results
          .map(
            (item) => `
              <div class="${item.ok ? "ok" : "fail"}">
                <strong>${escapeHtml(item.serviceName || item.service)} · ${escapeHtml(item.status || (item.ok ? "ok" : "failed"))}</strong>
                ${item.text ? `<small>已回收 ${escapeHtml(String(item.text).length)} 字</small>` : ""}
                ${item.warning ? `<small>${escapeHtml(item.warning)}</small>` : ""}
                ${item.error ? `<small>${escapeHtml(item.error)}</small>` : ""}
              </div>
            `,
          )
          .join("")}
      </div>
    `
    : "";

  const rightTabs = [
    ["members", "成员"],
    ["tasks", "任务"],
    ["stats", "统计"],
    ["templates", "模板"],
    ["settings", "设置"],
  ];
  const rightTabsHtml = rightTabs
    .map(
      ([id, label]) => `<button class="${state.arena.activeTab === id ? "active" : ""}" data-rp-tab data-tab="${id}" type="button">${label}</button>`,
    )
    .join("");

  const taskPanelHtml = `
    <section class="arena-rp-panel" data-tab-panel="tasks">
      <div class="arena-rp-title">当前任务 <span>${escapeHtml(currentTask.name)}</span></div>
      <div class="arena-task-list">${taskMenuHtml}</div>
      <label class="arena-context-box">
        <span>背景材料</span>
        <textarea id="arenaContext" rows="7" placeholder="粘贴资讯摘要、论文摘要、客户背景或会议记录">${escapeHtml(context)}</textarea>
      </label>
    </section>
  `;

  const statsPanelHtml = `
    <section class="arena-rp-panel" data-tab-panel="stats">
      <div class="arena-rp-title">模型实力榜 <span>本轮</span></div>
      <ol class="arena-ranking">
        ${selectedServices
          .map(
            (service, index) => `
              <li>
                <span>${index + 1}</span>
                <img class="arena-brand-logo" src="${escapeHtml(arenaServiceLogo(service))}" alt="">
                <strong>${escapeHtml(service.name)}</strong>
                <small>${active?.rounds?.at(-1)?.responses?.find((item) => item.service === service.id) ? "已生成 Prompt" : "待出场"}</small>
              </li>
            `,
          )
          .join("") || "<li><small>添加 AI 后显示排行</small></li>"}
      </ol>
      <div class="arena-stats-grid">
        <span><b>${selectedServices.length}</b><small>选手</small></span>
        <span><b>${active?.rounds?.at(-1)?.responses?.length || 0}</b><small>Prompt</small></span>
        <span><b>${companion.lastRun?.ok || 0}</b><small>已发送</small></span>
      </div>
    </section>
  `;

  const templatesPanelHtml = `
    <section class="arena-rp-panel" data-tab-panel="templates">
      <div class="arena-rp-title">提示模板 <span>${templates.length || 0}</span></div>
      <select id="arenaTemplate" class="arena-template-select">${templateOptions}</select>
      <div class="arena-template-list">
        ${templates
          .map(
            (template) => `
              <button class="${template.id === templateId ? "active" : ""}" data-template-pick="${escapeHtml(template.id)}" type="button">
                <strong>${escapeHtml(template.name)}</strong>
                <span>${escapeHtml(template.description || template.prompt || "")}</span>
              </button>
            `,
          )
          .join("") || `<div class="arena-muted">模板加载中</div>`}
      </div>
    </section>
  `;

  const settingsPanelHtml = `
    <section class="arena-rp-panel" data-tab-panel="settings">
      <div class="arena-rp-title">浏览器伴侣 <span>${escapeHtml(companion.status)}</span></div>
      ${
        needsReload
          ? `<div class="arena-version-warning">当前扩展是 v${escapeHtml(companion.version)}，页面需要 v${MIN_COMPANION_VERSION}+。请在 chrome://extensions 里重新加载 companion-extension。</div>`
          : ""
      }
      <p class="arena-config-text">${
        companion.connected
          ? `扩展已连接${companion.version ? ` · v${escapeHtml(companion.version)}` : ""}。点击底部发送后会立即提交到浏览器伴侣，自动提交到 AI 网页，并在生成完成后回收回答。`
          : "未检测到伴侣扩展。加载 companion-extension 并刷新页面后，底部发送按钮会直接调用已登录 AI 网页。"
      }</p>
      ${companionLastRunHtml}
    </section>
  `;

  const membersPanelHtml = `
    <section class="arena-rp-panel" data-tab-panel="members">
      <div class="arena-rp-title">已加入 <span>${selectedServices.length}/${ARENA_SERVICES.length}</span></div>
      <div class="arena-joined-list">${selectedServiceCards}</div>
      <div class="arena-rp-title">添加 AI</div>
      <div class="arena-service-grid">${serviceGridHtml}</div>
      <div class="arena-rp-title">角色帽</div>
      <div class="arena-role-grid">${roleOptions}</div>
    </section>
  `;

  const panelByTab = {
    members: membersPanelHtml,
    tasks: taskPanelHtml,
    stats: statsPanelHtml,
    templates: templatesPanelHtml,
    settings: settingsPanelHtml,
  };

  const logItems = [
    `伴侣：${companion.status}`,
    needsReload ? `扩展需重新加载：v${companion.version} -> v${MIN_COMPANION_VERSION}` : "",
    `任务：${currentTask.name}`,
    `选手：${selectedServices.length}/${ARENA_SERVICES.length}`,
    "模式：自动提交",
  ].filter(Boolean);

  els.arenaBoard.innerHTML = `
    <div class="arena-shell">
      <aside class="arena-chat-sidebar">
        <header class="arena-sidebar-header">
          <span>对话目录</span>
          <strong>${state.arena.sessions.length || 0}</strong>
        </header>
        <div class="arena-sidebar-search">搜索历史暂未开放</div>
        <div class="arena-sidebar-list">${sessionsHtml}</div>
      </aside>

      <section class="arena-chat-main">
        <header class="arena-chat-header">
          <div class="arena-chat-title">
            <img class="arena-chat-icon" src="/arena-assets/icon48.png" alt="">
            <div>
              <strong>AI Arena</strong>
              <span>浏览器伴侣模式 · 操控已登录 AI 网页</span>
            </div>
          </div>
          <div class="arena-chat-actions">
            <button type="button" disabled>折叠到顶</button>
            <button type="button" disabled>日简洁</button>
            <button type="button" disabled>Tab</button>
            <button type="button" disabled>并列</button>
            <button type="button" data-clear-arena>清空群聊</button>
          </div>
        </header>

        <div class="arena-badge-line">
          <span>${escapeHtml(currentTask.name)}</span>
          <strong>${mode === "free" ? "自由辩论" : "群策群力"}</strong>
          <em>${escapeHtml(state.arena.status || "Arena")}</em>
        </div>

        <main class="arena-chat-messages">
          ${state.arena.error ? `<div class="arena-error">${escapeHtml(state.arena.error)}</div>` : ""}
          ${
            active
              ? `
                <article class="arena-message user">
                  <div class="arena-message-avatar">我</div>
                  <div class="arena-message-body">
                    <div class="arena-message-meta">
                      <strong>${escapeHtml(active.title || "未命名圆桌")}</strong>
                      ${
                        active.id && !active.isPromptPack
                          ? `<a class="arena-msg-action" href="/api/arena/sessions/${escapeHtml(active.id)}/export" target="_blank" rel="noreferrer">导出 Markdown</a>`
                          : ""
                      }
                    </div>
                    <div class="arena-rich-text">${formatArenaText(active.context ? `${active.question}\n\n${active.context}` : active.question || "")}</div>
                  </div>
                </article>
                ${warningsHtml}
                ${roundsHtml}
                ${summaryHtml}
              `
              : `
                <section class="arena-empty-state">
                  <img class="arena-poster-img" src="/arena-assets/poster-ai-team.webp" alt="">
                  <h2>让 AI 同台辩论，逼近可执行结论</h2>
                  <div class="arena-empty-chips">
                    ${ARENA_TASKS.map((task) => `<span>${escapeHtml(task.name)}</span>`).join("")}
                    <span>@ 单发</span>
                    <span>浏览器伴侣</span>
                  </div>
                </section>
              `
          }
        </main>

        <div class="arena-roster">
          <span>下轮发言</span>
          ${selectedServices
            .map((service, index) => {
              const role = activeRoles[index] || arenaRoleHatByIndex(index);
              return `
                <div class="arena-roster-pill">
                  <img class="arena-brand-logo" src="${escapeHtml(arenaServiceLogo(service))}" alt="">
                  <span>${escapeHtml(service.name)} · ${escapeHtml(roleInitial(role))}</span>
                </div>
              `;
            })
            .join("")}
          <small>${selectedServices.length ? "浏览器伴侣待命" : "请选择 AI 选手"}</small>
        </div>

        <footer class="arena-input-bar">
          <div class="arena-task-picker">
            <button data-task-menu-toggle type="button">
              <strong>${escapeHtml(currentTask.name)}</strong>
              <span>任务</span>
            </button>
            ${state.arena.taskMenuOpen ? `<div class="arena-task-menu">${taskMenuHtml}</div>` : ""}
          </div>
          <div id="arenaChatInput" class="arena-chat-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="输入问题，让多个已登录 AI 同台回答...">${htmlFromText(question)}</div>
          <button class="arena-single-send" type="button" disabled>@ 单发</button>
          <button class="arena-send-arrow" data-arena-send type="button" ${state.arena.loading ? "disabled" : ""} aria-label="发送到浏览器伴侣">
            ${state.arena.loading ? "..." : "➤"}
          </button>
        </footer>
      </section>

      <aside class="arena-rightpanel">
        <div class="arena-rp-tabs">${rightTabsHtml}</div>
        ${panelByTab[state.arena.activeTab] || membersPanelHtml}
        <section class="arena-log-box">
          <div class="arena-rp-title">状态日志 <span>${escapeHtml(formatTime(new Date()))}</span></div>
          ${logItems.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
        </section>
      </aside>
    </div>
  `;
}

function renderTimeline(items) {
  if (!items.length) {
    els.timelineList.innerHTML = `<div class="empty">没有匹配到当前筛选条件下的方案洞察。</div>`;
    return;
  }

  const groups = groupByDay(items);
  const html = [...groups.values()]
    .map((groupItems) => {
      const first = groupItems[0];
      const entries = groupItems
        .map((item) => {
          const score = scoreFor(item);
          const imageUrl = imageFor(item);
          const media = imageUrl
            ? `
                <a class="entry-media" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer" aria-label="查看原文图片">
                  <img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
                </a>
              `
            : "";
          const tags = tagsFor(item)
            .map((tag) => `<span>${escapeHtml(tag)}</span>`)
            .join("");

          return `
            <article class="timeline-entry">
              <div class="entry-time">
                <strong>${escapeHtml(formatTime(item.publishedAt))}</strong>
                <span>${escapeHtml(toRelativeTime(item.publishedAt))}</span>
              </div>
              <div class="entry-node" aria-hidden="true"></div>
              <div class="entry-card${imageUrl ? " has-media" : ""}">
                <div class="entry-content">
                  <div class="entry-meta">
                    <span class="source-avatar">${escapeHtml(sourceInitial(item.source))}</span>
                    <span class="source-name">${escapeHtml(item.source || "未知信源")}</span>
                    <span class="score">${state.feed === "all" ? "热度" : "精选"} ${score}</span>
                  </div>
                  <h2><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a></h2>
                  <p class="summary">${escapeHtml(item.summary || "这条新闻暂无摘要，请打开原文查看详情。")}</p>
                  <div class="tag-row">${tags}</div>
                  <div class="focus">
                    <b>看点</b>
                    <span>${escapeHtml(focusLine(item))}</span>
                  </div>
                  <div class="entry-actions">
                    <a class="origin-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">查看原文</a>
                    <button class="arena-send-button" data-arena-url="${escapeHtml(item.url || "")}" type="button">送入圆桌</button>
                  </div>
                </div>
                ${media}
              </div>
            </article>
          `;
        })
        .join("");

      return `
        <section class="day-group">
          <div class="day-label">${escapeHtml(formatDateLabel(first.publishedAt))}</div>
          ${entries}
        </section>
      `;
    })
    .join("");

  els.timelineList.innerHTML = html;
  els.timelineList.querySelectorAll(".entry-media img").forEach((img) => {
    img.addEventListener(
      "error",
      () => {
        const media = img.closest(".entry-media");
        const card = img.closest(".entry-card");
        media?.remove();
        card?.classList.remove("has-media");
      },
      { once: true },
    );
  });
}

function screenIcon(name) {
  const paths = {
    total: '<path class="screen-glyph-line" d="M6.5 17.5h11M7 12.5h10M8 7.5h8"></path><circle class="screen-glyph-fill" cx="6" cy="7.5" r="1.4"></circle><circle class="screen-glyph-fill" cx="5" cy="12.5" r="1.4"></circle><circle class="screen-glyph-fill" cx="6" cy="17.5" r="1.4"></circle>',
    coverage: '<path class="screen-glyph-line" d="M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM4.8 12h14.4M12 4.5c2 2.1 3 4.6 3 7.5s-1 5.4-3 7.5M12 4.5c-2 2.1-3 4.6-3 7.5s1 5.4 3 7.5"></path>',
    heat: '<path class="screen-glyph-fill" d="M12.2 20c-3.1 0-5.4-2.2-5.4-5.2 0-2.2 1.2-3.7 2.5-5.2 1.1-1.2 2.2-2.5 2.2-4.6 2.6 1.7 4.7 4.1 4.7 7.2.7-.7 1.1-1.7 1.2-2.8 1.1 1.4 1.8 3 1.8 4.9 0 3.4-2.7 5.7-7 5.7z"></path><path class="screen-glyph-line screen-glyph-light" d="M11.9 17.5c-1.2-.2-2-1.1-2-2.3 0-1 .6-1.8 1.3-2.5.6-.7 1.2-1.4 1.2-2.4 1.4 1 2.5 2.3 2.5 4 0 1.9-1.2 3-3 3.2z"></path>',
    fresh: '<path class="screen-glyph-line" d="M6 12a6 6 0 0 1 10.3-4.2L18 9.5M18 6.2v3.3h-3.3M18 12a6 6 0 0 1-10.3 4.2L6 14.5M6 17.8v-3.3h3.3"></path><circle class="screen-glyph-dot" cx="12" cy="12" r="1.5"></circle>',
    spark: '<path class="screen-glyph-fill" d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"></path><path class="screen-glyph-line" d="M18 3v3M18 14v4M3 18h4M4 5l2 2"></path>',
    source: '<path class="screen-glyph-line" d="M6 7h12M6 12h8M6 17h5"></path><path class="screen-glyph-fill" d="m16.4 15.2 1.1 1.2 2.6-3 .9 1-3.5 4-2-2.2z"></path>',
    score: '<path class="screen-glyph-fill" d="m12 4 2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2L7.8 17l.8-4.7L5.2 9l4.7-.7L12 4z"></path>',
    pulse: '<path class="screen-glyph-line" d="M4 13h3.2l1.7-5 3.3 9 2-6H20"></path><circle class="screen-glyph-dot" cx="18.8" cy="11" r="1.3"></circle>',
    clock: '<circle class="screen-glyph-line" cx="12" cy="12" r="6.8"></circle><path class="screen-glyph-line" d="M12 8.2v4l2.8 1.7"></path><path class="screen-glyph-fill" d="M12 2.8 14 5h-4z"></path>',
    layers: '<path class="screen-glyph-fill" d="m12 4 7 3.8-7 3.8-7-3.8z"></path><path class="screen-glyph-line" d="m5 12 7 3.8 7-3.8M5 16l7 3.8 7-3.8"></path>',
    bolt: '<path class="screen-glyph-fill" d="M13.3 3.5 5.8 13h5.1l-.8 7.5 7.7-10.2h-5.2z"></path>',
    grid: '<path class="screen-glyph-fill" d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z"></path>',
    model: '<path class="screen-glyph-fill" d="M12 4 5.5 7.6V16l6.5 3.7 6.5-3.7V7.6z"></path><path class="screen-glyph-line screen-glyph-light" d="M12 11.6 5.5 7.6M12 11.6v8M12 11.6l6.5-4"></path>',
    product: '<path class="screen-glyph-line" d="M6.2 8.4h11.6l1 3.2H5.2zM6 11.6v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6"></path><path class="screen-glyph-fill" d="M9 5h6l1.1 3.4H7.9z"></path>',
    industry: '<path class="screen-glyph-fill" d="M5 20V8l5-2.5V20zM12 20V7.5l6 3V20z"></path><path class="screen-glyph-line screen-glyph-light" d="M7.6 12h1M7.6 16h1M14.8 14h1M14.8 17h1"></path>',
    paper: '<path class="screen-glyph-line" d="M7 4h7l4 4v12H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM14 4v4h4M8 13h8M8 17h6"></path>',
    tip: '<path class="screen-glyph-fill" d="M12 4a5.8 5.8 0 0 0-3.4 10.5c.7.5.9 1 .9 1.8h5c0-.8.2-1.3.9-1.8A5.8 5.8 0 0 0 12 4z"></path><path class="screen-glyph-line" d="M9.5 19h5M10.5 21h3"></path>',
  };
  return `
    <svg class="screen-icon screen-icon-${name}" viewBox="0 0 24 24" aria-hidden="true">
      <rect class="screen-glyph-bg" x="2.4" y="2.4" width="19.2" height="19.2" rx="6"></rect>
      ${paths[name] || paths.spark}
    </svg>
  `;
}

function renderTrendChart(items) {
  const chartItems = items
    .slice(0, 12)
    .filter((item) => Number.isFinite(new Date(item.publishedAt || 0).getTime()))
    .reverse();
  const scores = chartItems.map(scoreFor);
  const width = 560;
  const height = 168;
  const left = 24;
  const right = 18;
  const top = 16;
  const bottom = 24;

  if (!scores.length) {
    return `<div class="screen-chart-empty">暂无趋势数据</div>`;
  }

  const min = Math.max(0, Math.min(...scores) - 4);
  const max = Math.min(100, Math.max(...scores) + 4);
  const range = Math.max(1, max - min);
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const points = scores.map((score, index) => {
    const x = left + (chartItems.length === 1 ? plotWidth : (index / (chartItems.length - 1)) * plotWidth);
    const y = top + (1 - (score - min) / range) * plotHeight;
    return { x, y, score, item: chartItems[index] };
  });
  const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = [
    `${points[0].x.toFixed(1)},${height - bottom}`,
    ...points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`),
    `${points[points.length - 1].x.toFixed(1)},${height - bottom}`,
  ].join(" ");
  const grid = [0, 0.5, 1]
    .map((ratio) => {
      const y = top + ratio * plotHeight;
      return `<line x1="${left}" y1="${y.toFixed(1)}" x2="${width - right}" y2="${y.toFixed(1)}"></line>`;
    })
    .join("");
  const dots = points
    .map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.2"></circle>`)
    .join("");
  const firstLabel = escapeHtml(formatTime(chartItems[0]?.publishedAt));
  const lastLabel = escapeHtml(formatTime(chartItems[chartItems.length - 1]?.publishedAt));

  return `
    <svg class="screen-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="热度趋势折线图">
      <defs>
        <linearGradient id="screenTrendFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#2563eb" stop-opacity="0.24"></stop>
          <stop offset="100%" stop-color="#0ea5e9" stop-opacity="0.02"></stop>
        </linearGradient>
      </defs>
      <g class="screen-chart-grid">${grid}</g>
      <polygon class="screen-trend-area" points="${area}"></polygon>
      <polyline class="screen-trend-line" points="${line}"></polyline>
      <g class="screen-trend-dots">${dots}</g>
      <text x="${left}" y="${height - 4}">${firstLabel}</text>
      <text x="${width - right}" y="${height - 4}" text-anchor="end">${lastLabel}</text>
      <text x="${width - right}" y="14" text-anchor="end">MAX ${Math.max(...scores)}</text>
    </svg>
  `;
}

function renderDistributionDonut(categoryKeys, counts) {
  const palette = ["#2563eb", "#0ea5e9", "#14b8a6", "#f59e0b", "#8b5cf6"];
  const total = categoryKeys.reduce((sum, key) => sum + (counts[key] || 0), 0);
  let start = 0;
  const stops = categoryKeys.map((key, index) => {
    const value = counts[key] || 0;
    const size = total ? (value / total) * 360 : 0;
    const end = start + size;
    const part = `${palette[index]} ${start.toFixed(1)}deg ${end.toFixed(1)}deg`;
    start = end;
    return part;
  });
  const background = total ? `conic-gradient(${stops.join(", ")})` : "var(--panel-soft)";
  const legend = categoryKeys
    .map((key, index) => {
      const value = counts[key] || 0;
      const percent = total ? Math.round((value / total) * 100) : 0;
      return `
        <li>
          <i style="background:${palette[index]}"></i>
          <span>${escapeHtml(categories[key])}</span>
          <b>${value}</b>
          <small>${percent}%</small>
        </li>
      `;
    })
    .join("");

  return `
    <div class="screen-donut-wrap">
      <div class="screen-donut" style="background:${background}">
        <div>
          <strong>${total}</strong>
          <span>条目</span>
        </div>
      </div>
      <ul class="screen-chart-legend">${legend}</ul>
    </div>
  `;
}

function renderSourceBars(items) {
  const sourceCounts = items.reduce((acc, item) => {
    const key = item.source || "未知信源";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const rows = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const max = Math.max(1, ...rows.map((row) => row[1]));

  return rows
    .map(([source, count]) => {
      const width = Math.max(8, (count / max) * 100);
      return `
        <li class="screen-chart-bar">
          <div>
            <span>${escapeHtml(source)}</span>
            <b>${count}</b>
          </div>
          <i><em style="width:${width}%"></em></i>
        </li>
      `;
    })
    .join("");
}

function renderScoreBars(items) {
  return sortByScore(items)
    .slice(0, 5)
    .map((item, index) => {
      const score = scoreFor(item);
      return `
        <li class="screen-chart-bar hot">
          <div>
            <span>${String(index + 1).padStart(2, "0")} ${escapeHtml(item.title)}</span>
            <b>${score}</b>
          </div>
          <i><em style="width:${score}%"></em></i>
        </li>
      `;
    })
    .join("");
}

function renderScreen(items) {
  if (!items.length) {
    els.screenBoard.innerHTML = `<div class="empty">暂无可展示的方案洞察。</div>`;
    return;
  }

  const ranked = sortByScore(items);
  const lead = ranked[0];
  const latest = items.slice(0, 24);
  const categoryKeys = ["ai-models", "ai-products", "industry", "paper", "tip"];
  const counts = items.reduce((acc, item) => {
    const key = item.category || "uncategorized";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const sources = new Set(items.map((item) => item.source).filter(Boolean));
  const recentCount = items.filter((item) => {
    const time = new Date(item.publishedAt || 0).getTime();
    return Number.isFinite(time) && Date.now() - time <= 3 * 60 * 60 * 1000;
  }).length;
  const metricHtml = [
    ["total", "总线索", `${items.length}`, "实时聚合"],
    ["coverage", "信源覆盖", `${sources.size}`, "跨平台扫描"],
    ["heat", "最高热度", `${scoreFor(lead)}`, "优先级"],
    ["fresh", "3H 新增", `${recentCount}`, "新鲜信号"],
  ]
    .map(
      ([icon, label, value, hint]) => `
        <article class="screen-metric screen-metric-${icon}">
          <span class="screen-icon-box">${screenIcon(icon)}</span>
          <div>
            <span class="screen-metric-label">${label}</span>
            <strong>${value}</strong>
            <small>${hint}</small>
          </div>
        </article>
      `,
    )
    .join("");

  const latestHtml = latest
    .map(
      (item, index) => `
        <li>
          <a class="screen-list-link" href="${escapeHtml(item.url || "#")}" target="_blank" rel="noreferrer">
            <span class="rank">${screenIcon("clock")}${String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <small>${escapeHtml(formatTime(item.publishedAt))} · ${escapeHtml(categories[item.category] || "其他")} · ${escapeHtml(item.source || "未知信源")}</small>
            </div>
            <em>${scoreFor(item)}</em>
          </a>
        </li>
      `,
    )
    .join("");

  els.screenBoard.innerHTML = `
    <div class="screen-shell">
      <section class="screen-metrics" aria-label="大屏态势总览">
        ${metricHtml}
      </section>

      <section class="screen-hero">
        <div class="screen-kicker">
          <span>${screenIcon("spark")} TOP STORY</span>
          <strong>精选 ${scoreFor(lead)}</strong>
        </div>
        <h2>${escapeHtml(lead.title)}</h2>
        <p>${escapeHtml(lead.summary || "这条新闻暂无摘要，请打开原文查看详情。")}</p>
        <div class="screen-tags">
          ${tagsFor(lead)
            .map((tag) => `<span>${escapeHtml(tag)}</span>`)
            .join("")}
          <span>${escapeHtml(toRelativeTime(lead.publishedAt))}</span>
          <span>${escapeHtml(lead.source || "未知信源")}</span>
        </div>
      </section>

      <section class="screen-list">
        <header>
          <span>${screenIcon("clock")} 最新动态</span>
          <strong>${items.length} 条</strong>
        </header>
        <ol>${latestHtml}</ol>
      </section>

      <section class="screen-charts" aria-label="大屏图表分析">
        <article class="screen-chart screen-chart-trend">
          <header>
            <span>${screenIcon("pulse")} 热度趋势</span>
            <strong>最近 12 条</strong>
          </header>
          ${renderTrendChart(items)}
        </article>

        <article class="screen-chart">
          <header>
            <span>${screenIcon("grid")} 类别分布</span>
            <strong>${categoryKeys.length} 类</strong>
          </header>
          ${renderDistributionDonut(categoryKeys, counts)}
        </article>

        <article class="screen-chart">
          <header>
            <span>${screenIcon("source")} 信源排行</span>
            <strong>TOP 5</strong>
          </header>
          <ul class="screen-chart-bars">${renderSourceBars(items)}</ul>
        </article>

        <article class="screen-chart">
          <header>
            <span>${screenIcon("bolt")} 热度排行</span>
            <strong>TOP 5</strong>
          </header>
          <ul class="screen-chart-bars">${renderScoreBars(items)}</ul>
        </article>
      </section>
    </div>
  `;
}

function renderError(error) {
  const target = state.view === "screen" ? els.screenBoard : els.timelineList;
  target.innerHTML = `
    <div class="empty">
      数据同步失败：${escapeHtml(error instanceof Error ? error.message : String(error))}
    </div>
  `;
}

let searchTimer;
els.categoryTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");
  if (!button) return;
  state.category = button.dataset.category;
  els.categoryTabs.querySelectorAll("button").forEach((tab) => tab.classList.remove("active"));
  button.classList.add("active");
  fetchHot();
});

els.sourceTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-source]");
  if (!button) return;
  state.source = button.dataset.source;
  els.sourceTabs.querySelectorAll("button").forEach((tab) => tab.classList.remove("active"));
  button.classList.add("active");
  render();
});

els.searchInput.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    state.query = els.searchInput.value;
    fetchHot();
  }, 360);
});

els.refreshButton.addEventListener("click", fetchHot);
els.themeToggle?.addEventListener("click", () => {
  setTheme(document.body.classList.contains("theme-dark") ? "light" : "dark");
});
els.timelineList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-arena-url]");
  if (!button) return;
  const url = button.dataset.arenaUrl;
  const item = state.items.find((entry) => (entry.url || "") === url);
  sendItemToArena(item);
});
els.radarBoard.addEventListener("click", (event) => {
  const paperButton = event.target.closest("[data-arena-paper]");
  if (paperButton) {
    const item = state.radar?.items?.[Number(paperButton.dataset.arenaPaper)];
    sendItemToArena({
      title: item?.title,
      summary: item?.summary || item?.abstract || item?.contribution,
      source: item?.source || "论文精读",
      category: "paper",
      publishedAt: item?.publishedAt || item?.generatedAt,
      url: item?.link || item?.url,
    });
    return;
  }
  const button = event.target.closest("[data-radar-refresh]");
  if (!button) return;
  fetchRadar(true);
});
els.arenaBoard.addEventListener("change", (event) => {
  const roleInput = event.target.closest("[data-arena-role]");
  if (!roleInput) return;
  const checked = selectedArenaRoles(els.arenaBoard);
  if (els.arenaBoard.querySelectorAll("[data-arena-role]:checked").length > 3) {
    roleInput.checked = false;
    state.arena.error = "最多选择 3 个角色。";
  } else {
    state.arena.error = "";
  }
  state.arena.selectedRoles = selectedArenaRoles(els.arenaBoard);
  renderArena();
});
els.arenaBoard.addEventListener("click", (event) => {
  const root = els.arenaBoard;
  const tabButton = event.target.closest("[data-rp-tab]");
  if (tabButton) {
    cacheArenaDraftFromBoard(root);
    state.arena.activeTab = tabButton.dataset.tab || "members";
    state.arena.taskMenuOpen = false;
    renderArena();
    return;
  }
  const taskToggle = event.target.closest("[data-task-menu-toggle]");
  if (taskToggle) {
    cacheArenaDraftFromBoard(root);
    state.arena.taskMenuOpen = !state.arena.taskMenuOpen;
    renderArena();
    return;
  }
  const taskButton = event.target.closest("[data-task-pick]");
  if (taskButton) {
    cacheArenaDraftFromBoard(root);
    const task = arenaTaskById(taskButton.dataset.taskPick);
    state.arena.task = task.id;
    state.arena.taskStyle = task.style;
    state.arena.taskMenuOpen = false;
    state.arena.error = "";
    renderArena();
    return;
  }
  const templateButton = event.target.closest("[data-template-pick]");
  if (templateButton) {
    cacheArenaDraftFromBoard(root);
    state.arena.draft = {
      ...(state.arena.draft || {}),
      templateId: templateButton.dataset.templatePick,
    };
    renderArena();
    return;
  }
  const serviceButton = event.target.closest("[data-arena-service]");
  if (serviceButton) {
    cacheArenaDraftFromBoard(root);
    const serviceId = serviceButton.dataset.arenaService;
    if (state.arena.selectedServices.includes(serviceId)) {
      state.arena.selectedServices = state.arena.selectedServices.filter((id) => id !== serviceId);
    } else {
      state.arena.selectedServices = [...state.arena.selectedServices, serviceId].filter((id) => ARENA_SERVICE_IDS.includes(id));
    }
    state.arena.error = "";
    renderArena();
    return;
  }
  const removeServiceButton = event.target.closest("[data-remove-service]");
  if (removeServiceButton) {
    cacheArenaDraftFromBoard(root);
    state.arena.selectedServices = state.arena.selectedServices.filter((id) => id !== removeServiceButton.dataset.removeService);
    state.arena.error = "";
    renderArena();
    return;
  }
  const roleHatButton = event.target.closest("[data-role-hat]");
  if (roleHatButton) {
    cacheArenaDraftFromBoard(root);
    const roleId = roleHatButton.dataset.roleHat;
    const next = state.arena.selectedRoles.filter((id) => id !== roleId);
    if (next.length === state.arena.selectedRoles.length) next.push(roleId);
    state.arena.selectedRoles = next.length ? next : [roleId];
    renderArena();
    return;
  }
  const copyButton = event.target.closest("[data-copy-response]");
  if (copyButton) {
    const roundNum = Number(copyButton.dataset.round);
    const responseIndex = Number(copyButton.dataset.copyResponse);
    const response = state.arena.active?.rounds?.find((round) => round.num === roundNum)?.responses?.[responseIndex];
    if (response?.text) {
      navigator.clipboard?.writeText(response.text);
      copyButton.textContent = "已复制";
    }
    return;
  }
  const runButton = event.target.closest("[data-arena-run], [data-arena-send]");
  if (runButton) {
    runArenaFromForm(root);
    return;
  }
  const clearButton = event.target.closest("[data-clear-arena]");
  if (clearButton) {
    state.arena.active = null;
    state.arena.draft = null;
    state.arena.error = "";
    state.arena.taskMenuOpen = false;
    renderArena();
    return;
  }
  const sessionButton = event.target.closest("[data-arena-session]");
  if (sessionButton) {
    cacheArenaDraftFromBoard(root);
    loadArenaSession(sessionButton.dataset.arenaSession);
  }
});

initTheme();
applyView();
formatClock();
setInterval(formatClock, 1000);
if (state.view === "arena") {
  initArena();
} else if (state.view === "radar") {
  fetchRadar();
} else if (state.view === "about") {
  render();
} else {
  fetchHot();
  setInterval(fetchHot, state.refreshMs);
}
