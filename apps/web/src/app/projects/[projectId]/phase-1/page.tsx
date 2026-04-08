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
  feasibility_score: 0.82,
  feasibility_breakdown: { market: 85, originality: 80, producibility: 75, commercial: 88 },
  verdict: "go",
  summary: "강력한 시장성과 독창적 세계관을 갖춘 기획안으로 Phase 2 진행을 적극 권장합니다.",
  usp: [
    { icon: "⚡", title: "즉각적 몰입감", desc: "1화부터 주인공의 위기 상황으로\n독자를 끌어당기는 강렬한 훅", prediction: "1~3화 이탈률 30% 이하 예상" },
    { icon: "🌍", title: "정교한 세계관", desc: "게임·판타지 문법을 현실 감각과\n융합한 신선한 설정", prediction: "2차 창작 커뮤니티 활성화 기대" },
    { icon: "💪", title: "성장 서사", desc: "0에서 출발하는 주인공의 여정이\n독자 대리만족을 극대화", prediction: "장기 연재 시 충성 독자층 형성" },
    { icon: "🎭", title: "입체적 빌런", desc: "단순 악역이 아닌 논리적 동기를\n가진 복합적 대립자 구도", prediction: "커뮤니티 토론 유발, 화제성 상승" },
  ],
  competitors: [
    {
      title: "나 혼자만 레벨업",
      platform: "카카오페이지",
      period: "2018~2021",
      readers: "누적 1억 뷰+",
      strengths: "압도적 주인공 성장, 시각적 스펙터클, 글로벌 팬덤",
      weaknesses: "여성 캐릭터 비중 약함, 스토리 단선적",
      differentiation: "관계 중심 서사와 복잡한 도덕적 갈등 추가",
      genre_color: "#60a5fa",
    },
    {
      title: "전지적 독자시점",
      platform: "네이버웹툰",
      period: "2020~2023",
      readers: "주간 최고 400만 뷰",
      strengths: "메타픽션 구조, 촘촘한 복선 회수, 압도적 감정몰입",
      weaknesses: "원작 소설 의존도, 진입장벽 높음",
      differentiation: "오리지널 IP로 접근성 강화, 단독 완결 구조",
      genre_color: "#a78bfa",
    },
    {
      title: "신의 탑",
      platform: "네이버웹툰",
      period: "2010~연재중",
      readers: "글로벌 누적 5억 뷰+",
      strengths: "독창적 세계관, 방대한 설정, 장기 연재 전략",
      weaknesses: "초기 작화 진입장벽, 느린 전개",
      differentiation: "빠른 템포와 모바일 최적화 연출로 현대 독자 공략",
      genre_color: "#34d399",
    },
  ],
  positioning: {
    ours: { x: 65, y: 72, label: "우리 작품" },
    competitors: [
      { x: 82, y: 28, label: "나혼자만레벨업" },
      { x: 55, y: 78, label: "전지적독자시점" },
      { x: 40, y: 85, label: "신의탑" },
    ],
  },
  radar: {
    ours: [80, 85, 70, 78, 88],
    avg:  [65, 60, 72, 68, 70],
    categories: ["신선도", "감정몰입", "세계관", "캐릭터", "상업성"],
  },
  final_report: "■ Phase 1 최종 기획 분석 보고서\n\n▶ 시장 분석 요약\n현재 K-웹툰 시장은 헌터·게이트·스탯 시스템 기반 판타지 장르가 포화 상태이나,\n관계 중심 서사와 도덕적 딜레마를 결합한 서브 장르는 여전히 블루오션입니다.\n\n━ 경쟁 환경\n나 혼자만 레벨업, 전지적 독자시점, 신의 탑이 장르 기준점을 형성하고 있으며,\n본 기획안은 이들의 강점을 흡수하면서 차별화된 서사 구조를 제시합니다.\n\n▶ 독창성 평가\n기획안의 핵심 설정은 기존 이세계물과 명확히 구분되는 독창적 요소를 보유하고 있으며,\n장르 독자의 기대치를 충족하면서 새로운 경험을 제공할 수 있는 구조입니다.\n\n▶ 제작 가능성\n100화 장기 연재를 고려한 서사 구조의 확장성이 양호합니다.\n다만 세계관 설정의 내부 논리 정합성 강화 작업이 Phase 2에서 필요합니다.\n\n■ 최종 권고: GO\n실현가능성 종합 점수 0.82로 Phase 2 세계관 구축 진행을 적극 권장합니다.",
};

// ─── System Prompts ───────────────────────────────────────────────────────────

