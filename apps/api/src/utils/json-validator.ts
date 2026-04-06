import { z } from "zod";

// ─── ID 패턴 검증 ─────────────────────────────────────────────

const charIdPattern = /^char_\d{3}$/;
const locIdPattern = /^loc_\d{3}$/;
const propIdPattern = /^prop_\d{3}$/;

// ─── Phase 1 스키마 ───────────────────────────────────────────

export const Phase1OutputSchema = z.object({
  phase: z.literal("기획 분석"),
  summary: z.string().max(300, "summary는 300자 이내여야 합니다"),
  market_analysis: z.object({
    genre: z.string().min(1),
    positioning: z.string().min(1),
    trend_keywords: z.array(z.string()).min(1),
    competitors: z
      .array(
        z.object({
          title: z.string().min(1),
          strength: z.string().min(1),
          weakness: z.string().min(1),
          our_edge: z.string().min(1),
        })
      )
      .length(3, "경쟁작은 정확히 3개여야 합니다"),
  }),
  usp: z
    .array(z.string().min(1))
    .min(3, "USP는 최소 3개")
    .max(5, "USP는 최대 5개"),
  feasibility_score: z.number().min(0).max(1),
  agent_notes: z.object({
    strategist: z.string().min(1),
    researcher: z.string().min(1),
    producer: z.string().min(1),
  }),
  asset_list: z.object({
    characters: z.array(z.never()).default([]),
    locations: z.array(z.never()).default([]),
    props: z.array(z.never()).default([]),
  }),
  revision_history: z.array(z.unknown()).default([]),
});

export type Phase1OutputValidated = z.infer<typeof Phase1OutputSchema>;

export function validatePhase1Output(data: unknown) {
  return Phase1OutputSchema.safeParse(data);
}

// ─── Phase 2 스키마 ───────────────────────────────────────────

const WorldDesignSchema = z.object({
  physical_env: z.object({
    era: z.string().min(1),
    geography: z.string().min(1),
    climate: z.string().min(1),
  }),
  social_system: z.object({
    power_structure: z.string().min(1),
    class_system: z.string().min(1),
    economy: z.string().min(1),
  }),
  unique_rules: z
    .array(
      z.object({
        rule_name: z.string().min(1),
        description: z.string().min(1),
        limitation: z.string().min(1),
      })
    )
    .min(3, "고유 규칙은 최소 3개"),
  information_asymmetry: z.object({
    reader_knows: z.array(z.string()).min(1),
    character_knows: z.array(z.string()).min(1),
  }),
});

const DesignOptionSchema = z.object({
  target_id: z.string().min(1),
  target_name: z.string().min(1),
  target_type: z.enum(["character", "location"]),
  option_a: z.string().min(1),
  option_b: z.string().min(1),
  selected: z.enum(["A", "B"]).nullable(),
});

export const Phase2OutputSchema = z.object({
  phase: z.literal("세계관_에셋_설계"),
  summary: z.string().max(500, "summary는 500자 이내여야 합니다"),
  world_design: WorldDesignSchema,
  asset_list: z.object({
    characters: z
      .array(
        z.object({
          id: z.string().regex(charIdPattern, "char_NNN 형식이어야 합니다"),
          name: z.string().min(1),
          role: z.enum(["protagonist", "antagonist", "supporting"]),
          age: z.string().min(1),
          personality: z.string().min(1),
          appearance: z.object({
            face: z.string(),
            body: z.string(),
            hair: z.string(),
            outfit: z.string(),
            distinguishing_features: z.string(),
          }),
          ability: z.string(),
          arc: z.string(),
        })
      )
      .min(1, "캐릭터 최소 1명"),
    locations: z
      .array(
        z.object({
          id: z.string().regex(locIdPattern, "loc_NNN 형식이어야 합니다"),
          name: z.string().min(1),
          type: z.enum(["interior", "exterior", "landmark"]),
          atmosphere: z.string().min(1),
          structure: z.string().min(1),
          first_appearance: z.string().min(1),
        })
      )
      .min(1, "배경 최소 1개"),
    props: z.array(
      z.object({
        id: z.string().regex(propIdPattern, "prop_NNN 형식이어야 합니다"),
        name: z.string(),
        function: z.string(),
        appearance: z.string(),
        owner: z.string().nullable(),
      })
    ),
  }),
  design_options: z.array(DesignOptionSchema).min(1, "디자인 옵션 최소 1개"),
  approved_assets: z.array(z.string()).default([]),
  agent_notes: z.object({
    worldbuilder: z.string().min(1),
    researcher: z.string().min(1),
    character_designer: z.string().min(1),
    producer: z.string().min(1),
  }),
  revision_history: z.array(z.unknown()).default([]),
});

