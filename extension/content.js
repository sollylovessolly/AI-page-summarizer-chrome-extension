const highlightClass = "ai-summary-highlight";

function scoreContentNode(node) {
  const text = node.innerText?.trim() || "";
  const paragraphCount = node.querySelectorAll("p").length;
  const headingCount = node.querySelectorAll("h1, h2, h3").length;
  const linkTextLength = Array.from(node.querySelectorAll("a"))
    .map((link) => link.innerText || "")
    .join(" ")
    .length;
  const linkDensity = text.length ? linkTextLength / text.length : 0;

  return text.length + paragraphCount * 120 + headingCount * 60 - linkDensity * 500;
}

function getBestContentRoot(clonedDocument) {
  const preferred =
    clonedDocument.querySelector("article") ||
    clonedDocument.querySelector("main") ||
    clonedDocument.querySelector("[role='main']");

  if (preferred) return preferred;

  const candidates = Array.from(
    clonedDocument.querySelectorAll("section, div, body")
  ).filter((node) => (node.innerText || "").trim().length > 500);

  return candidates.sort((a, b) => scoreContentNode(b) - scoreContentNode(a))[0] || clonedDocument.body;
}

function getReadableText() {
  const clonedDocument = document.cloneNode(true);

  const selectorsToRemove = [
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "canvas",
    "nav",
    "aside",
    "footer",
    "header",
    "form",
    "button",
    "[role='navigation']",
    "[role='banner']",
    "[role='contentinfo']",
    ".sidebar",
    ".nav",
    ".menu",
    ".ads",
    ".advertisement",
    ".cookie",
    ".newsletter",
    ".modal",
    ".popover",
    ".breadcrumb",
    ".comments",
    "[aria-hidden='true']"
  ];

  selectorsToRemove.forEach((selector) => {
    clonedDocument.querySelectorAll(selector).forEach((element) => element.remove());
  });

  const article = getBestContentRoot(clonedDocument);

  const title = document.title || "Untitled Page";

  const headings = Array.from(article.querySelectorAll("h1, h2, h3"))
    .map((heading) => heading.innerText.trim())
    .filter(Boolean);

  const paragraphs = Array.from(article.querySelectorAll("p, li"))
    .map((node) => node.innerText.trim())
    .filter((text) => text.length > 40);

  const content = [...new Set([...headings, ...paragraphs])]
    .join("\n\n")
    .replace(/\s{2,}/g, " ")
    .trim();

  const wordCount = content.split(/\s+/).filter(Boolean).length;

  return {
    title,
    url: window.location.href,
    content: content.slice(0, 15000),
    wordCount
  };
}

function highlightImportantSections() {
  clearHighlights();

  const paragraphs = Array.from(document.querySelectorAll("article p, main p, p"));

  const strongParagraphs = paragraphs
    .filter((paragraph) => {
      const text = paragraph.innerText.trim();
      return text.length > 120 && text.split(/\s+/).length > 20;
    })
    .slice(0, 3);

  strongParagraphs.forEach((paragraph) => {
    paragraph.classList.add(highlightClass);
  });

  return strongParagraphs.length;
}

function clearHighlights() {
  document.querySelectorAll(`.${highlightClass}`).forEach((element) => {
    element.classList.remove(highlightClass);
  });
}

function injectHighlightStyles() {
  if (document.getElementById("ai-summary-highlight-style")) return;

  const style = document.createElement("style");
  style.id = "ai-summary-highlight-style";
  style.textContent = `
    .${highlightClass} {
      background: rgba(255, 228, 138, 0.58) !important;
      border-left: 4px solid #7a1f31 !important;
      border-radius: 6px !important;
      padding: 6px 8px !important;
      transition: background 160ms ease;
    }
  `;
  document.documentElement.appendChild(style);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    sendResponse({ ok: false, error: "Invalid message." });
    return true;
  }

  if (message.type === "EXTRACT_PAGE_CONTENT") {
    try {
      const pageData = getReadableText();

      if (!pageData.content || pageData.content.length < 200) {
        sendResponse({
          ok: false,
          error: "Could not extract enough readable content from this page."
        });
        return true;
      }

      sendResponse({ ok: true, data: pageData });
    } catch (error) {
      sendResponse({
        ok: false,
        error: "Failed to extract page content."
      });
    }

    return true;
  }

  if (message.type === "HIGHLIGHT_IMPORTANT_SECTIONS") {
    try {
      injectHighlightStyles();
      const count = highlightImportantSections();
      sendResponse({ ok: true, count });
    } catch (error) {
      sendResponse({
        ok: false,
        error: "Failed to highlight sections."
      });
    }

    return true;
  }

  if (message.type === "CLEAR_HIGHLIGHTS") {
    clearHighlights();
    sendResponse({ ok: true });
    return true;
  }

  sendResponse({ ok: false, error: "Unknown message type." });
  return true;
});
