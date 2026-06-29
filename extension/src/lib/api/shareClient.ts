import type { Dub, DubSegment } from "../types";
import { fetchJson, putBinary } from "../net";

export interface RemoteSegment {
  idx: number;
  startMs: number;
  endMs: number;
  originalText: string;
  text: string;
  audioUrl: string;
  mime: string;
}

export interface RemoteDub {
  id: string;
  platform: string;
  videoId: string;
  sourceLang: string;
  targetLang: string;
  voice: string;
  provider: "openai" | "gemini";
  title: string;
  durationMs: number;
  visibility: "public" | "private";
  segments: RemoteSegment[];
}

export interface LookupQuery {
  platform: string;
  videoId: string;
  targetLang: string;
  voice: string;
  provider: string;
}

interface InitResponse {
  id: string;
  ownerToken: string;
  uploads: { idx: number; putUrl: string }[];
}

function base(serverUrl: string): string {
  return serverUrl.replace(/\/$/, "");
}

export async function lookupDub(serverUrl: string, q: LookupQuery): Promise<RemoteDub | null> {
  const params = new URLSearchParams(q as unknown as Record<string, string>);
  try {
    return await fetchJson<RemoteDub>(`${base(serverUrl)}/api/dubs/lookup?${params.toString()}`);
  } catch {
    return null;
  }
}

export async function uploadDub(
  serverUrl: string,
  dub: Dub
): Promise<{ id: string; ownerToken: string; visibility: "public" | "private" }> {
  const voiced = dub.segments.filter((s) => s.audio && s.text);
  const init = await fetchJson<InitResponse>(`${base(serverUrl)}/api/dubs/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform: dub.platform,
      videoId: dub.videoId,
      sourceLang: dub.sourceLang,
      targetLang: dub.targetLang,
      voice: dub.voice,
      provider: dub.provider,
      title: dub.title,
      durationMs: dub.durationMs,
      visibility: dub.visibility,
      segments: voiced.map((s) => ({
        idx: s.idx,
        startMs: s.startMs,
        endMs: s.endMs,
        originalText: s.originalText,
        text: s.text,
        mime: s.audioMime
      }))
    })
  });

  const byIdx = new Map<number, DubSegment>(voiced.map((s) => [s.idx, s]));
  for (const up of init.uploads) {
    const seg = byIdx.get(up.idx);
    if (seg?.audio) {
      await putBinary(up.putUrl, seg.audioMime, seg.audio);
    }
  }

  const done = await fetchJson<{ visibility: "public" | "private" }>(
    `${base(serverUrl)}/api/dubs/${init.id}/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: init.ownerToken })
    }
  );

  return { id: init.id, ownerToken: init.ownerToken, visibility: done.visibility };
}

export async function setVisibility(
  serverUrl: string,
  id: string,
  visibility: "public" | "private",
  ownerToken: string
): Promise<void> {
  await fetchJson(`${base(serverUrl)}/api/dubs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility, ownerToken })
  });
}
