export interface ManagedSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
}

const SESSION_KEY = "evoDubbingManagedSession";

export async function loadManagedSession(): Promise<ManagedSession | null> {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  const session = stored[SESSION_KEY] as ManagedSession | undefined;
  if (!session || typeof session.accessToken !== "string" || typeof session.refreshToken !== "string") {
    return null;
  }
  return session;
}

export async function saveManagedSession(session: ManagedSession): Promise<void> {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
}

export async function clearManagedSession(): Promise<void> {
  await chrome.storage.local.remove(SESSION_KEY);
}

export function isSessionExpired(session: ManagedSession, skewMs = 60_000): boolean {
  return session.expiresAt - skewMs <= Date.now();
}
