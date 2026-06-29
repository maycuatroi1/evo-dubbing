import type { TranscriptSegment } from "../types";

const MAX_GAP_MS = 1200;
const MAX_DURATION_MS = 8000;
const MAX_CHARS = 220;
const SENTENCE_END = /[.!?…]["')\]]?\s*$/;

export function mergeCues(segments: TranscriptSegment[]): TranscriptSegment[] {
  const merged: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;

  const flush = () => {
    if (current) {
      current.text = current.text.replace(/\s+/g, " ").trim();
      if (current.text) merged.push(current);
    }
    current = null;
  };

  for (const seg of segments) {
    const text = seg.text.replace(/\s+/g, " ").trim();
    if (!text) continue;

    if (!current) {
      current = { idx: 0, startMs: seg.startMs, endMs: seg.endMs, text };
      continue;
    }

    const gap = seg.startMs - current.endMs;
    const wouldDuration = seg.endMs - current.startMs;
    const wouldChars = current.text.length + 1 + text.length;
    const breakHere =
      SENTENCE_END.test(current.text) ||
      gap > MAX_GAP_MS ||
      wouldDuration > MAX_DURATION_MS ||
      wouldChars > MAX_CHARS;

    if (breakHere) {
      flush();
      current = { idx: 0, startMs: seg.startMs, endMs: seg.endMs, text };
    } else {
      current.text += " " + text;
      current.endMs = seg.endMs;
    }
  }
  flush();

  return merged.map((cue, idx) => ({ ...cue, idx }));
}
