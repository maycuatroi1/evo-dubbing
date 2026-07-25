import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  artifactsDirectory,
  csvEscape,
  parseCsv,
  providersPath,
  readJson,
  writeJson
} from "./common.mjs";

function envOption(name) {
  const value = process.env[name];
  return value && value !== "true" ? value : null;
}

function parseWebImportArguments(argv) {
  const options = {
    exports: envOption("npm_config_exports"),
    reviewers: envOption("npm_config_reviewers")
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--exports") options.exports = argv[++index];
    else if (argument === "--reviewers") options.reviewers = argv[++index];
    else if (!argument.startsWith("--")) positional.push(argument);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.exports && positional.length) options.exports = positional.shift();
  if (!options.reviewers && positional.length) options.reviewers = positional.shift();
  return options;
}

const options = parseWebImportArguments(process.argv.slice(2));
if (!options.exports || !options.reviewers) {
  throw new Error("--exports <file-or-directory> and --reviewers <csv> are required");
}

const reviewerPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;

function checksumFor(runId, reviewerId, ratings) {
  const canonical = JSON.stringify({
    runId,
    reviewerId,
    ratings: ratings
      .map((rating) => ({
        sample_id: rating.sample_id,
        mos: rating.mos,
        severe_pronunciation_error: rating.severe_pronunciation_error,
        notes: rating.notes || ""
      }))
      .sort((left, right) => left.sample_id.localeCompare(right.sample_id))
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

const latestReview = await readJson(resolve(artifactsDirectory, "reviews", "latest.json"));
const reviewDirectory = resolve(artifactsDirectory, latestReview.reviewDirectory);
const manifest = await readJson(resolve(reviewDirectory, "manifest.private.json"));
const validSamples = new Set(manifest.samples.map((sample) => sample.sampleId));

const reviewerRows = parseCsv(await readFile(resolve(options.reviewers), "utf8"));
const config = await readJson(providersPath);
const minimumReviewers = config.acceptance?.minimumVietnameseReviewers ?? 5;
const confirmedReviewers = new Set(
  reviewerRows
    .filter((reviewer) => reviewer.confirmed_vietnamese.trim().toLowerCase() === "true")
    .map((reviewer) => reviewer.reviewer_id.trim())
    .filter(Boolean)
);
if (confirmedReviewers.size < minimumReviewers) {
  throw new Error(`At least ${minimumReviewers} confirmed Vietnamese reviewers are required`);
}

const exportsPath = resolve(options.exports);
let exportFiles;
try {
  const entries = await readdir(exportsPath, { withFileTypes: true });
  exportFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => resolve(exportsPath, entry.name))
    .sort();
} catch {
  exportFiles = [exportsPath];
}
if (!exportFiles.length) throw new Error(`No export JSON files found at ${exportsPath}`);

const registryPath = resolve(reviewDirectory, "web-imports.json");
let registry;
try {
  registry = await readJson(registryPath);
} catch {
  registry = { schemaVersion: 1, imports: [] };
}
const importedChecksums = new Set(registry.imports.map((entry) => entry.checksum));
const seenReviewers = new Set();
const allRatings = [];

for (const file of exportFiles) {
  let payload;
  try {
    payload = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(`Export is not valid JSON: ${file}`);
  }
  if (payload.schemaVersion !== 1) throw new Error(`Unsupported export schema: ${file}`);
  if (payload.runId !== latestReview.runId) throw new Error(`Export run mismatch: ${file}`);
  const reviewerId = String(payload.reviewer_id || "").trim();
  if (reviewerId.includes("@") || !reviewerPattern.test(reviewerId)) {
    throw new Error(`Invalid reviewer id in export: ${file}`);
  }
  if (!confirmedReviewers.has(reviewerId)) throw new Error(`Unconfirmed reviewer: ${reviewerId}`);
  if (seenReviewers.has(reviewerId)) throw new Error(`Duplicate reviewer export: ${reviewerId}`);
  seenReviewers.add(reviewerId);
  if (!Array.isArray(payload.ratings) || payload.ratings.length !== validSamples.size) {
    throw new Error(`Export must contain exactly ${validSamples.size} ratings: ${file}`);
  }
  const seenSamples = new Set();
  for (const rating of payload.ratings) {
    const sampleId = String(rating.sample_id || "").trim();
    if (!validSamples.has(sampleId)) throw new Error(`Unknown blind sample ${sampleId}: ${file}`);
    if (seenSamples.has(sampleId)) throw new Error(`Duplicate sample ${sampleId}: ${file}`);
    seenSamples.add(sampleId);
    if (!Number.isInteger(rating.mos) || rating.mos < 1 || rating.mos > 5) {
      throw new Error(`Invalid MOS for ${sampleId}: ${file}`);
    }
    if (!["true", "false"].includes(String(rating.severe_pronunciation_error))) {
      throw new Error(`Invalid severe pronunciation flag for ${sampleId}: ${file}`);
    }
    rating.severe_pronunciation_error = String(rating.severe_pronunciation_error);
    rating.notes = String(rating.notes || "");
  }
  const checksum = checksumFor(latestReview.runId, reviewerId, payload.ratings);
  if (checksum !== payload.checksum) throw new Error(`Checksum mismatch: ${file}`);
  if (importedChecksums.has(checksum)) throw new Error(`Duplicate submission checksum: ${reviewerId}`);
  importedChecksums.add(checksum);
  registry.imports.push({ checksum, reviewerId, file, importedAt: new Date().toISOString() });
  for (const rating of payload.ratings) {
    allRatings.push({ reviewer_id: reviewerId, ...rating });
  }
}

if (seenReviewers.size < minimumReviewers) {
  throw new Error(`Only ${seenReviewers.size} reviewer exports provided; at least ${minimumReviewers} are required`);
}

const ratingRows = ["reviewer_id,sample_id,mos,pronunciation_score,severe_pronunciation_error,notes"];
for (const rating of allRatings) {
  ratingRows.push([
    rating.reviewer_id,
    rating.sample_id,
    rating.mos,
    rating.mos,
    rating.severe_pronunciation_error,
    rating.notes
  ].map(csvEscape).join(","));
}
await writeFile(resolve(reviewDirectory, "ratings.csv"), `${ratingRows.join("\n")}\n`, "utf8");
await writeFile(resolve(reviewDirectory, "reviewers.csv"), await readFile(resolve(options.reviewers), "utf8"), "utf8");
await writeJson(registryPath, registry);

console.log(`confirmed_vietnamese_reviewers=${confirmedReviewers.size}`);
console.log(`imported_reviewer_exports=${seenReviewers.size}`);
console.log(`rating_count=${allRatings.length}`);
console.log("web_review_import=ok");
