import { describe, it, expect, vi } from "vitest";

// Mock firestore before importing mst.ts (which imports firestore.ts)
vi.mock("../../src/services/firestore.js", () => ({
  db: {},
  collections: {
    styleRegistry: () => ({
      collection: () => ({ doc: () => ({ get: vi.fn(), set: vi.fn(), update: vi.fn() }) }),
      firestore: { batch: vi.fn() },
    }),
  },
}));

import {
  buildFullPrompt,
  getChapterOverlay,
  reinforceMstPrompt,
  buildMstText,
  type MstDocument,
} from "../../src/services/mst.js";

// Minimal Timestamp stub for tests
const Timestamp = { now: () => ({ seconds: 0, nanoseconds: 0 }) };

const MOCK_MST: MstDocument = {
  version: 1,
  art_style: "Korean webtoon line art",
  line_weight: "clean bold outlines, 3px stroke",
  color_palette: "flat color, cel-shading, vivid saturation",
  rendering: "no texture, digital illustration, clean edges",
  perspective: "slight 2.5D, manga panel composition",
  negative_prompt: "realistic, 3D render, photo, watercolor",
  locked: true,
  last_modified_by: "system",
  last_modified_at: Timestamp.now(),
  revision_history: [],
};

describe("buildMstText", () => {
  it("joins all MST fields with comma", () => {
    const text = buildMstText(MOCK_MST);
    expect(text).toContain("Korean webtoon line art");
    expect(text).toContain("clean bold outlines");
    expect(text).toContain("flat color");
    expect(text).toContain("slight 2.5D");
  });
});

describe("getChapterOverlay", () => {
  it("returns empty string for default style", () => {
    expect(getChapterOverlay("default")).toBe("");
  });

  it("returns sepia overlay for flashback", () => {
    const overlay = getChapterOverlay("flashback");
    expect(overlay).toContain("sepia");
    expect(overlay).toContain("film grain");
  });

  it("returns high contrast for climax", () => {
    const overlay = getChapterOverlay("climax");
    expect(overlay).toContain("high contrast");
  });

  it("returns dreamy overlay for dream", () => {
    const overlay = getChapterOverlay("dream");
    expect(overlay).toContain("dreamy glow");
  });

  it("returns warm tone for epilogue", () => {
    const overlay = getChapterOverlay("epilogue");
    expect(overlay).toContain("warm tone");
  });
});

describe("buildFullPrompt", () => {
  it("assembles 4-layer prompt for default style", () => {
    const { prompt, negative_prompt } = buildFullPrompt(
      MOCK_MST, "default", "oval face, slim body", "close-up, shocked expression"
    );
    expect(prompt).toContain("Korean webtoon line art"); // L1
    expect(prompt).toContain("oval face");               // L2 asset
    expect(prompt).toContain("close-up");                // L3 cut
    expect(prompt).not.toContain("sepia");               // no overlay for default
    expect(negative_prompt).toContain("realistic");
  });

  it("includes chapter overlay in non-default style", () => {
    const { prompt } = buildFullPrompt(
      MOCK_MST, "flashback", "oval face", "medium shot"
    );
    expect(prompt).toContain("sepia tint");
    expect(prompt).toContain("Korean webtoon line art");
    expect(prompt).toContain("oval face");
    expect(prompt).toContain("medium shot");
  });

  it("skips empty asset tags gracefully", () => {
    const { prompt } = buildFullPrompt(MOCK_MST, "default", "", "cut tags");
    // Should not have double commas from empty asset tags
    expect(prompt).not.toMatch(/,\s*,/);
  });
});

describe("reinforceMstPrompt", () => {
  it("repeats art_style at start and end", () => {
    const { prompt } = reinforceMstPrompt(MOCK_MST, "original tags, more tags");
    const occurrences = (prompt.match(/Korean webtoon line art/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("strengthens negative_prompt", () => {
    const { negative_prompt } = reinforceMstPrompt(MOCK_MST, "test");
    expect(negative_prompt).toContain("realistic");
    expect(negative_prompt).toContain("photorealistic");
  });
});
