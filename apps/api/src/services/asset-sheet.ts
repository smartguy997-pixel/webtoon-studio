import { FieldValue } from "firebase-admin/firestore";
import { callAgent } from "./anthropic.js";
import {
  CHARACTER_SHEET_PROMPT,
  buildCharacterSheetMessage,
  type CharacterSheetInput,
} from "./agents/prompts/character-sheet.prompt.js";
import { extractJson, JsonExtractionError } from "../utils/extract-json.js";
import { generateImage, generateImageImg2Img } from "./whisk.js";
import { collections } from "./firestore.js";

// ─── 타입 ─────────────────────────────────────────────────────

export interface CharacterSheetTags {
  char_id: string;
  facial_tags: string[];
  body_tags: string[];
  expression_set_prompts: {
    happy: string;
    angry: string;
    sad: string;
    surprised: string;
    neutral: string;
    tense: string;
  };
  forbidden_tags: string[];
}

export interface CharacterSheet extends CharacterSheetTags {
  ref_image_id: string | null;
  pose_anchors: {
    front: string | null;
    side: string | null;
    back: string | null;
  };
  expression_set: {
    기쁨: string | null;
    분노: string | null;
    슬픔: string | null;
    놀람: string | null;
    무표정: string | null;
    긴장: string | null;
  };
  locked: boolean;
  created_at: unknown;
}

export interface BackgroundSheet {
  loc_id: string;
  structure_tags: string[];
  mood_variants: {
    day_clear: string | null;
    day_cloudy: string | null;
    evening: string | null;
    night: string | null;
    rain: string | null;
    snow: string | null;
  };
  color_grade: {
    temperature: "cool" | "warm" | "neutral";
    saturation_range: [number, number];
    hue_bias: string;
  };
  forbidden_elements: string[];
  locked: boolean;
  created_at: unknown;
}

// ─── 캐릭터 시트 태그 생성 (에이전트 호출) ────────────────────

async function generateCharacterSheetTags(
  input: CharacterSheetInput
): Promise<CharacterSheetTags> {
  const userMessage = buildCharacterSheetMessage(input);

  const raw = await callAgent(
    CHARACTER_SHEET_PROMPT,
    [{ role: "user", content: userMessage }],
    { agentName: `character-sheet-${input.charId}` }
  );

  try {
    return extractJson<CharacterSheetTags>(raw);
  } catch (err) {
    if (err instanceof JsonExtractionError) {
      const retry = await callAgent(
        CHARACTER_SHEET_PROMPT,
        [
          { role: "user", content: userMessage },
          { role: "assistant", content: raw },
          {
            role: "user",
            content:
              "출력이 올바른 JSON 형식이 아닙니다. 지정된 캐릭터 시트 JSON 스키마만 출력해주세요.",
          },
        ],
        { agentName: `character-sheet-${input.charId}-retry` }
      );
      return extractJson<CharacterSheetTags>(retry);
    }
    throw err;
  }
}

// ─── 캐릭터 참조 이미지 생성 ──────────────────────────────────

/** 캐릭터 태그를 연결해 이미지 프롬프트를 만든다 */
function buildCharAssetTags(tags: CharacterSheetTags): string {
  return [...tags.facial_tags, ...tags.body_tags].join(", ");
}

async function generatePoseImages(
  projectId: string,
  charId: string,
  tags: CharacterSheetTags
): Promise<CharacterSheet["pose_anchors"]> {
  const base = buildCharAssetTags(tags);

  const [front, side, back] = await Promise.allSettled([
    generateImage(projectId, `${base}, front view, facing camera, full body`),
    generateImage(projectId, `${base}, side profile view, full body`),
    generateImage(projectId, `${base}, back view, full body`),
  ]);

  return {
    front:  front.status  === "fulfilled" ? front.value  : null,
    side:   side.status   === "fulfilled" ? side.value   : null,
    back:   back.status   === "fulfilled" ? back.value   : null,
  };
}

async function generateExpressionImages(
  projectId: string,
  charId: string,
  tags: CharacterSheetTags
): Promise<CharacterSheet["expression_set"]> {
  const base = buildCharAssetTags(tags);

  const expressionEntries: Array<[keyof CharacterSheet["expression_set"], string]> = [
    ["기쁨",   `${base}, ${tags.expression_set_prompts.happy},   bust shot`],
    ["분노",   `${base}, ${tags.expression_set_prompts.angry},   bust shot`],
    ["슬픔",   `${base}, ${tags.expression_set_prompts.sad},     bust shot`],
    ["놀람",   `${base}, ${tags.expression_set_prompts.surprised}, bust shot`],
    ["무표정", `${base}, ${tags.expression_set_prompts.neutral}, bust shot`],
    ["긴장",   `${base}, ${tags.expression_set_prompts.tense},   bust shot`],
  ];

  const results = await Promise.allSettled(
    expressionEntries.map(([, prompt]) => generateImage(projectId, prompt))
  );

  const expressionSet: CharacterSheet["expression_set"] = {
    기쁨: null, 분노: null, 슬픔: null, 놀람: null, 무표정: null, 긴장: null,
  };

  expressionEntries.forEach(([key], idx) => {
    const result = results[idx];
    if (result.status === "fulfilled") expressionSet[key] = result.value;
  });

  return expressionSet;
}

