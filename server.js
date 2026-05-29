import http from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(__dirname, "public");
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";
const upstreamBase = "https://aihot.virxact.com";
const userAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 airview-everyday/0.1.0";
const cacheTtlMs = 120_000;
const cache = new Map();
const imageCacheTtlMs = 12 * 60 * 60 * 1000;
const imageNegativeTtlMs = 90 * 60 * 1000;
const imageFetchTimeoutMs = 3500;
const imageReadLimitBytes = 450_000;
const imageFetchConcurrency = 6;
const imageCache = new Map();
const imageInflight = new Map();
const radarCacheTtlMs = 12 * 60 * 60 * 1000;
const radarCache = new Map();
const appRoutes = new Set(["/all", "/all/", "/screen", "/screen/", "/communication", "/communication/"]);
const paperRadarBaseUrl = (process.env.PAPER_RADAR_BASE_URL || "https://api.muchu.cloud/v1").replace(/\/+$/, "");
const paperRadarModel = process.env.PAPER_RADAR_MODEL || "gpt-5.4-mini";
const paperRadarApiKey = process.env.PAPER_RADAR_API_KEY || process.env.OPENAI_API_KEY || "";

const radarTopics = [
  "LLM Agent",
  "AI Coding",
  "RAG",
  "Multi-Agent System",
  "AI for Software Engineering",
  "AI-RAN",
  "6G Network",
  "System Level Simulation",
  "Wireless Network Digital Twin",
  "Mobility Management",
  "Handover",
  "Radio Resource Management",
  "Massive MIMO",
  "ISAC",
  "NTN",
];

const topicPatterns = [
  ["LLM Agent", /\b(llm|large language model)s?\b[\s\S]{0,80}\bagent|agentic/i],
  ["AI Coding", /\b(code generation|program repair|software agent|coding agent|repository-level|swe-bench)\b/i],
  ["RAG", /\b(rag|retrieval[- ]augmented generation|retrieval augmented)\b/i],
  ["Multi-Agent System", /\b(multi[- ]agent|multiagent|agent collaboration|agent society)\b/i],
  ["AI for Software Engineering", /\b(ai for software engineering|software engineering|program synthesis|bug fixing|test generation)\b/i],
  ["AI-RAN", /\b(ai[- ]ran|ran intelligence|radio access network)\b/i],
  ["6G Network", /\b6g\b|\bsixth[- ]generation\b/i],
  ["System Level Simulation", /\bsystem[- ]level simulation|network simulation|simulation framework\b/i],
  ["Wireless Network Digital Twin", /\bwireless\b[\s\S]{0,80}\bdigital twin|\bdigital twin\b[\s\S]{0,80}\bwireless\b/i],
  ["Mobility Management", /\bmobility management|mobile network mobility\b/i],
  ["Handover", /\bhandover|handoff\b/i],
  ["Radio Resource Management", /\bradio resource management|\brrm\b|resource allocation\b/i],
  ["Massive MIMO", /\bmassive mimo|cell-free mimo|mimo\b/i],
  ["ISAC", /\bisac\b|integrated sensing and communication/i],
  ["NTN", /\bntn\b|non[- ]terrestrial network|satellite[- ]terrestrial/i],
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function clampTake(value) {
  const n = Number(value || 40);
  if (!Number.isFinite(n)) return 40;
  return Math.max(1, Math.min(100, Math.trunc(n)));
}

function buildItemsUrl(reqUrl) {
  const out = new URL("/api/public/items", upstreamBase);
  const mode = reqUrl.searchParams.get("mode") === "all" ? "all" : "selected";
  const category = reqUrl.searchParams.get("category");
  const q = reqUrl.searchParams.get("q");
  const since = reqUrl.searchParams.get("since");

  out.searchParams.set("mode", mode);
  out.searchParams.set("take", String(clampTake(reqUrl.searchParams.get("take"))));

  if (category && category !== "all") out.searchParams.set("category", category);
  if (q && q.trim().length >= 2) out.searchParams.set("q", q.trim().slice(0, 200));
  if (since) out.searchParams.set("since", since);

  return out;
}

function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function toHttpUrl(value, baseUrl) {
  if (!value || typeof value !== "string") return "";
  const trimmed = decodeHtmlEntities(value).trim();
  if (!trimmed || /^data:/i.test(trimmed)) return "";

  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function parseTagAttrs(tag) {
  const attrs = {};
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;

  while ((match = attrRe.exec(tag))) {
    attrs[match[1].toLowerCase()] = decodeHtmlEntities(match[2] || match[3] || match[4] || "");
  }

  return attrs;
}

function firstImageUrl(values, baseUrl) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = firstImageUrl(value, baseUrl);
      if (nested) return nested;
      continue;
    }

    if (value && typeof value === "object") {
      const nested = firstImageUrl([value.url, value.src, value.content], baseUrl);
      if (nested) return nested;
      continue;
    }

    const url = toHttpUrl(value, baseUrl);
    if (url) return url;
  }

  return "";
}

