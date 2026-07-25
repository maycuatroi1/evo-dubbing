import { exists, read, result, callArguments, walk } from "./_lib.mjs";

const CLIENT = "extension/src/lib/api/shareClient.ts";
const ROUTES = "server/src/app/api";
const DOCS = ["docs/ARCHITECTURE.md", "AGENTS.md", "server/README.md", "README.md"];

function normalize(path) {
  return path
    .split("?")[0]
    .replace(/\$\{[^}]*\}/g, "[id]")
    .replace(/\/+$/, "");
}

function routeFile(apiPath) {
  return `server/src/app${apiPath}/route.ts`;
}

export default function shareApi() {
  const r = result("share-api", "extension -> server HTTP API");
  if (!exists(CLIENT)) {
    r.fail(`${CLIENT} is missing`, "the extension no longer has a share client; drop this seam from contracts.yaml or restore the file");
    return r;
  }

  const client = read(CLIENT);
  const called = new Map();
  for (const args of [...callArguments(client, "fetchJson"), ...callArguments(client, "putBinary")]) {
    const found = args.match(/\/api\/[^`"'\s]*/);
    if (!found) continue;
    const path = normalize(found[0]);
    const method = (args.match(/method:\s*"([A-Z]+)"/) || [null, "GET"])[1];
    if (!called.has(path)) called.set(path, new Set());
    called.get(path).add(method);
  }

  if (called.size === 0) {
    r.fail(`no /api/ calls found in ${CLIENT}`, "the extractor expects fetchJson/putBinary with a template literal containing /api/...; update this check if the client was rewritten");
    return r;
  }

  for (const [path, methods] of called) {
    const file = routeFile(path);
    if (!exists(file)) {
      r.fail(
        `the extension calls ${[...methods].join("/")} ${path} but ${file} does not exist`,
        `create ${file}, or change ${CLIENT} to call a route that exists`
      );
      continue;
    }
    const route = read(file);
    for (const method of methods) {
      if (!new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(route)) {
        r.fail(
          `the extension calls ${method} ${path} but ${file} exports no ${method} handler`,
          `add "export async function ${method}" to ${file}; a shipped extension build is loaded unpacked and never auto-updates, so it will keep calling this forever`
        );
      }
    }
  }

  const served = new Set();
  for (const file of walk(ROUTES, ["route.ts"])) {
    const apiPath = "/" + file.replace("server/src/app/", "").replace(/\/route\.ts$/, "");
    served.add(apiPath);
    for (const method of read(file).matchAll(/export\s+async\s+function\s+([A-Z]+)\b/g)) {
      if (!called.has(apiPath) || !called.get(apiPath).has(method[1])) {
        r.note(`${method[1]} ${apiPath} is served but never called by the extension`);
      }
    }
  }

  for (const doc of DOCS) {
    if (!exists(doc)) continue;
    for (const m of read(doc).matchAll(/(?<![A-Za-z0-9._/-])\/api\/[a-z0-9/[\]_-]+/gi)) {
      const path = normalize(m[0]);
      if (!served.has(path) && !served.has(path.replace(/\/\[id\]/g, "/[id]"))) {
        r.fail(
          `${doc} documents ${path} which no route serves`,
          `fix the path in ${doc}, or add ${routeFile(path)}; an agent following the doc will call an endpoint that does not exist`
        );
      }
    }
  }

  r.summary = `${called.size} client path(s), ${served.size} route(s)`;
  return r;
}
