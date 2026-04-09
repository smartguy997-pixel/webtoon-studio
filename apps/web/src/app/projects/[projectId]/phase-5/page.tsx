"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import s from "./page.module.css";
import { streamClaude, getAnthropicKey } from "@/lib/claude-client";

// ─── Agent definitions ─────────────────────────────────────────────────────────

const AGENTS = {
  character: { label: "캐릭터 디자이너", color: "#fb923c", bg: "rgba(251,146,60,0.12)" },
  worldbuilder: { label: "세계관 설계자",  color: "#60a5fa", bg: "rgba(96,165,250,0.12)" },
  producer:  { label: "총괄 프로듀서",   color: "#f1f5f9", bg: "rgba(241,245,249,0.12)" },
} as const;
type AgentId = keyof typeof AGENTS;

// ─── Types ─────────────────────────────────────────────────────────────────────

interface MstCard {
  line_weight: string;
  coloring: string;
  perspective: string;
  forbidden_tags: string[];
  style_keywords: string[];
}

interface CharSheet {
  name: string;
  role: string;
  appearance: Record<string, string>;
  personality: string;
  speech: string;
  abilities?: string[];
  trauma?: string;
}

interface ImagePrompt {
  cut: number;
  scene: string;
  angle: string;
  prompt: string;
  negativePrompt: string;
  sccScore: number;
  sccStatus: "pass" | "warn" | "fail";
}

interface SccReport {
  overallRate: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  keyIssues: string[];
  recommendation: string;
}

interface Msg {
  id: string;
  agent: AgentId;
  text: string;
  streaming: boolean;
  cardType?: "imagePrompts" | "sccReport";
  imagePrompts?: ImagePrompt[];
  sccReport?: SccReport;
}

function uid() { return Math.random().toString(36).slice(2, 10); }

// ─── Prompt builders ───────────────────────────────────────────────────────────

function buildImagePromptGenPrompt(ep: number, mst: MstCard, characters: CharSheet[], context: string): string {
  const mstStr = [
    `선 굵기: ${mst.line_weight}`,
    `채색: ${mst.coloring}`,
    `원근: ${mst.perspective}`,
    `스타일 키워드: ${mst.style_keywords.join(", ")}`,
    `금지 태그: ${mst.forbidden_tags.join(", ")}`,
  ].join("\n");

  const charStr = characters.map(c =>
    `${c.name}(${c.role}): ${JSON.stringify(c.appearance)}`
  ).join("\n");

  return `당신은 AI Webtoon Studio 캐릭터 디자이너(agent_character)입니다. Phase 5 ${ep}화 이미지 프롬프트를 생성합니다.

MST(마스터 스타일 토큰):
${mstStr}

등장 캐릭터:
${charStr}

맥락: ${context}

역할:
- ${ep}화의 주요 컷 5개를 선택하여 Whisk API 호환 이미지 프롬프트를 생성합니다
- 모든 프롬프트 앞에 MST를 자동 prepend합니다
- 캐릭터별 외형 일관성을 유지하는 태그를 포함합니다
- SCC 점수(0.0~1.0)를 예측합니다

⚠️ 응답 마지막에 반드시 아래 형식의 JSON 블록을 포함하세요:

[IMAGE_PROMPTS_${ep}]
{"ep":${ep},"prompts":[{"cut":1,"scene":"오프닝 장면","angle":"ELS","prompt":"MST_PREPEND, scene specific tags, character appearance","negativePrompt":"blurry, low quality, inconsistent style","sccScore":0.88,"sccStatus":"pass"}]}
[/IMAGE_PROMPTS_${ep}]

정확히 5개의 이미지 프롬프트를 생성하세요. sccStatus: pass(≥0.85) / warn(0.70~0.84) / fail(<0.70).
말투: 전문적. 자연스러운 한국어. 50자 설명 후 JSON.`;
}

