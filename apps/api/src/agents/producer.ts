import { callAgent } from "../services/anthropic.js";
import {
  PRODUCER_PHASE1_PROMPT,
  buildProducerPhase1UserMessage,
} from "../services/agents/prompts/producer-phase1.prompt.js";
import { extractJson, JsonExtractionError } from "../utils/extract-json.js";
import type { StrategistOutput } from "./strategist.js";
import type { ResearcherOutput } from "./researcher.js";

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
    characters: never[];
    locations: never[];
    props: never[];
  };
  revision_history: never[];
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
