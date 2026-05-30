function visible(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

const INPUT_SELECTORS = {
  claude: ["div.ProseMirror[contenteditable='true']", ".ProseMirror[contenteditable]", "[contenteditable='true']"],
  gemini: [".ql-editor[contenteditable='true']", "rich-textarea .ql-editor", ".text-input-field textarea", "[contenteditable='true']"],
  chatgpt: ["div.ProseMirror[contenteditable='true']", "#prompt-textarea", "[contenteditable='true']", "textarea#prompt-textarea"],
  deepseek: ["#chat-input", "textarea[placeholder]", "textarea", "[contenteditable='true']"],
  doubao: ["textarea.semi-input-textarea", "[contenteditable='true']", "textarea", "[class*='input'][class*='editor']"],
  qwen: ["[role='textbox']", "[contenteditable='true']", "[contenteditable]", "textarea"],
  kimi: ["[role='textbox']", "[contenteditable='true']", "[contenteditable]", "textarea"],
  yuanbao: ["[contenteditable='true']", "textarea", "#chat-input"],
  grok: ["textarea", "[contenteditable='true']", "[role='textbox']"],
};

const SEND_BUTTON_SELECTORS = {
  claude: ["button[aria-label='Send Message']", "button[aria-label='Send message']", "button[data-testid='send-button']"],
  gemini: ["button[aria-label='Send message']", "button[aria-label*='发送']", "button.send-button"],
  chatgpt: ["button[data-testid='send-button']", "button[aria-label='Send prompt']", "button[aria-label='Send']"],
  deepseek: ["button[data-testid='send-button']", "button[aria-label*='Send']", "button[aria-label*='发送']"],
  doubao: ["button[class*='send-msg-btn']", "button[class*='g-send-msg']", "button[aria-label*='发送']", "button[class*='send']"],
  qwen: ["button[aria-label='发送消息']", "button[aria-label*='发送']", "button[aria-label*='Send']", "button[class*='send']"],
  kimi: ["button[aria-label*='发送']", "button[aria-label*='Send']", "button[aria-label='提交']", "button[class*='send']"],
  yuanbao: ["button[aria-label*='发送']", "button[aria-label*='Send']", "button[class*='send']"],
  grok: ["button[aria-label*='Submit']", "button[aria-label*='Send']", "button[type='submit']", "button[class*='send']"],
};

const RESPONSE_SELECTORS = {
  claude: [
    "[data-testid='assistant-message']",
    "[data-testid='conversation-turn-assistant']",
    "[data-testid='chat-message-content']",
    ".font-claude-message",
    "[class*='font-claude-message']",
    "main .prose",
  ],
  gemini: ["message-content.model-response-text", ".model-response-text", ".response-container .markdown", "bard-markdown", "[data-response-index]"],
  chatgpt: ["[data-message-author-role='assistant']", "[data-testid^='conversation-turn-']:has([data-message-author-role='assistant'])", ".markdown.prose"],
  deepseek: [".ds-markdown", ".markdown-body", "[class*='markdown']", "[class*='assistant']"],
  doubao: ["[class*='answer']", "[class*='message'][class*='assistant']", "[class*='markdown']", ".markdown"],
  qwen: ["[class*='assistant']", "[class*='markdown']", ".markdown", ".response-content"],
  kimi: ["[class*='assistant']", "[class*='markdown']", ".markdown", ".segment-content"],
  yuanbao: ["[class*='agent']", "[class*='assistant']", "[class*='markdown']", ".markdown"],
  grok: ["[data-testid='message-bubble']", "[class*='message'][class*='assistant']", ".markdown", "[class*='response']"],
};

const GENERATING_SELECTORS = {
  claude: ["button[aria-label*='Stop']", "button[aria-label*='停止']", "button[data-testid*='stop']"],
  gemini: ["button[aria-label*='Stop']", "button[aria-label*='停止']", ".response-container button[aria-label*='Stop']"],
  chatgpt: ["button[data-testid='stop-button']", "button[aria-label*='Stop']", "button[aria-label*='停止']"],
  deepseek: ["button[aria-label*='Stop']", "button[aria-label*='停止']", "button[class*='stop']"],
};

function selectorsFor(map, service, fallback) {
  return [...(map[service] || []), ...fallback];
}

function safeQueryAll(selector) {
  try {
    return [...document.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

function findPromptInput(service) {
  const selectors = selectorsFor(INPUT_SELECTORS, service, [
    "#prompt-textarea",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true']",
    "textarea",
  ]);
  for (const selector of selectors) {
    const element = [...document.querySelectorAll(selector)].find(visible);
    if (element) return element;
  }
  return null;
}

function dispatchInput(element) {
  try {
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  } catch {
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function editableText(element) {
  if (!element) return "";
  if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") return element.value || "";
  return element.innerText || element.textContent || "";
}

function responseText(element) {
  return (element?.innerText || element?.textContent || "").replace(/\u00a0/g, " ").trim();
}

function normalizeText(value = "") {
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function pageText() {
  const root = document.querySelector("main") || document.body;
  return responseText(root);
}

function cleanFallbackText(value = "") {
  return String(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(copy|复制|share|download|regenerate|重新生成|edit|编辑|thumbs|like|dislike)$/i.test(line))
    .filter((line) => !/(can make mistakes|可能会出错|AI-generated|生成式 AI)/i.test(line))
    .join("\n")
    .trim();
}

function responseCandidates(service) {
  const selectors = selectorsFor(RESPONSE_SELECTORS, service, [
    "[data-message-author-role='assistant']",
    ".markdown",
    ".prose",
    "[class*='assistant']",
    "[class*='response']",
  ]);

  for (const selector of selectors) {
    const candidates = safeQueryAll(selector)
      .filter(visible)
      .map((element) => ({ element, text: responseText(element) }))
      .filter((item) => item.text.length > 8);
    if (!candidates.length) continue;

    const seen = new Set();
    return candidates.filter((item) => {
      const key = item.text.replace(/\s+/g, " ").slice(0, 500);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return [];
}

function responseSnapshot(service) {
  const candidates = responseCandidates(service);
  return {
    count: candidates.length,
    latestText: candidates.at(-1)?.text || "",
    pageText: pageText(),
  };
}

function fallbackResponseFromPageText(prompt, { pageBaselineText, responseBaselineText } = {}) {
  const rawPageText = pageText();
  const normalizedPageText = normalizeText(rawPageText);
  const normalizedPrompt = normalizeText(prompt);

  if (normalizedPrompt.length > 80) {
    const promptIndex = normalizedPageText.lastIndexOf(normalizedPrompt);
    if (promptIndex >= 0) {
      return cleanFallbackText(normalizedPageText.slice(promptIndex + normalizedPrompt.length));
    }
  }

  const promptTail = normalizeText(String(prompt || "").slice(-500));
  if (promptTail.length > 80) {
    const promptTailIndex = normalizedPageText.lastIndexOf(promptTail);
    if (promptTailIndex >= 0) {
      return cleanFallbackText(normalizedPageText.slice(promptTailIndex + promptTail.length));
    }
  }

  const normalizedBaseline = normalizeText(pageBaselineText);
  if (normalizedBaseline.length > 80) {
    const baselineIndex = normalizedPageText.lastIndexOf(normalizedBaseline);
    if (baselineIndex >= 0) {
      return cleanFallbackText(normalizedPageText.slice(baselineIndex + normalizedBaseline.length));
    }
  }

  const normalizedResponseBaseline = normalizeText(responseBaselineText);
  if (normalizedResponseBaseline.length > 40) {
    const baselineIndex = normalizedPageText.lastIndexOf(normalizedResponseBaseline);
    if (baselineIndex >= 0) {
      return cleanFallbackText(normalizedPageText.slice(baselineIndex + normalizedResponseBaseline.length));
    }
  }

  return "";
}

function latestGeneratedResponse(service, { responseAnchor, responseBaselineText, pageBaselineText, prompt } = {}) {
  const candidates = responseCandidates(service);
  const anchor = Number(responseAnchor);
  const hasAnchor = Number.isFinite(anchor);
  let pool = hasAnchor ? candidates.slice(Math.max(0, anchor)) : candidates;

  if (!pool.length && responseBaselineText) {
    const latest = candidates.at(-1);
    if (latest?.text && latest.text !== responseBaselineText) pool = [latest];
  }

  const selectorText = pool.at(-1)?.text || "";
  return {
    text: selectorText || fallbackResponseFromPageText(prompt, { pageBaselineText, responseBaselineText }),
    responseCount: candidates.length,
  };
}

function setPromptText(element, text) {
  element.focus();
  if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
    const setter =
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set ||
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(element, text);
    else element.value = text;
    dispatchInput(element);
    return;
  }

  try {
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, text);
    dispatchInput(element);
    if (editableText(element).trim()) return;
  } catch {
    // Fall through to safe DOM insertion.
  }

  element.innerHTML = "";
  String(text)
    .split("\n")
    .forEach((line) => {
      const block = document.createElement("p");
      if (line) block.textContent = line;
      else block.appendChild(document.createElement("br"));
      element.appendChild(block);
    });
  dispatchInput(element);
}

function findSendButton(service) {
  const selectors = selectorsFor(SEND_BUTTON_SELECTORS, service, [
    "button[data-testid='send-button']",
    "button[aria-label*='Send']",
    "button[aria-label*='发送']",
    "button[type='submit']",
  ]);
  for (const selector of selectors) {
    const button = [...document.querySelectorAll(selector)].find((item) => visible(item) && !item.disabled);
    if (button) return button;
  }
  return null;
}

function isGenerating(service) {
  const selectors = selectorsFor(GENERATING_SELECTORS, service, [
    "button[aria-label*='Stop']",
    "button[aria-label*='停止']",
    "button[data-testid*='stop']",
    "[aria-busy='true']",
    "[class*='generating']",
    "[class*='loading']",
  ]);
  return selectors.some((selector) => safeQueryAll(selector).some(visible));
}

function dispatchEnter(element) {
  element.focus();
  for (const type of ["keydown", "keypress", "keyup"]) {
    element.dispatchEvent(
      new KeyboardEvent(type, {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: type !== "keyup",
      }),
    );
  }
}

async function waitForPromptAccepted(input, prompt) {
  const originalLength = String(prompt || "").trim().length;
  for (let index = 0; index < 16; index += 1) {
    await sleep(250);
    const remaining = editableText(input).trim();
    if (!remaining || remaining.length < originalLength * 0.3) return true;
  }
  return false;
}

async function submitPrompt(service, input, prompt) {
  for (let index = 0; index < 12; index += 1) {
    const button = findSendButton(service);
    const disabled = button && (button.disabled || button.getAttribute("aria-disabled") === "true");
    if (button && !disabled) {
      button.click();
      if (await waitForPromptAccepted(input, prompt)) return { ok: true, status: "submitted" };
      return {
        ok: true,
        status: "submitted_unconfirmed",
        warning: "已点击发送，但没有确认输入框清空；将继续尝试回收回答。",
      };
    }
    await sleep(250);
  }

  dispatchEnter(input);
  if (await waitForPromptAccepted(input, prompt)) {
    return { ok: true, status: "submitted" };
  }

  return {
    ok: true,
    status: "submitted_unconfirmed",
    warning: "已尝试回车发送，但没有确认网页接受；将继续尝试回收回答。",
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SAM_AI_PREPARE") {
    sendResponse({ ok: true, status: "ready" });
    return false;
  }

  if (message?.type === "SAM_AI_READ_RESPONSE") {
    const result = latestGeneratedResponse(message.service, {
      responseAnchor: message.responseAnchor,
      responseBaselineText: message.responseBaselineText,
      pageBaselineText: message.pageBaselineText,
      prompt: message.prompt,
    });
    sendResponse({
      ok: true,
      status: result.text ? "completed" : "empty",
      text: result.text,
      responseCount: result.responseCount,
      generating: isGenerating(message.service),
    });
    return false;
  }

  if (message?.type !== "SAM_AI_FILL_PROMPT") {
    sendResponse({ ok: false, error: "unknown message" });
    return false;
  }

  try {
    const snapshot = responseSnapshot(message.service);
    const input = findPromptInput(message.service);
    if (!input) throw new Error("没有找到当前 AI 页面输入框，请确认页面已登录并进入聊天页");
    setPromptText(input, message.prompt || "");
    if (message.autoSubmit) {
      submitPrompt(message.service, input, message.prompt || "").then((result) =>
        sendResponse({
          ...result,
          responseAnchor: snapshot.count,
          responseBaselineText: snapshot.latestText,
          pageBaselineText: snapshot.pageText,
        }),
      );
      return true;
    }
    sendResponse({ ok: true, status: "drafted", responseAnchor: snapshot.count, responseBaselineText: snapshot.latestText, pageBaselineText: snapshot.pageText });
  } catch (error) {
    sendResponse({ ok: false, status: "failed", error: error instanceof Error ? error.message : String(error) });
  }
  return false;
});
