"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import s from "./page.module.css";
import { streamClaude, getAnthropicKey, getAnthropicKeyByIndex, getAllAnthropicKeys, WEB_SEARCH_TOOL } from "@/lib/claude-client";

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = {
  scenario:     { label: "시나리오작가",   color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  ini: "시" },
  researcher:   { label: "심층조사자",     color: "#34d399", bg: "rgba(52,211,153,0.12)",  ini: "조" },
  worldbuilder: { label: "세계관설계자",   color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  ini: "세" },
  producer:     { label: "총괄프로듀서",   color: "#f1f5f9", bg: "rgba(241,245,249,0.12)", ini: "총" },
  editor:       { label: "편집자",         color: "#fb923c", bg: "rgba(251,146,60,0.10)",  ini: "편" },
  user:         { label: "나",             color: "#7c6cfc", bg: "rgba(124,108,252,0.12)", ini: "나" },
} as const;
type AgentId = keyof typeof AGENTS;

const NAME_TO_AGENT: Record<string, AgentId> = {
  "시나리오작가": "scenario",
  "심층조사자":   "researcher",
  "세계관설계자": "worldbuilder",
  "총괄프로듀서": "producer",
  "편집자":       "editor",
  "사용자":       "user",
};

// ─── 에이전트 페어링 (각 쌍이 하나의 API 키 공유) ─────────────────────────────
const AGENT_PAIRS_P3: Array<AgentId[]> = [
  ["scenario", "researcher"],  // Pair 1 (Key 1)
  ["worldbuilder", "producer"], // Pair 2 (Key 2)
];

// API 키 할당 (페어 인덱스 → 키 인덱스)
function getApiKeyIndexForPair(pairIndex: number): number {
  const keys = getAllAnthropicKeys();
  if (keys.length === 0) return 0;
  return (pairIndex % Math.max(1, keys.length)) + 1;
}

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
  id: string;
  agent: AgentId;
  text: string;
  type: "text" | "card";
  streaming: boolean;
  round?: number;
  card?: EpisodeCard | RoadmapCard;
  cardType?: "episode" | "roadmap";
}

type DebatePhase = "idle" | "running" | "paused" | "generating" | "done";

const ARC_COLORS = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6"];

function uid() { return Math.random().toString(36).slice(2, 10); }

// ─── Debate system prompt ─────────────────────────────────────────────────────

const DEBATE_SYSTEM_PROMPT = `너는 웹툰 기획팀 전문가 4명이 참여하는 Phase 3 100화 시리즈 로드맵 회의를 진행한다.
Phase 1·2에서 확정된 기획·세계관을 바탕으로 100화 에피소드 구조를 함께 설계한다.

### 참여자와 성격
- [시나리오작가]: 서사 설계 전문. "1막이 25화인데 독자를 붙잡으려면 5화마다 훅이 있어야 해요." 스타일.
- [심층조사자]: 데이터 기반. "비슷한 장르 성공작들 보면 2막에서 주인공 위기가 꼭 와요." 스타일.
- [세계관설계자]: 설정 일관성 집착. "그 에피소드, 세계관 규칙이랑 충돌하는데요." 스타일.
- [총괄프로듀서]: 중재·합의 유도. 갈등 정리 역할.
- [편집자]: 베테랑 편집자. 평소 침묵. 토론이 길어지면 앞 대화를 직접 인용하며 마무리를 유도한다.

### 출력 형식
[이름]: 대사

### 출력 규칙 (반드시 준수)
- 매 응답마다 직전 발언을 읽고, 그 내용에 직접 반응하는 사람 1명만 말한다.
- 반드시 앞 발언을 인식했음을 드러내야 한다. ("방금 말씀처럼..." "맞아요, 근데...")
- 각 대사는 1~2문장. 마크다운(#, *, >, -) 절대 금지.
- 카카오톡 메시지처럼 짧고 자연스러운 한국어.
- [사용자]: 가 발언하면 반드시 그 내용에 직접 반응한다.
- JSON 블록, [ROADMAP_CARD] 같은 출력 절대 금지. 오직 대화만.

### 편집자 등장 조건
- [시스템: 마무리 단계] 신호가 오면 편집자가 앞 대화의 실제 발언을 언급하며 정리를 유도한다.`;

// ─── Card generation prompts (run AFTER conversation ends) ────────────────────

