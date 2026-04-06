import { generateImage } from "../services/whisk.js";
import { runSCC, saveSCCLog, type SCCResult } from "../services/scc.js";
import { collections, db } from "../services/firestore.js";
import { FieldValue } from "firebase-admin/firestore";
import type { ScriptCut } from "../agents/script.js";

// ─── 상수 ─────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;

// ─── 타입 ─────────────────────────────────────────────────────

export type SccCutStatus = "pending" | "pass" | "fail" | "flagged";

export interface SccCutResult {
  cutNum: number;
  imageId: string | null;
  status: SccCutStatus;
  attempts: number;
  scores: {
    mstClip: number;
    charClip: number;
    bgOrb: number;
  } | null;
  error?: string;
}

export interface SccBatchResult {
  episodeNum: number;
  total: number;
  passed: number;
  flagged: number;
  results: SccCutResult[];
  all_passed: boolean;
}

// ─── 참조 이미지 URL 조회 ──────────────────────────────────────

async function getCharRefUrl(projectId: string, charId: string): Promise<string> {
  const doc = await collections
    .approvedAssets(projectId)
    .collection("characters")
    .doc(charId)
    .get();
  return (doc.data()?.ref_image_id as string | null) ?? "";
}

async function getBgRefUrl(projectId: string, locId: string): Promise<string> {
  const doc = await collections
    .approvedAssets(projectId)
    .collection("locations")
    .doc(locId)
    .get();
  return (doc.data()?.ref_image_id as string | null) ?? "";
}

async function getMstText(projectId: string): Promise<string> {
  const doc = await collections.styleRegistry(projectId).collection("mst").get();
  if (doc.empty) {
    return "Korean webtoon line art, clean bold outlines, flat color, cel-shading";
  }
  const mst = doc.docs[0].data();
  return [mst.art_style, mst.line_weight, mst.color_palette, mst.rendering, mst.perspective]
    .filter(Boolean)
    .join(", ");
}

// Whisk가 반환한 imageId → 공개 URL 변환 (실제 구현 시 Whisk API 참조)
function imageIdToUrl(imageId: string): string {
  return `https://cdn.whisk.com/images/${imageId}`;
}

// ─── 단일 컷 SCC 실행 (최대 3회 재시도) ──────────────────────

async function runSccForCut(
  projectId: string,
  epNum: number,
  cut: ScriptCut,
  mstText: string,
  charRefUrl: string,
  bgRefUrl: string
): Promise<SccCutResult> {
  let lastResult: SCCResult | null = null;
  let imageId: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // 이미지 생성 (MST 자동 주입은 whisk.ts 내부에서 처리)
      imageId = await generateImage(
        projectId,
        cut.image_prompt.cut_specific_tags,
        cut.image_prompt.negative_prompt
      );
      const imageUrl = imageIdToUrl(imageId);

      // SCC 검증
      lastResult = await runSCC(
        projectId,
        epNum,
        cut.cut,
        imageUrl,
        mstText,
        charRefUrl,
        bgRefUrl
      );
      lastResult = { ...lastResult, attempt };

      // 검증 로그 저장
      await saveSCCLog(projectId, epNum, cut.cut, lastResult);

      if (lastResult.overall === "pass") {
        return {
          cutNum: cut.cut,
          imageId,
          status: "pass",
          attempts: attempt,
          scores: {
            mstClip: lastResult.mstClipScore,
            charClip: lastResult.charClipScore,
            bgOrb: lastResult.bgOrbMatch,
          },
        };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "알 수 없는 오류";
      console.error(`[SCC] ep${epNum} cut${cut.cut} attempt${attempt} 실패:`, errorMsg);
      // 마지막 시도가 아니면 계속 재시도
      if (attempt < MAX_ATTEMPTS) continue;
      // 마지막 시도도 에러면 flagged로 처리
      return {
        cutNum: cut.cut,
        imageId,
        status: "flagged",
        attempts: attempt,
        scores: null,
        error: errorMsg,
      };
    }
  }

  // MAX_ATTEMPTS 모두 fail → flagged
  return {
    cutNum: cut.cut,
    imageId,
    status: "flagged",
    attempts: MAX_ATTEMPTS,
    scores: lastResult
      ? {
          mstClip: lastResult.mstClipScore,
          charClip: lastResult.charClipScore,
          bgOrb: lastResult.bgOrbMatch,
        }
      : null,
  };
}