function extractJsonLdImage(html, pageUrl) {
  const scriptRe = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptRe.exec(html))) {
    try {
      const data = JSON.parse(decodeHtmlEntities(match[1]).trim());
      const queue = Array.isArray(data) ? [...data] : [data];

      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== "object") continue;

        const image = firstImageUrl([item.image, item.thumbnailUrl], pageUrl);
        if (image) return image;

        Object.values(item).forEach((value) => {
          if (value && typeof value === "object") queue.push(value);
        });
      }
    } catch {
      // Some publishers serve relaxed JSON-LD. Meta tags still cover the common case.
    }
  }

  return "";
}

function isLikelyContentImage(url) {
  if (!url) return false;
  return !/\/(?:logo|icon|avatar|sprite|blank|default|placeholder|loading|transparent|pixel|spacer)(?:[._/-]|$)|\/v2\/t\.png(?:[?#]|$)|\.(?:svg|gif)(?:[?#]|$)/i.test(
    url,
  );
}

function extractInlineImage(html, pageUrl) {
  const imgRe = /<img\b[^>]*>/gi;
  let match;

  while ((match = imgRe.exec(html))) {
    const attrs = parseTagAttrs(match[0]);
    const image = firstImageUrl(
      [
        attrs["data-original"],
        attrs["data-src"],
        attrs["data-lazy-src"],
        attrs["data-url"],
        attrs.src,
      ],
      pageUrl,
    );

    if (isLikelyContentImage(image)) return image;
  }

  return "";
}

function extractImageFromHtml(html, pageUrl) {
  const candidates = [];
  const metaRe = /<meta\b[^>]*>/gi;
  let match;

  while ((match = metaRe.exec(html))) {
    const attrs = parseTagAttrs(match[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (
      [
        "og:image",
        "og:image:url",
        "og:image:secure_url",
        "twitter:image",
        "twitter:image:src",
        "thumbnail",
        "image",
      ].includes(key)
    ) {
      candidates.push(attrs.content);
    }
  }

  const linkRe = /<link\b[^>]*>/gi;
  while ((match = linkRe.exec(html))) {
    const attrs = parseTagAttrs(match[0]);
    if (/\bimage_src\b/i.test(attrs.rel || "")) candidates.push(attrs.href);
  }

  return firstImageUrl(candidates, pageUrl) || extractJsonLdImage(html, pageUrl) || extractInlineImage(html, pageUrl);
}

async function readLimitedText(response, limitBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) return response.text();

  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";

  while (bytes < limitBytes) {
    const { done, value } = await reader.read();
    if (done) break;

    const remaining = limitBytes - bytes;
    const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
    text += decoder.decode(chunk, { stream: true });
    bytes += chunk.byteLength;

    if (value.byteLength > remaining) {
      await reader.cancel().catch(() => {});
      break;
    }
  }

  return text + decoder.decode();
}

async function fetchPageImage(pageUrl) {
  const safeUrl = toHttpUrl(pageUrl);
  if (!safeUrl) return "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), imageFetchTimeoutMs);

  try {
    const response = await fetch(safeUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      },
    });
    if (!response.ok) return "";

    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) return "";

    const html = await readLimitedText(response, imageReadLimitBytes);
    return extractImageFromHtml(html, response.url || safeUrl);
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function readImageCache(pageUrl) {
  const cached = imageCache.get(pageUrl);
  if (!cached) return { hit: false, imageUrl: "" };

  const ttl = cached.imageUrl ? imageCacheTtlMs : imageNegativeTtlMs;
  if (Date.now() - cached.at > ttl) {
    imageCache.delete(pageUrl);
    return { hit: false, imageUrl: "" };
  }

  return { hit: true, imageUrl: cached.imageUrl };
}

function fetchPageImageCached(pageUrl) {
  const cached = readImageCache(pageUrl);
  if (cached.hit) return Promise.resolve(cached.imageUrl);
  if (imageInflight.has(pageUrl)) return imageInflight.get(pageUrl);

  const task = fetchPageImage(pageUrl)
    .then((imageUrl) => {
      imageCache.set(pageUrl, { at: Date.now(), imageUrl: imageUrl || "" });
      return imageUrl || "";
    })
    .catch(() => {
      imageCache.set(pageUrl, { at: Date.now(), imageUrl: "" });
      return "";
    })
    .finally(() => imageInflight.delete(pageUrl));

  imageInflight.set(pageUrl, task);
  return task;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        await mapper(items[index], index);
      }
    }),
  );
}

