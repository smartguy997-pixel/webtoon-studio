"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { streamClaude, getAnthropicKey, WEB_SEARCH_TOOL } from "@/lib/claude-client";

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
- 웹 검색으로 최신 네이버 웹툰·카카오페이지·레진코믹스 트렌드를 조사합니다
- 장르 포지셔닝(대중성 vs 마니아, 신규 IP vs 클리셰 재해석)을 평가합니다
- 실제 경쟁작 2~3종을 검색·벤치마크하고 차별화 전략을 도출합니다
- 독자 관점 USP 3~5개를 구체적으로 제시합니다

웹 검색을 적극 활용하여 최신 시장 데이터, 인기 작품, 독자 반응을 확인하세요.
말투: 전문적이고 논리적. 검색으로 찾은 실제 데이터를 근거로 분석. 자연스러운 한국어.
분량: 300~500자.`;

const RESEARCHER_PROMPT = `당신은 스토리 논리성·현실성 검토 전문 심층 조사자(agent_researcher)입니다. Phase 1 기획 분석 토론에 참여합니다.

역할:
- 웹 검색으로 기획안의 설정·배경이 실제와 맞는지 팩트체크합니다
- 기획안의 클리셰·내부 모순을 찾아 건설적으로 지적합니다
- 유사 소재의 기존 웹툰·만화를 검색하여 차별화 포인트를 분석합니다
- 전략기획자의 분석을 보완하거나 다른 시각을 제시합니다
- 반드시 건설적 개선 방향·대안을 함께 제안합니다

웹 검색을 적극 활용하여 유사 소재의 선행 작품, 독자 반응, 클리셰 여부를 확인하세요.
말투: 분석적이고 날카롭지만 건설적. 단순 비판 금지, 항상 대안 제시. 자연스러운 한국어.
분량: 300~500자.`;

const PRODUCER_SYNTHESIS_PROMPT = `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다. Phase 1 기획 분석 토론을 마무리합니다.

역할:
- 전략기획자와 심층조사자의 의견을 종합하고 갈등을 중재합니다
- 필요 시 웹 검색으로 추가 데이터를 확인하여 최종 판단의 근거를 보강합니다
- Phase 1 최종 실현가능성 평가를 내립니다
- 다음 단계(Phase 2) 진행 여부를 사용자에게 명확히 안내합니다

말투: 권위 있고 명확. 결론 지향. 자연스러운 한국어. 분량: 200~300자.

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
필요 시 웹 검색으로 최신 정보를 확인하고, 전략기획자·심층조사자의 관점을 언급하며 종합 의견을 제시하세요.
말투: 친근하지만 전문적. 자연스러운 한국어. 분량: 200~350자.`;
}

function buildStrategistRound2Prompt(userMsg: string, context: string): string {
  return `당신은 K-웹툰 시장 전문 전략 기획자(agent_strategist)입니다. Phase 1 기획 분석 2라운드 토론에 참여합니다.

아래는 1라운드 토론 내역입니다:
---
${context}
---

사용자 추가 의견: "${userMsg}"

역할:
- 사용자의 추가 의견을 반영하여 전략적 분석을 심화합니다
- 1라운드에서 미처 다루지 못한 시장 기회나 리스크를 보완합니다
- 웹 검색으로 최신 데이터를 보강하여 분석의 정확도를 높입니다
- USP 및 포지셔닝 전략을 더욱 구체화합니다

말투: 전문적이고 논리적. 자연스러운 한국어. 분량: 250~400자.`;
}

function buildResearcherRound2Prompt(userMsg: string, context: string): string {
  return `당신은 스토리 논리성·현실성 검토 전문 심층 조사자(agent_researcher)입니다. Phase 1 기획 분석 2라운드 토론에 참여합니다.

아래는 1라운드 토론 내역입니다:
---
${context}
---

사용자 추가 의견: "${userMsg}"

역할:
- 사용자의 피드백을 바탕으로 기획안의 보완 가능성을 재검토합니다
- 1라운드에서 지적한 문제점에 대한 구체적 해결 방안을 제시합니다
- 유사 작품의 성공 사례를 웹 검색으로 추가 발굴합니다
- 전략기획자의 2라운드 분석을 보완하는 새로운 시각을 제시합니다

말투: 분석적이고 건설적. 항상 대안 제시. 자연스러운 한국어. 분량: 250~400자.`;
}

function buildProducerRound2Prompt(context: string): string {
  return `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다. Phase 1 기획 분석 2라운드 중간 종합을 진행합니다.

