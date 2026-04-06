import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { runPhase1Pipeline, Phase1PipelineError } from "../phases/phase1.js";
import { collections } from "../services/firestore.js";
import { FieldValue } from "firebase-admin/firestore";

export const phasesRouter = Router();

// ─── Phase 1 입력 스키마 ──────────────────────────────────────

const Phase1InputSchema = z.object({
  title: z.string().optional(),
  genre: z.string().min(1, "장르는 필수입니다"),
  concept: z.string().min(10, "핵심 아이디어는 10자 이상이어야 합니다"),
  target_audience: z.string().optional(),
});

// ─── Phase 1 실행 ─────────────────────────────────────────────

/**
 * POST /api/phases/:projectId/phase-1
 *
 * Body: { title?, genre, concept, target_audience? }
 * Response: Phase1FinalOutput + verdict + gating_passed
 */
phasesRouter.post(
  "/:projectId/phase-1",
  authMiddleware,
  validate(Phase1InputSchema),
  async (req, res) => {
    const { projectId } = req.params;

    // 프로젝트 소유권 확인
    const uid = (req as typeof req & { uid: string }).uid;
    const projectSnap = await collections.projects().doc(projectId).get();
    if (!projectSnap.exists) {
      res.status(404).json({ error: "프로젝트를 찾을 수 없습니다" });
      return;
    }
    if (projectSnap.data()?.owner_uid !== uid) {
      res.status(403).json({ error: "접근 권한이 없습니다" });
      return;
    }

    try {
      const result = await runPhase1Pipeline(projectId, req.body);

      res.json({
        success: true,
        data: result.output,
        verdict: result.verdict,
        gating_passed: result.gating_passed,
        message: buildVerdictMessage(result.verdict),
      });
    } catch (err) {
      if (err instanceof Phase1PipelineError) {
        console.error(`[Phase1] ${err.stage} 단계 실패:`, err.message, err.cause);
        res.status(500).json({
          error: "Phase 1 분석 중 오류가 발생했습니다",
          stage: err.stage,
          detail: err.message,
        });
        return;
      }
      console.error("[Phase1] 예상치 못한 오류:", err);
      res.status(500).json({ error: "서버 오류가 발생했습니다" });
    }
  }
);

// ─── Phase 1 GATING 확인 ──────────────────────────────────────

/**
 * POST /api/phases/:projectId/gate/1
 *
 * 사용자가 USP를 확인하고 "진행" 버튼을 클릭했을 때 호출.
 * GATING 조건(feasibility_score >= 0.5)을 재검증하고 Phase 2로 잠금 해제.
 */
phasesRouter.post("/:projectId/gate/1", authMiddleware, async (req, res) => {
  const { projectId } = req.params;
  const uid = (req as typeof req & { uid: string }).uid;

  const projectSnap = await collections.projects().doc(projectId).get();
  if (!projectSnap.exists) {
    res.status(404).json({ error: "프로젝트를 찾을 수 없습니다" });
    return;
  }
  const project = projectSnap.data()!;
  if (project.owner_uid !== uid) {
    res.status(403).json({ error: "접근 권한이 없습니다" });
    return;
  }

  const phase1Result = project.phase_results?.phase_1;
  if (!phase1Result) {
    res.status(400).json({ error: "Phase 1이 아직 완료되지 않았습니다" });
    return;
  }
  if (!phase1Result.gating_passed) {
    res.status(400).json({
      error: "GATING 조건 미충족",
      detail: `feasibility_score(${phase1Result.feasibility_score})가 0.5 미만입니다. 재기획 후 다시 시도해주세요.`,
    });
    return;
  }

  // Phase 2로 상태 전환
  await collections.projects().doc(projectId).update({
    status: "phase_2",
    current_phase: 2,
    updated_at: FieldValue.serverTimestamp(),
  });

  res.json({
    success: true,
    message: "Phase 1 GATING 통과. Phase 2 — 세계관 및 에셋 설계를 시작할 수 있습니다.",
    next_phase: 2,
  });
});

// ─── Phase 2~4 라우트 (추후 구현) ────────────────────────────

phasesRouter.post("/:projectId/phase-2", authMiddleware, async (_req, res) => {
  res.status(501).json({ message: "Phase 2 — 세계관 및 에셋 설계 (구현 예정)" });
});

phasesRouter.post("/:projectId/phase-3", authMiddleware, async (_req, res) => {
  res.status(501).json({ message: "Phase 3 — 100화 로드맵 (구현 예정)" });
});

phasesRouter.post("/:projectId/phase-4/:episode", authMiddleware, async (req, res) => {
  res.status(501).json({
    message: `Phase 4 — ${req.params.episode}화 대본 (구현 예정)`,
  });
});

// ─── 헬퍼 ─────────────────────────────────────────────────────

function buildVerdictMessage(verdict: "go" | "conditional" | "reject"): string {
  switch (verdict) {
    case "go":
      return "기획이 승인되었습니다. Phase 2로 진행 가능합니다.";
    case "conditional":
      return "조건부 진행 가능합니다. 에이전트 노트를 확인 후 Phase 2를 시작해주세요.";
    case "reject":
      return "재기획을 권고합니다. 아이디어를 수정 후 다시 시도해주세요.";
  }
}
