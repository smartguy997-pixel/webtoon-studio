import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CallAgentOptions {
  maxTokens?: number;
  /** 로깅용 에이전트 이름 */
  agentName?: string;
}

/**
 * 단일 에이전트 호출
 * 응답 텍스트와 토큰 사용량을 로깅한다.
 */
export async function callAgent(
  systemPrompt: string,
  messages: AgentMessage[],
  options: CallAgentOptions | number = {}
): Promise<string> {
  // 이전 시그니처(maxTokens 숫자)와의 호환성 유지
  const opts: CallAgentOptions =
    typeof options === "number" ? { maxTokens: options } : options;

  const maxTokens = opts.maxTokens ?? 4096;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  // 토큰 사용량 로깅
  const usage = response.usage;
  console.log(
    `[${opts.agentName ?? "agent"}] tokens — input: ${usage.input_tokens}, output: ${usage.output_tokens}`
  );

  const block = response.content[0];
  if (block.type !== "text") {
    throw new Error(`예상치 못한 응답 타입: ${block.type}`);
  }
  return block.text;
}
