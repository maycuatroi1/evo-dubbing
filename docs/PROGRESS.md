# Progress

Append at the end of every session. Newest first. Keep entries short: what changed, what is
verified, what the next session should pick up. This file is the only thing that survives a
context window.

## 2026-07-25 - manual core acceptance

- Built and loaded `extension/dist` unpacked in Microsoft Edge, then dubbed `aircAruvnKk`,
  `IHZwWFHWa-w`, and `Ilg3gGewQ5U`. Their observed durations total 52.00 minutes and caption
  extraction returned 194, 208, and 120 merged cues.
- Verified real playback through HTTP 200 OpenAI TTS responses, non-empty Vietnamese subtitles,
  ducking from volume 1 to 0.18, three captured MP3 samples, and successful Vietnamese STT of
  those samples. The owner heard the direct extension replay and confirmed first audible dub,
  complete long lines without chipmunking, and correct pause/seek behavior.
- Verified lazy generation after 120.29 watched source seconds: after pause and API idle, provider
  requests stayed at 30 for another 20 seconds. Forward and backward seeks on all three videos
  moved playback to distinct translated lines and pause stopped ducking.
- Reproduced a reload cache defect before the fix: TTS requests rose from 13 to 21 because a new
  translation changed the text cache key. Added IndexedDB translation-batch caching, rebuilt, and
  verified both same-session seek and reload held TTS requests at 15 to 15.
- Promoted the six core behaviors exercised in this session to `passing`. Evidence is under
  `docs/evidence/2026-07-25-step-2/`: visual test recording, sanitized network/runtime logs,
  summary, and the three TTS samples.

## 2026-07-25 - harness scaffolding

- Added the harness this repo did not have: `AGENTS.md` (map), `init.ps1` / `init.sh` (boot),
  `feature_list.json` (work spec), `scripts/verify/` (six mechanical checks), `docs/index.md`.
  Cluster-level artifacts live in `../evo-dubbing-harness`.
- CI now runs `npm run type:all` and `npm run verify`. Before this, `server/` was never
  typechecked in CI and nothing checked the extension/server API seam.
- Fixed doc drift found by the new `share-api` check: `docs/ARCHITECTURE.md` advertised
  `/api/upload`, which no route serves. Presigned PUTs come back from `/api/dubs/init`.
- **Verified:** `npm run check` passes locally.
- **Not verified:** nothing in this session touched the dubbing path, and no behavior in
  `feature_list.json` was promoted to `passing`. Everything there is still `in_progress` or
  `not_started` on purpose.

### Next session should pick up

1. Promote one behavior to `passing` with real evidence. `dub-youtube-with-captions` is the one
   that matters most and the cheapest to prove: build, load unpacked, dub a video, write down
   what you heard.
2. Decide what to do about `player.json` and `player_android.json` at the repo root. They are
   tracked debug dumps of a YouTube player response; one may contain session identifiers. See
   `../evo-dubbing-harness/docs/debt.md`.
3. `docs/ROADMAP.md` claims "Extension share client wiring" is unchecked, but `shareClient.ts`
   is wired. Markdown checkboxes drifted from reality; `feature_list.json` is now the source of
   truth for status and the ROADMAP should shrink to milestones only.

## 2026-07-25 - plan step 4: TTS/translation benchmark and provider selection

- Built benchmarks/tts-vi corpus (30 Vietnamese sentences, North/Central/South balanced) plus
  scripts/benchmark pipeline (providers, review, review-web, report, fail-closed validator).
- Real benchmark 30/30 for translation (gemini-flash-lite, openai-economy, gemini-challenger) and
  TTS (google-wavenet, google-gemini-tts, openai-tts, vbee); Viettel AI, FPT.AI, VNPT SmartVoice
  dropped from the required set by owner decision (no credentials).
- Blind MOS via local review web (90 samples, reviewer-01, checksum f68a7c2a642a):
  google-gemini-tts MOS 4.867 / severe 3.33% / p95 5.784ms / COGS 114,708 VND per 300 source minutes;
  google-wavenet MOS 3.233 / COGS 27,863; vbee MOS 3.133 / severe 43.3%.
- Owner decisions 2026-07-25: acceptance override MOS >= 3.0, severe <= 5%, COGS <= 130,000 VND;
  tts_primary = google-gemini-tts, fallback = google-wavenet, translation_primary = gemini-flash-lite;
  paid plan price raised 99,000 -> 199,000 VND (TTS COGS exceeded old price), BUSINESS_MODEL.md updated.
- Fixed along the way: review-web partial-response bug, dynamic sample count, acceptance field-name
  mismatch that kept every score null, vendored get_credential.py into the repo after skillfish wiped
  the credentials-utils skill scripts, new restricted Google API key for Cloud TTS (google_tts_api_key).
- **Verified:** npm run benchmark:report passes with 0 validation errors; 7 validator tests; npm run check.
