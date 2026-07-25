import { randomUUID } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  artifactsDirectory,
  benchmarkDirectory,
  corpusPath,
  csvEscape,
  ensureDirectory,
  parseArguments,
  parseCsv,
  readJson,
  writeJson
} from "./common.mjs";

const options = parseArguments(process.argv.slice(2));
const latestPath = resolve(artifactsDirectory, "latest.json");

async function prepareReview() {
  const latest = await readJson(latestPath);
  const corpus = await readJson(corpusPath);
  const corpusById = new Map(corpus.items.map((item) => [item.id, item]));
  const samples = [];
  for (const entry of latest.results.filter((result) => result.kind === "tts")) {
    const result = await readJson(resolve(artifactsDirectory, entry.path));
    for (const item of result.items.filter((value) => value.status === "completed" && value.audioFile)) {
      samples.push({
        sampleId: `sample-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        providerId: result.providerId,
        corpusId: item.id,
        sourceAudio: resolve(artifactsDirectory, "runs", latest.runId, item.audioFile)
      });
    }
  }
  if (!samples.length) throw new Error("No completed TTS audio is available for blind review");
  samples.sort(() => Math.random() - 0.5);
  const reviewDirectory = resolve(artifactsDirectory, "reviews", latest.runId);
  const audioDirectory = resolve(reviewDirectory, "audio");
  await ensureDirectory(audioDirectory);
  const privateManifest = [];
  const reviewRows = ["sample_id,audio_file,text,region,coverage"];
  for (const sample of samples) {
    const corpusItem = corpusById.get(sample.corpusId);
    const audioFile = `${sample.sampleId}.mp3`;
    await copyFile(sample.sourceAudio, resolve(audioDirectory, audioFile));
    privateManifest.push({
      sampleId: sample.sampleId,
      providerId: sample.providerId,
      corpusId: sample.corpusId,
      audioFile
    });
    reviewRows.push([
      sample.sampleId,
      `audio/${audioFile}`,
      corpusItem.targetText,
      corpusItem.region,
      corpusItem.coverage.join("|")
    ].map(csvEscape).join(","));
  }
  await writeJson(resolve(reviewDirectory, "manifest.private.json"), {
    schemaVersion: 1,
    runId: latest.runId,
    createdAt: new Date().toISOString(),
    samples: privateManifest
  });
  await writeFile(resolve(reviewDirectory, "review-form.csv"), `${reviewRows.join("\n")}\n`, "utf8");
  await copyFile(resolve(benchmarkDirectory, "ratings-template.csv"), resolve(reviewDirectory, "ratings.csv"));
  await copyFile(resolve(benchmarkDirectory, "reviewers-template.csv"), resolve(reviewDirectory, "reviewers.csv"));
  await writeJson(resolve(artifactsDirectory, "reviews", "latest.json"), {
    runId: latest.runId,
    reviewDirectory: `reviews/${latest.runId}`
  });
  console.log(`review_run_id=${latest.runId}`);
  console.log(`blind_sample_count=${samples.length}`);
  console.log(`review_directory=${reviewDirectory}`);
  console.log("provider_labels_in_review_form=none");
  console.log("blind_review_prepare=ok");
}

async function importReview() {
  if (!options.ratings || !options.reviewers) {
    throw new Error("--ratings and --reviewers are required with --import");
  }
  const latestReview = await readJson(resolve(artifactsDirectory, "reviews", "latest.json"));
  const reviewDirectory = resolve(artifactsDirectory, latestReview.reviewDirectory);
  const manifest = await readJson(resolve(reviewDirectory, "manifest.private.json"));
  const validSamples = new Set(manifest.samples.map((sample) => sample.sampleId));
  const ratingText = await readFile(resolve(options.ratings), "utf8");
  const reviewerText = await readFile(resolve(options.reviewers), "utf8");
  const ratings = parseCsv(ratingText);
  const reviewers = parseCsv(reviewerText);
  const confirmedReviewers = new Set(
    reviewers
      .filter((reviewer) => reviewer.confirmed_vietnamese.trim().toLowerCase() === "true")
      .map((reviewer) => reviewer.reviewer_id.trim())
      .filter(Boolean)
  );
  if (confirmedReviewers.size < 5) throw new Error("At least five confirmed Vietnamese reviewers are required");
  const seen = new Set();
  for (const rating of ratings) {
    const reviewerId = rating.reviewer_id.trim();
    const sampleId = rating.sample_id.trim();
    const key = `${reviewerId}:${sampleId}`;
    if (!confirmedReviewers.has(reviewerId)) throw new Error(`Unconfirmed reviewer: ${reviewerId}`);
    if (!validSamples.has(sampleId)) throw new Error(`Unknown blind sample: ${sampleId}`);
    if (seen.has(key)) throw new Error(`Duplicate rating: ${key}`);
    seen.add(key);
    const mos = Number(rating.mos);
    const pronunciation = Number(rating.pronunciation_score);
    if (!Number.isInteger(mos) || mos < 1 || mos > 5) throw new Error(`Invalid MOS: ${key}`);
    if (!Number.isInteger(pronunciation) || pronunciation < 1 || pronunciation > 5) {
      throw new Error(`Invalid pronunciation score: ${key}`);
    }
    if (!['true', 'false'].includes(rating.severe_pronunciation_error.trim().toLowerCase())) {
      throw new Error(`Invalid severe pronunciation flag: ${key}`);
    }
  }
  await writeFile(resolve(reviewDirectory, "ratings.csv"), ratingText, "utf8");
  await writeFile(resolve(reviewDirectory, "reviewers.csv"), reviewerText, "utf8");
  console.log(`confirmed_vietnamese_reviewers=${confirmedReviewers.size}`);
  console.log(`rating_count=${ratings.length}`);
  console.log("blind_review_import=ok");
}

if (options.importRatings) await importReview();
else await prepareReview();
