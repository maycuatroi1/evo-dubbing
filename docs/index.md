# docs/

The system of record for evo-dubbing. `../AGENTS.md` is the map; this is the index of what the
map points at.

| File | What it answers | Owner of the answer |
|------|-----------------|---------------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the extension, server and pipeline fit together; the data model; the storage layout; the security posture | this repo |
| [ROADMAP.md](ROADMAP.md) | Milestones and what is deliberately not built yet | this repo |
| [PROGRESS.md](PROGRESS.md) | Where the last session stopped and what the next one should pick up | this repo |
| [../feature_list.json](../feature_list.json) | What "done" means per behavior, and which behaviors are actually verified | this repo, edit rules in `../AGENTS.md` |

Knowledge that is deliberately **not** here, because it is about the harness rather than the
product, lives in `../../evo-dubbing-harness/`:

| File | What it answers |
|------|-----------------|
| `CLUSTER.md` | The one-page orientation for an agent arriving at the cluster |
| `contracts.yaml` | Every seam that crosses a boundary, its owner, and the command that verifies it |
| `principles/golden-principles.md` | Rules learned the hard way, not yet mechanized |
| `principles/invariants.md` | Rules a machine enforces, each naming its check |
| `docs/debt.md` | Known debt, with the cost of leaving it |
| `plans/active/` | Multi-step changes in flight |

## What a competent stranger still cannot find out from this repo

Kept honest on purpose. Every line here is knowledge that only exists in someone's head, which
means it is invisible to an agent too:

- Which Cloudflare R2 bucket and Supabase project the deployed server uses, and who holds those
  credentials. `server/.env.example` names the variables and nothing names the instances.
- Where the server is actually deployed, and how a new image gets there. `server/Dockerfile`
  exists; no doc says what consumes it.
- Whether the extension has ever been submitted to the Chrome Web Store, or whether "load
  unpacked" is the intended distribution forever.
- Which YouTube videos were used to test caption extraction. That list is the closest thing this
  project has to a regression suite, and it is not written down.
