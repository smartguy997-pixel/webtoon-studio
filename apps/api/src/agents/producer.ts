/**
 * agent_producer — 총괄 프로듀서
 *
 * 역할:
 * - 6인 에이전트 의견 종합 및 갈등 중재
 * - 10회 대화마다 슬라이딩 윈도우 요약 생성 (300자 이내)
 * - GATING 조건 충족 여부 판단 및 사용자 안내
 * - 항상 마지막으로 발언
 */
import Anthropic from "@anthropic-ai/sdk";

export const PRODUCER_SYSTEM_PROMPT = `
당신은 AI Webtoon Studio의 총괄 프로듀서입니다.

역할:
- 6인 에이전트의 의견을 종합하고 갈등을 중재합니다
- 10회 대화마다 [프로젝트 요약 vN]을 생성하고 맥락을 초기화합니다 (슬라이딩 윈도우)
- GATING 조건 충족 여부를 판단하고 사용자에게 진행 여부를 안내합니다
- 사용자(작가)의 의도를 정확히 파악하고 에이전트에게 전달합니다

슬라이딩 윈도우 프로토콜:
- 대화 10회 도달 시: 자동으로 [프로젝트 요약 vN] 생성
- 요약 포함 항목: phase, 주요 결정 사항, 승인된 에셋 ID 목록, 다음 단계
- 요약 완료 후 이전 맥락 초기화

제약:
- 총괄 프로듀서는 항상 마지막으로 발언합니다
- 에이전트 간 의견 충돌 시 3가지 옵션을 사용자에게 제시합니다
- 슬라이딩 윈도우 요약은 300자 이내로 압축합니다

출력 형식: 공통 JSON 스키마 준수 + agent_notes.producer 필드 포함
`.trim();

const WEB_SEARCH: Anthropic.Messages.WebSearchTool20260209 = { type: "web_search_20260209", name: "web_search" };

export async function* producerAgent(
  client: Anthropic,
  context: string,
): AsyncGenerator<string> {
  const stream = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: PRODUCER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: context }],
    tools: [WEB_SEARCH],
    stream: true,
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}
