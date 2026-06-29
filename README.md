# evo-dubbing

[![CI](https://github.com/maycuatroi1/evo-dubbing/actions/workflows/ci.yml/badge.svg)](https://github.com/maycuatroi1/evo-dubbing/actions/workflows/ci.yml)
[![Deploy Pages](https://github.com/maycuatroi1/evo-dubbing/actions/workflows/pages.yml/badge.svg)](https://github.com/maycuatroi1/evo-dubbing/actions/workflows/pages.yml)

AI dubbing for online video platforms. Long tieng tu dong cho video tren web, bat dau voi YouTube.

Latest build: download from [GitHub Pages](https://maycuatroi1.github.io/evo-dubbing/) or the [Releases](https://github.com/maycuatroi1/evo-dubbing/releases) page, then load `chrome://extensions` -> Developer mode -> Load unpacked.

The project has two parts:

- `extension/` - Chrome MV3 extension. Detects the video, extracts the transcript (YouTube captions first, Whisper STT as fallback), translates, generates speech with the user's own API keys (OpenAI / Gemini), and plays the dubbed audio as a voice-over on top of the original.
- `server/` - Next.js share server. Lets users upload a finished dub so other people can play it back without re-dubbing. Public by default, switchable to private. Metadata in Postgres (Supabase), audio in Cloudflare R2.

## How it works

```
YouTube page
   |
   |  content script detects <video> + videoId
   v
captions (timedtext)  --no captions-->  Whisper STT
   |                                       |
   +------------------+--------------------+
                      v
              segments [{start,end,text}]
                      v
        translate (OpenAI / Gemini)
                      v
        TTS per segment (OpenAI / Gemini)
                      v
   voice-over player (Web Audio API)
   lower original volume, schedule TTS by timestamp
                      |
   optional: upload dub to share server (R2 + Postgres)
```

API keys never leave the browser. All provider calls are made client side from the extension.

## Quick start

Prerequisites: Node 20+, Docker (for local Postgres), a Cloudflare R2 bucket, an OpenAI and/or Gemini API key.

### Extension

```
cd extension
npm install
npm run build
```

Load `extension/dist` as an unpacked extension in `chrome://extensions` (Developer mode on). Open the options page and paste your OpenAI / Gemini key.

### Server

```
cd server
cp .env.example .env.local
docker compose up -d        # local Postgres
npm install
npm run db:push
npm run dev
```

See `docs/ARCHITECTURE.md` for the full design and `docs/ROADMAP.md` for what is built and what is next.
