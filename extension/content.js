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
    ".newsletter"
  ];

  selectorsToRemove.forEach((selector) => {
    clonedDocument.querySelectorAll(selector).forEach((element) => element.remove());
  });

  const article =
    clonedDocument.querySelector("article") ||
    clonedDocument.querySelector("main") ||
    clonedDocument.querySelector("[role='main']") ||
    clonedDocument.body;

  const title = document.title || "Untitled Page";

  const headings = Array.from(article.querySelectorAll("h1, h2, h3"))
    .map((heading) => heading.innerText.trim())
    .filter(Boolean);

  const paragraphs = Array.from(article.querySelectorAll("p, li"))
    .map((node) => node.innerText.trim())
    .filter((text) => text.length > 40);

  const content = [...headings, ...paragraphs]
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
  const paragraphs = Array.from(document.querySelectorAll("article p, main p, p"));

  const strongParagraphs = paragraphs
    .filter((paragraph) => paragraph.innerText.trim().length > 120)
    .slice(0, 3);

  strongParagraphs.forEach((paragraph) => {
    paragraph.style.background = "rgba(255, 230, 120, 0.45)";
    paragraph.style.borderRadius = "6px";
    paragraph.style.padding = "4px";
  });

  return strongParagraphs.length;
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

  sendResponse({ ok: false, error: "Unknown message type." });
  return true;
});