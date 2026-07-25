import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { providersPath, readJson } from "./common.mjs";

const reportScript = fileURLToPath(new URL("./report.mjs", import.meta.url));
const config = await readJson(providersPath);

function completeReport() {
  return {
    schemaVersion: 1,
    priceDate: config.priceDate,
    translationProviders: config.translation.map((provider) => ({
      providerId: provider.id,
      priceDate: provider.pricing.priceDate,
      priceSourceUrl: provider.pricing.sourceUrl,
      p95LatencyMs: 1000,
      projectedCogs300Vnd: 1000
    })),
    ttsProviders: config.tts.map((provider) => ({
      providerId: provider.id,
      priceDate: provider.pricing.priceDate,
      priceSourceUrl: provider.pricing.sourceUrl,
      listPrice: 1000,
      effectivePaidQuotaCharacters: 1000000,
      p95FirstAudioMs: 1000,
      pronunciationScore: 4.5,
      projectedCogs300Vnd: 30000
    })),
    selection: {
      translationPrimary: "gemini-flash-lite",
      ttsPrimary: "vbee",
      fallbackTts: "google-wavenet"
    }
  };
}

async function validateFixture(mutator) {
  const directory = await mkdtemp(resolve(tmpdir(), "evo-benchmark-report-"));
  try {
    const report = completeReport();
    mutator(report);
    const path = resolve(directory, "report.json");
    await writeFile(path, `${JSON.stringify(report)}\n`, "utf8");
    return spawnSync(process.execPath, [reportScript, "--validate", path], {
      encoding: "utf8",
      windowsHide: true
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("complete report passes", async () => {
  const result = await validateFixture(() => {});
  assert.equal(result.status, 0, result.stderr);
});

test("report fails when a required provider is missing", async () => {
  const result = await validateFixture((report) => report.ttsProviders.shift());
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing-provider/);
});

test("report fails when price date is missing", async () => {
  const result = await validateFixture((report) => { report.translationProviders[0].priceDate = null; });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /priceDate:missing/);
});

test("report fails when p95 latency is missing", async () => {
  const result = await validateFixture((report) => { report.ttsProviders[0].p95FirstAudioMs = null; });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /p95FirstAudioMs:missing/);
});

test("report fails when pronunciation score is missing", async () => {
  const result = await validateFixture((report) => { report.ttsProviders[0].pronunciationScore = null; });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pronunciationScore:missing/);
});

test("report fails when projected COGS is missing", async () => {
  const result = await validateFixture((report) => { report.ttsProviders[0].projectedCogs300Vnd = null; });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /projectedCogs300Vnd:missing/);
});

test("report fails when fallback selection is pending", async () => {
  const result = await validateFixture((report) => { report.selection.fallbackTts = "pending"; });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /selection.fallbackTts:pending/);
});
