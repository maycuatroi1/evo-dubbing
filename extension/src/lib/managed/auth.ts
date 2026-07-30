import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.ts";
import {
  clearManagedSession,
  isSessionExpired,
  loadManagedSession,
  saveManagedSession,
  type ManagedSession
} from "./session.ts";

export interface AuthState {
  signedIn: boolean;
  expiresAt?: number;
}

function parseTokenFragment(url: string): ManagedSession | null {
  const hash = new URL(url).hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const expiresIn = Number(params.get("expires_in") ?? "0");
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
    tokenType: params.get("token_type") ?? "bearer"
  };
}

export async function signInWithGoogle(): Promise<AuthState> {
  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl =
    `${SUPABASE_URL}/auth/v1/authorize?provider=google` +
    `&redirect_to=${encodeURIComponent(redirectUrl)}`;
  const responseUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  if (!responseUrl) throw new Error("Sign-in was cancelled.");
  const session = parseTokenFragment(responseUrl);
  if (!session) throw new Error("Supabase did not return a session. Check the redirect URL allowlist.");
  await saveManagedSession(session);
  return { signedIn: true, expiresAt: session.expiresAt };
}

interface RefreshResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export async function refreshSession(): Promise<AuthState> {
  const session = await loadManagedSession();
  if (!session) return { signedIn: false };
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh_token: session.refreshToken })
  });
  if (!res.ok) {
    await clearManagedSession();
    return { signedIn: false };
  }
  const body = (await res.json()) as RefreshResponse;
  if (!body.access_token || !body.refresh_token) {
    await clearManagedSession();
    return { signedIn: false };
  }
  const next: ManagedSession = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (body.expires_in && body.expires_in > 0 ? body.expires_in : 3600) * 1000,
    tokenType: body.token_type ?? "bearer"
  };
  await saveManagedSession(next);
  return { signedIn: true, expiresAt: next.expiresAt };
}

export async function signOut(): Promise<void> {
  const session = await loadManagedSession();
  if (session) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.accessToken}`
      }
    }).catch(() => undefined);
  }
  await clearManagedSession();
}

export async function getAuthState(): Promise<AuthState> {
  const session = await loadManagedSession();
  if (!session) return { signedIn: false };
  if (isSessionExpired(session)) return refreshSession();
  return { signedIn: true, expiresAt: session.expiresAt };
}

export async function getValidAccessToken(): Promise<string | null> {
  const session = await loadManagedSession();
  if (!session) return null;
  if (!isSessionExpired(session)) return session.accessToken;
  const refreshed = await refreshSession();
  if (!refreshed.signedIn) return null;
  const next = await loadManagedSession();
  return next?.accessToken ?? null;
}
