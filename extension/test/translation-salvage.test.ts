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
