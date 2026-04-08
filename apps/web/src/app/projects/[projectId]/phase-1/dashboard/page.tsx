"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import styles from "./page.module.css";

// ─── Types (mirrors phase-1/page.tsx) ────────────────────────────────────────

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
interface SavedData { result: Phase1Result; genre: string; concept: string; savedAt: string; }

// ─── Agent list ───────────────────────────────────────────────────────────────

const AGENTS = [
  { emoji: "📊", label: "전략 기획자" },
  { emoji: "🔍", label: "심층 조사자" },
  { emoji: "📝", label: "시나리오 작가" },
  { emoji: "🎬", label: "연출 작가" },
  { emoji: "🎯", label: "총괄 프로듀서" },
];

// ─── Derivation helpers ───────────────────────────────────────────────────────

function getRecommendedPlatform(result: Phase1Result): string {
  const { x, y } = result.positioning.ours;
  const c = result.feasibility_breakdown.commercial;
  if (x >= 70 && c >= 80) return "네이버웹툰";
  if (x >= 60) return "카카오페이지";
  if (y >= 75) return "네이버웹툰 (도전)";
  return "레진코믹스 / 카카오웹툰";
}

function getTargetAudience(result: Phase1Result): string {
  const { x } = result.positioning.ours;
  if (x >= 72) return "10~20대 남성 중심";
  if (x >= 55) return "20~30대 혼성";
  return "20~35대 마니아층";
}

type CompLevel = "낮음" | "중간" | "높음";
function getCompetitionLevel(result: Phase1Result): CompLevel {
  const { competitors, ours } = result.positioning;
  const close = competitors.filter(c => {
    const d = Math.sqrt((c.x - ours.x) ** 2 + (c.y - ours.y) ** 2);
    return d < 35;
  }).length;
  if (close === 0) return "낮음";
  if (close === 1) return "중간";
  return "높음";
}

function calcSimilarity(ours: PositioningPoint, comp: PositioningPoint): number {
  const d = Math.sqrt((ours.x - comp.x) ** 2 + (ours.y - comp.y) ** 2);
  return Math.round(Math.max(0, (1 - d / 141.4) * 100));
}

// ─── Circular gauge (SVG) ────────────────────────────────────────────────────

function FeasibilityGauge({ score, size = 120 }: { score: number; size?: number }) {
  const r = size * 0.38;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.round(score * 100);
  const offset = circ - (pct / 100) * circ;
  const color = score >= 0.7 ? "#34d399" : score >= 0.5 ? "#fbbf24" : "#f87171";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e1e2a" strokeWidth={size * 0.085} />
      <circle
        cx={cx} cy={cy} r={r} fill="none" stroke={color}
        strokeWidth={size * 0.085} strokeDasharray={circ}
        strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dashoffset 1s ease" }}
      />
      <text x={cx} y={cy - size * 0.05} textAnchor="middle" fill="#f1f5f9"
        fontSize={size * 0.22} fontWeight={800}>{pct}</text>
      <text x={cx} y={cy + size * 0.12} textAnchor="middle" fill="#64748b"
        fontSize={size * 0.10}>/ 100</text>
    </svg>
  );
}

// ─── Positioning matrix ───────────────────────────────────────────────────────

interface DotProps { cx?: number; cy?: number; payload?: { label: string; isOurs: boolean }; }
function CustomDot({ cx = 0, cy = 0, payload }: DotProps) {
  const isOurs = payload?.isOurs ?? false;
  const r = isOurs ? 9 : 7;
  const fill = isOurs ? "#7c6cfc" : "#60a5fa";
  const stroke = isOurs ? "#a78bfa" : "#93c5fd";
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.9} stroke={stroke} strokeWidth={2} />
      <text x={cx} y={cy - 13} textAnchor="middle" fontSize={10}
        fill={isOurs ? "#a78bfa" : "#94a3b8"} fontWeight={isOurs ? 700 : 400}>
        {payload?.label}
      </text>
    </g>
  );
}

