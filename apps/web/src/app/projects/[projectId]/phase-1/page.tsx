"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ReferenceLine,
  RadialBarChart, RadialBar,
  ResponsiveContainer, Legend, Tooltip,
} from "recharts";
import {
  doc, setDoc, getDoc, serverTimestamp,
  collection, addDoc, getDocs, query, where, orderBy, limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { streamClaude, fetchImagesWithClaude, getAnthropicKey, getAnthropicKeyByIndex, getAllAnthropicKeys } from "@/lib/claude-client";
import { AGENT_PERSONAS, DEBATE_RULES, USER_COMMAND_PATTERNS } from "./debate-config";
import styles from "./page.module.css";

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = {
  strategist:   { label: "전략기획자",    emoji: "📊", color: "#a78bfa", bg: "rgba(167,139,250,0.10)" },
  researcher:   { label: "심층조사자",    emoji: "🔍", color: "#34d399", bg: "rgba(52,211,153,0.10)"  },
  worldbuilder: { label: "세계관설계자",  emoji: "🌐", color: "#60a5fa", bg: "rgba(96,165,250,0.10)"  },
  character:    { label: "캐릭터디자이너", emoji: "🎭", color: "#f472b6", bg: "rgba(244,114,182,0.10)" },
  scenario:     { label: "시나리오작가",  emoji: "📝", color: "#fbbf24", bg: "rgba(251,191,36,0.10)"  },
  script:       { label: "연출작가",      emoji: "🎬", color: "#f87171", bg: "rgba(248,113,113,0.10)" },
  producer:     { label: "총괄프로듀서",  emoji: "🎯", color: "#e2e8f0", bg: "rgba(241,245,249,0.07)" },
  editor:       { label: "편집자",        emoji: "📋", color: "#fb923c", bg: "rgba(251,146,60,0.10)"  },
  user:         { label: "나",            emoji: "💬", color: "#7c6cfc", bg: "rgba(124,108,252,0.10)" },
} as const;
type AgentId = keyof typeof AGENTS;

// ─── 에이전트 발언 순서 (API 키를 돌아가며 사용) ─────────────────────────────

const AGENT_SPEAKING_ORDER_P1: AgentId[] = [
  "strategist", "researcher", "worldbuilder", "character",
  "scenario", "script", "producer",
];

// ─── Phase 1 토론 아젠다 ────────────────────────────────────────────────────────
// 순서 없음 — 자연스럽게 대화하다 안 다룬 주제가 있으면 프로듀서가 슬쩍 꺼냄
const AGENDA_P1 = [
  {
    id: "market" as const,
    label: "유사작품 시장성",
    keywords: /시장|조회수|플랫폼 성과|독자수|흥행|성공 사례|시장성|매출|구독/,
    nudge: "그런데 유사작품들의 실제 시장 성과 얘기는 아직 덜 된 것 같은데, 조회수나 플랫폼 반응 데이터 얘기해줄 수 있어?",
  },
  {
    id: "comparison" as const,
    label: "유사작품 특징 비교",
    keywords: /비교|차이|유사작품|레퍼런스|참고작|비슷한|대비|스토리 구조|연출 방식/,
    nudge: "유사작품들이랑 우리 기획을 직접 비교해서 얘기해주면 좋겠는데, 스토리·캐릭터·연출 측면에서 어떻게 달라?",
  },
  {
    id: "strengths" as const,
    label: "우리 작품 강점",
    keywords: /강점|차별화|독특|장점|경쟁력|우리만의|특징|매력|훅/,
    nudge: "우리 기획만의 강점이나 차별화 포인트는 뭔지 얘기해볼까? 다른 작품 대비 뭐가 제일 눈에 띄어?",
  },
  {
    id: "weaknesses" as const,
    label: "우리 작품 약점",
    keywords: /약점|리스크|위험|단점|한계|문제|부족|클리셰|실패|걱정/,
    nudge: "솔직하게 약점이나 리스크 얘기도 해야 할 것 같은데, 시장에서 이 기획이 실패할 수 있는 요인이 뭐가 있을까?",
  },
  {
    id: "improvements" as const,
    label: "보강해야 할 점",
    keywords: /보강|개선|보완|수정|발전|Phase 2|해결|업그레이드|강화/,
    nudge: "약점을 어떻게 보완할지도 짚어봐야 할 것 같아. Phase 2 전에 반드시 결정해야 할 것들이 뭔지.",
  },
  {
    id: "audience" as const,
    label: "주 독자층 예측",
    keywords: /독자층|타깃|연령|성별|소비 패턴|10대|20대|30대|여성 독자|남성 독자|팬덤/,
    nudge: "주 독자층에 대한 얘기가 빠진 것 같은데, 연령·성별·소비 패턴 측면에서 어떤 독자를 공략하는 게 좋을까?",
  },
  {
    id: "artstyle" as const,
    label: "그림 화풍",
    keywords: /그림체|화풍|스타일|색감|연출|비주얼|그림|컷|패널|작화/,
    nudge: "그림 화풍 얘기도 해야 할 것 같아. 이 기획에 맞는 그림체나 연출 스타일이 어떤 방향이면 좋을지.",
  },
] as const;

type AgendaId = typeof AGENDA_P1[number]["id"];

// API 키 할당 (에이전트 인덱스 → 키 인덱스) - API를 돌아가며 사용
function getApiKeyIndexForAgent(agentIndex: number): number {
  const keys = getAllAnthropicKeys();
  if (keys.length === 0) return 0;
  return (agentIndex % Math.max(1, keys.length)) + 1;
}

// 최근 대화 흐름 기반으로 다음 발언자 선택
// - recentLines: 최근 3줄 (누가 어떤 말을 했는지)
// - recentSpeakers: 최근 3명 발언자 (중복 방지)
// - lastSpeaker: 방금 발언한 에이전트 (연속 발언 방지)
function pickNextSpeaker(
  recentLines: string[],
  recentSpeakers: AgentId[],
  lastSpeaker: AgentId | null,
): AgentId {
  const combined = recentLines.join(" ").toLowerCase();

  // 최근 3턴에 발언 안 한 에이전트를 우선 후보로
  const all = AGENT_SPEAKING_ORDER_P1.filter(a => a !== lastSpeaker);
  const fresh = all.filter(a => !recentSpeakers.includes(a));
  const pool = fresh.length > 0 ? fresh : all;

  const find = (...ids: AgentId[]) => ids.find(a => pool.includes(a)) ?? pool[0];

  // 최근 대화 주제 → 전문 에이전트 매핑
  if (/캐릭터|주인공|감정|인물|성격|매력|관계|빌런/.test(combined)) return find("character", "scenario");
  if (/스토리|서사|플롯|훅|전개|결말|1화|클리프|기승전결/.test(combined)) return find("scenario", "character");
  if (/세계관|설정|배경|규칙|시스템|마법|능력|세계/.test(combined)) return find("worldbuilder", "researcher");
  if (/시장|플랫폼|성공|독자|수익|화제|네이버|카카오|트렌드/.test(combined)) return find("strategist", "researcher");
  if (/유사|비슷|참고|작품|웹툰|레퍼런스|사례/.test(combined)) return find("researcher", "scenario");
  if (/그림|비주얼|스타일|연출|색감|그림체|컷|패널/.test(combined)) return find("script", "character");
  if (/정리|요약|방향|결론|어떻게|다음 단계/.test(combined)) return find("producer", "strategist");

  // 매칭 없으면 fresh 후보 중 랜덤 (producer는 최하위 우선순위)
  const nonProducer = pool.filter(a => a !== "producer");
  const finalPool = nonProducer.length > 0 ? nonProducer : pool;
  return finalPool[Math.floor(Math.random() * finalPool.length)];
}

// 에이전트별 성격·역할 (Phase 1: 유사 웹툰 리서치 전문가 팀)
// 페르소나/규칙/명령패턴은 debate-config.ts 에서 관리

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReplyQuote { agentLabel: string; preview: string; }
interface Msg { id: string; agent: AgentId; round: number; text: string; streaming: boolean; replyQuote?: ReplyQuote; }
interface USP { icon: string; title: string; desc: string; prediction: string; }
interface Competitor {
  title: string; platform: string; period: string; readers: string;
  strengths: string; weaknesses: string; differentiation: string; genre_color: string;
}
interface PositioningPoint { x: number; y: number; label: string; }
interface Phase1Result {
  feasibility_score: number;
  feasibility_breakdown: { market: number; originality: number; producibility: number; commercial: number; };
  verdict: "go" | "conditional" | "reject";
  summary: string;
  // ── 기획분석 상세 ──
  genre_analysis: { genre: string; trend: string; audience: string; key_success: string; };
  market_analysis: { platform: string; market_size: string; growth: string; competition_level: string; opportunity: string; };
  similar_works: Array<{ title: string; platform: string; similarity: string; lesson: string; }>;
  // ── 유사작품 도입 전략 (목표③) ──
  adoption_strategy: Array<{ from_work: string; good_point: string; how_to_apply: string; }>;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
  // ── 세계관 보완사항 (목표②, Phase 2 인계용) ──
  worldbuilding_notes: Array<{ issue: string; suggestion: string; priority: "high" | "medium" | "low"; }>;
  usp: USP[];
  competitors: Competitor[];
  positioning: { ours: PositioningPoint; competitors: PositioningPoint[]; };
  radar: { ours: number[]; avg: number[]; categories: string[]; };
  final_report: string;
}
type Stage = "form" | "debate";
type DebatePhase = "idle" | "running" | "paused" | "done";

// ─── 에이전트 1명용 시스템 프롬프트 빌더 ─────────────────────────────────────────
// 페르소나(AGENT_PERSONAS)·규칙(DEBATE_RULES)은 debate-config.ts에서 관리

function buildAgentPromptP1(
  agentId: AgentId,
  genre: string,
  concept: string,
  platLabel: string,
  ep: string,
  blockedWorks: string[] = [],
): string {
  const agentLabel = AGENTS[agentId].label;
  const personality = AGENT_PERSONAS[agentId] ?? "";
  const blockSection = blockedWorks.length > 0
    ? `\n[🚫 절대 언급 금지 — 존재하지 않거나 이 기획과 무관한 작품]\n${blockedWorks.map(w => `• ${w}`).join("\n")}\n이 작품들은 어떤 맥락에서도 절대 언급하지 마. 예시·비교·유사작품 어디에도 쓰지 마. 이전 대화에 나왔더라도 완전히 무시해.\n`
    : "";
  return `너는 웹툰 기획 리서치 팀의 ${agentLabel}야.
${blockSection}
[네 정체]
${personality}

[분석 대상 기획]
기획 내용 (가장 중요):
${concept}

참고 정보 (부수적): 장르: ${genre} | 플랫폼: ${platLabel} | 목표화수: ${ep}

[핵심 원칙]
기획 내용(개요)이 유사작품 선정의 유일한 기준이야.
장르·플랫폼·화수는 그냥 참고 정보일 뿐 — 유사작품 판단에 쓰지 마.

[유사작품 범위]
웹툰·만화에 국한하지 마. 아래 모든 매체를 포함해서 분석해:
• 웹툰 / 만화 (한국·일본·미국 등)
• 영화 (국내외)
• 드라마 (한국 드라마, 넷플릭스 시리즈, 미드 등)
• 소설 / 웹소설
• 애니메이션
같은 스토리 구조·감정선·세계관을 가진 작품이라면 매체 상관없이 분석 대상이야.

유사작품 선정 기준:
- 이 기획의 핵심 소재·설정·세계관이 비슷한 작품
- 주인공의 처지·성격·성장 방식이 비슷한 작품
- 주요 갈등 구조나 테마가 겹치는 작품
- 독자/관객이 느끼는 감정선·분위기가 비슷한 작품

장르만 같고 내용이 전혀 다른 작품은 언급하지 마.
제목을 100% 확신하는 실존 작품만 언급해. 불확실하면 언급하지 말고, 모르면 솔직하게 말해.

팀이 같이 하는 건 이거야:
- 유사작품(웹툰·영화·드라마 등) 분석으로 이 기획의 시장 가능성 판단
- 기획의 약한 부분 미리 잡아두기 (Phase 2에서 보완)
- 잘 된 작품들의 성공 요소를 우리 기획에 어떻게 적용할지
- 비슷한 장르 비주얼 레퍼런스 공유

새로운 스토리나 설정 만들지 마. 분석이 전부야.

[이미지 서치할 때]
반드시 이 형식으로: 🖼️ 이미지 서치: "검색어"
한 번 발언에 딱 1개만.
검색어 = 작품 제목 + 매체 유형. 예시:
• "기해년 웹툰", "올드보이 영화", "이상한 변호사 우영우 드라마"
• "원펀맨 만화", "나의 아저씨 드라마", "신과함께 영화"
• 영미권: "Oldboy film", "One Piece manga", "Squid Game drama"
제목만 단독으로 쓰면 엉뚱한 이미지가 나오므로 반드시 매체 유형을 붙여.

${DEBATE_RULES}`;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_RESULT: Phase1Result = {
  feasibility_score: 0.84,
  feasibility_breakdown: { market: 88, originality: 82, producibility: 78, commercial: 87 },
  verdict: "go",
  summary: "헌터물 포화 시장에서 '관계 서사+도덕적 딜레마' 차별화로 네이버 10~20대 공략 가능. Phase 2 적극 권장.",
  genre_analysis: { genre: "헌터 판타지", trend: "관계 서사 하이브리드 부상", audience: "10~20대 남성", key_success: "성장+감정 균형" },
  market_analysis: { platform: "네이버웹툰", market_size: "2조 원+", growth: "연 12%", competition_level: "높음", opportunity: "단순 성장물 공백 공략" },
  similar_works: [
    { title: "나 혼자만 레벨업", platform: "카카오페이지", similarity: "스탯+성장 판타지", lesson: "압도적 스펙터클 필수, 관계 서사 보완 필요" },
    { title: "전지적 독자시점", platform: "네이버웹툰", similarity: "메타 서사+몰입", lesson: "신규 독자 진입 장벽 최소화" },
  ],
  strengths: ["관계 서사+도덕 딜레마 차별화", "글로벌 IP 확장성", "세로 스크롤 최적 연출"],
  weaknesses: ["헌터물 클리셰 리스크", "빌런 동기 논리 보완 필요"],
  improvements: ["Phase 2에서 능력 체계 명확화", "빌런 배경 서사 구체화"],
  usp: [
    {
      icon: "⚡",
      title: "1화 즉각 훅",
      desc: "세계관 설명 없이 위기 한복판으로\n독자를 던지는 인미디어스 레스 오프닝",
      prediction: "1→3화 이탈률 22% 이하 예상 (네이버 장르 평균 35% 대비 -13%p)",
    },
    {
      icon: "🧩",
      title: "다층적 도덕 갈등",
      desc: "선악 이분법을 깨는 빌런의 논리적 동기가\n독자 토론을 자연 발생시키는 구조",
      prediction: "네이버 베스트댓글·커뮤니티 화제성 상위 10% 진입 가능",
    },
    {
      icon: "🌐",
      title: "글로벌 IP 확장성",
      desc: "K-판타지 문법 + 보편적 성장 서사 결합으로\n일본·북미 현지화 장벽 최소화",
      prediction: "웹툰 완결 후 소설·애니 IP 전환 시 해외 매출 40%+ 예상",
    },
    {
      icon: "🎭",
      title: "캐릭터 관계망",
      desc: "주인공·라이벌·멘토 삼각 구도에\n예측 불가 배신 서사로 독자 감정 장악",
      prediction: "시즌1 완결 후 팬아트·2차 창작 활성화, 재방문율 60%+ 예상",
    },
    {
      icon: "📱",
      title: "모바일 최적 연출",
      desc: "세로 스크롤 정지 포인트 컷 전략으로\n매화 '다음 화 보기' 클릭률 극대화",
      prediction: "회차 완독률 72% 이상 예상 (플랫폼 평균 58% 대비 +14%p)",
    },
  ],
  competitors: [
    {
      title: "나 혼자만 레벨업",
      platform: "카카오페이지",
      period: "2018~2021",
      readers: "누적 1억 4300만 뷰, 글로벌 14개국 서비스",
      strengths: "압도적 주인공 성장 판타지, 시각적 스펙터클, 영상화 성공",
      weaknesses: "여성 캐릭터 단순화, 관계 서사 부재, 스토리 단선적 구조",
      differentiation: "관계 중심 도덕 서사 + 입체적 빌런으로 감정 깊이 차별화",
      genre_color: "#60a5fa",
    },
    {
      title: "전지적 독자시점",
      platform: "네이버웹툰",
      period: "2020~2023",
      readers: "주간 최고 420만 뷰, 카카오 소설 원작 기반",
      strengths: "메타픽션 구조, 촘촘한 복선 회수, 독자 감정 극한 몰입",
      weaknesses: "원작 소설 선행 지식 필요, 신규 독자 진입 장벽 높음",
      differentiation: "오리지널 IP로 접근성 강화, 1화부터 독자 독립 완주 구조",
      genre_color: "#a78bfa",
    },
    {
      title: "싸움독학",
      platform: "네이버웹툰",
      period: "2019~2023",
      readers: "주간 최고 280만 뷰, 남성 10~20대 압도적 점유",
      strengths: "성장 서사의 교과서, 현실감 있는 싸움 묘사, 높은 재방문율",
      weaknesses: "판타지 요소 부재로 세계관 확장 한계, 글로벌 IP 전환 어려움",
      differentiation: "판타지 세계관 결합으로 확장성 확보, 영상화·게임화 IP 가치 상향",
      genre_color: "#34d399",
    },
  ],
  adoption_strategy: [
    { from_work: "전지적 독자시점", good_point: "독자가 함께 수수께끼를 푸는 메타픽션 구조", how_to_apply: "1화부터 '독자만 아는 단서'를 심어 능동 참여 유도. 댓글·커뮤니티 화제성 자동 생성" },
    { from_work: "나 혼자만 레벨업", good_point: "스탯·시스템 수치화로 성장을 시각적으로 체감", how_to_apply: "능력 성장을 수치 패널로 표현해 독자 성취감 극대화. 다만 관계 서사와 균형 필수" },
    { from_work: "싸움독학", good_point: "현실감 있는 약자 주인공 + 단계적 성장", how_to_apply: "1화 주인공을 약자로 설정하되 명확한 성장 로드맵 제시. 첫 3화 안에 '이유 있는 의지' 장면 삽입" },
  ],
  worldbuilding_notes: [
    { issue: "능력 체계의 규칙이 불명확", suggestion: "Phase 2에서 능력 발동 조건·제한·부작용 3가지를 먼저 확정. 규칙 없는 능력은 독자 몰입 파괴", priority: "high" },
    { issue: "빌런 동기의 논리적 기반 부재", suggestion: "빌런이 '왜 악인가'를 설명할 수 있는 사건 하나를 세계관 역사에 심어야 함. 독자가 빌런에 공감할 수 있는 지점 필수", priority: "high" },
    { issue: "주인공 성장 트리거가 모호", suggestion: "성장이 언제, 왜 일어나는지 명확한 조건 필요. 유사작 나혼자만레벨업의 '던전 시스템'처럼 구체적 메커니즘 설계", priority: "medium" },
  ],
  positioning: {
    ours: { x: 68, y: 74, label: "우리 작품" },
    competitors: [
      { x: 88, y: 24, label: "나혼자만레벨업" },
      { x: 52, y: 80, label: "전지적독자시점" },
      { x: 76, y: 18, label: "싸움독학" },
    ],
  },
  radar: {
    ours: [82, 88, 74, 80, 87],
    avg:  [63, 62, 71, 66, 72],
    categories: ["신선도", "감정몰입", "세계관", "캐릭터", "상업성"],
  },
  final_report: "━━ PHASE 1 최종 기획 분석 보고서 ━━\n\n▶ 시장 분석 요약\n2025년 K-웹툰 시장은 헌터·게이트·스탯 계열 판타지의 황금기가 종료되고, '관계 서사+도덕적 딜레마'를 결합한 차세대 하이브리드 판타지의 공백이 형성 중입니다. 네이버웹툰 기준 10~20대 남성 타깃 장르에서 단순 성장물의 신작 성공률은 15% 이하로 추락했으나, 감정·관계 중심 서사를 가미한 작품은 여전히 안정적 독자층을 확보합니다.\n\n▶ 경쟁 환경\n나 혼자만 레벨업(카카오, 1.4억 뷰)·전지적 독자시점(네이버, 420만 주간뷰)·싸움독학(네이버, 280만 주간뷰)이 장르 기준점을 형성합니다. 이들의 공통 약점인 '단선적 성장 서사'와 '신규 독자 진입 장벽'을 본 기획안은 구조적으로 해결하고 있습니다.\n\n▶ 독창성 평가\n핵심 설정은 Lv1(허용 가능) 클리셰 수준이며, 빌런의 도덕적 동기와 다층적 관계망이 기존 경쟁작과의 명확한 차별점입니다. 심층조사자가 지적한 설정 논리 보완은 Phase 2에서 세계관설계자와 함께 해결 가능합니다.\n\n▶ 제작 가능성\n100화 장기 연재 서사 확장성 양호. 시즌1(50화) 완결 구조로 플랫폼 계약 협상력 확보 가능. 캐릭터 IP 잠재력 높아 소설·굿즈·애니 전환 기대. 네이버웹툰 독점 계약 또는 카카오페이지 동시 연재 전략 권장.\n\n■ 최종 권고: GO\n실현가능성 종합 84점. 시장 공백 정확히 공략하는 포지셔닝으로 Phase 2 세계관 구축 즉시 진행 권장. 전제 조건: 심층조사자 지적 사항(설정 내부 모순 2건) Phase 2 착수 전 해소.",
};

// ─── Parse helpers ────────────────────────────────────────────────────────────

function parsePhase1Result(text: string): Phase1Result | null {
  const match = text.match(/\[PHASE1_RESULT\]([\s\S]*?)\[\/PHASE1_RESULT\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim()) as Phase1Result;
  } catch {
    return null;
  }
}

function stripResultBlock(text: string): string {
  return text.replace(/\[PHASE1_RESULT\][\s\S]*?\[\/PHASE1_RESULT\]/g, "").trim();
}


// ─── Final report prompt (총괄프로듀서 보고서 + JSON) ─────────────────────────

const buildFinalReportPrompt = (allContext: string) => `지금까지의 유사작품 리서치 토론을 바탕으로 기획분석서를 작성하라.
이 분석서는 Phase 2 세계관 설계의 기초 자료로 사용된다.

━━ 전체 리서치 토론 내역 ━━
${allContext}

━━ 보고서 규칙 ━━
• "다들 수고했어요. 제가 정리하겠습니다."로 시작
• 마크다운 금지. 자연스럽고 전문적인 어조.
• 유사 웹툰 리서치 결과를 중심으로 정리 (스토리/세계관 창작 금지)
• similar_works: 토론에서 언급된 실제 작품들 최대한 반영
• adoption_strategy: 유사작의 좋은 점을 우리 기획에 도입하는 구체적 방법 (최소 3개)
• worldbuilding_notes: 기획의 문제점 + Phase 2에서 반드시 보완해야 할 사항 (최소 3개, priority: high/medium/low)
• strengths/weaknesses/improvements: 유사 작품 분석에서 도출된 인사이트 기반
• feasibility_score: 0.70+ = go / 0.50~0.69 = conditional / 미만 = reject
• 분량 (JSON 제외): 150~250자

보고서 직후 다음 JSON 출력 (다른 텍스트 없음):

[PHASE1_RESULT]
{"feasibility_score":0.00,"feasibility_breakdown":{"market":0,"originality":0,"producibility":0,"commercial":0},"verdict":"go","summary":"80자 이내 핵심 요약","genre_analysis":{"genre":"장르명","trend":"현재 장르 트렌드 설명","audience":"주요 타깃 독자층","key_success":"이 장르에서 성공하는 핵심 요소"},"market_analysis":{"platform":"주요 플랫폼","market_size":"시장 규모 설명","growth":"성장세 설명","competition_level":"경쟁 수준 (낮음/보통/높음)","opportunity":"이 기획의 시장 기회"},"similar_works":[{"title":"유사작품명","platform":"플랫폼","similarity":"유사한 점","lesson":"배울 점 또는 차별화 포인트"}],"adoption_strategy":[{"from_work":"유사작품명","good_point":"그 작품의 좋은 점","how_to_apply":"우리 기획에 도입하는 구체적 방법"}],"strengths":["강점1","강점2","강점3"],"weaknesses":["약점1","약점2"],"improvements":["보완할점1","보완할점2"],"worldbuilding_notes":[{"issue":"기획의 문제점 또는 세계관에서 약한 부분","suggestion":"Phase 2에서 보완해야 할 구체적 방향","priority":"high"}],"usp":[{"icon":"⚡","title":"USP제목","desc":"설명 한 줄","prediction":"독자반응 예측"}],"competitors":[{"title":"작품명","platform":"네이버웹툰","period":"YYYY~YYYY","readers":"주간XXX만뷰","strengths":"강점","weaknesses":"약점","differentiation":"차별점","genre_color":"#60a5fa"}],"positioning":{"ours":{"x":0,"y":0,"label":"우리 작품"},"competitors":[{"x":0,"y":0,"label":"작품명"}]},"radar":{"ours":[0,0,0,0,0],"avg":[0,0,0,0,0],"categories":["신선도","감정몰입","세계관","캐릭터","상업성"]},"final_report":"최종 권고 한 단락"}
[/PHASE1_RESULT]`;


// ─── Recharts helper types ────────────────────────────────────────────────────

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: PositioningPoint & { isOurs?: boolean };
}

// ─── Chart: Positioning Matrix ────────────────────────────────────────────────

function PositioningMatrix({ data }: { data: Phase1Result["positioning"] }) {
  const allPoints = [
    { ...data.ours, isOurs: true },
    ...data.competitors.map((c) => ({ ...c, isOurs: false })),
  ];

  const CustomDot = (props: unknown) => {
    const { cx, cy, payload } = props as DotProps;
    if (cx == null || cy == null || !payload) return null;
    const isOurs = payload.isOurs;
    const r = isOurs ? 10 : 8;
    const fill = isOurs ? "#7c6cfc" : "#60a5fa";
    return (
      <g>
        <circle cx={cx} cy={cy} r={r} fill={fill} opacity={0.9} />
        <text
          x={cx}
          y={cy - r - 5}
          textAnchor="middle"
          fill="#e2e8f0"
          fontSize={11}
          fontWeight={isOurs ? 700 : 400}
        >
          {payload.label}
        </text>
      </g>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
        <CartesianGrid stroke="#1e1e2a" strokeDasharray="4 4" />
        <XAxis
          type="number" dataKey="x" domain={[0, 100]}
          tick={{ fill: "#64748b", fontSize: 11 }}
          label={{ value: "마니아 ← → 대중적", position: "insideBottom", offset: -8, fill: "#64748b", fontSize: 11 }}
        />
        <YAxis
          type="number" dataKey="y" domain={[0, 100]}
          tick={{ fill: "#64748b", fontSize: 11 }}
          label={{ value: "신규IP", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 11 }}
        />
        <ReferenceLine x={50} stroke="#2a2a3d" strokeDasharray="4 4" />
        <ReferenceLine y={50} stroke="#2a2a3d" strokeDasharray="4 4" />
        <Scatter
          data={allPoints}
          shape={(props: unknown) => CustomDot(props as DotProps)}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ─── Chart: Radar ─────────────────────────────────────────────────────────────

function RadarChartView({ data }: { data: Phase1Result["radar"] }) {
  const chartData = data.categories.map((cat, i) => ({
    subject: cat,
    ours: data.ours[i],
    avg: data.avg[i],
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={chartData}>
        <PolarGrid stroke="#2a2a3d" />
        <PolarAngleAxis dataKey="subject" tick={{ fill: "#94a3b8", fontSize: 12 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar name="우리작품" dataKey="ours" stroke="#7c6cfc" fill="#7c6cfc" fillOpacity={0.3} />
        <Radar name="경쟁작 평균" dataKey="avg" stroke="#2dd4bf" fill="#2dd4bf" fillOpacity={0.1} strokeDasharray="5 3" />
        <Legend wrapperStyle={{ paddingTop: "12px", fontSize: "12px", color: "#94a3b8" }} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

// ─── Chart: Feasibility Radial ────────────────────────────────────────────────

function FeasibilityChart({ data }: { data: Phase1Result["feasibility_breakdown"] }) {
  const chartData = [
    { name: "상업성",    value: data.commercial,    fill: "#fbbf24" },
    { name: "제작가능성", value: data.producibility, fill: "#34d399" },
    { name: "독창성",    value: data.originality,   fill: "#a78bfa" },
    { name: "시장성",    value: data.market,        fill: "#60a5fa" },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderLegend = (props: any) => {
    const { payload = [] } = props;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center", marginTop: 4 }}>
        {(payload as Array<{ payload: { fill: string; name: string; value: number } }>).map((entry, i) => {
          return (
            <span key={i} style={{ fontSize: 11, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: entry.payload.fill, display: "inline-block" }} />
              {entry.payload.name} {entry.payload.value}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={220}>
      <RadialBarChart
        innerRadius="30%" outerRadius="90%"
        startAngle={90} endAngle={-270}
        data={chartData}
        barSize={14}
      >
        <RadialBar background={{ fill: "#1a1a27" }} dataKey="value" />
        <Legend content={renderLegend} />
        <Tooltip
          formatter={(v: unknown) => [`${Number(v)}점`, ""]}
          contentStyle={{ background: "#16161f", border: "1px solid #2a2a3d", borderRadius: 8, fontSize: 12 }}
        />
      </RadialBarChart>
    </ResponsiveContainer>
  );
}

// ─── Debate UI atoms ──────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <span className={styles.thinkingDots}>
      <span className={styles.dot} />
      <span className={styles.dot} />
      <span className={styles.dot} />
    </span>
  );
}

// ─── Image Search Card (Claude web_search) ────────────────────────────────────

function ImageSearchCard({ query, delayMs = 0 }: { query: string; delayMs?: number }) {
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/image-search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error("image-search API failed");
        const data = (await res.json()) as { urls: string[] };
        if (!cancelled) {
          setImages(data.urls ?? []);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    }, delayMs);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, delayMs]);

  return (
    <div style={{
      background: "rgba(96,165,250,0.07)", border: "1px solid rgba(96,165,250,0.2)",
      borderRadius: 10, padding: "10px 12px", margin: "8px 0",
    }}>
      <div style={{ fontSize: 11, color: "#60a5fa", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <span>🖼️</span><span>이미지 서치</span>
        <span style={{ color: "#334155" }}>·</span>
        <span style={{ color: "#94a3b8", fontStyle: "italic", fontWeight: 400 }}>{query}</span>
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: "#64748b", padding: "4px 0", display: "flex", alignItems: "center", gap: 6 }}>
          <ThinkingDots />
          <span>이미지 탐색 중...</span>
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: "#f87171" }}>⚠ {error}</div>
      )}

      {!loading && images.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 8 }}>
          {images.map((url, idx) => (
            <a
              key={idx}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ borderRadius: 8, overflow: "hidden", display: "block", border: "1px solid rgba(96,165,250,0.2)" }}
            >
              <img
                src={url}
                alt={query}
                style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }}
                loading="lazy"
                onError={(e) => {
                  (e.currentTarget.parentElement as HTMLElement).style.display = "none";
                }}
              />
            </a>
          ))}
        </div>
      )}

      {/* 항상 Google 이미지 링크 표시 (이미지 없을 때는 더 크게) */}
      {!loading && (
        <a
          href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex", alignItems: "center", gap: 5, marginTop: 4,
            fontSize: 11, color: "#60a5fa", textDecoration: "none",
            background: "rgba(96,165,250,0.08)", borderRadius: 5,
            padding: "3px 10px", border: "1px solid rgba(96,165,250,0.2)",
          }}
        >
          {images.length === 0 ? "🔍 Google 이미지에서 보기 →" : "더 찾기 →"}
        </a>
      )}
    </div>
  );
}