function knownItemImage(item) {
  return firstImageUrl(
    [
      item.imageUrl,
      item.image,
      item.cover,
      item.coverUrl,
      item.thumbnail,
      item.thumbnailUrl,
      item.ogImage,
      item.picture,
      item.pic,
      item.logo,
      item.media,
    ],
    item.url,
  );
}

async function warmImageCache(entries) {
  if (!entries.length) return;
  await mapWithConcurrency(entries, 3, async ({ pageUrl }) => {
    await fetchPageImageCached(pageUrl);
  });
}

async function enrichItemsWithImages(items, mode) {
  if (!Array.isArray(items) || !items.length) return items;

  const enriched = items.map((item) => ({ ...item }));
  const pending = [];

  enriched.forEach((item) => {
    const existingImage = knownItemImage(item);
    if (existingImage) {
      item.imageUrl = existingImage;
      return;
    }

    const pageUrl = toHttpUrl(item.url);
    if (!pageUrl) return;

    const cached = readImageCache(pageUrl);
    if (cached.hit) {
      if (cached.imageUrl) item.imageUrl = cached.imageUrl;
      return;
    }

    pending.push({ item, pageUrl });
  });

  const immediateLimit = mode === "all" ? 18 : 24;
  const immediate = pending.slice(0, immediateLimit);
  await mapWithConcurrency(immediate, imageFetchConcurrency, async ({ item, pageUrl }) => {
    const imageUrl = await fetchPageImageCached(pageUrl);
    if (imageUrl) item.imageUrl = imageUrl;
  });

  const warmEntries = pending.slice(immediateLimit, immediateLimit + 42);
  void warmImageCache(warmEntries).catch(() => {});

  return enriched;
}