export type Phase2OutputValidated = z.infer<typeof Phase2OutputSchema>;

export function validatePhase2Output(data: unknown) {
  return Phase2OutputSchema.safeParse(data);
}

/**
 * GATING 조건 1: ASSET_LIST에 캐릭터 최소 1명, 배경 최소 1개
 * GATING 조건 2: 모든 design_options[].selected가 null이 아님
 */
export function checkPhase2GatingConditions(output: Phase2OutputValidated): {
  condition1: boolean; // ASSET_LIST 충족
  condition2: boolean; // A/B 선택 완료
  unselected: string[]; // 아직 선택 안 된 target_id 목록
} {
  const condition1 =
    output.asset_list.characters.length >= 1 && output.asset_list.locations.length >= 1;

  const unselected = output.design_options
    .filter((opt) => opt.selected === null)
    .map((opt) => opt.target_id);
  const condition2 = unselected.length === 0;

  return { condition1, condition2, unselected };
}

// ─── Phase 3 스키마 ───────────────────────────────────────────

const EpisodeTypeSchema = z.enum(["normal", "hook", "peak", "twist", "fanservice", "info"]);
const ArcTypeSchema = z.enum(["small", "medium", "large"]);

const ArcSchema = z.object({
  arc_id: z.string().regex(/^arc_\d{3}$/, "arc_NNN 형식이어야 합니다"),
  arc_type: ArcTypeSchema,
  title: z.string().min(1),
  episode_range: z.tuple([z.number().int().min(1), z.number().int().max(100)]),
  theme: z.string().min(1),
  resolution: z.string().min(1),
});

const EpisodeSchema = z.object({
  ep: z.number().int().min(1).max(100),
  title: z.string().min(1),
  summary: z.string().min(1),
  arc_id: z.string().min(1),
  episode_type: EpisodeTypeSchema,
  featured_characters: z.array(z.string()),
  featured_locations: z.array(z.string()),
  cliffhanger: z.string().nullable(),
});

const ArcStructureSchema = z.object({
  act_1: z.object({ range: z.tuple([z.number(), z.number()]), theme: z.string(), key_events: z.array(z.string()) }),
  act_2: z.object({ range: z.tuple([z.number(), z.number()]), theme: z.string(), key_events: z.array(z.string()) }),
  act_3: z.object({ range: z.tuple([z.number(), z.number()]), theme: z.string(), key_events: z.array(z.string()) }),
  act_4: z.object({ range: z.tuple([z.number(), z.number()]), theme: z.string(), key_events: z.array(z.string()) }),
});

const PacingPlanSchema = z.object({
  hook_episodes: z.array(z.number().int()),
  peak_episodes: z.array(z.number().int()),
  twist_episodes: z.array(z.number().int()),
  estimated_weekly_schedule: z.string().min(1),
});

export const Phase3OutputSchema = z.object({
  phase: z.literal("100화_로드맵"),
  summary: z.string().max(500, "summary는 500자 이내여야 합니다"),
  arc_structure: ArcStructureSchema,
  arcs: z.array(ArcSchema).min(1, "arcs 최소 1개"),
  episodes: z
    .array(EpisodeSchema)
    .length(100, "episodes는 정확히 100개여야 합니다"),
  pacing_plan: PacingPlanSchema,
  agent_notes: z.object({
    scenario_writer: z.string().min(1),
    producer: z.string().min(1),
  }),
  revision_history: z.array(z.unknown()).default([]),
});

export type Phase3OutputValidated = z.infer<typeof Phase3OutputSchema>;

