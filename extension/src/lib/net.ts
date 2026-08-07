import { delay } from "./concurrency.ts";

interface ProxyInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  bodyBase64?: string;
}

interface FormFile {
  field: string;
  filename: string;
  mime: string;
  base64: string;
}

interface FormDescriptor {
  fields?: Record<string, string>;
  file?: FormFile;
}

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type ProxyResponse =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string };

const PROXY_ATTEMPTS = 3;
const PROXY_BACKOFF_MS = [400, 1200];

/**
 * Chrome can evict the MV3 service worker while it is still fetching. It then closes the
 * message channel with no reply, which arrives here as a rejection instead of an HTTP status.
 * The next sendMessage boots a fresh worker, so the request is worth repeating.
 */
const WORKER_GONE = /message channel closed|message port closed|Receiving end does not exist/i;

const NO_REPLY = "the extension background worker did not reply";

function isRetriableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

async function proxy(
  url: string,
  as: "text" | "arrayBuffer" | "json",
  init?: ProxyInit,
  form?: FormDescriptor
): Promise<unknown> {
  const message = { type: "fetchProxy", url, init, form, as };
  let lastStatus = 0;
  let lastError = NO_REPLY;

  for (let attempt = 0; attempt < PROXY_ATTEMPTS; attempt++) {
    if (attempt > 0) await delay(PROXY_BACKOFF_MS[attempt - 1] ?? 1200);

    let res: ProxyResponse | undefined;
    try {
      res = (await chrome.runtime.sendMessage(message)) as ProxyResponse | undefined;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (!WORKER_GONE.test(reason)) throw new HttpError(0, `fetch failed (0): ${reason}`);
      lastStatus = 0;
      lastError = reason;
      continue;
    }

    if (res?.ok) return res.data;
    lastStatus = res?.status ?? 0;
    lastError = res?.error ?? NO_REPLY;
    if (res && !isRetriableStatus(res.status)) break;
  }

  throw new HttpError(lastStatus, `fetch failed (${lastStatus}): ${lastError}`);
}

export async function fetchText(url: string, init?: ProxyInit): Promise<string> {
  return (await proxy(url, "text", init)) as string;
}

export async function fetchJson<T>(url: string, init?: ProxyInit): Promise<T> {
  return (await proxy(url, "json", init)) as T;
}

export async function fetchArrayBuffer(url: string, init?: ProxyInit): Promise<ArrayBuffer> {
  const bytes = (await proxy(url, "arrayBuffer", init)) as number[];
  return new Uint8Array(bytes).buffer;
}

export async function postForm<T>(
  url: string,
  headers: Record<string, string>,
  form: FormDescriptor
): Promise<T> {
  return (await proxy(url, "json", { method: "POST", headers }, form)) as T;
}

export async function putBinary(url: string, mime: string, buffer: ArrayBuffer): Promise<void> {
  await proxy(url, "text", {
    method: "PUT",
    headers: { "Content-Type": mime },
    bodyBase64: arrayBufferToBase64(buffer)
  });
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
