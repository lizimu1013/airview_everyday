const queryParams = new URLSearchParams(window.location.search);
const routePath = window.location.pathname.replace(/\/+$/, "") || "/";
const initialView = queryParams.get("view") === "screen" ? "screen" : "timeline";

const state = {
  view: initialView,
  feed: initialView === "screen" ? "selected" : routePath === "/all" ? "all" : "selected",
  source: "all",
  category: "all",
  query: "",
  items: [],
  loading: false,
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

const els = {
  page: document.querySelector(".page"),
  hero: document.querySelector(".hero"),
  toolbar: document.querySelector(".toolbar"),
  summaryStrip: document.querySelector(".summary-strip"),
  pageEyebrow: document.querySelector("#pageEyebrow"),
  pageTitle: document.querySelector("#pageTitle"),
  pageCopy: document.querySelector("#pageCopy"),
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
  viewLinks: document.querySelectorAll("[data-view-link]"),
  feedLinks: document.querySelectorAll("[data-feed-link]"),
};

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

function applyView() {
  const isScreen = state.view === "screen";
  document.body.classList.toggle("is-screen", isScreen);
  els.page.classList.toggle("screen-mode", isScreen);
  els.hero.hidden = isScreen;
  els.toolbar.hidden = isScreen;
  els.summaryStrip.hidden = isScreen;
  els.timelineList.hidden = isScreen;
  els.screenBoard.hidden = !isScreen;
  els.sourceTabs.hidden = isScreen || state.feed !== "all";

  els.pageEyebrow.textContent = state.feed === "all" ? "全部动态" : "精选";
  els.pageTitle.textContent = state.feed === "all" ? "AI 全量动态" : "AI 热点时间轴";
  els.pageCopy.textContent =
    state.feed === "all" ? "AI 相关资讯全量信息流，按发布时间持续更新。" : "按发布时间滚动展示当前最值得关注的 AI 动态。";

  els.navLinks.forEach((link) => link.classList.remove("active"));
  if (isScreen) {
    els.viewLinks.forEach((link) => {
      if (link.dataset.viewLink === "screen") link.classList.add("active");
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

function render() {
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

function renderTimeline(items) {
  if (!items.length) {
    els.timelineList.innerHTML = `<div class="empty">没有匹配到当前筛选条件下的 AI 热点。</div>`;
    return;
  }

  const groups = groupByDay(items);
  const html = [...groups.values()]
    .map((groupItems) => {
      const first = groupItems[0];
      const entries = groupItems
        .map((item) => {
          const score = scoreFor(item);
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
              <div class="entry-card">
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
                <a class="origin-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">查看原文</a>
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
}

function renderScreen(items) {
  if (!items.length) {
    els.screenBoard.innerHTML = `<div class="empty">暂无可展示的 AI 热点。</div>`;
    return;
  }

  const ranked = sortByScore(items);
  const lead = ranked[0];
  const latest = items.slice(0, 12);
  const categoryKeys = ["ai-models", "ai-products", "industry", "paper", "tip"];
  const counts = items.reduce((acc, item) => {
    const key = item.category || "uncategorized";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const maxCount = Math.max(1, ...categoryKeys.map((key) => counts[key] || 0));

  const latestHtml = latest
    .map(
      (item, index) => `
        <li>
          <span class="rank">${String(index + 1).padStart(2, "0")}</span>
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(formatTime(item.publishedAt))} · ${escapeHtml(categories[item.category] || "其他")} · ${escapeHtml(item.source || "未知信源")}</small>
          </div>
          <em>${scoreFor(item)}</em>
        </li>
      `,
    )
    .join("");

  const categoryHtml = categoryKeys
    .map((key) => {
      const categoryItems = items.filter((item) => item.category === key).slice(0, 3);
      const list = categoryItems
        .map((item) => `<li>${escapeHtml(item.title)}</li>`)
        .join("");
      const width = Math.max(6, ((counts[key] || 0) / maxCount) * 100);
      return `
        <article class="screen-category">
          <header>
            <span>${escapeHtml(categories[key])}</span>
            <strong>${counts[key] || 0}</strong>
          </header>
          <div class="screen-bar"><span style="width:${width}%"></span></div>
          <ol>${list || "<li>暂无条目</li>"}</ol>
        </article>
      `;
    })
    .join("");

  const signalHtml = ranked
    .slice(1, 7)
    .map(
      (item) => `
        <article>
          <b>${scoreFor(item)}</b>
          <span>${escapeHtml(item.title)}</span>
        </article>
      `,
    )
    .join("");

  els.screenBoard.innerHTML = `
    <div class="screen-shell">
      <section class="screen-hero">
        <div class="screen-kicker">
          <span>TOP STORY</span>
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
          <span>最新动态</span>
          <strong>${items.length} 条</strong>
        </header>
        <ol>${latestHtml}</ol>
      </section>

      <section class="screen-signals">
        <header>
          <span>高分信号</span>
          <strong>TOP 6</strong>
        </header>
        <div>${signalHtml}</div>
      </section>

      <section class="screen-categories">
        ${categoryHtml}
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

applyView();
formatClock();
setInterval(formatClock, 1000);
fetchHot();
setInterval(fetchHot, state.refreshMs);
