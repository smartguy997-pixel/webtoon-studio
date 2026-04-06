import { describe, it, expect } from "vitest";
import {
  validatePhase1Output,
  validatePhase2Output,
  validatePhase3Output,
  validatePhase4Output,
  checkPhase2GatingConditions,
} from "../../src/utils/json-validator.js";

// ─── Phase 1 ───────────────────────────────────────────────────

describe("validatePhase1Output", () => {
  const validPhase1 = {
    phase: "기획 분석" as const,
    summary: "테스트 요약",
    market_analysis: {
      genre: "현대판타지",
      positioning: "신규 IP × 대중",
      trend_keywords: ["이세계", "회귀", "성장"],
      competitors: [
        { title: "A작품", strength: "S강점", weakness: "W약점", our_edge: "차별점" },
        { title: "B작품", strength: "S강점", weakness: "W약점", our_edge: "차별점" },
        { title: "C작품", strength: "S강점", weakness: "W약점", our_edge: "차별점" },
      ],
    },
    usp: ["USP1", "USP2", "USP3"],
    feasibility_score: 0.75,
    agent_notes: { strategist: "메모1", researcher: "메모2", producer: "메모3" },
    asset_list: { characters: [], locations: [], props: [] },
    revision_history: [],
  };

  it("accepts valid Phase 1 output", () => {
    const result = validatePhase1Output(validPhase1);
    expect(result.success).toBe(true);
  });

  it("rejects feasibility_score > 1", () => {
    const result = validatePhase1Output({ ...validPhase1, feasibility_score: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects fewer than 3 competitors", () => {
    const twoCompetitors = [
      { title: "A", strength: "S", weakness: "W", our_edge: "E" },
      { title: "B", strength: "S", weakness: "W", our_edge: "E" },
    ];
    const result = validatePhase1Output({
      ...validPhase1,
      market_analysis: { ...validPhase1.market_analysis, competitors: twoCompetitors },
    });
    expect(result.success).toBe(false);
  });

  it("rejects summary over 300 chars", () => {
    const result = validatePhase1Output({ ...validPhase1, summary: "x".repeat(301) });
    expect(result.success).toBe(false);
  });
});

// ─── Phase 2 GATING ────────────────────────────────────────────

describe("checkPhase2GatingConditions", () => {
  const baseChar = {
    id: "char_001", name: "주인공", role: "protagonist" as const,
    age: "20대", personality: "용감함",
    appearance: { face: "타원형", body: "슬림", hair: "검정", outfit: "교복", distinguishing_features: "흉터" },
    ability: "능력", arc: "성장",
  };
  const baseLoc = {
    id: "loc_001", name: "학교", type: "interior" as const,
    atmosphere: "긴장감", structure: "3층 건물", first_appearance: "1화",
  };

  it("passes both conditions when assets ≥1 and all options selected", () => {
    const validated = {
      phase: "세계관_에셋_설계" as const,
      summary: "요약",
      world_design: {
        physical_env: { era: "현대", geography: "한국", climate: "온대" },
        social_system: { power_structure: "민주", class_system: "계층", economy: "자본" },
        unique_rules: [
          { rule_name: "R1", description: "설명", limitation: "제한" },
          { rule_name: "R2", description: "설명", limitation: "제한" },
          { rule_name: "R3", description: "설명", limitation: "제한" },
        ],
        information_asymmetry: {
          reader_knows: ["사실1"],
          character_knows: ["사실2"],
        },
      },
      asset_list: { characters: [baseChar], locations: [baseLoc], props: [] },
      design_options: [
        { target_id: "char_001", target_name: "주인공", target_type: "character" as const,
          option_a: "opt-a", option_b: "opt-b", selected: "A" as const },
      ],
      approved_assets: [],
      agent_notes: { worldbuilder: "W", researcher: "R", character_designer: "C", producer: "P" },
      revision_history: [],
    };

    const gating = checkPhase2GatingConditions(validated);
    expect(gating.condition1).toBe(true);
    expect(gating.condition2).toBe(true);
    expect(gating.unselected).toHaveLength(0);
  });

  it("fails condition2 when options are not yet selected", () => {
    const validated = {
      phase: "세계관_에셋_설계" as const,
      summary: "요약",
      world_design: {
        physical_env: { era: "현대", geography: "한국", climate: "온대" },
        social_system: { power_structure: "민주", class_system: "계층", economy: "자본" },
        unique_rules: [
          { rule_name: "R1", description: "설명", limitation: "제한" },
          { rule_name: "R2", description: "설명", limitation: "제한" },
          { rule_name: "R3", description: "설명", limitation: "제한" },
        ],
        information_asymmetry: { reader_knows: ["R1"], character_knows: ["C1"] },
      },
      asset_list: { characters: [baseChar], locations: [baseLoc], props: [] },
      design_options: [
        { target_id: "char_001", target_name: "주인공", target_type: "character" as const,
          option_a: "opt-a", option_b: "opt-b", selected: null },
      ],
      approved_assets: [],
      agent_notes: { worldbuilder: "W", researcher: "R", character_designer: "C", producer: "P" },
      revision_history: [],
    };

    const gating = checkPhase2GatingConditions(validated);
    expect(gating.condition2).toBe(false);
    expect(gating.unselected).toContain("char_001");
  });
});

// ─── Phase 3 스키마 ────────────────────────────────────────────

describe("validatePhase3Output", () => {
  function makeEpisode(ep: number) {
    return {
      ep, title: `${ep}화 제목`, summary: "1~2줄 요약",
      arc_id: "arc_001", episode_type: "normal" as const,
      featured_characters: ["char_001"], featured_locations: ["loc_001"],
      cliffhanger: null,
    };
  }

  const validPhase3 = {
    phase: "100화_로드맵" as const,
    summary: "전체 서사 요약",
    arc_structure: {
      act_1: { range: [1, 15] as [number, number], theme: "발단", key_events: ["사건1"] },
      act_2: { range: [16, 55] as [number, number], theme: "전개", key_events: ["사건2"] },
      act_3: { range: [56, 80] as [number, number], theme: "위기", key_events: ["사건3"] },
      act_4: { range: [81, 100] as [number, number], theme: "결말", key_events: ["사건4"] },
    },
    arcs: [{
      arc_id: "arc_001", arc_type: "large" as const,
      title: "대아크 1", episode_range: [1, 100] as [number, number],
      theme: "성장", resolution: "해소",
    }],
    episodes: Array.from({ length: 100 }, (_, i) => makeEpisode(i + 1)),
    pacing_plan: {
      hook_episodes: [5, 10, 15],
      peak_episodes: [20, 40, 60, 80],
      twist_episodes: [30, 65],
      estimated_weekly_schedule: "주 1회 연재",
    },
    agent_notes: { scenario_writer: "작가 메모", producer: "프로듀서 메모" },
    revision_history: [],
  };

  it("accepts valid Phase 3 output with 100 episodes", () => {
    const result = validatePhase3Output(validPhase3);
    expect(result.success).toBe(true);
  });

  it("rejects when episodes count != 100", () => {
    const result = validatePhase3Output({
      ...validPhase3,
      episodes: Array.from({ length: 99 }, (_, i) => makeEpisode(i + 1)),
    });
    expect(result.success).toBe(false);
  });
});

// ─── Phase 4 스키마 ────────────────────────────────────────────

describe("validatePhase4Output", () => {
  function makeCut(n: number) {
    return {
      cut: n, angle: "MS" as const, aspect_ratio: "1:2" as const,
      scene_description: "장면 설명",
      characters: [{ char_id: "char_001", position: "center" as const, expression: "무표정" as const, pose: "서 있음" }],
      location_id: "loc_001", background_variant: "day_clear" as const,
      dialogue: [{ char_id: "char_001", text: "대사", balloon_type: "normal" as const }],
      sfx: [], effect: "none" as const,
      image_prompt: { cut_specific_tags: "tags", negative_prompt: "neg" },
      director_note: "연출 메모",
    };
  }

  const validPhase4 = {
    phase: "30컷_대본" as const,
    episode: 1, episode_title: "1화 제목",
    chapter_style: "default" as const,
    script_data: Array.from({ length: 30 }, (_, i) => makeCut(i + 1)),
    episode_summary_for_next: "다음 화 요약",
    assets_used: { characters: ["char_001"], locations: ["loc_001"], props: [] },
    agent_notes: { script_writer: "작가 메모", producer: "프로듀서 메모" },
    revision_history: [],
  };

  it("accepts valid Phase 4 output with 30 cuts", () => {
    const result = validatePhase4Output(validPhase4);
    expect(result.success).toBe(true);
  });

  it("rejects when cuts count != 30", () => {
    const result = validatePhase4Output({
      ...validPhase4,
      script_data: Array.from({ length: 29 }, (_, i) => makeCut(i + 1)),
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid camera angle", () => {
    const badCut = { ...makeCut(1), angle: "INVALID" };
    const result = validatePhase4Output({
      ...validPhase4,
      script_data: [badCut, ...Array.from({ length: 29 }, (_, i) => makeCut(i + 2))],
    });
    expect(result.success).toBe(false);
  });
});
