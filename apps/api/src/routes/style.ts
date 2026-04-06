import { Router, type Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  getMst,
  updateMst,
  initChapterOverlays,
  type MstPatch,
} from "../services/mst.js";
import {
  generateCharacterSheet,
  generateBackgroundSheet,
  initializeAllAssetSheets,
  getCharacterSheet,
  getBackgroundSheet,
} from "../services/asset-sheet.js";
import {
  getSCCLog,
  getEpisodeSCCLogs,
} from "../services/scc.js";
import { collections } from "../services/firestore.js";

export const styleRouter = Router();

// ─── 공통 헬퍼 ────────────────────────────────────────────────

async function getProjectOrFail(
  projectId: string,
  uid: string,
  res: Response
): Promise<boolean> {
  const snap = await collections.projects().doc(projectId).get();
  if (!snap.exists) {
    res.status(404).json({ error: "프로젝트를 찾을 수 없습니다" });
    return false;
  }
  if (snap.data()?.owner_uid !== uid) {
    res.status(403).json({ error: "접근 권한이 없습니다" });
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════
// MST (마스터 스타일 토큰)
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/style/:projectId/mst
 * 현재 MST를 조회한다 (읽기 전용 뷰).
 */
styleRouter.get("/:projectId/mst", authMiddleware, async (req, res) => {
  const uid = (req as typeof req & { uid: string }).uid;
  if (!(await getProjectOrFail(req.params.projectId, uid, res))) return;

  try {
    const mst = await getMst(req.params.projectId);
    res.json({ success: true, mst });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "서버 오류";
    res.status(404).json({ error: msg });
  }
});

/**
 * PATCH /api/style/:projectId/mst
 * MST를 업데이트한다.
 * - 현재 버전 revision_history 보존
 * - version +1 적용
 * - 이후 생성 컷부터 새 MST 적용 (소급 없음)
 *
 * Body: 변경할 필드만 포함 (부분 업데이트)
 */
const MstPatchSchema = z.object({
  art_style:       z.string().min(1).optional(),
  line_weight:     z.string().min(1).optional(),
  color_palette:   z.string().min(1).optional(),
  rendering:       z.string().min(1).optional(),
  perspective:     z.string().min(1).optional(),
  negative_prompt: z.string().min(1).optional(),
});

styleRouter.patch(
  "/:projectId/mst",
  authMiddleware,
  validate(MstPatchSchema),
  async (req, res) => {
    const uid = (req as typeof req & { uid: string }).uid;
    if (!(await getProjectOrFail(req.params.projectId, uid, res))) return;

    const patch = req.body as MstPatch;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "변경할 필드가 없습니다" });
      return;
    }

    try {
      const updated = await updateMst(req.params.projectId, patch, uid);
      res.json({
        success: true,
        mst: updated,
        message: `MST가 v${updated.version}으로 업데이트되었습니다. 이후 생성 컷부터 새 MST가 적용됩니다.`,
        warning: "이미 생성된 컷에는 소급 적용되지 않습니다.",
      });
    } catch (err) {
      console.error("[MST] 업데이트 실패:", err);
      res.status(500).json({ error: "MST 업데이트 중 오류가 발생했습니다" });
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// 에셋 시트
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/style/:projectId/generate-sheets
 * 모든 승인된 에셋의 시트를 생성한다.
 * Phase 2 GATING 통과 직후 자동 호출되지만, 수동 재실행도 가능.
 */
styleRouter.post("/:projectId/generate-sheets", authMiddleware, async (req, res) => {
  const uid = (req as typeof req & { uid: string }).uid;
  if (!(await getProjectOrFail(req.params.projectId, uid, res))) return;

  // 비동기 실행 후 즉시 202 응답 (시간이 오래 걸림)
  res.status(202).json({
    success: true,
    message: "에셋 시트 생성을 시작했습니다. 완료까지 수 분이 소요될 수 있습니다.",
  });

  // 백그라운드 실행
  initializeAllAssetSheets(req.params.projectId)
    .then((result) => {
      console.log(
        `[Style] ${req.params.projectId} 에셋 시트 생성 완료: ` +
          `캐릭터 ${result.characters.length}개, 배경 ${result.locations.length}개` +
          (result.errors.length > 0 ? `, 오류 ${result.errors.length}건` : "")
      );
    })
    .catch((err) => {
      console.error(`[Style] ${req.params.projectId} 에셋 시트 생성 오류:`, err);
    });
});

/**
 * POST /api/style/:projectId/generate-sheets/:assetType/:assetId
 * 특정 에셋의 시트만 재생성한다.
 * assetType: "characters" | "locations"
 */
styleRouter.post(
  "/:projectId/generate-sheets/:assetType/:assetId",
  authMiddleware,
  async (req, res) => {
    const uid = (req as typeof req & { uid: string }).uid;
    if (!(await getProjectOrFail(req.params.projectId, uid, res))) return;

    const { assetType, assetId } = req.params;
    const { projectId } = req.params;

    if (assetType !== "characters" && assetType !== "locations") {
      res.status(400).json({ error: "assetType은 'characters' 또는 'locations'여야 합니다" });
      return;
    }

    const assetSnap = await collections
      .approvedAssets(projectId)
      .collection(assetType)
      .doc(assetId)
      .get();

    if (!assetSnap.exists) {
      res.status(404).json({ error: `${assetId}를 찾을 수 없습니다` });
      return;
    }

    res.status(202).json({
      success: true,
      message: `${assetId} 시트 재생성을 시작했습니다.`,
    });

    const data = assetSnap.data()!;

    if (assetType === "characters") {
      generateCharacterSheet(projectId, assetId, data as Parameters<typeof generateCharacterSheet>[2])
        .then(() => console.log(`[Style] ${assetId} 캐릭터 시트 재생성 완료`))
        .catch((err) => console.error(`[Style] ${assetId} 캐릭터 시트 재생성 실패:`, err));
    } else {
      generateBackgroundSheet(projectId, assetId, data as Parameters<typeof generateBackgroundSheet>[2])
        .then(() => console.log(`[Style] ${assetId} 배경 시트 재생성 완료`))
        .catch((err) => console.error(`[Style] ${assetId} 배경 시트 재생성 실패:`, err));
    }
  }
);

/**
 * GET /api/style/:projectId/character-sheets/:charId
 * 캐릭터 시트를 조회한다.
 */
styleRouter.get(
  "/:projectId/character-sheets/:charId",
  authMiddleware,
  async (req, res) => {
    const uid = (req as typeof req & { uid: string }).uid;
    if (!(await getProjectOrFail(req.params.projectId, uid, res))) return;

    const sheet = await getCharacterSheet(req.params.projectId, req.params.charId);
    if (!sheet) {
      res.status(404).json({ error: "캐릭터 시트가 아직 생성되지 않았습니다" });
      return;
    }
    res.json({ success: true, sheet });
  }
);

/**
 * GET /api/style/:projectId/character-sheets
 * 전체 캐릭터 시트 목록을 조회한다.
 */
styleRouter.get("/:projectId/character-sheets", authMiddleware, async (req, res) => {
  const uid = (req as typeof req & { uid: string }).uid;
  if (!(await getProjectOrFail(req.params.projectId, uid, res))) return;

  const snap = await collections
    .styleRegistry(req.params.projectId)
    .collection("character_sheets")
    .get();

  res.json({
    success: true,
    sheets: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
  });
});

/**
 * GET /api/style/:projectId/background-sheets/:locId
 * 배경 시트를 조회한다.
 */
styleRouter.get(
  "/:projectId/background-sheets/:locId",
  authMiddleware,
  async (req, res) => {
    const uid = (req as typeof req & { uid: string }).uid;
    if (!(await getProjectOrFail(req.params.projectId, uid, res))) return;

    const sheet = await getBackgroundSheet(req.params.projectId, req.params.locId);
    if (!sheet) {
      res.status(404).json({ error: "배경 시트가 아직 생성되지 않았습니다" });
      return;
    }
    res.json({ success: true, sheet });
  }
);

/**
 * GET /api/style/:projectId/background-sheets
 * 전체 배경 시트 목록을 조회한다.
 */
styleRouter.get("/:projectId/background-sheets", authMiddleware, async (req, res) => {
  const uid = (req as typeof req & { uid: string }).uid;
  if (!(await getProjectOrFail(req.params.projectId, uid, res))) return;

  const snap = await collections
    .styleRegistry(req.params.projectId)
    .collection("background_sheets")
    .get();

  res.json({
    success: true,
    sheets: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
  });
});

// ═══════════════════════════════════════════════════════════════
// SCC 검증 로그
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/style/:projectId/validation-log/:episode
 * 특정 화의 모든 컷 SCC 로그를 조회한다.
 */
styleRouter.get(
  "/:projectId/validation-log/:episode",
  authMiddleware,
  async (req, res) => {
    const uid = (req as typeof req & { uid: string }).uid;
    if (!(await getProjectOrFail(req.params.projectId, uid, res))) return;

    const epNum = parseInt(req.params.episode, 10);
    if (isNaN(epNum) || epNum < 1 || epNum > 100) {
      res.status(400).json({ error: "episode는 1~100 사이의 정수여야 합니다" });
      return;
    }

    const logs = await getEpisodeSCCLogs(req.params.projectId, epNum);
    const passedCount = logs.filter((l) => l.final_status === "pass").length;
    const flaggedCount = logs.filter((l) => l.final_status === "flagged").length;

    res.json({
      success: true,
      episode: epNum,
      total_cuts: logs.length,
      passed: passedCount,
      flagged: flaggedCount,
      all_passed: flaggedCount === 0 && logs.length > 0,
      logs,
    });
  }
);

/**
 * GET /api/style/:projectId/validation-log/:episode/:cut
 * 특정 컷의 SCC 로그를 조회한다.
 */
styleRouter.get(
  "/:projectId/validation-log/:episode/:cut",
  authMiddleware,
  async (req, res) => {
    const uid = (req as typeof req & { uid: string }).uid;
    if (!(await getProjectOrFail(req.params.projectId, uid, res))) return;

    const epNum = parseInt(req.params.episode, 10);
    const cutNum = parseInt(req.params.cut, 10);

    if (isNaN(epNum) || isNaN(cutNum)) {
      res.status(400).json({ error: "episode, cut은 정수여야 합니다" });
      return;
    }

    const log = await getSCCLog(req.params.projectId, epNum, cutNum);
    if (!log) {
      res.status(404).json({ error: `ep${epNum} cut${cutNum} SCC 로그가 없습니다` });
      return;
    }

    res.json({ success: true, log });
  }
);

/**
 * GET /api/style/:projectId/validation-log
 * 프로젝트 전체 SCC 로그 요약 (화별 통계)를 조회한다.
 */
styleRouter.get("/:projectId/validation-log", authMiddleware, async (req, res) => {
  const uid = (req as typeof req & { uid: string }).uid;
  if (!(await getProjectOrFail(req.params.projectId, uid, res))) return;

  const snap = await collections
    .styleRegistry(req.params.projectId)
    .collection("validation_log")
    .orderBy("episode")
    .orderBy("cut")
    .get();

  // 화별 집계
  const byEpisode: Record<number, { passed: number; flagged: number }> = {};
  for (const doc of snap.docs) {
    const data = doc.data();
    const ep = data.episode as number;
    if (!byEpisode[ep]) byEpisode[ep] = { passed: 0, flagged: 0 };
    if (data.final_status === "pass") byEpisode[ep].passed++;
    else byEpisode[ep].flagged++;
  }

  const totalPassed = snap.docs.filter((d) => d.data().final_status === "pass").length;
  const totalFlagged = snap.docs.filter((d) => d.data().final_status === "flagged").length;

  res.json({
    success: true,
    total_cuts: snap.size,
    total_passed: totalPassed,
    total_flagged: totalFlagged,
    by_episode: byEpisode,
  });
});
