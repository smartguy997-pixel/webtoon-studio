import { FieldValue } from "firebase-admin/firestore";
import { computeClipScore, computeOrbMatch } from "./replicate.js";
import {
  generateImage,
  generateImageImg2Img,
  generateImageControlNet,
} from "./whisk.js";
import { getMst, buildFullPrompt, reinforceMstPrompt, type ChapterStyle } from "./mst.js";
import { getCharacterSheet, getBackgroundSheet } from "./asset-sheet.js";
import { collections } from "./firestore.js";

// ─── 임계값 ───────────────────────────────────────────────────

const THRESHOLDS = {
  MST_CLIP:   0.82,
  CHAR_CLIP:  0.85,
  BG_ORB:     0.70,
  MAX_ATTEMPTS: 3,
} as const;

// ─── 타입 ─────────────────────────────────────────────────────

export interface StageResult {
  score: number;
  passed: boolean;
}

export interface SCCAttempt {
  attempt: number;
  image_id: string;
  mst_clip_score: number;
  char_clip_score: number;
  bg_orb_match: number;
  overall: "pass" | "fail";
  failure_reason: "mst" | "character" | "background" | null;
  timestamp: Date;
}

export interface SCCResult {
  overall: "pass" | "fail";
  mstClipScore: number;
  charClipScore: number;
  bgOrbMatch: number;
  attempt: number;
  imageId: string;
}

export interface SCCLog {
  project_id: string;
  episode: number;
  cut: number;
  attempts: SCCAttempt[];
  final_status: "pass" | "flagged";
  flagged_reason: string | null;
  created_at: unknown;
  updated_at: unknown;
}

// ─── 참조 이미지 URL 변환 (imageId → CDN URL) ─────────────────

function imageIdToUrl(imageId: string): string {
  return `https://cdn.whisk.com/images/${imageId}`;
}

// ─── 단계별 검증 ──────────────────────────────────────────────

/** 1차: MST 화풍 일치도 (CLIP Score ≥ 0.82) */
async function checkMstClip(imageUrl: string, mstText: string): Promise<StageResult> {
  const score = await computeClipScore(imageUrl, mstText);
  return { score, passed: score >= THRESHOLDS.MST_CLIP };
}

/** 2차: 캐릭터 유사도 (CLIP Score ≥ 0.85, 참조 이미지 없으면 스킵) */
async function checkCharClip(imageUrl: string, charRefUrl: string): Promise<StageResult> {
  if (!charRefUrl) return { score: 1.0, passed: true }; // 참조 없으면 통과 처리
  const score = await computeClipScore(imageUrl, charRefUrl);
  return { score, passed: score >= THRESHOLDS.CHAR_CLIP };
}

/** 3차: 배경 구조 일치도 (ORB Match ≥ 70%, 참조 이미지 없으면 스킵) */
async function checkBgOrb(imageUrl: string, bgRefUrl: string): Promise<StageResult> {
  if (!bgRefUrl) return { score: 1.0, passed: true };
  const score = await computeOrbMatch(imageUrl, bgRefUrl);
  return { score, passed: score >= THRESHOLDS.BG_ORB };
}

// ─── 실패 유형별 재생성 프롬프트 강화 ────────────────────────

interface RegenerateParams {
  projectId: string;
  failureReason: "mst" | "character" | "background";
  prompt: string;
  negativePrompt: string;
  charRefImageId: string | null;
  bgRefImageId: string | null;
}

async function regenerateWithReinforcement(params: RegenerateParams): Promise<string> {
  const { projectId, failureReason, prompt, negativePrompt, charRefImageId, bgRefImageId } =
    params;

  switch (failureReason) {
    case "mst":
      // 화풍 이탈: negative_prompt 강화 + art_style 태그 반복
      return generateImage(
        projectId,
        prompt, // reinforceMstPrompt()는 호출자가 적용
        negativePrompt
      );

    case "character":
      // 캐릭터 불일치: img2img strength 조정 + ref_image 가중치 상승
      if (charRefImageId) {
        return generateImageImg2Img(
          projectId,
          prompt,
          negativePrompt,
          charRefImageId,
          0.5 // strength 낮춤 (기본 0.7 → 0.5)
        );
      }
      return generateImage(projectId, prompt, negativePrompt);

    case "background":
      // 배경 구조 불일치: ControlNet Depth 모드로 전환
      if (bgRefImageId) {
        return generateImageControlNet(
          projectId,
          prompt,
          negativePrompt,
          bgRefImageId,
          "depth"
        );
      }
      return generateImage(projectId, prompt, negativePrompt);
  }
}

