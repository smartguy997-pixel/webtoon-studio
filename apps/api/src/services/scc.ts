import { computeClipScore, computeOrbMatch } from "./replicate.js";
import { collections } from "./firestore.js";

const THRESHOLDS = {
  MST_CLIP: 0.82,
  CHAR_CLIP: 0.85,
  BG_ORB: 0.7,
  MAX_ATTEMPTS: 3,
};

export interface SCCResult {
  overall: "pass" | "fail";
  mstClipScore: number;
  charClipScore: number;
  bgOrbMatch: number;
  attempt: number;
}

/**
 * Phase 5 — Style Consistency Checker (SCC)
 * 3단계 검증: MST 화풍 → 캐릭터 유사도 → 배경 구조
 */
export async function runSCC(
  projectId: string,
  episode: number,
  cut: number,
  imageUrl: string,
  mstText: string,
  charRefUrl: string,
  bgRefUrl: string
): Promise<SCCResult> {
  const mstClipScore = await computeClipScore(imageUrl, mstText);
  const charClipScore = await computeClipScore(imageUrl, charRefUrl);
  const bgOrbMatch = await computeOrbMatch(imageUrl, bgRefUrl);

  const overall =
    mstClipScore >= THRESHOLDS.MST_CLIP &&
    charClipScore >= THRESHOLDS.CHAR_CLIP &&
    bgOrbMatch >= THRESHOLDS.BG_ORB
      ? "pass"
      : "fail";

  return { overall, mstClipScore, charClipScore, bgOrbMatch, attempt: 1 };
}

/**
 * SCC 검증 로그를 Firestore에 저장
 */
export async function saveSCCLog(
  projectId: string,
  episode: number,
  cut: number,
  result: SCCResult
): Promise<void> {
  const logRef = collections
    .styleRegistry(projectId)
    .collection("validation_log")
    .doc(`ep_${String(episode).padStart(3, "0")}_cut_${String(cut).padStart(2, "0")}`);

  await logRef.set(
    {
      project_id: projectId,
      episode,
      cut,
      attempts: [
        {
          attempt: result.attempt,
          mst_clip_score: result.mstClipScore,
          char_clip_score: result.charClipScore,
          bg_orb_match: result.bgOrbMatch,
          overall: result.overall,
          timestamp: new Date(),
        },
      ],
      final_status: result.overall === "pass" ? "pass" : "flagged",
      created_at: new Date(),
    },
    { merge: true }
  );
}
