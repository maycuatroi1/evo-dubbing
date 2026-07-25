import { copyFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  artifactsDirectory,
  benchmarkDirectory,
  ensureDirectory,
  parseCsv,
  readJson,
  writeJson
} from "./common.mjs";
import { readFile } from "node:fs/promises";

const latestReview = await readJson(resolve(artifactsDirectory, "reviews", "latest.json"));
const reviewDirectory = resolve(artifactsDirectory, latestReview.reviewDirectory);
const rows = parseCsv(await readFile(resolve(reviewDirectory, "review-form.csv"), "utf8"));
if (!rows.length) throw new Error("Review form is empty; run benchmark:review -- --prepare first");

const webDirectory = resolve(benchmarkDirectory, "review-web");
const audioDirectory = resolve(webDirectory, "audio");
await ensureDirectory(audioDirectory);

const samples = [];
for (const row of rows) {
  const audioFile = row.audio_file.trim();
  const source = resolve(reviewDirectory, audioFile);
  const target = resolve(audioDirectory, audioFile.replace(/^audio\//, ""));
  await copyFile(source, target);
  samples.push({
    sample_id: row.sample_id.trim(),
    audio: `audio/${audioFile.replace(/^audio\//, "")}`,
    text: row.text,
    region: row.region.trim(),
    coverage: row.coverage
  });
}

const copied = await readdir(audioDirectory);
if (copied.length !== samples.length) throw new Error(`Audio copy mismatch: ${copied.length}/${samples.length}`);

await writeJson(resolve(webDirectory, "manifest.json"), {
  schemaVersion: 1,
  runId: latestReview.runId,
  generatedAt: new Date().toISOString(),
  sampleCount: samples.length,
  samples
});

console.log(`review_web_run_id=${latestReview.runId}`);
console.log(`review_web_samples=${samples.length}`);
console.log(`review_web_audio_files=${copied.length}`);
console.log("provider_labels_in_manifest=none");
console.log("review_web_build=ok");
