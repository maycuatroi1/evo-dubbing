import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const rootDirectory = fileURLToPath(new URL("../..", import.meta.url));
export const benchmarkDirectory = resolve(rootDirectory, "benchmarks", "tts-vi");
export const artifactsDirectory = resolve(benchmarkDirectory, "artifacts");
export const corpusPath = resolve(benchmarkDirectory, "corpus.json");
export const providersPath = resolve(benchmarkDirectory, "providers.json");
export const credentialScript = resolve(rootDirectory, "scripts", "benchmark", "get_credential.py");

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
}

export function parseArguments(argv) {
  const options = {
    dryRun: process.env.npm_config_dry_run === "true",
    kind: process.env.npm_config_kind || "all",
    providers: process.env.npm_config_providers?.split(",").filter(Boolean) || null,
    runId: process.env.npm_config_run_id || null,
    prepare: process.env.npm_config_prepare === "true",
    importRatings: process.env.npm_config_import === "true",
    ratings: process.env.npm_config_ratings || null,
    reviewers: process.env.npm_config_reviewers || null,
    exports: process.env.npm_config_exports || null,
    validate: process.env.npm_config_validate || null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--prepare") options.prepare = true;
    else if (argument === "--import") options.importRatings = true;
    else if (argument === "--kind") options.kind = argv[++index];
    else if (argument === "--providers") options.providers = argv[++index].split(",").filter(Boolean);
    else if (argument === "--run-id") options.runId = argv[++index];
    else if (argument === "--ratings") options.ratings = argv[++index];
    else if (argument === "--reviewers") options.reviewers = argv[++index];
    else if (argument === "--exports") options.exports = argv[++index];
    else if (argument === "--validate") options.validate = argv[++index];
    else if (!argument.startsWith("--") && [options.runId, options.ratings, options.reviewers, options.exports, options.validate].includes(argument)) {
      continue;
    } else if (!argument.startsWith("--") && ["all", "translation", "tts"].includes(argument)) {
      options.kind = argument;
    } else if (!argument.startsWith("--")) {
      options.providers = argument.split(",").filter(Boolean);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!["all", "translation", "tts"].includes(options.kind)) {
    throw new Error(`Invalid benchmark kind: ${options.kind}`);
  }
  return options;
}

export function loadCredential(path) {
  const result = spawnSync("python", [credentialScript, path], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return value || null;
}

export function loadProviderCredentials(provider) {
  const values = [];
  const missing = [];
  for (let index = 0; index < provider.credentialPaths.length; index += 1) {
    const environmentVariable = provider.environmentVariables[index];
    const value = loadCredential(provider.credentialPaths[index]) || process.env[environmentVariable];
    if (value) values.push(value);
    else {
      values.push(null);
      missing.push(provider.credentialPaths[index]);
    }
  }
  return { values, missing, available: missing.length === 0 };
}

export function validateCorpus(corpus) {
  if (!corpus || !Array.isArray(corpus.items) || corpus.items.length !== 30) {
    throw new Error("Corpus must contain exactly 30 items");
  }
  const ids = new Set();
  const regions = { north: 0, central: 0, south: 0 };
  const coverage = new Set();
  for (const item of corpus.items) {
    if (!item.id || ids.has(item.id)) throw new Error(`Corpus ID is missing or duplicated: ${item.id || "<missing>"}`);
    ids.add(item.id);
    if (!(item.region in regions)) throw new Error(`Invalid corpus region: ${item.region}`);
    regions[item.region] += 1;
    if (!item.sourceText || !item.targetText) throw new Error(`Corpus text is missing: ${item.id}`);
    if (!Array.isArray(item.coverage) || item.coverage.length === 0) throw new Error(`Coverage is missing: ${item.id}`);
    if (!Array.isArray(item.pronunciationTargets) || item.pronunciationTargets.length === 0) {
      throw new Error(`Pronunciation targets are missing: ${item.id}`);
    }
    for (const value of item.coverage) coverage.add(value);
  }
  if (Object.values(regions).some((count) => count !== 10)) {
    throw new Error(`Corpus regions must contain 10 items each: ${JSON.stringify(regions)}`);
  }
  for (const required of ["personal-name", "place-name", "ai", "code-switching"]) {
    if (!coverage.has(required)) throw new Error(`Corpus coverage is missing: ${required}`);
  }
  if (![...coverage].some((value) => value.includes("number") || value === "decimal" || value === "percentage")) {
    throw new Error("Corpus coverage is missing numbers");
  }
  return { count: corpus.items.length, regions, coverage: [...coverage].sort() };
}

export function createRunId() {
  return new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
}

export function sourceMinutes(corpus) {
  const words = corpus.items.reduce((total, item) => total + item.sourceText.trim().split(/\s+/).length, 0);
  return words / corpus.sourceWordsPerMinute;
}

export function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1);
  return Math.round(sorted[index]);
}

