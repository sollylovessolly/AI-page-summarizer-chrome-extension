const pageTitle = document.getElementById("pageTitle");
const summarizeBtn = document.getElementById("summarizeBtn");
const clearBtn = document.getElementById("clearBtn");
const copyBtn = document.getElementById("copyBtn");
const summaryMode = document.getElementById("summaryMode");
const highlightToggle = document.getElementById("highlightToggle");
const themeMode = document.getElementById("themeMode");
const loading = document.getElementById("loading");
const errorBox = document.getElementById("error");
const summaryContainer = document.getElementById("summaryContainer");
const summaryOutput = document.getElementById("summaryOutput");
const summaryStats = document.getElementById("summaryStats");

let currentTab = null;
let latestSummaryText = "";
const settingsKey = "popupSettings";

function setLoading(isLoading) {
  loading.classList.toggle("hidden", !isLoading);
  summarizeBtn.disabled = isLoading;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

function canAccessTab(tab) {
  return /^https?:\/\//.test(tab?.url || "");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderList(title, items) {
  if (!Array.isArray(items) || items.length === 0) return "";

  return `
    <h2>${escapeHtml(title)}</h2>
    <ul>
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function applyTheme(theme) {
  document.body.dataset.theme = theme || "auto";
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(settingsKey);
  const settings = stored[settingsKey] || {};

  summaryMode.value = settings.summaryMode || "structured";
  highlightToggle.checked = settings.highlightImportantSections !== false;
  themeMode.value = settings.themeMode || "auto";
  applyTheme(themeMode.value);
}

async function saveSettings() {
  const settings = {
    summaryMode: summaryMode.value,
    highlightImportantSections: highlightToggle.checked,
    themeMode: themeMode.value
  };

  await chrome.storage.local.set({ [settingsKey]: settings });
}

function renderSummary(summary, metadata = {}) {
  const html = [
    renderList("Summary", summary.bullets),
    renderList("Key Insights", summary.insights),
    renderList("Actionable Takeaways", summary.takeaways)
  ].join("");

  summaryOutput.innerHTML = html || "<p>No summary available.</p>";

  const stats = [];

  if (summary.estimatedReadingTime) {
    stats.push(`${summary.estimatedReadingTime} min read`);
  }

  if (summary.wordCount) {
    stats.push(`${summary.wordCount.toLocaleString()} words`);
  }

  if (metadata.cached) {
    stats.push("cached");
  }

  if (summary.model) {
    stats.push(summary.model);
  }

  summaryStats.textContent = stats.join(" · ");

  latestSummaryText = [
    "Summary:",
    ...(summary.bullets || []),
    "",
    "Key Insights:",
    ...(summary.insights || []),
    "",
    "Actionable Takeaways:",
    ...(summary.takeaways || [])
  ].join("\n");

  summaryContainer.classList.remove("hidden");
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}

async function sendMessageToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!error.message?.includes("Receiving end does not exist")) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });

    return await chrome.tabs.sendMessage(tabId, message);
  }
}

async function sendMessageToBackground(message) {
  return await chrome.runtime.sendMessage(message);
}

async function initializePopup() {
  await loadSettings();

  currentTab = await getActiveTab();

  if (!currentTab) {
    pageTitle.textContent = "No active tab found";
    summarizeBtn.disabled = true;
    return;
  }

  pageTitle.textContent = currentTab.title || "Untitled Page";

  if (!canAccessTab(currentTab)) {
    showError("Open an article or webpage to summarize. Browser pages cannot be read by extensions.");
    summarizeBtn.disabled = true;
  }
}

async function summarizeCurrentPage() {
  clearError();
  setLoading(true);

  try {
    if (!currentTab?.id) {
      throw new Error("No active tab found.");
    }

    const extracted = await sendMessageToTab(currentTab.id, {
      type: "EXTRACT_PAGE_CONTENT"
    });

    if (!extracted.ok) {
      throw new Error(extracted.error);
    }

    const result = await sendMessageToBackground({
      type: "SUMMARIZE_PAGE",
      pageData: extracted.data,
      mode: summaryMode.value
    });

    if (!result.ok) {
      throw new Error(result.error);
    }

    renderSummary(result.data, {
      cached: result.cached
    });

    if (highlightToggle.checked) {
      try {
        await sendMessageToTab(currentTab.id, {
          type: "HIGHLIGHT_IMPORTANT_SECTIONS"
        });
      } catch {
        // Highlighting is optional; keep the summary visible if page styling blocks it.
      }
    }
  } catch (error) {
    showError(error.message || "Failed to summarize page.");
  } finally {
    setLoading(false);
  }
}

async function clearSummary() {
  clearError();
  summaryOutput.innerHTML = "";
  latestSummaryText = "";
  summaryContainer.classList.add("hidden");

  if (currentTab?.url) {
    await sendMessageToBackground({
      type: "CLEAR_SUMMARY_CACHE",
      url: currentTab.url
    });

    if (currentTab.id && canAccessTab(currentTab)) {
      try {
        await sendMessageToTab(currentTab.id, {
          type: "CLEAR_HIGHLIGHTS"
        });
      } catch {
        // Ignore optional highlight cleanup failures on restricted pages.
      }
    }
  }
}

async function copySummary() {
  if (!latestSummaryText) return;

  await navigator.clipboard.writeText(latestSummaryText);
  copyBtn.textContent = "Copied";

  setTimeout(() => {
    copyBtn.textContent = "Copy";
  }, 1200);
}

summarizeBtn.addEventListener("click", summarizeCurrentPage);
clearBtn.addEventListener("click", clearSummary);
copyBtn.addEventListener("click", copySummary);
summaryMode.addEventListener("change", saveSettings);
highlightToggle.addEventListener("change", saveSettings);
themeMode.addEventListener("change", () => {
  applyTheme(themeMode.value);
  saveSettings();
});

initializePopup();
