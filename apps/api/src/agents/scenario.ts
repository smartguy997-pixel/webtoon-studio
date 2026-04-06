import { callAgent } from "../services/anthropic.js";
import {
  SCENARIO_PROMPT,
  buildScenarioBatch1Message,
  buildScenarioBatchNMessage,
  buildScenarioBatch4Message,
} from "../services/agents/prompts/scenario.prompt.js";
import { extractJson, JsonExtractionError } from "../utils/extract-json.js";

// ─── 타입 정의 ─────────────────────────────────────────────────

export type EpisodeType = "normal" | "hook" | "peak" | "twist" | "fanservice" | "info";
export type ArcType = "small" | "medium" | "large";

export interface Arc {
  arc_id: string;
  arc_type: ArcType;
  title: string;
  episode_range: [number, number];
  theme: string;
  resolution: string;
}

export interface Episode {
  ep: number;
  title: string;
  summary: string;
  arc_id: string;
  episode_type: EpisodeType;
  featured_characters: string[];
  featured_locations: string[];
  cliffhanger: string | null;
}

export interface ArcStructure {
  act_1: { range: [number, number]; theme: string; key_events: string[] };
  act_2: { range: [number, number]; theme: string; key_events: string[] };
  act_3: { range: [number, number]; theme: string; key_events: string[] };
  act_4: { range: [number, number]; theme: string; key_events: string[] };
}

export interface PacingPlan {
  hook_episodes: number[];
  peak_episodes: number[];
  twist_episodes: number[];
  estimated_weekly_schedule: string;
}

/** 배치 1 응답 */
interface Batch1Response {
  arc_structure: ArcStructure;
  arcs: Arc[];
  episodes: Episode[];
}

/** 배치 2~3 응답 */
interface BatchNResponse {
  episodes: Episode[];
}

/** 배치 4 응답 */
interface Batch4Response {
  episodes: Episode[];
  pacing_plan: PacingPlan;
}

/** 시나리오 작가 최종 병합 결과 (총괄 프로듀서에게 전달) */
export interface ScenarioMergedOutput {
  arc_structure: ArcStructure;
  arcs: Arc[];
  episodes: Episode[]; // 1~100화 전체
  pacing_plan: PacingPlan;
}

export interface ScenarioInput {
  genre: string;
  usp: string[];
  worldDesignSummary: string;
  characters: Array<{ id: string; name: string; role: string }>;
  locations: Array<{ id: string; name: string }>;
  platform: string;
  episodesPerWeek: number;
}

// ─── 배치 실행 헬퍼 ────────────────────────────────────────────

async function callWithRetry<T>(
  userMessage: string,
  agentName: string
): Promise<T> {
  const raw = await callAgent(
    SCENARIO_PROMPT,
    [{ role: "user", content: userMessage }],
    { agentName, maxTokens: 8192 }
  );

  try {
    return extractJson<T>(raw);
  } catch (err) {
    if (err instanceof JsonExtractionError) {
      const retry = await callAgent(
        SCENARIO_PROMPT,
        [
          { role: "user", content: userMessage },
          { role: "assistant", content: raw },
          {
            role: "user",
            content:
              "출력이 올바른 JSON 형식이 아닙니다. 지정된 JSON 스키마만 출력해주세요. episodes 배열이 비어있지 않도록 주의하세요.",
          },
        ],
        { agentName: `${agentName}-retry`, maxTokens: 8192 }
      );
      return extractJson<T>(retry);
    }
    throw err;
  }
}

/** 최근 N화의 요약을 컨텍스트 문자열로 변환 (토큰 절약) */
function buildEpisodesContext(episodes: Episode[], lastN = 5): string {
  const recent = episodes.slice(-lastN);
  return recent
    .map((e) => `ep${e.ep}(${e.episode_type}): ${e.summary}`)
    .join("\n");
}

/** 아크 목록을 간단한 참조 문자열로 변환 */
function buildArcsSummary(arcs: Arc[]): string {
  return arcs
    .map((a) => `${a.arc_id}[${a.episode_range[0]}-${a.episode_range[1]}] ${a.arc_type}: ${a.title}`)
    .join("\n");
}

// ─── 메인 에이전트 실행 ────────────────────────────────────────

/**
 * 시나리오 작가 에이전트 — 25화씩 4배치로 100화 생성
 *
 * 배치 1: arc_structure + arcs + episodes 1~25
 * 배치 2: episodes 26~50
 * 배치 3: episodes 51~75
 * 배치 4: episodes 76~100 + pacing_plan
 */
export async function runScenarioAgent(
  input: ScenarioInput,
  onBatchComplete?: (batchNum: number, episodeCount: number) => void
): Promise<ScenarioMergedOutput> {
  // ── 배치 1: arc_structure + arcs + ep 1~25 ──────────────────
  const batch1Msg = buildScenarioBatch1Message(input);
  const batch1 = await callWithRetry<Batch1Response>(batch1Msg, "scenario-batch1");
  onBatchComplete?.(1, batch1.episodes.length);

  const arcsSummary = buildArcsSummary(batch1.arcs);

  // ── 배치 2: ep 26~50 ─────────────────────────────────────────
  const batch2Msg = buildScenarioBatchNMessage(
    2,
    26,
    50,
    arcsSummary,
    buildEpisodesContext(batch1.episodes)
  );
  const batch2 = await callWithRetry<BatchNResponse>(batch2Msg, "scenario-batch2");
  onBatchComplete?.(2, batch2.episodes.length);

  const allEpsSoFar2 = [...batch1.episodes, ...batch2.episodes];

  // ── 배치 3: ep 51~75 ─────────────────────────────────────────
  const batch3Msg = buildScenarioBatchNMessage(
    3,
    51,
    75,
    arcsSummary,
    buildEpisodesContext(allEpsSoFar2)
  );
  const batch3 = await callWithRetry<BatchNResponse>(batch3Msg, "scenario-batch3");
  onBatchComplete?.(3, batch3.episodes.length);

  const allEpsSoFar3 = [...allEpsSoFar2, ...batch3.episodes];

  // ── 배치 4: ep 76~100 + pacing_plan ──────────────────────────
  const batch4Msg = buildScenarioBatch4Message(
    arcsSummary,
    buildEpisodesContext(allEpsSoFar3),
    input.platform,
    input.episodesPerWeek
  );
  const batch4 = await callWithRetry<Batch4Response>(batch4Msg, "scenario-batch4");
  onBatchComplete?.(4, batch4.episodes.length);

  // ── 병합 ──────────────────────────────────────────────────────
  const allEpisodes = [
    ...batch1.episodes,
    ...batch2.episodes,
    ...batch3.episodes,
    ...batch4.episodes,
  ];

  // ep 번호 기준 정렬 (배치 경계에서 중복/역순 방지)
  allEpisodes.sort((a, b) => a.ep - b.ep);

  return {
    arc_structure: batch1.arc_structure,
    arcs: batch1.arcs,
    episodes: allEpisodes,
    pacing_plan: batch4.pacing_plan,
  };
}
