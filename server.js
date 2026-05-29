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
const appRoutes = new Set(["/all", "/all/", "/screen", "/screen/"]);

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

async function proxyHot(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
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
      body = { error: "AI HOT returned non-JSON data.", detail: text.slice(0, 300) };
    }

    if (!response.ok) {
      sendJson(res, response.status, body);
      return;
    }

    cache.set(cacheKey, { at: now, body });
    sendJson(res, 200, body, { "x-airview-cache": "MISS" });
  } catch (error) {
    sendJson(res, 502, {
      error: "Unable to reach AI HOT right now.",
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

  if (req.url === "/health") {
    const index = await readFile(join(publicDir, "index.html"), "utf8");
    sendJson(res, 200, { ok: true, indexBytes: index.length });
    return;
  }

  await serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`AI Hot dashboard listening on http://${host}:${port}`);
});