// ─── 캐릭터 시트 전체 생성 ────────────────────────────────────

/**
 * 단일 캐릭터의 시트를 생성하고 Firestore에 저장한다.
 *
 * 1. 에이전트 호출 → 구조화 태그
 * 2. Whisk → 3뷰 포즈 이미지
 * 3. Whisk → 6표정 이미지
 * 4. Firestore style_registry/character_sheets/{charId} 저장
 * 5. approved_assets/characters/{charId} ref_image_id 업데이트
 */
export async function generateCharacterSheet(
  projectId: string,
  charId: string,
  charData: {
    name: string;
    role: string;
    age: string;
    personality: string;
    appearance: { face: string; body: string; hair: string; outfit: string; distinguishing_features: string };
    final_prompt: string;
  }
): Promise<CharacterSheet> {
  console.log(`[AssetSheet] ${charId} 캐릭터 시트 생성 시작`);

  // 1. 에이전트 → 구조화 태그
  const tags = await generateCharacterSheetTags({
    charId,
    name: charData.name,
    role: charData.role,
    age: charData.age,
    appearance: charData.appearance,
    personality: charData.personality,
    finalPrompt: charData.final_prompt,
  });

  // 2~3. 이미지 생성 (포즈 + 표정) — 병렬 실행
  const [poseAnchors, expressionSet] = await Promise.all([
    generatePoseImages(projectId, charId, tags),
    generateExpressionImages(projectId, charId, tags),
  ]);

  // base ref는 front 포즈 이미지
  const refImageId = poseAnchors.front;

  const sheet: CharacterSheet = {
    ...tags,
    ref_image_id: refImageId,
    pose_anchors: poseAnchors,
    expression_set: expressionSet,
    locked: true,
    created_at: FieldValue.serverTimestamp(),
  };

  // 4. Firestore 저장
  await collections
    .styleRegistry(projectId)
    .collection("character_sheets")
    .doc(charId)
    .set(sheet);

  // 5. approved_assets ref_image_id 업데이트
  if (refImageId) {
    await collections
      .approvedAssets(projectId)
      .collection("characters")
      .doc(charId)
      .update({ ref_image_id: refImageId, updated_at: FieldValue.serverTimestamp() });
  }

  console.log(`[AssetSheet] ${charId} 캐릭터 시트 완료`);
  return sheet;
}

// ─── 배경 시트 생성 ───────────────────────────────────────────

/** 배경 데이터에서 structure_tags를 결정론적으로 추출한다 */
function extractStructureTags(locData: {
  name: string;
  type: string;
  atmosphere: string;
  structure: string;
}): string[] {
  // structure 문자열을 콤마/마침표로 분리해 태그 배열로 변환
  const fromStructure = locData.structure
    .split(/[,.]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 2 && s.length < 60);

  const fromAtmosphere = locData.atmosphere
    .split(/[,.]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 2 && s.length < 60);

  return [...new Set([...fromStructure, ...fromAtmosphere])].slice(0, 10);
}

const MOOD_VARIANT_OVERLAYS: Record<string, string> = {
  day_clear:  "bright daylight, clear blue sky, sharp shadows",
  day_cloudy: "overcast daylight, diffused light, no harsh shadows",
  evening:    "golden hour, warm orange glow, long shadows",
  night:      "dark night, artificial lighting, neon reflections",
  rain:       "heavy rain, wet surfaces, reflective puddles, gray atmosphere",
  snow:       "snowfall, white ground cover, cold blue tint",
};

async function generateMoodVariants(
  projectId: string,
  locId: string,
  baseTags: string
): Promise<BackgroundSheet["mood_variants"]> {
  const entries = Object.entries(MOOD_VARIANT_OVERLAYS) as Array<
    [keyof BackgroundSheet["mood_variants"], string]
  >;

  const results = await Promise.allSettled(
    entries.map(([, overlay]) =>
      generateImage(projectId, `${baseTags}, ${overlay}, background only, no characters`)
    )
  );

  const variants: BackgroundSheet["mood_variants"] = {
    day_clear: null, day_cloudy: null, evening: null,
    night: null, rain: null, snow: null,
  };

  entries.forEach(([key], idx) => {
    const result = results[idx];
    if (result.status === "fulfilled") variants[key] = result.value;
  });

  return variants;
}

