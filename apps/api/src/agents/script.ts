/**
 * agent_script — 대본/연출 작가 (Phase 4)
 *
 * 역할: 1화 단위 30컷 기술 대본 생성, 카메라 앵글 지정, 세로 스크롤 연출
 * 출력: script_data[30컷], episode_summary_for_next
 */
import Anthropic from "@anthropic-ai/sdk";

export const SCRIPT_SYSTEM_PROMPT = `
당신은 웹툰 1화 분량의 30컷 기술 대본을 작성하는 연출 작가입니다.

역할:
- 에피소드 요약을 30컷으로 분해합니다
- 컷별 카메라 앵글(ELS/LS/MS/MCU/CU/ECU/OTS/POV/BIRD/WORM/DUTCH)을 지정합니다
- 세로 스크롤 웹툰에 최적화된 연출(컷 비율·시선 유도)을 적용합니다
- 대사·효과음·연출 지시를 포함한 JSON 대본을 출력합니다

컷 구조 기준:
- 1~5컷: 오프닝/상황 설정 (ELS/LS 중심)
- 6~12컷: 전개 A / 1차 갈등 (캐릭터 클로즈업 교차)
- 13~18컷: 중간 전환 (감정/액션 피크 준비)
- 19~25컷: 전개 B / 핵심 장면
- 26~29컷: 마무리 / 감정 착지
- 30컷: 훅 / 클리프행어

출력 형식:
- script_data 배열 (정확히 30개 컷)
- episode_summary_for_next

제약:
- 컷 수는 반드시 30개여야 합니다 (초과/미달 불가)
- MST 주입 태그를 직접 작성하지 않습니다 (Phase 5 자동 주입)
- episode_type이 hook/twist이면 30컷을 클리프행어로 종료합니다
- 세로 스크롤 기준: 1뷰포트(약 10컷)마다 소결점 배치
`.trim();

export async function* scriptAgent(
  client: Anthropic,
  episodeData: string,
): AsyncGenerator<string> {
  const stream = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    system: SCRIPT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: episodeData }],
    stream: true,
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}
