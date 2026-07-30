import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import {
  DEFAULT_SUPABASE_AUDIENCE,
  DEFAULT_SUPABASE_ISSUER,
  SupabaseAuthenticator,
  UserOperationRateLimiter,
  bearerToken,
  parseAuthConfig,
  requireV1Auth
} from "../src/lib/auth.ts";
import { buildAccountPayload, parseManagedFlags } from "../src/lib/account.ts";

const ISSUER = DEFAULT_SUPABASE_ISSUER;
const AUDIENCE = DEFAULT_SUPABASE_AUDIENCE;
const KEY_ID = "test-signing-key";
const USER_ID = "0b7f3a2e-6c4d-4f1e-9a2b-1c2d3e4f5a6b";

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: KEY_ID, alg: "ES256" };
const testJwks = createLocalJWKSet({ keys: [publicJwk] });

function config(overrides: Record<string, string | undefined> = {}) {
  return parseAuthConfig({
    SUPABASE_ISSUER: ISSUER,
    SUPABASE_AUDIENCE: AUDIENCE,
    V1_RATE_LIMIT_PER_MINUTE: "60",
    ...overrides
  });
}

function authenticator() {
  return new SupabaseAuthenticator(config(), testJwks);
}

async function signToken(
  options: { sub?: string; iss?: string; aud?: string; expOffsetSec?: number; key?: typeof privateKey } = {}
) {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID, typ: "JWT" })
    .setSubject(options.sub ?? USER_ID)
    .setIssuer(options.iss ?? ISSUER)
    .setAudience(options.aud ?? AUDIENCE)
    .setIssuedAt(nowSec - 10)
    .setExpirationTime(nowSec + (options.expOffsetSec ?? 600))
    .sign(options.key ?? privateKey);
}

function authRequest(token?: string) {
  const headers = new Headers();
  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
  return new Request("https://server.test/api/v1/account", { headers });
}

function unlimited() {
  return new UserOperationRateLimiter(1000);
}

test("config defaults to the Supabase project issuer and authenticated audience", () => {
  const parsed = parseAuthConfig({});
  assert.equal(parsed.issuer, "https://lrypactuodbguwncoomc.supabase.co/auth/v1");
  assert.equal(parsed.audience, "authenticated");
  assert.equal(
    parsed.jwksUrl,
    "https://lrypactuodbguwncoomc.supabase.co/auth/v1/.well-known/jwks.json"
  );
});

test("missing token returns 401 missing_token", async () => {
  const result = await requireV1Auth(authRequest(), authenticator(), unlimited(), "account.read");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 401);
    assert.equal(result.code, "missing_token");
  }
});

test("non-bearer authorization header is rejected", async () => {
  const headers = new Headers({ authorization: "Basic abc" });
  const request = new Request("https://server.test/api/v1/account", { headers });
  assert.equal(bearerToken(request), null);
  const result = await requireV1Auth(request, authenticator(), unlimited(), "account.read");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
});

test("expired token returns 401 token_expired", async () => {
  const token = await signToken({ expOffsetSec: -60 });
  const result = await requireV1Auth(authRequest(token), authenticator(), unlimited(), "account.read");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 401);
    assert.equal(result.code, "token_expired");
  }
});

test("wrong issuer returns 401", async () => {
  const token = await signToken({ iss: "https://attacker.example.com/auth/v1" });
  const result = await requireV1Auth(authRequest(token), authenticator(), unlimited(), "account.read");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 401);
    assert.equal(result.code, "invalid_token");
  }
});

test("wrong audience returns 401", async () => {
  const token = await signToken({ aud: "service_role" });
  const result = await requireV1Auth(authRequest(token), authenticator(), unlimited(), "account.read");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
});

test("forged JWT signed with an unknown key returns 401", async () => {
  const attacker = await generateKeyPair("ES256");
  const token = await signToken({ key: attacker.privateKey });
  const result = await requireV1Auth(authRequest(token), authenticator(), unlimited(), "account.read");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
});

test("tampered JWT payload returns 401", async () => {
  const token = await signToken();
  const [header, payload] = token.split(".");
  const forgedPayload = Buffer.from(JSON.stringify({ sub: "attacker", iss: ISSUER, aud: AUDIENCE }))
    .toString("base64url");
  const tampered = `${header}.${forgedPayload}.${token.split(".")[2]}`;
  assert.notEqual(payload, forgedPayload);
  const result = await requireV1Auth(authRequest(tampered), authenticator(), unlimited(), "account.read");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
});

test("valid token maps sub to user_id", async () => {
  const token = await signToken();
  const result = await requireV1Auth(authRequest(token), authenticator(), unlimited(), "account.read");
  assert.deepEqual(result, { ok: true, userId: USER_ID });
});

test("valid token still verifies after a service-worker restart and yields the right account", async () => {
  const token = await signToken();
  const freshAuthenticator = authenticator();
  const freshLimiter = unlimited();
  const result = await requireV1Auth(authRequest(token), freshAuthenticator, freshLimiter, "account.read");
  assert.deepEqual(result, { ok: true, userId: USER_ID });
  if (result.ok) {
    const payload = buildAccountPayload({
      userId: result.userId,
      periods: [],
      trialUsedMs: 0,
      flags: parseManagedFlags({}),
      now: new Date()
    });
    assert.equal(payload.userId, USER_ID);
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /secret|checksum|api_?key|payos|password/i);
  }
});

test("rate limit is applied per user and per operation", () => {
  const limiter = new UserOperationRateLimiter(2);
  const t0 = 1_000_000;
  assert.equal(limiter.check("user-a", "account.read", t0).allowed, true);
  assert.equal(limiter.check("user-a", "account.read", t0 + 1).allowed, true);
  const denied = limiter.check("user-a", "account.read", t0 + 2);
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterSec > 0);
  assert.equal(limiter.check("user-a", "dubs.lookup", t0 + 3).allowed, true);
  assert.equal(limiter.check("user-b", "account.read", t0 + 4).allowed, true);
  assert.equal(limiter.check("user-a", "account.read", t0 + 61_000).allowed, true);
});

test("requireV1Auth returns 429 once the user+operation limit is exceeded", async () => {
  const limiter = new UserOperationRateLimiter(1);
  const token = await signToken();
  const first = await requireV1Auth(authRequest(token), authenticator(), limiter, "account.read");
  assert.equal(first.ok, true);
  const second = await requireV1Auth(authRequest(token), authenticator(), limiter, "account.read");
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.status, 429);
    assert.equal(second.code, "rate_limited");
    assert.ok(second.retryAfterSec && second.retryAfterSec > 0);
  }
});

test("BYOK and public share lookup routes under /api/dubs stay free of account auth", () => {
  const apiDir = fileURLToPath(new URL("../src/app/api/dubs", import.meta.url));
  const routeFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts")) routeFiles.push(full);
    }
  };
  walk(apiDir);
  assert.ok(routeFiles.length >= 4);
  for (const file of routeFiles) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /lib\/auth|requireV1Auth|SupabaseAuthenticator/, `${file} must not require account auth`);
  }
});