const P_STRATEGIST_R1 = (genre: string, concept: string) => `당신은 K-웹툰 시장 전문 전략 기획자(agent_strategist)입니다. Phase 1 기획 분석 Round 1 토론에 참여합니다.

분석 대상:
- 장르: ${genre}
- 기획 개요: ${concept}

역할:
1. 웹 검색으로 네이버웹툰·카카오페이지·레진코믹스 최신 트렌드를 조사하세요.
2. 실제 경쟁작 2~3종을 이름과 함께 구체적으로 인용하세요. (예: 나 혼자만 레벨업, 전지적 독자시점, 신의 탑)
3. 포지셔닝 평가: 대중성(0~100) / 신규IP(0~100) 점수를 명시하세요.
4. 핵심 타겟 독자층(연령·성별·소비 패턴)을 분석하세요.
5. USP 3~5개를 "독자는 이 작품에서 [구체적 경험]을 얻습니다" 형식으로 작성하세요.

말투: 전문적이고 논리적. 실제 데이터 근거 필수. 자연스러운 한국어.
분량: 450~650자.`;

const P_RESEARCHER_R1 = (genre: string, concept: string) => `당신은 스토리 논리성·현실성 검토 전문 심층 조사자(agent_researcher)입니다. Phase 1 기획 분석 Round 1 토론에 참여합니다.

분석 대상:
- 장르: ${genre}
- 기획 개요: ${concept}

역할:
1. 웹 검색으로 기획안 설정·배경의 현실성을 팩트체크하세요.
2. 유사 선행 작품을 구체적으로 인용하세요: "이 [요소]는 《작품명》(플랫폼, 연도)의 [소재]와 유사합니다"
3. 내부 논리 모순을 구체적으로 지적하세요: "X 능력이 Y 조건이면 Z 장면이 불가능해집니다"
4. 각 문제점에 반드시 구체적 대안을 제시하세요. 순수 비판 금지.

말투: 분석적이고 날카롭지만 건설적. 자연스러운 한국어.
분량: 400~600자.`;

const buildP_SCENARIO_R2 = (r1Context: string, userInput: string) => `당신은 K-웹툰 시나리오 전문 작가(agent_scenario)입니다. Phase 1 Round 2 토론에 참여합니다.

Round 1 토론 내역:
---
${r1Context}
---
${userInput ? `\n사용자 추가 의견: "${userInput}"\n` : ""}
역할:
1. 3막 구조를 구체적 화수와 함께 제시하세요. (예: "1~20화: 도입, 21~60화: 갈등, 61~100화: 클라이막스")
2. 독자 이탈 방지 훅 포인트를 화수와 함께 명시하세요.
3. 웹 검색으로 장기 연재 성공 패턴을 조사하여 적용하세요.
4. 시즌 분할 가능성을 평가하세요.

말투: 창의적이고 구조적. 자연스러운 한국어.
분량: 350~500자.`;

const buildP_SCRIPT_R2 = (r1Context: string, userInput: string) => `당신은 K-웹툰 연출 전문 작가(agent_script)입니다. Phase 1 Round 2 토론에 참여합니다.

Round 1 토론 내역:
---
${r1Context}
---
${userInput ? `\n사용자 추가 의견: "${userInput}"\n` : ""}
역할:
1. 세로 스크롤 웹툰 특화 연출 전략을 구체적으로 제시하세요.
2. "정지 포인트" 컷 배치 전략을 화수 유형별로 제안하세요.
3. 모바일 최적 컷수를 구체적 숫자로 제시하세요. (회차 유형별 상이)
4. 장르별 시각 문법 예시 (로맨스/액션/공포 중 해당 장르 중심)
5. 도입부/클라이막스/일상화 컷 분배를 구체적 수치로 제시하세요.

말투: 시각적이고 실용적. 자연스러운 한국어.
분량: 350~500자.`;

