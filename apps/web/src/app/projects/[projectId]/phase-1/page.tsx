"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ReferenceLine,
  RadialBarChart, RadialBar,
  ResponsiveContainer, Legend, Tooltip,
} from "recharts";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { streamClaude, getAnthropicKey, WEB_SEARCH_TOOL } from "@/lib/claude-client";
import styles from "./page.module.css";

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = {
  strategist: { label: "전략 기획자",   emoji: "📊", color: "#a78bfa", bg: "rgba(167,139,250,0.10)" },
  researcher: { label: "심층 조사자",   emoji: "🔍", color: "#34d399", bg: "rgba(52,211,153,0.10)"  },
  scenario:   { label: "시나리오 작가", emoji: "📝", color: "#fbbf24", bg: "rgba(251,191,36,0.10)"  },
  script:     { label: "연출 작가",     emoji: "🎬", color: "#f87171", bg: "rgba(248,113,113,0.10)" },
  producer:   { label: "총괄 프로듀서", emoji: "🎯", color: "#e2e8f0", bg: "rgba(241,245,249,0.07)" },
  user:       { label: "나",            emoji: "💬", color: "#7c6cfc", bg: "rgba(124,108,252,0.10)" },
} as const;
type AgentId = keyof typeof AGENTS;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Msg { id: string; agent: AgentId; round: number; text: string; streaming: boolean; }
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
  usp: USP[];
  competitors: Competitor[];
  positioning: { ours: PositioningPoint; competitors: PositioningPoint[]; };
  radar: { ours: number[]; avg: number[]; categories: string[]; };
  final_report: string;
}
type Stage = "form" | "debate";
type DebatePhase = "idle" | "running" | "user_wait" | "vote" | "done";
type UserInterventionType = "IDEA" | "QUESTION" | "OBJECTION";

