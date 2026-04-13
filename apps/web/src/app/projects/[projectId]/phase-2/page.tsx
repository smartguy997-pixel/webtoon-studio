"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import s from "./page.module.css";
import { streamClaude, getAnthropicKey, getAnthropicKeyByIndex, getAllAnthropicKeys } from "@/lib/claude-client";

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = {
  worldbuilder: { label: "세계관설계자",   color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  ini: "세" },
  character:    { label: "캐릭터디자이너", color: "#fb923c", bg: "rgba(251,146,60,0.12)",  ini: "캐" },
  scenario:     { label: "시나리오작가",   color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  ini: "시" },
  script:       { label: "연출작가",       color: "#f87171", bg: "rgba(248,113,113,0.12)", ini: "연" },
  producer:     { label: "총괄프로듀서",   color: "#f1f5f9", bg: "rgba(241,245,249,0.12)", ini: "총" },
  editor:       { label: "편집자",         color: "#fb923c", bg: "rgba(251,146,60,0.10)",  ini: "편" },
  user:         { label: "나",             color: "#7c6cfc", bg: "rgba(124,108,252,0.12)", ini: "나" },
} as const;
type AgentId = keyof typeof AGENTS;

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
    "세계관 설계 전문가. 이 세계가 실제로 존재하는 것처럼 만들어야 해. " +
    "설정 구멍 찾고, 논리적으로 맞지 않으면 바로 짚어. " +
    "시각적으로 어떻게 보여야 하는지도 구체적으로 얘기해줘. " +
    "빌딩, 거리, 복장, 기술 수준까지 세세하게.",
  character:
    "캐릭터 디자이너. 인물의 외형·복장·표정·몸짓까지 이미지로 그려질 수 있게 설계해. " +
    "얼굴 생김새, 키와 체형, 헤어, 패션까지 구체적으로 얘기해. " +
    "내면의 상처와 성격이 외모와 말투에 어떻게 드러나는지 연결해줘.",
  scenario:
    "서사 구조 전문가. 이야기가 장기 시리즈 동안 독자를 어떻게 끌고 가는지 설계해. " +
    "복선이 어디서 심겨서 어디서 회수되는지, 감정 곡선이 어떻게 흐르는지 구체적으로.",
  script:
    "연출·비주얼 감독. 영화나 애니메이션 감독처럼 생각해. " +
    "이 장면을 어떤 앵글로 찍을지, 조명은 어떻게, 색감은 어떻게. " +
    "공간 구조, 인물 배치, 카메라 무브까지 그림으로 떠올릴 수 있게 얘기해줘.",
  producer:
    "총괄 프로듀서. 지금 우리가 만드는 건 단순한 아이디어가 아니라 실제 제작물이야. " +
    "설정이 너무 추상적이면 '그래서 구체적으로 어떻게 보여?' 하고 파고들어. " +
    "의견 충돌하거나 정리 필요할 때만 끼어들고, 진짜 필요한 결정을 내려줘.",
  editor:
    "베테랑 편집자. 독자 입장에서 생각해. " +
    "'이 설정 독자가 납득할 수 있어?', '이 캐릭터 독자가 왜 좋아해야 해?' 하고 날카롭게. " +
    "짧고 핵심만. 길게 말하지 마.",
};

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
  1: 3,  // 세계관 — 5개 프레임워크, 주제당 3회 키워드 감지 시 완료 처리 (WRAP_UP_AFTER = 35)
  2: 4,  // 시놉시스
  3: 3,  // 캐릭터
  4: 3,  // 장소
  5: 3,  // 소품
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
  3: [ // 캐릭터
    { id: "hero",      label: "주인공",       keywords: /주인공|히어로|주역|주연|리드|protagonist|주캐/,                        nudge: "주인공을 더 깊이 파자. 얼굴·체형·복장·말투·동기·상처까지. 이미지 생성할 수 있을 정도로." },
    { id: "villain",   label: "빌런·적대자",  keywords: /빌런|악당|적|반동|대립|antagonist|보스|라이벌|악역/,                   nudge: "빌런이나 주요 갈등 상대를 설계해보자. 외모·동기·힘·세계관에서의 위치까지." },
    { id: "support",   label: "조력자·단역",  keywords: /조력|서브|단역|주변|캐릭터|등장인물|인물|캐스팅|팀|동료|친구|스승/,   nudge: "조력자들과 단역 인물들도 구체적으로 잡아야 해. 이름·역할·외형·이야기 기능." },
    { id: "design",    label: "외형·시각 설계",keywords: /외모|외형|헤어|머리|눈|얼굴|키|체형|체중|복장|옷|패션|시각|디자인/, nudge: "캐릭터들의 시각적 설계를 정밀하게 잡자. 이미지로 바로 그릴 수 있을 만큼 구체적으로." },
    { id: "relation",  label: "캐릭터 관계",  keywords: /관계|관계도|사이|갈등|우정|사랑|적대|가족|팀|연결|케미|구도/,        nudge: "인물들 사이의 관계 구도를 얘기해야 해. 누가 누구와 어떤 관계이고 어떻게 변하는지." },
  ],
  4: [ // 장소
    { id: "mainloc",   label: "주요 배경",    keywords: /장소|배경|위치|공간|지역|동네|건물|도시|마을|숲|성|궁전|학교|회사/,   nudge: "주요 배경들을 하나씩 짚어보자. 이름·용도·이야기에서의 역할까지." },
    { id: "visual_l",  label: "색채·조명",    keywords: /색채|색감|색|조명|빛|밝기|명암|톤|팔레트|컬러|시각적|비주얼/,        nudge: "각 장소의 색채 팔레트와 조명 특성을 얘기해보자. 그림으로 재현할 수 있게." },
    { id: "arch",      label: "공간 구조",    keywords: /구조|건축|인테리어|레이아웃|공간|규모|크기|층|넓이|형태|구성/,        nudge: "장소들의 건축 구조나 공간 구성을 구체적으로 잡아야 해. 연출할 때 꼭 필요해." },
    { id: "meaning",   label: "서사적 의미",  keywords: /의미|상징|역할|이야기|서사|사건|감정|기억|역사|중요|핵심|전환점/,    nudge: "각 장소가 이야기에서 어떤 서사적 의미를 갖는지 얘기해보자. 단순 배경 그 이상의 역할." },
  ],
  5: [ // 소품·장비
    { id: "items",     label: "주요 소품",    keywords: /소품|아이템|물건|도구|장비|물품|용품|기물|오브제|prop/,               nudge: "이야기에서 핵심 역할을 하는 소품들을 뽑아보자. 이름·용도·시각적 특징." },
    { id: "weapons",   label: "탈것·무기",    keywords: /무기|탈것|차량|비행|선박|총|칼|검|방패|갑옷|장비|군사/,              nudge: "탈것이나 무기류를 설계해보자. 외형·재질·상태·누가 쓰는지까지." },
    { id: "visual_p",  label: "시각적 설계",  keywords: /외형|형태|색|재질|크기|상태|낡|새것|디테일|시각|묘사|그림|모양/,     nudge: "소품들의 시각적 설계를 세밀하게 잡자. 이미지 생성 프롬프트 수준으로 구체적으로." },
    { id: "symbol",    label: "상징·의미",    keywords: /상징|의미|역할|중요|핵심|복선|주인공과의 관계|이야기|서사|감정/,      nudge: "이 소품들이 이야기에서 어떤 상징적 의미를 갖는지 얘기해보자." },
  ],
};

// ─── Types ────────────────────────────────────────────────────────────────────

