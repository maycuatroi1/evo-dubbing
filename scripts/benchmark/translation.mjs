import { requestWithRetry, safeError, sourceMinutes, summarizeItems } from "./common.mjs";

function translationPrompt(sourceText) {
  return [
    "Translate this English video subtitle into natural Vietnamese for spoken dubbing.",
    "Preserve names, numbers, technical terms, and code-switching when natural.",
    "Return only the Vietnamese translation with no explanation.",
    sourceText
  ].join("\n");
}

function geminiText(data) {
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
}

function openAiText(data) {
  if (typeof data.output_text === "string") return data.output_text.trim();
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text || "")
    .join("")
    .trim();
}

async function translateGemini(provider, sourceText, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: translationPrompt(sourceText) }] }],
    generationConfig: { temperature: 0.3 }
  });
  const { response, latencyMs, attempts } = await requestWithRetry(() => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  }));
  const data = await response.json();
  const outputText = geminiText(data);
  if (!outputText) throw new Error("Gemini returned an empty translation");
  return {
    outputText,
    latencyMs,
    attempts,
    inputTokens: data.usageMetadata?.promptTokenCount ?? null,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? null
  };
}

async function translateOpenAi(provider, sourceText, apiKey) {
  const body = JSON.stringify({
    model: provider.model,
    input: translationPrompt(sourceText),
    max_output_tokens: 256
  });
  const { response, latencyMs, attempts } = await requestWithRetry(() => fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body
  }));
  const data = await response.json();
  const outputText = openAiText(data);
  if (!outputText) throw new Error("OpenAI returned an empty translation");
  return {
    outputText,
    latencyMs,
    attempts,
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null
  };
}

export async function runTranslation(provider, corpus, credentials, runId) {
  const startedAt = new Date().toISOString();
  const items = [];
  for (const corpusItem of corpus.items) {
    try {
      const result = provider.provider === "gemini"
        ? await translateGemini(provider, corpusItem.sourceText, credentials[0])
        : await translateOpenAi(provider, corpusItem.sourceText, credentials[0]);
      items.push({
        id: corpusItem.id,
        status: "completed",
        outputText: result.outputText,
        latencyMs: result.latencyMs,
        attempts: result.attempts,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens
      });
    } catch (error) {
      items.push({
        id: corpusItem.id,
        status: "failed",
        latencyMs: null,
        attempts: 2,
        inputTokens: null,
        outputTokens: null,
        error: safeError(error)
      });
    }
  }
  const summary = summarizeItems(items);
  return {
    schemaVersion: 1,
    runId,
    kind: "translation",
    providerId: provider.id,
    model: provider.model,
    startedAt,
    completedAt: new Date().toISOString(),
    status: summary.successCount === items.length ? "completed" : summary.successCount ? "partial" : "failed",
    sourceMinutes: sourceMinutes(corpus),
    metrics: {
      ...summary,
      inputTokens: items.reduce((total, item) => total + (item.inputTokens || 0), 0),
      outputTokens: items.reduce((total, item) => total + (item.outputTokens || 0), 0)
    },
    items
  };
}
