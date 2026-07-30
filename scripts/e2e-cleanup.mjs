import { readFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "https://nghe.omelet.tech").replace(/\/$/, "");
const statePath = join(dirname(fileURLToPath(import.meta.url)), "..", "e2e", ".seed-state.json");

async function main() {
  if (!existsSync(statePath)) {
    console.log("nothing to clean: no seed state file");
    return;
  }
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const res = await fetch(`${BASE_URL}/api/dubs/${state.dubId}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ownerToken: state.ownerToken })
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`DELETE /api/dubs/${state.dubId} -> ${res.status}`);
  }
  rmSync(statePath);
  console.log(`cleanup ok: dub ${state.dubId} removed`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
