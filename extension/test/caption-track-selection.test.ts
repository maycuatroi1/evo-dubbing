import test from "node:test";
import assert from "node:assert/strict";
import {
  coverageOf,
  describeTracks,
  isUsable,
  rankTracks,
  trackIds,
  type CaptionsTracklist,
  type RawCaptionTrack
} from "../src/content/caption-tracks.ts";

const ENGLISH_ASR: RawCaptionTrack = {
  baseUrl: "https://www.youtube.com/api/timedtext?v=Dx2yPk0FsGM&lang=en&kind=asr",
  languageCode: "en",
  kind: "asr",
  vssId: "a.en",
  name: { simpleText: "English (auto-generated)" }
};

const KLINGON: RawCaptionTrack = {
  baseUrl: "https://www.youtube.com/api/timedtext?v=Dx2yPk0FsGM&lang=tlh",
  languageCode: "tlh",
  vssId: ".tlh",
  name: { simpleText: "Klingon" }
};

function events(spans: [number, number][]) {
  return spans.map(([startMs, endMs]) => ({ startMs, endMs, text: "x" }));
}

test("a joke caption track in another language never outranks the spoken-language ASR track", () => {
  const tracks = [ENGLISH_ASR, KLINGON];
  const list: CaptionsTracklist = { captionTracks: tracks };
  const ranked = rankTracks(list, tracks, "vi");

  assert.equal(ranked[0].id, "a.en");
  assert.equal(ranked[0].primary, true);
  assert.equal(ranked[1].id, ".tlh");
  assert.equal(ranked[1].primary, false);
});

test("captionTrackIndices listing every track does not make a foreign track primary", () => {
  const tracks = [ENGLISH_ASR, KLINGON];
  const list: CaptionsTracklist = {
    captionTracks: tracks,
    audioTracks: [{ captionTrackIndices: [1, 0] }]
  };
  const ranked = rankTracks(list, tracks, "vi");

  assert.equal(ranked[0].id, "a.en");
  assert.equal(ranked[1].primary, false);
});

test("with no ASR track the audio track's declared default caption decides the spoken language", () => {
  const english: RawCaptionTrack = {
    baseUrl: "https://example.test/en",
    languageCode: "en",
    vssId: ".en",
    name: { simpleText: "English" }
  };
  const tracks = [KLINGON, english];
  const list: CaptionsTracklist = {
    captionTracks: tracks,
    audioTracks: [{ captionTrackIndices: [0, 1], defaultCaptionTrackIndex: 1 }]
  };
  const ranked = rankTracks(list, tracks);

  assert.equal(ranked[0].id, ".en");
  assert.equal(ranked[0].primary, true);
});

test("multi-audio videos pick the ASR track of the default audio track", () => {
  const spanishAsr: RawCaptionTrack = {
    baseUrl: "https://example.test/es",
    languageCode: "es",
    kind: "asr",
    vssId: "a.es",
    name: { simpleText: "Spanish (auto-generated)" }
  };
  const spanishManual: RawCaptionTrack = {
    baseUrl: "https://example.test/es-manual",
    languageCode: "es",
    vssId: ".es",
    name: { simpleText: "Spanish" }
  };
  const tracks = [ENGLISH_ASR, spanishAsr, spanishManual];
  const list: CaptionsTracklist = {
    captionTracks: tracks,
    audioTracks: [{ captionTrackIndices: [0] }, { captionTrackIndices: [1, 2] }],
    defaultAudioTrackIndex: 1
  };
  const ranked = rankTracks(list, tracks);

  assert.equal(ranked[0].id, ".es");
  assert.equal(ranked[1].id, "a.es");
  assert.equal(ranked[2].id, "a.en");
  assert.equal(ranked[2].primary, false);
});

test("a human-written track wins over ASR when both cover the spoken language", () => {
  const human: RawCaptionTrack = {
    baseUrl: "https://example.test/en",
    languageCode: "en",
    vssId: ".en",
    name: { simpleText: "English" }
  };
  const tracks = [ENGLISH_ASR, human];
  const ranked = rankTracks({ captionTracks: tracks }, tracks);

  assert.equal(ranked[0].id, ".en");
  assert.equal(ranked[1].id, "a.en");
});

test("a track already in the target language is pushed to the bottom", () => {
  const vietnamese: RawCaptionTrack = {
    baseUrl: "https://example.test/vi",
    languageCode: "vi",
    vssId: ".vi",
    name: { simpleText: "Vietnamese" }
  };
  const tracks = [vietnamese, ENGLISH_ASR];
  const ranked = rankTracks({ captionTracks: tracks }, tracks, "vi");

  assert.equal(ranked[0].id, "a.en");
  assert.equal(ranked.at(-1)?.id, ".vi");
});

test("track ids stay unique when YouTube omits vssId", () => {
  const tracks: RawCaptionTrack[] = [
    { baseUrl: "https://example.test/1", languageCode: "en" },
    { baseUrl: "https://example.test/2", languageCode: "en" }
  ];
  const ids = trackIds(tracks);

  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});

test("coverage merges overlapping cues instead of double counting them", () => {
  assert.equal(coverageOf(events([[0, 5000], [4000, 10000]]), 10000), 1);
  assert.equal(coverageOf(events([[0, 2000], [8000, 10000]]), 10000), 0.4);
  assert.equal(coverageOf([], 10000), 0);
  assert.equal(coverageOf(events([[0, 1000]]), 0), 1);
});

test("a handful of cues on a long video is not a usable transcript", () => {
  const sparse = events([[0, 2000], [400000, 402000]]);
  assert.equal(isUsable(sparse, coverageOf(sparse, 795000), 795000), false);

  const dense = events(Array.from({ length: 200 }, (_, i) => [i * 4000, i * 4000 + 3500] as [number, number]));
  assert.equal(isUsable(dense, coverageOf(dense, 795000), 795000), true);
});

test("describeTracks reports auto and primary flags for the picker", () => {
  const tracks = [ENGLISH_ASR, KLINGON];
  const described = describeTracks(rankTracks({ captionTracks: tracks }, tracks));

  assert.deepEqual(described, [
    { id: "a.en", lang: "en", name: "English (auto-generated)", auto: true, primary: true },
    { id: ".tlh", lang: "tlh", name: "Klingon", auto: false, primary: false }
  ]);
});
