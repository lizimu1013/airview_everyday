import { AI_SERVICES, buildRunPlan, isAllowedSiteOrigin, summarizeRunResults } from "./background-core.js";

const RESPONSE_TIMEOUT_MS = 180_000;
const RESPONSE_POLL_MS = 2_000;
const RESPONSE_STABLE_POLLS = 2;

function chromeCall(api, ...args) {
  return new Promise((resolve, reject) => {
    api(...args, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createTaskTab(item) {
  return await chromeCall(chrome.tabs.create, { url: item.url, active: false });
}

function waitForTabComplete(tabId, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }, timeoutMs);

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function ensureAiContentScript(tabId) {
  try {
    await chromeCall(chrome.tabs.sendMessage, tabId, { type: "SAM_AI_PREPARE" });
    return;
  } catch {
    await chromeCall(chrome.scripting.executeScript, {
      target: { tabId },
      files: ["ai-page.js"],
    });
  }
}

function readableSubmitStatus(status) {
  return status === "submitted" || status === "submitted_unconfirmed";
}

async function openAndSubmitPrompt(item) {
  const tab = await createTaskTab(item);
  try {
    if (tab.status !== "complete") await waitForTabComplete(tab.id);
    await ensureAiContentScript(tab.id);
    const response = await chromeCall(chrome.tabs.sendMessage, tab.id, {
      type: "SAM_AI_FILL_PROMPT",
      service: item.service,
      roleName: item.roleName,
      prompt: item.prompt,
      autoSubmit: item.autoSubmit,
    });

    return {
      ok: Boolean(response?.ok) || readableSubmitStatus(response?.status),
      service: item.service,
      serviceName: item.serviceName,
      tabId: tab.id,
      status: response?.status || "unknown",
      text: "",
      error: response?.error || "",
      warning: response?.warning || "",
      responseAnchor: response?.responseAnchor,
      responseBaselineText: response?.responseBaselineText,
      pageBaselineText: response?.pageBaselineText,
      prompt: item.prompt,
    };
  } catch (error) {
    return {
      ok: false,
      service: item.service,
      serviceName: item.serviceName,
      tabId: tab.id,
      status: "failed",
      text: "",
      error: error instanceof Error ? error.message : String(error),
      prompt: item.prompt,
    };
  }
}

async function readSubmittedResult(result) {
  if (!readableSubmitStatus(result.status) || !result.tabId) return result;

  const readback = await readResponseAfterSubmit(result.tabId, result.service, {
    responseAnchor: result.responseAnchor,
    responseBaselineText: result.responseBaselineText,
    pageBaselineText: result.pageBaselineText,
    prompt: result.prompt,
  });
  const text = readback?.text || "";
  return {
    ...result,
    ok: result.ok || Boolean(text),
    status: text ? readback.status : readback?.status || result.status,
    text,
    error: text ? "" : result.error || readback?.error || "",
  };
}

async function runArenaTask(task) {
  const plan = buildRunPlan(task);
  if (!plan.length) throw new Error("任务里没有可发送的 AI Prompt");
  const submittedResults = await Promise.all(plan.map((item) => openAndSubmitPrompt(item)));
  const results = await Promise.all(submittedResults.map((result) => readSubmittedResult(result)));
  return summarizeRunResults(results);
}

async function readResponseAfterSubmit(tabId, service, options = {}) {
  const startedAt = Date.now();
  let lastText = "";
  let stablePolls = 0;
  let lastError = "";

  while (Date.now() - startedAt < RESPONSE_TIMEOUT_MS) {
    await sleep(RESPONSE_POLL_MS);
    try {
      const response = await chromeCall(chrome.tabs.sendMessage, tabId, {
        type: "SAM_AI_READ_RESPONSE",
        service,
        responseAnchor: options.responseAnchor,
        responseBaselineText: options.responseBaselineText,
        pageBaselineText: options.pageBaselineText,
        prompt: options.prompt,
      });
      const text = String(response?.text || "").trim();
      if (text && text === lastText) stablePolls += 1;
      else stablePolls = 0;
      if (text) lastText = text;
      if (lastText && stablePolls >= RESPONSE_STABLE_POLLS && !response?.generating) {
        return { status: "completed", text: lastText };
      }
      if (lastText && stablePolls >= RESPONSE_STABLE_POLLS + 1) {
        return { status: "completed", text: lastText };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (lastText) return { status: "partial", text: lastText, error: lastError };
  return { status: "submitted", text: "", error: lastError };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.url) {
    sendResponse({ ok: false, error: "缺少来源页面" });
    return false;
  }

  const origin = new URL(sender.url).origin;
  if (!isAllowedSiteOrigin(origin)) {
    sendResponse({ ok: false, error: "来源页面未授权" });
    return false;
  }

  if (message?.type === "ARENA_COMPANION_PING") {
    sendResponse({ ok: true, payload: { connected: true, version: chrome.runtime.getManifest().version } });
    return false;
  }

  if (message?.type === "ARENA_COMPANION_RUN") {
    runArenaTask(message.task)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  sendResponse({ ok: false, error: "未知的浏览器伴侣消息" });
  return false;
});