function PositioningChart({ positioning }: { positioning: Phase1Result["positioning"] }) {
  const allPoints = [
    { ...positioning.ours, isOurs: true },
    ...positioning.competitors.map(c => ({ ...c, isOurs: false })),
  ];
  return (
    <div className={styles.chartWrap}>
      <div className={styles.axisLabelTop}>← 신규 IP &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 클리셰 재해석 →</div>
      <div className={styles.axisLabelLeft}>마니아</div>
      <div className={styles.axisLabelRight}>대중적</div>
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 24, right: 28, bottom: 12, left: 28 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a27" />
          <XAxis type="number" dataKey="x" domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={{ stroke: "#2a2a3d" }} tickLine={false} />
          <YAxis type="number" dataKey="y" domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={{ stroke: "#2a2a3d" }} tickLine={false} />
          <ReferenceLine x={50} stroke="#2a2a3d" strokeDasharray="4 4" />
          <ReferenceLine y={50} stroke="#2a2a3d" strokeDasharray="4 4" />
          <Tooltip cursor={false} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0]?.payload as { label: string; x: number; y: number };
            return (
              <div style={{ background: "#16161f", border: "1px solid #2a2a3d", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#f1f5f9" }}>
                <div style={{ fontWeight: 700 }}>{d.label}</div>
                <div style={{ color: "#64748b" }}>대중성 {d.x} · 독창성 {d.y}</div>
              </div>
            );
          }} />
          <Scatter data={allPoints} shape={(p) => CustomDot(p as DotProps)} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Radar chart ─────────────────────────────────────────────────────────────

function RadarChartView({ radar }: { radar: Phase1Result["radar"] }) {
  const data = radar.categories.map((cat, i) => ({
    subject: cat, ours: radar.ours[i] ?? 0, avg: radar.avg[i] ?? 0,
  }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart cx="50%" cy="50%" outerRadius="72%" data={data}>
        <PolarGrid stroke="#2a2a3d" />
        <PolarAngleAxis dataKey="subject" tick={{ fill: "#94a3b8", fontSize: 12, fontWeight: 500 }} />
        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "#3a3a52", fontSize: 9 }} axisLine={false} />
        <Radar name="우리 작품" dataKey="ours" stroke="#7c6cfc" fill="#7c6cfc" fillOpacity={0.28} strokeWidth={2} />
        <Radar name="경쟁작 평균" dataKey="avg" stroke="#34d399" fill="#34d399" fillOpacity={0.10} strokeWidth={1.5} strokeDasharray="4 4" />
      </RadarChart>
    </ResponsiveContainer>
  );
}

// ─── Competitor card with similarity bar ─────────────────────────────────────