interface OrchestratorDecision {
  next_agent: AgentId;
  instruction: string;
  consensus_reached: boolean;
  deadlock: boolean;
  vote_needed: boolean;
  vote_options: string[] | null;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_RESULT: Phase1Result = {
  feasibility_score: 0.84,
  feasibility_breakdown: { market: 88, originality: 82, producibility: 78, commercial: 87 },
  verdict: "go",
  summary: "헌터물 포화 시장에서 '관계 서사+도덕적 딜레마' 차별화로 네이버 10~20대 공략 가능. Phase 2 적극 권장.",
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

// ─── V2 Agent Personas ────────────────────────────────────────────────────────

const AGENT_PERSONAS: Record<string, {
  role: string; personality: string; objectionTrigger: string; agreeTrigger: string; voiceStyle: string;
}> = {
  strategist: {
    role: "K-웹툰 시장 전문 전략기획자",
    personality: "데이터 중심, 클리셰 혐오, 상업성 최우선. 냉정하고 논리적.",
    objectionTrigger: "USP가 불분명하거나 기존 히트작과 차별점이 없을 때, 시장성 근거가 약할 때",
    agreeTrigger: "명확한 USP와 시장성이 데이터로 증명됐을 때",
    voiceStyle: '"이미 유사작품 3개 있습니다. 차별점이 뭔가요?" 스타일의 냉정한 시장 분석가 말투.',
  },
  researcher: {
    role: "스토리 논리성·현실성 검증 전문 심층조사자",
    personality: "논리 허점 탐지 전문가. '왜?'를 3번 이상 묻는다. 반박 시 반드시 대안 제시.",
    objectionTrigger: "설정 내부 모순, 클리셰 Lv3 남용, 현실 팩트와 충돌할 때",
    agreeTrigger: "논리적 일관성이 완벽하고 내부 모순이 0개일 때",
    voiceStyle: '"그 설정, 논리적 모순이 있습니다. 대신 이렇게 하면 어떨까요?" 스타일의 집요한 팩트체커 말투.',
  },
  worldbuilder: {
    role: "K-웹툰 세계관 설계 전문가",
    personality: "규칙과 일관성 집착. 세계관 바이블 수호자. 능력 체계 수치화 고집.",
    objectionTrigger: "세계관 규칙 위반, 능력 체계 모순, 설정 충돌이 발생했을 때",
    agreeTrigger: "세계관 내부 논리가 완벽히 맞을 때",
    voiceStyle: '"이 세계에서 그 능력이 가능하려면 물리 법칙을 먼저 정의해야 합니다." 스타일.',
  },
  character: {
    role: "K-웹툰 캐릭터 디자이너",
    personality: "캐릭터 감정선 집착. '이 캐릭터 왜 이런 행동을 하는가?' 질문. 트라우마 설계 전문.",
    objectionTrigger: "캐릭터 동기가 불분명하거나 개성이 없을 때, 행동 개연성이 부족할 때",
    agreeTrigger: "입체적 감정선과 명확한 트라우마가 설정됐을 때",
    voiceStyle: '"독자가 이 캐릭터를 사랑하게 만들려면 트라우마가 필요합니다." 스타일.',
  },
  scenario: {
    role: "K-웹툰 시나리오 전문 작가",
    personality: "4막 구조 신봉자. 훅과 반전 집착. 100화 로드맵 관리자.",
    objectionTrigger: "서사 리듬이 깨질 때, 클라이막스 타이밍이 틀릴 때, 독자 이탈 위험이 있을 때",
    agreeTrigger: "완벽한 아크 구조와 훅 배치가 완성됐을 때",
    voiceStyle: '"이 전개는 25화 즈음에 배치해야 독자 이탈을 막을 수 있습니다." 스타일.',
  },
  script: {
    role: "K-웹툰 연출 전문 작가",
    personality: "30컷 단위 집착. 카메라 앵글로 감정 표현. 세로 스크롤 UX 전문가.",
    objectionTrigger: "연출이 텍스트 중심이거나 시각 임팩트가 부족할 때",
    agreeTrigger: "컷 구성이 세로 스크롤에 최적화됐을 때",
    voiceStyle: '"이 장면은 ECU(극단 클로즈업)로 가야 독자가 감정이입 합니다." 스타일.',
  },
};

// ─── V2 Dynamic Debate Prompts ────────────────────────────────────────────────

/** 에이전트 한 턴 발언 프롬프트 — 이전 전체 토론 맥락 + 중재자 지시 포함 */
const buildAgentTurnPrompt = (
  agentId: string,
  instruction: string,
  debateHistory: string,
  genre: string,
  concept: string,
  platform: string,
  ep: string,
) => {
  const p = AGENT_PERSONAS[agentId] ?? AGENT_PERSONAS.strategist;
  return `당신은 ${p.role}입니다.

━━ 당신의 페르소나 ━━
성격: ${p.personality}
반박 조건: ${p.objectionTrigger}
동의 조건: ${p.agreeTrigger}
말투: ${p.voiceStyle}

━━ 기획 정보 ━━
장르: ${genre} | 플랫폼: ${platform} | 목표화수: ${ep}
기획: ${concept.slice(0, 300)}

━━ 지금까지의 토론 ━━
${debateHistory}

━━ 총괄프로듀서의 지시 ━━
${instruction}

━━ 발언 규칙 (반드시 준수) ━━
1. 이전 발언을 직접 인용하며 시작: "○○님 말씀처럼..." 또는 "앞서 ○○님이 말씀하신..."
2. 반박 시 반드시 구체적 대안 포함. "이건 안 됩니다"만 하는 것 금지.
3. 동의 시에도 추가 가치를 더하세요: "○○님 의견에 동의합니다. 추가로..."
4. 250~450자 이내로 간결하게. 핵심만.
5. 당신 전문 분야 외의 발언 금지 (연출작가가 시장 분석 하는 것 등).`;
};

/** 총괄프로듀서 오케스트레이터 — 다음 발언자 결정 + 합의 판단 */
const buildOrchestratorPrompt = (debateHistory: string, userInput?: string) => `당신은 AI Webtoon Studio 토론 오케스트레이터입니다.
지금까지의 토론을 분석하여 다음 행동을 결정합니다.

━━ 지금까지의 토론 ━━
${debateHistory}
${userInput ? `\n━━ 사용자 개입 ━━\n유형: ${userInput}\n→ 이 개입을 고려하여 판단하세요.\n` : ""}
━━ 판단 기준 ━━
• 합의 조건: 전략기획자 + 심층조사자가 모두 동의했거나, 총 5턴 이상 진행됐고 주요 이슈가 해소됨
• 교착 상태: 동일 주제로 3턴 이상 반박이 반복되고 진전이 없음 → 투표 트리거
• 다음 발언자 선택: 현재 미해결 이슈를 가장 잘 다룰 수 있는 에이전트

━━ 출력 형식 (JSON만, 다른 텍스트 절대 없음) ━━
{
  "next_agent": "strategist|researcher|worldbuilder|character|scenario|script|producer",
  "instruction": "다음 에이전트에게 전달할 구체적 지시 (100자 이내)",
  "consensus_reached": false,
  "deadlock": false,
  "vote_needed": false,
  "vote_options": null
}

next_agent가 "producer"이면 최종 합의 결론 도출을 의미합니다.`;

/** 총괄프로듀서 최종 결론 — JSON 결과 포함 */
const buildProducerFinalPrompt = (allContext: string) => `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다.
토론을 마무리하고 투자자·PD에게 바로 전달 가능한 최종 보고서를 작성합니다.

━━ 전체 토론 내역 ━━
${allContext}

━━ 중재 원칙 ━━
• 에이전트 의견 충돌 시 이름을 직접 거론하여 명확히 중재하세요.
  형식: "전략기획자는 [X]를 주장했으나, 심층조사자의 [Y] 우려가 더 타당합니다."
• 사용자 의견이 반영됐다면 반드시 명시하세요.
• feasibility_score: 0.70+ = go / 0.50~0.69 = conditional / 미만 = reject

━━ 보고서 순서 ━━
1. "토론을 마무리합니다."로 시작
2. 종합 판단 (2~3문장, 결론 선행)
3. 에이전트별 핵심 의견 요약 (각 1문장)
4. 핵심 리스크 1~2개
5. Phase 2 진행 권고

말투: 권위 있고 결론 지향. 분량 (JSON 제외): 300~450자.

보고서 직후 다음 JSON 출력 (다른 텍스트 없음):

[PHASE1_RESULT]
{
  "feasibility_score": 0.00,
  "feasibility_breakdown": {"market": 0, "originality": 0, "producibility": 0, "commercial": 0},
  "verdict": "go",
  "summary": "80자 이내 핵심 요약",
  "usp": [{"icon": "⚡", "title": "USP제목", "desc": "설명\\n2줄", "prediction": "독자반응 예측"}],
  "competitors": [{"title": "작품명", "platform": "네이버웹툰", "period": "YYYY~YYYY", "readers": "주간XXX만뷰", "strengths": "강점", "weaknesses": "약점", "differentiation": "차별점", "genre_color": "#60a5fa"}],
  "positioning": {"ours": {"x": 0, "y": 0, "label": "우리 작품"}, "competitors": [{"x": 0, "y": 0, "label": "작품명"}]},
  "radar": {"ours": [0,0,0,0,0], "avg": [0,0,0,0,0], "categories": ["신선도","감정몰입","세계관","캐릭터","상업성"]},
  "final_report": "━━ PHASE 1 최종 기획 분석 보고서 ━━\\n\\n▶ 시장 분석 요약\\n[400자+ 플랫폼 포지셔닝·경쟁 환경·타깃 독자층 포함]\\n\\n▶ 독창성 평가\\n[핵심 차별점, 클리셰 리스크]\\n\\n▶ 제작 가능성\\n[100화 확장성, IP 잠재력]\\n\\n■ 최종 권고: GO\\n[한 줄 선언 + 전제 조건]"
}
[/PHASE1_RESULT]`;

/** 사용자 개입 분류 프롬프트 */
const buildClassifyPrompt = (userMsg: string, debateContext: string) => `당신은 사용자 메시지를 분류합니다.

토론 맥락: ${debateContext.slice(0, 400)}
사용자 메시지: "${userMsg}"

출력 (JSON만):
{"type": "IDEA|QUESTION|OBJECTION|VOTE|OFF_TOPIC", "summary": "한 줄 요약"}`;




// (old fixed-round prompts removed — V2 uses buildAgentTurnPrompt / buildOrchestratorPrompt)

const P_RESEARCHER_R1 = (genre: string, concept: string) => `당신은 스토리 논리성·현실성 검증 전문 심층조사자(agent_researcher)입니다.
K-웹툰 장르 클리셰 데이터베이스와 선행작 아카이브를 기반으로 기획안을 정밀 검증합니다.

━━ 검증 대상 ━━
장르: ${genre}
기획 개요: ${concept}

━━ 검증 프레임워크 ━━
• [설정 내부 모순] 능력·규칙이 후반 서사와 충돌하는지 사전 탐지
• [선행작 충돌] 핵심 소재·구조가 기존 히트작과 유사하면 차별화 필수 경보
• [현실 팩트체크] 한국 사회·법제도·과학·역사 설정의 오류 검증
• [클리셰 레벨] Lv1(장르 문법, 허용) / Lv2(과다 사용, 주의) / Lv3(독자 이탈 유발, 수정 필수)

━━ 분석 지시 ━━
1. 웹 검색으로 동일 소재를 다룬 K-웹툰 선행작을 조사하고 직접 인용하세요.
   인용 형식: "이 [설정/소재]는 《작품명》(플랫폼, 연도)의 [해당 요소]와 구조적으로 유사합니다. 차별화 방향: [구체적 제안]."
2. 기획안 설정의 내부 논리 모순을 1~3개 구체적으로 지적하세요.
   지적 형식: "[X 요소]가 [Y 조건]이라면, [Z 화]의 [특정 장면/상황]이 논리적으로 불가능해집니다. 수정 방향: [대안]."
3. 클리셰 레벨을 명시하세요.
   클리셰 형식: "Lv[N] 클리셰 — [요소명]: [설명]. 차별화 제안: [구체적 방법]."
4. 한국 사회 현실(직장문화·교육제도·법률·사회통념) 반영 여부를 검토하세요. 오류 발견 시 수정 방향 제시.
5. 반드시 긍정 요소(독창성 있는 부분)를 1개 이상 포함하세요. 순수 비판만 하는 것은 금지.
6. 각 문제점마다 즉시 실행 가능한 대안 1개 이상 반드시 제시하세요.

말투: 분석적·건설적. 팩트 우선, 직설적이되 협력적. 전문 편집자 톤.
분량: 500~700자.`;

const buildP_SCENARIO_R2 = (r1Context: string, userInput: string) => `당신은 K-웹툰 시나리오 전문 작가(agent_scenario)입니다.
네이버웹툰 평균 연재 기간 3.5년, 카카오페이지 평균 완결 화수 120화를 기준점으로 서사 구조를 설계합니다.

━━ Round 1 토론 맥락 ━━
${r1Context}
${userInput ? `\n━━ 사용자 추가 의견 ━━\n"${userInput}"\n→ 이 의견을 서사 구조에 반드시 반영하고, 반영 방식을 명시하세요.\n` : ""}
━━ 플랫폼별 서사 공식 ━━
• 네이버: 1화 임팩트 최우선. 5화 내 세계관 확립. 10화 내 핵심 갈등 제시. 독자 이탈률 1→3화 35%, 3→10화 20%.
• 카카오: 3화 무료 공개 후 유료 전환. 3화 훅이 첫 결제 유인. 아크 완결 시점(20~25화)이 재결제 타이밍.
• 레진: 소아크 7~10화 완결 구조 선호. 회차 길이 제한 없음.

━━ 서사 설계 공식 ━━
• 3막: 1막(도입·각성, 전체 20%) / 2막(성장·갈등·위기, 60%) / 3막(클라이막스·결말, 20%)
• 필수 훅 배치: 1화(세계관 훅), 3화(주인공 변화), 5화(첫 위기), 15화(중간 반전), 30화(1막 완결+대반전), 50화(시즌 분기점), 70화(최대 위기), 95~100화(클라이막스)
• 감정 피크: 소아크(5화) 마지막화 + 중아크(25화) 마지막화

━━ 분석 지시 ━━
1. Round 1 에이전트 의견(전략기획자·심층조사자)을 직접 인용하며 서사 전략과 연결하세요.
2. 3막 구조를 화수와 함께 제시하세요. (예: 1~18화 / 19~72화 / 73~100화)
3. 독자 이탈 방지를 위한 훅 포인트를 5개 이상, 화수·내용·의도를 함께 명시하세요.
4. 독자층(전략기획자 분석 기반) 맞춤 감정 코드를 서사에 어떻게 심을지 제안하세요.
5. 시즌 분할(시즌1 완결 화수) 및 스핀오프 확장 가능성을 평가하세요.
6. 웹 검색으로 동일 장르 장기 연재 성공 패턴을 1건 이상 조사하여 적용하세요.

말투: 구조적·창의적. 현장 시나리오 작가 + 전략가의 시선.
분량: 450~600자.`;

const buildP_SCRIPT_R2 = (r1Context: string, userInput: string) => `당신은 K-웹툰 연출 전문 작가(agent_script)입니다.
세로 스크롤 모바일 UX와 독자 시선 흐름을 전문으로 하며, 웹툰 플랫폼 데이터 기반 연출 전략을 수립합니다.

━━ Round 1 토론 맥락 ━━
${r1Context}
${userInput ? `\n━━ 사용자 추가 의견 ━━\n"${userInput}"\n→ 이 의견을 연출 전략에 반드시 반영하세요.\n` : ""}
━━ 웹툰 연출 데이터 ━━
• 화당 컷수 기준: 도입화 20~25컷 / 액션화 28~35컷 / 감정화 18~22컷 / 일상화 15~20컷
• 스크롤 정지 포인트: 화당 1/3 지점에 임팩트 컷 1개 배치 → 이탈률 40% 감소 (플랫폼 내부 데이터)
• 세로 분할 패널: 긴장감·속도감 연출. 가로 분할: 시간 경과·장소 전환. 풀페이지: 화당 1~2개(과용 금지).
• 말풍선 규칙: 컷당 최대 3개. 초과 시 가독성 급락.
• 1화 황금률: 첫 3컷에서 세계관 또는 감정 훅 확립 필수.

━━ 장르별 시각 문법 ━━
• 액션·판타지: 분할 패널로 속도감 → 임팩트 풀컷 → SFX 텍스트 과감 사용. 30컷+ 권장.
• 로맨스: 표정 CU(클로즈업) 빈도 높음. 풀페이지 1컷은 감정 클라이막스(고백·키스) 전용. 22컷 내외.
• 스릴러·공포: 여백과 침묵 컷 활용으로 독자 상상 유발. 화면 분할 불규칙성으로 불안감 조성. 25컷 내외.
• 현대판타지: ELS(원경)로 세계관 → MS(중경)로 캐릭터 감정 → CU(근경)로 클라이막스 흐름.

━━ 분석 지시 ━━
1. Round 1 에이전트 의견과 시나리오 작가 의견을 연결하여, 연출이 서사 전략을 어떻게 뒷받침할지 제시하세요.
2. 해당 장르에 맞는 화 유형별 컷 배분 공식을 수치와 함께 제시하세요. (도입화·클라이막스화·일상화 각각)
3. 세로 스크롤 스크롤 정지 포인트 전략을 화 유형별로 구체적으로 제안하세요.
4. 1화 연출 시나리오를 제안하세요: 첫 컷 구성·훅 배치·페이지 엔딩 전략.
5. 모바일(세로 720px 기준) 가독성 최적화 팁 2~3가지를 제시하세요.
6. 이 기획안의 장르·세계관에 특화된 시각적 시그니처(반복 연출 패턴)를 1개 제안하세요.

말투: 시각적·실용적. 현장 연출 PD + 아트디렉터의 시선.
분량: 450~600자.`;

const buildP_PRODUCER_R3 = (allContext: string) => `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다.
4인 에이전트의 토론을 종합하여 투자자·PD에게 바로 전달 가능한 수준의 최종 판단을 내립니다.

━━ 전체 토론 내역 ━━
${allContext}

━━ 중재 원칙 ━━
• 에이전트 의견 충돌 시: 이름을 직접 거론하여 입장을 명확히 중재하세요.
  형식: "전략기획자는 [X]를 주장했으나, 심층조사자의 [Y] 우려가 더 타당합니다. 따라서 [결론]."
• 사용자 추가 의견이 있다면: 반영 여부와 이유를 반드시 명시하세요.
• feasibility_score 판정 기준: 0.70 이상 = go / 0.50~0.69 = conditional / 0.50 미만 = reject

━━ 보고서 구조 (이 순서로 작성) ━━
1. "토론을 마무리합니다."로 시작
2. 종합 판단 (2~3문장, 결론 선행)
3. 에이전트별 핵심 의견 요약 및 중재 (각 1~2문장)
4. 핵심 리스크 1~2개 (실명 지적)
5. Phase 2 진행 권고 및 전제 조건 (있는 경우)

말투: 권위 있고 결론 지향. 현장 PD 보고서 수준.
분량 (JSON 제외): 350~500자.

━━ JSON 출력 (보고서 직후, 다른 텍스트 없이) ━━

[PHASE1_RESULT]
{
  "feasibility_score": 0.00,
  "feasibility_breakdown": {
    "market": 0,
    "originality": 0,
    "producibility": 0,
    "commercial": 0
  },
  "verdict": "go",
  "summary": "80자 이내 핵심 요약 — 이 기획안의 가장 강한 무기와 시장 포지션",
  "usp": [
    {
      "icon": "⚡",
      "title": "USP 제목 (10자 이내)",
      "desc": "독자가 얻는 경험을 2줄로\\n구체적 감정 언어로 작성",
      "prediction": "예: 1~3화 이탈률 25% 이하 예상 / 특정 커뮤니티 화제성 높음"
    }
  ],
  "competitors": [
    {
      "title": "실제 작품명만 (약칭 금지)",
      "platform": "네이버웹툰|카카오페이지|레진코믹스",
      "period": "YYYY~YYYY or YYYY~연재중",
      "readers": "주간 최고 XXX만 뷰 or 누적 X억 뷰",
      "strengths": "핵심 강점 (50자 이내)",
      "weaknesses": "핵심 약점 (50자 이내)",
      "differentiation": "우리 작품의 차별화 포인트 (50자 이내)",
      "genre_color": "#60a5fa"
    }
  ],
  "positioning": {
    "ours": {"x": 0, "y": 0, "label": "우리 작품"},
    "competitors": [{"x": 0, "y": 0, "label": "작품명"}]
  },
  "radar": {
    "ours": [0, 0, 0, 0, 0],
    "avg":  [0, 0, 0, 0, 0],
    "categories": ["신선도", "감정몰입", "세계관", "캐릭터", "상업성"]
  },
  "final_report": "━━ PHASE 1 최종 기획 분석 보고서 ━━\\n\\n▶ 시장 분석 요약\\n[400자 이상. 플랫폼 포지셔닝, 경쟁 환경, 타깃 독자층 포함]\\n\\n▶ 독창성 평가\\n[기획안 핵심 차별점, 클리셰 리스크 포함]\\n\\n▶ 제작 가능성\\n[100화 연재 확장성, 캐릭터 IP 잠재력, 영상화 가능성]\\n\\n■ 최종 권고: [GO|CONDITIONAL|REJECT]\\n[한 줄 선언 + 전제 조건]"
}
[/PHASE1_RESULT]`;

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

function parseOrchestratorDecision(text: string): OrchestratorDecision | null {
  const match = text.match(/\{[\s\S]*?"next_agent"[\s\S]*?\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as OrchestratorDecision;
  } catch {
    return null;
  }
}

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

function MsgBubble({ msg }: { msg: Msg; key?: string }) {
  const agent = AGENTS[msg.agent];
  const isUser = msg.agent === "user";
  const displayText = msg.agent === "producer" ? stripResultBlock(msg.text) : msg.text;

  return (
    <div className={`${styles.msgRow} ${isUser ? styles.msgRowUser : ""}`}>
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
          {isUser
            ? displayText.split("\n").map((line, i) => (
                <span key={i}>{line}{i < displayText.split("\n").length - 1 && <br />}</span>
              ))
            : displayText.split("\n").map((line, i) => renderMsgLine(line, i, agent.color))
          }
          {msg.streaming && <span className={styles.streamCursor} />}
          {msg.streaming && !displayText && <ThinkingDots />}
        </div>
      </div>
      {isUser && (
        <div className={styles.avatar} style={{ background: agent.bg, borderColor: agent.color }}>
          {agent.emoji}
        </div>
      )}
    </div>
  );
}

// ─── V2 Intervention ──────────────────────────────────────────────────────────

interface InterventionV2Props {
  turnCount: number;
  onSubmit: (text: string, type: UserInterventionType) => void;
  onSkip: () => void;
}

function InterventionV2({ turnCount, onSubmit, onSkip }: InterventionV2Props) {
  const [text, setText] = useState("");
  const [type, setType] = useState<UserInterventionType>("IDEA");
  const [timeLeft, setTimeLeft] = useState(10);

  useEffect(() => {
    if (timeLeft <= 0) { onSkip(); return; }
    const timer = setTimeout(() => setTimeLeft((p: number) => p - 1), 1000);
    return () => clearTimeout(timer);
  }, [timeLeft, onSkip]);

  const TYPE_CONFIG: Record<UserInterventionType, { label: string; color: string; bg: string; placeholder: string }> = {
    IDEA:      { label: "💡 아이디어", color: "#34d399", bg: "rgba(52,211,153,0.1)", placeholder: "새로운 설정 아이디어나 제안을 입력하세요..." },
    QUESTION:  { label: "❓ 질문",    color: "#60a5fa", bg: "rgba(96,165,250,0.1)",  placeholder: "특정 에이전트에게 궁금한 점을 질문하세요..." },
    OBJECTION: { label: "⚡ 반박",    color: "#f87171", bg: "rgba(248,113,113,0.1)", placeholder: "특정 의견에 반박하거나 수정을 요청하세요..." },
  };

  const cfg = TYPE_CONFIG[type as UserInterventionType];

  return (
    <div className={styles.interventionV2}>
      <div className={styles.ivHeader}>
        <span className={styles.ivTurn}>Turn {turnCount} 완료</span>
        <span className={styles.ivTitle}>의견을 추가하시겠어요?</span>
        <span className={styles.ivTimer} style={{ color: timeLeft <= 4 ? "#f87171" : "#475569" }}>
          {timeLeft}s
        </span>
      </div>
      <div className={styles.ivTypeBtns}>
        {(Object.keys(TYPE_CONFIG) as UserInterventionType[]).map((t) => (
          <button
            key={t}
            className={`${styles.ivTypeBtn} ${type === t ? styles.ivTypeBtnActive : ""}`}
            style={type === t ? { borderColor: TYPE_CONFIG[t].color, background: TYPE_CONFIG[t].bg, color: TYPE_CONFIG[t].color } : {}}
            onClick={() => setType(t)}
          >
            {TYPE_CONFIG[t].label}
          </button>
        ))}
      </div>
      <div className={styles.ivInputRow}>
        <textarea
          className={styles.ivInput}
          value={text}
          onChange={(e: { target: HTMLTextAreaElement }) => setText(e.target.value)}
          placeholder={cfg.placeholder}
          rows={2}
          style={{ borderColor: text ? cfg.color : undefined }}
        />
      </div>
      <div className={styles.ivBtns}>
        <button className={styles.ivBtnSkip} onClick={onSkip}>건너뛰기</button>
        <button
          className={styles.ivBtnSubmit}
          disabled={!text.trim()}
          onClick={() => onSubmit(text.trim(), type)}
          style={text.trim() ? { background: cfg.bg, borderColor: cfg.color, color: cfg.color } : {}}
        >
          {cfg.label} 제출
        </button>
      </div>
    </div>
  );
}

// ─── Vote Modal ───────────────────────────────────────────────────────────────

interface VoteModalProps {
  options: string[];
  onVote: (choice: string) => void;
}

function VoteModal({ options, onVote }: VoteModalProps) {
  return (
    <div className={styles.modalOverlay}>
      <div className={styles.voteModal}>
        <div className={styles.voteHeader}>
          <span style={{ fontSize: 22 }}>🗳️</span>
          <div>
            <div className={styles.voteTitle}>에이전트 의견이 갈렸습니다</div>
            <div className={styles.voteSub}>방향을 선택해주세요 — 선택이 토론에 즉시 반영됩니다</div>
          </div>
        </div>
        <div className={styles.voteOptions}>
          {options.map((opt, i) => (
            <button key={i} className={styles.voteOption} onClick={() => onVote(opt)}>
              <span className={styles.voteNum}>{i + 1}</span>
              <span className={styles.voteText}>{opt}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Result sections ──────────────────────────────────────────────────────────

function SimilarWorksSection({ competitors }: { competitors: Competitor[] }) {
  return (
    <section className={styles.resultSec}>
      <div className={styles.secHeaderRow}>
        <span className={styles.secNum}>01</span>
        <div className={styles.secHeader}>
          <h3 className={styles.secTitle}>경쟁작 분석</h3>
          <p className={styles.secSub}>실제 플랫폼 데이터 기반 유사작 벤치마크</p>
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
          <span className={styles.secNum}>02</span>
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
          <span className={styles.secNum}>03</span>
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

const EPISODE_COUNTS = ["50화", "100화", "150화", "200화", "미정"] as const;
type EpisodeCount = typeof EPISODE_COUNTS[number];

export default function Phase1Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();

  // ── State ──
  const [stage, setStage] = useState<Stage>("form");
  const [debatePhase, setDebatePhase] = useState<DebatePhase>("idle");
  const [genre, setGenre] = useState(GENRES[0]);
  const [platform, setPlatform] = useState<PlatformValue>("undecided");
  const [episodeCount, setEpisodeCount] = useState<EpisodeCount>("100화");
  const [concept, setConcept] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [result, setResult] = useState<Phase1Result | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [showGatingModal, setShowGatingModal] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [savedGenre, setSavedGenre] = useState<string | null>(null);
  const [savedConcept, setSavedConcept] = useState<string | null>(null);
  const [showPrevBanner, setShowPrevBanner] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [voteOptions, setVoteOptions] = useState<string[] | null>(null);

  // ── Refs ──
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const interventionResolveRef = useRef<((v: string, type?: UserInterventionType) => void) | null>(null);
  const voteResolveRef = useRef<((choice: string) => void) | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    if (!projectId) return;

    // 1) Try localStorage first (instant)
    const raw = localStorage.getItem(`p1_result_${projectId}`);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as { result: Phase1Result; genre: string; concept: string; savedAt: string; };
        setSavedAt(saved.savedAt);
        setSavedGenre(saved.genre);
        setSavedConcept(saved.concept);
        setShowPrevBanner(true);
        return; // localStorage hit — skip Firestore
      } catch { /* ignore */ }
    }

    // 2) Fallback: load from Firestore (if localStorage is empty / cleared)
    if (!db) return;
    getDoc(doc(db, "project_summary", projectId, "phase_1", "result"))
      .then((snap: import("firebase/firestore").DocumentSnapshot) => {
        if (!snap.exists()) return;
        const data = snap.data() as Phase1Result & { genre?: string; concept?: string; savedAt?: { toDate?: () => Date } };
        const savedDate = data.savedAt?.toDate?.()?.toISOString() ?? new Date().toISOString();
        // Re-populate localStorage so next load is instant
        const payload = { result: data as Phase1Result, genre: data.genre ?? "", concept: data.concept ?? "", savedAt: savedDate };
        localStorage.setItem(`p1_result_${projectId}`, JSON.stringify(payload));
        setSavedAt(savedDate);
        setSavedGenre(data.genre ?? null);
        setSavedConcept(data.concept ?? null);
        setShowPrevBanner(true);
      })
      .catch(() => {}); // Firestore unavailable — silently skip
  }, [projectId]);

  // Auto-scroll
  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [msgs]);

  // ── Message helpers ──
  const addMsg = useCallback((agent: AgentId, round: number, text = "", streaming = false): string => {
    const id = `${agent}_${Date.now()}_${Math.random()}`;
    setMsgs((prev: Msg[]) => [...prev, { id, agent, round, text, streaming }]);
    return id;
  }, []);

  const updateMsg = useCallback((id: string, text: string, streaming: boolean) => {
    setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === id ? { ...m, text, streaming } : m));
  }, []);

  // ── Helpers: sleep + context trim ──
  // Context is trimmed before injection into prompts to prevent
  // token accumulation across rounds (main cause of 429 rate limits).
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const trimCtx = (text: string, max = 700): string =>
    text.length <= max ? text : text.slice(0, max) + "\n...(요약됨)";

  // ── Stream one agent ──
  const streamAgent = useCallback(async (
    apiKey: string,
    agent: AgentId,
    round: number,
    systemPrompt: string,
    userContent: string,
    useSearch = false,
    maxTokens = 1100,
  ): Promise<string> => {
    const id = addMsg(agent, round, "", true);
    let full = "";
    const tools = useSearch ? [WEB_SEARCH_TOOL] : [];

    for await (const chunk of streamClaude({
      apiKey,
      systemPrompt,
      messages: [{ role: "user", content: userContent }],
      maxTokens,
      tools,
    })) {
      full += chunk;
      updateMsg(id, full, true);
    }
    updateMsg(id, full, false);
    return full;
  }, [addMsg, updateMsg]);

  // ── Fetch orchestrator decision (non-visible call) ──
  const fetchOrchestrator = useCallback(async (
    apiKey: string,
    debateHistory: string,
    userInput?: string,
  ): Promise<OrchestratorDecision | null> => {
    let full = "";
    for await (const chunk of streamClaude({
      apiKey,
      systemPrompt: "당신은 토론 오케스트레이터입니다. 지시한 JSON만 출력합니다. 다른 텍스트는 절대 없음.",
      messages: [{ role: "user", content: buildOrchestratorPrompt(debateHistory, userInput) }],
      maxTokens: 250,
      tools: [],
    })) {
      full += chunk;
    }
    return parseOrchestratorDecision(full);
  }, []);

  // ── Save result ──
  const saveResult = useCallback((res: Phase1Result, g: string, c: string) => {
    const payload = { result: res, genre: g, concept: c, savedAt: new Date().toISOString() };
    localStorage.setItem(`p1_result_${projectId}`, JSON.stringify(payload));
    setSavedAt(payload.savedAt);

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

  // ── Run debate V2 (dynamic orchestrator loop) ──
  const runDebate = useCallback(async (g: string, c: string, plat: string, ep: string) => {
    if (runningRef.current) return;
    runningRef.current = true;

    const apiKey = getAnthropicKey();
    const platLabel = PLATFORMS.find((p) => p.value === plat)?.label ?? plat;

    // ── Helper: wait for user intervention with auto-dismiss ──
    const waitIntervention = (turn: number): Promise<{ text: string; type: UserInterventionType } | null> => {
      setDebatePhase("user_wait");
      setTurnCount(turn);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          interventionResolveRef.current = null;
          setDebatePhase("running");
          resolve(null);
        }, 10000);
        interventionResolveRef.current = (text: string, type?: UserInterventionType) => {
          clearTimeout(timer);
          setDebatePhase("running");
          resolve(text ? { text, type: type ?? "IDEA" } : null);
        };
      });
    };

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

      const MOCK_V2: Array<{ agent: AgentId; turn: number; text: string }> = [
        {
          agent: "strategist", turn: 1,
          text: `📊 전략기획자 — 시장 분석 개시\n\n[시장 현황] 2025년 K-웹툰 ${g} 장르는 네이버웹툰·카카오페이지 양대 플랫폼 기준 신작 진입 경쟁이 역대 최고 수준입니다. 헌터·스탯 계열 판타지는 포화(신작 성공률 15% 이하)이나, 관계 서사와 도덕적 딜레마를 결합한 하이브리드 구조는 여전히 공백 구간입니다.\n\n[경쟁작 벤치마크]\n• 나 혼자만 레벨업 (카카오, 2018~2021): 1.4억 뷰. 성장 판타지 최강자. 단, 관계 서사 부재·단선 구조가 약점.\n• 전지적 독자시점 (네이버, 2020~2023): 420만 주간뷰. 메타픽션 탁월. 신규 독자 진입 장벽 높음.\n• 싸움독학 (네이버, 2019~2023): 280만 주간뷰. 성장 서사 교과서. IP 확장 한계.\n\n[포지셔닝] 우리 작품 — 대중성 68 / 신규IP 74. 경쟁작과 겹치지 않는 좌표.\n\n[슬로건] "헌터물의 스펙터클, 인간 드라마의 깊이" — GO 가능권. 시장성 88점.`,
        },
        {
          agent: "researcher", turn: 2,
          text: `🔍 심층조사자 — 전략기획자님께 반박합니다\n\n전략기획자님의 포지셔닝 분석은 탁월합니다. 그러나 "공백 구간"이라는 표현에는 동의하기 어렵습니다. 이 기획안의 '각성+성장' 구조는 《나 혼자만 레벨업》 문법과 60% 이상 유사합니다.\n\n[내부 모순 지적]\nLv2 클리셰 — 주인공 초기 무능: 1~3화 약함 설정이 6화 이후 급성장과 충돌합니다. "왜 갑자기 강해지는가"에 대한 논리 근거가 없으면 독자 이탈 유발. 수정 방향: '잠재 능력 봉인' 조건(트라우마·외부 봉인)을 1화에 암시로 심어두세요.\n\n[긍정 요소] 빌런의 논리적 동기 설정은 기존 경쟁작 대비 명확한 차별점입니다. 전략기획자님 슬로건을 지지하지만, 전제 조건이 해소되어야 합니다.`,
        },
        {
          agent: "scenario", turn: 3,
          text: `📝 시나리오작가 — 두 분 의견을 통합합니다\n\n앞서 전략기획자님과 심층조사자님 발언을 직접 인용하겠습니다. 전략기획자님 "하이브리드 서사"와 심층조사자님 "각성 시점 조정" 제안 모두 맞습니다. 서사 구조로 해결하겠습니다.\n\n[3막 구조]\n• 1막 (1~18화): 불공정한 세계를 먼저 보여준 뒤 주인공 잠재력을 독자만 아는 방식으로 암시. 3화 첫 변화, 5화 첫 위기.\n• 2막 (19~72화): 15화 중간 반전, 30화 대반전(빌런이 피해자였다는 복선), 50화 시즌 분기점.\n• 3막 (73~100화): 85화 진실 공개, 100화 열린 결말.\n\n심층조사자님 우려하신 성장 논리는 1화 '잠재력 봉인 암시' 컷으로 해결 가능합니다. 이것이면 충분하신가요?`,
        },
        {
          agent: "researcher", turn: 4,
          text: `🔍 심층조사자 — 시나리오작가님께 동의합니다\n\n시나리오작가님의 "1화 봉인 암시" 제안은 제가 지적한 논리 모순을 구조적으로 해결합니다. 추가로 한 가지 더: 30화 빌런 독백 "나는 너와 같은 선택을 했다" 장면이 커뮤니티 토론 폭발 포인트가 될 것입니다. 네이버 베스트댓글 점유 상위 10% 진입 가능.\n\n전략기획자님 포지셔닝 분석과 시나리오작가님 3막 구조 모두 데이터와 논리가 정합합니다. 내부 모순 2건 중 1건 해소. 나머지 1건(한국 사회 현실 반영 팩트체크)은 Phase 2에서 세계관설계자와 함께 처리하면 됩니다.\n\n합의 가능합니다.`,
        },
        {
          agent: "producer", turn: 5,
          text: `토론을 마무리합니다.\n\n전략기획자는 시장 공백과 포지셔닝 우위를 데이터로 입증했습니다. 심층조사자가 지적한 "성장 논리 모순"은 시나리오작가의 1화 봉인 암시 컷 제안으로 해소되었고, 심층조사자 본인도 합의를 표명했습니다.\n\n[핵심 리스크]\n① 한국 사회 현실 반영(팩트체크) — Phase 2 착수 전 해소 필요. (심각도 MEDIUM)\n② 헌터물 클리셰 유사성 — 1화 연출에서 각성 전에 세계관 불공정 장면 배치로 완화.\n\n[종합 판단]\n시장 공백 포지셔닝(대중성 68 / 신규IP 74), 명확한 USP(빌런 도덕 서사), 100화 확장 서사 구조 확보. 실현가능성 종합 84점.\n\n■ Phase 2 진행 권고: GO`,
        },
      ];

      setDebatePhase("running");
      setTurnCount(0);

      for (let i = 0; i < MOCK_V2.length; i++) {
        const m = MOCK_V2[i];
        setTurnCount(m.turn);
        const id = addMsg(m.agent, m.turn, "", true);
        await typeMsg(id, m.text);
        await sleep(500);

        // User intervention window after turns 2 and 3
        if (m.turn === 2 || m.turn === 3) {
          const iv = await waitIntervention(m.turn);
          if (iv) {
            addMsg("user", m.turn, `[${iv.type}] ${iv.text}`, false);
          }
        }
      }

      setResult(MOCK_RESULT);
      saveResult(MOCK_RESULT, g, c);
      setDebatePhase("done");
      runningRef.current = false;
      return;
    }

    // ── REAL API MODE (V2 orchestrator loop) ──
    setDebatePhase("running");
    setTurnCount(1);
    const history: string[] = [];

    const addToHistory = (agentLabel: string, text: string) => {
      history.push(`[${agentLabel}] ${trimCtx(text, 350)}`);
    };

    // Turn 1: strategist opens with web search
    const strat = await streamAgent(
      apiKey, "strategist", 1,
      buildAgentTurnPrompt("strategist", "시장 분석을 시작하세요. 웹 검색으로 실제 경쟁작 데이터를 조사하고 포지셔닝을 분석하세요.", "", g, c, platLabel, ep),
      `장르: ${g}\n플랫폼: ${platLabel}\n화수: ${ep}\n기획: ${c.slice(0, 400)}`,
      true, 1200,
    );
    addToHistory(AGENTS.strategist.label, strat);

    let turn = 1;
    const MAX_TURNS = 18;

    while (turn < MAX_TURNS) {
      await sleep(1200);

      // User intervention window (10s auto-dismiss)
      const iv = await waitIntervention(turn);
      if (iv) {
        addMsg("user", turn, `[${iv.type}] ${iv.text}`, false);
        addToHistory("사용자", `[${iv.type}] ${iv.text}`);
      }

      // Orchestrator decides next speaker
      const histText = history.join("\n\n");
      const decision = await fetchOrchestrator(apiKey, histText, iv?.text);

      if (!decision) break;

      // Vote if deadlock
      if (decision.vote_needed || decision.deadlock) {
        const opts = decision.vote_options ?? ["현재 방향 유지", "수정 후 진행", "재기획 필요"];
        setVoteOptions(opts);
        setDebatePhase("vote");
        const voteChoice = await new Promise<string>((res) => {
          voteResolveRef.current = res;
        });
        setVoteOptions(null);
        addToHistory("투표결과", voteChoice);
        addMsg("producer", turn, `🗳️ 투표 결과: ${voteChoice}`, false);
        setDebatePhase("running");
      }

      if (decision.consensus_reached || decision.next_agent === "producer") break;

      turn++;
      setTurnCount(turn);
      await sleep(1500);

      const agentReply = await streamAgent(
        apiKey, decision.next_agent, turn,
        buildAgentTurnPrompt(decision.next_agent, decision.instruction, history.join("\n\n"), g, c, platLabel, ep),
        `장르: ${g}\n기획: ${c.slice(0, 200)}`,
        false, 1000,
      );
      addToHistory(AGENTS[decision.next_agent as AgentId]?.label ?? decision.next_agent, agentReply);
    }

    await sleep(1500);

    // Producer final
    turn++;
    setTurnCount(turn);
    const producerFinal = await streamAgent(
      apiKey, "producer", turn,
      buildProducerFinalPrompt(history.join("\n\n")),
      `장르: ${g}\n기획: ${c.slice(0, 200)}`,
      false, 2500,
    );

    const parsed = parsePhase1Result(producerFinal);
    setResult(parsed ?? MOCK_RESULT);
    saveResult(parsed ?? MOCK_RESULT, g, c);

    setDebatePhase("done");
    runningRef.current = false;

  }, [addMsg, updateMsg, streamAgent, fetchOrchestrator, saveResult]);

  // ── Form submit ──
  const handleStart = useCallback(() => {
    if (!concept.trim()) return;
    setMsgs([]);
    setResult(null);
    setIsMock(false);
    setStage("debate");
    runDebate(genre, concept.trim(), platform, episodeCount);
  }, [concept, genre, platform, episodeCount, runDebate]);

  // ── V2 Intervention callbacks ──
  const handleInterventionSubmit = useCallback((text: string, type: UserInterventionType) => {
    if (interventionResolveRef.current) {
      interventionResolveRef.current(text, type);
      interventionResolveRef.current = null;
    }
  }, []);

  const handleInterventionSkip = useCallback(() => {
    if (interventionResolveRef.current) {
      interventionResolveRef.current("", "IDEA");
      interventionResolveRef.current = null;
    }
  }, []);

  const handleVote = useCallback((choice: string) => {
    if (voteResolveRef.current) {
      voteResolveRef.current(choice);
      voteResolveRef.current = null;
    }
  }, []);

  // ── Load saved result ──
  const handleResume = useCallback(() => {
    const raw = localStorage.getItem(`p1_result_${projectId}`);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { result: Phase1Result; genre: string; concept: string };
      setGenre(saved.genre);
      setConcept(saved.concept);
      setResult(saved.result);
      setDebatePhase("done");
      setStage("debate");
    } catch { /* ignore */ }
  }, [projectId]);

  const handleRestartNew = useCallback(() => {
    localStorage.removeItem(`p1_result_${projectId}`);
    setShowPrevBanner(false);
    setSavedAt(null);
  }, [projectId]);

  // ── Group messages by round (unused in V2 but kept for type safety) ──
  const rounds = Array.from(new Set(msgs.map((m: Msg) => m.round))).sort();

  // ── Render form ──
  if (stage === "form") {
    return (
      <div className={styles.page}>
        <div className={styles.formWrap}>
          {showPrevBanner && savedAt && (
            <div className={styles.prevBanner}>
              <div className={styles.prevBannerTitle}>이전 분석 결과가 있습니다</div>
              <div className={styles.prevBannerMeta}>
                저장: {new Date(savedAt).toLocaleDateString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </div>
              {savedGenre && <span className={styles.prevBannerGenre}>{savedGenre}</span>}
              {savedConcept && (
                <p className={styles.prevBannerConcept}>
                  {savedConcept.length > 80 ? savedConcept.slice(0, 80) + "..." : savedConcept}
                </p>
              )}
              <div className={styles.prevBannerBtns}>
                <button className={styles.btnResume} onClick={handleResume}>결과 보기</button>
                <button className={styles.btnRestartNew} onClick={handleRestartNew}>새로 분석</button>
              </div>
            </div>
          )}

          <div className={styles.formCard}>
            <h1 className={styles.formTitle}>Phase 1 · 기획 분석</h1>
            <p className={styles.formDesc}>
              5인 AI 에이전트가 3라운드 토론으로 기획안을 분석합니다.<br />
              시장 포지셔닝·설정 검증·서사 구조·연출 전략을 종합해 Phase 2 진행 여부를 판단합니다.
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
            onClick={() => { setStage("form"); setDebatePhase("r1"); setMsgs([]); setResult(null); runningRef.current = false; }}
          >
            다시 분석
          </button>
        </div>

        {/* V2 Turn counter bar */}
        <div className={styles.progressBar}>
          <div className={styles.turnCounterWrap}>
            <span className={styles.turnLabel}>
              {debatePhase === "done" ? "✅ 토론 완료" : debatePhase === "vote" ? "🗳️ 투표 중" : debatePhase === "user_wait" ? "💡 의견 입력 가능" : `Turn ${turnCount}`}
            </span>
            <div className={styles.turnDots}>
              {Array.from({ length: Math.max(turnCount, 1) }).map((_, i) => (
                <div key={i} className={`${styles.turnDot} ${i < turnCount - 1 ? styles.turnDotDone : i === turnCount - 1 ? styles.turnDotActive : ""}`} />
              ))}
            </div>
          </div>
          {debatePhase === "running" && <span className={styles.turnRunning}><ThinkingDots /></span>}
        </div>

        {/* Chat body */}
        <div className={styles.chatBody} ref={chatBodyRef}>
          {msgs.map((msg: Msg) => (
            <MsgBubble key={msg.id} msg={msg} />
          ))}

          {/* V2 Intervention */}
          {debatePhase === "user_wait" && (
            <InterventionV2
              turnCount={turnCount}
              onSubmit={handleInterventionSubmit}
              onSkip={handleInterventionSkip}
            />
          )}

          {/* Results */}
          {result && debatePhase === "done" && (
            <div className={styles.resultWrap}>
              <div className={styles.resultDivider}>
                <div className={styles.resultDividerLine} />
                <span className={styles.resultDividerText}>Phase 1 분석 완료</span>
                <div className={styles.resultDividerLine} />
              </div>

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
                >
                  📊 대시보드 보기
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
                  onClick={() => { setStage("form"); setDebatePhase("r1"); setMsgs([]); setResult(null); runningRef.current = false; }}
                >
                  재분석
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Vote Modal ── */}
      {debatePhase === "vote" && voteOptions && (
        <VoteModal options={voteOptions} onVote={handleVote} />
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
