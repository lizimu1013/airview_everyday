export const ARENA_PAGE_SOURCE = "solution-ai-mate-arena";
export const ARENA_COMPANION_SOURCE = "solution-ai-mate-companion";
export const ARENA_SERVICES = [
  { id: "claude", name: "Claude", shortName: "Claude", desc: "Anthropic · 推理稳健" },
  { id: "gemini", name: "Gemini", shortName: "Gemini", desc: "Google · 多模态强" },
  { id: "chatgpt", name: "GPT", shortName: "GPT", desc: "OpenAI · 全能选手" },
  { id: "deepseek", name: "DeepSeek", shortName: "DeepSeek", desc: "深度求索 · 代码强" },
  { id: "doubao", name: "豆包", shortName: "豆包", desc: "字节 · 中文友好" },
  { id: "qwen", name: "千问", shortName: "千问", desc: "阿里 · 长文档强" },
  { id: "kimi", name: "Kimi", shortName: "Kimi", desc: "月之暗面 · 超长上下文" },
  { id: "yuanbao", name: "元宝", shortName: "元宝", desc: "腾讯 · 微信生态" },
  { id: "grok", name: "Grok", shortName: "Grok", desc: "xAI · 实时网络" },
];
export const ARENA_SERVICE_IDS = ARENA_SERVICES.map((service) => service.id);
export const DEFAULT_COMPANION_SERVICES = ARENA_SERVICE_IDS.slice(0, 3);

export function latestPromptResponses(active) {
  return active?.rounds?.at(-1)?.responses?.filter((response) => response?.text) || [];
}

export function mapPromptsToServices(prompts, serviceIds = DEFAULT_COMPANION_SERVICES) {
  return prompts.slice(0, serviceIds.length).map((item, index) => ({
    service: item.service || serviceIds[index],
    roleName: item.roleName || `角色 ${index + 1}`,
    prompt: item.text || item.prompt || "",
  }));
}

export function createArenaCompanionTask(active, options = {}) {
  const prompts = mapPromptsToServices(latestPromptResponses(active), options.services || DEFAULT_COMPANION_SERVICES);
  return {
    id: `sam-arena-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: active?.title || active?.question || "AI 圆桌任务",
    question: active?.question || "",
    context: active?.context || "",
    prompts,
    autoSubmit: true,
    createdAt: new Date().toISOString(),
  };
}

export function mergeCompanionResultsIntoActive(active, companionResult) {
  const results = Array.isArray(companionResult?.results) ? companionResult.results : [];
  if (!active?.rounds?.length || !results.length) return active;

  const latestRoundIndex = active.rounds.length - 1;
  const resultByService = new Map(results.map((item) => [item.service, item]));

  return {
    ...active,
    rounds: active.rounds.map((round, index) => {
      if (index !== latestRoundIndex) return round;
      return {
        ...round,
        responses: (round.responses || []).map((response) => {
          const result = resultByService.get(response.service);
          if (!result) return response;

          const text = typeof result.text === "string" ? result.text.trim() : "";
          return {
            ...response,
            providerStatus: text ? "response" : response.providerStatus,
            text: text || response.text,
            companionStatus: result.status || "",
            companionError: result.error || "",
            tabId: result.tabId || response.tabId,
            collectedAt: text ? new Date().toISOString() : response.collectedAt,
          };
        }),
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

export function createCompanionClient(targetWindow = globalThis.window, { timeoutMs = 1200 } = {}) {
  if (!targetWindow?.postMessage || !targetWindow?.addEventListener) {
    return null;
  }

  function request(type, payload = {}, timeoutOverride) {
    const requestId = `sam-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const timeout = timeoutOverride || timeoutMs;

    return new Promise((resolve, reject) => {
      const timer = targetWindow.setTimeout?.(() => {
        targetWindow.removeEventListener("message", onMessage);
        reject(new Error("未检测到浏览器伴侣扩展"));
      }, timeout);

      function onMessage(event) {
        if (event.source !== targetWindow) return;
        const message = event.data || {};
        if (message.source !== ARENA_COMPANION_SOURCE || message.requestId !== requestId) return;
        if (timer) targetWindow.clearTimeout(timer);
        targetWindow.removeEventListener("message", onMessage);
        if (message.ok === false) {
          reject(new Error(message.error || "浏览器伴侣扩展执行失败"));
          return;
        }
        resolve(message.payload || {});
      }

      targetWindow.addEventListener("message", onMessage);
      targetWindow.postMessage(
        {
          source: ARENA_PAGE_SOURCE,
          type,
          requestId,
          payload,
        },
        "*",
      );
    });
  }

  return {
    ping: () => request("ARENA_COMPANION_PING", {}, 700),
    runTask: (task) => request("ARENA_COMPANION_RUN", { task }, 240_000),
  };
}

if (typeof window !== "undefined") {
  window.SolutionArenaCompanion = createCompanionClient(window);
}