/** 배경 분위기에서 color_grade를 추론한다 */
function inferColorGrade(atmosphere: string): BackgroundSheet["color_grade"] {
  const lower = atmosphere.toLowerCase();
  const isCool = /cold|winter|night|dark|shadow|rain|fog|gray|grey/.test(lower);
  const isWarm = /warm|summer|sunset|golden|cozy|fire|desert/.test(lower);

  return {
    temperature: isCool ? "cool" : isWarm ? "warm" : "neutral",
    saturation_range: [0.6, 0.85],
    hue_bias: isCool ? "blue-gray" : isWarm ? "orange-yellow" : "neutral",
  };
}

/**
 * 단일 배경 시트를 생성하고 Firestore에 저장한다.
 *
 * 1. structure_tags를 배경 데이터에서 추출
 * 2. Whisk → 6종 mood_variants 이미지
 * 3. Firestore style_registry/background_sheets/{locId} 저장
 * 4. approved_assets/locations/{locId} ref_image_id 업데이트
 */
export async function generateBackgroundSheet(
  projectId: string,
  locId: string,
  locData: {
    name: string;
    type: string;
    atmosphere: string;
    structure: string;
    first_appearance: string;
  }
): Promise<BackgroundSheet> {
  console.log(`[AssetSheet] ${locId} 배경 시트 생성 시작`);

  const structureTags = extractStructureTags(locData);
  const baseTags = structureTags.join(", ");
  const colorGrade = inferColorGrade(locData.atmosphere);

  const moodVariants = await generateMoodVariants(projectId, locId, baseTags);

  const sheet: BackgroundSheet = {
    loc_id: locId,
    structure_tags: structureTags,
    mood_variants: moodVariants,
    color_grade: colorGrade,
    forbidden_elements: [], // 에이전트가 추가할 수도 있으나 기본 빈 배열
    locked: true,
    created_at: FieldValue.serverTimestamp(),
  };

  // Firestore 저장
  await collections
    .styleRegistry(projectId)
    .collection("background_sheets")
    .doc(locId)
    .set(sheet);

  // approved_assets ref_image_id 업데이트 (day_clear 기준)
  const refImageId = moodVariants.day_clear;
  if (refImageId) {
    await collections
      .approvedAssets(projectId)
      .collection("locations")
      .doc(locId)
      .update({ ref_image_id: refImageId, updated_at: FieldValue.serverTimestamp() });
  }

  console.log(`[AssetSheet] ${locId} 배경 시트 완료`);
  return sheet;
}

// ─── 전체 에셋 시트 초기화 ────────────────────────────────────

/**
 * Phase 2 GATING 통과 직후 호출.
 * 승인된 캐릭터 전체 + 배경 전체의 시트를 생성한다.
 * 실패한 에셋은 오류 로그만 기록하고 계속 진행 (non-fatal).
 */
export async function initializeAllAssetSheets(projectId: string): Promise<{
  characters: string[];
  locations: string[];
  errors: string[];
}> {
  const [charsSnap, locsSnap] = await Promise.all([
    collections.approvedAssets(projectId).collection("characters").get(),
    collections.approvedAssets(projectId).collection("locations").get(),
  ]);

  const succeeded: { characters: string[]; locations: string[] } = {
    characters: [],
    locations: [],
  };
  const errors: string[] = [];

  // 캐릭터 시트 — 순차 처리 (API 레이트 리밋 방지)
  for (const doc of charsSnap.docs) {
    const data = doc.data() as {
      name: string;
      role: string;
      age: string;
      personality: string;
      appearance: { face: string; body: string; hair: string; outfit: string; distinguishing_features: string };
      final_prompt: string;
    };
    try {
      await generateCharacterSheet(projectId, doc.id, data);
      succeeded.characters.push(doc.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      errors.push(`${doc.id}: ${msg}`);
      console.error(`[AssetSheet] ${doc.id} 캐릭터 시트 실패:`, msg);
    }
  }

  // 배경 시트 — 순차 처리
  for (const doc of locsSnap.docs) {
    const data = doc.data() as {
      name: string;
      type: string;
      atmosphere: string;
      structure: string;
      first_appearance: string;
    };
    try {
      await generateBackgroundSheet(projectId, doc.id, data);
      succeeded.locations.push(doc.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      errors.push(`${doc.id}: ${msg}`);
      console.error(`[AssetSheet] ${doc.id} 배경 시트 실패:`, msg);
    }
  }

  return { ...succeeded, errors };
}

// ─── 단일 시트 조회 ────────────────────────────────────────────

export async function getCharacterSheet(
  projectId: string,
  charId: string
): Promise<CharacterSheet | null> {
  const doc = await collections
    .styleRegistry(projectId)
    .collection("character_sheets")
    .doc(charId)
    .get();
  return doc.exists ? (doc.data() as CharacterSheet) : null;
}

export async function getBackgroundSheet(
  projectId: string,
  locId: string
): Promise<BackgroundSheet | null> {
  const doc = await collections
    .styleRegistry(projectId)
    .collection("background_sheets")
    .doc(locId)
    .get();
  return doc.exists ? (doc.data() as BackgroundSheet) : null;
}
