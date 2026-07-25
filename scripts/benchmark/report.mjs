import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  artifactsDirectory,
  corpusPath,
  parseArguments,
  parseCsv,
  providersPath,
  readJson,
  writeJson
} from "./common.mjs";
import { validateReport } from "./report-validator.mjs";

const options = parseArguments(process.argv.slice(2));
const config = await readJson(providersPath);

if (options.validate) {
  const candidate = await readJson(resolve(options.validate));
  const candidateErrors = validateReport(candidate, config);
  if (candidateErrors.length) {
    for (const error of candidateErrors) console.error(`validation_error=${error}`);
    process.exit(1);
  }
  console.log("report_validation=ok");
  process.exit(0);
}

async function optionalJson(path) {
  try {
    await access(path);
    return await readJson(path);
  } catch {
    return null;
  }
}

async function loadResultMap() {
  const latest = await optionalJson(resolve(artifactsDirectory, "latest.json"));
  const results = new Map();
  if (!latest) return { latest: null, results };
  for (const entry of latest.results) {
    results.set(`${entry.kind}:${entry.providerId}`, await readJson(resolve(artifactsDirectory, entry.path)));
  }
  return { latest, results };
}

async function loadRatings() {
  const latestReview = await optionalJson(resolve(artifactsDirectory, "reviews", "latest.json"));
  if (!latestReview) return { ratings: [], reviewers: new Set(), providersBySample: new Map() };
  const directory = resolve(artifactsDirectory, latestReview.reviewDirectory);
  const manifest = await optionalJson(resolve(directory, "manifest.private.json"));
  if (!manifest) return { ratings: [], reviewers: new Set(), providersBySample: new Map() };
  try {
    const ratings = parseCsv(await readFile(resolve(directory, "ratings.csv"), "utf8"));
    const reviewerRows = parseCsv(await readFile(resolve(directory, "reviewers.csv"), "utf8"));
    const reviewers = new Set(
      reviewerRows
        .filter((reviewer) => reviewer.confirmed_vietnamese.trim().toLowerCase() === "true")
        .map((reviewer) => reviewer.reviewer_id.trim())
        .filter(Boolean)
    );
    const providersBySample = new Map(manifest.samples.map((sample) => [sample.sampleId, sample.providerId]));
    return { ratings, reviewers, providersBySample };
  } catch {
    return { ratings: [], reviewers: new Set(), providersBySample: new Map() };
  }
}

function average(values) {
  if (!values.length) return null;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length * 1000) / 1000;
}

function reviewMetrics(providerId, reviewData) {
  const ratings = reviewData.ratings.filter((rating) =>
    reviewData.reviewers.has(rating.reviewer_id.trim())
    && reviewData.providersBySample.get(rating.sample_id.trim()) === providerId
  );
  const reviewerCount = new Set(ratings.map((rating) => rating.reviewer_id.trim())).size;
  const severeCount = ratings.filter((rating) => rating.severe_pronunciation_error.trim().toLowerCase() === "true").length;
  return {
    reviewerCount,
    ratingCount: ratings.length,
    mos: average(ratings.map((rating) => Number(rating.mos)).filter(Number.isFinite)),
    pronunciationScore: average(ratings.map((rating) => Number(rating.pronunciation_score)).filter(Number.isFinite)),
    severePronunciationErrorRate: ratings.length ? severeCount / ratings.length : null
  };
}

