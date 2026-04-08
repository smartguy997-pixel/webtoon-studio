"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ReferenceLine,
  RadialBarChart, RadialBar,
  ResponsiveContainer, Legend, Tooltip,
} from "recharts";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
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
type DebatePhase = "r1" | "r1_wait" | "r2" | "r3" | "done";

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

// ─── System Prompts ───────────────────────────────────────────────────────────

const P_STRATEGIST_R1 = (genre: string, concept: string, platform = "미정", episodeCount = "100화") => `당신은 K-웹툰 시장 전문 전략기획자(agent_strategist)입니다.
네이버웹툰·카카오페이지·레진코믹스 3개 플랫폼 데이터를 기반으로 기획안의 시장성을 분석합니다.

━━ 분석 대상 ━━
장르: ${genre}
목표 플랫폼: ${platform === "미정" ? "미정 (최적 플랫폼 추천 필요)" : platform}
목표 화수: ${episodeCount}
기획 개요: ${concept}

━━ 플랫폼 시장 맥락 (2024~2025 기준) ━━
• 네이버웹툰: 글로벌 MAU 1억 8000만, 국내 웹툰 점유율 70%+. 10~20대 남성 → 액션·현대판타지·이능력물. 20~30대 여성 → 로맨스·일상물. 1화 임팩트가 알고리즘 노출 결정.
• 카카오페이지: 국내 MAU 3600만, 유료 결제율 업계 1위. "기다리면무료" 모델로 25~35세 여성 장악. 로맨스판타지(빙의·회귀)·오피스물이 TOP50 절반 이상.
• 레진코믹스: 월정액제, 30대+ 마니아층. 성인·BL·하드코어 장르 허용. 마니아 IP 테스트베드 역할.

━━ 장르별 트렌드 국면 ━━
• 헌터·게이트·스탯 판타지: 2018~2022 황금기 종료. 현재 포화 상태, 신작 성공률 15% 이하. 차별화 없으면 진입 불가.
• 로맨스판타지(빙의·회귀): 2022~2025 초강세 지속. 카카오 TOP10 중 7개 점유. 단, 클리셰 누적으로 독자 피로도 상승 중.
• 현대판타지·이능력물: 네이버 10~20대 타깃, 2023~2025 신흥 강세. 학원물·직장물과 결합한 하이브리드 강세.
• 스릴러·범죄: 30대 男 카카오·네이버 동시 공략 가능. 영상화 IP 전환 성공률 높아 투자사 선호.

━━ 분석 지시 ━━
1. 웹 검색으로 "${genre}" 장르 현재 연재 중인 주요 작품 2~3종을 실제 조사하세요.
2. 각 경쟁작: 플랫폼·연재기간·독자반응(별점·댓글 분위기)·강점·약점을 구체적 수치와 함께 인용하세요.
3. 포지셔닝 좌표를 수치로 제시하세요 — 대중성(0=마니아, 100=대중적) / 신규IP(0=클리셰재해석, 100=완전신규).
4. 핵심 타깃 독자층: 연령대·성별·소비 패턴·추천 플랫폼을 명시하세요.
5. USP 3~5개를 "독자는 이 작품에서 [구체적 감정/경험]을 얻습니다" 형식으로 작성하세요.
6. 포지셔닝 한 줄 슬로건을 제시하세요. (예: "헌터물의 스펙터클 + 인간 드라마의 깊이")

말투: 현장 PD 보고서 수준의 전문 한국어. 수치·근거 반드시 포함.
분량: 550~750자.`;

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
          formatter={(v) => [`${Number(v)}점`, ""]}
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

