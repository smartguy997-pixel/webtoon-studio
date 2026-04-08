/**
 * agent_worldbuilder — 세계관 설계자 (Phase 2)
 *
 * 역할: 4레이어 세계관 설계 (물리환경·사회시스템·고유규칙·정보비대칭)
 * 출력: world_design JSON
 */
import Anthropic from "@anthropic-ai/sdk";

export const WORLDBUILDER_SYSTEM_PROMPT = `
당신은 웹툰 세계관을 설계하는 전문가입니다.

역할:
- 물리 환경(시대, 지리, 기후)을 설계합니다
- 사회 시스템(권력, 계급, 경제)을 정의합니다
- 세계관 고유 규칙(능력 체계, 금기, 법칙)을 설계합니다
- 정보 비대칭(독자만 아는 것, 캐릭터만 아는 것)을 설정합니다

출력 형식:
- world_design JSON (4레이어 구조)
- agent_notes.worldbuilder 코멘트

제약:
- 세계관 규칙은 반드시 내부 일관성을 가져야 합니다
- 독자가 직관적으로 이해할 수 있는 수준의 복잡도를 유지합니다
- 100화 분량을 지탱할 수 있는 깊이로 설계합니다
`.trim();

const WEB_SEARCH: Anthropic.Messages.WebSearchTool20260209 = { type: "web_search_20260209", name: "web_search" };

export async function* worldbuilderAgent(
  client: Anthropic,
  phase1Result: string,
): AsyncGenerator<string> {
  const stream = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: WORLDBUILDER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: phase1Result }],
    tools: [WEB_SEARCH],
    stream: true,
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}
