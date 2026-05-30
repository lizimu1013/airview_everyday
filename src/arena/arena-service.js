import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const dataDir = resolve(repoRoot, "data", "arena-sessions");
const maxBodyBytes = 1_000_000;
const maxContextChars = 6000;

export const arenaRoles = [
  {
    id: "architect",
    name: "方案架构师",
    shortName: "架构",
    duty: "把信息转化为可落地的解决方案结构，关注系统边界、模块拆分、交付路径和客户价值。",
    format: "方案结构 / 关键模块 / 落地路径 / 依赖条件 / 验证方式",
  },
  {
    id: "technologist",
    name: "技术专家",
    shortName: "技术",
    duty: "判断技术可行性、接口和数据要求，识别实现难点、性能瓶颈和验证实验。",
    format: "技术要点 / 数据接口 / 实现难点 / 验证实验 / 工程风险",
  },
  {
    id: "critic",
    name: "反方挑战者",
    shortName: "反方",
    duty: "专门寻找逻辑跳跃、证据不足、失败路径和客户侧阻力，避免方案过早乐观。",
    format: "最大风险 / 反例 / 隐含假设 / 失败信号 / 修正建议",
  },
  {
    id: "market",
    name: "市场洞察员",
    shortName: "市场",
    duty: "从行业趋势、竞品、客户预算和采购动因判断机会是否值得进入。",
    format: "机会判断 / 目标客户 / 竞品参照 / 商业价值 / 进入时机",
  },
  {
    id: "action",
    name: "行动拆解员",
    shortName: "行动",
    duty: "把结论拆成下一步动作、负责人角色、验收标准和优先级。",
    format: "下一步 / 优先级 / 负责人角色 / 验证标准 / 截止条件",
  },
];

export const arenaTemplates = [
  {
    id: "solution-insight",
    name: "方案洞察",
    description: "把一条资讯、论文或客户问题转成解决方案判断。",
    prompt:
      "请围绕材料判断它对解决方案工作的价值：它解决什么问题、适合哪些客户场景、需要哪些技术组件、短期能做什么验证。",
  },
  {
    id: "tech-research",
    name: "技术预研",
    description: "适合论文、开源项目、技术趋势的可行性分析。",
    prompt:
      "请把材料当作技术预研线索，判断技术原理、成熟度、可替代方案、验证实验和工程化风险。",
  },
  {
    id: "customer-brief",
    name: "客户交流稿",
    description: "把复杂动态转成客户能听懂的价值和下一步建议。",
    prompt:
      "请把材料转成面向客户交流的判断：客户痛点、价值主张、可展示能力、风险边界和下一步沟通问题。",
  },
  {
    id: "ppt-material",
    name: "PPT 素材池",
    description: "生成标题、红腰带、结构、图示和证据点。",
    prompt:
      "请把材料拆成单页 PPT 可用素材：主标题、红腰带、三段论证结构、可视化建议、需要补充的数据证据。",
  },
];

const roleMap = new Map(arenaRoles.map((role) => [role.id, role]));
const templateMap = new Map(arenaTemplates.map((template) => [template.id, template]));

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    let body = "";
    req.on("data", (chunk) => {
      size += chunk.byteLength;
      if (size > maxBodyBytes) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sessionPath(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id || "")) throw new Error("Invalid session id");
  return join(dataDir, `${id}.json`);
}

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

async function readSession(id) {
  const text = await readFile(sessionPath(id), "utf8");
  return JSON.parse(text);
}

async function saveSession(session) {
  await ensureDataDir();
  session.updatedAt = new Date().toISOString();
  await writeFile(sessionPath(session.id), JSON.stringify(session, null, 2), "utf8");
  return session;
}

async function listSessions() {
  try {
    await ensureDataDir();
    const files = await readdir(dataDir);
    const sessions = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          try {
            const session = JSON.parse(await readFile(join(dataDir, file), "utf8"));
            return {
              id: session.id,
              title: session.title,
              mode: session.mode,
              templateId: session.templateId,
              roleCount: Array.isArray(session.roles) ? session.roles.length : 0,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              hasSummary: Boolean(session.summary),
            };
          } catch {
            return null;
          }
        }),
    );
    return sessions.filter(Boolean).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function sanitizeText(value, fallback = "") {
  return String(value || fallback).trim().slice(0, maxContextChars);
}

function sanitizeRoles(ids) {
  const roleIds = Array.isArray(ids) && ids.length ? ids : ["architect", "technologist", "critic"];
  const roles = roleIds.map((id) => roleMap.get(id)).filter(Boolean);
  return roles.slice(0, 3).length ? roles.slice(0, 3) : arenaRoles.slice(0, 3);
}

