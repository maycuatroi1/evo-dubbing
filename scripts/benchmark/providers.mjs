import { resolve } from "node:path";
import {
  artifactsDirectory,
  corpusPath,
  createRunId,
  ensureDirectory,
  loadProviderCredentials,
  parseArguments,
  providersPath,
  readJson,
  safeError,
  validateCorpus,
  writeJson
} from "./common.mjs";
import { runTranslation } from "./translation.mjs";
import { runTts } from "./tts.mjs";

const options = parseArguments(process.argv.slice(2));
const corpus = await readJson(corpusPath);
const config = await readJson(providersPath);
const coverage = validateCorpus(corpus);
const translationProviders = options.kind === "tts" ? [] : config.translation;
const ttsProviders = options.kind === "translation" ? [] : config.tts;
const allProviders = [
  ...translationProviders.map((provider) => ({ kind: "translation", provider })),
  ...ttsProviders.map((provider) => ({ kind: "tts", provider }))
].filter(({ provider }) => !options.providers || options.providers.includes(provider.id));

if (options.providers) {
  const selected = new Set(allProviders.map(({ provider }) => provider.id));
  const unknown = options.providers.filter((provider) => !selected.has(provider));
  if (unknown.length) throw new Error(`Unknown or excluded providers: ${unknown.join(",")}`);
}

if (options.dryRun) {
  console.log("benchmark_mode=dry-run");
  console.log(`corpus_items=${coverage.count}`);
  console.log(`corpus_regions=north:${coverage.regions.north},central:${coverage.regions.central},south:${coverage.regions.south}`);
  for (const { kind, provider } of allProviders) {
    const credentialState = loadProviderCredentials(provider);
    console.log(`${kind}:${provider.id} model=${provider.model} requests=${corpus.items.length} credential=${credentialState.available ? "available" : "missing"}`);
  }
  console.log("request_headers=redacted");
  console.log("request_urls=redacted");
  console.log("request_bodies=redacted");
  process.exit(0);
}

const runId = options.runId || createRunId();
const runDirectory = resolve(artifactsDirectory, "runs", runId);
await ensureDirectory(runDirectory);
const index = {
  schemaVersion: 1,
  runId,
  createdAt: new Date().toISOString(),
  results: []
};

for (const { kind, provider } of allProviders) {
  const credentialState = loadProviderCredentials(provider);
  let result;
  if (!credentialState.available) {
    result = {
      schemaVersion: 1,
      runId,
      kind,
      providerId: provider.id,
      model: provider.model,
      voice: provider.voice ?? null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: "skipped_missing_credential",
      missingCredentialPaths: credentialState.missing,
      metrics: null,
      items: []
    };
  } else {
    try {
      result = kind === "translation"
        ? await runTranslation(provider, corpus, credentialState.values, runId)
        : await runTts(provider, corpus, credentialState.values, runId, runDirectory);
    } catch (error) {
      result = {
        schemaVersion: 1,
        runId,
        kind,
        providerId: provider.id,
        model: provider.model,
        voice: provider.voice ?? null,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: "failed",
        error: safeError(error),
        metrics: null,
        items: []
      };
    }
  }
  const relativePath = `runs/${runId}/${kind}-${provider.id}.json`;
  await writeJson(resolve(artifactsDirectory, relativePath), result);
  index.results.push({ kind, providerId: provider.id, path: relativePath, status: result.status });
  console.log(`${kind}:${provider.id} status=${result.status} success=${result.metrics?.successCount ?? 0} errors=${result.metrics?.errorCount ?? 0}`);
}

await writeJson(resolve(artifactsDirectory, "latest.json"), index);
console.log(`run_id=${runId}`);
console.log(`result_count=${index.results.length}`);
console.log("benchmark_persistence=ok");
