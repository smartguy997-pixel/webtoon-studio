"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { streamClaude, getAnthropicKey } from "@/lib/claude-client";

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = {
  strategist:   { label: "전략 기획자",    color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  researcher:   { label: "심층 조사자",    color: "#34d399", bg: "rgba(52,211,153,0.12)"  },
  worldbuilder: { label: "세계관 설계자",  color: "#60a5fa", bg: "rgba(96,165,250,0.12)"  },
  character:    { label: "캐릭터 디자이너",color: "#fb923c", bg: "rgba(251,146,60,0.12)"  },
  scenario:     { label: "시나리오 작가",  color: "#fbbf24", bg: "rgba(251,191,36,0.12)"  },
  script:       { label: "대본/연출 작가", color: "#f87171", bg: "rgba(248,113,113,0.12)" },
  producer:     { label: "총괄 프로듀서",  color: "#f1f5f9", bg: "rgba(241,245,249,0.12)" },
  user:         { label: "나",             color: "#7c6cfc", bg: "rgba(124,108,252,0.12)" },
} as const;
type AgentId = keyof typeof AGENTS;

// ─── System prompts ───────────────────────────────────────────────────────────

const STRATEGIST_PROMPT = `당신은 K-웹툰 시장 전문 전략 기획자(agent_strategist)입니다. Phase 1 기획 분석 토론에 참여합니다.

역할:
- 네이버 웹툰·카카오페이지·레진코믹스 트렌드를 분석합니다
- 장르 포지셔닝(대중성 vs 마니아, 신규 IP vs 클리셰 재해석)을 평가합니다
- 경쟁작 2~3종을 벤치마크하고 차별화 전략을 도출합니다
- 독자 관점 USP 3~5개를 구체적으로 제시합니다

말투: 전문적이고 논리적. 실제 시장 데이터와 근거를 들어 분석. 자연스러운 한국어.
분량: 250~400자.`;

const RESEARCHER_PROMPT = `당신은 스토리 논리성·현실성 검토 전문 심층 조사자(agent_researcher)입니다. Phase 1 기획 분석 토론에 참여합니다.

역할:
- 기획안의 클리셰·내부 모순을 찾아 건설적으로 지적합니다
- 역사·과학·사회 레퍼런스와의 충돌을 팩트체크합니다
- 전략기획자의 분석을 보완하거나 다른 시각을 제시합니다
- 반드시 건설적 개선 방향·대안을 함께 제안합니다

말투: 분석적이고 날카롭지만 건설적. 단순 비판 금지, 항상 대안 제시. 자연스러운 한국어.
분량: 250~400자.`;

const PRODUCER_SYNTHESIS_PROMPT = `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다. Phase 1 기획 분석 토론을 마무리합니다.

역할:
- 전략기획자와 심층조사자의 의견을 종합하고 갈등을 중재합니다
- Phase 1 최종 실현가능성 평가를 내립니다
- 다음 단계(Phase 2) 진행 여부를 사용자에게 명확히 안내합니다

말투: 권위 있고 명확. 결론 지향. 자연스러운 한국어. 분량: 150~250자.

⚠️ 응답 마지막에 반드시 아래 JSON 블록을 정확히 포함하세요 (다른 텍스트 없이 줄바꿈만):

[PHASE1_RESULT]
{"feasibility_score":0.75,"verdict":"conditional","usp":["USP 예시 1","USP 예시 2","USP 예시 3"],"summary":"100자 이내 요약"}
[/PHASE1_RESULT]

verdict 기준: "go" ≥ 0.70, "conditional" 0.50~0.69, "reject" < 0.50
feasibility_score는 실제 분석에 따라 정직하게 산정하세요.`;

function buildProducerFollowupPrompt(discussionContext: string): string {
  return `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다.

아래는 Phase 1 기획 분석 토론 내역입니다:
---
${discussionContext}
---

역할: 사용자의 추가 질문·의견에 에이전트 팀을 대표하여 명확하고 전문적으로 응답합니다.
필요 시 전략기획자·심층조사자의 관점을 언급하며 종합 의견을 제시하세요.
말투: 친근하지만 전문적. 자연스러운 한국어. 분량: 200~350자.`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Msg {
  id: string;
  agent: AgentId;
  text: string;
  type: "text" | "card";
  streaming: boolean;
  card?: {
    score: number;
    verdict: "go" | "conditional" | "reject";
    usp: string[];
    summary: string;
  };
}

type Stage = "form" | "chat";

const GENRES = ["판타지", "로맨스", "액션", "SF", "스릴러", "일상·힐링", "무협", "스포츠", "공포", "역사"];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/** Parse [PHASE1_RESULT]{...}[/PHASE1_RESULT] from producer text */
function parsePhase1Result(text: string): Msg["card"] | null {
  const match = text.match(/\[PHASE1_RESULT\]\s*([\s\S]*?)\s*\[\/PHASE1_RESULT\]/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[1]);
    const score = Number(raw.feasibility_score ?? raw.score ?? 0.5);
    const verdict: "go" | "conditional" | "reject" =
      score >= 0.7 ? "go" : score >= 0.5 ? "conditional" : "reject";
    return {
      score,
      verdict: raw.verdict ?? verdict,
      usp: Array.isArray(raw.usp) ? raw.usp : [],
      summary: raw.summary ?? "",
    };
  } catch {
    return null;
  }
}

/** Strip the [PHASE1_RESULT] block from display text */
function stripResultBlock(text: string): string {
  return text.replace(/\[PHASE1_RESULT\][\s\S]*?\[\/PHASE1_RESULT\]/g, "").trim();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <span className={styles.thinkingDots}>
      <span className={styles.dot} style={{ animationDelay: "0ms" }} />
      <span className={styles.dot} style={{ animationDelay: "160ms" }} />
      <span className={styles.dot} style={{ animationDelay: "320ms" }} />
    </span>
  );
}

