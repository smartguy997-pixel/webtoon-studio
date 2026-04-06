import { FieldValue } from "firebase-admin/firestore";
import { runScriptAgent, detectChapterStyle, type ScriptWriterInput } from "../agents/script.js";
import { runProducerPhase4, type Phase4FinalOutput } from "../agents/producer.js";
import {
  validatePhase4Output,
  type Phase4OutputValidated,
} from "../utils/json-validator.js";
import { triggerSccBatch, getSccStatus, type SccBatchResult } from "../utils/scc-hook.js";
import { saveSlidingWindowSummary } from "../utils/sliding-window.js";
import { collections, db } from "../services/firestore.js";
import type { Episode } from "../agents/scenario.js";

// ─── 타입 ─────────────────────────────────────────────────────

export interface Phase4Input {
  episodeNum: number;
  /** SCC 이미지 생성까지 실행할지 여부 (기본 true) */
  triggerScc?: boolean;
}

export interface Phase4Result {
  output: Phase4FinalOutput;
  scc: SccBatchResult | null; // triggerScc=false면 null
  gating: {
    condition1: boolean; // script_data 30컷 확인
    condition2: boolean; // SCC 전체 통과 (triggerScc=true일 때만 평가)
    condition3: boolean; // 사용자 확인 대기 중 (항상 false — gate/4 호출 시 true)
  };
}

// ─── 에피소드 데이터 로드 ──────────────────────────────────────

async function loadEpisodeFromRoadmap(
  projectId: string,
  epNum: number
): Promise<Episode> {
  const epId = `ep_${String(epNum).padStart(3, "0")}`;
  const doc = await collections.seriesRoadmap(projectId).collection("episodes").doc(epId).get();
  if (!doc.exists) {
    throw new Phase4PipelineError(
      `시리즈 로드맵에 ${epNum}화 데이터가 없습니다`,
      "load_episode",
      null
    );
  }
  return doc.data() as Episode;
}

async function loadApprovedCharacters(
  projectId: string
): Promise<Array<{ id: string; name: string; role: string; appearance: { face: string; body: string; hair: string; outfit: string; distinguishing_features: string } }>> {
  const snap = await collections.approvedAssets(projectId).collection("characters").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ReturnType<typeof loadApprovedCharacters> extends Promise<Array<infer T>> ? T : never));
}

async function loadApprovedLocations(
  projectId: string
): Promise<Array<{ id: string; name: string; type: string; atmosphere: string }>> {
  const snap = await collections.approvedAssets(projectId).collection("locations").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ReturnType<typeof loadApprovedLocations> extends Promise<Array<infer T>> ? T : never));
}

async function loadPreviousSummary(
  projectId: string,
  epNum: number
): Promise<string | null> {
  if (epNum <= 1) return null;
  const prevEpId = `ep_${String(epNum - 1).padStart(3, "0")}`;
  const doc = await collections
    .scripts(projectId)
    .collection("episodes")
    .doc(prevEpId)
    .get();
  return (doc.data()?.episode_summary_for_next as string | undefined) ?? null;
}

// ─── Firestore 저장 ───────────────────────────────────────────

