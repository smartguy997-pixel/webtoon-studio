import { callAgent } from "../services/anthropic.js";
import {
  RESEARCHER_PROMPT,
  buildResearcherUserMessage,
} from "../services/agents/prompts/researcher.prompt.js";
import { extractJson, JsonExtractionError } from "../utils/extract-json.js";
import type { StrategistOutput } from "./strategist.js";

// ─── 중간 출력 타입 ────────────────────────────────────────────

export interface ResearcherFlag {
  type: "cliche" | "logic_gap" | "market_risk" | "differentiation";
  severity: "low" | "medium" | "high";
  description: string;
  suggestion: string;
}

export interface ResearcherOutput {
  flags: ResearcherFlag[];
  feasibility_adjustment: number; // ±0.15 범위
  improved_usp_suggestions: string[];
  agent_notes: {
    researcher: string;
  };
}

// ─── 에이전트 실행 ─────────────────────────────────────────────

/**
 * 심층 조사자 에이전트 실행
 * 전략 기획자의 출력을 받아 검토하고 ResearcherOutput JSON을 반환한다.
 */
export async function runResearcherAgent(
  userInput: { genre: string; concept: string },
  strategistOutput: StrategistOutput
): Promise<ResearcherOutput> {
  const strategistRaw = JSON.stringify(strategistOutput, null, 2);
  const userMessage = buildResearcherUserMessage(userInput, strategistRaw);

  const raw = await callAgent(
    RESEARCHER_PROMPT,
    [{ role: "user", content: userMessage }],
    { agentName: "researcher" }
  );

  try {
    return extractJson<ResearcherOutput>(raw);
  } catch (err) {
    if (err instanceof JsonExtractionError) {
      const retry = await callAgent(
        RESEARCHER_PROMPT,
        [
          { role: "user", content: userMessage },
          { role: "assistant", content: raw },
          {
            role: "user",
            content:
              "출력이 올바른 JSON 형식이 아닙니다. 지정된 JSON 스키마만 출력해주세요.",
          },
        ],
        { agentName: "researcher-retry" }
      );
      return extractJson<ResearcherOutput>(retry);
    }
    throw err;
  }
}