function buildRoadmapGenPrompt(genre: string, debateContext: string): string {
  return `당신은 AI Webtoon Studio 시나리오 작가입니다. Phase 3 100화 4막 로드맵 카드를 생성합니다.

토론 결과:
${debateContext.slice(0, 2000)}

장르: ${genre}

위 토론에서 결정된 내용을 바탕으로 4막 구조 로드맵 JSON을 생성하세요.
반드시 아래 형식으로 출력하세요:

[ROADMAP_CARD]
{"arcs":[{"num":1,"name":"막 이름","theme":"핵심 테마","eps":[1,25],"color":"#60a5fa"},{"num":2,"name":"막 이름","theme":"핵심 테마","eps":[26,50],"color":"#34d399"},{"num":3,"name":"막 이름","theme":"핵심 테마","eps":[51,75],"color":"#fbbf24"},{"num":4,"name":"막 이름","theme":"핵심 테마","eps":[76,100],"color":"#f472b6"}],"totalEps":100}
[/ROADMAP_CARD]`;
}

function buildEpisodeGenPrompt(
  arcNum: number, arcName: string, arcTheme: string, epsRange: [number, number],
  genre: string, debateContext: string,
): string {
  const arcColor = ARC_COLORS[arcNum - 1];
  return `당신은 AI Webtoon Studio 시나리오 작가입니다. ${arcNum}막 에피소드 카드를 생성합니다.

토론 결과: ${debateContext.slice(0, 1000)}
장르: ${genre}
담당 막: ${arcNum}막 "${arcName}" — ${arcTheme} (EP ${epsRange[0]}–${epsRange[1]})

EP ${epsRange[0]}~${epsRange[1]} 총 25화를 정확히 생성하세요. tension은 1(저)~5(고).

[EPISODE_CARD_${arcNum}]
{"episodes":[{"ep":${epsRange[0]},"title":"화 제목","event":"핵심 사건","characters":["주인공"],"emotion":"감정 키워드","foreshadow":"","cliffhanger":"","arc":${arcNum},"tension":3}],"arcLabel":"${arcNum}막 — ${arcName}","arcColor":"${arcColor}"}
[/EPISODE_CARD_${arcNum}]

정확히 25개 에피소드 객체 생성. JSON만 출력.`;
}

// ─── Parse [이름]: 대사 format ────────────────────────────────────────────────