// ─── 메인 SCC 파이프라인 ──────────────────────────────────────

export interface SccRunInput {
  projectId: string;
  episode: number;
  cut: number;
  /** 컷 고유 태그 (MST 제외) */
  cutSpecificTags: string;
  cutNegativePrompt: string;
  chapterStyle: ChapterStyle;
  /** 이 컷에 등장하는 첫 번째 캐릭터 ID (없으면 null) */
  primaryCharId: string | null;
  /** 이 컷의 배경 ID (없으면 null) */
  locationId: string | null;
}

/**
 * Phase 5 SCC 3단계 검증 파이프라인 (순차 실행)
 *
 * 1차 MST 화풍 → 2차 캐릭터 유사도 → 3차 배경 구조
 * 각 단계 실패 시 실패 유형에 따른 프롬프트 강화 후 재생성 (최대 3회)
 */
export async function runSCC(input: SccRunInput): Promise<SCCResult> {
  const { projectId, episode, cut, cutSpecificTags, cutNegativePrompt, chapterStyle } = input;

  // MST + 에셋 시트 로드
  const mst = await getMst(projectId);
  const mstText = `${mst.art_style}, ${mst.line_weight}, ${mst.color_palette}, ${mst.rendering}, ${mst.perspective}`;

  // 캐릭터·배경 시트에서 ref_image_id 조회
  const [charSheet, bgSheet] = await Promise.all([
    input.primaryCharId ? getCharacterSheet(projectId, input.primaryCharId) : null,
    input.locationId ? getBackgroundSheet(projectId, input.locationId) : null,
  ]);

  const charRefImageId = charSheet?.ref_image_id ?? null;
  const bgRefImageId = bgSheet?.mood_variants.day_clear ?? null; // 기본 day_clear 기준

  const charRefUrl = charRefImageId ? imageIdToUrl(charRefImageId) : "";
  const bgRefUrl = bgRefImageId ? imageIdToUrl(bgRefImageId) : "";

  // 에셋 태그 조합 (캐릭터 facial + body tags)
  const assetTags = charSheet
    ? [...(charSheet.facial_tags ?? []), ...(charSheet.body_tags ?? [])].join(", ")
    : "";

  const attempts: SCCAttempt[] = [];
  let currentImageId = "";

  for (let attempt = 1; attempt <= THRESHOLDS.MAX_ATTEMPTS; attempt++) {
    // 첫 시도 또는 재생성
    if (attempt === 1) {
      const { prompt, negative_prompt } = buildFullPrompt(
        mst,
        chapterStyle,
        assetTags,
        cutSpecificTags
      );
      currentImageId = await generateImage(projectId, prompt, negative_prompt);
    }

    const imageUrl = imageIdToUrl(currentImageId);

    // ── 1차: MST 화풍 ─────────────────────────────────────────
    const mstResult = await checkMstClip(imageUrl, mstText);
    if (!mstResult.passed) {
      const { prompt: reinforced, negative_prompt: reinforcedNeg } = reinforceMstPrompt(
        mst,
        `${assetTags}, ${cutSpecificTags}`
      );
      attempts.push({
        attempt,
        image_id: currentImageId,
        mst_clip_score: mstResult.score,
        char_clip_score: 0,
        bg_orb_match: 0,
        overall: "fail",
        failure_reason: "mst",
        timestamp: new Date(),
      });

      if (attempt < THRESHOLDS.MAX_ATTEMPTS) {
        currentImageId = await regenerateWithReinforcement({
          projectId,
          failureReason: "mst",
          prompt: reinforced,
          negativePrompt: reinforcedNeg,
          charRefImageId,
          bgRefImageId,
        });
      }
      continue;
    }

    // ── 2차: 캐릭터 유사도 ────────────────────────────────────
    const charResult = await checkCharClip(imageUrl, charRefUrl);
    if (!charResult.passed) {
      const { prompt, negative_prompt } = buildFullPrompt(
        mst,
        chapterStyle,
        assetTags,
        cutSpecificTags
      );
      attempts.push({
        attempt,
        image_id: currentImageId,
        mst_clip_score: mstResult.score,
        char_clip_score: charResult.score,
        bg_orb_match: 0,
        overall: "fail",
        failure_reason: "character",
        timestamp: new Date(),
      });

      if (attempt < THRESHOLDS.MAX_ATTEMPTS) {
        currentImageId = await regenerateWithReinforcement({
          projectId,
          failureReason: "character",
          prompt,
          negativePrompt: negative_prompt,
          charRefImageId,
          bgRefImageId,
        });
      }
      continue;
    }

    // ── 3차: 배경 구조 ────────────────────────────────────────
    const bgResult = await checkBgOrb(imageUrl, bgRefUrl);
    if (!bgResult.passed) {
      const { prompt, negative_prompt } = buildFullPrompt(
        mst,
        chapterStyle,
        assetTags,
        cutSpecificTags
      );
      attempts.push({
        attempt,
        image_id: currentImageId,
        mst_clip_score: mstResult.score,
        char_clip_score: charResult.score,
        bg_orb_match: bgResult.score,
        overall: "fail",
        failure_reason: "background",
        timestamp: new Date(),
      });

      if (attempt < THRESHOLDS.MAX_ATTEMPTS) {
        currentImageId = await regenerateWithReinforcement({
          projectId,
          failureReason: "background",
          prompt,
          negativePrompt: negative_prompt,
          charRefImageId,
          bgRefImageId,
        });
      }
      continue;
    }

    // ── 전체 통과 ─────────────────────────────────────────────
    attempts.push({
      attempt,
      image_id: currentImageId,
      mst_clip_score: mstResult.score,
      char_clip_score: charResult.score,
      bg_orb_match: bgResult.score,
      overall: "pass",
      failure_reason: null,
      timestamp: new Date(),
    });

    await saveSCCLog(projectId, episode, cut, attempts, "pass");

    return {
      overall: "pass",
      mstClipScore: mstResult.score,
      charClipScore: charResult.score,
      bgOrbMatch: bgResult.score,
      attempt,
      imageId: currentImageId,
    };
  }

  // 3회 모두 실패 → flagged
  const last = attempts[attempts.length - 1];
  const flaggedReason = buildFlaggedReason(last);
  await saveSCCLog(projectId, episode, cut, attempts, "flagged", flaggedReason);

  return {
    overall: "fail",
    mstClipScore: last?.mst_clip_score ?? 0,
    charClipScore: last?.char_clip_score ?? 0,
    bgOrbMatch: last?.bg_orb_match ?? 0,
    attempt: THRESHOLDS.MAX_ATTEMPTS,
    imageId: currentImageId,
  };
}

