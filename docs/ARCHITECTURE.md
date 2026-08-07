# Architecture

## Overview

evo-dubbing is split into a Chrome extension that does all the heavy lifting client side, and a thin share server that stores finished dubs so they can be reused.

```
+-------------------------------------------------------------+
|  Chrome Extension (MV3)                                     |
|                                                             |
|  content script (per platform)                              |
|    - detect <video>, read platform metadata (videoId)       |
|    - inject overlay control panel                           |
|    - own the voice-over audio player                        |
|                                                             |
|  dubbing engine                                             |
|    captions -> translate -> tts -> segments                 |
|                                                             |
|  providers (client side, user keys)                         |
|    OpenAI, Gemini                                           |
|                                                             |
|  background service worker                                   |
|    - cross-origin fetch proxy for caption/audio downloads   |
|    - settings cache                                         |
|                                                             |
|  options + popup pages                                      |
+----------------------------+--------------------------------+
                             | https
                             v
+-------------------------------------------------------------+
|  Share server (Next.js, App Router)                         |
|    /api/dubs                  list public dubs               |
|    /api/dubs/init             create dub + presigned R2 PUTs  |
|    /api/dubs/[id]/complete    finalise after uploads land     |
|    /api/dubs/[id]             get, patch visibility, delete   |
|    /api/dubs/lookup           find dub by platform+video+lang |
|    /api/health                liveness                        |
|                                                             |
|  Postgres (Supabase)  dub + segment metadata                |
|  Cloudflare R2        per-segment audio + manifest          |
+-------------------------------------------------------------+
```

## Why this split

- Keys stay on the client. The extension calls OpenAI / Gemini directly. The server never sees a user key and never pays for inference.
- The server is optional. The extension dubs fully standalone. Sharing is an opt-in upload.
- The server only stores derived artifacts (translated text + generated audio), keyed by platform + video id + language + voice, so a second viewer downloads instead of re-dubbing.

## Dubbing pipeline

1. Resolve the platform adapter from the page URL. YouTube first.
2. Get a transcript:
   - Preferred: the platform's own caption track (YouTube `timedtext`). Cheap, already timed.
     YouTube now requires a `pot` (poToken) on `timedtext`; the MAIN-world bridge hooks the
     player's own caption request to capture a valid `pot` and appends it to the track baseUrl.
   - Which track: `extension/src/content/caption-tracks.ts` ranks them. The spoken language is
     the language of the ASR track inside the default audio track (YouTube only auto-generates
     captions for what is actually spoken); with no ASR track it falls back to
     `defaultCaptionTrackIndex`. Only tracks in that language count as primary, and a
     human-written track beats ASR only inside that group, so a community joke track in an
     unrelated language never wins. Do not trust `captionTrackIndices` as the primary signal: on
     `Dx2yPk0FsGM` it lists the Klingon track alongside the English one. The bridge then loads up
     to 3 candidates in rank order and keeps the first whose cue coverage clears 35% of the video.
   - The viewer can override the pick: the overlay lists every track and stores the choice per
     video and per channel (`evoDubbingTrackPrefs`). A pinned track is used as-is, with its
     coverage reported back so the overlay can warn when the captions are near-empty.
   - Fallback: download the audio and run Whisper STT (OpenAI). Produces timed segments. (Not wired yet.)
3. Merge fragmented caption cues into sentence-level cues (fewer TTS calls, more natural speech).
4. Translate and synthesize lazily, driven by the playhead. See "Cost: lazy generation".
5. Play as a voice-over while generating ahead. Sharing runs a one-off "complete all" pass.

## Cost: lazy generation

The `DubSession` never generates the whole video up front. It only translates and synthesizes
cues inside a sliding window around the current playback position (a lookahead of ~30s), so a
viewer who watches two minutes of a long video only pays for two minutes of TTS.

- Translation is cheap and runs in small chunks just before TTS; TTS is the dominant cost and is
  the thing kept strictly on-demand.
- Generation stops when the dub is paused, so leaving a video idle costs nothing further.
- Generated audio is cached in IndexedDB keyed by `provider|model|voice|hash(text)`, so seeking
  back, re-watching, reloading, or hitting the same line in another video reuses the audio for free.
- Before generating anything, the extension asks the share server whether a finished dub already
  exists for `(platform, video, targetLang, voice, provider)`; if so it streams that for free.

## Playback (voice-over)

The player follows the page `<video>` element:

- Original volume is ducked to a low level (configurable) while a segment plays, restored between segments.
- Each TTS segment is scheduled against `video.currentTime` using the Web Audio API.
- Seeking and pause/play re-sync the schedule. Segments whose audio is longer than their time slot are time-stretched via `playbackRate` within a clamp, or allowed to overrun slightly.

### The first-line gap, and the two things that answer it

Lazy generation means the dub is never ahead of the viewer at the moment they press Dub: a
caption fetch, a translate call, and a TTS round trip all have to land first. Left alone, the
video runs on and the opening stretch plays with no voice-over at all.

- **Hold** (`holdUntilFirstDub`, on by default). `DubSession.beginHold()` is called by the
  content script the moment Dub is pressed, *before* the shared-library lookup and the caption
  fetch, and pauses the video. It releases when the first cue at the playhead settles - audio in
  hand, translated to silence, or failed - and only then calls `play()`. It also releases on a
  fatal error, on a 30s timeout, and the instant the viewer presses play themselves; a hold that
  fights the play button, or that can hang forever, is worse than a few un-dubbed seconds. While
  held the session keeps pumping generation, which the normal paused path deliberately does not.
- **Coverage** (`showTimelineProgress`, on by default). The session emits merged ranges of
  prepared cues (`lib/dubbing/coverage.ts`) on every cue that settles, and
  `content/timeline.ts` draws them as a lane under the YouTube scrubber, plus the notice that
  explains a held video. Both are positioned against the measured player box rather than being
  appended inside YouTube's own progress DOM: chaptered videos split that DOM into per-chapter
  lists that no longer map to the whole duration, and their internal positioning is not ours to
  depend on. The platform adapter owns the two selectors (`getPlayerRoot`, `getProgressBar`).

## Data model (server)

```
dubs
  id            uuid pk
  platform      text         'youtube'
  video_id      text
  source_lang   text
  target_lang   text
  voice         text
  provider      text         'openai' | 'gemini'
  title         text
  visibility    text         'public' | 'private'
  owner_token   text         anonymous owner secret (hashed)
  duration_ms   integer
  segment_count integer
  manifest_key  text         R2 key of manifest.json
  created_at    timestamptz
  updated_at    timestamptz

dub_segments
  id            uuid pk
  dub_id        uuid fk -> dubs.id
  idx           integer
  start_ms      integer
  end_ms        integer
  original_text text
  text          text         translated
  audio_key     text         R2 key of the segment audio
```

A dub is uniquely addressable by `(platform, video_id, target_lang, voice, provider)`.

## Storage layout (R2)

```
dubs/{dubId}/manifest.json
dubs/{dubId}/seg/{idx}.mp3
```

## Ownership without accounts

To keep the first version accountless, each upload mints an `ownerToken` stored only in the uploader's extension. The server stores a hash of it. Visibility changes and deletes require presenting the token. Accounts can be layered on later.

## Security notes

- Provider keys live in `chrome.storage.local`, never synced, never sent to the server.
- The server validates and size-limits uploads, and only issues presigned PUTs scoped to a single object key.
- CORS on the API is restricted to the extension origin.