// ─── 컷 SCC 결과를 Firestore에 반영 ───────────────────────────

async function updateCutSccStatus(
  projectId: string,
  epNum: number,
  result: SccCutResult
): Promise<void> {
  const epId = `ep_${String(epNum).padStart(3, "0")}`;
  const cutId = `cut_${String(result.cutNum).padStart(2, "0")}`;
  const cutRef = collections
    .scripts(projectId)
    .collection("episodes")
    .doc(epId)
    .collection("cuts")
    .doc(cutId);

  await cutRef.update({
    scc_status: result.status,
    scc_image_id: result.imageId,
    scc_attempts: result.attempts,
    scc_scores: result.scores,
    scc_updated_at: FieldValue.serverTimestamp(),
  });
}

// ─── 에피소드 전체 컷 배치 SCC 실행 ──────────────────────────

/**
 * 한 에피소드의 30컷에 대해 순차적으로 SCC를 실행한다.
 *
 * 실행 전략:
 * - 컷별로 MAX_ATTEMPTS=3회까지 재시도
 * - 실패 컷은 "flagged" 상태로 Firestore에 기록
 * - 전체 결과 요약을 에피소드 메타 문서에 반영
 */
export async function triggerSccBatch(
  projectId: string,
  epNum: number,
  cuts: ScriptCut[]
): Promise<SccBatchResult> {
  const mstText = await getMstText(projectId);

  const results: SccCutResult[] = [];

  for (const cut of cuts) {
    // 이 컷의 첫 번째 캐릭터 참조 이미지 사용 (없으면 빈 문자열)
    const primaryCharId = cut.characters[0]?.char_id ?? "";
    const charRefUrl = primaryCharId ? await getCharRefUrl(projectId, primaryCharId) : "";
    const bgRefUrl = cut.location_id ? await getBgRefUrl(projectId, cut.location_id) : "";

    const result = await runSccForCut(projectId, epNum, cut, mstText, charRefUrl, bgRefUrl);
    results.push(result);

    // 개별 컷 Firestore 업데이트
    await updateCutSccStatus(projectId, epNum, result);
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const flagged = results.filter((r) => r.status === "flagged").length;
  const all_passed = flagged === 0;

  // 에피소드 SCC 요약 업데이트
  const epId = `ep_${String(epNum).padStart(3, "0")}`;
  await collections
    .scripts(projectId)
    .collection("episodes")
    .doc(epId)
    .update({
      scc_status: all_passed ? "pass" : "partial",
      scc_passed_cuts: passed,
      scc_flagged_cuts: flagged,
      scc_completed_at: FieldValue.serverTimestamp(),
    });

  return {
    episodeNum: epNum,
    total: results.length,
    passed,
    flagged,
    results,
    all_passed,
  };
}

/**
 * 에피소드 전체 컷의 SCC 상태를 Firestore에서 조회
 */
export async function getSccStatus(
  projectId: string,
  epNum: number
): Promise<{ all_passed: boolean; passed: number; flagged: number; pending: number }> {
  const epId = `ep_${String(epNum).padStart(3, "0")}`;
  const cutsSnap = await collections
    .scripts(projectId)
    .collection("episodes")
    .doc(epId)
    .collection("cuts")
    .get();

  let passed = 0, flagged = 0, pending = 0;
  for (const doc of cutsSnap.docs) {
    const status = doc.data().scc_status as SccCutStatus | undefined;
    if (status === "pass") passed++;
    else if (status === "flagged") flagged++;
    else pending++;
  }

  return { all_passed: flagged === 0 && pending === 0, passed, flagged, pending };
}
