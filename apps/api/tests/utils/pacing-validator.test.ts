import { describe, it, expect } from "vitest";
import { validatePacingRules, checkEpisodeCoverage } from "../../src/utils/pacing-validator.js";
import type { Episode, Arc } from "../../src/agents/scenario.js";

function makeEpisode(ep: number, type: Episode["episode_type"] = "normal"): Episode {
  return {
    ep, title: `${ep}화`, summary: "요약",
    arc_id: "arc_001", episode_type: type,
    featured_characters: ["char_001"], featured_locations: ["loc_001"],
    cliffhanger: null,
  };
}

function makeArc(id: string, type: Arc["arc_type"], start: number, end: number): Arc {
  return {
    arc_id: id, arc_type: type, title: `${id} 제목`,
    episode_range: [start, end], theme: "테마", resolution: "해소",
  };
}

const BASE_ARC: Arc = makeArc("arc_001", "large", 1, 100);

function fullEpisodes(overrides: Partial<Record<number, Episode["episode_type"]>> = {}): Episode[] {
  return Array.from({ length: 100 }, (_, i) => {
    const ep = i + 1;
    return makeEpisode(ep, overrides[ep] ?? "normal");
  });
}

describe("checkEpisodeCoverage", () => {
  it("detects full coverage", () => {
    const episodes = fullEpisodes();
    const result = checkEpisodeCoverage(episodes);
    expect(result.covered).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.total).toBe(100);
  });

  it("detects missing episodes", () => {
    const episodes = fullEpisodes();
    const withGap = episodes.filter((e) => e.ep !== 50 && e.ep !== 75);
    const result = checkEpisodeCoverage(withGap);
    expect(result.covered).toBe(false);
    expect(result.missing).toContain(50);
    expect(result.missing).toContain(75);
  });
});

describe("validatePacingRules", () => {
  it("passes valid episodes with correct peak positions", () => {
    const episodes = fullEpisodes({ 20: "peak", 40: "peak", 60: "peak", 80: "peak", 30: "twist", 65: "twist" });
    const result = validatePacingRules(episodes, [BASE_ARC]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("errors when peak is missing at ep 20", () => {
    const episodes = fullEpisodes({ 40: "peak", 60: "peak", 80: "peak" }); // ep 20 = normal
    const result = validatePacingRules(episodes, [BASE_ARC]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("20화"))).toBe(true);
  });

  it("errors when twist appears in act 1 (ep ≤ 15)", () => {
    const episodes = fullEpisodes({ 10: "twist", 20: "peak", 40: "peak", 60: "peak", 80: "peak" });
    const result = validatePacingRules(episodes, [BASE_ARC]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("10화"))).toBe(true);
  });

  it("errors when two twists are less than 30 apart", () => {
    const episodes = fullEpisodes({ 20: "peak", 40: "peak", 60: "peak", 80: "peak", 50: "twist", 70: "twist" }); // gap = 20
    const result = validatePacingRules(episodes, [BASE_ARC]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("간격"))).toBe(true);
  });

  it("passes when two twists are exactly 30 apart", () => {
    const episodes = fullEpisodes({
      20: "peak", 40: "peak", 60: "peak", 80: "peak",
      35: "twist", 65: "twist",
    });
    const result = validatePacingRules(episodes, [BASE_ARC]);
    // gap = 30, should pass (≥ 30)
    expect(result.errors.filter((e) => e.includes("간격"))).toHaveLength(0);
  });

  it("errors on missing episodes", () => {
    const incomplete = fullEpisodes({ 20: "peak", 40: "peak", 60: "peak", 80: "peak" }).slice(0, 90);
    const result = validatePacingRules(incomplete, [BASE_ARC]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("누락"))).toBe(true);
  });

  it("warns on 3+ consecutive hook episodes", () => {
    const episodes = fullEpisodes({
      20: "peak", 40: "peak", 60: "peak", 80: "peak",
      6: "hook", 7: "hook", 8: "hook",
    });
    const result = validatePacingRules(episodes, [BASE_ARC]);
    expect(result.warnings.some((w) => w.includes("hook"))).toBe(true);
  });
});
