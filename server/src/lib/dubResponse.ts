export interface DubResponseSegment {
  idx: number;
  startMs: number;
  endMs: number;
  originalText: string;
  text: string;
  mime: string;
  audioUrl: string;
}

export interface DubResponseSource {
  id: string;
  platform: string;
  videoId: string;
  sourceLang: string;
  targetLang: string;
  voice: string;
  provider: string;
  title: string;
  durationMs: number;
  visibility: string;
}

export function shapeDubResponse(dub: DubResponseSource, segments: DubResponseSegment[]) {
  return {
    id: dub.id,
    platform: dub.platform,
    videoId: dub.videoId,
    sourceLang: dub.sourceLang,
    targetLang: dub.targetLang,
    voice: dub.voice,
    provider: dub.provider,
    title: dub.title,
    durationMs: dub.durationMs,
    visibility: dub.visibility,
    segments
  };
}
