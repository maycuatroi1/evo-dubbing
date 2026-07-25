import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  audioDurationMs,
  ensureDirectory,
  requestWithRetry,
  safeError,
  sourceMinutes,
  summarizeItems
} from "./common.mjs";

function findAudioReference(value) {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && ["audio", "audioContent", "audioLink", "audio_url", "url"].includes(key)) {
      return { key, value: child };
    }
    const nested = findAudioReference(child);
    if (nested) return nested;
  }
  return null;
}

async function audioFromResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("audio") || contentType.includes("octet-stream")) {
    return Buffer.from(await response.arrayBuffer());
  }
  const data = await response.json();
  const reference = findAudioReference(data);
  if (!reference) throw new Error("TTS response did not include audio");
  if (!reference.value.startsWith("http") && (reference.key === "audio" || reference.key === "audioContent")) {
    return Buffer.from(reference.value, "base64");
  }
  const { response: audioResponse } = await requestWithRetry(() => fetch(reference.value));
  return Buffer.from(await audioResponse.arrayBuffer());
}

async function synthesizeGoogle(provider, text, credentials) {
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(credentials[0])}`;
  const body = JSON.stringify({
    input: { text },
    voice: { languageCode: "vi-VN", name: provider.voice },
    audioConfig: { audioEncoding: "MP3" }
  });
  const { response, latencyMs, attempts } = await requestWithRetry(() => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  }));
  const data = await response.json();
  if (!data.audioContent) throw new Error("Google TTS returned no audio");
  return { audio: Buffer.from(data.audioContent, "base64"), latencyMs, attempts };
}

function wavFromPcm(pcm, sampleRate = 24000, channels = 1, bytesPerSample = 2) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * bytesPerSample;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(bytesPerSample * 8, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function synthesizeGoogleGemini(provider, text, credentials) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(credentials[0])}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: `Đọc tự nhiên, rõ ràng bằng tiếng Việt: ${text}` }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: provider.voice } } }
    }
  });
  const { response, latencyMs, attempts } = await requestWithRetry(() => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  }));
  const data = await response.json();
  const part = data.candidates?.[0]?.content?.parts?.find((value) => value.inlineData?.data);
  if (!part) throw new Error("Google Gemini TTS returned no audio");
  return { audio: wavFromPcm(Buffer.from(part.inlineData.data, "base64")), latencyMs, attempts, extension: "wav" };
}

async function synthesizeOpenai(provider, text, credentials) {
  const body = JSON.stringify({
    model: provider.model,
    voice: provider.voice,
    input: text,
    instructions: "Doc ro rang, tu nhien, dung ngu dieu tieng Viet, giu nguyen thuat ngu tieng Anh.",
    response_format: "mp3"
  });
  const { response, latencyMs, attempts } = await requestWithRetry(() => fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials[0]}`,
      "Content-Type": "application/json"
    },
    body
  }));
  return { audio: Buffer.from(await response.arrayBuffer()), latencyMs, attempts };
}

async function synthesizeVbee(provider, text, credentials) {
  const body = JSON.stringify({
    text,
    mode: "sync",
    voiceCode: provider.voice,
    outputFormat: "mp3",
    bitrate: 128,
    speed: 1
  });
  const { response, latencyMs, attempts } = await requestWithRetry(() => fetch("https://api.vbee.vn/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials[1]}`,
      "App-Id": credentials[0],
      "Content-Type": "application/json"
    },
    body
  }));
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("json")) throw new Error("Vbee returned metadata instead of audio");
  return { audio: Buffer.from(await response.arrayBuffer()), latencyMs, attempts };
}