const STAGES = [
  { id: 1 as const, name: "세계관",     topic: "세계관 — 드라마·웹툰·애니를 위한 세계 설계: 시대적 공기·사회적 압박·만약에 설정·인물 역학·테마",  tag: "WORLD",  color: "#60a5fa", schema: '{"era":"구체적 시대 배경 (연도·장소명·그 시대의 결핍이나 특징)","core_space":"핵심 공간 (주인공이 주로 머무는 곳의 디테일 — 캐릭터 처지를 대변)","daily_life":"생활감 (사람들이 먹고·입고·쓰는 유행어 등 현실적 디테일)","power_hierarchy":"계급과 권력 (누가 갑이고 누가 을인가 — 재벌/서민, 상사/부하 등)","social_norms":"사회적 통념 (이 세계에서 당연하게 여겨지는 가치관)","taboo":"금기 (넘어서는 안 되는 선 — 주인공이 이 선을 넘을 때 갈등 폭발)","what_if_rule":"만약에 설정 (현실과 딱 하나 다른 핵심 규칙 — 장르물이면 필수, 현실물이면 생략 가능)","what_if_cost":"규칙의 대가 (초능력·행운에 따르는 리스크와 제약)","what_if_who_knows":"비밀의 공유 (이 설정을 누가 알고 누가 모르는가 — 정보 불균형이 긴장감 만듦)","key_characters":[{"name":"이름","role":"주인공/빌런/조력자/방해자","position":"이야기에서의 포지션 (돕는자/막는자/중립)","age":"나이/나이대","gender":"성별","face":"얼굴 특징 (이목구비·인상·표정 습관)","height":"키","build":"체형","outfit":"복장","personality":"성격 (3가지 이상)","motivation":"동기와 목표 (무엇을 원하고 왜)","backstory":"과거사와 내면의 상처","speech":"말투","goal_conflict":"다른 인물과의 목표 충돌"}],"key_locations":[{"name":"장소명","type":"유형","visual":"시각적 묘사","significance":"이야기에서의 역할"}],"character_backstory":"인물들이 서로 얽히게 된 결정적 계기 (과거사 요약)","goal_conflicts":"목표의 충돌 구조 (A는 복수를 원하고 B는 용서를 원할 때 등)","theme":"핵심 테마·메시지 (모든 사건과 배경이 향하는 주제 — 사랑/복수/가족애/정의 등)"}' },
  { id: 2 as const, name: "시놉시스",   topic: "시놉시스 — IP 전략가+수석 작가 관점: 로그라인·기획의도·세계관규칙·인카네이션·스토리아크·비판보완 + 에셋리스트",    tag: "SYNOPSIS",      color: "#34d399", schema: '{"logline":"한 문장 — 아이러니하고 시선을 끄는 로그라인","production_intent":"기획 의도 — 이 작품이 지금 이 시대에 왜 필요한가","target_audience":"핵심 타겟층 (나이·성별·관심사)","genre":"최적 장르 + 서브장르","world_rules":["이 세계에서만 작동하는 사회 규칙 1","규칙 2","규칙 3"],"protagonist":{"name":"이름","pain_point":"결핍(Pain point) — 무엇이 빠져있는가","want":"목표(Want) — 무엇을 원하는가","need":"진짜 필요 — 자신도 모르는 진짜 문제","incarnation":"왜 이 세계관에서만 이 결핍이 의미 있는가","arc":"캐릭터 아크 — 시작에서 끝까지 어떻게 변하는가"},"trigger":"사건의 트리거 — 세계관 특수 규칙이 주인공 일상과 충돌하는 첫 번째 대사건","story_arc":{"setup":"발단 — 주인공의 일상과 사건의 도화선","development":"전개 — 갈등 심화와 세계관 비밀 노출 시작","crisis":"위기 — 모든 것이 잘못될 때","climax":"절정 — 가장 극적인 대결 또는 선택","resolution":"결말 — 카타르시스와 변화","twist":"반전 — 독자가 예상 못할 전환점"},"world_exclusivity":"이 세계관이 아니면 절대 불가능한 이유","critique":"진부한 요소 지적 + 어떻게 신선하게 만들 것인가","characters":[{"name":"이름","role":"역할(주인공/빌런/조력자 등)","appearance":"외형 묘사 (이미지 생성용 — 얼굴·키·체형·복장·헤어·특징)","personality":"성격 키워드 3가지 이상","relation":"주인공과의 관계"}],"locations":[{"name":"장소명","type":"유형","visual":"시각적 묘사 (이미지 생성용 — 건축·조명·색채·분위기·디테일)","significance":"이야기에서의 역할"}],"props":[{"name":"소품명","type":"유형","visual":"시각적 묘사 (이미지 생성용 — 색·형태·재질·크기·상태)","story_role":"이야기 역할","owner":"소유자"}],"key_scenes":[{"title":"장면 제목","location":"장소","characters":"등장 인물","action":"행동·상황 묘사","visual":"시각적 묘사 (이미지 생성용 — 구도·색감·조명·분위기)","emotion":"감정·분위기 키워드"}]}' },
  { id: 3 as const, name: "캐릭터 설정", topic: "등장인물 — 이름·역할·성별·나이·외모·체형·복장·성격·동기·말투·세계관 내 역할",        tag: "CHARACTERS",    color: "#fb923c", schema: '{"characters":[{"name":"이름","role":"주인공/빌런/조력자","gender":"성별","age":"나이/나이대","face":"얼굴 특징","height":"키","build":"체형","weight":"몸무게","outfit":"복장 스타일","personality":"성격","motivation":"동기","speech":"말투","story_role":"시놉시스·세계관에서의 역할"}]}' },
  { id: 4 as const, name: "장소 설정",  topic: "주요 장소 — 이름·유형·건축/공간 구조·조명·색채·분위기·소리·서사적 의미·상징",  tag: "LOCATIONS",     color: "#a78bfa", schema: '{"locations":[{"name":"장소명","type":"유형","visual":"시각적 묘사","architecture":"건축/공간 구조","lighting":"조명 특성","color_palette":"색채 팔레트","atmosphere":"분위기","sound":"소리/냄새","significance":"서사적 의미","key_scenes":"이곳에서 일어나는 주요 장면","symbolic_meaning":"상징적 의미"}]}' },
  { id: 5 as const, name: "소품·장비",  topic: "소품·장비·도구 — 탈것·무기·특수 아이템·장비·일상용품 등 이야기에서 중요한 모든 물건의 시각적 설계",  tag: "PROPS", color: "#e879f9", schema: '{"props":[{"name":"소품명","type":"유형(탈것/무기/장비/아이템/일상용품)","visual":"시각적 묘사 (색상·형태·재질·크기)","condition":"상태 (낡음/새것/특별히 장식됨 등)","function":"기능/용도","story_role":"이야기에서의 역할","symbolic_meaning":"상징적 의미","owner":"주요 소유자/사용자"}]}' },
];
type StageId = 1 | 2 | 3 | 4 | 5;

interface StageResult {
  stageId: StageId;
  data: Record<string, unknown>;
  summary: string;
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
    return `[${stage.name} 확정]\n${r.summary}`;
  }).join("\n\n");
}

// 시놉시스에서 추출한 에셋 목록 타입
interface SynopsisAssets {
  characters: string[];
  locations: string[];
  props: string[];
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

