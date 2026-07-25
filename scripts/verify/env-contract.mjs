import { exists, read, result, walk } from "./_lib.mjs";

const EXAMPLE = "server/.env.example";
const SOURCES = ["server/src", "server/drizzle.config.ts", "server/next.config.js"];
const RUNTIME_PROVIDED = new Set(["NODE_ENV", "VERCEL_URL", "PORT"]);

export default function envContract() {
  const r = result("env-contract", "server code <-> server/.env.example");
  if (!exists(EXAMPLE)) {
    r.fail(`${EXAMPLE} is missing`, "create it; without a declared contract every deploy is a guess about which vars are needed");
    return r;
  }

  const declared = new Set(
    read(EXAMPLE)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => line.split("=")[0].trim())
  );

  const files = [];
  for (const source of SOURCES) {
    if (!exists(source)) continue;
    if (source.endsWith(".ts") || source.endsWith(".js")) files.push(source);
    else files.push(...walk(source, [".ts", ".tsx", ".js", ".mjs"]));
  }

  const readBy = new Map();
  const contents = files.map((file) => ({ file, content: read(file) }));
  const envEscapes = contents.some(({ content }) => /process\.env(?!\.\w)/.test(content));
  for (const { file, content } of contents) {
    for (const m of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      if (!readBy.has(m[1])) readBy.set(m[1], new Set());
      readBy.get(m[1]).add(file);
    }
    if (envEscapes) {
      for (const m of content.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) {
        if (!readBy.has(m[1])) readBy.set(m[1], new Set());
        readBy.get(m[1]).add(file);
      }
    }
  }

  for (const [name, where] of readBy) {
    if (RUNTIME_PROVIDED.has(name)) continue;
    if (!declared.has(name)) {
      r.fail(
        `${[...where][0]} reads ${name} which ${EXAMPLE} does not declare`,
        `add "${name}=" to ${EXAMPLE} with a placeholder value; an undeclared var is missing from every new deploy and only fails at runtime`
      );
    }
  }

  for (const name of declared) {
    if (!readBy.has(name)) {
      r.fail(
        `${EXAMPLE} declares ${name} but no server code reads it`,
        `remove ${name} from ${EXAMPLE}, or read it where it is meant to apply; a declared-but-unused var makes operators configure something that does nothing`
      );
    }
  }

  const contracted = [...readBy.keys()].filter((name) => !RUNTIME_PROVIDED.has(name)).length;
  r.summary = `${declared.size} declared, ${contracted} read + ${readBy.size - contracted} runtime-provided (names only, no values)`;
  return r;
}
