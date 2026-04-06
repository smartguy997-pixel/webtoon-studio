export type AgentId =
  | "agent_strategist"
  | "agent_researcher"
  | "agent_worldbuilder"
  | "agent_character"
  | "agent_scenario"
  | "agent_script"
  | "agent_producer";

export interface AgentNote {
  agent_id: AgentId;
  content: string;
  phase: number;
  created_at: string;
}
