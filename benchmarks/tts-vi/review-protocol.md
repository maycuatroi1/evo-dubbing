# Blind Vietnamese TTS review

## Reviewer requirements

Use at least five different native or fully fluent Vietnamese reviewers. Each reviewer confirms Vietnamese fluency in `reviewers.csv`. Do not use an AI grader, synthetic ratings, or ratings copied from another reviewer.

## Prepare

Run `npm run benchmark:review -- --prepare` after real TTS runs. The generated reviewer directory contains opaque audio filenames and `review-form.csv`. Keep `manifest.private.json` away from reviewers because it maps sample IDs to providers.

## Review

Each reviewer listens with headphones in a quiet room and rates every assigned sample without seeing the provider. Use integer MOS from 1 to 5, integer pronunciation score from 1 to 5, and `true` only when a pronunciation error changes or seriously obscures meaning. Do not discuss scores until all forms are submitted.

## Import

Combine ratings into one CSV with columns from `ratings-template.csv`. Add one row per reviewer and sample. Fill `reviewers.csv`, then run `npm run benchmark:review -- --import --ratings <ratings.csv> --reviewers <reviewers.csv>`.

The report remains pending until each benchmarked provider has ratings from at least five confirmed Vietnamese reviewers. Acceptance requires MOS at least 3.8, severe pronunciation errors below 2 percent, p95 first audio at most 8 seconds, and projected variable COGS at most 35,000 VND for 300 source minutes.
