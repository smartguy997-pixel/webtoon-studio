import type { AgentId } from "../types/agent.js";

export const AGENT_NAMES: Record<AgentId, string> = {
  agent_strategist: "전략 기획자",
  agent_researcher: "심층 조사자",
  agent_worldbuilder: "세계관 설계자",
  agent_character: "캐릭터 디자이너",
  agent_scenario: "시나리오 작가",
  agent_script: "대본/연출 작가",
  agent_producer: "총괄 프로듀서",
};

export const AGENT_ACTIVE_PHASES: Record<AgentId, number[]> = {
  agent_strategist: [1],
  agent_researcher: [1, 2],
  agent_worldbuilder: [2],
  agent_character: [2, 5],
  agent_scenario: [3],
  agent_script: [4],
  agent_producer: [1, 2, 3, 4, 5],
};

export const SLIDING_WINDOW_SIZE = 10;

export const FEASIBILITY_THRESHOLDS = {
  GO: 0.8,
  CONDITIONAL: 0.5,
} as const;

export const SCC_THRESHOLDS = {
  MST_CLIP: 0.82,
  CHAR_CLIP: 0.85,
  BG_ORB: 0.7,
  MAX_ATTEMPTS: 3,
} as const;