function translationRow(provider, result) {
  const metrics = result?.metrics;
  const sourceMinutes = result?.sourceMinutes;
  const inputCostUsd = metrics ? metrics.inputTokens / 1000000 * provider.pricing.inputPerMillionTokens : null;
  const outputCostUsd = metrics ? metrics.outputTokens / 1000000 * provider.pricing.outputPerMillionTokens : null;
  const baseCostUsd = inputCostUsd === null || outputCostUsd === null ? null : inputCostUsd + outputCostUsd;
  const retryCostUsd = baseCostUsd !== null && metrics.successCount
    ? baseCostUsd * metrics.retryCount / metrics.successCount
    : null;
  const actualCostVnd = baseCostUsd === null ? null : (baseCostUsd + (retryCostUsd || 0)) * config.vndPerUsd;
  const vndPerSourceMinute = actualCostVnd !== null && sourceMinutes ? actualCostVnd / sourceMinutes : null;
  return {
    providerId: provider.id,
    model: provider.model,
    role: provider.role,
    status: result?.status ?? "missing",
    priceDate: provider.pricing.priceDate,
    priceSourceUrl: provider.pricing.sourceUrl,
    listPriceInputPerMillionTokens: provider.pricing.inputPerMillionTokens,
    listPriceOutputPerMillionTokens: provider.pricing.outputPerMillionTokens,
    effectivePaidQuotaTokens: 1000000,
    requestCount: metrics?.requestCount ?? null,
    retryCount: metrics?.retryCount ?? null,
    retryCostVnd: retryCostUsd === null ? null : retryCostUsd * config.vndPerUsd,
    p95LatencyMs: metrics?.p95LatencyMs ?? null,
    errorCount: metrics?.errorCount ?? null,
    errorRate: metrics?.errorRate ?? null,
    inputTokens: metrics?.inputTokens ?? null,
    outputTokens: metrics?.outputTokens ?? null,
    vndPerSourceMinute,
    projectedCogs300Vnd: vndPerSourceMinute === null ? null : vndPerSourceMinute * 300
  };
}

function ttsUnitPriceVnd(pricing) {
  if (typeof pricing.listPrice !== "number" || typeof pricing.effectivePaidQuotaCharacters !== "number") return null;
  const priceVnd = pricing.currency === "USD" ? pricing.listPrice * config.vndPerUsd : pricing.listPrice;
  return priceVnd / pricing.effectivePaidQuotaCharacters;
}

function ttsRow(provider, result, reviewData, translationCogs300Vnd) {
  const metrics = result?.metrics;
  const sourceMinutes = result?.sourceMinutes;
  const unitPriceVnd = ttsUnitPriceVnd(provider.pricing);
  const inputCharacters = metrics?.inputCharacters ?? null;
  const retryCharacters = metrics?.retryCharacters ?? null;
  const usableRun = ["completed", "partial"].includes(result?.status) && metrics?.successCount > 0;
  const actualTtsCostVnd = !usableRun || unitPriceVnd === null || inputCharacters === null || retryCharacters === null
    ? null
    : unitPriceVnd * (inputCharacters + retryCharacters);
  const retryCostVnd = !usableRun || unitPriceVnd === null || retryCharacters === null ? null : unitPriceVnd * retryCharacters;
  const ttsVndPerSourceMinute = actualTtsCostVnd !== null && sourceMinutes ? actualTtsCostVnd / sourceMinutes : null;
  const projectedTtsCogs300Vnd = ttsVndPerSourceMinute === null ? null : ttsVndPerSourceMinute * 300;
  const projectedCogs300Vnd = projectedTtsCogs300Vnd === null || translationCogs300Vnd === null
    ? null
    : projectedTtsCogs300Vnd + translationCogs300Vnd;
  const reviews = reviewMetrics(provider.id, reviewData);
  const qualityPass = reviews.reviewerCount >= config.acceptance.minimumVietnameseReviewers
    && reviews.mos >= config.acceptance.minimumMos
    && reviews.severePronunciationErrorRate < config.acceptance.maximumSeverePronunciationErrorRate;
  const latencyPass = typeof metrics?.p95FirstAudioMs === "number"
    && metrics.p95FirstAudioMs <= config.acceptance.maximumP95FirstAudioMs;
  const costPass = typeof projectedCogs300Vnd === "number"
    && projectedCogs300Vnd <= config.acceptance.maximumProjectedCogs300Vnd;
  const reliabilityPass = metrics?.errorCount === 0;
  const score = qualityPass && latencyPass && costPass && reliabilityPass
    ? reviews.mos / 5 * 40
      + reviews.pronunciationScore / 5 * 20
      + Math.max(0, 1 - metrics.p95FirstAudioMs / config.acceptance.maximumP95FirstAudioMs) * 20
      + Math.max(0, 1 - projectedCogs300Vnd / config.acceptance.maximumProjectedCogs300Vnd) * 20
    : null;
  return {
    providerId: provider.id,
    model: provider.model,
    voice: provider.voice,
    status: result?.status ?? "missing",
    pricingStatus: provider.pricing.status,
    priceDate: provider.pricing.priceDate,
    priceSourceUrl: provider.pricing.sourceUrl,
    listPrice: provider.pricing.listPrice,
    listCurrency: provider.pricing.currency,
    listUnit: provider.pricing.listUnit,
    paidQuotaCharacters: provider.pricing.paidQuotaCharacters,
    effectivePaidQuotaCharacters: provider.pricing.effectivePaidQuotaCharacters,
    freeQuotaCharacters: provider.pricing.freeQuotaCharacters,
    requestCount: metrics?.requestCount ?? null,
    retryCount: metrics?.retryCount ?? null,
    retryCostVnd,
    p95LatencyMs: metrics?.p95LatencyMs ?? null,
    p95FirstAudioMs: metrics?.p95FirstAudioMs ?? null,
    outputDurationMs: metrics?.outputDurationMs ?? null,
    averageOutputDurationMs: metrics?.averageOutputDurationMs ?? null,
    errorCount: metrics?.errorCount ?? null,
    errorRate: metrics?.errorRate ?? null,
    inputCharacters,
    retryCharacters,
    reviewerCount: reviews.reviewerCount,
    ratingCount: reviews.ratingCount,
    mos: reviews.mos,
    pronunciationScore: reviews.pronunciationScore,
    severePronunciationErrorRate: reviews.severePronunciationErrorRate,
    vndPerSourceMinute: ttsVndPerSourceMinute,
    projectedTtsCogs300Vnd,
    projectedTranslationCogs300Vnd: translationCogs300Vnd,
    projectedCogs300Vnd,
    acceptance: { qualityPass, latencyPass, costPass, reliabilityPass },
    score
  };
}

