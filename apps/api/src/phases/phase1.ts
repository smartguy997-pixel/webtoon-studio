import { FieldValue } from "firebase-admin/firestore";
import { runStrategistAgent, type StrategistInput } from "../agents/strategist.js";
import { runResearcherAgent } from "../agents/researcher.js";
import { runProducerPhase1, getFeasibilityVerdict, type Phase1FinalOutput } from "../agents/producer.js";
import { validatePhase1Output } from "../utils/json-validator.js";
import { saveSlidingWindowSummary } from "../utils/sliding-window.js";
import { collections } from "../services/firestore.js";

// ─── 입력 타입 ─────────────────────────────────────────────────

export interface Phase1Input {
  title?: string;
  genre: string;
  concept: string;
  target_audience?: string;
}

// ─── 파이프라인 결과 ───────────────────────────────────────────

export interface Phase1Result {
  output: Phase1FinalOutput;
  verdict: "go" | "conditional" | "reject";
  gating_passed: boolean; // feasibility_score >= 0.5
}

// ─── Phase 1 파이프라인 ────────────────────────────────────────

/**
 * Phase 1 기획 분석 파이프라인
 *
 * 실행 순서: 전략 기획자 → 심층 조사자 → 총괄 프로듀서
 * 결과를 검증하고 Firestore에 저장한다.
 */
export async function runPhase1Pipeline(
  projectId: string,
  input: Phase1Input
): Promise<Phase1Result> {
  const strategistInput: StrategistInput = {
    title: input.title,
    genre: input.genre,
    concept: input.concept,
    target_audience: input.target_audience,
  };

  // ── Step 1: 전략 기획자 ──────────────────────────────────────
  let strategistOutput;
  try {
    strategistOutput = await runStrategistAgent(strategistInput);
  } catch (err) {
    throw new Phase1PipelineError("전략 기획자 에이전트 실행 실패", "strategist", err);
  }

  // ── Step 2: 심층 조사자 ──────────────────────────────────────
  let researcherOutput;
  try {
    researcherOutput = await runResearcherAgent(
      { genre: input.genre, concept: input.concept },
      strategistOutput
    );
  } catch (err) {
    throw new Phase1PipelineError("심층 조사자 에이전트 실행 실패", "researcher", err);
  }

  // ── Step 3: 총괄 프로듀서 ────────────────────────────────────
  let producerOutput;
  try {
    producerOutput = await runProducerPhase1(input, strategistOutput, researcherOutput);
  } catch (err) {
    throw new Phase1PipelineError("총괄 프로듀서 에이전트 실행 실패", "producer", err);
  }

  // ── Step 4: 출력 유효성 검증 ─────────────────────────────────
  const validation = validatePhase1Output(producerOutput);
  if (!validation.success) {
    throw new Phase1PipelineError(
      `Phase 1 출력 스키마 검증 실패: ${JSON.stringify(validation.error.flatten())}`,
      "validation",
      null
    );
  }

  const validated = validation.data;
  const verdict = getFeasibilityVerdict(validated.feasibility_score);
  const gating_passed = validated.feasibility_score >= 0.5;

  // ── Step 5: Firestore 저장 ────────────────────────────────────
  await savePhase1Result(projectId, validated, gating_passed);

  return { output: producerOutput, verdict, gating_passed };
}

// ─── Firestore 저장 ────────────────────────────────────────────

async function savePhase1Result(
  projectId: string,
  output: Phase1FinalOutput,
  gatingPassed: boolean
): Promise<void> {
  const batch = collections.projects().firestore.batch();

  // 1. project_summary 에 슬라이딩 윈도우 요약 저장
  await saveSlidingWindowSummary(projectId, 1, {
    genre: output.market_analysis.genre,
    usp: output.usp,
    feasibility_score: output.feasibility_score,
    key_decisions: [
      `장르: ${output.market_analysis.genre}`,
      `포지셔닝: ${output.market_analysis.positioning}`,
      `실현가능성: ${output.feasibility_score.toFixed(2)}`,
    ],
    next_phase_ready: gatingPassed,
  });

  // 2. projects 문서 상태 업데이트
  const projectRef = collections.projects().doc(projectId);
  batch.update(projectRef, {
    "phase_results.phase_1": {
      summary: output.summary,
      feasibility_score: output.feasibility_score,
      usp: output.usp,
      genre: output.market_analysis.genre,
      gating_passed: gatingPassed,
      completed_at: FieldValue.serverTimestamp(),
    },
    updated_at: FieldValue.serverTimestamp(),
    ...(gatingPassed ? {} : {}), // GATING 통과 여부는 사용자 확인 후 phase 전환
  });

  await batch.commit();
}

// ─── 에러 클래스 ───────────────────────────────────────────────

export class Phase1PipelineError extends Error {
  constructor(
    message: string,
    public readonly stage: "strategist" | "researcher" | "producer" | "validation",
    public readonly cause: unknown
  ) {
    super(message);
    this.name = "Phase1PipelineError";
  }
}
