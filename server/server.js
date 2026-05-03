import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

if (!process.env.GEMINI_API_KEY) {
  console.warn("⚠️ GEMINI_API_KEY is missing. Add it to your .env file.");
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "X-Extension-Name"]
  })
);

app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.send("Gemini summarizer proxy is running.");
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

app.post("/api/summarize", async (req, res) => {
  try {
    const validationError = validateBody(req.body);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const { title, url, content, wordCount, mode } = req.body;

    const promptMode = getPromptMode(mode);
    const estimatedReadingTime = estimateReadingTime(wordCount);

    const prompt = `
You are a careful webpage summarizer.

${promptMode}

Return only valid JSON.
Do not include markdown.
Do not invent facts.

Use this exact JSON shape:
{
  "bullets": ["string"],
  "insights": ["string"],
  "takeaways": ["string"]
}

Rules:
- Keep each bullet clear and useful.
- Avoid repeating the same point.
- If the page is technical, explain it simply.
- If there are no actionable takeaways, return an empty takeaways array.
- Do not include anything outside the JSON object.

Page title: ${title}
Page URL: ${url}
Estimated reading time: ${estimatedReadingTime} minutes

Page content:
${content}
    `.trim();

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt
    });

    const rawText = response.text;

    if (!rawText) {
      return res.status(502).json({
        error: "No summary returned by Gemini."
      });
    }

    let parsed;

    try {
      parsed = extractJson(rawText);
    } catch (error) {
      console.error("Invalid Gemini JSON:", rawText);

      return res.status(502).json({
        error: "Gemini returned invalid JSON."
      });
    }

    return res.json({
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets : [],
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways : [],
      estimatedReadingTime
    });
  } catch (error) {
    console.error("Gemini summary error:", error);

    return res.status(500).json({
      error: "Failed to summarize page with Gemini."
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found."
  });
});

app.listen(port, () => {
  console.log(`Gemini summarizer proxy running on http://localhost:${port}`);
});