const corpus = await readJson(corpusPath);
const { latest, results } = await loadResultMap();
const reviewData = await loadRatings();
const translationProviders = config.translation.map((provider) =>
  translationRow(provider, results.get(`translation:${provider.id}`))
);
const eligibleTranslations = translationProviders
  .filter((provider) => provider.status === "completed"
    && provider.errorRate === 0
    && typeof provider.p95LatencyMs === "number"
    && typeof provider.projectedCogs300Vnd === "number")
  .sort((left, right) => left.projectedCogs300Vnd - right.projectedCogs300Vnd);
const translationPrimary = eligibleTranslations[0]?.providerId ?? "pending";
const translationCogs300Vnd = eligibleTranslations[0]?.projectedCogs300Vnd ?? null;
const ttsProviders = config.tts.map((provider) =>
  ttsRow(provider, results.get(`tts:${provider.id}`), reviewData, translationCogs300Vnd)
);
const vietnameseCandidates = ttsProviders
  .filter((provider) => provider.providerId !== "google-wavenet" && provider.score !== null)
  .sort((left, right) => right.score - left.score);
const googleFallback = ttsProviders.find((provider) => provider.providerId === "google-wavenet");
const ttsPrimary = vietnameseCandidates[0]?.providerId ?? "pending";
const fallbackTts = googleFallback?.score !== null ? "google-wavenet" : "pending";
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runId: latest?.runId ?? null,
  priceDate: config.priceDate,
  corpus: {
    itemCount: corpus.items.length,
    sourceWordsPerMinute: corpus.sourceWordsPerMinute
  },
  acceptance: config.acceptance,
  translationProviders,
  ttsProviders,
  selection: {
    translationPrimary,
    ttsPrimary,
    fallbackTts,
    status: ttsPrimary === "pending" || fallbackTts === "pending" ? "pending" : "selected"
  }
};
const errors = validateReport(report, config);
report.validationErrors = errors;
const reportPath = resolve(artifactsDirectory, "latest-report.json");
await writeJson(reportPath, report);
console.log(`report_path=${reportPath}`);
console.log(`translation_primary=${translationPrimary}`);
console.log(`tts_primary=${ttsPrimary}`);
console.log(`fallback_tts=${fallbackTts}`);
console.log(`validation_error_count=${errors.length}`);
if (errors.length) {
  for (const error of errors) console.error(`validation_error=${error}`);
  process.exit(1);
}
console.log("benchmark_report=ok");
