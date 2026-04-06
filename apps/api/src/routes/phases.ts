import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";

export const phasesRouter = Router();

// Phase 1 실행
phasesRouter.post("/:projectId/phase-1", authMiddleware, async (req, res) => {
  // TODO: Phase 1 에이전트 파이프라인 (strategist → researcher → producer) 구현
  res.json({ message: "Phase 1 — 기획 분석 시작" });
});

// Phase 2 실행
phasesRouter.post("/:projectId/phase-2", authMiddleware, async (req, res) => {
  // TODO: Phase 2 에이전트 파이프라인 (worldbuilder → researcher → character → producer) 구현
  res.json({ message: "Phase 2 — 세계관 및 에셋 설계 시작" });
});

// Phase 3 실행
phasesRouter.post("/:projectId/phase-3", authMiddleware, async (req, res) => {
  // TODO: Phase 3 에이전트 파이프라인 (scenario → producer) 구현 (25화씩 4배치)
  res.json({ message: "Phase 3 — 100화 로드맵 생성 시작" });
});

// Phase 4 실행 (화별)
phasesRouter.post("/:projectId/phase-4/:episode", authMiddleware, async (req, res) => {
  const episode = parseInt(req.params.episode, 10);
  // TODO: Phase 4 에이전트 파이프라인 (script → producer → SCC) 구현
  res.json({ message: `Phase 4 — ${episode}화 대본 생성 시작` });
});

// Phase GATING 승인
phasesRouter.post("/:projectId/gate/:phase", authMiddleware, async (req, res) => {
  const phase = parseInt(req.params.phase, 10);
  // TODO: GATING 조건 검사 및 다음 Phase 잠금 해제
  res.json({ message: `Phase ${phase} GATING 통과`, next_phase: phase + 1 });
});
