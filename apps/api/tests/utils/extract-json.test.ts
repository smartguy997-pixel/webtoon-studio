import { describe, it, expect } from "vitest";
import { extractJson, JsonExtractionError } from "../../src/utils/extract-json.js";

describe("extractJson", () => {
  it("parses pure JSON", () => {
    const raw = '{"phase": "기획 분석", "score": 0.75}';
    const result = extractJson<{ phase: string; score: number }>(raw);
    expect(result.phase).toBe("기획 분석");
    expect(result.score).toBe(0.75);
  });

  it("parses ```json code block", () => {
    const raw = '```json\n{"phase": "test", "value": 1}\n```';
    const result = extractJson<{ phase: string; value: number }>(raw);
    expect(result.phase).toBe("test");
    expect(result.value).toBe(1);
  });

  it("parses plain ``` code block", () => {
    const raw = '```\n{"key": "value"}\n```';
    const result = extractJson<{ key: string }>(raw);
    expect(result.key).toBe("value");
  });

  it("extracts embedded JSON from text", () => {
    const raw = 'Here is the output:\n{"phase": "embedded", "n": 42}\nEnd.';
    const result = extractJson<{ phase: string; n: number }>(raw);
    expect(result.phase).toBe("embedded");
    expect(result.n).toBe(42);
  });

  it("throws JsonExtractionError on invalid JSON", () => {
    expect(() => extractJson("not json at all")).toThrow(JsonExtractionError);
  });

  it("throws JsonExtractionError on empty string", () => {
    expect(() => extractJson("")).toThrow(JsonExtractionError);
  });

  it("handles nested JSON correctly", () => {
    const raw = '{"outer": {"inner": [1, 2, 3]}, "flag": true}';
    const result = extractJson<{ outer: { inner: number[] }; flag: boolean }>(raw);
    expect(result.outer.inner).toEqual([1, 2, 3]);
    expect(result.flag).toBe(true);
  });
});

// extractBalancedBraces is an internal function tested indirectly via extractJson
describe("extractJson embedded JSON (internal brace balancing)", () => {
  it("finds JSON object in surrounding text", () => {
    const text = 'Some text {"key": "value"} more text';
    const result = extractJson<{ key: string }>(text);
    expect(result.key).toBe("value");
  });

  it("throws when no JSON in plain text", () => {
    expect(() => extractJson("no json here")).toThrow(JsonExtractionError);
  });

  it("handles nested braces in embedded text", () => {
    const text = 'prefix {"a": {"b": 1}} suffix';
    const result = extractJson<{ a: { b: number } }>(text);
    expect(result.a.b).toBe(1);
  });
});
