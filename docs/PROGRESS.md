# Progress

Append at the end of every session. Newest first. Keep entries short: what changed, what is
verified, what the next session should pick up. This file is the only thing that survives a
context window.

## 2026-08-05 - caption source: ranked track pick + viewer override

- Root cause found on `Dx2yPk0FsGM`: the video ships an English ASR track plus a manual Klingon
  track, and `page-bridge.ts` preferred any `kind !== "asr"` track, so every dub was built from a
  few lines of Klingon. The rule was never about ASR quality, it was about ownership of the
  spoken language.
- New `extension/src/content/caption-tracks.ts` (pure, unit tested) treats the language of the
  ASR track as the spoken language, ranks only that language as primary, then prefers
  human-written over ASR inside it, with a penalty for tracks already in the target language.
  `fetchTranscript` walks up to 3 candidates and keeps the first whose merged cue coverage clears
  35% of the runtime, so a short or broken track self-heals.
- Trap worth remembering: `audioTracks[].captionTrackIndices` is NOT a spoken-language filter. On
  `Dx2yPk0FsGM` it is `[1, 0]`, listing Klingon before English, so an earlier version of this
  ranking still picked Klingon. Checked against the real tracklist before believing the tests.
- Viewer override: bridge gained `listCaptionTracks`, the overlay gained a "Caption source"
  select (auto + every track, foreign-language ones labelled), and the choice is stored per video
  and per channel in `evoDubbingTrackPrefs`. Coverage under 50% renders a warning under the
  select pointing at the picker.
- **Verified:** `npm run check` (10 seam checks, bridge-protocol now 3 request / 4 result kinds),
  `npm test --workspace extension` 45 tests including 8 new ranking/coverage cases built from the
  real `Dx2yPk0FsGM` tracklist, `npm run build:ext`.
- **Not verified (owner-only):** no in-browser run yet. Load `extension/dist` unpacked, open
  `Dx2yPk0FsGM`, confirm the dub now reads English and that the picker lists both tracks.
- Next: the same coverage signal is the natural trigger for the STT fallback in ROADMAP, and
  a "paste your own .srt" source would close the last gap.

## 2026-07-30 - nghe-site-mvp: product site live on production

- https://nghe.omelet.tech is now the mono-light product site: landing with the 199.000 VND /
  300 phút / 30 ngày pricing contract, `/library` search, `/dub/[id]` preview playback over
  presigned URLs (playback_started with a localStorage web install ID), `/privacy` + `/terms`,
  Supabase PKCE web sign-in, `/account` quota dashboard with PayOS renewal behind
  `MANAGED_CHECKOUT_ENABLED`, and `/admin` restyled onto the extension tokens.
- Deploy runbook written from the live VPS state (42.96.16.233, docker + Caddy, env
  `/opt/evo-dubbing/server.env`, recreate to reload env, rollback by image tag) - top of
  docs/DEPLOY.md. Every step above shipped as its own deploy behind `npm run check` + Playwright.
- Gotcha worth remembering: Next inlines `process.env.NEXT_PUBLIC_*` at BUILD time, so the public
  Supabase config is read at runtime via `GET /api/auth/config`; direct reads in server components
  silently become undefined in the Docker image.
- **Verified:** `npm run check`, 126+37 unit tests, `npm run test:integration`; per-step deploys
  each gated by `npm run test:e2e:prod` (22 specs green at the end, including library search on
  the seeded fixture dub, real audio playback > 2s with a 200 playback event, mock-session auth
  reload/sign-out, mock account + checkout navigation to the PayOS link). e2e seed/cleanup
  scripts round-trip; the fixture dub is left seeded for the next gate.
- **Not verified (owner-only):** live Google sign-in on the web (needs the Supabase Google
  provider Web client append + redirect allowlist, docs/DEPLOY.md "Web sign-in") and one live
  PayOS checkout (blocked on merchant KYC, managed-dubbing-business-mvp step 18).
- Windows dev box flakes: loopback `ERR_NO_BUFFER_SPACE`/`ERR_ADDRESS_IN_USE` under ~5k TIME_WAIT
  connections; Playwright retries: 1 absorbs it.

## 2026-07-30 - extension UI redesign mono minimal + single-branch decision

- Redesigned the extension UI to a light monochrome system (tokens.css, base.css primitives,
  icon-mask SVGs, new icons rendered by `extension/scripts/render-icons.mjs`, popup/options/
  overlay restyled, i18n module added, `web/privacy.html` and CWS listing copy drafted).
- Owner decision: develop on a single branch. The whole WIP lands as one commit on
  `feat/managed-dubbing-business-mvp`, merged `--no-ff` into `main`; the feature branch is
  deleted afterwards. Every later step of plan `nghe-site-mvp` commits straight to `main`.
- **Verified:** `npm run check`, `npm test` (126 server + 37 extension), `npm run
  test:integration`, `npm run build:ext` all green; dist manifest keeps the `key` field so the
  CWS Item ID `ligchebgiheiildjcnndjoalkpiamgko` is unchanged.
- **Not verified:** no live dubbing run after the redesign; popup/options visuals checked only
  via build and unit tests.

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
