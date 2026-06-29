---
name: type-check-all-workspaces
command_path: "npm run type:all"
occurrences: 3
framework: "npm scripts"
entrypoint: "npm run <script>"
proposed_location: "Add to root package.json scripts alongside existing build:ext, build:server, dev:ext, etc."
learned_at: 2026-06-29T09:40:21
source_session: 71ecc7df-3e21-48bb-aff8-23586b6d48e3
---

# CLI Suggestion: `npm run type:all`

## Why
During development, developer runs `npx tsc --noEmit` separately for extension and server to catch type errors. A unified command reduces friction and ensures both workspaces are checked before committing.

## Observed calls (3x)
- `npx tsc --noEmit -p extension/tsconfig.json`
- `npx tsc --noEmit -p server/tsconfig.json`
- `npx tsc --noEmit -p extension/tsconfig.json (repeat to verify fix)`

## Proposed location
`Add to root package.json scripts alongside existing build:ext, build:server, dev:ext, etc.`

## Implementation sketch
```json
"type:all": "npm run type:ext && npm run type:server",
"type:ext": "tsc --noEmit -p extension/tsconfig.json",
"type:server": "tsc --noEmit -p server/tsconfig.json"
```
