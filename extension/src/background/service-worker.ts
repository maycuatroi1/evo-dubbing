interface FormFileDescriptor {
  field: string;
  filename: string;
  mime: string;
  base64: string;
}

import { createManagedCheckout, fetchManagedAccount } from "../lib/managed/account.ts";
import { getAuthState, refreshSession, signInWithGoogle, signOut } from "../lib/managed/auth.ts";
import { handleManagedLookupDub, handleManagedTranslate, handleManagedTts } from "../lib/managed/client.ts";
import { handlePlaybackEvent } from "../lib/managed/events.ts";
import {
  RUNTIME_MESSAGE_TYPES,
  type RuntimeMessage,
  type RuntimeMessageType,
  type RuntimeResponse
} from "../lib/managed/protocol.ts";

function isRuntimeMessage(message: unknown): message is RuntimeMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    typeof (message as { type?: unknown }).type === "string" &&
    RUNTIME_MESSAGE_TYPES.includes((message as { type: string }).type as RuntimeMessageType)
  );
}

async function handleRuntimeMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
  try {
    switch (message.type) {
      case "auth.signIn":
        return { ok: true, data: await signInWithGoogle() };
      case "auth.signOut":
        await signOut();
        return { ok: true, data: { signedIn: false } };
      case "auth.refresh":
        return { ok: true, data: await refreshSession() };
      case "auth.getState":
        return { ok: true, data: await getAuthState() };
      case "managed.translate":
        return await handleManagedTranslate(message.payload);
      case "managed.tts":
        return await handleManagedTts(message.payload);
      case "managed.account":
        return await fetchManagedAccount(message.payload.baseUrl);
      case "managed.checkout":
        return await createManagedCheckout(message.payload.baseUrl, message.payload.planId);
      case "managed.lookupDub":
        return await handleManagedLookupDub(message.payload);
      case "events.playback":
        return await handlePlaybackEvent(message.payload);
    }
  } catch (err) {
    return { ok: false, status: 0, code: "internal_error", error: err instanceof Error ? err.message : String(err) };
  }
}

interface FormDescriptor {
  fields?: Record<string, string>;
  file?: FormFileDescriptor;
}

type FetchProxyRequest = {
  type: "fetchProxy";
  url: string;
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    bodyBase64?: string;
  };
  form?: FormDescriptor;
  as: "text" | "arrayBuffer" | "json";
};

type FetchProxyResponse =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string };

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function buildBody(req: FetchProxyRequest): BodyInit | undefined {
  if (req.form) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(req.form.fields ?? {})) {
      fd.append(k, v);
    }
    if (req.form.file) {
      const bytes = base64ToBytes(req.form.file.base64);
      const blob = new Blob([bytes as BlobPart], { type: req.form.file.mime });
      fd.append(req.form.file.field, blob, req.form.file.filename);
    }
    return fd;
  }
  if (req.init?.bodyBase64 !== undefined) {
    return base64ToBytes(req.init.bodyBase64) as unknown as BodyInit;
  }
  return req.init?.body;
}

const FETCH_TIMEOUT_MS = 120000;
const KEEPALIVE_PING_MS = 20000;

let inFlight = 0;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

function pingForKeepAlive(): void {
  try {
    chrome.runtime.getPlatformInfo().catch(() => undefined);
  } catch {
    // Nothing to keep alive if the runtime is already gone.
  }
}

/**
 * Chrome evicts an MV3 service worker after roughly 30 seconds without extension API activity,
 * and a bare fetch() does not reset that timer. Long TTS calls outlived the worker, so every
 * in-flight proxied request died together and surfaced as "the message channel closed".
 * Touching an extension API on a timer holds the worker open for exactly as long as there is
 * work in the air, and no longer.
 */
async function withKeepAlive<T>(run: () => Promise<T>): Promise<T> {
  inFlight++;
  if (keepAliveTimer === null) keepAliveTimer = setInterval(pingForKeepAlive, KEEPALIVE_PING_MS);
  try {
    return await run();
  } finally {
    inFlight--;
    if (inFlight === 0 && keepAliveTimer !== null) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }
}

async function handleFetchProxy(req: FetchProxyRequest): Promise<FetchProxyResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = { ...(req.init?.headers ?? {}) };
    if (req.form) {
      delete headers["Content-Type"];
      delete headers["content-type"];
    }
    const res = await fetch(req.url, {
      method: req.init?.method ?? (req.form ? "POST" : "GET"),
      headers,
      body: buildBody(req),
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text || res.statusText };
    }
    if (req.as === "arrayBuffer") {
      const buf = await res.arrayBuffer();
      return { ok: true, status: res.status, data: Array.from(new Uint8Array(buf)) };
    }
    if (req.as === "json") {
      return { ok: true, status: res.status, data: await res.json() };
    }
    return { ok: true, status: res.status, data: await res.text() };
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, status: 0, error: `request timed out after ${Math.round(FETCH_TIMEOUT_MS / 1000)}s` };
    }
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "fetchProxy") {
    withKeepAlive(() => handleFetchProxy(message as FetchProxyRequest)).then(sendResponse);
    return true;
  }
  if (message?.type === "openOptionsPage") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  if (isRuntimeMessage(message)) {
    withKeepAlive(() => handleRuntimeMessage(message)).then(sendResponse);
    return true;
  }
  return false;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});