function RoundHeader({ round, label }: { round: number; label: string }) {
  return (
    <div className={styles.roundHeader}>
      <div className={styles.roundLine} />
      <span className={styles.roundBadge}>Round {round} · {label}</span>
      <div className={styles.roundLine} />
    </div>
  );
}

// ─── Message line renderer (supports agent formatting) ───────────────────────

function renderMsgLine(line: string, i: number, agentColor: string) {
  // 🔍 Web search indicator line
  if (line.includes("🔍 **웹 검색**") || line.startsWith("🔍")) {
    const query = line.replace(/.*🔍\s*\*\*웹 검색\*\*:\s*/, "").replace(/"/g, "");
    return (
      <div key={i} style={{
        display: "flex", alignItems: "center", gap: 6,
        background: "rgba(124,108,252,0.08)", border: "1px solid rgba(124,108,252,0.18)",
        borderRadius: 6, padding: "4px 10px", margin: "6px 0", fontSize: 11, color: "#a78bfa",
      }}>
        <span>🔍</span>
        <span style={{ color: "#64748b" }}>웹 검색:</span>
        <span style={{ fontStyle: "italic" }}>{query}</span>
      </div>
    );
  }
  // 🖼️ Image search — 말풍선 내 순서(i)에 따라 딜레이를 줘서 하나씩 순차 실행
  if (line.startsWith("🖼️")) {
    const raw = line
      .replace(/^🖼️\s*이미지\s*서치\s*:\s*/i, "")
      .replace(/^🖼️\s*이미지\s*검색\s*:\s*/i, "")
      .replace(/"/g, "").trim();
    // i번째 이미지 서치: i * 12초 딜레이로 순차 실행 (동시 429 방지)
    return <ImageSearchCard key={i} query={raw} delayMs={i * 12000} />;
  }
  // ⏳ Rate-limit wait indicator
  if (line.includes("⏳") && line.includes("레이트 리밋")) {
    return (
      <div key={i} style={{
        background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)",
        borderRadius: 6, padding: "4px 10px", margin: "4px 0", fontSize: 11, color: "#fbbf24",
      }}>
        {line.replace(/\*\*/g, "")}
      </div>
    );
  }
  // ━━ Section heading ━━
  if (line.startsWith("━━") || (line.startsWith("[") && line.endsWith("]"))) {
    return (
      <div key={i} style={{ fontWeight: 700, color: agentColor, fontSize: 12, marginTop: i === 0 ? 0 : 10, marginBottom: 3, letterSpacing: "0.03em" }}>
        {line}
      </div>
    );
  }
  // • or ① ② ③ bullets
  if (/^[•①②③④⑤]/.test(line)) {
    return (
      <div key={i} style={{ paddingLeft: 12, color: "#cbd5e1", fontSize: 13, lineHeight: 1.6, marginBottom: 2 }}>
        {line}
      </div>
    );
  }
  // Blank line → small gap
  if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
  // Default
  return (
    <div key={i} style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.65 }}>
      {line}
    </div>
  );
}