export function validatePhase3Output(data: unknown) {
  return Phase3OutputSchema.safeParse(data);
}

// ─── Phase 4 스키마 ───────────────────────────────────────────

const CameraAngleSchema = z.enum([
  "ELS", "LS", "MS", "MCU", "CU", "ECU", "OTS", "POV", "BIRD", "WORM", "DUTCH",
]);

const ScriptCutCharacterSchema = z.object({
  char_id: z.string().min(1),
  position: z.enum(["left", "center", "right", "background"]),
  expression: z.enum(["기쁨", "분노", "슬픔", "놀람", "무표정", "긴장"]),
  pose: z.string().min(1),
});

const ScriptCutDialogueSchema = z.object({
  char_id: z.string().min(1),
  text: z.string().min(1),
  balloon_type: z.enum(["normal", "shout", "whisper", "thought", "narration"]),
});

const ScriptCutSchema = z.object({
  cut: z.number().int().min(1).max(30),
  angle: CameraAngleSchema,
  aspect_ratio: z.enum(["1:1", "1:1.5", "1:2", "1:3"]),
  scene_description: z.string().min(1),
  characters: z.array(ScriptCutCharacterSchema),
  location_id: z.string().min(1),
  background_variant: z.enum(["day_clear", "day_cloudy", "evening", "night", "rain", "snow"]),
  dialogue: z.array(ScriptCutDialogueSchema),
  sfx: z.array(z.string()),
  effect: z.enum(["none", "speed_lines", "impact_lines", "glow", "blur"]),
  image_prompt: z.object({
    cut_specific_tags: z.string(),
    negative_prompt: z.string(),
  }),
  director_note: z.string(),
});

export const Phase4OutputSchema = z.object({
  phase: z.literal("30컷_대본"),
  episode: z.number().int().min(1).max(100),
  episode_title: z.string().min(1),
  chapter_style: z.enum(["default", "flashback", "dream", "climax", "epilogue"]),
  script_data: z
    .array(ScriptCutSchema)
    .length(30, "script_data는 정확히 30개 컷이어야 합니다"),
  episode_summary_for_next: z.string().min(1),
  assets_used: z.object({
    characters: z.array(z.string()),
    locations: z.array(z.string()),
    props: z.array(z.string()),
  }),
  agent_notes: z.object({
    script_writer: z.string().min(1),
    producer: z.string().min(1),
  }),
  revision_history: z.array(z.unknown()).default([]),
});

export type Phase4OutputValidated = z.infer<typeof Phase4OutputSchema>;

export function validatePhase4Output(data: unknown) {
  return Phase4OutputSchema.safeParse(data);
}

// ─── 공통 스키마 ──────────────────────────────────────────────

export const AssetListSchema = z.object({
  characters: z.array(
    z.object({
      id: z.string().regex(charIdPattern, "char_NNN 형식이어야 합니다"),
      name: z.string(),
      role: z.enum(["protagonist", "antagonist", "supporting"]),
      age: z.string(),
      personality: z.string(),
      appearance: z.object({
        face: z.string(),
        body: z.string(),
        hair: z.string(),
        outfit: z.string(),
        distinguishing_features: z.string(),
      }),
      ability: z.string(),
      arc: z.string(),
    })
  ),
  locations: z.array(
    z.object({
      id: z.string().regex(locIdPattern, "loc_NNN 형식이어야 합니다"),
      name: z.string(),
      type: z.enum(["interior", "exterior", "landmark"]),
      atmosphere: z.string(),
      structure: z.string(),
      first_appearance: z.string(),
    })
  ),
  props: z.array(
    z.object({
      id: z.string().regex(propIdPattern, "prop_NNN 형식이어야 합니다"),
      name: z.string(),
      function: z.string(),
      appearance: z.string(),
      owner: z.string().nullable(),
    })
  ),
});

// ScriptCutSchema은 Phase4OutputSchema 블록에 정의됨 (위 참조)
export const ScriptDataSchema = z.array(ScriptCutSchema).length(30);

export function validateAssetList(data: unknown) {
  return AssetListSchema.safeParse(data);
}

export function validateScriptData(data: unknown) {
  return ScriptDataSchema.safeParse(data);
}
