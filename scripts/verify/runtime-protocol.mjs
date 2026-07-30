import { exists, read, result } from "./_lib.mjs";

const PROTOCOL = "extension/src/lib/managed/protocol.ts";
const SERVICE_WORKER = "extension/src/background/service-worker.ts";
const SENDER = "extension/src/lib/managed/messages.ts";

function messageTypes(source) {
  const at = source.indexOf("RUNTIME_MESSAGE_TYPES");
  if (at === -1) return null;
  const open = source.indexOf("= [", at);
  const close = source.indexOf("]", open);
  if (open === -1 || close === -1) return null;
  return [...source.slice(open + 1, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

export default function runtimeProtocol() {
  const r = result("runtime-protocol", "content script <-> MV3 service worker typed runtime messages");
  for (const file of [PROTOCOL, SERVICE_WORKER, SENDER]) {
    if (!exists(file)) {
      r.fail(`${file} is missing`, "the runtime protocol was moved or renamed; update this check and contracts.yaml to match");
      return r;
    }
  }

  const types = messageTypes(read(PROTOCOL));
  if (!types || types.length === 0) {
    r.fail(
      `could not read RUNTIME_MESSAGE_TYPES from ${PROTOCOL}`,
      "keep RUNTIME_MESSAGE_TYPES as a single array of string literals, or update this check"
    );
    return r;
  }

  const worker = read(SERVICE_WORKER);
  const sender = read(SENDER);

  for (const type of types) {
    if (!worker.includes(`case "${type}"`)) {
      r.fail(
        `runtime message "${type}" has no handler in ${SERVICE_WORKER}`,
        `add a case "${type}" to handleRuntimeMessage in ${SERVICE_WORKER}; an unhandled kind makes the sender hang or report a generic error`
      );
    }
    if (!sender.includes(`type: "${type}"`)) {
      r.note(`runtime message "${type}" is declared and handled but never sent from ${SENDER}`);
    }
  }

  for (const sent of [...sender.matchAll(/type: "((?:auth|managed)\.[^"]+)"/g)].map((m) => m[1])) {
    if (!types.includes(sent)) {
      r.fail(
        `${SENDER} sends undeclared message kind "${sent}"`,
        `add "${sent}" to RuntimeMessage and RUNTIME_MESSAGE_TYPES in ${PROTOCOL}; undeclared kinds bypass the typed protocol`
      );
    }
  }

  r.summary = `${types.length} message kind(s) handled and sent`;
  return r;
}
