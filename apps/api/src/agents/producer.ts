import { callAgent } from "../services/anthropic.js";
import {
  PRODUCER_PHASE1_PROMPT,
  buildProducerPhase1UserMessage,
} from "../services/agents/prompts/producer-phase1.prompt.js";
import {
  PRODUCER_PHASE2_PROMPT,
  buildProducerPhase2UserMessage,
} from "../services/agents/prompts/producer-phase2.prompt.js";
import {
  PRODUCER_PHASE3_PROMPT,
  buildProducerPhase3UserMessage,
} from "../services/agents/prompts/producer-phase3.prompt.js";
import {
  PRODUCER_PHASE4_PROMPT,
  buildProducerPhase4UserMessage,
} from "../services/agents/prompts/producer-phase4.prompt.js";
import { extractJson, JsonExtractionError } from "../utils/extract-json.js";
import type { StrategistOutput } from "./strategist.js";
import type { ResearcherOutput, ResearcherPhase2Output } from "./researcher.js";
import type { WorldbuilderOutput } from "./worldbuilder.js";
import type { CharacterOutput, AssetList, DesignOption } from "./character.js";
import type { ScenarioMergedOutput, ArcStructure, Arc, Episode, PacingPlan } from "./scenario.js";
import type { ScriptDraft, Phase4FinalOutput } from "./script.js";

// ─── Phase 1 최종 출력 타입 ────────────────────────────────────

export interface Phase1FinalOutput {
  phase: "기획 분석";
  summary: string;
  market_analysis: {
    genre: string;
    positioning: string;
    trend_keywords: string[];
    competitors: Array<{
      title: string;
      strength: string;
      weakness: string;
      our_edge: string;
    }>;
  };
  usp: string[];
  feasibility_score: number;
  agent_notes: {
    strategist: string;
    researcher: string;
    producer: string;
  };
  asset_list: {
    characters: unknown[];
    locations: unknown[];
    props: unknown[];
  };
  revision_history: unknown[];
}

export type FeasibilityVerdict = "go" | "conditional" | "reject";

export function getFeasibilityVerdict(score: number): FeasibilityVerdict {
  if (score >= 0.8) return "go";
  if (score >= 0.5) return "conditional";
  return "reject";
}

// ─── 에이전트 실행 ─────────────────────────────────────────────

/**
 * 총괄 프로듀서 에이전트 실행 (Phase 1)
 * 전략 기획자 + 심층 조사자 결과를 종합해 Phase 1 최종 출력을 생성한다.
 */
export async function runProducerPhase1(
  userInput: { title?: string; genre: string; concept: string; target_audience?: string },
  strategistOutput: StrategistOutput,
  researcherOutput: ResearcherOutput
): Promise<Phase1FinalOutput> {
  const userMessage = buildProducerPhase1UserMessage(
    userInput,
    JSON.stringify(strategistOutput, null, 2),
    JSON.stringify(researcherOutput, null, 2)
  );

  const raw = await callAgent(
    PRODUCER_PHASE1_PROMPT,
    [{ role: "user", content: userMessage }],
    { agentName: "producer-phase1" }
  );

  try {
    return extractJson<Phase1FinalOutput>(raw);
  } catch (err) {
    if (err instanceof JsonExtractionError) {
      const retry = await callAgent(
        PRODUCER_PHASE1_PROMPT,
        [
          { role: "user", content: userMessage },
          { role: "assistant", content: raw },
          {
            role: "user",
            content:
              "출력이 올바른 JSON 형식이 아닙니다. 지정된 Phase1 출력 JSON 스키마만 출력해주세요.",
          },
        ],
        { agentName: "producer-phase1-retry" }
      );
      return extractJson<Phase1FinalOutput>(retry);
    }
    throw err;
  }
}

// ─── Phase 2 최종 출력 타입 ────────────────────────────────────

export interface Phase2FinalOutput {
  phase: "세계관_에셋_설계";
  summary: string;
  world_design: WorldbuilderOutput["world_design"];
  asset_list: AssetList;
  design_options: DesignOption[];
  approved_assets: string[];
  agent_notes: {
    worldbuilder: string;
    researcher: string;
    character_designer: string;
    producer: string;
  };
  revision_history: unknown[];
}

// ─── Phase 2 에이전트 실행 ─────────────────────────────────────

/**
 * 총괄 프로듀서 에이전트 실행 (Phase 2)
 * 세계관 설계자 + 심층 조사자 + 캐릭터 디자이너 결과를 종합해 Phase 2 최종 출력 생성.
 */
