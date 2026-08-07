import test from "node:test";
import assert from "node:assert/strict";
import { parseTranslationsResponse } from "../src/lib/providers/index.ts";

test("parses a well-formed translations response", () => {
  const text = JSON.stringify({
    translations: [
      { idx: 0, text: "xin chao" },
      { idx: 1, text: "tam biet" }
    ]
  });
  assert.deepEqual(parseTranslationsResponse(text), [
    { idx: 0, text: "xin chao" },
    { idx: 1, text: "tam biet" }
  ]);
});

test("returns empty array for valid JSON without translations", () => {
  assert.deepEqual(parseTranslationsResponse("{}"), []);
});

test("salvages complete segments from truncated JSON", () => {
  const text =
    '{"translations":[{"idx":0,"text":"xin chao"},{"idx":1,"text":"co dau \\"nhay\\" ben trong"},{"idx":2,"text":"bi cut giua chu';
  assert.deepEqual(parseTranslationsResponse(text), [
    { idx: 0, text: "xin chao" },
    { idx: 1, text: 'co dau "nhay" ben trong' }
  ]);
});

test("salvages segments with escaped unicode and newlines", () => {
  const text = '{"translations":[{"idx":5,"text":"dong mot\\ndong hai \\u00e0"},{"idx":6,"text":';
  assert.deepEqual(parseTranslationsResponse(text), [{ idx: 5, text: "dong mot\ndong hai à" }]);
});

test("throws when nothing can be salvaged", () => {
  assert.throws(() => parseTranslationsResponse("not json at all"), /not valid JSON/);
});

test("parses a response wrapped in a markdown fence", () => {
  const text = '```json\n{"translations":[{"idx":0,"text":"xin chao"}]}\n```';
  assert.deepEqual(parseTranslationsResponse(text), [{ idx: 0, text: "xin chao" }]);
});

test("parses a response with prose around the object", () => {
  const text = 'Here you go:\n{"translations":[{"idx":3,"text":"chao ban"}]}\nHope that helps.';
  assert.deepEqual(parseTranslationsResponse(text), [{ idx: 3, text: "chao ban" }]);
});

test("parses a bare array response", () => {
  const text = '[{"idx":0,"text":"mot"},{"idx":1,"text":"hai"}]';
  assert.deepEqual(parseTranslationsResponse(text), [
    { idx: 0, text: "mot" },
    { idx: 1, text: "hai" }
  ]);
});

test("normalises a string idx so the cue lookup still matches", () => {
  const text = '{"translations":[{"idx":"7","text":"bay"}]}';
  assert.deepEqual(parseTranslationsResponse(text), [{ idx: 7, text: "bay" }]);
});

test("salvages segments that carry extra keys or reordered keys", () => {
  const text = '{"translations":[{"text":"xin chao","idx":0,"note":"greeting"},{"idx":1,"text":"cut';
  assert.deepEqual(parseTranslationsResponse(text), [{ idx: 0, text: "xin chao" }]);
});

test("drops malformed entries instead of passing them through", () => {
  const text = '{"translations":[{"idx":0,"text":"ok"},{"idx":1},{"text":"no idx"}]}';
  assert.deepEqual(parseTranslationsResponse(text), [{ idx: 0, text: "ok" }]);
});
