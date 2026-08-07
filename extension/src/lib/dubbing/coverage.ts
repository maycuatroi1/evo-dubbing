import type { DubCoverageRange } from "../types.ts";

/**
 * Two prepared cues separated by less than this are drawn as one range. The gap between
 * sentences in a caption track is silence, not a hole in the dub, and at scrubber scale a
 * few pixels of dashes read as "something is missing".
 */
export const COVERAGE_MERGE_GAP_MS = 1200;

interface Timed {
  startMs: number;
  endMs: number;
}

/**
 * Collapse the cues the session has already prepared into the fewest contiguous ranges.
 * `prepared` is asked per index so callers can decide what counts (audio in hand, or a cue
 * that translated to silence and will never need audio).
 */
export function mergeCoverageRanges(
  cues: Timed[],
  prepared: (idx: number) => boolean,
  gapMs = COVERAGE_MERGE_GAP_MS
): DubCoverageRange[] {
  const ranges: DubCoverageRange[] = [];
  for (let i = 0; i < cues.length; i++) {
    if (!prepared(i)) continue;
    const startMs = Math.max(0, cues[i].startMs);
    const endMs = Math.max(startMs, cues[i].endMs);
    const last = ranges[ranges.length - 1];
    if (last && startMs - last.endMs <= gapMs) last.endMs = Math.max(last.endMs, endMs);
    else ranges.push({ startMs, endMs });
  }
  return ranges;
}

/**
 * Index of the first cue whose audio the viewer would still hear from `ms` onward, or -1 when
 * the playhead is past the last cue. This is the cue a playback hold waits for.
 */
export function firstCueAtOrAfter(cues: Timed[], ms: number): number {
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].endMs > ms) return i;
  }
  return -1;
}
