import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;
const xaiApiBaseUrl = process.env.XAI_API_BASE_URL || "https://api.x.ai/v1";
const summaryModels = (process.env.XAI_MODELS || "grok-4.3,grok-4")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

if (!process.env.XAI_API_KEY) {
  console.warn("XAI_API_KEY is missing. Add it to your .env file.");
}

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "X-Extension-Name"]
  })
);

app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.send("xAI summarizer proxy is running.");
});

function estimateReadingTime(wordCount) {
  const wordsPerMinute = 220;
  return Math.max(1, Math.ceil((wordCount || 0) / wordsPerMinute));
}

function getPromptMode(mode) {
  if (mode === "three_bullets") {
    return "Summarize the page in exactly 3 concise bullet points.";
  }

  if (mode === "insights") {
    return "Extract only the most important insights from the page.";
  }

  return "Create a structured summary with bullet points, key insights, and actionable takeaways.";
}

function validateBody(body) {
  if (!body) return "Missing request body.";
  if (!body.title || typeof body.title !== "string") return "Missing page title.";
  if (!body.url || typeof body.url !== "string") return "Missing page URL.";
  if (!body.content || typeof body.content !== "string") return "Missing page content.";
  if (body.content.length < 200) return "Page content is too short to summarize.";
  if (body.content.length > 16000) return "Page content is too long.";
  return null;
}

function trimContentForQuota(content) {
  return content
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Number(process.env.SUMMARY_CONTENT_LIMIT || 4000));
}

function extractJson(text) {
  const cleaned = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const firstCurly = cleaned.indexOf("{");
  const lastCurly = cleaned.lastIndexOf("}");

  if (firstCurly === -1 || lastCurly === -1) {
    throw new Error("No JSON object found.");
  }

  const jsonString = cleaned.slice(firstCurly, lastCurly + 1);
  return JSON.parse(jsonString);
}

function splitSentences(content) {
  return [...new Set(content
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 45 && sentence.length < 280))];
}

function getTopTerms(content) {
  const stopWords = new Set([
    "about", "after", "again", "also", "because", "been", "before", "being", "between",
    "could", "does", "from", "have", "into", "more", "most", "other", "over", "such",
    "than", "that", "their", "there", "these", "they", "this", "through", "were", "when",
    "where", "which", "while", "with", "would", "your"
  ]);
  const counts = new Map();

  content
    .toLowerCase()
    .match(/[a-z][a-z-]{3,}/g)
    ?.forEach((word) => {
      if (!stopWords.has(word)) {
        counts.set(word, (counts.get(word) || 0) + 1);
      }
    });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word]) => word);
}

function createLocalSummary({ content, wordCount, mode }) {
  const sentences = splitSentences(content);
  const terms = getTopTerms(content);
  const scored = sentences
    .map((sentence, index) => {
      const lower = sentence.toLowerCase();
      const termScore = terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
      const positionScore = index < 4 ? 2 : 0;

      return {
        sentence,
        score: termScore + positionScore
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, mode === "three_bullets" ? 3 : 5)
    .map((item) => item.sentence);

  const bullets = mode === "insights" ? scored.slice(0, 2) : scored;
  const insights = [
    terms.length
      ? `Main themes detected: ${terms.slice(0, 5).join(", ")}.`
      : "The page has enough readable text for a high-level summary.",
    "This summary was generated locally because the configured xAI account is not currently able to complete API requests."
  ];
  const takeaways = mode === "insights"
    ? []
    : [
        "Review the highlighted sections for the most information-dense parts of the page.",
        "Enable xAI credits or licenses to replace this local fallback with an AI-generated summary."
      ];

  return {
    bullets,
    insights,
    takeaways,
    estimatedReadingTime: estimateReadingTime(wordCount),
    model: "local-extractive-fallback"
  };
}

function getXaiErrorMessage(error) {
  if (!error) return "Unknown xAI error.";

  if (error.status === 401) {
    return "xAI rejected the API key. Check XAI_API_KEY in your .env file.";
  }

  if (error.status === 403) {
    if (error.message?.toLowerCase().includes("credits or licenses")) {
      return "xAI says this team has no credits or licenses yet. Add credits in the xAI console, then restart the proxy.";
    }

    return "xAI says this key or team does not have permission for the selected model/API. Check credits, team access, and model access in the xAI console.";
  }

  if (error.status === 429) {
    return "xAI rate limit or quota exceeded. Wait for the quota window to reset or check your xAI plan.";
  }

  if (error.status === 500 || error.status === 502 || error.status === 503) {
    return "xAI is temporarily unavailable. Try again shortly.";
  }

  return error.message || "Unknown xAI error.";
}

function isRetryableXaiError(error) {
  return error?.status === 403 || error?.status === 429 || error?.status === 500 || error?.status === 502 || error?.status === 503;
}

async function generateSummary(prompt) {
  if (!process.env.XAI_API_KEY) {
    const error = new Error("Missing XAI_API_KEY.");
    error.status = 401;
    throw error;
  }

  let lastError;

  for (const model of summaryModels) {
    try {
      const response = await fetch(`${xaiApiBaseUrl}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.XAI_API_KEY}`
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: "system",
              content: "You summarize webpages. Return only valid JSON."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.2,
          max_output_tokens: Number(process.env.SUMMARY_MAX_TOKENS || 700)
        })
      });

      const responseText = await response.text();
      let data = {};

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        data = {
          message: responseText
        };
      }

      if (!response.ok) {
        const message =
          (typeof data.error === "string" ? data.error : data.error?.message) ||
          data.message ||
          data.code ||
          `xAI request failed with status ${response.status}.`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }

      return {
        model,
        text:
          data.output_text ||
          data.output?.flatMap((item) => item.content || [])
            .map((content) => content.text || "")
            .join("")
      };
    } catch (error) {
      lastError = error;

      if (!isRetryableXaiError(error)) {
        break;
      }

      console.warn(`xAI model ${model} failed:`, getXaiErrorMessage(error));
    }
  }

  throw lastError;
}

app.post("/api/summarize", async (req, res) => {
  try {
    const validationError = validateBody(req.body);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const { title, url, content, wordCount, mode } = req.body;
    const promptMode = getPromptMode(mode);
    const estimatedReadingTime = estimateReadingTime(wordCount);
    const trimmedContent = trimContentForQuota(content);
    const prompt = `
Summarize this webpage. ${promptMode}
Return only JSON: {"bullets":["string"],"insights":["string"],"takeaways":["string"]}
Title: ${title}
URL: ${url}
Content: ${trimmedContent}
    `.trim();

    const response = await generateSummary(prompt);
    const rawText = response.text;

    if (!rawText) {
      return res.status(502).json({
        error: "No summary returned by xAI."
      });
    }

    let parsed;

    try {
      parsed = extractJson(rawText);
    } catch (error) {
      console.error("Invalid xAI JSON:", rawText);

      return res.status(502).json({
        error: "xAI returned invalid JSON."
      });
    }

    return res.json({
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets : [],
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways : [],
      estimatedReadingTime,
      model: response.model
    });
  } catch (error) {
    console.error("xAI summary error:", error);

    if (process.env.ALLOW_LOCAL_FALLBACK !== "false") {
      const { content, wordCount, mode } = req.body || {};

      return res.json(createLocalSummary({
        content: content || "",
        wordCount,
        mode
      }));
    }

    return res.status(500).json({
      error: `Failed to summarize page with xAI: ${getXaiErrorMessage(error)}`
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found."
  });
});

app.listen(port, () => {
  console.log(`xAI summarizer proxy running on http://localhost:${port}`);
});
