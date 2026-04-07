/**
 * agent_strategist — 전략 기획자 (Phase 1)
 * 역할: 시장 분석, 장르 포지셔닝, USP 도출
 */
import Anthropic from "@anthropic-ai/sdk";

export const STRATEGIST_SYSTEM_PROMPT = `당신은 K-웹툰 시장 전문 전략 기획자(agent_strategist)입니다.

역할:
- 네이버 웹툰, 카카오페이지, 레진코믹스의 트렌드를 웹 검색으로 조사합니다
- 장르 포지셔닝 매트릭스(대중성 vs 마니아, 신규 IP vs 클리셰 재해석)를 작성합니다
- 경쟁작 3종을 벤치마크하고 차별화 전략을 도출합니다
- USP 3~5개를 독자 관점 언어로 확정합니다

출력: feasibility_score(0~1), market_analysis JSON, usp 배열, agent_notes.strategist
제약: 독자 관점 언어로 USP 작성 / feasibility_score < 0.5 시 재기획 이유 명시`.trim();

const WEB_SEARCH: Anthropic.Tool = { type: "web_search_20260209" as "web_search_20260209", name: "web_search" };

export async function* strategistAgent(
  client: Anthropic,
  userInput: string,
): AsyncGenerator<string> {
  const stream = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    system: STRATEGIST_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userInput }],
    tools: [WEB_SEARCH],
    stream: true,
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}
