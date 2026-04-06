"use client";

import { useState, useEffect } from "react";
import s from "./page.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

// ── Types ─────────────────────────────────────────────────
type SccStatus = "pass" | "warn" | "fail" | "pending";

interface Cut {
  cut: number;
  panel_type: "wide" | "medium" | "close" | "extreme_close" | "overhead";
  description: string;
  dialogue: string;
  camera: string;
  emotion: string;
  scc_status: SccStatus;
}

interface Phase4Data {
  episode: number;
  title: string;
  cuts: Cut[];
  scc_pass_rate: number;
}

interface SavedEpisode {
  data: Phase4Data;
  isMock: boolean;
  savedAt: string;
}

type RunState = "idle" | "running" | "done";
type AgentStatus = "idle" | "running" | "done";

const AGENTS = [
  { id: "script",    label: "대본/연출 작가",  desc: "30컷 콘티 · 대사 · 카메라 지시 작성" },
  { id: "character", label: "캐릭터 디자이너", desc: "캐릭터 등장 컷 SCC 검증" },
  { id: "producer",  label: "총괄 프로듀서",   desc: "완성도 검토 · 최종 승인" },
];

const PANEL_LABELS: Record<string, string> = {
  wide: "와이드", medium: "미디엄", close: "클로즈업",
  extreme_close: "극클로즈", overhead: "오버헤드",
};

const EMOTION_EMOJIS: Record<string, string> = {
  "긴장": "😤", "슬픔": "😢", "기쁨": "😊", "분노": "😠", "놀람": "😲",
  "평온": "😌", "공포": "😱", "설렘": "💓", "결의": "💪", "혼란": "😵",
};

// ── Mock generator ────────────────────────────────────────
function buildMockEpisode(ep: number, genre: string): Phase4Data {
  const panelTypes: Cut["panel_type"][] = [
    "wide","medium","close","medium","close",
    "extreme_close","wide","medium","close","overhead",
    "medium","close","wide","medium","close",
    "extreme_close","medium","close","medium","wide",
    "close","medium","extreme_close","wide","close",
    "medium","close","medium","wide","extreme_close",
  ];

  const emotionsByGenre: Record<string, string[]> = {
    "판타지": ["평온","긴장","결의","놀람","긴장","분노","결의","긴장","놀람","결의"],
    "로맨스": ["설렘","평온","설렘","긴장","슬픔","긴장","설렘","혼란","설렘","기쁨"],
    "액션":   ["긴장","분노","결의","긴장","분노","놀람","결의","긴장","분노","결의"],
    "스릴러": ["공포","긴장","혼란","공포","긴장","놀람","공포","긴장","혼란","공포"],
  };
  const emotions = emotionsByGenre[genre] ?? ["평온","긴장","결의","놀람","긴장","분노","결의","기쁨","설렘","혼란"];

  const descTemplates = [
    "인물이 {장소}에 들어서며 주변을 살핀다.",
    "카메라가 천천히 {인물}의 표정을 클로즈업한다.",
    "두 인물이 마주보며 긴 침묵이 흐른다.",
    "갑작스러운 {사건}에 모두가 굳어버린다.",
    "{인물}이 결심한 듯 앞으로 나아간다.",
    "배경 전체가 드러나는 풀샷으로 전환된다.",
    "감정이 폭발하며 {인물}이 소리친다.",
    "조용한 순간, {인물}의 눈빛이 흔들린다.",
    "예상치 못한 {사건}이 분위기를 뒤집는다.",
    "마지막 컷, 여운을 남기는 롱샷으로 마무리된다.",
  ];

  const dialogueTemplates = [
    `"지금 여기서 물러설 수 없어."`,
    `"그게 사실이야...?"`,
    `(말 없이 눈을 마주친다)`,
    `"처음부터 알고 있었어."`,
    `"내가 반드시 지켜낼게."`,
    `(내레이션) 그날의 선택이 모든 걸 바꿨다.`,
    `"너는 아무것도 모르잖아!"`,
    `"...미안해."`,
    `(소리 없이 고개를 끄덕인다)`,
    `"이제 시작이야."`,
  ];

  const places = ["폐허", "숲 속", "도시 한복판", "지하 통로", "옥상"];
  const events = ["폭발", "배신", "각성", "만남", "이별"];
  const chars = ["주인공", "라이벌", "조력자", "빌런"];

  const sccStatuses: SccStatus[] = ["pass","pass","pass","pass","pass","pass","warn","pass","pass","pass",
                                     "pass","pass","warn","pass","pass","pass","pass","pass","pass","pass",
                                     "pass","fail","pass","pass","pass","pass","pass","pass","pass","pass"];

  const cuts: Cut[] = Array.from({ length: 30 }, (_, i) => {
    const cut = i + 1;
    const place = places[cut % places.length];
    const event = events[cut % events.length];
    const char  = chars[cut % chars.length];
    const descRaw = descTemplates[cut % descTemplates.length]
      .replace("{장소}", place).replace("{사건}", event).replace("{인물}", char);
    return {
      cut,
      panel_type: panelTypes[i],
      description: `[컷 ${cut}] ${descRaw}`,
      dialogue: dialogueTemplates[cut % dialogueTemplates.length],
      camera: `${PANEL_LABELS[panelTypes[i]]} / ${["정면","사선","측면","배면"][cut%4]} / ${["자연광","인공조명","역광","실루엣"][cut%4]}`,
      emotion: emotions[cut % emotions.length],
      scc_status: sccStatuses[i],
    };
  });

  const passCount = cuts.filter(c => c.scc_status === "pass").length;

  return {
    episode: ep,
    title: `${ep}화 — ${["각성", "시련", "선택", "반전", "결전"][ep % 5]}`,
    cuts,
    scc_pass_rate: parseFloat((passCount / 30).toFixed(2)),
  };
}