아래는 지금까지의 토론 내역입니다:
---
${context}
---

역할:
- 2라운드 전략기획자와 심층조사자의 보완 분석을 간략히 종합합니다
- 1라운드 대비 개선된 점과 남은 과제를 명확히 정리합니다
- 곧 최종 마무리가 진행됨을 안내합니다

말투: 권위 있고 명확. 결론 지향. 자연스러운 한국어. 분량: 150~250자.
⚠️ 이 응답에는 [PHASE1_RESULT] 블록을 포함하지 마세요.`;
}

function buildProducerWrapupPrompt(context: string): string {
  return `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다. Phase 1 기획 분석 토론 최종 마무리를 진행합니다.

아래는 전체 토론 내역입니다:
---
${context}
---

역할:
- "토론을 마무리합니다." 로 시작합니다
- 2라운드 전체 토론을 종합하여 최종 실현가능성 평가를 내립니다
- 전략기획자와 심층조사자의 모든 의견을 반영한 최종 USP를 정리합니다
- Phase 2 진행 여부를 명확히 안내합니다
- 필요 시 웹 검색으로 추가 데이터를 확인합니다

말투: 권위 있고 명확. 결론 지향. 자연스러운 한국어. 분량: 250~350자.

⚠️ 응답 마지막에 반드시 아래 JSON 블록을 정확히 포함하세요 (다른 텍스트 없이 줄바꿈만):

[PHASE1_RESULT]
{"feasibility_score":0.75,"verdict":"conditional","usp":["USP 예시 1","USP 예시 2","USP 예시 3"],"summary":"100자 이내 요약"}
[/PHASE1_RESULT]

