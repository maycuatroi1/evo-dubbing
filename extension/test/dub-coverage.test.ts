import test from "node:test";
import assert from "node:assert/strict";
import { mergeCoverageRanges, firstCueAtOrAfter } from "../src/lib/dubbing/coverage.ts";

const CUES = [
  { startMs: 0, endMs: 2000 },
  { startMs: 2200, endMs: 4000 },
  { startMs: 30000, endMs: 32000 },
  { startMs: 32100, endMs: 34000 }
];

test("neighbouring prepared cues collapse into one range, a real gap stays a gap", () => {
  const ranges = mergeCoverageRanges(CUES, () => true);
  assert.deepEqual(ranges, [
    { startMs: 0, endMs: 4000 },
    { startMs: 30000, endMs: 34000 }
  ]);
});

test("cues that are not prepared yet leave a hole the scrubber can show", () => {
  const prepared = new Set([0, 2]);
  const ranges = mergeCoverageRanges(CUES, (i) => prepared.has(i));
  assert.deepEqual(ranges, [
    { startMs: 0, endMs: 2000 },
    { startMs: 30000, endMs: 32000 }
  ]);
});

test("nothing prepared means no ranges, not a full bar", () => {
  assert.deepEqual(mergeCoverageRanges(CUES, () => false), []);
});

test("the cue a hold waits for is the first one still audible from the playhead", () => {
  assert.equal(firstCueAtOrAfter(CUES, 0), 0, "playhead inside the first cue");
  assert.equal(firstCueAtOrAfter(CUES, 2100), 1, "playhead in the silence before cue 1");
  assert.equal(firstCueAtOrAfter(CUES, 31000), 2, "playhead mid cue after a seek");
  assert.equal(firstCueAtOrAfter(CUES, 34000), -1, "past the last cue there is nothing to wait for");
  assert.equal(firstCueAtOrAfter([], 0), -1, "captions not loaded yet");
});
