const ARENA_PAGE_SOURCE = "solution-ai-mate-arena";
const ARENA_COMPANION_SOURCE = "solution-ai-mate-companion";

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const message = event.data || {};
  if (message.source !== ARENA_PAGE_SOURCE) return;

  chrome.runtime.sendMessage(
    {
      type: message.type,
      task: message.payload?.task,
    },
    (response) => {
      const error = chrome.runtime.lastError;
      window.postMessage(
        {
          source: ARENA_COMPANION_SOURCE,
          requestId: message.requestId,
          ok: error ? false : response?.ok !== false,
          payload: response?.payload || response,
          error: error?.message || response?.error || "",
        },
        "*",
      );
    },
  );
});
