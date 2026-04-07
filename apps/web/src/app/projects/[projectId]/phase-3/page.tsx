"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import s from "./page.module.css";
import { streamClaude, getAnthropicKey, WEB_SEARCH_TOOL } from "@/lib/claude-client";

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = {
  scenario:   { label: "시나리오 작가", color: "#fbbf24", bg: "rgba(251,191,36,0.12)"  },
  researcher: { label: "심층 조사자",   color: "#34d399", bg: "rgba(52,211,153,0.12)"  },
  producer:   { label: "총괄 프로듀서", color: "#f1f5f9", bg: "rgba(241,245,249,0.12)" },
  user:       { label: "나",            color: "#7c6cfc", bg: "rgba(124,108,252,0.12)" },
} as const;
type AgentId = keyof typeof AGENTS;

// ─── Types ────────────────────────────────────────────────────────────────────

interface EpisodeDetail {
  ep: number; title: string; event: string;
  characters: string[]; emotion: string;
  foreshadow: string; cliffhanger: string;
  arc: number; tension: number;
}
interface EpisodeCard { episodes: EpisodeDetail[]; arcLabel: string; arcColor: string }
interface RoadmapCard {
  arcs: { num: number; name: string; theme: string; eps: [number, number]; color: string }[];
  totalEps: number;
}

interface Msg {
  id: string; agent: AgentId; text: string;
  streaming: boolean;
  card?: EpisodeCard | RoadmapCard;
  cardType?: "episode" | "roadmap";
}

const ARC_COLORS = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"];

function uid() { return Math.random().toString(36).slice(2, 10); }

// ─── System prompts ───────────────────────────────────────────────────────────

function buildResearcherPrompt(genre: string, context: string): string {
  return `당신은 AI Webtoon Studio 심층 조사자(agent_researcher)입니다. Phase 3 시리즈 로드맵 설계를 지원합니다.

${context}

역할:
- 웹 검색으로 ${genre} 장르 장기 연재 웹툰의 독자 유지율 패턴을 조사합니다
- 성공적인 100화 이상 연재작의 막 구조와 서사 패턴을 분석합니다
- 독자 이탈 방지를 위한 훅 배치, 클리프행어 전략을 제안합니다

말투: 분석적이고 데이터 기반. 자연스러운 한국어. 분량: 200~300자.`;
}

function buildRoadmapPrompt(genre: string, context: string, researchSummary: string): string {
  return `당신은 AI Webtoon Studio 시나리오 작가(agent_scenario)입니다. Phase 3 100화 로드맵 설계를 담당합니다.

${context}
조사 결과: ${researchSummary}

역할:
- 4막 구조(각 25화)로 100화 전체 로드맵을 설계합니다
- 각 막의 이름, 주제, 핵심 테마가 장르와 기획에 맞아야 합니다
- 전체적인 서사 흐름과 장력 배분을 고려합니다

말투: 창의적이고 전문적. 자연스러운 한국어. 분량: 100~150자 설명 후 JSON.

⚠️ 응답 마지막에 반드시 아래 형식으로 JSON 블록을 포함하세요:

[ROADMAP_CARD]
{"arcs":[{"num":1,"name":"막 이름","theme":"핵심 테마","eps":[1,25],"color":"#60a5fa"},{"num":2,"name":"막 이름","theme":"핵심 테마","eps":[26,50],"color":"#34d399"},{"num":3,"name":"막 이름","theme":"핵심 테마","eps":[51,75],"color":"#fbbf24"},{"num":4,"name":"막 이름","theme":"핵심 테마","eps":[76,100],"color":"#f472b6"}],"totalEps":100}
[/ROADMAP_CARD]`;
}