function CompetitorCard({ comp, similarity }: { comp: Competitor; similarity: number }) {
  return (
    <div className={styles.compCard}>
      <div className={styles.compCardHeader} style={{ borderTop: `3px solid ${comp.genre_color}` }}>
        <div className={styles.compTitle}>{comp.title}</div>
        <div className={styles.compMeta}>
          <span className={styles.platformBadge} style={{ background: `${comp.genre_color}20`, color: comp.genre_color, border: `1px solid ${comp.genre_color}40` }}>
            {comp.platform}
          </span>
          <span className={styles.compPeriod}>{comp.period}</span>
        </div>
        <div className={styles.compReaders}>{comp.readers}</div>
      </div>
      <div className={styles.compBody}>
        <div className={styles.compTagRow}>
          <span className={styles.compTag} style={{ background: "rgba(52,211,153,0.10)", color: "#34d399", border: "1px solid rgba(52,211,153,0.25)" }}>
            강점
          </span>
          <span className={styles.compTagText}>{comp.strengths}</span>
        </div>
        <div className={styles.compTagRow}>
          <span className={styles.compTag} style={{ background: "rgba(248,113,113,0.10)", color: "#f87171", border: "1px solid rgba(248,113,113,0.25)" }}>
            약점
          </span>
          <span className={styles.compTagText}>{comp.weaknesses}</span>
        </div>
        <div className={styles.compTagRow}>
          <span className={styles.compTag} style={{ background: "rgba(167,139,250,0.10)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.25)" }}>
            차별점
          </span>
          <span className={styles.compTagText}>{comp.differentiation}</span>
        </div>
      </div>
      <div className={styles.similarityWrap}>
        <div className={styles.similarityLabel}>포지셔닝 유사도</div>
        <div className={styles.similarityRow}>
          <div className={styles.similarityBar}>
            <div className={styles.similarityFill} style={{ width: `${similarity}%`, background: comp.genre_color }} />
          </div>
          <span className={styles.similarityPct} style={{ color: comp.genre_color }}>{similarity}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── USP card ────────────────────────────────────────────────────────────────

function USPCard({ usp, idx }: { usp: USP; idx: number }) {
  const accents = ["#7c6cfc", "#34d399", "#f87171", "#fbbf24", "#60a5fa"];
  const accent = accents[idx % accents.length];
  return (
    <div className={styles.uspCard} style={{ borderTop: `3px solid ${accent}` }}>
      <div className={styles.uspIcon}>{usp.icon}</div>
      <div className={styles.uspTitle}>{usp.title}</div>
      <div className={styles.uspDesc}>
        {usp.desc.split(/\\n|\n/).map((line, i) => <p key={i}>{line}</p>)}
      </div>
      <div className={styles.uspPrediction} style={{ borderLeft: `2px solid ${accent}` }}>
        💡 {usp.prediction}
      </div>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ num, title, sub, children }: {
  num: string; title: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionNum}>{num}</span>
        <div>
          <div className={styles.sectionTitle}>{title}</div>
          {sub && <div className={styles.sectionSub}>{sub}</div>}
        </div>
      </div>
      {children}
    </section>
  );
}

// ─── Main dashboard page ──────────────────────────────────────────────────────

export default function Phase1Dashboard() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const [data, setData] = useState<SavedData | null>(null);
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    if (!projectId) return;
    const raw = localStorage.getItem(`p1_result_${projectId}`);
    if (!raw) return;
    try { setData(JSON.parse(raw) as SavedData); } catch { /* ignore */ }
  }, [projectId]);

  const handlePrint = useCallback(() => window.print(), []);

  const handleCopy = useCallback(() => {
    if (!data?.result.final_report) return;
    void navigator.clipboard.writeText(data.result.final_report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [data]);

  // ── No data state ──
  if (mounted && !data) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📋</div>
          <div className={styles.emptyTitle}>분석 결과 없음</div>
          <div className={styles.emptyDesc}>Phase 1 기획 분석을 먼저 완료해야 대시보드를 볼 수 있습니다.</div>
          <button className={styles.btnBack} onClick={() => router.push(`/projects/${projectId}/phase-1`)}>
            Phase 1 분석 시작
          </button>
        </div>
      </div>
    );
  }

  // ── Loading state ──
  if (!mounted || !data) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyState}>
          <div className={styles.emptyDesc}>로딩 중...</div>
        </div>
      </div>
    );
  }

  const { result, genre, savedAt } = data;
  const savedDate = savedAt ? new Date(savedAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }) : "날짜 미상";
  const platform = getRecommendedPlatform(result);
  const audience = getTargetAudience(result);
  const compLevel = getCompetitionLevel(result);
  const compLevelColor = compLevel === "낮음" ? "#34d399" : compLevel === "중간" ? "#fbbf24" : "#f87171";
  const verdictLabel = result.verdict === "go" ? "Phase 2 진행 권장" : result.verdict === "conditional" ? "조건부 진행" : "재검토 필요";
  const verdictColor = result.verdict === "go" ? "#34d399" : result.verdict === "conditional" ? "#fbbf24" : "#f87171";

  return (
    <div className={styles.page} ref={reportRef}>

      {/* ── Print/PDF header watermark ── */}
      <div className={styles.printWatermark}>AI WEBTOON STUDIO · Phase 1 기획 분석 보고서</div>

      {/* ── Main header ── */}
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.titleWrap}>
            <div className={styles.reportLabel}>Phase 1 · 기획 분석 보고서</div>
            <div className={styles.workTitle}>
              {genre} 웹툰 기획안
              <span className={styles.genreBadge}>{genre}</span>
            </div>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.btnPrint} onClick={handlePrint} title="인쇄 / PDF 저장">
              🖨 인쇄
            </button>
            <button className={styles.btnPdf} onClick={handlePrint} title="PDF로 내보내기">
              📄 PDF 내보내기
            </button>
            <button className={styles.btnBack2}
              onClick={() => router.push(`/projects/${projectId}/phase-1`)}>
              ← 토론으로
            </button>
          </div>
        </div>
        <div className={styles.headerMeta}>
          <span className={styles.metaItem}>📅 분석일: {savedDate}</span>
          <span className={styles.metaDivider} />
          <div className={styles.agentRow}>
            {AGENTS.map(a => (
              <span key={a.label} className={styles.agentChip}>{a.emoji} {a.label}</span>
            ))}
          </div>
        </div>
        <div className={styles.verdictBanner} style={{ borderColor: `${verdictColor}40`, background: `${verdictColor}0d` }}>
          <span className={styles.verdictDot} style={{ background: verdictColor }} />
          <span style={{ color: verdictColor, fontWeight: 700, fontSize: 14 }}>{verdictLabel}</span>
          <span style={{ color: "#64748b", fontSize: 13, marginLeft: 8 }}>— {result.summary}</span>
        </div>
      </header>

      {/* ── Section 1: Core metrics ── */}
      <Section num="01" title="핵심 지표" sub="실현가능성 종합 평가 및 시장 환경 분석">
        <div className={styles.metricsGrid}>
          {/* Feasibility gauge */}
          <div className={styles.metricCard}>
            <div className={styles.metricCardLabel}>실현가능성 점수</div>
            <div className={styles.metricGauge}>
              {mounted && <FeasibilityGauge score={result.feasibility_score} size={100} />}
            </div>
            <div className={styles.metricCardSub} style={{ color: verdictColor }}>{verdictLabel}</div>
          </div>
          {/* Competition level */}
          <div className={styles.metricCard}>
            <div className={styles.metricCardLabel}>시장 경쟁도</div>
            <div className={styles.metricBig} style={{ color: compLevelColor }}>{compLevel}</div>
            <div className={styles.metricCardSub}>동일 포지셔닝 경쟁작 기준</div>
          </div>
          {/* Target audience */}
          <div className={styles.metricCard}>
            <div className={styles.metricCardLabel}>예상 타겟 독자층</div>
            <div className={styles.metricBig} style={{ fontSize: 18 }}>{audience}</div>
            <div className={styles.metricCardSub}>포지셔닝 매트릭스 기반</div>
          </div>
          {/* Recommended platform */}
          <div className={styles.metricCard}>
            <div className={styles.metricCardLabel}>추천 연재 플랫폼</div>
            <div className={styles.metricBig} style={{ fontSize: 18, color: "#a78bfa" }}>{platform}</div>
            <div className={styles.metricCardSub}>상업성·독창성 지표 기반</div>
          </div>
        </div>
        {/* Breakdown bars */}
        <div className={styles.breakdownGrid}>
          {[
            { label: "시장성",     val: result.feasibility_breakdown.market,        color: "#60a5fa" },
            { label: "독창성",     val: result.feasibility_breakdown.originality,   color: "#a78bfa" },
            { label: "제작가능성", val: result.feasibility_breakdown.producibility, color: "#34d399" },
            { label: "상업성",     val: result.feasibility_breakdown.commercial,    color: "#fbbf24" },
          ].map(item => (
            <div key={item.label} className={styles.breakdownRow}>
              <span className={styles.breakdownLabel}>{item.label}</span>
              <div className={styles.breakdownTrack}>
                <div className={styles.breakdownFill} style={{ width: `${item.val}%`, background: item.color }} />
              </div>
              <span className={styles.breakdownVal} style={{ color: item.color }}>{item.val}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Section 2: Market analysis charts ── */}
      <Section num="02" title="시장 분석" sub="포지셔닝 매트릭스와 성공요소 비교">
        <div className={styles.twoColGrid}>
          <div>
            <div className={styles.chartTitle}>시장 포지셔닝 매트릭스</div>
            <div className={styles.chartCard}>
              {mounted && <PositioningChart positioning={result.positioning} />}
            </div>
          </div>
          <div>
            <div className={styles.chartTitle}>성공요소 레이더 차트</div>
            <div className={styles.chartCard}>
              {mounted && <RadarChartView radar={result.radar} />}
              <div className={styles.radarLegend}>
                <span className={styles.legendDot} style={{ background: "#7c6cfc" }} /> 우리 작품
                <span className={styles.legendDot} style={{ background: "#34d399", marginLeft: 12 }} /> 경쟁작 평균
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Section 3: Competitor comparison ── */}
      <Section num="03" title="유사작품 비교 분석" sub="경쟁작 강점·약점·차별화 전략 및 포지셔닝 유사도">
        <div className={styles.compGrid}>
          {result.competitors.map((comp, i) => {
            const matchedComp = result.positioning.competitors[i];
            const sim = matchedComp ? calcSimilarity(result.positioning.ours, matchedComp) : 0;
            return <CompetitorCard key={i} comp={comp} similarity={sim} />;
          })}
        </div>
      </Section>

      {/* ── Section 4: USPs ── */}
      <Section num="04" title="핵심 셀링 포인트 (USP)" sub="독자가 이 작품을 선택해야 하는 이유">
        <div className={styles.uspGrid}>
          {result.usp.map((u, i) => <USPCard key={i} usp={u} idx={i} />)}
        </div>
      </Section>

      {/* ── Section 5: Final report ── */}
      <Section num="05" title="최종 기획 요약서" sub="투자자·PD 제출용 A4 포맷">
        <div className={styles.reportHeader}>
          <button className={styles.btnCopy} onClick={handleCopy}>
            {copied ? "✓ 복사됨" : "📋 전문 복사"}
          </button>
        </div>
        <div className={styles.reportBox}>
          {result.final_report.split("\n").map((line, i) => {
            if (!line.trim()) return <div key={i} className={styles.reportBlank} />;
            if (line.startsWith("■") || line.startsWith("▶") || line.startsWith("━━"))
              return <div key={i} className={styles.reportHeading}>{line}</div>;
            if (line.startsWith("━"))
              return <hr key={i} className={styles.reportRule} />;
            if (line.startsWith("- ") || line.startsWith("• ") || line.startsWith("①") || line.startsWith("②") || line.startsWith("③"))
              return <div key={i} className={styles.reportBullet}>{line}</div>;
            return <div key={i} className={styles.reportLine}>{line}</div>;
          })}
        </div>
      </Section>

      {/* ── Footer ── */}
      <footer className={styles.footer}>
        <div className={styles.footerLeft}>AI Webtoon Studio · Phase 1 기획 분석 완료</div>
        <div className={styles.footerRight}>
          <button className={styles.btnPhase2}
            onClick={() => router.push(`/projects/${projectId}/phase-2`)}>
            Phase 2 세계관 설계 →
          </button>
        </div>
      </footer>

    </div>
  );
}