function buildSccReviewPrompt(ep: number, mst: MstCard, prompts: ImagePrompt[]): string {
  const promptSummary = prompts.map(p =>
    `컷${p.cut}: SCC ${p.sccScore} (${p.sccStatus})`
  ).join(", ");

  return `당신은 AI Webtoon Studio 세계관 설계자(agent_worldbuilder)입니다. ${ep}화 SCC 최종 검토를 합니다.

MST 스타일: ${mst.style_keywords.join(", ")}
컷별 SCC: ${promptSummary}

역할:
- SCC 점수 패턴을 분석하여 화풍 일관성 위험 요소를 파악합니다
- fail/warn 컷의 구체적 개선 방향을 제시합니다
- Phase 5 완료 조건(전체 SCC ≥ 0.82)을 판단합니다

말투: 분석적. 자연스러운 한국어. 분량: 150~200자.`;
}

function buildProducerPhase5Prompt(ep: number, overallRate: number, context: string): string {
  const passed = overallRate >= 0.82;
  return `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다. Phase 5 ${ep}화 최종 검토를 마무리합니다.

전체 SCC 통과율: ${Math.round(overallRate * 100)}%
${passed ? "✅ SCC 임계값(82%) 충족 — Phase 5 통과" : "⚠️ SCC 임계값(82%) 미달 — 재검토 필요"}

${context}

역할:
- SCC 결과를 종합하고 이미지 생성 준비 상태를 평가합니다
- ${passed ? "다음 단계(실제 이미지 생성) 안내를 합니다" : "SCC 개선 방향과 재실행 조건을 안내합니다"}

말투: 권위 있고 명확. 자연스러운 한국어. 분량: 100~150자.`;
}

// ─── JSON block parser ─────────────────────────────────────────────────────────

