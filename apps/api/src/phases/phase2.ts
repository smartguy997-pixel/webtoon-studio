import { FieldValue } from "firebase-admin/firestore";
import { runWorldbuilderAgent, type WorldbuilderInput } from "../agents/worldbuilder.js";
import { runResearcherPhase2Agent } from "../agents/researcher.js";
import { runCharacterAgent } from "../agents/character.js";
import { runProducerPhase2, type Phase2FinalOutput } from "../agents/producer.js";
import {
  validatePhase2Output,
  checkPhase2GatingConditions,
  type Phase2OutputValidated,
} from "../utils/json-validator.js";
import { saveSlidingWindowSummary } from "../utils/sliding-window.js";
import { collections } from "../services/firestore.js";
import { initChapterOverlays } from "../services/mst.js";
import { initializeAllAssetSheets } from "../services/asset-sheet.js";

// ─── 입력 타입 ─────────────────────────────────────────────────

export interface Phase2Input {
  /** Phase 1 결과에서 가져옴 */
  genre: string;
  usp: string[];
  phase1Summary: string;
  /** 작가 추가 힌트 (선택) */
  worldHints?: string;
  characterHints?: string;
}

// ─── 파이프라인 결과 ───────────────────────────────────────────

export interface Phase2Result {
  output: Phase2FinalOutput;
  gating: {
    condition1: boolean; // ASSET_LIST 최소 기준
    condition2: boolean; // A/B 선택 완료 여부
    unselected: string[]; // 아직 선택 안 된 target_id
    all_passed: boolean;
  };
}

// ─── Phase 2 파이프라인 ────────────────────────────────────────

/**
 * Phase 2 세계관·에셋 설계 파이프라인
 *
 * 실행 순서: 세계관 설계자 → 심층 조사자 → 캐릭터 디자이너 → 총괄 프로듀서
 */
export async function runPhase2Pipeline(
  projectId: string,
  input: Phase2Input
): Promise<Phase2Result> {
  // ── Step 1: 세계관 설계자 ─────────────────────────────────────
  const worldbuilderInput: WorldbuilderInput = {
    phase1Summary: input.phase1Summary,
    genre: input.genre,
    usp: input.usp,
    worldHints: input.worldHints,
    characterHints: input.characterHints,
  };

  let worldbuilderOutput;
  try {
    worldbuilderOutput = await runWorldbuilderAgent(worldbuilderInput);
  } catch (err) {
    throw new Phase2PipelineError("세계관 설계자 에이전트 실행 실패", "worldbuilder", err);
  }

  // ── Step 2: 심층 조사자 (세계관 일관성 검토) ──────────────────
  let researcherOutput;
  try {
    researcherOutput = await runResearcherPhase2Agent(
      input.genre,
      input.usp,
      worldbuilderOutput
    );
  } catch (err) {
    throw new Phase2PipelineError("심층 조사자 에이전트 실행 실패", "researcher", err);
  }

  // ── Step 3: 캐릭터 디자이너 ──────────────────────────────────
  let characterOutput;
  try {
    characterOutput = await runCharacterAgent({
      genre: input.genre,
      usp: input.usp,
      worldbuilderOutput,
      researcherOutput,
      characterHints: input.characterHints,
    });
  } catch (err) {
    throw new Phase2PipelineError("캐릭터 디자이너 에이전트 실행 실패", "character", err);
  }

  // ── Step 4: 총괄 프로듀서 ────────────────────────────────────
  let producerOutput;
  try {
    producerOutput = await runProducerPhase2(
      input.genre,
      input.usp,
      worldbuilderOutput,
      researcherOutput,
      characterOutput
    );
  } catch (err) {
    throw new Phase2PipelineError("총괄 프로듀서 에이전트 실행 실패", "producer", err);
  }

  // ── Step 5: 출력 유효성 검증 ─────────────────────────────────
  const validation = validatePhase2Output(producerOutput);
  if (!validation.success) {
    throw new Phase2PipelineError(
      `Phase 2 출력 스키마 검증 실패: ${JSON.stringify(validation.error.flatten())}`,
      "validation",
      null
    );
  }

  const validated = validation.data;
  const gating = checkPhase2GatingConditions(validated);

  // ── Step 6: Firestore 저장 ────────────────────────────────────
  await savePhase2Draft(projectId, validated);

  return {
    output: producerOutput,
    gating: { ...gating, all_passed: gating.condition1 && gating.condition2 },
  };
}

// ─── A/B 선택 처리 ────────────────────────────────────────────

/**
 * 사용자가 특정 에셋의 A/B 디자인 옵션을 선택한다.
 * design_options를 업데이트하고 Firestore에 반영.
 */
export async function selectDesignOption(
  projectId: string,
  targetId: string,
  selected: "A" | "B"
): Promise<{ allSelected: boolean; unselected: string[] }> {
  const projectRef = collections.projects().doc(projectId);
  const snap = await projectRef.get();
  if (!snap.exists) throw new Error("프로젝트를 찾을 수 없습니다");

  const phase2Result = snap.data()?.phase_results?.phase_2;
  if (!phase2Result) throw new Error("Phase 2가 아직 완료되지 않았습니다");

  // design_options 배열에서 targetId 선택 업데이트
  const options: Array<{ target_id: string; selected: "A" | "B" | null }> =
    phase2Result.design_options ?? [];

  const targetIndex = options.findIndex((o) => o.target_id === targetId);
  if (targetIndex === -1) throw new Error(`target_id '${targetId}'를 찾을 수 없습니다`);

  options[targetIndex].selected = selected;

  const unselected = options.filter((o) => o.selected === null).map((o) => o.target_id);

  await projectRef.update({
    [`phase_results.phase_2.design_options`]: options,
    updated_at: FieldValue.serverTimestamp(),
  });

  return { allSelected: unselected.length === 0, unselected };
}

