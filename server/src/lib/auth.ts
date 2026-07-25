import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose";
import type { JWTVerifyGetKey } from "jose";
import { V1_ERROR_CODES } from "./api-error.ts";

export const DEFAULT_SUPABASE_ISSUER = "https://lrypactuodbguwncoomc.supabase.co/auth/v1";
export const DEFAULT_SUPABASE_AUDIENCE = "authenticated";

export interface AuthConfig {
  issuer: string;
  audience: string;
  jwksUrl: string;
  rateLimitPerMinute: number;
}

export function parseAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const issuer = env.SUPABASE_ISSUER ?? DEFAULT_SUPABASE_ISSUER;
  return {
    issuer,
    audience: env.SUPABASE_AUDIENCE ?? DEFAULT_SUPABASE_AUDIENCE,
    jwksUrl: env.SUPABASE_JWKS_URL ?? `${issuer}/.well-known/jwks.json`,
    rateLimitPerMinute: Number(env.V1_RATE_LIMIT_PER_MINUTE ?? 60)
  };
}

export function authConfig(): AuthConfig {
  return parseAuthConfig(process.env);
}

export type VerifyResult =
  | { ok: true; userId: string }
  | { ok: false; code: string; message: string };

export class SupabaseAuthenticator {
  private config: AuthConfig;
  private jwks: JWTVerifyGetKey;

  constructor(config: AuthConfig, jwks?: JWTVerifyGetKey) {
    this.config = config;
    this.jwks = jwks ?? createRemoteJWKSet(new URL(config.jwksUrl));
  }

  async verify(token: string): Promise<VerifyResult> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience
      });
      if (typeof payload.sub !== "string" || !payload.sub) {
        return { ok: false, code: V1_ERROR_CODES.invalidToken, message: "token subject missing" };
      }
      return { ok: true, userId: payload.sub };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        return { ok: false, code: V1_ERROR_CODES.tokenExpired, message: "access token expired" };
      }
      return { ok: false, code: V1_ERROR_CODES.invalidToken, message: "invalid access token" };
    }
  }
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export class UserOperationRateLimiter {
  private limit: number;
  private windowMs: number;
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(limitPerMinute: number, windowMs = 60_000) {
    this.limit = limitPerMinute;
    this.windowMs = windowMs;
  }

  check(userId: string, operation: string, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
    const key = `${userId}${operation}`;
    const entry = this.hits.get(key);
    if (!entry || now >= entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.prune(now);
      return { allowed: true, retryAfterSec: 0 };
    }
    entry.count += 1;
    if (entry.count > this.limit) {
      return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  private prune(now: number): void {
    if (this.hits.size < 1000) return;
    for (const [k, v] of this.hits) {
      if (now >= v.resetAt) this.hits.delete(k);
    }
  }
}

export type RequireAuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; code: string; message: string; retryAfterSec?: number };

export async function requireV1Auth(
  request: Request,
  authenticator: SupabaseAuthenticator,
  limiter: UserOperationRateLimiter,
  operation: string
): Promise<RequireAuthResult> {
  const token = bearerToken(request);
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: V1_ERROR_CODES.missingToken,
      message: "missing bearer token"
    };
  }
  const verified = await authenticator.verify(token);
  if (!verified.ok) {
    return { ok: false, status: 401, code: verified.code, message: verified.message };
  }
  const limited = limiter.check(verified.userId, operation);
  if (!limited.allowed) {
    return {
      ok: false,
      status: 429,
      code: V1_ERROR_CODES.rateLimited,
      message: `rate limit exceeded for ${operation}`,
      retryAfterSec: limited.retryAfterSec
    };
  }
  return { ok: true, userId: verified.userId };
}
