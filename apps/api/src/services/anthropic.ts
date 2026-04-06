import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * 단일 에이전트 호출
 */
export async function callAgent(
  systemPrompt: string,
  messages: AgentMessage[],
  maxTokens = 4096
): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");
  return block.text;
}

/**
 * 멀티 에이전트 순차 호출 (총괄 프로듀서 → 담당 에이전트들 → 총괄 프로듀서)
 */
export async function runAgentPipeline(
  agents: Array<{ systemPrompt: string; messages: AgentMessage[] }>
): Promise<string[]> {
  const results: string[] = [];
  for (const agent of agents) {
    const result = await callAgent(agent.systemPrompt, agent.messages);
    results.push(result);
  }
  return results;
}