verdict 기준: "go" ≥ 0.70, "conditional" 0.50~0.69, "reject" < 0.50
feasibility_score는 2라운드 전체 토론을 반영하여 정직하게 산정하세요.`;
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

interface AgentTexts {
  r1_strategist: string;
  r1_researcher: string;
  r1_producer: string;
  r2_user: string;
  r2_strategist: string;
  r2_researcher: string;
  r2_producer: string;
  r3_producer: string;
}

interface PrevDiscussion {
  genre: string;
  concept: string;
  agentTexts: AgentTexts;
  result: Msg["card"] | null;
  discussionContext: string;
  savedAt: { toDate?: () => Date } | null;
}

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

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ROUNDS = 3;

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

  // ── New state: round tracking + discussion closed ──
  const [roundCount, setRoundCount] = useState<0 | 1 | 3>(0);
  const [discussionClosed, setDiscussionClosed] = useState(false);

  // ── New state: Firestore previous discussion ──
  const [prevDiscussion, setPrevDiscussion] = useState<PrevDiscussion | null>(null);
  const [checkingFirestore, setCheckingFirestore] = useState(true);

  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Holds the full discussion text for follow-up context
  const discussionRef = useRef<string>("");
  // Track active streams for potential cleanup
  const abortRef = useRef<AbortController | null>(null);
  // Track raw agent texts for Firestore save
  const savedMsgsRef = useRef<Partial<AgentTexts>>({});

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // ── Restore saved result or pre-seed from localStorage ──
  useEffect(() => {
    const key = `wts_phase1_${projectId}`;
    const saved = localStorage.getItem(key);
    if (saved) {
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
          return;
        }
      } catch { /* ignore */ }
    }
    // Pre-seed from project creation (no result yet)
    const seed = localStorage.getItem(`wts_project_seed_${projectId}`);
    if (seed) {
      try {
        const { genre: g, concept: c } = JSON.parse(seed) as { genre: string; concept: string };
        if (g) setGenre(g);
        if (c) setConcept(c);
      } catch { /* ignore */ }
    }
  }, [projectId]);

  // ── Load previous Firestore discussion on mount ──
  useEffect(() => {
    let cancelled = false;
    async function loadPrev() {
      try {
        const { collection, query, orderBy, limit, getDocs } = await import("firebase/firestore");
        const { db } = await import("@/lib/firebase");
        const colRef = collection(db, "projects", projectId, "phase1_discussions");
        const q = query(colRef, orderBy("savedAt", "desc"), limit(1));
        const snap = await getDocs(q);
        if (!cancelled && !snap.empty) {
          const doc = snap.docs[0].data() as PrevDiscussion;
          setPrevDiscussion(doc);
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setCheckingFirestore(false);
      }
    }
    loadPrev();
    return () => { cancelled = true; };
  }, [projectId]);

  // ── Save discussion to Firestore ──
  const saveToFirestore = useCallback(async (
    g: string,
    c: string,
    agentTexts: AgentTexts,
    card: Msg["card"] | null,
    context: string,
  ) => {
    try {
      const { collection, addDoc, serverTimestamp } = await import("firebase/firestore");
      const { db } = await import("@/lib/firebase");
      const colRef = collection(db, "projects", projectId, "phase1_discussions");
      await addDoc(colRef, {
        genre: g,
        concept: c,
        agentTexts,
        result: card ?? null,
        discussionContext: context,
        savedAt: serverTimestamp(),
      });
    } catch {
      // silently fail
    }
  }, [projectId]);

  /**
   * Creates a new streaming message, streams API response into it, and returns
   * the full accumulated text.
   */
  const runAgentStream = useCallback(async (
    agent: AgentId,
    systemPrompt: string,
    msgs: Array<{ role: "user" | "assistant"; content: string }>,
    apiKey: string,
    isCard = false,
    useWebSearch = true,
  ): Promise<string> => {
    const id = uid();
    setMessages(prev => [...prev, { id, agent, text: "", type: isCard ? "card" : "text", streaming: true }]);
    scrollToBottom();

    let fullText = "";
    const gen = streamClaude({
      apiKey,
      systemPrompt,
      messages: msgs,
      maxTokens: 3000,
      tools: useWebSearch ? [WEB_SEARCH_TOOL] : [],
    });

    for await (const chunk of gen) {
      fullText += chunk;
      const displayText = isCard ? stripResultBlock(fullText) : fullText;
      setMessages(prev => prev.map(m =>
        m.id === id ? { ...m, text: fullText, ...(isCard && { card: parsePhase1Result(fullText) ?? undefined }) } : m
      ));
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

  /** Round 1: strategist → researcher → producer (with result card) */
  const runRound1 = useCallback(async (g: string, c: string, apiKey: string): Promise<{
    strategistText: string;
    researcherText: string;
    producerText: string;
  }> => {
    const userPrompt = `장르: ${g}\n\n아이디어: ${c}`;

    const strategistText = await runAgentStream(
      "strategist",
      STRATEGIST_PROMPT,
      [{ role: "user", content: userPrompt }],
      apiKey,
    );
    savedMsgsRef.current.r1_strategist = strategistText;

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
    savedMsgsRef.current.r1_researcher = researcherText;

    const producerText = await runAgentStream(
      "producer",
      PRODUCER_SYNTHESIS_PROMPT,
      [
        { role: "user", content: userPrompt },
        { role: "assistant", content: `[전략기획자]\n${strategistText}\n\n[심층조사자]\n${researcherText}` },
        { role: "user", content: "총괄 프로듀서의 최종 평가를 부탁합니다." },
      ],
      apiKey,
      true,
    );
    savedMsgsRef.current.r1_producer = producerText;

    return { strategistText, researcherText, producerText };
  }, [runAgentStream]);

  /** Round 2 + 3: user message → strategist(r2) → researcher(r2) → producer(r2) → AUTO producer wrap-up (r3/card) */
  const runRound2And3 = useCallback(async (userMsg: string, apiKey: string) => {
    savedMsgsRef.current.r2_user = userMsg;

    const context = discussionRef.current;

    const r2Strategist = await runAgentStream(
      "strategist",
      buildStrategistRound2Prompt(userMsg, context),
      [{ role: "user", content: userMsg }],
      apiKey,
    );
    savedMsgsRef.current.r2_strategist = r2Strategist;

    const r2Researcher = await runAgentStream(
      "researcher",
      buildResearcherRound2Prompt(userMsg, context),
      [
        { role: "user", content: userMsg },
        { role: "assistant", content: `[전략기획자 2라운드]\n${r2Strategist}` },
        { role: "user", content: "심층 조사자의 2라운드 분석을 부탁합니다." },
      ],
      apiKey,
    );
    savedMsgsRef.current.r2_researcher = r2Researcher;

    const r2Context = [
      context,
      `[사용자 추가 의견]\n${userMsg}`,
      `[전략기획자 2라운드]\n${r2Strategist}`,
      `[심층조사자 2라운드]\n${r2Researcher}`,
    ].join("\n\n");

    const r2Producer = await runAgentStream(
      "producer",
      buildProducerRound2Prompt(r2Context),
      [{ role: "user", content: "2라운드 중간 종합을 부탁합니다." }],
      apiKey,
    );
    savedMsgsRef.current.r2_producer = r2Producer;

    // Auto-trigger Round 3 wrap-up (with result card)
    const r3Context = [
      r2Context,
      `[총괄프로듀서 2라운드]\n${r2Producer}`,
    ].join("\n\n");

    const r3Producer = await runAgentStream(
      "producer",
      buildProducerWrapupPrompt(r3Context),
      [{ role: "user", content: "최종 마무리를 부탁합니다." }],
      apiKey,
      true,
    );
    savedMsgsRef.current.r3_producer = r3Producer;

    return { r2Context: r3Context, r3Producer };
  }, [runAgentStream]);

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
    savedMsgsRef.current = {};

    try {
      const { strategistText, researcherText, producerText } = await runRound1(g, c, apiKey);

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

      setRoundCount(1);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = raw.includes("401") || raw.includes("authentication")
        ? "API 키가 유효하지 않습니다. 설정 페이지에서 sk-ant-api03-... 형식의 키를 다시 확인해주세요."
        : `API 오류: ${raw}`;
      setApiError(msg);
    } finally {
      setChatRunning(false);
    }
  }, [runRound1, projectId]);

  const handleFormSubmit = useCallback(() => {
    if (concept.trim().length < 10) return;
    setStage("chat");
    setTimeout(() => runDiscussion(genre, concept), 100);
  }, [concept, genre, runDiscussion]);

  /** User send: handles round 2+3 vs closed discussion follow-up */
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

    // Add user message to chat
    setMessages(prev => [...prev, { id: uid(), agent: "user", type: "text", text, streaming: false }]);
    setChatRunning(true);

    try {
      // ── If discussion already closed: producer follow-up (stay closed) ──
      if (discussionClosed) {
        if (text === "계속") {
          await runAgentStream(
            "producer",
            buildProducerFollowupPrompt(discussionRef.current),
            [{ role: "user", content: text }],
            apiKey,
          );
        } else {
          // Remind user about "계속"
          const id = uid();
          setMessages(prev => [...prev, {
            id,
            agent: "producer",
            text: "추가 논의를 원하면 '계속'을 입력해주세요.",
            type: "text",
            streaming: false,
          }]);
        }
        return;
      }

      // ── Round 2 (first user message after round 1) ──
      if (roundCount === 1) {
        const { r2Context, r3Producer } = await runRound2And3(text, apiKey);

        // Update discussion context with full r2+r3 context
        discussionRef.current = r2Context;

        // Extract card from r3 producer
        const card = parsePhase1Result(r3Producer);
        if (card) {
          setResult(card);
          localStorage.setItem(
            `wts_phase1_${projectId}`,
            JSON.stringify({ data: card, input: { genre, concept }, savedAt: new Date().toISOString() }),
          );
        }

        setRoundCount(3);
        setDiscussionClosed(true);

        // Save to Firestore
        const agentTexts: AgentTexts = {
          r1_strategist: savedMsgsRef.current.r1_strategist ?? "",
          r1_researcher: savedMsgsRef.current.r1_researcher ?? "",
          r1_producer: savedMsgsRef.current.r1_producer ?? "",
          r2_user: savedMsgsRef.current.r2_user ?? "",
          r2_strategist: savedMsgsRef.current.r2_strategist ?? "",
          r2_researcher: savedMsgsRef.current.r2_researcher ?? "",
          r2_producer: savedMsgsRef.current.r2_producer ?? "",
          r3_producer: savedMsgsRef.current.r3_producer ?? "",
        };
        await saveToFirestore(genre, concept, agentTexts, card ?? null, r2Context);
        return;
      }

      // ── Fallback: producer follow-up for any other state ──
      await runAgentStream(
        "producer",
        buildProducerFollowupPrompt(discussionRef.current),
        [{ role: "user", content: text }],
        apiKey,
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = raw.includes("401") || raw.includes("authentication")
        ? "API 키가 유효하지 않습니다. 설정 페이지에서 키를 다시 확인해주세요."
        : `API 오류: ${raw}`;
      setApiError(msg);
    } finally {
      setChatRunning(false);
    }
  }, [userInput, chatRunning, discussionClosed, roundCount, runAgentStream, runRound2And3, saveToFirestore, genre, concept, projectId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleUserSend();
    }
  }, [handleUserSend]);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  /** Reconstruct messages from a PrevDiscussion's agentTexts */
  const reconstructMessages = useCallback((pd: PrevDiscussion): Msg[] => {
    const msgs: Msg[] = [];
    const at = pd.agentTexts;

    if (at.r1_strategist) msgs.push({ id: uid(), agent: "strategist", text: at.r1_strategist, type: "text", streaming: false });
    if (at.r1_researcher) msgs.push({ id: uid(), agent: "researcher", text: at.r1_researcher, type: "text", streaming: false });
    if (at.r1_producer) {
      const card = parsePhase1Result(at.r1_producer);
      msgs.push({ id: uid(), agent: "producer", text: at.r1_producer, type: card ? "card" : "text", streaming: false, card: card ?? undefined });
    }
    if (at.r2_user) msgs.push({ id: uid(), agent: "user", text: at.r2_user, type: "text", streaming: false });
    if (at.r2_strategist) msgs.push({ id: uid(), agent: "strategist", text: at.r2_strategist, type: "text", streaming: false });
    if (at.r2_researcher) msgs.push({ id: uid(), agent: "researcher", text: at.r2_researcher, type: "text", streaming: false });
    if (at.r2_producer) msgs.push({ id: uid(), agent: "producer", text: at.r2_producer, type: "text", streaming: false });
    if (at.r3_producer) {
      const card = parsePhase1Result(at.r3_producer);
      msgs.push({ id: uid(), agent: "producer", text: at.r3_producer, type: card ? "card" : "text", streaming: false, card: card ?? undefined });
    }

    return msgs;
  }, []);

  const handleContinuePrev = useCallback(() => {
    if (!prevDiscussion) return;
    const { genre: g, concept: c, agentTexts, result: prevResult, discussionContext } = prevDiscussion;
    setGenre(g);
    setConcept(c);
    discussionRef.current = discussionContext ?? "";
    savedMsgsRef.current = { ...agentTexts };
    const msgs = reconstructMessages(prevDiscussion);
    setMessages(msgs);
    if (prevResult) setResult(prevResult);
    setRoundCount(3);
    setDiscussionClosed(true);
    setStage("chat");
  }, [prevDiscussion, reconstructMessages]);

  const conceptSnippet = concept.length > 60 ? concept.slice(0, 60) + "…" : concept;

  return (
    <div className={styles.page}>
      {stage === "form" ? (
        <div className={styles.formWrap}>
          {/* ── Firestore previous discussion banner ── */}
          {checkingFirestore ? (
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <ThinkingDots />
              이전 토론 내역 확인 중...
            </div>
          ) : prevDiscussion ? (
            <div className={styles.prevBanner}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 10 }}>
                <strong style={{ color: "#f1f5f9" }}>이전 토론 내역이 있습니다</strong>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <span style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa", padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                  {prevDiscussion.genre}
                </span>
                <span style={{ fontSize: 13, color: "#94a3b8" }}>
                  {prevDiscussion.concept.slice(0, 50)}{prevDiscussion.concept.length > 50 ? "…" : ""}
                </span>
              </div>
              <div className={styles.prevBannerBtns}>
                <button
                  onClick={handleContinuePrev}
                  style={{ background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.4)", color: "#34d399", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                >
                  이어하기
                </button>
                <button
                  onClick={() => setPrevDiscussion(null)}
                  style={{ background: "rgba(148,163,184,0.08)", border: "1px solid rgba(148,163,184,0.2)", color: "#94a3b8", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                >
                  새로 시작하기
                </button>
              </div>
            </div>
          ) : null}

          {/* ── localStorage restored banner ── */}
          {!prevDiscussion && restoredFromSave && result && (
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

            {!prevDiscussion && restoredFromSave && result && (
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
            {roundCount > 0 && (
              <span className={styles.roundBadge}>
                라운드 {roundCount} / {MAX_ROUNDS}
              </span>
            )}
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

          {discussionClosed && (
            <div className={styles.closedBanner}>
              토론이 마무리되었습니다. &apos;계속&apos;을 입력하면 추가 질문이 가능합니다.
            </div>
          )}

          <div className={styles.chatInputRow}>
            <textarea
              ref={inputRef}
              className={styles.chatInput}
              value={userInput}
              onChange={e => setUserInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                discussionClosed
                  ? "'계속'을 입력하면 추가 질문이 가능합니다…"
                  : roundCount === 1
                  ? "추가 의견을 보내면 에이전트들이 2라운드 토론을 진행합니다… (Enter 전송)"
                  : "에이전트에게 추가 질문이나 의견을 보내세요… (Enter 전송, Shift+Enter 줄바꿈)"
              }
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
