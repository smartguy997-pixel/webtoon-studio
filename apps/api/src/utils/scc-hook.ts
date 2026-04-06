import { FieldValue } from "firebase-admin/firestore";
import { runSCC, type SCCResult } from "../services/scc.js";
import { collections, db } from "../services/firestore.js";
import type { ScriptCut } from "../agents/script.js";
import type { ChapterStyle } from "../services/mst.js";

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
 * 내부적으로 services/scc.ts의 `runSCC()`를 호출하며,
 * 3단계 검증(MST 화풍 → 캐릭터 유사도 → 배경 구조) +
 * 실패 유형별 프롬프트 강화 재생성이 자동으로 처리된다.
 */
export async function triggerSccBatch(
  projectId: string,
  epNum: number,
  cuts: ScriptCut[],
  chapterStyle: ChapterStyle = "default"
): Promise<SccBatchResult> {
  const results: SccCutResult[] = [];

  for (const cut of cuts) {
    const primaryCharId = cut.characters[0]?.char_id ?? null;

    let sccResult: SCCResult;
    try {
      sccResult = await runSCC({
        projectId,
        episode: epNum,
        cut: cut.cut,
        cutSpecificTags: cut.image_prompt.cut_specific_tags,
        cutNegativePrompt: cut.image_prompt.negative_prompt,
        chapterStyle,
        primaryCharId,
        locationId: cut.location_id || null,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "알 수 없는 오류";
      console.error(`[SCC] ep${epNum} cut${cut.cut} 실행 오류:`, errorMsg);
      const errResult: SccCutResult = {
        cutNum: cut.cut,
        imageId: null,
        status: "flagged",
        attempts: 0,
        scores: null,
        error: errorMsg,
      };
      results.push(errResult);
      await updateCutSccStatus(projectId, epNum, errResult).catch(() => {});
      continue;
    }

    const status: SccCutStatus =
      sccResult.overall === "pass"
        ? "pass"
        : sccResult.attempt >= 3
        ? "flagged"
        : "fail";

    const cutResult: SccCutResult = {
      cutNum: cut.cut,
      imageId: sccResult.imageId || null,
      status,
      attempts: sccResult.attempt,
      scores: {
        mstClip: sccResult.mstClipScore,
        charClip: sccResult.charClipScore,
        bgOrb: sccResult.bgOrbMatch,
      },
    };

    results.push(cutResult);
    await updateCutSccStatus(projectId, epNum, cutResult).catch(() => {});
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
    })
    .catch(() => {});

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

  let passed = 0,
    flagged = 0,
    pending = 0;
  for (const doc of cutsSnap.docs) {
    const status = doc.data().scc_status as SccCutStatus | undefined;
    if (status === "pass") passed++;
    else if (status === "flagged") flagged++;
    else pending++;
  }

  return { all_passed: flagged === 0 && pending === 0, passed, flagged, pending };
}
