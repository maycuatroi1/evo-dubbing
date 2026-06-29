# evo-dubbing server

Next.js share server. Stores finished dubs so other viewers can play them back without re-dubbing.

- Metadata in Postgres (Supabase in production, local Docker for dev).
- Per-segment audio in Cloudflare R2.
- No accounts. Each upload mints an anonymous owner token; the server keeps only its hash. The token is required to change visibility or delete.

## Local development

```
cp .env.example .env.local
docker compose up -d
npm install
npm run db:push
npm run dev
```

API base: `http://localhost:3000`.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (Supabase pooler URL in production) |
| `R2_ACCOUNT_ID` | Cloudflare account id |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 S3 credentials |
| `R2_BUCKET` | Bucket name |
| `R2_PUBLIC_BASE_URL` | Optional public bucket / custom domain base. If set, GET urls are public instead of presigned |
| `ALLOWED_EXTENSION_ORIGIN` | CORS origin allowed to call the API. `*` for dev |
| `MAX_SEGMENTS` / `MAX_SEGMENT_BYTES` | Upload guards |

## R2 CORS

The extension PUTs audio with presigned urls and GETs audio for playback from the YouTube page, so the bucket needs CORS that allows those origins:

```json
[
  {
    "AllowedOrigins": ["https://www.youtube.com", "*"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

Tighten `AllowedOrigins` before going to production.

## API

| Method | Path | Body / Query | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | | liveness |
| GET | `/api/dubs` | `?limit&platform` | list public ready dubs |
| GET | `/api/dubs/lookup` | `?platform&videoId&targetLang&voice&provider` | find a reusable dub |
| POST | `/api/dubs/init` | meta + segments | create dub, return owner token + presigned PUTs |
| POST | `/api/dubs/[id]/complete` | `{ownerToken}` | mark dub ready |
| GET | `/api/dubs/[id]` | | fetch a dub with audio urls |
| PATCH | `/api/dubs/[id]` | `{ownerToken, visibility}` | toggle public / private |
| DELETE | `/api/dubs/[id]` | `{ownerToken}` | remove a dub |

## Deploy

- Database: Supabase Postgres. Use the connection pooler URL as `DATABASE_URL`, run `npm run db:push` once.
- App: container from the included `Dockerfile`, or any Node host. Set all env vars.
- Storage: a Cloudflare R2 bucket with the CORS config above.