export function summarizeItems(items) {
  const successes = items.filter((item) => item.status === "completed");
  const latencies = successes.map((item) => item.latencyMs);
  return {
    requestCount: items.length,
    successCount: successes.length,
    errorCount: items.length - successes.length,
    errorRate: items.length ? (items.length - successes.length) / items.length : null,
    retryCount: items.reduce((total, item) => total + Math.max(0, (item.attempts || 1) - 1), 0),
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95)
  };
}

export function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9._-]+/g, "<redacted>")
    .replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/[?&](?:key|token|api_key)=[^\s&]+/gi, "<redacted-param>")
    .slice(0, 240);
}

export async function requestWithRetry(request, maximumAttempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const startedAt = performance.now();
    try {
      const response = await request();
      const latencyMs = Math.round(performance.now() - startedAt);
      if (response.ok) return { response, latencyMs, attempts: attempt };
      if (attempt < maximumAttempts && (response.status === 429 || response.status >= 500)) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500 * attempt));
        continue;
      }
      let detail = "";
      try {
        const data = await response.clone().json();
        const status = data.error?.status || data.status || "";
        const message = data.error?.message || data.message || "";
        detail = safeError([status, message].filter(Boolean).join(": "));
      } catch {
        detail = "";
      }
      throw new Error(`Provider request failed with HTTP ${response.status}${detail ? ` (${detail})` : ""}`);
    } catch (error) {
      lastError = error;
      if (attempt >= maximumAttempts) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500 * attempt));
    }
  }
  throw lastError;
}

function mp3DurationMs(buffer) {
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    offset = 10 + size;
  }
  const mpeg1Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const mpeg2Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const baseSampleRates = [44100, 48000, 32000, 0];
  let durationSeconds = 0;
  let frames = 0;
  while (offset + 4 <= bytes.length) {
    const header = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (((header & 0xffe00000) >>> 0) !== 0xffe00000) {
      offset += 1;
      continue;
    }
    const versionBits = (header >>> 19) & 0x3;
    const layerBits = (header >>> 17) & 0x3;
    const bitrateIndex = (header >>> 12) & 0xf;
    const sampleRateIndex = (header >>> 10) & 0x3;
    const padding = (header >>> 9) & 0x1;
    if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
      offset += 1;
      continue;
    }
    const isMpeg1 = versionBits === 3;
    const bitrate = (isMpeg1 ? mpeg1Bitrates : mpeg2Bitrates)[bitrateIndex];
    const divisor = versionBits === 2 ? 2 : versionBits === 0 ? 4 : 1;
    const sampleRate = baseSampleRates[sampleRateIndex] / divisor;
    const frameLength = Math.floor((isMpeg1 ? 144000 : 72000) * bitrate / sampleRate) + padding;
    if (!frameLength || offset + frameLength > bytes.length) break;
    durationSeconds += (isMpeg1 ? 1152 : 576) / sampleRate;
    frames += 1;
    offset += frameLength;
  }
  if (!frames) throw new Error("Audio duration parser found no MP3 frames");
  return Math.round(durationSeconds * 1000);
}

function wavDurationMs(buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }
  let offset = 12;
  let byteRate = null;
  let dataSize = null;
  while (offset + 8 <= buffer.length) {
    const chunk = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (chunk === "fmt " && size >= 12) byteRate = buffer.readUInt32LE(offset + 16);
    if (chunk === "data") dataSize = size;
    offset += 8 + size + (size % 2);
  }
  if (!byteRate || dataSize === null) return null;
  return Math.round(dataSize / byteRate * 1000);
}

export function audioDurationMs(buffer) {
  return wavDurationMs(buffer) ?? mp3DurationMs(buffer);
}

export function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}
