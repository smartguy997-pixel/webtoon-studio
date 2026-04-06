import { FieldValue } from "firebase-admin/firestore";
import { runScenarioAgent, type ScenarioInput } from "../agents/scenario.js";
import { runProducerPhase3, type Phase3FinalOutput } from "../agents/producer.js";
import {
  validatePhase3Output,
  type Phase3OutputValidated,
} from "../utils/json-validator.js";
import {
  validatePacingRules,
  checkEpisodeCoverage,
} from "../utils/pacing-validator.js";
import { saveSlidingWindowSummary } from "../utils/sliding-window.js";
import { collections, db } from "../services/firestore.js";

// ─── 입력 타입 ─────────────────────────────────────────────────

export interface Phase3Input {
  /** Phase 1 결과에서 */
  genre: string;
  usp: string[];
  /** Phase 2 결과에서 */
  worldDesignSummary: string;
  characters: Array<{ id: string; name: string; role: string }>;
  locations: Array<{ id: string; name: string }>;
  /** 연재 설정 */
  platform: string;
  episodesPerWeek: number;
}

// ─── 파이프라인 결과 ───────────────────────────────────────────

export interface Phase3Result {
  output: Phase3FinalOutput;
  gating: {
    condition1: boolean; // ep 1~100 전체 커버
    missing_episodes: number[];
    pacing_valid: boolean;
    pacing_errors: string[];
    pacing_warnings: string[];
  };
}

// ─── Phase 3 파이프라인 ────────────────────────────────────────

/**
 * Phase 3 100화 시리즈 로드맵 파이프라인
 *
 * 실행 순서:
 * 1. 시나리오 작가 — 25화씩 4배치로 100화 생성
 * 2. 총괄 프로듀서 — 완급 조절 검증 + 최종 정리
 * 3. Zod 스키마 검증
 * 4. 완급 규칙 검증 (pacing-validator)
 * 5. Firestore 분할 저장 (arc_structure + arcs + episodes)
 */
export async function runPhase3Pipeline(
  projectId: string,
  input: Phase3Input
): Promise<Phase3Result> {
  // ── Step 1: 시나리오 작가 (4배치) ───────────────────────────
  const scenarioInput: ScenarioInput = {
    genre: input.genre,
    usp: input.usp,
    worldDesignSummary: input.worldDesignSummary,
    characters: input.characters,
    locations: input.locations,
    platform: input.platform,
    episodesPerWeek: input.episodesPerWeek,
  };

  let scenarioMerged;
  try {
    scenarioMerged = await runScenarioAgent(scenarioInput, (batchNum, count) => {
      console.log(`[Phase3] 시나리오 배치 ${batchNum} 완료: ${count}화 생성`);
    });
  } catch (err) {
    throw new Phase3PipelineError("시나리오 작가 에이전트 실행 실패", "scenario", err);
  }

  // ── Step 2: 총괄 프로듀서 (완급 조절 검증 + 최종 정리) ───────
  let producerOutput;
  try {
    producerOutput = await runProducerPhase3(
      scenarioMerged,
      input.platform,
      input.episodesPerWeek
    );
  } catch (err) {
    throw new Phase3PipelineError("총괄 프로듀서 에이전트 실행 실패", "producer", err);
  }

  // ── Step 3: Zod 스키마 검증 ─────────────────────────────────
  const validation = validatePhase3Output(producerOutput);
  if (!validation.success) {
    throw new Phase3PipelineError(
      `Phase 3 출력 스키마 검증 실패: ${JSON.stringify(validation.error.flatten())}`,
      "validation",
      null
    );
  }

  const validated = validation.data;

  // ── Step 4: 완급 규칙 검증 ──────────────────────────────────
  const coverageCheck = checkEpisodeCoverage(validated.episodes);
  const pacingCheck = validatePacingRules(validated.episodes, validated.arcs);

  // ── Step 5: Firestore 분할 저장 ──────────────────────────────
  await savePhase3Roadmap(projectId, validated);

  return {
    output: producerOutput,
    gating: {
      condition1: coverageCheck.covered,
      missing_episodes: coverageCheck.missing,
      pacing_valid: pacingCheck.valid,
      pacing_errors: pacingCheck.errors,
      pacing_warnings: pacingCheck.warnings,
    },
  };
}

// ─── Firestore 저장 ───────────────────────────────────────────

