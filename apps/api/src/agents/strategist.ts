import { callAgent } from "../services/anthropic.js";
import {
  STRATEGIST_PROMPT,
  buildStrategistUserMessage,
} from "../services/agents/prompts/strategist.prompt.js";
import { extractJson, JsonExtractionError } from "../utils/extract-json.js";

// ─── 중간 출력 타입 ────────────────────────────────────────────

export interface StrategistOutput {
  preliminary_feasibility_score: number;
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
  initial_usp: string[];
  agent_notes: {
    strategist: string;
  };
}

export interface StrategistInput {
  title?: string;
  genre: string;
  concept: string;
  target_audience?: string;
}

// ─── 에이전트 실행 ─────────────────────────────────────────────

/**
 * 전략 기획자 에이전트 실행
 * Anthropic API를 호출하고 StrategistOutput JSON을 반환한다.
 * 파싱 실패 시 1회 재시도한다.
 */
export async function runStrategistAgent(input: StrategistInput): Promise<StrategistOutput> {
  const userMessage = buildStrategistUserMessage(input);

  const raw = await callAgent(
    STRATEGIST_PROMPT,
    [{ role: "user", content: userMessage }],
    { agentName: "strategist" }
  );

  try {
    return extractJson<StrategistOutput>(raw);
  } catch (err) {
    if (err instanceof JsonExtractionError) {
      // 1회 재시도: JSON만 출력하도록 명시적 요청
      const retry = await callAgent(
        STRATEGIST_PROMPT,
        [
          { role: "user", content: userMessage },
          { role: "assistant", content: raw },
          {
            role: "user",
            content:
              "출력이 올바른 JSON 형식이 아닙니다. 위에서 지정한 JSON 스키마만 그대로 출력해주세요. 다른 텍스트는 포함하지 마세요.",
          },
        ],
        { agentName: "strategist-retry" }
      );
      return extractJson<StrategistOutput>(retry);
    }
    throw err;
  }
}
