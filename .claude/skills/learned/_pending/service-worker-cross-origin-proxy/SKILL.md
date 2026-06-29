---
name: service-worker-cross-origin-proxy
description: Use service worker as proxy for fetch calls with custom headers, multipart forms, and binary bodies
pattern_type: workaround
learned_at: 2026-06-29T09:40:21
source_session: 71ecc7df-3e21-48bb-aff8-23586b6d48e3
---

# Service Worker as Cross-Origin Fetch Proxy

## When to use
Content scripts and popups have CORS restrictions; API keys should never leave service worker. Need to handle diverse request types: JSON, form-data, multipart (STT uploads), binary (R2 presigned PUT).

## How it works
Service worker intercepts message from content script, delegates fetch with full control:
- Adds auth headers (API keys)
- Handles various `Content-Type` dynamically
- Returns typed response (JSON, ArrayBuffer, text)

## Key pattern
```typescript
// Service worker
chrome.runtime.onMessage.addListener(async (msg, sender, reply) => {
  if (msg.type === 'NET_FETCH') {
    try {
      const opts: RequestInit = { method: msg.method, headers: msg.headers };
      if (msg.body) {
        if (msg.headers['Content-Type']?.includes('multipart/form-data')) {
          opts.body = msg.body; // FormData as ArrayBuffer from content script
        } else if (msg.bodyType === 'arraybuffer') {
          opts.body = new Uint8Array(msg.body);
        } else {
          opts.body = JSON.stringify(msg.body);
        }
      }
      const res = await fetch(msg.url, opts);
      const data = msg.responseType === 'arraybuffer' 
        ? await res.arrayBuffer() 
        : await res.json();
      reply({ ok: res.ok, status: res.status, data });
    } catch (e) {
      reply({ ok: false, error: e.message });
    }
  }
});

// Content script
const result = await chrome.runtime.sendMessage({
  type: 'NET_FETCH',
  method: 'PUT',
  url: presignedUrl,
  body: audioBuffer,
  bodyType: 'arraybuffer',
  headers: { 'Content-Type': 'audio/wav' }
});
```

For multipart, serialize FormData to object in content script, reconstruct in service worker.

## Advantages
- Keys stay server-side (not exposed to page)
- One place to add auth logic
- Content script stays simple (just send message)
