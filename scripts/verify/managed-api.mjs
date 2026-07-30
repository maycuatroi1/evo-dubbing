import { exists, read, result, walk } from "./_lib.mjs";

const ROUTES = {
  "/api/v1/inference/translate": "server/src/app/api/v1/inference/translate/route.ts",
  "/api/v1/inference/tts": "server/src/app/api/v1/inference/tts/route.ts"
};
const HANDLER_LIB = "server/src/lib/managed/inference-api.ts";
const ENVELOPE_LIB = "server/src/lib/api-error.ts";
const LEGACY_DUBS = "server/src/app/api/dubs";

export default function managedApi() {
  const r = result("managed-api", "extension -> managed v1 inference API");

  for (const [path, file] of Object.entries(ROUTES)) {
    if (!exists(file)) {
      r.fail(
        `${file} is missing so POST ${path} does not exist`,
        `create ${file}; step 11 of the managed-dubbing plan requires an additive POST ${path}`
      );
      continue;
    }
    const route = read(file);
    if (!/export\s+(async\s+function\s+POST|const\s+POST)\b/.test(route)) {
      r.fail(
        `${file} exports no POST handler for ${path}`,
        `add a POST export to ${file}; the managed extension flow depends on it`
      );
    }
  }

  if (!exists(HANDLER_LIB)) {
    r.fail(
      `${HANDLER_LIB} is missing`,
      `create ${HANDLER_LIB} with the testable translate/tts handlers`
    );
    return r;
  }
  const lib = read(HANDLER_LIB);
  if (!/requireV1Auth/.test(lib)) {
    r.fail(
      `${HANDLER_LIB} never calls requireV1Auth`,
      "both managed inference routes must require account auth; unauthenticated inference would bypass quota and billing"
    );
  }
  if (!/v1Error/.test(lib) || !/v1Json/.test(lib)) {
    r.fail(
      `${HANDLER_LIB} does not use the v1 envelope helpers`,
      "return errors via v1Error and success via v1Json so error codes stay stable for the extension"
    );
  }

  if (exists(ENVELOPE_LIB)) {
    const envelope = read(ENVELOPE_LIB);
    if (!/error:\s*\{\s*code/.test(envelope)) {
      r.fail(
        `${ENVELOPE_LIB} no longer emits the { error: { code, message } } shape`,
        "restore the v1 error envelope; the extension branches on error.code"
      );
    }
  }

  for (const file of walk(LEGACY_DUBS, ["route.ts"])) {
    const source = read(file);
    if (/managed\/inference|requireV1Auth|SupabaseAuthenticator/.test(source)) {
      r.fail(
        `${file} now touches the managed inference/auth stack`,
        "keep /api/dubs/* behavior unchanged; step 11 is additive and legacy BYOK routes must stay free of account auth"
      );
    }
  }

  r.summary = `${Object.keys(ROUTES).length} managed inference route(s), additive over /api/dubs/*`;
  return r;
}
