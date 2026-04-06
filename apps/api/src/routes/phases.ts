import { Router } from "express";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { authMiddleware } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { runPhase1Pipeline, Phase1PipelineError } from "../phases/phase1.js";
import {
  runPhase2Pipeline,
  selectDesignOption,
  approvePhase2Assets,
  Phase2PipelineError,
} from "../phases/phase2.js";
import {
  runPhase3Pipeline,
  approvePhase3Roadmap,
  Phase3PipelineError,
} from "../phases/phase3.js";
import { validatePhase2Output, checkPhase2GatingConditions } from "../utils/json-validator.js";
import { collections } from "../services/firestore.js";

export const phasesRouter = Router();

// ─── 공통 헬퍼 ────────────────────────────────────────────────

async function getProjectOrFail(
  projectId: string,
  uid: string,
  res: Parameters<Parameters<typeof phasesRouter.use>[0]>[1]
): Promise<ReturnType<typeof collections.projects>["firestore"] extends infer _ ? Record<string, unknown> | null : never> {
  const snap = await collections.projects().doc(projectId).get();
  if (!snap.exists) {
    res.status(404).json({ error: "프로젝트를 찾을 수 없습니다" });
    return null;
  }
  if (snap.data()?.owner_uid !== uid) {
    res.status(403).json({ error: "접근 권한이 없습니다" });
    return null;
  }
  return snap.data() as Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1
// ═══════════════════════════════════════════════════════════════

const Phase1InputSchema = z.object({
  title: z.string().optional(),
  genre: z.string().min(1, "장르는 필수입니다"),
  concept: z.string().min(10, "핵심 아이디어는 10자 이상이어야 합니다"),
  target_audience: z.string().optional(),
});

/**
 * POST /api/phases/:projectId/phase-1
 */
phasesRouter.post(
  "/:projectId/phase-1",
  authMiddleware,
  validate(Phase1InputSchema),
  async (req, res) => {
    const uid = (req as typeof req & { uid: string }).uid;
    const project = await getProjectOrFail(req.params.projectId, uid, res);
    if (!project) return;

    try {
      const result = await runPhase1Pipeline(req.params.projectId, req.body);
      res.json({
        success: true,
        data: result.output,
        verdict: result.verdict,
        gating_passed: result.gating_passed,
        message: buildPhase1VerdictMessage(result.verdict),
      });
    } catch (err) {
      if (err instanceof Phase1PipelineError) {
        console.error(`[Phase1] ${err.stage} 단계 실패:`, err.message);
        res.status(500).json({ error: "Phase 1 분석 중 오류", stage: err.stage });
        return;
      }
      console.error("[Phase1] 예상치 못한 오류:", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

/**
 * POST /api/phases/:projectId/gate/1
 * Phase 1 GATING 사용자 확인 → Phase 2로 전환
 */
phasesRouter.post("/:projectId/gate/1", authMiddleware, async (req, res) => {
  const uid = (req as typeof req & { uid: string }).uid;
  const project = await getProjectOrFail(req.params.projectId, uid, res);
  if (!project) return;

  const phase1Result = (project as Record<string, unknown> & { phase_results?: { phase_1?: { gating_passed?: boolean; feasibility_score?: number } } }).phase_results?.phase_1;
  if (!phase1Result) {
    res.status(400).json({ error: "Phase 1이 아직 완료되지 않았습니다" });
    return;
  }
  if (!phase1Result.gating_passed) {
    res.status(400).json({
      error: "GATING 조건 미충족",
      detail: `feasibility_score(${phase1Result.feasibility_score})가 0.5 미만입니다.`,
    });
    return;
  }

  await collections.projects().doc(req.params.projectId).update({
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

// ═══════════════════════════════════════════════════════════════
// PHASE 2
// ═══════════════════════════════════════════════════════════════

const Phase2InputSchema = z.object({
  world_hints: z.string().optional(),
  character_hints: z.string().optional(),
});

/**
 * POST /api/phases/:projectId/phase-2
 *
 * Phase 1 결과를 프로젝트에서 자동 로드하여 파이프라인 실행.
 * Body: { world_hints?, character_hints? }
 */
phasesRouter.post(
  "/:projectId/phase-2",
  authMiddleware,
  validate(Phase2InputSchema),
  async (req, res) => {
    const uid = (req as typeof req & { uid: string }).uid;
    const project = await getProjectOrFail(req.params.projectId, uid, res);
    if (!project) return;

    // Phase 1 결과 확인
    const phase1 = (project as Record<string, Record<string, unknown>>).phase_results?.phase_1 as {
      gating_passed?: boolean;
      genre?: string;
      usp?: string[];
      summary?: string;
    } | undefined;

    if (!phase1?.gating_passed) {
      res.status(400).json({ error: "Phase 1 GATING이 완료되지 않았습니다. /gate/1을 먼저 호출해주세요." });
      return;
    }

    const { world_hints, character_hints } = req.body as {
      world_hints?: string;
      character_hints?: string;
    };

    try {
      const result = await runPhase2Pipeline(req.params.projectId, {
        genre: phase1.genre ?? "",
        usp: phase1.usp ?? [],
        phase1Summary: phase1.summary ?? "",
        worldHints: world_hints,
        characterHints: character_hints,
      });

      res.json({
        success: true,
        data: result.output,
        gating: result.gating,
        message: buildPhase2GatingMessage(result.gating),
      });
    } catch (err) {
      if (err instanceof Phase2PipelineError) {
        console.error(`[Phase2] ${err.stage} 단계 실패:`, err.message);
        res.status(500).json({ error: "Phase 2 설계 중 오류", stage: err.stage });
        return;
      }
      console.error("[Phase2] 예상치 못한 오류:", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

/**
 * POST /api/phases/:projectId/design-select
 *
 * 사용자가 특정 에셋의 A/B 디자인을 선택.
 * Body: { target_id: string, selected: "A" | "B" }
 */
const DesignSelectSchema = z.object({
  target_id: z.string().min(1),
  selected: z.enum(["A", "B"]),
});

phasesRouter.post(
  "/:projectId/design-select",
  authMiddleware,
  validate(DesignSelectSchema),
  async (req, res) => {
    const uid = (req as typeof req & { uid: string }).uid;
    const project = await getProjectOrFail(req.params.projectId, uid, res);
    if (!project) return;

    const { target_id, selected } = req.body as { target_id: string; selected: "A" | "B" };

    try {
      const result = await selectDesignOption(req.params.projectId, target_id, selected);
      res.json({
        success: true,
        target_id,
        selected,
        all_selected: result.allSelected,
        unselected: result.unselected,
        message: result.allSelected
          ? "모든 에셋 선택 완료. /gate/2를 호출하여 Phase 3으로 진행할 수 있습니다."
          : `${result.unselected.length}개 에셋이 아직 선택되지 않았습니다: ${result.unselected.join(", ")}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      res.status(400).json({ error: msg });
    }
  }
);

/**
 * POST /api/phases/:projectId/gate/2
 *
 * Phase 2 GATING 최종 확인:
 * - 조건 1: ASSET_LIST 캐릭터 ≥ 1 + 배경 ≥ 1
 * - 조건 2: 모든 design_options 선택 완료
 * 통과 시 approved_assets 잠금 저장 + MST 초기화 + phase_3 전환
 */
phasesRouter.post("/:projectId/gate/2", authMiddleware, async (req, res) => {
  const uid = (req as typeof req & { uid: string }).uid;
  const project = await getProjectOrFail(req.params.projectId, uid, res);
  if (!project) return;

  const phase2Data = (project as Record<string, unknown> & {
    phase_results?: { phase_2?: unknown };
  }).phase_results?.phase_2;

  if (!phase2Data) {
    res.status(400).json({ error: "Phase 2가 아직 완료되지 않았습니다" });
    return;
  }

  // 최신 design_options 상태로 GATING 재검증
  const validation = validatePhase2Output(phase2Data);
  if (!validation.success) {
    res.status(400).json({
      error: "Phase 2 데이터 스키마 오류",
      details: validation.error.flatten(),
    });
    return;
  }

  const gating = checkPhase2GatingConditions(validation.data);

  if (!gating.condition1) {
    res.status(400).json({
      error: "GATING 조건 1 미충족",
      detail: "ASSET_LIST에 캐릭터 최소 1명, 배경 최소 1개가 필요합니다.",
    });
    return;
  }

  if (!gating.condition2) {
    res.status(400).json({
      error: "GATING 조건 2 미충족",
      detail: `아직 선택하지 않은 에셋이 있습니다: ${gating.unselected.join(", ")}`,
      unselected: gating.unselected,
    });
    return;
  }

  try {
    // approved_assets 잠금 저장 + MST 초기화 + phase_3 전환
    await approvePhase2Assets(req.params.projectId, validation.data);

    res.json({
      success: true,
      message:
        "Phase 2 GATING 통과. 에셋이 확정되었습니다. Phase 3 — 100화 시리즈 로드맵을 시작할 수 있습니다.",
      next_phase: 3,
      approved_characters: validation.data.asset_list.characters.map((c) => c.id),
      approved_locations: validation.data.asset_list.locations.map((l) => l.id),
    });
  } catch (err) {
    console.error("[gate/2] Firestore 저장 실패:", err);
    res.status(500).json({ error: "에셋 확정 저장 중 오류가 발생했습니다" });
  }
});

// ═══════════════════════════════════════════════════════════════
// PHASE 3
// ═══════════════════════════════════════════════════════════════

const Phase3InputSchema = z.object({
  platform: z.enum(["naver", "kakao", "lezhin", "other"]).default("naver"),
  episodes_per_week: z.number().int().min(1).max(7).default(1),
});

/**
 * POST /api/phases/:projectId/phase-3
 *
 * Phase 2 승인된 에셋을 자동 로드하여 100화 시리즈 로드맵을 생성한다.
 * Body: { platform?, episodes_per_week? }
 */
phasesRouter.post(
  "/:projectId/phase-3",
  authMiddleware,
  validate(Phase3InputSchema),
  async (req, res) => {
    const uid = (req as typeof req & { uid: string }).uid;
    const project = await getProjectOrFail(req.params.projectId, uid, res);
    if (!project) return;

    // Phase 2 GATING 완료 확인
    const phase2 = (project as Record<string, Record<string, unknown>>).phase_results
      ?.phase_2 as
      | {
          gating_passed?: boolean;
          world_design?: { physical_env?: { era?: string } };
          asset_list?: {
            characters?: Array<{ id: string; name: string; role: string }>;
            locations?: Array<{ id: string; name: string }>;
          };
        }
      | undefined;

    if (!phase2?.gating_passed) {
      res
        .status(400)
        .json({ error: "Phase 2 GATING이 완료되지 않았습니다. /gate/2를 먼저 호출해주세요." });
      return;
    }

    const phase1 = (project as Record<string, Record<string, unknown>>).phase_results
      ?.phase_1 as { genre?: string; usp?: string[]; summary?: string } | undefined;

    const { platform, episodes_per_week } = req.body as {
      platform: "naver" | "kakao" | "lezhin" | "other";
      episodes_per_week: number;
    };

    // 세계관 요약 구성
    const worldDesignSummary = phase2.world_design?.physical_env?.era
      ? `배경 시대: ${phase2.world_design.physical_env.era}`
      : "세계관 정보 없음";

    try {
      const result = await runPhase3Pipeline(req.params.projectId, {
        genre: phase1?.genre ?? "",
        usp: phase1?.usp ?? [],
        worldDesignSummary,
        characters: (phase2.asset_list?.characters ?? []) as Array<{
          id: string;
          name: string;
          role: string;
        }>,
        locations: (phase2.asset_list?.locations ?? []) as Array<{
          id: string;
          name: string;
        }>,
        platform,
        episodesPerWeek: episodes_per_week,
      });

      res.json({
        success: true,
        data: result.output,
        gating: result.gating,
        message: buildPhase3GatingMessage(result.gating),
      });
    } catch (err) {
      if (err instanceof Phase3PipelineError) {
        console.error(`[Phase3] ${err.stage} 단계 실패:`, err.message);
        res.status(500).json({ error: "Phase 3 로드맵 생성 중 오류", stage: err.stage });
        return;
      }
      console.error("[Phase3] 예상치 못한 오류:", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

/**
 * POST /api/phases/:projectId/gate/3
 *
 * Phase 3 GATING 최종 확인:
 * - 조건 1: ep 1~100 전체 커버 확인
 * - 조건 2: 사용자 확인 (이 API 호출 자체가 확인 의미)
 * Body: { start_episode?: number }  (기본값 1)
 */
const Gate3Schema = z.object({
  start_episode: z.number().int().min(1).max(100).default(1),
});

phasesRouter.post("/:projectId/gate/3", authMiddleware, validate(Gate3Schema), async (req, res) => {
  const uid = (req as typeof req & { uid: string }).uid;
  const project = await getProjectOrFail(req.params.projectId, uid, res);
  if (!project) return;

  const phase3 = (project as Record<string, Record<string, unknown>>).phase_results
    ?.phase_3 as { gating_passed?: boolean; episode_count?: number } | undefined;

  if (!phase3) {
    res.status(400).json({ error: "Phase 3이 아직 완료되지 않았습니다" });
    return;
  }
  if (phase3.episode_count !== 100) {
    res.status(400).json({
      error: "GATING 조건 미충족",
      detail: `에피소드 수(${phase3.episode_count ?? 0})가 100화가 아닙니다.`,
    });
    return;
  }

  const { start_episode } = req.body as { start_episode: number };

  try {
    await approvePhase3Roadmap(req.params.projectId, start_episode);

    res.json({
      success: true,
      message: `Phase 3 GATING 통과. ${start_episode}화부터 대본 작성을 시작합니다.`,
      next_phase: 4,
      start_episode,
    });
  } catch (err) {
    console.error("[gate/3] Firestore 저장 실패:", err);
    res.status(500).json({ error: "로드맵 확정 저장 중 오류가 발생했습니다" });
  }
});

// ═══════════════════════════════════════════════════════════════
// PHASE 4 (추후 구현)
// ═══════════════════════════════════════════════════════════════

phasesRouter.post("/:projectId/phase-4/:episode", authMiddleware, async (req, res) => {
  res.status(501).json({ message: `Phase 4 — ${req.params.episode}화 대본 (구현 예정)` });
});

// ─── 헬퍼 함수 ────────────────────────────────────────────────

function buildPhase1VerdictMessage(verdict: "go" | "conditional" | "reject"): string {
  switch (verdict) {
    case "go":
      return "기획이 승인되었습니다. Phase 2로 진행 가능합니다.";
    case "conditional":
      return "조건부 진행 가능합니다. 에이전트 노트를 확인 후 Phase 2를 시작해주세요.";
    case "reject":
      return "재기획을 권고합니다. 아이디어를 수정 후 다시 시도해주세요.";
  }
}

function buildPhase2GatingMessage(gating: {
  condition1: boolean;
  condition2: boolean;
  unselected: string[];
}): string {
  if (gating.condition1 && gating.condition2) {
    return "세계관과 에셋 설계가 완료되었습니다. /gate/2를 호출하여 Phase 3으로 진행하세요.";
  }
  if (!gating.condition1) {
    return "ASSET_LIST가 최소 기준을 충족하지 않습니다. 에이전트를 다시 실행해주세요.";
  }
  return `${gating.unselected.length}개 에셋의 A/B 선택이 필요합니다: ${gating.unselected.join(", ")}`;
}

function buildPhase3GatingMessage(gating: {
  condition1: boolean;
  missing_episodes: number[];
  pacing_valid: boolean;
  pacing_errors: string[];
  pacing_warnings: string[];
}): string {
  if (!gating.condition1) {
    return `누락된 에피소드가 있습니다: ${gating.missing_episodes.join(", ")}화. Phase 3을 다시 실행해주세요.`;
  }
  if (!gating.pacing_valid) {
    return `완급 조절 규칙 위반이 있습니다: ${gating.pacing_errors.join(" | ")}. /gate/3을 호출하여 계속 진행하거나 Phase 3을 다시 실행해주세요.`;
  }
  const warnMsg =
    gating.pacing_warnings.length > 0
      ? ` (경고 ${gating.pacing_warnings.length}건 있음)`
      : "";
  return `100화 로드맵이 완성되었습니다${warnMsg}. 로드맵을 확인하고 /gate/3을 호출하여 대본 작성을 시작하세요.`;
}
