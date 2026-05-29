const queryParams = new URLSearchParams(window.location.search);
const routePath = window.location.pathname.replace(/\/+$/, "") || "/";
const initialView = queryParams.get("view") === "screen" ? "screen" : routePath === "/communication" ? "radar" : "timeline";

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
  document.body.classList.toggle("is-screen", isScreen);
  els.page.classList.toggle("screen-mode", isScreen);
  els.page.classList.toggle("radar-mode", isRadar);
  els.hero.hidden = isScreen;
  els.toolbar.hidden = isScreen || isRadar;
  els.summaryStrip.hidden = isScreen || isRadar;
  els.timelineList.hidden = isScreen || isRadar;
  els.screenBoard.hidden = !isScreen;
  els.radarBoard.hidden = !isRadar;
  els.sourceTabs.hidden = isScreen || isRadar || state.feed !== "all";

  if (isRadar) {
    els.pageEyebrow.textContent = "通信论文";
    els.pageTitle.textContent = "论文雷达";
    els.pageCopy.textContent = "聚焦 AI Agent、AI Coding、RAG 与无线通信网络方向的每日精读候选。";
  } else {
    els.pageEyebrow.textContent = state.feed === "all" ? "全部动态" : "精选";
    els.pageTitle.textContent = state.feed === "all" ? "AI 全量动态" : "AI 热点时间轴";
    els.pageCopy.textContent =
      state.feed === "all" ? "AI 相关资讯全量信息流，按发布时间持续更新。" : "按发布时间滚动展示当前最值得关注的 AI 动态。";
  }

  els.navLinks.forEach((link) => link.classList.remove("active"));
  if (isScreen || isRadar) {
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
  els.radarBoard.innerHTML = `<div class="empty">正在扫描可访问论文源并生成精读候选。</div>`;

  try {
    const response = await fetch(`/api/paper-radar${refresh ? "?refresh=1" : ""}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "论文雷达生成失败");
    state.radar = data;
    renderRadar(data);
    setConnection(true, data.cached ? "雷达缓存" : "实时同步");
  } catch (error) {
    setConnection(false, "扫描失败");
    renderRadarError(error);
  } finally {
    state.radarLoading = false;
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
      论文雷达暂不可用：${escapeHtml(error instanceof Error ? error.message : String(error))}
    </div>
  `;
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
els.radarBoard.addEventListener("click", (event) => {
  const button = event.target.closest("[data-radar-refresh]");
  if (!button) return;
  fetchRadar(true);
});

applyView();
formatClock();
setInterval(formatClock, 1000);
if (state.view === "radar") {
  fetchRadar();
} else {
  fetchHot();
  setInterval(fetchHot, state.refreshMs);
}
