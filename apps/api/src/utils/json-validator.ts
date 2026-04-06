import { z } from "zod";

// ─── ID 패턴 검증 ─────────────────────────────────────────────

const charIdPattern = /^char_\d{3}$/;
const locIdPattern = /^loc_\d{3}$/;
const propIdPattern = /^prop_\d{3}$/;

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