function MsgBubble({ msg }: { msg: Msg }) {
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
          {displayText.split("\n").map((line, i) => (
            <span key={i}>
              {line}
              {i < displayText.split("\n").length - 1 && <br />}
            </span>
          ))}
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

interface InterventionBoxProps {
  onSubmit: (text: string) => void;
  onSkip: () => void;
}

function InterventionBox({ onSubmit, onSkip }: InterventionBoxProps) {
  const [text, setText] = useState("");
  const [timeLeft, setTimeLeft] = useState(30);

  useEffect(() => {
    if (timeLeft <= 0) { onSkip(); return; }
    const t = setTimeout(() => setTimeLeft((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, onSkip]);

  return (
    <div className={styles.interventionBox}>
      <div className={styles.interventionHeader}>
        <span className={styles.interventionTitle}>💡 Round 1 검토 완료 — 의견을 추가하시겠어요?</span>
        <span
          className={styles.interventionTimer}
          style={{ color: timeLeft <= 10 ? "#f87171" : "#94a3b8" }}
        >
          {timeLeft}초
        </span>
      </div>
      <p className={styles.interventionDesc}>
        추가 의견이 없으면 건너뛰기를 눌러주세요. Round 2에서 에이전트들이 심화 분석을 이어갑니다.
      </p>
      <div className={styles.interventionInputRow}>
        <textarea
          className={styles.interventionInput}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="예: 주인공이 마법을 쓰지 못하는 이유를 더 구체적으로 설정해야 할 것 같아요..."
          rows={3}
        />
      </div>
      <div className={styles.interventionBtns}>
        <button
          className={styles.btnIntervene}
          disabled={!text.trim()}
          onClick={() => onSubmit(text.trim())}
        >
          의견 제출
        </button>
        <button className={styles.btnSkip} onClick={onSkip}>
          건너뛰기 ({timeLeft}s)
        </button>
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
  const [debatePhase, setDebatePhase] = useState<DebatePhase>("r1");
  const [genre, setGenre] = useState(GENRES[0]);
  const [platform, setPlatform] = useState<PlatformValue>("undecided");
  const [episodeCount, setEpisodeCount] = useState<EpisodeCount>("100화");
  const [concept, setConcept] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [result, setResult] = useState<Phase1Result | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [savedGenre, setSavedGenre] = useState<string | null>(null);
  const [savedConcept, setSavedConcept] = useState<string | null>(null);
  const [showPrevBanner, setShowPrevBanner] = useState(false);

  // ── Refs ──
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const interventionResolveRef = useRef<((v: string) => void) | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    // Load saved result
    const raw = localStorage.getItem(`p1_result_${projectId}`);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as {
          result: Phase1Result;
          genre: string;
          concept: string;
          savedAt: string;
        };
        setSavedAt(saved.savedAt);
        setSavedGenre(saved.genre);
        setSavedConcept(saved.concept);
        setShowPrevBanner(true);
      } catch { /* ignore */ }
    }
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
    setMsgs((prev) => [...prev, { id, agent, round, text, streaming }]);
    return id;
  }, []);

  const updateMsg = useCallback((id: string, text: string, streaming: boolean) => {
    setMsgs((prev) => prev.map((m) => m.id === id ? { ...m, text, streaming } : m));
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

  // ── Save result ──
  const saveResult = useCallback((res: Phase1Result, g: string, c: string) => {
    const payload = { result: res, genre: g, concept: c, savedAt: new Date().toISOString() };
    localStorage.setItem(`p1_result_${projectId}`, JSON.stringify(payload));
    setSavedAt(payload.savedAt);

    // Best-effort Firestore save
    setDoc(doc(db, "project_summary", projectId, "phase_1", "result"), {
      ...res,
      genre: g,
      concept: c,
      savedAt: serverTimestamp(),
    }).catch(() => {});
  }, [projectId]);

  // ── Run debate ──
  const runDebate = useCallback(async (g: string, c: string, plat: string, ep: string) => {
    if (runningRef.current) return;
    runningRef.current = true;

    const apiKey = getAnthropicKey();

    if (!apiKey) {
      // Mock mode — commercial-quality simulated debate
      setIsMock(true);

      const mockMsgs: Array<{ agent: AgentId; round: number; text: string }> = [
        {
          agent: "strategist",
          round: 1,
          text: `📊 시장 분석 보고 — 전략기획자

[시장 현황] 2025년 K-웹툰 ${g} 장르는 네이버웹툰·카카오페이지 양대 플랫폼 기준 신작 진입 경쟁이 역대 최고 수준입니다. 헌터·스탯 계열 판타지는 포화(신작 성공률 15% 이하)이나, 관계 서사와 도덕적 딜레마를 결합한 하이브리드 구조는 여전히 공백 구간입니다.

[경쟁작 벤치마크]
• 나 혼자만 레벨업 (카카오페이지, 2018~2021): 누적 1.4억 뷰. 압도적 성장 판타지·시각적 스펙터클 강점. 단, 관계 서사 부재·단선 구조가 명백한 약점.
• 전지적 독자시점 (네이버웹툰, 2020~2023): 주간 최고 420만 뷰. 메타픽션·복선 회수 탁월. 그러나 원작 소설 선지식 없이는 신규 독자 진입 장벽 높음.
• 싸움독학 (네이버웹툰, 2019~2023): 주간 280만 뷰. 성장 서사 교과서. 판타지 요소 부재로 IP 확장 한계.

[포지셔닝] 우리 작품 — 대중성 68점 / 신규IP 74점. 기존 경쟁작과 겹치지 않는 좌표.

[타깃] 네이버웹툰 10~20대 남성 핵심 + 20~30대 감정 서사 선호 독자. 추천 플랫폼: 네이버웹툰 독점 or 카카오페이지 동시 연재.

[슬로건] "헌터물의 스펙터클, 인간 드라마의 깊이 — 두 마리 토끼를 잡는다"

feasibility 초기 평가: 시장성 88 / 상업성 87 — GO 가능권.`,
        },
        {
          agent: "researcher",
          round: 1,
          text: `🔍 설정 검증 보고 — 심층조사자

[선행작 충돌 검토]
이 기획안의 '각성 + 성장' 구조는 《나 혼자만 레벨업》(카카오페이지, 2018)의 핵심 문법과 60% 이상 유사합니다. 단, 빌런의 도덕적 동기와 관계 서사가 명확하게 추가되어 있어 직접 충돌 수준은 아닙니다. 차별화 방향: '각성' 장면을 1화 첫 컷에서 제거하고, 세계관의 구조적 불공정을 먼저 보여준 뒤 주인공 변화를 2~3화에 배치하면 신선도 확보 가능.

[내부 모순 지적]
Lv2 클리셰 — 주인공 초기 무능 설정: 1~3화 주인공이 약하다는 설정이 6화 이후 급격한 성장 속도와 충돌합니다. "왜 갑자기 강해지는가"에 대한 논리적 근거가 설정 내에 없으면 독자 이탈 유발. 수정 방향: '잠재 능력 봉인' 조건(트라우마·외부 봉인 장치 등)을 1화에 암시로 심어두세요.

Lv1 클리셰 (허용) — 고등학생 주인공, 특별한 운명: 장르 문법으로 허용 가능. 단, 주인공의 평범함을 강조하는 묘사는 3컷 이내로 제한해야 도입부 흡인력 유지.

[긍정 요소] 빌런의 논리적 동기 설정은 기존 경쟁작 대비 명확한 차별점입니다. 독자가 빌런에게 공감하는 순간을 25화에 설계하면 커뮤니티 토론 유발 효과 기대.

[팩트체크] 한국 고등학교 교육 시스템·학교 공간 묘사는 현실 기준 정합성 확인 필요. Phase 2에서 세계관설계자와 함께 처리 권장.`,
        },
        {
          agent: "scenario",
          round: 2,
          text: `📝 서사 구조 설계 — 시나리오작가

Round 1 검토를 반영합니다. 전략기획자의 "하이브리드 감정 서사" 방향과 심층조사자의 "각성 시점 조정" 제안을 서사 설계에 적용했습니다.

[3막 구조]
• 1막 (1~18화) — 도입·세계관 제시: 불공정한 세계를 먼저 보여준 뒤 주인공의 잠재력을 독자만 아는 방식으로 암시. 3화에서 주인공 첫 변화, 5화에서 첫 위기.
• 2막 (19~72화) — 성장·갈등·위기: 15화 중간 반전(조력자의 배신 암시), 30화 1막 완결+대반전(빌런이 사실 피해자였다는 복선 공개), 50화 시즌1 완결 가능 분기점, 60화 최대 위기.
• 3막 (73~100화) — 클라이막스·결말: 70화 최후의 선택, 85화 빌런과의 대면·진실 공개, 95화 최종 대결, 100화 열린 결말(시즌2 여지).

[훅 포인트 5개]
① 3화: 주인공이 처음으로 능력의 실마리를 무의식적으로 사용 — "어? 내가 방금 뭘 한 거지?"
② 15화: 믿었던 조력자가 주인공을 감시하고 있었다는 암시 컷
③ 30화: 빌런의 독백 — "나는 너와 같은 선택을 했다"
④ 50화: 주인공이 자신의 능력의 부작용을 처음 인지 — 클리프행어
⑤ 75화: 빌런이 사실 과거의 주인공과 같은 상황에 처해 있었음을 독자가 먼저 알게 되는 정보 비대칭 컷

[시즌 분할] 50화 완결로 시즌1 구성 가능. 시즌2 독립 진행 시 스핀오프(라이벌 시점) 동시 기획 권장.`,
        },
        {
          agent: "script",
          round: 2,
          text: `🎬 연출 전략 — 연출작가

시나리오작가의 3막 구조와 심층조사자의 클리셰 지적을 연출 레벨에서 해결하는 방향으로 제안합니다.

[화 유형별 컷 배분]
• 도입화(1~5화): 23컷 기준. 1~3컷에서 세계관의 불공정함을 ELS→MS 순서로 제시, 설명 없이 장면으로 보여주기.
• 액션·각성화(3화, 30화, 75화): 32컷. 세로 분할 패널(1:2 비율)로 속도감 → 풀페이지 임팩트 컷 1개로 피크 처리.
• 감정·반전화(15화, 50화): 20컷. 표정 CU 빈도 60%+, 여백 컷 2~3개로 독자 감정 침잠 시간 확보.
• 일상화: 17컷. 캐릭터 관계 빌드업 중심, 다음 화 복선 1개 의무 삽입.

[스크롤 정지 포인트 전략]
매화 7~8컷째: 세로 분할 패널 + SFX 텍스트로 시각적 충격 → 스크롤 정지 유도.
매화 마지막 컷(클리프행어): 다음 화를 보게 만드는 "질문형 화면 종료" — 대사 없이 캐릭터 표정 CU만으로 처리.

[1화 연출 제안]
컷 1: ELS — 황폐화된 도시 전경 (설명 자막 없음, 독자 상상 유도)
컷 2~3: MS → CU — 주인공 일상, 무기력한 표정
컷 7: 임팩트 컷 — 세계관의 핵심 불공정 장면, 풀 패널
컷 23: 클리프행어 — 주인공 눈빛 변화 CU, "다음 화" 버튼 클릭 유도

[시그니처 연출] 빌런 등장 씬마다 동일한 카메라 앵글(DUTCH + 역광)을 반복 사용 → 독자 조건반사적 긴장감 형성.`,
        },
        {
          agent: "producer",
          round: 3,
          text: `토론을 마무리합니다.

4인 에이전트의 의견을 종합합니다.

전략기획자는 시장 공백과 포지셔닝 우위를 데이터로 입증했습니다. 심층조사자가 지적한 "각성 시점 조정"과 "성장 속도 논리 보완"은 시나리오작가의 3막 설계에 이미 반영되었으며 충돌이 해소되었습니다. 연출작가의 화 유형별 컷 배분 전략은 시나리오 구조와 정합성이 높습니다.

[핵심 리스크]
① 심층조사자 지적: 주인공 성장 논리(1화 잠재력 암시 장치) — Phase 2 세계관 설계 시 반드시 해소 필요. (심각도 HIGH)
② 전략기획자 지적: 헌터물 클리셰 유사성 — 1화 연출에서 세계관 불공정 장면을 각성보다 앞에 배치하는 방식으로 완화 가능.

[종합 판단]
시장 공백 정확히 공략하는 포지셔닝(대중성 68 / 신규IP 74), 경쟁작 대비 명확한 차별점(빌런 도덕 서사), 100화 확장 가능한 서사 구조 확보. 실현가능성 종합 84점.

■ Phase 2 진행 권고: GO
전제 조건 — 주인공 성장 논리 보완(잠재력 봉인 장치 설정)을 Phase 2 착수 전 기획안에 반영할 것.`,
        },
      ];

      // Simulate streaming: type out each message character by character
      const typeMsg = async (msgId: string, text: string) => {
        const CHUNK = 6; // chars per tick
        for (let i = CHUNK; i <= text.length + CHUNK; i += CHUNK) {
          updateMsg(msgId, text.slice(0, i), true);
          await new Promise((r) => setTimeout(r, 18));
        }
        updateMsg(msgId, text, false);
      };

      setDebatePhase("r1");
      const id1 = addMsg("strategist", 1, "", true);
      await typeMsg(id1, mockMsgs[0].text);
      await sleep(600);

      const id2 = addMsg("researcher", 1, "", true);
      await typeMsg(id2, mockMsgs[1].text);

      setDebatePhase("r1_wait");
      const userOpinion = await new Promise<string>((resolve) => {
        interventionResolveRef.current = resolve;
      });
      if (userOpinion) addMsg("user", 1, userOpinion, false);

      setDebatePhase("r2");
      await sleep(400);
      const id3 = addMsg("scenario", 2, "", true);
      await typeMsg(id3, mockMsgs[2].text);
      await sleep(600);

      const id4 = addMsg("script", 2, "", true);
      await typeMsg(id4, mockMsgs[3].text);
      await sleep(600);

      setDebatePhase("r3");
      const id5 = addMsg("producer", 3, "", true);
      await typeMsg(id5, mockMsgs[4].text);

      setResult(MOCK_RESULT);
      saveResult(MOCK_RESULT, g, c);
      setDebatePhase("done");
      runningRef.current = false;
      return;
    }

    // ── Round 1 ──
    // Web search only for strategist (first call). Researcher builds on that context.
    // Each subsequent agent uses trimmed context to prevent token accumulation.
    setDebatePhase("r1");
    const platLabel = PLATFORMS.find(p => p.value === plat)?.label ?? plat;
    const userContent = `장르: ${g}\n목표 플랫폼: ${platLabel}\n목표 화수: ${ep}\n기획 개요: ${c}`;

    const strat1 = await streamAgent(
      apiKey, "strategist", 1, P_STRATEGIST_R1(g, c, platLabel, ep),
      userContent, /* useSearch */ true, /* maxTokens */ 1200,
    );

    await sleep(2000); // spread requests to avoid hitting 30k TPM limit

    const resrch1 = await streamAgent(
      apiKey, "researcher", 1, P_RESEARCHER_R1(g, c),
      // Pass only trimmed strategist text to keep input tokens low
      `기획: ${c.slice(0, 300)}\n목표 플랫폼: ${platLabel}\n목표 화수: ${ep}\n\n[전략기획자 요약]\n${trimCtx(strat1, 600)}`,
      /* useSearch */ false, /* maxTokens */ 1000,
    );

    // ── Intervention ──
    setDebatePhase("r1_wait");
    // Build trimmed r1 context for Round 2 prompts
    const r1Context = `[전략기획자]\n${trimCtx(strat1, 500)}\n\n[심층조사자]\n${trimCtx(resrch1, 500)}`;

    const userOpinion = await new Promise<string>((resolve) => {
      interventionResolveRef.current = resolve;
    });

    if (userOpinion) {
      addMsg("user", 1, userOpinion, false);
    }

    await sleep(2000);

    // ── Round 2 ──
    // Neither scenario nor script uses web search — they synthesise R1 context
    setDebatePhase("r2");
    const scen2 = await streamAgent(
      apiKey, "scenario", 2, buildP_SCENARIO_R2(r1Context, userOpinion),
      `장르: ${g}\n기획: ${c.slice(0, 200)}`,
      /* useSearch */ false, /* maxTokens */ 1000,
    );

    await sleep(2000);

    const scrpt2 = await streamAgent(
      apiKey, "script", 2, buildP_SCRIPT_R2(r1Context, userOpinion),
      `장르: ${g}\n기획: ${c.slice(0, 200)}\n\n[시나리오 요약]\n${trimCtx(scen2, 400)}`,
      /* useSearch */ false, /* maxTokens */ 1000,
    );

    await sleep(2000);

    // ── Round 3 ──
    // Producer receives trimmed summaries of all 4 agents
    setDebatePhase("r3");
    const allContext = [
      `[전략기획자]\n${trimCtx(strat1, 400)}`,
      `[심층조사자]\n${trimCtx(resrch1, 400)}`,
      userOpinion ? `[사용자 의견]\n${userOpinion}` : "",
      `[시나리오작가]\n${trimCtx(scen2, 400)}`,
      `[연출작가]\n${trimCtx(scrpt2, 400)}`,
    ].filter(Boolean).join("\n\n");

    const prod3 = await streamAgent(
      apiKey, "producer", 3, buildP_PRODUCER_R3(allContext),
      `장르: ${g}\n기획: ${c.slice(0, 200)}`,
      /* useSearch */ false, /* maxTokens */ 2000, // needs room for JSON output
    );

    // Parse result
    const parsed = parsePhase1Result(prod3);
    if (parsed) {
      setResult(parsed);
      saveResult(parsed, g, c);
    } else {
      // Fallback: use mock
      setResult(MOCK_RESULT);
      saveResult(MOCK_RESULT, g, c);
    }

    setDebatePhase("done");
    runningRef.current = false;
  }, [addMsg, streamAgent, saveResult]);

  // ── Form submit ──
  const handleStart = useCallback(() => {
    if (!concept.trim()) return;
    setMsgs([]);
    setResult(null);
    setIsMock(false);
    setStage("debate");
    runDebate(genre, concept.trim(), platform, episodeCount);
  }, [concept, genre, platform, episodeCount, runDebate]);

  // ── Intervention callbacks ──
  const handleInterventionSubmit = useCallback((text: string) => {
    if (interventionResolveRef.current) {
      interventionResolveRef.current(text);
      interventionResolveRef.current = null;
    }
  }, []);

  const handleInterventionSkip = useCallback(() => {
    if (interventionResolveRef.current) {
      interventionResolveRef.current("");
      interventionResolveRef.current = null;
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

  // ── Group messages by round ──
  const rounds = Array.from(new Set(msgs.map((m) => m.round))).sort();

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
                  onChange={(e) => setGenre(e.target.value)}
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
                  onChange={(e) => setEpisodeCount(e.target.value as EpisodeCount)}
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

            <label className={styles.formLabel} style={{ marginTop: 18 }}>기획 개요</label>
            <textarea
              className={styles.formTextarea}
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
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

        {/* Chat body */}
        <div className={styles.chatBody} ref={chatBodyRef}>
          {rounds.map((round) => (
            <div key={round}>
              <RoundHeader
                round={round}
                label={round === 1 ? "시장 분석" : round === 2 ? "심화 분석" : "총괄 종합"}
              />
              {msgs.filter((m) => m.round === round).map((msg) => (
                <MsgBubble key={msg.id} msg={msg} />
              ))}
            </div>
          ))}

          {/* Intervention box */}
          {debatePhase === "r1_wait" && (
            <InterventionBox
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
                    onClick={() => router.push(`/projects/${projectId}/phase-2`)}
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
    </div>
  );
}