function buildEpisodePrompt(
  arcNum: number, arcName: string, arcTheme: string, epsRange: [number, number],
  genre: string, context: string, roadmapSummary: string,
): string {
  const arcColor = ARC_COLORS[arcNum - 1];
  return `당신은 AI Webtoon Studio 시나리오 작가(agent_scenario)입니다. ${arcNum}막 에피소드 목록을 설계합니다.

${context}
로드맵: ${roadmapSummary}
담당 막: ${arcNum}막 "${arcName}" — ${arcTheme} (EP ${epsRange[0]}–${epsRange[1]})

역할:
- EP ${epsRange[0]}부터 ${epsRange[1]}까지 총 25화 각각의 에피소드를 설계합니다
- 각 화마다: 제목, 핵심 사건, 등장인물, 감정 곡선, 복선, 클리프행어(5화마다), 장력(1-5) 설정
- ${arcNum}막 테마인 "${arcTheme}"를 전체적으로 관통하되 각 화는 독립적 훅이 있어야 합니다
- tension은 1(저)부터 5(고)로 막의 흐름에 따라 자연스럽게 변화시키세요

말투: 자연스러운 한국어. 분량: 50자 설명 후 JSON.

⚠️ 응답 마지막에 반드시 아래 형식으로 JSON 블록을 포함하세요:

[EPISODE_CARD_${arcNum}]
{"episodes":[{"ep":${epsRange[0]},"title":"화 제목","event":"핵심 사건 설명","characters":["주인공"],"emotion":"감정 키워드","foreshadow":"복선 (없으면 빈 문자열)","cliffhanger":"클리프행어 (없으면 빈 문자열)","arc":${arcNum},"tension":3}],"arcLabel":"${arcNum}막 — ${arcName}","arcColor":"${arcColor}"}
[/EPISODE_CARD_${arcNum}]

정확히 25개의 에피소드 객체를 생성하세요.`;
}

function buildProducerSignoffPrompt(genre: string, context: string): string {
  return `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다. Phase 3 100화 로드맵 검토를 마무리합니다.

${context}

역할:
- 4막 구조와 완급 배분이 ${genre} 장르 독자 기대치에 부합하는지 최종 검토합니다
- 특히 인상적인 에피소드 설계나 개선 포인트를 간략히 언급합니다
- Phase 4 진행 방법을 안내합니다

말투: 권위 있고 명확. 자연스러운 한국어. 분량: 150~200자.`;
}

function buildProducerFollowupPrompt(context: string): string {
  return `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다.

아래는 Phase 3 100화 로드맵 토론 내역입니다:
---
${context}
---

역할: 사용자의 수정 요청이나 질문에 응답합니다.
특정 화 수정 요청이 있다면 시나리오 작가의 입장에서 어떻게 반영할지 구체적으로 설명하세요.
말투: 친근하지만 전문적. 자연스러운 한국어. 분량: 150~250자.`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThinkingDots() {
  return <span className={s.dots}><span /><span /><span /></span>;
}

function StreamCursor() {
  return (
    <span style={{
      display: "inline-block", width: 2, height: 13, background: "#7c6cfc",
      marginLeft: 2, verticalAlign: "middle", borderRadius: 1,
      animation: "blink 0.9s step-start infinite",
    }} />
  );
}

function TensionDots({ level }: { level: number }) {
  const colors = ["", "#4ade80", "#a3e635", "#fbbf24", "#f97316", "#ef4444"];
  return (
    <span className={s.tensionDots}>
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} className={s.tensionDot}
          style={{ background: n <= level ? colors[level] : "#252535" }} />
      ))}
    </span>
  );
}

