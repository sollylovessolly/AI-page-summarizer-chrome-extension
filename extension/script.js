const pageTitle = document.getElementById("pageTitle");
const summarizeBtn = document.getElementById("summarizeBtn");
const clearBtn = document.getElementById("clearBtn");
const copyBtn = document.getElementById("copyBtn");
const summaryMode = document.getElementById("summaryMode");
const loading = document.getElementById("loading");
const errorBox = document.getElementById("error");
const summaryContainer = document.getElementById("summaryContainer");
const summaryOutput = document.getElementById("summaryOutput");
const readingTime = document.getElementById("readingTime");

let currentTab = null;
let latestSummaryText = "";

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

function renderSummary(summary) {
  const html = [
    renderList("Summary", summary.bullets),
    renderList("Key Insights", summary.insights),
    renderList("Actionable Takeaways", summary.takeaways)
  ].join("");

  summaryOutput.innerHTML = html || "<p>No summary available.</p>";

  readingTime.textContent = summary.estimatedReadingTime
    ? `${summary.estimatedReadingTime} min read`
    : "";

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
  return await chrome.tabs.sendMessage(tabId, message);
}

async function sendMessageToBackground(message) {
  return await chrome.runtime.sendMessage(message);
}

async function initializePopup() {
  currentTab = await getActiveTab();

  if (!currentTab) {
    pageTitle.textContent = "No active tab found";
    summarizeBtn.disabled = true;
    return;
  }

  pageTitle.textContent = currentTab.title || "Untitled Page";
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

    renderSummary(result.data);

    await sendMessageToTab(currentTab.id, {
      type: "HIGHLIGHT_IMPORTANT_SECTIONS"
    });
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

initializePopup();