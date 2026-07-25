import { exists, read, result, abs } from "./_lib.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";

const MAP = "AGENTS.md";
const LINE_BUDGET = 150;
const MUST_MENTION = [
  ["init.ps1", "the boot command"],
  ["npm run verify", "the seam checks"],
  ["feature_list.json", "the work spec"],
  ["docs/PROGRESS.md", "where the last session stopped"]
];

export default function map() {
  const r = result("map", "AGENTS.md as the entry point");
  if (!exists(MAP)) {
    r.fail(`${MAP} is missing`, "an agent arriving with an empty context window has nothing to read first");
    return r;
  }

  const source = read(MAP);
  const lines = source.split("\n").length;
  if (lines > LINE_BUDGET) {
    r.fail(
      `${MAP} is ${lines} lines, over the ${LINE_BUDGET}-line budget`,
      `move detail into docs/ and leave a pointer; a map that grows into an encyclopedia crowds out the context it was meant to save`
    );
  }

  for (const [needle, what] of MUST_MENTION) {
    if (!source.includes(needle)) {
      r.fail(`${MAP} does not mention ${needle} (${what})`, `name it in ${MAP}; if it is not in the map, every session re-derives it`);
    }
  }

  const targets = [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
  const inline = [...source.matchAll(/`([a-zA-Z0-9_./-]+\.(?:md|json|ts|mjs|ps1|sh|yaml|yml|html))`/g)].map((m) => m[1]);
  for (const target of [...targets, ...inline]) {
    if (/^[a-z]+:\/\//.test(target) || target.startsWith("#")) continue;
    const clean = target.split("#")[0];
    const resolved = clean.startsWith("../") ? join(abs("."), clean) : abs(clean);
    if (!existsSync(resolved)) {
      r.fail(
        `${MAP} points at ${clean} which does not exist`,
        `fix the path or create the file; a dead pointer in the map costs every future session a search that returns nothing`
      );
    }
  }

  const harnessRoot = join(abs("."), "..", "evo-dubbing-harness");
  if (!existsSync(join(harnessRoot, "harness.yaml"))) {
    r.note(`the harness root ../evo-dubbing-harness is not on this machine; clone it or the cross-repo pointers in ${MAP} dangle`);
  }

  r.summary = `${lines}/${LINE_BUDGET} lines, ${targets.length + inline.length} pointer(s)`;
  return r;
}
