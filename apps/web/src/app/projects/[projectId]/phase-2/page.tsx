"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import s from "./page.module.css";
import { streamClaude, getAnthropicKey, getAnthropicKeyByIndex, getAllAnthropicKeys } from "@/lib/claude-client";

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = {
  worldbuilder:    { label: "세계관설계자",     color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  ini: "세" },
  character:       { label: "캐릭터디자이너",   color: "#fb923c", bg: "rgba(251,146,60,0.12)",  ini: "캐" },
  scenario:        { label: "시나리오작가",     color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  ini: "시" },
  script:          { label: "연출작가",         color: "#f87171", bg: "rgba(248,113,113,0.12)", ini: "연" },
  producer:        { label: "총괄프로듀서",     color: "#f1f5f9", bg: "rgba(241,245,249,0.12)", ini: "총" },
  editor:          { label: "편집자",           color: "#fb923c", bg: "rgba(251,146,60,0.10)",  ini: "편" },
  foreshadowing:   { label: "복선암시설계자",   color: "#818cf8", bg: "rgba(129,140,248,0.12)", ini: "복" },
  audiencepanel:   { label: "독자패널",         color: "#34d399", bg: "rgba(52,211,153,0.12)",  ini: "독" },
  scriptwriter:    { label: "대본작가",         color: "#f472b6", bg: "rgba(244,114,182,0.12)", ini: "대" },
  meetingrecorder: { label: "회의록작성자",     color: "#94a3b8", bg: "rgba(148,163,184,0.07)", ini: "📋" },
  user:            { label: "나",               color: "#7c6cfc", bg: "rgba(124,108,252,0.12)", ini: "나" },
} as const;
type AgentId = keyof typeof AGENTS;

// 회의록 현황판 타입
interface MeetingDoc {
  confirmed: string[];   // ✅ 확정된 설정
  exploring: string[];   // ⏳ 논의 중인 아이디어
  rejected: string[];    // ❌ 거부된 방향
  user_prefs: string[];  // 👤 사용자 선호
}

// API 키 할당 (에이전트 인덱스 → 키 인덱스, 순환)
function getApiKeyIndexForAgent(agentIdx: number): number {
  const keys = getAllAnthropicKeys();
  if (keys.length === 0) return 0;
  return (agentIdx % Math.max(1, keys.length)) + 1;
}

// Runway API 키 — Settings에서 저장한 키 읽기
function getRunwayKey(): string {
  return (typeof window !== "undefined" ? localStorage.getItem("wts_runway_key") : null) ?? "";
}

const AGENT_ROLE_DESC: Partial<Record<AgentId, string>> = {
  worldbuilder:
    "너는 이 작품의 세계관 설계자야. 이야기가 펼쳐지는 세계의 뼈대 — 시대적 공기, 사회 계층, 권력 구조, 생활감, 금기 — 를 만드는 사람이야. " +
    "네가 집착하는 건 단 하나: 이 세계가 '실제로 존재할 수 있는가'. 설정에 구멍이 있으면 절대 그냥 넘어가지 마. " +
    "특히 시나리오작가가 '이야기를 위해' 세계관 규칙을 무시하려 하면 강하게 반박해. " +
    "세계관 규칙이 지켜져야 독자가 몰입한다. 추상적인 말 하지 말고, 구체적인 연도·장소·사회 규칙·생활 디테일로 얘기해.",

  character:
    "너는 이 작품의 캐릭터 디자이너야. 인물이 독자 마음속에 살아 숨쉬게 만드는 게 네 일이야. " +
    "네가 집착하는 건: 독자가 이 캐릭터를 사랑하거나 증오할 만한 이유가 있는가. " +
    "외형(얼굴·키·체형·복장·헤어)이 그 사람의 내면과 연결되어야 해. 상처가 말투에, 트라우마가 행동 습관에 드러나야 해. " +
    "세계관설계자가 '세계 규칙' 때문에 캐릭터를 억압하려 하면 맞서. '규칙이 캐릭터를 죽이면 독자가 떠난다'는 게 네 무기야. " +
    "반드시 구체적인 외형 묘사와 심리적 디테일로 말해.",

  scenario:
    "너는 이 작품의 시나리오 작가야. 이야기 전체의 뼈대 — 발단·전개·위기·절정·결말 — 를 설계하는 사람이야. " +
    "네가 집착하는 건: 독자가 다음 화를 안 읽고는 못 배기게 만드는 '인과의 사슬'. " +
    "모든 사건에는 원인이 있어야 하고, 감정 곡선은 독자를 지치게 하면 안 돼. " +
    "세계관설계자가 '설정상 불가능하다'고 막으면 '이야기가 우선이야, 설정은 이야기를 위해 존재해'라고 맞서. " +
    "복선암시설계자가 '지금 씨앗을 심자'고 하면 '지금 당장 재밌어야 해'로 긴장을 만들어. " +
    "구체적인 장면·사건·전환점으로 얘기해. 추상적인 말 하지 마.",

  script:
    "너는 이 작품의 연출 감독이야. 웹툰 컷 하나하나가 어떻게 보여야 하는지 설계하는 사람이야. " +
    "네가 집착하는 건: 이 장면이 그림으로 표현될 때 독자 눈에 꽂히는가. " +
    "앵글, 조명, 색감, 인물 배치, 시선 흐름, 컷 분할 — 영화 감독처럼 생각해. " +
    "시나리오작가가 이야기만 얘기하면 '그래서 이걸 어떻게 그림으로 보여줄 건데?'라고 파고들어. " +
    "대본작가가 대사만 강조하면 '비주얼 없는 대사는 반쪽짜리야'라고 맞서. " +
    "구체적인 컷 구성·색감·조명 묘사로 얘기해.",

  producer:
    "너는 이 작품의 총괄 프로듀서야. 모든 에이전트를 조율하고, 최선의 결과를 만들도록 이끄는 사람이야. " +
    "네가 집착하는 건 두 가지: 시장성(팔리는가)과 완성 가능성(실제로 만들 수 있는가). " +
    "너무 예술적이면 '이게 실제로 독자한테 팔려?' 하고 현실로 끌어내려. " +
    "의견이 충돌할 때만 끼어들어 정리해. 에이전트들이 합의를 못 하고 있으면 '결정하자, A안이냐 B안이냐'로 강제해. " +
    "설정이 추상적이면 '구체적으로 어떻게 보여?'라고 파고들어. 말은 짧고 결정적으로.",

  editor:
    "너는 베테랑 편집자야. 독자 입장에서 모든 걸 평가하는 사람이야. " +
    "네가 집착하는 건: 독자가 이탈하는 순간을 막는 것. " +
    "설정이 복잡하면 '독자가 이걸 이해할 수 있어?', 캐릭터가 매력 없으면 '독자가 왜 이 캐릭터를 응원해야 해?' " +
    "모든 에이전트한테 날카롭게 짚어. 특히 세계관이 너무 복잡해지면 '독자는 설정집 읽으러 온 게 아니야'라고 끊어. " +
    "짧고 핵심만. 칭찬보다 문제점 먼저. 항상 '독자라면 어떻게 느끼냐'를 기준으로 말해.",

  foreshadowing:
    "너는 이 작품의 복선·암시 설계자야. 독자가 나중에 '아, 그게 그거였어!' 하는 순간을 만드는 사람이야. " +
    "네가 집착하는 건: 지금 이 장면·대사·소품이 나중 어디서 회수될 것인가. " +
    "시나리오작가가 '지금 당장 재밌어야 해'라고 하면 '지금 심지 않으면 나중에 회수할 게 없어'라고 맞서. " +
    "구체적으로 말해: '1화에서 X를 보여주고 → 30화에서 Y로 회수한다', '이 소품은 사실 Z의 복선이어야 해'. " +
    "긴장감을 만드는 암시(불길한 예감, 미묘한 모순, 숨겨진 정보)도 네 영역이야. " +
    "단순한 '재밌는 전개'가 아니라 '나중이 기대되는 전개'를 설계해.",

  audiencepanel:
    "너는 독자 패널이야. 실제 다양한 독자층을 대변하는 사람이야. " +
    "발언할 때는 반드시 4가지 독자 반응을 각각 구분해서 말해: " +
    "① 10대 여학생 (로맨스·감정 중심), ② 20대 직장인 남성 (현실감·개연성 중시), " +
    "③ 30대 주부 (가족·관계·공감 중심), ④ 40대 남성 독자 (서사·반전·완성도 중시). " +
    "네가 집착하는 건: '이 작품이 실제로 클릭되고, 구독되고, 다음 화가 기다려지는가'. " +
    "모든 에이전트한테 솔직하게 말해 — 창작자들은 항상 독자를 과대평가해. " +
    "'이 설정, 독자는 5초 안에 이해 못 하면 넘긴다'는 현실을 직시시켜. " +
    "칭찬도 독자 입장에서, 비판도 독자 입장에서.",

  scriptwriter:
    "너는 이 작품의 대본 작가야. 실제 대사·지문·장면 묘사를 만드는 사람이야. " +
    "네가 집착하는 건: 이 대사가 입에서 자연스럽게 나오는가, 이 장면에서 독자가 웃거나 울거나 긴장하는가. " +
    "연출작가가 '비주얼'만 얘기하면 '아무리 예쁜 그림도 대사가 맛없으면 독자가 안 읽어'라고 맞서. " +
    "캐릭터의 말투·호흡·침묵의 타이밍까지 설계해. " +
    "설정이나 세계관을 대사로 자연스럽게 녹이는 것도 네 역할이야 — 설명충 대사는 절대 안 돼. " +
    "구체적인 대사 샘플을 들어서 얘기해. '이렇게 말하면 어때?' 식으로.",
};

// ─── 에이전트 명시적 지정 라우팅 ─────────────────────────────────────────────────
// 에이전트가 발언 끝에 `→ @agentId` 를 붙이면 다음 발언자를 지정할 수 있음
// pickNextSpeaker() 와 MsgBubble 이 모두 이 맵을 사용함

const NEXT_AGENT_ALIASES: Record<string, AgentId> = {
  // 영문 ID
  worldbuilder:  "worldbuilder",
  character:     "character",
  scenario:      "scenario",
  script:        "script",
  editor:        "editor",
  foreshadowing: "foreshadowing",
  audiencepanel: "audiencepanel",
  scriptwriter:  "scriptwriter",
  // 한국어 별칭
  세계관설계자:   "worldbuilder",
  세계관:         "worldbuilder",
  캐릭터디자이너: "character",
  캐릭터:         "character",
  시나리오작가:   "scenario",
  시나리오:       "scenario",
  연출작가:       "script",
  스크립트작가:   "script",
  연출가:         "script",
  편집자:         "editor",
  복선암시설계자: "foreshadowing",
  복선설계자:     "foreshadowing",
  복선:           "foreshadowing",
  독자패널:       "audiencepanel",
  독자:           "audiencepanel",
  대본작가:       "scriptwriter",
  대본:           "scriptwriter",
};

/** 텍스트에서 `→ @agentId` 패턴을 파싱해 AgentId 반환. 없으면 null. */
function parseNextAgent(text: string): AgentId | null {
  const m = text.match(/→\s*@([^\s\]]+)/);
  if (!m) return null;
  return (NEXT_AGENT_ALIASES[m[1]] ?? NEXT_AGENT_ALIASES[m[1].toLowerCase()] ?? null) as AgentId | null;
}

// ─── Phase 2 사용자 명령 패턴 ────────────────────────────────────────────────────
// 사용자가 특정 키워드 입력 시 즉시 반응하는 에이전트 라우팅

interface P2CommandPattern {
  triggers: string[];
  handler: "single_turn" | "end" | "break";
  speakerAgent?: AgentId;
  maxTokens?: number;
  promptOverride?: string;
}

const COMMAND_PATTERNS_P2: P2CommandPattern[] = [
  // 토론 종료
  {
    triggers: ["끝내자", "마무리해", "결론 내자", "결론내자", "종료해", "다음으로 가자", "다음 단계"],
    handler: "end",
  },
  // 요약/정리 요청
  {
    triggers: ["요약해줘", "요약 해줘", "지금까지 정리해줘", "내용 정리해줘", "정리해줘", "뭐가 나왔어"],
    handler: "single_turn",
    speakerAgent: "producer",
    maxTokens: 500,
    promptOverride:
      "{history}사용자가 지금까지 토론 내용을 요약해달라고 했어. " +
      "프로듀서로서 지금 단계에서 합의된 핵심 내용을 5~8문장으로 구체적으로 정리해줘. " +
      "이름·설정·관계 등 확정된 정보 위주로. 마크다운 금지.",
  },
  // 이미지/레퍼런스 요청
  {
    triggers: [
      "보여줘", "이미지 보여", "레퍼런스 보여", "그림 보여줘", "시각적으로 보여줘",
      "이미지로 보여", "비주얼 보여줘", "레퍼런스 찾아줘", "어떻게 생겼어", "어떤 느낌이야",
    ],
    handler: "single_turn",
    speakerAgent: "script",
    maxTokens: 200,
    promptOverride:
      "{history}사용자가 시각적 레퍼런스 이미지를 보고 싶다고 했어. " +
      "방금 토론에서 나온 핵심 시각 요소 1~2개를 골라 이미지 서치를 해줘. " +
      "반드시 이 형식 사용: 🖼️ 이미지 서치: \"구체적인 검색어\"\n" +
      "1~2문장 코멘트 추가 가능.",
  },
  // 설명/자세히 요청
  {
    triggers: [
      "설명해줘", "자세히", "더 자세히", "이유가 뭐야", "왜 그래", "근거가 뭐야",
      "무슨 말이야", "다시 말해줘", "이해 못 했어",
    ],
    handler: "single_turn",
    speakerAgent: "worldbuilder",
    maxTokens: 400,
    promptOverride:
      "{history}사용자가 방금 나온 내용에 대해 더 자세한 설명을 요청했어. " +
      "가장 최근 논의된 포인트를 골라 3~5문장으로 구체적으로 설명해줘. " +
      "이름, 이유, 맥락을 포함해서. 마크다운 금지.",
  },
  // 멈춤
  {
    triggers: ["멈춰", "잠깐", "그만해", "스톱", "stop", "잠깐만", "일시정지"],
    handler: "break",
    speakerAgent: "producer",
    maxTokens: 80,
    promptOverride: "사용자가 잠깐 멈추라고 했어. 알겠다고 짧게 말해줘.",
  },
];

function matchCommandP2(msg: string): P2CommandPattern | null {
  const lower = msg.toLowerCase().trim();
  return COMMAND_PATTERNS_P2.find(p => p.triggers.some(t => lower.includes(t))) ?? null;
}

// ─── Phase 2 스테이지별 아젠다 ──────────────────────────────────────────────────
// 각 스테이지마다 반드시 다뤄야 할 하위 주제들
// 스테이지별 주제당 최소 턴 수 — 세계관(1)은 깊이가 중요해서 더 많이
const MIN_TURNS_BY_STAGE: Record<number, number> = {
  1: 4,  // 세계관 프레임워크 — 주제당 4회 이상 언급돼야 완료
  2: 4,  // 시놉시스 4단계 워크플로우
  3: 5,  // 캐릭터 — 이름이 5회 이상 언급돼야 "이 인물 다뤘다" 처리
  4: 4,  // 장소 — 4회 이상 언급
  5: 3,  // 소품 — 3회 이상 언급
};
const MIN_TURNS_PER_TOPIC_P2 = 7; // fallback (UI 표시용)

const STAGE_AGENDA: Record<number, Array<{
  id: string;
  label: string;
  keywords: RegExp;
  nudge: string;
}>> = {
  1: [ // 세계관 — 드라마/웹툰/애니 5대 프레임워크
    { id: "atmosphere", label: "시대·공간적 공기",   keywords: /시대|배경|세기|현대|미래|과거|공간|도시|동네|거리|분위기|공기|냄새|질감|역사|연도|시절|결핍|생활|음식|의상|옷|유행어|일상|현실|디테일|공기감|거주|공간감|장소/,  nudge: "시대적 공기가 아직 얕아. 구체적인 연도와 그 시대만의 결핍·특징, 주인공이 머무는 핵심 공간의 생생한 디테일(색채·냄새·질감), 사람들이 무엇을 먹고 어떤 옷을 입으며 어떤 유행어를 쓰는지까지 파야 해." },
    { id: "social",     label: "사회적 압박·갈등",   keywords: /계급|권력|갑|을|재벌|서민|상사|부하|통념|가치관|당연|금기|taboo|선|장벽|결핍|압박|사회|규범|관습|위계|차별|불평등|억압|질서|체계|제도/,            nudge: "사회적 압박이 아직 모호해. 이 세계에서 갑/을 관계가 어떻게 형성되는지, '당연하게' 여겨지는 가치관이 무엇인지, 주인공이 절대 넘어선 안 되는 금기의 선이 무엇인지 구체적으로 파야 해." },
    { id: "whatif",     label: "만약에 설정",         keywords: /만약|핵심 규칙|특수 능력|초능력|능력|마법|대가|리스크|비밀|누가 알|정보|불균형|판타지|장르|비현실|설정|시스템|규칙|법칙|제약|힘|파워/,              nudge: "이 이야기를 장르물로 만드는 '만약에' 설정이 아직 불분명해. 현실과 딱 하나 다른 핵심 규칙이 뭔지, 그 능력·규칙에는 어떤 대가가 따르는지, 그리고 이 비밀을 누가 알고 누가 모르는지 정의해야 해." },
    { id: "dynamics",   label: "인물 관계·역학",      keywords: /인물|주인공|캐릭터|등장|사람|이름|과거사|계기|얽힌|목표|충돌|원하는|복수|용서|조력자|방해자|적|빌런|관계|역학|구도|동기|상처|역할|포지션|연결/,       nudge: "인물 관계의 역학이 아직 피상적이야. 인물들이 서로 얽히게 된 결정적 과거사, 각자가 원하는 것이 어떻게 충돌하는지, 그리고 주인공의 성장을 돕는 조력자와 가로막는 방해자의 포지션까지 명확히 설계해야 해." },
    { id: "theme",      label: "메시지·테마",          keywords: /테마|메시지|주제|하고 싶은 말|핵심|사랑|복수|가족|정의|성장|의미|작가|독자|감동|울림|방향|가치|철학|삶|죽음|희망|용기|진실/,                     nudge: "이 세계관이 궁극적으로 전하는 메시지가 무엇인지 얘기해야 해. 사랑·복수·가족애·정의 등 핵심 테마를 명확히 정의해야 모든 사건과 배경이 그 방향을 향해 달려갈 수 있어." },
  ],
  2: [ // 시놉시스 — 4단계 구조화 워크플로우 (진행 표시용)
    { id: "step_learning",  label: "① 세계관 학습",    keywords: /세계관|배경|설정|규칙|시대|공간|학습/,                                    nudge: "세계관 핵심 내용을 다시 한 번 짚어보자." },
    { id: "step_persona",   label: "② 페르소나 추출",  keywords: /인물|주인공|페르소나|후보|결핍|권력|고통|캐릭터|유형/,                       nudge: "이 세계관에서 가장 고통받을 인물, 가장 큰 권력을 가질 인물을 뽑아야 해." },
    { id: "step_logline",   label: "③ 로그라인 대결",  keywords: /로그라인|한 줄|아이러니|선택|제목|후크|hook/,                               nudge: "3명의 인물 후보로 서로 다른 느낌의 로그라인 5개를 써야 해." },
    { id: "step_synopsis",  label: "④ 시놉시스 완성",  keywords: /기획의도|타겟|장르|인카네이션|트리거|기승전결|비판|보완|스토리아크|완성/,      nudge: "선택된 로그라인을 기반으로 전체 시놉시스를 완성해야 해." },
  ],
  3: [ // 캐릭터 — 이전 단계 데이터 없을 때 폴백
    { id: "hero",      label: "주인공",       keywords: /주인공|히어로|주역|주연|리드|protagonist|주캐/,
      nudge: "주인공을 필수 항목까지 완성하자. ①성별·나이대·키·몸무게 ②체형(근육질/마른/보통 등) ③주요 복장 ④얼굴 묘사(이목구비·눈빛·표정 습관) ⑤성격 특징 3가지 이상 ⑥조력자·연인·가족 등 인물 관계 ⑦갈등 관계." },
    { id: "villain",   label: "빌런·적대자",  keywords: /빌런|악당|적|반동|대립|antagonist|보스|라이벌|악역/,
      nudge: "빌런·적대자를 필수 항목까지 설계하자. ①체형·외모 ②복장 ③성격 ④주인공과의 갈등 관계와 이유 ⑤목표와 동기." },
    { id: "support",   label: "조력자·단역",  keywords: /조력|서브|단역|주변|캐릭터|등장인물|인물|캐스팅|팀|동료|친구|스승/,
      nudge: "조력자와 단역들을 구체적으로 잡자. 이름·외형·성격·주인공과의 관계(어떤 도움을 주는지)·갈등 가능성." },
    { id: "relation",  label: "인물 관계·갈등", keywords: /관계|관계도|사이|갈등|우정|사랑|적대|가족|팀|연결|케미|구도|대립/,
      nudge: "인물들 사이의 관계와 갈등 구도를 정리하자. 누가 조력자고 누가 연인인지, 누가 최종 대립 관계인지 명확히." },
  ],
  4: [ // 장소 — 이전 단계 데이터 없을 때 폴백
    { id: "loctype",   label: "장소 유형·역할", keywords: /장소|배경|위치|공간|지역|동네|건물|도시|야외|실내|역할|기능/,
      nudge: "각 장소의 유형(야외/실내/건물)과 역할(대결 장소·안식처·사건 현장 등)을 정의해야 해." },
    { id: "visual_l",  label: "시각적 묘사",   keywords: /색채|색감|조명|빛|분위기|묘사|풍경|시각|디테일|낡|오래된|새|현대/,
      nudge: "각 장소를 그림처럼 묘사해줘. 시간대·날씨·세부 요소·역사적 배경 포함. 예: '1980년대 쌍문동 골목, 밤, 가로등 하나, 연탄재와 쓰레기, 멀리 북한산 실루엣'." },
    { id: "arch",      label: "공간 구조",     keywords: /구조|건축|인테리어|레이아웃|규모|크기|층|넓이|형태|재질/,
      nudge: "장소의 건축 구조와 공간 구성을 잡자. 크기·층수·재질·레이아웃 — 연출에 꼭 필요한 정보." },
    { id: "meaning",   label: "서사적 의미",   keywords: /의미|상징|역할|서사|사건|감정|기억|역사|중요|핵심|전환점/,
      nudge: "각 장소가 이야기에서 갖는 서사적·상징적 의미를 다뤄야 해. 이 장소에서 어떤 중요한 사건이 일어나는가." },
  ],
  5: [ // 소품·장비
    { id: "items",     label: "주요 소품",    keywords: /소품|아이템|물건|도구|장비|물품|용품|기물|오브제|prop/,               nudge: "이야기에서 핵심 역할을 하는 소품들을 뽑아보자. 이름·용도·시각적 특징." },
    { id: "weapons",   label: "탈것·무기",    keywords: /무기|탈것|차량|비행|선박|총|칼|검|방패|갑옷|장비|군사/,              nudge: "탈것이나 무기류를 설계해보자. 외형·재질·상태·누가 쓰는지까지." },
    { id: "visual_p",  label: "시각적 설계",  keywords: /외형|형태|색|재질|크기|상태|낡|새것|디테일|시각|묘사|그림|모양/,     nudge: "소품들의 시각적 설계를 세밀하게 잡자. 이미지 생성 프롬프트 수준으로 구체적으로." },
    { id: "symbol",    label: "상징·의미",    keywords: /상징|의미|역할|중요|핵심|복선|주인공과의 관계|이야기|서사|감정/,      nudge: "이 소품들이 이야기에서 어떤 상징적 의미를 갖는지 얘기해보자." },
  ],
};

// ─── 동적 아젠다 빌더: Stage 3/4/5는 이전 단계 결과에서 항목 추출 ──────────────────
type AgendaItem = { id: string; label: string; keywords: RegExp; nudge: string };

function buildDynamicAgenda(stageId: number, stageResults: Array<{ stageId: number; data: Record<string, unknown> }>): AgendaItem[] {
  const ns = (arr: unknown): Array<{ name: string }> =>
    Array.isArray(arr) ? (arr as Array<{ name: string }>).filter(x => x?.name) : [];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 캐릭터/장소 이름이 recentLines에 있을 때만 해당 항목 체크되도록
  // (?=.*이름) AND (?=.*필드 키워드) 방식으로 동시 존재 확인
  const both = (name: string, fields: string) =>
    new RegExp(`(?=.*${esc(name)})(?=.*(?:${fields}))`);

  const s1 = stageResults.find(r => r.stageId === 1)?.data;
  const s2 = stageResults.find(r => r.stageId === 2)?.data;

  if (stageId === 3) {
    const chars = ns(s2?.characters).length > 0 ? ns(s2?.characters) : ns(s1?.key_characters);
    if (chars.length > 0) {
      const items: AgendaItem[] = [];
      for (const c of chars) {
        const n = c.name;
        items.push(
          {
            id: `char_${n}_body`,
            label: `${n} — 신체`,
            keywords: both(n, "성별|나이대|나이|키|cm|몸무게|kg|체형|근육질|마른체형|보통체형|통통|왜소"),
            nudge: `${n}의 신체 정보가 빠져 있어. 성별·나이대·키·몸무게·체형(근육질/마른/보통 등)을 지금 정해줘.`,
          },
          {
            id: `char_${n}_face`,
            label: `${n} — 얼굴`,
            keywords: both(n, "얼굴|이목구비|눈|코|입|피부|인상|표정|눈빛|헤어|머리카락"),
            nudge: `${n}의 얼굴 묘사가 없어. 이목구비·눈빛·피부·인상·표정 습관·헤어 스타일까지 구체적으로 묘사해줘.`,
          },
          {
            id: `char_${n}_outfit`,
            label: `${n} — 복장`,
            keywords: both(n, "복장|옷|패션|스타일|의상|착용|입고|색상|소재|코트|자켓|셔츠|청바지|원피스"),
            nudge: `${n}의 주요 복장이 아직 정의 안 됐어. 색상·소재·스타일을 구체적으로 잡아줘.`,
          },
          {
            id: `char_${n}_personality`,
            label: `${n} — 성격`,
            keywords: both(n, "성격|특징|성향|무표정|내성적|외향적|활발|차분|냉정|다정|고집|예민|쿨|따뜻|도도|소심"),
            nudge: `${n}의 성격 특징이 부족해. 최소 3가지 이상 구체적으로 정의해줘 (예: 무표정하고 세상사에 관심 없음, 의외로 다정함).`,
          },
          {
            id: `char_${n}_relation`,
            label: `${n} — 관계`,
            keywords: both(n, "관계|조력자|연인|사랑하는|친구|가족|스승|동료|파트너|사이|케미"),
            nudge: `${n}과 다른 인물들의 관계가 정의 안 됐어. 누가 조력자이고 누구와 어떤 사이인지 명확히 해줘.`,
          },
          {
            id: `char_${n}_conflict`,
            label: `${n} — 갈등`,
            keywords: both(n, "갈등|대립|적|경쟁|반목|충돌|라이벌|적대|원수|싸움|대결"),
            nudge: `${n}의 갈등 관계가 빠져 있어. 누구와 왜 대립하고 어떻게 전개되는지 정해줘.`,
          },
        );
      }
      return items;
    }
  }

  if (stageId === 4) {
    const locs = ns(s2?.locations).length > 0 ? ns(s2?.locations) : ns(s1?.key_locations);
    if (locs.length > 0) {
      const items: AgendaItem[] = [];
      for (const l of locs) {
        const n = l.name;
        items.push(
          {
            id: `loc_${n}_type`,
            label: `${n} — 유형·역할`,
            keywords: both(n, "야외|실내|건물|복합|유형|역할|기능|용도|대결|안식처|사건 현장|배경 장소"),
            nudge: `${n}의 유형(야외/실내/건물)과 역할(대결 장소·안식처·사건 현장 등)을 정의해야 해.`,
          },
          {
            id: `loc_${n}_visual`,
            label: `${n} — 시각 묘사`,
            keywords: both(n, "묘사|풍경|가로등|조명|낡은|어두운|밝은|연탄|골목|밤|새벽|낮|오후|비|눈|날씨|역사|연대"),
            nudge: `${n}의 구체적 시각 묘사가 없어. 시간대·날씨·세부 요소·역사적 배경을 그림처럼 묘사해줘. 예: "1980년대 쌍문동 좁은 골목, 밤, 가로등 하나, 연탄재와 쓰레기, 멀리 북한산 실루엣".`,
          },
          {
            id: `loc_${n}_arch`,
            label: `${n} — 공간 구조`,
            keywords: both(n, "구조|건축|공간|규모|크기|층|레이아웃|재질|형태|넓이|좁은|긴|원형|사각"),
            nudge: `${n}의 공간 구조를 잡아야 해. 크기·층수·재질·레이아웃·특이한 구조물 등.`,
          },
        );
      }
      return items;
    }
  }

  if (stageId === 5) {
    const props = ns(s2?.props);
    if (props.length > 0) {
      return props.map(p => ({
        id: `prop_${p.name}`,
        label: p.name,
        keywords: both(p.name, "형태|색상|재질|크기|상태|낡은|새것|역할|상징|소유"),
        nudge: `${p.name} 소품을 구체적으로 설계하자. 형태·색상·재질·크기·상태·이야기 역할·상징·소유자까지.`,
      }));
    }
  }

  // 이전 단계 데이터가 없으면 정적 아젠다로 폴백
  return STAGE_AGENDA[stageId] ?? [];
}

// ─── Types ────────────────────────────────────────────────────────────────────

const STAGES = [
  { id: 1 as const, name: "세계관",     topic: "세계관 — 드라마·웹툰·애니를 위한 세계 설계: 시대적 공기·사회적 압박·만약에 설정·인물 역학·테마",  tag: "WORLD",  color: "#60a5fa", schema: '{"era":"구체적 시대 배경 (연도·장소명·그 시대의 결핍이나 특징)","core_space":"핵심 공간 (주인공이 주로 머무는 곳의 디테일 — 캐릭터 처지를 대변)","daily_life":"생활감 (사람들이 먹고·입고·쓰는 유행어 등 현실적 디테일)","power_hierarchy":"계급과 권력 (누가 갑이고 누가 을인가 — 재벌/서민, 상사/부하 등)","social_norms":"사회적 통념 (이 세계에서 당연하게 여겨지는 가치관)","taboo":"금기 (넘어서는 안 되는 선 — 주인공이 이 선을 넘을 때 갈등 폭발)","what_if_rule":"만약에 설정 (현실과 딱 하나 다른 핵심 규칙 — 장르물이면 필수, 현실물이면 생략 가능)","what_if_cost":"규칙의 대가 (초능력·행운에 따르는 리스크와 제약)","what_if_who_knows":"비밀의 공유 (이 설정을 누가 알고 누가 모르는가 — 정보 불균형이 긴장감 만듦)","key_characters":[{"name":"이름","role":"주인공/빌런/조력자/방해자","position":"이야기에서의 포지션 (돕는자/막는자/중립)","age":"나이/나이대","gender":"성별","face":"얼굴 특징 (이목구비·인상·표정 습관)","height":"키","build":"체형","outfit":"복장","personality":"성격 (3가지 이상)","motivation":"동기와 목표 (무엇을 원하고 왜)","backstory":"과거사와 내면의 상처","speech":"말투","goal_conflict":"다른 인물과의 목표 충돌"}],"key_locations":[{"name":"장소명","type":"유형","visual":"시각적 묘사","significance":"이야기에서의 역할"}],"character_backstory":"인물들이 서로 얽히게 된 결정적 계기 (과거사 요약)","goal_conflicts":"목표의 충돌 구조 (A는 복수를 원하고 B는 용서를 원할 때 등)","theme":"핵심 테마·메시지 (모든 사건과 배경이 향하는 주제 — 사랑/복수/가족애/정의 등)"}' },
  { id: 2 as const, name: "시놉시스",   topic: "시놉시스 — IP 전략가+수석 작가 관점: 로그라인·기획의도·세계관규칙·인카네이션·스토리아크·비판보완 + 에셋리스트",    tag: "SYNOPSIS",      color: "#34d399", schema: '{"logline":"한 문장 — 아이러니하고 시선을 끄는 로그라인","production_intent":"기획 의도 — 이 작품이 지금 이 시대에 왜 필요한가","target_audience":"핵심 타겟층 (나이·성별·관심사)","genre":"최적 장르 + 서브장르","world_rules":["이 세계에서만 작동하는 사회 규칙 1","규칙 2","규칙 3"],"protagonist":{"name":"이름","pain_point":"결핍(Pain point) — 무엇이 빠져있는가","want":"목표(Want) — 무엇을 원하는가","need":"진짜 필요 — 자신도 모르는 진짜 문제","incarnation":"왜 이 세계관에서만 이 결핍이 의미 있는가","arc":"캐릭터 아크 — 시작에서 끝까지 어떻게 변하는가"},"trigger":"사건의 트리거 — 세계관 특수 규칙이 주인공 일상과 충돌하는 첫 번째 대사건","story_arc":{"setup":"발단 — 주인공의 일상과 사건의 도화선","development":"전개 — 갈등 심화와 세계관 비밀 노출 시작","crisis":"위기 — 모든 것이 잘못될 때","climax":"절정 — 가장 극적인 대결 또는 선택","resolution":"결말 — 카타르시스와 변화","twist":"반전 — 독자가 예상 못할 전환점"},"world_exclusivity":"이 세계관이 아니면 절대 불가능한 이유","critique":"진부한 요소 지적 + 어떻게 신선하게 만들 것인가","characters":[{"name":"이름","role":"역할(주인공/빌런/조력자 등)","appearance":"외형 묘사 (얼굴·키·체형·복장·헤어·특징 — 구체적으로)","personality":"성격 키워드 3가지 이상","relation":"주인공과의 관계","image_prompt":"Runway Gen-4 영문 프롬프트 — [인물 외형: 인종·나이·헤어·복장·표정], [조명: 유형·방향·색온도], [카메라: 샷 종류·앵글], [분위기·스타일 키워드]. 예: Korean woman in her 20s, shoulder-length black hair, wearing worn denim jacket, looking away from camera, golden hour backlighting, medium close-up, webtoon line art style, melancholic mood"}],"locations":[{"name":"장소명","type":"유형","visual":"시각적 묘사 (건축·조명·색채·분위기·디테일 — 구체적으로)","significance":"이야기에서의 역할","image_prompt":"Runway Gen-4 영문 프롬프트 — [장소 묘사: 공간·건축·색채], [조명: 시간대·자연/인공·그림자], [카메라: 샷 종류·무브], [분위기·스타일]. 예: narrow alleyway between brutalist concrete buildings, flickering neon signs reflected on wet pavement, overcast night lighting, low-angle wide shot, Korean urban noir style, oppressive atmosphere"}],"props":[{"name":"소품명","type":"유형","visual":"시각적 묘사 (색·형태·재질·크기·상태 — 구체적으로)","story_role":"이야기 역할","owner":"소유자","image_prompt":"Runway Gen-4 영문 프롬프트 — [소품 묘사: 형태·색상·재질·상태·크기], [조명: 방향·색온도·반사], [카메라: 샷 종류], [스타일·분위기]. 예: worn leather notebook with frayed edges, dark brown with gold-stamped cover, sitting on wooden desk, soft desk lamp sidelight, extreme close-up, warm tones, webtoon still-life style"}],"key_scenes":[{"title":"장면 제목","location":"장소","characters":"등장 인물","action":"행동·상황 묘사","visual":"시각적 묘사 (구도·색감·조명·분위기)","emotion":"감정·분위기 키워드","image_prompt":"Runway Gen-4 영문 프롬프트 — [인물 행동·표정], [장소 배경], [조명: 시간·방향·색온도], [카메라: 샷·무브·앵글], [분위기·스타일]. 예: young man in hoodie running through rain-soaked alley, desperate expression, pursuing shadows behind him, dramatic side lighting with blue tones, tracking shot from low angle, Korean webtoon action style"}]}' },
  { id: 3 as const, name: "캐릭터 설정", topic: "등장인물 필수 설정 — 각 인물마다: ①성별·나이대·키·몸무게 ②체형(근육질/마른/보통 등) ③주요 복장 ④얼굴 묘사(이목구비·인상·표정 습관) ⑤성격 특징(3가지 이상) ⑥인물 관계(조력자·연인·가족 등) ⑦갈등 관계(대립·경쟁) ⑧기타 설정", tag: "CHARACTERS", color: "#fb923c",
    schema: '{"characters":[{"name":"이름","role":"주인공/빌런/조력자/단역","gender":"성별","age":"나이/나이대","height":"키 (대략적 수치 또는 cm)","weight":"몸무게 (대략적 수치 또는 kg)","build":"체형 — 근육질/마른/보통/통통/왜소 등 구체적으로","face":"얼굴 묘사 — 이목구비·인상·눈빛·피부·표정 습관 등 구체적으로","outfit":"주요 복장 — 색상·소재·스타일 구체적으로","personality":"성격 특징 — 3가지 이상 (예: 무표정하고 세상사에 관심 없음, 의외로 다정함)","motivation":"동기와 목표","speech":"말투","relationships":[{"character":"상대 인물 이름","type":"조력자/연인/친구/가족/스승 등","description":"관계 묘사 — 어떻게 만났고 어떤 사이인가"}],"conflicts":[{"character":"상대 인물 이름","type":"대립/경쟁/갈등/반목 등","description":"갈등 내용과 원인 — 왜 대립하고 어떻게 전개되는가"}],"story_role":"시놉시스·세계관에서의 역할","other":"기타 특이 설정 — 특수 능력·숨겨진 비밀·상징적 소품 등"}]}' },
  { id: 4 as const, name: "장소 설정",  topic: "주요 장소 필수 설정 — 각 장소마다: ①건물/야외/실내 구분 ②장소의 역할(대결 장소·안식처·사건 현장 등) ③구체적 시각 묘사(시간대·날씨·세부 요소·역사적 배경 포함)", tag: "LOCATIONS", color: "#a78bfa",
    schema: '{"locations":[{"name":"장소명","location_type":"야외/실내/건물/복합 — 구체적 유형","role":"장소의 역할 — 대결 장소/주인공 안식처/사건 현장/배경 장소 등 이야기에서의 기능","visual":"구체적 시각 묘사 — 시간대·날씨·세부 요소·역사적 배경·분위기를 그림처럼 묘사 (예: 1980년대 쌍문동 좁은 골목길, 밤, 흐린 하늘, 가로등 하나, 연탄재와 쓰레기가 쌓여 있음, 멀리 북한산 실루엣이 보임)","architecture":"건축/공간 구조 — 크기·층수·재질·레이아웃","lighting":"조명 특성 — 시간대·자연광/인공광·그림자 방향·색온도","color_palette":"색채 팔레트 — 주조색과 포인트색","atmosphere":"분위기 키워드","sound":"소리·냄새·촉감 등 감각 묘사","significance":"서사적 의미 — 이야기에서 이 장소가 왜 중요한가","symbolic_meaning":"상징적 의미"}]}' },
  { id: 5 as const, name: "소품·장비",  topic: "소품·장비·도구 — 탈것·무기·특수 아이템·장비·일상용품 등 이야기에서 중요한 모든 물건의 시각적 설계",  tag: "PROPS", color: "#e879f9", schema: '{"props":[{"name":"소품명","type":"유형(탈것/무기/장비/아이템/일상용품)","visual":"시각적 묘사 (색상·형태·재질·크기)","condition":"상태 (낡음/새것/특별히 장식됨 등)","function":"기능/용도","story_role":"이야기에서의 역할","symbolic_meaning":"상징적 의미","owner":"주요 소유자/사용자"}]}' },
];
type StageId = 1 | 2 | 3 | 4 | 5;

interface StageResult {
  stageId: StageId;
  data: Record<string, unknown>;
  summary: string;
  version?: number;  // 1-indexed, undefined = v1 (legacy)
}

interface ImageItem {
  type: "character" | "location" | "prop";
  name: string;
  description: string;
  stageId: StageId;
  imageUrl?: string;
  prompt?: string;
  confirmed: boolean;
}

interface ImageConcept {
  label: "A" | "B" | "C" | "D";
  direction: string;       // 영문 이미지 생성 방향 프롬프트
  imageUrl?: string;
  prompt?: string;
  generating: boolean;
  error?: string;
  recommendations: Array<{ agentId: AgentId; reason: string }>;
}

// Phase 1 → Phase 2 인계 데이터 타입 (최소한만)
interface P1Data {
  concept?: string;
  summary?: string;          // Phase 1 종합 요약
  final_report?: string;     // Phase 1 최종 보고서 (긴 텍스트)
  worldbuilding_notes?: Array<{ issue: string; suggestion: string; priority: string }>;
  similar_works?: Array<{ title: string; lesson: string; platform?: string; similarity?: string }>;
  strengths?: string[];
  weaknesses?: string[];
  improvements?: string[];   // 보강해야 할 점 (Phase 1 → Phase 2 액션 항목)
  genre_analysis?: { genre?: string; trend?: string; audience?: string; key_success?: string };
}

// Msg는 현재 단계 채팅 메시지만 담음 (단계 구분선/결과카드는 별도 렌더)
interface Msg {
  id: string;
  agent: AgentId;
  text: string;
  streaming: boolean;
  imageUrl?: string;
  replyQuote?: { agentLabel: string; preview: string }; // reply-to 인용
}

// 모델 선택
const DEBATE_MODELS_P2 = [
  { value: "claude-haiku-4-5-20251001", label: "Haiku", desc: "빠름 · 저비용" },
  { value: "claude-sonnet-4-6",         label: "Sonnet", desc: "균형 · 권장" },
  { value: "claude-opus-4-6",           label: "Opus",   desc: "최고품질 · 고비용" },
] as const;
type DebateModelP2 = typeof DEBATE_MODELS_P2[number]["value"];

type DebatePhase = "idle" | "running" | "confirming" | "confirmed" | "done" | "paused";

function uid() { return Math.random().toString(36).slice(2, 10); }

// ─── JSON block parsers ───────────────────────────────────────────────────────

function parseBlock<T>(text: string, tag: string): T | null {
  const re = new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${tag}\\]`);
  const m = text.match(re);
  if (!m) return null;
  try { return JSON.parse(m[1]) as T; } catch { return null; }
}

// ─── Phase 1 결과를 Phase 2 컨텍스트로 변환 ──────────────────────────────────

function buildPhase1Context(p1: P1Data): string {
  const parts: string[] = [];

  // 기획 개요 — 전체 개념 전달 (잘리면 Phase 2 방향이 달라짐)
  if (p1.concept) {
    parts.push(`[기획 개요 — 이 기획의 핵심. Phase 2는 이 방향을 그대로 발전시켜야 함]\n${p1.concept.slice(0, 600)}`);
  }

  // Phase 1 종합 요약 (AI가 정리한 핵심 인사이트)
  if (p1.summary) {
    parts.push(`[Phase 1 분석 요약]\n${p1.summary.slice(0, 400)}`);
  }

  // 장르·트렌드·타깃 독자 — 세계관/인물 설계에 직접 영향
  if (p1.genre_analysis) {
    const g = p1.genre_analysis;
    const lines = [
      g.genre && `장르: ${g.genre}`,
      g.trend && `트렌드: ${g.trend}`,
      g.audience && `타깃 독자: ${g.audience}`,
      g.key_success && `성공 요소: ${g.key_success}`,
    ].filter(Boolean);
    if (lines.length) parts.push(`[장르·시장 분석]\n${lines.join("\n")}`);
  }

  // 세계관 보완사항 — Phase 2에서 반드시 반영해야 할 항목
  if (p1.worldbuilding_notes?.length) {
    const order = { high: 0, medium: 1, low: 2 };
    const sorted = [...p1.worldbuilding_notes]
      .sort((a, b) => (order[a.priority as keyof typeof order] ?? 2) - (order[b.priority as keyof typeof order] ?? 2));
    parts.push(`[Phase 1→2 인계 사항 — 반드시 Phase 2에서 반영]\n${sorted.map(n => `· [${n.priority.toUpperCase()}] ${n.issue}: ${n.suggestion}`).join("\n")}`);
  }

  // 강점/약점 + 보강 방향
  const swLines = [
    ...(p1.strengths?.map(s => `+ ${s}`) ?? []),
    ...(p1.weaknesses?.map(w => `- ${w}`) ?? []),
  ];
  if (swLines.length) parts.push(`[기획 강점 / 약점]\n${swLines.join("\n")}`);

  if (p1.improvements?.length) {
    parts.push(`[보강해야 할 점 — Phase 2에서 해결]\n${p1.improvements.map(i => `· ${i}`).join("\n")}`);
  }

  // 유사 작품 — 레퍼런스 학습용
  if (p1.similar_works?.length) {
    const works = p1.similar_works
      .map(w => `· ${w.title}${w.platform ? ` (${w.platform})` : ""}: ${w.lesson}`)
      .join("\n");
    parts.push(`[참고 유사 작품 — 이 작품들의 장점을 우리 세계관·인물에 녹여내야 함]\n${works}`);
  }

  return parts.join("\n\n");
}

// ─── Prompt builders (단계별 독립 API 호출 + 이전 결과 컨텍스트) ──────────────

const STAGE_PROMPTS: Record<StageId, string> = {
  1: `세계관 — [기획분석]을 바탕으로 드라마·웹툰·애니메이션을 위한 세계를 설계해. 반드시 다음 5가지 프레임워크를 충분히 다뤄야 해:
① 시대적·공간적 공기: 구체적인 연도와 그 시대만의 결핍/특징. 주인공이 주로 머무는 핵심 공간의 디테일(캐릭터 처지를 대변). 사람들이 먹는 음식·입는 옷·쓰는 유행어 등 생활감.
② 사회적 압박과 갈등: 이 세계의 갑/을 관계(계급·권력). 당연하게 여겨지는 사회적 통념. 주인공이 넘어서면 갈등이 폭발하는 금기(Taboo).
③ 만약에 설정: 현실과 딱 하나 다른 핵심 규칙(장르물이면 필수). 그 능력/규칙에 따르는 대가와 리스크. 이 비밀을 누가 알고 누가 모르는가(정보 불균형이 긴장감을 만든다).
④ 인물 관계의 역학: 인물들이 서로 얽히게 된 결정적 과거사. 각자가 원하는 것이 어떻게 충돌하는가(A는 복수, B는 용서). 주인공의 성장을 돕는 조력자와 가로막는 방해자의 포지션.
⑤ 메시지와 테마: 이 세계관을 통해 하고 싶은 말. 사랑·복수·가족애·정의 등 핵심 테마.`,
  2: `시놉시스 완성 — IP 비즈니스 전략가 + 수석 작가 관점으로 다음 6가지를 완성해:\n① 로그라인: 한 문장, 아이러니하고 시선을 끄는 훅\n② 기획 의도: 이 작품이 지금 이 시대에 왜 필요한가\n③ 세계관 규칙: 이 세계에서만 작동하는 특별한 사회 규칙 3가지\n④ 인카네이션: 이 세계관에서만 의미 있는 결핍(Pain point)을 가진 주인공 정의\n⑤ 스토리 아크: 발단-전개-위기-절정-결말 + 반전 (세계관 비밀이 서서히 밝혀지는 구조)\n⑥ 비판과 보완: 진부한 요소 찾기 + 신선하게 만들 방법\n핵심 원칙: '이 세계관이 아니면 절대 불가능한 이야기'여야 한다.`,
  3: "등장인물 전체 목록 — 주인공·빌런·조력자·단역까지 이 이야기에 등장하는 모든 인물. 이름·역할·성별·나이·얼굴·키·체형·복장·성격·말투·동기·내면의 상처·세계관 역할. 이미지 생성 프롬프트로 바로 쓸 수 있을 만큼 시각적으로 구체적으로. 시놉시스에 이름이 나온 인물은 한 명도 빠지면 안 돼.",
  4: "장소 전체 목록 — 1화라도 등장하는 모든 장소. 이름·유형·건축 구조·조명·색채·소리·분위기·서사적 의미·상징. 영화 프로덕션 디자이너가 현장을 지을 수 있을 만큼 구체적으로. 스쳐 지나가는 배경도 시각적 정체성이 있어야 해.",
  5: "소품·장비·도구 전체 목록 — 탈것·무기·특수 아이템·장비·일상용품·상징물. 이야기에서 단 한 번이라도 의미 있게 등장하는 모든 물건. 색상·형태·재질·상태·크기, 소유자와의 관계까지. 영화 프랍 디자이너가 실제로 제작할 수 있는 수준으로.",
};

// 단계별 구조화 데이터 → 에이전트용 풍부한 다줄 요약 (모든 필드 포함)
function formatStageSummary(stageId: StageId, data: Record<string, unknown>): string {
  if (data.raw_summary) return String(data.raw_summary).slice(0, 800);
  const line = (...parts: (string | false | null | undefined)[]) =>
    parts.filter(Boolean).join(" ");
  try {
    switch (stageId) {
      case 1: {
        const chars = Array.isArray(data.key_characters)
          ? (data.key_characters as Record<string, string>[]).map(c =>
              [
                `  ▸ ${c.name ?? "?"}${c.role ? ` (${c.role})` : ""}${c.position ? ` [${c.position}]` : ""}${c.age ? ` · ${c.age}` : ""}${c.gender ? ` · ${c.gender}` : ""}`,
                c.face && `    얼굴: ${c.face}`,
                (c.height || c.build) && `    체형: ${[c.height, c.build].filter(Boolean).join(", ")}`,
                c.outfit && `    복장: ${c.outfit}`,
                c.personality && `    성격: ${c.personality}`,
                c.motivation && `    동기: ${c.motivation}`,
                c.backstory && `    과거: ${c.backstory}`,
                c.speech && `    말투: ${c.speech}`,
                c.goal_conflict && `    목표 충돌: ${c.goal_conflict}`,
              ].filter(Boolean).join("\n")
            ).join("\n")
          : "";
        const locs = Array.isArray(data.key_locations)
          ? (data.key_locations as Record<string, string>[]).map(l =>
              [
                `  ▸ ${l.name ?? "?"}${l.type ? ` (${l.type})` : ""}`,
                l.visual && `    시각: ${l.visual}`,
                l.significance && `    역할: ${l.significance}`,
              ].filter(Boolean).join("\n")
            ).join("\n")
          : "";
        return [
          data.era              && `[시대 배경] ${data.era}`,
          data.core_space       && `[핵심 공간] ${data.core_space}`,
          data.daily_life       && `[생활감] ${data.daily_life}`,
          data.power_hierarchy  && `[계급·권력] ${data.power_hierarchy}`,
          data.social_norms     && `[사회적 통념] ${data.social_norms}`,
          data.taboo            && `[금기] ${data.taboo}`,
          data.what_if_rule     && `[만약에 설정] ${data.what_if_rule}`,
          data.what_if_cost     && `[규칙의 대가] ${data.what_if_cost}`,
          data.what_if_who_knows && `[비밀의 공유] ${data.what_if_who_knows}`,
          chars                 && `[핵심 인물]\n${chars}`,
          data.character_backstory && `[얽힌 과거사] ${data.character_backstory}`,
          data.goal_conflicts   && `[목표 충돌] ${data.goal_conflicts}`,
          locs                  && `[주요 장소]\n${locs}`,
          data.theme            && `[테마] ${data.theme}`,
        ].filter(Boolean).join("\n");
      }
      case 2: {
        const protagonist = data.protagonist as Record<string,string> | null ?? null;
        const storyArc    = data.story_arc    as Record<string,string> | null ?? null;
        const chars  = Array.isArray(data.characters)  ? (data.characters  as Record<string,string>[]) : [];
        const locs   = Array.isArray(data.locations)   ? (data.locations   as Record<string,string>[]) : [];
        const scenes = Array.isArray(data.key_scenes)  ? (data.key_scenes  as Record<string,string>[]) : [];
        return [
          data.logline           && `로그라인: ${data.logline}`,
          data.production_intent && `기획의도: ${data.production_intent}`,
          data.target_audience   && `타겟: ${data.target_audience}`,
          data.genre             && `장르: ${data.genre}`,
          Array.isArray(data.world_rules) && `세계관 규칙: ${(data.world_rules as string[]).join(" / ")}`,
          protagonist && `주인공(${protagonist.name ?? "?"}): 결핍=${protagonist.pain_point ?? ""} / 목표=${protagonist.want ?? ""}`,
          protagonist?.incarnation && `인카네이션: ${protagonist.incarnation}`,
          data.trigger           && `트리거: ${data.trigger}`,
          storyArc && `스토리아크: 발단=${storyArc.setup ?? ""} / 절정=${storyArc.climax ?? ""} / 반전=${storyArc.twist ?? ""}`,
          data.critique          && `비판·보완: ${data.critique}`,
          chars.length  > 0 && `등장인물(${chars.length}명): ${chars.map(c => `${c.name}(${c.role})`).join(", ")}`,
          locs.length   > 0 && `장소(${locs.length}곳): ${locs.map(l => l.name).join(", ")}`,
          scenes.length > 0 && `핵심장면(${scenes.length}개): ${scenes.map(s => s.title).join(", ")}`,
        ].filter(Boolean).join("\n");
      }
      case 3:
        if (Array.isArray(data.characters)) {
          return (data.characters as Record<string, string>[]).map(c =>
            [
              `▸ ${c.name} (${c.role})`,
              c.personality && `  성격: ${c.personality}`,
              c.motivation  && `  동기: ${c.motivation}`,
              c.appearance  && `  외형: ${c.appearance}`,
              c.speech      && `  말투: ${c.speech}`,
            ].filter(Boolean).join("\n")
          ).join("\n");
        }
        break;
      case 4:
        if (Array.isArray(data.locations)) {
          return (data.locations as Record<string, string>[]).map(l =>
            [
              `▸ ${l.name}${l.type ? ` (${l.type})` : ""}`,
              l.visual       && `  시각: ${l.visual}`,
              l.architecture && `  구조: ${l.architecture}`,
              l.lighting     && `  조명: ${l.lighting}`,
              l.color_palette && `  색채: ${l.color_palette}`,
              l.atmosphere   && `  분위기: ${l.atmosphere}`,
              l.sound        && `  소리: ${l.sound}`,
              l.significance && `  서사적 의미: ${l.significance}`,
              l.key_scenes   && `  주요 장면: ${l.key_scenes}`,
              l.symbolic_meaning && `  상징: ${l.symbolic_meaning}`,
            ].filter(Boolean).join("\n")
          ).join("\n\n");
        }
        break;
      case 5:
        if (Array.isArray(data.props)) {
          return (data.props as Record<string, string>[]).map(p =>
            [
              `▸ ${p.name}${p.type ? ` (${p.type})` : ""}`,
              p.visual     && `  시각: ${p.visual}`,
              p.condition  && `  상태: ${p.condition}`,
              p.function   && `  기능: ${p.function}`,
              p.story_role && `  역할: ${p.story_role}`,
              p.symbolic_meaning && `  상징: ${p.symbolic_meaning}`,
              p.owner      && `  소유자: ${p.owner}`,
            ].filter(Boolean).join("\n")
          ).join("\n\n");
        }
        break;
    }
  } catch { /* ignore */ }
  return Object.entries(data).slice(0, 8)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 120)}`).join("\n");
}

// 이전 단계 결과를 에이전트가 읽기 쉬운 컨텍스트로 변환 (summary 필드 사용)
function buildContext(stageId: StageId, prevResults: StageResult[]): string {
  const relevant = prevResults.filter(r => r.stageId < stageId);
  if (!relevant.length) return "";

  return relevant.map(r => {
    const stage = STAGES.find(s => s.id === r.stageId)!;
    let extra = "";

    // Stage 3/4/5 진입 시 — 시놉시스 JSON 구조 데이터를 보충 (summary 텍스트 보완)
    if (stageId >= 3 && r.stageId === 2) {
      const d = r.data;
      const parts: string[] = [];

      if (d.logline)          parts.push(`로그라인: ${String(d.logline)}`);
      if (Array.isArray(d.world_rules) && (d.world_rules as string[]).length)
        parts.push(`세계관 규칙:\n${(d.world_rules as string[]).map((rule, i) => `  ${i + 1}. ${rule}`).join("\n")}`);

      const prot = d.protagonist as Record<string,string> | undefined;
      if (prot?.name) {
        parts.push([
          `주인공 — ${prot.name}`,
          prot.pain_point  ? `  결핍: ${prot.pain_point}` : "",
          prot.want        ? `  목표: ${prot.want}` : "",
          prot.incarnation ? `  인카네이션: ${prot.incarnation}` : "",
          prot.arc         ? `  아크: ${prot.arc}` : "",
        ].filter(Boolean).join("\n"));
      }

      if (d.trigger) parts.push(`사건의 트리거: ${String(d.trigger)}`);

      const arc = d.story_arc as Record<string,string> | undefined;
      if (arc) {
        parts.push([
          "스토리 아크:",
          arc.setup       ? `  발단: ${arc.setup}` : "",
          arc.development ? `  전개: ${arc.development}` : "",
          arc.crisis      ? `  위기: ${arc.crisis}` : "",
          arc.climax      ? `  절정: ${arc.climax}` : "",
          arc.resolution  ? `  결말: ${arc.resolution}` : "",
          arc.twist       ? `  반전: ${arc.twist}` : "",
        ].filter(Boolean).join("\n"));
      }

      if (parts.length) extra = `\n[시놉시스 핵심 구조]\n${parts.join("\n\n")}`;
    }

    // Stage 4/5 진입 시 — 세계관 핵심 설정도 보충
    if (stageId >= 4 && r.stageId === 1) {
      const d = r.data;
      const parts: string[] = [];
      if (d.era)            parts.push(`시대/배경: ${String(d.era)}`);
      if (d.core_space)     parts.push(`핵심 공간: ${String(d.core_space)}`);
      if (d.what_if_rule)   parts.push(`만약에 설정: ${String(d.what_if_rule)}`);
      if (d.social_norms)   parts.push(`사회적 통념: ${String(d.social_norms)}`);
      if (d.theme)          parts.push(`테마: ${String(d.theme)}`);
      if (parts.length) extra = `\n[세계관 핵심 구조]\n${parts.join("\n")}`;
    }

    return `[${stage.name} 확정]\n${r.summary}${extra}`;
  }).join("\n\n");
}

// 시놉시스에서 추출한 에셋 목록 타입
interface SynopsisAssets {
  characters: string[];
  locations: string[];
  props: string[];
}

// ── 실제 인물 여부 판별 ────────────────────────────────────────────────────────
// AI가 key_characters / characters 배열에 사회계층·조직·인용구·서술문 등을
// 잘못 넣는 경우를 걸러낸다.
function isRealCharacter(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  const n = name.trim();
  // 너무 긴 이름 = 서술문 (실제 인물명은 대부분 20자 이내)
  if (n.length > 22) return false;
  // 인용구 (따옴표·낫표로 시작)
  if (/^["'「『【'"]/.test(n)) return false;
  // 목표·태스크 서술 (~것., ~것을, ~에 대한, ~접근.)
  if (/것\.|것을\b|에 대한|에 관한|물리적 접근|기술을 보유/.test(n)) return false;
  // 문장형 어미 (동사로 끝나는 서술문)
  if (/(이다|다|했다|한다|된다|있다|없다|보유하고|저지른|감당하지|요청했다|봉인됐다|알려진|기록에)\s*\.?$/.test(n)) return false;
  // 사회 계층 레이블 (최상충:, 중간층, 하층: 등)
  if (/^(최상|상위|중상|중간|중하|하위|하층|상층|중층|최하|서민|귀족|노동|엘리트)/.test(n)) return false;
  if (/(충|층)\s*:?\s*$/.test(n)) return false;
  // 조직·단체·기관명 (개인 인물이 아님)
  if (/(관리단|정보단|특수단|연구단|수사대|작전대|조직망|단체|기관|위원회|부대|집단|리단|보관단)/.test(n)) return false;
  // 장소 키워드
  if (/골목|거리|길(?!\w)|집(?!\w)|방(?!법|향)|마을|학교|병원|건물|식당|카페|공장|시장|아파트|빌라|광장|공원|해변|산(?!\w)|강(?!\w)|호수|바다|센터|연구소|사무실|창고|지하|옥상|주택|빌딩|본부|기지|술집/.test(n)) return false;
  // 시간 표현
  if (/^\d{2,4}년|상반기|하반기|년대|세기|시절/.test(n)) return false;
  // 추상 개념
  if (/풍경|문화|계층|압박|규범|관습|금기|세계관|이념|역사|미디어|트렌드|가치관|분위기|구조|계급|체제|경제|정치/.test(n)) return false;
  return true;
}

// 에이전트 1명이 이전 토론을 읽고 반응하는 단일 역할 프롬프트
function buildSingleAgentPrompt(
  stageId: StageId,
  genre: string,
  agentId: AgentId,
  prevResults: StageResult[],
  p1Data?: P1Data | null,
  blockedItems: string[] = [],
  synopsisAssets?: SynopsisAssets | null,
): string {
  const agentLabel = AGENTS[agentId].label;
  const roleDesc = AGENT_ROLE_DESC[agentId] ?? "";
  const context = buildContext(stageId, prevResults);
  const p1Context = p1Data ? buildPhase1Context(p1Data) : "";

  const blockSection = blockedItems.length > 0
    ? `\n[🚫 절대 사용 금지 — 사용자가 거부한 이름·설정·방향]\n${blockedItems.map(w => `• ${w}`).join("\n")}\n이 항목들은 절대 언급·제안·인용하지 마. 어떤 맥락에서도 쓰지 마.\n`
    : "";

  // 이전 단계 JSON 데이터 — 설명 포함 체크리스트 생성에 사용
  const s1Data = prevResults.find(r => r.stageId === 1)?.data;
  const s2Data = prevResults.find(r => r.stageId === 2)?.data;

  // 에셋 목록 — 세계관·시놉시스에서 확정된 항목, 시각 묘사 + Runway 프롬프트 포함
  const s1chars   = Array.isArray(s1Data?.key_characters) ? (s1Data!.key_characters as Record<string,string>[]) : [];
  const s2chars   = Array.isArray(s2Data?.characters)     ? (s2Data!.characters     as Record<string,string>[]) : [];
  const s1locs    = Array.isArray(s1Data?.key_locations)  ? (s1Data!.key_locations  as Record<string,string>[]) : [];
  const s2locs    = Array.isArray(s2Data?.locations)      ? (s2Data!.locations      as Record<string,string>[]) : [];
  const s2props   = Array.isArray(s2Data?.props)          ? (s2Data!.props          as Record<string,string>[]) : [];

  let assetChecklist = "";
  if (synopsisAssets) {
    if (stageId === 3 && synopsisAssets.characters.length > 0) {
      // 주인공 인카네이션 별도 강조
      const prot = s2Data?.protagonist as Record<string,string> | undefined;
      const protSection = prot ? [
        `[📌 주인공 — 시놉시스 확정 설정]`,
        prot.name        ? `이름: ${prot.name}` : "",
        prot.pain_point  ? `결핍(Pain Point): ${prot.pain_point}` : "",
        prot.want        ? `목표(Want): ${prot.want}` : "",
        prot.need        ? `진짜 필요(Need): ${prot.need}` : "",
        prot.incarnation ? `인카네이션: ${prot.incarnation}` : "",
        prot.arc         ? `캐릭터 아크: ${prot.arc}` : "",
      ].filter(Boolean).join("\n") + "\n" : "";

      const lines = synopsisAssets.characters.map((name, i) => {
        const s1ch = s1chars.find(c => c.name === name);
        const s2ch = s2chars.find(c => c.name === name);
        const role = s2ch?.role ?? s1ch?.role ?? "";
        const desc = [
          (s2ch?.appearance ?? s1ch?.face) ? `외형: ${s2ch?.appearance ?? s1ch?.face}` : "",
          (s2ch?.personality ?? s1ch?.personality) ? `성격: ${s2ch?.personality ?? s1ch?.personality}` : "",
          s2ch?.relation ? `관계: ${s2ch.relation}` : "",
          (!s2ch && s1ch?.motivation) ? `동기: ${s1ch.motivation}` : "",
          s2ch?.image_prompt ? `Runway프롬프트(EN): ${s2ch.image_prompt}` : "",
        ].filter(Boolean).join(" / ");
        return `${i + 1}. **${name}**${role ? ` — ${role}` : ""}${desc ? `\n   ${desc}` : ""}`;
      }).join("\n");

      assetChecklist = `\n${protSection}[⚠️ 반드시 설계해야 할 캐릭터 목록]\n${lines}\n` +
        `시놉시스·세계관에서 확정된 인물들이야. 위 외형·성격 기반으로 Runway Gen-4 이미지 생성에 바로 쓸 수 있는 수준까지 구체화해.\n` +
        `얼굴·키·체형·복장·헤어·표정 습관·말투 + Runway 프롬프트(영문)까지 빠짐없이. 위 목록에 없는 인물이 필요하다면 추가로 설계해.\n`;

    } else if (stageId === 4 && synopsisAssets.locations.length > 0) {
      const lines = synopsisAssets.locations.map((name, i) => {
        const s1loc = s1locs.find(l => l.name === name);
        const s2loc = s2locs.find(l => l.name === name);
        const type  = s2loc?.type ?? s1loc?.type ?? "";
        const desc  = [
          (s2loc?.visual ?? s1loc?.visual) ? `시각: ${s2loc?.visual ?? s1loc?.visual}` : "",
          (s2loc?.significance ?? s1loc?.significance) ? `역할: ${s2loc?.significance ?? s1loc?.significance}` : "",
          s2loc?.image_prompt ? `Runway프롬프트(EN): ${s2loc.image_prompt}` : "",
        ].filter(Boolean).join(" / ");
        return `${i + 1}. **${name}**${type ? ` — ${type}` : ""}${desc ? `\n   ${desc}` : ""}`;
      }).join("\n");

      assetChecklist = `\n[⚠️ 반드시 설계해야 할 장소 목록]\n${lines}\n` +
        `시놉시스·세계관에서 확정된 장소들이야. 위 시각 묘사를 기반으로 Runway Gen-4 이미지 생성 가능 수준까지 설계해.\n` +
        `건축 구조·조명·색채 팔레트·분위기·냄새·소리 + Runway 프롬프트(영문)까지. 위 목록에 없는 장소가 필요하다면 추가로 설계해.\n`;

    } else if (stageId === 5 && synopsisAssets.props.length > 0) {
      const lines = synopsisAssets.props.map((name, i) => {
        const prop = s2props.find(p => p.name === name);
        const desc = [
          prop?.type         ? `유형: ${prop.type}` : "",
          prop?.visual       ? `시각: ${prop.visual}` : "",
          prop?.story_role   ? `역할: ${prop.story_role}` : "",
          prop?.owner        ? `소유자: ${prop.owner}` : "",
          prop?.image_prompt ? `Runway프롬프트(EN): ${prop.image_prompt}` : "",
        ].filter(Boolean).join(" / ");
        return `${i + 1}. **${name}**${desc ? `\n   ${desc}` : ""}`;
      }).join("\n");

      assetChecklist = `\n[⚠️ 반드시 설계해야 할 소품 목록]\n${lines}\n` +
        `시놉시스에서 확정된 소품들이야. 위 시각 묘사를 기반으로 Runway Gen-4 이미지 생성 가능 수준까지 설계해.\n` +
        `형태·색상·재질·크기·상태·디테일 + Runway 프롬프트(영문)까지. 위 목록에 없는 소품이 필요하다면 추가로 설계해.\n`;
    }
  }

  const isWorldbuildingStage = stageId === 1;
  const isSynopsisStage = stageId === 2;
  const productionMandate = isWorldbuildingStage
    ? `\n[⚠️ 드라마·웹툰·애니 세계관 설계 — 5개 프레임워크]\n이 토론은 제안→토론→합의 순서로 진행돼. 처음부터 확정하지 마 — 각자 방향을 제안하고 팀원들이 반응하면서 좁혀나가야 해.\n커버해야 할 5가지:\n1. 시대적·공간적 공기: 연도, 핵심 공간, 생활감\n2. 사회적 압박: 갑/을 구조, 통념, 금기\n3. 만약에 설정: 핵심 규칙 1가지, 대가, 정보 불균형\n4. 인물 역학: 과거사, 목표 충돌, 조력자/방해자\n5. 테마: 궁극적으로 전하는 메시지\n사용자가 개입하면 반드시 그 의견을 충분히 반영하고 논의를 이어가.\n`
    : isSynopsisStage
    ? `\n[⚠️ IP 비즈니스 전략가 + 수석 작가 관점]\n너는 지금 이 플랫폼의 대표작이 될 시놉시스를 기획하고 있어.\n반드시 명심: "이 세계관이 아니면 절대 불가능한 이야기"를 만들어야 해.\n\n완성해야 할 6가지:\n1. 로그라인: 한 문장 — 아이러니하고 시선을 끄는 훅\n2. 기획 의도: 이 작품이 지금 이 시대에 왜 필요한가\n3. 세계관 규칙: 이 세계에서만 작동하는 특별한 사회 규칙 3가지\n4. 인카네이션: 이 세계관에서만 의미 있는 결핍(Pain point)을 가진 주인공\n5. 스토리 아크: 발단-전개-위기-절정-결말 + 반전\n6. 비판과 보완: 진부한 요소 + 신선하게 만들 방법\n\n이 토론은 제안→토론→합의 순서로 진행돼. 처음부터 확정하지 마.\n사용자가 개입하면 반드시 그 의견을 충분히 반영하고 논의를 이어가.\n`
    : "";
  const responseGuide = isWorldbuildingStage
    ? "- 한 번 발언할 때 3~4문장. 의견을 제안하고 이유를 설명해. 다른 팀원 의견에 동의·반박·질문을 섞어.\n- 확정 선언 금지. '~이 좋을 것 같아', '~는 어때?', '~보다 ~이 더 낫지 않을까?' 같은 제안 어조로.\n- 사용자가 말하면 그 내용을 먼저 받아 충분히 반응한 뒤 이어가."
    : isSynopsisStage
    ? "- 한 번 발언할 때 2~3문장. 의견을 제안하고 이유를 설명해. 확정 선언 금지.\n- '~이 좋을 것 같아', '~는 어때?', '다른 방향도 있어' 같은 제안 어조로.\n- 사용자가 말하면 그 내용을 먼저 받아 충분히 반응한 뒤 이어가."
    : "- 딱 1~2문장. 짧을수록 좋아.";

  return `너는 웹툰 기획 팀의 ${agentLabel}야.
${blockSection}성격: ${roleDesc}
장르: ${genre}
${p1Context ? `\n[Phase 1 분석 결과 — 우리 작품의 방향]\n${p1Context}\n` : ""}${context ? `\n[우리 팀이 함께 만든 세계 — 이미 알고 있는 내용]\n${context}\n` : ""}${assetChecklist}${productionMandate}지금 주제: ${STAGE_PROMPTS[stageId]}

[대화 방식]
- 앞 사람 말 받아서 자연스럽게 이어가.
${responseGuide}
- ㅋㅋ ㅎㅎ 같은 자연스러운 표현 써도 돼.
- 이미 나온 얘기 반복하지 마.
- 대사만. 이름이나 접두어 붙이지 마.
- 마크다운(#, *, >, -) 금지. JSON 금지.
- "다음 단계", "단계 완료" 같은 말 하지 마.
- "못박아야 한다" 같은 딱딱한 표현 쓰지 마. 대신 "먼저 정하면 좋겠어", "설정해두면 어떨까", "결정해두는 게 좋을 것 같아" 같이 자연스럽게.
- 특정 팀원에게 발언을 넘기고 싶을 때만, 메시지 끝에 \`→ @에이전트ID\`를 붙여. 예: \`→ @character\`, \`→ @worldbuilder\`, \`→ @scenario\`, \`→ @script\`, \`→ @editor\`. 매번 쓰면 흐름이 딱딱해지니 꼭 필요할 때만.

[레퍼런스 이미지 서치]
시각적 레퍼런스가 필요할 때 딱 1번만 이렇게 써:
🖼️ 이미지 서치: "검색어"
검색어 예시: "사이버펑크 도시 컨셉아트", "판타지 성 배경", "다크 판타지 캐릭터 디자인"
발언당 최대 1개만. 실제 존재하는 작품이나 스타일 검색어를 써.`;
}

// 백엔드 API URL
const API_BASE = "http://localhost:4000";

// 스타일 토론 에이전트 프롬프트
function buildStyleAgentPrompt(
  genre: string,
  agentId: AgentId,
  worldSummary: string,
  synopsisSummary: string,
): string {
  const agentLabel = AGENTS[agentId].label;
  const roleDesc = AGENT_ROLE_DESC[agentId] ?? "";
  const isScriptAgent = agentId === "script";
  const imageSearchGuide = isScriptAgent
    ? `\n[이미지 서치 — 필수]\n매 발언마다 반드시 시각 레퍼런스 이미지를 1개 찾아줘:\n🖼️ 이미지 서치: "구체적인 검색어"\n예: 🖼️ 이미지 서치: "Korean webtoon dark fantasy ink style"\n예: 🖼️ 이미지 서치: "manga noir style urban thriller"\n검색어는 영어로, 스타일·분위기·작품 조합으로.`
    : `\n[이미지 서치 — 선택]\n레퍼런스 작품 언급할 때 이미지를 보여줄 수 있어:\n🖼️ 이미지 서치: "검색어" (발언당 최대 1개)`;

  return `너는 웹툰 기획 팀의 ${agentLabel}야.
성격: ${roleDesc}
장르: ${genre}

[우리 팀이 함께 만든 작품 — 이미 알고 있는 내용]
세계관: ${worldSummary.slice(0, 600)}
시놉시스: ${synopsisSummary.slice(0, 400)}

지금 주제: 이 작품에 맞는 시각적 스타일 정의
목표: 선화 스타일, 색채 팔레트, 분위기/톤을 구체적으로 합의
${imageSearchGuide}

[대화 방식]
- 앞 사람 말 받아서 자연스럽게 이어가.
- 딱 1~2문장.
- 구체적인 작품명·스타일 이름을 들어서 얘기해. (예: "귀멸의 칼날 색채에 헌터X헌터 선화 조합")
- 대사만. 이름 접두어 없음. 마크다운 금지. JSON 금지.`;
}

// 세계관(Stage1) + 시놉시스(Stage2) 컨텍스트를 하나로 합쳐 추출 프롬프트에 제공
// — 미언급 시각 세부사항 추론 기준으로 활용
function buildBibleContext(stageResults: StageResult[]): string | undefined {
  const s1 = stageResults.find(r => r.stageId === 1);
  const s2 = stageResults.find(r => r.stageId === 2);
  const parts: string[] = [];
  if (s1?.summary) parts.push(`[세계관]\n${s1.summary.slice(0, 600)}`);
  if (s2?.summary) parts.push(`[시놉시스]\n${s2.summary.slice(0, 800)}`);
  // 시놉시스 JSON의 캐릭터 시각 데이터 (appearance, image_prompt) 추가
  const s2chars = Array.isArray(s2?.data?.characters)
    ? (s2!.data.characters as Record<string, string>[])
    : [];
  if (s2chars.length) {
    const charLines = s2chars.map(c =>
      `${c.name ?? ""}(${c.role ?? ""}): ${[c.appearance, c.image_prompt].filter(Boolean).join(" / ")}`
    ).join("\n");
    parts.push(`[시놉시스 캐릭터 시각 데이터]\n${charLines}`);
  }
  return parts.length ? parts.join("\n\n") : undefined;
}

function buildExtractionPrompt(
  stageId: StageId,
  genre: string,
  debateText: string,
  synopsisContext?: string,  // Stage 2 요약 — 완전성 기준
): string {
  const stage = STAGES.find(s => s.id === stageId)!;
  const isBibleStage = stageId === 3 || stageId === 4 || stageId === 5;
  const locationFilter = (stageId === 2 || stageId === 4)
    ? `\n[장소 선별 원칙 — 엄격히 준수]\n` +
      `- 고유한 이름이 있는 구체적 장소만 포함 (예: "증곡동 폐차장 골목", "이서연의 반지하방", "성진고 옥상")\n` +
      `- "거리풍경", "3층 건물", "공원", "실내", "복도" 같은 일반 묘사·건축 설명은 절대 포함 금지\n` +
      `- 스토리에서 반복 등장하거나 중요한 사건이 일어나는 '이름 붙은' 공간만 리스트업\n`
    : "";
  const bibleNote = isBibleStage
    ? `\n[제작 바이블 원칙 — 반드시 준수]\n` +
      `- 등장인물: 시놉시스·세계관에 이름이 확정된 인물만 포함. 역할명(주인공/빌런/조력자)이 있으면 반드시 포함\n` +
      `- 토론에서 덜 다뤄진 항목도 기본 정보로 추가 (누락 금지)\n` +
      `${locationFilter}` +
      `\n[시각적 완전성 원칙 — 이미지 생성용]\n` +
      `- "미확정", "토론에서 미확정", "불명", "미정", "논의 필요" 등의 값은 절대 사용 금지\n` +
      `- 토론에서 명시적으로 언급되지 않은 시각적 세부사항(얼굴·체형·복장·색상 등)은\n` +
      `  장르(${genre})·세계관·시놉시스 맥락에 어울리도록 구체적으로 창작하여 채울 것\n` +
      `- 모든 시각적 필드는 이미지 생성 AI에 바로 입력할 수 있는 수준으로 작성\n` +
      `- 빈 문자열("")도 금지 — 반드시 의미 있는 묘사로 채울 것\n`
    : "";
  const synopsisNote = (isBibleStage && synopsisContext)
    ? `\n[세계관·시놉시스 컨텍스트 — 미언급 세부사항 추론 기준으로 활용]\n${synopsisContext.slice(0, 2500)}\n`
    : "";

  return `다음 토론에서 "${stage.name}" 관련 합의된 내용을 JSON으로 정리하세요.
${synopsisNote}${bibleNote}
토론:
${debateText.slice(0, 4000)}

장르: ${genre}

아래 형식으로만 출력 (JSON만, 설명 없이):
[${stage.tag}]
${stage.schema}
[/${stage.tag}]`;
}


// ─── 단계별 상세 요약 프롬프트 (fallback용) ──────────────────────────────────────

const STAGE_SUMMARY_PROMPTS: Record<StageId, string> = {
  1: `다음 토론에서 합의된 세계관을 드라마·웹툰·애니메이션 제작 바이블로 정리해주세요.
이 문서는 이후 모든 단계(시놉시스·캐릭터·장소·소품·이미지 생성)의 기준이 됩니다.
반드시 아래 5개 섹션을 ■ 기호로 구분하여 작성하세요. 각 항목을 충분히 서술하세요.

■ 시대적·공간적 공기 (Atmosphere)
  - 구체적인 연도(예: 1998년 IMF 시절, 2030년 초고령 사회)와 그 시대만의 결핍이나 특징
  - 핵심 공간: 주인공이 주로 머무는 장소(단칸방·재벌가 저택·학교·직장 등)의 디테일 — 이 공간이 캐릭터의 처지를 어떻게 대변하는가
  - 생활감: 사람들이 무엇을 먹고, 어떤 옷을 입으며, 어떤 유행어(키워드)를 쓰는지 등 현실적인 디테일

■ 사회적 압박과 갈등 요소 (Social Conflict)
  - 계급과 권력: 누가 갑이고 누가 을인가 (재벌과 서민, 상사와 부하, 일진과 빵셔틀 등)
  - 사회적 통념: 이 세계에서 '당연하게' 여겨지는 가치관 (예: "성공하려면 수단방법 가리지 마라")
  - 금기(Taboo): 넘어서는 안 되는 선 — 주인공이 이 선을 넘을 때 갈등이 폭발

■ 만약에 설정 (The "What If" Rule) — 장르물이면 필수, 현실물이면 생략 가능
  - 한 가지의 비현실성: "죽기 직전의 사람을 볼 수 있다면?" 같은 현실과 딱 하나 다른 핵심 규칙
  - 규칙의 대가: 초능력이나 행운에 따르는 반드시 존재하는 리스크
  - 비밀의 공유: 이 특수한 설정을 누가 알고 있고 누가 모르는가 (정보의 불균형이 긴장감을 만든다)

■ 인물 관계의 역학 (Character Dynamics)
  각 핵심 인물마다:
  **이름 (역할 — 주인공/빌런/조력자/방해자)**
  - 외형: 얼굴 특징, 키·체형, 복장 (이미지 생성에 쓸 수 있는 수준)
  - 성격: 3가지 이상 핵심 특성
  - 동기와 목표: 무엇을 원하고 왜
  - 내면의 상처와 과거사
  - 말투: 구체적인 말하는 방식
  - 포지션: 주인공을 돕는가 가로막는가 그리고 왜

  관계망:
  - 인물들이 서로 얽히게 된 결정적 계기 (과거사)
  - 목표의 충돌: A는 복수를 원하고, B는 용서를 원할 때 생기는 드라마
  - 조력자와 방해자의 포지션 명확화

■ 메시지와 테마 (Theme)
  - 핵심 테마: 사랑·복수·가족애·정의·성장 등 — 모든 사건과 배경이 향하는 주제
  - 작가가 이 세계관을 통해 독자에게 전하고 싶은 말
  - 이 이야기가 끝났을 때 독자가 무엇을 느끼고 가야 하는가

서술형 문장으로 풍부하게 작성하세요. 추상적 표현 금지 — 모든 항목에 구체적인 이름·숫자·장소명을 사용하세요.`,

  2: `다음 토론에서 합의된 시놉시스를 IP 제작 바이블 형식으로 정리해주세요.
이 문서는 이후 캐릭터·장소·소품·이미지 생성의 기반이 됩니다.

반드시 아래 순서로 ■ 기호를 사용하여 작성하세요:

■ 로그라인
  한 문장 — 아이러니하고 시선을 끄는 훅

■ 기획 의도
  이 작품이 지금 이 시대에 왜 필요한가. 시대적 맥락과 독자에게 주는 의미.

■ 세계관 규칙 3가지
  이 이야기 속에서만 작동하는 특별한 사회 규칙. 각각 한 줄로.

■ 인카네이션 — 주인공 정의
  - 이름, 나이, 직업/처지
  - Pain Point (결핍): 이 세계관 때문에 더 고통스러운 이유
  - Want (목표): 무엇을 원하는가
  - Need (진짜 필요): 자신도 모르는 진짜 문제
  - 왜 이 세계관이 아니면 이 결핍이 의미 없는가

■ 사건의 트리거
  세계관의 특수 규칙이 주인공 일상과 충돌하는 첫 번째 대사건. 구체적으로.

■ 스토리 아크 (발단-전개-위기-절정-결말)
  - 발단: 주인공의 일상 + 트리거 사건
  - 전개: 갈등 심화, 세계관 비밀이 서서히 드러남
  - 위기: 모든 것이 잘못될 때 (최저점)
  - 절정: 가장 극적인 대결 또는 선택
  - 결말: 카타르시스 + 주인공의 변화
  - 반전: 독자가 예상 못할 전환점 (어디서 오는가)

■ 비판과 보완
  이 시놉시스에서 진부하거나 식상한 요소. 그것을 어떻게 신선하게 바꿀 것인가.

■ 등장인물 리스트 (Runway Gen-4 이미지 생성용)
  각 인물마다:
  - 이름 / 역할
  - 외형 묘사: 얼굴·인상·키·체형·헤어 색상·복장·눈에 띄는 특징 (구체적으로)
  - 성격 키워드 3가지 이상 / 주인공과의 관계
  - Runway 프롬프트 (영문): [인물 외형·복장], [조명: 유형·방향·색온도], [카메라: 샷 종류·앵글], [분위기·화풍 키워드]
    예: "Korean woman early 20s, shoulder-length black hair, worn denim jacket, looking away, golden hour backlighting, medium close-up, webtoon line art, melancholic mood"

■ 장소 리스트 (Runway Gen-4 이미지 생성용)
  각 장소마다:
  - 장소명 / 유형 / 이야기 역할
  - 시각적 묘사: 건축·공간 구조·색채·주요 오브젝트 (구체적으로)
  - Runway 프롬프트 (영문): [공간 묘사·건축·색채], [조명: 시간대·자연/인공·색온도], [카메라: 샷 종류·무브], [분위기·화풍]
    예: "narrow alleyway between brutalist concrete buildings, neon reflections on wet pavement, overcast night, low-angle wide shot, Korean urban noir, oppressive atmosphere"

■ 소품 리스트 (Runway Gen-4 이미지 생성용)
  각 소품마다:
  - 이름 / 유형 / 소유자 / 이야기 역할
  - 시각적 묘사: 형태·색상·재질·크기·상태 (구체적으로)
  - Runway 프롬프트 (영문): [소품 묘사·재질·상태], [조명: 방향·색온도], [카메라: 샷 종류], [스타일·분위기]
    예: "worn leather notebook dark brown gold-stamped cover frayed edges, on wooden desk, soft desk lamp sidelight, extreme close-up, warm tones, webtoon still-life"

■ 핵심장면 리스트 (Runway Gen-4 이미지 생성용)
  각 장면마다:
  - 제목 / 장소 / 등장인물 / 감정 키워드
  - 행동·상황 묘사 (구체적으로)
  - Runway 프롬프트 (영문): [인물 행동·표정], [배경 장소], [조명: 시간·방향·색온도], [카메라: 샷·무브·앵글], [분위기·화풍]
    예: "young man in hoodie running through rain-soaked alley, desperate expression, shadows pursuing, blue dramatic side lighting, low-angle tracking shot, Korean webtoon action style"

서술형 문장으로 풍부하게 작성하세요.`,

  3: `다음 토론에서 합의된 등장인물을 상세히 정리해주세요.
각 인물은 이미지 생성과 시나리오 집필에 바로 활용할 수 있는 수준으로 작성합니다.

각 인물마다 반드시 포함할 내용:
■ 기본 정보: 이름, 나이/나이대, 성별
■ 시각적 특징 (이미지 생성용)
  - 얼굴: 이목구비 특징, 인상, 표정 습관
  - 키와 체형: 구체적 수치 또는 묘사 (예: 180cm, 마른 근육형)
  - 몸무게 또는 체형 묘사
  - 복장 스타일: 주로 입는 옷, 색상, 특징적 아이템
  - 헤어스타일과 색상
  - 눈에 띄는 특징 (흉터, 문신, 특이한 눈색 등)
■ 성격: 3~5가지 핵심 성격 특성 (상세히)
■ 말투: 구체적인 말하는 방식, 자주 쓰는 표현
■ 행동 동기와 목표: 무엇을 원하는가, 왜 그것을 원하는가
■ 내면의 상처나 비밀
■ 시놉시스·세계관에서의 역할: 이야기 전체에서 어떤 기능을 하는가
■ 다른 주요 인물과의 관계

각 인물을 풍부하게 서술하세요.`,

  4: `다음 토론에서 합의된 주요 장소를 프로덕션 디자인 바이블 수준으로 상세히 정리해주세요.
영화·애니메이션 프로덕션 디자이너가 실제로 공간을 설계할 수 있는 수준이어야 합니다.

각 장소마다 반드시 포함할 내용 (장소당 충분히 서술):
■ 장소 기본 정보
  - 이름, 유형 (실내/실외, 도시/자연 등)
  - 세계관에서의 위치와 규모

■ 시각적 묘사 — 눈에 그려질 수 있도록 구체적으로
  - 건축/공간 구조: 형태, 재질, 높이, 구획
  - 조명: 자연광/인공광, 방향, 시간대별 변화, 그림자
  - 색채 팔레트: 지배색, 보조색, 금지색 (이 공간에 어울리지 않는 색)
  - 주요 오브젝트와 소품: 눈에 띄는 것들
  - 소리 풍경: 어떤 소리가 들리는가 (바람, 기계, 군중, 침묵...)
  - 냄새: 어떤 냄새가 나는가

■ 분위기와 감정적 기능
  - 이 공간에 들어서는 순간 느끼는 감정
  - 계절/날씨/시간에 따른 분위기 변화
  - 캐릭터별로 이 공간이 다르게 느껴지는 방식

■ 서사적 역할
  - 이곳에서 일어나는 주요 장면/사건 (구체적으로)
  - 이 공간이 인물에게 갖는 개인적 의미
  - 이야기 전체에서의 상징적 기능

■ 이 장소의 역사와 비밀
  - 과거에 어떤 일이 있었는가
  - 숨겨진 공간이나 비밀이 있는가

서술형 문단과 구체적 묘사를 섞어 작성하세요.`,

  5: `다음 토론에서 합의된 소품·장비·도구를 영화·애니메이션 프랍 디자이너가 실제로 제작할 수 있는 수준으로 상세히 정리해주세요.
각 소품마다 이미지 생성에 바로 활용할 수 있는 수준의 시각적 묘사가 필요합니다.

각 소품·장비·도구마다 반드시 포함할 내용:
■ 기본 정보
  - 이름과 유형 (탈것 / 무기 / 장비 / 특수 아이템 / 일상용품 / 기타)
  - 주요 소유자 또는 사용자

■ 시각적 설계 (이미지 생성 가능 수준)
  - 전체적인 형태와 구조
  - 색상: 주조색, 보조색, 강조색
  - 재질과 질감 (금속 광택, 낡은 천, 녹슨 철, 나무결 등)
  - 크기와 비례 (사람과의 상대적 크기)
  - 상태: 새것/낡음/손상/특별히 개조됨/장식됨
  - 눈에 띄는 특징적 디테일 (로고, 흠집, 개조 부위, 특수 장치 등)

■ 기능과 용도
  - 실제 기능 (어떻게 작동하는가)
  - 이야기 속에서의 구체적 사용 방식

■ 서사적 역할과 상징
  - 이야기에서 어떤 역할을 하는가
  - 상징적 의미 (있다면)
  - 소유자와의 관계 (왜 이 인물이 이것을 가지고 있는가)

서술형 문장으로 풍부하게, 각 항목을 충분히 작성하세요.`,
};

// ─── 단계 결과 추출 ────────────────────────────────────────────────────────────
//
// 두 가지를 항상 병렬로 생성:
//   data    → 구조화 JSON (카드 UI 표시, 필드별 렌더링)
//   summary → 상세 내러티브 요약 (다음 단계 에이전트 컨텍스트용)
//
// summary는 STAGE_SUMMARY_PROMPTS 기반 LLM 생성 — JSON 스키마에 없는
// 토론 뉘앙스·관계성·배경 설명까지 포함.

async function extractStageData(
  stage: typeof STAGES[number],
  genre: string,
  debateText: string,
  apiKey: string,
  synopsisContext?: string,  // Stage 2 요약 — 완전성 기준으로 활용
): Promise<{ data: Record<string, unknown>; summary: string }> {

  const slicedDebate = debateText.slice(0, 8000);
  const isBibleStage = stage.id === 3 || stage.id === 4 || stage.id === 5;

  // ① JSON 추출 + ② 상세 내러티브 요약 — 병렬 실행
  const [jsonResult, narrativeResult] = await Promise.allSettled([

    // JSON 추출 (카드 UI용)
    (async () => {
      let fullText = "";
      try {
        for await (const chunk of streamClaude({
          apiKey,
          model: "claude-sonnet-4-6",
          systemPrompt: isBibleStage
            ? "웹툰 캐릭터·세계관 디자인 전문가입니다. 토론 내용을 JSON으로 변환하되, 명시적으로 논의되지 않은 시각적 세부사항(얼굴·체형·복장·색상 등)은 장르와 세계관에 어울리게 창의적으로 채웁니다. '미확정'·'불명' 같은 값은 절대 사용하지 않으며, 이미지 생성 AI에 바로 활용 가능한 수준으로 모든 시각 필드를 구체적으로 작성합니다. JSON 외에는 아무것도 출력하지 마세요."
            : "토론 결과를 정확한 JSON으로 변환하는 전문가입니다. 지정된 형식 외에 아무것도 출력하지 마세요.",
          messages: [{ role: "user", content: buildExtractionPrompt(stage.id, genre, slicedDebate, synopsisContext) }],
          maxTokens: (stage.id === 3 || stage.id === 4) ? 4000 : 2000,
        })) fullText += chunk;
      } catch { /* ignore */ }
      // 태그 파싱 → 루즈 JSON 파싱 순서로 시도
      const tagged = parseBlock<Record<string, unknown>>(fullText, stage.tag);
      if (tagged) return tagged;
      const m = fullText.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { /* ignore */ } }
      return null;
    })(),

    // 상세 내러티브 요약 (에이전트 컨텍스트용)
    (async () => {
      let text = "";
      try {
        for await (const chunk of streamClaude({
          apiKey,
          model: "claude-sonnet-4-6",
          systemPrompt: `웹툰 기획 전문가. 장르: ${genre}. 토론에서 합의된 내용을 다음 단계 작업자가 바로 활용할 수 있도록 빠짐없이, 구체적으로 정리합니다.`,
          messages: [{
            role: "user",
            content: `${STAGE_SUMMARY_PROMPTS[stage.id]}\n\n[토론 내용]\n${slicedDebate}`,
          }],
          maxTokens: 4000,
        })) text += chunk;
      } catch { /* ignore */ }
      return text.trim();
    })(),
  ]);

  let structured = jsonResult.status === "fulfilled" ? jsonResult.value : null;
  const narrative  = narrativeResult.status === "fulfilled" ? narrativeResult.value : "";

  // ③ 완전성 보충 — Stage 3/4/5에서 시놉시스 기준으로 누락 항목 추가
  // 토론에서 다루지 않은 인물·장소·소품을 자동으로 채워 바이블을 완성
  if (isBibleStage && structured && synopsisContext) {
    const listKey = stage.id === 3 ? "characters" : stage.id === 4 ? "locations" : "props";
    const currentList = Array.isArray(structured[listKey]) ? (structured[listKey] as Record<string, unknown>[]) : [];
    const currentNames = currentList.map(item => String(item.name ?? "")).filter(Boolean);

    let patchText = "";
    try {
      for await (const chunk of streamClaude({
        apiKey,
        model: "claude-sonnet-4-6",
        systemPrompt: "웹툰 제작 바이블 완전성 검증 전문가. 누락된 항목만 JSON 배열로 출력.",
        messages: [{
          role: "user",
          content:
            `[시놉시스]\n${synopsisContext.slice(0, 1500)}\n\n` +
            `[이미 추출된 ${stage.name} 목록]\n${currentNames.map(n => `- ${n}`).join("\n") || "(없음)"}\n\n` +
            `시놉시스에 언급되었지만 위 목록에 없는 ${stage.name}이 있으면 추가해줘.\n` +
            `없으면 빈 배열 []만 출력.\n\n` +
            `출력 형식 (JSON 배열만, 설명 없이):\n[PATCH]\n[${stage.schema.includes('"characters"') ? '{"name":"이름","role":"역할","gender":"","age":"","face":"","height":"","build":"","weight":"","outfit":"","personality":"","motivation":"","speech":"","story_role":""}' : stage.id === 4 ? '{"name":"장소명","type":"","visual":"","architecture":"","lighting":"","color_palette":"","atmosphere":"","sound":"","significance":"","key_scenes":"","symbolic_meaning":""}' : '{"name":"소품명","type":"","visual":"","condition":"","function":"","story_role":"","symbolic_meaning":"","owner":""}'}]\n[/PATCH]`,
        }],
        maxTokens: 1500,
        tools: [],
      })) patchText += chunk;
    } catch { /* ignore */ }

    const patchMatch = patchText.match(/\[PATCH\]\s*([\s\S]*?)\s*\[\/PATCH\]/);
    if (patchMatch) {
      try {
        const additions = JSON.parse(patchMatch[1]) as Record<string, unknown>[];
        if (Array.isArray(additions) && additions.length > 0) {
          structured = { ...structured, [listKey]: [...currentList, ...additions] };
        }
      } catch { /* ignore */ }
    }
  }

  // ④ Claude 기반 인물·장소·소품 클린업 — 모든 스테이지 적용
  // 토론에서 오염된 항목(사회계층·조직명·인용구·서술문·추상개념)을 Claude가 제거
  if (structured) {
    // 스테이지별 배열 키 매핑
    const charKey = stage.id === 1 ? "key_characters" : "characters";
    const locKey  = stage.id === 1 ? "key_locations"  : "locations";
    const propKey = "props";

    const rawChars = Array.isArray(structured[charKey]) ? (structured[charKey] as Record<string,unknown>[]) : [];
    const rawLocs  = Array.isArray(structured[locKey])  ? (structured[locKey]  as Record<string,unknown>[]) : [];
    const rawProps = Array.isArray(structured[propKey]) ? (structured[propKey] as Record<string,unknown>[]) : [];

    const charNames = rawChars.map(c => String(c.name ?? "")).filter(Boolean);
    const locNames  = rawLocs.map(l => String(l.name ?? "")).filter(Boolean);
    const propNames = rawProps.map(p => String(p.name ?? "")).filter(Boolean);

    if (charNames.length > 0 || locNames.length > 0 || propNames.length > 0) {
      let filterText = "";
      try {
        for await (const chunk of streamClaude({
          apiKey,
          model: "claude-sonnet-4-6",
          systemPrompt: "웹툰 에셋 분류 전문가. 실제 항목만 남기고 오염된 항목을 제거한다. JSON만 출력, 설명 없이.",
          messages: [{
            role: "user",
            content:
              `아래 목록에서 각 규칙에 맞는 항목만 남겨줘.\n\n` +
              `[등장인물 후보] (${charNames.length}개): ${charNames.join(" / ")}\n` +
              `[장소 후보] (${locNames.length}개): ${locNames.join(" / ")}\n` +
              `[소품 후보] (${propNames.length}개): ${propNames.join(" / ")}\n\n` +
              `규칙:\n` +
              `- characters: 고유 이름 있는 실제 개인 인물·존재만. 사회계층(최상층·중산층 등), 집단명, 조직명, 인용구("..."), 서술문(~했다/~된다), 목표 설명, 추상개념 절대 금지\n` +
              `- locations: 실제 물리적 장소(거리·건물·도시·지역·공간·시설)만. 추상적 상태·이념·사회현상·감정·역학관계 금지\n` +
              `- props: 실제 물건·도구·아이템만. 추상개념·상태·사회현상 금지\n` +
              `- 원본 이름 그대로 유지 (수정 금지), 해당 없으면 빈 배열\n\n` +
              `JSON만:\n{"characters":["이름"],"locations":["장소"],"props":["소품"]}`,
          }],
          maxTokens: 400,
          tools: [],
        })) { filterText += chunk; }
      } catch { /* ignore — 아래 isRealCharacter 필터로 폴백 */ }

      const fm = filterText.match(/\{[\s\S]*\}/);
      if (fm) {
        try {
          const filtered = JSON.parse(fm[0]) as { characters?: string[]; locations?: string[]; props?: string[] };
          const keepChars = new Set(filtered.characters ?? []);
          const keepLocs  = new Set(filtered.locations  ?? []);
          const keepProps = new Set(filtered.props      ?? []);

          if (keepChars.size > 0 || charNames.length === 0) {
            structured = { ...structured, [charKey]: rawChars.filter(c => keepChars.has(String(c.name ?? ""))) };
          }
          if (keepLocs.size > 0 || locNames.length === 0) {
            structured = { ...structured, [locKey]: rawLocs.filter(l => keepLocs.has(String(l.name ?? ""))) };
          }
          if (keepProps.size > 0 || propNames.length === 0) {
            structured = { ...structured, [propKey]: rawProps.filter(p => keepProps.has(String(p.name ?? ""))) };
          }
        } catch { /* ignore */ }
      }
    }

    // 2차 필터: isRealCharacter로 인물 배열 최종 정제
    const finalChars = Array.isArray(structured[charKey])
      ? (structured[charKey] as Record<string,unknown>[]).filter(c => isRealCharacter(String(c.name ?? "")))
      : [];
    structured = { ...structured, [charKey]: finalChars };
  }

  // data: 구조화 JSON 우선, 없으면 내러티브에서 기본 필드 파싱 시도, 최후엔 raw_summary
  let data: Record<string, unknown>;
  if (structured) {
    data = structured;
  } else if (narrative) {
    // 내러티브 텍스트에서 JSON 재추출 시도 (■ 섹션 기반 파싱)
    // Stage 1 전용: key_characters, key_locations 이름 목록만이라도 복원
    if (stage.id === 1) {
      const charSection = narrative.match(/■[^■]*인물[^■]*([\s\S]*?)(?=\n■|$)/);
      const locSection  = narrative.match(/■[^■]*장소[^■]*([\s\S]*?)(?=\n■|$)/);
      const extractNames = (block: string | null): Record<string,string>[] => {
        if (!block) return [];
        return [...block.matchAll(/\*\*([^*]+)\*\*/g)].map(m => ({ name: m[1].trim() }));
      };
      const chars = extractNames(charSection ? charSection[0] : null);
      const locs  = extractNames(locSection  ? locSection[0]  : null);
      data = {
        raw_summary: narrative,
        ...(chars.length ? { key_characters: chars } : {}),
        ...(locs.length  ? { key_locations:  locs  } : {}),
      };
    } else {
      data = { raw_summary: narrative };
    }
  } else {
    data = { raw_summary: "(추출 실패)" };
  }

  // summary: 내러티브 우선 (가장 상세), 없으면 JSON 기반 포맷
  const summary = narrative || formatStageSummary(stage.id, data);

  return { data, summary };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThinkingDots() {
  return <div className={s.dots}><span /><span /><span /></div>;
}

function StreamCursor() {
  return <span style={{ display: "inline-block", width: 2, height: 13, background: "#7c6cfc", marginLeft: 2, verticalAlign: "middle", borderRadius: 1, animation: "blink 0.9s step-start infinite" }} />;
}

function StageResultCard({ result, debateMsgs }: { key?: StageId; result: StageResult; debateMsgs?: Msg[] }) {
  const [modalTab, setModalTab] = useState<"data" | "context" | "debate" | null>(null);
  const stage = STAGES.find(s => s.id === result.stageId)!;
  const { data } = result;
  const c = stage.color;

  const row = (label: string, val: unknown) => val ? (
    <div key={label} style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"6px 0", borderBottom:"1px solid #1e1e2a" }}>
      <span style={{ fontSize:10, fontWeight:700, color:"#4a4a68", minWidth:72, flexShrink:0, paddingTop:2, textTransform:"uppercase" as const, letterSpacing:"0.4px" }}>{label}</span>
      <span style={{ fontSize:13, color:"#eeeef5", lineHeight:1.6 }}>{Array.isArray(val) ? (val as unknown[]).join(" · ") : String(val)}</span>
    </div>
  ) : null;

  // 카드에 표시할 한 줄 프리뷰
  const preview = (() => {
    if (result.stageId === 1) return data.era ? String(data.era).slice(0, 55) : "";
    if (result.stageId === 2) return data.logline ? String(data.logline).slice(0, 65) : "";
    if (result.stageId === 3) return Array.isArray(data.characters) ? `${(data.characters as unknown[]).length}명 설계 완료` : "";
    if (result.stageId === 4) return Array.isArray(data.locations) ? `${(data.locations as unknown[]).length}개 장소 설계 완료` : "";
    if (result.stageId === 5) return Array.isArray(data.props) ? `${(data.props as unknown[]).length}개 소품 설계 완료` : "";
    return "";
  })();

  // 모달 내 구조화 데이터 렌더
  const dataContent = (
    <div>
      {result.stageId === 1 && (
        <>
          {row("시대/배경", data.era)}
          {row("분위기", data.atmosphere)}
          {row("대립 구도", data.conflict_structure)}
          {row("협력 구도", data.alliance_structure)}
          {Array.isArray(data.key_characters) && (data.key_characters as Record<string,string>[]).length > 0 && (
            <div style={{ marginTop:12, marginBottom:10 }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#4a4a68", marginBottom:8, textTransform:"uppercase" as const, letterSpacing:"0.06em" }}>핵심 인물</div>
              {(data.key_characters as Record<string,string>[]).map((ch, i) => (
                <div key={i} style={{ marginBottom:10, paddingBottom:10, borderBottom:"1px solid #1e1e2a" }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#eeeef5", marginBottom:6 }}>
                    {ch.name} <span style={{ fontSize:11, color:"#7878a0" }}>({ch.role})</span>
                    {ch.age && <span style={{ fontSize:11, color:"#7878a0", marginLeft:6 }}>{ch.age}{ch.gender ? ` · ${ch.gender}` : ""}</span>}
                  </div>
                  {row("얼굴", ch.face)}{row("체형/복장", [ch.height, ch.build, ch.outfit].filter(Boolean).join(" · ") || undefined)}{row("성격", ch.personality)}{row("동기", ch.motivation)}{row("배경/상처", ch.backstory)}{row("말투", ch.speech)}
                </div>
              ))}
            </div>
          )}
          {Array.isArray(data.key_locations) && (data.key_locations as Record<string,string>[]).length > 0 && (
            <div style={{ marginTop:12, marginBottom:10 }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#4a4a68", marginBottom:8, textTransform:"uppercase" as const, letterSpacing:"0.06em" }}>주요 장소</div>
              {(data.key_locations as Record<string,string>[]).map((l, i) => (
                <div key={i} style={{ marginBottom:8, paddingBottom:8, borderBottom:"1px solid #1e1e2a" }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#eeeef5", marginBottom:4 }}>
                    {l.name}{l.type && <span style={{ fontSize:11, color:"#7878a0", marginLeft:6 }}>({l.type})</span>}
                  </div>
                  {row("시각", l.visual)}{row("조명/분위기", [l.lighting, l.atmosphere].filter(Boolean).join(" · ") || undefined)}{row("역할", l.significance)}
                </div>
              ))}
            </div>
          )}
          {row("세계 규칙", data.world_rules)}
          {row("특수 설정", data.special_elements)}
        </>
      )}
      {result.stageId === 2 && (
        <>
          {row("로그라인", data.logline)}
          {row("전제", data.premise)}
          {row("핵심 갈등", data.conflict)}
          {data.act1 && row("기(起)", data.act1)}
          {data.act2 && row("승(承)", data.act2)}
          {data.act3 && row("전(轉)", data.act3)}
          {data.act4 && row("결(結)", data.act4)}
          {row("테마", data.theme)}
          {Array.isArray(data.characters) && (data.characters as Record<string,string>[]).length > 0 && (
            <div style={{ marginTop:12, marginBottom:10 }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#4a4a68", marginBottom:8, textTransform:"uppercase" as const, letterSpacing:"0.06em" }}>등장인물</div>
              {(data.characters as Record<string,string>[]).map((ch, i) => (
                <div key={i} style={{ fontSize:12, color:"#94a3b8", marginBottom:4 }}>
                  <span style={{ color:"#eeeef5", fontWeight:600 }}>{ch.name}</span>
                  {ch.role && <span style={{ color:"#7878a0", marginLeft:6 }}>({ch.role})</span>}
                  {ch.appearance && <span style={{ color:"#64748b" }}> — {String(ch.appearance).slice(0,50)}</span>}
                </div>
              ))}
            </div>
          )}
          {Array.isArray(data.locations) && (data.locations as Record<string,string>[]).length > 0 && (
            <div style={{ marginTop:12, marginBottom:10 }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#4a4a68", marginBottom:8, textTransform:"uppercase" as const, letterSpacing:"0.06em" }}>주요 장소</div>
              {(data.locations as Record<string,string>[]).map((l, i) => (
                <div key={i} style={{ fontSize:12, color:"#94a3b8", marginBottom:4 }}>
                  <span style={{ color:"#eeeef5", fontWeight:600 }}>{l.name}</span>
                  {l.significance && <span style={{ color:"#64748b" }}> — {l.significance}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {result.stageId === 3 && Array.isArray(data.characters) && (data.characters as Record<string,string>[]).map((ch, i) => (
        <div key={i} style={{ marginBottom:12, paddingBottom:12, borderBottom:"1px solid #1e1e2a" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#eeeef5", marginBottom:6 }}>
            {ch.name} <span style={{ fontSize:11, color:"#7878a0" }}>({ch.role})</span>
            {ch.gender && <span style={{ fontSize:11, color:"#7878a0", marginLeft:6 }}>{ch.gender}{ch.age ? ` · ${ch.age}` : ""}</span>}
          </div>
          {row("얼굴", ch.face)}{row("키/체형", ch.height || ch.build ? [ch.height, ch.build, ch.weight].filter(Boolean).join(" · ") : undefined)}{row("복장", ch.outfit)}{row("성격", ch.personality)}{row("동기", ch.motivation)}{row("말투", ch.speech)}{row("세계관 역할", ch.story_role)}
        </div>
      ))}
      {result.stageId === 4 && Array.isArray(data.locations) && (data.locations as Record<string,string>[]).map((loc, i) => (
        <div key={i} style={{ marginBottom:12, paddingBottom:12, borderBottom:"1px solid #1e1e2a" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#eeeef5", marginBottom:6 }}>{loc.name} <span style={{ fontSize:11, color:"#7878a0" }}>({loc.type})</span></div>
          {row("시각", loc.visual)}{row("구조", loc.architecture)}{row("조명", loc.lighting)}{row("색채", loc.color_palette)}{row("분위기", loc.atmosphere)}{row("소리", loc.sound)}{row("서사적 의미", loc.significance)}{row("주요 장면", loc.key_scenes)}{row("상징", loc.symbolic_meaning)}
        </div>
      ))}
      {result.stageId === 5 && Array.isArray(data.props) && (data.props as Record<string,string>[]).map((p, i) => (
        <div key={i} style={{ marginBottom:12, paddingBottom:12, borderBottom:"1px solid #1e1e2a" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#eeeef5", marginBottom:6 }}>
            {p.name} <span style={{ fontSize:11, color:"#7878a0" }}>({p.type})</span>
            {p.owner && <span style={{ fontSize:11, color:"#7878a0", marginLeft:6 }}>· {p.owner}</span>}
          </div>
          {row("시각", p.visual)}{row("상태", p.condition)}{row("기능", p.function)}{row("역할", p.story_role)}{row("상징", p.symbolic_meaning)}
        </div>
      ))}
      {data.raw_summary && renderNarrativeSummary(String(data.raw_summary), c)}
    </div>
  );

  return (
    <>
      {/* ── 컴팩트 카드 ── */}
      <div style={{ background:`${c}0a`, border:`1px solid ${c}28`, borderRadius:8, padding:"8px 12px", marginBottom:6, display:"flex", alignItems:"center", gap:10 }}>
        {/* 색상 도트 */}
        <div style={{ width:7, height:7, borderRadius:"50%", background:c, flexShrink:0 }} />
        {/* 텍스트 */}
        <div style={{ flex:1, minWidth:0 }}>
          <span style={{ fontSize:11, fontWeight:800, color:c, textTransform:"uppercase" as const, letterSpacing:"0.6px" }}>✓ {stage.name} 완료</span>
          {preview && (
            <span style={{ fontSize:11, color:"#5a5a7a", marginLeft:8, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const }}>
              {preview}
            </span>
          )}
        </div>
        {/* 버튼들 */}
        <div style={{ display:"flex", gap:4, flexShrink:0 }}>
          <button
            onClick={() => setModalTab("data")}
            style={{ fontSize:11, fontWeight:600, color:"#7878a0", background:"transparent", border:"1px solid #2a2a3d", borderRadius:5, padding:"3px 9px", cursor:"pointer" }}>
            🗂 보기
          </button>
          {result.summary && (
            <button
              onClick={() => setModalTab("context")}
              style={{ fontSize:11, fontWeight:600, color:"#7878a0", background:"transparent", border:"1px solid #2a2a3d", borderRadius:5, padding:"3px 9px", cursor:"pointer" }}>
              📋 전달
            </button>
          )}
          {debateMsgs && debateMsgs.length > 0 && (
            <button
              onClick={() => setModalTab("debate")}
              style={{ fontSize:11, fontWeight:600, color:"#7878a0", background:"transparent", border:"1px solid #2a2a3d", borderRadius:5, padding:"3px 9px", cursor:"pointer" }}>
              💬 토론
            </button>
          )}
        </div>
      </div>

      {/* ── 모달 오버레이 ── */}
      {modalTab !== null && (
        <>
          {/* 배경 딤 — pointer-events: none으로 채팅 입력창은 그대로 사용 가능 */}
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", pointerEvents:"none", zIndex:900 }} />
          {/* 모달 박스 */}
          <div style={{
            position:"fixed",
            top:"50%", left:"50%",
            transform:"translate(-50%,-50%)",
            zIndex:901,
            width:"min(700px, 92vw)",
            maxHeight:"72vh",
            display:"flex",
            flexDirection:"column",
            background:"#14141e",
            border:`1px solid ${c}40`,
            borderRadius:14,
            boxShadow:"0 24px 60px rgba(0,0,0,0.7)",
            overflow:"hidden",
          }}>
            {/* 헤더 */}
            <div style={{ padding:"14px 18px 12px", borderBottom:`1px solid ${c}20`, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background:c }} />
                <span style={{ fontSize:13, fontWeight:800, color:c, letterSpacing:"0.3px" }}>✓ {stage.name}</span>
                {/* 탭 */}
                <div style={{ display:"flex", gap:4, marginLeft:4 }}>
                  {(["data", "context", "debate"] as const).map(tab => {
                    if (tab === "context" && !result.summary) return null;
                    if (tab === "debate" && (!debateMsgs || debateMsgs.length === 0)) return null;
                    const labels = { data:"결과", context:"전달 내용", debate:"토론 기록" };
                    const active = modalTab === tab;
                    return (
                      <button key={tab} onClick={() => setModalTab(tab)}
                        style={{ fontSize:11, fontWeight:700, color: active ? c : "#4a4a6a", background: active ? `${c}18` : "transparent", border:`1px solid ${active ? c : "#2a2a3d"}`, borderRadius:5, padding:"2px 9px", cursor:"pointer" }}>
                        {labels[tab]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                onClick={() => setModalTab(null)}
                style={{ fontSize:17, lineHeight:1, color:"#5a5a7a", background:"transparent", border:"none", cursor:"pointer", padding:"0 4px" }}>
                ✕
              </button>
            </div>
            {/* 스크롤 내용 */}
            <div style={{ padding:"16px 18px 20px", overflowY:"auto", flex:1 }}>
              {modalTab === "data" && dataContent}
              {modalTab === "context" && result.summary && (
                <pre style={{ fontSize:12, color:`${c}cc`, lineHeight:1.8, whiteSpace:"pre-wrap" as const, margin:0, fontFamily:"inherit" }}>
                  {result.summary}
                </pre>
              )}
              {modalTab === "debate" && debateMsgs && (
                debateMsgs.length === 0
                  ? <div style={{ fontSize:13, color:"#4a4a6a" }}>저장된 토론 내용이 없습니다.</div>
                  : debateMsgs.map((m: Msg) => <MsgBubble key={m.id} msg={m} />)
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── 스테이지 완료 보고서 (채팅 인라인) ───────────────────────────────────────
// Phase 1의 FinalReportSection과 동일한 패턴: 채팅 바디 안에 직접 렌더

// ─── 공용 내러티브 요약 렌더러 ────────────────────────────────────────────────────
// StageReportInChat, VersionHistoryModal 양쪽에서 공유
function renderNarrativeSummary(text: string, c: string) {
  const SECTION_ICONS: [string, string][] = [
    ["시대", "🌍"], ["배경", "🌍"], ["세계", "🌍"], ["공기", "🌍"], ["드라마", "🎬"], ["제작", "🎬"], ["바이블", "📖"],
    ["인물", "👤"], ["캐릭터", "👤"], ["등장인물", "👥"], ["관계", "🔗"], ["역학", "🔗"],
    ["장소", "🏙"], ["공간", "🏙"],
    ["갈등", "⚔️"], ["대립", "⚔️"], ["압박", "⚔️"], ["협력", "🤝"], ["연대", "🤝"], ["사회", "⚔️"],
    ["규칙", "📜"], ["법칙", "📜"], ["만약에", "✨"], ["what if", "✨"],
    ["로그라인", "💡"], ["의도", "💡"], ["기획", "💡"],
    ["요약", "📝"], ["정리", "📝"],
    ["플롯", "📖"], ["전개", "📖"], ["기승전결", "📖"], ["시놉시스", "📖"], ["스토리", "📖"],
    ["테마", "🎭"], ["주제", "🎭"], ["메시지", "🎭"],
    ["스타일", "🎨"], ["화풍", "🎨"], ["역할", "🎯"],
  ];
  const getIcon = (title: string) => {
    const lower = title.toLowerCase();
    for (const [kw, icon] of SECTION_ICONS) if (lower.includes(kw.toLowerCase())) return icon;
    return "📋";
  };

  // ── 본문 라인 렌더러 (공유) ────────────────────────────────────────────────────
  const renderBodyLines = (bodyText: string, color: string) => {
    const paragraphs = bodyText.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) return null;
    return (
      <>
        {paragraphs.map((para, pi) => {
          const paraLines = para.split("\n");
          const nodes: JSX.Element[] = [];
          paraLines.forEach((rawLine, li) => {
            const t = rawLine.trim();
            if (!t) return;
            const isHorizRule = /^---+$/.test(t);
            const isBullet    = /^[-•*]\s/.test(t);
            const isSubHdr    = /^\*\*([^*]+)\*\*\s*$/.test(t) || /^\*\*([^*]+)\*\*[:：]/.test(t);
            const isMdHdr     = /^#{1,3}\s/.test(t);  // # / ## / ### 마크다운 헤더
            const content     = t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/^[-•*]\s*/, "").replace(/^#{1,3}\s*/, "").trim();
            if (isHorizRule) {
              nodes.push(<hr key={`hr-${li}`} style={{ border:"none", borderTop:`1px solid ${color}18`, margin:"8px 0" }} />);
            } else if (isMdHdr) {
              nodes.push(<div key={`mh-${li}`} style={{ fontSize:13, fontWeight:700, color:"#e2e8f0", borderBottom:`1px solid #1e1e2a`, paddingBottom:4, marginBottom:6, marginTop: li > 0 ? 10 : 0 }}>{content}</div>);
            } else if (isSubHdr) {
              nodes.push(<div key={`sh-${li}`} style={{ fontSize:13, fontWeight:700, color:"#e2e8f0", borderBottom:`1px solid #1e1e2a`, paddingBottom:4, marginBottom:6, marginTop: li > 0 ? 10 : 0 }}>{content}</div>);
            } else if (isBullet || content.length <= 60) {
              nodes.push(<div key={`b-${li}`} style={{ display:"flex", gap:6, fontSize:13, color:"#c8d0e0", lineHeight:1.75, marginBottom:3 }}><span style={{ color:`${color}90`, fontSize:10, flexShrink:0, paddingTop:4 }}>▸</span><span>{content}</span></div>);
            } else {
              nodes.push(<p key={`p-${li}`} style={{ fontSize:13, color:"#c8d0e0", lineHeight:1.85, margin:`0 0 ${li < paraLines.length - 1 ? 6 : 0}px` }}>{content}</p>);
            }
          });
          return <div key={pi} style={{ marginBottom: pi < paragraphs.length - 1 ? 12 : 0 }}>{nodes}</div>;
        })}
      </>
    );
  };

  // ── 섹션 카드 렌더러 (공유) ────────────────────────────────────────────────────
  const renderSectionCards = (sections: Array<{ title: string; body: string }>) => (
    <div style={{ display:"flex", flexDirection:"column" as const, gap:10 }}>
      {sections.map((section, idx) => {
        const icon = getIcon(section.title);
        return (
          <div key={idx} style={{ background:"#10101c", borderRadius:12, overflow:"hidden", border:`1px solid ${c}30` }}>
            {section.title && (
              <div style={{ background:`linear-gradient(90deg, ${c}28, transparent)`, borderBottom:`1px solid ${c}25`,
                            padding:"11px 16px", display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:15 }}>{icon}</span>
                <span style={{ fontSize:12, fontWeight:800, color:c, letterSpacing:"0.5px", textTransform:"uppercase" as const }}>
                  {section.title}
                </span>
              </div>
            )}
            <div style={{ padding:"14px 16px" }}>
              {renderBodyLines(section.body, c)}
            </div>
          </div>
        );
      })}
    </div>
  );

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return null;

  // ── 섹션 마커 감지 헬퍼 ────────────────────────────────────────────────────────
  // 줄의 첫 문자가 특수 기호(비ASCII, 비한국어, 비CJK)이면 섹션 헤더로 처리
  const isSectionMarkerChar = (ch: string): boolean => {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x7E) return false;          // ASCII 제외
    if (cp >= 0xAC00 && cp <= 0xD7A3) return false;  // 한글 제외
    if (cp >= 0x4E00 && cp <= 0x9FFF) return false;  // CJK 제외
    if (cp >= 0x3040 && cp <= 0x30FF) return false;  // 일본어 가나 제외
    if (cp >= 0xFF00 && cp <= 0xFFEF) return false;  // 전각 ASCII 제외
    return true; // 그 외 특수 기호 (■◆●★▶ 등 모두 포함)
  };

  const isSectionHeader = (line: string): boolean => {
    const t = line.trimStart();
    if (!t) return false;
    if (/^#{1,3}\s/.test(t)) return true;
    return isSectionMarkerChar(t[0]);
  };

  // 섹션 마커 제거
  const stripMarker = (t: string) =>
    t.trimStart()
     .replace(/^#{1,3}\s*/, "")
     .replace(/^[^\w\s가-힣\u4E00-\u9FFF]+\s*/, "")  // 비단어·비한국·비CJK 앞부분 제거
     .replace(/\*\*([^*]+)\*\*/g, "$1")
     .trim();

  // ── 전략 1: ■ (U+25A0) 직접 split — 최우선 처리 ─────────────────────────────────
  // AI 출력 형식: ■ 섹션명\n본문. 다른 어떤 전략보다 먼저 처리하여 ## 서브헤더 등에 의한
  // 오작동을 방지.
  // ※ 줄 맨 앞에 "■ " 형태로 나타나는 경우만 섹션 구분자로 인식.
  //    본문 중간에 ■이 장식/리스트 기호로 쓰인 경우에는 Strategy 2(##)로 넘긴다.
  if (/^\s*■\s/m.test(normalized)) {
    const parts = normalized.split("■");
    const sections: Array<{ title: string; body: string }> = [];
    // ■ 이전 텍스트가 있으면 빈 제목 카드로 추가
    const preamble = parts[0].trim();
    if (preamble) sections.push({ title: "", body: preamble });
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const nl = part.indexOf("\n");
      const title = (nl === -1 ? part : part.slice(0, nl)).trim().replace(/\*\*([^*]+)\*\*/g, "$1");
      const body  = nl === -1 ? "" : part.slice(nl + 1).trim();
      if (title || body) sections.push({ title, body });
    }
    if (sections.length > 0) return renderSectionCards(sections);
  }

  // ── 전략 2: ## / ### 마크다운 헤더 (H2 이상만 섹션으로 처리) ─────────────────────────
  // # (H1)은 문서 제목이므로 섹션 구분자로 사용하지 않음
  if (/^#{2,3}\s/m.test(normalized)) {
    const lines = normalized.split("\n");
    const sections: Array<{ title: string; body: string }> = [];
    let cur: { title: string; bodyLines: string[] } | null = null;
    for (const line of lines) {
      if (/^#{2,3}\s/.test(line.trimStart())) {
        if (cur) sections.push({ title: cur.title, body: cur.bodyLines.join("\n").trim() });
        const rawTitle = line.trimStart().replace(/^#{2,3}\s*/, "").replace(/\*\*([^*]+)\*\*/g, "$1").trim();
        cur = { title: rawTitle, bodyLines: [] };
      } else if (cur) {
        cur.bodyLines.push(line);
      }
    }
    if (cur) sections.push({ title: cur.title, body: cur.bodyLines.join("\n").trim() });
    const valid = sections.filter(s => s.title || s.body);
    if (valid.length > 0) return renderSectionCards(valid);
  }

  // ── 전략 3: 임의 섹션 마커 문자 (줄 단위 탐지) ────────────────────────────────────
  {
    const lines = normalized.split("\n");
    if (lines.some(isSectionHeader)) {
      const sections: Array<{ title: string; body: string }> = [];
      let cur: { title: string; bodyLines: string[] } | null = null;
      for (const line of lines) {
        if (isSectionHeader(line)) {
          if (cur) sections.push({ title: cur.title, body: cur.bodyLines.join("\n").trim() });
          cur = { title: stripMarker(line), bodyLines: [] };
        } else if (cur) {
          cur.bodyLines.push(line);
        }
      }
      if (cur) sections.push({ title: cur.title, body: cur.bodyLines.join("\n").trim() });
      const valid = sections.filter(s => s.title || s.body);
      if (valid.length > 0) return renderSectionCards(valid);
    }
  }

  // ── 전략 4: 단락 카드 폴백 ──────────────────────────────────────────────────────
  const paras = normalized.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  return (
    <div style={{ display:"flex", flexDirection:"column" as const, gap:8 }}>
      {paras.map((para, i) => (
        <div key={i} style={{ background:"#10101c", borderRadius:10, padding:"12px 16px", border:`1px solid ${c}18` }}>
          <p style={{ fontSize:13, color:"#c8d0e0", lineHeight:1.85, margin:0, whiteSpace:"pre-wrap" as const }}>
            {para.replace(/\*\*([^*]+)\*\*/g, "$1")}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── 버전 히스토리 모달 ──────────────────────────────────────────────────────────
function VersionHistoryModal({
  stageObj,
  allVersions,
  onClose,
  onViewHistory,
  onNextStage,
  nextStageName,
}: {
  stageObj: typeof STAGES[number];
  allVersions: StageResult[];
  onClose: () => void;
  onViewHistory: () => void; // ?view=N 이동
  onNextStage?: () => void;
  nextStageName: string | null;
}) {
  const [selected, setSelected] = useState<StageResult>(allVersions[allVersions.length - 1]);
  const c = stageObj.color;
  // 본문 렌더: raw_summary 우선, 없으면 summary — 헤더 마커(##, ■) 보존
  const rawContent = (selected.data?.raw_summary ? String(selected.data.raw_summary) : selected.summary) || "";
  // 미리보기 전용: 마크다운 제거한 짧은 텍스트
  const cleanSummary = (selected.summary || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[#>_`■]/g, "")
    .trim();

  return (
    <div
      onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.88)", zIndex:10000,
               display:"flex", alignItems:"flex-end", justifyContent:"center", padding:"0 0 0" }}
    >
      <div
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        style={{ width:"100%", maxWidth:560, maxHeight:"88vh", display:"flex", flexDirection:"column" as const,
                 background:"#12121e", border:`1px solid ${c}35`, borderRadius:"16px 16px 0 0", overflow:"hidden" }}
      >
        {/* 헤더 */}
        <div style={{ padding:"14px 18px", borderBottom:"1px solid #1e1e2a", display:"flex",
                      alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:4, height:18, borderRadius:2, background:c, flexShrink:0 }} />
            <span style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>{stageObj.name}</span>
            <span style={{ fontSize:11, color:"#4a4a6a", marginLeft:2 }}>
              {allVersions.length > 1 ? `${allVersions.length}개 버전` : "v1"}
            </span>
          </div>
          <button onClick={onClose}
            style={{ background:"transparent", border:"none", color:"#4a4a68", fontSize:20, cursor:"pointer", padding:4, lineHeight:1 }}>
            ✕
          </button>
        </div>

        {/* 버전 카드 (2개 이상일 때만) */}
        {allVersions.length > 1 && (
          <div style={{ padding:"10px 18px", borderBottom:"1px solid #1e1e2a", display:"flex",
                        gap:8, flexShrink:0, overflowX:"auto" as const }}>
            {allVersions.map((v) => {
              const vNum = v.version ?? 1;
              const isSelected = vNum === (selected.version ?? 1);
              const preview = (v.summary || "")
                .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/[#>_`]/g, "").trim().slice(0, 45);
              return (
                <button key={vNum} onClick={() => setSelected(v)} style={{
                  padding:"8px 14px", borderRadius:10, fontSize:12, fontWeight:700, cursor:"pointer",
                  background: isSelected ? `${c}20` : "rgba(255,255,255,0.03)",
                  border: isSelected ? `1px solid ${c}55` : "1px solid #252535",
                  color: isSelected ? c : "#4a4a6a",
                  textAlign:"left" as const, flexShrink:0, minWidth:80, maxWidth:160,
                  transition:"all 0.15s",
                }}>
                  <div style={{ fontSize:13, marginBottom:3 }}>v{vNum}</div>
                  {preview && (
                    <div style={{ fontSize:10, color: isSelected ? `${c}90` : "#3a3a52",
                                  fontWeight:400, lineHeight:1.4,
                                  overflow:"hidden", display:"-webkit-box",
                                  WebkitLineClamp:2, WebkitBoxOrient:"vertical" as const }}>
                      {preview}…
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 결과 요약 내용 (스크롤 가능) */}
        <div style={{ flex:1, overflowY:"auto", padding:"16px 18px" }}>
          {rawContent
            ? renderNarrativeSummary(rawContent, c)
            : <div style={{ fontSize:13, color:"#3a3a52", textAlign:"center" as const, padding:"20px 0" }}>요약이 없습니다.</div>
          }
        </div>

        {/* 액션 버튼 */}
        <div style={{ padding:"12px 18px", borderTop:"1px solid #1e1e2a",
                      display:"flex", flexDirection:"column" as const, gap:8, flexShrink:0,
                      background:"#0e0e1a" }}>
          {nextStageName && onNextStage && (
            <button onClick={() => { onNextStage(); onClose(); }}
              style={{ width:"100%", padding:"12px 0", borderRadius:10, fontSize:14, fontWeight:800,
                       cursor:"pointer", background:`linear-gradient(135deg, ${c}dd, ${c})`,
                       border:"none", color:"#0a0a14", boxShadow:`0 4px 16px ${c}40` }}>
              {nextStageName} 시작 →
            </button>
          )}
          <button onClick={onViewHistory}
            style={{ width:"100%", padding:"10px 0", borderRadius:10, fontSize:13, fontWeight:700,
                     cursor:"pointer", background:"rgba(255,255,255,0.04)",
                     border:"1px solid #2a2a3d", color:"#94a3b8" }}>
            💬 채팅 기록 전체 보기 →
          </button>
        </div>
      </div>
    </div>
  );
}

function StageReportInChat({
  result,
  stage,
  onNextStage,
  onContinueDebate,
  nextStageName,
  onReanalyze,
  onNewDebate,
  allVersions,
  onSelectVersion,
}: {
  result: StageResult;
  stage: typeof STAGES[number];
  onNextStage: () => void;
  onContinueDebate: () => void;
  nextStageName: string | null;
  onReanalyze?: () => Promise<void>;
  onNewDebate?: () => void;   // 뷰 모드 전용: 기존 내용 지우고 새로 토론
  allVersions?: StageResult[];        // 이전 버전 포함 전체 버전 배열 (정렬됨)
  onSelectVersion?: (v: StageResult) => void; // 버전 전환 시 호출
}) {
  const [reanalyzing, setReanalyzing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [stg1CharModal, setStg1CharModal] = useState<Record<string,unknown> | null>(null);
  const [stg1LocModal,  setStg1LocModal]  = useState<Record<string,unknown> | null>(null);
  const [selectedResult, setSelectedResult] = useState<StageResult>(result);
  const isViewMode = !!onNewDebate; // onNewDebate가 있으면 뷰 모드
  const c = stage.color;
  const { data } = selectedResult;

  // 다음 단계 버튼 레이블 — nextStageName이 없으면 stageId로 유추
  const nextBtnLabel = nextStageName
    ? `${nextStageName} 시작 →`
    : selectedResult.stageId === 1 ? "시놉시스 시작 →"
    : selectedResult.stageId === 2 ? "에셋 리스트 검토 →"
    : selectedResult.stageId <= 4 ? "이미지 생성 →"
    : "스타일 정의 →";

  const str = (v: unknown): string => (v ? String(v) : "");
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v as unknown[] : []);

  // 필드 한 줄
  const Field = ({ label, val }: { label: string; val: unknown }) => {
    const text = Array.isArray(val) ? (val as unknown[]).join(" · ") : str(val);
    if (!text) return null;
    return (
      <div style={{ display:"flex", gap:10, fontSize:13, lineHeight:1.7, marginBottom:6 }}>
        <span style={{ minWidth:60, fontWeight:700, color:"#4a4a6a", fontSize:11, paddingTop:2, flexShrink:0, textTransform:"uppercase" as const, letterSpacing:"0.3px" }}>{label}</span>
        <span style={{ color:"#d4dce8" }}>{text}</span>
      </div>
    );
  };

  // 섹션 헤더
  const SectionHeader = ({ icon, title }: { icon: string; title: string }) => (
    <div style={{ display:"flex", alignItems:"center", gap:10, margin:"20px 0 12px" }}>
      <span style={{ fontSize:13 }}>{icon}</span>
      <span style={{ fontSize:11, fontWeight:800, color:c, letterSpacing:"0.8px", textTransform:"uppercase" as const }}>{title}</span>
      <div style={{ flex:1, height:1, background:`${c}30` }} />
    </div>
  );

  // ── 캐릭터 카드 (접기/펼치기) ────────────────────────────────────────────
  const CharCard = ({ ch, cardColor }: { ch: Record<string, unknown>; cardColor: string }) => {
    const [expanded, setExpanded] = useState(false);
    const s = (v: unknown) => (v ? String(v) : "");
    const name = s(ch.name) || "?";
    const initials = name.slice(0, 2);
    const meta = [s(ch.gender), s(ch.age)].filter(Boolean).join(" · ");
    const bodyStr = [s(ch.height), s(ch.weight), s(ch.build)].filter(Boolean).join(" · ");
    const rels = Array.isArray(ch.relationships) ? ch.relationships as Array<Record<string,string>> : [];
    const cons = Array.isArray(ch.conflicts)     ? ch.conflicts     as Array<Record<string,string>> : [];
    // 요약 태그: 성격 첫 번째 키워드
    const personalityFirst = s(ch.personality).split(/[,·,]/)[0].trim();
    return (
      <div style={{ background:"#10101c", borderRadius:12, overflow:"hidden", marginBottom:8, border:`1px solid ${cardColor}25` }}>
        {/* 헤더 — 항상 표시, 클릭으로 펼치기/접기 */}
        <div
          onClick={() => setExpanded((prev: boolean) => !prev)}
          style={{ background:`linear-gradient(90deg, ${cardColor}25, transparent)`, padding:"10px 14px", display:"flex", alignItems:"center", gap:10, cursor:"pointer", userSelect:"none" as const }}
        >
          <div style={{ width:36, height:36, borderRadius:"50%", background:`${cardColor}30`, border:`2px solid ${cardColor}60`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, color:cardColor, flexShrink:0 }}>{initials}</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:800, color:"#f1f5f9", display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" as const }}>
              {name}
              {s(ch.role) && <span style={{ fontSize:11, fontWeight:700, color:cardColor, background:`${cardColor}20`, padding:"2px 8px", borderRadius:20 }}>{s(ch.role)}</span>}
            </div>
            {/* 접혀있을 때: 요약 한 줄 */}
            {!expanded && (
              <div style={{ fontSize:11, color:"#4a5568", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const }}>
                {[meta, personalityFirst].filter(Boolean).join(" · ")}
              </div>
            )}
            {/* 펼쳐있을 때: meta */}
            {expanded && meta && <div style={{ fontSize:12, color:"#64748b", marginTop:2 }}>{meta}</div>}
          </div>
          <div style={{ fontSize:13, color:"#3a3a52", flexShrink:0, transform: expanded ? "rotate(180deg)" : "none", transition:"transform 0.2s" }}>▼</div>
        </div>

        {/* 상세 내용 — expanded 시만 표시 */}
        {expanded && (
          <>
            {/* 신체 */}
            {bodyStr && (
              <div style={{ padding:"10px 16px 0", borderTop:"1px solid #1a1a28" }}>
                <div style={{ fontSize:10, color:"#4a4a68", fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.5px", marginBottom:4 }}>신체</div>
                <div style={{ fontSize:12, color:"#94a3b8", paddingBottom:10 }}>{bodyStr}</div>
              </div>
            )}
            {/* 얼굴·복장·성격 */}
            <div style={{ padding:"10px 16px 0" }}>
              <Field label="얼굴" val={ch.face} />
              <Field label="복장" val={ch.outfit} />
              <Field label="성격" val={ch.personality} />
              <Field label="동기" val={ch.motivation} />
              <Field label="말투" val={ch.speech} />
              {s(ch.story_role) && <Field label="서사 역할" val={ch.story_role} />}
              {s(ch.other) && <Field label="기타" val={ch.other} />}
            </div>
            {/* 인물 관계 */}
            {rels.length > 0 && (
              <div style={{ padding:"10px 16px", borderTop:"1px solid #1a1a28" }}>
                <div style={{ fontSize:10, color:"#34d399", fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.5px", marginBottom:6 }}>인물 관계</div>
                {rels.map((r, i) => (
                  <div key={i} style={{ fontSize:12, color:"#94a3b8", marginBottom:4, display:"flex", gap:6 }}>
                    <span style={{ color:"#f1f5f9", fontWeight:600, whiteSpace:"nowrap" as const }}>{r.character}</span>
                    <span style={{ color:cardColor, fontSize:11, background:`${cardColor}15`, padding:"1px 7px", borderRadius:20, whiteSpace:"nowrap" as const }}>{r.type}</span>
                    {r.description && <span style={{ color:"#64748b" }}>— {r.description}</span>}
                  </div>
                ))}
              </div>
            )}
            {/* 갈등 관계 */}
            {cons.length > 0 && (
              <div style={{ padding:"10px 16px", borderTop:"1px solid #1a1a28" }}>
                <div style={{ fontSize:10, color:"#f87171", fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.5px", marginBottom:6 }}>갈등 관계</div>
                {cons.map((r, i) => (
                  <div key={i} style={{ fontSize:12, color:"#94a3b8", marginBottom:4, display:"flex", gap:6, flexWrap:"wrap" as const }}>
                    <span style={{ color:"#f1f5f9", fontWeight:600, whiteSpace:"nowrap" as const }}>{r.character}</span>
                    <span style={{ color:"#f87171", fontSize:11, background:"rgba(248,113,113,0.12)", padding:"1px 7px", borderRadius:20, whiteSpace:"nowrap" as const }}>{r.type}</span>
                    {r.description && <span style={{ color:"#64748b" }}>— {r.description}</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // ── 장소 카드 ─────────────────────────────────────────────────────────────
  const LocCard = ({ loc, cardColor }: { loc: Record<string, unknown>; cardColor: string }) => {
    const s = (v: unknown) => (v ? String(v) : "");
    const locType = s(loc.location_type) || s(loc.type);
    const role    = s(loc.role) || s(loc.significance);
    return (
      <div style={{ background:"#10101c", borderRadius:12, overflow:"hidden", marginBottom:16, border:`1px solid ${cardColor}22` }}>
        <div style={{ background:`linear-gradient(90deg, ${cardColor}18, transparent)`, borderBottom:`1px solid ${cardColor}20`, padding:"12px 16px", display:"flex", alignItems:"flex-start", gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:`${cardColor}20`, border:`1px solid ${cardColor}40`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>
            {locType.includes("야외") ? "🌿" : locType.includes("실내") ? "🏠" : locType.includes("건물") ? "🏢" : "🏙"}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" as const }}>
              {s(loc.name)}
              {locType && <span style={{ fontSize:11, color:"#64748b", background:"rgba(255,255,255,0.06)", padding:"2px 8px", borderRadius:20 }}>{locType}</span>}
            </div>
            {role && <div style={{ fontSize:12, color:`${cardColor}cc`, marginTop:3 }}>{role}</div>}
          </div>
        </div>
        <div style={{ padding:"12px 16px" }}>
          <Field label="시각 묘사" val={loc.visual} />
          <Field label="조명" val={loc.lighting} />
          <Field label="색채" val={loc.color_palette} />
          <Field label="분위기" val={loc.atmosphere} />
          <Field label="공간 구조" val={loc.architecture} />
          <Field label="소리·냄새" val={loc.sound} />
          <Field label="서사적 의미" val={s(loc.significance) !== role ? loc.significance : undefined} />
          <Field label="상징" val={loc.symbolic_meaning} />
        </div>
      </div>
    );
  };

  // ── Stage별 내용 ─────────────────────────────────────────────────────────────

  const content = (() => {
    switch (result.stageId) {

      case 1: { // 세계관 — 5개 프레임워크
        const _rawChars1 = arr(data.key_characters) as Record<string,string>[];
        const chars = _rawChars1.filter(ch => {
          const n = ch.name ?? "";
          return !/골목|거리|길(?!\w)|집(?!\w)|방(?!법|향)|층|마을|학교|병원|건물|식당|분식|카페|폐자장|공장|시장|역(?!\w)|아파트|빌라|광장|공원|해변|산(?!\w)|강(?!\w)|호수|바다|가게|점포|센터|연구소|사무실|작업장|창고|지하|옥상|뒷골목|주택|빌딩|본부|기지|술집|주점|포장마차|편의점|노점/.test(n)
            && !/^\d{2,4}년|상반기|하반기|년대|세기|시절|연도|기간/.test(n)
            && !/의 결핍|통신|음식|유행어|키워드|풍경|문화|계층|압박|규범|의식|관습|금기|세계관|배경|설정|규칙|시스템|언어|방언|경제|정치|체제|체계|이념|역사|미디어|대중|소비|트렌드|가치관|분위기|기운|층위|차원|구조|계급/.test(n);
        });
        // 장소 필터: 추상 개념·상태·이념 표현 제외, 실제 물리 장소만
        const _rawLocs1 = arr(data.key_locations) as Record<string,string>[];
        const locs = _rawLocs1.filter(loc => {
          const n = loc.name ?? loc.location_name ?? "";
          return !/의\s*(붕괴|결핍|상실|압박|억압|공포|위기|혼란|충돌|분열|고립|단절|격차|무너짐)/.test(n)
            && !/에\s*(대한|관한)/.test(n)
            && !/신뢰|불신|이념|체제|격차|불평등|차별|세계관|규범|금기|역사|경제|정치|미디어|관습|통념/.test(n)
            && n.length > 0;
        });
        const hasStructured = data.era || data.core_space || data.power_hierarchy || data.theme || chars.length > 0;
        if (!hasStructured && data.raw_summary) return renderNarrativeSummary(str(data.raw_summary), c);

        // ── 내부 헬퍼 ──────────────────────────────────────────────────────
        const InfoBlock = ({ label, val }: { label: string; val: unknown }) =>
          val ? (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: c, letterSpacing: "0.5px", textTransform: "uppercase" as const, marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 13, color: "#d4dce8", lineHeight: 1.7 }}>{str(val)}</div>
            </div>
          ) : null;

        const rels1 = Array.isArray(data.character_relationships) ? data.character_relationships as Array<Record<string,string>> : [];

        return (
          <>
            {/* ① 세계 배경 */}
            {(data.era || data.core_space || data.daily_life) && (
              <div style={{ background: "#10101c", borderRadius: 12, padding: "16px 18px", marginBottom: 10, border: `1px solid ${c}20` }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: c, letterSpacing: "0.6px", textTransform: "uppercase" as const, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>🌍</span> 세계 배경
                </div>
                {data.era && (
                  <div style={{ background: `${c}0c`, border: `1px solid ${c}25`, borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: `${c}99`, fontWeight: 700, marginBottom: 3 }}>시대 배경</div>
                    <div style={{ fontSize: 13, color: "#e2e8f0", lineHeight: 1.65 }}>{str(data.era)}</div>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: data.core_space && data.daily_life ? "1fr 1fr" : "1fr", gap: 8 }}>
                  {data.core_space && (
                    <div style={{ background: "#0d0d1a", borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 10, color: "#4a4a68", fontWeight: 700, marginBottom: 3 }}>핵심 공간</div>
                      <div style={{ fontSize: 12, color: "#c8d0e0", lineHeight: 1.6 }}>{str(data.core_space)}</div>
                    </div>
                  )}
                  {data.daily_life && (
                    <div style={{ background: "#0d0d1a", borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 10, color: "#4a4a68", fontWeight: 700, marginBottom: 3 }}>생활감</div>
                      <div style={{ fontSize: 12, color: "#c8d0e0", lineHeight: 1.6 }}>{str(data.daily_life)}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ② 사회 구조 */}
            {(data.power_hierarchy || data.social_norms || data.taboo) && (
              <div style={{ background: "#10101c", borderRadius: 12, padding: "16px 18px", marginBottom: 10, border: `1px solid ${c}20` }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: c, letterSpacing: "0.6px", textTransform: "uppercase" as const, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>⚔️</span> 사회 구조
                </div>
                <InfoBlock label="계급·권력" val={data.power_hierarchy} />
                <InfoBlock label="사회 통념" val={data.social_norms} />
                <InfoBlock label="금기 (Taboo)" val={data.taboo} />
              </div>
            )}

            {/* ③ What If 설정 */}
            {(data.what_if_rule || data.what_if_cost || data.what_if_who_knows) && (
              <div style={{ background: `${c}08`, borderRadius: 12, padding: "16px 18px", marginBottom: 10, border: `1px solid ${c}30` }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: c, letterSpacing: "0.6px", textTransform: "uppercase" as const, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>✨</span> What If 설정
                </div>
                {data.what_if_rule && (
                  <div style={{ background: `${c}12`, border: `1px solid ${c}35`, borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: `${c}aa`, fontWeight: 700, marginBottom: 3 }}>핵심 규칙</div>
                    <div style={{ fontSize: 13, color: "#f1f5f9", fontWeight: 600, lineHeight: 1.65 }}>{str(data.what_if_rule)}</div>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: data.what_if_cost && data.what_if_who_knows ? "1fr 1fr" : "1fr", gap: 8 }}>
                  {data.what_if_cost && (
                    <div style={{ background: "#0d0d1a", borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 10, color: "#4a4a68", fontWeight: 700, marginBottom: 3 }}>규칙의 대가</div>
                      <div style={{ fontSize: 12, color: "#c8d0e0", lineHeight: 1.6 }}>{str(data.what_if_cost)}</div>
                    </div>
                  )}
                  {data.what_if_who_knows && (
                    <div style={{ background: "#0d0d1a", borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 10, color: "#4a4a68", fontWeight: 700, marginBottom: 3 }}>누가 아는가</div>
                      <div style={{ fontSize: 12, color: "#c8d0e0", lineHeight: 1.6 }}>{str(data.what_if_who_knows)}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ④ 등장인물 */}
            {chars.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#fb923c", letterSpacing: "0.6px", textTransform: "uppercase" as const, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>👤</span> 등장인물 <span style={{ background: "rgba(251,146,60,0.15)", color: "#fb923c", borderRadius: 99, padding: "1px 8px", fontWeight: 700 }}>{chars.length}</span>
                </div>
                {/* 인물 그리드 */}
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(chars.length, 3)}, 1fr)`, gap: 8, marginBottom: 8 }}>
                  {chars.map((ch, i) => {
                    const rels = Array.isArray(ch.relationships) ? ch.relationships as Array<Record<string,string>> : [];
                    return (
                      <div key={i} onClick={() => setStg1CharModal(ch)} style={{ background: "#10101c", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(251,146,60,0.18)", cursor: "pointer", transition: "border-color 0.15s" }}
                        onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.borderColor = "rgba(251,146,60,0.5)")}
                        onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.borderColor = "rgba(251,146,60,0.18)")}>
                        <div style={{ background: "linear-gradient(135deg, rgba(251,146,60,0.18), transparent)", padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(251,146,60,0.2)", border: "2px solid rgba(251,146,60,0.5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#fb923c", flexShrink: 0 }}>
                            {(str(ch.name) || "?").slice(0, 2)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{str(ch.name)}</div>
                            {ch.role && <div style={{ fontSize: 10, color: "#fb923c", marginTop: 1 }}>{str(ch.role)}</div>}
                          </div>
                          <span style={{ fontSize: 9, color: "#4a4a68" }}>▶</span>
                        </div>
                        {(ch.personality || ch.motivation) && (
                          <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                            {ch.personality && <div style={{ fontSize: 11, color: "#8080a0", lineHeight: 1.5, marginBottom: ch.motivation ? 4 : 0 }}><span style={{ color: "#fb923c88", fontWeight: 700, marginRight: 4 }}>성격</span>{str(ch.personality).slice(0, 60)}{str(ch.personality).length > 60 ? "…" : ""}</div>}
                            {ch.motivation && <div style={{ fontSize: 11, color: "#8080a0", lineHeight: 1.5 }}><span style={{ color: "#fb923c88", fontWeight: 700, marginRight: 4 }}>동기</span>{str(ch.motivation).slice(0, 60)}{str(ch.motivation).length > 60 ? "…" : ""}</div>}
                          </div>
                        )}
                        {/* 관계 태그 */}
                        {rels.length > 0 && (
                          <div style={{ padding: "6px 12px 8px", borderTop: "1px solid rgba(255,255,255,0.04)", display: "flex", flexWrap: "wrap" as const, gap: 4 }}>
                            {rels.slice(0, 3).map((r, ri) => (
                              <span key={ri} style={{ fontSize: 10, background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.2)", borderRadius: 99, padding: "1px 7px", color: "#fb923c" }}>
                                {r.character} <span style={{ opacity: 0.6 }}>({r.type})</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* 관계망 요약 */}
                {(rels1.length > 0 || data.character_backstory || data.goal_conflicts) && (
                  <div style={{ background: "#10101c", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(251,146,60,0.12)" }}>
                    {rels1.length > 0 && (
                      <div style={{ marginBottom: data.character_backstory || data.goal_conflicts ? 8 : 0 }}>
                        <div style={{ fontSize: 10, color: "#34d399", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 6 }}>관계망</div>
                        {rels1.map((r, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 4, flexWrap: "wrap" as const }}>
                            <span style={{ color: "#f1f5f9", fontWeight: 700 }}>{r.from ?? r.character}</span>
                            <span style={{ color: "#34d399", fontSize: 10, background: "rgba(52,211,153,0.12)", padding: "1px 7px", borderRadius: 99 }}>↔ {r.type ?? r.relation}</span>
                            <span style={{ color: "#f1f5f9", fontWeight: 700 }}>{r.to ?? r.target}</span>
                            {(r.description ?? r.detail) && <span style={{ color: "#4a4a68" }}>— {str(r.description ?? r.detail)}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {data.character_backstory && <InfoBlock label="얽힌 과거사" val={data.character_backstory} />}
                    {data.goal_conflicts && <InfoBlock label="목표 충돌" val={data.goal_conflicts} />}
                  </div>
                )}
              </div>
            )}

            {/* ⑤ 핵심 장소 */}
            {locs.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#a78bfa", letterSpacing: "0.6px", textTransform: "uppercase" as const, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>🏙</span> 핵심 장소 <span style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa", borderRadius: 99, padding: "1px 8px", fontWeight: 700 }}>{locs.length}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: locs.length > 1 ? "1fr 1fr" : "1fr", gap: 8 }}>
                  {locs.map((l, i) => {
                    const locType = str(l.location_type) || str(l.type);
                    const locIcon = /야외|거리|공원|광장|산|바다|들판/.test(locType) ? "🌿" : /건물|빌딩|아파트|학교|병원|관청/.test(locType) ? "🏢" : /시장|상점|가게/.test(locType) ? "🏪" : "🏠";
                    const desc = str(l.visual || l.atmosphere || l.significance || l.role);
                    return (
                      <div key={i} onClick={() => setStg1LocModal(l)} style={{ background: "#10101c", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(167,139,250,0.18)", cursor: "pointer", transition: "border-color 0.15s" }}
                        onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.borderColor = "rgba(167,139,250,0.5)")}
                        onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.borderColor = "rgba(167,139,250,0.18)")}>
                        <div style={{ background: "linear-gradient(90deg, rgba(167,139,250,0.12), transparent)", padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 18, flexShrink: 0 }}>{locIcon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{str(l.name ?? l.location_name)}</div>
                            {locType && <div style={{ fontSize: 10, color: "#a78bfa", marginTop: 1 }}>{locType}</div>}
                          </div>
                          <span style={{ fontSize: 9, color: "#4a4a68" }}>▶</span>
                        </div>
                        {desc && (
                          <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.04)", fontSize: 11, color: "#7070a0", lineHeight: 1.55 }}>
                            {desc.slice(0, 80)}{desc.length > 80 ? "…" : ""}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ⑥ 테마 */}
            {data.theme && (
              <div style={{ background: `${c}0a`, border: `1px solid ${c}28`, borderRadius: 12, padding: "14px 18px", marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: c, letterSpacing: "0.6px", textTransform: "uppercase" as const, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>🎭</span> 메시지·테마
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9", lineHeight: 1.75 }}>{str(data.theme)}</div>
              </div>
            )}

            {data.raw_summary && renderNarrativeSummary(str(data.raw_summary), c)}
          </>
        );
      }

      case 2: { // 시놉시스 — 새 스키마
        const protagonist  = data.protagonist as Record<string,string> | null ?? null;
        const storyArc     = data.story_arc   as Record<string,string> | null ?? null;
        const worldRules   = Array.isArray(data.world_rules) ? (data.world_rules as string[]) : [];
        const _rawChars2   = arr(data.characters)  as Record<string,string>[];
        const chars        = _rawChars2.filter(ch => {
          const n = ch.name ?? "";
          return !/골목|거리|길(?!\w)|집(?!\w)|방(?!법|향)|층|마을|학교|병원|건물|식당|분식|카페|폐자장|공장|시장|역(?!\w)|아파트|빌라|광장|공원|해변|산(?!\w)|강(?!\w)|호수|바다|가게|점포|센터|연구소|사무실|작업장|창고|지하|옥상|뒷골목|주택|빌딩|본부|기지|술집|주점|포장마차|편의점|노점/.test(n)
            && !/^\d{2,4}년|상반기|하반기|년대|세기|시절|연도|기간/.test(n)
            && !/의 결핍|통신|음식|유행어|키워드|풍경|문화|계층|압박|규범|의식|관습|금기|세계관|배경|설정|규칙|시스템|언어|방언|경제|정치|체제|체계|이념|역사|미디어|대중|소비|트렌드|가치관|분위기|기운|층위|차원|구조|계급/.test(n);
        });
        const locs         = arr(data.locations)   as Record<string,string>[];
        const props2       = arr(data.props)        as Record<string,string>[];
        const keyScenes    = arr(data.key_scenes)   as Record<string,string>[];
        return (
          <>
            {/* 로그라인 */}
            {data.logline && (
              <div style={{ background:`${c}12`, border:`1px solid ${c}40`, borderRadius:12, padding:"16px 20px", marginBottom:12 }}>
                <div style={{ fontSize:10, fontWeight:800, color:c, letterSpacing:"0.8px", textTransform:"uppercase" as const, marginBottom:8 }}>💡 로그라인</div>
                <div style={{ fontSize:16, fontWeight:700, color:"#f1f5f9", lineHeight:1.65 }}>{str(data.logline)}</div>
              </div>
            )}
            {/* 기획의도 + 타겟·장르 */}
            {(data.production_intent || data.target_audience || data.genre) && (
              <div style={{ background:"#10101c", borderRadius:12, padding:"16px 18px", marginBottom:12, border:`1px solid ${c}20` }}>
                <Field label="기획 의도" val={data.production_intent} />
                <Field label="타겟" val={data.target_audience} />
                <Field label="장르" val={data.genre} />
              </div>
            )}
            {/* 세계관 규칙 3가지 */}
            {worldRules.length > 0 && (
              <>
                <SectionHeader icon="📜" title="세계관 규칙 3가지" />
                <div style={{ background:"#10101c", borderRadius:12, padding:"14px 16px", marginBottom:12, border:`1px solid ${c}20` }}>
                  {worldRules.map((rule, i) => (
                    <div key={i} style={{ display:"flex", gap:10, padding:"6px 0", borderBottom: i < worldRules.length-1 ? "1px solid #1e1e2a" : "none" }}>
                      <span style={{ fontSize:11, fontWeight:800, color:c, minWidth:20 }}>{i+1}.</span>
                      <span style={{ fontSize:13, color:"#d4dce8", lineHeight:1.65 }}>{rule}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {/* 인카네이션 — 주인공 */}
            {protagonist && (
              <>
                <SectionHeader icon="🎭" title={`인카네이션 — ${protagonist.name ?? "주인공"}`} />
                <div style={{ background:"#10101c", borderRadius:12, padding:"16px 18px", marginBottom:12, border:`1px solid ${c}20` }}>
                  <Field label="Pain Point" val={protagonist.pain_point} />
                  <Field label="Want (목표)" val={protagonist.want} />
                  <Field label="Need (진짜 필요)" val={protagonist.need} />
                  <Field label="인카네이션 이유" val={protagonist.incarnation} />
                  <Field label="캐릭터 아크" val={protagonist.arc} />
                </div>
              </>
            )}
            {/* 사건의 트리거 */}
            {data.trigger && (
              <>
                <SectionHeader icon="⚡" title="사건의 트리거" />
                <div style={{ background:`${c}08`, borderRadius:12, padding:"14px 16px", marginBottom:12, border:`1px solid ${c}25` }}>
                  <div style={{ fontSize:13, color:"#e2e8f0", lineHeight:1.75 }}>{str(data.trigger)}</div>
                </div>
              </>
            )}
            {/* 스토리 아크 */}
            {storyArc && (
              <>
                <SectionHeader icon="📖" title="스토리 아크" />
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
                  {([
                    ["🌱 발단", storyArc.setup],
                    ["🌊 전개", storyArc.development],
                    ["🔥 위기", storyArc.crisis],
                    ["⚔️ 절정", storyArc.climax],
                    ["🎯 결말", storyArc.resolution],
                    ["🔀 반전", storyArc.twist],
                  ] as [string,string][]).map(([label, val]) => val ? (
                    <div key={label} style={{ background:"#10101c", borderRadius:10, padding:"12px 14px", border:`1px solid ${c}22`, borderTop:`3px solid ${c}` }}>
                      <div style={{ fontSize:11, fontWeight:800, color:c, marginBottom:6 }}>{label}</div>
                      <div style={{ fontSize:12, color:"#d4dce8", lineHeight:1.65 }}>{val}</div>
                    </div>
                  ) : null)}
                </div>
              </>
            )}
            {/* 비판과 보완 */}
            {data.critique && (
              <>
                <SectionHeader icon="🔍" title="비판과 보완" />
                <div style={{ background:"rgba(248,113,113,0.05)", borderRadius:12, padding:"14px 16px", marginBottom:12, border:"1px solid rgba(248,113,113,0.2)" }}>
                  <div style={{ fontSize:13, color:"#d4dce8", lineHeight:1.75 }}>{str(data.critique)}</div>
                </div>
              </>
            )}
            {/* 등장인물 리스트 */}
            {chars.length > 0 && (
              <>
                <SectionHeader icon="👥" title={`등장인물 리스트 (${chars.length}명)`} />
                {chars.map((ch, i) => (
                  <div key={i} style={{ display:"flex", gap:12, padding:"10px 14px", background:"#10101c", borderRadius:10, marginBottom:8, border:`1px solid ${c}18` }}>
                    <div style={{ width:32, height:32, borderRadius:"50%", background:"#fb923c22", border:"1px solid #fb923c40", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, color:"#fb923c", flexShrink:0 }}>{(ch.name ?? "?").slice(0,2)}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:"#f1f5f9" }}>{ch.name} <span style={{ fontSize:11, color:"#64748b", fontWeight:400 }}>({ch.role})</span></div>
                      {ch.appearance && <div style={{ fontSize:12, color:"#9a9abf", marginTop:3 }}>{ch.appearance}</div>}
                      {ch.relation && <div style={{ fontSize:11, color:"#64748b", marginTop:2 }}>↔ {ch.relation}</div>}
                      {ch.image_prompt && (
                        <div style={{ marginTop:6, background:"rgba(251,146,60,0.06)", border:"1px solid rgba(251,146,60,0.2)", borderRadius:6, padding:"5px 8px", display:"flex", alignItems:"flex-start", gap:6 }}>
                          <span style={{ fontSize:9, fontWeight:700, color:"#fb923c", textTransform:"uppercase" as const, letterSpacing:"0.07em", whiteSpace:"nowrap", marginTop:1 }}>Runway</span>
                          <span style={{ fontSize:10, color:"#94a3b8", lineHeight:1.5, fontFamily:"monospace", flex:1 }}>{ch.image_prompt}</span>
                          <button onClick={() => navigator.clipboard.writeText(ch.image_prompt ?? "")} style={{ background:"rgba(251,146,60,0.15)", border:"1px solid rgba(251,146,60,0.3)", borderRadius:4, color:"#fb923c", fontSize:9, fontWeight:700, padding:"2px 6px", cursor:"pointer", whiteSpace:"nowrap" }}>복사</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
            {/* 장소 리스트 */}
            {locs.length > 0 && (
              <>
                <SectionHeader icon="🗺" title={`장소 리스트 (${locs.length}곳)`} />
                {locs.map((l, i) => (
                  <div key={i} style={{ padding:"10px 14px", background:"#10101c", borderRadius:10, marginBottom:8, border:`1px solid #a78bfa18` }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"#f1f5f9" }}>{l.name} {l.type && <span style={{ fontSize:11, color:"#64748b", fontWeight:400 }}>({l.type})</span>}</div>
                    {l.visual && <div style={{ fontSize:12, color:"#9a9abf", marginTop:3 }}>{l.visual}</div>}
                    {l.significance && <div style={{ fontSize:11, color:"#64748b", marginTop:2 }}>역할: {l.significance}</div>}
                    {l.image_prompt && (
                      <div style={{ marginTop:6, background:"rgba(167,139,250,0.06)", border:"1px solid rgba(167,139,250,0.2)", borderRadius:6, padding:"5px 8px", display:"flex", alignItems:"flex-start", gap:6 }}>
                        <span style={{ fontSize:9, fontWeight:700, color:"#a78bfa", textTransform:"uppercase" as const, letterSpacing:"0.07em", whiteSpace:"nowrap", marginTop:1 }}>Runway</span>
                        <span style={{ fontSize:10, color:"#94a3b8", lineHeight:1.5, fontFamily:"monospace", flex:1 }}>{l.image_prompt}</span>
                        <button onClick={() => navigator.clipboard.writeText(l.image_prompt ?? "")} style={{ background:"rgba(167,139,250,0.15)", border:"1px solid rgba(167,139,250,0.3)", borderRadius:4, color:"#a78bfa", fontSize:9, fontWeight:700, padding:"2px 6px", cursor:"pointer", whiteSpace:"nowrap" }}>복사</button>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
            {/* 소품 리스트 */}
            {props2.length > 0 && (
              <>
                <SectionHeader icon="🎒" title={`소품 리스트 (${props2.length}개)`} />
                {props2.map((p, i) => (
                  <div key={i} style={{ padding:"10px 14px", background:"#10101c", borderRadius:10, marginBottom:8, border:`1px solid #e879f918` }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"#f1f5f9" }}>{p.name} {p.type && <span style={{ fontSize:11, color:"#64748b", fontWeight:400 }}>({p.type})</span>}</div>
                    {p.visual && <div style={{ fontSize:12, color:"#9a9abf", marginTop:3 }}>{p.visual}</div>}
                    {p.story_role && <div style={{ fontSize:11, color:"#64748b", marginTop:2 }}>역할: {p.story_role}</div>}
                    {p.image_prompt && (
                      <div style={{ marginTop:6, background:"rgba(232,121,249,0.06)", border:"1px solid rgba(232,121,249,0.2)", borderRadius:6, padding:"5px 8px", display:"flex", alignItems:"flex-start", gap:6 }}>
                        <span style={{ fontSize:9, fontWeight:700, color:"#e879f9", textTransform:"uppercase" as const, letterSpacing:"0.07em", whiteSpace:"nowrap", marginTop:1 }}>Runway</span>
                        <span style={{ fontSize:10, color:"#94a3b8", lineHeight:1.5, fontFamily:"monospace", flex:1 }}>{p.image_prompt}</span>
                        <button onClick={() => navigator.clipboard.writeText(p.image_prompt ?? "")} style={{ background:"rgba(232,121,249,0.15)", border:"1px solid rgba(232,121,249,0.3)", borderRadius:4, color:"#e879f9", fontSize:9, fontWeight:700, padding:"2px 6px", cursor:"pointer", whiteSpace:"nowrap" }}>복사</button>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
            {/* 핵심장면 리스트 */}
            {keyScenes.length > 0 && (
              <>
                <SectionHeader icon="🎬" title={`핵심장면 리스트 (${keyScenes.length}장면)`} />
                {keyScenes.map((sc, i) => (
                  <div key={i} style={{ padding:"12px 14px", background:"#10101c", borderRadius:10, marginBottom:8, border:`1px solid #fbbf2418` }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"#fbbf24", marginBottom:4 }}>{sc.title}</div>
                    <div style={{ fontSize:12, color:"#9a9abf" }}>{sc.location} {sc.characters && `· ${sc.characters}`}</div>
                    {sc.visual && <div style={{ fontSize:12, color:"#d4dce8", marginTop:4, lineHeight:1.6 }}>{sc.visual}</div>}
                    {sc.emotion && <div style={{ fontSize:11, color:"#64748b", marginTop:3 }}>분위기: {sc.emotion}</div>}
                    {sc.image_prompt && (
                      <div style={{ marginTop:6, background:"rgba(251,191,36,0.06)", border:"1px solid rgba(251,191,36,0.2)", borderRadius:6, padding:"5px 8px", display:"flex", alignItems:"flex-start", gap:6 }}>
                        <span style={{ fontSize:9, fontWeight:700, color:"#fbbf24", textTransform:"uppercase" as const, letterSpacing:"0.07em", whiteSpace:"nowrap", marginTop:1 }}>Runway</span>
                        <span style={{ fontSize:10, color:"#94a3b8", lineHeight:1.5, fontFamily:"monospace", flex:1 }}>{sc.image_prompt}</span>
                        <button onClick={() => navigator.clipboard.writeText(sc.image_prompt ?? "")} style={{ background:"rgba(251,191,36,0.15)", border:"1px solid rgba(251,191,36,0.3)", borderRadius:4, color:"#fbbf24", fontSize:9, fontWeight:700, padding:"2px 6px", cursor:"pointer", whiteSpace:"nowrap" }}>복사</button>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
            {data.raw_summary && renderNarrativeSummary(str(data.raw_summary), c)}
          </>
        );
      }

      case 3: { // 캐릭터 설정
        const chars = arr(data.characters) as Record<string,string>[];
        return (
          <>
            {chars.length > 0
              ? chars.map((ch, i) => <CharCard key={i} ch={ch} cardColor={c} />)
              : data.raw_summary && renderNarrativeSummary(str(data.raw_summary), c)
            }
          </>
        );
      }

      case 4: { // 장소 설정
        const locs = arr(data.locations) as Record<string,string>[];
        return (
          <>
            {locs.length > 0
              ? locs.map((loc, i) => <LocCard key={i} loc={loc} cardColor={c} />)
              : data.raw_summary && renderNarrativeSummary(str(data.raw_summary), c)
            }
          </>
        );
      }

      case 5: { // 소품·장비
        const props = arr(data.props) as Record<string,string>[];
        return (
          <>
            {props.length > 0
              ? props.map((p, i) => (
                <div key={i} style={{ background:"#10101c", borderRadius:12, overflow:"hidden", marginBottom:12, border:`1px solid ${c}22` }}>
                  <div style={{ background:`linear-gradient(90deg, ${c}18, transparent)`, borderBottom:`1px solid ${c}20`, padding:"12px 16px" }}>
                    <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>{p.name}
                      {p.type && <span style={{ fontSize:11, color:"#64748b", marginLeft:8 }}>{p.type}</span>}
                      {p.owner && <span style={{ fontSize:11, color:c, marginLeft:8 }}>· {p.owner}</span>}
                    </div>
                  </div>
                  <div style={{ padding:"12px 16px" }}>
                    <Field label="시각" val={p.visual} />
                    <Field label="상태" val={p.condition} />
                    <Field label="기능" val={p.function} />
                    <Field label="이야기 역할" val={p.story_role} />
                    <Field label="상징" val={p.symbolic_meaning} />
                  </div>
                </div>
              ))
              : data.raw_summary && renderNarrativeSummary(str(data.raw_summary), c)
            }
          </>
        );
      }

      default: return null;
    }
  })();

  const cleanSummary = (selectedResult.summary || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[#>_`]/g, "")
    .trim();
  const previewText = cleanSummary.slice(0, 120) + (cleanSummary.length > 120 ? "..." : "");

  return (
    <div style={{ margin:"8px 0" }}>
      {/* ── 컴팩트 결과 타일 ── */}
      <div
        onClick={() => setModalOpen(true)}
        style={{
          background:"#16161f",
          border:`1px solid ${c}35`,
          borderRadius:12,
          padding:"13px 15px",
          cursor:"pointer",
          transition:"border-color 0.15s",
          marginBottom:10,
        }}
      >
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:c, flexShrink:0 }} />
            <span style={{ fontSize:13, fontWeight:800, color:"#f1f5f9" }}>{stage.name} 완료</span>
          </div>
          <span style={{ fontSize:13, color:c, fontWeight:700, opacity:0.8 }}>↗</span>
        </div>
        <div style={{
          fontSize:12, color:"#64748b", lineHeight:1.55,
          overflow:"hidden", display:"-webkit-box",
          WebkitLineClamp:2, WebkitBoxOrient:"vertical" as const,
        }}>
          {previewText || "결과를 보려면 눌러주세요."}
        </div>
      </div>

      {/* ── 버전 탭 ── */}
      {allVersions && allVersions.length > 1 && (
        <div style={{ display:"flex", gap:4, marginBottom:8, flexWrap:"wrap" as const }}>
          {allVersions.map((v) => {
            const vNum = v.version ?? 1;
            const isActive = vNum === (selectedResult.version ?? 1);
            return (
              <button
                key={vNum}
                onClick={() => {
                  setSelectedResult(v);
                  onSelectVersion?.(v);
                }}
                style={{
                  padding:"4px 12px",
                  borderRadius:20,
                  fontSize:11,
                  fontWeight:700,
                  cursor:"pointer",
                  background: isActive ? `rgba(124,108,252,0.2)` : "transparent",
                  border: isActive ? "1px solid rgba(124,108,252,0.5)" : "1px solid #2a2a3d",
                  color: isActive ? "#a78bfa" : "#4a4a6a",
                  transition:"all 0.15s",
                }}
              >
                v{vNum}
              </button>
            );
          })}
          <span style={{ fontSize:10, color:"#3a3a52", alignSelf:"center", marginLeft:4 }}>
            {allVersions.length}개 버전
          </span>
        </div>
      )}

      {/* ── 액션 버튼 ── */}
      <div style={{ display:"flex", flexDirection:"column" as const, gap:8 }}>
        {isViewMode ? (
          <>
            <button onClick={onNextStage}
              style={{ width:"100%", padding:"12px 0", borderRadius:10, fontSize:14, fontWeight:800, cursor:"pointer", background:`linear-gradient(135deg, ${c}dd, ${c})`, border:"none", color:"#0a0a14", boxShadow:`0 4px 16px ${c}40` }}>
              {nextBtnLabel}
            </button>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={onNewDebate}
                style={{ flex:1, padding:"9px 0", borderRadius:10, fontSize:12, fontWeight:700, cursor:"pointer", background:"transparent", border:"1px solid #3a2a2a", color:"#f87171" }}>
                🗑 새로 토론
              </button>
              <button onClick={onContinueDebate}
                style={{ flex:2, padding:"9px 0", borderRadius:10, fontSize:12, fontWeight:700, cursor:"pointer", background:"rgba(255,255,255,0.04)", border:"1px solid #2a2a3d", color:"#94a3b8" }}>
                ↩ 이어서 토론
              </button>
            </div>
          </>
        ) : (
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={onContinueDebate}
              style={{ flex:1, padding:"10px 0", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer", background:"transparent", border:"1px solid #2a2a3d", color:"#64748b" }}>
              ✎ 계속 토론
            </button>
            <button onClick={onNextStage}
              style={{ flex:2, padding:"10px 0", borderRadius:10, fontSize:14, fontWeight:800, cursor:"pointer", background:`linear-gradient(135deg, ${c}dd, ${c})`, border:"none", color:"#0a0a14", boxShadow:`0 4px 16px ${c}40` }}>
              {nextBtnLabel}
            </button>
          </div>
        )}
        <button
          disabled={reanalyzing}
          onClick={async () => { setReanalyzing(true); try { await onReanalyze?.(); } finally { setReanalyzing(false); } }}
          style={{ width:"100%", padding:"9px 0", borderRadius:10, fontSize:12, fontWeight:700, cursor:reanalyzing?"default":"pointer", background:"rgba(255,255,255,0.03)", border:"1px solid #252535", color:reanalyzing?"#3a3a52":"#64748b", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
          {reanalyzing ? <><span style={{ display:"inline-block", animation:"spin 1s linear infinite" }}>⟳</span> 분석 중...</> : "🔄 기존 내용 다시 분석"}
        </button>
      </div>

      {/* ── 전체 내용 모달 ── */}
      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.80)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
        >
          <div
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            style={{ background:"#12121e", border:`1px solid ${c}30`, borderRadius:16, padding:"20px 22px", width:"100%", maxWidth:520, maxHeight:"85vh", overflowY:"auto", display:"flex", flexDirection:"column" as const, gap:16 }}
          >
            {/* 모달 헤더 */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:4, height:22, borderRadius:2, background:c, flexShrink:0 }} />
                <span style={{ fontSize:16, fontWeight:800, color:"#f1f5f9" }}>{stage.name}</span>
              </div>
              <button onClick={() => setModalOpen(false)} style={{ background:"transparent", border:"none", color:"#4a4a68", fontSize:20, cursor:"pointer", padding:4, lineHeight:1 }}>✕</button>
            </div>
            {/* 내용 */}
            <div style={{ fontSize:14, color:"#c8d0e0", lineHeight:1.85, whiteSpace:"pre-wrap" as const }}>
              {cleanSummary || "요약이 없습니다."}
            </div>
            {/* 닫기 */}
            <button
              onClick={() => setModalOpen(false)}
              style={{ alignSelf:"flex-end" as const, padding:"8px 22px", borderRadius:8, background:"#1e1e2a", border:"1px solid #2a2a3d", color:"#94a3b8", fontSize:13, fontWeight:700, cursor:"pointer" }}
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


function ImageSearchCard({ query, delayMs = 0 }: { query: string; delayMs?: number; key?: number }) {
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/image-search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error("image-search API failed");
        const data = await res.json() as { urls: string[] };
        if (!cancelled) { setImages(data.urls ?? []); setLoading(false); }
      } catch {
        if (!cancelled) { setError(true); setLoading(false); }
      }
    }, delayMs);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, delayMs]);

  if (loading) return <div style={{ fontSize: 11, color: "#7c6cfc", margin: "6px 0" }}>🔍 이미지 검색 중: "{query}"...</div>;
  if (error || images.length === 0) return <div style={{ fontSize: 11, color: "#4a4a6a", margin: "6px 0" }}>🔍 "{query}" — 이미지 없음</div>;
  return (
    <div style={{ margin: "8px 0" }}>
      <div style={{ fontSize: 10, color: "#7c6cfc", marginBottom: 4 }}>🖼️ {query}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {images.slice(0, 4).map((url, i) => (
          <img key={i} src={url} alt={query}
            style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 6, border: "1px solid #2a2a3d", cursor: "pointer" }}
            onClick={() => window.open(url, "_blank")}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ))}
      </div>
    </div>
  );
}

// ── 캐릭터 갤러리 ────────────────────────────────────────────────────────────
function CharacterGallery({
  chars,
  imageItems,
  stageColor,
  compact = false,
}: {
  chars: Record<string,string>[];
  imageItems: ImageItem[];
  stageColor: string;
  compact?: boolean;
}) {
  const [selectedChar, setSelectedChar] = useState<Record<string,string> | null>(null);
  if (chars.length === 0) return null;
  const c = stageColor;
  // compact 모드: 가로 스크롤 한 줄, 작은 타일
  const tileW = compact ? 72 : 90;

  return (
    <div style={{ padding: compact ? "0" : "10px 0 4px" }}>
      {!compact && (
        <div style={{ fontSize:10, fontWeight:800, color:c, letterSpacing:"0.06em", marginBottom:8, textTransform:"uppercase" as const }}>
          👥 캐릭터 ({chars.length}명) — 누르면 상세 설정
        </div>
      )}

      {/* ── 타일 그리드 ── */}
      <div style={{ display:"flex", gap: compact ? 6 : 8, flexWrap: compact ? "nowrap" as const : "wrap" as const }}>
        {chars.map((ch, i) => {
          const imgItem = imageItems.find(
            (it: ImageItem) => it.type === "character" && it.name === ch.name && it.imageUrl
          );
          const initials = (ch.name || "?").slice(0, 2);
          const roleBg = ch.role === "주인공" ? "#fbbf24" : ch.role === "빌런" ? "#f87171" : "#94a3b8";

          return (
            <div
              key={i}
              onClick={() => setSelectedChar(ch)}
              style={{
                width: tileW,
                cursor: "pointer",
                background: "#16161f",
                border: `1px solid ${c}25`,
                borderRadius: compact ? 8 : 10,
                overflow: "hidden",
                transition: "border-color 0.15s",
                flexShrink: 0,
              }}
            >
              {/* 이미지 or 이니셜 */}
              <div style={{ position:"relative" as const, width:"100%", aspectRatio:"1", background:`${c}10`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                {imgItem?.imageUrl
                  ? <img src={imgItem.imageUrl} alt={ch.name} style={{ width:"100%", height:"100%", objectFit:"cover" as const, display:"block" }} />
                  : <div style={{ fontSize:18, fontWeight:800, color:c }}>{initials}</div>
                }
                {/* 역할 배지 */}
                {ch.role && (
                  <div style={{ position:"absolute" as const, top:4, left:4, background:roleBg, color:"#0a0a14", fontSize:9, fontWeight:800, padding:"2px 5px", borderRadius:4, letterSpacing:"0.3px" }}>
                    {ch.role}
                  </div>
                )}
              </div>
              {/* 이름 + 한 줄 요약 */}
              <div style={{ padding:"5px 7px 7px" }}>
                <div style={{ fontSize:11, fontWeight:800, color:"#f1f5f9", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const }}>{ch.name}</div>
                <div style={{ fontSize:10, color:"#4a5568", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const, marginTop:1 }}>
                  {(ch.personality || ch.gender || "").split(/[,·]/)[0].trim() || "설정 확인 →"}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 캐릭터 상세 모달 (2단 레이아웃) ── */}
      {selectedChar && (() => {
        const selImgItem = imageItems.find(
          (it: ImageItem) => it.type === "character" && it.name === selectedChar.name && it.imageUrl
        );
        const selInitials = (selectedChar.name || "?").slice(0, 2);
        const selRoleBg = selectedChar.role === "주인공" ? "#fbbf24" : selectedChar.role === "빌런" ? "#f87171" : "#94a3b8";
        return (
          <div
            onClick={() => setSelectedChar(null)}
            style={{ position:"fixed" as const, inset:0, background:"rgba(0,0,0,0.88)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
          >
            <div
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              style={{ background:"#12121e", border:`1px solid ${c}30`, borderRadius:16, width:"100%", maxWidth:700, maxHeight:"88vh", display:"flex", flexDirection:"column" as const, overflow:"hidden" }}
            >
              {/* 2단 콘텐츠 영역 */}
              <div style={{ display:"flex", flex:1, overflow:"hidden", minHeight:0 }}>
                {/* 좌측: 이미지 패널 */}
                <div style={{ width:"42%", flexShrink:0, background:`${c}08`, display:"flex", alignItems:"center", justifyContent:"center", position:"relative" as const, overflow:"hidden", minHeight:340 }}>
                  {selImgItem?.imageUrl
                    ? <img src={selImgItem.imageUrl} alt={selectedChar.name} style={{ width:"100%", height:"100%", objectFit:"cover" as const, display:"block", position:"absolute" as const, inset:0 }} />
                    : (
                      <div style={{ display:"flex", flexDirection:"column" as const, alignItems:"center", gap:10 }}>
                        <div style={{ width:88, height:88, borderRadius:"50%", background:`${c}18`, border:`2px solid ${c}40`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, fontWeight:800, color:c }}>{selInitials}</div>
                        <div style={{ fontSize:11, color:`${c}55`, textAlign:"center" as const, padding:"0 16px", lineHeight:1.5 }}>이미지 생성 대기 중</div>
                      </div>
                    )
                  }
                </div>
                {/* 우측: 정보 패널 */}
                <div style={{ flex:1, overflowY:"auto" as const, padding:"24px 22px 16px", position:"relative" as const }}>
                  {/* X 버튼 */}
                  <button onClick={() => setSelectedChar(null)} style={{ position:"absolute" as const, top:14, right:14, background:"transparent", border:"none", color:"#4a4a68", fontSize:20, cursor:"pointer", padding:4, lineHeight:1 }}>✕</button>
                  {/* 이름 */}
                  <div style={{ fontSize:22, fontWeight:800, color:"#f1f5f9", paddingRight:36, lineHeight:1.2, marginBottom:10 }}>{selectedChar.name}</div>
                  {/* 배지 */}
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" as const, marginBottom:20 }}>
                    {selectedChar.role && (
                      <span style={{ background:selRoleBg, color:"#0a0a14", padding:"3px 11px", borderRadius:20, fontSize:11, fontWeight:800 }}>{selectedChar.role}</span>
                    )}
                    {selImgItem?.imageUrl && (
                      <span style={{ background:`${c}18`, color:c, padding:"3px 11px", borderRadius:20, fontSize:11, fontWeight:700, border:`1px solid ${c}35` }}>대표 디자인</span>
                    )}
                  </div>
                  {/* 필드 섹션들 */}
                  {([
                    ["기본 정보", [selectedChar.gender, selectedChar.age, selectedChar.height, selectedChar.weight, selectedChar.build].filter(Boolean).join(" · ")],
                    ["외형 — 얼굴", selectedChar.face],
                    ["외형 — 복장", selectedChar.outfit],
                    ["성격", selectedChar.personality],
                    ["동기", selectedChar.motivation],
                    ["말투", selectedChar.speech],
                    ["서사 역할", selectedChar.story_role],
                    ["기타", selectedChar.other],
                  ] as Array<[string, string]>).filter(([, v]) => v).map(([label, val]) => (
                    <div key={label} style={{ marginBottom:16 }}>
                      <div style={{ fontSize:10, fontWeight:800, color:`${c}75`, letterSpacing:"0.6px", textTransform:"uppercase" as const, marginBottom:4 }}>{label}</div>
                      <div style={{ fontSize:13, color:"#d4dce8", lineHeight:1.75, whiteSpace:"pre-wrap" as const }}>{val}</div>
                    </div>
                  ))}
                  {/* 인물 관계 */}
                  {Array.isArray(selectedChar.relationships) && (selectedChar.relationships as unknown as Array<Record<string,string>>).length > 0 && (
                    <div style={{ marginBottom:16 }}>
                      <div style={{ fontSize:10, fontWeight:800, color:"#34d39975", letterSpacing:"0.6px", textTransform:"uppercase" as const, marginBottom:6 }}>인물 관계</div>
                      {(selectedChar.relationships as unknown as Array<Record<string,string>>).map((r, i) => (
                        <div key={i} style={{ fontSize:12, color:"#94a3b8", marginBottom:5 }}>
                          <span style={{ color:"#f1f5f9", fontWeight:600 }}>{r.character}</span>
                          {r.type && <span style={{ color:c, fontSize:11, background:`${c}15`, padding:"1px 7px", borderRadius:20, marginLeft:6 }}>{r.type}</span>}
                          {r.description && <span style={{ color:"#64748b" }}> — {r.description}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 갈등 관계 */}
                  {Array.isArray(selectedChar.conflicts) && (selectedChar.conflicts as unknown as Array<Record<string,string>>).length > 0 && (
                    <div style={{ marginBottom:16 }}>
                      <div style={{ fontSize:10, fontWeight:800, color:"#f8717175", letterSpacing:"0.6px", textTransform:"uppercase" as const, marginBottom:6 }}>갈등 관계</div>
                      {(selectedChar.conflicts as unknown as Array<Record<string,string>>).map((r, i) => (
                        <div key={i} style={{ fontSize:12, color:"#94a3b8", marginBottom:5 }}>
                          <span style={{ color:"#f1f5f9", fontWeight:600 }}>{r.character}</span>
                          {r.type && <span style={{ color:"#f87171", fontSize:11, background:"rgba(248,113,113,0.12)", padding:"1px 7px", borderRadius:20, marginLeft:6 }}>{r.type}</span>}
                          {r.description && <span style={{ color:"#64748b" }}> — {r.description}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* 하단 닫기 버튼 */}
              <div style={{ padding:"12px 22px", borderTop:"1px solid #1e1e2a", flexShrink:0 }}>
                <button
                  onClick={() => setSelectedChar(null)}
                  style={{ width:"100%", padding:"12px 0", borderRadius:10, background:"#1e1e2a", border:"1px solid #2a2a3d", color:"#94a3b8", fontSize:14, fontWeight:700, cursor:"pointer" }}
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function renderMsgText(text: string) {
  const lines = text.split("\n");
  let imgCount = 0;
  return lines.map((line, i) => {
    if (/^🖼️/.test(line)) {
      const raw = line
        .replace(/^🖼️\s*이미지\s*서치\s*:\s*/i, "")
        .replace(/^🖼️\s*이미지\s*검색\s*:\s*/i, "")
        .replace(/"/g, "").trim();
      const delay = (imgCount++) * 12000;
      return <ImageSearchCard key={i} query={raw} delayMs={delay} />;
    }
    return <span key={i}>{line}{i < lines.length - 1 ? "\n" : ""}</span>;
  });
}

function MsgBubble({ msg, onReply }: { key?: string; msg: Msg; onReply?: (m: Msg) => void }) {
  const ag = AGENTS[msg.agent];
  const isUser = msg.agent === "user";

  // ── 회의록작성자 전용 카드 렌더링 ──
  if (msg.agent === "meetingrecorder") {
    const lines = msg.text.split("\n");
    const title = lines[0] ?? "";
    const body = lines.slice(2).join("\n"); // 빈 줄 뒤 본문
    return (
      <div style={{ margin: "14px 0", padding: "14px 16px", background: "rgba(148,163,184,0.05)", border: "1px solid rgba(148,163,184,0.15)", borderRadius: 12, borderLeft: "3px solid #94a3b8" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 14 }}>📋</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" as const }}>회의록작성자</span>
          <div style={{ flex: 1, height: 1, background: "rgba(148,163,184,0.15)" }} />
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.85, whiteSpace: "pre-wrap" as const }}>{body}</div>
        {msg.streaming && <StreamCursor />}
      </div>
    );
  }

  // 명시적 다음 발언자 지정 감지
  const nextAgentId = !msg.streaming ? parseNextAgent(msg.text) : null;
  const nextAgentInfo = nextAgentId ? AGENTS[nextAgentId] : null;
  // 텍스트에서 `→ @xxx` 부분 제거해 표시
  const displayText = nextAgentId ? msg.text.replace(/\s*→\s*@[^\s\]]+\s*$/, "").trimEnd() : msg.text;

  return (
    <div className={`${s.msgRow} ${isUser ? s.msgRowUser : ""}`}>
      {!isUser && <div className={s.avatar} style={{ background: ag.bg, color: ag.color, border: `1px solid ${ag.color}40` }}>{ag.ini}</div>}
      <div className={s.msgMain}>
        {!isUser && <div className={s.agentName} style={{ color: ag.color }}>{ag.label}</div>}
        {msg.replyQuote && (
          <div style={{ fontSize: 11, color: "#7878a0", background: "rgba(120,120,160,0.08)", borderLeft: "2px solid #7878a0", padding: "3px 8px", borderRadius: "0 4px 4px 0", marginBottom: 4 }}>
            ↩ <b>{msg.replyQuote.agentLabel}</b> — {msg.replyQuote.preview}{msg.replyQuote.preview.length >= 60 ? "..." : ""}
          </div>
        )}
        <div
          className={`${s.bubble} ${isUser ? s.bubbleUser : ""}`}
          style={{ ...(!isUser ? { borderLeft: `3px solid ${ag.color}60` } : {}), ...(onReply ? { cursor: "pointer" } : {}) }}
          onClick={() => { if (onReply && !msg.streaming) onReply(msg); }}
          title={onReply && !msg.streaming ? "클릭해서 댓글 달기" : undefined}
        >
          {msg.streaming && !msg.text ? <ThinkingDots /> : (
            <span className={s.msgText} style={{ whiteSpace: "pre-wrap" }}>{renderMsgText(displayText)}{msg.streaming && <StreamCursor />}</span>
          )}
          {msg.imageUrl && (
            <img src={msg.imageUrl} alt="concept art"
              style={{ display: "block", maxWidth: 320, width: "100%", borderRadius: 8, marginTop: 10, border: "1px solid #2a2a3d", objectFit: "cover" }}
            />
          )}
        </div>
        {/* 다음 발언자 지정 배지 */}
        {nextAgentInfo && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
            <span style={{ fontSize: 10, color: "#4a4a68" }}>→</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: nextAgentInfo.color, background: `${nextAgentInfo.color}18`, border: `1px solid ${nextAgentInfo.color}35`, borderRadius: 20, padding: "1px 8px" }}>
              {nextAgentInfo.label}
            </span>
          </div>
        )}
      </div>
      {isUser && <div className={s.avatar} style={{ background: ag.bg, color: ag.color, border: `1px solid ${ag.color}40` }}>나</div>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Phase2Page({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── State ──
  const [genre, setGenre] = useState("판타지");
  const [appReady, setAppReady] = useState(false); // localStorage 복원 완료 여부 (init 화면 깜빡임 방지)
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [debatePhase, setDebatePhase] = useState<DebatePhase>("idle");
  const [currentStageIdx, setCurrentStageIdx] = useState(0); // index into STAGES
  const [stageResults, setStageResults] = useState<StageResult[]>([]);
  // stageResultHistory: stageIdx → 이전 버전 배열 (현재 활성 버전 제외)
  const [stageResultHistory, setStageResultHistory] = useState<Record<number, StageResult[]>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [coveredAgendaIds, setCoveredAgendaIds] = useState<string[]>([]); // 완료된 아젠다 항목
  const [agendaTurnCounts, setAgendaTurnCounts] = useState<Record<string, number>>({}); // 항목별 누적 턴수
  const [activeStageAgenda, setActiveStageAgenda] = useState<AgendaItem[]>([]); // 현재 토론의 실제 아젠다 (동적)
  const [debateModel, setDebateModel] = useState<DebateModelP2>("claude-sonnet-4-6"); // 모델 선택
  const [rejectedItems, setRejectedItems] = useState<string[]>([]); // 블랙리스트
  const rejectedItemsRef = useRef<string[]>([]);
  const [replyTo, setReplyTo] = useState<{ msg: Msg; agentLabel: string; preview: string } | null>(null); // reply-to
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [stageHistoryMsgs, setStageHistoryMsgs] = useState<Record<number, Msg[]>>({}); // 단계별 토론 기록
  const [agendaExpanded, setAgendaExpanded] = useState(false); // 아젠다 체크리스트 펼침 여부
  const [versionHistoryModal, setVersionHistoryModal] = useState<{ stageIdx: number } | null>(null); // 버전 히스토리 모달

  // ── 시놉시스 4단계 워크플로우 State ──
  type SynopsisStep = "idle" | "learning" | "persona" | "logline" | "completing" | "completing_wait";
  const [synopsisStep, setSynopsisStep] = useState<SynopsisStep>("idle");
  const [synopsisLoglines, setSynopsisLoglines] = useState<string[]>([]);
  const [selectedLogline, setSelectedLogline] = useState<string>("");
  const [step4CountDown, setStep4CountDown] = useState(0); // Step 4 대기 카운트다운 (초)
  const synopsisStepRef = useRef<SynopsisStep>("idle");
  // logline 선택을 기다리는 Promise resolver
  const loglineResolverRef = useRef<((logline: string) => void) | null>(null);
  // Step 4 "다음 에이전트" 수동 진행 resolver
  const step4ProceedRef = useRef<(() => void) | null>(null);

  // ── 에셋 리스트 단계 State (Stage 2 완료 후 스타일 전 삽입) ──
  type AssetListPhase = "idle" | "reviewing" | "confirmed";
  const [assetListPhase, setAssetListPhase] = useState<AssetListPhase>("idle");
  const [editableAssets, setEditableAssets] = useState<SynopsisAssets>({ characters: [], locations: [], props: [] });
  // 각 섹션별 새 항목 입력값
  const [newCharInput, setNewCharInput] = useState("");
  const [newLocInput, setNewLocInput] = useState("");
  const [newPropInput, setNewPropInput] = useState("");
  // 에셋 상세 모달
  const [assetModal, setAssetModal] = useState<{ type: "char" | "loc" | "prop"; item: Record<string,string> } | null>(null);

  // ── 스타일 정의 State (Stage 2 완료 후 삽입) ──
  type StylePhase = "idle" | "debating" | "reviewing" | "generating" | "confirmed";
  const [stylePhase, setStylePhase] = useState<StylePhase>("idle");
  const [conceptStyle, setConceptStyle] = useState(""); // 확정된 스타일 프롬프트
  const [styleTestImages, setStyleTestImages] = useState<string[]>([]); // 테스트 이미지 URL들
  const [styleGenLoading, setStyleGenLoading] = useState(false);
  const [styleGenError, setStyleGenError] = useState<string | null>(null);
  const [styleInput, setStyleInput] = useState(""); // 사용자가 편집하는 스타일 텍스트

  // ── 이미지 컨셉 회의 State (Stage 3/4/5 완료 후 삽입) ──
  // pre-debate: 사전 회의 (방향 논의)
  // extracting: 4방향 추출 중
  // generating: 4개 이미지 병렬 생성
  // post-debate: 검토 회의 (이미지 평가)
  // recommending: 에이전트 추천 발표
  // selecting: 사용자 선택 대기
  type ImageSessionPhase = "idle" | "pre-debate" | "extracting" | "generating" | "post-debate" | "recommending" | "selecting";
  const [imageSessionPhase, setImageSessionPhase] = useState<ImageSessionPhase>("idle");
  const [imageItems, setImageItems] = useState<ImageItem[]>([]);
  const [currentImageItemIdx, setCurrentImageItemIdx] = useState(0);
  const [imageConcepts, setImageConcepts] = useState<ImageConcept[]>([]);
  const [imageRoundNum, setImageRoundNum] = useState(1);
  const [imageGenLoading, setImageGenLoading] = useState(false);
  const [imageGenError, setImageGenError] = useState<string | null>(null);
  const [imageCustomDir, setImageCustomDir] = useState(""); // 사용자 커스텀 방향 입력
  const [newStageChoice, setNewStageChoice] = useState<{
    stageIdx: number; transcript: string[]; msgs: Msg[]
  } | null>(null); // 이전 단계에서 넘어올 때 기존 토론 내용 이어하기/새로 시작 선택 UI

  // ── Refs ──
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null); // 채팅 스크롤 컨테이너
  const viewScrollRef = useRef<HTMLDivElement>(null); // 뷰 모드 스크롤 컨테이너
  const runningRef = useRef(false);
  const abortRef = useRef(false);
  const pendingUserMsgRef = useRef<string | null>(null);
  const convRef = useRef<string[]>([]); // transcript: 각 에이전트 발언 문자열 배열
  const stageResultsRef = useRef<StageResult[]>([]);
  const stageResultHistoryRef = useRef<Record<number, StageResult[]>>({}); // stageIdx → 이전 버전들
  const msgsRef = useRef<Msg[]>([]); // msgs의 최신값 추적용
  const resumeDataRef = useRef<{ transcript: string[]; msgs: Msg[] } | null>(null);
  const p1DataRef = useRef<P1Data | null>(null); // Phase 1 분석 결과 인계용
  const styleRunningRef = useRef(false);
  const styleConvRef = useRef<string[]>([]);
  const pendingDebateStartRef = useRef<number | null>(null); // 뷰 모드 → 다음 단계 자동 시작용
  const pendingResumeRef = useRef<number | null>(null);      // 페이지 재로드·이어서 토론 자동 재개용
  const pendingStyleMsgRef = useRef<string | null>(null);
  const imageItemsRef = useRef<ImageItem[]>([]);
  const imageTargetStageIdxRef = useRef<number>(0);
  const imageCurrentItemIdxRef = useRef(0);
  const imageConvRef = useRef<string[]>([]);
  const pendingImageMsgRef = useRef<string | null>(null);
  const imageDebateRunRef = useRef(false);
  const imageAbortRef = useRef(false);
  const isComposingRef = useRef(false);
  const imageConceptsRef = useRef<ImageConcept[]>([]);
  const imageSelectedDirRef = useRef(""); // 이전 라운드에서 선택한 방향
  // 전 스테이지 통합 확정 아이템 목록 — 일관성 컨텍스트 구성에 사용
  const confirmedAllItemsRef = useRef<ImageItem[]>([]);
  // 시놉시스에서 추출한 에셋 목록 — Stage 3/4/5 에이전트에게 전달
  const synopsisAssetsRef = useRef<SynopsisAssets | null>(null);

  // ── Mount: restore from localStorage ──
  useEffect(() => {
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.genre) setGenre(p1.input.genre);
      if (p1?.data) {
        p1DataRef.current = {
          concept:             p1.data.concept,
          summary:             p1.data.summary,
          final_report:        p1.data.final_report,
          worldbuilding_notes: p1.data.worldbuilding_notes,
          similar_works:       p1.data.similar_works,
          strengths:           p1.data.strengths,
          weaknesses:          p1.data.weaknesses,
          improvements:        p1.data.improvements,
          genre_analysis:      p1.data.genre_analysis,
        };
      }

      // 에셋 리스트 복원 (isRealCharacter 필터 재적용)
      const savedAssets = localStorage.getItem(`wts_asset_list_${projectId}`);
      if (savedAssets) {
        const raw = JSON.parse(savedAssets) as SynopsisAssets;
        const parsed: SynopsisAssets = {
          characters: raw.characters.filter(isRealCharacter),
          locations: raw.locations,
          props: raw.props,
        };
        synopsisAssetsRef.current = parsed;
        setEditableAssets(parsed);
        setAssetListPhase("confirmed");
      }

      // 확정된 스타일 복원
      const savedStyle = localStorage.getItem(`wts_style_${projectId}`);
      if (savedStyle) { setConceptStyle(savedStyle); setStyleInput(savedStyle); setStylePhase("confirmed"); }

      const savedData = localStorage.getItem(`wts_phase2_${projectId}`);
      if (savedData) {
        const parsed = JSON.parse(savedData) as { stageResults: StageResult[]; stageResultHistory?: Record<number, StageResult[]>; currentStageIdx: number; stageHistoryMsgs?: Record<number, Msg[]>; pendingDebateStart?: number; pendingResume?: number };
        if (parsed.stageResults?.length) {
          stageResultsRef.current = parsed.stageResults;
          setStageResults(parsed.stageResults);
          if (parsed.stageHistoryMsgs) setStageHistoryMsgs(parsed.stageHistoryMsgs);
          if (parsed.stageResultHistory) {
            stageResultHistoryRef.current = parsed.stageResultHistory;
            setStageResultHistory(parsed.stageResultHistory);
          }
          const idx = parsed.currentStageIdx ?? 0;
          setCurrentStageIdx(idx);
          // pendingDebateStart: 뷰 모드에서 다음 단계 버튼 눌렀을 때 자동 시작 플래그
          if (typeof parsed.pendingDebateStart === "number") {
            pendingDebateStartRef.current = parsed.pendingDebateStart;
            // 플래그 제거 후 저장
            const { pendingDebateStart: _pd, ...rest } = parsed;
            void _pd;
            try { localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify(rest)); } catch { /* ignore */ }
          }
          // pendingResume: 뷰 모드에서 "이어서 토론" 버튼 눌렀을 때 자동 재개 플래그
          if (typeof parsed.pendingResume === "number") {
            pendingResumeRef.current = parsed.pendingResume;
            const { pendingResume: _pr, ...restPR } = parsed;
            void _pr;
            try { localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify(restPR)); } catch { /* ignore */ }
          }
          if (idx >= STAGES.length) {
            setDebatePhase("done");
          } else if (pendingDebateStartRef.current !== null) {
            // pendingDebateStart가 있으면 auto-start effect가 즉시 토론 시작 — confirmed 렌더 스킵
            setDebatePhase("idle");
          } else if (pendingResumeRef.current !== null) {
            // pendingResume(이어서 토론)도 마찬가지 — confirmed 렌더 없이 바로 재개
            setDebatePhase("idle");
          } else {
            // 진행 중인 토론이 저장되어 있으면 "이어하기" 상태로
            const savedConv = localStorage.getItem(`p2_conv_${idx}_${projectId}`);
            const savedMsgs = localStorage.getItem(`p2_msgs_${idx}_${projectId}`);
            if (savedConv && savedMsgs) {
              resumeDataRef.current = {
                transcript: JSON.parse(savedConv) as string[],
                msgs: JSON.parse(savedMsgs) as Msg[],
              };
              pendingResumeRef.current = idx; // "이어하기" 버튼 대신 자동 재개 (crash recovery + view mode resume 공통)
            } else {
              setDebatePhase("confirmed");
            }
          }
          setAppReady(true); // localStorage 복원 완료 (early return 전에 호출)
          return;
        }
      }
    } catch { /* ignore */ }
    setAppReady(true); // 저장 데이터 없는 경우 (첫 방문)
  }, [projectId]);

  useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  // 새 메시지 추가 시 채팅 하단으로 스크롤
  const scrollChatToBottom = (instant = false) => {
    const el = chatBodyRef.current;
    if (!el) return;
    if (instant) { el.scrollTop = el.scrollHeight; return; }
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };
  useEffect(() => { scrollChatToBottom(); }, [msgs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (debatePhase === "confirmed") {
      setTimeout(() => scrollChatToBottom(), 100);
    }
  }, [debatePhase]); // eslint-disable-line react-hooks/exhaustive-deps

  // 페이지 초기 로드 완료 후 최신 메시지로 즉시 이동
  // requestAnimationFrame 2회: 1번째 = React 커밋 이후, 2번째 = 브라우저 페인트 이후
  useEffect(() => {
    if (!appReady) return;
    let raf1: number, raf2: number;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        scrollChatToBottom(true);
        // 뷰 모드(?view=N)로 직접 로드 시 viewScrollRef도 하단으로 이동
        if (viewScrollRef.current) {
          viewScrollRef.current.scrollTop = viewScrollRef.current.scrollHeight;
        }
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [appReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // 뷰 모드 진입 시 채팅 기록 하단으로 스크롤
  useEffect(() => {
    if (!viewScrollRef.current) return;
    const t = setTimeout(() => {
      if (viewScrollRef.current) viewScrollRef.current.scrollTop = viewScrollRef.current.scrollHeight;
    }, 150);
    return () => clearTimeout(t);
  }, [searchParams]);

  useEffect(() => {
    if (!projectId || msgs.length === 0) return;
    if (msgs.some((m: Msg) => m.streaming)) return;
    localStorage.setItem(`p2_msgs_${projectId}`, JSON.stringify(msgs));
  }, [msgs, projectId]);

  // 뷰 모드에서 다음 단계 버튼 → 자동 토론 시작 / 페이지 재로드·이어서 토론 → 자동 재개
  useEffect(() => {
    if (pendingDebateStartRef.current !== null) {
      const idx = pendingDebateStartRef.current;
      pendingDebateStartRef.current = null;
      resumeDataRef.current = null;
      runningRef.current = false;   // 혹시 stuck된 상태 초기화
      abortRef.current = false;
      setCurrentStageIdx(idx);
      setDebatePhase("idle");
      // 저장된 진행 내용 있으면 선택 UI 표시 (pendingDebateStart도 기존 데이터 우선)
      const savedConv = localStorage.getItem(`p2_conv_${idx}_${projectId}`);
      const savedMsgs = localStorage.getItem(`p2_msgs_${idx}_${projectId}`);
      if (savedConv && savedMsgs) {
        try {
          const parsedT = JSON.parse(savedConv) as string[];
          const parsedM = JSON.parse(savedMsgs) as Msg[];
          if (parsedT.length > 0 || parsedM.length > 0) {
            setMsgs([]);          // 모달 표시 중 이전 채팅 완전히 숨김
            convRef.current = [];
            setNewStageChoice({ stageIdx: idx, transcript: parsedT, msgs: parsedM });
            return;
          }
        } catch { /* ignore */ }
      }
      setMsgs([]);
      convRef.current = [];
      void runDebate(idx);
      return;
    }
    if (pendingResumeRef.current !== null) {
      const idx = pendingResumeRef.current;
      pendingResumeRef.current = null;
      runningRef.current = false;
      abortRef.current = false;
      // 크래시 복구: 저장된 내용이 있으면 자동 재개 대신 선택 UI 표시
      if (resumeDataRef.current) {
        const data = resumeDataRef.current;
        resumeDataRef.current = null;
        setCurrentStageIdx(idx);
        setNewStageChoice({ stageIdx: idx, transcript: data.transcript, msgs: data.msgs });
      } else {
        void runDebate(idx);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // mount 시 1회만 실행

  // 뷰 모드 → 메인 모드 소프트 내비게이션 감지: ?view 파라미터 사라지면 자동 재개
  const searchParamsStr = searchParams.toString();
  useEffect(() => {
    const viewGone = !searchParams.get("view");
    if (!viewGone) return;
    if (pendingResumeRef.current === null) return;
    if (runningRef.current) return;
    const idx = pendingResumeRef.current;
    pendingResumeRef.current = null;
    runningRef.current = false;
    abortRef.current = false;
    void runDebate(idx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParamsStr]);

  // 블랙리스트 localStorage 동기화
  useEffect(() => {
    rejectedItemsRef.current = rejectedItems;
    if (rejectedItems.length > 0) {
      try { localStorage.setItem(`p2_rejected_${projectId}`, JSON.stringify(rejectedItems)); } catch { /* quota */ }
    }
  }, [rejectedItems, projectId]);

  // 블랙리스트 복원 (mount)
  useEffect(() => {
    if (!projectId) return;
    try {
      const saved = localStorage.getItem(`p2_rejected_${projectId}`);
      if (saved) {
        const list = JSON.parse(saved) as string[];
        setRejectedItems(list);
        rejectedItemsRef.current = list;
      }
    } catch { /* ignore */ }
  }, [projectId]);

  useEffect(() => {
    const id = "wts-blink-style";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id;
      el.textContent = "@keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} } @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }";
      document.head.appendChild(el);
    }
  }, []);

  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  // ── Message helpers ──
  const addMsg = useCallback((agent: AgentId, text = "", streaming = false): string => {
    const id = uid();
    setMsgs((prev: Msg[]) => [...prev, { id, agent, text, streaming }]);
    return id;
  }, []);

  const updateMsg = useCallback((id: string, text: string, streaming: boolean) => {
    setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === id ? { ...m, text, streaming } : m));
  }, []);

  // ── Run debate: 자연스러운 토론 루프 (Phase 1과 동일 방식) ──
  const runDebate = useCallback(async (stageIdx: number) => {
    if (runningRef.current) return;
    runningRef.current = true;
    abortRef.current = false;
    setDebatePhase("running");
    setApiError(null);

    const stage = STAGES[stageIdx];

    // Stage 3/4/5 시작 전 — Stage 1/2 확정 JSON 데이터로 synopsisAssetsRef 보강
    // (비동기 AI 추출이 완료되지 않았을 때 대비, 구조화 JSON에서 직접 병합)
    if (stageIdx >= 2) {
      const s1res = stageResultsRef.current.find((r: StageResult) => r.stageId === 1);
      const s2res = stageResultsRef.current.find((r: StageResult) => r.stageId === 2);
      const s1d = s1res?.data;
      const s2d = s2res?.data;
      const names = (arr: unknown, key: string): string[] =>
        Array.isArray(arr) ? (arr as Record<string,string>[]).map(x => x[key]).filter(Boolean) : [];

      const prev = synopsisAssetsRef.current ?? { characters: [], locations: [], props: [] };
      const chars = [...new Set([
        ...prev.characters,
        ...names(s1d?.key_characters, "name").filter(isRealCharacter),
        ...names(s2d?.characters, "name").filter(isRealCharacter),
      ])];
      const locs = [...new Set([
        ...prev.locations,
        ...names(s1d?.key_locations, "name"),
        ...names(s2d?.locations, "name"),
      ])];
      const merged: SynopsisAssets = { characters: chars, locations: locs, props: prev.props };
      synopsisAssetsRef.current = merged;
      // editableAssets와도 동기화
      setEditableAssets((cur: SynopsisAssets) => {
        const next: SynopsisAssets = {
          characters: [...new Set([...cur.characters, ...chars])],
          locations:  [...new Set([...cur.locations,  ...locs])],
          props:      cur.props,
        };
        localStorage.setItem(`wts_asset_list_${projectId}`, JSON.stringify(next));
        return next;
      });
    }

    // 롤링 요약 + 결정사항 추적 + 사용자 컨텍스트 상태
    let conversationSummary = "";
    let stageDecisions: { agreed: string[]; rejected: string[]; pending: string[] } = {
      agreed: [], rejected: [], pending: [],
    };
    let turnsSinceLastSummary = 0;
    let lastUserMsg = "";
    let userTurnCount = 0;
    let wrapUpProposed = false;
    let wrapUpProposedAt = 0;
    let wrapUpRejectedTurn = -999; // 사용자가 마무리 거부한 턴 — 거부 후 최소 N턴 대기용
    let naturalExit = false;
    // Stage 3/4/5: 이전 단계 결과에서 동적 아젠다 빌드 (캐릭터/장소별 필수 항목 세분화)
    // Stage 1/2: 정적 아젠다 유지
    const stageAgenda = buildDynamicAgenda(stage.id, stageResultsRef.current);
    setActiveStageAgenda(stageAgenda); // UI 체크리스트에 반영
    const minTurnsForStage = MIN_TURNS_BY_STAGE[stage.id] ?? MIN_TURNS_PER_TOPIC_P2;
    // WRAP_UP_AFTER: 안전망(hard cap)용 — 항목당 최대 12턴 × 아젠다 수
    // allCovered && converging이 실질적 1차 트리거이며, WRAP_UP_AFTER는 무한 토론 방지용
    const WRAP_UP_AFTER = Math.max(stageAgenda.length * 12, stage.id === 1 ? 60 : 40);
    const WRAP_UP_AUTO_MS = stage.id === 1 ? 30_000 : 60_000; // 바이블 스테이지는 60초
    // 아젠다 추적 (스테이지마다 초기화)
    const coveredAgenda = new Set<string>();
    const agendaTurns: Record<string, number> = {};
    let nudgeCooldown = 0;
    // UI 초기화
    setCoveredAgendaIds([]);
    setAgendaTurnCounts({});
    const AGREE_RE = /^(그래|응|ㅇㅇ|좋아|해줘|시작|정리|맞아|그렇게|ㄱ|ok|오케|ㅇㅋ|확인|다음)/i;

    // 이어하기: 저장된 트랜스크립트 복원 / 새 시작: 빈 배열
    let transcript: string[];
    if (resumeDataRef.current) {
      transcript = [...resumeDataRef.current.transcript];
      setMsgs(resumeDataRef.current.msgs);
      resumeDataRef.current = null;
    } else {
      transcript = [];
    }
    convRef.current = transcript;
    // 이 runDebate 세션 시작 시점의 에이전트 턴 수 → WRAP_UP_AFTER는 여기서부터 카운트
    const agentTurnsAtSessionStart = transcript.filter(l => !l.startsWith("[사용자]")).length;
    // 이어하기 시: rejection 기준점을 시작점으로 설정 (첫 WRAP_UP_AFTER 새 턴은 마무리 차단)
    if (agentTurnsAtSessionStart > 0) {
      wrapUpRejectedTurn = agentTurnsAtSessionStart;
    }

    // Phase 2 토론 에이전트 풀 (producer·meetingrecorder·user·scriptwriter 제외 — 별도 역할)
    // scriptwriter는 Phase 4에서 주로 활약, Phase 2에서는 명시적 지정으로만 참여
    const P2_AGENTS: AgentId[] = ["worldbuilder", "character", "scenario", "script", "editor", "foreshadowing", "audiencepanel"];
    let agentIndex = 0;
    let lastSpeaker: AgentId | null = null;
    let secondToLastSpeaker: AgentId | null = null; // 직전 2명 추적 — 같은 에이전트 연속 방지

    // 빈도 제한: 특정 에이전트는 N턴에 한 번꼴로만 발언 (흐름 유지)
    const AGENT_FREQUENCY: Partial<Record<AgentId, number>> = {
      editor:        3,  // 3턴마다 한 번 (날카로운 비판은 집중적으로)
      foreshadowing: 3,  // 3턴마다 한 번 (복선 타이밍은 전략적으로)
      audiencepanel: 4,  // 4턴마다 한 번 (독자 반응은 핵심 포인트에서)
    };

    function pickNextSpeaker(lastLine: string, last: AgentId | null, secondLast: AgentId | null): AgentId {
      // 0. 명시적 지정 감지: → @agentId (직전 2명 제외 규칙보다 우선)
      const explicit = parseNextAgent(lastLine);
      if (explicit && P2_AGENTS.includes(explicit)) return explicit;

      // 직전 2명 제외 (같은 에이전트가 연속으로 나타나는 현상 방지)
      const available = P2_AGENTS.filter(a => a !== last && a !== secondLast);
      const safeAvail = available.length > 0 ? available : P2_AGENTS.filter(a => a !== last);
      if (!safeAvail.length) return P2_AGENTS[0];
      const lower = lastLine.toLowerCase();

      // 키워드 매칭: 주제에 맞는 전문가 우선
      if (/세계|배경|규칙|설정|시대|문명|마법|공간|당위성|인과/.test(lower) && safeAvail.includes("worldbuilder")) return "worldbuilder";
      if (/캐릭터|인물|주인공|감정|성격|외형|말투|빌런|외모|트라우마/.test(lower) && safeAvail.includes("character")) return "character";
      if (/이야기|서사|플롯|갈등|전개|장르|훅|전제|결말|발단|위기/.test(lower) && safeAvail.includes("scenario")) return "scenario";
      if (/그림|연출|장면|시각|컷|화면|비주얼|앵글|조명|색감/.test(lower) && safeAvail.includes("script")) return "script";
      if (/편집|구조|흐름|전반적|연결|독자이탈|지루/.test(lower) && safeAvail.includes("editor")) return "editor";
      if (/복선|암시|회수|씨앗|긴장|불길|예감|반전|떡밥/.test(lower) && safeAvail.includes("foreshadowing")) return "foreshadowing";
      if (/독자|대중|흥행|클릭|구독|반응|공감|재미|지루|몰입/.test(lower) && safeAvail.includes("audiencepanel")) return "audiencepanel";

      // 빈도 제한: 주기 조건 미충족 시 해당 에이전트 억제
      const suppressed = new Set<AgentId>();
      for (const [agent, freq] of Object.entries(AGENT_FREQUENCY) as [AgentId, number][]) {
        if (agentIndex % freq !== 0) suppressed.add(agent);
      }
      const freqFiltered = safeAvail.filter(a => !suppressed.has(a));
      const pool = freqFiltered.length > 0 ? freqFiltered : safeAvail;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    // 롤링 요약 (백그라운드 비동기, 누적 갱신)
    const refreshSummary = () => {
      if (transcript.length < 3) return;
      const key = getAnthropicKeyByIndex(getApiKeyIndexForAgent(agentIndex));
      if (!key) return;
      void (async () => {
        let next = "";
        try {
          for await (const chunk of streamClaude({
            apiKey: key,
            model: "claude-sonnet-4-6",
            systemPrompt: "웹툰 기획 토론 기록 전문가. 빠짐없이 정확하게 정리해. 마크다운 금지.",
            messages: [{
              role: "user",
              content: [
                conversationSummary ? `[이전 요약]\n${conversationSummary}\n\n` : "",
                `[최근 대화]\n${transcript.slice(-8).join("\n")}\n\n`,
                `위 내용을 합쳐서 토론 진행 상황 요약문을 작성해줘.\n`,
                `다음 순서로:\n`,
                `1. 현재 논의 중인 핵심 주제와 방향 (2~3문장)\n`,
                `2. 팀이 탐색한 주요 아이디어·선택지·의견들 (2~3문장)\n`,
                `3. 사용자가 언급한 내용이나 선호도 (있다면, 1~2문장)\n`,
                `총 5~8문장. 구체적인 설정값(연도, 이름, 규칙 등)은 반드시 포함.`,
              ].filter(Boolean).join(""),
            }],
            maxTokens: 400,
            tools: [],
          })) next += chunk;
        } catch { /* ignore */ }
        if (next.trim()) conversationSummary = next.trim();
      })();
    };

    const refreshDecisions = () => {
      if (transcript.length < 5) return;
      const key = getAnthropicKeyByIndex(getApiKeyIndexForAgent(agentIndex));
      if (!key) return;
      void (async () => {
        let raw = "";
        try {
          for await (const chunk of streamClaude({
            apiKey: key,
            model: "claude-sonnet-4-6",
            systemPrompt: "웹툰 기획 토론 분석가. JSON만 출력. 설명 없이.",
            messages: [{
              role: "user",
              content: [
                stageDecisions.agreed.length > 0
                  ? `[이미 합의된 내용 — 중복 추출 금지]\n${stageDecisions.agreed.map(d => `• ${d}`).join("\n")}\n\n`
                  : "",
                `[토론 내용]\n${transcript.slice(-10).join("\n")}\n\n`,
                `위 토론에서 새롭게 확인된 합의·거부·미결 항목을 추출해줘.\n`,
                `출력 형식 (JSON만, 설명 없이):\n`,
                `{"agreed":["합의 항목 (구체적 설정값 포함)"],"rejected":["팀/사용자가 거부한 방향"],"pending":["아직 결정 안 된 중요 쟁점"]}\n`,
                `각 항목은 한 줄 이내. 없으면 빈 배열.`,
              ].filter(Boolean).join(""),
            }],
            maxTokens: 300,
            tools: [],
          })) raw += chunk;
        } catch { /* ignore */ }
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            const parsed = JSON.parse(m[0]) as { agreed?: string[]; rejected?: string[]; pending?: string[] };
            stageDecisions = {
              agreed:   [...new Set([...stageDecisions.agreed,   ...(parsed.agreed   ?? [])])],
              rejected: [...new Set([...stageDecisions.rejected, ...(parsed.rejected ?? [])])],
              pending:  parsed.pending ?? stageDecisions.pending,
            };
          } catch { /* ignore */ }
        }
      })();
    };

    // ── 살아있는 현황판 (Living Doc) ──────────────────────────────────────────────
    let meetingDoc: MeetingDoc | null = null;
    const MEETING_INTERVAL = 12; // 12 에이전트 턴마다 회의록 갱신

    const formatDoc = (doc: MeetingDoc): string => [
      doc.confirmed.length  > 0 ? `[확정] ${doc.confirmed.join(" / ")}` : "",
      doc.exploring.length  > 0 ? `[논의 중] ${doc.exploring.join(" / ")}` : "",
      doc.rejected.length   > 0 ? `[거부됨] ${doc.rejected.join(" / ")}` : "",
      doc.user_prefs.length > 0 ? `[사용자 선호] ${doc.user_prefs.join(" / ")}` : "",
    ].filter(Boolean).join("\n");

    const updateLivingDoc = async (): Promise<void> => {
      if (transcript.length < 6 || abortRef.current) return;
      const key = getAnthropicKeyByIndex(getApiKeyIndexForAgent(agentIndex));
      if (!key) return;
      let raw = "";
      try {
        for await (const chunk of streamClaude({
          apiKey: key,
          model: debateModel,
          systemPrompt: "웹툰 기획 토론 분석가. JSON만 출력. 설명 없이.",
          messages: [{
            role: "user",
            content: [
              meetingDoc ? `[기존 현황판]\n${JSON.stringify(meetingDoc)}\n\n` : "",
              `[최근 대화]\n${transcript.slice(-15).join("\n")}\n\n`,
              "위 내용을 바탕으로 기획 현황판을 갱신하세요.\n",
              `{"confirmed":["확정 설정 (구체 수치·이름 포함)"],"exploring":["현재 논의 중인 아이디어"],"rejected":["팀/사용자가 거부한 방향"],"user_prefs":["사용자가 언급한 선호"]}\n`,
              "각 배열 항목은 1줄 이내, 최대 7개. 기존 현황판과 최근 대화를 합쳐서 덮어씀. JSON만.",
            ].filter(Boolean).join(""),
          }],
          maxTokens: 500,
          tools: [],
        })) { if (abortRef.current) break; raw += chunk; }
      } catch { return; }
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return;
      try {
        const doc = JSON.parse(m[0]) as MeetingDoc;
        meetingDoc = doc;
        // 채팅창에 회의록 버블 추가
        const lines = [
          doc.confirmed.length  > 0 ? `✅ 확정\n${doc.confirmed.map(s => `• ${s}`).join("\n")}` : "",
          doc.exploring.length  > 0 ? `⏳ 논의 중\n${doc.exploring.map(s => `• ${s}`).join("\n")}` : "",
          doc.rejected.length   > 0 ? `❌ 거부됨\n${doc.rejected.map(s => `• ${s}`).join("\n")}` : "",
          doc.user_prefs.length > 0 ? `👤 선호\n${doc.user_prefs.map(s => `• ${s}`).join("\n")}` : "",
        ].filter(Boolean).join("\n\n");
        const msgId = addMsg("meetingrecorder", `지금까지 논의를 정리할게요.\n\n${lines}`, false);
        transcript.push(`[회의록작성자]: [기획 현황 정리됨]`);
        convRef.current = transcript;
        // 저장
        try {
          localStorage.setItem(`p2_conv_${stageIdx}_${projectId}`, JSON.stringify(transcript));
          localStorage.setItem(`p2_msgs_${stageIdx}_${projectId}`, JSON.stringify(msgsRef.current.filter((m2: Msg) => !m2.streaming)));
        } catch { /* ignore */ }
        void msgId;
      } catch { /* ignore */ }
    };

    // 단일 에이전트 타이프라이터 효과 (백그라운드 스트림 → 재생)
    const runSingleAgent = async (agentId: AgentId, userContent: string, tokens: number, isContinuation = false) => {
      const key = getAnthropicKeyByIndex(getApiKeyIndexForAgent(agentIndex));
      if (!key) return;
      // 전역 lock: 어떤 에이전트든 스트리밍 중이면 완료 대기 (한 번에 한 명만 발언, 최대 60초)
      const waitDedup = Date.now();
      while (
        msgsRef.current.some((m: Msg) => m.streaming) &&
        Date.now() - waitDedup < 60000
      ) { await sleep(200); }
      const msgId = addMsg(agentId, "", true);
      let fullText = "";
      let apiDone = false;
      let fetchError: string | null = null;
      let wasTruncated = false;

      // 백그라운드에서 API 패치 (버퍼 채우기)
      void (async () => {
        try {
          for await (const chunk of streamClaude({
            apiKey: key,
            model: debateModel,
            systemPrompt: buildSingleAgentPrompt(stage.id, genre, agentId, stageResultsRef.current, p1DataRef.current, rejectedItemsRef.current, synopsisAssetsRef.current),
            messages: [{ role: "user", content: userContent }],
            maxTokens: tokens,
            tools: [],
            onStopReason: (reason) => { if (reason === "max_tokens") wasTruncated = true; },
          })) {
            if (abortRef.current) break;
            fullText += chunk;
          }
        } catch (err) {
          fetchError = err instanceof Error ? err.message : String(err);
        }
        apiDone = true;
      })();

      // 타이핑 효과: 버퍼를 1자씩 100ms 속도로 소비 (자연스러운 읽기 속도)
      const CHARS = 1; const TICK = 100;
      let displayed = 0;
      while (true) {
        if (abortRef.current) break;
        if (apiDone && displayed >= fullText.length) break;
        // 사용자가 메시지를 보내면 현재 발언 즉시 완성 후 종료
        if (pendingUserMsgRef.current) {
          const waitFlush = Date.now();
          while (!apiDone && Date.now() - waitFlush < 10000) await sleep(100);
          displayed = fullText.length;
          updateMsg(msgId, fullText.slice(0, displayed), true);
          break;
        }
        if (displayed < fullText.length) {
          displayed = Math.min(displayed + CHARS, fullText.length);
          updateMsg(msgId, fullText.slice(0, displayed), true);
        }
        await sleep(TICK);
      }

      // 오류 처리
      if (fetchError) {
        setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== msgId));
        if (!fetchError.includes("abort") && !abortRef.current) setApiError(`API 오류: ${fetchError}`);
        return;
      }
      // 완료 후 마크다운 클린업 적용
      const clean = fullText.trim().replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/[#>_`]/g, "");
      if (!clean) { setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== msgId)); return; }
      updateMsg(msgId, clean, false);
      transcript.push(`[${AGENTS[agentId].label}]: ${clean}`);
      convRef.current = transcript;
      agentIndex++;
      secondToLastSpeaker = lastSpeaker;
      lastSpeaker = agentId;
      // 진행 저장 (이어하기 지원)
      try {
        localStorage.setItem(`p2_conv_${stageIdx}_${projectId}`, JSON.stringify(transcript));
        localStorage.setItem(`p2_msgs_${stageIdx}_${projectId}`, JSON.stringify(msgsRef.current.filter((m: Msg) => !m.streaming)));
      } catch { /* ignore */ }

      // 말이 끊긴 경우: 같은 에이전트가 자동으로 이어서 발언 (1회만)
      if (wasTruncated && !isContinuation && !abortRef.current) {
        await sleep(400);
        const contPrompt = `${userContent}\n\n[네 방금 발언 — 토큰 한도로 중간에 끊김]\n${clean}\n\n방금 하던 말이 끊겼어. 자연스럽게 바로 이어서 계속해줘. 앞에 한 말은 절대 반복하지 마.`;
        await runSingleAgent(agentId, contPrompt, Math.min(tokens + 300, 1200), true);
      }
    };

    // 스테이지 오프닝: 이전 단계 내용을 팀에게 자연스럽게 환기
    if (stageIdx > 0 && stageResultsRef.current.length > 0 && transcript.length === 0) {
      const prevContext = buildContext(stage.id, stageResultsRef.current);
      if (prevContext) {
        await runSingleAgent(
          "producer",
          `팀에게 "${stage.name}" 단계를 시작하면서, 우리가 앞에서 함께 만들어온 내용을 자연스럽게 2~3문장으로 환기시켜줘. 마치 함께 작업해온 동료처럼, 자연스럽게. 딱딱한 브리핑이 아니라 팀워크 느낌으로.\n\n[우리가 함께 만든 내용]\n${prevContext}`,
          200,
        );
      }
    }

    // ── Stage 2 전용: 4단계 구조화 워크플로우 ─────────────────────────────────
    if (stage.id === 2) {
      const worldCtx  = buildContext(2, stageResultsRef.current);
      const p1Context = p1DataRef.current ? buildPhase1Context(p1DataRef.current) : "";
      const baseCtx   = [p1Context, worldCtx].filter(Boolean).join("\n\n").slice(0, 4000);

      const histText = () => {
        if (transcript.length === 0) return "";
        const dec = [
          stageDecisions.agreed.length   > 0 ? `[✅ 합의된 내용]\n${stageDecisions.agreed.map(d => `• ${d}`).join("\n")}` : "",
          stageDecisions.rejected.length > 0 ? `[❌ 거부된 방향]\n${stageDecisions.rejected.map(d => `• ${d}`).join("\n")}` : "",
          stageDecisions.pending.length  > 0 ? `[⏳ 미결 쟁점]\n${stageDecisions.pending.map(d => `• ${d}`).join("\n")}` : "",
        ].filter(Boolean).join("\n");
        return conversationSummary
          ? `[토론 요약]\n${conversationSummary}\n\n${dec ? `${dec}\n\n` : ""}[직전 대화]\n${transcript.slice(-3).join("\n")}\n\n`
          : `[지금까지 대화]\n${transcript.slice(-5).join("\n")}\n\n`;
      };

      try {
        // ─ Step 1: 세계관 학습 (3턴) ─────────────────────────────────────────
        synopsisStepRef.current = "learning";
        setSynopsisStep("learning");
        setCoveredAgendaIds(["step_learning"]);

        await runSingleAgent("producer",
          `[세계관 학습 시작] 팀이 시놉시스 기획을 시작하기 전에 세계관 내용을 먼저 파악해야 해. 아래 세계관의 핵심 내용을 팀에게 2~3문장으로 자연스럽게 소개해줘. 구어체로.\n\n${baseCtx}`,
          300);
        if (abortRef.current) throw new Error("abort");

        await runSingleAgent("worldbuilder",
          `${histText()}이 세계관에서 이야기 만들기에 가장 흥미로운 긴장감이나 규칙이 뭐야? 1~2문장.`,
          200);
        if (abortRef.current) throw new Error("abort");

        await runSingleAgent("scenario",
          `${histText()}IP 전략가 관점에서, 이 세계관의 어떤 요소가 독자를 끌어당길 가장 강한 훅이야? 1~2문장.`,
          200);
        if (abortRef.current) throw new Error("abort");

        // ─ Step 2: 페르소나 추출 (8~10턴) ────────────────────────────────────
        synopsisStepRef.current = "persona";
        setSynopsisStep("persona");
        setCoveredAgendaIds(["step_learning", "step_persona"]);

        await runSingleAgent("producer",
          `${histText()}이제 이 세계관에서 가장 흥미로운 주인공 후보를 찾아보자. '이 세계관 안에서 가장 고통받을 인물'과 '가장 큰 권력을 가질 인물'을 중심으로 — 각자 인물 유형 1개씩 제안해봐.`,
          250);
        if (abortRef.current) throw new Error("abort");

        const personaAgents: AgentId[] = ["character", "scenario", "worldbuilder", "editor", "script"];
        for (let pt = 0; pt < 8 && !abortRef.current; pt++) {
          // 사용자 입력 폴링 (최대 8초 대기)
          const waitStart = Date.now();
          while (Date.now() - waitStart < 8000) {
            if (abortRef.current || pendingUserMsgRef.current) break;
            await sleep(200);
          }
          if (abortRef.current) break;

          // 사용자 메시지 처리
          const pendingMsg = pendingUserMsgRef.current;
          if (pendingMsg) {
            pendingUserMsgRef.current = null;
            transcript.push(`[사용자]: ${pendingMsg}`);
            convRef.current = transcript;
            refreshSummary();
            refreshDecisions();
            await runSingleAgent("scenario",
              `${histText()}사용자가 방금 "${pendingMsg}" 라고 했어. 이 의견을 반영해서 페르소나 논의를 이어가줘. 2~3문장.`,
              250);
            continue;
          }

          if (pt < 6) {
            const agent = personaAgents[pt % personaAgents.length];
            await runSingleAgent(agent,
              `${histText()}이 세계관에서 가장 극적인 갈등을 겪을 수 있는 인물 유형을 1개 제안해줘. 이름이나 직업·처지, 그리고 왜 이 세계관에서만 의미 있는지. 2~3문장.`,
              280);
          } else {
            // 마지막 2턴: 3명으로 수렴
            await runSingleAgent("producer",
              `${histText()}지금까지 나온 인물 유형들 중에서 가장 흥미로운 3명을 골라서 정리해줘. 각 인물 이름 또는 유형 + 이 세계관에서 겪는 핵심 갈등 한 줄씩.`,
              350);
            break;
          }
        }
        if (abortRef.current) throw new Error("abort");

        // ─ Step 3: 로그라인 대결 ──────────────────────────────────────────────
        synopsisStepRef.current = "logline";

        await runSingleAgent("scenario",
          `${histText()}[로그라인 대결] 방금 추출한 3명의 인물 후보를 활용해서 서로 다른 느낌의 로그라인을 5개 써줘.\n각 로그라인은:\n- 한 문장\n- 아이러니하고 시선을 끄는 훅\n- 이 세계관이 아니면 불가능한 이야기\n- "1. [로그라인]" 형식으로 번호 붙여서\n5개를 모두 작성해줘.`,
          600);
        if (abortRef.current) throw new Error("abort");

        // 마지막 메시지에서 로그라인 파싱
        const lastMsg = transcript[transcript.length - 1] ?? "";
        const parsed = [...lastMsg.matchAll(/^\s*\d+[\.\)]\s+(.+)/gm)]
          .map(m => m[1].trim())
          .filter(Boolean);
        const loglines = parsed.length >= 2 ? parsed : [];

        setSynopsisLoglines(loglines);
        setSynopsisStep("logline");
        setCoveredAgendaIds(["step_learning", "step_persona", "step_logline"]);

        // 로그라인 선택 대기 (사용자가 카드 클릭 또는 채팅 입력)
        const chosenLogline = await new Promise<string>((resolve) => {
          loglineResolverRef.current = resolve;
          // abort 폴링
          const poll = setInterval(() => {
            if (abortRef.current) { clearInterval(poll); resolve(""); return; }
            const um = pendingUserMsgRef.current;
            if (um && synopsisStepRef.current === "logline") {
              clearInterval(poll);
              pendingUserMsgRef.current = null;
              transcript.push(`[사용자]: ${um}`);
              convRef.current = transcript;
              resolve(um);
            }
          }, 300);
        });

        if (abortRef.current || !chosenLogline) throw new Error("abort");

        setSelectedLogline(chosenLogline);
        addMsg("user", `선택: ${chosenLogline.length > 80 ? chosenLogline.slice(0, 80) + "…" : chosenLogline}`);
        transcript.push(`[사용자]: [선택한 로그라인] ${chosenLogline}`);
        convRef.current = transcript;

        await runSingleAgent("producer",
          `${histText()}사용자가 이 로그라인을 선택했어: "${chosenLogline.slice(0, 120)}"\n이 방향으로 전체 시놉시스를 완성하자. 팀에게 짧게 공지해줘. 1~2문장.`,
          180);
        if (abortRef.current) throw new Error("abort");

        // ─ Step 3.5: 등장인물 명시적 확정 (extractStageData 캐릭터 추출용) ──
        // 지금까지 논의된 인물들을 구조화된 목록으로 정리해 transcript에 남긴다.
        // extractStageData(Stage 2)가 이 목록을 기반으로 characters 배열을 생성한다.
        await runSingleAgent("character",
          `${histText()}지금까지 논의된 내용을 바탕으로, 이 이야기에 등장하는 핵심 인물들을 확정해서 정리해줘.\n` +
          `아래 형식으로 빠짐없이 목록화해줘 (마크다운 금지):\n\n` +
          `[확정 등장인물 목록]\n` +
          `1. [이름/번호+별칭] — [역할: 주인공/빌런/조력자/단역] — [성별·나이대] — [핵심 특성 한 줄]\n` +
          `2. ...\n\n` +
          `이름이 없으면 번호나 역할명으로 표기 (예: "029번 요원 — 빌런"). 지금까지 언급된 모든 주요 인물을 포함해.`,
          500);
        if (abortRef.current) throw new Error("abort");

        // ─ Step 4: 시놉시스 완성 (10~12턴) ──────────────────────────────────
        synopsisStepRef.current = "completing";
        setSynopsisStep("completing");
        setCoveredAgendaIds(["step_learning", "step_persona", "step_logline", "step_synopsis"]);

        const synopsisTopics = [
          { agent: "scenario"    as AgentId, prompt: `${histText()}선택된 로그라인을 바탕으로 기획 의도를 말해줘. 이 작품이 지금 이 시대에 왜 필요한가. 2~3문장.` },
          { agent: "worldbuilder"as AgentId, prompt: `${histText()}이 이야기 세계에서만 작동하는 특별한 사회 규칙 3가지를 구체적으로 제안해줘. 각각 한 줄씩.` },
          { agent: "character"   as AgentId, prompt: `${histText()}주인공의 인카네이션을 정의해줘. Pain Point(결핍)와 Want(목표)를 이 세계관과 연결해서. 왜 이 세계관이 아니면 이 결핍이 의미 없는지 포함해줘. 3~4문장.` },
          { agent: "scenario"    as AgentId, prompt: `${histText()}사건의 트리거를 구체적으로 말해줘. 세계관 규칙이 주인공 일상과 충돌하는 첫 번째 대사건. 2~3문장.` },
          { agent: "script"      as AgentId, prompt: `${histText()}스토리 아크를 제안해줘. 발단-전개-위기-절정-결말 5단계 + 독자가 예상 못할 반전. 각 단계를 한 줄씩.` },
          { agent: "editor"      as AgentId, prompt: `${histText()}솔직히 말해봐 — 이 시놉시스에서 진부하거나 식상한 부분이 어디야? 그리고 어떻게 신선하게 바꿀 수 있어? 2~3문장.` },
        ];

        const STEP4_WAIT_SEC = 30; // 사용자 개입 대기 시간 (초)
        for (let ti = 0; ti < synopsisTopics.length; ti++) {
          if (abortRef.current) break;
          const { agent, prompt } = synopsisTopics[ti];

          // ─ 첫 번째 턴 이후만 사용자 개입 대기 ─
          if (ti > 0) {
            // completing_wait 상태: "다음 에이전트 →" 버튼 + 카운트다운 표시
            synopsisStepRef.current = "completing_wait";
            setSynopsisStep("completing_wait");

            // 30초 카운트다운 + 사용자 proceed 대기
            const proceeded = await new Promise<string | null>((resolve) => {
              step4ProceedRef.current = () => resolve(null); // 버튼 클릭 → null
              let remaining = STEP4_WAIT_SEC;
              setStep4CountDown(remaining);
              const timer = setInterval(() => {
                if (abortRef.current) { clearInterval(timer); step4ProceedRef.current = null; resolve(null); return; }
                // 사용자 메시지 확인
                const um = pendingUserMsgRef.current;
                if (um) {
                  clearInterval(timer);
                  pendingUserMsgRef.current = null;
                  step4ProceedRef.current = null;
                  setStep4CountDown(0);
                  resolve(um);
                  return;
                }
                remaining--;
                setStep4CountDown(remaining);
                if (remaining <= 0) { clearInterval(timer); step4ProceedRef.current = null; setStep4CountDown(0); resolve(null); }
              }, 1000);
            });

            synopsisStepRef.current = "completing";
            setSynopsisStep("completing");

            // 사용자 메시지가 있으면 에이전트에게 전달
            if (proceeded && !abortRef.current) {
              transcript.push(`[사용자]: ${proceeded}`);
              convRef.current = transcript;
              await runSingleAgent("scenario",
                `${histText()}사용자가 "${proceeded}" 라고 했어. 이 의견을 충분히 반영해서 시놉시스 논의를 이어가줘.`,
                300);
            }
          }

          if (abortRef.current) break;
          await runSingleAgent(agent, prompt, 400);
        }
        if (abortRef.current) throw new Error("abort");

        // 에셋 리스트 확정 요청 (등장인물 이름 명시 필수)
        await runSingleAgent("producer",
          `${histText()}시놉시스 완성됐어. 아래 형식으로 최종 에셋 목록을 정리해줘 (마크다운 금지):\n\n` +
          `[등장인물] 각 인물: 이름(번호/별칭 포함) — 역할 — 외형 한 줄\n` +
          `[장소] 각 장소: 장소명 — 시각적 특징 한 줄\n` +
          `[소품] 각 소품: 소품명 — 용도·특징 한 줄\n\n` +
          `등장인물 이름은 반드시 실명 또는 "번호+역할명"으로 표기. 지금까지 논의된 모든 인물을 빠짐없이 포함해.`,
          500);
        if (abortRef.current) throw new Error("abort");

        naturalExit = true;
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        if (!raw.includes("abort") && !abortRef.current) setApiError(`API 오류: ${raw}`);
      }

      runningRef.current = false;
      synopsisStepRef.current = "idle";
      setSynopsisStep("idle");

      // 자연 종료 시 자동 추출
      if (!abortRef.current && naturalExit) {
        setDebatePhase("confirming");
        const apiKey = getAnthropicKey();
        if (apiKey) {
          const debateText = convRef.current.join("\n");
          const extractId = addMsg("producer", "시놉시스 정리 중...", true);
          const synopsisCtx = stageResultsRef.current.find((r: StageResult) => r.stageId === 2)?.summary;
          const { data, summary } = await extractStageData(stage, genre, debateText, apiKey, synopsisCtx);
          updateMsg(extractId, "", false);
          setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== extractId));
          localStorage.removeItem(`p2_conv_${stageIdx}_${projectId}`);
          localStorage.removeItem(`p2_msgs_${stageIdx}_${projectId}`);
          const result: StageResult = { stageId: stage.id, data, summary };
          const newResults = [...stageResultsRef.current, result];
          stageResultsRef.current = newResults;
          setStageResults(newResults);
          setEditableAssets((prev: SynopsisAssets) => {
            const ns = (arr: unknown, key: string): string[] =>
              Array.isArray(arr) ? (arr as Record<string,string>[]).map(x => x[key]).filter(Boolean) : [];
            const next: SynopsisAssets = {
              characters: [...new Set([...prev.characters, ...ns(data.characters, "name").filter(isRealCharacter)])],
              locations:  [...new Set([...prev.locations,  ...ns(data.locations,  "name")])],
              props:      [...new Set([...prev.props,      ...ns(data.props,      "name")])],
            };
            localStorage.setItem(`wts_asset_list_${projectId}`, JSON.stringify(next));
            synopsisAssetsRef.current = next;
            return next;
          });
          setCurrentStageIdx(stageIdx + 1);
          localStorage.setItem(`wts_p2_stage_${projectId}`, String(stageIdx + 1));
          setDebatePhase("confirmed");
        }
      } else {
        setDebatePhase("idle");
      }
      return; // Stage 2 워크플로우 종료 — 아래 debateLoop 실행 안 함
    }
    // ── Stage 2 워크플로우 끝 ─────────────────────────────────────────────────

    // ── Stage 3 전용: 인물별 구조화 워크플로우 ────────────────────────────────
    if (stage.id === 3) {
      const charList = synopsisAssetsRef.current?.characters ?? [];
      const s1d = stageResultsRef.current.find(r => r.stageId === 1)?.data;
      const s2d = stageResultsRef.current.find(r => r.stageId === 2)?.data;
      const s2chars = Array.isArray(s2d?.characters) ? (s2d!.characters as Record<string,string>[]) : [];
      const s1chars = Array.isArray(s1d?.key_characters) ? (s1d!.key_characters as Record<string,string>[]) : [];
      const prot    = s2d?.protagonist as Record<string,string> | undefined;
      const baseCtx = buildContext(3, stageResultsRef.current).slice(0, 3000);
      const histText = () =>
        transcript.length === 0 ? "" : `[대화 내용]\n${transcript.slice(-4).join("\n")}\n\n`;

      try {
        if (charList.length === 0) {
          // 에셋 목록 없으면 프로듀서가 캐릭터 목록 작성 요청
          await runSingleAgent("producer",
            `캐릭터 설계 단계야. 세계관·시놉시스를 보고 이 이야기에 등장하는 모든 인물을 목록으로 정리해줘.\n\n${baseCtx}`,
            300);
          if (abortRef.current) throw new Error("abort");
        }

        // 각 캐릭터를 순서대로 완전히 설계
        const targets = charList.length > 0 ? charList : ["주인공"];
        for (let ci = 0; ci < targets.length && !abortRef.current; ci++) {
          const charName = targets[ci];
          const isProtagonist = ci === 0 || charName === prot?.name;
          const prevChar = s2chars.find(c => c.name === charName) ?? s1chars.find(c => c.name === charName);
          const prevDesc = prevChar ? [
            prevChar.appearance ?? prevChar.face ? `외형 힌트: ${prevChar.appearance ?? prevChar.face}` : "",
            prevChar.personality ? `성격 힌트: ${prevChar.personality}` : "",
            prevChar.role ? `역할: ${prevChar.role}` : "",
          ].filter(Boolean).join(" / ") : "";

          const remainCount = targets.length - ci - 1;
          const remainHint = remainCount > 0 ? ` (이후 ${targets.slice(ci + 1).join(", ")} 설계 예정)` : " (마지막 캐릭터)";

          // ─ 1) 캐릭터디자이너 — 신체·얼굴 집중 설계 ─
          await runSingleAgent("character",
            `${histText()}[${ci + 1}/${targets.length}] 지금부터 **${charName}**을 집중 설계해${remainHint}.\n` +
            (prevDesc ? `시놉시스에서 나온 기존 정보: ${prevDesc}\n\n` : "") +
            `아래 항목을 구체적 수치와 함께 빠짐없이:\n` +
            `① 성별·나이대·정확한 키(cm)·몸무게(kg)·체형(근육질/마른/보통/통통 등 구체적으로)\n` +
            `② 얼굴 묘사: 이목구비·눈빛·피부색·인상·표정 습관 (예: 무표정이지만 눈이 항상 촉촉함)\n` +
            `③ 헤어: 색상·길이·스타일\n` +
            `${isProtagonist ? "주인공이야 — 독자가 매화 보는 얼굴이니 최대한 구체적으로." : "조연이지만 이미지 생성에 쓸 수 있을 수준으로."}`,
            isProtagonist ? 550 : 400);
          if (abortRef.current) throw new Error("abort");

          // 사용자 개입 폴링 (3초)
          const t1 = Date.now();
          while (Date.now() - t1 < 3000) { if (abortRef.current || pendingUserMsgRef.current) break; await sleep(200); }
          if (abortRef.current) throw new Error("abort");
          if (pendingUserMsgRef.current) {
            const um = pendingUserMsgRef.current; pendingUserMsgRef.current = null;
            transcript.push(`[사용자]: ${um}`); convRef.current = transcript;
            await runSingleAgent("character", `${histText()}사용자가 "${um}"라고 했어. ${charName} 얼굴·신체 설계에 반영해줘.`, 300);
            if (abortRef.current) throw new Error("abort");
          }

          // ─ 2) 스크립트 작가 — 복장·스타일 + Runway 프롬프트 ─
          await runSingleAgent("script",
            `${histText()}${charName}의 **주요 복장과 스타일**을 잡아줘.\n` +
            `색상·소재·스타일·착용 방식 구체적으로. 이 세계관 분위기에 어울리게.\n` +
            `그리고 Runway Gen-4 영문 프롬프트도 완성해줘 — ` +
            `[인물 외형: 인종·나이·헤어·복장·표정], [조명: 유형·방향·색온도], [카메라: 샷 종류·앵글], [분위기·스타일 키워드].`,
            isProtagonist ? 400 : 320);
          if (abortRef.current) throw new Error("abort");

          // 사용자 개입 폴링 (3초)
          const t2 = Date.now();
          while (Date.now() - t2 < 3000) { if (abortRef.current || pendingUserMsgRef.current) break; await sleep(200); }
          if (abortRef.current) throw new Error("abort");
          if (pendingUserMsgRef.current) {
            const um = pendingUserMsgRef.current; pendingUserMsgRef.current = null;
            transcript.push(`[사용자]: ${um}`); convRef.current = transcript;
            await runSingleAgent("script", `${histText()}사용자: "${um}". ${charName} 복장·Runway 프롬프트에 반영해줘.`, 300);
            if (abortRef.current) throw new Error("abort");
          }

          // ─ 3) 시나리오 작가 — 성격·관계·갈등 ─
          await runSingleAgent("scenario",
            `${histText()}${charName}의 **성격·관계·갈등**을 정의해줘.\n` +
            `성격 특징 3가지 이상 (예: 무표정하지만 의외로 다정함, 완벽주의, 분노 조절 어려움)\n` +
            `주요 관계: 누구와 어떤 사이인지 (조력자/연인/경쟁자/스승 등)\n` +
            `핵심 갈등: 누구와 왜 대립하고 어떻게 전개되는지`,
            isProtagonist ? 400 : 300);
          if (abortRef.current) throw new Error("abort");

          // ─ 4) 15초 사용자 개입 창 + 피드백 반영 ─
          // coveredAgenda 로컬 Set도 함께 갱신 — debateLoop fall-through 시 덮어쓰기 방지
          const completedCharIds = targets.slice(0, ci + 1).flatMap(n =>
            [`char_${n}_body`, `char_${n}_face`, `char_${n}_outfit`, `char_${n}_personality`, `char_${n}_relation`]
          );
          completedCharIds.forEach(id => coveredAgenda.add(id));
          setCoveredAgendaIds(completedCharIds);
          const waitStart = Date.now();
          while (Date.now() - waitStart < 15000) {
            if (abortRef.current || pendingUserMsgRef.current) break;
            await sleep(300);
          }
          if (abortRef.current) throw new Error("abort");
          if (pendingUserMsgRef.current) {
            const um = pendingUserMsgRef.current; pendingUserMsgRef.current = null;
            transcript.push(`[사용자]: ${um}`); convRef.current = transcript;
            await runSingleAgent("character",
              `${histText()}사용자가 ${charName}에 대해 "${um}"라고 했어. 이 피드백 반영해서 설계를 수정하거나 보완해줘.`, 350);
            if (abortRef.current) throw new Error("abort");
          }

          // ─ 5) 프로듀서 — 완료 확인 + 다음 캐릭터 안내 ─
          if (ci < targets.length - 1) {
            await runSingleAgent("producer",
              `${histText()}${charName} 설계 완료. 다음은 **${targets[ci + 1]}** 차례야. 바로 시작하자.`,
              80);
            if (abortRef.current) throw new Error("abort");
          }
        }

        if (!abortRef.current) {
          // 모든 캐릭터 완료 후 프로듀서 마무리
          await runSingleAgent("producer",
            `${histText()}${targets.length}명 캐릭터 설계 완료! 수정하거나 보완할 내용이 있으면 바로 채팅해줘. 모두 만족스러우면 아래 '이 단계 확정하고 결과 정리' 버튼을 눌러줘.`,
            120);
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        if (!raw.includes("abort") && !abortRef.current) setApiError(`API 오류: ${raw}`);
        runningRef.current = false;
        setDebatePhase("idle");
        return; // 에러/중단 시 Stage 3 워크플로우 종료
      }

      if (abortRef.current) {
        runningRef.current = false;
        setDebatePhase("idle");
        return;
      }
      // 구조적 캐릭터 처리 완료 → 자동 추출하지 않고 debateLoop 로 이어서 채팅 유지
      // 사용자가 '이 단계 확정하고 결과 정리' 버튼을 눌러야 Stage 3 완료
    }
    // ── Stage 3 워크플로우 끝 ─────────────────────────────────────────────────

    try {
      debateLoop: while (true) {
        if (abortRef.current) break;

        const agentTurnsSoFar = transcript.filter(l => !l.startsWith("[사용자]")).length;

        // 자동 마무리: wrapUp 제안 후 WRAP_UP_AUTO_MS 동안 응답 없으면 자동 종료
        // (사용자가 거부 메시지를 보내면 타이머 리셋 — pendingUserMsgRef 체크로 포착)
        if (wrapUpProposed && !pendingUserMsgRef.current && Date.now() - wrapUpProposedAt > WRAP_UP_AUTO_MS) {
          addMsg("producer", "그럼 이 단계 확인하고 넘어갈게요.", false);
          transcript.push(`[총괄프로듀서]: 그럼 이 단계 확인하고 넘어갈게요.`);
          convRef.current = transcript;
          await sleep(1500);
          naturalExit = true;
          break debateLoop;
        }
        // 사용자 메시지가 도착하면 wrapUp 타이머 리셋 (타임아웃 직전 메시지도 반영)
        if (wrapUpProposed && pendingUserMsgRef.current) {
          wrapUpProposedAt = Date.now();
        }

        // 에이전트 간 대기 (9~15초), 사용자 입력 폴링
        if (agentTurnsSoFar > 0) {
          const waitMs = 9000 + Math.random() * 6000;
          const startWait = Date.now();
          while (Date.now() - startWait < waitMs) {
            if (abortRef.current || pendingUserMsgRef.current) break;
            await sleep(150);
          }
          if (abortRef.current) break;
        }

        // 사용자 메시지 처리 (UI는 입력 핸들러에서 이미 표시됨 — addMsg 호출 안 함)
        const pendingMsg = pendingUserMsgRef.current;
        let matchedCmd: P2CommandPattern | null = null;
        if (pendingMsg) {
          pendingUserMsgRef.current = null;
          transcript.push(`[사용자]: ${pendingMsg}`);
          convRef.current = transcript;
          lastUserMsg = pendingMsg;
          userTurnCount = 4;
          refreshSummary();
          refreshDecisions();
          turnsSinceLastSummary = 0;
          if (wrapUpProposed) {
            if (AGREE_RE.test(pendingMsg.trim())) { naturalExit = true; break debateLoop; }
            wrapUpProposed = false;
            wrapUpRejectedTurn = agentTurnsSoFar; // 거부 시점 기록 — 이후 10턴 대기
          }
          matchedCmd = matchCommandP2(pendingMsg);
          if (matchedCmd?.handler === "end") { naturalExit = true; break debateLoop; }
        }

        // 주기적 요약 + 결정사항 갱신 (5턴마다)
        turnsSinceLastSummary++;
        if (turnsSinceLastSummary >= 5) { refreshSummary(); refreshDecisions(); turnsSinceLastSummary = 0; }

        // 회의록 현황판 갱신 (MEETING_INTERVAL 턴마다 — await로 직렬화)
        if (agentTurnsSoFar > 0 && agentTurnsSoFar % MEETING_INTERVAL === 0 && !abortRef.current) {
          await updateLivingDoc();
        }

        // 히스토리 텍스트 구성: 현황판 있으면 현황판 + 직전 5개, 없으면 기존 방식
        const lastLine = transcript.filter(l => !l.startsWith("[사용자]")).slice(-1)[0] ?? "";
        const decisionsBlock = [
          stageDecisions.agreed.length   > 0 ? `[✅ 합의된 내용]\n${stageDecisions.agreed.map(d => `• ${d}`).join("\n")}` : "",
          stageDecisions.rejected.length > 0 ? `[❌ 거부된 방향]\n${stageDecisions.rejected.map(d => `• ${d}`).join("\n")}` : "",
          stageDecisions.pending.length  > 0 ? `[⏳ 미결 쟁점]\n${stageDecisions.pending.map(d => `• ${d}`).join("\n")}` : "",
        ].filter(Boolean).join("\n");
        const historyText = meetingDoc
          ? `[기획 현황 — 지금까지 팀이 합의·탐색·거부한 내용]\n${formatDoc(meetingDoc)}\n\n${userTurnCount > 0 ? `[사용자 의견]: ${lastUserMsg}\n` : ""}[직전 대화]\n${transcript.filter(l => !l.startsWith("[회의록작성자]")).slice(-5).join("\n")}\n\n`
          : conversationSummary
            ? `[토론 요약]\n${conversationSummary}\n\n${decisionsBlock ? `${decisionsBlock}\n\n` : ""}${userTurnCount > 0 ? `[사용자 의견]: ${lastUserMsg}\n` : ""}[직전 발언]: ${lastLine}\n\n`
            : `[대화 내용]\n${transcript.slice(-5).join("\n")}\n\n`;
        if (userTurnCount > 0) userTurnCount--;

        // ── 명령 핸들러 — 사용자 명령에 즉시 반응 ──
        if (matchedCmd?.handler === "single_turn" && matchedCmd.speakerAgent) {
          const p = matchedCmd.promptOverride?.replace("{history}", historyText) ?? `${historyText}사용자 요청에 직접 응답해줘.`;
          await runSingleAgent(matchedCmd.speakerAgent, p, matchedCmd.maxTokens ?? 300);
          nudgeCooldown = 2;
          continue;
        }
        if (matchedCmd?.handler === "break") {
          const p = matchedCmd.promptOverride ?? "사용자가 잠깐 멈추라고 했어.";
          await runSingleAgent(matchedCmd.speakerAgent ?? "producer", p, matchedCmd.maxTokens ?? 80);
          await sleep(10000);
          continue;
        }

        // ── 아젠다 키워드 감지 ──
        const recentLines = transcript.slice(-4).join(" ");
        for (const item of stageAgenda) {
          if (item.keywords.test(recentLines)) {
            agendaTurns[item.id] = (agendaTurns[item.id] ?? 0) + 1;
            if (!coveredAgenda.has(item.id) && (agendaTurns[item.id] ?? 0) >= minTurnsForStage) {
              coveredAgenda.add(item.id);
              setCoveredAgendaIds([...coveredAgenda]);
            }
            setAgendaTurnCounts({ ...agendaTurns });
          }
        }

        // 오케스트레이터 조율 — 명시적 → @agentId 지정이 없을 때만 넛지 실행
        const explicitNextAgent = parseNextAgent(lastLine);
        if (nudgeCooldown > 0) {
          if (!explicitNextAgent) nudgeCooldown--;
        } else if (agentTurnsSoFar > 0 && !explicitNextAgent) {
          const uncovered = stageAgenda.filter(item => !coveredAgenda.has(item.id));
          const covered   = stageAgenda.filter(item =>  coveredAgenda.has(item.id));

          // Stage 1: 8턴마다 프로듀서가 진행 상황 공지 + 다음 주제 안내
          const shouldProgress = stage.id === 1 && agentTurnsSoFar % 8 === 0 && uncovered.length > 0;
          // 나머지 스테이지: 3턴마다 미완료 주제 넛지
          const shouldNudge = !shouldProgress && agentTurnsSoFar % 3 === 0 && uncovered.length > 0;

          if (shouldProgress) {
            const pick = uncovered.sort((a, b) => (agendaTurns[a.id] ?? 0) - (agendaTurns[b.id] ?? 0))[0];
            const coveredStr = covered.length > 0
              ? `"${covered.map(i => i.label).join('", "')}"는 어느 정도 얘기됐어.`
              : "";
            const remainStr = `아직 "${uncovered.map(i => i.label).join('", "')}" ${uncovered.length}개가 남았어.`;
            await runSingleAgent(
              "producer",
              `${historyText}[진행 상황 정리] 프로듀서로서 토론 흐름을 짧게 정리하고 다음 주제로 안내해줘. ${coveredStr} ${remainStr} 지금은 "${pick.label}" 주제에 집중하자. ${pick.nudge} 2~3문장, 자연스럽게.`,
              stage.id === 1 ? 350 : 200,
            );
            secondToLastSpeaker = lastSpeaker;
            lastSpeaker = "producer";
            nudgeCooldown = 3;
            continue;
          } else if (shouldNudge) {
            const pick = uncovered.sort((a, b) => (agendaTurns[a.id] ?? 0) - (agendaTurns[b.id] ?? 0))[0];
            await runSingleAgent(
              "producer",
              `${historyText}${pick.nudge} 여러 선택지를 놓고 서로 의견을 주고받아봐.`,
              stage.id === 1 ? 300 : 200,
            );
            secondToLastSpeaker = lastSpeaker;
            lastSpeaker = "producer";
            nudgeCooldown = 2;
            continue;
          }
        }

        // 마무리 조건 체크 ─────────────────────────────────────────────────────────
        // 1차 트리거: 모든 아젠다 항목 완료(allCovered) + 수렴 신호(converging)
        // 2차 트리거(hard cap): 이번 세션 신규 턴 ≥ WRAP_UP_AFTER (무한 토론 방지)
        //   → 이어하기 시 기존 누적 턴은 제외 (agentTurnsAtSessionStart 차감)
        const allCovered = stageAgenda.length > 0 && coveredAgenda.size >= stageAgenda.length;
        const newTurnsSinceStart = agentTurnsSoFar - agentTurnsAtSessionStart;
        const minTurnsForConverge = stage.id === 1 ? 10 : 8;
        const converging = newTurnsSinceStart >= minTurnsForConverge && (
          stage.id === 1
            ? (recentLines.match(/정리|결론|충분|이 정도|마무리|확인|다음 단계|좋아|됐어|완성/g) ?? []).length >= 1
            : (recentLines.match(/정리|결론|충분|이 정도|마무리|확인|다음 단계/g) ?? []).length >= 2
        );

        // 마무리 재제안: 사용자 거부 후 최소 10턴 경과해야 다시 제안 가능
        const turnsAfterRejection = agentTurnsSoFar - wrapUpRejectedTurn;

        const wrapUpConditionMet = !wrapUpProposed && turnsAfterRejection >= 10
          && ((allCovered && converging) || newTurnsSinceStart >= WRAP_UP_AFTER);

        if (wrapUpConditionMet) {
          wrapUpProposed = true;
          wrapUpProposedAt = Date.now();
          const coveredLabels = stageAgenda.filter(i => coveredAgenda.has(i.id)).map(i => i.label);
          const uncoveredLabels = stageAgenda.filter(i => !coveredAgenda.has(i.id)).map(i => i.label);
          const wrapUpIntro = uncoveredLabels.length > 0
            ? `"${coveredLabels.join('", "')}"은 충분히 다뤘어. "${uncoveredLabels.join('", "')}"이 아직 남아 있어.`
            : `이 단계의 모든 항목 — "${coveredLabels.join('", "')}" — 충분히 다뤘어.`;
          await runSingleAgent("producer",
            `${historyText}${wrapUpIntro} 프로듀서로서 이 단계를 마무리하자고 자연스럽게 제안해줘. 1~2문장.`,
            180);
          secondToLastSpeaker = lastSpeaker;
          lastSpeaker = "producer";
          continue;
        }

        // 다음 발언자 선택 및 실행
        const isFirst = agentTurnsSoFar === 0;
        const nextAgent = isFirst ? "worldbuilder" : pickNextSpeaker(lastLine, lastSpeaker, secondToLastSpeaker);

        const agentPrompt = isFirst
          ? stage.id === 1
            ? `"${stage.topic}" 주제로 첫 발언을 해줘. 아직 아무것도 정해진 게 없어 — 기획분석 내용을 보고 이 작품에 어울릴 시대·배경 방향을 2~3가지 제안하면서 팀 의견을 물어봐. 선언하지 말고 제안과 질문으로 열어줘. 구어체, 3~4문장.`
            : `"${stage.topic}" 주제로 첫 의견을 자연스럽게 말해줘. 짧고 구어체로.`
          : userTurnCount > 0
            ? stage.id === 1
              ? `${historyText}사용자가 방금 의견을 냈어. 반드시 그 내용을 직접 받아서 충분히 반응해줘 — 동의하거나, 다른 방향을 제안하거나, 그 의견을 더 구체화해줘. 사용자 말을 흘리지 마.`
              : `${historyText}사용자 의견을 자연스럽게 반영해서 토론을 이어가줘.`
            : stage.id === 1
              ? `${historyText}앞 사람 의견에 반응해줘. 동의하거나 다른 방향을 제안하거나 질문을 던져. 아직 확정하지 마 — 여러 선택지를 탐색해야 해.`
              : `${historyText}앞 대화 받아서 네 관점으로 짧게 한마디.`;

        await runSingleAgent(nextAgent, agentPrompt, stage.id === 1 ? 700 : 500);
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (!raw.includes("abort") && !abortRef.current) setApiError(`API 오류: ${raw}`);
    }

    runningRef.current = false;

    // 자연 종료 시 자동 확정 (inline — handleConfirm과 동일 로직)
    if (!abortRef.current && naturalExit) {
      setDebatePhase("confirming");
      const apiKey = getAnthropicKey();
      if (apiKey) {
        const debateText = convRef.current.join("\n");
        const extractId = addMsg("producer", "결과 정리 중...", true);
        const synopsisCtx = buildBibleContext(stageResultsRef.current);
        const { data, summary } = await extractStageData(stage, genre, debateText, apiKey, synopsisCtx);
        updateMsg(extractId, "", false);
        setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== extractId));

        localStorage.removeItem(`p2_conv_${stageIdx}_${projectId}`);
        localStorage.removeItem(`p2_msgs_${stageIdx}_${projectId}`);

        // 이전 버전 아카이브 + 버전 번호 계산
        const existingNE = stageResultsRef.current.find((r: StageResult) => r.stageId === stage.id);
        const versionNumberNE = (existingNE?.version ?? 0) + 1;
        if (existingNE) {
          const newHistNE = { ...stageResultHistoryRef.current, [stageIdx]: [...(stageResultHistoryRef.current[stageIdx] ?? []), existingNE] };
          stageResultHistoryRef.current = newHistNE;
          setStageResultHistory(newHistNE);
        }
        const result: StageResult = { stageId: stage.id, data, summary, version: versionNumberNE };
        const newResults = [...stageResultsRef.current.filter((r: StageResult) => r.stageId !== stage.id), result];
        stageResultsRef.current = newResults;
        setStageResults(newResults);

        // 에셋 목록 즉시 누적 (handleConfirm과 동일)
        setEditableAssets((prev: SynopsisAssets) => {
          const names = (arr: unknown, key: string): string[] =>
            Array.isArray(arr) ? (arr as Record<string, string>[]).map(x => x[key]).filter(Boolean) : [];
          let chars = [...prev.characters];
          let locs   = [...prev.locations];
          let props  = [...prev.props];
          if ((stage.id as StageId) === 1) {
            chars = [...new Set([...chars, ...names(data.key_characters, "name")])];
            locs  = [...new Set([...locs,  ...names(data.key_locations,  "name")])];
          } else if ((stage.id as StageId) === 2) {
            // 시놉시스 확정 시 등장인물 + 장소 즉시 누적
            chars = [...new Set([...chars, ...names(data.characters, "name")])];
            locs  = [...new Set([...locs,  ...names(data.locations,  "name")])];
          } else if ((stage.id as StageId) === 3) {
            chars = [...new Set([...chars, ...names(data.characters, "name")])];
          } else if (stage.id === 4) {
            locs  = [...new Set([...locs,  ...names(data.locations, "name")])];
          } else if (stage.id === 5) {
            props = [...new Set([...props, ...names(data.props, "name")])];
          }
          const next: SynopsisAssets = { characters: chars, locations: locs, props };
          localStorage.setItem(`wts_asset_list_${projectId}`, JSON.stringify(next));
          synopsisAssetsRef.current = next;
          return next;
        });

        const savedMsgs = msgsRef.current.filter((m: Msg) => !m.streaming);
        setStageHistoryMsgs((prev: Record<number, Msg[]>) => {
          const next = { ...prev, [stageIdx]: savedMsgs };
          localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({
            stageResults: newResults,
            stageResultHistory: stageResultHistoryRef.current,
            currentStageIdx: stageIdx + 1,
            stageHistoryMsgs: next,
          }));
          return next;
        });

        setDebatePhase("confirmed");
      }
    }
  }, [genre, addMsg, updateMsg, projectId]);

  // ── Asset List Review: Claude가 직접 분류·정제 (Stage 2 완료 후) ──
  const runAssetListReview = useCallback(async () => {
    setAssetListPhase("reviewing");
    setMsgs([]);
    convRef.current = [];

    const apiKey = getAnthropicKey();
    const s1d = stageResultsRef.current.find(r => r.stageId === 1)?.data;
    const s2d = stageResultsRef.current.find(r => r.stageId === 2)?.data;
    const s1sum = stageResultsRef.current.find(r => r.stageId === 1)?.summary ?? "";
    const s2sum = stageResultsRef.current.find(r => r.stageId === 2)?.summary ?? "";

    // 실제 토론 대화 텍스트 — 문맥 이해용
    const s1msgs = stageHistoryMsgs[0] ?? [];
    const s2msgs = stageHistoryMsgs[1] ?? [];
    const debateText = [...s1msgs, ...s2msgs]
      .filter((m: Msg) => !m.streaming && m.text)
      .map((m: Msg) => {
        const ag = AGENTS[m.agent as AgentId];
        return `[${ag?.label ?? m.agent}]: ${m.text}`;
      })
      .join("\n")
      .slice(0, 8000);

    const msgId = addMsg("producer", "에셋 목록 분류 중...", true);

    // Claude가 토론 전체 문맥을 읽고 실제 등장인물/장소/소품 추출
    let extracted: SynopsisAssets = { characters: [], locations: [], props: [] };

    if (apiKey) {
      const ctx = [s1sum, s2sum].filter(Boolean).join("\n\n");
      let jsonText = "";
      try {
        for await (const chunk of streamClaude({
          apiKey,
          model: "claude-sonnet-4-6",
          systemPrompt:
            "웹툰 기획 에셋 분류 전문가. 토론 전체를 읽고 문맥을 이해해서 실제 등장인물·장소·소품을 추출한다. " +
            "반드시 JSON만 출력. 설명·마크다운 없이.",
          messages: [{
            role: "user",
            content:
              `아래 세계관·시놉시스 토론에서 이미지 생성에 필요한 에셋을 추출해줘.\n\n` +
              `[요약]\n${ctx}\n\n` +
              (debateText ? `[토론 전문]\n${debateText}\n\n` : "") +
              `추출 기준:\n` +
              `- characters: 이 이야기에 실제로 등장하는 인물 전부. 이름이든 코드명이든 별명이든 상관없이, ` +
              `토론에서 구체적인 개인으로 언급된 사람이면 모두 포함. ` +
              `(예: 강현, 029번 요원, 엄기태 — 모두 포함)\n` +
              `  단, 조직명·집단·계층 전체(예: "단 요원들", "상위 계층")는 제외\n` +
              `- locations: 이야기에서 구체적으로 언급된 장소 (거리명·건물명·지역명 등)\n` +
              `- props: 이야기에서 중요한 소품·장비·아이템. 없으면 빈 배열\n` +
              `- 각 항목은 "이름만" (설명 없이)\n` +
              `- 중복 제거\n\n` +
              `출력 형식 (JSON만):\n` +
              `{"characters":["이름1","이름2"],"locations":["장소1","장소2"],"props":["소품1"]}`,
          }],
          maxTokens: 800,
          tools: [],
        })) { jsonText += chunk; }
      } catch { /* fallback to regex filter */ }

      const m = jsonText.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          const parsed = JSON.parse(m[0]) as { characters?: string[]; locations?: string[]; props?: string[] };
          extracted = {
            characters: (parsed.characters ?? []).filter(isRealCharacter),
            locations:  (parsed.locations  ?? []),
            props:      (parsed.props      ?? []),
          };
        } catch { /* ignore parse error */ }
      }
    }

    // Claude 추출 결과가 없으면 기존 regex 필터 폴백
    if (extracted.characters.length === 0 && extracted.locations.length === 0) {
      const ns = (arr: unknown, key: string): string[] =>
        Array.isArray(arr) ? (arr as Record<string,string>[]).map(x => x[key]).filter(Boolean) : [];
      extracted = {
        characters: [...new Set([
          ...ns(s1d?.key_characters, "name").filter(isRealCharacter),
          ...ns(s2d?.characters, "name").filter(isRealCharacter),
        ])],
        locations: [...new Set([
          ...ns(s1d?.key_locations, "name"),
          ...ns(s2d?.locations, "name"),
        ])],
        props: [],
      };
    }

    // 기존 확정된 항목과 합산 (사용자가 이미 추가한 것 보존)
    const prev = synopsisAssetsRef.current ?? { characters: [], locations: [], props: [] };
    const merged: SynopsisAssets = {
      characters: [...new Set([...extracted.characters, ...prev.characters.filter(isRealCharacter)])],
      locations:  [...new Set([...extracted.locations,  ...prev.locations])],
      props:      [...new Set([...extracted.props,      ...prev.props])],
    };
    synopsisAssetsRef.current = merged;
    localStorage.setItem(`wts_asset_list_${projectId}`, JSON.stringify(merged));
    setEditableAssets(merged);

    // 프로듀서 공지
    const charCount = merged.characters.length;
    const locCount  = merged.locations.length;
    const propCount = merged.props.length;
    const text = `에셋 정리 완료. 등장인물 ${charCount}명, 장소 ${locCount}곳, 소품 ${propCount}개. 빠진 거 있으면 추가하고, 불필요한 건 × 눌러서 빼줘.`;
    setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === msgId ? { ...m, text: "", streaming: true } : m));
    for (let i = 2; i < text.length; i += 2) {
      await new Promise<void>(r => setTimeout(r, 60));
      setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === msgId ? { ...m, text: text.slice(0, i), streaming: true } : m));
    }
    setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === msgId ? { ...m, text, streaming: false } : m));
  }, [addMsg, projectId, stageHistoryMsgs]);

  // ── Style Definition: 스타일 토론 (Stage 2 완료 후) ──
  const runStyleDebate = useCallback(async () => {
    if (styleRunningRef.current) return;
    styleRunningRef.current = true;
    abortRef.current = false;
    setMsgs([]);
    styleConvRef.current = [];

    const worldRes  = stageResultsRef.current.find((r: StageResult) => r.stageId === 1);
    const synRes    = stageResultsRef.current.find((r: StageResult) => r.stageId === 2);
    const worldSum  = worldRes?.summary  ?? "";
    const synSum    = synRes?.summary    ?? "";

    let agentIdx = 0;
    let lastSpeaker: AgentId | null = null;
    const transcript: string[] = [];
    const STYLE_AGENTS: AgentId[] = ["script", "worldbuilder", "character", "scenario", "editor"];

    const runOne = async (agentId: AgentId, prompt: string) => {
      const key = getAnthropicKeyByIndex(getApiKeyIndexForAgent(agentIdx));
      if (!key) return;
      // 전역 lock: 스트리밍 중이면 완료 대기 (한 번에 한 명만 발언)
      const lockStart = Date.now();
      while (msgsRef.current.some((m: Msg) => m.streaming) && Date.now() - lockStart < 30000) {
        await sleep(200);
      }
      const msgId = addMsg(agentId, "", true);
      let text = "";
      try {
        for await (const chunk of streamClaude({
          apiKey: key,
          model: "claude-sonnet-4-6",
          systemPrompt: buildStyleAgentPrompt(genre, agentId, worldSum, synSum),
          messages: [{ role: "user", content: prompt }],
          maxTokens: 250,
          tools: [],
        })) {
          if (abortRef.current) break;
          text += chunk;
        }
      } catch {
        setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== msgId));
        return;
      }
      const clean = text.trim().replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/[#>_`]/g, "");
      if (!clean) { setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== msgId)); return; }
      for (let i = 2; i < clean.length; i += 2) {
        if (abortRef.current) break;
        updateMsg(msgId, clean.slice(0, i), true);
        await sleep(120);
      }
      updateMsg(msgId, clean, false);
      transcript.push(`[${AGENTS[agentId].label}]: ${clean}`);
      styleConvRef.current = transcript;
      agentIdx++;
      lastSpeaker = agentId;
    };

    try {
      for (let turn = 0; turn < 8; turn++) {
        if (abortRef.current) break;
        if (turn > 0) {
          const wait = 6000 + Math.random() * 3000;
          const start = Date.now();
          while (Date.now() - start < wait) {
            if (abortRef.current || pendingStyleMsgRef.current) break;
            await sleep(150);
          }
        }
        const pending = pendingStyleMsgRef.current;
        if (pending) {
          pendingStyleMsgRef.current = null;
          addMsg("user", pending, false);
          transcript.push(`[사용자]: ${pending}`);
          styleConvRef.current = transcript;
        }
        if (abortRef.current) break;

        const hist = transcript.length > 0
          ? `[지금까지 논의]\n${transcript.slice(-4).join("\n")}\n\n`
          : "";
        const avail = STYLE_AGENTS.filter(a => a !== lastSpeaker);
        const next  = avail[Math.floor(Math.random() * avail.length)] ?? STYLE_AGENTS[0];

        if (turn === 0) {
          await runOne("script", "세계관과 시놉시스를 보고 어떤 시각적 스타일이 어울릴지 첫 제안을 해줘. 구체적인 작품 레퍼런스로.");
        } else {
          await runOne(next, `${hist}앞 얘기 받아서 스타일에 대한 네 생각 한마디.`);
        }
      }
      // 마무리: 프로듀서가 합의 요약
      await runOne("producer", `${transcript.slice(-4).join("\n")}\n\n지금까지 나온 스타일 방향을 자연스럽게 한 문장으로 정리해줘.`);
    } catch { /* ignore */ }

    // 스타일 키워드 자동 추출 (Claude)
    const apiKey = getAnthropicKey();
    let finalStylePrompt = "";
    if (apiKey && transcript.length > 0) {
      try {
        let extracted = "";
        for await (const chunk of streamClaude({
          apiKey,
          model: "claude-sonnet-4-6",
          systemPrompt: "Runway Gen-4 이미지 생성 프롬프트 전문가.",
          messages: [{
            role: "user",
            content:
              `다음 스타일 토론 내용을 Runway Gen-4용 영문 스타일 프롬프트로 40~70단어 이내로 정리하세요.\n` +
              `Runway Gen-4 프롬프트는: [화풍 키워드], [색채 팔레트], [조명 스타일], [카메라 특성], [분위기 키워드] 순서로.\n` +
              `예시: "Korean webtoon line art, dark fantasy, detailed ink lines, muted earth tones with glowing blue accents, dramatic side lighting, cinematic wide shots, melancholic atmosphere"\n` +
              `[토론]\n${transcript.join("\n")}\n\n영문 Runway 프롬프트 키워드만 출력. 설명 없이.`,
          }],
          maxTokens: 150,
          tools: [],
        })) { extracted += chunk; }
        finalStylePrompt = extracted.trim();
        if (finalStylePrompt) { setStyleInput(finalStylePrompt); setConceptStyle(finalStylePrompt); }
      } catch { /* ignore */ }
    }

    // ── 이미지 생성 + 팀 반응 토론 루프 ──
    // 흐름: 이미지 생성 → 팀 반응 토론 → 사용자/에이전트 피드백 → 필요하면 재생성 → 확정
    const STYLE_AGREE_RE = /^(좋아|맞아|괜찮아|확정|다음으로|다음|넘어가자|확인|ok|오케|ㅇㅋ|ㄱ|그렇게|완성|확정하자|이대로)/i;

    let currentStylePrompt = finalStylePrompt || "Korean webtoon style";
    let generatedImageUrl = "";
    let styleIterCount = 0;

    // 이미지 생성 헬퍼 (반복 사용)
    const generateStyleImage = async (): Promise<string> => {
      const autoRunwayKey = getRunwayKey();
      const genMsgId = addMsg("producer", "🎨 스타일 이미지 생성 중...", true);
      try {
        const description = `${genre} 장르 웹툰 스타일 테스트 씬 — 세계관과 분위기를 보여주는 대표 컷`;
        const res = await fetch(`${API_BASE}/api/assets/${projectId}/generate-concept`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description,
            style: currentStylePrompt,
            type: "style_test",
            anthropicApiKey: apiKey,
            runwayApiKey: autoRunwayKey,
          }),
        });
        if (res.ok) {
          const { imageUrl: autoUrl } = await res.json() as { imageUrl: string };
          if (autoUrl) {
            updateMsg(genMsgId, "🎨 테스트 이미지 생성됐어. 방향 어때?", false);
            setMsgs((prev: Msg[]) => [...prev, {
              id: `style_img_${Date.now()}`,
              agent: "producer" as AgentId,
              text: "",
              imageUrl: autoUrl,
              streaming: false,
            }]);
            setStyleTestImages((prev: string[]) => [...prev, autoUrl]);
            return autoUrl;
          }
        }
        setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== genMsgId));
      } catch {
        setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== genMsgId));
      }
      return "";
    };

    if (apiKey) {
      // 첫 이미지 생성
      generatedImageUrl = await generateStyleImage();
      styleIterCount++;

      // ── 이미지 기반 반응 토론 루프 ──
      // 에이전트들이 이미지를 보고 의견 내고, 사용자가 확정하거나 수정 요청 가능
      // 사용자가 동의 표현 → 확정, 수정 요청 → 스타일 재추출 + 이미지 재생성
      styleDebateLoop: while (!abortRef.current) {
        // 이미지 반응 토론: 4~5턴
        const imageCtx = generatedImageUrl
          ? `스타일 프롬프트 "${currentStylePrompt}"로 이미지가 생성됐어.`
          : `스타일 방향이 "${currentStylePrompt}"로 정리됐어.`;

        for (let turn = 0; turn < 5; turn++) {
          if (abortRef.current) break styleDebateLoop;

          if (turn > 0) {
            const wait = 6000 + Math.random() * 4000;
            const start = Date.now();
            while (Date.now() - start < wait) {
              if (abortRef.current || pendingStyleMsgRef.current) break;
              await sleep(150);
            }
          }

          // 사용자 입력 처리
          const pending = pendingStyleMsgRef.current;
          if (pending) {
            pendingStyleMsgRef.current = null;
            addMsg("user", pending, false);
            transcript.push(`[사용자]: ${pending}`);
            styleConvRef.current = transcript;

            // 확정 표현이면 즉시 루프 탈출
            if (STYLE_AGREE_RE.test(pending.trim())) break styleDebateLoop;
          }
          if (abortRef.current) break styleDebateLoop;

          const avail = STYLE_AGENTS.filter(a => a !== lastSpeaker);
          const next = avail[Math.floor(Math.random() * avail.length)] ?? STYLE_AGENTS[0];
          const hist = `${imageCtx}\n[논의 내용]\n${transcript.slice(-3).join("\n")}\n\n`;

          if (turn === 0) {
            await runOne("script",
              `${hist}방금 생성된 이미지 방향에 대해 솔직하게 평가해줘. 잘 된 점과 보완할 점을. 1~2문장.`);
          } else if (turn < 4) {
            await runOne(next, `${hist}앞 평가 듣고 네 생각 한마디. 방향 수정 제안도 환영.`);
          } else {
            // 마지막 턴: 프로듀서가 방향 정리 + 사용자에게 확정/수정 요청
            await runOne("producer",
              `${hist}팀 의견 종합해서 이 스타일 방향으로 확정할지, 수정이 필요한지 정리해줘. 사용자에게 "확정하자" 또는 수정 방향 입력하라고 요청해줘. 1~2문장.`);
            lastSpeaker = "producer";
          }
        }

        if (abortRef.current) break styleDebateLoop;

        // 사용자 응답 대기 (최대 60초, 폴링)
        const waitStart = Date.now();
        while (Date.now() - waitStart < 60000) {
          if (abortRef.current || pendingStyleMsgRef.current) break;
          await sleep(300);
        }

        const userResponse = pendingStyleMsgRef.current;
        if (!userResponse) {
          // 타임아웃: 자동 확정
          addMsg("producer", "반응이 없네. 이 방향으로 확정할게!", false);
          transcript.push(`[총괄프로듀서]: 반응이 없네. 이 방향으로 확정할게!`);
          break styleDebateLoop;
        }

        pendingStyleMsgRef.current = null;
        addMsg("user", userResponse, false);
        transcript.push(`[사용자]: ${userResponse}`);
        styleConvRef.current = transcript;

        // 확정 표현이면 종료
        if (STYLE_AGREE_RE.test(userResponse.trim())) break styleDebateLoop;

        // 수정 요청: 스타일 프롬프트 재추출 + 이미지 재생성
        if (styleIterCount < 3) {
          // 팀이 수정 방향 반영해서 새 스타일 프롬프트 추출
          addMsg("producer", "알겠어, 수정 방향 반영해서 다시 뽑아볼게.", false);
          try {
            let revised = "";
            for await (const chunk of streamClaude({
              apiKey,
              model: "claude-sonnet-4-6",
              systemPrompt: "이미지 생성 프롬프트 전문가.",
              messages: [{
                role: "user",
                content:
                  `현재 스타일 프롬프트: "${currentStylePrompt}"\n\n` +
                  `사용자/팀 피드백:\n${transcript.slice(-6).join("\n")}\n\n` +
                  `피드백을 반영해서 수정된 영문 스타일 키워드를 40~70단어로 만들어줘. 영문 키워드만 출력.`,
              }],
              maxTokens: 150,
              tools: [],
            })) { revised += chunk; }
            if (revised.trim()) {
              currentStylePrompt = revised.trim();
              setStyleInput(currentStylePrompt);
              setConceptStyle(currentStylePrompt);
            }
          } catch { /* ignore */ }

          generatedImageUrl = await generateStyleImage();
          styleIterCount++;
        } else {
          // 최대 재생성 횟수 초과
          addMsg("producer", "수정을 충분히 했으니 이 방향으로 가자. 리뷰에서 직접 조정할 수 있어!", false);
          break styleDebateLoop;
        }
      }
    }

    styleRunningRef.current = false;
    setStylePhase("reviewing");
  }, [genre, addMsg, updateMsg, projectId]);

  // ── Style: 테스트 이미지 생성 ──
  const generateStyleTestImage = useCallback(async () => {
    setStyleGenLoading(true);
    setStyleGenError(null);
    setStylePhase("generating");
    try {
      const description = `${genre} 장르 웹툰 스타일 테스트 씬 — 세계관과 분위기를 보여주는 대표 컷`;
      const res = await fetch(`${API_BASE}/api/assets/${projectId}/generate-concept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          style: styleInput || conceptStyle,
          type: "style_test",
          anthropicApiKey: getAnthropicKey(),
          runwayApiKey: getRunwayKey(),
        }),
      });
      if (!res.ok) {
        const errData = await res.json() as { error?: string };
        throw new Error(errData.error ?? `서버 오류 ${res.status}`);
      }
      const { imageUrl } = await res.json() as { imageUrl: string };
      setStyleTestImages((prev: string[]) => [...prev, imageUrl]);
    } catch (err) {
      setStyleGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setStyleGenLoading(false);
      setStylePhase("reviewing");
    }
  }, [projectId, styleInput, conceptStyle, genre]);

  // ── 새 단계 시작: 기존 저장 내용 있으면 선택 UI 표시 ──
  const startNewStageDebate = useCallback((idx: number) => {
    const savedConv = localStorage.getItem(`p2_conv_${idx}_${projectId}`);
    const savedMsgs = localStorage.getItem(`p2_msgs_${idx}_${projectId}`);
    if (savedConv && savedMsgs) {
      try {
        const parsedTranscript = JSON.parse(savedConv) as string[];
        const parsedMsgs = JSON.parse(savedMsgs) as Msg[];
        if (parsedTranscript.length > 0 || parsedMsgs.length > 0) {
          setMsgs([]);             // 모달 표시 중 이전 채팅 완전히 숨김
          convRef.current = [];
          setDebatePhase("idle"); // 이전 StageReportInChat 즉시 숨김
          setNewStageChoice({ stageIdx: idx, transcript: parsedTranscript, msgs: parsedMsgs });
          return;
        }
      } catch { /* ignore parse errors */ }
    }
    // 저장된 내용 없으면 즉시 새 토론 시작
    resumeDataRef.current = null;
    setMsgs([]);
    convRef.current = [];
    setCurrentStageIdx(idx);
    void runDebate(idx);
  }, [projectId, runDebate]);

  // ── Style: 확정 & Stage 3 진행 ──
  const confirmStyle = useCallback(() => {
    const style = styleInput.trim() || conceptStyle;
    setConceptStyle(style);
    localStorage.setItem(`wts_style_${projectId}`, style);
    setStylePhase("confirmed");
    setMsgs([]);
    convRef.current = [];
    resumeDataRef.current = null; // 전 단계 resume 데이터 반드시 초기화
    setCurrentStageIdx(2);
    setDebatePhase("idle");
    startNewStageDebate(2);
  }, [styleInput, conceptStyle, projectId, startNewStageDebate]);

  // ── 이미지 컨셉 회의 Phase ──

  // 전체 이미지 세션 종료 → 다음 스테이지로
  const proceedAfterAllImages = useCallback(() => {
    const stageIdx = imageTargetStageIdxRef.current;
    const nextIdx = stageIdx + 1;
    setImageSessionPhase("idle");
    setImageItems([]);
    setImageConcepts([]);
    imageItemsRef.current = [];
    imageConceptsRef.current = [];
    setMsgs([]);
    convRef.current = [];
    setCurrentStageIdx(nextIdx);
    if (nextIdx >= STAGES.length) setDebatePhase("done");
    else void runDebate(nextIdx);
  }, [runDebate]);

  // 현재 아이템 완료 → 다음 아이템 또는 전체 종료
  const proceedToNextItem = useCallback((startDebate: (item: ImageItem) => void) => {
    const items = imageItemsRef.current;
    const nextIdx = imageCurrentItemIdxRef.current + 1;
    if (nextIdx < items.length) {
      setCurrentImageItemIdx(nextIdx);
      imageCurrentItemIdxRef.current = nextIdx;
      imageSelectedDirRef.current = "";
      setImageRoundNum(1);
      setImageConcepts([]);
      imageConceptsRef.current = [];
      setMsgs([]);
      imageConvRef.current = [];
      startDebate(items[nextIdx]);
    } else {
      proceedAfterAllImages();
    }
  }, [proceedAfterAllImages]);

  // 에이전트 1명 발언 (이미지 토론용 — typewriter 포함)
  const runImageAgent = useCallback(async (
    agentId: AgentId,
    systemPrompt: string,
    userPrompt: string,
    maxTokens = 200,
  ): Promise<void> => {
    const key = getAnthropicKeyByIndex(getApiKeyIndexForAgent(0));
    if (!key) return;
    // 전역 lock: 스트리밍 중이면 완료 대기 (한 번에 한 명만 발언)
    const lockStart = Date.now();
    while (msgsRef.current.some((m: Msg) => m.streaming) && Date.now() - lockStart < 30000) {
      await sleep(200);
    }
    const msgId = addMsg(agentId, "", true);
    let text = "";
    try {
      for await (const chunk of streamClaude({
        apiKey: key, model: "claude-sonnet-4-6", systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens, tools: [],
      })) {
        if (imageAbortRef.current) break;
        text += chunk;
      }
    } catch {
      setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== msgId));
      return;
    }
    const clean = text.trim().replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/[#>_`]/g, "");
    if (!clean) { setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== msgId)); return; }
    for (let j = 2; j < clean.length; j += 2) {
      if (imageAbortRef.current) break;
      updateMsg(msgId, clean.slice(0, j), true);
      await sleep(100);
    }
    updateMsg(msgId, clean, false);
  }, [addMsg, updateMsg]);

  // ── 일관성 컨텍스트 빌더 ──
  // 이미 확정된 캐릭터/장소 비주얼을 다음 아이템 생성 시 참조로 주입
  // character 생성 시 → 화풍(MST)만
  // location 생성 시 → 화풍 + 확정 캐릭터들
  // prop 생성 시    → 화풍 + 확정 캐릭터 + 확정 장소
  function buildConsistencyContext(itemType: "character" | "location" | "prop"): string {
    const confirmed = confirmedAllItemsRef.current;
    const parts: string[] = [];

    if (conceptStyle) {
      parts.push(`[확정 화풍 — 반드시 일치]\n${conceptStyle}`);
    }
    if (itemType !== "character") {
      const chars = confirmed.filter((c: ImageItem) => c.type === "character");
      if (chars.length > 0) {
        parts.push(
          `[확정된 캐릭터 비주얼 — 같은 세계에 등장, 스타일 통일 필수]\n` +
          chars.map((c: ImageItem) => `• ${c.name}: ${c.description.split("\n").slice(0, 3).join(" / ")}`).join("\n")
        );
      }
    }
    if (itemType === "prop") {
      const locs = confirmed.filter((c: ImageItem) => c.type === "location");
      if (locs.length > 0) {
        parts.push(
          `[확정된 장소 비주얼 — 소품이 놓일 환경]\n` +
          locs.map((l: ImageItem) => `• ${l.name}: ${l.description.split("\n").slice(0, 2).join(" / ")}`).join("\n")
        );
      }
    }
    if (parts.length === 0) return "";
    return `\n[일관성 참고]\n${parts.join("\n\n")}\n\n[일관성 원칙]\n- 모든 이미지는 같은 웹툰 세계의 일부로, 색감·선화·분위기가 통일되어야 함\n- 이미 확정된 아이템과 나란히 놓였을 때 같은 작품처럼 보여야 함`;
  }

  // 이미지 회의용 에이전트 시스템 프롬프트 생성
  function buildImageAgentSysPrompt(agentId: AgentId, item: ImageItem, topic: string, prevDir?: string): string {
    const typeLabel = item.type === "character" ? "캐릭터" : item.type === "location" ? "장소" : "소품";
    const consistencyCtx = buildConsistencyContext(item.type);
    return [
      `너는 웹툰 기획 팀의 ${AGENTS[agentId].label}야.`,
      `성격: ${AGENT_ROLE_DESC[agentId] ?? ""}`,
      `장르: ${genre}`,
      ``,
      `지금 주제: "${item.name}" ${typeLabel} ${topic}`,
      ``,
      `[설계 내용]`,
      item.description,
      prevDir ? `\n[이전 라운드 선택 방향]\n${prevDir}` : "",
      consistencyCtx,
      ``,
      `[대화 방식]`,
      `- 1~2문장, 구어체`,
      `- 구체적인 색감·스타일·구도 언급`,
      `- 이미 확정된 아이템들과의 일관성을 반드시 고려`,
      `- 마크다운/JSON 금지`,
    ].join("\n");
  }

  // ── 사전 회의: 4가지 방향 논의 ──
  const runPreGenDebate = useCallback(async (item: ImageItem, prevDir?: string) => {
    if (imageDebateRunRef.current) return;
    imageDebateRunRef.current = true;
    imageAbortRef.current = false;
    setImageSessionPhase("pre-debate");
    setMsgs([]);
    imageConvRef.current = [];
    pendingImageMsgRef.current = null;

    const IMG_AGENTS: AgentId[] = ["character", "script", "worldbuilder", "scenario", "editor"];
    let agentIdx = 0;
    let lastSpeaker: AgentId | null = null;
    let transcript: string[] = [];
    const typeLabel = item.type === "character" ? "캐릭터" : item.type === "location" ? "장소" : "소품";
    const topic = `컨셉 시안 방향 회의${prevDir ? " (개선 라운드)" : ""}`;

    for (let turn = 0; turn < 7; turn++) {
      if (imageAbortRef.current) break;
      if (turn > 0) {
        const wait = 5000 + Math.random() * 3000;
        const start = Date.now();
        while (Date.now() - start < wait) {
          if (imageAbortRef.current || pendingImageMsgRef.current) break;
          await sleep(150);
        }
      }
      const pending = pendingImageMsgRef.current;
      if (pending) {
        pendingImageMsgRef.current = null;
        // User message already shown immediately in UI handler; just update transcript
        transcript.push(`[사용자]: ${pending}`);
        imageConvRef.current = transcript;
      }
      if (imageAbortRef.current) break;

      const avail = IMG_AGENTS.filter(a => a !== lastSpeaker);
      const next: AgentId = turn === 0 ? "character"
        : avail[Math.floor(Math.random() * avail.length)] ?? IMG_AGENTS[0];

      const hist = transcript.slice(-3).join("\n");
      const prompt = turn === 0
        ? `"${item.name}" ${typeLabel}를 위한 시각적 시안 방향을 제안해줘. ${
            prevDir ? `이전에 선택된 방향: "${prevDir}"을 기반으로 발전된 아이디어로.`
            : "서로 다른 스타일 접근법 중 하나를 먼저 꺼내봐."}`
        : `[지금까지]\n${hist}\n\n앞 얘기 받아서 시안 방향에 대해 한마디.`;

      await runImageAgent(next, buildImageAgentSysPrompt(next, item, topic, prevDir), prompt);
      transcript.push(`[${AGENTS[next].label}]: (발언)`);
      imageConvRef.current = transcript;
      agentIdx++;
      lastSpeaker = next;
    }

    // 프로듀서가 4가지 방향으로 정리
    if (!imageAbortRef.current) {
      const hist = transcript.slice(-4).join("\n");
      await runImageAgent("producer",
        buildImageAgentSysPrompt("producer", item, topic, prevDir),
        `${hist}\n\n팀 의견을 종합해서 A안/B안/C안/D안 네 가지 서로 다른 시안 방향을 자연스럽게 제안해줘. 각각 색감·스타일이 뚜렷이 다르게. 한 문장씩.`,
        400,
      );
    }

    imageDebateRunRef.current = false;
    if (!imageAbortRef.current) {
      // 자동 진행
      void extractAndGenerate(item);
    }
  }, [genre, addMsg, runImageAgent]);  // eslint-disable-line

  // ── 4방향 추출 + 4개 이미지 병렬 생성 ──
  const extractAndGenerate = useCallback(async (item: ImageItem) => {
    setImageSessionPhase("extracting");
    setImageGenError(null);
    const apiKey = getAnthropicKey();
    if (!apiKey) { setImageGenError("Anthropic API 키가 필요합니다"); return; }

    const transcript = imageConvRef.current.join("\n");
    const typeLabel = item.type === "character" ? "캐릭터" : item.type === "location" ? "장소" : "소품";

    // Claude로 4방향 추출
    let dirJSON = "";
    try {
      for await (const chunk of streamClaude({
        apiKey,
        model: "claude-sonnet-4-6",
        systemPrompt: "이미지 생성 프롬프트 전문가. JSON만 출력.",
        messages: [{
          role: "user",
          content:
            `다음 "${item.name}" ${typeLabel} 시안 방향 회의 내용에서 4가지 서로 다른 영문 이미지 생성 프롬프트를 추출하세요.\n` +
            `각각 색감·스타일·구도가 뚜렷이 달라야 합니다.\n` +
            `확정된 스타일: ${conceptStyle || "Korean webtoon, digital illustration"}\n\n` +
            `[회의 내용]\n${transcript.slice(0, 3000)}\n\n` +
            `[아이템 설계]\n${item.description}\n\n` +
            (buildConsistencyContext(item.type) ? `${buildConsistencyContext(item.type)}\n\n` : "") +
            `[중요] 4개 프롬프트 모두 위의 확정 화풍·캐릭터 스타일과 일관성을 유지해야 합니다.\n` +
            `아래 JSON만 출력 (설명 없이):\n` +
            `[DIRECTIONS]\n{"A":"영문 프롬프트 40-60단어","B":"...","C":"...","D":"..."}\n[/DIRECTIONS]`,
        }],
        maxTokens: 600,
        tools: [],
      })) { dirJSON += chunk; }
    } catch { /* ignore */ }

    const m = dirJSON.match(/\[DIRECTIONS\]\s*([\s\S]*?)\s*\[\/DIRECTIONS\]/);
    let directions: Record<"A"|"B"|"C"|"D", string> = {
      A: `${item.description} — style 1: bright and clean`,
      B: `${item.description} — style 2: dark and dramatic`,
      C: `${item.description} — style 3: detailed and realistic`,
      D: `${item.description} — style 4: stylized and abstract`,
    };
    if (m) {
      try { directions = JSON.parse(m[1]) as Record<"A"|"B"|"C"|"D", string>; } catch { /* fallback */ }
    }

    // 4개 초기 컨셉 설정
    const LABELS = ["A", "B", "C", "D"] as const;
    const initConcepts: ImageConcept[] = LABELS.map((label, i) => ({
      label, direction: directions[label] ?? `direction ${i+1}`, imageUrl: undefined,
      prompt: undefined, generating: true, recommendations: [],
    }));
    setImageConcepts(initConcepts);
    imageConceptsRef.current = initConcepts;
    setImageSessionPhase("generating");
    setImageGenLoading(true);

    // 4개 병렬 생성
    const results = await Promise.allSettled(
      LABELS.map(label =>
        fetch(`${API_BASE}/api/assets/${projectId}/generate-concept`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: directions[label],
            style: conceptStyle,
            type: item.type,
            anthropicApiKey: apiKey,
            runwayApiKey: getRunwayKey(),
          }),
        }).then(async r => {
          const data = await r.json() as { imageUrl?: string; prompt?: string; error?: string };
          if (!r.ok || data.error) throw new Error(data.error ?? `HTTP ${r.status}`);
          return data as { imageUrl: string; prompt: string };
        })
      )
    );

    const updatedConcepts: ImageConcept[] = LABELS.map((label, i) => {
      const r = results[i];
      if (r.status === "fulfilled" && r.value.imageUrl) {
        return { ...initConcepts[i], imageUrl: r.value.imageUrl, prompt: r.value.prompt, generating: false };
      }
      const errMsg = r.status === "rejected" ? String((r.reason as Error).message ?? "생성 실패") : "생성 실패";
      return { ...initConcepts[i], generating: false, error: errMsg };
    });
    setImageConcepts(updatedConcepts);
    imageConceptsRef.current = updatedConcepts;
    setImageGenLoading(false);

    // 검토 회의로
    void runPostGenDebate(item, updatedConcepts);
  }, [projectId, conceptStyle, runImageAgent]);  // eslint-disable-line

  // ── 검토 회의: 4개 이미지 평가 토론 ──
  const runPostGenDebate = useCallback(async (item: ImageItem, concepts: ImageConcept[]) => {
    if (imageDebateRunRef.current) return;
    imageDebateRunRef.current = true;
    imageAbortRef.current = false;
    setImageSessionPhase("post-debate");
    setMsgs([]);
    imageConvRef.current = [];
    pendingImageMsgRef.current = null;

    const typeLabel = item.type === "character" ? "캐릭터" : item.type === "location" ? "장소" : "소품";
    const conceptSummary = concepts.map(c => `${c.label}안: ${c.direction}`).join("\n");
    const topic = `시안 검토 회의 — A/B/C/D 4개 이미지 평가`;
    const postSysPrompt = (agentId: AgentId) =>
      buildImageAgentSysPrompt(agentId, item, topic) + `\n\n[4개 시안 방향]\n${conceptSummary}` +
      `\n\nA/B/C/D를 구체적으로 언급하며 장단점을 얘기해줘.`;

    const POST_AGENTS: AgentId[] = ["script", "worldbuilder", "character", "scenario", "editor"];
    let lastSpeaker: AgentId | null = null;
    let transcript: string[] = [];

    for (let turn = 0; turn < 5; turn++) {
      if (imageAbortRef.current) break;
      if (turn > 0) {
        const wait = 5000 + Math.random() * 3000;
        const start = Date.now();
        while (Date.now() - start < wait) {
          if (imageAbortRef.current || pendingImageMsgRef.current) break;
          await sleep(150);
        }
      }
      const pending = pendingImageMsgRef.current;
      if (pending) {
        pendingImageMsgRef.current = null;
        // User message already shown immediately in UI handler; just update transcript
        transcript.push(`[사용자]: ${pending}`);
        imageConvRef.current = transcript;
      }
      if (imageAbortRef.current) break;

      const avail = POST_AGENTS.filter(a => a !== lastSpeaker);
      const next: AgentId = turn === 0 ? "script"
        : avail[Math.floor(Math.random() * avail.length)] ?? POST_AGENTS[0];

      const hist = transcript.slice(-3).join("\n");
      const prompt = turn === 0
        ? `4개 시안(A/B/C/D)을 검토해줘. 어떤 방향이 "${item.name}"의 설계 의도에 가장 맞는지 첫 의견.`
        : `${hist ? `[지금까지]\n${hist}\n\n` : ""}앞 의견 받아서 시안 평가 한마디.`;

      await runImageAgent(next, postSysPrompt(next), prompt);
      transcript.push(`[${AGENTS[next].label}]: (발언)`);
      imageConvRef.current = transcript;
      lastSpeaker = next;
    }

    imageDebateRunRef.current = false;
    if (!imageAbortRef.current) {
      void runAgentRecommendations(item, concepts);
    }
  }, [addMsg, runImageAgent]);  // eslint-disable-line

  // ── 에이전트 추천 발표 ──
  const runAgentRecommendations = useCallback(async (item: ImageItem, concepts: ImageConcept[]) => {
    setImageSessionPhase("recommending");
    const conceptSummary = concepts.map(c => `${c.label}안: ${c.direction}`).join("\n");
    const typeLabel = item.type === "character" ? "캐릭터" : item.type === "location" ? "장소" : "소품";
    const REC_AGENTS: AgentId[] = ["character", "script", "worldbuilder", "editor"];
    const updatedConcepts = [...imageConceptsRef.current];

    for (let i = 0; i < REC_AGENTS.length; i++) {
      if (imageAbortRef.current) break;
      if (i > 0) await sleep(2000 + Math.random() * 1500);
      const agentId = REC_AGENTS[i];
      const key = getAnthropicKeyByIndex(getApiKeyIndexForAgent(i));
      if (!key) continue;
      const msgId = addMsg(agentId, "", true);
      let text = "";
      try {
        for await (const chunk of streamClaude({
          apiKey: key,
          model: "claude-sonnet-4-6",
          systemPrompt: `너는 웹툰 기획 팀의 ${AGENTS[agentId].label}야. ${AGENT_ROLE_DESC[agentId] ?? ""}`,
          messages: [{
            role: "user",
            content:
              `"${item.name}" ${typeLabel} 시안 4개 중 하나를 추천해줘.\n\n` +
              `[시안 방향]\n${conceptSummary}\n\n` +
              `[설계 내용]\n${item.description}\n\n` +
              `반드시 A/B/C/D 중 하나를 선택해서 "저는 [X]안을 추천합니다. {이유 1문장}" 형식으로.`,
          }],
          maxTokens: 150,
          tools: [],
        })) {
          if (imageAbortRef.current) break;
          text += chunk;
        }
      } catch {
        setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== msgId));
        continue;
      }
      const clean = text.trim().replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/[#>_`]/g, "");
      if (!clean) { setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== msgId)); continue; }
      for (let j = 2; j < clean.length; j += 2) {
        if (imageAbortRef.current) break;
        updateMsg(msgId, clean.slice(0, j), true);
        await sleep(80);
      }
      updateMsg(msgId, clean, false);

      // 추천 라벨 파싱 (A/B/C/D)
      const recMatch = clean.match(/[ABCD]안/);
      if (recMatch) {
        const label = recMatch[0][0] as "A"|"B"|"C"|"D";
        const conceptIdx = ["A","B","C","D"].indexOf(label);
        if (conceptIdx >= 0) {
          updatedConcepts[conceptIdx] = {
            ...updatedConcepts[conceptIdx],
            recommendations: [...updatedConcepts[conceptIdx].recommendations, { agentId, reason: clean }],
          };
          setImageConcepts([...updatedConcepts]);
          imageConceptsRef.current = [...updatedConcepts];
        }
      }
    }

    // 프로듀서 종합 추천
    if (!imageAbortRef.current) {
      await sleep(1500);
      const recCounts = updatedConcepts.map(c => ({ label: c.label, count: c.recommendations.length }))
        .sort((a, b) => b.count - a.count);
      const topLabel = recCounts[0]?.label ?? "A";
      await runImageAgent("producer",
        `너는 총괄 프로듀서야. 장르: ${genre}`,
        `팀 추천 집계: ${recCounts.map(r => `${r.label}안 ${r.count}표`).join(", ")}.\n\n` +
        `팀 의견을 종합해서 "${topLabel}안"을 중심으로 최종 추천 의견을 1~2문장으로 자연스럽게.` +
        ` 그리고 사용자(감독님)에게 최종 결정을 부탁해줘.`,
        200,
      );
    }

    setImageSessionPhase("selecting");

    // ── 이미지 확정 대화 루프 ──
    // 이미지 생성 후 에이전트+사용자 토론으로 방향을 다듬고 확정
    // 사용자가 "A안 확정", "좋아" → 확정 / "다시 만들어", "수정" → 재생성 라운드
    const IMG_LABEL_RE = /\b([A-Da-d])안/;
    const IMG_CONFIRM_RE = /확정|좋아|맞아|이걸로|이대로|다음|넘어가|ok|오케|ㅇㅋ|ㄱ|그걸로/i;
    const IMG_REGEN_RE = /다시|재생성|수정|바꿔|개선|변경|못 쓰|별로|안 맞|이상해/i;
    let agentChimeCount = 0;
    pendingImageMsgRef.current = null;

    selectionLoop: while (!imageAbortRef.current) {
      // 사용자 응답 대기 (최대 20초)
      const pollStart = Date.now();
      while (Date.now() - pollStart < 20000) {
        if (imageAbortRef.current || pendingImageMsgRef.current) break;
        await sleep(300);
      }
      if (imageAbortRef.current) break;

      const userMsg = pendingImageMsgRef.current;
      if (!userMsg) {
        // 타임아웃: 에이전트가 가끔 한마디 (최대 2번)
        agentChimeCount++;
        if (agentChimeCount <= 2) {
          const chimeAgents: AgentId[] = ["script", "editor"];
          const chimeAgent = chimeAgents[agentChimeCount % chimeAgents.length];
          const cSummary = updatedConcepts.map(c => `${c.label}안: ${c.direction.slice(0, 50)}`).join(", ");
          await runImageAgent(chimeAgent,
            buildImageAgentSysPrompt(chimeAgent, item, "최종 결정 대기"),
            `[시안] ${cSummary}\n\n어떤 안이 제일 나아 보여? A/B/C/D 중 골라줘. 1문장.`, 80);
        }
        continue;
      }

      pendingImageMsgRef.current = null;
      // User message already shown immediately in UI handler

      const labelMatch = IMG_LABEL_RE.exec(userMsg);
      const isConfirm = IMG_CONFIRM_RE.test(userMsg);
      const isRegen = IMG_REGEN_RE.test(userMsg);

      if ((labelMatch || isConfirm) && !isRegen) {
        // 확정: 선택 라벨 파악 (없으면 가장 많이 추천된 것)
        const topLabel = [...updatedConcepts].sort((a, b) => b.recommendations.length - a.recommendations.length)[0]?.label ?? "A";
        const selectedLabel = labelMatch
          ? (labelMatch[1].toUpperCase() as "A"|"B"|"C"|"D")
          : topLabel;

        const concept = imageConceptsRef.current.find(c => c.label === selectedLabel);
        const idx = imageCurrentItemIdxRef.current;
        const confirmedItem = imageItemsRef.current[idx];
        const updated = imageItemsRef.current.map((it: ImageItem, i: number) =>
          i === idx ? { ...it, imageUrl: concept?.imageUrl, confirmed: true } : it
        );
        imageItemsRef.current = updated;
        setImageItems(updated);
        if (confirmedItem) {
          confirmedAllItemsRef.current = [
            ...confirmedAllItemsRef.current,
            { ...confirmedItem, imageUrl: concept?.imageUrl, confirmed: true },
          ];
        }
        setImageCustomDir("");
        setImageRoundNum(1);
        setImageConcepts([]);
        imageConceptsRef.current = [];
        imageSelectedDirRef.current = "";
        addMsg("producer", `${selectedLabel}안 확정! 다음으로 넘어갈게.`, false);
        await sleep(800);
        proceedToNextItem((nextItem: ImageItem) => void runPreGenDebate(nextItem, undefined));
        break selectionLoop;
      }

      if (isRegen) {
        // 재생성 요청: 사용자 피드백을 방향으로 삼아 다음 라운드 시작
        const dir = imageCustomDir.trim() || userMsg;
        addMsg("producer", "알겠어, 피드백 반영해서 다시 만들어볼게!", false);
        await sleep(500);
        imageSelectedDirRef.current = dir;
        setImageCustomDir("");
        setImageRoundNum((r: number) => r + 1);
        setImageConcepts([]);
        imageConceptsRef.current = [];
        imageDebateRunRef.current = false;
        void runPreGenDebate(item, dir);
        break selectionLoop;
      }

      // 일반 코멘트: 에이전트가 반응 + 결정 유도
      const respAgents: AgentId[] = ["script", "character", "worldbuilder", "editor"];
      const respAgent = respAgents[Math.floor(Math.random() * respAgents.length)];
      const cSummary2 = updatedConcepts.map(c => `${c.label}안: ${c.direction.slice(0, 60)}`).join("\n");
      await runImageAgent(respAgent,
        buildImageAgentSysPrompt(respAgent, item, "피드백 반응"),
        `사용자 코멘트: "${userMsg}"\n[시안 방향]\n${cSummary2}\n\n의견에 반응하고 A/B/C/D 중 확정을 유도해줘. 1문장.`,
        120);
    }
  }, [genre, addMsg, updateMsg, runImageAgent, proceedToNextItem, runPreGenDebate]);  // eslint-disable-line

  // ── 이미지 생성 단계 진입 (stage 결과에서 아이템 목록 구성) ──
  const enterImageGenPhase = useCallback((stageIdx: number) => {
    const stageId = STAGES[stageIdx].id;
    const stageResult = stageResultsRef.current.find((r: StageResult) => r.stageId === stageId);
    if (!stageResult) {
      const nextIdx = stageIdx + 1;
      setCurrentStageIdx(nextIdx);
      if (nextIdx >= STAGES.length) setDebatePhase("done");
      else void runDebate(nextIdx);
      return;
    }
    imageTargetStageIdxRef.current = stageIdx;
    const items: ImageItem[] = [];
    const data = stageResult.data;
    if (stageIdx === 2) {
      // Stage 3(캐릭터 설정) + Stage 1(세계관 key_characters) 병합 — 누락 방지
      const stage3Chars = Array.isArray(data.characters) ? data.characters as Record<string,string>[] : [];
      const stage1 = stageResultsRef.current.find((r: StageResult) => r.stageId === 1);
      const stage1Chars = Array.isArray(stage1?.data?.key_characters) ? stage1!.data.key_characters as Record<string,string>[] : [];

      const seen = new Set<string>();
      const merged: Record<string,string>[] = [];
      for (const ch of [...stage3Chars, ...stage1Chars]) {
        const name = (ch.name ?? "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        // Stage 3 데이터를 우선, Stage 1로 부족한 필드 보완
        const base = stage3Chars.find(c => c.name === name) ?? ch;
        const sup  = stage1Chars.find(c => c.name === name) ?? {};
        merged.push({ ...sup, ...base }); // Stage 3 우선
      }

      for (const ch of merged) {
        const desc = [
          `이름: ${ch.name}${ch.role ? ` (${ch.role})` : ""}`,
          ch.gender && `성별: ${ch.gender}`,
          ch.age && `나이: ${ch.age}`,
          ch.face && `얼굴: ${ch.face}`,
          (ch.height || ch.build) && `키/체형: ${[ch.height, ch.build, ch.weight].filter(Boolean).join(", ")}`,
          ch.outfit && `복장: ${ch.outfit}`,
          ch.personality && `성격: ${ch.personality}`,
          ch.motivation && `동기: ${ch.motivation}`,
          ch.backstory && `배경/상처: ${ch.backstory}`,
          ch.speech && `말투: ${ch.speech}`,
        ].filter(Boolean).join("\n");
        items.push({ type: "character", name: ch.name ?? "캐릭터", description: desc, stageId: 3, confirmed: false });
      }
    } else if (stageIdx === 3) {
      // Stage 4(장소 설정) + Stage 1(세계관 key_locations) 병합 — 누락 방지
      const stage4Locs = Array.isArray(data.locations) ? data.locations as Record<string,string>[] : [];
      const stage1 = stageResultsRef.current.find((r: StageResult) => r.stageId === 1);
      const stage1Locs = Array.isArray(stage1?.data?.key_locations) ? stage1!.data.key_locations as Record<string,string>[] : [];

      const seen = new Set<string>();
      const merged: Record<string,string>[] = [];
      for (const loc of [...stage4Locs, ...stage1Locs]) {
        const name = (loc.name ?? "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const base = stage4Locs.find(l => l.name === name) ?? loc;
        const sup  = stage1Locs.find(l => l.name === name) ?? {};
        merged.push({ ...sup, ...base });
      }

      for (const loc of merged) {
        const desc = [
          `장소명: ${loc.name}${loc.type ? ` (${loc.type})` : ""}`,
          loc.visual && `시각적 묘사: ${loc.visual}`,
          loc.architecture && `건축 구조: ${loc.architecture}`,
          loc.lighting && `조명: ${loc.lighting}`,
          loc.color_palette && `색채: ${loc.color_palette}`,
          loc.atmosphere && `분위기: ${loc.atmosphere}`,
          loc.sound && `소리: ${loc.sound}`,
        ].filter(Boolean).join("\n");
        items.push({ type: "location", name: loc.name ?? "장소", description: desc, stageId: 4, confirmed: false });
      }
    } else if (stageIdx === 4 && Array.isArray(data.props)) {
      for (const p of data.props as Record<string, string>[]) {
        const desc = [
          `소품명: ${p.name ?? ""}${p.type ? ` (${p.type})` : ""}`,
          p.visual && `시각적 묘사: ${p.visual}`,
          p.condition && `상태: ${p.condition}`,
          p.function && `기능: ${p.function}`,
          p.owner && `소유자: ${p.owner}`,
        ].filter(Boolean).join("\n");
        items.push({ type: "prop", name: p.name ?? "소품", description: desc, stageId: 5, confirmed: false });
      }
    }
    if (items.length === 0) {
      const nextIdx = stageIdx + 1;
      setCurrentStageIdx(nextIdx);
      if (nextIdx >= STAGES.length) setDebatePhase("done");
      else void runDebate(nextIdx);
      return;
    }
    imageItemsRef.current = items;
    setImageItems(items);
    setCurrentImageItemIdx(0);
    imageCurrentItemIdxRef.current = 0;
    imageSelectedDirRef.current = "";
    setImageRoundNum(1);
    setImageConcepts([]);
    imageConceptsRef.current = [];
    imageDebateRunRef.current = false; // 이전 세션 guard stuck 방지
    setMsgs([]);
    convRef.current = [];
    void runPreGenDebate(items[0], undefined);
  }, [runPreGenDebate, runDebate]);

  // ── 사용자가 "다음 라운드" 선택: 선택 시안 기반으로 새 라운드 ──
  const handleNextRound = useCallback((label: "A"|"B"|"C"|"D") => {
    const concept = imageConceptsRef.current.find((c: ImageConcept) => c.label === label);
    const dir = imageCustomDir.trim() || concept?.direction || "";
    imageSelectedDirRef.current = dir;
    setImageCustomDir("");
    setImageRoundNum((r: number) => r + 1);
    setImageConcepts([]);
    imageConceptsRef.current = [];
    const item = imageItemsRef.current[imageCurrentItemIdxRef.current];
    void runPreGenDebate(item, dir);
  }, [imageCustomDir, runPreGenDebate]);

  // ── 사용자가 "최종 확정" ──
  const handleFinalConfirm = useCallback((label: "A"|"B"|"C"|"D") => {
    const concept = imageConceptsRef.current.find((c: ImageConcept) => c.label === label);
    const idx = imageCurrentItemIdxRef.current;
    const confirmedItem = imageItemsRef.current[idx];
    const updated = imageItemsRef.current.map((it: ImageItem, i: number) =>
      i === idx ? { ...it, imageUrl: concept?.imageUrl, confirmed: true } : it
    );
    imageItemsRef.current = updated;
    setImageItems(updated);
    // 전 스테이지 통합 확정 목록에 추가 (다음 아이템 일관성 컨텍스트에 사용)
    if (confirmedItem) {
      confirmedAllItemsRef.current = [
        ...confirmedAllItemsRef.current,
        { ...confirmedItem, imageUrl: concept?.imageUrl, confirmed: true },
      ];
    }
    setImageCustomDir("");
    setImageRoundNum(1);
    setImageConcepts([]);
    imageConceptsRef.current = [];
    imageSelectedDirRef.current = "";
    proceedToNextItem((nextItem: ImageItem) => void runPreGenDebate(nextItem, undefined));
  }, [proceedToNextItem, runPreGenDebate]);

  // ── 수동으로 사전 회의 종료 → 시안 생성 ──
  const handleEndPreDebate = useCallback(() => {
    imageAbortRef.current = true;
    void (async () => {
      while (imageDebateRunRef.current) await new Promise<void>(r => setTimeout(r, 100));
      imageAbortRef.current = false;
      const item = imageItemsRef.current[imageCurrentItemIdxRef.current];
      void extractAndGenerate(item);
    })();
  }, [extractAndGenerate]);

  // ── 수동으로 검토 회의 종료 → 추천 발표 ──
  const handleEndPostDebate = useCallback(() => {
    imageAbortRef.current = true;
    void (async () => {
      while (imageDebateRunRef.current) await new Promise<void>(r => setTimeout(r, 100));
      imageAbortRef.current = false;
      const item = imageItemsRef.current[imageCurrentItemIdxRef.current];
      void runAgentRecommendations(item, imageConceptsRef.current);
    })();
  }, [runAgentRecommendations]);

  // ── Confirm current stage: stop debate → extract JSON → save ──
  const handleConfirm = useCallback(async (stageIdx: number) => {
    abortRef.current = true;
    setDebatePhase("confirming");

    while (runningRef.current) {
      await new Promise<void>(r => setTimeout(r, 100));
    }

    const stage = STAGES[stageIdx];
    const apiKey = getAnthropicKey();
    if (!apiKey) { setDebatePhase("running"); abortRef.current = false; return; }

    const debateText = convRef.current.join("\n");
    const extractId = addMsg("producer", "결과 정리 중...", true);
    const synopsisCtx = buildBibleContext(stageResultsRef.current);

    const { data, summary } = await extractStageData(stage, genre, debateText, apiKey, synopsisCtx);

    updateMsg(extractId, "", false);
    setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== extractId));

    // 확정 완료 → in-progress 대화 삭제
    localStorage.removeItem(`p2_conv_${stageIdx}_${projectId}`);
    localStorage.removeItem(`p2_msgs_${stageIdx}_${projectId}`);

    // 이전 버전 아카이브 + 버전 번호 계산
    const existing = stageResultsRef.current.find((r: StageResult) => r.stageId === stage.id);
    const versionNumber = (existing?.version ?? 0) + 1;
    if (existing) {
      const newHist = { ...stageResultHistoryRef.current, [stageIdx]: [...(stageResultHistoryRef.current[stageIdx] ?? []), existing] };
      stageResultHistoryRef.current = newHist;
      setStageResultHistory(newHist);
    }
    const result: StageResult = { stageId: stage.id, data, summary, version: versionNumber };
    // replace: 같은 stageId 제거 후 최신 버전만 유지
    const newResults = [...stageResultsRef.current.filter((r: StageResult) => r.stageId !== stage.id), result];
    stageResultsRef.current = newResults;
    setStageResults(newResults);

    // ── 스테이지 확정 시 에셋 목록 즉시 업데이트 ──
    // 각 스테이지의 JSON 데이터에서 이름을 추출해 editableAssets에 누적
    setEditableAssets((prev: SynopsisAssets) => {
      const names = (arr: unknown, key: string): string[] =>
        Array.isArray(arr)
          ? (arr as Record<string, string>[]).map(x => x[key]).filter(Boolean)
          : [];
      let chars = [...prev.characters];
      let locs   = [...prev.locations];
      let props  = [...prev.props];

      if (stage.id === 1) {
        chars = [...new Set([...chars, ...names(data.key_characters, "name")])];
        locs  = [...new Set([...locs,  ...names(data.key_locations,  "name")])];
      } else if (stage.id === 2) {
        chars = [...new Set([...chars, ...names(data.characters, "name")])];
        locs  = [...new Set([...locs,  ...names(data.locations,  "name")])];
        props = [...new Set([...props, ...names(data.props,      "name")])];
      } else if (stage.id === 3) {
        chars = [...new Set([...chars, ...names(data.characters, "name")])];
      } else if (stage.id === 4) {
        locs  = [...new Set([...locs,  ...names(data.locations, "name")])];
      } else if (stage.id === 5) {
        props = [...new Set([...props, ...names(data.props, "name")])];
      }

      const next: SynopsisAssets = { characters: chars, locations: locs, props };
      localStorage.setItem(`wts_asset_list_${projectId}`, JSON.stringify(next));
      synopsisAssetsRef.current = next; // 에이전트 체크리스트와 항상 동기화
      return next;
    });

    // 시놉시스(Stage 2) 완료 시 → 에셋 목록 자동 추출 (AI fallback — 추가 병합)
    if (stage.id === 2 && summary) {
      void (async () => {
        try {
          let extracted = "";
          for await (const chunk of streamClaude({
            apiKey,
            model: "claude-sonnet-4-6",
            systemPrompt: "JSON만 출력. 설명 없이.",
            messages: [{
              role: "user",
              content:
                `다음 시놉시스에 등장하는 캐릭터, 장소, 소품의 이름을 모두 추출하세요.\n\n[시놉시스]\n${summary.slice(0, 3000)}\n\n` +
                `출력 형식 (JSON만, 설명 없이):\n{"characters":["이름1","이름2"],"locations":["장소1","장소2"],"props":["소품1"]}`,
            }],
            maxTokens: 400,
            tools: [],
          })) { extracted += chunk; }
          const m = extracted.match(/\{[\s\S]*\}/);
          if (m) {
            try {
              const aiAssets = JSON.parse(m[0]) as SynopsisAssets;
              // 기존 목록에 병합 (덮어쓰지 않음)
              setEditableAssets((prev: SynopsisAssets) => {
                const next: SynopsisAssets = {
                  characters: [...new Set([...prev.characters, ...aiAssets.characters])],
                  locations:  [...new Set([...prev.locations,  ...aiAssets.locations])],
                  props:      [...new Set([...prev.props,      ...aiAssets.props])],
                };
                localStorage.setItem(`wts_asset_list_${projectId}`, JSON.stringify(next));
                synopsisAssetsRef.current = next;
                return next;
              });
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      })();
    }

    // 현재 단계 토론 메시지 저장
    const savedMsgs = msgsRef.current.filter((m: Msg) => !m.streaming);
    setStageHistoryMsgs((prev: Record<number, Msg[]>) => {
      const next = { ...prev, [stageIdx]: savedMsgs };
      localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({
        stageResults: newResults,
        stageResultHistory: stageResultHistoryRef.current,
        currentStageIdx: stageIdx + 1,
        stageHistoryMsgs: next,
      }));
      return next;
    });

    setDebatePhase("confirmed");
  }, [genre, projectId, addMsg, updateMsg]);

  // ── Move to next stage (only via button) ──
  const handleNextStage = useCallback((stageIdx: number) => {
    resumeDataRef.current = null; // 단계 전환 시 이전 resume 데이터 반드시 초기화
    // Stage 2(index=1) 완료 후 → 에셋 리스트 검토 → 스타일 정의 단계
    if (stageIdx === 1) {
      setMsgs([]);
      convRef.current = [];
      setDebatePhase("idle"); // StageReportInChat 숨김 — 다음 단계 UI가 제대로 보이도록
      if (assetListPhase === "idle") {
        // Start asset list review first
        void runAssetListReview();
      } else if (assetListPhase === "confirmed" && stylePhase === "idle") {
        setStylePhase("debating");
        void runStyleDebate();
      } else if (assetListPhase === "confirmed" && stylePhase === "confirmed") {
        // 에셋 + 스타일 이미 완료 (페이지 재로드 등) → 바로 캐릭터 설정 토론 시작
        startNewStageDebate(2);
      }
      return;
    }
    // Stage 3/4/5(index=2/3/4) 완료 후 → 이미지 생성 단계 삽입
    if (stageIdx >= 2) {
      setDebatePhase("idle"); // StageReportInChat 숨김
      enterImageGenPhase(stageIdx);
      return;
    }
    const nextIdx = stageIdx + 1;
    setMsgs([]);
    convRef.current = [];
    setDebatePhase("idle"); // StageReportInChat 숨김 — newStageChoice 모달과 동시 표시 방지
    if (nextIdx >= STAGES.length) {
      setCurrentStageIdx(nextIdx);
      setDebatePhase("done");
    } else {
      startNewStageDebate(nextIdx);
    }
  }, [startNewStageDebate, runStyleDebate, runAssetListReview, stylePhase, assetListPhase, enterImageGenPhase]);

  // ── Re-analyze: 기존 토론 내용을 다시 추출 + 이후 스테이지에 공지 삽입 ──
  const handleReanalyze = useCallback(async (stageIdx: number): Promise<void> => {
    const stage = STAGES[stageIdx];
    const apiKey = getAnthropicKey();
    if (!apiKey) return;

    // 저장된 메시지에서 토론 텍스트 복원
    const histMsgs = stageHistoryMsgs[stageIdx] ?? [];
    const debateText = histMsgs
      .filter((m: Msg) => !m.streaming && m.text)
      .map((m: Msg) => {
        const agData = AGENTS[m.agent as AgentId];
        const label = agData ? agData.label : "사용자";
        return `[${label}]: ${m.text}`;
      })
      .join("\n");

    if (!debateText) return;

    // 재추출
    const synopsisCtx = buildBibleContext(stageResultsRef.current);
    const { data, summary } = await extractStageData(stage, genre, debateText, apiKey, synopsisCtx);

    // 이전 버전 아카이브 + 교체
    const existingRA = stageResultsRef.current.find((r: StageResult) => r.stageId === stage.id);
    const versionNumberRA = (existingRA?.version ?? 0) + 1;
    if (existingRA) {
      const newHistRA = { ...stageResultHistoryRef.current, [stageIdx]: [...(stageResultHistoryRef.current[stageIdx] ?? []), existingRA] };
      stageResultHistoryRef.current = newHistRA;
      setStageResultHistory(newHistRA);
    }
    const result: StageResult = { stageId: stage.id, data, summary, version: versionNumberRA };
    const newResults = stageResultsRef.current.map((r: StageResult) =>
      r.stageId === stage.id ? result : r
    );
    stageResultsRef.current = newResults;
    setStageResults(newResults);

    // 에셋 목록 — 전체 stageResults에서 재빌드 (merge 아닌 rebuild)
    // 재분석 후 구버전 항목이 남지 않도록 확정된 스테이지 데이터 기준으로 완전 재구성
    const rebuildAssets = (results: StageResult[]): SynopsisAssets => {
      const ns = (arr: unknown, key: string): string[] =>
        Array.isArray(arr) ? (arr as Record<string,string>[]).map(x => x[key]).filter(Boolean) : [];
      const s1d = results.find(r => r.stageId === 1)?.data;
      const s2d = results.find(r => r.stageId === 2)?.data;
      const s3d = results.find(r => r.stageId === 3)?.data;
      const s4d = results.find(r => r.stageId === 4)?.data;
      const s5d = results.find(r => r.stageId === 5)?.data;
      return {
        characters: [...new Set([
          ...ns(s1d?.key_characters, "name").filter(isRealCharacter),
          ...ns(s2d?.characters, "name").filter(isRealCharacter),
          ...ns(s3d?.characters, "name").filter(isRealCharacter),
        ])],
        locations: [...new Set([
          ...ns(s1d?.key_locations, "name"),
          ...ns(s2d?.locations, "name"),
          ...ns(s4d?.locations, "name"),
        ])],
        props: [...new Set([...ns(s5d?.props, "name")])],
      };
    };
    const newAssets = rebuildAssets(newResults);
    setEditableAssets(() => {
      localStorage.setItem(`wts_asset_list_${projectId}`, JSON.stringify(newAssets));
      synopsisAssetsRef.current = newAssets;
      return newAssets;
    });

    // 이후 완료된 스테이지에 업데이트 공지 AI 생성
    const laterResults = newResults.filter((r: StageResult) => r.stageId > stage.id);
    const historyUpdates: Record<number, Msg> = {};

    for (const laterResult of laterResults) {
      const laterStage = STAGES.find(s => s.id === laterResult.stageId);
      if (!laterStage) continue;
      const laterIdx = laterResult.stageId - 1;

      let updateText = "";
      try {
        for await (const chunk of streamClaude({
          apiKey,
          model: "claude-sonnet-4-6",
          systemPrompt: "웹툰 기획 팀의 총괄 프로듀서. 자연스러운 구어체, 2~3문장.",
          messages: [{
            role: "user",
            content:
              `[${stage.name}] 내용이 새로 분석됐어.\n\n` +
              `[업데이트된 ${stage.name} 핵심 요약]\n${summary.slice(0, 600)}\n\n` +
              `[기존 ${laterStage.name} 요약]\n${laterResult.summary.slice(0, 400)}\n\n` +
              `팀에게 자연스럽게 알려줘: "${stage.name}이 업데이트됐고, ${laterStage.name}에서 구체적으로 어떤 부분을 다시 확인해야 하는지". 구어체, 2~3문장, 마크다운 금지.`,
          }],
          maxTokens: 200,
          tools: [],
        })) updateText += chunk;
      } catch { /* ignore */ }

      // AI 생성 실패 시 fallback 메시지 보장
      if (!updateText) {
        updateText = `${stage.name} 내용이 업데이트됐어. 변경된 내용이 이 단계에 영향을 줄 수 있으니 다시 확인해봐. "↩ 이어서 토론"으로 업데이트 내용을 반영해서 계속할 수 있어.`;
      }
      historyUpdates[laterIdx] = {
        id: uid(),
        agent: "producer",
        text: `[🔄 ${stage.name} 업데이트] ${updateText.trim().replace(/\*\*?([^*]+)\*\*?/g, "$1")}`,
        streaming: false,
      };
    }

    // 히스토리 업데이트 + localStorage 저장
    setStageHistoryMsgs((prev: Record<number, Msg[]>) => {
      const updated = { ...prev };
      for (const [k, msg] of Object.entries(historyUpdates)) {
        updated[Number(k)] = [...(updated[Number(k)] ?? []), msg];
      }
      try {
        const savedData = localStorage.getItem(`wts_phase2_${projectId}`);
        const existingParsed = savedData ? JSON.parse(savedData) as { currentStageIdx?: number } : {};
        localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({
          stageResults: newResults,
          currentStageIdx: existingParsed.currentStageIdx ?? (stageIdx + 1),
          stageHistoryMsgs: updated,
        }));
      } catch { /* ignore */ }
      return updated;
    });

    // 완료 공지 (현재 채팅 또는 view mode에서 카드 업데이트됨)
    const laterNames = laterResults
      .map((r: StageResult) => STAGES.find(s => s.id === r.stageId)?.name)
      .filter(Boolean)
      .join(", ");
    addMsg(
      "producer",
      laterNames
        ? `${stage.name} 다시 분석 완료. 이미 완료된 [${laterNames}] 토론 기록에 업데이트 내용을 추가했어. 해당 단계 채팅에서 확인해봐.`
        : `${stage.name} 다시 분석 완료. 업데이트된 결과 카드를 확인해봐.`,
      false,
    );
  }, [genre, projectId, addMsg, stageHistoryMsgs]);

  const handleRestartNew = useCallback(() => {
    abortRef.current = true;
    const idx = currentStageIdx;
    // 현재 스테이지 대화만 지우고, 이전 스테이지 결과는 보존
    localStorage.removeItem(`p2_conv_${idx}_${projectId}`);
    localStorage.removeItem(`p2_msgs_${idx}_${projectId}`);
    // 이전 결과는 유지, 현재 스테이지부터 제거
    const keptResults = stageResultsRef.current.filter((r: StageResult) => r.stageId < STAGES[idx].id);
    const keptHistory: Record<number, Msg[]> = {};
    for (let i = 0; i < idx; i++) keptHistory[i] = stageHistoryMsgs[i] ?? [];
    try {
      localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({
        stageResults: keptResults,
        currentStageIdx: idx,
        stageHistoryMsgs: keptHistory,
      }));
    } catch { /* ignore */ }
    resumeDataRef.current = null;
    convRef.current = [];
    stageResultsRef.current = keptResults;
    runningRef.current = false;
    // synopsis step 초기화
    synopsisStepRef.current = "idle";
    loglineResolverRef.current = null;
    step4ProceedRef.current = null;
    setMsgs([]);
    setStageResults(keptResults);
    setStageHistoryMsgs(keptHistory);
    setApiError(null);
    setSynopsisStep("idle");
    setSynopsisLoglines([]);
    setSelectedLogline("");
    setStep4CountDown(0);
    setDebatePhase("idle");
  }, [projectId, currentStageIdx, stageHistoryMsgs]);

  // ── 뷰 모드 전용: 과거 스테이지 이어서 토론 (기존 트랜스크립트 resume) ──
  const handleResumeStageFromView = useCallback((stageIdx: number) => {
    const histMsgs = stageHistoryMsgs[stageIdx] ?? [];
    const transcript = histMsgs
      .filter((m: Msg) => !m.streaming && m.text)
      .map((m: Msg) => {
        const agData = AGENTS[m.agent as AgentId];
        const label = agData ? agData.label : "사용자";
        return `[${label}]: ${m.text}`;
      });
    // refs에 직접 복원 (소프트 내비게이션: 전체 리로드 없이 뷰 모드 → 토론 모드)
    resumeDataRef.current = { transcript, msgs: histMsgs };
    pendingResumeRef.current = stageIdx;
    setCurrentStageIdx(stageIdx);
    // localStorage에도 저장 (강제 리로드 대비)
    try {
      localStorage.setItem(`p2_conv_${stageIdx}_${projectId}`, JSON.stringify(transcript));
      localStorage.setItem(`p2_msgs_${stageIdx}_${projectId}`, JSON.stringify(histMsgs));
      const saved = localStorage.getItem(`wts_phase2_${projectId}`);
      const parsed = saved ? JSON.parse(saved) as Record<string, unknown> : {};
      localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({ ...parsed, currentStageIdx: stageIdx, pendingResume: stageIdx }));
    } catch { /* ignore */ }
    // ?view 파라미터 제거 → 메인 토론 뷰로 전환 (소프트 내비게이션, 흰 화면 없음)
    router.push(`/projects/${projectId}/phase-2`);
  }, [projectId, stageHistoryMsgs, router]);

  // ── 뷰 모드 전용: 과거 스테이지 새로 토론 (해당 스테이지 + 이후 초기화) ──
  const handleRestartStageFromView = useCallback((stageIdx: number) => {
    // 해당 스테이지 이후 결과 제거
    const newResults = stageResultsRef.current.filter((r: StageResult) => r.stageId <= stageIdx);
    const newHistory: Record<number, Msg[]> = {};
    for (let i = 0; i < stageIdx; i++) newHistory[i] = stageHistoryMsgs[i] ?? [];
    // localStorage 정리
    for (let i = stageIdx; i < STAGES.length; i++) {
      localStorage.removeItem(`p2_conv_${i}_${projectId}`);
      localStorage.removeItem(`p2_msgs_${i}_${projectId}`);
    }
    try {
      localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({
        stageResults: newResults,
        currentStageIdx: stageIdx,
        stageHistoryMsgs: newHistory,
        pendingDebateStart: stageIdx,  // 재로드 후 해당 스테이지 자동 시작
      }));
    } catch { /* ignore */ }
    window.location.href = `/projects/${projectId}/phase-2`;
  }, [projectId, stageHistoryMsgs]);

  // ── UI ──

  // ── View mode: sidebar 내비게이션 ──
  const viewParam = searchParams.get("view");
  if (viewParam) {
    const stageIdMap: Record<string, number> = { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5 };
    const stageId = stageIdMap[viewParam];
    const viewResult = stageId ? stageResults.find((r: StageResult) => r.stageId === stageId) : null;
    const isAssetsView = viewParam === "assets";
    const isStyleView = viewParam === "style";
    const hasData = viewResult ?? (isAssetsView && editableAssets.characters.length + editableAssets.locations.length + editableAssets.props.length > 0) ?? (isStyleView && !!conceptStyle);

    // 스테이지 토론 기록 뷰
    if (viewResult && stageId) {
      const stageIdx = stageId - 1; // stageId 1→idx 0, 2→idx 1 ...
      const viewStageObj = STAGES.find(st => st.id === stageId)!;
      const histMsgs: Msg[] = stageHistoryMsgs[stageIdx] ?? [];
      return (
        <div className={s.page}>
          <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
            {/* 헤더 */}
            <div style={{ padding: "12px 20px", borderBottom: "1px solid #1e1e2a", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: viewStageObj.color, margin: 0 }}>
                ✓ {viewStageObj.name} 토론 기록
              </h2>
              <a href={`/projects/${projectId}/phase-2`} style={{ fontSize: 12, color: "#7c6cfc", textDecoration: "none", padding: "5px 12px", border: "1px solid rgba(124,108,252,0.3)", borderRadius: 6, background: "rgba(124,108,252,0.05)" }}>
                ← 현재 단계로 돌아가기
              </a>
            </div>
            {/* 채팅 기록 + 보고서 */}
            <div ref={viewScrollRef} style={{ flex: 1, overflowY: "auto", padding: "0 0 60px" }}>
              {histMsgs.length > 0
                ? histMsgs.map((m: Msg) => <MsgBubble key={m.id} msg={m} />)
                : <div style={{ padding: "40px 20px", textAlign: "center", color: "#3a3a52", fontSize: 13 }}>토론 기록이 없습니다.</div>
              }
              {/* 인라인 보고서 */}
              <StageReportInChat
                result={viewResult}
                stage={viewStageObj}
                onNextStage={() => {
                  const nextIdx = stageIdx + 1;
                  try {
                    const saved = localStorage.getItem(`wts_phase2_${projectId}`);
                    const parsed = saved ? JSON.parse(saved) as Record<string, unknown> : {};
                    localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({
                      ...parsed,
                      currentStageIdx: nextIdx,
                      pendingDebateStart: nextIdx,
                    }));
                  } catch { /* ignore */ }
                  window.location.href = `/projects/${projectId}/phase-2`;
                }}
                onContinueDebate={() => handleResumeStageFromView(stageIdx)}
                onNewDebate={() => handleRestartStageFromView(stageIdx)}
                nextStageName={stageIdx + 1 < STAGES.length ? STAGES[stageIdx + 1].name : null}
                onReanalyze={() => handleReanalyze(stageIdx)}
                allVersions={(() => {
                  const allV = [
                    ...(stageResultHistory[stageIdx] ?? []),
                    viewResult,
                  ].sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
                  return allV.length > 1 ? allV : undefined;
                })()}
                onSelectVersion={(v) => {
                  const currentActive = stageResultsRef.current.find((r: StageResult) => r.stageId === viewResult.stageId);
                  if (currentActive && (currentActive.version ?? 1) !== (v.version ?? 1)) {
                    const filtered = (stageResultHistoryRef.current[stageIdx] ?? []).filter((r: StageResult) => (r.version ?? 1) !== (v.version ?? 1));
                    const newHist = { ...stageResultHistoryRef.current, [stageIdx]: [...filtered, currentActive] };
                    stageResultHistoryRef.current = newHist;
                    setStageResultHistory(newHist);
                  }
                  const newResults = [...stageResultsRef.current.filter((r: StageResult) => r.stageId !== viewResult.stageId), v];
                  stageResultsRef.current = newResults;
                  setStageResults(newResults);
                  try {
                    const saved = localStorage.getItem(`wts_phase2_${projectId}`);
                    const parsed = saved ? JSON.parse(saved) as Record<string, unknown> : {};
                    localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({
                      ...parsed,
                      stageResults: newResults,
                      stageResultHistory: stageResultHistoryRef.current,
                    }));
                  } catch { /* ignore */ }
                }}
              />
            </div>
          </div>
        </div>
      );
    }

    if (hasData) {
      return (
        <div className={s.page}>
          <div style={{ padding: "16px 20px", maxWidth: 900, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#c8d0e0", margin: 0 }}>
                {isAssetsView ? "에셋 리스트" : "스타일"}
              </h2>
              <a href={`/projects/${projectId}/phase-2`} style={{ fontSize: 12, color: "#7c6cfc", textDecoration: "none", padding: "5px 12px", border: "1px solid rgba(124,108,252,0.3)", borderRadius: 6, background: "rgba(124,108,252,0.05)" }}>
                ← 현재 단계로 돌아가기
              </a>
            </div>

            {isAssetsView && (() => {
              // Stage 1+2+3 데이터 병합 (우선순위: Stage 3 > Stage 1 > Stage 2)
              const s1 = stageResults.find((r: StageResult) => r.stageId === 1)?.data;
              const s2 = stageResults.find((r: StageResult) => r.stageId === 2)?.data;
              const s3 = stageResults.find((r: StageResult) => r.stageId === 3)?.data;
              const s4 = stageResults.find((r: StageResult) => r.stageId === 4)?.data;
              const s5 = stageResults.find((r: StageResult) => r.stageId === 5)?.data;

              const mergeByName = (...arrays: Record<string,string>[][]): Record<string,string>[] => {
                const seen = new Set<string>();
                const result: Record<string,string>[] = [];
                for (const arr of arrays) {
                  for (const item of arr) {
                    if (!item.name || seen.has(item.name)) continue;
                    seen.add(item.name);
                    // 같은 이름의 모든 소스 데이터 병합 (나중 배열이 우선)
                    const merged = arrays.reduce((acc, src) => {
                      const match = src.find(x => x.name === item.name);
                      return match ? { ...acc, ...match } : acc;
                    }, {} as Record<string,string>);
                    result.push(merged);
                  }
                }
                return result;
              };

              const charData = mergeByName(
                (s2?.characters as Record<string,string>[] | undefined) ?? [],
                (s1?.key_characters as Record<string,string>[] | undefined) ?? [],
                (s3?.characters as Record<string,string>[] | undefined) ?? [],
              );
              const locData = mergeByName(
                (s2?.locations as Record<string,string>[] | undefined) ?? [],
                (s1?.key_locations as Record<string,string>[] | undefined) ?? [],
                (s4?.locations as Record<string,string>[] | undefined) ?? [],
              );
              const propData = (s5?.props as Record<string,string>[] | undefined) ?? [];

              // ── 섹션 헤더 ──
              const SectionHead = ({ icon, label, color, count }: { icon: string; label: string; color: string; count: number }) => (
                <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "24px 0 10px", paddingBottom: 8, borderBottom: `1px solid ${color}20` }}>
                  <span style={{ fontSize: 15 }}>{icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color, letterSpacing: "0.5px", textTransform: "uppercase" as const }}>{label}</span>
                  <span style={{ fontSize: 11, color, background: `${color}15`, borderRadius: 99, padding: "1px 9px", fontWeight: 700 }}>{count}</span>
                </div>
              );

              // ── 컴팩트 카드 (클릭 → 모달) ──
              const CompactCard = ({ it, color, type, icon }: { it: Record<string,string>; color: string; type: "char"|"loc"|"prop"; icon?: string }) => {
                const preview = it.face || it.appearance || it.visual || it.personality || it.story_role || "";
                const sub = type === "char"
                  ? [it.gender, it.age, it.build].filter(Boolean).join(" · ")
                  : type === "loc"
                  ? it.location_type || it.type || ""
                  : it.type || "";
                return (
                  <div onClick={() => setAssetModal({ type, item: it })} style={{
                    background: "#0f0f1c", borderRadius: 10, overflow: "hidden", marginBottom: 8,
                    border: `1px solid ${color}1e`, cursor: "pointer", transition: "border-color 0.2s",
                  }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = `${color}50`)}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = `${color}1e`)}
                  >
                    <div style={{ padding: "9px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                      {type === "char" ? (
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: `${color}20`, border: `1.5px solid ${color}45`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color, flexShrink: 0 }}>
                          {(it.name ?? "?").slice(0, 2)}
                        </div>
                      ) : (
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}15`, border: `1px solid ${color}35`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{icon}</div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{it.name}</span>
                          {it.role && <span style={{ fontSize: 10, color, background: `${color}15`, padding: "1px 6px", borderRadius: 99 }}>{it.role}</span>}
                          {type !== "char" && sub && <span style={{ fontSize: 10, color: "#5a5a7a" }}>{sub}</span>}
                        </div>
                        {type === "char" && sub && <div style={{ fontSize: 11, color: "#4a4a6a", marginTop: 1 }}>{sub}</div>}
                        {preview && (
                          <div style={{ fontSize: 11, color: "#4a4a68", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, maxWidth: "100%" }}>
                            {preview.slice(0, 60)}{preview.length > 60 ? "…" : ""}
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: "#2a2a40", flexShrink: 0 }}>›</span>
                    </div>
                  </div>
                );
              };

              // 이름 기준 resolved 목록
              const resolve = (names: string[], items: Record<string,string>[]) => {
                const allNames = [...new Set([...names, ...items.map(it => it.name).filter(Boolean)])];
                return allNames.map(n => items.find(it => it.name === n) ?? { name: n });
              };
              const chars   = resolve(editableAssets.characters, charData);
              const locs    = resolve(editableAssets.locations,  locData);
              const propRes = resolve(editableAssets.props,      propData);

              return (
                <div>
                  {/* 등장인물 */}
                  <SectionHead icon="👤" label="등장인물" color="#fb923c" count={chars.length} />
                  {chars.length === 0
                    ? <div style={{ fontSize: 12, color: "#2e2e48", padding: "8px 0 16px" }}>(없음)</div>
                    : chars.map((it, i) => <CompactCard key={i} it={it} color="#fb923c" type="char" />)
                  }
                  {/* 장소 */}
                  <SectionHead icon="🗺" label="장소" color="#a78bfa" count={locs.length} />
                  {locs.length === 0
                    ? <div style={{ fontSize: 12, color: "#2e2e48", padding: "8px 0 16px" }}>(없음)</div>
                    : locs.map((it, i) => {
                        const locType = it.location_type || it.type || "";
                        const icon = /야외|거리|공원|산|바다/.test(locType) ? "🌿" : /건물|빌딩|학교|병원/.test(locType) ? "🏢" : "🏠";
                        return <CompactCard key={i} it={it} color="#a78bfa" type="loc" icon={icon} />;
                      })
                  }
                  {/* 소품 */}
                  <SectionHead icon="🎒" label="소품·장비" color="#e879f9" count={propRes.length} />
                  {propRes.length === 0
                    ? <div style={{ fontSize: 12, color: "#2e2e48", padding: "8px 0 16px" }}>(없음)</div>
                    : propRes.map((it, i) => <CompactCard key={i} it={it} color="#e879f9" type="prop" icon="🎒" />)
                  }
                </div>
              );
            })()}

            {isStyleView && conceptStyle && (
              <div style={{ background: "#0e0e1a", border: "1px solid #f59e0b40", borderRadius: 10, padding: "16px 18px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 8 }}>확정된 스타일 프롬프트</div>
                <div style={{ fontSize: 13, color: "#eeeef5", lineHeight: 1.7, fontFamily: "monospace" }}>{conceptStyle}</div>
                {styleTestImages.length > 0 && (
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" as const }}>
                    {styleTestImages.map((url, i) => (
                      <img key={i} src={url} alt={`스타일 테스트 ${i+1}`} style={{ height: 150, borderRadius: 8, objectFit: "cover", border: "1px solid #2a2a3d" }} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }
  }

  // localStorage 복원 전 — 빈 화면으로 대기 (init 화면 깜빡임 방지)
  if (!appReady) {
    return <div className={s.page} />;
  }

  if (debatePhase === "idle" && stageResults.length === 0) {
    return (
      <div className={s.page}>
        <div className={s.formWrap}>
          <h1 className={s.formTitle}>Phase 2 — 세계관 & 스토리 설계</h1>
          <p className={s.formDesc}>6단계 순차 토론으로 세계관·시놉시스·관계·인물·장소·구체화를 함께 완성합니다. 언제든 의견을 입력할 수 있습니다.</p>
          {apiError && <div style={{ background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.3)", borderRadius:10, padding:"10px 16px", marginBottom:16, fontSize:13, color:"#f87171" }}>⚠ {apiError}</div>}
          <div className={s.formCard}>
            <div className={s.prereqNote}>Phase 1 기획 데이터를 자동으로 불러옵니다.</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, margin:"12px 0" }}>
              {STAGES.map(st => (
                <div key={st.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:"#1a1a26", borderRadius:8 }}>
                  <span style={{ fontSize:12, fontWeight:800, color:st.color, minWidth:20 }}>{st.id}</span>
                  <span style={{ fontSize:13, color:"#c8d0dc", fontWeight:600 }}>{st.name}</span>
                  <span style={{ fontSize:11, color:"#4a4a6a", marginLeft:"auto" }}>{st.topic}</span>
                </div>
              ))}
            </div>
            <button className={s.btnStart} onClick={() => { void runDebate(0); }}>✦ 1단계부터 토론 시작</button>
          </div>
        </div>
      </div>
    );
  }

  const stage = STAGES[currentStageIdx] ?? STAGES[STAGES.length - 1];

  return (
    <div className={s.page}>
      <div className={s.chatLayout}>
        {/* Stage progress header */}
        <div className={s.chatHeader}>
          <div className={s.stepBar} style={{ padding:"0", background:"transparent", border:"none", flex:1 }}>
            {STAGES.map((st, idx) => {
              const isDone = stageResults.some((r: StageResult) => r.stageId === st.id);
              const isActive = idx === currentStageIdx && debatePhase !== "done" && stylePhase === "idle";
              const versionCount = isDone
                ? (stageResultHistory[idx] ?? []).length + 1
                : 0;
              return (
                <div
                  key={st.id}
                  className={`${s.stepItem} ${isDone ? s.stepDone : ""} ${isActive ? s.stepActive : ""}`}
                  onClick={isDone ? () => setVersionHistoryModal({ stageIdx: idx }) : undefined}
                  style={{ cursor: isDone ? "pointer" : "default", userSelect:"none" as const }}
                >
                  <div className={s.stepDot} style={isDone || isActive ? { background:st.color } : {}} />
                  <span className={s.stepLabel} style={isDone || isActive ? { color:st.color } : {}}>{st.name}</span>
                  {isDone && versionCount > 1 && (
                    <span style={{ fontSize:9, fontWeight:800, color:st.color, background:`${st.color}22`,
                                   border:`1px solid ${st.color}40`, padding:"1px 5px",
                                   borderRadius:99, marginLeft:2, lineHeight:1.4 }}>
                      v{versionCount}
                    </span>
                  )}
                </div>
              );
            })}
            {/* 에셋 리스트 단계 표시기 */}
            {assetListPhase !== "idle" && (
              <div className={s.stepItem} style={{ opacity: assetListPhase === "confirmed" ? 0.5 : 1 }}>
                <div className={s.stepDot} style={{ background: assetListPhase === "confirmed" ? "#34d399" : "#fbbf24", boxShadow: assetListPhase !== "confirmed" ? "0 0 6px #fbbf24" : "none" }} />
                <span className={s.stepLabel} style={{ color: assetListPhase === "confirmed" ? "#34d399" : "#fbbf24" }}>
                  {assetListPhase === "confirmed" ? "✓ 에셋 리스트" : "📋 에셋 리스트"}
                </span>
              </div>
            )}
            {/* 스타일 정의 단계 표시기 */}
            {stylePhase !== "idle" && (
              <div className={s.stepItem} style={{ opacity: stylePhase === "confirmed" ? 0.5 : 1 }}>
                <div className={s.stepDot} style={{ background: stylePhase === "confirmed" ? "#34d399" : "#f59e0b", boxShadow: stylePhase !== "confirmed" ? "0 0 6px #f59e0b" : "none" }} />
                <span className={s.stepLabel} style={{ color: stylePhase === "confirmed" ? "#34d399" : "#f59e0b" }}>
                  {stylePhase === "confirmed" ? "✓ 스타일" : "🎨 스타일 정의"}
                </span>
              </div>
            )}
          </div>
          {/* 이미지 컨셉 회의 아이템 진행 표시기 */}
          {imageSessionPhase !== "idle" && imageItems.length > 0 && (
            <div style={{ display: "flex", gap: 8, padding: "8px 16px", overflowX: "auto", flexShrink: 0 }}>
              {imageItems.map((item: ImageItem, i: number) => {
                const isActive = i === currentImageItemIdx;
                const typeIcon = item.type === "character" ? "👤" : item.type === "location" ? "🗺" : "🎒";
                const typeLabel = item.type === "character" ? "캐릭터" : item.type === "location" ? "장소" : "소품";
                const activeColor = "#7c6cfc";
                const doneColor = "#34d399";
                const col = isActive ? activeColor : item.confirmed ? doneColor : "#3a3a5a";
                return (
                  <div key={i} style={{
                    display: "flex", flexDirection: "column" as const, alignItems: "flex-start", gap: 2,
                    padding: "8px 14px", borderRadius: 10, flexShrink: 0, minWidth: 80,
                    background: isActive ? "rgba(124,108,252,0.15)" : item.confirmed ? "rgba(52,211,153,0.08)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${isActive ? "#7c6cfc60" : item.confirmed ? "#34d39940" : "#2a2a3d"}`,
                    boxShadow: isActive ? "0 0 0 1px rgba(124,108,252,0.2)" : "none",
                    transition: "all 0.2s",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ fontSize: 13 }}>{typeIcon}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: isActive ? "#e2e8f0" : item.confirmed ? doneColor : "#6a6a8a", whiteSpace: "nowrap" as const }}>
                        {item.confirmed ? "✓ " : isActive ? "" : ""}{item.name}
                      </span>
                      {isActive && imageRoundNum > 1 && (
                        <span style={{ fontSize: 10, color: "#7c6cfc", background: "rgba(124,108,252,0.15)", padding: "1px 6px", borderRadius: 99 }}>R{imageRoundNum}</span>
                      )}
                    </div>
                    <span style={{ fontSize: 10, color: col, opacity: 0.7, paddingLeft: 18 }}>{isActive ? "▶ 진행 중" : item.confirmed ? "완료" : typeLabel}</span>
                  </div>
                );
              })}
            </div>
          )}
          <button className={s.btnRestart} onClick={handleRestartNew} style={{ flexShrink:0, marginLeft:12 }}>↺ 초기화</button>
        </div>

        {/* 아젠다 진행 패널 — 토론 중일 때만 표시 */}
        {debatePhase === "running" && (() => {
          const currentStageId = STAGES[currentStageIdx]?.id;
          const stageAgendaItems: AgendaItem[] = activeStageAgenda.length > 0 ? activeStageAgenda : (STAGE_AGENDA[currentStageId] ?? []);
          const minTurnsUI = MIN_TURNS_BY_STAGE[currentStageId] ?? MIN_TURNS_PER_TOPIC_P2;
          const isSynStep = currentStageId === 2;
          const coveredCount = stageAgendaItems.filter((i: AgendaItem) => coveredAgendaIds.includes(i.id)).length;
          const totalCount = stageAgendaItems.length;

          // 항목 상태
          const itemStatus = (item: AgendaItem): "done" | "active" | "seen" | "none" => {
            if (coveredAgendaIds.includes(item.id)) return "done";
            const t = agendaTurnCounts[item.id] ?? 0;
            if (t >= Math.ceil(minTurnsUI * 0.5)) return "active";
            if (t > 0) return "seen";
            return "none";
          };
          const statusColor: Record<string, string> = {
            done: "#34d399", active: "#7c6cfc", seen: "#3d3d60", none: "#1a1a2e",
          };
          const statusBorder: Record<string, string> = {
            done: "rgba(52,211,153,0.5)", active: "rgba(124,108,252,0.5)", seen: "rgba(61,61,96,0.6)", none: "rgba(255,255,255,0.05)",
          };

          // "이름 — 필드" 패턴으로 그룹화
          const groupMap = new Map<string, AgendaItem[]>();
          for (const item of stageAgendaItems) {
            const dashIdx = item.label.indexOf(" — ");
            const gk = dashIdx >= 0 ? item.label.slice(0, dashIdx) : "__flat__";
            if (!groupMap.has(gk)) groupMap.set(gk, []);
            groupMap.get(gk)!.push(item);
          }
          const isGrouped = !groupMap.has("__flat__") && groupMap.size > 0;

          return (
            <div style={{ background: "rgba(8,8,18,0.7)", borderBottom: "1px solid rgba(99,102,241,0.1)" }}>

              {isGrouped ? (
                /* ━━━ 그룹 모드 (캐릭터·장소별) ━━━ */
                <>
                  {/* 요약 헤더 — 클릭으로 카드 펼침 */}
                  <div
                    onClick={() => setAgendaExpanded((v: boolean) => !v)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", cursor: "pointer", userSelect: "none" }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#a5b4fc", flexShrink: 0 }}>
                      {STAGES[currentStageIdx]?.name ?? "토론"}
                    </span>
                    {/* 엔티티별 이름 + 미니 진행바 */}
                    <div style={{ display: "flex", gap: 8, flex: 1, alignItems: "center", overflowX: "auto" }}>
                      {Array.from(groupMap.entries()).map(([gk, items]) => {
                        const done = items.filter((i: AgendaItem) => coveredAgendaIds.includes(i.id)).length;
                        const pct = items.length > 0 ? (done / items.length) * 100 : 0;
                        const allDone = done === items.length;
                        return (
                          <div key={gk} style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
                            padding: "3px 10px 3px 8px", borderRadius: 8,
                            background: allDone ? "rgba(52,211,153,0.07)" : "rgba(99,102,241,0.08)",
                            border: `1px solid ${allDone ? "rgba(52,211,153,0.2)" : "rgba(99,102,241,0.15)"}`,
                          }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: allDone ? "#34d399" : "#c4c4e8", whiteSpace: "nowrap" as const }}>
                              {allDone ? "✓ " : ""}{gk}
                            </span>
                            <div style={{ width: 36, height: 3, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden", flexShrink: 0 }}>
                              <div style={{
                                height: "100%", borderRadius: 99, transition: "width 0.4s",
                                background: allDone ? "#34d399" : pct > 0 ? "#7c6cfc" : "transparent",
                                width: `${pct}%`,
                              }} />
                            </div>
                            <span style={{ fontSize: 10, color: allDone ? "#34d399" : "#4a4a6a" }}>{done}/{items.length}</span>
                          </div>
                        );
                      })}
                    </div>
                    <span style={{ fontSize: 11, color: coveredCount === totalCount ? "#34d399" : "#4a4a6a", fontWeight: 700, flexShrink: 0 }}>
                      {coveredCount}/{totalCount}
                    </span>
                    <span style={{ fontSize: 9, color: "#2e2e4a", flexShrink: 0 }}>{agendaExpanded ? "▲" : "▼"}</span>
                  </div>

                  {/* 펼침: 엔티티별 필드 카드 */}
                  {agendaExpanded && (
                    <div style={{ display: "flex", gap: 10, padding: "0 14px 12px", overflowX: "auto" }}>
                      {Array.from(groupMap.entries()).map(([gk, items]) => {
                        const done = items.filter((i: AgendaItem) => coveredAgendaIds.includes(i.id)).length;
                        const allDone = done === items.length;
                        return (
                          <div key={gk} style={{
                            flexShrink: 0, minWidth: 170,
                            borderRadius: 10, overflow: "hidden",
                            border: `1px solid ${allDone ? "rgba(52,211,153,0.25)" : "rgba(99,102,241,0.18)"}`,
                            background: allDone ? "rgba(52,211,153,0.05)" : "rgba(18,18,32,0.8)",
                          }}>
                            {/* 카드 헤더: 이름 크게 */}
                            <div style={{
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              padding: "10px 12px 8px",
                              background: allDone ? "rgba(52,211,153,0.08)" : "rgba(99,102,241,0.07)",
                              borderBottom: `1px solid ${allDone ? "rgba(52,211,153,0.15)" : "rgba(99,102,241,0.12)"}`,
                            }}>
                              <span style={{ fontSize: 14, fontWeight: 800, color: allDone ? "#34d399" : "#e2e8f0" }}>{gk}</span>
                              <span style={{ fontSize: 11, color: allDone ? "#34d399" : "#4a4a6a", marginLeft: 8 }}>{done}/{items.length}</span>
                            </div>
                            {/* 필드 목록 */}
                            <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column" as const, gap: 4 }}>
                              {items.map((item: AgendaItem) => {
                                const st = itemStatus(item);
                                const subLabel = item.label.includes(" — ") ? item.label.split(" — ")[1] : item.label;
                                return (
                                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <div style={{
                                      width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
                                      background: statusColor[st],
                                      border: `1px solid ${statusBorder[st]}`,
                                      transition: "background 0.3s",
                                    }} />
                                    <span style={{
                                      fontSize: 11,
                                      color: st === "done" ? "#34d399" : st === "active" ? "#a5b4fc" : st === "seen" ? "#3d3d60" : "#2a2a40",
                                      fontWeight: st === "done" ? 700 : 400,
                                    }}>{subLabel}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                /* ━━━ 플랫 모드 (스테이지 1·2) ━━━ */
                <>
                  <div
                    onClick={() => setAgendaExpanded((v: boolean) => !v)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", cursor: "pointer", userSelect: "none" }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#a5b4fc" }}>{STAGES[currentStageIdx]?.name ?? "토론"}</span>
                    <div style={{ flex: 1, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 99, background: coveredCount === totalCount ? "#34d399" : "#7c6cfc",
                        width: totalCount > 0 ? `${(coveredCount / totalCount) * 100}%` : "0%", transition: "width 0.4s" }} />
                    </div>
                    <span style={{ fontSize: 11, color: coveredCount === totalCount ? "#34d399" : "#4a4a6a", fontWeight: 700 }}>{coveredCount}/{totalCount}</span>
                    <span style={{ fontSize: 9, color: "#2e2e4a" }}>{agendaExpanded ? "▲" : "▼"}</span>
                  </div>
                  {agendaExpanded && (
                    <div style={{ display: "flex", gap: 4, padding: "0 14px 8px", flexWrap: "wrap" as const }}>
                      {stageAgendaItems.map((item: AgendaItem) => {
                        const st = itemStatus(item);
                        const isActive = isSynStep && (
                          (item.id === "step_learning" && synopsisStep === "learning") ||
                          (item.id === "step_persona"  && synopsisStep === "persona") ||
                          (item.id === "step_logline"  && synopsisStep === "logline") ||
                          (item.id === "step_synopsis" && (synopsisStep === "completing" || synopsisStep === "completing_wait"))
                        );
                        return (
                          <div key={item.id} style={{
                            display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 99, fontSize: 10,
                            background: st === "done" ? "rgba(52,211,153,0.1)" : isActive ? "rgba(52,211,153,0.06)" : st === "active" ? "rgba(124,108,252,0.1)" : "rgba(255,255,255,0.02)",
                            border: `1px solid ${st === "done" ? "rgba(52,211,153,0.3)" : isActive ? "rgba(52,211,153,0.2)" : st === "active" ? "rgba(124,108,252,0.3)" : "rgba(255,255,255,0.05)"}`,
                            color: st === "done" ? "#34d399" : isActive ? "#6ee7b7" : st === "active" ? "#a5b4fc" : "#2a2a40",
                            fontWeight: st === "done" || isActive ? 700 : 400,
                          }}>
                            <span style={{ fontSize: 8 }}>{st === "done" ? "✓" : isActive ? "▶" : "·"}</span>
                            <span>{item.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* 블랙리스트 태그 — 항상 표시 */}
              {rejectedItems.length > 0 && (
                <div style={{ display: "flex", gap: 4, padding: "0 14px 6px", flexWrap: "wrap" as const }}>
                  {rejectedItems.map((w: string) => (
                    <span key={w} title="클릭해서 차단 해제"
                      onClick={(e: React.MouseEvent) => { e.stopPropagation(); const next = rejectedItems.filter((x: string) => x !== w); setRejectedItems(next); rejectedItemsRef.current = next; if (next.length === 0) localStorage.removeItem(`p2_rejected_${projectId}`); }}
                      style={{ fontSize: 9, padding: "2px 7px", borderRadius: 99, cursor: "pointer",
                        background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.18)", color: "#f87171" }}>
                      🚫 {w}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* 모델 선택 (토론 idle 상태일 때) */}
        {debatePhase === "idle" && (
          <div style={{ display: "flex", gap: 6, padding: "8px 16px", background: "rgba(15,20,40,0.4)", borderBottom: "1px solid rgba(99,102,241,0.1)", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "#4a4a6a", marginRight: 4 }}>모델:</span>
            {DEBATE_MODELS_P2.map((m) => (
              <button key={m.value} onClick={() => setDebateModel(m.value)} style={{
                padding: "3px 10px", borderRadius: 8, fontSize: 11, cursor: "pointer",
                border: `1px solid ${debateModel === m.value ? "#7c6cfc" : "#2a2a3d"}`,
                background: debateModel === m.value ? "rgba(124,108,252,0.15)" : "transparent",
                color: debateModel === m.value ? "#a5b4fc" : "#4a4a6a",
              }}>
                {m.label} <span style={{ opacity: 0.6, fontSize: 10 }}>{m.desc}</span>
              </button>
            ))}
          </div>
        )}

        {apiError && (
          <div style={{ background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.3)", margin:"8px 16px", borderRadius:8, padding:"8px 14px", fontSize:13, color:"#f87171" }}>
            ⚠ {apiError}
          </div>
        )}

        <div ref={chatBodyRef} className={s.chatBody}>
          {/* ── 이전 완료 단계 대화 기록 (단계 구분선 포함) ── */}
          {STAGES.slice(0, currentStageIdx).map((st, si) => {
            const histMsgs = stageHistoryMsgs[si] ?? [];
            if (histMsgs.length === 0) return null;
            return (
              <div key={si}>
                {/* 단계 구분선 */}
                <div style={{ display:"flex", alignItems:"center", gap:8, margin:"6px 0 10px", opacity:0.55 }}>
                  <div style={{ flex:1, height:1, background:"#1e1e2a" }} />
                  <span style={{ fontSize:10, fontWeight:700, color:st.color, letterSpacing:"0.06em", whiteSpace:"nowrap" as const }}>
                    {st.name} — 완료
                  </span>
                  <div style={{ flex:1, height:1, background:"#1e1e2a" }} />
                </div>
                {/* 해당 단계 메시지들 (투명도 낮춰서 '과거' 느낌) */}
                <div style={{ opacity:0.65 }}>
                  {histMsgs.map((m: Msg) => <MsgBubble key={m.id} msg={m} />)}
                </div>
                {/* 단계 완료 구분선 */}
                <div style={{ display:"flex", alignItems:"center", gap:8, margin:"10px 0 16px", opacity:0.4 }}>
                  <div style={{ flex:1, height:1, background:"#1e1e2a" }} />
                  <span style={{ fontSize:10, color:"#34d399", fontWeight:700 }}>✓ 단계 완료</span>
                  <div style={{ flex:1, height:1, background:"#1e1e2a" }} />
                </div>
              </div>
            );
          })}

          {msgs.map((m: Msg) => <MsgBubble key={m.id} msg={m} onReply={debatePhase === "running" && m.agent !== "user" ? (msg) => {
            const ag = AGENTS[msg.agent];
            setReplyTo({ msg, agentLabel: ag?.label ?? msg.agent, preview: msg.text.slice(0, 60).trim() });
            setTimeout(() => chatInputRef.current?.focus(), 50);
          } : undefined} />)}

          {/* ── 새 단계 시작: 기존 토론 내용 이어하기/새로 시작 선택 UI ── */}
          {newStageChoice && (
            <div style={{
              margin: "12px 0",
              background: "#0e0e1a",
              border: "1px solid rgba(124,108,252,0.35)",
              borderRadius: 14,
              padding: "20px 18px",
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#a5b4fc", marginBottom: 6 }}>
                💬 기존 토론 내용이 있습니다
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16, lineHeight: 1.6 }}>
                이전에 저장된 &apos;{STAGES[newStageChoice.stageIdx]?.name}&apos; 토론 내용이 있습니다.
                이어서 진행할까요, 아니면 처음부터 새로 시작할까요?
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => {
                    const { stageIdx, transcript, msgs: savedMsgs } = newStageChoice;
                    setNewStageChoice(null);
                    resumeDataRef.current = { transcript, msgs: savedMsgs };
                    setCurrentStageIdx(stageIdx);
                    void runDebate(stageIdx);
                  }}
                  style={{
                    flex: 1,
                    background: "rgba(124,108,252,0.15)",
                    border: "1px solid rgba(124,108,252,0.4)",
                    borderRadius: 10,
                    color: "#a5b4fc",
                    fontSize: 13,
                    fontWeight: 700,
                    padding: "11px 16px",
                    cursor: "pointer",
                  }}
                >
                  이어서 하기 →
                </button>
                <button
                  onClick={() => {
                    const { stageIdx } = newStageChoice;
                    setNewStageChoice(null);
                    resumeDataRef.current = null;
                    try {
                      localStorage.removeItem(`p2_conv_${stageIdx}_${projectId}`);
                      localStorage.removeItem(`p2_msgs_${stageIdx}_${projectId}`);
                    } catch { /* ignore */ }
                    setMsgs([]);
                    convRef.current = [];
                    setCurrentStageIdx(stageIdx);
                    void runDebate(stageIdx);
                  }}
                  style={{
                    flex: 1,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid #2a2a3d",
                    borderRadius: 10,
                    color: "#94a3b8",
                    fontSize: 13,
                    fontWeight: 700,
                    padding: "11px 16px",
                    cursor: "pointer",
                  }}
                >
                  새로 시작하기
                </button>
              </div>
            </div>
          )}

          {/* ── 시놉시스 로그라인 선택 UI ── */}
          {synopsisStep === "logline" && synopsisLoglines.length > 0 && (
            <div style={{ margin:"12px 0", background:"#0e0e1a", border:"1px solid #34d39940", borderRadius:14, padding:"18px 16px" }}>
              <div style={{ fontSize:12, fontWeight:800, color:"#34d399", letterSpacing:"0.06em", marginBottom:4 }}>
                🎯 로그라인 대결 — 하나를 선택해주세요
              </div>
              <div style={{ fontSize:11, color:"#64748b", marginBottom:14 }}>
                클릭하면 해당 로그라인으로 시놉시스를 완성합니다
              </div>
              <div style={{ display:"flex", flexDirection:"column" as const, gap:8 }}>
                {synopsisLoglines.map((line, i) => (
                  <button key={i}
                    onClick={() => {
                      if (!loglineResolverRef.current) return;
                      const resolver = loglineResolverRef.current;
                      loglineResolverRef.current = null;
                      resolver(line);
                    }}
                    style={{
                      background: selectedLogline === line ? "#34d39918" : "#12121e",
                      border: selectedLogline === line ? "1px solid #34d399" : "1px solid #1e2a1e",
                      borderRadius:10, padding:"12px 14px", cursor:"pointer",
                      textAlign:"left" as const, color:"#e2e8f0", fontSize:13, lineHeight:1.65,
                      transition:"all 0.15s",
                    }}
                  >
                    <span style={{ fontSize:11, fontWeight:800, color:"#34d399", marginRight:8 }}>{i+1}.</span>
                    {line}
                  </button>
                ))}
              </div>
              <div style={{ marginTop:12, fontSize:11, color:"#4a5568" }}>
                또는 채팅창에 직접 로그라인을 입력해도 됩니다
              </div>
            </div>
          )}

          {/* ── Step 4 사용자 개입 대기 UI ── */}
          {synopsisStep === "completing_wait" && (
            <div style={{ margin:"12px 0", background:"#0e0e1a", border:"1px solid rgba(124,108,252,0.3)", borderRadius:14, padding:"16px" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:800, color:"#a5b4fc", letterSpacing:"0.06em", marginBottom:4 }}>
                    💬 의견이 있으면 지금 입력하세요
                  </div>
                  <div style={{ fontSize:11, color:"#64748b" }}>
                    채팅창에 입력하거나 {step4CountDown > 0 ? `${step4CountDown}초 후` : "지금"} 다음 에이전트로 자동 진행됩니다
                  </div>
                </div>
                <button
                  onClick={() => { if (step4ProceedRef.current) { step4ProceedRef.current(); step4ProceedRef.current = null; } }}
                  style={{
                    flexShrink:0, background:"linear-gradient(135deg,#7c6cfc,#a78bfa)",
                    border:"none", borderRadius:10, color:"#fff", fontSize:13, fontWeight:700,
                    padding:"10px 20px", cursor:"pointer", whiteSpace:"nowrap" as const,
                  }}>
                  다음 에이전트 → {step4CountDown > 0 ? `(${step4CountDown})` : ""}
                </button>
              </div>
            </div>
          )}

          {/* ── 스테이지 완료 인라인 보고서 ── */}
          {debatePhase === "confirmed" && stageResults.length > 0 && imageSessionPhase === "idle" && (() => {
            const latestResult = stageResults[stageResults.length - 1];
            const stageObj = STAGES.find(st => st.id === latestResult.stageId) ?? STAGES[currentStageIdx];
            // latestResult.stageId 기준으로 완료된 스테이지 인덱스 계산 (currentStageIdx 오프셋 버그 방지)
            const completedStageIdx = STAGES.findIndex(s => s.id === latestResult.stageId);
            const resolvedIdx = completedStageIdx >= 0 ? completedStageIdx : currentStageIdx;
            const nextStageName = resolvedIdx + 1 < STAGES.length ? STAGES[resolvedIdx + 1].name : null;
            // 버전 관리: 이전 버전들 + 현재 버전을 버전 번호 순 정렬
            const allVersionsForStage = [
              ...(stageResultHistory[resolvedIdx] ?? []),
              latestResult,
            ].sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
            return (
              <StageReportInChat
                result={latestResult}
                stage={stageObj}
                onNextStage={() => handleNextStage(resolvedIdx)}
                onContinueDebate={() => {
                  // 이전 토론 컨텍스트 복원 후 이어서 토론
                  const histMsgs = stageHistoryMsgs[resolvedIdx] ?? msgsRef.current;
                  if (histMsgs.length > 0) {
                    const trans = histMsgs
                      .filter((m: Msg) => !m.streaming && m.text)
                      .map((m: Msg) => `[${AGENTS[m.agent as AgentId]?.label ?? "사용자"}]: ${m.text}`);
                    resumeDataRef.current = { transcript: trans, msgs: histMsgs };
                  }
                  setCurrentStageIdx(resolvedIdx); // 확정 버튼이 올바른 stageIdx 사용하도록 동기화
                  runningRef.current = false;
                  abortRef.current = false;
                  void runDebate(resolvedIdx);
                }}
                nextStageName={nextStageName}
                onReanalyze={async () => { await handleReanalyze(resolvedIdx); handleNextStage(resolvedIdx); }}
                allVersions={allVersionsForStage.length > 1 ? allVersionsForStage : undefined}
                onSelectVersion={(v) => {
                  // 현재 활성 버전 → history로 이동, 선택 버전 → active로 이동
                  const currentActive = stageResultsRef.current.find((r: StageResult) => r.stageId === latestResult.stageId);
                  if (currentActive && (currentActive.version ?? 1) !== (v.version ?? 1)) {
                    const filtered = (stageResultHistoryRef.current[resolvedIdx] ?? []).filter((r: StageResult) => (r.version ?? 1) !== (v.version ?? 1));
                    const newHist = { ...stageResultHistoryRef.current, [resolvedIdx]: [...filtered, currentActive] };
                    stageResultHistoryRef.current = newHist;
                    setStageResultHistory(newHist);
                  }
                  const newResults = [...stageResultsRef.current.filter((r: StageResult) => r.stageId !== latestResult.stageId), v];
                  stageResultsRef.current = newResults;
                  setStageResults(newResults);
                  try {
                    const saved = localStorage.getItem(`wts_phase2_${projectId}`);
                    const parsed = saved ? JSON.parse(saved) as Record<string, unknown> : {};
                    localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({
                      ...parsed,
                      stageResults: newResults,
                      stageResultHistory: stageResultHistoryRef.current,
                    }));
                  } catch { /* ignore */ }
                }}
              />
            );
          })()}

          {/* ── 4개 이미지 그리드 (selecting 단계) ── */}
          {imageSessionPhase === "selecting" && imageConcepts.length > 0 && (
            <div style={{ padding: "16px", borderTop: "1px solid #1e1e2a" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#7c6cfc", marginBottom: 10, letterSpacing: "0.05em" }}>
                🖼️ {imageItems[currentImageItemIdx]?.name} 시안 — 라운드 {imageRoundNum}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {imageConcepts.map((concept: ImageConcept) => {
                  const recCount = concept.recommendations.length;
                  return (
                    <div key={concept.label} style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: "2px solid #2a2a3d", background: "#0d0d1a" }}>
                      {/* 라벨 배지 */}
                      <div style={{ position: "absolute", top: 8, left: 8, zIndex: 1, background: "#7c6cfc", color: "#fff", fontSize: 12, fontWeight: 800, padding: "2px 8px", borderRadius: 6 }}>
                        {concept.label}안
                      </div>
                      {/* 추천 카운트 배지 */}
                      {recCount > 0 && (
                        <div style={{ position: "absolute", top: 8, right: 8, zIndex: 1, background: "rgba(251,191,36,0.9)", color: "#000", fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 6 }}>
                          ⭐ {recCount}
                        </div>
                      )}
                      {/* 이미지 */}
                      {concept.imageUrl
                        ? <img src={concept.imageUrl} alt={`${concept.label}안`} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
                        : <div style={{ width: "100%", aspectRatio: "1", background: "#1a1a26", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#4a4a6a" }}>
                            {concept.error
                          ? <span style={{ padding: "0 8px", textAlign: "center", color: "#f87171" }}>
                              ⚠ 생성 실패<br/>
                              <span style={{ fontSize: 9, color: "#9ca3af", lineHeight: 1.3, display: "block", marginTop: 4 }}>
                                {concept.error.slice(0, 120)}
                              </span>
                            </span>
                          : "⏳ 생성 중"}
                          </div>
                      }
                      {/* 방향 설명 */}
                      <div style={{ padding: "6px 8px", fontSize: 10, color: "#7878a0", lineHeight: 1.4, maxHeight: 48, overflow: "hidden" }}>
                        {concept.direction.slice(0, 80)}...
                      </div>
                      {/* 추천 에이전트 이름들 */}
                      {concept.recommendations.length > 0 && (
                        <div style={{ padding: "0 8px 6px", display: "flex", gap: 4, flexWrap: "wrap" as const }}>
                          {concept.recommendations.map((r: { agentId: AgentId; reason: string }, i: number) => (
                            <span key={i} style={{ fontSize: 10, color: AGENTS[r.agentId].color, background: AGENTS[r.agentId].bg, padding: "1px 5px", borderRadius: 4 }}>
                              {AGENTS[r.agentId].label}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* 선택 버튼들 */}
                      <div style={{ padding: "6px 8px 10px", display: "flex", gap: 6 }}>
                        <button
                          onClick={() => handleNextRound(concept.label)}
                          style={{ flex: 1, background: "rgba(124,108,252,0.1)", border: "1px solid rgba(124,108,252,0.4)", borderRadius: 6, color: "#7c6cfc", fontSize: 11, fontWeight: 700, padding: "6px 0", cursor: "pointer" }}>
                          이 방향으로 →
                        </button>
                        <button
                          onClick={() => handleFinalConfirm(concept.label)}
                          style={{ flex: 1, background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.4)", borderRadius: 6, color: "#34d399", fontSize: 11, fontWeight: 700, padding: "6px 0", cursor: "pointer" }}>
                          ✓ 최종 확정
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* 커스텀 방향 입력 */}
              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <textarea
                  value={imageCustomDir}
                  onChange={(e: { target: HTMLTextAreaElement }) => setImageCustomDir(e.target.value)}
                  placeholder="직접 방향 입력 (선택 안 하고 새 방향 제시) — 비워두면 선택한 시안 방향으로 진행"
                  rows={1}
                  style={{ flex: 1, background: "#12121c", border: "1px solid #2a2a3d", borderRadius: 6, color: "#eeeef5", fontSize: 12, padding: "8px 10px", resize: "none", fontFamily: "inherit" }}
                />
              </div>
              {imageGenError && <div style={{ fontSize: 12, color: "#f87171", marginTop: 6 }}>⚠ {imageGenError}</div>}
            </div>
          )}

          {/* generating: 4개 생성 중 표시 */}
          {imageSessionPhase === "generating" && (
            <div style={{ padding: "16px", borderTop: "1px solid #1e1e2a" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24", marginBottom: 10 }}>
                ⏳ {imageItems[currentImageItemIdx]?.name} 시안 4개 생성 중...
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {(["A","B","C","D"] as const).map(label => {
                  const c = imageConcepts.find((x: ImageConcept) => x.label === label);
                  return (
                    <div key={label} style={{ borderRadius: 8, background: "#1a1a26", border: "1px solid #2a2a3d", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#4a4a6a", flexDirection: "column" as const, gap: 6 }}>
                      <span style={{ fontSize: 16, fontWeight: 800, color: "#7c6cfc" }}>{label}안</span>
                      {c?.imageUrl ? <span style={{ color: "#34d399", fontSize: 11 }}>✓ 완료</span> : <ThinkingDots />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── 캐릭터 갤러리 고정 바: 채팅창 아래, 입력창 위 ── */}
        {(() => {
          const s3 = stageResults.find((r: StageResult) => r.stageId === 3);
          if (!s3) return null;
          const chars = Array.isArray(s3.data.characters) ? s3.data.characters as Record<string,string>[] : [];
          if (chars.length === 0) return null;
          const syncedChars = editableAssets.characters;
          const newInSynopsis = syncedChars.filter(n => !chars.some(c => c.name === n));
          return (
            <div style={{ flexShrink: 0, borderTop: "1px solid #1a1a28", background: "#09090f", padding: "8px 20px 8px", overflowX: "auto", overflowY: "hidden" }}>
              {newInSynopsis.length > 0 && (
                <div style={{ fontSize: 10, color: "#fbbf24", marginBottom: 5 }}>
                  ⚡ 시놉시스에 새 캐릭터: {newInSynopsis.join(", ")} — 캐릭터 설정을 다시 실행하면 반영됩니다.
                </div>
              )}
              <CharacterGallery chars={chars} imageItems={imageItems} stageColor={STAGES[2].color} compact />
            </div>
          );
        })()}

        <div className={s.chatBottom}>

          {/* ── 이미지 컨셉 회의 단계 바텀바 ── */}
          {imageSessionPhase !== "idle" && imageSessionPhase !== "generating" ? (
            <div>
              <div style={{ padding: "8px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#7c6cfc" }}>
                  {imageSessionPhase === "pre-debate" && `🎯 사전 회의 — ${imageItems[currentImageItemIdx]?.name} 방향 논의`}
                  {imageSessionPhase === "extracting" && "⚙️ 4가지 방향 추출 중..."}
                  {imageSessionPhase === "post-debate" && `🔍 검토 회의 — 시안 평가`}
                  {imageSessionPhase === "recommending" && "💬 팀 추천 발표 중..."}
                  {imageSessionPhase === "selecting" && `💬 ${imageItems[currentImageItemIdx]?.name} — 채팅으로 확정 또는 수정 요청`}
                  {imageRoundNum > 1 && <span style={{ fontSize: 10, color: "#4a4a6a", marginLeft: 8 }}>라운드 {imageRoundNum}</span>}
                </div>
              </div>
              {imageGenError && <div style={{ padding: "4px 16px", fontSize: 12, color: "#f87171" }}>⚠ {imageGenError}</div>}
              {/* 사전 회의 또는 검토 회의 중: 사용자 개입 + 마무리 버튼 */}
              {(imageSessionPhase === "pre-debate" || imageSessionPhase === "post-debate") && (
                <>
                  <div style={{ padding: "6px 16px 0" }}>
                    <button
                      onClick={imageSessionPhase === "pre-debate" ? handleEndPreDebate : handleEndPostDebate}
                      style={{ width: "100%", background: `rgba(124,108,252,0.08)`, border: `1px solid rgba(124,108,252,0.3)`, borderRadius: 8, color: "#7c6cfc", fontSize: 13, fontWeight: 700, padding: "9px 0", cursor: "pointer" }}>
                      {imageSessionPhase === "pre-debate" ? "🎨 시안 생성 →" : "⭐ 추천 받기 →"}
                    </button>
                  </div>
                  <div className={s.inputRow}>
                    <textarea
                      className={s.chatInput} rows={1}
                      placeholder="의견 입력 (Enter 전송) — 토론에 개입"
                      value={chatInput}
                      onChange={(e: { target: HTMLTextAreaElement }) => setChatInput(e.target.value)}
                      onKeyDown={(e: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          const msg = chatInput.trim();
                          if (msg) { addMsg("user", msg, false); pendingImageMsgRef.current = msg; setChatInput(""); }
                        }
                      }}
                    />
                    <button className={s.btnSend} disabled={!chatInput.trim()} onClick={() => { const msg = chatInput.trim(); if (msg) { addMsg("user", msg, false); pendingImageMsgRef.current = msg; setChatInput(""); } }}>전송</button>
                  </div>
                </>
              )}
              {/* selecting: 채팅으로 확정/수정 — 버튼과 병행 */}
              {imageSessionPhase === "selecting" && (
                <div className={s.inputRow}>
                  <textarea
                    className={s.chatInput} rows={1}
                    placeholder='채팅으로 확정 ("A안 확정", "좋아") 또는 수정 요청 ("다시 만들어", "B안 더 어둡게")'
                    value={chatInput}
                    onChange={(e: { target: HTMLTextAreaElement }) => setChatInput(e.target.value)}
                    onKeyDown={(e: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        const msg = chatInput.trim();
                        if (msg) { addMsg("user", msg, false); pendingImageMsgRef.current = msg; setChatInput(""); }
                      }
                    }}
                  />
                  <button className={s.btnSend} disabled={!chatInput.trim()} onClick={() => { const msg = chatInput.trim(); if (msg) { addMsg("user", msg, false); pendingImageMsgRef.current = msg; setChatInput(""); } }}>전송</button>
                </div>
              )}
            </div>
          ) : null}

          {/* ── 스타일 정의 단계 UI (stylePhase가 활성이면 일반 바텀바 대체) ── */}
          {imageSessionPhase !== "idle" ? null : stylePhase === "debating" && (
            <>
              <div style={{ padding:"6px 16px 0" }}>
                <button
                  onClick={() => { abortRef.current = true; styleRunningRef.current = false; setStylePhase("reviewing"); }}
                  style={{ width:"100%", background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.3)", borderRadius:8, color:"#f59e0b", fontSize:13, fontWeight:700, padding:"9px 0", cursor:"pointer" }}>
                  ✓ 토론 마무리 & 스타일 정리로 이동
                </button>
              </div>
              <div className={s.inputRow}>
                <textarea
                  className={s.chatInput} rows={1}
                  placeholder="스타일에 대한 의견 입력 (Enter 전송)"
                  value={chatInput}
                  onChange={(e: { target: HTMLTextAreaElement }) => setChatInput(e.target.value)}
                  onKeyDown={(e: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (chatInput.trim()) { pendingStyleMsgRef.current = chatInput.trim(); setChatInput(""); }
                    }
                  }}
                />
                <button className={s.btnSend} disabled={!chatInput.trim()} onClick={() => { if (chatInput.trim()) { pendingStyleMsgRef.current = chatInput.trim(); setChatInput(""); } }}>전송</button>
              </div>
            </>
          )}

          {imageSessionPhase === "idle" && (stylePhase === "reviewing" || stylePhase === "generating") && (
            <div>
              {/* 생성된 테스트 이미지들 */}
              {styleTestImages.length > 0 && (
                <div style={{ padding:"10px 16px 0", overflowX:"auto" }}>
                  <div style={{ display:"flex", gap:8 }}>
                    {styleTestImages.map((url: string, i: number) => (
                      <img key={i} src={url} alt={`스타일 테스트 ${i+1}`}
                        style={{ height:180, borderRadius:8, objectFit:"cover", border:"1px solid #2a2a3d", flexShrink:0 }} />
                    ))}
                  </div>
                </div>
              )}
              {styleGenError && (
                <div style={{ padding:"6px 16px", fontSize:12, color:"#f87171" }}>⚠ {styleGenError}</div>
              )}
              {/* 스타일 텍스트 편집 영역 */}
              <div style={{ padding:"8px 16px 0" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#4a4a68", marginBottom:4, letterSpacing:"0.05em" }}>스타일 프롬프트 — 직접 편집 가능</div>
                <textarea
                  value={styleInput}
                  onChange={(e: { target: HTMLTextAreaElement }) => setStyleInput(e.target.value)}
                  placeholder="스타일 키워드 (영문). 예: Korean webtoon, dark fantasy, detailed ink lines, muted earth tones..."
                  rows={2}
                  style={{ width:"100%", background:"#12121c", border:"1px solid #2a2a3d", borderRadius:6, color:"#eeeef5", fontSize:12, padding:"8px 10px", resize:"none", boxSizing:"border-box", fontFamily:"inherit" }}
                />
              </div>
              <div style={{ padding:"6px 16px 10px", display:"flex", gap:8 }}>
                <button
                  onClick={() => void generateStyleTestImage()}
                  disabled={styleGenLoading || stylePhase === "generating"}
                  style={{ background:"rgba(245,158,11,0.06)", border:"1px solid rgba(245,158,11,0.2)", borderRadius:8, color:"#f59e0b", fontSize:12, fontWeight:600, padding:"8px 14px", cursor:"pointer", opacity: styleGenLoading ? 0.5 : 1, flexShrink:0 }}>
                  {stylePhase === "generating" ? "생성 중..." : "↺ 다시 생성"}
                </button>
                <button
                  onClick={confirmStyle}
                  disabled={stylePhase === "generating"}
                  style={{ flex:1, background:"rgba(52,211,153,0.08)", border:"1px solid rgba(52,211,153,0.3)", borderRadius:8, color:"#34d399", fontSize:13, fontWeight:700, padding:"9px 0", cursor:"pointer" }}>
                  ✓ 이 스타일로 확정 →
                </button>
              </div>
            </div>
          )}

          {/* ── 에셋 리스트 검토 단계 UI ── */}
          {imageSessionPhase === "idle" && assetListPhase === "reviewing" && (() => {
            // Stage 1·2 JSON에서 상세 정보 룩업
            const s1d = stageResults.find((r: StageResult) => r.stageId === 1)?.data;
            const s2d = stageResults.find((r: StageResult) => r.stageId === 2)?.data;
            const s1charsA = Array.isArray(s1d?.key_characters) ? (s1d!.key_characters as Record<string,string>[]) : [];
            const s2charsA = Array.isArray(s2d?.characters)     ? (s2d!.characters     as Record<string,string>[]) : [];
            const s1locsA  = Array.isArray(s1d?.key_locations)  ? (s1d!.key_locations  as Record<string,string>[]) : [];
            const s2locsA  = Array.isArray(s2d?.locations)      ? (s2d!.locations      as Record<string,string>[]) : [];
            const s2propsA = Array.isArray(s2d?.props)          ? (s2d!.props          as Record<string,string>[]) : [];
            const protA    = s2d?.protagonist as Record<string,string> | undefined;

            const confirmAssets = () => {
              const confirmed = { ...editableAssets };
              synopsisAssetsRef.current = confirmed;
              localStorage.setItem(`wts_asset_list_${projectId}`, JSON.stringify(confirmed));
              setAssetListPhase("confirmed");
              setStylePhase("debating");
              void runStyleDebate();
            };

            const SectionHdr = ({ label, color, count }: { label: string; color: string; count: number }) => (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, marginTop: 16 }}>
                <div style={{ width: 3, height: 14, background: color, borderRadius: 2 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>{label}</span>
                <span style={{ fontSize: 10, color: "#3a3a52", fontWeight: 600 }}>{count}개</span>
              </div>
            );

            const AddRow = ({ value, onChange, onAdd, placeholder, color }: { value: string; onChange: (v: string) => void; onAdd: () => void; placeholder: string; color: string }) => (
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input value={value} onChange={e => onChange(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && value.trim()) onAdd(); }}
                  placeholder={placeholder}
                  style={{ flex: 1, background: "#0e0e1a", border: "1px solid #2a2a3d", borderRadius: 6, color: "#eeeef5", fontSize: 12, padding: "5px 9px", outline: "none" }} />
                <button onClick={onAdd}
                  style={{ background: `${color}15`, border: `1px solid ${color}40`, borderRadius: 6, color, fontSize: 11, fontWeight: 700, padding: "5px 12px", cursor: "pointer" }}>+ 추가</button>
              </div>
            );

            return (
              <div style={{ padding: "14px 16px 16px", borderTop: "1px solid #1e1e2a", overflowY: "auto", maxHeight: "65vh" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24", marginBottom: 4 }}>
                  📋 에셋 리스트 확인
                </div>
                <div style={{ fontSize: 11, color: "#3a3a52", marginBottom: 2 }}>
                  빠진 항목 추가 또는 불필요한 항목 삭제 후 확정하세요. Runway 프롬프트가 있는 항목은 이미지 생성에 바로 사용 가능합니다.
                </div>

                {/* ── 등장인물 ── */}
                <SectionHdr label="등장인물" color="#fb923c" count={editableAssets.characters.length} />
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {editableAssets.characters.map((name, i) => {
                    const s2c = s2charsA.find(c => c.name === name);
                    const s1c = s1charsA.find(c => c.name === name);
                    const isProtag   = protA?.name === name;
                    const role       = s2c?.role ?? s1c?.role ?? "";
                    const appearance = s2c?.appearance ?? s1c?.face ?? "";
                    const personality= s2c?.personality ?? s1c?.personality ?? "";
                    const relation   = s2c?.relation ?? "";
                    const imagePrompt= s2c?.image_prompt ?? "";
                    return (
                      <div key={i} style={{
                        background: isProtag ? "rgba(251,146,60,0.08)" : "rgba(255,255,255,0.025)",
                        border: `1px solid ${isProtag ? "rgba(251,146,60,0.35)" : "rgba(251,146,60,0.12)"}`,
                        borderRadius: 10, padding: "10px 12px",
                        display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "start",
                      }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#fb923c" }}>{name}</span>
                            {isProtag && <span style={{ fontSize: 9, fontWeight: 700, color: "#fb923c", background: "rgba(251,146,60,0.15)", border: "1px solid rgba(251,146,60,0.3)", borderRadius: 4, padding: "1px 5px" }}>주인공</span>}
                            {role && !isProtag && <span style={{ fontSize: 11, color: "#64748b" }}>{role}</span>}
                          </div>
                          {isProtag && protA && (
                            <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5, marginBottom: 3 }}>
                              {protA.pain_point && <span style={{ color: "#f87171" }}>결핍: {protA.pain_point}</span>}
                              {protA.want && <span style={{ color: "#60a5fa", marginLeft: 8 }}>목표: {protA.want}</span>}
                            </div>
                          )}
                          {appearance && <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}><span style={{ color: "#4a4a68", fontWeight: 600 }}>외형 </span>{appearance}</div>}
                          {personality && <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5, marginTop: 2 }}><span style={{ color: "#4a4a68", fontWeight: 600 }}>성격 </span>{personality}</div>}
                          {relation && <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5, marginTop: 2 }}><span style={{ color: "#4a4a68", fontWeight: 600 }}>관계 </span>{relation}</div>}
                          {imagePrompt && (
                            <div style={{ marginTop: 6, background: "rgba(251,146,60,0.06)", border: "1px solid rgba(251,146,60,0.2)", borderRadius: 6, padding: "6px 8px" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                                <span style={{ fontSize: 9, fontWeight: 700, color: "#fb923c", textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Runway Prompt</span>
                                <button onClick={() => navigator.clipboard.writeText(imagePrompt)}
                                  style={{ background: "rgba(251,146,60,0.15)", border: "1px solid rgba(251,146,60,0.3)", borderRadius: 4, color: "#fb923c", fontSize: 9, fontWeight: 700, padding: "2px 6px", cursor: "pointer" }}>복사</button>
                              </div>
                              <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.5, fontFamily: "monospace" }}>{imagePrompt}</div>
                            </div>
                          )}
                          {!appearance && !personality && !relation && !isProtag && !imagePrompt && (
                            <div style={{ fontSize: 11, color: "#3a3a52", fontStyle: "italic" }}>세부 정보 없음 — 캐릭터 설계 단계에서 구체화됩니다</div>
                          )}
                        </div>
                        <button onClick={() => setEditableAssets(a => ({ ...a, characters: a.characters.filter((_, j) => j !== i) }))}
                          style={{ background: "none", border: "none", color: "#3a3a52", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1, marginTop: 2 }}>×</button>
                      </div>
                    );
                  })}
                </div>
                <AddRow value={newCharInput} onChange={setNewCharInput} placeholder="+ 등장인물 이름 추가 (Enter)" color="#fb923c"
                  onAdd={() => { if (newCharInput.trim()) { setEditableAssets(a => ({ ...a, characters: [...a.characters, newCharInput.trim()] })); setNewCharInput(""); } }} />

                {/* ── 장소 ── */}
                <SectionHdr label="장소" color="#a78bfa" count={editableAssets.locations.length} />
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {editableAssets.locations.map((name, i) => {
                    const s2l = s2locsA.find(l => l.name === name);
                    const s1l = s1locsA.find(l => l.name === name);
                    const type         = s2l?.type ?? s1l?.type ?? "";
                    const visual       = s2l?.visual ?? s1l?.visual ?? "";
                    const significance = s2l?.significance ?? s1l?.significance ?? "";
                    const imagePrompt  = s2l?.image_prompt ?? "";
                    return (
                      <div key={i} style={{
                        background: "rgba(255,255,255,0.025)", border: "1px solid rgba(167,139,250,0.12)",
                        borderRadius: 10, padding: "10px 12px",
                        display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "start",
                      }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>{name}</span>
                            {type && <span style={{ fontSize: 11, color: "#64748b" }}>{type}</span>}
                          </div>
                          {visual && <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}><span style={{ color: "#4a4a68", fontWeight: 600 }}>시각 </span>{visual}</div>}
                          {significance && <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5, marginTop: 2 }}><span style={{ color: "#4a4a68", fontWeight: 600 }}>역할 </span>{significance}</div>}
                          {imagePrompt && (
                            <div style={{ marginTop: 6, background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 6, padding: "6px 8px" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                                <span style={{ fontSize: 9, fontWeight: 700, color: "#a78bfa", textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Runway Prompt</span>
                                <button onClick={() => navigator.clipboard.writeText(imagePrompt)}
                                  style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 4, color: "#a78bfa", fontSize: 9, fontWeight: 700, padding: "2px 6px", cursor: "pointer" }}>복사</button>
                              </div>
                              <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.5, fontFamily: "monospace" }}>{imagePrompt}</div>
                            </div>
                          )}
                          {!visual && !significance && !imagePrompt && (
                            <div style={{ fontSize: 11, color: "#3a3a52", fontStyle: "italic" }}>세부 정보 없음 — 장소 설계 단계에서 구체화됩니다</div>
                          )}
                        </div>
                        <button onClick={() => setEditableAssets(a => ({ ...a, locations: a.locations.filter((_, j) => j !== i) }))}
                          style={{ background: "none", border: "none", color: "#3a3a52", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1, marginTop: 2 }}>×</button>
                      </div>
                    );
                  })}
                </div>
                <AddRow value={newLocInput} onChange={setNewLocInput} placeholder="+ 장소명 추가 (Enter)" color="#a78bfa"
                  onAdd={() => { if (newLocInput.trim()) { setEditableAssets(a => ({ ...a, locations: [...a.locations, newLocInput.trim()] })); setNewLocInput(""); } }} />

                {/* ── 소품·장비 ── */}
                <SectionHdr label="소품·장비" color="#e879f9" count={editableAssets.props.length} />
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {editableAssets.props.map((name, i) => {
                    const prop = s2propsA.find(p => p.name === name);
                    const type        = prop?.type ?? "";
                    const visual      = prop?.visual ?? "";
                    const story_role  = prop?.story_role ?? "";
                    const owner       = prop?.owner ?? "";
                    const imagePrompt = prop?.image_prompt ?? "";
                    return (
                      <div key={i} style={{
                        background: "rgba(255,255,255,0.025)", border: "1px solid rgba(232,121,249,0.12)",
                        borderRadius: 10, padding: "10px 12px",
                        display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "start",
                      }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#e879f9" }}>{name}</span>
                            {type && <span style={{ fontSize: 11, color: "#64748b" }}>{type}</span>}
                            {owner && <span style={{ fontSize: 10, color: "#4a4a68" }}>— {owner}</span>}
                          </div>
                          {visual && <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}><span style={{ color: "#4a4a68", fontWeight: 600 }}>시각 </span>{visual}</div>}
                          {story_role && <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5, marginTop: 2 }}><span style={{ color: "#4a4a68", fontWeight: 600 }}>역할 </span>{story_role}</div>}
                          {imagePrompt && (
                            <div style={{ marginTop: 6, background: "rgba(232,121,249,0.06)", border: "1px solid rgba(232,121,249,0.2)", borderRadius: 6, padding: "6px 8px" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                                <span style={{ fontSize: 9, fontWeight: 700, color: "#e879f9", textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Runway Prompt</span>
                                <button onClick={() => navigator.clipboard.writeText(imagePrompt)}
                                  style={{ background: "rgba(232,121,249,0.15)", border: "1px solid rgba(232,121,249,0.3)", borderRadius: 4, color: "#e879f9", fontSize: 9, fontWeight: 700, padding: "2px 6px", cursor: "pointer" }}>복사</button>
                              </div>
                              <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.5, fontFamily: "monospace" }}>{imagePrompt}</div>
                            </div>
                          )}
                          {!visual && !story_role && !imagePrompt && (
                            <div style={{ fontSize: 11, color: "#3a3a52", fontStyle: "italic" }}>세부 정보 없음 — 소품 설계 단계에서 구체화됩니다</div>
                          )}
                        </div>
                        <button onClick={() => setEditableAssets(a => ({ ...a, props: a.props.filter((_, j) => j !== i) }))}
                          style={{ background: "none", border: "none", color: "#3a3a52", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1, marginTop: 2 }}>×</button>
                      </div>
                    );
                  })}
                </div>
                <AddRow value={newPropInput} onChange={setNewPropInput} placeholder="+ 소품·장비 추가 (Enter)" color="#e879f9"
                  onAdd={() => { if (newPropInput.trim()) { setEditableAssets(a => ({ ...a, props: [...a.props, newPropInput.trim()] })); setNewPropInput(""); } }} />

                {/* 확정 버튼 */}
                <button onClick={confirmAssets}
                  style={{ width: "100%", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 8, color: "#34d399", fontSize: 13, fontWeight: 700, padding: "11px 0", cursor: "pointer", marginTop: 16 }}>
                  ✓ 확정 → 스타일 정의로
                </button>
              </div>
            );
          })()}

          {/* 이미지/스타일/에셋 리스트 단계 활성 중엔 아래 일반 바텀바 숨김 */}
          {imageSessionPhase !== "idle" || (stylePhase !== "idle" && stylePhase !== "confirmed") || assetListPhase === "reviewing" ? null : (<>

          {/* Paused: 이전 토론 이어하기 */}
          {debatePhase === "paused" && (
            <div className={s.gatingRow}>
              <div>
                <div className={s.gatingMsg}>⏸ 이전에 진행하던 토론이 있습니다</div>
                <div style={{ fontSize:11, color:"#64748b", marginTop:3 }}>이어하기를 누르면 중단된 지점부터 재개됩니다</div>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button className={s.btnGating} style={{ width:"auto", padding:"10px 16px" }} onClick={() => {
                  runningRef.current = false;
                  abortRef.current = false;
                  void runDebate(currentStageIdx);
                }}>이어하기 →</button>
                <button className={s.btnRestart} onClick={() => {
                  resumeDataRef.current = null;
                  runningRef.current = false;
                  abortRef.current = false;
                  loglineResolverRef.current = null;
                  synopsisStepRef.current = "idle";
                  try {
                    localStorage.removeItem(`p2_conv_${currentStageIdx}_${projectId}`);
                    localStorage.removeItem(`p2_msgs_${currentStageIdx}_${projectId}`);
                  } catch { /* ignore */ }
                  void runDebate(currentStageIdx);
                }}>새로 시작</button>
              </div>
            </div>
          )}

          {/* Running: Stage 3은 캐릭터 진행 카드, 나머지는 확정 버튼 */}
          {debatePhase === "running" && STAGES[currentStageIdx]?.id === 3 ? (() => {
            const chars3 = editableAssets.characters;
            if (chars3.length === 0) return null;
            const doneCount = chars3.filter(n => coveredAgendaIds.includes(`char_${n}_body`)).length;
            const activeIdx = chars3.findIndex(n => !coveredAgendaIds.includes(`char_${n}_body`));
            return (
              <div style={{ padding:"8px 16px 10px", borderTop:"1px solid #1a1a28" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#fb923c", letterSpacing:"0.06em", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <span>👥 캐릭터 설정 진행</span>
                  <span style={{ color:"#3a3a52" }}>{doneCount} / {chars3.length}</span>
                </div>
                <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:2 }}>
                  {chars3.map((name, i) => {
                    const isDone = coveredAgendaIds.includes(`char_${name}_body`);
                    const isActive = !isDone && i === activeIdx;
                    const isPending = !isDone && !isActive;
                    return (
                      <div key={i} style={{
                        flexShrink:0, width:72, minHeight:76,
                        borderRadius:10,
                        border:`1px solid ${isDone ? "rgba(52,211,153,0.35)" : isActive ? "rgba(251,146,60,0.45)" : "rgba(255,255,255,0.12)"}`,
                        background: isDone ? "rgba(52,211,153,0.06)" : isActive ? "rgba(251,146,60,0.07)" : "rgba(255,255,255,0.04)",
                        display:"flex", flexDirection:"column" as const, alignItems:"center", justifyContent:"center",
                        gap:5, padding:"8px 4px",
                        transition:"all 0.2s",
                      }}>
                        <div style={{
                          width:34, height:34, borderRadius:"50%",
                          background: isDone ? "rgba(52,211,153,0.18)" : isActive ? "rgba(251,146,60,0.18)" : "rgba(255,255,255,0.07)",
                          border:`1px solid ${isDone ? "rgba(52,211,153,0.4)" : isActive ? "rgba(251,146,60,0.4)" : "rgba(255,255,255,0.1)"}`,
                          display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize: isDone ? 16 : isPending ? 14 : 10,
                          color: isDone ? "#34d399" : isActive ? "#fb923c" : "#4a4a6a",
                        }}>
                          {isDone ? "✓" : isActive ? <ThinkingDots /> : "○"}
                        </div>
                        <div style={{
                          fontSize:10, fontWeight:700, textAlign:"center" as const, lineHeight:1.3,
                          maxWidth:64, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const,
                          color: isDone ? "#34d399" : isActive ? "#fb923c" : "#6a6a8a",
                        }}>{name}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })() : debatePhase === "running" ? (
            <div style={{ padding:"6px 16px 0" }}>
              <button
                onClick={() => { void handleConfirm(currentStageIdx); }}
                style={{
                  width:"100%", background:"rgba(52,211,153,0.08)", border:"1px solid rgba(52,211,153,0.3)",
                  borderRadius:8, color:"#34d399", fontSize:13, fontWeight:700,
                  padding:"9px 0", cursor:"pointer", letterSpacing:"0.02em",
                }}>
                ✓ 이 단계 확정하고 결과 정리
              </button>
            </div>
          ) : null}

          {/* Confirming: spinner */}
          {debatePhase === "confirming" && (
            <div style={{ padding:"10px 20px", fontSize:13, color:"#fbbf24" }}>📝 결과 정리 중...</div>
          )}

          {/* Confirmed: action buttons are in StageReportInChat (in-chat report) */}

          {/* Done — all stages complete */}
          {debatePhase === "done" && (
            <div className={s.gatingRow}>
              <span className={s.gatingMsg}>✓ Phase 2 전체 완료 — Phase 3 진행 가능</span>
              <div style={{ display:"flex", gap:8 }}>
                <button className={s.btnRestart} onClick={handleRestartNew}>재생성</button>
                <button className={s.btnGating} style={{ width:"auto", padding:"10px 20px" }} onClick={() => router.push(`/projects/${projectId}/phase-3`)}>Phase 3 시작 →</button>
              </div>
            </div>
          )}

          {/* Chat input during running */}
          {debatePhase === "running" && (
            <div className={s.chatInputRow} style={{ flexDirection: "column", gap: 0, padding: 0 }}>
              {/* Reply-to 표시 */}
              {replyTo && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "6px 12px", background: "rgba(99,102,241,0.12)",
                  borderTop: "1px solid rgba(99,102,241,0.25)",
                  borderLeft: "3px solid rgba(99,102,241,0.6)",
                  fontSize: 12, color: "#a5b4fc",
                }}>
                  <span>
                    <span style={{ fontWeight: 700 }}>↩ {replyTo.agentLabel}</span>
                    <span style={{ opacity: 0.75 }}> — {replyTo.preview}{replyTo.preview.length >= 60 ? "..." : ""}</span>
                  </span>
                  <button
                    onClick={() => setReplyTo(null)}
                    style={{ background: "none", border: "none", color: "#a5b4fc", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
                  >✕</button>
                </div>
              )}
              <div style={{ display: "flex", width: "100%" }}>
                <textarea
                  ref={chatInputRef}
                  className={s.chatInput}
                  value={chatInput}
                  rows={2}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setChatInput(e.target.value)}
                  onCompositionStart={() => { isComposingRef.current = true; }}
                  onCompositionEnd={() => { isComposingRef.current = false; }}
                  onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                    if (e.key === "Escape") { setReplyTo(null); return; }
                    if (e.key === "Enter" && !e.shiftKey && !isComposingRef.current && chatInput.trim()) {
                      e.preventDefault();
                      const text = chatInput.trim();
                      const quote = replyTo
                        ? `[${replyTo.agentLabel}의 발언 "${replyTo.preview}${replyTo.preview.length >= 60 ? "..." : ""}"에 대해]: `
                        : "";
                      pendingUserMsgRef.current = quote + text;
                      setMsgs((prev: Msg[]) => [...prev, {
                        id: Math.random().toString(36).slice(2),
                        agent: "user" as AgentId, text,
                        replyQuote: replyTo ? { agentLabel: replyTo.agentLabel, preview: replyTo.preview } : undefined,
                        streaming: false,
                      }]);
                      setChatInput(""); setReplyTo(null);
                    }
                  }}
                  placeholder={replyTo ? `${replyTo.agentLabel}에게 댓글... (Enter 전송 · Esc 취소)` : "아무 때나 끼어들어도 돼! (Enter 전송 · Shift+Enter 줄바꿈)"}
                  style={{ resize: "none", flex: 1 }}
                />
                <button
                  className={s.btnSend}
                  onClick={() => {
                    const text = chatInput.trim();
                    if (!text) return;
                    const quote = replyTo
                      ? `[${replyTo.agentLabel}의 발언 "${replyTo.preview}${replyTo.preview.length >= 60 ? "..." : ""}"에 대해]: `
                      : "";
                    pendingUserMsgRef.current = quote + text;
                    setMsgs((prev: Msg[]) => [...prev, {
                      id: Math.random().toString(36).slice(2),
                      agent: "user" as AgentId, text,
                      replyQuote: replyTo ? { agentLabel: replyTo.agentLabel, preview: replyTo.preview } : undefined,
                      streaming: false,
                    }]);
                    setChatInput(""); setReplyTo(null);
                  }}
                >전송</button>
              </div>
            </div>
          )}
          </>)}
        </div>
      </div>

      {/* ── 버전 히스토리 모달 ─────────────────────────────────────────────── */}
      {versionHistoryModal && (() => {
        const { stageIdx } = versionHistoryModal;
        const stageObj = STAGES[stageIdx];
        const latestResult = stageResults.find((r: StageResult) => r.stageId === stageObj.id);
        if (!latestResult) return null;
        const allVersions = [
          ...(stageResultHistory[stageIdx] ?? []),
          latestResult,
        ].sort((a: StageResult, b: StageResult) => (a.version ?? 1) - (b.version ?? 1));
        const nextStageName = stageIdx + 1 < STAGES.length ? STAGES[stageIdx + 1].name : null;
        return (
          <VersionHistoryModal
            stageObj={stageObj}
            allVersions={allVersions}
            onClose={() => setVersionHistoryModal(null)}
            onViewHistory={() => {
              setVersionHistoryModal(null);
              window.location.href = `/projects/${projectId}/phase-2?view=${stageObj.id}`;
            }}
            onNextStage={stageIdx + 1 <= currentStageIdx ? undefined : () => {
              setVersionHistoryModal(null);
              handleNextStage(stageIdx);
            }}
            nextStageName={nextStageName}
          />
        );
      })()}

      {/* ── 에셋 모달 오버레이 ─────────────────────────────────────────────── */}
      {assetModal && (() => {
        const { type, item } = assetModal;
        const color = type === "char" ? "#fb923c" : type === "loc" ? "#a78bfa" : "#e879f9";
        const typeLabel = type === "char" ? "등장인물" : type === "loc" ? "장소" : "소품·장비";

        const MField = ({ label, val }: { label: string; val?: string }) =>
          val ? (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color, letterSpacing: "0.6px", textTransform: "uppercase" as const, marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 13, color: "#d4dce8", lineHeight: 1.7 }}>{val}</div>
            </div>
          ) : null;

        const charFields: [string, string][] = [
          ["외형·얼굴", item.face ?? item.appearance ?? ""],
          ["성별", item.gender ?? ""],
          ["나이", item.age ?? ""],
          ["체형", item.build ?? ""],
          ["헤어", item.hair ?? ""],
          ["패션", item.fashion ?? ""],
          ["성격", item.personality ?? ""],
          ["역할", item.role ?? ""],
          ["목표", item.goal ?? item.want ?? ""],
          ["내면의 상처", item.wound ?? item.backstory ?? ""],
          ["말투", item.speech_style ?? ""],
          ["관계", item.relation ?? ""],
          ["서사적 역할", item.story_role ?? ""],
        ];
        const locFields: [string, string][] = [
          ["유형", item.location_type ?? item.type ?? ""],
          ["시각 묘사", item.visual ?? item.appearance ?? ""],
          ["조명", item.lighting ?? ""],
          ["색채", item.color_palette ?? ""],
          ["분위기", item.atmosphere ?? ""],
          ["공간 구조", item.architecture ?? ""],
          ["소리·냄새", item.sound ?? ""],
          ["서사적 의미", item.significance ?? item.role ?? ""],
          ["상징", item.symbolic_meaning ?? ""],
        ];
        const propFields: [string, string][] = [
          ["유형", item.type ?? ""],
          ["시각 묘사", item.visual ?? item.appearance ?? ""],
          ["서사적 역할", item.story_role ?? item.significance ?? item.role ?? ""],
          ["소유자", item.owner ?? ""],
        ];
        const fields = type === "char" ? charFields : type === "loc" ? locFields : propFields;

        return (
          <div
            onClick={() => setAssetModal(null)}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9999,
              display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: "#0d0d1b", border: `1px solid ${color}35`, borderRadius: 16,
                width: "100%", maxWidth: 520, maxHeight: "80vh", overflow: "hidden",
                display: "flex", flexDirection: "column",
              }}
            >
              {/* 헤더 */}
              <div style={{
                padding: "16px 20px", background: `${color}10`, borderBottom: `1px solid ${color}25`,
                display: "flex", alignItems: "center", gap: 12,
              }}>
                {type === "char" ? (
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: `${color}25`, border: `2px solid ${color}50`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color, flexShrink: 0 }}>
                    {(item.name ?? "?").slice(0, 2)}
                  </div>
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}20`, border: `1px solid ${color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                    {type === "loc" ? "🗺" : "🎒"}
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: "0.6px", textTransform: "uppercase" as const, marginBottom: 2 }}>{typeLabel}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: "#f1f5f9" }}>{item.name}</div>
                  {item.role && <div style={{ fontSize: 11, color: `${color}bb`, marginTop: 1 }}>{item.role}</div>}
                </div>
                <button
                  onClick={() => setAssetModal(null)}
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#94a3b8", cursor: "pointer", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}
                >✕</button>
              </div>

              {/* 바디 */}
              <div style={{ padding: "18px 20px", overflowY: "auto", flex: 1 }}>
                {fields.map(([label, val]) =>
                  val ? <MField key={label} label={label} val={val} /> : null
                )}
                {/* Runway 프롬프트 복사 */}
                {item.image_prompt && (
                  <div style={{ marginTop: 8, background: `${color}08`, border: `1px solid ${color}25`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, fontWeight: 800, color, textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 4 }}>Runway 프롬프트</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55, fontFamily: "monospace" }}>{item.image_prompt}</div>
                    </div>
                    <button
                      onClick={() => void navigator.clipboard.writeText(item.image_prompt ?? "")}
                      style={{ background: `${color}18`, border: `1px solid ${color}35`, borderRadius: 6, color, fontSize: 10, fontWeight: 700, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
                    >복사</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