// ─── GATING 통과 처리 ─────────────────────────────────────────

/**
 * Phase 2 GATING 통과 처리.
 * 모든 A/B 선택이 완료된 상태에서 호출.
 * approved_assets에 에셋을 잠금 상태로 저장하고 MST를 초기화한다.
 */
export async function approvePhase2Assets(
  projectId: string,
  validated: Phase2OutputValidated
): Promise<void> {
  const db = collections.projects().firestore;
  const batch = db.batch();

  // 1. 캐릭터 에셋 approved_assets에 저장
  for (const char of validated.asset_list.characters) {
    const option = validated.design_options.find((o) => o.target_id === char.id);
    const finalPrompt =
      option?.selected === "A" ? option.option_a : (option?.option_b ?? "");

    const ref = collections
      .approvedAssets(projectId)
      .collection("characters")
      .doc(char.id);

    batch.set(ref, {
      ...char,
      selected_option: option?.selected ?? null,
      final_prompt: finalPrompt,
      ref_image_id: null, // 이미지 생성 후 업데이트
      locked: true,
      created_at: FieldValue.serverTimestamp(),
    });
  }

  // 2. 배경 에셋 approved_assets에 저장
  for (const loc of validated.asset_list.locations) {
    const option = validated.design_options.find((o) => o.target_id === loc.id);
    const finalPrompt =
      option?.selected === "A" ? option.option_a : (option?.option_b ?? "");

    const ref = collections
      .approvedAssets(projectId)
      .collection("locations")
      .doc(loc.id);

    batch.set(ref, {
      ...loc,
      selected_option: option?.selected ?? null,
      final_prompt: finalPrompt,
      ref_image_id: null,
      locked: true,
      created_at: FieldValue.serverTimestamp(),
    });
  }

  // 3. 소품 에셋 approved_assets에 저장
  for (const prop of validated.asset_list.props) {
    const ref = collections
      .approvedAssets(projectId)
      .collection("props")
      .doc(prop.id);
    batch.set(ref, { ...prop, locked: true, created_at: FieldValue.serverTimestamp() });
  }

  // 4. MST 기본값 초기화 (style_registry)
  const mstRef = collections.styleRegistry(projectId).collection("mst").doc("v1");
  batch.set(mstRef, {
    version: 1,
    art_style: "Korean webtoon line art",
    line_weight: "clean bold outlines, 3px stroke",
    color_palette: "flat color, cel-shading, vivid saturation",
    rendering: "no texture, digital illustration, clean edges",
    perspective: "slight 2.5D, manga panel composition",
    negative_prompt:
      "realistic, 3D render, photo, watercolor, pencil sketch, noise, grain",
    locked: true,
    last_modified_by: "system",
    last_modified_at: FieldValue.serverTimestamp(),
    revision_history: [],
  });

  // 5. 프로젝트 상태 → phase_3로 전환
  const projectRef = collections.projects().doc(projectId);
  batch.update(projectRef, {
    status: "phase_3",
    current_phase: 3,
    "phase_results.phase_2.gating_passed": true,
    "phase_results.phase_2.approved_at": FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  // Phase 5 초기화 — 장 오버레이 저장 + 에셋 시트 생성 (백그라운드)
  initChapterOverlays(projectId).catch((err) =>
    console.error("[Phase2] 장 오버레이 초기화 실패:", err)
  );

  // 에셋 시트 생성은 시간이 오래 걸리므로 fire-and-forget
  initializeAllAssetSheets(projectId)
    .then((result) => {
      const charCount = result.characters.length;
      const locCount = result.locations.length;
      const errCount = result.errors.length;
      console.log(
        `[Phase5] 에셋 시트 초기화 완료 — 캐릭터 ${charCount}개, 배경 ${locCount}개` +
          (errCount > 0 ? `, 오류 ${errCount}건: ${result.errors.join(" | ")}` : "")
      );
    })
    .catch((err) => console.error("[Phase5] 에셋 시트 초기화 실패:", err));
}

// ─── Firestore 초안 저장 ──────────────────────────────────────

async function savePhase2Draft(
  projectId: string,
  output: Phase2OutputValidated
): Promise<void> {
  // 슬라이딩 윈도우 요약
  await saveSlidingWindowSummary(projectId, 2, {
    key_decisions: [
      `세계관: ${output.world_design.physical_env.era}`,
      `캐릭터: ${output.asset_list.characters.map((c) => c.name).join(", ")}`,
      `배경: ${output.asset_list.locations.map((l) => l.name).join(", ")}`,
    ],
    approved_asset_ids: {
      characters: output.asset_list.characters.map((c) => c.id),
      locations: output.asset_list.locations.map((l) => l.id),
      props: output.asset_list.props.map((p) => p.id),
    },
    next_phase_ready: false, // A/B 선택 완료 후 갱신
  });

  // projects 문서에 Phase 2 결과 저장
  await collections.projects().doc(projectId).update({
    "phase_results.phase_2": {
      summary: output.summary,
      world_design: output.world_design,
      asset_list: output.asset_list,
      design_options: output.design_options,
      agent_notes: output.agent_notes,
      gating_passed: false,
      completed_at: FieldValue.serverTimestamp(),
    },
    updated_at: FieldValue.serverTimestamp(),
  });
}

// ─── 에러 클래스 ───────────────────────────────────────────────

export class Phase2PipelineError extends Error {
  constructor(
    message: string,
    public readonly stage:
      | "worldbuilder"
      | "researcher"
      | "character"
      | "producer"
      | "validation",
    public readonly cause: unknown
  ) {
    super(message);
    this.name = "Phase2PipelineError";
  }
}
