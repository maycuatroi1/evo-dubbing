---
name: mv3-main-world-bridge-csp-bypass
description: Extract DOM data from YouTube using MAIN-world script to bypass CSP restrictions
pattern_type: workaround
learned_at: 2026-06-29T09:40:21
source_session: 71ecc7df-3e21-48bb-aff8-23586b6d48e3
---

# MV3 MAIN-World Bridge for CSP Bypass

## When to use
Chrome MV3 content scripts run in isolated world and cannot access window.yt.* or player APIs on restricted sites like YouTube. CSP blocks inline script injection, making normal patterns impossible.

## How it works
Create two content scripts:
1. **MAIN world** (via script injection): runs in webpage context, posts messages to isolated world
2. **Isolated world** (normal content script): receives messages, no access to page APIs

Example:
- `page-bridge.ts` injected into MAIN: calls `window.ytInitialData`, posts to isolated world
- `youtube.content.ts` (isolated): listens for caption data via message port, coordinates engine

## Key pattern
```typescript
// In manifest: inject page-bridge.ts as inline script
// page-bridge uses window.postMessage to reply to content script
window.addEventListener('message', e => {
  if (e.data.type === 'BRIDGE_CAPTIONS_REQUEST') {
    const captions = extractFromPlayer();
    window.postMessage({ type: 'BRIDGE_CAPTIONS_RESPONSE', captions }, '*');
  }
});

// Content script (isolated) listens for replies
window.addEventListener('message', e => {
  if (e.data.type === 'BRIDGE_CAPTIONS_RESPONSE') {
    // use captions data
  }
});
```

Avoid using `chrome.scripting.executeScript` for this - it can't return values. Use message passing instead.

## Limitations
- No direct DOM access from isolated context
- Large payloads (JSON stringify captions) must be chunked
- Timing: wait for player.ready before requesting captions
