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
   - Fallback: download the audio and run Whisper STT (OpenAI). Produces timed segments.
3. Translate each segment to the target language with the selected provider. Segments are translated in batches with surrounding context for coherence.
4. Synthesize speech per segment with the selected TTS voice.
5. Build a `Dub` object: ordered segments, each with `startMs`, `endMs`, `translatedText`, and an audio blob / url.

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
