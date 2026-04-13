"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
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

// ─── Phase 2 스테이지별 아젠다 ──────────────────────────────────────────────────
// 각 스테이지마다 반드시 다뤄야 할 하위 주제들
// 스테이지별 주제당 최소 턴 수 — 세계관(1)은 깊이가 중요해서 더 많이
const MIN_TURNS_BY_STAGE: Record<number, number> = {
  1: 15, // 세계관 — A4 분량 깊이 필요
  2: 10, // 시놉시스
  3: 8,  // 캐릭터
  4: 8,  // 장소
  5: 7,  // 소품
};
const MIN_TURNS_PER_TOPIC_P2 = 7; // fallback (UI 표시용)

const STAGE_AGENDA: Record<number, Array<{
  id: string;
  label: string;
  keywords: RegExp;
  nudge: string;
}>> = {
  1: [ // 세계관 — 시놉시스 작성의 기초: 시대배경 + 핵심 인물 + 대립협력 구도
    { id: "era",       label: "시대·배경",     keywords: /시대|배경|세기|현대|미래|과거|공간|지역|나라|도시|문명|왕국|제국|행성|시절|연대|세계|동네|거리|분위기|공기|냄새|질감|지형|역사/,  nudge: "시대·배경이 아직 얕아. 이 공간만의 구체적인 이름, 지형, 역사적 맥락, 그리고 독자가 발을 딛는 순간 느끼는 공기와 질감까지 파고들어야 해. 예를 들어 왜 이 동네인지, 어떤 역사가 이 공간을 만들었는지." },
    { id: "characters",label: "핵심 인물",     keywords: /인물|주인공|캐릭터|등장|누구|사람|존재|주역|주요 인물|핵심 인물|이름|설정|직업|나이|출신|과거|성격|동기|욕망|상처/,         nudge: "핵심 인물들이 아직 피상적이야. 주인공·빌런·핵심 조력자 각각의 이름·직업·나이·출신 배경·내면의 상처·욕망·숨기는 것까지. 왜 이 인물이 이 이야기에서 이 역할을 맡아야 하는지 설득력이 있어야 해." },
    { id: "conflict",  label: "대립·갈등 구도", keywords: /대립|갈등|싸움|충돌|적|적대|원수|반목|긴장|위협|전쟁|분쟁|투쟁|대결|맞서|이유|왜|원인|뿌리|역학/,          nudge: "대립 구도가 아직 표면적이야. 누가 누구와 왜 대립하는지, 그 갈등의 뿌리는 어디서 왔는지, 세력 간 역학 관계가 어떻게 형성됐는지 구체적으로 파야 해. 단순 선악 구도 이상의 복잡성이 있어야 해." },
    { id: "alliance",  label: "협력·관계 구도", keywords: /협력|동맹|우정|팀|같은 편|연대|협조|관계|유대|연결|파트너|동료|지원|신뢰|손잡|함께|거래|이해관계/,          nudge: "협력 구도가 아직 부족해. 누가 왜 손잡는지, 이해관계는 어떻게 얽히는지, 신뢰와 배신의 가능성은 어디 있는지. 대립과 협력이 교차하는 복합적 관계망을 설계해야 해." },
    { id: "rules",     label: "세계 규칙",     keywords: /규칙|법칙|마법|능력|시스템|체계|작동|원리|금기|제약|힘|파워|기술|과학|설정의 법|구조|질서|사회|권력|비밀/,  nudge: "세계 규칙이 아직 충분하지 않아. 이 세계의 권력 구조, 숨겨진 비밀, 일반인이 모르는 규칙들, 그리고 주인공이 맞닥뜨릴 제약과 금기까지 구체적으로 설계해야 해." },
  ],
  2: [ // 시놉시스
    { id: "logline",   label: "로그라인·전제", keywords: /로그라인|전제|한 줄|요약|이야기|스토리|설정|소재|아이디어|기본/,       nudge: "이 이야기를 한 줄로 정의하면 뭐야? 로그라인과 전제를 명확하게 잡아보자." },
    { id: "conflict",  label: "핵심 갈등",    keywords: /갈등|충돌|대립|싸움|적|빌런|문제|장애|위기|위협|악|적대|대결|전쟁/,   nudge: "핵심 갈등 구조를 깊이 파야 해. 무엇 대 무엇의 싸움인지, 왜 독자가 몰입하는지." },
    { id: "structure", label: "서사 구조",    keywords: /구조|전개|기승전결|전환|반전|클라이막스|절정|복선|회수|아크|챕터|발단|위기|절정|결말|막|단계/,  nudge: "이야기가 어떻게 전개되는지 서사 구조를 얘기해보자. 기승전결 4막으로 어떻게 흐르는지, 어디서 반전이 오는지." },
    { id: "resolution",label: "해결·결말",    keywords: /결말|해결|엔딩|마무리|결론|완결|끝|클로징|정리|귀결|성장|변화|결과/,  nudge: "이야기가 어떻게 끝나야 하는지, 주인공이 어떻게 변하는지 얘기해야 해." },
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
  { id: 1 as const, name: "세계관",     topic: "세계관 — 시대·배경·핵심 인물·대립협력 구도·세계 규칙",  tag: "WORLD",  color: "#60a5fa", schema: '{"era":"시대/배경","key_characters":[{"name":"이름","role":"역할(주인공/빌런/조력자)","brief":"한 줄 설명"}],"conflict_structure":"대립 구도 (누가 누구와 왜)","alliance_structure":"협력 구도 (누가 같은 편이고 왜)","world_rules":["규칙1","규칙2","규칙3"]}' },
  { id: 2 as const, name: "시놉시스",   topic: "시놉시스 — 로그라인·전제·핵심 갈등·해결 방향",    tag: "SYNOPSIS",      color: "#34d399", schema: '{"logline":"한 줄 요약","premise":"전제","conflict":"핵심 갈등","resolution_hint":"해결 방향"}' },
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
  1: "세계관 — 시놉시스를 쓸 수 있는 기초를 만드는 단계. 반드시 다음 순서로 충분히 깊이 다뤄야 해 (각 주제별로 A4 반 장 분량 이상):\n① 시대·배경: 언제 어디서 일어나는 이야기인지. 구체적인 공간 이름, 역사적 맥락, 그 공간만의 냄새와 질감까지\n② 핵심 인물: 이름·직업·나이·출신·내면의 상처·욕망·숨기는 것까지. 왜 이 인물인지 설득력 있게\n③ 대립 구도: 누가 누구와 왜 대립하는지. 갈등의 뿌리, 세력 간 역학, 단순 선악 이상의 복잡성\n④ 협력 구도: 누가 왜 손잡는지. 이해관계, 신뢰/배신 가능성, 복합적 관계망\n⑤ 세계 규칙: 권력 구조, 숨겨진 비밀, 일반인이 모르는 법칙, 주인공이 맞닥뜨릴 제약\n비주얼·연출 얘기는 이 단계에서 하지 마. 그건 나중 단계야.",
  2: "시놉시스 — 로그라인·전제·핵심 갈등·기승전결 4막 구조·해결 방향. 장기 연재 로드맵을 짤 수 있을 만큼 구체적으로.",
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
        const rules = Array.isArray(data.world_rules)
          ? (data.world_rules as string[]).map((r, i) => `  ${i + 1}. ${r}`).join("\n")
          : data.world_rules ? `  ${String(data.world_rules)}` : "";
        return [
          data.era            && `시대/배경: ${data.era}`,
          data.atmosphere     && `분위기: ${data.atmosphere}`,
          rules               && `세계 규칙:\n${rules}`,
          data.special_elements && `특수 설정: ${data.special_elements}`,
        ].filter(Boolean).join("\n");
      }
      case 2:
        return [
          data.logline         && `로그라인: ${data.logline}`,
          data.premise         && `전제: ${data.premise}`,
          data.conflict        && `핵심 갈등: ${data.conflict}`,
          data.resolution_hint && `해결 방향: ${data.resolution_hint}`,
        ].filter(Boolean).join("\n");
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

// 에이전트 1명이 이전 토론을 읽고 반응하는 단일 역할 프롬프트
function buildSingleAgentPrompt(
  stageId: StageId,
  genre: string,
  agentId: AgentId,
  prevResults: StageResult[],
  p1Data?: P1Data | null,
  blockedItems: string[] = [],
): string {
  const agentLabel = AGENTS[agentId].label;
  const roleDesc = AGENT_ROLE_DESC[agentId] ?? "";
  const context = buildContext(stageId, prevResults);
  const p1Context = p1Data ? buildPhase1Context(p1Data) : "";

  const blockSection = blockedItems.length > 0
    ? `\n[🚫 절대 사용 금지 — 사용자가 거부한 이름·설정·방향]\n${blockedItems.map(w => `• ${w}`).join("\n")}\n이 항목들은 절대 언급·제안·인용하지 마. 어떤 맥락에서도 쓰지 마.\n`
    : "";

  const isWorldbuildingStage = stageId === 1;
  const productionMandate = isWorldbuildingStage
    ? `\n[⚠️ 이건 제작 바이블 — 모호함 금지]\n이 토론 결과는 실제 웹툰 제작에 쓰이는 세계관 문서야. "어떤 인물" "어느 공간" 같은 추상적 표현은 쓸모가 없어. 이름, 직업, 나이, 구체적 장소명, 역사적 맥락, 관계의 이유를 못 박아야 해. 모호하게 말하면 제작 못 해.\n`
    : "";
  const responseGuide = isWorldbuildingStage
    ? "- 한 번 발언할 때 3~5문장. 구체적인 고유명사(이름·장소·직업·나이)를 반드시 포함해.\n- 추상적·모호한 표현 금지. '어떤 인물' 대신 실제 이름, '어딘가' 대신 실제 장소명."
    : "- 딱 1~2문장. 짧을수록 좋아.";

  return `너는 웹툰 기획 팀의 ${agentLabel}야.
${blockSection}성격: ${roleDesc}
장르: ${genre}
${p1Context ? `\n[Phase 1 분석 결과 — 우리 작품의 방향]\n${p1Context}\n` : ""}${context ? `\n[우리 팀이 함께 만든 세계 — 이미 알고 있는 내용]\n${context}\n` : ""}${productionMandate}지금 주제: ${STAGE_PROMPTS[stageId]}

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
  return `너는 웹툰 기획 팀의 ${agentLabel}야.
성격: ${roleDesc}
장르: ${genre}

[우리 팀이 함께 만든 작품 — 이미 알고 있는 내용]
세계관: ${worldSummary.slice(0, 600)}
시놉시스: ${synopsisSummary.slice(0, 400)}

지금 주제: 이 작품에 맞는 시각적 스타일 정의
목표: 선화 스타일, 색채 팔레트, 분위기/톤을 구체적으로 합의

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
  1: `다음 토론에서 합의된 세계관을 A4 용지 2~3장 분량으로 상세히 정리해주세요.
이 문서는 이후 모든 단계(시놉시스·캐릭터·장소·복선)에서 참고할 세계관 바이블입니다.

반드시 포함할 내용 (각 항목을 충분히 서술):
■ 시대와 배경
  - 구체적인 시대 (몇 세기, 근미래, 판타지 세계 등)
  - 지리적 배경과 문명 수준
  - 사회 구조와 계급 체계
  - 역사적 맥락 (어떤 사건이 이 세계를 만들었는가)

■ 세계의 핵심 규칙과 법칙
  - 마법/기술/초능력 등 특수 시스템 (상세히)
  - 사회 질서와 법률
  - 일반인의 일상생활 방식

■ 세계의 분위기와 톤
  - 전반적인 무드 (어둡고 절망적, 희망적, 혼돈 등)
  - 시각적 이미지 (색감, 건축, 풍경)
  - 독자가 느껴야 할 감정

■ 특수 설정과 독창적 요소
  - 이 세계만의 고유한 개념/규칙
  - 다른 작품과 차별화되는 설정

■ 세계의 문제와 갈등 구조
  - 세계 전체가 직면한 근본적 문제
  - 다양한 세력/집단 간의 갈등 구도

서술형 문장으로 풍부하게 작성하세요. 목록보다 문단 형식을 섞어서.`,

  2: `다음 토론에서 합의된 시놉시스를 A4 용지 2~3장 분량으로 상세히 정리해주세요.
이 문서는 이후 캐릭터·장소·복선 설계의 기반이 됩니다.

반드시 포함할 내용 (각 항목을 충분히 서술):
■ 로그라인 (한 줄 핵심 요약)

■ 이야기의 전제와 출발점
  - 이야기가 시작되는 상황
  - 주인공의 초기 상태와 일상
  - 사건의 도화선이 되는 계기

■ 주요 등장인물 관계도 (캐릭터 설정 전 큰 그림)
  - 주인공과 주변 인물의 관계 구도
  - 대립 구조

■ 핵심 갈등
  - 내적 갈등 (주인공 내면)
  - 외적 갈등 (주인공 vs 적대 세력/환경)
  - 갈등이 고조되는 방식

■ 이야기의 기승전결 4막 구조
  - 기(起): 도입부와 사건 발단
  - 승(承): 갈등 심화와 전개
  - 전(轉): 위기와 반전
  - 결(結): 클라이맥스와 해결 방향

■ 핵심 테마와 메시지
  - 이 이야기가 독자에게 전달할 주제

■ 예상 분위기와 타겟 독자층

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

  // data: 구조화 JSON 우선, 없으면 내러티브를 raw_summary로
  const data: Record<string, unknown> = structured ?? (narrative ? { raw_summary: narrative } : { raw_summary: "(추출 실패)" });

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

function StageResultCard({ result, onViewDebate, isViewingDebate }: { key?: StageId; result: StageResult; onViewDebate?: () => void; isViewingDebate?: boolean }) {
  const [showContext, setShowContext] = useState(false);
  const stage = STAGES.find(s => s.id === result.stageId)!;
  const { data } = result;
  const c = stage.color;
  const row = (label: string, val: unknown) => val ? (
    <div key={label} style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"6px 0", borderBottom:"1px solid #1e1e2a" }}>
      <span style={{ fontSize:10, fontWeight:700, color:"#4a4a68", minWidth:72, flexShrink:0, paddingTop:2, textTransform:"uppercase" as const, letterSpacing:"0.4px" }}>{label}</span>
      <span style={{ fontSize:13, color:"#eeeef5", lineHeight:1.6 }}>{Array.isArray(val) ? (val as unknown[]).join(" · ") : String(val)}</span>
    </div>
  ) : null;

  return (
    <div style={{ background:`${c}08`, border:`1px solid ${c}30`, borderRadius:10, padding:"14px 16px", marginBottom:6 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
        <div style={{ fontSize:10, fontWeight:800, color:c, textTransform:"uppercase" as const, letterSpacing:"0.7px" }}>✓ {stage.name} 완료</div>
        <div style={{ display:"flex", gap:6 }}>
          <button
            onClick={() => setShowContext((v: boolean) => !v)}
            style={{ fontSize:11, fontWeight:700, color: showContext ? c : "#4a4a6a", background: showContext ? `${c}18` : "transparent", border:`1px solid ${showContext ? c : "#2a2a3d"}`, borderRadius:6, padding:"3px 10px", cursor:"pointer" }}>
            {showContext ? "▲" : "📋"} 전달 내용
          </button>
          {onViewDebate && (
            <button
              onClick={onViewDebate}
              style={{ fontSize:11, fontWeight:700, color: isViewingDebate ? c : "#4a4a6a", background: isViewingDebate ? `${c}18` : "transparent", border:`1px solid ${isViewingDebate ? c : "#2a2a3d"}`, borderRadius:6, padding:"3px 10px", cursor:"pointer" }}>
              {isViewingDebate ? "▲ 닫기" : "💬 토론"}
            </button>
          )}
        </div>
      </div>
      {/* 다음 단계 에이전트에게 전달되는 내용 */}
      {showContext && result.summary && (
        <div style={{ marginBottom:12, padding:"10px 12px", background:"#0d0d1a", border:`1px solid ${c}30`, borderRadius:8 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#4a4a68", marginBottom:6, letterSpacing:"0.05em" }}>📋 다음 단계 에이전트 전달 내용</div>
          <pre style={{ fontSize:12, color:`${c}dd`, lineHeight:1.75, whiteSpace:"pre-wrap" as const, margin:0, fontFamily:"inherit" }}>{result.summary}</pre>
        </div>
      )}
      {result.stageId === 1 && <>{row("시대/배경", data.era)}{row("분위기", data.atmosphere)}{row("세계 규칙", data.world_rules)}{row("특수 설정", data.special_elements)}</>}
      {result.stageId === 2 && <>{row("로그라인", data.logline)}{row("전제", data.premise)}{row("갈등", data.conflict)}{row("해결 방향", data.resolution_hint)}</>}
      {result.stageId === 3 && Array.isArray(data.characters) && (data.characters as Record<string,string>[]).map((ch, i) => (
        <div key={i} style={{ marginBottom:10, paddingBottom:10, borderBottom:"1px solid #2a2a3d" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#eeeef5", marginBottom:6 }}>
            {ch.name} <span style={{ fontSize:11, color:"#7878a0" }}>({ch.role})</span>
            {ch.gender && <span style={{ fontSize:11, color:"#7878a0", marginLeft:6 }}>{ch.gender}{ch.age ? ` · ${ch.age}` : ""}</span>}
          </div>
          {row("얼굴", ch.face)}{row("키 / 체형", ch.height || ch.build ? [ch.height, ch.build, ch.weight].filter(Boolean).join(" · ") : undefined)}{row("복장", ch.outfit)}{row("성격", ch.personality)}{row("동기", ch.motivation)}{row("말투", ch.speech)}{row("세계관 역할", ch.story_role)}
        </div>
      ))}
      {result.stageId === 4 && Array.isArray(data.locations) && (data.locations as Record<string,string>[]).map((loc, i) => (
        <div key={i} style={{ marginBottom:10, paddingBottom:10, borderBottom:"1px solid #2a2a3d" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#eeeef5", marginBottom:6 }}>{loc.name} <span style={{ fontSize:11, color:"#7878a0" }}>({loc.type})</span></div>
          {row("시각", loc.visual)}{row("구조", loc.architecture)}{row("조명", loc.lighting)}{row("색채", loc.color_palette)}{row("분위기", loc.atmosphere)}{row("소리", loc.sound)}{row("서사적 의미", loc.significance)}{row("주요 장면", loc.key_scenes)}{row("상징", loc.symbolic_meaning)}
        </div>
      ))}
      {result.stageId === 5 && Array.isArray(data.props) && (data.props as Record<string,string>[]).map((p, i) => (
        <div key={i} style={{ marginBottom:10, paddingBottom:10, borderBottom:"1px solid #2a2a3d" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#eeeef5", marginBottom:6 }}>
            {p.name} <span style={{ fontSize:11, color:"#7878a0" }}>({p.type})</span>
            {p.owner && <span style={{ fontSize:11, color:"#7878a0", marginLeft:6 }}>· {p.owner}</span>}
          </div>
          {row("시각", p.visual)}{row("상태", p.condition)}{row("기능", p.function)}{row("역할", p.story_role)}{row("상징", p.symbolic_meaning)}
        </div>
      ))}
      {/* Fallback: 구조화 실패 시 단계별 상세 요약 */}
      {data.raw_summary && (
        <div style={{ fontSize:13, color:"#d4d4e8", lineHeight:1.85, whiteSpace:"pre-wrap" as const, background:"#12121c", borderRadius:8, padding:"12px 14px" }}>
          {String(data.raw_summary)}
        </div>
      )}
    </div>
  );
}

// 이미지 서치 카드 (Phase 1과 동일)
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
  const [viewingStageIdx, setViewingStageIdx] = useState<number | null>(null); // 열람 중인 이전 단계

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
      el.textContent = "@keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }";
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

    // 롤링 요약 + 사용자 컨텍스트 상태
    let conversationSummary = "";
    let turnsSinceLastSummary = 0;
    let lastUserMsg = "";
    let userTurnCount = 0;
    let wrapUpProposed = false;
    let wrapUpProposedAt = 0;
    let naturalExit = false;
    // 이 스테이지의 아젠다 항목 수 × 최소 턴 + 여유
    const stageAgenda = STAGE_AGENDA[stage.id] ?? [];
    const minTurnsForStage = MIN_TURNS_BY_STAGE[stage.id] ?? MIN_TURNS_PER_TOPIC_P2;
    const WRAP_UP_AFTER = stageAgenda.length * minTurnsForStage + (stage.id === 1 ? 20 : 10);
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
            systemPrompt: "웹툰 기획 토론 요약 전문가. 핵심만 2문장 이내로.",
            messages: [{
              role: "user",
              content: `${conversationSummary ? `이전 요약: ${conversationSummary}\n\n` : ""}최근 대화:\n${transcript.slice(-5).join("\n")}\n\n합쳐서 2문장 이내 요약. 핵심 합의사항·의견 포함. 마크다운 금지.`,
            }],
            maxTokens: 120,
            tools: [],
          })) next += chunk;
        } catch { /* ignore */ }
        if (next.trim()) conversationSummary = next.trim();
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
          systemPrompt: buildSingleAgentPrompt(stage.id, genre, agentId, stageResultsRef.current, p1DataRef.current, rejectedItemsRef.current),
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
        if (pendingMsg) {
          pendingUserMsgRef.current = null;
          transcript.push(`[사용자]: ${pendingMsg}`);
          convRef.current = transcript;
          lastUserMsg = pendingMsg;
          userTurnCount = 4;
          refreshSummary();
          turnsSinceLastSummary = 0;
          if (wrapUpProposed) {
            if (AGREE_RE.test(pendingMsg.trim())) { naturalExit = true; break debateLoop; }
            wrapUpProposed = false;
          }
        }

        // 주기적 요약 갱신
        turnsSinceLastSummary++;
        if (turnsSinceLastSummary >= 5) { refreshSummary(); turnsSinceLastSummary = 0; }

        // 히스토리 텍스트 구성
        const lastLine = transcript.filter(l => !l.startsWith("[사용자]")).slice(-1)[0] ?? "";
        const historyText = conversationSummary
          ? `[지금까지]: ${conversationSummary}\n${userTurnCount > 0 ? `[사용자 의견]: ${lastUserMsg}\n` : ""}[직전 발언]: ${lastLine}\n\n`
          : `[대화 내용]\n${transcript.slice(-3).join("\n")}\n\n`;
        if (userTurnCount > 0) userTurnCount--;

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

        // 3턴마다 — 가장 덜 다뤄진 미완료 주제를 프로듀서가 꺼냄
        if (nudgeCooldown > 0) {
          nudgeCooldown--;
        } else if (agentTurnsSoFar > 0 && agentTurnsSoFar % 3 === 0) {
          const uncovered = stageAgenda.filter(item => !coveredAgenda.has(item.id));
          if (uncovered.length > 0) {
            const pick = uncovered.sort(
              (a, b) => (agendaTurns[a.id] ?? 0) - (agendaTurns[b.id] ?? 0)
            )[0];
            const currentTurns = agendaTurns[pick.id] ?? 0;
            await runSingleAgent(
              "producer",
              `${historyText}${pick.nudge} 지금까지 ${currentTurns}회 다뤄졌는데, 최소 ${minTurnsForStage}회 이상 충분히 다뤄야 해. 구체적인 이름, 배경, 관계, 이유를 들어 깊이 있게 이야기해줘.`,
              stage.id === 1 ? 400 : 200,
            );
            lastSpeaker = "producer";
            nudgeCooldown = 2;
            continue;
          }
        }

        // 마무리 조건 체크 — 모든 아젠다 완료 or WRAP_UP_AFTER 턴 초과
        const allCovered = stageAgenda.length > 0 && coveredAgenda.size >= stageAgenda.length;
        const converging = agentTurnsSoFar >= 8 &&
          (recentLines.match(/정리|결론|충분|이 정도|마무리|확인|다음 단계/g) ?? []).length >= 2;

        if (!wrapUpProposed && (agentTurnsSoFar >= WRAP_UP_AFTER || (allCovered && converging))) {
          wrapUpProposed = true;
          wrapUpProposedAt = Date.now();
          await runSingleAgent("producer",
            `${historyText}[${stage.name}] 단계의 모든 주요 항목을 충분히 다뤘어. 프로듀서로서 이 단계를 마무리하고 확인하자고 자연스럽게 제안해줘. 1~2문장.`,
            150);
          lastSpeaker = "producer";
          continue;
        }

        // 다음 발언자 선택 및 실행
        const isFirst = agentTurnsSoFar === 0;
        const nextAgent = isFirst ? "worldbuilder" : pickNextSpeaker(lastLine, lastSpeaker);

        const agentPrompt = isFirst
          ? stage.id === 1
            ? `"${stage.topic}" 주제의 첫 발언을 해줘. 지금 우리가 만드는 작품의 시대·배경부터 구체적으로 잡아줘. 추상적이면 안 돼 — 실제 제작에 쓸 정보여야 해.`
            : `"${stage.topic}" 주제로 첫 의견을 자연스럽게 말해줘. 짧고 구어체로.`
          : userTurnCount > 0
            ? `${historyText}사용자 의견을 자연스럽게 반영해서 토론을 이어가줘.`
            : stage.id === 1
              ? `${historyText}앞 대화 받아서 구체적인 디테일을 추가해줘. 이름, 장소, 관계, 이유 — 제작 문서에 쓸 수 있는 정보로.`
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
          maxTokens: 180,
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
        const trimmed = extracted.trim();
        if (trimmed) { setStyleInput(trimmed); setConceptStyle(trimmed); }
      } catch { /* ignore */ }
    }

    styleRunningRef.current = false;
    setStylePhase("reviewing");
  }, [genre, addMsg, updateMsg]);

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
        addMsg("user", pending, false);
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
        addMsg("user", pending, false);
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
  }, [genre, addMsg, updateMsg, runImageAgent]);

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
    if (stageIdx === 2 && Array.isArray(data.characters)) {
      for (const ch of data.characters as Record<string, string>[]) {
        const desc = [
          `이름: ${ch.name ?? ""}${ch.role ? ` (${ch.role})` : ""}`,
          ch.gender && `성별: ${ch.gender}`,
          ch.age && `나이: ${ch.age}`,
          ch.face && `얼굴: ${ch.face}`,
          (ch.height || ch.build) && `키/체형: ${[ch.height, ch.build, ch.weight].filter(Boolean).join(", ")}`,
          ch.outfit && `복장: ${ch.outfit}`,
          ch.personality && `성격: ${ch.personality}`,
        ].filter(Boolean).join("\n");
        items.push({ type: "character", name: ch.name ?? "캐릭터", description: desc, stageId: 3, confirmed: false });
      }
    } else if (stageIdx === 3 && Array.isArray(data.locations)) {
      for (const loc of data.locations as Record<string, string>[]) {
        const desc = [
          `장소명: ${loc.name ?? ""}${loc.type ? ` (${loc.type})` : ""}`,
          loc.visual && `시각적 묘사: ${loc.visual}`,
          loc.architecture && `건축 구조: ${loc.architecture}`,
          loc.lighting && `조명: ${loc.lighting}`,
          loc.color_palette && `색채: ${loc.color_palette}`,
          loc.atmosphere && `분위기: ${loc.atmosphere}`,
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
    // Stage 2(index=1) 완료 후 → 스타일 정의 단계 삽입
    if (stageIdx === 1 && stylePhase === "idle") {
      setMsgs([]);
      convRef.current = [];
      setStylePhase("debating");
      void runStyleDebate();
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
  }, [runDebate, runStyleDebate, stylePhase, enterImageGenPhase]);

  const handleRestartNew = useCallback(() => {
    abortRef.current = true;
    localStorage.removeItem(`p2_msgs_${projectId}`);
    localStorage.removeItem(`wts_phase2_${projectId}`);
    STAGES.forEach((_, idx) => {
      localStorage.removeItem(`p2_conv_${idx}_${projectId}`);
      localStorage.removeItem(`p2_msgs_${idx}_${projectId}`);
    });
    resumeDataRef.current = null;
    convRef.current = [];
    stageResultsRef.current = [];
    runningRef.current = false;
    setMsgs([]); setStageResults([]); setCurrentStageIdx(0); setApiError(null);
    setStageHistoryMsgs({}); setViewingStageIdx(null);
    setDebatePhase("idle");
  }, [projectId]);

  // ── UI ──

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
                return (
                  <div key={item.id} style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "2px 8px", borderRadius: 99, fontSize: 11,
                    background: covered ? "rgba(99,102,241,0.25)" : turns > 0 ? "rgba(99,102,241,0.1)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${covered ? "rgba(99,102,241,0.4)" : "transparent"}`,
                    color: covered ? "#a5b4fc" : turns > 0 ? "rgba(165,180,252,0.6)" : "rgba(255,255,255,0.3)",
                    transition: "all 0.5s",
                  }}>
                    <span>{covered ? "✓" : "○"}</span>
                    <span>{item.label}</span>
                    <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 2 }}>
                      {progress}/{minTurnsUI}
                    </span>
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

        {/* Confirmed stage results (above chat) */}
        {stageResults.length > 0 && (
          <div style={{ padding:"12px 16px 0" }}>
            {stageResults.map((r: StageResult, idx: number) => (
              <div key={r.stageId}>
                <StageResultCard
                  result={r}
                  onViewDebate={() => setViewingStageIdx(viewingStageIdx === idx ? null : idx)}
                  isViewingDebate={viewingStageIdx === idx}
                />
                {/* 토론 내용 인라인 뷰어 */}
                {viewingStageIdx === idx && (
                  <div style={{ background:"#0e0e1a", border:"1px solid #2a2a3d", borderRadius:10, padding:"12px 16px", marginBottom:8, maxHeight:400, overflowY:"auto" as const }}>
                    <div style={{ fontSize:11, fontWeight:700, color:"#4a4a6a", marginBottom:10, letterSpacing:"0.05em" }}>
                      {STAGES[idx].name} 토론 기록
                    </div>
                    {(stageHistoryMsgs[idx] ?? []).length === 0
                      ? <div style={{ fontSize:13, color:"#4a4a6a" }}>저장된 토론 내용이 없습니다.</div>
                      : (stageHistoryMsgs[idx] ?? []).map((m: Msg) => <MsgBubble key={m.id} msg={m} />)
                    }
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className={s.chatBody}>
          {msgs.map((m: Msg) => <MsgBubble key={m.id} msg={m} onReply={debatePhase === "running" && m.agent !== "user" ? (msg) => {
            const ag = AGENTS[msg.agent];
            setReplyTo({ msg, agentLabel: ag?.label ?? msg.agent, preview: msg.text.slice(0, 60).trim() });
            setTimeout(() => chatInputRef.current?.focus(), 50);
          } : undefined} />)}

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
          {imageSessionPhase !== "idle" && imageSessionPhase !== "selecting" && imageSessionPhase !== "generating" ? (
            <div>
              <div style={{ padding: "8px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#7c6cfc" }}>
                  {imageSessionPhase === "pre-debate" && `🎯 사전 회의 — ${imageItems[currentImageItemIdx]?.name} 방향 논의`}
                  {imageSessionPhase === "extracting" && "⚙️ 4가지 방향 추출 중..."}
                  {imageSessionPhase === "post-debate" && `🔍 검토 회의 — 시안 평가`}
                  {imageSessionPhase === "recommending" && "💬 팀 추천 발표 중..."}
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
                          if (chatInput.trim()) { pendingImageMsgRef.current = chatInput.trim(); setChatInput(""); }
                        }
                      }}
                    />
                    <button className={s.btnSend} disabled={!chatInput.trim()} onClick={() => { if (chatInput.trim()) { pendingImageMsgRef.current = chatInput.trim(); setChatInput(""); } }}>전송</button>
                  </div>
                </>
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
                  style={{ flex:1, background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.3)", borderRadius:8, color:"#f59e0b", fontSize:13, fontWeight:700, padding:"9px 0", cursor:"pointer", opacity: styleGenLoading ? 0.5 : 1 }}>
                  {stylePhase === "generating" ? "🎨 생성 중..." : "🎨 테스트 이미지 생성"}
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

          {/* 이미지/스타일 단계 활성 중엔 아래 일반 바텀바 숨김 */}
          {imageSessionPhase !== "idle" || (stylePhase !== "idle" && stylePhase !== "confirmed") ? null : (<>

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

          {/* Confirmed: next stage button */}
          {debatePhase === "confirmed" && (
            <div className={s.gatingRow}>
              <div>
                <div className={s.gatingMsg}>✓ {stage.name} 확정 완료</div>
                <div style={{ fontSize:11, color:"#64748b", marginTop:3 }}>
                  {currentStageIdx + 1 < STAGES.length
                    ? `다음: ${STAGES[currentStageIdx + 1].name} 토론`
                    : "모든 단계 완료 — Phase 3 진행 가능"}
                </div>
              </div>
              <button
                className={s.btnGating}
                style={{ width:"auto", padding:"10px 20px" }}
                onClick={() => handleNextStage(currentStageIdx)}>
                {currentStageIdx + 1 < STAGES.length
                  ? `${STAGES[currentStageIdx + 1].name} 시작 →`
                  : "Phase 3 시작 →"}
              </button>
            </div>
          )}

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

