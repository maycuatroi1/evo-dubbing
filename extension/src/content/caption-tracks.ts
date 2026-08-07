import type { CaptionEvent, CaptionTrackInfo } from "./bridge-protocol.ts";

export interface TrackName {
  simpleText?: string;
  runs?: { text?: string }[];
}

export interface RawCaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  vssId?: string;
  name?: TrackName;
  trackName?: string;
}

export interface RawAudioTrack {
  captionTrackIndices?: number[];
  defaultCaptionTrackIndex?: number;
}

export interface CaptionsTracklist {
  captionTracks?: RawCaptionTrack[];
  audioTracks?: RawAudioTrack[];
  defaultAudioTrackIndex?: number;
}

export interface RankedTrack {
  track: RawCaptionTrack;
  id: string;
  primary: boolean;
  score: number;
}

export const MIN_COVERAGE = 0.35;
export const MIN_EVENTS = 5;
export const MAX_TRACK_ATTEMPTS = 3;

export function isAsr(track: RawCaptionTrack): boolean {
  return track.kind === "asr";
}

export function trackLabel(track: RawCaptionTrack): string {
  const named = track.name?.simpleText ?? track.name?.runs?.map((r) => r.text ?? "").join("") ?? track.trackName;
  return (named ?? "").trim() || track.languageCode;
}

export function trackIds(tracks: RawCaptionTrack[]): string[] {
  const seen = new Set<string>();
  return tracks.map((track, index) => {
    const base = track.vssId || `${isAsr(track) ? "a" : "m"}.${track.languageCode}`;
    let id = base;
    while (seen.has(id)) id = `${base}#${index}`;
    seen.add(id);
    return id;
  });
}

export function primaryIndices(list: CaptionsTracklist, tracks: RawCaptionTrack[]): Set<number> {
  const sameLanguageAs = (index: number) => {
    const lang = tracks[index].languageCode;
    return new Set(tracks.map((t, i) => (t.languageCode === lang ? i : -1)).filter((i) => i >= 0));
  };

  const audioTracks = list.audioTracks ?? [];
  const defaultAudio = audioTracks[list.defaultAudioTrackIndex ?? 0];
  const declared = (defaultAudio?.captionTrackIndices ?? []).filter((i) => i >= 0 && i < tracks.length);
  const pool = declared.length ? declared : tracks.map((_, i) => i);

  const asrIndex = pool.find((i) => isAsr(tracks[i]));
  if (asrIndex !== undefined) return sameLanguageAs(asrIndex);

  const declaredDefault = defaultAudio?.defaultCaptionTrackIndex;
  if (typeof declaredDefault === "number" && tracks[declaredDefault]) return sameLanguageAs(declaredDefault);

  if (declared.length === 1) return new Set(declared);

  return new Set(tracks.map((_, i) => i));
}

export function rankTracks(
  list: CaptionsTracklist,
  tracks: RawCaptionTrack[],
  avoidLang?: string
): RankedTrack[] {
  const primary = primaryIndices(list, tracks);
  const ids = trackIds(tracks);

  return tracks
    .map((track, index) => {
      const isPrimary = primary.has(index);
      let score = isPrimary ? 100 : 0;
      if (!isAsr(track)) score += isPrimary ? 10 : 1;
      if (avoidLang && track.languageCode === avoidLang) score -= 500;
      return { track, id: ids[index], primary: isPrimary, score, index };
    })
    .sort((a, b) => (b.score === a.score ? a.index - b.index : b.score - a.score))
    .map(({ track, id, primary: isPrimary, score }) => ({ track, id, primary: isPrimary, score }));
}

export function coverageOf(events: CaptionEvent[], durationMs: number): number {
  if (events.length === 0) return 0;
  if (durationMs <= 0) return 1;
  const spans = events
    .map((ev) => [Math.max(0, ev.startMs), Math.min(durationMs, Math.max(ev.startMs, ev.endMs))] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);

  let covered = 0;
  let openStart = 0;
  let cursor = -1;
  for (const [start, end] of spans) {
    if (cursor < 0) {
      openStart = start;
      cursor = end;
      continue;
    }
    if (start > cursor) {
      covered += cursor - openStart;
      openStart = start;
      cursor = end;
    } else if (end > cursor) {
      cursor = end;
    }
  }
  if (cursor >= 0) covered += cursor - openStart;
  return Math.min(1, covered / durationMs);
}

export function isUsable(events: CaptionEvent[], coverage: number, durationMs: number): boolean {
  if (events.length === 0) return false;
  if (durationMs > 60000 && events.length < MIN_EVENTS) return false;
  return coverage >= MIN_COVERAGE;
}

export function describeTracks(ranked: RankedTrack[]): CaptionTrackInfo[] {
  return ranked.map((entry) => ({
    id: entry.id,
    lang: entry.track.languageCode,
    name: trackLabel(entry.track),
    auto: isAsr(entry.track),
    primary: entry.primary
  }));
}