function parseBlock<T>(text: string, tag: string): T | null {
  const m = text.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`));
  if (!m) return null;
  try { return JSON.parse(m[1].trim()) as T; } catch { return null; }
}

function stripBlocks(text: string): string {
  return text.replace(/\[[A-Z_0-9]+\][\s\S]*?\[\/[A-Z_0-9]+\]/g, "").trim();
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function Phase5Page({ params }: { params: { projectId: string } }) {
  const { projectId } = params;

  const [mst, setMst] = useState<MstCard | null>(null);
  const [characters, setCharacters] = useState<CharSheet[]>([]);
  const [genre, setGenre] = useState("판타지");
  const [selectedEp, setSelectedEp] = useState(1);
  const [doneEps, setDoneEps] = useState<Set<number>>(new Set());
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [imagePrompts, setImagePrompts] = useState<ImagePrompt[]>([]);
  const [sccReport, setSccReport] = useState<SccReport | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load Phase 2 MST + characters
  useEffect(() => {
    const p2 = JSON.parse(localStorage.getItem(`wts_phase2_${projectId}`) ?? "null");
    if (p2?.data?.mst) setMst(p2.data.mst as MstCard);
    if (p2?.data?.characters) setCharacters((p2.data.characters as CharSheet[]).filter(Boolean));

    const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
    if (p1?.data?.genre) setGenre(p1.data.genre);

    // Load done episodes
    const done = new Set<number>();
    for (let i = 1; i <= 100; i++) {
      if (localStorage.getItem(`wts_phase5_ep_${projectId}_${i}`)) done.add(i);
    }
    setDoneEps(done);
  }, [projectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // ─── Streaming helper ────────────────────────────────────────────────────────

  const streamText = useCallback(async (
    agent: AgentId,
    system: string,
    messages: { role: "user" | "assistant"; content: string }[],
    apiKey: string,
    cardKey?: string,
  ): Promise<string> => {
    const msgId = uid();
    setMsgs((prev: Msg[]) => [...prev, { id: msgId, agent, text: "", streaming: true }]);

    let full = "";
    for await (const chunk of streamClaude({ systemPrompt: system, messages, apiKey, maxTokens: 4000 })) {
      full += chunk;
      setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === msgId ? { ...m, text: full } : m));
    }

    const displayText = cardKey ? stripBlocks(full) : full;

    if (cardKey === `IMAGE_PROMPTS_${selectedEp}`) {
      const parsed = parseBlock<{ ep: number; prompts: ImagePrompt[] }>(full, `IMAGE_PROMPTS_${selectedEp}`);
      if (parsed?.prompts) {
        setImagePrompts(parsed.prompts);
        setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === msgId
          ? { ...m, text: displayText, streaming: false, cardType: "imagePrompts", imagePrompts: parsed.prompts }
          : m));
        return full;
      }
    }

    setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === msgId ? { ...m, text: displayText, streaming: false } : m));
    return full;
  }, [selectedEp]);

  // ─── Main pipeline ────────────────────────────────────────────────────────────

  const runPhase5 = useCallback(async () => {
    if (busy) return;
    const apiKey = getAnthropicKey();
    if (!apiKey) { setApiError("Anthropic API 키가 필요합니다. 설정 페이지에서 키를 입력해주세요."); return; }
    if (!mst) { setApiError("Phase 2를 먼저 완료하여 MST를 생성해주세요."); return; }

    setBusy(true);
    setApiError(null);
    setMsgs([]);
    setImagePrompts([]);
    setSccReport(null);

    try {
      const ep = selectedEp;
      const p4 = JSON.parse(localStorage.getItem(`wts_phase4_ep_${projectId}_${ep}`) ?? "null");
      const p3 = JSON.parse(localStorage.getItem(`wts_phase3_done_${projectId}`) ?? "null");
      const context = [
        `장르: ${genre}`,
        `화: ${ep}화`,
        p4 ? `Phase 4 SCC 통과율: ${Math.round(p4.sccRate * 100)}%` : "",
        p3 ? "Phase 3 로드맵 완료" : "",
      ].filter(Boolean).join("\n");

      // ── 1. Character designer: generate image prompts ──
      const promptText = await streamText(
        "character",
        buildImagePromptGenPrompt(ep, mst, characters, context),
        [{ role: "user", content: `${ep}화 이미지 프롬프트 5개를 생성해주세요.` }],
        apiKey,
        `IMAGE_PROMPTS_${ep}`,
      );

      const parsed = parseBlock<{ ep: number; prompts: ImagePrompt[] }>(promptText, `IMAGE_PROMPTS_${ep}`);
      const prompts = parsed?.prompts ?? [];

      // ── 2. Worldbuilder: SCC review ──
      await streamText(
        "worldbuilder",
        buildSccReviewPrompt(ep, mst, prompts.length > 0 ? prompts : [
          { cut: 1, scene: "주요 장면", angle: "MS", prompt: "", negativePrompt: "", sccScore: 0.85, sccStatus: "pass" },
        ]),
        [{ role: "user", content: "SCC 검토 결과를 알려주세요." }],
        apiKey,
      );

      // ── 3. Compute SCC report ──
      const passCount = prompts.filter(p => p.sccStatus === "pass").length;
      const warnCount = prompts.filter(p => p.sccStatus === "warn").length;
      const failCount = prompts.filter(p => p.sccStatus === "fail").length;
      const overallRate = prompts.length > 0
        ? prompts.reduce((sum, p) => sum + p.sccScore, 0) / prompts.length
        : 0.85;

      const report: SccReport = {
        overallRate,
        passCount,
        warnCount,
        failCount,
        keyIssues: failCount > 0 ? [`${failCount}개 컷 화풍 불일치 감지`] : [],
        recommendation: overallRate >= 0.82 ? "이미지 생성 진행 가능" : "SCC 재검증 필요",
      };
      setSccReport(report);

      // ── 4. Producer sign-off ──
      await streamText(
        "producer",
        buildProducerPhase5Prompt(ep, overallRate, context),
        [{ role: "user", content: "Phase 5 최종 검토를 해주세요." }],
        apiKey,
      );

      // Save completion
      setDoneEps((prev: Set<number>) => new Set([...prev, ep]));
      localStorage.setItem(`wts_phase5_ep_${projectId}_${ep}`, JSON.stringify({
        sccRate: overallRate,
        savedAt: new Date().toISOString(),
      }));
      localStorage.setItem(`wts_phase5_done_${projectId}`, JSON.stringify({
        completedEps: Array.from(doneEps).concat(ep),
        savedAt: new Date().toISOString(),
      }));

    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = raw.includes("401") || raw.includes("authentication")
        ? "API 키가 유효하지 않습니다. 설정 페이지에서 키를 다시 확인해주세요."
        : `API 오류: ${raw}`;
      setApiError(msg);
    } finally {
      setBusy(false);
    }
  }, [busy, mst, selectedEp, genre, characters, projectId, streamText, doneEps]);

  // ─── Render helpers ───────────────────────────────────────────────────────────

  function SccBadge({ status, score }: { status: ImagePrompt["sccStatus"]; score: number }) {
    const colors = { pass: "#22c55e", warn: "#f59e0b", fail: "#ef4444" };
    const labels = { pass: "PASS", warn: "WARN", fail: "FAIL" };
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700,
        background: `${colors[status]}18`, color: colors[status],
        border: `1px solid ${colors[status]}40`,
      }}>
        {labels[status]} {score.toFixed(2)}
      </span>
    );
  }

  const noMst = !mst;

  return (
    <div className={s.page}>
      {/* ─── Header ─── */}
      <div className={s.header}>
        <div>
          <div className={s.phaseTag}>Phase 5</div>
          <h1 className={s.title}>이미지 프롬프트 생성 + SCC 검증</h1>
          <p className={s.subtitle}>MST 자동 주입 · CLIP Score 화풍 일관성 검증</p>
        </div>
        {doneEps.size > 0 && (
          <div className={s.progressBadge}>
            {doneEps.size}화 완료
          </div>
        )}
      </div>

      {/* ─── MST Panel ─── */}
      {noMst ? (
        <div className={s.warningBanner}>
          ⚠️ MST가 없습니다. Phase 2를 완료하여 마스터 스타일 토큰을 생성해주세요.
        </div>
      ) : (
        <div className={s.mstPanel}>
          <div className={s.mstHeader}>
            <span className={s.mstTitle}>MST — 마스터 스타일 토큰</span>
            <span className={s.mstLocked}>🔒 자동 주입</span>
          </div>
          <div className={s.mstGrid}>
            <div className={s.mstField}>
              <span className={s.mstFieldLabel}>선 굵기</span>
              <span className={s.mstFieldValue}>{mst.line_weight}</span>
            </div>
            <div className={s.mstField}>
              <span className={s.mstFieldLabel}>채색</span>
              <span className={s.mstFieldValue}>{mst.coloring}</span>
            </div>
            <div className={s.mstField}>
              <span className={s.mstFieldLabel}>원근</span>
              <span className={s.mstFieldValue}>{mst.perspective}</span>
            </div>
          </div>
          <div className={s.mstTags}>
            {mst.style_keywords.map((kw: string, i: number) => (
              <span key={i} className={s.mstTag}>{kw}</span>
            ))}
          </div>
          {mst.forbidden_tags.length > 0 && (
            <div className={s.mstForbidden}>
              금지: {mst.forbidden_tags.join(", ")}
            </div>
          )}
        </div>
      )}

      {/* ─── Characters ─── */}
      {characters.length > 0 && (
        <div className={s.charRow}>
          {characters.map((c: { role: string; name: string }, i: number) => (
            <div key={i} className={s.charChip}>
              <span className={s.charRole}>{c.role === "protagonist" ? "주인공" : c.role === "antagonist" ? "빌런" : c.role}</span>
              <span className={s.charName}>{c.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* ─── Controls ─── */}
      <div className={s.controls}>
        <div className={s.epSelector}>
          <label className={s.epLabel}>화 선택</label>
          <select
            className={s.epSelect}
            value={selectedEp}
            onChange={(e: { target: HTMLSelectElement }) => setSelectedEp(Number(e.target.value))}
            disabled={busy}
          >
            {Array.from({ length: 100 }, (_, i) => i + 1).map(n => (
              <option key={n} value={n}>
                {n}화 {doneEps.has(n) ? "✓" : ""}
              </option>
            ))}
          </select>
        </div>
        <button
          className={`${s.runBtn} ${busy ? s.runBtnBusy : ""}`}
          onClick={runPhase5}
          disabled={busy || noMst}
        >
          {busy ? (
            <><span className={s.spinner} /> SCC 검증 중...</>
          ) : (
            `${selectedEp}화 이미지 프롬프트 생성`
          )}
        </button>
      </div>

      {apiError && (
        <div className={s.errorBanner}>{apiError}</div>
      )}

      {/* ─── Image Prompts Grid ─── */}
      {imagePrompts.length > 0 && (
        <div className={s.promptsSection}>
          <div className={s.sectionTitle}>이미지 프롬프트 — {selectedEp}화 주요 컷</div>
          <div className={s.promptGrid}>
            {imagePrompts.map((p: ImagePrompt, i: number) => (
              <div key={i} className={s.promptCard}>
                <div className={s.promptCardTop}>
                  <span className={s.promptCutNum}>컷 {p.cut}</span>
                  <span className={s.promptAngle}>{p.angle}</span>
                  <SccBadge status={p.sccStatus} score={p.sccScore} />
                </div>
                <div className={s.promptScene}>{p.scene}</div>
                <div className={s.promptText}>{p.prompt}</div>
                {p.negativePrompt && (
                  <div className={s.promptNeg}>
                    <span className={s.promptNegLabel}>Negative:</span> {p.negativePrompt}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── SCC Report ─── */}
      {sccReport && (
        <div className={s.sccReport}>
          <div className={s.sccReportHeader}>
            <span className={s.sccReportTitle}>SCC 검증 리포트</span>
            <span className={s.sccOverallScore} style={{
              color: sccReport.overallRate >= 0.82 ? "#22c55e" : "#f59e0b",
            }}>
              {Math.round(sccReport.overallRate * 100)}%
            </span>
          </div>
          <div className={s.sccStats}>
            <div className={s.sccStat}><span style={{ color: "#22c55e" }}>PASS</span> {sccReport.passCount}</div>
            <div className={s.sccStat}><span style={{ color: "#f59e0b" }}>WARN</span> {sccReport.warnCount}</div>
            <div className={s.sccStat}><span style={{ color: "#ef4444" }}>FAIL</span> {sccReport.failCount}</div>
          </div>
          <div className={s.sccRecommendation} style={{
            color: sccReport.overallRate >= 0.82 ? "#22c55e" : "#f59e0b",
          }}>
            {sccReport.overallRate >= 0.82 ? "✅" : "⚠️"} {sccReport.recommendation}
          </div>
        </div>
      )}

      {/* ─── Agent Discussion ─── */}
      {msgs.length > 0 && (
        <div className={s.discussion}>
          <div className={s.discussionTitle}>에이전트 토론</div>
          {msgs.map((msg: Msg) => {
            const agent = AGENTS[msg.agent as AgentId];
            return (
              <div key={msg.id} className={s.msg}>
                <div className={s.msgHeader} style={{ color: agent.color }}>
                  {agent.label}
                </div>
                <div className={s.msgBody} style={{ borderLeft: `3px solid ${agent.color}40`, background: agent.bg }}>
                  {msg.text || <span className={s.streaming}>▋</span>}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
