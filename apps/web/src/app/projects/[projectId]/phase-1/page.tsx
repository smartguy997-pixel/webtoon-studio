"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import s from "./page.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const GENRES = [
  "판타지", "로맨스", "액션", "SF", "스릴러", "일상/힐링",
  "무협", "스포츠", "공포", "역사", "드라마", "개그",
];

// ── 3 agents for Phase 1 ────────────────────────────────
const AGENTS = [
  { id: "strategist", label: "전략 기획자",   desc: "장르 포지셔닝 · USP 도출 · 경쟁작 분석" },
  { id: "researcher", label: "심층 조사자",   desc: "트렌드 리서치 · 독자 시장 검증" },
  { id: "producer",   label: "총괄 프로듀서", desc: "최종 실현가능성 점수 산정 · 종합 판단" },
];

// ── Types ─────────────────────────────────────────────────
interface Competitor {
  title: string;
  strength: string;
  weakness: string;
  our_edge: string;
}

interface Phase1Data {
  feasibility_score: number;
  verdict: "go" | "conditional" | "reject";
  usp: string[];
  summary: string;
  market_analysis: {
    genre: string;
    positioning: string;
    trend_keywords: string[];
    competitors: Competitor[];
  };
  agent_notes: Record<string, string>;
}

interface SavedResult {
  data: Phase1Data;
  gating_passed: boolean;
  input: { genre: string; concept: string; title?: string; target_audience?: string };
  isMock: boolean;
  savedAt: string;
}

type AgentStatus = "idle" | "running" | "done";
type RunState = "idle" | "running" | "done" | "error";

// ── Mock data generator ───────────────────────────────────
function buildMock(input: { genre: string; concept: string; title?: string }): Phase1Data {
  const scoreMap: Record<string, number> = {
    "판타지": 0.82, "로맨스": 0.79, "액션": 0.76, "SF": 0.74,
    "스릴러": 0.71, "일상/힐링": 0.68, "무협": 0.73, "스포츠": 0.70,
    "공포": 0.65, "역사": 0.67, "드라마": 0.72, "개그": 0.63,
  };
  const score = (scoreMap[input.genre] ?? 0.72) + (input.concept.length > 80 ? 0.04 : 0);
  const clamped = Math.min(score, 0.97);
  const verdict: "go" | "conditional" | "reject" =
    clamped >= 0.7 ? "go" : clamped >= 0.5 ? "conditional" : "reject";

  const uspByGenre: Record<string, string[]> = {
    "판타지": [
      "매화 마지막 컷에서 독자가 예상하지 못한 반전이 터진다",
      "주인공이 항상 상황보다 한 발 앞서 생각하는 것처럼 느껴진다",
      "세계관 규칙이 명확해서 독자가 퍼즐처럼 앞 내용을 추리할 수 있다",
      "주조연 모두 뚜렷한 동기가 있어 악당도 이해하게 된다",
    ],
    "로맨스": [
      "감정선이 과장 없이 현실적으로 쌓여 독자가 감정 이입하기 쉽다",
      "두 주인공의 대화가 쿠션 없이 날카로워서 다음 화가 기다려진다",
      "조력자 캐릭터들도 각자의 사랑 이야기가 있어 부캐를 좋아하는 독자를 잡는다",
    ],
    "액션": [
      "전투 연출이 세로 스크롤 리듬에 최적화돼 있어 손가락이 멈추지 않는다",
      "주인공이 약해서 이기는 것이 아니라 전략으로 이기는 장면이 통쾌하다",
      "반복 패턴 없이 매 전투마다 새로운 해결책이 나온다",
      "적 캐릭터의 능력이 항상 설명되어 독자가 미리 긴장할 수 있다",
    ],
  };
  const usp = uspByGenre[input.genre] ?? [
    `${input.genre} 장르에서 흔히 보지 못한 주인공 성장 방식`,
    "매화 말미에 다음 화가 궁금해지는 강력한 훅",
    "독자가 공감하는 현실적 감정선과 갈등 구조",
    "기존 독자층 + 신규 유입층 모두 잡는 이중 타겟 전략",
  ];

  return {
    feasibility_score: parseFloat(clamped.toFixed(2)),
    verdict,
    usp,
    summary: `${input.genre} 장르의 "${input.title ?? "이 작품"}"은 현재 시장에서 ${verdict === "go" ? "충분한 경쟁력" : "잠재력"}을 가지고 있습니다. 독자 이탈 지점을 보완하고 플랫폼 특성에 맞춘 연출로 차별화할 경우 상위권 진입 가능성이 있습니다.`,
    market_analysis: {
      genre: input.genre,
      positioning: `신규 IP / 대중 방향 — 현재 ${input.genre} 시장 주류와 차별화된 서브장르 포지셔닝 권장`,
      trend_keywords: ["세계관 빌딩", "캐릭터 서사", "세로 스크롤 최적화", "훅 밀도", "팬덤 형성"],
      competitors: [
        {
          title: "현재 ${genre} 상위작 A",
          strength: "기존 독자층이 두터운 클래식 설정",
          weakness: "중반부 완급 조절 실패로 이탈률 상승",
          our_edge: "매화 긴장도 유지 + 예측 불가 반전으로 이탈 방지",
        },
        {
          title: "신작 B",
          strength: "연출 스타일이 독특해 SNS 바이럴 성공",
          weakness: "스토리 완성도 부족으로 초반 유입 후 독자 유지 실패",
          our_edge: "탄탄한 3막 구조 + 캐릭터 감정선으로 장기 연재 체력 확보",
        },
        {
          title: "완결작 C",
          strength: "완결까지 완성도를 유지한 검증된 스토리텔링",
          weakness: "독자 접근성이 낮은 마니아향 설정",
          our_edge: "대중 접근성 + 마니아 만족 레이어를 분리 설계",
        },
      ].map((c) => ({ ...c, title: c.title.replace("${genre}", input.genre) })),
    },
    agent_notes: {
      strategist: `${input.genre} 시장은 현재 상위 20% 작품이 조회수의 78%를 가져가는 구조입니다. 초반 3화 이내에 독자를 잡는 훅 밀도가 핵심입니다.`,
      researcher: `최근 6개월 ${input.genre} 신작 중 월간 독자 100만 달성 작품의 공통점: ①주인공 명확한 목표 ②2화 이내 첫 위기 ③조력자 캐릭터의 독립적 매력`,
      producer: `USP와 시장 분석을 종합할 때 실현가능성 ${(clamped * 100).toFixed(0)}%로 평가합니다. ${verdict === "go" ? "Phase 2 진행을 승인합니다." : "아이디어 보완 후 재분석을 권장합니다."}`,
    },
  };
}

