import { callAgent } from "../services/anthropic.js";
import {
  CHARACTER_PROMPT,
  buildCharacterUserMessage,
} from "../services/agents/prompts/character.prompt.js";
import { extractJson, JsonExtractionError } from "../utils/extract-json.js";
import type { WorldbuilderOutput } from "./worldbuilder.js";
import type { ResearcherPhase2Output } from "./researcher.js";

// ─── 중간 출력 타입 ────────────────────────────────────────────

export interface CharacterAppearance {
  face: string;
  body: string;
  hair: string;
  outfit: string;
  distinguishing_features: string;
}

export interface CharacterAsset {
  id: string; // char_NNN
  name: string;
  role: "protagonist" | "antagonist" | "supporting";
  age: string;
  personality: string;
  appearance: CharacterAppearance;
  ability: string;
  arc: string;
}

export interface LocationAsset {
  id: string; // loc_NNN
  name: string;
  type: "interior" | "exterior" | "landmark";
  atmosphere: string;
  structure: string;
  first_appearance: string;
}

export interface PropAsset {
  id: string; // prop_NNN
  name: string;
  function: string;
  appearance: string;
  owner: string | null;
}

export interface AssetList {
  characters: CharacterAsset[];
  locations: LocationAsset[];
  props: PropAsset[];
}

export interface DesignOption {
  target_id: string;
  target_name: string;
  target_type: "character" | "location";
  option_a: string;
  option_b: string;
  selected: "A" | "B" | null;
}

export interface CharacterOutput {
  asset_list: AssetList;
  design_options: DesignOption[];
  agent_notes: {
    character_designer: string;
  };
}

export interface CharacterInput {
  genre: string;
  usp: string[];
  worldbuilderOutput: WorldbuilderOutput;
  researcherOutput: ResearcherPhase2Output;
  characterHints?: string;
}

// ─── 에이전트 실행 ─────────────────────────────────────────────

export async function runCharacterAgent(input: CharacterInput): Promise<CharacterOutput> {
  const userMessage = buildCharacterUserMessage(
    input.genre,
    input.usp,
    JSON.stringify(input.worldbuilderOutput, null, 2),
    JSON.stringify(input.researcherOutput, null, 2),
    input.characterHints
  );

  const raw = await callAgent(
    CHARACTER_PROMPT,
    [{ role: "user", content: userMessage }],
    { agentName: "character-designer" }
  );

  try {
    const parsed = extractJson<CharacterOutput>(raw);
    return sanitizeDesignOptions(parsed);
  } catch (err) {
    if (err instanceof JsonExtractionError) {
      const retry = await callAgent(
        CHARACTER_PROMPT,
        [
          { role: "user", content: userMessage },
          { role: "assistant", content: raw },
          {
            role: "user",
            content:
              "출력이 올바른 JSON 형식이 아닙니다. 지정된 JSON 스키마만 출력해주세요. 비주얼 태그는 영문만 사용하세요.",
          },
        ],
        { agentName: "character-designer-retry" }
      );
      const parsed = extractJson<CharacterOutput>(retry);
      return sanitizeDesignOptions(parsed);
    }
    throw err;
  }
}

// ─── MST 태그 제거 ─────────────────────────────────────────────

/**
 * design_options의 A/B 프롬프트에서 MST 관련 화풍 태그를 제거한다.
 * 에이전트가 지시를 어기고 화풍 태그를 포함할 경우의 방어 로직.
 */
const MST_TAGS_PATTERN =
  /\b(korean\s+webtoon|webtoon\s+style|line\s+art|cel[- ]shad\w*|flat\s+color|manga\s+panel|digital\s+illustration|no\s+texture|clean\s+edges|bold\s+outlines?|2\.5[dD])\b,?\s*/gi;

function sanitizePrompt(prompt: string): string {
  return prompt.replace(MST_TAGS_PATTERN, "").replace(/,\s*,/g, ",").trim().replace(/^,|,$/, "");
}

function sanitizeDesignOptions(output: CharacterOutput): CharacterOutput {
  return {
    ...output,
    design_options: output.design_options.map((opt) => ({
      ...opt,
      option_a: sanitizePrompt(opt.option_a),
      option_b: sanitizePrompt(opt.option_b),
    })),
  };
}
