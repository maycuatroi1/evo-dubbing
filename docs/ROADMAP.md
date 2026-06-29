# Roadmap

## Milestone 1 - standalone YouTube dubbing (in progress)

- [x] Monorepo skeleton, docs
- [x] Extension build tooling (Vite + crxjs, MV3)
- [x] Provider abstraction + OpenAI + Gemini adapters
- [x] API key storage + options page
- [x] YouTube caption extraction + Whisper STT fallback
- [x] Translate + TTS pipeline
- [x] Voice-over player (Web Audio)
- [x] Content script overlay control panel + popup

## Milestone 2 - share server

- [x] Next.js app, Drizzle schema, Docker Postgres
- [x] R2 client + presigned upload
- [x] Dubs CRUD + lookup API
- [ ] Browse page for public dubs
- [ ] Extension share client wiring (upload after dub, lookup before dub)
- [ ] Public / private toggle from the overlay

## Milestone 3 - hardening and reach

- [ ] More platforms (Vimeo, Coursera, generic <video>)
- [ ] Segment caching in IndexedDB to avoid re-paying for the same dub
- [ ] Time-stretch tuning and pause/seek robustness
- [ ] Optional accounts + moderation for the public library
- [ ] Rate limiting and abuse protection on the server
- [ ] Cost estimate preview before dubbing

## Known limitations to revisit

- YouTube occasionally changes how the player response is exposed; the caption extractor may need updates.
- Per-segment TTS makes many provider calls. Batch where the provider allows it.
- Voice-over timing is approximate when translated speech is longer than the source slot.