async function proxyHot(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const mode = reqUrl.searchParams.get("mode") === "all" ? "all" : "selected";
  const upstream = buildItemsUrl(reqUrl);
  const cacheKey = upstream.toString();
  const now = Date.now();
  const cached = cache.get(cacheKey);

  if (cached && now - cached.at < cacheTtlMs) {
    sendJson(res, 200, cached.body, { "x-airview-cache": "HIT" });
    return;
  }

  try {
    const response = await fetch(upstream, {
      headers: {
        "user-agent": userAgent,
        accept: "application/json",
      },
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: "Upstream data source returned non-JSON data.", detail: text.slice(0, 300) };
    }

    if (!response.ok) {
      sendJson(res, response.status, body);
      return;
    }

    if (Array.isArray(body.items)) {
      body = { ...body, items: await enrichItemsWithImages(body.items, mode) };
    }

    cache.set(cacheKey, { at: now, body });
    sendJson(res, 200, body, { "x-airview-cache": "MISS" });
  } catch (error) {
    sendJson(res, 502, {
      error: "Unable to reach the upstream data source right now.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function decodeXml(value = "") {
  return String(value)
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function extractAuthorNames(block) {
  return [...block.matchAll(/<author\b[\s\S]*?<\/author>/gi)]
    .map((match) => extractTag(match[0], "name"))
    .filter(Boolean);
}

function extractCategoryTerms(block) {
  return [...block.matchAll(/<category\b[^>]*term="([^"]+)"/gi)].map((match) => decodeXml(match[1])).filter(Boolean);
}

function parseArxivAtom(xml) {
  return [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => {
    const block = match[0];
    const id = extractTag(block, "id");
    const abstract = extractTag(block, "summary");
    const title = extractTag(block, "title");
    return {
      id,
      title,
      authors: extractAuthorNames(block).join(", ") || "作者未知",
      institutions: "未知/需原文确认",
      link: id,
      source: "arXiv",
      publishedAt: extractTag(block, "published") || extractTag(block, "updated"),
      abstract,
      categories: extractCategoryTerms(block),
    };
  });
}

function parseRssItems(xml, source) {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => {
    const block = match[0];
    return {
      id: extractTag(block, "guid") || extractTag(block, "link"),
      title: extractTag(block, "title"),
      authors: extractTag(block, "dc:creator") || extractTag(block, "author") || "作者未知",
      institutions: "未知/需原文确认",
      link: extractTag(block, "link"),
      source,
      publishedAt: extractTag(block, "pubDate"),
      abstract: extractTag(block, "description"),
      categories: [...block.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((item) => decodeXml(item[1])),
    };
  });
}

function matchedTopics(candidate) {
  const title = candidate.title || "";
  const abstract = candidate.abstract || "";
  const titleMatches = topicPatterns.filter(([, pattern]) => pattern.test(title)).map(([label]) => label);
  const abstractMatches = topicPatterns.filter(([, pattern]) => pattern.test(abstract)).map(([label]) => label);
  return {
    titleMatches,
    abstractMatches,
    all: [...new Set([...abstractMatches, ...titleMatches])],
  };
}

function candidateScore(candidate) {
  const matches = matchedTopics(candidate);
  const methodHints = /\b(method|framework|system|architecture|algorithm|evaluation|benchmark|simulation|prototype|dataset|experiment)\b/i.test(
    candidate.abstract || "",
  )
    ? 2
    : 0;
  return matches.abstractMatches.length * 4 + matches.titleMatches.length + methodHints;
}

function normalizeCandidate(candidate) {
  const matches = matchedTopics(candidate);
  return {
    ...candidate,
    matchedTopics: matches.all,
    localScore: candidateScore(candidate),
  };
}

async function fetchText(url, accept = "application/xml,text/xml,application/atom+xml,text/html;q=0.8", timeoutMs = 10_000) {
  const response = await fetch(url, {
    headers: {
      "user-agent": userAgent,
      accept,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return await response.text();
}

async function fetchJson(url, timeoutMs = 10_000) {
  const response = await fetch(url, {
    headers: {
      "user-agent": userAgent,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${new URL(url).hostname}`);
  }
  if (!response.ok) throw new Error(body.detail || body.error || `${response.status} ${response.statusText}`);
  return body;
}

async function fetchArxivCandidates() {
  const categories = ["cs.AI", "cs.SE", "cs.CL", "cs.NI", "eess.SP", "cs.IT"];
  const notes = [];
  const items = [];

  await Promise.all(
    categories.map(async (category) => {
    try {
      const xml = await fetchText(`https://export.arxiv.org/rss/${category}`, "application/rss+xml,application/xml,text/xml", 12_000);
      items.push(...parseRssItems(xml, `arXiv ${category}`));
    } catch (error) {
      notes.push(`arXiv ${category} RSS 读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
    }),
  );

  if (items.length) notes.push(`arXiv 返回 ${items.length} 条候选`);
  return { items, notes };
}

async function fetchPapersWithCodeCandidates() {
  const queries = ["LLM agent", "RAG", "6G wireless"];
  const notes = [];
  const items = [];

  await Promise.all(
    queries.map(async (query) => {
    try {
      const url = new URL("https://paperswithcode.com/api/v1/papers/");
      url.searchParams.set("q", query);
      url.searchParams.set("page_size", "4");
      const data = await fetchJson(url, 9_000);
      const results = Array.isArray(data.results) ? data.results : [];
      items.push(
        ...results.map((paper) => ({
          id: paper.id || paper.url_abs || paper.title,
          title: paper.title || "标题未知",
          authors: Array.isArray(paper.authors) ? paper.authors.join(", ") : paper.authors || "作者未知",
          institutions: "未知/需原文确认",
          link: paper.url_abs || (paper.id ? `https://paperswithcode.com/paper/${paper.id}` : "https://paperswithcode.com"),
          source: "Papers with Code",
          publishedAt: paper.published || paper.date,
          abstract: paper.abstract || paper.summary || "",
          categories: [],
        })),
      );
    } catch (error) {
      notes.push(`Papers with Code 查询 ${query} 失败：${error instanceof Error ? error.message : String(error)}`);
    }
    }),
  );

  if (items.length) notes.push(`Papers with Code 返回 ${items.length} 条候选`);
  return { items, notes };
}

async function fetchScholarAlertCandidates() {
  const feeds = (process.env.GOOGLE_SCHOLAR_ALERT_FEEDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!feeds.length) {
    return { items: [], notes: ["Google Scholar Alert 未配置可访问 RSS，因此未纳入扫描"] };
  }

  const notes = [];
  const items = [];
  for (const feed of feeds) {
    try {
      const xml = await fetchText(feed, "application/rss+xml,application/xml,text/xml");
      items.push(...parseRssItems(xml, "Google Scholar Alert"));
    } catch (error) {
      notes.push(`Google Scholar Alert 读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (items.length) notes.push(`Google Scholar Alert 返回 ${items.length} 条候选`);
  return { items, notes };
}

async function collectPaperCandidates() {
  const [arxiv, pwc, scholar] = await Promise.all([
    fetchArxivCandidates(),
    fetchPapersWithCodeCandidates(),
    fetchScholarAlertCandidates(),
  ]);

  const seen = new Set();
  const candidates = [...arxiv.items, ...pwc.items, ...scholar.items]
    .filter((item) => item.title && item.link)
    .map(normalizeCandidate)
    .filter((item) => item.localScore >= 4 || item.source === "Google Scholar Alert")
    .filter((item) => {
      const key = (item.link || item.title).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const scoreDelta = b.localScore - a.localScore;
      if (scoreDelta) return scoreDelta;
      return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
    })
    .slice(0, 36);

  return {
    scannedAt: new Date().toISOString(),
    sourceNotes: [...arxiv.notes, ...pwc.notes, ...scholar.notes],
    candidates,
  };
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("模型未返回 JSON 对象");
  return JSON.parse(trimmed.slice(start, end + 1));
}

function fallbackRadar(sourceData, reason) {
  const items = sourceData.candidates.slice(0, 10).map((item) => ({
    title: item.title,
    authors: item.authors || "作者未知",
    institutions: item.institutions || "未知/需原文确认",
    link: item.link,
    summary: item.abstract ? item.abstract.slice(0, 260) : "摘要不可用，需原文确认。",
    keywords: item.matchedTopics,
    contribution: "模型筛选暂不可用，需人工阅读摘要与方法确认贡献。",
    relevanceScore: Math.max(1, Math.min(5, Math.ceil(item.localScore / 4))),
    worthDeepRead: item.localScore >= 8,
    deepReadReason: "这是按摘要关键词和方法信号生成的降级结果，需原文确认。",
    transferDirections: ["技术预研"],
    source: item.source,
    publishedAt: item.publishedAt,
  }));
  return {
    generatedAt: new Date().toISOString(),
    sourceNotes: [...sourceData.sourceNotes, `模型筛选失败，使用降级候选：${reason}`],
    items,
    topReads: items.filter((item) => item.worthDeepRead).slice(0, 3).map((item) => item.title),
    saveOnly: items.filter((item) => !item.worthDeepRead).slice(0, 5).map((item) => item.title),
    filteredReasons: ["降级模式只依据摘要和关键词初筛，无法确认方法细节与机构信息。"],
  };
}

function compactCandidateForModel(item) {
  const authors = String(item.authors || "作者未知")
    .split(",")
    .map((author) => author.trim())
    .filter(Boolean);
  return {
    title: item.title,
    authors: authors.length > 8 ? `${authors.slice(0, 8).join(", ")} et al.` : authors.join(", ") || "作者未知",
    institutions: item.institutions || "未知/需原文确认",
    link: item.link,
    source: item.source,
    publishedAt: item.publishedAt,
    abstract: String(item.abstract || "").slice(0, 900),
    categories: item.categories || [],
    matchedTopics: item.matchedTopics || [],
    localScore: item.localScore,
  };
}

async function callPaperRadarModel(sourceData) {
  if (!paperRadarApiKey) {
    throw new Error("PAPER_RADAR_API_KEY is not configured");
  }

  const systemPrompt = [
    "你是用户的论文精读助手。每天扫描 arXiv、Papers with Code、Google Scholar Alert 的可访问结果，筛选与用户相关的论文，生成精读候选清单。",
    `关注方向：${radarTopics.join("；")}。`,
    "输出不超过 10 篇。不要因为标题像就推荐，优先看摘要和方法；如果只是理论推导但难以工程转化，要说明。",
    "不要编造论文内容；只使用给定候选中的可访问来源。作者机构或方法细节不确定时，明确写未知或需原文确认。",
  ].join("\n");

  const userPrompt = `
请基于候选论文 JSON 输出严格 JSON，不要 Markdown。
每篇必须包含：title, authors, institutions, link, summary, keywords, contribution, relevanceScore(1-5), worthDeepRead(boolean), deepReadReason, transferDirections。
transferDirections 只能从这些值里选：AirView 建模、AI For Work、博客、团队分享、技术预研。
topReads 必须是今天最值得精读的 1-3 篇标题；saveOnly 是可以只收藏不读的论文标题；filteredReasons 写明显不相关的过滤原因。
顶层 JSON 字段：
{
  "generatedAt": "${new Date().toISOString()}",
  "sourceNotes": [],
  "items": [],
  "topReads": [],
  "saveOnly": [],
  "filteredReasons": []
}

可访问来源状态：
${sourceData.sourceNotes.map((note) => `- ${note}`).join("\n")}

候选论文：
${JSON.stringify(sourceData.candidates.slice(0, 18).map(compactCandidateForModel), null, 2)}
`;

  const body = {
    model: paperRadarModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 4000,
    response_format: { type: "json_object" },
  };

  const doRequest = async (payload) => {
    const response = await fetch(`${paperRadarBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${paperRadarApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 300) };
    }
    if (!response.ok) throw new Error(data.error?.message || data.error || `${response.status} ${response.statusText}`);
    return data;
  };

  let data;
  try {
    data = await doRequest(body);
  } catch (error) {
    if (!String(error instanceof Error ? error.message : error).toLowerCase().includes("response_format")) throw error;
    const { response_format: _responseFormat, ...retryBody } = body;
    data = await doRequest(retryBody);
  }

  const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || "";
  return extractJsonObject(content);
}

async function proxyPaperRadar(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const refresh = reqUrl.searchParams.get("refresh") === "1";
  const cacheKey = "daily-paper-radar";
  const cached = radarCache.get(cacheKey);
  const now = Date.now();

  if (!refresh && cached && now - cached.at < radarCacheTtlMs) {
    sendJson(res, 200, { ...cached.body, cached: true });
    return;
  }

  try {
    const sourceData = await collectPaperCandidates();
    let report;
    try {
      report = sourceData.candidates.length
        ? await callPaperRadarModel(sourceData)
        : {
            generatedAt: new Date().toISOString(),
            sourceNotes: sourceData.sourceNotes,
            items: [],
            topReads: [],
            saveOnly: [],
            filteredReasons: ["可访问来源未返回足够匹配摘要的候选论文。"],
          };
    } catch (error) {
      report = fallbackRadar(sourceData, error instanceof Error ? error.message : String(error));
    }

    const reportItems = Array.isArray(report.items) ? report.items.slice(0, 10) : [];
    const reportTopReads = Array.isArray(report.topReads) ? report.topReads.slice(0, 3) : [];
    const reportSaveOnly = Array.isArray(report.saveOnly) ? report.saveOnly : [];
    const reportFilteredReasons = Array.isArray(report.filteredReasons) ? report.filteredReasons : [];
    const reportSourceNotes = Array.isArray(report.sourceNotes) ? report.sourceNotes : [];

    const body = {
      ...report,
      items: reportItems,
      topReads: reportTopReads,
      saveOnly: reportSaveOnly,
      filteredReasons: reportFilteredReasons,
      ok: true,
      cached: false,
      candidateCount: sourceData.candidates.length,
      scannedAt: sourceData.scannedAt,
      sourceNotes: [...new Set([...reportSourceNotes, ...sourceData.sourceNotes])],
    };
    radarCache.set(cacheKey, { at: now, body });
    sendJson(res, 200, body);
  } catch (error) {
    sendJson(res, 502, {
      error: "Solution AI Mate paper assistant is unavailable right now.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function serveStatic(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname === "/" ? "/index.html" : reqUrl.pathname;
  const decoded = decodeURIComponent(pathname);
  let filePath = normalize(join(publicDir, decoded));

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    if (!appRoutes.has(reqUrl.pathname)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    filePath = join(publicDir, "index.html");
  }

  const ext = extname(filePath);
  res.writeHead(200, {
    "content-type": mimeTypes[ext] || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-store" : "public, max-age=0, must-revalidate",
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) return;

  if (req.url.startsWith("/api/hot")) {
    await proxyHot(req, res);
    return;
  }

  if (req.url.startsWith("/api/paper-radar")) {
    await proxyPaperRadar(req, res);
    return;
  }

  if (req.url === "/health") {
    const index = await readFile(join(publicDir, "index.html"), "utf8");
    sendJson(res, 200, { ok: true, indexBytes: index.length });
    return;
  }

  await serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`Solution AI Mate listening on http://${host}:${port}`);
});
