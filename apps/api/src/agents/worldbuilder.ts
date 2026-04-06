import { callAgent } from "../services/anthropic.js";
import {
  WORLDBUILDER_PROMPT,
  buildWorldbuilderUserMessage,
} from "../services/agents/prompts/worldbuilder.prompt.js";
import { extractJson, JsonExtractionError } from "../utils/extract-json.js";

// ─── 중간 출력 타입 ────────────────────────────────────────────

export interface WorldDesign {
  physical_env: {
    era: string;
    geography: string;
    climate: string;
  };
  social_system: {
    power_structure: string;
    class_system: string;
    economy: string;
  };
  unique_rules: Array<{
    rule_name: string;
    description: string;
    limitation: string;
  }>;
  information_asymmetry: {
    reader_knows: string[];
    character_knows: string[];
  };
}

export interface WorldbuilderOutput {
  world_design: WorldDesign;
  agent_notes: {
    worldbuilder: string;
  };
}

export interface WorldbuilderInput {
  phase1Summary: string;
  genre: string;
  usp: string[];
  worldHints?: string;
  characterHints?: string;
}

// ─── 에이전트 실행 ─────────────────────────────────────────────

export async function runWorldbuilderAgent(
  input: WorldbuilderInput
): Promise<WorldbuilderOutput> {
  const userMessage = buildWorldbuilderUserMessage(input);

  const raw = await callAgent(
    WORLDBUILDER_PROMPT,
    [{ role: "user", content: userMessage }],
    { agentName: "worldbuilder" }
  );

  try {
    return extractJson<WorldbuilderOutput>(raw);
  } catch (err) {
    if (err instanceof JsonExtractionError) {
      const retry = await callAgent(
        WORLDBUILDER_PROMPT,
        [
          { role: "user", content: userMessage },
          { role: "assistant", content: raw },
          {
            role: "user",
            content:
              "출력이 올바른 JSON 형식이 아닙니다. 지정된 JSON 스키마만 출력해주세요.",
          },
        ],
        { agentName: "worldbuilder-retry" }
      );
      return extractJson<WorldbuilderOutput>(retry);
    }
    throw err;
  }
}
