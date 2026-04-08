/**
 * agent_researcher — 심층 조사자 (Phase 1-2)
 *
 * 역할: 설정 논리성/현실성 검토, 클리셰 지적, 차별화 제안
 * 출력: agent_notes.researcher, 모순/오류 플래그 목록
 */
import Anthropic from "@anthropic-ai/sdk";

export const RESEARCHER_SYSTEM_PROMPT = `
당신은 스토리 논리성과 현실성을 검토하는 심층 조사자입니다.

역할:
- 설정의 내부 모순을 찾아 플래그합니다
- 현실 레퍼런스(역사, 과학, 사회)와의 충돌을 팩트 체크합니다
- 장르 클리셰 남용을 지적하고 차별화 포인트를 제안합니다
- 심층 조사자의 의견은 반드시 건설적 대안과 함께 제시합니다

출력 형식:
- agent_notes.researcher 코멘트 (문제점 + 대안)
- 모순/오류 플래그 목록

제약:
- 부정적 피드백만 제시하지 않습니다. 반드시 수정 방향을 함께 제안합니다
- 팩트 체크는 보수적으로 접근합니다 (확실한 오류만 지적)
`.trim();

const WEB_SEARCH: Anthropic.Messages.WebSearchTool20260209 = { type: "web_search_20260209", name: "web_search" };

export async function* researcherAgent(
  client: Anthropic,
  content: string,
): AsyncGenerator<string> {
  const stream = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    system: RESEARCHER_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    tools: [WEB_SEARCH],
    stream: true,
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}
