const API_BASE_URL = "http://localhost:4000";
const minimumRequestInterval = 2500;
let lastRequestAt = 0;

function getCacheKey(url, mode) {
  return `summary:${mode}:${url}`;
}

async function getFromStorage(key) {
  return await chrome.storage.local.get(key);
}

async function saveToStorage(key, value) {
  return await chrome.storage.local.set({ [key]: value });
}

async function callSummaryApi({ title, url, content, wordCount, mode }) {
  const response = await fetch(`${API_BASE_URL}/api/summarize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Extension-Name": "AI Page Summarizer"
    },
    body: JSON.stringify({
      title,
      url,
      content,
      wordCount,
      mode
    })
  });

  const data = await response.json().catch(() => ({
    error: "The summarizer server returned an invalid response."
  }));

  if (!response.ok) {
    throw new Error(data.error || "AI summary request failed.");
  }

  return data;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  async function handleMessage() {
    if (!message || typeof message.type !== "string") {
      return { ok: false, error: "Invalid message." };
    }

    if (message.type === "SUMMARIZE_PAGE") {
      const { pageData, mode } = message;

      if (!pageData || !pageData.url || !pageData.content) {
        return { ok: false, error: "Invalid page data." };
      }

      const safeMode = ["structured", "three_bullets", "insights"].includes(mode)
        ? mode
        : "structured";

      const cacheKey = getCacheKey(pageData.url, safeMode);
      const cached = await getFromStorage(cacheKey);

      if (cached[cacheKey]) {
        return {
          ok: true,
          data: cached[cacheKey],
          cached: true
        };
      }

      const now = Date.now();
      const waitMs = minimumRequestInterval - (now - lastRequestAt);

      if (waitMs > 0) {
        return {
          ok: false,
          error: `Please wait ${Math.ceil(waitMs / 1000)} seconds before summarizing again.`
        };
      }

      lastRequestAt = now;

      const summary = await callSummaryApi({
        ...pageData,
        mode: safeMode
      });
      summary.wordCount = pageData.wordCount || 0;

      await saveToStorage(cacheKey, summary);

      return {
        ok: true,
        data: summary,
        cached: false
      };
    }

    if (message.type === "CLEAR_SUMMARY_CACHE") {
      const { url } = message;

      if (!url) {
        return { ok: false, error: "Missing URL." };
      }

      const keys = [
        getCacheKey(url, "structured"),
        getCacheKey(url, "three_bullets"),
        getCacheKey(url, "insights")
      ];

      await chrome.storage.local.remove(keys);

      return { ok: true };
    }

    return { ok: false, error: "Unknown message type." };
  }

  handleMessage()
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error.message || "Something went wrong."
      });
    });

  return true;
});