function parseAgentMessages(text: string): Array<{ agentId: AgentId; text: string }> {
  const lines = text.split(/\n/);
  const results: Array<{ agentId: AgentId; text: string }> = [];
  let current: { agentId: AgentId; lines: string[] } | null = null;
  for (const line of lines) {
    const match = line.match(/^\[([^\]]+)\]:\s*([\s\S]*)/);
    if (match) {
      if (current && current.lines.join(" ").trim())
        results.push({ agentId: current.agentId, text: current.lines.join(" ").trim() });
      const name = match[1].trim();
      const agentId = NAME_TO_AGENT[name] ?? "producer";
      current = { agentId, lines: [match[2]] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current && current.lines.join(" ").trim())
    results.push({ agentId: current.agentId, text: current.lines.join(" ").trim() });
  return results;
}

function parseBlock<T>(text: string, tag: string): T | null {
  const re = new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${tag}\\]`);
  const m = text.match(re);
  if (!m) return null;
  try { return JSON.parse(m[1]) as T; } catch { return null; }
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

function MsgBubble({ msg }: { key?: string; msg: Msg }) {
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
          {cfg.ini}
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

  const [debatePhase, setDebatePhase] = useState<DebatePhase>("idle");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [genre, setGenre] = useState("판타지");
  const [roadmapDone, setRoadmapDone] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<string>("");
  const runningRef = useRef(false);
  const savedConvRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);

  // ── Restore on mount ──
  useEffect(() => {
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.genre) setGenre(p1.input.genre);

      const savedConv = localStorage.getItem(`p3_conv_${projectId}`);
      if (savedConv) savedConvRef.current = JSON.parse(savedConv);

      const savedMsgs = localStorage.getItem(`p3_msgs_${projectId}`);
      const hasMsgs = savedMsgs && JSON.parse(savedMsgs).length > 0;
      if (savedMsgs) setMsgs(JSON.parse(savedMsgs));

      // Check if cards were already generated
      const saved = localStorage.getItem(`wts_phase3_${projectId}`);
      if (saved) {
        const data = JSON.parse(saved) as { roadmapCard?: RoadmapCard; episodeCards?: EpisodeCard[]; context?: string };
        const cards: Msg[] = [];
        if (data.roadmapCard) cards.push({ id: uid(), agent: "scenario", text: "", type: "card", cardType: "roadmap", card: data.roadmapCard, streaming: false });
        data.episodeCards?.forEach(ec => cards.push({ id: uid(), agent: "scenario", text: "", type: "card", cardType: "episode", card: ec, streaming: false }));
        if (cards.length > 0) {
          setMsgs((prev: Msg[]) => [...prev, ...cards]);
          setRoadmapDone(true);
          setDebatePhase("done");
          if (data.context) contextRef.current = data.context;
          return;
        }
      }
      if (hasMsgs) setDebatePhase("paused");
    } catch { /* ignore */ }
  }, [projectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // Auto-save msgs when streaming is done
  useEffect(() => {
    if (!projectId || msgs.length === 0) return;
    if (msgs.some((m: Msg) => m.streaming)) return;
    const textOnly = msgs.filter((m: Msg) => m.type === "text");
    if (textOnly.length > 0) localStorage.setItem(`p3_msgs_${projectId}`, JSON.stringify(msgs));
  }, [msgs, projectId]);

  useEffect(() => {
    const id = "wts-blink-style";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id;
      el.textContent = "@keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }";
      document.head.appendChild(el);
    }
  }, []);

  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  const addMsg = useCallback((agent: AgentId, round: number, text = "", streaming = false, type: "text" | "card" = "text", cardType?: "roadmap" | "episode"): string => {
    const id = uid();
    setMsgs((prev: Msg[]) => [...prev, { id, agent, text, type, cardType, streaming, round }]);
    return id;
  }, []);

  const updateMsg = useCallback((id: string, text: string, streaming: boolean, extra?: Partial<Msg>) => {
    setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === id ? { ...m, text, streaming, ...extra } : m));
  }, []);

  // ── Card generation (runs AFTER debate ends) ──
  const generateRoadmap = useCallback(async (apiKey: string, debateContext: string) => {
    setDebatePhase("generating");

    let phase1Summary = `장르: ${genre}`;
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.concept) phase1Summary += `\n기획: ${p1.input.concept}`;
      if (p1?.data?.summary) phase1Summary += `\nPhase1 요약: ${p1.data.summary}`;
      const p2 = JSON.parse(localStorage.getItem(`wts_phase2_${projectId}`) ?? "null");
      if (p2?.world?.era) phase1Summary += `\n세계관: ${p2.world.era}`;
    } catch { /* ignore */ }

    const context = `${phase1Summary}\n\n[토론 내용]\n${debateContext.slice(0, 2000)}`;

    // ── 1. Roadmap card ──
    const rmId = addMsg("scenario", 0, "로드맵 생성 중...", true, "card", "roadmap");
    let rmText = "";
    for await (const chunk of streamClaude({ apiKey, systemPrompt: buildRoadmapGenPrompt(genre, context), messages: [{ role: "user", content: "100화 4막 로드맵을 생성해주세요." }], maxTokens: 1500 })) {
      rmText += chunk;
      updateMsg(rmId, `로드맵 생성 중... (${rmText.length}자)`, true);
    }
    const roadmapCard = parseBlock<RoadmapCard>(rmText, "ROADMAP_CARD");
    if (roadmapCard) {
      updateMsg(rmId, "", false, { type: "card", cardType: "roadmap", card: roadmapCard });
    } else {
      updateMsg(rmId, rmText, false, { type: "text" });
    }

    // ── 2. Episode cards (4 arcs) ──
    const episodeCards: EpisodeCard[] = [];
    for (let arcNum = 1; arcNum <= 4; arcNum++) {
      const arc = roadmapCard?.arcs[arcNum - 1];
      const arcName = arc?.name ?? `${arcNum}막`;
      const arcTheme = arc?.theme ?? "전개";
      const epsRange: [number, number] = arc?.eps ?? [(arcNum - 1) * 25 + 1, arcNum * 25];

      const epId = addMsg("scenario", 0, `${arcNum}막 에피소드 생성 중...`, true, "card", "episode");
      let epText = "";
      for await (const chunk of streamClaude({ apiKey, systemPrompt: buildEpisodeGenPrompt(arcNum, arcName, arcTheme, epsRange, genre, context), messages: [{ role: "user", content: `${arcNum}막 에피소드를 생성해주세요.` }], maxTokens: 8000 })) {
        epText += chunk;
        const cnt = (epText.match(/"ep":/g) ?? []).length;
        if (cnt > 0) updateMsg(epId, `${arcNum}막 에피소드 생성 중... (${cnt}/25화)`, true);
      }
      const epCard = parseBlock<EpisodeCard>(epText, `EPISODE_CARD_${arcNum}`);
      if (epCard) {
        episodeCards.push(epCard);
        updateMsg(epId, "", false, { type: "card", cardType: "episode", card: epCard });
      } else {
        updateMsg(epId, epText, false, { type: "text" });
      }
      await sleep(300);
    }

    // ── Save ──
    const arcSummary = roadmapCard ? roadmapCard.arcs.map(a => `${a.num}막: ${a.name}`).join(", ") : "";
    contextRef.current = `${phase1Summary}\n로드맵: ${arcSummary}`;
    localStorage.setItem(`wts_phase3_${projectId}`, JSON.stringify({
      roadmapCard, episodeCards, context: contextRef.current, genre,
    }));
    setRoadmapDone(true);
    setDebatePhase("done");
  }, [genre, projectId, addMsg, updateMsg]);

  // ── Debate loop ──
  const runDebate = useCallback(async (resumeConv?: Array<{ role: "user" | "assistant"; content: string }>) => {
    const apiKey = getAnthropicKey();
    if (!apiKey) { setApiError("ANTHROPIC_API_KEY가 설정되지 않았습니다."); return; }
    if (runningRef.current) return;

    runningRef.current = true;
    setDebatePhase("running");
    setApiError(null);

    let context = `장르: ${genre}`;
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.concept) context += `\n기획: ${p1.input.concept}`;
      if (p1?.data?.summary) context += `\nPhase 1 요약: ${p1.data.summary}`;
      const p2 = JSON.parse(localStorage.getItem(`wts_phase2_${projectId}`) ?? "null");
      if (p2?.world?.era) context += `\n세계관: ${p2.world.era} / ${p2.world?.atmosphere ?? ""}`;
    } catch { /* ignore */ }
    contextRef.current = context;

    const convHistory: Array<{ role: "user" | "assistant"; content: string }> =
      resumeConv ?? savedConvRef.current ?? [];

    if (convHistory.length === 0) {
      convHistory.push({ role: "user", content: `Phase 3 시작. ${context}\n\n100화 시리즈 로드맵을 함께 설계해봅시다. 4막 구조로 각 막 25화씩 구성합니다.` });
    }

    const END_TRIGGERS = ["정리하자", "확정하자", "로드맵 만들어", "에피소드 생성", "끝내자", "결정하자", "카드 만들어"];
    let round = 0;

    try {
      while (runningRef.current) {
        round++;
        setTurnCount(round);

        // ── Sliding window every 10 rounds ──
        if (round > 1 && round % 10 === 0 && convHistory.length > 10) {
          const toCompress = convHistory.splice(0, convHistory.length - 6);
          const summaryText = toCompress.map(m => m.content).join("\n").slice(0, 3000);
          const compressRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
            body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 500, messages: [{ role: "user", content: `다음 토론을 200자로 요약하세요:\n${summaryText}` }] }),
          });
          if (compressRes.ok) {
            const compressData = await compressRes.json() as { content: Array<{ text: string }> };
            const summary = compressData.content[0]?.text ?? "";
            convHistory.unshift({ role: "user", content: `[이전 토론 요약] ${summary}` });
          }
          localStorage.setItem(`p3_conv_${projectId}`, JSON.stringify(convHistory));
          savedConvRef.current = convHistory;
        }

        // ── Editor at round 80 ──
        if (round === 80) {
          const recentLines = convHistory.slice(-6).map(m => m.content.slice(0, 100)).join(" / ");
          convHistory.push({ role: "user", content: `[시스템: 마무리 단계] 편집자가 앞 토론("${recentLines}")을 인용하며 마무리를 유도한다.` });
        }

        const systemWithCtx = DEBATE_SYSTEM_PROMPT + `\n\n### 프로젝트 컨텍스트\n${context}`;
        const id = addMsg("producer", round, "", true);

        let fullText = "";
        for await (const chunk of streamClaude({ apiKey, systemPrompt: systemWithCtx, messages: convHistory, maxTokens: 300, tools: [{ ...WEB_SEARCH_TOOL, allowed_callers: ["direct"] }] })) {
          fullText += chunk;
          updateMsg(id, fullText, true);
        }

        if (!fullText.trim()) { updateMsg(id, "...", false); break; }

        // Parse [이름]: lines
        const parsed = parseAgentMessages(fullText);
        if (parsed.length > 0) {
          updateMsg(id, parsed[0].text, false, { agent: parsed[0].agentId });
          for (let i = 1; i < parsed.length; i++) {
            addMsg(parsed[i].agentId, round, parsed[i].text, false);
          }
        } else {
          updateMsg(id, fullText, false);
        }

        convHistory.push({ role: "assistant", content: fullText });
        localStorage.setItem(`p3_conv_${projectId}`, JSON.stringify(convHistory));
        savedConvRef.current = convHistory;

        // ── Check END triggers ──
        if (END_TRIGGERS.some(t => fullText.includes(t))) break;
        if (round > 100) break;

        await sleep(400);

        // ── Pending user message ──
        const pendingKey = `p3_pending_${projectId}`;
        const pending = localStorage.getItem(pendingKey);
        if (pending) {
          localStorage.removeItem(pendingKey);
          convHistory.push({ role: "user", content: pending });
          addMsg("user", round, pending, false);
        }
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setApiError(raw.includes("401") ? "API 키가 유효하지 않습니다." : `API 오류: ${raw}`);
    }

    runningRef.current = false;
    if (debatePhase !== "done") {
      const debateText = convHistory.map(m => m.content).join("\n");
      await generateRoadmap(apiKey, debateText);
    }
  }, [genre, projectId, addMsg, updateMsg, generateRoadmap]);

  const handleSendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    addMsg("user", turnCount, text, false);

    if (runningRef.current) {
      localStorage.setItem(`p3_pending_${projectId}`, text);
    } else if (debatePhase === "paused" || debatePhase === "running") {
      savedConvRef.current.push({ role: "user", content: text });
      await runDebate(savedConvRef.current);
    }
  }, [chatInput, turnCount, projectId, debatePhase, addMsg, runDebate]);

  const handleRestartNew = useCallback(() => {
    localStorage.removeItem(`p3_msgs_${projectId}`);
    localStorage.removeItem(`p3_conv_${projectId}`);
    localStorage.removeItem(`wts_phase3_${projectId}`);
    savedConvRef.current = [];
    setMsgs([]); setRoadmapDone(false); setApiError(null);
    setDebatePhase("idle"); setTurnCount(0);
    runningRef.current = false;
  }, [projectId]);

  if (debatePhase === "idle") {
    return (
      <div className={s.page}>
        <div className={s.formWrap}>
          <h1 className={s.formTitle}>Phase 3 — 100화 시리즈 로드맵</h1>
          <p className={s.formDesc}>에이전트들이 자유 토론으로 100화 4막 구조 로드맵과 에피소드를 함께 설계합니다.</p>
          {apiError && <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "#f87171" }}>⚠ {apiError}</div>}
          <div className={s.formCard}>
            <div className={s.prereqNote}>Phase 1·2 기획·세계관 데이터를 자동으로 불러옵니다.</div>
            <button className={s.btnStart} onClick={() => runDebate()}>✦ 로드맵 설계 토론 시작</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <div className={s.chatLayout}>
        {/* Header */}
        <div className={s.chatHeader}>
          <span className={s.chatHeaderTitle}>Phase 3 — 100화 시리즈 로드맵</span>
          <span className={s.turnBadge}>{turnCount}턴</span>
          {debatePhase === "running" && <span className={s.liveDot} />}
          {debatePhase === "generating" && <span style={{ fontSize: 12, color: "#fbbf24", marginLeft: 8 }}>🗺 로드맵 생성 중...</span>}
        </div>

        {/* Paused resume */}
        {debatePhase === "paused" && (
          <div style={{ display: "flex", gap: 8, padding: "10px 20px", background: "rgba(251,146,60,0.08)", borderBottom: "1px solid rgba(251,146,60,0.2)" }}>
            <span style={{ fontSize: 13, color: "#fb923c", flex: 1 }}>⏸ 토론 일시중지 — 이어서 진행할 수 있습니다</span>
            <button className={s.btnStart} style={{ padding: "4px 14px", fontSize: 13 }} onClick={() => runDebate(savedConvRef.current)}>토론 계속하기</button>
            <button className={s.btnGatingSecondary} style={{ padding: "4px 14px", fontSize: 13 }} onClick={handleRestartNew}>새로 시작</button>
          </div>
        )}

        {apiError && (
          <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", margin: "8px 16px", borderRadius: 8, padding: "8px 14px", fontSize: 13, color: "#f87171" }}>
            ⚠ {apiError}
          </div>
        )}

        <div className={s.chatBody}>
          {msgs.map((msg: Msg) => <MsgBubble key={msg.id} msg={msg} />)}
          <div ref={bottomRef} />
        </div>

        {/* Gating when done */}
        {roadmapDone && debatePhase === "done" && (
          <div className={s.gatingRow}>
            <div className={s.gatingBanner}>
              <div className={s.gatingText}>
                <strong>✓ 100화 로드맵 완성</strong>
                <span>특정 화 수정: "N화 수정: [의견]" · Phase 4에서 첫 화 대본을 작성합니다</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className={s.btnGatingSecondary} onClick={() => {
                  const saved = localStorage.getItem(`wts_phase3_${projectId}`);
                  if (!saved) return;
                  const data = JSON.parse(saved) as { roadmapCard: RoadmapCard; episodeCards: EpisodeCard[]; genre: string };
                  const allEps = (data.episodeCards ?? []).flatMap(ec => ec.episodes).sort((a, b) => a.ep - b.ep);
                  const lines = [
                    `[${data.genre} 웹툰] 100화 로드맵`,
                    `생성일: ${new Date().toLocaleDateString("ko-KR")}`, "",
                    ...(data.roadmapCard?.arcs ?? []).map(a => `■ ${a.num}막 "${a.name}" (EP ${a.eps[0]}~${a.eps[1]}) — ${a.theme}`), "",
                    ...allEps.map(ep => `${String(ep.ep).padStart(3, " ")}화 | ${ep.title}\n     → ${ep.event} | 감정: ${ep.emotion}${ep.cliffhanger ? ` | 클리프행어: ${ep.cliffhanger}` : ""}`),
                  ];
                  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = `roadmap_${projectId}.txt`; a.click(); URL.revokeObjectURL(url);
                }}>📄 텍스트 내보내기</button>
                <button className={s.btnGatingSecondary} onClick={() => {
                  const saved = localStorage.getItem(`wts_phase3_${projectId}`);
                  if (!saved) return;
                  const data = JSON.parse(saved) as { roadmapCard: RoadmapCard; episodeCards: EpisodeCard[]; genre: string };
                  const allEps = (data.episodeCards ?? []).flatMap(ec => ec.episodes).sort((a, b) => a.ep - b.ep);
                  const blob = new Blob([JSON.stringify({ genre: data.genre, arcs: data.roadmapCard?.arcs, episodes: allEps }, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = `roadmap_${projectId}.json`; a.click(); URL.revokeObjectURL(url);
                }}>📥 JSON 내보내기</button>
                <button className={s.btnGatingSecondary} onClick={handleRestartNew}>재생성</button>
                <button className={s.btnGating} onClick={() => router.push(`/projects/${projectId}/phase-4`)}>Phase 4 시작 →</button>
              </div>
            </div>
          </div>
        )}

        {/* Chat input */}
        {(debatePhase === "running" || debatePhase === "paused") && (
          <div className={s.chatInputRow}>
            <textarea
              className={s.chatInput}
              placeholder={`의견을 입력하세요 · "정리하자"로 카드 생성`}
              value={chatInput}
              onChange={(e: { target: HTMLTextAreaElement }) => setChatInput(e.target.value)}
              rows={1}
              onKeyDown={(e: { key: string; shiftKey: boolean; preventDefault: () => void }) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSendChat(); } }}
            />
            <button className={s.btnSend} onClick={() => void handleSendChat()} disabled={!chatInput.trim()}>전송</button>
          </div>
        )}
      </div>
    </div>
  );
}
