# AGENTS.md - evo-dubbing

Table of contents, not an encyclopedia. Read this, then only the file you need.

## What this is

A Chrome MV3 extension that dubs online video (YouTube first) using the user's own OpenAI /
Gemini keys, plus an optional Next.js server that stores finished dubs so a second viewer
downloads instead of re-paying for inference.

Three deployables in one repo, shipped separately:

| Part | What it is | How it ships |
|------|-----------|--------------|
| `extension/` | MV3 extension, TypeScript + Vite + @crxjs | zip artifact -> GitHub Pages / Releases, user loads unpacked |
| `server/` | Next.js 14 App Router + Drizzle + Postgres + Cloudflare R2 | Docker image (`server/Dockerfile`) |
| `web/index.html` | the download landing page | GitHub Pages (`.github/workflows/pages.yml`) |

## Bearings ritual (start of every session)

```
./init.ps1              # Windows;  ./init.sh on POSIX
npm run verify          # seam + harness checks, must be green before you start
git log --oneline -10
```

Then read `docs/PROGRESS.md` for where the last session stopped, and `feature_list.json` for
what "done" means. The cluster harness lives outside this repo at `../evo-dubbing-harness/`:
its map is `../evo-dubbing-harness/CLUSTER.md` and its seam registry is
`../evo-dubbing-harness/contracts.yaml`.

## Commands

| Task | Command |
|------|---------|
| Boot everything | `./init.ps1` / `./init.sh` |
| Extension dev (HMR) | `npm run dev:ext` then load `extension/dist` unpacked |
| Server dev | `npm run dev:server` (needs `docker compose up -d` in `server/`) |
| Typecheck both workspaces | `npm run type:all` |
| Build both | `npm run build:ext && npm run build:server` |
| Seam + harness checks | `npm run verify` |
| Everything CI runs | `npm run check` |
| Push schema to local db | `npm run db:push` |

There is no unit test suite yet. `npm run verify` is the only mechanical gate besides `tsc`;
see "What is not verified" before trusting a green run.

## Where knowledge lives

| Question | File |
|----------|------|
| How the pieces fit, the pipeline, the data model | `docs/ARCHITECTURE.md` |
| What is built and what is next | `docs/ROADMAP.md` |
| What "done" means, per behavior | `feature_list.json` |
| Where the last session stopped | `docs/PROGRESS.md` |
| Rules learned the hard way | `../evo-dubbing-harness/principles/golden-principles.md` |
| Which rules a machine enforces | `../evo-dubbing-harness/principles/invariants.md` |
| What crosses a boundary and what checks it | `../evo-dubbing-harness/contracts.yaml` |

## The four seams that break silently

Each has a check under `scripts/verify/`. Run them with `npm run verify`.

1. **share-api** - `extension/src/lib/api/shareClient.ts` calls routes owned by
   `server/src/app/api/`. The extension is loaded unpacked and **never auto-updates**, so a
   shipped build keeps calling the old shape forever. Server changes must be additive.
   Check: `node scripts/verify/index.mjs share-api`
2. **bridge-protocol** - `extension/src/content/bridge-protocol.ts` defines a `postMessage`
   protocol between the ISOLATED-world caller (`extension/src/lib/platforms/youtube.ts`) and the
   MAIN-world script (`extension/src/content/page-bridge.ts`). A new `kind` with no handler
   fails silently.
   Check: `node scripts/verify/index.mjs bridge-protocol`
3. **env-contract** - every `process.env.X` in `server/` must be declared in
   `server/.env.example`. A missing var only surfaces at runtime, in production.
   Check: `node scripts/verify/index.mjs env-contract`
4. **model-catalog** - `extension/src/lib/providers/{openai,gemini}.ts` own the model and voice
   lists; `extension/src/lib/storage.ts` `DEFAULT_SETTINGS` picks defaults out of them. A model
   id renamed in one place and not the other renders an empty dropdown.
   Check: `node scripts/verify/index.mjs model-catalog`

## Rules

- **`feature_list.json`: you may only flip `status` and write `evidence`.** Never edit, delete,
  or reword a behavior. `npm run verify` fails if an id disappears or if a `status: "passing"`
  entry has empty `evidence`.
- **Model ids are data, not literals.** Add them to the provider catalog in
  `lib/providers/*.ts`. Do not hardcode a `gpt-*` / `gemini-*` string anywhere else.
- **The service worker is the only place allowed to do cross-origin `fetch`.** Content scripts
  proxy through `extension/src/background/service-worker.ts`; page CSP blocks the direct call.
- **Never read the YouTube player object from the content script.** It is in the page's MAIN
  world. Go through the bridge.
- **Do not commit debug dumps.** `player.json` and `player_android.json` at the repo root are
  exactly that, and are tracked debt (`../evo-dubbing-harness/docs/debt.md`).

## What is not verified

Honesty about the gaps, so a green `npm run verify` is not mistaken for a working dub:

- **No end-to-end test.** Nothing proves a real video actually dubs. Verify by hand in Chrome:
  load `extension/dist` unpacked, open a YouTube video with captions, press dub, confirm audio.
- **Provider APIs are external.** `gpt-*` / `gemini-*` ids and their parameter rules (see the
  `reasoning_effort` entry in golden-principles) can break with no commit on our side.
- **YouTube caption extraction is external and unowned.** `timedtext` needs a `pot`; the
  mechanism has already changed twice. When dubbing stops at 0 segments, suspect this first.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **evo-dubbing** (611 symbols, 1595 relationships, 49 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/evo-dubbing/context` | Codebase overview, check index freshness |
| `gitnexus://repo/evo-dubbing/clusters` | All functional areas |
| `gitnexus://repo/evo-dubbing/processes` | All execution flows |
| `gitnexus://repo/evo-dubbing/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Use this installed skill |
|------|---------------------|
| Understand architecture / "How does X work?" | `gitnexus-exploring` |
| Blast radius / "What breaks if I change X?" | `gitnexus-impact-analysis` |
| Trace bugs / "Why is X failing?" | `gitnexus-debugging` |
| Rename / extract / split / refactor | `gitnexus-refactoring` |
| Tools, resources, schema reference | `gitnexus-guide` |
| Index, status, clean, wiki CLI commands | `gitnexus-cli` |

<!-- gitnexus:end -->