async function synthesizeFpt(provider, text, credentials) {
  const startedAt = performance.now();
  const { response, attempts } = await requestWithRetry(() => fetch("https://api.fpt.ai/hmi/tts/v5", {
    method: "POST",
    headers: {
      "api-key": credentials[0],
      voice: provider.voice,
      speed: "0"
    },
    body: text
  }));
  const data = await response.json();
  const reference = findAudioReference(data);
  if (!reference || !reference.value.startsWith("http")) throw new Error("FPT.AI returned no audio reference");
  let lastStatus = null;
  for (let poll = 0; poll < 60; poll += 1) {
    const audioResponse = await fetch(reference.value);
    lastStatus = audioResponse.status;
    if (audioResponse.ok) {
      const audio = Buffer.from(await audioResponse.arrayBuffer());
      if (audio.length > 512) return { audio, latencyMs: Math.round(performance.now() - startedAt), attempts };
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  throw new Error(`FPT.AI audio did not become ready, last HTTP ${lastStatus}`);
}

async function synthesizeViettel(provider, text, credentials) {
  const body = JSON.stringify({
    text,
    voice: provider.voice,
    speed: 1,
    tts_return_option: 2,
    without_filter: false
  });
  const { response, latencyMs, attempts } = await requestWithRetry(() => fetch("https://viettelai.vn/tts/speech_synthesis", {
    method: "POST",
    headers: { token: credentials[0], "Content-Type": "application/json" },
    body
  }));
  return { audio: await audioFromResponse(response), latencyMs, attempts };
}

async function synthesizeVnpt(provider, text, credentials) {
  const body = JSON.stringify({
    text,
    text_split: false,
    speed: 1,
    region: "north",
    gender: "female",
    language: "vi"
  });
  const { response, latencyMs, attempts } = await requestWithRetry(() => fetch("https://api.idg.vnpt.vn/tts-service/v2/standard", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials[0]}`,
      "Token-id": credentials[1],
      "Token-key": credentials[2],
      "Content-Type": "application/json"
    },
    body
  }));
  return { audio: await audioFromResponse(response), latencyMs, attempts };
}

async function synthesize(provider, text, credentials) {
  if (provider.provider === "google") return synthesizeGoogle(provider, text, credentials);
  if (provider.provider === "google-gemini") return synthesizeGoogleGemini(provider, text, credentials);
  if (provider.provider === "openai") return synthesizeOpenai(provider, text, credentials);
  if (provider.provider === "vbee") return synthesizeVbee(provider, text, credentials);
  if (provider.provider === "fpt") return synthesizeFpt(provider, text, credentials);
  if (provider.provider === "viettel") return synthesizeViettel(provider, text, credentials);
  if (provider.provider === "vnpt") return synthesizeVnpt(provider, text, credentials);
  throw new Error(`Unsupported TTS provider: ${provider.provider}`);
}

export async function runTts(provider, corpus, credentials, runId, runDirectory) {
  const startedAt = new Date().toISOString();
  const audioDirectory = resolve(runDirectory, "audio", provider.id);
  await ensureDirectory(audioDirectory);
  const items = [];
  for (const corpusItem of corpus.items) {
    const characters = [...corpusItem.targetText].length;
    try {
      const result = await synthesize(provider, corpusItem.targetText, credentials);
      if (result.audio.length < 512) throw new Error("TTS returned an empty audio payload");
        const durationMs = audioDurationMs(result.audio);
        const relativeAudioFile = `audio/${provider.id}/${corpusItem.id}.${result.extension || "mp3"}`;
      await writeFile(resolve(runDirectory, relativeAudioFile), result.audio);
      items.push({
        id: corpusItem.id,
        status: "completed",
        latencyMs: result.latencyMs,
        firstAudioMs: result.latencyMs,
        outputDurationMs: durationMs,
        attempts: result.attempts,
        inputCharacters: characters,
        retryCharacters: characters * Math.max(0, result.attempts - 1),
        audioBytes: result.audio.length,
        audioFile: relativeAudioFile
      });
    } catch (error) {
      items.push({
        id: corpusItem.id,
        status: "failed",
        latencyMs: null,
        firstAudioMs: null,
        outputDurationMs: null,
        attempts: 2,
        inputCharacters: characters,
        retryCharacters: characters,
        audioBytes: null,
        audioFile: null,
        error: safeError(error)
      });
    }
  }
  const summary = summarizeItems(items);
  const outputDurations = items.filter((item) => item.outputDurationMs !== null).map((item) => item.outputDurationMs);
  return {
    schemaVersion: 1,
    runId,
    kind: "tts",
    providerId: provider.id,
    model: provider.model,
    voice: provider.voice,
    startedAt,
    completedAt: new Date().toISOString(),
    status: summary.successCount === items.length ? "completed" : summary.successCount ? "partial" : "failed",
    sourceMinutes: sourceMinutes(corpus),
    metrics: {
      ...summary,
      p95FirstAudioMs: summary.p95LatencyMs,
      inputCharacters: items.reduce((total, item) => total + item.inputCharacters, 0),
      retryCharacters: items.reduce((total, item) => total + item.retryCharacters, 0),
      outputDurationMs: outputDurations.reduce((total, value) => total + value, 0),
      averageOutputDurationMs: outputDurations.length
        ? Math.round(outputDurations.reduce((total, value) => total + value, 0) / outputDurations.length)
        : null
    },
    items
  };
}
