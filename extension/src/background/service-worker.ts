interface FormFileDescriptor {
  field: string;
  filename: string;
  mime: string;
  base64: string;
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

async function handleFetchProxy(req: FetchProxyRequest): Promise<FetchProxyResponse> {
  try {
    const headers = { ...(req.init?.headers ?? {}) };
    if (req.form) {
      delete headers["Content-Type"];
      delete headers["content-type"];
    }
    const res = await fetch(req.url, {
      method: req.init?.method ?? (req.form ? "POST" : "GET"),
      headers,
      body: buildBody(req)
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
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "fetchProxy") {
    handleFetchProxy(message as FetchProxyRequest).then(sendResponse);
    return true;
  }
  return false;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});
