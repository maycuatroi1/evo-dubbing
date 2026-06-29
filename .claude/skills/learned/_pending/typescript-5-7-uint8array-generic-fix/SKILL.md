---
name: typescript-5-7-uint8array-generic-fix
description: Fix TS 5.7+ Uint8Array generic incompatibility with ArrayBufferView in Blob constructor
pattern_type: error_resolution
learned_at: 2026-06-29T09:40:21
source_session: 71ecc7df-3e21-48bb-aff8-23586b6d48e3
---

# TypeScript 5.7 Uint8Array Generic Compatibility

## Error
```
Type 'Uint8Array<ArrayBufferLike>' is not assignable to type 'BlobPart'.
Type 'Uint8Array<ArrayBufferLike>' is not assignable to type 'ArrayBufferView<ArrayBuffer>'.
Types of property 'buffer' are incompatible.
```

## Cause
TS 5.7 made `Uint8Array` generic over buffer type. Blob constructor expects `ArrayBufferView<ArrayBuffer>` (non-generic), causing type mismatch.

## Fix
Cast via `.buffer` or use explicit `ArrayBuffer`:
```typescript
const data: Uint8Array = new Uint8Array(audioData);
const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)]);
// or
const blob = new Blob([new Uint8Array(data)]);
```

Or update tsconfig to use a less strict target if you control it.

## Applied in this project
Fixed in `service-worker.ts` where Gemini TTS returns PCM as Uint8Array — wrap to WAV Blob via `.buffer`.