const buildP_PRODUCER_R3 = (allContext: string) => `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다. Phase 1 기획 분석 Round 3 최종 종합을 진행합니다.

전체 토론 내역:
---
${allContext}
---

역할:
1. "토론을 마무리합니다."로 시작하세요.
2. 4명 에이전트의 의견을 종합하고, 명시적 갈등은 이름을 거론하며 중재하세요.
3. 최종 실현가능성 평가를 내리세요.
4. Phase 2 진행 여부를 명확히 권고하세요.

말투: 권위 있고 명확. 결론 지향. 자연스러운 한국어.
분량: 300~450자.

⚠️ 응답 마지막에 다음 형식의 JSON을 정확히 출력하세요 (다른 텍스트 없이):

[PHASE1_RESULT]
{
  "feasibility_score": 0.82,
  "feasibility_breakdown": {"market": 85, "originality": 80, "producibility": 75, "commercial": 88},
  "verdict": "go",
  "summary": "80자 이내 요약",
  "usp": [{"icon": "⚡", "title": "USP제목", "desc": "설명\\n2줄", "prediction": "독자반응 예측"}],
  "competitors": [{"title": "작품명", "platform": "네이버웹툰", "period": "2022~연재중", "readers": "주간200만+", "strengths": "강점", "weaknesses": "약점", "differentiation": "차별점", "genre_color": "#60a5fa"}],
  "positioning": {"ours": {"x": 65, "y": 72, "label": "우리 작품"}, "competitors": [{"x": 80, "y": 30, "label": "작품명"}]},
  "radar": {"ours": [70,85,60,80,75], "avg": [65,60,70,65,70], "categories": ["신선도","감정몰입","세계관","캐릭터","상업성"]},
  "final_report": "300자 이상 A4급 보고서"
}
[/PHASE1_RESULT]

verdict 기준: "go" ≥ 0.70, "conditional" 0.50~0.69, "reject" < 0.50`;

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
    if (line.startsWith("■") || line.startsWith("▶") || line.startsWith("━")) {
      return <div key={i} className={styles.reportHeading}>{line}</div>;
    }
    if (line.startsWith("- ")) {
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

export default function Phase1Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();

  // ── State ──
  const [stage, setStage] = useState<Stage>("form");
  const [debatePhase, setDebatePhase] = useState<DebatePhase>("r1");
  const [genre, setGenre] = useState(GENRES[0]);
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
  const runDebate = useCallback(async (g: string, c: string) => {
    if (runningRef.current) return;
    runningRef.current = true;

    const apiKey = getAnthropicKey();

    if (!apiKey) {
      // Mock mode
      setIsMock(true);
      const mockMsgs: Array<{ agent: AgentId; round: number; text: string }> = [
        { agent: "strategist", round: 1, text: "【Mock】 시장 분석: 현재 판타지 장르 시장은 강세를 유지하고 있습니다. 나 혼자만 레벨업(카카오페이지)과 전지적 독자시점(네이버웹툰)이 기준점을 형성하며, 본 기획안은 대중성 65점 / 신규IP 72점의 포지셔닝으로 차별화 가능성이 높습니다." },
        { agent: "researcher", round: 1, text: "【Mock】 팩트체크 완료: 설정의 내부 논리는 전반적으로 탄탄하나, 주인공의 능력 제한 조건이 3화 이후 서사와 충돌할 수 있습니다. 해결책으로 '능력 봉인 해제 조건'을 초반에 명시하는 것을 제안합니다." },
        { agent: "scenario",   round: 2, text: "【Mock】 3막 구조: 1~20화 도입(세계관 제시 + 주인공 각성), 21~60화 성장과 갈등(라이벌 등장, 중간보스), 61~100화 클라이막스(최종 빌런 대결). 15화, 40화, 75화에 주요 반전 훅 포인트 배치를 권장합니다." },
        { agent: "script",     round: 2, text: "【Mock】 연출 전략: 도입화 28컷, 클라이막스 35컷, 일상화 22컷 구성 권장. 스크롤 정지 포인트는 매화 7~9컷째에 임팩트 컷 삽입. 세로 분할 패널을 활용한 속도감 연출이 모바일 독자 집중도를 높입니다." },
        { agent: "producer",   round: 3, text: "토론을 마무리합니다.\n\n전략기획자와 시나리오작가의 시장성 분석, 심층조사자의 논리 검증, 연출작가의 모바일 최적화 전략을 종합한 결과, 본 기획안은 Phase 2 진행에 충분한 완성도를 갖추고 있습니다. 실현가능성 종합 점수 0.82점으로 적극 권장 판정입니다." },
      ];
      for (const m of mockMsgs) {
        addMsg(m.agent, m.round, m.text, false);
        await new Promise((r) => setTimeout(r, 300));
      }
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
    const userContent = `장르: ${g}\n기획 개요: ${c}`;

    const strat1 = await streamAgent(
      apiKey, "strategist", 1, P_STRATEGIST_R1(g, c),
      userContent, /* useSearch */ true, /* maxTokens */ 1100,
    );

    await sleep(2000); // spread requests to avoid hitting 30k TPM limit

    const resrch1 = await streamAgent(
      apiKey, "researcher", 1, P_RESEARCHER_R1(g, c),
      // Pass only trimmed strategist text to keep input tokens low
      `기획: ${c.slice(0, 300)}\n\n[전략기획자 요약]\n${trimCtx(strat1, 600)}`,
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
    runDebate(genre, concept.trim());
  }, [concept, genre, runDebate]);

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
              7인 AI 에이전트가 장르·기획안을 다각도로 분석합니다.<br />
              전략기획자·심층조사자·시나리오작가·연출작가·총괄프로듀서가 3라운드 토론 후 Phase 2 진행 여부를 판단합니다.
            </p>

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

            <label className={styles.formLabel}>기획 개요</label>
            <textarea
              className={styles.formTextarea}
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder={"예: 평범한 고등학생이 어느 날 눈을 떠보니 10년 후 멸망한 세계에 있다.\n자신이 죽인 것으로 알려진 '마왕'이 사실은 세계를 구하려 했다는 진실을 밝히기 위해\n과거로 거슬러 올라가는 타임루프 판타지."}
              rows={6}
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
