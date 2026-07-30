import { read, result, walk } from "./_lib.mjs";

const CONTENT_REACHABLE_ROOTS = ["extension/src/content"];

const WORKER_ONLY_MODULES = [
  "lib/managed/auth",
  "lib/managed/session",
  "lib/managed/client",
  "lib/managed/config"
];

const FORBIDDEN_IN_CONTENT = [
  { pattern: "evoDubbingManagedSession", why: "the managed session storage key must stay inside the service worker" },
  { pattern: "accessToken", why: "managed access tokens must never cross into content scripts" },
  { pattern: "refreshToken", why: "managed refresh tokens must never cross into content scripts" },
  { pattern: "refresh_token", why: "managed refresh tokens must never cross into content scripts" },
  { pattern: "launchWebAuthFlow", why: "the OAuth flow runs in the service worker only" },
  { pattern: "SUPABASE_PUBLISHABLE_KEY", why: "Supabase config is read by the service worker only" }
];

const FORBIDDEN_ANYWHERE = [
  { pattern: "sb_secret_", why: "Supabase secret keys are server-only; never commit them to the extension" },
  { pattern: "sb_publishable_", why: "inject the publishable key at build time via VITE_SUPABASE_PUBLISHABLE_KEY, not as a literal" },
  { pattern: "service_role", why: "service-role credentials are server-only" }
];

export default function secretBoundary() {
  const r = result("secret-boundary", "managed tokens and secret keys never reach content scripts");

  const contentFiles = CONTENT_REACHABLE_ROOTS.flatMap((root) => walk(root, [".ts"]));
  if (contentFiles.length === 0) {
    r.fail("no content script sources found", "CONTENT_REACHABLE_ROOTS drifted from the extension layout; update this check");
    return r;
  }

  for (const file of contentFiles) {
    const source = read(file);
    for (const { pattern, why } of FORBIDDEN_IN_CONTENT) {
      if (source.includes(pattern)) {
        r.fail(
          `${file} references "${pattern}"`,
          `${why}; content scripts must go through the typed runtime messages in extension/src/lib/managed/messages.ts`
        );
      }
    }
    for (const mod of WORKER_ONLY_MODULES) {
      if (source.includes(mod)) {
        r.fail(
          `${file} imports the worker-only module "${mod}"`,
          "only extension/src/background and extension/src/lib/managed may import auth/session/client/config; use messages.ts from content scripts"
        );
      }
    }
  }

  for (const file of walk("extension/src", [".ts"])) {
    const source = read(file);
    for (const { pattern, why } of FORBIDDEN_ANYWHERE) {
      if (source.includes(pattern)) {
        r.fail(`${file} contains "${pattern}"`, why);
      }
    }
  }

  for (const file of walk("extension/src", [".ts"])) {
    if (file.startsWith("extension/src/background/") || file.startsWith("extension/src/lib/managed/")) continue;
    const source = read(file);
    for (const mod of WORKER_ONLY_MODULES) {
      if (source.includes(`managed/${mod.split("/").pop()}`) || source.includes(mod)) {
        r.fail(
          `${file} imports the worker-only module "${mod}" outside the service worker`,
          "token-bearing modules are only reachable from extension/src/background; keep the boundary or update this check deliberately"
        );
      }
    }
  }

  r.summary = `${contentFiles.length} content file(s) clean, no secret literals in extension/src`;
  return r;
}