export async function runProducerPhase2(
  genre: string,
  usp: string[],
  worldbuilderOutput: WorldbuilderOutput,
  researcherOutput: ResearcherPhase2Output,
  characterOutput: CharacterOutput
): Promise<Phase2FinalOutput> {
  const userMessage = buildProducerPhase2UserMessage(
    genre,
    usp,
    JSON.stringify(worldbuilderOutput, null, 2),
    JSON.stringify(researcherOutput, null, 2),
    JSON.stringify(characterOutput, null, 2)
  );

  const raw = await callAgent(
    PRODUCER_PHASE2_PROMPT,
    [{ role: "user", content: userMessage }],
    { agentName: "producer-phase2" }
  );

  try {
    return extractJson<Phase2FinalOutput>(raw);
  } catch (err) {
    if (err instanceof JsonExtractionError) {
      const retry = await callAgent(
        PRODUCER_PHASE2_PROMPT,
        [
          { role: "user", content: userMessage },
          { role: "assistant", content: raw },
          {
            role: "user",
            content:
              "출력이 올바른 JSON 형식이 아닙니다. 지정된 Phase 2 출력 JSON 스키마만 출력해주세요.",
          },
        ],
        { agentName: "producer-phase2-retry" }
      );
      return extractJson<Phase2FinalOutput>(retry);
    }
    throw err;
  }
}

// ─── Phase 3 최종 출력 타입 ────────────────────────────────────

export interface Phase3FinalOutput {
  phase: "100화_로드맵";
  summary: string;
  arc_structure: ArcStructure;
  arcs: Arc[];
  episodes: Episode[]; // 1~100화 전체
  pacing_plan: PacingPlan;
  agent_notes: {
    scenario_writer: string;
    producer: string;
  };
  revision_history: unknown[];
}

// ─── Phase 3 에이전트 실행 ─────────────────────────────────────

/**
 * 총괄 프로듀서 에이전트 실행 (Phase 3)
 * 시나리오 작가의 4배치 병합 결과를 검토하여 최종 100화 로드맵을 출력한다.
 */
export async function runProducerPhase3(
  mergedOutput: ScenarioMergedOutput,
  platform: string,
  episodesPerWeek: number
): Promise<Phase3FinalOutput> {
  const userMessage = buildProducerPhase3UserMessage(
    JSON.stringify(mergedOutput, null, 2),
    platform,
    episodesPerWeek
  );

  const raw = await callAgent(
    PRODUCER_PHASE3_PROMPT,
    [{ role: "user", content: userMessage }],
    { agentName: "producer-phase3", maxTokens: 8192 }
  );

  try {
    return extractJson<Phase3FinalOutput>(raw);
  } catch (err) {
    if (err instanceof JsonExtractionError) {
      const retry = await callAgent(
        PRODUCER_PHASE3_PROMPT,
        [
          { role: "user", content: userMessage },
          { role: "assistant", content: raw },
          {
            role: "user",
            content:
              "출력이 올바른 JSON 형식이 아닙니다. 지정된 Phase 3 출력 JSON 스키마만 출력해주세요. episodes 배열에 1화~100화 전체(100개)가 포함되어야 합니다.",
          },
        ],
        { agentName: "producer-phase3-retry", maxTokens: 8192 }
      );
      return extractJson<Phase3FinalOutput>(retry);
    }
    throw err;
  }
}

// ─── Phase 4 에이전트 실행 ─────────────────────────────────────

/**
 * 총괄 프로듀서 에이전트 실행 (Phase 4)
 * 대본/연출 작가의 30컷 초안을 검토하여 최종 대본을 출력한다.
 */
export async function runProducerPhase4(
  scriptDraft: ScriptDraft,
  episodeType: string,
  cliffhanger: string | null
): Promise<Phase4FinalOutput> {
  const userMessage = buildProducerPhase4UserMessage(
    JSON.stringify(scriptDraft, null, 2),
    episodeType,
    cliffhanger
  );

  const raw = await callAgent(
    PRODUCER_PHASE4_PROMPT,
    [{ role: "user", content: userMessage }],
    { agentName: "producer-phase4", maxTokens: 8192 }
  );

  try {
    return extractJson<Phase4FinalOutput>(raw);
  } catch (err) {
    if (err instanceof JsonExtractionError) {
      const retry = await callAgent(
        PRODUCER_PHASE4_PROMPT,
        [
          { role: "user", content: userMessage },
          { role: "assistant", content: raw },
          {
            role: "user",
            content:
              "출력이 올바른 JSON 형식이 아닙니다. 지정된 Phase 4 출력 JSON 스키마만 출력해주세요. script_data 배열은 반드시 30개여야 합니다.",
          },
        ],
        { agentName: "producer-phase4-retry", maxTokens: 8192 }
      );
      return extractJson<Phase4FinalOutput>(retry);
    }
    throw err;
  }
}
