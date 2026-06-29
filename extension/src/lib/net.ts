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

async function proxy(
  url: string,
  as: "text" | "arrayBuffer" | "json",
  init?: ProxyInit,
  form?: FormDescriptor
): Promise<unknown> {
  const res = (await chrome.runtime.sendMessage({ type: "fetchProxy", url, init, form, as })) as
    | { ok: true; status: number; data: unknown }
    | { ok: false; status: number; error: string };
  if (!res || !res.ok) {
    throw new Error(`fetch failed (${res?.status ?? 0}): ${res?.error ?? "no response"}`);
  }
  return res.data;
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