function makeTitle(question, sourceItem) {
  const title = sanitizeText(sourceItem?.title || question || "AI 圆桌", "AI 圆桌");
  return title.length > 48 ? `${title.slice(0, 48)}...` : title;
}

function scanSensitive(text) {
  const rules = [
    { id: "api-key", category: "API_KEY", severity: "block", pattern: /\b(?:sk|ak|pk|rk)-[A-Za-z0-9_-]{16,}\b/g },
    { id: "bearer-token", category: "TOKEN", severity: "block", pattern: /\bBearer\s+[A-Za-z0-9._~-]{20,}\b/g },
    { id: "private-key", category: "PRIVATE_KEY", severity: "block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
    { id: "password", category: "PASSWORD", severity: "warn", pattern: /\b(password|passwd|pwd|密码)\s*[:=]\s*\S{6,}/gi },
  ];
  const hits = [];
  for (const rule of rules) {
    let match;
    while ((match = rule.pattern.exec(text))) {
      hits.push({ rule: rule.id, category: rule.category, severity: rule.severity, index: match.index, length: match[0].length });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

function maskSensitive(text, hits) {
  return [...hits]
    .sort((a, b) => b.index - a.index)
    .reduce((output, hit) => `${output.slice(0, hit.index)}<${hit.category}>${output.slice(hit.index + hit.length)}`, text);
}

async function createSession(payload) {
  const now = new Date().toISOString();
  const question = sanitizeText(payload.question, "");
  if (!question) throw new Error("question is required");
  const contextRaw = sanitizeText(payload.context, "");
  const sensitiveHits = scanSensitive([question, contextRaw].join("\n"));
  const context = maskSensitive(contextRaw, sensitiveHits);
  const sourceItem = payload.sourceItem && typeof payload.sourceItem === "object" ? payload.sourceItem : null;
  const session = {
    id: randomUUID(),
    title: makeTitle(question, sourceItem),
    question: maskSensitive(question, sensitiveHits),
    context,
    sourceItem,
    mode: payload.mode === "free" ? "free" : "collab",
    templateId: templateMap.has(payload.templateId) ? payload.templateId : "solution-insight",
    roles: sanitizeRoles(payload.roles),
    rounds: Array.isArray(payload.rounds) ? payload.rounds : [],
    summary: payload.summary || null,
    warnings: sensitiveHits.length
      ? [{ type: "sensitive_masked", message: "输入中疑似包含敏感字段，已遮蔽。", hits: sensitiveHits }]
      : [],
    createdAt: now,
    updatedAt: now,
  };
  return await saveSession(session);
}

function exportMarkdown(session) {
  const lines = [
    `# ${session.title}`,
    "",
    `- 创建时间：${session.createdAt}`,
    `- 模式：${session.mode === "free" ? "自由辩论" : "群策群力"}`,
    `- 模板：${templateMap.get(session.templateId)?.name || session.templateId}`,
    "",
    "## 问题",
    session.question,
    "",
    "## 背景材料",
    session.context || "无",
  ];
  for (const round of session.rounds || []) {
    lines.push("", `## 第 ${round.num} 轮`, "");
    for (const response of round.responses || []) {
      lines.push(`### ${response.roleName}`, "", response.text || "", "");
    }
  }
  if (session.summary) {
    lines.push("", "## 裁判总结", "", session.summary.text || "");
  }
  return lines.join("\n");
}

export async function handleArenaRequest(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const path = reqUrl.pathname.replace(/\/+$/, "");
  const method = req.method || "GET";

  try {
    if (method === "GET" && path === "/api/arena/templates") {
      sendJson(res, 200, {
        roles: arenaRoles,
        templates: arenaTemplates,
        defaults: { roles: ["architect", "technologist", "critic"], mode: "collab", templateId: "solution-insight" },
        companionOnly: true,
      });
      return;
    }

    if (method === "GET" && path === "/api/arena/sessions") {
      sendJson(res, 200, { sessions: await listSessions() });
      return;
    }

    if (method === "POST" && path === "/api/arena/sessions") {
      sendJson(res, 201, { session: await createSession(await readJsonBody(req)) });
      return;
    }

    const sessionMatch = path.match(/^\/api\/arena\/sessions\/([^/]+)(?:\/([^/]+))?$/);
    if (sessionMatch) {
      const [, id, action] = sessionMatch;
      if (method === "GET" && !action) {
        sendJson(res, 200, { session: await readSession(id) });
        return;
      }
      if (method === "GET" && action === "export") {
        const session = await readSession(id);
        res.writeHead(200, {
          "content-type": "text/markdown; charset=utf-8",
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="arena-${session.id}.md"`,
        });
        res.end(exportMarkdown(session));
        return;
      }
    }

    sendJson(res, 404, { error: "Arena endpoint not found" });
  } catch (error) {
    sendJson(res, error?.message === "question is required" ? 400 : 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
