const queryParams = new URLSearchParams(window.location.search);
const routePath = window.location.pathname.replace(/\/+$/, "") || "/";
const initialView =
  queryParams.get("view") === "screen"
    ? "screen"
    : routePath === "/communication"
      ? "radar"
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
  const isAbout = state.view === "about";
  document.body.classList.toggle("is-screen", isScreen);
  els.page.classList.toggle("screen-mode", isScreen);
  els.page.classList.toggle("radar-mode", isRadar);
  els.hero.hidden = isScreen;
  els.toolbar.hidden = isScreen || isRadar || isAbout;
  els.summaryStrip.hidden = isScreen || isRadar || isAbout;
  els.timelineList.hidden = isScreen || isRadar || isAbout;
  els.screenBoard.hidden = !isScreen;
  els.radarBoard.hidden = !isRadar;
  els.aboutBoard.hidden = !isAbout;
  els.sourceTabs.hidden = isScreen || isRadar || isAbout || state.feed !== "all";

  if (isAbout) {
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
  if (isScreen || isRadar || isAbout) {
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
            <a class="origin-link" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">查看论文</a>
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
                  <a class="origin-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">查看原文</a>
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
els.radarBoard.addEventListener("click", (event) => {
  const button = event.target.closest("[data-radar-refresh]");
  if (!button) return;
  fetchRadar(true);
});

initTheme();
applyView();
formatClock();
setInterval(formatClock, 1000);
if (state.view === "radar") {
  fetchRadar();
} else if (state.view === "about") {
  render();
} else {
  fetchHot();
  setInterval(fetchHot, state.refreshMs);
}
