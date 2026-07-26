import type { ManagedAccount, ManagedCheckoutResult } from "./account.ts";
import type {
  AuthMessage,
  ManagedLookupDubPayload,
  ManagedMessage,
  ManagedTranslatePayload,
  ManagedTranslateResult,
  ManagedTtsPayload,
  ManagedTtsResult,
  RuntimeResponse
} from "./protocol.ts";

export class ManagedClientError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface ManagedAuthState {
  signedIn: boolean;
  expiresAt?: number;
}

async function send(message: AuthMessage | ManagedMessage): Promise<unknown> {
  const res = (await chrome.runtime.sendMessage(message)) as RuntimeResponse | undefined;
  if (!res) throw new ManagedClientError(0, "no_response", "No response from the extension background worker.");
  if (!res.ok) throw new ManagedClientError(res.status, res.code, res.error);
  return res.data;
}

export async function managedSignIn(): Promise<ManagedAuthState> {
  return (await send({ type: "auth.signIn" })) as ManagedAuthState;
}

export async function managedSignOut(): Promise<void> {
  await send({ type: "auth.signOut" });
}

export async function managedRefresh(): Promise<ManagedAuthState> {
  return (await send({ type: "auth.refresh" })) as ManagedAuthState;
}

export async function managedAuthState(): Promise<ManagedAuthState> {
  return (await send({ type: "auth.getState" })) as ManagedAuthState;
}

export async function managedAccount(baseUrl: string): Promise<ManagedAccount> {
  return (await send({ type: "managed.account", payload: { baseUrl } })) as ManagedAccount;
}

export async function managedCheckout(baseUrl: string, planId?: string): Promise<ManagedCheckoutResult> {
  return (await send({ type: "managed.checkout", payload: { baseUrl, planId } })) as ManagedCheckoutResult;
}

export interface ManagedSharedSegment {
  idx: number;
  startMs: number;
  endMs: number;
  originalText: string;
  text: string;
  audioUrl: string;
  mime: string;
}

export interface ManagedSharedDub {
  id: string;
  platform: string;
  videoId: string;
  sourceLang: string;
  targetLang: string;
  voice: string;
  provider: string;
  title: string;
  durationMs: number;
  visibility: "public" | "private";
  generationProfile: string | null;
  voiceProfile: string | null;
  rightsAssertedAt: string | null;
  aiVoiceDisclosure: string;
  segments: ManagedSharedSegment[];
}

export async function managedLookupDub(payload: ManagedLookupDubPayload): Promise<ManagedSharedDub | null> {
  try {
    return (await send({ type: "managed.lookupDub", payload })) as ManagedSharedDub;
  } catch (err) {
    if (err instanceof ManagedClientError && err.status === 404) return null;
    throw err;
  }
}

interface ServerTranslateResponse {
  batchId: string;
  translations: { id: string; text: string; startMs: number; endMs: number }[];
}

interface ServerTtsResponse {
  requestId: string;
  chargedSourceMs: number;
  remainingMs: number;
  voiceProfileVersion: string;
  audioUrl?: string;
  audioBase64?: string;
  audioKey?: string;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function managedTranslate(payload: ManagedTranslatePayload): Promise<ManagedTranslateResult> {
  const data = (await send({ type: "managed.translate", payload })) as ServerTranslateResponse;
  return {
    translations: data.translations.map((t) => ({
      idx: Number(t.id.replace(/^s/, "")),
      text: t.text
    }))
  };
}

export async function managedTts(payload: ManagedTtsPayload): Promise<ManagedTtsResult> {
  const data = (await send({ type: "managed.tts", payload })) as ServerTtsResponse;
  const result: ManagedTtsResult = {
    mime: "audio/mpeg",
    chargedSourceMs: data.chargedSourceMs,
    remainingMs: data.remainingMs,
    voiceProfileVersion: data.voiceProfileVersion
  };
  if (typeof data.audioBase64 === "string" && data.audioBase64) {
    result.audio = base64ToArrayBuffer(data.audioBase64);
  } else if (typeof data.audioUrl === "string" && data.audioUrl) {
    result.audioUrl = data.audioUrl;
  } else {
    throw new ManagedClientError(502, "provider_bad_response", "Managed TTS returned no playable audio.");
  }
  return result;
}
