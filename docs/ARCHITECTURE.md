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
|    /api/dubs            list public dubs, create dub         |
|    /api/dubs/[id]       get, patch visibility, delete        |
|    /api/dubs/lookup     find dub by platform+video+lang      |
|    /api/upload          presigned PUT to R2                  |
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