function MsgBubble({ msg, onReply }: { msg: Msg; key?: string; onReply?: (msg: Msg) => void }) {
  const [hovered, setHovered] = useState(false);
  const agent = AGENTS[msg.agent] ?? { label: msg.agent, emoji: "🤖", color: "#94a3b8", bg: "rgba(148,163,184,0.10)" };
  const isUser = msg.agent === "user";
  const displayText = msg.agent === "producer" ? stripResultBlock(msg.text) : msg.text;

  return (
    <div
      className={`${styles.msgRow} ${isUser ? styles.msgRowUser : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: "relative" }}
    >
      {!isUser && (
        <div className={styles.avatar} style={{ background: agent.bg, borderColor: agent.color }}>
          {agent.emoji}
        </div>
      )}
      <div className={styles.msgContent}>
        {!isUser && (
          <span className={styles.agentName} style={{ color: agent.color }}>
            {agent.label}
          </span>
        )}
        <div
          className={`${styles.bubble} ${isUser ? styles.bubbleUser : ""}`}
          style={!isUser ? { borderLeftColor: agent.color, background: agent.bg } : {}}
        >
          {/* 댓글 대상 말풍선 인용 표시 */}
          {isUser && msg.replyQuote && (
            <div style={{
              borderLeft: "2px solid rgba(165,180,252,0.5)",
              paddingLeft: 8, marginBottom: 6,
              color: "rgba(165,180,252,0.8)", fontSize: 11,
            }}>
              <span style={{ fontWeight: 600 }}>{msg.replyQuote.agentLabel}</span>
              {" — "}
              <span style={{ opacity: 0.85 }}>{msg.replyQuote.preview}</span>
            </div>
          )}
          {isUser
            ? displayText.split("\n").map((line, i) => (
                <span key={i}>{line}{i < displayText.split("\n").length - 1 && <br />}</span>
              ))
            : displayText.split("\n").map((line, i) => renderMsgLine(line, i, agent.color))
          }
          {msg.streaming && <span className={styles.streamCursor} />}
          {msg.streaming && !displayText && <ThinkingDots />}
        </div>
        {/* 댓글 버튼 — 호버 시 표시, 에이전트 발언에만 */}
        {!isUser && !msg.streaming && onReply && hovered && (
          <button
            onClick={() => onReply(msg)}
            style={{
              marginTop: 4, padding: "2px 10px", fontSize: 11,
              background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)",
              borderRadius: 99, color: "#a5b4fc", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            ↩ 댓글 달기
          </button>
        )}
      </div>
      {isUser && (
        <div className={styles.avatar} style={{ background: agent.bg, borderColor: agent.color }}>
          {agent.emoji}
        </div>
      )}
    </div>
  );
}


// ─── Result sections ──────────────────────────────────────────────────────────

function GenreMarketSection({ result }: { result: Phase1Result }) {
  const g = result.genre_analysis;
  const m = result.market_analysis;
  if (!g || !m) return null;
  return (
    <div className={styles.twoColGrid}>
      <section className={styles.resultSec}>
        <div className={styles.secHeaderRow}>
          <span className={styles.secNum}>01</span>
          <div className={styles.secHeader}>
            <h3 className={styles.secTitle}>장르 분석</h3>
            <p className={styles.secSub}>{g.genre}</p>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 0" }}>
          {[
            { label: "현재 트렌드", val: g.trend },
            { label: "주요 독자층", val: g.audience },
            { label: "성공 핵심 요소", val: g.key_success },
          ].map(({ label, val }) => (
            <div key={label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: "#7c6cfc", fontWeight: 700, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 13, color: "#c8d0dc", lineHeight: 1.6 }}>{val}</div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.resultSec}>
        <div className={styles.secHeaderRow}>
          <span className={styles.secNum}>02</span>
          <div className={styles.secHeader}>
            <h3 className={styles.secTitle}>시장 분석</h3>
            <p className={styles.secSub}>{m.platform}</p>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 0" }}>
          {[
            { label: "시장 규모", val: m.market_size },
            { label: "성장세", val: m.growth },
            { label: "경쟁 수준", val: m.competition_level },
            { label: "기회 포인트", val: m.opportunity },
          ].map(({ label, val }) => (
            <div key={label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: "#34d399", fontWeight: 700, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 13, color: "#c8d0dc", lineHeight: 1.6 }}>{val}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SWOTSection({ result }: { result: Phase1Result }) {
  if (!result.strengths && !result.weaknesses && !result.improvements) return null;
  const cols = [
    { label: "강점", color: "#34d399", items: result.strengths ?? [] },
    { label: "약점", color: "#f87171", items: result.weaknesses ?? [] },
    { label: "보완할 점", color: "#fbbf24", items: result.improvements ?? [] },
  ];
  return (
    <section className={styles.resultSec}>
      <div className={styles.secHeaderRow}>
        <span className={styles.secNum}>03</span>
        <div className={styles.secHeader}>
          <h3 className={styles.secTitle}>강점 · 약점 · 보완점</h3>
          <p className={styles.secSub}>이 기획의 핵심 평가</p>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {cols.map(({ label, color, items }) => (
          <div key={label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "14px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 10 }}>{label}</div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((item, i) => (
                <li key={i} style={{ fontSize: 13, color: "#c8d0dc", lineHeight: 1.5, display: "flex", gap: 8 }}>
                  <span style={{ color, flexShrink: 0 }}>▸</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function SimilarWorksDeepSection({ similar_works }: { similar_works: Phase1Result["similar_works"] }) {
  if (!similar_works?.length) return null;
  return (
    <section className={styles.resultSec}>
      <div className={styles.secHeaderRow}>
        <span className={styles.secNum}>04</span>
        <div className={styles.secHeader}>
          <h3 className={styles.secTitle}>유사작품 분석</h3>
          <p className={styles.secSub}>레퍼런스 작품과의 비교 및 차별화 포인트</p>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {similar_works.map((w, i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "14px 16px", display: "grid", gridTemplateColumns: "140px 1fr 1fr", gap: 16, alignItems: "start" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#e2e8f0", marginBottom: 4 }}>{w.title}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>{w.platform}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#60a5fa", fontWeight: 700, marginBottom: 4 }}>유사한 점</div>
              <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5 }}>{w.similarity}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#fbbf24", fontWeight: 700, marginBottom: 4 }}>배울 점 / 차별화</div>
              <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5 }}>{w.lesson}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SimilarWorksSection({ competitors }: { competitors: Competitor[] }) {
  return (
    <section className={styles.resultSec}>
      <div className={styles.secHeaderRow}>
        <span className={styles.secNum}>05</span>
        <div className={styles.secHeader}>
          <h3 className={styles.secTitle}>경쟁작 벤치마크</h3>
          <p className={styles.secSub}>실제 플랫폼 데이터 기반 경쟁작 상세 분석</p>
        </div>
      </div>
      <div className={styles.competitorGrid}>
        {competitors.map((c, i) => (
          <div key={i} className={styles.competitorCard}>
            <div
              className={styles.competitorHeader}
              style={{ background: `${c.genre_color}18`, borderBottomColor: `${c.genre_color}40` }}
            >
              <div className={styles.competitorTitle}>{c.title}</div>
              <div className={styles.competitorMeta}>
                <span className={styles.platformBadge} style={{ borderColor: c.genre_color, color: c.genre_color }}>
                  {c.platform}
                </span>
                <span className={styles.periodText}>{c.period}</span>
                <span className={styles.readersText}>{c.readers}</span>
              </div>
            </div>
            <div className={styles.competitorBody}>
              <div className={styles.competitorRow}>
                <span className={styles.compRowLabel} style={{ color: "#34d399" }}>강점</span>
                <span className={styles.compRowVal}>{c.strengths}</span>
              </div>
              <div className={styles.competitorRow}>
                <span className={styles.compRowLabel} style={{ color: "#f87171" }}>약점</span>
                <span className={styles.compRowVal}>{c.weaknesses}</span>
              </div>
              <div className={styles.competitorDiff}>
                <span className={styles.compDiffLabel}>차별점</span>
                <span className={styles.compDiffVal}>{c.differentiation}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 유사작품 도입 전략 섹션 (목표③) ──────────────────────────────────────────

function AdoptionStrategySection({ strategies }: { strategies: Phase1Result["adoption_strategy"] }) {
  if (!strategies?.length) return null;
  return (
    <section className={styles.resultSec}>
      <div className={styles.secHeaderRow}>
        <span className={styles.secNum} style={{ background: "rgba(52,211,153,0.15)", color: "#34d399" }}>★</span>
        <div className={styles.secHeader}>
          <h3 className={styles.secTitle}>유사작품 도입 전략</h3>
          <p className={styles.secSub}>좋은 점을 우리 기획에 적용하는 방법</p>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {strategies.map((s, i) => (
          <div key={i} style={{
            background: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.18)",
            borderRadius: 10, padding: "14px 16px",
            display: "grid", gridTemplateColumns: "160px 1fr 1fr", gap: 16, alignItems: "start",
          }}>
            <div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>참고 작품</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#34d399" }}>{s.from_work}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#34d399", fontWeight: 700, marginBottom: 4 }}>좋은 점</div>
              <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.55 }}>{s.good_point}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#fbbf24", fontWeight: 700, marginBottom: 4 }}>우리 기획 적용 방법</div>
              <div style={{ fontSize: 13, color: "#c8d0dc", lineHeight: 1.55 }}>{s.how_to_apply}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 세계관 보완사항 섹션 (목표②, Phase 2 인계) ────────────────────────────────

function WorldbuildingNotesSection({ notes }: { notes: Phase1Result["worldbuilding_notes"] }) {
  if (!notes?.length) return null;
  const priorityStyle = {
    high:   { label: "긴급", color: "#f87171", bg: "rgba(248,113,113,0.12)" },
    medium: { label: "중요", color: "#fbbf24", bg: "rgba(251,191,36,0.10)"  },
    low:    { label: "참고", color: "#60a5fa", bg: "rgba(96,165,250,0.10)"  },
  };
  return (
    <section className={styles.resultSec} style={{ border: "1px solid rgba(248,113,113,0.25)", borderRadius: 12 }}>
      <div className={styles.secHeaderRow}>
        <span className={styles.secNum} style={{ background: "rgba(248,113,113,0.15)", color: "#f87171" }}>⚠</span>
        <div className={styles.secHeader}>
          <h3 className={styles.secTitle} style={{ color: "#f87171" }}>세계관 보완사항 — Phase 2 인계</h3>
          <p className={styles.secSub}>이 기획의 문제점과 Phase 2에서 반드시 해결해야 할 사항</p>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {notes.map((n, i) => {
          const p = priorityStyle[n.priority] ?? priorityStyle.medium;
          return (
            <div key={i} style={{
              background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "14px 16px",
              borderLeft: `3px solid ${p.color}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: p.color, background: p.bg, padding: "2px 8px", borderRadius: 4 }}>
                  {p.label}
                </span>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{n.issue}</div>
              </div>
              <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6, paddingLeft: 4 }}>
                ▸ {n.suggestion}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12, padding: "8px 14px", background: "rgba(248,113,113,0.06)", borderRadius: 8, fontSize: 12, color: "#64748b" }}>
        💡 위 사항은 Phase 2 세계관 설계 시 자동으로 참고 자료로 전달됩니다.
      </div>
    </section>
  );
}

