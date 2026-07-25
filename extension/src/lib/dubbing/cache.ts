const DB_NAME = "evo-dubbing";
const TTS_STORE = "tts";
const TRANSLATION_STORE = "translations";
const DB_VERSION = 2;

interface CachedAudio {
  key: string;
  data: ArrayBuffer;
  mime: string;
  createdAt: number;
}

interface CachedTranslation {
  key: string;
  translations: { idx: number; text: string }[];
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TTS_STORE)) {
        db.createObjectStore(TTS_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(TRANSLATION_STORE)) {
        db.createObjectStore(TRANSLATION_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function hashText(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function ttsCacheKey(provider: string, model: string, voice: string, text: string): string {
  return `${provider}|${model}|${voice}|${hashText(text)}`;
}

export function translationCacheKey(
  provider: string,
  model: string,
  sourceLang: string,
  targetLang: string,
  segments: { idx: number; text: string }[]
): string {
  return `${provider}|${model}|${sourceLang}|${targetLang}|${hashText(JSON.stringify(segments))}`;
}

export async function getCachedAudio(key: string): Promise<{ data: ArrayBuffer; mime: string } | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(TTS_STORE, "readonly");
      const req = tx.objectStore(TTS_STORE).get(key);
      req.onsuccess = () => {
        const value = req.result as CachedAudio | undefined;
        resolve(value ? { data: value.data, mime: value.mime } : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function putCachedAudio(key: string, data: ArrayBuffer, mime: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(TTS_STORE, "readwrite");
      tx.objectStore(TTS_STORE).put({ key, data, mime, createdAt: Date.now() } satisfies CachedAudio);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore cache write failures
  }
}

export async function getCachedTranslation(key: string): Promise<{ idx: number; text: string }[] | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(TRANSLATION_STORE, "readonly");
      const req = tx.objectStore(TRANSLATION_STORE).get(key);
      req.onsuccess = () => {
        const value = req.result as CachedTranslation | undefined;
        resolve(value?.translations ?? null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function putCachedTranslation(key: string, translations: { idx: number; text: string }[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(TRANSLATION_STORE, "readwrite");
      tx.objectStore(TRANSLATION_STORE).put({ key, translations, createdAt: Date.now() } satisfies CachedTranslation);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    return;
  }
}