function EpCardView({ card }: { card: EpisodeCard }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <div className={s.epCard}>
      <div className={s.epCardHeader}>
        <span className={s.epCardArcLabel} style={{ color: card.arcColor }}>{card.arcLabel}</span>
        <span className={s.epCardCount}>{card.episodes.length}화</span>
      </div>
      <div className={s.epList}>
        {card.episodes.map(ep => (
          <div key={ep.ep} className={s.epRow} onClick={() => setExpanded(expanded === ep.ep ? null : ep.ep)}>
            <div className={s.epRowTop}>
              <span className={s.epNum}>{ep.ep}화</span>
              <span className={s.epTitle}>{ep.title}</span>
              <TensionDots level={ep.tension} />
              <span className={s.epChevron}>{expanded === ep.ep ? "▲" : "▼"}</span>
            </div>
            {expanded === ep.ep && (
              <div className={s.epDetail}>
                <div className={s.epDetailRow}><span className={s.epDetailLabel}>핵심 사건</span><span className={s.epDetailVal}>{ep.event}</span></div>
                <div className={s.epDetailRow}><span className={s.epDetailLabel}>등장인물</span><span className={s.epDetailVal}>{ep.characters.join(", ")}</span></div>
                <div className={s.epDetailRow}><span className={s.epDetailLabel}>감정 곡선</span><span className={s.epDetailVal}>{ep.emotion}</span></div>
                {ep.foreshadow && <div className={s.epDetailRow}><span className={s.epDetailLabel}>복선</span><span className={s.epDetailVal}>{ep.foreshadow}</span></div>}
                {ep.cliffhanger && <div className={s.epDetailRow}><span className={s.epDetailLabel}>클리프행어</span><span className={s.epDetailVal} style={{ color: "#fbbf24" }}>{ep.cliffhanger}</span></div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RoadmapCardView({ card }: { card: RoadmapCard }) {
  return (
    <div className={s.roadmapCard}>
      <div className={s.roadmapTitle}>100화 4막 구조 로드맵</div>
      <div className={s.arcGrid}>
        {card.arcs.map(arc => (
          <div key={arc.num} className={s.arcBlock} style={{ borderTopColor: arc.color }}>
            <div className={s.arcBlockLabel} style={{ color: arc.color }}>막 {arc.num}</div>
            <div className={s.arcBlockName}>{arc.name}</div>
            <div className={s.arcBlockEps}>EP {arc.eps[0]}–{arc.eps[1]}</div>
            <div className={s.arcBlockTheme}>{arc.theme}</div>
          </div>
        ))}
      </div>
      <div className={s.roadmapBar}>
        {card.arcs.map(arc => (
          <div key={arc.num} className={s.roadmapBarSeg} style={{ background: arc.color, flex: 25 }}>
            <span className={s.roadmapBarLabel}>{arc.num}막</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MsgBubble({ msg }: { msg: Msg }) {
  const cfg = AGENTS[msg.agent];
  const isUser = msg.agent === "user";
  if (msg.cardType === "roadmap" && msg.card) {
    return <RoadmapCardView card={msg.card as RoadmapCard} />;
  }
  if (msg.cardType === "episode" && msg.card) {
    return <EpCardView card={msg.card as EpisodeCard} />;
  }
  return (
    <div className={`${s.msgRow} ${isUser ? s.msgRowUser : ""}`}>
      {!isUser && (
        <div className={s.avatar} style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}33` }}>
          {cfg.label[0]}
        </div>
      )}
      <div className={s.msgContent}>
        {!isUser && <div className={s.agentName} style={{ color: cfg.color }}>{cfg.label}</div>}
        <div className={`${s.bubble} ${isUser ? s.bubbleUser : ""}`}
          style={!isUser ? { borderColor: `${cfg.color}22` } : {}}>
          {msg.streaming && !msg.text ? (
            <ThinkingDots />
          ) : (
            <span style={{ whiteSpace: "pre-wrap" }}>
              {msg.text}
              {msg.streaming && <StreamCursor />}
            </span>
          )}
        </div>
      </div>
      {isUser && (
        <div className={s.avatar} style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}33` }}>나</div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Phase3Page({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();

  const [stage, setStage] = useState<"idle" | "chat">("idle");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [genre, setGenre] = useState("판타지");
  const [roadmapDone, setRoadmapDone] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<string>("");

  useEffect(() => {
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.genre) setGenre(p1.input.genre);
    } catch { /* ignore */ }
  }, [projectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const id = "wts-blink-style";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id;
      el.textContent = "@keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }";
      document.head.appendChild(el);
    }
  }, []);

  // Streaming text helper (plain text, no card)
  const streamText = useCallback(async (
    agent: AgentId,
    systemPrompt: string,
    msgs: Array<{ role: "user" | "assistant"; content: string }>,
    apiKey: string,
  ): Promise<string> => {
    const id = uid();
    setMessages(prev => [...prev, { id, agent, text: "", streaming: true }]);

    let fullText = "";
    const gen = streamClaude({ apiKey, systemPrompt, messages: msgs, maxTokens: 2000, tools: [WEB_SEARCH_TOOL] });
    for await (const chunk of gen) {
      fullText += chunk;
      setMessages(prev => prev.map(m => m.id === id ? { ...m, text: fullText } : m));
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    setMessages(prev => prev.map(m => m.id === id ? { ...m, streaming: false } : m));
    return fullText;
  }, []);

  // Streaming JSON card helper
  const streamCard = useCallback(async (
    agent: AgentId,
    systemPrompt: string,
    msgs: Array<{ role: "user" | "assistant"; content: string }>,
    apiKey: string,
    cardType: "roadmap" | "episode",
    arcNum?: number,
  ): Promise<string> => {
    const id = uid();
    // Add a placeholder text bubble that becomes a card on completion
    setMessages(prev => [...prev, { id, agent, text: "에피소드 생성 중...", streaming: true }]);

    let fullText = "";
    const gen = streamClaude({ apiKey, systemPrompt, messages: msgs, maxTokens: 8000, tools: [] });
    for await (const chunk of gen) {
      fullText += chunk;
      // Update progress text
      const lineCount = (fullText.match(/"ep":/g) || []).length;
      if (cardType === "episode" && lineCount > 0) {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, text: `에피소드 생성 중... (${lineCount}/25화)` } : m));
      }
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    // Parse and show card
    if (cardType === "roadmap") {
      const tag = "ROADMAP_CARD";
      const re = new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${tag}\\]`);
      const match = fullText.match(re);
      let card: RoadmapCard | null = null;
      try { if (match) card = JSON.parse(match[1]) as RoadmapCard; } catch { /* ignore */ }
      if (card) {
        setMessages(prev => prev.map(m => m.id === id
          ? { ...m, text: "", streaming: false, cardType: "roadmap", card }
          : m));
      } else {
        // Show raw text if parse fails
        setMessages(prev => prev.map(m => m.id === id ? { ...m, text: fullText, streaming: false } : m));
      }
    } else {
      const tag = `EPISODE_CARD_${arcNum ?? 1}`;
      const re = new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${tag}\\]`);
      const match = fullText.match(re);
      let card: EpisodeCard | null = null;
      try { if (match) card = JSON.parse(match[1]) as EpisodeCard; } catch { /* ignore */ }
      if (card) {
        setMessages(prev => prev.map(m => m.id === id
          ? { ...m, text: "", streaming: false, cardType: "episode", card }
          : m));
      } else {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, text: "에피소드 생성 완료 (파싱 오류)", streaming: false } : m));
      }
    }
    return fullText;
  }, []);

  const startRoadmap = useCallback(async () => {
    const apiKey = getAnthropicKey();
    if (!apiKey) {
      setApiError("ANTHROPIC_API_KEY가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력해주세요.");
      return;
    }
    setApiError(null);
    setStage("chat");
    setBusy(true);
    setMessages([]);
    setRoadmapDone(false);

    // Build context from Phase 1+2
    let context = `장르: ${genre}`;
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.concept) context += `\n기획 아이디어: ${p1.input.concept}`;
      if (p1?.data?.summary) context += `\nPhase 1 요약: ${p1.data.summary}`;
      const p2 = JSON.parse(localStorage.getItem(`wts_phase2_${projectId}`) ?? "null");
      if (p2?.data?.world) context += `\n세계관: ${p2.data.world.era} / ${p2.data.world.atmosphere}`;
    } catch { /* ignore */ }

    try {
      // ── 1. Researcher analysis ──
      const researchText = await streamText(
        "researcher",
        buildResearcherPrompt(genre, context),
        [{ role: "user", content: `${genre} 장르 웹툰의 장기 연재 전략을 분석해주세요.` }],
        apiKey,
      );

      // ── 2. Roadmap overview ──
      const roadmapText = await streamCard(
        "scenario",
        buildRoadmapPrompt(genre, context, researchText.slice(0, 300)),
        [{ role: "user", content: "100화 4막 구조 로드맵 개요를 작성해주세요." }],
        apiKey,
        "roadmap",
      );

      // Parse roadmap for arc info
      let roadmapData: RoadmapCard | null = null;
      try {
        const m = roadmapText.match(/\[ROADMAP_CARD\]\s*([\s\S]*?)\s*\[\/ROADMAP_CARD\]/);
        if (m) roadmapData = JSON.parse(m[1]) as RoadmapCard;
      } catch { /* ignore */ }

      const arcSummary = roadmapData
        ? roadmapData.arcs.map(a => `${a.num}막: ${a.name} (${a.theme})`).join(", ")
        : "4막 구조 로드맵 완성";

      // ── 3. Episodes per arc (4 calls) ──
      for (let arcNum = 1; arcNum <= 4; arcNum++) {
        const arc = roadmapData?.arcs[arcNum - 1];
        const arcName = arc?.name ?? `${arcNum}막`;
        const arcTheme = arc?.theme ?? "전개";
        const epsRange: [number, number] = arc?.eps ?? [(arcNum - 1) * 25 + 1, arcNum * 25];

        await streamCard(
          "scenario",
          buildEpisodePrompt(arcNum, arcName, arcTheme, epsRange, genre, context, arcSummary),
          [{ role: "user", content: `${arcNum}막 (EP ${epsRange[0]}–${epsRange[1]}) 에피소드 목록을 생성해주세요.` }],
          apiKey,
          "episode",
          arcNum,
        );
      }

      // ── 4. Producer sign-off ──
      contextRef.current = `${context}\n로드맵: ${arcSummary}`;
      await streamText(
        "producer",
        buildProducerSignoffPrompt(genre, contextRef.current),
        [{ role: "user", content: "100화 로드맵 검토 및 Phase 4 안내를 부탁합니다." }],
        apiKey,
      );

      setRoadmapDone(true);
      localStorage.setItem(`wts_phase3_done_${projectId}`, JSON.stringify({ savedAt: new Date().toISOString() }));
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = raw.includes("401") || raw.includes("authentication")
        ? "API 키가 유효하지 않습니다. 설정 페이지에서 키를 다시 확인해주세요."
        : `API 오류: ${raw}`;
      setApiError(msg);
    } finally {
      setBusy(false);
    }
  }, [genre, projectId, streamText, streamCard]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    const apiKey = getAnthropicKey();
    if (!apiKey) { setApiError("ANTHROPIC_API_KEY가 설정되지 않았습니다."); return; }

    setApiError(null);
    setInput("");
    setMessages(prev => [...prev, { id: uid(), agent: "user", text, streaming: false }]);
    setBusy(true);

    try {
      await streamText(
        "producer",
        buildProducerFollowupPrompt(contextRef.current),
        [{ role: "user", content: text }],
        apiKey,
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setApiError(raw.includes("401") ? "API 키가 유효하지 않습니다." : `API 오류: ${raw}`);
    } finally {
      setBusy(false);
    }
  }, [input, busy, streamText]);

  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>Phase 3 — 100화 시리즈 로드맵</h1>

      {stage === "idle" && (
        <div className={s.idleWrap}>
          {apiError && (
            <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "#f87171" }}>
              ⚠ {apiError}
            </div>
          )}
          <div className={s.idleCard}>
            <div className={s.idleIcon}>🗺</div>
            <div className={s.idleTitle}>100화 로드맵 자동 설계</div>
            <div className={s.idleDesc}>
              심층 조사자 · 시나리오 작가 · 총괄 프로듀서가 협업하여<br />
              4막 구조 100화 에피소드 — 제목·핵심사건·감정곡선·복선·클리프행어를 자동 생성합니다.
            </div>
            <button className={s.btnStart} onClick={startRoadmap}>
              ✦ 로드맵 생성 시작
            </button>
          </div>
        </div>
      )}

      {stage === "chat" && (
        <div className={s.chatLayout}>
          {apiError && (
            <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", margin: "12px 20px 0", borderRadius: 10, padding: "10px 16px", fontSize: 13, color: "#f87171", display: "flex", alignItems: "center", gap: 8 }}>
              <span>⚠</span><span>{apiError}</span>
              <a href="/settings" style={{ marginLeft: "auto", color: "#f87171", textDecoration: "underline", whiteSpace: "nowrap" }}>설정으로 이동</a>
            </div>
          )}

          <div className={s.chatBody}>
            {messages.map(msg => <MsgBubble key={msg.id} msg={msg} />)}
            <div ref={bottomRef} />
          </div>

          {roadmapDone && (
            <div className={s.gatingRow}>
              <div className={s.gatingBanner}>
                <div className={s.gatingText}>
                  <strong>✓ 100화 로드맵 완성</strong>
                  <span>특정 화 수정: "N화 수정: [의견]" · Phase 4에서 첫 화 대본을 작성합니다</span>
                </div>
                <button className={s.btnGating} onClick={() => router.push(`/projects/${projectId}/phase-4`)}>
                  Phase 4 시작 →
                </button>
              </div>
            </div>
          )}

          <div className={s.chatInputRow}>
            <textarea
              className={s.chatInput}
              placeholder={`특정 화 수정: "N화 수정: 내용" / 전체 의견 자유롭게 입력`}
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={busy}
              rows={1}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            />
            <button className={s.btnSend} onClick={sendMessage} disabled={busy || !input.trim()}>
              전송
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