function PositioningSection({
  positioning, radar, mounted,
}: {
  positioning: Phase1Result["positioning"];
  radar: Phase1Result["radar"];
  mounted: boolean;
}) {
  return (
    <div className={styles.twoColGrid}>
      <section className={styles.resultSec}>
        <div className={styles.secHeaderRow}>
          <span className={styles.secNum}>06</span>
          <div className={styles.secHeader}>
            <h3 className={styles.secTitle}>포지셔닝 맵</h3>
            <p className={styles.secSub}>시장 내 좌표 (대중성 × 신규IP)</p>
          </div>
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartWrap}>
            {mounted ? (
              <PositioningMatrix data={positioning} />
            ) : (
              <div className={styles.chartPlaceholder} />
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 8px" }}>
            <span className={styles.axisLabel}>← 마니아</span>
            <span className={styles.axisLabel}>대중적 →</span>
          </div>
        </div>
      </section>

      <section className={styles.resultSec}>
        <div className={styles.secHeaderRow}>
          <span className={styles.secNum}>07</span>
          <div className={styles.secHeader}>
            <h3 className={styles.secTitle}>역량 레이더</h3>
            <p className={styles.secSub}>5개 축 경쟁작 평균 대비 평가</p>
          </div>
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartWrap}>
            {mounted ? (
              <RadarChartView data={radar} />
            ) : (
              <div className={styles.chartPlaceholder} />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function USPSection({ usp }: { usp: USP[] }) {
  return (
    <section className={styles.resultSec}>
      <div className={styles.secHeaderRow}>
        <span className={styles.secNum}>04</span>
        <div className={styles.secHeader}>
          <h3 className={styles.secTitle}>핵심 독자 가치 제안 (USP)</h3>
          <p className={styles.secSub}>독자가 이 작품에서 얻는 고유한 경험</p>
        </div>
      </div>
      <div className={styles.uspGrid}>
        {usp.map((u, i) => (
          <div key={i} className={styles.uspCard}>
            <div className={styles.uspIconWrap}>{u.icon}</div>
            <div className={styles.uspTitle}>{u.title}</div>
            <div className={styles.uspDesc}>
              {u.desc.split("\n").map((line, j) => (
                <span key={j}>{line}{j < u.desc.split("\n").length - 1 && <br />}</span>
              ))}
            </div>
            <div className={styles.uspPrediction}>💡 {u.prediction}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeasibilitySection({
  result, mounted,
}: {
  result: Phase1Result;
  mounted: boolean;
}) {
  const score = result.feasibility_score;
  const verdictColor =
    result.verdict === "go" ? "#34d399" :
    result.verdict === "conditional" ? "#fbbf24" : "#f87171";
  const verdictLabel =
    result.verdict === "go" ? "✅ Phase 2 진행 권장" :
    result.verdict === "conditional" ? "⚠️ 조건부 진행" : "❌ 재기획 권장";

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - score);

  const breakdown = [
    { label: "시장성",    value: result.feasibility_breakdown.market,        color: "#60a5fa" },
    { label: "독창성",    value: result.feasibility_breakdown.originality,   color: "#a78bfa" },
    { label: "제작가능성", value: result.feasibility_breakdown.producibility, color: "#34d399" },
    { label: "상업성",    value: result.feasibility_breakdown.commercial,    color: "#fbbf24" },
  ];

  return (
    <section className={styles.resultSec}>
      <div className={styles.secHeaderRow}>
        <span className={styles.secNum}>05</span>
        <div className={styles.secHeader}>
          <h3 className={styles.secTitle}>실현 가능성 평가</h3>
          <p className={styles.secSub}>4개 축 종합 점수 및 Phase 2 진행 권고</p>
        </div>
      </div>
      <div className={styles.feasibilityWrap}>
        <div className={styles.feasibilityGaugeCol}>
          <svg width={140} height={140} viewBox="0 0 140 140">
            <circle cx={70} cy={70} r={radius} fill="none" stroke="#1e1e2a" strokeWidth={12} />
            <circle
              cx={70} cy={70} r={radius}
              fill="none"
              stroke={verdictColor}
              strokeWidth={12}
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 70 70)"
              style={{ transition: "stroke-dashoffset 1s ease" }}
            />
            <text x={70} y={66} textAnchor="middle" fill="#f1f5f9" fontSize={22} fontWeight={700}>
              {Math.round(score * 100)}
            </text>
            <text x={70} y={82} textAnchor="middle" fill="#64748b" fontSize={11}>
              / 100
            </text>
          </svg>
          <div className={styles.feasibilityVerdict} style={{ color: verdictColor }}>
            {verdictLabel}
          </div>
          <p className={styles.feasibilitySummary}>{result.summary}</p>
        </div>

        <div className={styles.feasibilityChartCol}>
          {mounted ? <FeasibilityChart data={result.feasibility_breakdown} /> : <div className={styles.chartPlaceholder} />}
          <div className={styles.feasibilityBreakdown}>
            {breakdown.map((b, i) => (
              <div key={i} className={styles.breakdownRow}>
                <span className={styles.breakdownLabel}>{b.label}</span>
                <div className={styles.breakdownBar}>
                  <div
                    className={styles.breakdownFill}
                    style={{ width: `${b.value}%`, background: b.color }}
                  />
                </div>
                <span className={styles.breakdownVal}>{b.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalReportSection({ report }: { report: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const renderLine = (line: string, i: number) => {
    if (line.startsWith("■") || line.startsWith("▶") || line.startsWith("━━")) {
      return <div key={i} className={styles.reportHeading}>{line}</div>;
    }
    if (line.startsWith("━")) {
      return <hr key={i} style={{ border: "none", borderTop: "1px solid #23233a", margin: "8px 0" }} />;
    }
    if (line.startsWith("- ") || line.startsWith("• ") || line.startsWith("①") || line.startsWith("②") || line.startsWith("③")) {
      return <div key={i} className={styles.reportBullet}>{line}</div>;
    }
    if (line.trim() === "") {
      return <br key={i} />;
    }
    return <div key={i} className={styles.reportLine}>{line}</div>;
  };

  return (
    <section className={styles.resultSec}>
      <div className={styles.secHeaderRow}>
        <span className={styles.secNum}>06</span>
        <div className={styles.secHeader}>
          <h3 className={styles.secTitle}>최종 분석 보고서</h3>
          <p className={styles.secSub}>총괄 프로듀서 종합 의견서</p>
        </div>
        <button className={styles.btnCopy} onClick={handleCopy}>
          {copied ? "✓ 복사됨" : "복사"}
        </button>
      </div>
      <div className={styles.finalReportCard}>
        {report.split("\n").map((line, i) => renderLine(line, i))}
      </div>
    </section>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const GENRES = ["판타지", "로맨스", "액션", "SF", "스릴러", "일상·힐링", "무협", "스포츠", "공포", "역사"];

const PLATFORMS = [
  { value: "naver",  label: "네이버웹툰",  desc: "10~20대 男 액션·판타지 강세, 글로벌 노출" },
  { value: "kakao",  label: "카카오페이지", desc: "25~35세 女 로맨스·오피스 강세, 유료 결제율 1위" },
  { value: "lezhin", label: "레진코믹스",   desc: "30대+ 마니아, 성인·BL·장르물 허용" },
  { value: "undecided", label: "미정",      desc: "에이전트가 최적 플랫폼을 추천합니다" },
] as const;
type PlatformValue = typeof PLATFORMS[number]["value"];

const EPISODE_COUNTS = ["30화", "50화", "100화", "150화", "200화", "미정"] as const;
type EpisodeCount = typeof EPISODE_COUNTS[number];

export default function Phase1Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();

  // ── State ──
  const [stage, setStage] = useState<Stage>("form");
  const [debatePhase, setDebatePhase] = useState<DebatePhase>("idle");
  const [genre, setGenre] = useState(GENRES[0]);
  const [platform, setPlatform] = useState<PlatformValue>("undecided");
  const [episodeCount, setEpisodeCount] = useState<EpisodeCount>("30화");
  const [concept, setConcept] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [result, setResult] = useState<Phase1Result | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [showGatingModal, setShowGatingModal] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const [isWritingReport, setIsWritingReport] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [coveredAgendaIds, setCoveredAgendaIds] = useState<AgendaId[]>([]); // 다뤄진 아젠다 항목 (UI 표시용)
  const [statusMsg, setStatusMsg] = useState(""); // 진행 상태 안내 메시지
  const [replyTo, setReplyTo] = useState<{ msg: Msg; agentLabel: string; preview: string } | null>(null);
  const [rejectedWorks, setRejectedWorks] = useState<string[]>([]); // 사용자가 부정한 유사작품 블랙리스트
  const rejectedWorksRef = useRef<string[]>([]);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  // ── Refs ──
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const pendingUserMsgRef = useRef<string | null>(null);
  const pendingUserMsgIdRef = useRef<string | null>(null);
  const userTypingRef = useRef(false);
  const savedTranscriptRef = useRef<string[]>([]);
  const isComposingRef = useRef(false);

  // rejectedWorks state → ref 동기화 + localStorage 영구 저장
  useEffect(() => {
    rejectedWorksRef.current = rejectedWorks;
    if (rejectedWorks.length > 0) {
      try { localStorage.setItem(`p1_rejected_${projectId}`, JSON.stringify(rejectedWorks)); } catch { /* ignore */ }
    }
  }, [rejectedWorks, projectId]);

  useEffect(() => {
    setMounted(true);
    if (!projectId) return;

    // 0-a) 블랙리스트 복원
    try {
      const saved = localStorage.getItem(`p1_rejected_${projectId}`);
      if (saved) {
        const list = JSON.parse(saved) as string[];
        setRejectedWorks(list);
        rejectedWorksRef.current = list;
      }
    } catch { /* ignore */ }

    // 0) Restore saved conversation messages
    let hasSavedMsgs = false;
    const rawMsgs = localStorage.getItem(`p1_msgs_${projectId}`);
    if (rawMsgs) {
      try {
        const savedMsgs = JSON.parse(rawMsgs) as Msg[];
        const nonEmptyMsgs = savedMsgs.filter((m: Msg) => m.text.trim().length > 0);
        if (nonEmptyMsgs.length > 0) {
          setMsgs(nonEmptyMsgs);
          hasSavedMsgs = true;
        }
      } catch { /* ignore */ }
    }

    // 0b) Restore saved conv history (for resume)
    const rawConv = localStorage.getItem(`p1_conv_${projectId}`);
    if (rawConv) {
      try {
        const saved = JSON.parse(rawConv) as {
          transcript: string[];
          genre: string; concept: string; platform: string; episodeCount: string;
        };
        savedTranscriptRef.current = saved.transcript ?? [];
        if (saved.genre) setGenre(saved.genre);
        if (saved.concept) setConcept(saved.concept);
        if (saved.platform) setPlatform(saved.platform as PlatformValue);
        if (saved.episodeCount) setEpisodeCount(saved.episodeCount as EpisodeCount);
      } catch { /* ignore */ }
    }

    // 1) Try localStorage first — auto-redirect to debate if result exists
    const raw = localStorage.getItem(`p1_result_${projectId}`);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as { result: Phase1Result; genre: string; concept: string; savedAt: string; };
        setGenre(saved.genre);
        setConcept(saved.concept);
        setResult(saved.result);
        setSavedAt(saved.savedAt);
        setStage("debate");
        setDebatePhase("done");
        return; // localStorage hit — skip Firestore
      } catch { /* ignore */ }
    }

    // 1b) No result yet but have saved messages → debate was interrupted (paused)
    if (hasSavedMsgs) {
      setStage("debate");
      setDebatePhase("paused");
      return;
    }

    // 2) Fallback: load from Firestore (if localStorage is empty / cleared)
    if (!db) return;
    getDoc(doc(db, "project_summary", projectId, "phase_1", "result"))
      .then((snap: import("firebase/firestore").DocumentSnapshot) => {
        if (!snap.exists()) return;
        const data = snap.data() as Phase1Result & { genre?: string; concept?: string; savedAt?: { toDate?: () => Date } };
        const savedDate = data.savedAt?.toDate?.()?.toISOString() ?? new Date().toISOString();
        // Re-populate localStorage so next load is instant
        const g = data.genre ?? "";
        const c = data.concept ?? "";
        const payload = { result: data as Phase1Result, genre: g, concept: c, savedAt: savedDate };
        localStorage.setItem(`p1_result_${projectId}`, JSON.stringify(payload));
        localStorage.setItem(`wts_phase1_${projectId}`, JSON.stringify({
          input: { genre: g, concept: c, savedAt: savedDate },
          data: { ...(data as Phase1Result), genre: g, concept: c, savedAt: savedDate },
        }));
        setGenre(g);
        setConcept(c);
        setResult(data as Phase1Result);
        setSavedAt(savedDate);
        setStage("debate");
        setDebatePhase("done");
      })
      .catch(() => {}); // Firestore unavailable — silently skip
  }, [projectId]);

  // Auto-scroll
  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [msgs]);

  // ── Save conversation whenever all streaming finishes ──
  useEffect(() => {
    if (!projectId || msgs.length === 0) return;
    if (msgs.some((m: Msg) => m.streaming)) return; // wait until round is fully done
    localStorage.setItem(`p1_msgs_${projectId}`, JSON.stringify(msgs));
  }, [msgs, projectId]);

  // ── Message helpers ──
  const addMsg = useCallback((agent: AgentId, round: number, text = "", streaming = false): string => {
    const id = `${agent}_${Date.now()}_${Math.random()}`;
    setMsgs((prev: Msg[]) => [...prev, { id, agent, round, text, streaming }]);
    return id;
  }, []);

  const updateMsg = useCallback((id: string, text: string, streaming: boolean) => {
    setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === id ? { ...m, text, streaming } : m));
  }, []);

  // ── Helper: sleep ──
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // ── Save result ──
  const saveResult = useCallback((res: Phase1Result, g: string, c: string, ep: string = "", plat: string = "") => {
    const savedAt = new Date().toISOString();
    const payload = { result: res, genre: g, concept: c, savedAt };
    localStorage.setItem(`p1_result_${projectId}`, JSON.stringify(payload));
    setSavedAt(savedAt);

    // Write cross-phase canonical key so Phase 2/3/4/5 can read Phase 1 data.
    // Structure covers all access patterns used across the codebase:
    //   p1?.input?.genre        (Phase 2, 3, 4)
    //   p1?.input?.episodeCount (Phase 3 — 화수 계획)
    //   p1?.data?.genre         (Phase 5)
    //   p1?.data?.feasibility_score  (Projects list)
    localStorage.setItem(`wts_phase1_${projectId}`, JSON.stringify({
      input: { genre: g, concept: c, episodeCount: ep, platform: plat, savedAt },
      data: { ...res, genre: g, concept: c, episodeCount: ep, savedAt },
    }));

    // Best-effort Firestore save
    if (db) {
      setDoc(doc(db, "project_summary", projectId, "phase_1", "result"), {
        ...res,
        genre: g,
        concept: c,
        savedAt: serverTimestamp(),
      }).catch(() => {});
    }
  }, [projectId]);

  // ── Run debate: 에이전트 1명씩 별도 API 호출 (Phase 2와 동일한 방식) ──
  const runDebate = useCallback(async (
    g: string, c: string, plat: string, ep: string,
    resumeTranscript?: string[]
  ) => {
    if (runningRef.current) return;
    runningRef.current = true;

    const apiKey = getAnthropicKey();
    const platLabel = PLATFORMS.find((p) => p.value === plat)?.label ?? plat;

    // ── Helper: simulate typing for mock mode ──
    const typeMsg = async (msgId: string, text: string) => {
      const CHUNK = 6;
      for (let i = CHUNK; i <= text.length + CHUNK; i += CHUNK) {
        updateMsg(msgId, text.slice(0, i), true);
        await new Promise((r) => setTimeout(r, 18));
      }
      updateMsg(msgId, text, false);
    };

    if (!apiKey) {
      // ── MOCK MODE ──
      setIsMock(true);
      setDebatePhase("running");
      setTurnCount(0);

      const MOCK_LINES: Array<{ agent: AgentId; text: string }> = [
        { agent: "strategist",   text: `이미 비슷한 거 세 개 있는데, 이 기획은 뭐가 다르죠?` },
        { agent: "researcher",   text: `잠깐, 주인공이 갑자기 강해지는 건데... 이유가 있어요?` },
        { agent: "character",    text: `그게 제일 중요한 거 아니에요? 독자가 왜 이 캐릭터를 좋아해야 해요?` },
        { agent: "strategist",   text: `포지셔닝 봐요. 감성 서사 + 도덕 딜레마 조합, 이 영역이 비어 있어요.` },
        { agent: "researcher",   text: `(잠시 생각하다가) 그건... 맞는 말인데, 설정 모순은요?` },
        { agent: "worldbuilder", text: `능력 체계가 정해지면 자연스럽게 해결되는 문제예요.` },
        { agent: "scenario",     text: `1화에 봉인 암시 컷 하나 넣으면 되잖아요. 이탈률 잡을 수 있어요.` },
        { agent: "script",       text: `그 장면, 클로즈업 아니면 임팩트 없어요. 표정으로만 가야 해요.` },
        { agent: "producer",     text: `좋아요, 정리할게요. 이 기획, 진행합시다.` },
      ];

      for (let i = 0; i < MOCK_LINES.length; i++) {
        const m = MOCK_LINES[i];
        setTurnCount(i + 1);
        const id = addMsg(m.agent, i + 1, "", true);
        await typeMsg(id, m.text);
        await sleep(400);
      }

      setResult(MOCK_RESULT);
      saveResult(MOCK_RESULT, g, c, ep, plat);
      setDebatePhase("done");
      runningRef.current = false;
      return;
    }

    // ── REAL API MODE ──
    setDebatePhase("running");
    setCoveredAgendaIds([]);

    // 명령 패턴은 debate-config.ts의 USER_COMMAND_PATTERNS에서 관리
    const matchCommand = (msg: string) =>
      USER_COMMAND_PATTERNS.find(p => p.triggers.some(t => msg.includes(t))) ?? null;

    // 이어하기: 저장된 트랜스크립트 복원 / 새 시작: 빈 배열
    let transcript: string[] = resumeTranscript ? [...resumeTranscript] : [];

    // agentIndex: API 키 로테이션용 카운터
    let agentIndex = transcript.filter(l => {
      for (const agent of AGENT_SPEAKING_ORDER_P1) {
        if (l.includes(`[${AGENTS[agent].label}]`)) return true;
      }
      return false;
    }).length;

    let round = transcript.filter(l => !l.startsWith("[사용자]")).length + 1;
    setTurnCount(round);
    let lastSpeaker: AgentId | null = null;
    let recentSpeakers: AgentId[] = [];  // 최근 3명 발언자 (중복 방지)
    let lastUserMsg = "";   // 가장 최근 사용자 발언
    let userTurnCount = 0;  // > 0 이면 "사용자 응답 모드"
    let wrapUpProposed = false;     // 프로듀서가 마무리 제안 중
    let wrapUpProposedAt = 0;       // 제안 시각 (ms)
    let wrapUpCooldown = 0;         // 사용자 거부 후 N턴 동안 마무리 제안 금지
    const WRAP_UP_AFTER = 20;       // 에이전트 발언 N회 후 마무리 제안 (아젠다 전체 완료 후 적용)
    const WRAP_UP_AUTO_MS = 30_000; // 30초 무응답 → 자동 종료
    // ── 아젠다 추적 (순서 없음 — 키워드 감지 기반) ──
    const coveredAgenda = new Set<AgendaId>(); // 자연스럽게 다뤄진 주제들
    let nudgeCooldown = 0; // 프로듀서가 주제 꺼낸 후 N턴 대기
    setCoveredAgendaIds([]);
    // 사용자 동의 패턴 (마무리 제안에 yes 한 것으로 간주)
    const AGREE_RE = /^(그래|응|ㅇㅇ|좋아|해줘|시작|정리|맞아|그렇게|ㄱ|ok|오케|ㅇㅋ)/i;

    // ── 에이전트 한 번 발언 헬퍼 ──
    // 1) 스트리밍은 백그라운드에서 조용히 받고 (ThinkingDots 표시)
    // 2) 완성 후 사람 타이핑 속도로 재생 (~8자/55ms ≈ 빠른 타이핑)
    const runSingleAgent = async (agentId: AgentId, prompt: string, tokens: number) => {
      const key = getAnthropicKeyByIndex(getApiKeyIndexForAgent(agentIndex));
      if (!key) return;
      const msgId = addMsg(agentId, round, "", true); // ThinkingDots
      let text = "";
      const msgs: Array<{ role: "user" | "assistant"; content: string }> = [
        { role: "user", content: prompt },
      ];
      const isSentenceEnd = (t: string) =>
        /[.!?~。！？～…♪ㅎㅋ다요야지해네죠나까]\s*$/.test(t.trim());
      for (let cont = 0; cont <= 2; cont++) {
        let stopReason = "end_turn";
        try {
          for await (const chunk of streamClaude({
            apiKey: key,
            systemPrompt: buildAgentPromptP1(agentId, g, c, platLabel, ep, rejectedWorksRef.current),
            messages: msgs,
            maxTokens: tokens,
            tools: [],
            onStopReason: (r) => { stopReason = r; },
            onRateLimit: (msg) => { updateMsg(msgId, msg, true); },
          })) {
            text += chunk; // UI 업데이트 없이 백그라운드 수집
          }
        } catch { /* stream error → use what we have */ }
        if (cont === 2) break;
        const truncated = stopReason === "max_tokens" || (text.trim().length > 0 && !isSentenceEnd(text));
        if (!truncated) break;
        msgs.push({ role: "assistant", content: text });
        msgs.push({ role: "user", content: "앞 내용 반복 없이, 끊긴 문장 나머지만 완성해줘." });
        await sleep(600);
      }
      const clean = text.trim().replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/[#>_`]/g, "");
      if (!clean) { setMsgs(prev => prev.filter(m => m.id !== msgId)); return; }
      // 타자 효과: 사람 타이핑 속도로 재생
      const CHARS = 2;
      const TICK = 120; // ~17자/초 — 자연스러운 타이핑 속도 (60자 → 약 3.6초)
      for (let i = CHARS; i < clean.length; i += CHARS) {
        updateMsg(msgId, clean.slice(0, i), true);
        await sleep(TICK);
      }
      updateMsg(msgId, clean, false);
      transcript.push(`[${AGENTS[agentId].label}]: ${clean}`);
      round++;
      agentIndex++;
    };

    // ── 슬라이딩 메모리 시스템 ──
    // 구조: 롤링 누적 요약(20턴마다 cascading) + 주제별 맥락 요약 4개
    // 에이전트는 자신의 전문 분야 주제 요약 + 전체 누적 요약 + 최근 6줄을 받는다

    let rollingSummary = "";          // 전체 토론 누적 요약 (7~8줄, cascading)
    let topicMarket = "";             // 시장·플랫폼·독자층
    let topicSimilar = "";            // 유사작품·레퍼런스·비교분석
    let topicStrengths = "";          // 기획 강약점·차별점·개선방향
    let topicWorldbuilding = "";      // 세계관·캐릭터·설정 보완점
    let turnsInWindow = 0;            // 현재 20턴 윈도우 카운터
    let windowBuffer: string[] = [];  // 현재 윈도우 발언 버퍼

    // ── 메모리 복원: Firestore 우선, localStorage 폴백 ──
    const MEMORY_KEY  = `p1_memory_${projectId}`;
    const FRESH_KEY   = `p1_fresh_start_${projectId}`;
    const TURNS_COL   = `p1_turns_${projectId}`;   // Firestore 컬렉션명
    const MEMORY_DOC  = () => db ? doc(db, "p1_memory", projectId) : null;

    // 새로 분석 플래그 확인 — 있으면 메모리 전체 건너뜀 (개요만으로 시작)
    const isFreshStart = localStorage.getItem(FRESH_KEY) === "1";
    if (isFreshStart) {
      localStorage.removeItem(FRESH_KEY);
      localStorage.removeItem(MEMORY_KEY);
      // Firestore 삭제도 재시도 (비동기 경쟁 조건 해소)
      if (db) {
        void import("firebase/firestore").then(({ doc: fsDoc, deleteDoc }) => {
          void deleteDoc(fsDoc(db!, "p1_memory", projectId)).catch(() => {});
        });
      }
      // rollingSummary / topicXxx 전부 빈 채로 유지 — 개요만으로 토론 시작
    }

    // Firestore에서 메모리 로드 (계속 토론 시만)
    if (!isFreshStart && db) {
      try {
        const snap = await getDoc(doc(db, "p1_memory", projectId));
        if (snap.exists()) {
          const m = snap.data() as {
            rolling?: string; market?: string; similar?: string;
            strengths?: string; worldbuilding?: string;
            turnsInWindow?: number; windowBuffer?: string[];
          };
          if (m.rolling)       rollingSummary     = m.rolling;
          if (m.market)        topicMarket        = m.market;
          if (m.similar)       topicSimilar       = m.similar;
          if (m.strengths)     topicStrengths     = m.strengths;
          if (m.worldbuilding) topicWorldbuilding = m.worldbuilding;
          if (m.turnsInWindow) turnsInWindow      = m.turnsInWindow;
          if (m.windowBuffer)  windowBuffer       = m.windowBuffer;
        }
      } catch { /* Firestore unavailable → fallback */ }
    }
    // Firestore에 없으면 localStorage 폴백 (계속 토론 시만)
    if (!isFreshStart && !rollingSummary) {
      try {
        const saved = localStorage.getItem(MEMORY_KEY);
        if (saved) {
          const m = JSON.parse(saved) as {
            rolling?: string; market?: string; similar?: string;
            strengths?: string; worldbuilding?: string;
            turnsInWindow?: number; windowBuffer?: string[];
          };
          if (m.rolling)       rollingSummary     = m.rolling;
          if (m.market)        topicMarket        = m.market;
          if (m.similar)       topicSimilar       = m.similar;
          if (m.strengths)     topicStrengths     = m.strengths;
          if (m.worldbuilding) topicWorldbuilding = m.worldbuilding;
          if (m.turnsInWindow) turnsInWindow      = m.turnsInWindow;
          if (m.windowBuffer)  windowBuffer       = m.windowBuffer;
        }
      } catch { /* quota or parse error */ }
    }

    // 메모리 저장: Firestore 기본, localStorage 동시 백업
    const saveMemory = () => {
      const payload = {
        rolling: rollingSummary,
        market: topicMarket, similar: topicSimilar,
        strengths: topicStrengths, worldbuilding: topicWorldbuilding,
        turnsInWindow, windowBuffer,
        savedAt: new Date().toISOString(),
      };
      // Firestore (비동기, 백그라운드)
      const mdoc = MEMORY_DOC();
      if (mdoc) void setDoc(mdoc, { ...payload, savedAt: serverTimestamp() }).catch(() => {});
      // localStorage (동기, 폴백)
      try { localStorage.setItem(MEMORY_KEY, JSON.stringify(payload)); } catch { /* quota */ }
    };

    // ── 발언 1개를 Firestore에 저장 (RAG 검색 대상) ──
    // topic 태그로 분류 → 나중에 벡터 임베딩 추가 시 vector 필드만 추가하면 됨
    const saveTurn = (text: string, speaker: AgentId, turnNum: number) => {
      if (!db) return;
      const topic = AGENT_TOPIC[speaker] ?? "market";
      void addDoc(collection(db, TURNS_COL), {
        text, speaker, topic, turn: turnNum,
        isUser: speaker === "user",
        createdAt: serverTimestamp(),
        // vector: null  ← 나중에 임베딩 API 연동 시 여기에 추가
      }).catch(() => {});
    };

    // ── 에이전트 전문 주제의 관련 과거 발언을 Firestore에서 검색 ──
    // V1: topic 기준 최신 5개 (turn 내림차순)
    // V2 (예정): findNearest(vector, queryVector, {limit:5}) 로 교체
    const fetchRelevantTurns = async (agentId: AgentId): Promise<string[]> => {
      if (!db) return [];
      try {
        const topic = AGENT_TOPIC[agentId] ?? "market";
        const q = query(
          collection(db, TURNS_COL),
          where("topic", "==", topic),
          orderBy("turn", "desc"),
          limit(5),
        );
        const snap = await getDocs(q);
        // 오래된 것부터 정렬해서 반환 (시간 순서로 읽히도록)
        return snap.docs.map((d: import("firebase/firestore").QueryDocumentSnapshot) => d.data().text as string).reverse();
      } catch { return []; }
    };

    // 에이전트 → 전문 주제 매핑
    const AGENT_TOPIC: Record<AgentId, "market" | "similar" | "strengths" | "worldbuilding"> = {
      strategist:   "market",
      researcher:   "similar",
      worldbuilder: "worldbuilding",
      character:    "worldbuilding",
      scenario:     "strengths",
      script:       "strengths",
      producer:     "market",
      editor:       "market",
      user:         "market",
    };
    const TOPIC_LABEL: Record<string, string> = {
      market:       "시장·플랫폼 맥락",
      similar:      "유사작품 맥락",
      strengths:    "기획 강약점 맥락",
      worldbuilding:"세계관·캐릭터 맥락",
    };

    // 20턴마다 롤링 요약 + 주제별 요약을 백그라운드에서 동시에 갱신
    const updateSummaries = (buffer: string[]) => {
      const key = getAnthropicKeyByIndex(getApiKeyIndexForAgent(agentIndex));
      if (!key || buffer.length === 0) return;
      const bufText = buffer.join("\n");

      // ① 롤링 누적 요약 (cascading)
      void (async () => {
        setStatusMsg("이전 대화 요약 중...");
        let next = "";
        try {
          for await (const chunk of streamClaude({
            apiKey: key,
            systemPrompt: "웹툰 기획 토론 요약 전문가. 핵심 결정·쟁점·미해결 항목을 명확히 기록.",
            messages: [{
              role: "user",
              content: `${rollingSummary ? `[이전 누적 요약]\n${rollingSummary}\n\n` : ""}[최근 ${buffer.length}턴 토론]\n${bufText}\n\n위 내용을 합쳐 누적 요약을 업데이트해줘.\n포함 항목: 합의된 결정, 핵심 쟁점과 각 에이전트 입장, 미해결 항목.\n7~8줄 이내. 작품명·수치 등 구체적 내용 반드시 포함. 마크다운 금지.${rejectedWorksRef.current.length > 0 ? `\n\n주의: 다음 작품들은 존재하지 않거나 유사하지 않다고 판명됨 — 요약에 절대 포함하지 마: ${rejectedWorksRef.current.join(", ")}` : ""}`,
            }],
            maxTokens: 300,
            tools: [],
          })) next += chunk;
        } catch { /* ignore */ }
        if (next.trim()) { rollingSummary = next.trim(); saveMemory(); }
        setStatusMsg("");
      })();

      // ② 주제별 맥락 요약 (4개를 1번 API 호출로)
      void (async () => {
        let raw = "";
        try {
          for await (const chunk of streamClaude({
            apiKey: key,
            systemPrompt: "웹툰 기획 토론 분석 전문가. 주제별 맥락을 정확히 추출.",
            messages: [{
              role: "user",
              content: `[최근 토론]\n${bufText}\n\n아래 4개 주제별로 이 토론에서 관련된 내용을 추출해줘. 해당 내용 없으면 "언급 없음".\n\n[MARKET]\n시장·플랫폼·독자층·수익·트렌드 관련 논의 (4~5줄)\n[/MARKET]\n[SIMILAR]\n유사작품·레퍼런스·비교분석 관련 논의 (4~5줄)\n[/SIMILAR]\n[STRENGTHS]\n기획의 강점·약점·차별점·개선방향 관련 논의 (4~5줄)\n[/STRENGTHS]\n[WORLDBUILDING]\n세계관·캐릭터·설정·보완점 관련 논의 (4~5줄)\n[/WORLDBUILDING]\n\n마크다운 금지.`,
            }],
            maxTokens: 500,
            tools: [],
          })) raw += chunk;
        } catch { /* ignore */ }
        if (!raw.trim()) return;
        const extract = (tag: string) => {
          const m = raw.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`));
          return m ? m[1].trim() : "";
        };
        const m = extract("MARKET");
        const s = extract("SIMILAR");
        const st = extract("STRENGTHS");
        const wb = extract("WORLDBUILDING");
        if (m && m !== "언급 없음") topicMarket = m;
        if (s && s !== "언급 없음") topicSimilar = s;
        if (st && st !== "언급 없음") topicStrengths = st;
        if (wb && wb !== "언급 없음") topicWorldbuilding = wb;
        saveMemory();
      })();
    };

    // 에이전트별 컨텍스트 빌더 — 전체 요약 + 전문 주제 요약 + Firestore 관련 발언 + 최근 6줄
    const buildAgentContext = async (agentId: AgentId): Promise<string> => {
      const topicKey = AGENT_TOPIC[agentId] ?? "market";
      const topicContent = {
        market: topicMarket, similar: topicSimilar,
        strengths: topicStrengths, worldbuilding: topicWorldbuilding,
      }[topicKey];
      const label = TOPIC_LABEL[topicKey];

      // Firestore에서 해당 주제의 관련 과거 발언 검색 (RAG)
      const relevantTurns = await fetchRelevantTurns(agentId);

      // rolling summary에서 차단 작품 문장 실시간 제거
      const sanitize = (text: string) => {
        if (!rejectedWorksRef.current.length) return text;
        return text
          .split(/(?<=[.!?。])\s+/)
          .filter(sentence => !rejectedWorksRef.current.some(w => sentence.includes(w)))
          .join(" ");
      };

      const parts: string[] = [];
      if (rollingSummary)           parts.push(`[전체 토론 요약]\n${sanitize(rollingSummary)}`);
      if (topicContent)             parts.push(`[${label}]\n${sanitize(topicContent)}`);
      if (relevantTurns.length > 0) parts.push(`[${label} 관련 과거 발언]\n${sanitize(relevantTurns.join("\n"))}`);
      parts.push(`[최근 대화]\n${transcript.slice(-6).join("\n")}`);
      return parts.join("\n\n") + "\n\n";
    };

    // ── 메인 대화 루프 ──
    debateLoop: while (true) {

      // 0) 마무리 제안 후 30초 무응답 → 프로듀서가 자동으로 정리
      if (wrapUpProposed && !pendingUserMsgRef.current && Date.now() - wrapUpProposedAt > WRAP_UP_AUTO_MS) {
        addMsg("producer", round, "그럼 제가 정리할게요.", false);
        transcript.push(`[총괄프로듀서]: 그럼 제가 정리할게요.`);
        await sleep(1500);
        break debateLoop;
      }

      // 1) 에이전트 발언 후 대기 — 사용자 타이핑 중이면 계속 기다림
      if (transcript.length > 0) {
        const minWait = 5000 + Math.random() * 5000; // 5~10s
        const maxWait = 60000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
          if (pendingUserMsgRef.current) break;
          if (Date.now() - start >= minWait && !userTypingRef.current) break;
          await sleep(150);
        }
      }

      // 2) 사용자 메시지 처리
      const pendingMsg = pendingUserMsgRef.current;
      let matchedCommand = null as ReturnType<typeof matchCommand>;
      if (pendingMsg) {
        pendingUserMsgRef.current = null;
        const shownId = pendingUserMsgIdRef.current;
        pendingUserMsgIdRef.current = null;
        if (shownId) {
          setMsgs(prev => prev.map((m: Msg) => m.id === shownId ? { ...m, round } : m));
        } else {
          addMsg("user", round, pendingMsg, false);
        }
        transcript.push(`[사용자]: ${pendingMsg}`);
        saveTurn(`[사용자]: ${pendingMsg}`, "user", round); // 사용자 발언도 Firestore 저장
        round++;
        lastUserMsg = pendingMsg;

        // 사용자가 특정 작품을 부정한 경우 블랙리스트에 추가
        // "X가 왜 나와", "X는 관계없어", "X 언급하지마" 등 감지
        const REJECT_RE = /왜\s*나와|관계\s*없|상관\s*없|언급\s*하지|얘기\s*하지\s*마|다르잖|틀렸|아니잖|아니야|관련\s*없/;
        if (REJECT_RE.test(pendingMsg)) {
          // 최근 3턴 에이전트 발언에서 꺾쇠·따옴표로 감싸진 작품명 또는 <작품명> 추출
          const recentAgentLines = transcript.slice(-6).filter(l => !l.startsWith("[사용자]"));
          const workPattern = /[<「『""]([^>」』""]{1,30})[>」』""]/g;
          const foundWorks = new Set<string>();
          for (const line of recentAgentLines) {
            let m;
            while ((m = workPattern.exec(line)) !== null) foundWorks.add(m[1].trim());
          }
          if (foundWorks.size > 0) {
            const newRejected = [...rejectedWorksRef.current, ...foundWorks].filter((v, i, a) => a.indexOf(v) === i);
            rejectedWorksRef.current = newRejected;
            setRejectedWorks(newRejected);
          }
        }
        userTurnCount = 4; // 4턴 동안 사용자 의견을 context에 유지
        // 마무리 제안 중이면: 동의 → 종료, 그 외 → 계속 대화
        if (wrapUpProposed) {
          if (AGREE_RE.test(pendingMsg.trim())) break debateLoop;
          wrapUpProposed = false;    // 사용자가 더 할 말 있음 → 계속
          wrapUpCooldown = 12;       // 12턴 동안 마무리 재제안 금지
        }
        matchedCommand = matchCommand(pendingMsg);
        if (matchedCommand?.handler === "end") break debateLoop;
      }

      setTurnCount(round);

      const lastLine = transcript[transcript.length - 1] ?? "";
      // 명령·마무리 등 공통 컨텍스트 (에이전트 미정 상황용)
      const baseContext = rollingSummary
        ? `[전체 토론 요약]\n${rollingSummary}\n${userTurnCount > 0 ? `\n[사용자 최근 의견]: ${lastUserMsg}\n` : ""}[최근 대화]\n${transcript.slice(-6).join("\n")}\n\n`
        : `[대화 내용]\n${transcript.slice(-6).join("\n")}\n\n`;

      // 3) 명령 핸들러
      if (matchedCommand?.handler === "single_turn" && matchedCommand.speakerAgent) {
        const p = matchedCommand.promptOverride?.replace("{history}", baseContext) ?? `${baseContext}사용자 요청에 응답해.`;
        await runSingleAgent(matchedCommand.speakerAgent, p, matchedCommand.maxTokens ?? 300);
        continue;
      }
      if (matchedCommand?.handler === "summarize_then_end" && matchedCommand.speakerAgent) {
        const p = matchedCommand.promptOverride?.replace("{history}", baseContext) ?? `${baseContext}지금까지 내용 최종 정리해줘.`;
        await runSingleAgent(matchedCommand.speakerAgent, p, matchedCommand.maxTokens ?? 500);
        break debateLoop;
      }
      if (matchedCommand?.handler === "all_greet") {
        const p = matchedCommand.promptOverride ?? "사용자가 인사를 건넸어. 짧게 안부 인사 1문장.";
        for (const gId of AGENT_SPEAKING_ORDER_P1) {
          await runSingleAgent(gId, p, matchedCommand.maxTokens ?? 60);
          await sleep(600 + Math.random() * 400);
        }
        continue;
      }
      if (matchedCommand?.handler === "break") {
        const p = matchedCommand.promptOverride?.replace("{history}", baseContext) ?? "브레이크 타임을 선언해줘.";
        await runSingleAgent(matchedCommand.speakerAgent ?? "producer", p, matchedCommand.maxTokens ?? 80);
        await sleep(matchedCommand.breakDurationMs ?? 30000);
        continue;
      }

      // 4) 마무리 제안 시점 확인 (20턴 or 대화 수렴 감지)
      const agentTurnsSoFar = transcript.filter(l => !l.startsWith("[사용자]") && l.trim()).length;
      if (wrapUpCooldown > 0) wrapUpCooldown--;
      // 최근 4줄이 비슷한 결론 방향이면 수렴으로 간주 (같은 키워드 반복)
      const convergenceCheck = transcript.slice(-4).join(" ");
      const converging = agentTurnsSoFar >= 15 &&
        (convergenceCheck.match(/정리|결론|충분|이 정도|마무리|보고서/g) ?? []).length >= 2;

      const allAgendaDone = coveredAgenda.size >= AGENDA_P1.length;
      if (!wrapUpProposed && wrapUpCooldown === 0 && allAgendaDone && (agentTurnsSoFar >= WRAP_UP_AFTER || converging)) {
        wrapUpProposed = true;
        wrapUpProposedAt = Date.now();
        const wrapPrompt = `${baseContext}팀이 충분히 논의했어. 프로듀서로서 자연스럽게 마무리를 제안해줘. "이 정도면 충분히 얘기한 것 같은데, 보고서 작성할까요?" 느낌으로 1~2문장.`;
        await runSingleAgent("producer", wrapPrompt, 80);
        lastSpeaker = "producer";
        recentSpeakers = (["producer" as AgentId, ...recentSpeakers] as AgentId[]).slice(0, 3);
        continue; // 이번 턴은 프로듀서 제안으로 끝
      }

      // 5) 다음 발언자: 최근 3줄 주제 + 최근 발언자 중복 회피로 선택
      const speakerPickLines = transcript.slice(-3);
      const nextAgent = pickNextSpeaker(speakerPickLines, recentSpeakers, lastSpeaker);

      // 5) 에이전트별 맞춤 컨텍스트 (전체 요약 + 전문 주제 요약 + Firestore 관련 발언 + 최근 6줄)
      const agentCtx = await buildAgentContext(nextAgent);

      // 6) 프롬프트 구성 — 직전 발언자·내용을 명시해서 실제 반응 유도
      const isFirst = transcript.length <= 1;
      // 사용자가 마무리를 거부한 경우 에이전트에게 명시적으로 전달
      const continueNote = wrapUpCooldown > 0
        ? `⚠️ 사용자가 마무리를 거부하고 더 깊은 분석을 요청했음. 절대 마무리·보고서 작성·다음 단계 이동을 제안하지 말고 현재 주제를 더 깊이 파고들어.\n\n`
        : "";
      let agentPrompt: string;
      if (isFirst) {
        agentPrompt = `리서치 시작해줘. 기획 내용을 잘 읽고, 소재·설정·갈등구조가 실제로 비슷한 웹툰 한 편만 소개해줘. 장르만 같은 작품은 안 돼. 배울 점도 짧게.`;
      } else if (userTurnCount > 0) {
        agentPrompt = `${continueNote}${agentCtx}사용자가 "${lastUserMsg.slice(0, 80)}"라고 했어. 이 의견에 대해 네 전문 분야에서 구체적으로 반응해줘. 2~3문장.`;
      } else {
        // 직전 발언자와 내용을 추출해 맥락 있는 반응 유도
        const prevMatch = lastLine.match(/^\[([^\]]+)\]:\s*([\s\S]+)/);
        const prevLabel = prevMatch ? prevMatch[1] : null;
        const prevContent = prevMatch ? prevMatch[2].slice(0, 100) : null;
        if (prevLabel && prevContent) {
          agentPrompt = `${continueNote}${agentCtx}방금 ${prevLabel}이(가) "${prevContent.trim()}"라고 했어. 이 내용에 동의·반론·보완 중 하나를 골라 네 전문 분야에서 2~3문장으로 응답해줘.`;
        } else {
          agentPrompt = `${continueNote}${agentCtx}앞 대화에서 네 전문 분야와 관련된 부분을 짚어서 의견을 더해줘. 2~3문장.`;
        }
      }

      // 7) 에이전트 발언
      await runSingleAgent(nextAgent, agentPrompt, 120);
      lastSpeaker = nextAgent;
      recentSpeakers = ([nextAgent, ...recentSpeakers] as AgentId[]).slice(0, 3);
      // 발언 완료 후 Firestore 저장 + 윈도우 버퍼 추가
      const lastAdded = transcript[transcript.length - 1];
      if (lastAdded) {
        saveTurn(lastAdded, nextAgent, round);  // Firestore RAG 저장
        windowBuffer.push(lastAdded);

        // ── 에이전트 자기수정 감지 → 자동 블랙리스트 ──
        // "실제 작품이 아니야", "잘못 참고했어" 등 → 해당 발언의 작품명 자동 차단
        const SELF_CORRECT_RE = /실제\s*(작품|웹툰|드라마|영화|만화)이?\s*(아니|없)|잘못\s*(참고|알고|언급)|존재하지\s*않|없는\s*(작품|제목|웹툰)|만들어\s*낸|허구|가상의\s*작품|제가\s*잘못/;
        if (SELF_CORRECT_RE.test(lastAdded)) {
          const wpRe = /[<「『《""]([^>」』》""\n]{1,30})[>」』》""]/g;
          const autoBlocked = new Set<string>();
          let wm: RegExpExecArray | null;
          while ((wm = wpRe.exec(lastAdded)) !== null) autoBlocked.add(wm[1].trim());
          if (autoBlocked.size > 0) {
            const next = [...rejectedWorksRef.current, ...autoBlocked].filter((v, i, a) => a.indexOf(v) === i);
            rejectedWorksRef.current = next;
            setRejectedWorks(next);
          }
        }
      }

      // 사용자 응답 모드 카운트다운
      if (userTurnCount > 0) {
        userTurnCount--;
        if (userTurnCount === 0) lastUserMsg = "";
      }

      // ── 아젠다 키워드 감지 (최근 대화에서 자연스럽게 다룬 주제 체크) ──
      const recentText = transcript.slice(-4).join(" ");
      for (const item of AGENDA_P1) {
        if (!coveredAgenda.has(item.id) && item.keywords.test(recentText)) {
          coveredAgenda.add(item.id);
          setCoveredAgendaIds([...coveredAgenda]); // UI 체크리스트 업데이트
        }
      }
      // 아직 안 다룬 주제가 있고 5턴마다 프로듀서가 슬쩍 꺼냄
      if (nudgeCooldown > 0) {
        nudgeCooldown--;
      } else if (agentTurnsSoFar > 0 && agentTurnsSoFar % 5 === 0) {
        const uncovered = AGENDA_P1.filter(item => !coveredAgenda.has(item.id));
        if (uncovered.length > 0) {
          // 아직 안 다룬 것 중 하나를 랜덤으로 꺼냄
          const pick = uncovered[Math.floor(Math.random() * uncovered.length)];
          await runSingleAgent("producer", pick.nudge + " 짧게 한마디만.", 60);
          lastSpeaker = "producer";
          recentSpeakers = (["producer" as AgentId, ...recentSpeakers] as AgentId[]).slice(0, 3);
          nudgeCooldown = 4; // 4턴 대기 후 다시 체크
          continue;
        }
      }

      // 8) 20턴마다 롤링 요약 + 주제별 요약 갱신 (백그라운드, 비차단)
      turnsInWindow++;
      saveMemory(); // 윈도우 버퍼·카운터 매 턴 저장 (중단 복원용)
      if (turnsInWindow >= 20) {
        turnsInWindow = 0;
        const bufferSnapshot = [...windowBuffer];
        windowBuffer = [];
        updateSummaries(bufferSnapshot);
      }

      // 8) 저장
      try {
        localStorage.setItem(`p1_conv_${projectId}`, JSON.stringify({
          transcript, genre: g, concept: c, platform: plat, episodeCount: ep,
        }));
      } catch { /* quota */ }
    }

    // ── Final report (별도 API 호출) ──
    await sleep(500);
    setTurnCount(round + 1);

    // 프로듀서 공지 — 채팅에만 표시. 보고서 내용 자체는 채팅에 안 보임.
    addMsg("producer", round + 1, "다들 수고했어요. 제가 정리하겠습니다.", false);
    await sleep(1500);

    setIsWritingReport(true);
    setStatusMsg("기획 분석 보고서 작성 중...");

    const allDebateText = transcript.join("\n");

    // 보고서는 sonnet 사용 — 복잡한 JSON 포맷을 haiku보다 훨씬 안정적으로 생성
    const reportApiKey = apiKey; // getAnthropicKey() — 이미 위에서 검증됨
    const reportStream = async (model: string) => {
      let text = "";
      try {
        for await (const chunk of streamClaude({
          apiKey: reportApiKey,
          model,
          systemPrompt: "너는 총괄프로듀서다. 팀의 실제 토론 내용을 바탕으로 지시에 따라 최종 보고서를 작성하라. 반드시 토론에서 언급된 실제 작품명과 인사이트를 반영하라.",
          messages: [{ role: "user", content: buildFinalReportPrompt(allDebateText) }],
          maxTokens: 4000,
          tools: [],
        })) text += chunk;
      } catch { /* ignore */ }
      return text;
    };

    // 1차: sonnet으로 시도
    let reportText = await reportStream("claude-sonnet-4-6");
    let parsed = parsePhase1Result(reportText);

    // 2차: 파싱 실패 시 재시도
    if (!parsed) {
      console.warn("[Phase1] 보고서 파싱 실패 — 재시도 중. 원본:", reportText.slice(0, 300));
      reportText = await reportStream("claude-sonnet-4-6");
      parsed = parsePhase1Result(reportText);
    }

    setIsWritingReport(false);
    setStatusMsg("");

    if (!parsed) {
      console.error("[Phase1] 보고서 생성 실패. 원본 응답:", reportText.slice(0, 500));
    }
    setResult(parsed ?? MOCK_RESULT);
    saveResult(parsed ?? MOCK_RESULT, g, c, ep, plat);

    setDebatePhase("done");
    runningRef.current = false;

  }, [addMsg, updateMsg, saveResult, projectId]);

  // ── Form submit ──
  const handleStart = useCallback(() => {
    if (!concept.trim()) return;
    localStorage.removeItem(`p1_conv_${projectId}`);
    savedTranscriptRef.current = [];
    setMsgs([]);
    setResult(null);
    setIsMock(false);
    setStage("debate");
    runDebate(genre, concept.trim(), platform, episodeCount);
  }, [concept, genre, platform, episodeCount, projectId, runDebate]);

  const handleRestartNew = useCallback(() => {
    // 대화 데이터 초기화
    localStorage.removeItem(`p1_result_${projectId}`);
    localStorage.removeItem(`p1_msgs_${projectId}`);
    localStorage.removeItem(`p1_conv_${projectId}`);
    localStorage.removeItem(`wts_phase1_${projectId}`);
    // 메모리(롤링 요약·토픽 요약) 완전 초기화 — 이전 작품 기억이 오염되지 않도록
    localStorage.removeItem(`p1_memory_${projectId}`);
    // fresh start 플래그 — runDebate가 Firestore/localStorage 메모리 로딩을 건너뜀
    localStorage.setItem(`p1_fresh_start_${projectId}`, "1");
    // 블랙리스트는 유지 — 프로젝트 수준 지식 (프로젝트 삭제 시에만 제거)
    // "구해줘 홈즈는 이 기획과 관련없다"는 새 분석을 해도 여전히 사실
    if (db) {
      void import("firebase/firestore").then(({ doc: fsDoc, deleteDoc }) => {
        void deleteDoc(fsDoc(db!, "p1_memory", projectId)).catch(() => {});
      });
    }
    savedTranscriptRef.current = [];
    setSavedAt(null);
    setMsgs([]);
    setResult(null);
    // rejectedWorks는 유지 (프로젝트 수준 지식 — 프로젝트 삭제 시에만 제거)
    setStage("form");
    setDebatePhase("idle");
  }, [projectId]);

  // ── Continue interrupted debate ──
  const handleContinue = useCallback(async () => {
    setMsgs((prev: Msg[]) => prev.filter((m: Msg) => !m.streaming));
    // "저장 중" 안내 메시지 잠깐 표시
    const tmpId = Math.random().toString(36).slice(2);
    setMsgs((prev: Msg[]) => [...prev, { id: tmpId, agent: "producer" as AgentId, round: 0, text: "💾 기존 대화 저장 중...", streaming: true }]);
    await new Promise<void>(r => setTimeout(r, 1200));
    setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== tmpId));
    runDebate(genre, concept, platform, episodeCount, savedTranscriptRef.current);
  }, [genre, concept, platform, episodeCount, runDebate]);


  // ── Render form ──
  if (stage === "form") {
    return (
      <div className={styles.page}>
        <div className={styles.formWrap}>
          <div className={styles.formCard}>
            <h1 className={styles.formTitle}>Phase 1 · 기획 분석</h1>
            <p className={styles.formDesc}>
              7인 AI 에이전트가 유사 웹툰을 리서치하고 분석합니다.<br />
              비슷한 설정의 작품들을 찾아 좋은 점·나쁜 점·문제점을 공유하고, Phase 2 세계관 설계의 기초 자료를 만듭니다.
            </p>

            {/* Row: 장르 + 플랫폼 */}
            <div className={styles.formRow}>
              <div className={styles.formCol}>
                <label className={styles.formLabel}>장르</label>
                <select
                  className={styles.formSelect}
                  value={genre}
                  onChange={(e: { target: HTMLSelectElement }) => setGenre(e.target.value)}
                >
                  {GENRES.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formCol}>
                <label className={styles.formLabel}>목표 화수</label>
                <select
                  className={styles.formSelect}
                  value={episodeCount}
                  onChange={(e: { target: HTMLSelectElement }) => setEpisodeCount(e.target.value as EpisodeCount)}
                >
                  {EPISODE_COUNTS.map((ep) => (
                    <option key={ep} value={ep}>{ep}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 플랫폼 선택 — 카드형 */}
            <label className={styles.formLabel} style={{ marginTop: 18 }}>목표 플랫폼</label>
            <div className={styles.platformGrid}>
              {PLATFORMS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`${styles.platformCard} ${platform === p.value ? styles.platformCardActive : ""}`}
                  onClick={() => setPlatform(p.value)}
                >
                  <span className={styles.platformCardLabel}>{p.label}</span>
                  <span className={styles.platformCardDesc}>{p.desc}</span>
                </button>
              ))}
            </div>

            <div className={styles.formLabelRow}>
              <label className={styles.formLabel} style={{ marginTop: 18, marginBottom: 0 }}>기획 개요</label>
              <span className={styles.charCount} style={{ color: concept.length >= 100 ? "#34d399" : concept.length >= 50 ? "#fbbf24" : "#475569" }}>
                {concept.length}자 {concept.length >= 100 ? "✓ 충분" : concept.length >= 50 ? "· 조금 더" : "· 더 작성하세요"}
              </span>
            </div>
            <textarea
              className={styles.formTextarea}
              value={concept}
              onChange={(e: { target: HTMLTextAreaElement }) => setConcept(e.target.value)}
              placeholder={"예: 평범한 고등학생이 어느 날 눈을 떠보니 10년 후 멸망한 세계에 있다.\n자신이 죽인 것으로 알려진 '마왕'이 사실은 세계를 구하려 했다는 진실을 밝히기 위해\n과거로 거슬러 올라가는 타임루프 판타지.\n\nTip: 주인공·세계관·핵심 갈등·차별점을 포함할수록 분석 품질이 높아집니다."}
              rows={7}
            />

            <button
              className={styles.btnStart}
              onClick={handleStart}
              disabled={!concept.trim()}
            >
              에이전트 토론 시작 →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render debate ──
  return (
    <div className={styles.page}>
      <div className={styles.chatLayout}>
        {/* Header */}
        <div className={styles.chatHeader}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              background: "#1e1e2a", border: "1px solid #2a2a3d",
              borderRadius: 6, padding: "2px 10px", fontSize: 12, color: "#94a3b8"
            }}>
              {genre}
            </span>
            {isMock && <span className={styles.mockBadge}>Mock 데이터</span>}
            {savedAt && (
              <span style={{ fontSize: 11, color: "#475569" }}>
                저장됨 {new Date(savedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </span>
          <button
            className={styles.btnRestart}
            onClick={() => { handleRestartNew(); runningRef.current = false; }}
          >
            다시 분석
          </button>
        </div>

        {/* 아젠다 체크리스트 + 블랙리스트 태그 */}
        {(debatePhase === "running" || debatePhase === "done") && (
          <div style={{
            display: "flex", gap: 4, padding: "6px 12px", flexWrap: "wrap", alignItems: "center",
            background: "rgba(15,20,40,0.6)", borderBottom: "1px solid rgba(99,102,241,0.15)",
          }}>
            {AGENDA_P1.map((item) => {
              const covered = debatePhase === "done" || coveredAgendaIds.includes(item.id);
              return (
                <div key={item.id} style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "2px 8px", borderRadius: 99, fontSize: 11,
                  background: covered ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.04)",
                  border: "1px solid transparent",
                  color: covered ? "#a5b4fc" : "rgba(255,255,255,0.3)",
                  transition: "all 0.5s",
                }}>
                  <span>{covered ? "✓" : "○"}</span>
                  <span>{item.label}</span>
                </div>
              );
            })}
            {rejectedWorks.length > 0 && (
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: "rgba(248,113,113,0.6)" }}>차단:</span>
                {rejectedWorks.map((w) => (
                  <span key={w} style={{
                    fontSize: 10, padding: "1px 7px", borderRadius: 99,
                    background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)",
                    color: "#f87171",
                  }}>🚫 {w}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* V2 Turn counter bar */}
        <div className={styles.progressBar}>
          <div className={styles.turnCounterWrap}>
            <span className={styles.turnLabel}>
              {debatePhase === "done" ? "✅ 토론 완료" : debatePhase === "paused" ? "⏸ 토론 일시중지" : `Turn ${turnCount}`}
            </span>
            <div className={styles.turnDots}>
              {Array.from({ length: Math.max(turnCount, 1) }).map((_, i) => (
                <div key={i} className={`${styles.turnDot} ${i < turnCount - 1 ? styles.turnDotDone : i === turnCount - 1 ? styles.turnDotActive : ""}`} />
              ))}
            </div>
          </div>
          {statusMsg ? (
            <span style={{ fontSize: 11, color: "#a5b4fc", display: "flex", alignItems: "center", gap: 6 }}>
              <ThinkingDots />{statusMsg}
            </span>
          ) : debatePhase === "running" && (
            <span className={styles.turnRunning}><ThinkingDots /></span>
          )}
        </div>

        {/* Chat body */}
        <div className={styles.chatBody} ref={chatBodyRef}>
          {msgs.map((msg: Msg) => (
            <MsgBubble
              key={msg.id}
              msg={msg}
              onReply={debatePhase === "running" ? (m) => {
                const agent = AGENTS[m.agent];
                setReplyTo({
                  msg: m,
                  agentLabel: agent?.label ?? m.agent,
                  preview: (agent?.label === "총괄프로듀서" ? stripResultBlock(m.text) : m.text).slice(0, 60).trim(),
                });
                setTimeout(() => chatInputRef.current?.focus(), 50);
              } : undefined}
            />
          ))}

          {/* Paused — offer resume */}
          {debatePhase === "paused" && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              gap: 10, padding: "24px 16px", marginTop: 8,
            }}>
              <p style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", margin: 0 }}>
                이전 토론이 저장되어 있습니다. 이어서 진행할 수 있어요.
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <button className={styles.btnGating} onClick={handleContinue}>
                  토론 계속하기 →
                </button>
                <button className={styles.btnRestart} onClick={() => { handleRestartNew(); runningRef.current = false; }}>
                  새로 시작
                </button>
              </div>
            </div>
          )}

          {/* 보고서 작성 중 */}
          {isWritingReport && (
            <div className={styles.reportWriting}>
              <span className={styles.spin} />
              <span>보고서 작성 중...</span>
            </div>
          )}

          {/* Results */}
          {result && debatePhase === "done" && (
            <div className={styles.resultWrap}>
              <div className={styles.resultDivider}>
                <div className={styles.resultDividerLine} />
                <span className={styles.resultDividerText}>Phase 1 분석 완료</span>
                <div className={styles.resultDividerLine} />
              </div>

              <GenreMarketSection result={result} />
              <SWOTSection result={result} />
              <SimilarWorksDeepSection similar_works={result.similar_works} />
              <AdoptionStrategySection strategies={result.adoption_strategy} />
              <WorldbuildingNotesSection notes={result.worldbuilding_notes} />
              <SimilarWorksSection competitors={result.competitors} />
              <PositioningSection positioning={result.positioning} radar={result.radar} mounted={mounted} />
              <USPSection usp={result.usp} />
              <FeasibilitySection result={result} mounted={mounted} />
              <FinalReportSection report={result.final_report} />

              {/* Gating */}
              <div className={styles.gatingRow}>
                <button
                  className={styles.btnDashboard}
                  onClick={() => router.push(`/projects/${projectId}/phase-1/dashboard`)}
                  style={{ background: "linear-gradient(135deg,#7c6cfc,#a78bfa)", color: "#fff", fontWeight: 800, fontSize: 15, padding: "12px 28px" }}
                >
                  📊 보고서 전체 보기 →
                </button>
                {result.verdict !== "reject" ? (
                  <button
                    className={styles.btnGating}
                    onClick={() => setShowGatingModal(true)}
                  >
                    Phase 2 세계관 설계 시작 →
                  </button>
                ) : (
                  <p style={{ color: "#f87171", fontSize: 14 }}>
                    실현가능성 점수가 낮아 Phase 2 진행이 권장되지 않습니다. 기획을 수정 후 재분석하세요.
                  </p>
                )}
                <button
                  className={styles.btnRestart}
                  onClick={() => { handleRestartNew(); runningRef.current = false; }}
                >
                  재분석
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── User chat input (during debate) ── */}
      {debatePhase === "running" && (
        <div className={styles.chatInputRow} style={{ flexDirection: "column", gap: 0, padding: 0 }}>
          {/* 댓글 대상 표시 바 */}
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
              >
                ✕
              </button>
            </div>
          )}
          <div style={{ display: "flex", width: "100%" }}>
            <textarea
              ref={chatInputRef}
              className={styles.chatInputBox}
              value={chatInput}
              rows={2}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                setChatInput(e.target.value);
                userTypingRef.current = e.target.value.length > 0;
              }}
              onCompositionStart={() => { isComposingRef.current = true; }}
              onCompositionEnd={() => { isComposingRef.current = false; }}
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === "Escape") { setReplyTo(null); return; }
                if (e.key === "Enter" && !e.shiftKey && !isComposingRef.current && chatInput.trim()) {
                  e.preventDefault();
                  const text = chatInput.trim();
                  const id = `user_${Date.now()}_${Math.random()}`;
                  const quote = replyTo
                    ? `[${replyTo.agentLabel}의 발언 "${replyTo.preview}${replyTo.preview.length >= 60 ? "..." : ""}"에 대해]: `
                    : "";
                  const fullText = quote + text;
                  pendingUserMsgRef.current = fullText;
                  pendingUserMsgIdRef.current = id;
                  userTypingRef.current = false;
                  setMsgs((prev: Msg[]) => [...prev, {
                    id, agent: "user" as AgentId, round: 0, text,
                    replyQuote: replyTo ? { agentLabel: replyTo.agentLabel, preview: replyTo.preview } : undefined,
                    streaming: false,
                  }]);
                  setChatInput("");
                  setReplyTo(null);
                }
              }}
              placeholder={replyTo ? `${replyTo.agentLabel}에게 댓글... (Enter 전송 · Esc 취소)` : "아무 때나 끼어들어도 돼! (Enter 전송 · Shift+Enter 줄바꿈)\n끝내려면 '끝내자' 입력"}
              style={{ resize: "none", flex: 1 }}
            />
            <button
              className={styles.chatSendBtn}
              onClick={() => {
                if (chatInput.trim()) {
                  const text = chatInput.trim();
                  const id = `user_${Date.now()}_${Math.random()}`;
                  const quote = replyTo
                    ? `[${replyTo.agentLabel}의 발언 "${replyTo.preview}${replyTo.preview.length >= 60 ? "..." : ""}"에 대해]: `
                    : "";
                  const fullText = quote + text;
                  pendingUserMsgRef.current = fullText;
                  pendingUserMsgIdRef.current = id;
                  userTypingRef.current = false;
                  setMsgs((prev: Msg[]) => [...prev, {
                    id, agent: "user" as AgentId, round: 0, text,
                    replyQuote: replyTo ? { agentLabel: replyTo.agentLabel, preview: replyTo.preview } : undefined,
                    streaming: false,
                  }]);
                  setChatInput("");
                  setReplyTo(null);
                }
              }}
            >
              전송
            </button>
          </div>
        </div>
      )}

      {/* ── Phase 2 Gating Modal ── */}
      {showGatingModal && result && (
        <div className={styles.modalOverlay} onClick={() => setShowGatingModal(false)}>
          <div className={styles.modalBox} onClick={(e: { stopPropagation: () => void }) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalIcon}>🚀</span>
              <h2 className={styles.modalTitle}>Phase 2 진행 확인</h2>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.modalScoreRow}>
                <div className={styles.modalScoreItem}>
                  <span className={styles.modalScoreLabel}>실현가능성</span>
                  <span className={styles.modalScoreVal} style={{ color: result.verdict === "go" ? "#34d399" : "#fbbf24" }}>
                    {Math.round(result.feasibility_score * 100)}점
                  </span>
                </div>
                <div className={styles.modalScoreItem}>
                  <span className={styles.modalScoreLabel}>판정</span>
                  <span className={styles.modalScoreVal} style={{ color: result.verdict === "go" ? "#34d399" : "#fbbf24", fontSize: 15 }}>
                    {result.verdict === "go" ? "✅ GO" : "⚠️ 조건부 GO"}
                  </span>
                </div>
              </div>
              <p className={styles.modalDesc}>{result.summary}</p>
              <div className={styles.modalNote}>
                Phase 2에서는 <strong>세계관설계자</strong>와 <strong>캐릭터디자이너</strong>가 합류하여
                능력 체계·사회 시스템·에셋 디자인을 설계합니다.
                {result.verdict === "conditional" && (
                  <span style={{ color: "#fbbf24", display: "block", marginTop: 8 }}>
                    ⚠️ 조건부 판정 — 총괄프로듀서 지적 사항 해소 후 진행을 권장합니다.
                  </span>
                )}
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.modalBtnCancel} onClick={() => setShowGatingModal(false)}>
                취소
              </button>
              <button
                className={styles.modalBtnConfirm}
                onClick={() => router.push(`/projects/${projectId}/phase-2`)}
              >
                Phase 2 시작 →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
