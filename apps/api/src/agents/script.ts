import { callAgent } from "../services/anthropic.js";
import {
  SCRIPT_WRITER_PROMPT,
  buildScriptWriterMessage,
  type ScriptWriterInput,
} from "../services/agents/prompts/script.prompt.js";
import { extractJson, JsonExtractionError } from "../utils/extract-json.js";

// ─── 타입 정의 ─────────────────────────────────────────────────

export type ChapterStyle = "default" | "flashback" | "dream" | "climax" | "epilogue";
export type CameraAngle = "ELS" | "LS" | "MS" | "MCU" | "CU" | "ECU" | "OTS" | "POV" | "BIRD" | "WORM" | "DUTCH";
export type AspectRatio = "1:1" | "1:1.5" | "1:2" | "1:3";
export type CharacterPosition = "left" | "center" | "right" | "background";
export type CharacterExpression = "기쁨" | "분노" | "슬픔" | "놀람" | "무표정" | "긴장";
export type BackgroundVariant = "day_clear" | "day_cloudy" | "evening" | "night" | "rain" | "snow";
export type BalloonType = "normal" | "shout" | "whisper" | "thought" | "narration";
export type CutEffect = "none" | "speed_lines" | "impact_lines" | "glow" | "blur";

export interface ScriptCutCharacter {
  char_id: string;
  position: CharacterPosition;
  expression: CharacterExpression;
  pose: string;
}

export interface ScriptCutDialogue {
  char_id: string;
  text: string;
  balloon_type: BalloonType;
}

export interface ScriptCutImagePrompt {
  cut_specific_tags: string;
  negative_prompt: string;
}

export interface ScriptCut {
  cut: number; // 1~30
  angle: CameraAngle;
  aspect_ratio: AspectRatio;
  scene_description: string;
  characters: ScriptCutCharacter[];
  location_id: string;
  background_variant: BackgroundVariant;
  dialogue: ScriptCutDialogue[];
  sfx: string[];
  effect: CutEffect;
  image_prompt: ScriptCutImagePrompt;
  director_note: string;
}

export interface ScriptAssetsUsed {
  characters: string[];
  locations: string[];
  props: string[];
}

/** 대본 작가 초안 (agent_notes 없음) */
export interface ScriptDraft {
  phase: "30컷_대본";
  episode: number;
  episode_title: string;
  chapter_style: ChapterStyle;
  script_data: ScriptCut[];
  episode_summary_for_next: string;
  assets_used: ScriptAssetsUsed;
}

/** Phase 4 최종 출력 (총괄 프로듀서 검토 후) */
export interface Phase4FinalOutput extends ScriptDraft {
  agent_notes: {
    script_writer: string;
    producer: string;
  };
  revision_history: unknown[];
}

export type { ScriptWriterInput };

// ─── MST 태그 제거 (image_prompt 방어 레이어) ──────────────────

const MST_TAGS_PATTERN =
  /\b(korean\s+webtoon|webtoon\s+style|line\s+art|cel[- ]shad\w*|flat\s+color|vivid\s+saturation|bold\s+outline|manga\s+panel|digital\s+illustration|2\.5D|no\s+texture|clean\s+edges)\b,?\s*/gi;

function sanitizeImagePrompt(tags: string): string {
  return tags.replace(MST_TAGS_PATTERN, "").replace(/,\s*,/g, ",").trim().replace(/^,|,$/, "").trim();
}

function sanitizeCuts(cuts: ScriptCut[]): ScriptCut[] {
  return cuts.map((cut) => ({
    ...cut,
    image_prompt: {
      ...cut.image_prompt,
      cut_specific_tags: sanitizeImagePrompt(cut.image_prompt.cut_specific_tags),
    },
  }));
}

// ─── 에이전트 실행 ─────────────────────────────────────────────

/**
 * 대본/연출 작가 에이전트 — 1화 30컷 기술 대본 초안 생성
 */
export async function runScriptAgent(input: ScriptWriterInput): Promise<ScriptDraft> {
  const userMessage = buildScriptWriterMessage(input);

  const raw = await callAgent(
    SCRIPT_WRITER_PROMPT,
    [{ role: "user", content: userMessage }],
    { agentName: "script-writer", maxTokens: 8192 }
  );

  try {
    const draft = extractJson<ScriptDraft>(raw);
    return { ...draft, script_data: sanitizeCuts(draft.script_data) };
  } catch (err) {
    if (err instanceof JsonExtractionError) {
      const retry = await callAgent(
        SCRIPT_WRITER_PROMPT,
        [
          { role: "user", content: userMessage },
          { role: "assistant", content: raw },
          {
            role: "user",
            content:
              "출력이 올바른 JSON 형식이 아닙니다. 지정된 JSON 스키마만 출력해주세요. script_data 배열은 반드시 30개여야 합니다.",
          },
        ],
        { agentName: "script-writer-retry", maxTokens: 8192 }
      );
      const draft = extractJson<ScriptDraft>(retry);
      return { ...draft, script_data: sanitizeCuts(draft.script_data) };
    }
    throw err;
  }
}

// ─── 헬퍼 ──────────────────────────────────────────────────────

/**
 * 에피소드 유형에 따른 chapter_style 자동 결정
 * (에이전트 출력 chapter_style이 없을 경우 폴백)
 */
export function detectChapterStyle(
  episodeType: string,
  summary: string
): ChapterStyle {
  if (episodeType === "peak") return "climax";
  if (episodeType === "fanservice") return "epilogue";
  const lower = summary.toLowerCase();
  if (lower.includes("회상") || lower.includes("과거")) return "flashback";
  if (lower.includes("꿈") || lower.includes("환상")) return "dream";
  return "default";
}
