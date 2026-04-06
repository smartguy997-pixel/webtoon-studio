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

export const ScriptCutSchema = z.object({
  cut: z.number().int().min(1).max(30),
  angle: z.enum(["ELS", "LS", "MS", "MCU", "CU", "ECU", "OTS", "POV", "BIRD", "WORM", "DUTCH"]),
  aspect_ratio: z.enum(["1:1", "1:1.5", "1:2", "1:3"]),
  scene_description: z.string(),
  characters: z.array(z.object({
    char_id: z.string(),
    position: z.enum(["left", "center", "right", "background"]),
    expression: z.enum(["기쁨", "분노", "슬픔", "놀람", "무표정", "긴장"]),
    pose: z.string(),
  })),
  location_id: z.string(),
  background_variant: z.enum(["day_clear", "day_cloudy", "evening", "night", "rain", "snow"]),
  dialogue: z.array(z.object({
    char_id: z.string(),
    text: z.string(),
    balloon_type: z.enum(["normal", "shout", "whisper", "thought", "narration"]),
  })),
  sfx: z.array(z.string()),
  effect: z.enum(["none", "speed_lines", "impact_lines", "glow", "blur"]),
  director_note: z.string(),
});

export const ScriptDataSchema = z.array(ScriptCutSchema).length(30);

export function validateAssetList(data: unknown) {
  return AssetListSchema.safeParse(data);
}

export function validateScriptData(data: unknown) {
  return ScriptDataSchema.safeParse(data);
}