function ResultCard({ card }: { card: NonNullable<Msg["card"]> }) {
  const { score, verdict, usp, summary } = card;
  const pct = Math.round(score * 100);
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (pct / 100) * circumference;
  const verdictLabel =
    verdict === "go" ? "✓ 진행 가능" : verdict === "conditional" ? "△ 조건부 진행" : "✗ 재검토 필요";
  const verdictClass =
    verdict === "go" ? styles.verdictGo : verdict === "conditional" ? styles.verdictConditional : styles.verdictReject;
  const gaugeColor = score >= 0.7 ? "#34d399" : score >= 0.5 ? "#fbbf24" : "#f87171";

  return (
    <div className={styles.resultCard}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        실현가능성 평가
      </div>
      <div className={styles.gaugeWrap}>
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="#2a2a3d" strokeWidth="8" />
          <circle cx="50" cy="50" r="42" fill="none" stroke={gaugeColor} strokeWidth="8"
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
            transform="rotate(-90 50 50)" style={{ transition: "stroke-dashoffset 0.8s ease" }} />
          <text x="50" y="45" textAnchor="middle" fill="#f1f5f9" fontSize="18" fontWeight="700">{pct}</text>
          <text x="50" y="60" textAnchor="middle" fill="#64748b" fontSize="10">점</text>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className={`${styles.verdictBadge} ${verdictClass}`}>{verdictLabel}</div>
          <div style={{ fontSize: 13, color: "#94a3b8", maxWidth: 220, lineHeight: 1.6 }}>{summary}</div>
        </div>
      </div>
      {usp.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            핵심 USP
          </div>
          <ul className={styles.uspList}>
            {usp.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function MsgBubble({ msg }: { msg: Msg }) {
  const agent = AGENTS[msg.agent];
  const isUser = msg.agent === "user";
  const displayText = msg.type === "card" ? stripResultBlock(msg.text) : msg.text;

  return (
    <div className={`${styles.msgRow} ${isUser ? styles.msgRowUser : ""}`}>
      {!isUser && (
        <div className={styles.avatar}
          style={{ background: agent.bg, color: agent.color, border: `1px solid ${agent.color}30` }}>
          {agent.label[0]}
        </div>
      )}
      <div className={styles.msgContent}>
        {!isUser && (
          <span className={styles.agentName} style={{ color: agent.color }}>{agent.label}</span>
        )}
        <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : ""}`}>
          {msg.streaming && !msg.text ? (
            <ThinkingDots />
          ) : msg.type === "card" && msg.card ? (
            <>
              {displayText && (
                <div style={{ marginBottom: 12, whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 14 }}
                  dangerouslySetInnerHTML={{ __html: displayText.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>") }} />
              )}
              <ResultCard card={msg.card} />
            </>
          ) : (
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 14 }}>
              <span dangerouslySetInnerHTML={{ __html: displayText.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>") }} />
              {msg.streaming && <span className={styles.streamCursor} />}
            </div>
          )}
        </div>
      </div>
      {isUser && (
        <div className={styles.avatar}
          style={{ background: agent.bg, color: agent.color, border: `1px solid ${agent.color}30` }}>
          나
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Phase1Page({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("form");
  const [genre, setGenre] = useState("판타지");
  const [concept, setConcept] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [userInput, setUserInput] = useState("");
  const [chatRunning, setChatRunning] = useState(false);
  const [result, setResult] = useState<Msg["card"] | null>(null);
  const [restoredFromSave, setRestoredFromSave] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Holds the full discussion text for follow-up context
  const discussionRef = useRef<string>("");
  // Track active streams for potential cleanup
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Restore saved result
  useEffect(() => {
    const key = `wts_phase1_${projectId}`;
    const saved = localStorage.getItem(key);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as {
        data: NonNullable<Msg["card"]>;
        input: { genre: string; concept: string };
        savedAt: string;
      };
      if (parsed.data && parsed.input) {
        setGenre(parsed.input.genre);
        setConcept(parsed.input.concept);
        setResult(parsed.data);
        setRestoredFromSave(true);
      }
    } catch { /* ignore */ }
  }, [projectId]);

  /**
   * Creates a new streaming message, streams API response into it, and returns
   * the full accumulated text.
   */
  const runAgentStream = useCallback(async (
    agent: AgentId,
    systemPrompt: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    apiKey: string,
    isCard = false,
  ): Promise<string> => {
    const id = uid();
    setMessages(prev => [...prev, { id, agent, text: "", type: isCard ? "card" : "text", streaming: true }]);
    scrollToBottom();

    let fullText = "";
    const gen = streamClaude({ apiKey, systemPrompt, messages });

    for await (const chunk of gen) {
      fullText += chunk;
      const displayText = isCard ? stripResultBlock(fullText) : fullText;
      setMessages(prev => prev.map(m =>
        m.id === id ? { ...m, text: fullText, ...(isCard && { card: parsePhase1Result(fullText) ?? undefined }) } : m
      ));
      // suppress unused variable warning
      void displayText;
      scrollToBottom();
    }

    // Mark done
    if (isCard) {
      const card = parsePhase1Result(fullText);
      setMessages(prev => prev.map(m =>
        m.id === id ? { ...m, text: fullText, streaming: false, card: card ?? undefined } : m
      ));
    } else {
      setMessages(prev => prev.map(m =>
        m.id === id ? { ...m, streaming: false } : m
      ));
    }
    scrollToBottom();
    return fullText;
  }, [scrollToBottom]);

  /** Full Phase 1 agent discussion pipeline */
  const runDiscussion = useCallback(async (g: string, c: string) => {
    const apiKey = getAnthropicKey();
    if (!apiKey) {
      setApiError("ANTHROPIC_API_KEY가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력해주세요.");
      setChatRunning(false);
      return;
    }
    setApiError(null);
    setChatRunning(true);

    const userPrompt = `장르: ${g}\n\n아이디어: ${c}`;

    try {
      // ── 1. Strategist ──
      const strategistText = await runAgentStream(
        "strategist",
        STRATEGIST_PROMPT,
        [{ role: "user", content: userPrompt }],
        apiKey,
      );

      // ── 2. Researcher ──
      const researcherText = await runAgentStream(
        "researcher",
        RESEARCHER_PROMPT,
        [
          { role: "user", content: userPrompt },
          { role: "assistant", content: `[전략기획자]\n${strategistText}` },
          { role: "user", content: "심층 조사자의 분석을 부탁합니다." },
        ],
        apiKey,
      );

      // ── 3. Producer (synthesis + result card) ──
      const producerText = await runAgentStream(
        "producer",
        PRODUCER_SYNTHESIS_PROMPT,
        [
          { role: "user", content: userPrompt },
          { role: "assistant", content: `[전략기획자]\n${strategistText}\n\n[심층조사자]\n${researcherText}` },
          { role: "user", content: "총괄 프로듀서의 최종 평가를 부탁합니다." },
        ],
        apiKey,
        true, // isCard
      );

      // Save discussion context for follow-ups
      discussionRef.current = [
        `[전략기획자]\n${strategistText}`,
        `[심층조사자]\n${researcherText}`,
        `[총괄프로듀서]\n${stripResultBlock(producerText)}`,
      ].join("\n\n");

      // Extract and save result
      const card = parsePhase1Result(producerText);
      if (card) {
        setResult(card);
        localStorage.setItem(
          `wts_phase1_${projectId}`,
          JSON.stringify({ data: card, input: { genre: g, concept: c }, savedAt: new Date().toISOString() }),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setApiError(`API 오류: ${msg}`);
    } finally {
      setChatRunning(false);
    }
  }, [runAgentStream, projectId]);

  const handleFormSubmit = useCallback(() => {
    if (concept.trim().length < 10) return;
    setStage("chat");
    setTimeout(() => runDiscussion(genre, concept), 100);
  }, [concept, genre, runDiscussion]);

  /** User follow-up → producer responds */
  const handleUserSend = useCallback(async () => {
    const text = userInput.trim();
    if (!text || chatRunning) return;

    const apiKey = getAnthropicKey();
    if (!apiKey) {
      setApiError("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
      return;
    }
    setApiError(null);
    setUserInput("");

    // Add user message
    setMessages(prev => [...prev, { id: uid(), agent: "user", type: "text", text, streaming: false }]);
    setChatRunning(true);

    try {
      await runAgentStream(
        "producer",
        buildProducerFollowupPrompt(discussionRef.current),
        [{ role: "user", content: text }],
        apiKey,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setApiError(`API 오류: ${msg}`);
    } finally {
      setChatRunning(false);
    }
  }, [userInput, chatRunning, runAgentStream]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleUserSend();
    }
  }, [handleUserSend]);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const conceptSnippet = concept.length > 60 ? concept.slice(0, 60) + "…" : concept;

  return (
    <div className={styles.page}>
      {stage === "form" ? (
        <div className={styles.formWrap}>
          {restoredFromSave && result && (
            <div style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "#34d399", display: "flex", alignItems: "center", gap: 8 }}>
              <span>✓</span>
              <span>이전 분석 결과 불러옴 — 다시 분석하거나 Phase 2로 이동할 수 있습니다.</span>
            </div>
          )}
          <div className={styles.formCard}>
            <div className={styles.formTitle}>Phase 1 — 기획 분석</div>
            <div className={styles.formDesc}>
              장르와 아이디어를 입력하면 AI 에이전트들이 실시간으로 토론하며 기획을 분석합니다.
            </div>

            <label className={styles.formLabel}>장르</label>
            <select className={styles.formSelect} value={genre} onChange={e => setGenre(e.target.value)}>
              {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>

            <label className={styles.formLabel}>아이디어 / 개념</label>
            <textarea
              className={styles.formTextarea}
              value={concept}
              onChange={e => setConcept(e.target.value)}
              placeholder="주인공, 핵심 갈등, 세계관의 특징, 목표 독자층 등을 자유롭게 서술하세요. (최소 10자)"
              rows={5}
            />
            <div style={{ fontSize: 12, color: concept.length < 10 ? "#f87171" : "#34d399", marginTop: 4 }}>
              {concept.length}자 {concept.length < 10 ? `(최소 ${10 - concept.length}자 더 필요)` : "✓"}
            </div>

            <button className={styles.btnStart} disabled={concept.trim().length < 10} onClick={handleFormSubmit}>
              ✦ 분석 시작
            </button>

            {restoredFromSave && result && (
              <button className={styles.btnStart} style={{ marginTop: 10, background: "#1e4d3a", borderColor: "#34d399", color: "#34d399" }}
                onClick={() => router.push(`/projects/${projectId}/phase-2`)}>
                Phase 2 시작 →
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.chatLayout}>
          <div className={styles.chatHeader}>
            <span style={{ color: "#a78bfa", fontWeight: 600 }}>{genre}</span>
            <span style={{ color: "#64748b", margin: "0 8px" }}>·</span>
            <span style={{ color: "#94a3b8", fontSize: 13 }}>{conceptSnippet}</span>
            {chatRunning && (
              <span style={{ marginLeft: "auto", fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
                에이전트 토론 중 <ThinkingDots />
              </span>
            )}
          </div>

          {apiError && (
            <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", margin: "12px 20px 0", borderRadius: 10, padding: "10px 16px", fontSize: 13, color: "#f87171", display: "flex", alignItems: "center", gap: 8 }}>
              <span>⚠</span>
              <span>{apiError}</span>
              <a href="/settings" style={{ marginLeft: "auto", color: "#f87171", textDecoration: "underline", whiteSpace: "nowrap" }}>설정으로 이동</a>
            </div>
          )}

          <div className={styles.chatBody} ref={bodyRef}>
            {messages.map(msg => <MsgBubble key={msg.id} msg={msg} />)}
            <div style={{ height: 16 }} />
          </div>

          {result && (
            <div className={styles.gatingRow}>
              <button className={styles.btnGating} onClick={() => router.push(`/projects/${projectId}/phase-2`)}>
                Phase 2 시작 — 세계관 설계 →
              </button>
            </div>
          )}

          <div className={styles.chatInputRow}>
            <textarea
              ref={inputRef}
              className={styles.chatInput}
              value={userInput}
              onChange={e => setUserInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="에이전트에게 추가 질문이나 의견을 보내세요… (Enter 전송, Shift+Enter 줄바꿈)"
              rows={1}
              disabled={chatRunning}
            />
            <button className={styles.btnSend} onClick={handleUserSend} disabled={!userInput.trim() || chatRunning}>
              전송
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