// ── Storage ───────────────────────────────────────────────
function loadEpisode(projectId: string, ep: number): SavedEpisode | null {
  try { return JSON.parse(localStorage.getItem(`wts_phase4_${projectId}_ep${ep}`) ?? "null"); } catch { return null; }
}
function saveEpisode(projectId: string, ep: number, r: SavedEpisode) {
  localStorage.setItem(`wts_phase4_${projectId}_ep${ep}`, JSON.stringify(r));
}

// ── SCC badge ─────────────────────────────────────────────
function SccBadge({ status }: { status: SccStatus }) {
  const map = {
    pass:    { label: "SCC ✓",  cls: s.sccPass },
    warn:    { label: "SCC △",  cls: s.sccWarn },
    fail:    { label: "SCC ✗",  cls: s.sccFail },
    pending: { label: "SCC —",  cls: s.sccPending },
  };
  const { label, cls } = map[status];
  return <span className={`${s.sccBadge} ${cls}`}>{label}</span>;
}

// ── Page ──────────────────────────────────────────────────
export default function Phase4Page({ params }: { params: { projectId: string } }) {
  const { projectId } = params;

  const [selectedEp, setSelectedEp]   = useState(1);
  const [runState, setRunState]       = useState<RunState>("idle");
  const [agentStates, setAgentStates] = useState<AgentStatus[]>(["idle","idle","idle"]);
  const [result, setResult]           = useState<SavedEpisode | null>(null);
  const [isMock, setIsMock]           = useState(false);
  const [genre, setGenre]             = useState("판타지");
  const [expandedCut, setExpandedCut] = useState<number | null>(null);

  useEffect(() => {
    const saved = loadEpisode(projectId, selectedEp);
    if (saved) { setResult(saved); setRunState("done"); setIsMock(saved.isMock); }
    else { setResult(null); setRunState("idle"); }

    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.genre) setGenre(p1.input.genre);
    } catch {}
  }, [projectId, selectedEp]);

  function setAgent(i: number, st: AgentStatus) {
    setAgentStates(prev => prev.map((v, idx) => idx === i ? st : v));
  }

  async function runScript() {
    setRunState("running");
    setAgentStates(["idle","idle","idle"]);
    setResult(null);

    const key = localStorage.getItem("wts_anthropic_key") ?? "";
    let useMock = !key;

    if (!useMock) {
      try {
        for (let i = 0; i < 3; i++) {
          setAgent(i, "running"); await delay(600 + i * 300); setAgent(i, "done");
        }
        const res = await fetch(`${API_BASE}/api/phases/${projectId}/phase-4`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Anthropic-Key": key },
          body: JSON.stringify({ episode: selectedEp }),
          signal: AbortSignal.timeout(90000),
        });
        if (!res.ok) throw new Error();
        const json = await res.json();
        const saved: SavedEpisode = { data: json.data, isMock: false, savedAt: new Date().toISOString() };
        saveEpisode(projectId, selectedEp, saved);
        setResult(saved); setRunState("done"); return;
      } catch { useMock = true; setAgentStates(["idle","idle","idle"]); }
    }

    setIsMock(true);
    for (let i = 0; i < AGENTS.length; i++) {
      setAgent(i, "running"); await delay(700 + i * 300); setAgent(i, "done");
    }

    const mockData = buildMockEpisode(selectedEp, genre);
    const saved: SavedEpisode = { data: mockData, isMock: true, savedAt: new Date().toISOString() };
    saveEpisode(projectId, selectedEp, saved);
    setResult(saved); setRunState("done");
  }

  const passCount = result?.data.cuts.filter(c => c.scc_status === "pass").length ?? 0;
  const totalCuts = result?.data.cuts.length ?? 30;

  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>Phase 4 — 30컷 제작 대본</h1>
      <p className={s.pageDesc}>화별 30컷 콘티 · 대사 · 카메라 지시 · SCC 검증을 AI가 자동 생성합니다.</p>

      {/* Episode selector */}
      <div className={s.epSelector}>
        <div className={s.epSelectorLabel}>화 선택</div>
        <div className={s.epSelectorRow}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map(ep => {
            const hasData = typeof window !== "undefined" && !!localStorage.getItem(`wts_phase4_${projectId}_ep${ep}`);
            return (
              <button
                key={ep}
                className={`${s.epBtn} ${selectedEp === ep ? s.epBtnActive : ""} ${hasData ? s.epBtnDone : ""}`}
                onClick={() => setSelectedEp(ep)}
              >
                {ep}화
                {hasData && <span className={s.epDoneDot} />}
              </button>
            );
          })}
          <span className={s.epMore}>… 100화까지</span>
        </div>
      </div>

      {/* Run card */}
      {runState === "idle" && (
        <div className={s.startCard}>
          <div className={s.startIcon}>✏️</div>
          <div className={s.startBody}>
            <div className={s.startTitle}>{selectedEp}화 대본 생성</div>
            <div className={s.startDesc}>3인의 AI 에이전트가 {selectedEp}화 30컷 콘티 · 대사 · 연출 지시를 자동 작성하고 SCC 검증을 수행합니다.</div>
          </div>
          <button className={s.btnRun} onClick={runScript}>✦ {selectedEp}화 대본 생성</button>
        </div>
      )}

      {/* Agent progress */}
      {runState === "running" && (
        <div className={s.progress}>
          <div className={s.progressTitle}>에이전트 실행 중 — {selectedEp}화</div>
          <div className={s.agentSteps}>
            {AGENTS.map((agent, i) => {
              const st = agentStates[i];
              return (
                <div key={agent.id} className={`${s.agentStep} ${st==="done"?s.stepDone:""} ${st==="running"?s.stepActive:""}`}>
                  <div className={s.agentStepIcon}>
                    {st==="done" ? "✓" : st==="running" ? <div className={s.spinnerDot}><span/><span/><span/></div> : i+1}
                  </div>
                  <div className={s.agentStepBody}>
                    <div className={s.agentStepName}>
                      {agent.label}
                      {st==="running" && <span className={s.runningLabel}>작업 중…</span>}
                    </div>
                    <div className={s.agentStepDesc}>{agent.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Results */}
      {runState === "done" && result && (
        <>
          {isMock && (
            <div className={s.mockBadge}>
              ⚠ ANTHROPIC_API_KEY 미설정 — 미리보기(mock) 데이터입니다.&nbsp;
              <a href="/settings">설정에서 키 입력 →</a>
            </div>
          )}

          {/* Episode header */}
          <div className={s.epHeader}>
            <div className={s.epHeaderLeft}>
              <div className={s.epHeaderTitle}>{result.data.title}</div>
              <div className={s.epHeaderMeta}>총 {totalCuts}컷 · SCC 통과 {passCount}/{totalCuts}</div>
            </div>
            <div className={s.sccSummary}>
              <div className={s.sccBar}>
                <div className={s.sccBarFill} style={{ width: `${(passCount / totalCuts) * 100}%` }} />
              </div>
              <div className={s.sccRate}>{Math.round((passCount / totalCuts) * 100)}%</div>
            </div>
            <button className={s.btnRetry} onClick={() => setRunState("idle")}>↺ 재생성</button>
          </div>

          {/* Cut cards */}
          <div className={s.cutGrid}>
            {result.data.cuts.map(cut => (
              <div
                key={cut.cut}
                className={`${s.cutCard} ${cut.scc_status === "fail" ? s.cutFail : cut.scc_status === "warn" ? s.cutWarn : ""}`}
                onClick={() => setExpandedCut(expandedCut === cut.cut ? null : cut.cut)}
              >
                {/* Card header */}
                <div className={s.cutCardHeader}>
                  <span className={s.cutNum}>컷 {cut.cut}</span>
                  <span className={s.panelType}>{PANEL_LABELS[cut.panel_type]}</span>
                  <span className={s.emotion}>{EMOTION_EMOJIS[cut.emotion] ?? "😐"} {cut.emotion}</span>
                  <SccBadge status={cut.scc_status} />
                </div>

                {/* Image placeholder */}
                <div className={s.cutImage}>
                  <div className={s.cutImagePlaceholder}>
                    <div className={s.cutImageIcon}>🎬</div>
                    <div className={s.cutImageLabel}>{PANEL_LABELS[cut.panel_type]}</div>
                  </div>
                </div>

                {/* Description */}
                <div className={s.cutDesc}>{cut.description}</div>

                {/* Expanded detail */}
                {expandedCut === cut.cut && (
                  <div className={s.cutDetail}>
                    <div className={s.cutDetailRow}>
                      <span className={s.cutDetailLabel}>대사</span>
                      <span className={s.cutDetailValue}>{cut.dialogue}</span>
                    </div>
                    <div className={s.cutDetailRow}>
                      <span className={s.cutDetailLabel}>카메라</span>
                      <span className={s.cutDetailValue}>{cut.camera}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Gating */}
          {passCount >= 27 ? (
            <div className={s.gatingBanner}>
              <div className={s.gatingText}>
                <h3>✓ SCC 검증 통과 — 다음 화 진행 가능</h3>
                <p>SCC 통과율 {Math.round((passCount/totalCuts)*100)}% · 기준 90% 이상 충족<br/>다음 화 대본을 생성하거나 이미지 생성(Phase 5)을 시작합니다.</p>
              </div>
              <button className={s.btnGating} onClick={() => setSelectedEp(prev => Math.min(prev + 1, 100))}>
                {selectedEp + 1}화 대본 →
              </button>
            </div>
          ) : (
            <div className={s.gatingBlock}>
              ✗ SCC 검증 미통과 — 통과율 {Math.round((passCount/totalCuts)*100)}%가 기준(90%) 미만입니다. 재생성하거나 컷을 수정해주세요.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }
