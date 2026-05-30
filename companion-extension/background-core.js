export const AI_SERVICES = {
  claude: {
    id: "claude",
    name: "Claude",
    url: "https://claude.ai/new",
    match: "https://claude.ai/*",
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    url: "https://gemini.google.com/app",
    match: "https://gemini.google.com/*",
  },
  chatgpt: {
    id: "chatgpt",
    name: "GPT",
    url: "https://chatgpt.com/",
    match: "https://chatgpt.com/*",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    url: "https://chat.deepseek.com/",
    match: "https://chat.deepseek.com/*",
  },
  doubao: {
    id: "doubao",
    name: "豆包",
    url: "https://www.doubao.com/chat",
    match: "https://www.doubao.com/*",
  },
  qwen: {
    id: "qwen",
    name: "千问",
    url: "https://www.qianwen.com",
    match: "https://www.qianwen.com/*",
  },
  kimi: {
    id: "kimi",
    name: "Kimi",
    url: "https://www.kimi.com",
    match: "https://www.kimi.com/*",
  },
  yuanbao: {
    id: "yuanbao",
    name: "元宝",
    url: "https://yuanbao.tencent.com/chat",
    match: "https://yuanbao.tencent.com/*",
  },
  grok: {
    id: "grok",
    name: "Grok",
    url: "https://grok.com",
    match: "https://grok.com/*",
  },
};

export function isAllowedSiteOrigin(origin) {
  return /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(origin || "");
}

export function buildRunPlan(task) {
  if (!task || !Array.isArray(task.prompts)) return [];
  return task.prompts
    .map((prompt) => {
      const service = AI_SERVICES[prompt.service];
      if (!service || !prompt.prompt) return null;
      return {
        taskId: task.id,
        service: service.id,
        serviceName: service.name,
        url: service.url,
        prompt: prompt.prompt,
        roleName: prompt.roleName || service.name,
        autoSubmit: Boolean(task.autoSubmit),
      };
    })
    .filter(Boolean);
}

export function isReusableServiceTab(service, tabUrl) {
  if (!service?.url || !tabUrl) return false;
  try {
    const target = new URL(service.url);
    const current = new URL(tabUrl);
    if (target.origin !== current.origin) return false;
    const targetPath = target.pathname.replace(/\/+$/, "") || "/";
    const currentPath = current.pathname.replace(/\/+$/, "") || "/";
    return currentPath === targetPath;
  } catch {
    return false;
  }
}

export function summarizeRunResults(results) {
  const ok = results.filter((item) => item.ok).length;
  return {
    ok,
    failed: results.length - ok,
    results,
  };
}
