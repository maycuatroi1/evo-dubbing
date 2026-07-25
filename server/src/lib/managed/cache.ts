import { MANAGED_CACHE_VERSION } from "./catalog.ts";
import { headObject, presignGet, putObject } from "../r2.ts";

export interface CacheEntry {
  audioBase64?: string;
  audioKey?: string;
  url?: string;
}

export interface CacheStore {
  get(key: string): Promise<CacheEntry | null>;
  put(key: string, entry: { audioBase64: string }): Promise<CacheEntry>;
}

export function managedTtsR2Key(cacheKey: string): string {
  return `managed/tts/v${MANAGED_CACHE_VERSION}/${cacheKey.replace(/^v\d+:/, "")}`;
}

export interface R2CacheDeps {
  head(key: string): Promise<{ size: number } | null>;
  put(key: string, body: Uint8Array, mime: string): Promise<void>;
  presign(key: string): Promise<string>;
}

const defaultDeps: R2CacheDeps = {
  head: headObject,
  put: putObject,
  presign: presignGet
};

export function createR2CacheStore(deps: R2CacheDeps = defaultDeps): CacheStore {
  return {
    async get(key: string): Promise<CacheEntry | null> {
      const r2Key = managedTtsR2Key(key);
      const found = await deps.head(r2Key);
      if (!found) return null;
      return { audioKey: r2Key, url: await deps.presign(r2Key) };
    },
    async put(key: string, entry: { audioBase64: string }): Promise<CacheEntry> {
      const r2Key = managedTtsR2Key(key);
      await deps.put(r2Key, Buffer.from(entry.audioBase64, "base64"), "audio/mpeg");
      return { audioKey: r2Key, url: await deps.presign(r2Key) };
    }
  };
}