// ── Storage helpers ───────────────────────────────────────
const getKey = (id: string) => `wts_phase1_${id}`;

function loadResult(projectId: string): SavedResult | null {
  try {
    const raw = localStorage.getItem(getKey(projectId));
    return raw ? (JSON.parse(raw) as SavedResult) : null;
  } catch { return null; }
}

function saveResult(projectId: string, r: SavedResult) {
  localStorage.setItem(getKey(projectId), JSON.stringify(r));
  // 프로젝트 목록도 업데이트
  try {
    const projects = JSON.parse(localStorage.getItem("wts_projects") ?? "[]") as Array<Record<string, unknown>>;
    const updated = projects.map((p) =>
      p.id === projectId
        ? { ...p, feasibilityScore: r.data.feasibility_score, currentPhase: Math.max(Number(p.currentPhase ?? 1), 1) }
        : p
    );
    localStorage.setItem("wts_projects", JSON.stringify(updated));
  } catch { /* ignore */ }
}

// ── ScoreGauge ────────────────────────────────────────────
function ScoreGauge({ score }: { score: number }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const fill = circ * score;
  const color = score >= 0.7 ? "var(--phase-2-color)" : score >= 0.5 ? "var(--phase-3-color)" : "#f87171";

  return (
    <div className={s.scoreGauge}>
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="8" />
        <circle
          cx="60" cy="60" r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={`${fill} ${circ - fill}`}
          strokeLinecap="round"
          style={{ transform: "rotate(-90deg)", transformOrigin: "60px 60px", transition: "stroke-dasharray 0.8s ease" }}
        />
      </svg>
      <div className={s.scoreText}>
        <span className={s.scoreValue} style={{ color }}>{Math.round(score * 100)}</span>
        <span className={s.scoreUnit}>/ 100</span>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────
export default function Phase1Page({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();

  // Form
  const [genre, setGenre] = useState(GENRES[0]);
  const [title, setTitle] = useState("");
  const [concept, setConcept] = useState("");
  const [target, setTarget] = useState("");

  // Run state
  const [runState, setRunState] = useState<RunState>("idle");
  const [agentStates, setAgentStates] = useState<AgentStatus[]>(["idle", "idle", "idle"]);
  const [isMock, setIsMock] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Result
  const [result, setResult] = useState<SavedResult | null>(null);

  useEffect(() => {
    const saved = loadResult(projectId);
    if (saved) {
      setResult(saved);
      setGenre(saved.input.genre);
      setTitle(saved.input.title ?? "");
      setConcept(saved.input.concept);
      setTarget(saved.input.target_audience ?? "");
      setRunState("done");
      setIsMock(saved.isMock);
    }
  }, [projectId]);

  function setAgent(idx: number, st: AgentStatus) {
    setAgentStates((prev) => prev.map((v, i) => (i === idx ? st : v)));
  }

  async function runAnalysis() {
    if (!concept.trim() || concept.trim().length < 10) return;

    setRunState("running");
    setAgentStates(["idle", "idle", "idle"]);
    setErrorMsg("");
    setResult(null);
    setIsMock(false);

    const input = { genre, concept: concept.trim(), title: title.trim() || undefined, target_audience: target.trim() || undefined };
    const anthropicKey = localStorage.getItem("wts_anthropic_key") ?? "";

    // ── Try real API ────────────────────────────────────────
    let useMock = !anthropicKey;

    if (!useMock) {
      try {
        setAgent(0, "running");
        await delay(400);

        const res = await fetch(`${API_BASE}/api/phases/${projectId}/phase-1`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Anthropic-Key": anthropicKey,
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(60000),
        });

        setAgent(0, "done");
        setAgent(1, "running");
        await delay(300);
        setAgent(1, "done");
        setAgent(2, "running");
        await delay(300);
        setAgent(2, "done");

        if (!res.ok) throw new Error(`API ${res.status}`);

        const json = (await res.json()) as {
          success: boolean;
          data: Phase1Data;
          gating_passed: boolean;
        };

        const saved: SavedResult = {
          data: json.data,
          gating_passed: json.gating_passed,
          input,
          isMock: false,
          savedAt: new Date().toISOString(),
        };
        saveResult(projectId, saved);
        setResult(saved);
        setRunState("done");
        return;
      } catch {
        useMock = true;
      }
    }

    // ── Mock mode ───────────────────────────────────────────
    setIsMock(true);
    for (let i = 0; i < AGENTS.length; i++) {
      setAgent(i, "running");
      await delay(900 + i * 400);
      setAgent(i, "done");
    }

    const mockData = buildMock(input);
    const saved: SavedResult = {
      data: mockData,
      gating_passed: mockData.feasibility_score >= 0.5,
      input,
      isMock: true,
      savedAt: new Date().toISOString(),
    };
    saveResult(projectId, saved);
    setResult(saved);
    setRunState("done");
  }

  function handleGating() {
    router.push(`/projects/${projectId}/phase-2`);
  }

  const canRun = concept.trim().length >= 10 && runState !== "running";
  const verdictLabel = result?.data.verdict === "go" ? "GO — Phase 2 진행 가능" :
    result?.data.verdict === "conditional" ? "조건부 진행" : "재기획 권고";
  const verdictClass = result?.data.verdict === "go" ? s.verdictGo :
    result?.data.verdict === "conditional" ? s.verdictConditional : s.verdictReject;

  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>Phase 1 — 기획 분석</h1>
      <p className={s.pageDesc}>
        장르와 핵심 아이디어를 입력하면 3인의 AI 에이전트가 시장성을 분석하고 USP를 도출합니다.
      </p>

      {/* ── Input card ── */}
      <div className={s.inputCard}>
        <div className={s.inputCardTitle}>작품 정보 입력</div>
        <div className={s.inputRow}>
          <div className={s.formGroup}>
            <label className={s.formLabel}>장르 *</label>
            <select className={s.formSelect} value={genre} onChange={(e) => setGenre(e.target.value)}>
              {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className={s.formGroup}>
            <label className={s.formLabel}>작품 제목 (선택)</label>
            <input className={s.formInput} placeholder="예) 별을 삼킨 소녀" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className={s.formGroup}>
            <label className={s.formLabel}>타겟 독자 (선택)</label>
            <input className={s.formInput} placeholder="예) 20대 여성" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
        </div>
        <div className={s.formGroup}>
          <label className={s.formLabel}>핵심 아이디어 * (10자 이상)</label>
          <textarea
            className={s.formTextarea}
            placeholder="주인공의 특징, 핵심 갈등, 세계관 설정, 차별화 포인트 등 자유롭게 적어주세요"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
          />
        </div>
        <div className={s.inputActions}>
          <span className={`${s.charCount} ${concept.length > 0 && concept.length < 10 ? s.charCountWarn : ""}`}>
            {concept.length}자 {concept.length < 10 ? `(최소 10자)` : ""}
          </span>
          <button className={s.btnRun} onClick={runAnalysis} disabled={!canRun}>
            {runState === "running" ? "⏳ 분석 중…" : "✦ 기획 분석 실행"}
          </button>
        </div>
      </div>

      {/* ── Agent progress ── */}
      {runState === "running" && (
        <div className={s.progress}>
          <div className={s.progressTitle}>에이전트 실행 중</div>
          <div className={s.agentSteps}>
            {AGENTS.map((agent, i) => {
              const st = agentStates[i];
              return (
                <div key={agent.id} className={`${s.agentStep} ${st === "done" ? s.stepDone : ""} ${st === "running" ? s.stepActive : ""}`}>
                  <div className={s.agentStepIcon}>
                    {st === "done" ? "✓" : st === "running" ? (
                      <div className={s.spinnerDot}><span /><span /><span /></div>
                    ) : i + 1}
                  </div>
                  <div className={s.agentStepBody}>
                    <div className={s.agentStepName}>
                      {agent.label}
                      {st === "running" && <span style={{ color: "var(--primary)", fontSize: 12, fontWeight: 400 }}>분석 중…</span>}
                    </div>
                    <div className={s.agentStepDesc}>{agent.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {runState === "done" && result && (
        <>
          {isMock && (
            <div className={s.mockBadge}>
              ⚠ ANTHROPIC_API_KEY 미설정 — 미리보기(mock) 데이터입니다.&nbsp;
              <a href="/settings" style={{ color: "inherit", textDecoration: "underline" }}>설정에서 키 입력 →</a>
            </div>
          )}

          {/* Score */}
          <div className={s.scoreSection}>
            <ScoreGauge score={result.data.feasibility_score} />
            <div className={s.scoreInfo}>
              <div className={`${s.verdictBadge} ${verdictClass}`}>
                {result.data.verdict === "go" ? "✓" : result.data.verdict === "conditional" ? "△" : "✗"}&nbsp;{verdictLabel}
              </div>
              <div className={s.scoreMessage}>{result.data.summary}</div>
              <button className={s.btnRetry} onClick={() => setRunState("idle")}>↺ 다시 분석</button>
            </div>
          </div>

          {/* USP */}
          <div className={s.section}>
            <div className={s.sectionTitle}><span className={s.sectionIcon}>⭐</span> 핵심 USP ({result.data.usp.length}개)</div>
            <div className={s.uspGrid}>
              {result.data.usp.map((u, i) => (
                <div key={i} className={s.uspItem}>
                  <span className={s.uspNum}>U{i + 1}</span>
                  <span className={s.uspText}>{u}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Market analysis */}
          <div className={s.section}>
            <div className={s.sectionTitle}><span className={s.sectionIcon}>📊</span> 시장 분석</div>
            <div className={s.positioning}>{result.data.market_analysis.positioning}</div>
            <div className={s.keywords} style={{ marginTop: 12 }}>
              {result.data.market_analysis.trend_keywords.map((k) => (
                <span key={k} className={s.keyword}># {k}</span>
              ))}
            </div>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>경쟁작</th>
                  <th>강점</th>
                  <th>약점</th>
                  <th style={{ color: "var(--phase-2-color)" }}>우리의 차별점</th>
                </tr>
              </thead>
              <tbody>
                {result.data.market_analysis.competitors.map((c, i) => (
                  <tr key={i}>
                    <td><span className={s.competitorTitle}>{c.title}</span></td>
                    <td>{c.strength}</td>
                    <td>{c.weakness}</td>
                    <td><span className={s.edge}>{c.our_edge}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Agent notes */}
          <div className={s.section}>
            <div className={s.sectionTitle}><span className={s.sectionIcon}>🤖</span> 에이전트 노트</div>
            <div className={s.notesList}>
              {Object.entries(result.data.agent_notes).map(([agent, note]) => (
                <div key={agent} className={s.noteItem}>
                  <div className={s.noteAgent}>{AGENTS.find((a) => a.id === agent)?.label ?? agent}</div>
                  <div className={s.noteText}>{note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Gating */}
          {result.gating_passed ? (
            <div className={s.gatingBanner}>
              <div className={s.gatingText}>
                <h3>✓ GATING 통과 — Phase 2 진행 가능</h3>
                <p>실현가능성 점수 {Math.round(result.data.feasibility_score * 100)}% · 기준 50% 이상 충족<br />Phase 2에서 세계관 설계와 캐릭터/배경 A/B 디자인을 진행합니다.</p>
              </div>
              <button className={s.btnGating} onClick={handleGating}>
                Phase 2 시작 →
              </button>
            </div>
          ) : (
            <div className={s.gatingBlockBanner}>
              ✗ GATING 미충족 — 실현가능성 점수 {Math.round(result.data.feasibility_score * 100)}%가 기준(50%) 미만입니다.
              아이디어를 보완한 후 다시 분석해주세요.
            </div>
          )}
        </>
      )}

      {/* Error */}
      {runState === "error" && (
        <div className={s.errorBox}>
          <span className={s.errorIcon}>⚠</span>
          <div>
            <div className={s.errorTitle}>분석 실패</div>
            <div className={s.errorMsg}>{errorMsg || "API 서버에 연결할 수 없습니다."}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
