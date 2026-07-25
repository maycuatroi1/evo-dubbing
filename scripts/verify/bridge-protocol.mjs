import { exists, read, result, walk } from "./_lib.mjs";

const PROTOCOL = "extension/src/content/bridge-protocol.ts";
const MAIN_WORLD = "extension/src/content/page-bridge.ts";
const ISOLATED_WORLD = "extension/src/lib/platforms/youtube.ts";
const CHANNEL_LITERALS = ["evo-dub-req", "evo-dub-res"];

function unionKinds(source, typeName) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`export type ${typeName}`));
  if (start === -1) return null;
  const block = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim() || /^\S/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return [...block.join("\n").matchAll(/kind:\s*"([^"]+)"/g)].map((m) => m[1]);
}

export default function bridgeProtocol() {
  const r = result("bridge-protocol", "MAIN-world page bridge <-> ISOLATED-world content script");
  for (const file of [PROTOCOL, MAIN_WORLD, ISOLATED_WORLD]) {
    if (!exists(file)) {
      r.fail(`${file} is missing`, "the bridge was moved or renamed; update this check and contracts.yaml to match");
      return r;
    }
  }

  const protocol = read(PROTOCOL);
  const requests = unionKinds(protocol, "BridgeRequest");
  const results = unionKinds(protocol, "BridgeResult");
  if (!requests || !results) {
    r.fail(
      `could not read BridgeRequest / BridgeResult from ${PROTOCOL}`,
      "keep both as a discriminated union of { kind: \"...\" } members, or update this check"
    );
    return r;
  }

  const mainWorld = read(MAIN_WORLD);
  const isolated = read(ISOLATED_WORLD);

  for (const kind of requests) {
    if (!mainWorld.includes(`"${kind}"`)) {
      r.fail(
        `BridgeRequest kind "${kind}" has no handler in ${MAIN_WORLD}`,
        `handle req.kind === "${kind}" in ${MAIN_WORLD}; an unhandled kind returns undefined and the caller hangs or reports a generic error instead of the real cause`
      );
    }
    if (!isolated.includes(`"${kind}"`)) {
      r.note(`BridgeRequest kind "${kind}" is declared and handled but never sent from ${ISOLATED_WORLD}`);
    }
  }

  for (const kind of results) {
    if (kind === "error") continue;
    if (!isolated.includes(`"${kind}"`)) {
      r.fail(
        `BridgeResult kind "${kind}" is never discriminated in ${ISOLATED_WORLD}`,
        `check for res.kind === "${kind}" in ${ISOLATED_WORLD}; a result nobody reads means the round trip silently drops data`
      );
    }
    if (!mainWorld.includes(`"${kind}"`)) {
      r.fail(
        `BridgeResult kind "${kind}" is never produced in ${MAIN_WORLD}`,
        `return { kind: "${kind}", ... } from ${MAIN_WORLD}, or delete the member from BridgeResult`
      );
    }
  }

  for (const file of walk("extension/src", [".ts"])) {
    if (file === PROTOCOL) continue;
    const source = read(file);
    for (const literal of CHANNEL_LITERALS) {
      if (source.includes(`"${literal}"`)) {
        r.fail(
          `${file} hardcodes the channel literal "${literal}"`,
          `import BRIDGE_REQ / BRIDGE_RES from ${PROTOCOL} instead; two copies of a postMessage channel name drift apart with no type error`
        );
      }
    }
  }

  r.summary = `${requests.length} request kind(s), ${results.length} result kind(s)`;
  return r;
}