async function saveScript(
  projectId: string,
  output: Phase4OutputValidated
): Promise<void> {
  const epId = `ep_${String(output.episode).padStart(3, "0")}`;
  const epRef = collections.scripts(projectId).collection("episodes").doc(epId);

  // 에피소드 메타 문서
  const batch1 = db.batch();
  batch1.set(epRef, {
    phase: output.phase,
    episode: output.episode,
    episode_title: output.episode_title,
    chapter_style: output.chapter_style,
    assets_used: output.assets_used,
    agent_notes: output.agent_notes,
    episode_summary_for_next: output.episode_summary_for_next,
    scc_status: "pending",
    scc_passed_cuts: 0,
    scc_flagged_cuts: 0,
    approved: false,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  await batch1.commit();

  // 컷 문서 저장 (30개) — 배치로 한 번에
  const cutBatch = db.batch();
  for (const cut of output.script_data) {
    const cutId = `cut_${String(cut.cut).padStart(2, "0")}`;
    const cutRef = epRef.collection("cuts").doc(cutId);
    cutBatch.set(cutRef, {
      ...cut,
      scc_status: "pending",
      scc_image_id: null,
      scc_attempts: 0,
      scc_scores: null,
      created_at: FieldValue.serverTimestamp(),
    });
  }
  await cutBatch.commit();
}

// ─── Phase 4 파이프라인 ────────────────────────────────────────

/**
 * Phase 4 30컷 대본 파이프라인
 *
 * 실행 순서:
 * 1. series_roadmap에서 에피소드 데이터 로드
 * 2. approved_assets에서 승인된 에셋 로드
 * 3. 이전 화 episode_summary_for_next 로드
 * 4. 대본/연출 작가 에이전트 실행
 * 5. 총괄 프로듀서 에이전트 검토
 * 6. Zod 스키마 검증 (30컷 확인)
 * 7. Firestore 저장 (metadata + cuts 서브컬렉션)
 * 8. SCC 배치 실행 (triggerScc=true인 경우)
 * 9. 슬라이딩 윈도우 (10화 단위)
 */
export async function runPhase4Pipeline(
  projectId: string,
  input: Phase4Input
): Promise<Phase4Result> {
  const { episodeNum, triggerScc = true } = input;

  // ── Step 1~3: 데이터 로드 ────────────────────────────────────
  let episodeData: Episode;
  let characters: Awaited<ReturnType<typeof loadApprovedCharacters>>;
  let locations: Awaited<ReturnType<typeof loadApprovedLocations>>;
  let previousSummary: string | null;

  try {
    [episodeData, characters, locations, previousSummary] = await Promise.all([
      loadEpisodeFromRoadmap(projectId, episodeNum),
      loadApprovedCharacters(projectId),
      loadApprovedLocations(projectId),
      loadPreviousSummary(projectId, episodeNum),
    ]);
  } catch (err) {
    if (err instanceof Phase4PipelineError) throw err;
    throw new Phase4PipelineError("데이터 로드 실패", "load_episode", err);
  }

  // ── Step 4: 대본/연출 작가 ──────────────────────────────────
  const scriptInput: ScriptWriterInput = {
    targetEpisode: episodeNum,
    episodeTitle: episodeData.title,
    episodeSummary: episodeData.summary,
    episodeType: episodeData.episode_type,
    cliffhanger: episodeData.cliffhanger,
    featuredCharacterIds: episodeData.featured_characters,
    featuredLocationIds: episodeData.featured_locations,
    characters: characters
      .filter((c) => episodeData.featured_characters.includes(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        appearance: c.appearance,
      })),
    locations: locations
      .filter((l) => episodeData.featured_locations.includes(l.id))
      .map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        atmosphere: l.atmosphere,
      })),
    previousSummary,
  };

  let scriptDraft;
  try {
    scriptDraft = await runScriptAgent(scriptInput);
  } catch (err) {
    throw new Phase4PipelineError("대본 작가 에이전트 실행 실패", "script_writer", err);
  }

  // chapter_style 폴백: 에이전트가 누락하면 자동 결정
  if (!scriptDraft.chapter_style) {
    scriptDraft.chapter_style = detectChapterStyle(episodeData.episode_type, episodeData.summary);
  }

  // ── Step 5: 총괄 프로듀서 ────────────────────────────────────
  let producerOutput;
  try {
    producerOutput = await runProducerPhase4(
      scriptDraft,
      episodeData.episode_type,
      episodeData.cliffhanger
    );
  } catch (err) {
    throw new Phase4PipelineError("총괄 프로듀서 에이전트 실행 실패", "producer", err);
  }

  // ── Step 6: Zod 스키마 검증 ─────────────────────────────────
  const validation = validatePhase4Output(producerOutput);
  if (!validation.success) {
    throw new Phase4PipelineError(
      `Phase 4 출력 스키마 검증 실패: ${JSON.stringify(validation.error.flatten())}`,
      "validation",
      null
    );
  }
  const validated = validation.data;

  // ── Step 7: Firestore 저장 ────────────────────────────────────
  await saveScript(projectId, validated);

  // ── Step 8: SCC 배치 실행 ────────────────────────────────────
  let sccResult: SccBatchResult | null = null;
  if (triggerScc) {
    try {
      sccResult = await triggerSccBatch(
        projectId,
        episodeNum,
        validated.script_data,
        validated.chapter_style
      );
    } catch (err) {
      // SCC 실패는 치명적 오류가 아님 — 로그 후 계속
      console.error(`[Phase4] ep${episodeNum} SCC 배치 실행 중 오류:`, err);
    }
  }

  // ── Step 9: 슬라이딩 윈도우 (10화 단위) ─────────────────────
  if (episodeNum % 10 === 0) {
    await saveSlidingWindowSummary(projectId, 4, {
      key_decisions: [
        `${episodeNum}화까지 대본 완성`,
        `${episodeNum}화 chapter_style: ${validated.chapter_style}`,
      ],
      latest_summary: validated.episode_summary_for_next,
      episode_progress: `${episodeNum}/100`,
    });
  }

  return {
    output: producerOutput,
    scc: sccResult,
    gating: {
      condition1: validated.script_data.length === 30,
      condition2: sccResult?.all_passed ?? false,
      condition3: false, // 사용자가 gate/4 호출 시 true
    },
  };
}

// ─── GATING 통과 처리 ─────────────────────────────────────────

/**
 * Phase 4 화별 GATING 통과 처리.
 * 조건 1(30컷), 조건 2(SCC), 조건 3(사용자 확인) 모두 충족 시 호출.
 */
export async function approveEpisodeScript(
  projectId: string,
  epNum: number
): Promise<void> {
  const epId = `ep_${String(epNum).padStart(3, "0")}`;
  const batch = db.batch();

  // 스크립트 에피소드 승인
  const epRef = collections.scripts(projectId).collection("episodes").doc(epId);
  batch.update(epRef, {
    approved: true,
    approved_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });

  // 프로젝트 진행 화수 업데이트
  const projectRef = collections.projects().doc(projectId);
  batch.update(projectRef, {
    [`phase_results.phase_4.latest_approved_episode`]: epNum,
    [`phase_results.phase_4.episodes_completed`]: FieldValue.increment(1),
    updated_at: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  // 100화 완료 시 프로젝트 완료 처리
  if (epNum >= 100) {
    await collections.projects().doc(projectId).update({
      status: "completed",
      completed_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    console.log(`[Phase4] 프로젝트 ${projectId} — 100화 전체 완성! 🎉`);
  }
}

// ─── 에러 클래스 ───────────────────────────────────────────────

export class Phase4PipelineError extends Error {
  constructor(
    message: string,
    public readonly stage:
      | "load_episode"
      | "script_writer"
      | "producer"
      | "validation",
    public readonly cause: unknown
  ) {
    super(message);
    this.name = "Phase4PipelineError";
  }
}
