import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function abs(rel) {
  return join(repoRoot, rel);
}

export function exists(rel) {
  return existsSync(abs(rel));
}

export function read(rel) {
  return readFileSync(abs(rel), "utf8");
}

export function readOr(rel, fallback) {
  return exists(rel) ? read(rel) : fallback;
}

export function walk(rel, extensions) {
  const start = abs(rel);
  if (!existsSync(start)) return [];
  const out = [];
  const stack = [start];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        stack.push(full);
      } else if (!extensions || extensions.some((e) => entry.endsWith(e))) {
        out.push(relative(repoRoot, full).split("\\").join("/"));
      }
    }
  }
  return out.sort();
}

export function gitShow(ref, rel) {
  try {
    return execFileSync("git", ["show", `${ref}:${rel}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return null;
  }
}

export function result(name, seam) {
  return {
    name,
    seam,
    failures: [],
    notes: [],
    summary: "",
    fail(what, fix) {
      this.failures.push({ what, fix });
    },
    note(text) {
      this.notes.push(text);
    }
  };
}

export function extractStringArray(source, property) {
  const at = source.indexOf(`${property}:`);
  if (at === -1) return null;
  const open = source.indexOf("[", at);
  const close = source.indexOf("]", open);
  if (open === -1 || close === -1) return null;
  return [...source.slice(open + 1, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

export function callArguments(source, callee) {
  const calls = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(callee, from);
    if (at === -1) break;
    let i = source.indexOf("(", at);
    if (i === -1) break;
    let depth = 0;
    let quote = null;
    let start = i + 1;
    for (; i < source.length; i++) {
      const c = source[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(start, i));
    from = i + 1;
  }
  return calls;
}