/**
 * series_roadmap/{projectId}/ 아래에 분할 저장한다.
 *
 * 구조:
 *   series_roadmap/{projectId}               ← arc_structure, summary, pacing_plan
 *   series_roadmap/{projectId}/arcs/arc_NNN  ← 각 아크 문서
 *   series_roadmap/{projectId}/episodes/ep_NNN ← 각 에피소드 문서
 */
async function savePhase3Roadmap(
  projectId: string,
  output: Phase3OutputValidated
): Promise<void> {
  const roadmapRef = collections.seriesRoadmap(projectId);

  // Firestore는 배치당 500 ops 제한 → 에피소드 100개 + 아크 + 루트 doc은 작게 시작
  // 루트 문서 저장
  const batch1 = db.batch();
  batch1.set(roadmapRef, {
    phase: output.phase,
    summary: output.summary,
    arc_structure: output.arc_structure,
    pacing_plan: output.pacing_plan,
    agent_notes: output.agent_notes,
    episode_count: output.episodes.length,
    arc_count: output.arcs.length,
    gating_passed: false,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });

  // 아크 문서 저장
  for (const arc of output.arcs) {
    const arcRef = roadmapRef.collection("arcs").doc(arc.arc_id);
    batch1.set(arcRef, {
      ...arc,
      created_at: FieldValue.serverTimestamp(),
    });
  }

  await batch1.commit();

  // 에피소드 100개는 배치 분할 저장 (최대 100 ops/배치)
  const BATCH_SIZE = 100;
  for (let i = 0; i < output.episodes.length; i += BATCH_SIZE) {
    const epBatch = db.batch();
    const slice = output.episodes.slice(i, i + BATCH_SIZE);
    for (const ep of slice) {
      const epId = `ep_${String(ep.ep).padStart(3, "0")}`;
      const epRef = roadmapRef.collection("episodes").doc(epId);
      epBatch.set(epRef, {
        ...ep,
        created_at: FieldValue.serverTimestamp(),
      });
    }
    await epBatch.commit();
  }

  // 슬라이딩 윈도우 요약 저장
  await saveSlidingWindowSummary(projectId, 3, {
    key_decisions: [
      `총 에피소드: ${output.episodes.length}화`,
      `아크 수: ${output.arcs.length}개`,
      `반전 화: ${output.pacing_plan.twist_episodes.join(", ")}화`,
      `감정 피크: ${output.pacing_plan.peak_episodes.join(", ")}화`,
    ],
    roadmap_summary: output.summary,
    next_phase_ready: false,
  });

  // projects 문서에 Phase 3 메타 저장
  await collections.projects().doc(projectId).update({
    "phase_results.phase_3": {
      summary: output.summary,
      episode_count: output.episodes.length,
      arc_count: output.arcs.length,
      pacing_plan: output.pacing_plan,
      agent_notes: output.agent_notes,
      gating_passed: false,
      completed_at: FieldValue.serverTimestamp(),
    },
    updated_at: FieldValue.serverTimestamp(),
  });
}

// ─── GATING 통과 처리 ─────────────────────────────────────────

/**
 * Phase 3 GATING 통과 처리.
 * 사용자가 로드맵을 확인하고 대본 시작 화를 선택한 후 호출된다.
 */
export async function approvePhase3Roadmap(
  projectId: string,
  startEpisode: number
): Promise<void> {
  const batch = db.batch();

  // series_roadmap gating_passed 플래그
  const roadmapRef = collections.seriesRoadmap(projectId);
  batch.update(roadmapRef, {
    gating_passed: true,
    start_episode: startEpisode,
    approved_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });

  // projects 상태 → phase_4로 전환
  const projectRef = collections.projects().doc(projectId);
  batch.update(projectRef, {
    status: "phase_4",
    current_phase: 4,
    "phase_results.phase_3.gating_passed": true,
    "phase_results.phase_3.start_episode": startEpisode,
    "phase_results.phase_3.approved_at": FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });

  await batch.commit();
}

// ─── 에러 클래스 ───────────────────────────────────────────────

export class Phase3PipelineError extends Error {
  constructor(
    message: string,
    public readonly stage:
      | "scenario"
      | "producer"
      | "validation",
    public readonly cause: unknown
  ) {
    super(message);
    this.name = "Phase3PipelineError";
  }
}