  // 에셋 목록 — 세계관·시놉시스에서 확정된 항목, 설명 포함
  let assetChecklist = "";
  if (synopsisAssets) {
    if (stageId === 3 && synopsisAssets.characters.length > 0) {
      const lines = synopsisAssets.characters.map((name, i) => {
        const s1ch = Array.isArray(s1Data?.key_characters)
          ? (s1Data!.key_characters as Record<string,string>[]).find(c => c.name === name) : null;
        const s2ch = Array.isArray(s2Data?.characters)
          ? (s2Data!.characters as Record<string,string>[]).find(c => c.name === name) : null;
        const role = s1ch?.role ?? s2ch?.role ?? "";
        const desc = s2ch?.appearance ?? s2ch?.relation ?? s1ch?.motivation ?? "";
        return `${i + 1}. ${name}${role ? ` — ${role}` : ""}${desc ? ` (${desc})` : ""}`;
      }).join("\n");
      assetChecklist = `\n[⚠️ 반드시 설계해야 할 캐릭터 목록 — 세계관·시놉시스에서 이미 확정된 인물들]\n${lines}\n이들은 이전 단계에서 존재가 확정된 인물이야. 새로 만들지 말고 더 깊이 구체화해. 위 목록에 없는 인물이 등장했다면 추가로 다뤄.\n`;
    } else if (stageId === 4 && synopsisAssets.locations.length > 0) {
      const lines = synopsisAssets.locations.map((name, i) => {
        const s1loc = Array.isArray(s1Data?.key_locations)
          ? (s1Data!.key_locations as Record<string,string>[]).find(l => l.name === name) : null;
        const s2loc = Array.isArray(s2Data?.locations)
          ? (s2Data!.locations as Record<string,string>[]).find(l => l.name === name) : null;
        const type = s1loc?.type ?? s2loc?.type ?? "";
        const role = s1loc?.significance ?? s2loc?.significance ?? s2loc?.visual ?? "";
        return `${i + 1}. ${name}${type ? ` — ${type}` : ""}${role ? ` (${role})` : ""}`;
      }).join("\n");
      assetChecklist = `\n[⚠️ 반드시 설계해야 할 장소 목록 — 세계관·시놉시스에서 이미 확정된 장소들]\n${lines}\n이들은 이전 단계에서 존재가 확정된 장소야. 새로 만들지 말고 시각적으로 더 깊이 설계해. 위 목록에 없는 장소가 나왔다면 추가로 다뤄.\n`;
    } else if (stageId === 5 && synopsisAssets.props.length > 0) {
      assetChecklist = `\n[⚠️ 반드시 설계해야 할 소품 목록 — 세계관·시놉시스에서 이미 확정된 소품들]\n${synopsisAssets.props.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n이들은 이전 단계에서 확정된 소품이야. 각각을 충분히 깊이 다뤄야 해. 위 목록에 없는 소품이 나왔다면 추가로 다뤄.\n`;
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

function buildExtractionPrompt(
  stageId: StageId,
  genre: string,
  debateText: string,
  synopsisContext?: string,  // Stage 2 요약 — 완전성 기준
): string {
  const stage = STAGES.find(s => s.id === stageId)!;
  const isBibleStage = stageId === 3 || stageId === 4 || stageId === 5;
  const bibleNote = isBibleStage
    ? `\n[제작 바이블 원칙 — 반드시 준수]\n` +
      `- 시놉시스·세계관에 이름/언급이 있는 모든 항목을 포함\n` +
      `- 토론에서 덜 다뤄진 항목도 기본 정보로 추가 (누락 금지)\n` +
      `- 한 번이라도 등장하면 반드시 리스트업\n`
    : "";
  const synopsisNote = (isBibleStage && synopsisContext)
    ? `\n[시놉시스 — 이 내용에 등장하는 항목을 기준으로 완전성 검증]\n${synopsisContext.slice(0, 1500)}\n`
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

■ 등장인물 리스트 (이미지 생성용)
  각 인물마다: 이름 / 역할 / 외형 묘사 (얼굴·키·체형·복장·헤어·특징) / 성격 키워드 / 주인공과의 관계

■ 장소 리스트 (이미지 생성용)
  각 장소마다: 장소명 / 유형 / 시각적 묘사 (건축·조명·색채·분위기) / 이야기 역할

■ 소품 리스트 (이미지 생성용)
  각 소품마다: 이름 / 유형 / 시각적 묘사 (색·형태·재질·상태) / 이야기 역할

■ 핵심장면 리스트 (이미지 생성용)
  각 장면마다: 제목 / 장소 / 등장인물 / 행동·상황 / 시각적 묘사 (구도·색감·분위기) / 감정 키워드

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
          systemPrompt: "토론 결과를 정확한 JSON으로 변환하는 전문가입니다. 지정된 형식 외에 아무것도 출력하지 마세요.",
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
      {data.raw_summary && (
        <div style={{ fontSize:13, color:"#d4d4e8", lineHeight:1.85, whiteSpace:"pre-wrap" as const, background:"#12121c", borderRadius:8, padding:"12px 14px" }}>
          {String(data.raw_summary)}
        </div>
      )}
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

function StageReportInChat({
  result,
  stage,
  onNextStage,
  onContinueDebate,
  nextStageName,
  onReanalyze,
  onNewDebate,
}: {
  result: StageResult;
  stage: typeof STAGES[number];
  onNextStage: () => void;
  onContinueDebate: () => void;
  nextStageName: string | null;
  onReanalyze?: () => Promise<void>;
  onNewDebate?: () => void;   // 뷰 모드 전용: 기존 내용 지우고 새로 토론
}) {
  const [reanalyzing, setReanalyzing] = useState(false);
  const isViewMode = !!onNewDebate; // onNewDebate가 있으면 뷰 모드
  const c = stage.color;
  const { data } = result;

  // 다음 단계 버튼 레이블 — nextStageName이 없으면 stageId로 유추
  const nextBtnLabel = nextStageName
    ? `${nextStageName} 시작 →`
    : result.stageId === 1 ? "시놉시스 시작 →"
    : result.stageId === 2 ? "에셋 리스트 검토 →"
    : result.stageId <= 4 ? "이미지 생성 →"
    : "스타일 정의 →";

  const str = (v: unknown): string => (v ? String(v) : "");
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v as unknown[] : []);

  // ── 내러티브 요약 → 섹션 카드 렌더러 ──────────────────────────────────────────
  const renderNarrativeSummary = (text: string) => {
    const clean = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/^\s*[-·•]\s*/, "").trim();
    const SECTION_ICONS: [string, string][] = [
      ["시대", "🌍"], ["배경", "🌍"], ["세계", "🌍"],
      ["인물", "👤"], ["캐릭터", "👤"], ["등장인물", "👥"],
      ["장소", "🏙"], ["공간", "🏙"],
      ["갈등", "⚔️"], ["대립", "⚔️"], ["협력", "🤝"], ["연대", "🤝"],
      ["규칙", "📜"], ["법칙", "📜"],
      ["로그라인", "💡"], ["요약", "📝"],
      ["플롯", "📖"], ["전개", "📖"], ["기승전결", "📖"], ["시놉시스", "📖"],
      ["테마", "🎭"], ["주제", "🎭"],
      ["스타일", "🎨"], ["화풍", "🎨"], ["역할", "🎯"],
    ];
    const getIcon = (title: string) => {
      for (const [kw, icon] of SECTION_ICONS) if (title.includes(kw)) return icon;
      return "📋";
    };

    // 섹션 헤더 감지: ■ / ## / ### / ## ■ / • ### 등 혼합 패턴 모두 처리
    // 패턴: 선택적 bullet(•·) + 선택적 ##/### + 선택적 ■
    const HEADER_RE = /^(?:[ \t]*[•·][ \t]*)?(?:#{1,3}[ \t]*)?■|^(?:[ \t]*[•·][ \t]*)?#{1,3}[ \t]/;
    const hasAnyHeader = HEADER_RE.test(text) || /(?:^|\n)(?:[ \t]*[•·][ \t]*)?(?:#{1,3}[ \t]*)?■/m.test(text);

    const rawSections = hasAnyHeader
      ? text.split(/\n(?=(?:[ \t]*[•·][ \t]*)?(?:#{1,3}[ \t]*)?■|(?:[ \t]*[•·][ \t]*)?#{1,3}[ \t])/)
          .map(s => s.trim()).filter(Boolean)
      : [text.trim()].filter(Boolean);

    // 실제로 섹션 헤더로 시작하는 항목만 유효 섹션
    const validSections = rawSections.filter(s => HEADER_RE.test(s));

    if (validSections.length === 0) {
      // 섹션 없으면 단락 단위로 렌더
      return (
        <div style={{ background:"#10101c", borderRadius:12, padding:"16px 18px", border:`1px solid ${c}20` }}>
          {text.split(/\n{2,}/).map((para, i) => (
            <p key={i} style={{ fontSize:13, color:"#c8d0e0", lineHeight:1.85, marginBottom:10 }}>
              {clean(para)}
            </p>
          ))}
        </div>
      );
    }

    // 유효 섹션이 1개여도 카드로 렌더
    const sections = validSections;

    return (
      <div style={{ display:"flex", flexDirection:"column" as const, gap:10 }}>
        {sections.map((section, idx) => {
          const lines = section.split('\n');
          const titleRaw = lines[0];
          const title = clean(titleRaw
            .replace(/^[ \t]*[•·][ \t]*/, "")  // leading bullet
            .replace(/^#{1,3}[ \t]*/, "")        // ## / ###
            .replace(/^■[ \t]*/, ""));            // ■
          const bodyLines = lines.slice(1).filter(l => l.trim());
          const icon = getIcon(title);

          // 본문 내 **이름** 마커로 소항목 분리 (인물/장소 이름)
          const groups: Array<{ name?: string; lines: string[] }> = [];
          let cur: { name?: string; lines: string[] } = { lines: [] };
          for (const line of bodyLines) {
            const t = line.trim();
            if (!t) continue;
            const boldMatch = t.match(/^\*\*([^*]+)\*\*/);
            if (boldMatch) {
              if (cur.lines.length || cur.name) groups.push(cur);
              cur = { name: boldMatch[1].trim(), lines: [] };
            } else {
              cur.lines.push(clean(t));
            }
          }
          if (cur.lines.length || cur.name) groups.push(cur);

          return (
            <div key={idx} style={{ background:"#10101c", borderRadius:12, overflow:"hidden", border:`1px solid ${c}20` }}>
              <div style={{ background:`linear-gradient(90deg, ${c}15, transparent)`, borderBottom:`1px solid ${c}20`, padding:"10px 16px", display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:14 }}>{icon}</span>
                <span style={{ fontSize:12, fontWeight:800, color:c, letterSpacing:"0.4px", textTransform:"uppercase" as const }}>{title}</span>
              </div>
              <div style={{ padding:"12px 16px" }}>
                {groups.map((g, gi) => (
                  <div key={gi} style={{ marginBottom: g.name ? 14 : 0 }}>
                    {g.name && (
                      <div style={{ fontSize:13, fontWeight:700, color:"#e2e8f0", padding:"4px 0 6px", borderBottom:`1px solid #1e1e2a`, marginBottom:6 }}>
                        {g.name}
                      </div>
                    )}
                    {g.lines.map((item, ii) => (
                      <div key={ii} style={{ fontSize:13, color:"#c8d0e0", lineHeight:1.75, marginBottom:3, paddingLeft: g.name ? 6 : 0 }}>
                        {item.startsWith("•") || item.startsWith("-") ? item : `• ${item}`}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

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

  // ── 캐릭터 카드 ─────────────────────────────────────────────────────────────
  const CharCard = ({ ch, cardColor }: { ch: Record<string,string>; cardColor: string }) => {
    const initials = (ch.name ?? "?").slice(0, 2);
    const roleLabel = ch.role ?? "";
    const meta = [ch.gender, ch.age].filter(Boolean).join(" · ");
    const body = [ch.height, ch.build].filter(Boolean).join(", ");
    return (
      <div style={{ background:"#10101c", borderRadius:12, overflow:"hidden", marginBottom:12, border:`1px solid ${cardColor}22` }}>
        {/* 헤더 바 */}
        <div style={{ background:`linear-gradient(90deg, ${cardColor}22, transparent)`, borderBottom:`1px solid ${cardColor}22`, padding:"12px 16px", display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:40, height:40, borderRadius:"50%", background:`${cardColor}30`, border:`2px solid ${cardColor}60`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, color:cardColor, flexShrink:0 }}>{initials}</div>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>{ch.name}
              {roleLabel && <span style={{ fontSize:11, fontWeight:700, color:cardColor, marginLeft:10, background:`${cardColor}20`, padding:"2px 8px", borderRadius:20 }}>{roleLabel}</span>}
            </div>
            {meta && <div style={{ fontSize:12, color:"#64748b", marginTop:2 }}>{meta}</div>}
          </div>
        </div>
        {/* 내용 */}
        <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column" as const, gap:2 }}>
          <Field label="얼굴" val={ch.face} />
          <Field label="체형/복장" val={[body, ch.outfit].filter(Boolean).join(" — ") || undefined} />
          <Field label="성격" val={ch.personality} />
          <Field label="동기" val={ch.motivation} />
          <Field label="상처/비밀" val={ch.backstory} />
          <Field label="말투" val={ch.speech} />
          {ch.story_role && <Field label="서사 역할" val={ch.story_role} />}
        </div>
      </div>
    );
  };

  // ── 장소 카드 ─────────────────────────────────────────────────────────────
  const LocCard = ({ loc, cardColor }: { loc: Record<string,string>; cardColor: string }) => (
    <div style={{ background:"#10101c", borderRadius:12, overflow:"hidden", marginBottom:12, border:`1px solid ${cardColor}22` }}>
      <div style={{ background:`linear-gradient(90deg, ${cardColor}18, transparent)`, borderBottom:`1px solid ${cardColor}22`, padding:"12px 16px", display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ width:36, height:36, borderRadius:8, background:`${cardColor}20`, border:`1px solid ${cardColor}40`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>🏙</div>
        <div>
          <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>{loc.name}
            {loc.type && <span style={{ fontSize:11, color:"#64748b", marginLeft:8 }}>{loc.type}</span>}
          </div>
          {loc.significance && <div style={{ fontSize:12, color:`${cardColor}cc`, marginTop:2 }}>{loc.significance}</div>}
        </div>
      </div>
      <div style={{ padding:"12px 16px" }}>
        <Field label="시각" val={loc.visual} />
        <Field label="조명" val={loc.lighting} />
        <Field label="색채" val={loc.color_palette} />
        <Field label="분위기" val={loc.atmosphere} />
        <Field label="건축" val={loc.architecture} />
        <Field label="소리" val={loc.sound} />
        <Field label="주요 장면" val={loc.key_scenes} />
        <Field label="상징" val={loc.symbolic_meaning} />
      </div>
    </div>
  );

  // ── Stage별 내용 ─────────────────────────────────────────────────────────────

  const content = (() => {
    switch (result.stageId) {

      case 1: { // 세계관 — 5개 프레임워크
        const chars = arr(data.key_characters) as Record<string,string>[];
        const locs  = arr(data.key_locations)  as Record<string,string>[];
        const hasStructured = data.era || data.core_space || data.power_hierarchy || data.theme || chars.length > 0;
        // raw_summary만 있으면 narrative 카드 렌더
        if (!hasStructured && data.raw_summary) return renderNarrativeSummary(str(data.raw_summary));
        return (
          <>
            {/* ① 시대적·공간적 공기 */}
            {(data.era || data.core_space || data.daily_life) && (
              <>
                <SectionHeader icon="🌍" title="시대적·공간적 공기" />
                <div style={{ background:"#10101c", borderRadius:12, padding:"16px 18px", marginBottom:4, border:`1px solid ${c}20` }}>
                  <Field label="시대 배경" val={data.era} />
                  <Field label="핵심 공간" val={data.core_space} />
                  <Field label="생활감" val={data.daily_life} />
                </div>
              </>
            )}

            {/* ② 사회적 압박과 갈등 */}
            {(data.power_hierarchy || data.social_norms || data.taboo) && (
              <>
                <SectionHeader icon="⚔️" title="사회적 압박과 갈등" />
                <div style={{ background:"#10101c", borderRadius:12, padding:"16px 18px", marginBottom:4, border:`1px solid ${c}20` }}>
                  <Field label="계급·권력" val={data.power_hierarchy} />
                  <Field label="사회적 통념" val={data.social_norms} />
                  <Field label="금기 (Taboo)" val={data.taboo} />
                </div>
              </>
            )}

            {/* ③ 만약에 설정 */}
            {(data.what_if_rule || data.what_if_cost || data.what_if_who_knows) && (
              <>
                <SectionHeader icon="✨" title="만약에 설정 (What If)" />
                <div style={{ background:"#10101c", borderRadius:12, padding:"16px 18px", marginBottom:4, border:`1px solid ${c}20` }}>
                  <Field label="핵심 규칙" val={data.what_if_rule} />
                  <Field label="규칙의 대가" val={data.what_if_cost} />
                  <Field label="비밀의 공유" val={data.what_if_who_knows} />
                </div>
              </>
            )}

            {/* ④ 인물 관계의 역학 */}
            {(chars.length > 0 || data.character_backstory || data.goal_conflicts) && (
              <>
                <SectionHeader icon="👤" title={`인물 관계의 역학${chars.length > 0 ? ` (${chars.length}명)` : ""}`} />
                {chars.map((ch, i) => <CharCard key={i} ch={ch} cardColor={c} />)}
                {(data.character_backstory || data.goal_conflicts) && (
                  <div style={{ background:"#10101c", borderRadius:12, padding:"16px 18px", marginBottom:4, border:`1px solid ${c}20` }}>
                    <Field label="얽힌 과거사" val={data.character_backstory} />
                    <Field label="목표 충돌" val={data.goal_conflicts} />
                  </div>
                )}
              </>
            )}

            {/* 주요 장소 */}
            {locs.length > 0 && (
              <>
                <SectionHeader icon="🏙" title={`주요 장소 (${locs.length}곳)`} />
                {locs.map((l, i) => <LocCard key={i} loc={l} cardColor={c} />)}
              </>
            )}

            {/* ⑤ 테마 */}
            {data.theme && (
              <>
                <SectionHeader icon="🎭" title="메시지와 테마" />
                <div style={{ background:`${c}10`, border:`1px solid ${c}30`, borderRadius:12, padding:"16px 18px", marginBottom:4 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:"#f1f5f9", lineHeight:1.75 }}>{str(data.theme)}</div>
                </div>
              </>
            )}

            {data.raw_summary && renderNarrativeSummary(str(data.raw_summary))}
          </>
        );
      }

      case 2: { // 시놉시스 — 새 스키마
        const protagonist  = data.protagonist as Record<string,string> | null ?? null;
        const storyArc     = data.story_arc   as Record<string,string> | null ?? null;
        const worldRules   = Array.isArray(data.world_rules) ? (data.world_rules as string[]) : [];
        const chars        = arr(data.characters)  as Record<string,string>[];
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
                  </div>
                ))}
              </>
            )}
            {data.raw_summary && renderNarrativeSummary(str(data.raw_summary))}
          </>
        );
      }

      case 3: { // 캐릭터 설정
        const chars = arr(data.characters) as Record<string,string>[];
        return (
          <>
            {chars.length > 0
              ? chars.map((ch, i) => <CharCard key={i} ch={ch} cardColor={c} />)
              : data.raw_summary && renderNarrativeSummary(str(data.raw_summary))
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
              : data.raw_summary && renderNarrativeSummary(str(data.raw_summary))
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
              : data.raw_summary && renderNarrativeSummary(str(data.raw_summary))
            }
          </>
        );
      }

      default: return null;
    }
  })();

  return (
    <div style={{ margin:"24px 0 8px" }}>
      {/* ── 완료 배너 ── */}
      <div style={{ background:`linear-gradient(90deg, ${c}18, ${c}08, transparent)`, border:`1px solid ${c}30`, borderRadius:12, padding:"14px 20px", marginBottom:20, display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ width:36, height:36, borderRadius:10, background:`${c}30`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>✓</div>
        <div>
          <div style={{ fontSize:15, fontWeight:800, color:c }}>{stage.name} 완료</div>
          <div style={{ fontSize:12, color:"#64748b", marginTop:2 }}>토론 결과가 정리되었습니다. 내용을 확인하고 다음 단계로 진행하세요.</div>
        </div>
      </div>

      {/* ── 내용 ── */}
      <div style={{ padding:"0 4px" }}>
        {content}

        {/* ── 액션 버튼 ── */}
        <div style={{ display:"flex", flexDirection:"column" as const, gap:8, marginTop:20 }}>
          {isViewMode ? (
            /* 뷰 모드: 이어서 토론 / 새로 토론하기 */
            <div style={{ display:"flex", gap:10 }}>
              <button
                onClick={onNewDebate}
                style={{ flex:1, padding:"12px 0", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer", background:"transparent", border:"1px solid #3a2a2a", color:"#f87171", transition:"all 0.15s" }}>
                🗑 새로 토론
              </button>
              <button
                onClick={onContinueDebate}
                style={{ flex:2, padding:"12px 0", borderRadius:10, fontSize:13, fontWeight:800, cursor:"pointer", background:`linear-gradient(135deg, ${c}dd, ${c})`, border:"none", color:"#0a0a14", boxShadow:`0 4px 20px ${c}40` }}>
                ↩ 이어서 토론
              </button>
            </div>
          ) : (
            /* 인라인 모드: 계속 토론 / 다음 단계 */
            <div style={{ display:"flex", gap:10 }}>
              <button
                onClick={onContinueDebate}
                style={{ flex:1, padding:"12px 0", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer", background:"transparent", border:"1px solid #2a2a3d", color:"#64748b", transition:"border-color 0.15s" }}>
                ✎ 계속 토론
              </button>
              <button
                onClick={onNextStage}
                style={{ flex:2, padding:"12px 0", borderRadius:10, fontSize:14, fontWeight:800, cursor:"pointer", background:`linear-gradient(135deg, ${c}dd, ${c})`, border:"none", color:"#0a0a14", boxShadow:`0 4px 20px ${c}40` }}>
                {nextBtnLabel}
              </button>
            </div>
          )}
          {/* ── 다시 분석 버튼 ── */}
          <button
            disabled={reanalyzing}
            onClick={async () => {
              setReanalyzing(true);
              try { await onReanalyze?.(); } finally { setReanalyzing(false); }
            }}
            style={{ width:"100%", padding:"10px 0", borderRadius:10, fontSize:12, fontWeight:700, cursor: reanalyzing ? "default" : "pointer", background:"rgba(255,255,255,0.03)", border:"1px solid #252535", color: reanalyzing ? "#3a3a52" : "#64748b", transition:"all 0.15s", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
            {reanalyzing
              ? <><span style={{ display:"inline-block", animation:"spin 1s linear infinite" }}>⟳</span> 분석 중...</>
              : "🔄 기존 내용 다시 분석"}
          </button>
        </div>
      </div>
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
            <span className={s.msgText} style={{ whiteSpace: "pre-wrap" }}>{renderMsgText(msg.text)}{msg.streaming && <StreamCursor />}</span>
          )}
          {msg.imageUrl && (
            <img src={msg.imageUrl} alt="concept art"
              style={{ display: "block", maxWidth: 320, width: "100%", borderRadius: 8, marginTop: 10, border: "1px solid #2a2a3d", objectFit: "cover" }}
            />
          )}
        </div>
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
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [debatePhase, setDebatePhase] = useState<DebatePhase>("idle");
  const [currentStageIdx, setCurrentStageIdx] = useState(0); // index into STAGES
  const [stageResults, setStageResults] = useState<StageResult[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [coveredAgendaIds, setCoveredAgendaIds] = useState<string[]>([]); // 완료된 아젠다 항목
  const [agendaTurnCounts, setAgendaTurnCounts] = useState<Record<string, number>>({}); // 항목별 누적 턴수
  const [debateModel, setDebateModel] = useState<DebateModelP2>("claude-sonnet-4-6"); // 모델 선택
  const [rejectedItems, setRejectedItems] = useState<string[]>([]); // 블랙리스트
  const rejectedItemsRef = useRef<string[]>([]);
  const [replyTo, setReplyTo] = useState<{ msg: Msg; agentLabel: string; preview: string } | null>(null); // reply-to
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [stageHistoryMsgs, setStageHistoryMsgs] = useState<Record<number, Msg[]>>({}); // 단계별 토론 기록

  // ── 시놉시스 4단계 워크플로우 State ──
  type SynopsisStep = "idle" | "learning" | "persona" | "logline" | "completing";
  const [synopsisStep, setSynopsisStep] = useState<SynopsisStep>("idle");
  const [synopsisLoglines, setSynopsisLoglines] = useState<string[]>([]);
  const [selectedLogline, setSelectedLogline] = useState<string>("");
  const synopsisStepRef = useRef<SynopsisStep>("idle");
  // logline 선택을 기다리는 Promise resolver
  const loglineResolverRef = useRef<((logline: string) => void) | null>(null);

  // ── 에셋 리스트 단계 State (Stage 2 완료 후 스타일 전 삽입) ──
  type AssetListPhase = "idle" | "reviewing" | "confirmed";
  const [assetListPhase, setAssetListPhase] = useState<AssetListPhase>("idle");
  const [editableAssets, setEditableAssets] = useState<SynopsisAssets>({ characters: [], locations: [], props: [] });
  // 각 섹션별 새 항목 입력값
  const [newCharInput, setNewCharInput] = useState("");
  const [newLocInput, setNewLocInput] = useState("");
  const [newPropInput, setNewPropInput] = useState("");

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

  // ── Refs ──
  const bottomRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const abortRef = useRef(false);
  const pendingUserMsgRef = useRef<string | null>(null);
  const convRef = useRef<string[]>([]); // transcript: 각 에이전트 발언 문자열 배열
  const stageResultsRef = useRef<StageResult[]>([]);
  const msgsRef = useRef<Msg[]>([]); // msgs의 최신값 추적용
  const resumeDataRef = useRef<{ transcript: string[]; msgs: Msg[] } | null>(null);
  const p1DataRef = useRef<P1Data | null>(null); // Phase 1 분석 결과 인계용
  const styleRunningRef = useRef(false);
  const styleConvRef = useRef<string[]>([]);
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

      // 에셋 리스트 복원
      const savedAssets = localStorage.getItem(`wts_asset_list_${projectId}`);
      if (savedAssets) {
        const parsed = JSON.parse(savedAssets) as SynopsisAssets;
        synopsisAssetsRef.current = parsed;
        setEditableAssets(parsed);
        setAssetListPhase("confirmed");
      }

      // 확정된 스타일 복원
      const savedStyle = localStorage.getItem(`wts_style_${projectId}`);
      if (savedStyle) { setConceptStyle(savedStyle); setStyleInput(savedStyle); setStylePhase("confirmed"); }

      const savedData = localStorage.getItem(`wts_phase2_${projectId}`);
      if (savedData) {
        const parsed = JSON.parse(savedData) as { stageResults: StageResult[]; currentStageIdx: number; stageHistoryMsgs?: Record<number, Msg[]> };
        if (parsed.stageResults?.length) {
          stageResultsRef.current = parsed.stageResults;
          setStageResults(parsed.stageResults);
          if (parsed.stageHistoryMsgs) setStageHistoryMsgs(parsed.stageHistoryMsgs);
          const idx = parsed.currentStageIdx ?? 0;
          setCurrentStageIdx(idx);
          if (idx >= STAGES.length) {
            setDebatePhase("done");
          } else {
            // 진행 중인 토론이 저장되어 있으면 "이어하기" 상태로
            const savedConv = localStorage.getItem(`p2_conv_${idx}_${projectId}`);
            const savedMsgs = localStorage.getItem(`p2_msgs_${idx}_${projectId}`);
            if (savedConv && savedMsgs) {
              resumeDataRef.current = {
                transcript: JSON.parse(savedConv) as string[],
                msgs: JSON.parse(savedMsgs) as Msg[],
              };
              setDebatePhase("paused");
            } else {
              setDebatePhase("confirmed");
            }
          }
          return;
        }
      }
    } catch { /* ignore */ }
  }, [projectId]);

  useEffect(() => { msgsRef.current = msgs; }, [msgs]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  useEffect(() => {
    if (debatePhase === "confirmed") {
      setTimeout(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, 100);
    }
  }, [debatePhase]);

  useEffect(() => {
    if (!projectId || msgs.length === 0) return;
    if (msgs.some((m: Msg) => m.streaming)) return;
    localStorage.setItem(`p2_msgs_${projectId}`, JSON.stringify(msgs));
  }, [msgs, projectId]);

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
        ...names(s1d?.key_characters, "name"),
        ...names(s2d?.characters, "name"),
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
    let naturalExit = false;
    // 이 스테이지의 아젠다 항목 수 × 최소 턴 + 여유
    const stageAgenda = STAGE_AGENDA[stage.id] ?? [];
    const minTurnsForStage = MIN_TURNS_BY_STAGE[stage.id] ?? MIN_TURNS_PER_TOPIC_P2;
    // Stage 1: 5개 프레임워크 × 3 + 20 = 35턴 상한 (오케스트레이터가 전환 관리)
    const WRAP_UP_AFTER = stage.id === 1 ? 35 : stageAgenda.length * minTurnsForStage + 10;
    const WRAP_UP_AUTO_MS = 30_000;
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

    // Phase 2 에이전트 동적 선택
    const P2_AGENTS: AgentId[] = ["worldbuilder", "character", "scenario", "script", "editor"];
    let agentIndex = 0;
    let lastSpeaker: AgentId | null = null;

    function pickNextSpeaker(lastLine: string, last: AgentId | null): AgentId {
      const available = P2_AGENTS.filter(a => a !== last);
      if (!available.length) return P2_AGENTS[0];
      const lower = lastLine.toLowerCase();
      // 키워드 매칭: 주제에 맞는 전문가 우선
      if (/세계|배경|규칙|설정|시대|문명|마법|공간/.test(lower) && available.includes("worldbuilder")) return "worldbuilder";
      if (/캐릭터|인물|주인공|감정|성격|외형|말투|빌런/.test(lower) && available.includes("character")) return "character";
      if (/이야기|서사|플롯|갈등|전개|장르|훅|전제/.test(lower) && available.includes("scenario")) return "scenario";
      if (/그림|연출|장면|시각|컷|화면|비주얼|그려/.test(lower) && available.includes("script")) return "script";
      if (/편집|구조|흐름|전반적|연결/.test(lower) && available.includes("editor")) return "editor";
      // 매칭 없으면: editor는 3턴에 한 번꼴로만 끼어들게 (흐름 끊지 않도록)
      const nonEditor = available.filter(a => a !== "editor");
      const pool = (nonEditor.length > 0 && agentIndex % 3 !== 2) ? nonEditor : available;
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

    // 단일 에이전트 타이프라이터 효과 (백그라운드 스트림 → 재생)
    const runSingleAgent = async (agentId: AgentId, userContent: string, tokens: number) => {
      const key = getAnthropicKeyByIndex(getApiKeyIndexForAgent(agentIndex));
      if (!key) return;
      const msgId = addMsg(agentId, "", true);
      let text = "";
      try {
        for await (const chunk of streamClaude({
          apiKey: key,
          model: debateModel,
          systemPrompt: buildSingleAgentPrompt(stage.id, genre, agentId, stageResultsRef.current, p1DataRef.current, rejectedItemsRef.current, synopsisAssetsRef.current),
          messages: [{ role: "user", content: userContent }],
          maxTokens: tokens,
          tools: [],
        })) {
          if (abortRef.current) break;
          text += chunk;
        }
      } catch (err) {
        setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== msgId));
        const raw = err instanceof Error ? err.message : String(err);
        if (!raw.includes("abort") && !abortRef.current) setApiError(`API 오류: ${raw}`);
        return;
      }
      const clean = text.trim().replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/[#>_`]/g, "");
      if (!clean) { setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== msgId)); return; }
      // 타이프라이터: 2자씩 120ms
      const CHARS = 2; const TICK = 120;
      for (let i = CHARS; i < clean.length; i += CHARS) {
        if (abortRef.current) break;
        updateMsg(msgId, clean.slice(0, i), true);
        await sleep(TICK);
      }
      updateMsg(msgId, clean, false);
      transcript.push(`[${AGENTS[agentId].label}]: ${clean}`);
      convRef.current = transcript;
      agentIndex++;
      lastSpeaker = agentId;
      // 진행 저장 (이어하기 지원)
      try {
        localStorage.setItem(`p2_conv_${stageIdx}_${projectId}`, JSON.stringify(transcript));
        localStorage.setItem(`p2_msgs_${stageIdx}_${projectId}`, JSON.stringify(msgsRef.current.filter((m: Msg) => !m.streaming)));
      } catch { /* ignore */ }
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

        for (const { agent, prompt } of synopsisTopics) {
          if (abortRef.current) break;
          // 사용자 입력 폴링 (6초)
          const ws = Date.now();
          while (Date.now() - ws < 6000) {
            if (abortRef.current || pendingUserMsgRef.current) break;
            await sleep(200);
          }
          const pendingMsg2 = pendingUserMsgRef.current;
          if (pendingMsg2) {
            pendingUserMsgRef.current = null;
            transcript.push(`[사용자]: ${pendingMsg2}`);
            convRef.current = transcript;
            await runSingleAgent("scenario",
              `${histText()}사용자가 "${pendingMsg2}" 라고 했어. 이 의견을 충분히 반영해서 시놉시스 논의를 이어가줘.`,
              300);
          }
          await runSingleAgent(agent, prompt, 400);
        }
        if (abortRef.current) throw new Error("abort");

        // 에셋 리스트 확정 요청
        await runSingleAgent("producer",
          `${histText()}시놉시스 완성됐어. 이제 이미지 생성을 위해 이야기에 등장하는 모든 인물, 장소, 소품, 핵심 장면 목록을 간략히 정리해줘. 각각 이름 + 한 줄 시각적 특징. 마크다운 금지.`,
          400);
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
              characters: [...new Set([...prev.characters, ...ns(data.characters, "name")])],
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

    try {
      debateLoop: while (true) {
        if (abortRef.current) break;

        const agentTurnsSoFar = transcript.filter(l => !l.startsWith("[사용자]")).length;

        // 자동 마무리: wrapUp 제안 후 30초 동안 응답 없으면 자동 종료
        if (wrapUpProposed && !pendingUserMsgRef.current && Date.now() - wrapUpProposedAt > WRAP_UP_AUTO_MS) {
          addMsg("producer", "그럼 이 단계 확인하고 넘어갈게요.", false);
          transcript.push(`[총괄프로듀서]: 그럼 이 단계 확인하고 넘어갈게요.`);
          convRef.current = transcript;
          await sleep(1500);
          naturalExit = true;
          break debateLoop;
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
          }
          matchedCmd = matchCommandP2(pendingMsg);
          if (matchedCmd?.handler === "end") { naturalExit = true; break debateLoop; }
        }

        // 주기적 요약 + 결정사항 갱신 (5턴마다)
        turnsSinceLastSummary++;
        if (turnsSinceLastSummary >= 5) { refreshSummary(); refreshDecisions(); turnsSinceLastSummary = 0; }

        // 히스토리 텍스트 구성
        const lastLine = transcript.filter(l => !l.startsWith("[사용자]")).slice(-1)[0] ?? "";
        const decisionsBlock = [
          stageDecisions.agreed.length   > 0 ? `[✅ 합의된 내용]\n${stageDecisions.agreed.map(d => `• ${d}`).join("\n")}` : "",
          stageDecisions.rejected.length > 0 ? `[❌ 거부된 방향]\n${stageDecisions.rejected.map(d => `• ${d}`).join("\n")}` : "",
          stageDecisions.pending.length  > 0 ? `[⏳ 미결 쟁점]\n${stageDecisions.pending.map(d => `• ${d}`).join("\n")}` : "",
        ].filter(Boolean).join("\n");
        const historyText = conversationSummary
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

        // 오케스트레이터 조율 — 주제 전환 + 진행 상황 공지
        if (nudgeCooldown > 0) {
          nudgeCooldown--;
        } else if (agentTurnsSoFar > 0) {
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
            lastSpeaker = "producer";
            nudgeCooldown = 2;
            continue;
          }
        }

        // 마무리 조건 체크 — 모든 아젠다 완료 or WRAP_UP_AFTER 턴 초과
        const allCovered = stageAgenda.length > 0 && coveredAgenda.size >= stageAgenda.length;
        // Stage 1: 최소 10턴 이상 + 모든 항목 완료 시 수렴 신호 1개만 있어도 마무리
        const minTurnsForConverge = stage.id === 1 ? 10 : 8;
        const converging = agentTurnsSoFar >= minTurnsForConverge && (
          stage.id === 1
            ? (recentLines.match(/정리|결론|충분|이 정도|마무리|확인|다음 단계|좋아|됐어|완성/g) ?? []).length >= 1
            : (recentLines.match(/정리|결론|충분|이 정도|마무리|확인|다음 단계/g) ?? []).length >= 2
        );

        if (!wrapUpProposed && (agentTurnsSoFar >= WRAP_UP_AFTER || (allCovered && converging))) {
          wrapUpProposed = true;
          wrapUpProposedAt = Date.now();
          const coveredLabels = stageAgenda.map(i => i.label);
          const wrapUpIntro = stage.id === 1
            ? `5개 프레임워크 — "${coveredLabels.join('", "')}" — 모두 충분히 다뤘어.`
            : `이 단계의 항목들 — "${coveredLabels.join('", "')}" — 충분히 다뤘어.`;
          await runSingleAgent("producer",
            `${historyText}${wrapUpIntro} 프로듀서로서 이 단계를 마무리하자고 자연스럽게 제안해줘. 1~2문장.`,
            180);
          lastSpeaker = "producer";
          continue;
        }

        // 다음 발언자 선택 및 실행
        const isFirst = agentTurnsSoFar === 0;
        const nextAgent = isFirst ? "worldbuilder" : pickNextSpeaker(lastLine, lastSpeaker);

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

        // 에셋 목록 즉시 누적 (handleConfirm과 동일)
        setEditableAssets((prev: SynopsisAssets) => {
          const names = (arr: unknown, key: string): string[] =>
            Array.isArray(arr) ? (arr as Record<string, string>[]).map(x => x[key]).filter(Boolean) : [];
          let chars = [...prev.characters];
          let locs   = [...prev.locations];
          let props  = [...prev.props];
          if (stage.id === 1) {
            chars = [...new Set([...chars, ...names(data.key_characters, "name")])];
            locs  = [...new Set([...locs,  ...names(data.key_locations,  "name")])];
          } else if (stage.id === 3) {
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
            currentStageIdx: stageIdx + 1,
            stageHistoryMsgs: next,
          }));
          return next;
        });

        setDebatePhase("confirmed");
      }
    }
  }, [genre, addMsg, updateMsg, projectId]);

  // ── Asset List Review: 에셋 목록 확인 (Stage 2 완료 후, 스타일 전) ──
  const runAssetListReview = useCallback(async () => {
    // editableAssets는 이미 각 스테이지 확정 시 누적됨 — synopsisAssetsRef는 AI fallback
    // setEditableAssets는 이미 최신 상태이므로 덮어쓰지 않음 (synopsisAssets가 있을 때만 병합)
    if (synopsisAssetsRef.current) {
      const syn = synopsisAssetsRef.current;
      setEditableAssets((prev: SynopsisAssets) => ({
        characters: [...new Set([...prev.characters, ...syn.characters])],
        locations:  [...new Set([...prev.locations,  ...syn.locations])],
        props:      [...new Set([...prev.props,      ...syn.props])],
      }));
    }
    setAssetListPhase("reviewing");

    // Producer announces the asset list review
    setMsgs([]);
    convRef.current = [];
    const msgId = addMsg("producer", "", true);
    const text = "시놉시스에서 에셋 목록을 뽑았어. 이걸 기준으로 캐릭터/장소/소품을 설계할 거야. 빠진 거 있으면 추가해줘.";
    for (let i = 2; i < text.length; i += 2) {
      await new Promise<void>(r => setTimeout(r, 80));
      setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === msgId ? { ...m, text: text.slice(0, i), streaming: true } : m));
    }
    setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === msgId ? { ...m, text, streaming: false } : m));
  }, [addMsg]);

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
          systemPrompt: "이미지 생성 프롬프트 전문가.",
          messages: [{
            role: "user",
            content:
              `다음 스타일 토론 내용을 영문 이미지 생성 스타일 키워드로 40~70단어 이내로 정리하세요.\n` +
              `예시: "Korean webtoon line art, dark fantasy, detailed ink lines, muted earth tones with glowing blue accents, dramatic shadows, cinematic widescreen"\n` +
              `[토론]\n${transcript.join("\n")}\n\n영문 키워드만 출력. 설명 없이.`,
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

  // ── Style: 확정 & Stage 3 진행 ──
  const confirmStyle = useCallback(() => {
    const style = styleInput.trim() || conceptStyle;
    setConceptStyle(style);
    localStorage.setItem(`wts_style_${projectId}`, style);
    setStylePhase("confirmed");
    setMsgs([]);
    convRef.current = [];
    setCurrentStageIdx(2);
    setDebatePhase("idle");
    void runDebate(2);
  }, [styleInput, conceptStyle, projectId, runDebate]);

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
        }).then(r => r.json() as Promise<{ imageUrl: string; prompt: string }>)
      )
    );

    const updatedConcepts: ImageConcept[] = LABELS.map((label, i) => {
      const r = results[i];
      if (r.status === "fulfilled") {
        return { ...initConcepts[i], imageUrl: r.value.imageUrl, prompt: r.value.prompt, generating: false };
      }
      return { ...initConcepts[i], generating: false, error: "생성 실패" };
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
    const synopsisCtx = stageResultsRef.current.find((r: StageResult) => r.stageId === 2)?.summary;

    const { data, summary } = await extractStageData(stage, genre, debateText, apiKey, synopsisCtx);

    updateMsg(extractId, "", false);
    setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== extractId));

    // 확정 완료 → in-progress 대화 삭제
    localStorage.removeItem(`p2_conv_${stageIdx}_${projectId}`);
    localStorage.removeItem(`p2_msgs_${stageIdx}_${projectId}`);

    const result: StageResult = { stageId: stage.id, data, summary };
    const newResults = [...stageResultsRef.current, result];
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
        currentStageIdx: stageIdx + 1,
        stageHistoryMsgs: next,
      }));
      return next;
    });

    setDebatePhase("confirmed");
  }, [genre, projectId, addMsg, updateMsg]);

  // ── Move to next stage (only via button) ──
  const handleNextStage = useCallback((stageIdx: number) => {
    // Stage 2(index=1) 완료 후 → 에셋 리스트 검토 → 스타일 정의 단계
    if (stageIdx === 1) {
      setMsgs([]);
      convRef.current = [];
      if (assetListPhase === "idle") {
        // Start asset list review first
        void runAssetListReview();
      } else if (assetListPhase === "confirmed" && stylePhase === "idle") {
        setStylePhase("debating");
        void runStyleDebate();
      }
      return;
    }
    // Stage 3/4/5(index=2/3/4) 완료 후 → 이미지 생성 단계 삽입
    if (stageIdx >= 2) {
      enterImageGenPhase(stageIdx);
      return;
    }
    const nextIdx = stageIdx + 1;
    setMsgs([]);
    convRef.current = [];
    setCurrentStageIdx(nextIdx);
    if (nextIdx >= STAGES.length) {
      setDebatePhase("done");
    } else {
      void runDebate(nextIdx);
    }
  }, [runDebate, runStyleDebate, runAssetListReview, stylePhase, assetListPhase, enterImageGenPhase]);

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
    const synopsisCtx = stageResultsRef.current.find((r: StageResult) => r.stageId === 2)?.summary;
    const { data, summary } = await extractStageData(stage, genre, debateText, apiKey, synopsisCtx);

    // 해당 스테이지 결과 교체
    const result: StageResult = { stageId: stage.id, data, summary };
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
          ...ns(s1d?.key_characters, "name"),
          ...ns(s2d?.characters, "name"),
          ...ns(s3d?.characters, "name"),
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
    setMsgs([]);
    setStageResults(keptResults);
    setStageHistoryMsgs(keptHistory);
    setApiError(null);
    setSynopsisStep("idle");
    setSynopsisLoglines([]);
    setSelectedLogline("");
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
    // resume 데이터로 저장 (mount 시 자동 복원)
    try {
      localStorage.setItem(`p2_conv_${stageIdx}_${projectId}`, JSON.stringify(transcript));
      localStorage.setItem(`p2_msgs_${stageIdx}_${projectId}`, JSON.stringify(histMsgs));
      const saved = localStorage.getItem(`wts_phase2_${projectId}`);
      const parsed = saved ? JSON.parse(saved) as Record<string, unknown> : {};
      localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({ ...parsed, currentStageIdx: stageIdx }));
    } catch { /* ignore */ }
    window.location.href = `/projects/${projectId}/phase-2`;
  }, [projectId, stageHistoryMsgs]);

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
            <div style={{ flex: 1, overflowY: "auto", padding: "0 0 60px" }}>
              {histMsgs.length > 0
                ? histMsgs.map((m: Msg) => <MsgBubble key={m.id} msg={m} />)
                : <div style={{ padding: "40px 20px", textAlign: "center", color: "#3a3a52", fontSize: 13 }}>토론 기록이 없습니다.</div>
              }
              {/* 인라인 보고서 */}
              <StageReportInChat
                result={viewResult}
                stage={viewStageObj}
                onNextStage={() => { window.location.href = `/projects/${projectId}/phase-2`; }}
                onContinueDebate={() => handleResumeStageFromView(stageIdx)}
                onNewDebate={() => handleRestartStageFromView(stageIdx)}
                nextStageName={stageIdx + 1 < STAGES.length ? STAGES[stageIdx + 1].name : null}
                onReanalyze={() => handleReanalyze(stageIdx)}
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

              const AssetCard = ({ item, color }: { item: Record<string, string>; color: string }) => {
                const hasDetail = !!(item.face || item.outfit || item.personality || item.visual || item.atmosphere || item.one_line || item.motivation || item.significance || item.description);
                return (
                  <div style={{ background: "#12121e", borderRadius: 12, overflow: "hidden", marginBottom: 10, border: `1px solid ${color}22` }}>
                    <div style={{ background: `linear-gradient(90deg, ${color}18, transparent)`, borderBottom: `1px solid ${color}20`, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: "50%", background: `${color}25`, border: `1px solid ${color}50`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color, flexShrink: 0 }}>
                        {(item.name ?? "?").slice(0, 2)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#f1f5f9" }}>
                          {item.name}
                          {item.role && <span style={{ fontSize: 11, color, marginLeft: 8, fontWeight: 700, background: `${color}18`, padding: "1px 6px", borderRadius: 99 }}>{item.role}</span>}
                          {item.type && <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>{item.type}</span>}
                        </div>
                        {(item.one_line ?? item.characteristics) && (
                          <div style={{ fontSize: 11, color: "#9a9abf", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                            {item.one_line ?? item.characteristics}
                          </div>
                        )}
                      </div>
                      {!hasDetail && <span style={{ fontSize: 10, color: "#2a2a3d", flexShrink: 0 }}>기본 정보</span>}
                    </div>
                    {hasDetail && (
                      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column" as const, gap: 3 }}>
                        {item.face && <div style={{ fontSize: 11, color: "#9a9abf" }}><span style={{ color: "#4a4a68", marginRight: 6, fontWeight: 700 }}>얼굴</span>{item.face}</div>}
                        {item.outfit && <div style={{ fontSize: 11, color: "#9a9abf" }}><span style={{ color: "#4a4a68", marginRight: 6, fontWeight: 700 }}>복장</span>{item.outfit}</div>}
                        {item.personality && <div style={{ fontSize: 11, color: "#9a9abf" }}><span style={{ color: "#4a4a68", marginRight: 6, fontWeight: 700 }}>성격</span>{item.personality}</div>}
                        {item.motivation && <div style={{ fontSize: 11, color: "#9a9abf" }}><span style={{ color: "#4a4a68", marginRight: 6, fontWeight: 700 }}>동기</span>{item.motivation}</div>}
                        {item.visual && <div style={{ fontSize: 11, color: "#9a9abf" }}><span style={{ color: "#4a4a68", marginRight: 6, fontWeight: 700 }}>시각</span>{item.visual}</div>}
                        {item.atmosphere && <div style={{ fontSize: 11, color: "#9a9abf" }}><span style={{ color: "#4a4a68", marginRight: 6, fontWeight: 700 }}>분위기</span>{item.atmosphere}</div>}
                        {item.significance && <div style={{ fontSize: 11, color: "#9a9abf" }}><span style={{ color: "#4a4a68", marginRight: 6, fontWeight: 700 }}>의미</span>{item.significance}</div>}
                        {item.function && <div style={{ fontSize: 11, color: "#9a9abf" }}><span style={{ color: "#4a4a68", marginRight: 6, fontWeight: 700 }}>기능</span>{item.function}</div>}
                      </div>
                    )}
                  </div>
                );
              };

              // editableAssets names와 상세 데이터 매핑 (이름 기준)
              const Section = ({ label, color, items, names }: { label: string; color: string; items: Record<string,string>[]; names: string[] }) => {
                // 이름 목록 = editableAssets names ∪ 상세 데이터 이름 (누락 없이)
                const allNames = [...new Set([...names, ...items.map(it => it.name).filter(Boolean)])];
                const resolved = allNames.map(n => items.find(it => it.name === n) ?? { name: n });
                return (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color, letterSpacing: "0.6px", textTransform: "uppercase" as const, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                      {label}
                      <span style={{ background: `${color}20`, color, borderRadius: 99, padding: "1px 8px", fontSize: 10 }}>{resolved.length}</span>
                    </div>
                    {resolved.length === 0
                      ? <div style={{ fontSize: 12, color: "#3a3a52", padding: "8px 0" }}>(없음)</div>
                      : resolved.map((it, i) => <AssetCard key={i} item={it} color={color} />)
                    }
                  </div>
                );
              };

              return (
                <div>
                  <Section label="캐릭터" color="#fb923c" items={charData} names={editableAssets.characters} />
                  <Section label="장소" color="#a78bfa" items={locData} names={editableAssets.locations} />
                  <Section label="소품·장비" color="#e879f9" items={propData} names={editableAssets.props} />
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

  if (debatePhase === "idle") {
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
              return (
                <div key={st.id} className={`${s.stepItem} ${isDone ? s.stepDone : ""} ${isActive ? s.stepActive : ""}`}>
                  <div className={s.stepDot} style={isDone || isActive ? { background:st.color } : {}} />
                  <span className={s.stepLabel} style={isDone || isActive ? { color:st.color } : {}}>{st.name}</span>
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
            <div style={{ display: "flex", gap: 6, padding: "4px 16px 0", overflowX: "auto", flexShrink: 0 }}>
              {imageItems.map((item: ImageItem, i: number) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "3px 8px", borderRadius: 6, flexShrink: 0,
                  background: i === currentImageItemIdx ? "rgba(124,108,252,0.15)" : item.confirmed ? "rgba(52,211,153,0.08)" : "transparent",
                  border: `1px solid ${i === currentImageItemIdx ? "#7c6cfc" : item.confirmed ? "#34d399" : "#2a2a3d"}`,
                  fontSize: 11, color: i === currentImageItemIdx ? "#7c6cfc" : item.confirmed ? "#34d399" : "#4a4a6a",
                }}>
                  {item.confirmed ? "✓" : i === currentImageItemIdx ? "→" : "·"} {item.name}
                  {i === currentImageItemIdx && imageRoundNum > 1 && (
                    <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 2 }}>R{imageRoundNum}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <button className={s.btnRestart} onClick={handleRestartNew} style={{ flexShrink:0, marginLeft:12 }}>↺ 초기화</button>
        </div>

        {/* 아젠다 체크리스트 + 블랙리스트 — 토론 중일 때만 표시 */}
        {debatePhase === "running" && (() => {
          const currentStageId = STAGES[currentStageIdx]?.id;
          const stageAgendaItems = STAGE_AGENDA[currentStageId] ?? [];
          const minTurnsUI = MIN_TURNS_BY_STAGE[currentStageId] ?? MIN_TURNS_PER_TOPIC_P2;
          return (
            <div style={{
              display: "flex", gap: 4, padding: "6px 12px", flexWrap: "wrap", alignItems: "center",
              background: "rgba(15,20,40,0.6)", borderBottom: "1px solid rgba(99,102,241,0.15)",
            }}>
              {stageAgendaItems.map((item) => {
                const covered = coveredAgendaIds.includes(item.id);
                const turns = agendaTurnCounts[item.id] ?? 0;
                const progress = Math.min(turns, minTurnsUI);
                // Stage 2: 현재 진행 중인 단계 하이라이트
                const isSynStep = currentStageId === 2;
                const isActive = isSynStep && (
                  (item.id === "step_learning"  && synopsisStep === "learning") ||
                  (item.id === "step_persona"   && synopsisStep === "persona") ||
                  (item.id === "step_logline"   && synopsisStep === "logline") ||
                  (item.id === "step_synopsis"  && synopsisStep === "completing")
                );
                return (
                  <div key={item.id} style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "2px 8px", borderRadius: 99, fontSize: 11,
                    background: covered ? "rgba(52,211,153,0.2)" : isActive ? "rgba(52,211,153,0.1)" : turns > 0 ? "rgba(99,102,241,0.1)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${covered ? "rgba(52,211,153,0.5)" : isActive ? "rgba(52,211,153,0.3)" : "transparent"}`,
                    color: covered ? "#34d399" : isActive ? "#6ee7b7" : turns > 0 ? "rgba(165,180,252,0.6)" : "rgba(255,255,255,0.3)",
                    transition: "all 0.5s",
                    fontWeight: isActive ? 700 : 400,
                  }}>
                    <span>{covered ? "✓" : isActive ? "▶" : "○"}</span>
                    <span>{item.label}</span>
                    {!isSynStep && (
                      <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 2 }}>
                        {progress}/{minTurnsUI}
                      </span>
                    )}
                  </div>
                );
              })}
              {/* 블랙리스트 태그 */}
              {rejectedItems.length > 0 && (
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color: "rgba(248,113,113,0.6)" }}>차단:</span>
                  {rejectedItems.map((w) => (
                    <span key={w}
                      title="클릭해서 차단 해제"
                      onClick={() => {
                        const next = rejectedItems.filter(x => x !== w);
                        setRejectedItems(next); rejectedItemsRef.current = next;
                        if (next.length === 0) localStorage.removeItem(`p2_rejected_${projectId}`);
                      }}
                      style={{ fontSize: 10, padding: "1px 7px", borderRadius: 99, cursor: "pointer",
                        background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171" }}>
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

        <div className={s.chatBody}>
          {msgs.map((m: Msg) => <MsgBubble key={m.id} msg={m} onReply={debatePhase === "running" && m.agent !== "user" ? (msg) => {
            const ag = AGENTS[msg.agent];
            setReplyTo({ msg, agentLabel: ag?.label ?? msg.agent, preview: msg.text.slice(0, 60).trim() });
            setTimeout(() => chatInputRef.current?.focus(), 50);
          } : undefined} />)}

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

          {/* ── 스테이지 완료 인라인 보고서 ── */}
          {debatePhase === "confirmed" && stageResults.length > 0 && imageSessionPhase === "idle" && (() => {
            const latestResult = stageResults[stageResults.length - 1];
            const stageObj = STAGES.find(st => st.id === latestResult.stageId) ?? STAGES[currentStageIdx];
            // latestResult.stageId 기준으로 완료된 스테이지 인덱스 계산 (currentStageIdx 오프셋 버그 방지)
            const completedStageIdx = STAGES.findIndex(s => s.id === latestResult.stageId);
            const resolvedIdx = completedStageIdx >= 0 ? completedStageIdx : currentStageIdx;
            const nextStageName = resolvedIdx + 1 < STAGES.length ? STAGES[resolvedIdx + 1].name : null;
            return (
              <StageReportInChat
                result={latestResult}
                stage={stageObj}
                onNextStage={() => handleNextStage(resolvedIdx)}
                onContinueDebate={() => { void runDebate(resolvedIdx); }}
                nextStageName={nextStageName}
                onReanalyze={() => handleReanalyze(resolvedIdx)}
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
                            {concept.error ? "⚠ 생성 실패" : "⏳ 생성 중"}
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
          {imageSessionPhase === "idle" && assetListPhase === "reviewing" && (
            <div style={{ padding: "12px 16px", borderTop: "1px solid #1e1e2a", overflowY: "auto", maxHeight: "60vh" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24", marginBottom: 10 }}>
                📋 에셋 리스트 확인 — 빠진 항목이 있으면 추가하세요
              </div>

              {/* 캐릭터 섹션 */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#3a3a52", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 6 }}>캐릭터</div>
                <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6, marginBottom: 6 }}>
                  {editableAssets.characters.map((name, i) => (
                    <span key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.3)", borderRadius: 99, padding: "2px 8px 2px 10px", fontSize: 12, color: "#fb923c" }}>
                      {name}
                      <button onClick={() => setEditableAssets(a => ({ ...a, characters: a.characters.filter((_, j) => j !== i) }))}
                        style={{ background: "none", border: "none", color: "#fb923c", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={newCharInput} onChange={e => setNewCharInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && newCharInput.trim()) { setEditableAssets(a => ({ ...a, characters: [...a.characters, newCharInput.trim()] })); setNewCharInput(""); } }}
                    placeholder="+ 캐릭터 추가 (Enter)" style={{ flex: 1, background: "#12121c", border: "1px solid #2a2a3d", borderRadius: 6, color: "#eeeef5", fontSize: 12, padding: "5px 8px" }} />
                  <button onClick={() => { if (newCharInput.trim()) { setEditableAssets(a => ({ ...a, characters: [...a.characters, newCharInput.trim()] })); setNewCharInput(""); } }}
                    style={{ background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.3)", borderRadius: 6, color: "#fb923c", fontSize: 11, fontWeight: 700, padding: "5px 10px", cursor: "pointer" }}>+ 추가</button>
                </div>
              </div>

              {/* 장소 섹션 */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#3a3a52", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 6 }}>장소</div>
                <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6, marginBottom: 6 }}>
                  {editableAssets.locations.map((name, i) => (
                    <span key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 99, padding: "2px 8px 2px 10px", fontSize: 12, color: "#a78bfa" }}>
                      {name}
                      <button onClick={() => setEditableAssets(a => ({ ...a, locations: a.locations.filter((_, j) => j !== i) }))}
                        style={{ background: "none", border: "none", color: "#a78bfa", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={newLocInput} onChange={e => setNewLocInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && newLocInput.trim()) { setEditableAssets(a => ({ ...a, locations: [...a.locations, newLocInput.trim()] })); setNewLocInput(""); } }}
                    placeholder="+ 장소 추가 (Enter)" style={{ flex: 1, background: "#12121c", border: "1px solid #2a2a3d", borderRadius: 6, color: "#eeeef5", fontSize: 12, padding: "5px 8px" }} />
                  <button onClick={() => { if (newLocInput.trim()) { setEditableAssets(a => ({ ...a, locations: [...a.locations, newLocInput.trim()] })); setNewLocInput(""); } }}
                    style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 6, color: "#a78bfa", fontSize: 11, fontWeight: 700, padding: "5px 10px", cursor: "pointer" }}>+ 추가</button>
                </div>
              </div>

              {/* 소품·장비 섹션 */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#3a3a52", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 6 }}>소품·장비</div>
                <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6, marginBottom: 6 }}>
                  {editableAssets.props.map((name, i) => (
                    <span key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(232,121,249,0.1)", border: "1px solid rgba(232,121,249,0.3)", borderRadius: 99, padding: "2px 8px 2px 10px", fontSize: 12, color: "#e879f9" }}>
                      {name}
                      <button onClick={() => setEditableAssets(a => ({ ...a, props: a.props.filter((_, j) => j !== i) }))}
                        style={{ background: "none", border: "none", color: "#e879f9", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={newPropInput} onChange={e => setNewPropInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && newPropInput.trim()) { setEditableAssets(a => ({ ...a, props: [...a.props, newPropInput.trim()] })); setNewPropInput(""); } }}
                    placeholder="+ 소품·장비 추가 (Enter)" style={{ flex: 1, background: "#12121c", border: "1px solid #2a2a3d", borderRadius: 6, color: "#eeeef5", fontSize: 12, padding: "5px 8px" }} />
                  <button onClick={() => { if (newPropInput.trim()) { setEditableAssets(a => ({ ...a, props: [...a.props, newPropInput.trim()] })); setNewPropInput(""); } }}
                    style={{ background: "rgba(232,121,249,0.1)", border: "1px solid rgba(232,121,249,0.3)", borderRadius: 6, color: "#e879f9", fontSize: 11, fontWeight: 700, padding: "5px 10px", cursor: "pointer" }}>+ 추가</button>
                </div>
              </div>

              {/* 확정 버튼 */}
              <button
                onClick={() => {
                  const confirmed = { ...editableAssets };
                  synopsisAssetsRef.current = confirmed;
                  localStorage.setItem(`wts_asset_list_${projectId}`, JSON.stringify(confirmed));
                  setAssetListPhase("confirmed");
                  setStylePhase("debating");
                  void runStyleDebate();
                }}
                style={{ width: "100%", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 8, color: "#34d399", fontSize: 13, fontWeight: 700, padding: "10px 0", cursor: "pointer", marginTop: 4 }}>
                ✓ 확정 → 스타일 정의로
              </button>
            </div>
          )}

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
                <button className={s.btnGating} style={{ width:"auto", padding:"10px 16px" }} onClick={() => void runDebate(currentStageIdx)}>이어하기 →</button>
                <button className={s.btnRestart} onClick={() => { resumeDataRef.current = null; void runDebate(currentStageIdx); }}>새로 시작</button>
              </div>
            </div>
          )}

          {/* Running: confirm button */}
          {debatePhase === "running" && (
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
          )}

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
    </div>
  );
}