// ─── SCC 로그 저장 ────────────────────────────────────────────

function buildFlaggedReason(last: SCCAttempt | undefined): string {
  if (!last) return "알 수 없는 오류";
  switch (last.failure_reason) {
    case "mst":
      return `화풍 일치도 미달 (MST CLIP ${last.mst_clip_score.toFixed(3)} < ${THRESHOLDS.MST_CLIP})`;
    case "character":
      return `캐릭터 유사도 미달 (CLIP ${last.char_clip_score.toFixed(3)} < ${THRESHOLDS.CHAR_CLIP})`;
    case "background":
      return `배경 구조 일치도 미달 (ORB ${last.bg_orb_match.toFixed(3)} < ${THRESHOLDS.BG_ORB})`;
    default:
      return "검증 실패";
  }
}

export async function saveSCCLog(
  projectId: string,
  episode: number,
  cut: number,
  attempts: SCCAttempt[],
  finalStatus: "pass" | "flagged",
  flaggedReason: string | null = null
): Promise<void> {
  const logId = `ep_${String(episode).padStart(3, "0")}_cut_${String(cut).padStart(2, "0")}`;
  const logRef = collections
    .styleRegistry(projectId)
    .collection("validation_log")
    .doc(logId);

  await logRef.set(
    {
      project_id: projectId,
      episode,
      cut,
      attempts,
      final_status: finalStatus,
      flagged_reason: flaggedReason,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // 최초 생성인 경우 created_at 설정
  const doc = await logRef.get();
  if (!doc.data()?.created_at) {
    await logRef.update({ created_at: FieldValue.serverTimestamp() });
  }
}

// ─── SCC 로그 조회 ────────────────────────────────────────────

export async function getSCCLog(
  projectId: string,
  episode: number,
  cut: number
): Promise<SCCLog | null> {
  const logId = `ep_${String(episode).padStart(3, "0")}_cut_${String(cut).padStart(2, "0")}`;
  const doc = await collections
    .styleRegistry(projectId)
    .collection("validation_log")
    .doc(logId)
    .get();
  return doc.exists ? (doc.data() as SCCLog) : null;
}

export async function getEpisodeSCCLogs(
  projectId: string,
  episode: number
): Promise<SCCLog[]> {
  const snap = await collections
    .styleRegistry(projectId)
    .collection("validation_log")
    .where("episode", "==", episode)
    .orderBy("cut")
    .get();
  return snap.docs.map((d) => d.data() as SCCLog);
}
