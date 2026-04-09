"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import s from "./page.module.css";
import { streamClaude, getAnthropicKey, WEB_SEARCH_TOOL } from "@/lib/claude-client";

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = {
  worldbuilder: { label: "세계관 설계자",   color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  ini: "세" },
  character:    { label: "캐릭터 디자이너", color: "#fb923c", bg: "rgba(251,146,60,0.12)",  ini: "캐" },
  producer:     { label: "총괄 프로듀서",   color: "#f1f5f9", bg: "rgba(241,245,249,0.12)", ini: "총" },
  user:         { label: "나",              color: "#7c6cfc", bg: "rgba(124,108,252,0.12)", ini: "나" },
} as const;
type AgentId = keyof typeof AGENTS;

// ─── Types ────────────────────────────────────────────────────────────────────

interface CharSheet {
  name: string; role: string;
  appearance: { face: string; eyes: string; nose: string; mouth: string; hair: string; body: string; outfit: string };
  personality: string; speech: string; abilities: string[]; trauma: string;
}
interface WorldCard { era: string; atmosphere: string; rules: string[] }
interface MstCard {
  line_weight: string; coloring: string; perspective: string;
  forbidden_tags: string[]; style_keywords: string[];
}
interface AbCard { options: Array<{ label: string; style: string; keywords: string[]; desc: string }>; chosen?: string }

type CardType = "world" | "character" | "mst" | "ab";

interface Msg {
  id: string;
  agent: AgentId;
  text: string;
  type: "text" | "card";
  cardType?: CardType;
  world?: WorldCard;
  character?: CharSheet;
  mst?: MstCard;
  ab?: AbCard;
  streaming: boolean;
}

function uid() { return Math.random().toString(36).slice(2, 10); }

// ─── JSON block parsers ───────────────────────────────────────────────────────

function parseBlock<T>(text: string, tag: string): T | null {
  const re = new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${tag}\\]`);
  const m = text.match(re);
  if (!m) return null;
  try { return JSON.parse(m[1]) as T; } catch { return null; }
}

function stripBlocks(text: string): string {
  return text
    .replace(/\[WORLD_CARD\][\s\S]*?\[\/WORLD_CARD\]/g, "")
    .replace(/\[CHAR_CARD\][\s\S]*?\[\/CHAR_CARD\]/g, "")
    .replace(/\[MST_CARD\][\s\S]*?\[\/MST_CARD\]/g, "")
    .replace(/\[AB_CARD\][\s\S]*?\[\/AB_CARD\]/g, "")
    .trim();
}

// ─── System prompts ───────────────────────────────────────────────────────────

function buildWorldbuilderPrompt(genre: string, phase1Summary: string): string {
  return `당신은 AI Webtoon Studio 세계관 설계자(agent_worldbuilder)입니다. Phase 2 세계관 설계를 담당합니다.

Phase 1 기획 정보:
- 장르: ${genre}
- 요약: ${phase1Summary}

역할:
- 웹 검색으로 ${genre} 장르 웹툰의 세계관 트렌드, 인기 배경 설정을 조사합니다
- 독자가 몰입할 수 있는 구체적이고 독창적인 세계관을 설계합니다
- 세계관의 핵심 규칙 3가지를 논리적으로 수립합니다

말투: 전문적이고 창의적. 자연스러운 한국어. 분량: 150~200자 설명 후 JSON.

⚠️ 응답 마지막에 반드시 아래 형식으로 JSON 블록을 포함하세요:

[WORLD_CARD]
{"era":"시대/배경 설명","atmosphere":"분위기 설명","rules":["규칙1","규칙2","규칙3"]}
[/WORLD_CARD]`;
}

function buildCharacterPrompt(
  role: "protagonist" | "antagonist",
  genre: string,
  worldSummary: string,
  phase1Summary: string,
): string {
  const roleKo = role === "protagonist" ? "주인공" : "빌런(조력자)";
  return `당신은 AI Webtoon Studio 캐릭터 디자이너(agent_character)입니다. Phase 2 캐릭터 설계를 담당합니다.

Phase 1 기획: ${phase1Summary}
확정 세계관: ${worldSummary}
장르: ${genre}

역할:
- 이미지 생성 AI가 일관된 결과를 낼 수 있도록 ${roleKo} 외형을 초정밀하게 정의합니다
- 외형 묘사는 face/eyes/nose/mouth/hair/body/outfit 각각 구체적으로 작성합니다
- 심리적 깊이가 있는 성격·말투·트라우마를 설정합니다

말투: 전문적이고 창의적. 자연스러운 한국어. 분량: 100~150자 설명 후 JSON.

⚠️ 응답 마지막에 반드시 아래 형식으로 JSON 블록을 포함하세요:

[CHAR_CARD]
{"name":"캐릭터 이름 (${roleKo})","role":"${role}","appearance":{"face":"얼굴형 묘사","eyes":"눈 묘사","nose":"코 묘사","mouth":"입 묘사","hair":"헤어 묘사","body":"체형/키/체중","outfit":"의상 묘사"},"personality":"성격","speech":"말투 특징","abilities":["능력1","능력2","능력3"],"trauma":"트라우마"}
[/CHAR_CARD]`;
}

function buildMstPrompt(genre: string, worldSummary: string, charsSummary: string): string {
  return `당신은 AI Webtoon Studio 캐릭터 디자이너(agent_character)입니다. MST(마스터 스타일 토큰) 설계를 담당합니다.

장르: ${genre}
세계관: ${worldSummary}
핵심 캐릭터: ${charsSummary}

역할:
- 웹 검색으로 ${genre} 장르 웹툰의 화풍 트렌드를 조사합니다
- 이미지 생성 시 일관된 화풍을 유지하기 위한 MST를 정의합니다
- 금지 태그는 화풍을 해치는 요소들을 명확히 지정합니다
- 스타일 키워드는 모든 이미지 생성에 자동 적용됩니다

말투: 전문적이고 구체적. 자연스러운 한국어. 분량: 100~150자 설명 후 JSON.

⚠️ 응답 마지막에 반드시 아래 형식으로 JSON 블록을 포함하세요:

[MST_CARD]
{"line_weight":"선 두께 규칙","coloring":"채색 방식","perspective":"원근감/앵글 규칙","forbidden_tags":["금지태그1","금지태그2","금지태그3"],"style_keywords":["스타일키워드1","스타일키워드2","스타일키워드3","스타일키워드4","스타일키워드5"]}
[/MST_CARD]`;
}

function buildAbPrompt(genre: string, worldSummary: string, mstSummary: string): string {
  return `당신은 AI Webtoon Studio 세계관 설계자(agent_worldbuilder)입니다. 디자인 방향 A/B안 제안을 담당합니다.

장르: ${genre}
세계관: ${worldSummary}
MST 요약: ${mstSummary}

역할:
- 전체 작품의 비주얼 방향성을 두 가지 안으로 제안합니다
- 각 안의 타겟 독자층, 분위기, 색상 팔레트가 명확히 달라야 합니다
- 사용자가 선택할 수 있도록 각 안의 특징을 간결하게 설명합니다

말투: 친근하고 설득력 있게. 자연스러운 한국어. 분량: 80~100자 설명 후 JSON.

⚠️ 응답 마지막에 반드시 아래 형식으로 JSON 블록을 포함하세요:

[AB_CARD]
{"options":[{"label":"A안","style":"스타일명","keywords":["키워드1","키워드2","키워드3"],"desc":"A안 설명 (독자층, 분위기, 색상 팔레트 포함)"},{"label":"B안","style":"스타일명","keywords":["키워드1","키워드2","키워드3"],"desc":"B안 설명 (독자층, 분위기, 색상 팔레트 포함)"}]}
[/AB_CARD]`;
}

function buildCharacterCrossCheckPrompt(genre: string, worldSummary: string): string {
  return `당신은 AI Webtoon Studio 캐릭터 디자이너(agent_character)입니다.

세계관 설계자(agent_worldbuilder)가 방금 세계관을 완성했습니다:
${worldSummary}

세계관 설계자의 작업을 인정하며, 이 세계관에서 살아갈 캐릭터 설계 방향을 한 문장으로 예고하세요.
예: "세계관 설계자의 [핵심 규칙]을 기반으로, 이 세계에 어울리는 [캐릭터 특성]을 가진 주인공을 설계하겠습니다."
말투: 전문적이고 기대감 있게. 자연스러운 한국어. 분량: 50~80자. JSON 없음.`;
}

function buildProducerMidpointPrompt(char1Summary: string, char2Summary: string): string {
  return `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다.

캐릭터 디자이너(agent_character)가 두 캐릭터를 완성했습니다:
- ${char1Summary}
- ${char2Summary}

두 캐릭터의 대비와 서사적 긴장감을 짧게 평가하고, 다음 단계(MST 설계)를 예고하세요.
말투: 권위 있고 간결하게. 자연스러운 한국어. 분량: 60~100자. JSON 없음.`;
}

function buildWorldbuilderCrossCheckPrompt(mstSummary: string, worldSummary: string): string {
  return `당신은 AI Webtoon Studio 세계관 설계자(agent_worldbuilder)입니다.

캐릭터 디자이너(agent_character)가 MST(마스터 스타일 토큰)를 완성했습니다:
${mstSummary}

이 MST가 당신이 설계한 세계관(${worldSummary})의 분위기와 일치하는지 한 문장으로 검토하고,
디자인 방향 A/B 제안을 시작하겠다고 예고하세요.
말투: 전문적이고 확신 있게. 자연스러운 한국어. 분량: 60~100자. JSON 없음.`;
}

function buildProducerFinalPrompt(context: string): string {
  return `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다.

팀의 Phase 2 설계가 완료되었습니다:
${context}

전체 설계를 간결하게 총괄하고, 사용자에게 디자인 방향 A/B안 선택을 요청하세요.
말투: 따뜻하고 자신감 있게. 자연스러운 한국어. 분량: 80~120자. JSON 없음.`;
}

function buildProducerFollowupPrompt(context: string): string {
  return `당신은 AI Webtoon Studio 총괄 프로듀서(agent_producer)입니다.

아래는 Phase 2 세계관/에셋 설계 내역입니다:
---
${context}
---

역할: 사용자의 수정 요청이나 추가 질문에 에이전트 팀을 대표하여 응답합니다.
수정이 필요한 경우 어떤 에이전트가 어떤 부분을 수정할 수 있는지 안내하세요.
말투: 친근하지만 전문적. 자연스러운 한국어. 분량: 150~250자.`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThinkingDots() {
  return <div className={s.dots}><span /><span /><span /></div>;
}

function WorldCardView({ w }: { w: WorldCard }) {
  return (
    <div className={s.worldCard}>
      <div className={s.cardLabel} style={{ color: "#60a5fa" }}>세계관 설계</div>
      <div className={s.worldRow}><span className={s.wLabel}>시대/배경</span><span className={s.wVal}>{w.era}</span></div>
      <div className={s.worldRow}><span className={s.wLabel}>분위기</span><span className={s.wVal}>{w.atmosphere}</span></div>
      <div className={s.worldRules}>
        <div className={s.wLabel}>세계관 규칙</div>
        {w.rules.map((r, i) => <div key={i} className={s.ruleItem}>◆ {r}</div>)}
      </div>
    </div>
  );
}

function CharCardView({ c }: { c: CharSheet }) {
  const roleColor = c.role === "protagonist" ? "#a78bfa" : c.role === "antagonist" ? "#f87171" : "#60a5fa";
  const roleLabel = c.role === "protagonist" ? "주인공" : c.role === "antagonist" ? "빌런" : "조력자";
  return (
    <div className={s.charCard}>
      <div className={s.charHeader}>
        <div className={s.charName}>{c.name}</div>
        <span className={s.charRole} style={{ background: `${roleColor}20`, color: roleColor, border: `1px solid ${roleColor}40` }}>{roleLabel}</span>
      </div>
      <div className={s.charSection}>
        <div className={s.charSectionTitle} style={{ color: "#fb923c" }}>외형</div>
        <div className={s.charGrid}>
          {Object.entries(c.appearance).map(([k, v]) => (
            <div key={k} className={s.charField}>
              <span className={s.fieldKey}>{({ face: "얼굴형", eyes: "눈", nose: "코", mouth: "입", hair: "헤어", body: "체형", outfit: "의상" })[k] ?? k}</span>
              <span className={s.fieldVal}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={s.charSection}>
        <div className={s.charSectionTitle} style={{ color: "#fb923c" }}>내면</div>
        <div className={s.charField}><span className={s.fieldKey}>성격</span><span className={s.fieldVal}>{c.personality}</span></div>
        <div className={s.charField}><span className={s.fieldKey}>말투</span><span className={s.fieldVal}>{c.speech}</span></div>
        <div className={s.charField}><span className={s.fieldKey}>트라우마</span><span className={s.fieldVal}>{c.trauma}</span></div>
      </div>
      <div className={s.charSection}>
        <div className={s.charSectionTitle} style={{ color: "#fb923c" }}>능력/특기</div>
        <div className={s.abilityList}>{c.abilities.map((a, i) => <span key={i} className={s.abilityTag}>{a}</span>)}</div>
      </div>
    </div>
  );
}

function MstCardView({ m }: { m: MstCard }) {
  return (
    <div className={s.mstCard}>
      <div className={s.cardLabel} style={{ color: "#a78bfa" }}>MST — 마스터 스타일 토큰</div>
      <div className={s.mstRow}><span className={s.mLabel}>선 두께</span><code className={s.mCode}>{m.line_weight}</code></div>
      <div className={s.mstRow}><span className={s.mLabel}>채색 방식</span><code className={s.mCode}>{m.coloring}</code></div>
      <div className={s.mstRow}><span className={s.mLabel}>원근감</span><code className={s.mCode}>{m.perspective}</code></div>
      <div className={s.mstRow}>
        <span className={s.mLabel}>금지 태그</span>
        <div className={s.tagList}>{m.forbidden_tags.map((t, i) => <span key={i} className={s.tagForbid}>{t}</span>)}</div>
      </div>
      <div className={s.mstRow}>
        <span className={s.mLabel}>스타일 키워드</span>
        <div className={s.tagList}>{m.style_keywords.map((t, i) => <span key={i} className={s.tagStyle}>{t}</span>)}</div>
      </div>
    </div>
  );
}

function AbCardView({ ab, onChoose }: { ab: AbCard; onChoose: (label: string) => void }) {
  return (
    <div className={s.abWrap}>
      <div className={s.cardLabel} style={{ color: "#fbbf24" }}>디자인 방향 A/B 선택</div>
      <div className={s.abRow}>
        {ab.options.map(opt => (
          <div key={opt.label}
            className={`${s.abCard} ${ab.chosen === opt.label ? s.abChosen : ""}`}
            onClick={() => !ab.chosen && onChoose(opt.label)}>
            <div className={s.abLabel}>{opt.label}</div>
            <div className={s.abStyle}>{opt.style}</div>
            <div className={s.abDesc}>{opt.desc}</div>
            <div className={s.abKwList}>{opt.keywords.map((k, i) => <span key={i} className={s.abKw}>{k}</span>)}</div>
            {ab.chosen === opt.label && <div className={s.abCheck}>✓ 선택됨</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function StreamCursor() {
  return <span style={{ display: "inline-block", width: 2, height: 13, background: "#7c6cfc", marginLeft: 2, verticalAlign: "middle", borderRadius: 1, animation: "blink 0.9s step-start infinite" }} />;
}

function MsgBubble({ msg, onAbChoose }: { key?: string; msg: Msg; onAbChoose: (id: string, label: string) => void }) {
  const ag = AGENTS[msg.agent];
  const isUser = msg.agent === "user";
  const displayText = stripBlocks(msg.text);

  return (
    <div className={`${s.msgRow} ${isUser ? s.msgRowUser : ""}`}>
      {!isUser && (
        <div className={s.avatar} style={{ background: ag.bg, color: ag.color, border: `1px solid ${ag.color}40` }}>{ag.ini}</div>
      )}
      <div className={s.msgMain}>
        {!isUser && <div className={s.agentName} style={{ color: ag.color }}>{ag.label}</div>}
        <div className={`${s.bubble} ${isUser ? s.bubbleUser : ""}`}
          style={!isUser ? { borderLeft: `3px solid ${ag.color}60` } : {}}>
          {msg.streaming && !msg.text ? (
            <ThinkingDots />
          ) : (
            <>
              {displayText && (
                <div className={s.msgText} style={{ whiteSpace: "pre-wrap" }}>
                  <span dangerouslySetInnerHTML={{ __html: displayText.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>") }} />
                  {msg.streaming && <StreamCursor />}
                </div>
              )}
              {msg.streaming && !displayText && <StreamCursor />}
              {msg.type === "card" && !msg.streaming && msg.world && <WorldCardView w={msg.world} />}
              {msg.type === "card" && !msg.streaming && msg.character && <CharCardView c={msg.character} />}
              {msg.type === "card" && !msg.streaming && msg.mst && <MstCardView m={msg.mst} />}
              {msg.type === "card" && !msg.streaming && msg.ab && (
                <AbCardView ab={msg.ab} onChoose={lbl => onAbChoose(msg.id, lbl)} />
              )}
            </>
          )}
        </div>
      </div>
      {isUser && (
        <div className={s.avatar} style={{ background: ag.bg, color: ag.color, border: `1px solid ${ag.color}40` }}>나</div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Phase2Page({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();

  const [genre, setGenre] = useState("판타지");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [userInput, setUserInput] = useState("");
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [abChosen, setAbChosen] = useState(false);
  const [mstDone, setMstDone] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<string>("");

  useEffect(() => {
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.genre) setGenre(p1.input.genre);

      // Restore saved Phase 2 data
      const saved = localStorage.getItem(`wts_phase2_${projectId}`);
      if (saved) {
        const { data } = JSON.parse(saved) as {
          data: { world?: WorldCard; characters?: (CharSheet | null)[]; mst?: MstCard; ab?: AbCard };
        };
        if (data) {
          const restored: Msg[] = [];
          if (data.world) {
            restored.push({ id: uid(), agent: "worldbuilder", text: "", type: "card", cardType: "world", world: data.world, streaming: false });
          }
          if (data.characters) {
            data.characters.filter(Boolean).forEach(c => {
              if (c) restored.push({ id: uid(), agent: "character", text: "", type: "card", cardType: "character", character: c, streaming: false });
            });
          }
          if (data.mst) {
            restored.push({ id: uid(), agent: "character", text: "", type: "card", cardType: "mst", mst: data.mst, streaming: false });
            setMstDone(true);
          }
          if (data.ab) {
            restored.push({ id: uid(), agent: "worldbuilder", text: "", type: "card", cardType: "ab", ab: data.ab, streaming: false });
          }
          if (restored.length > 0) {
            setMessages(restored);
            setStarted(true);
            setAbChosen(!!data.ab);
          }
        }
      }
    } catch { /* ignore */ }
  }, [projectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Inject blink keyframe for stream cursor
  useEffect(() => {
    const id = "wts-blink-style";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id;
      el.textContent = "@keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }";
      document.head.appendChild(el);
    }
  }, []);

  const addStreamingMsg = useCallback((agent: AgentId, cardType?: CardType): string => {
    const id = uid();
    setMessages((prev: Msg[]) => [...prev, {
      id, agent, text: "", type: cardType ? "card" : "text",
      cardType, streaming: true,
    }]);
    return id;
  }, []);

  const runStream = useCallback(async (
    agent: AgentId,
    systemPrompt: string,
    msgs: Array<{ role: "user" | "assistant"; content: string }>,
    apiKey: string,
    cardType?: CardType,
  ): Promise<string> => {
    const id = addStreamingMsg(agent, cardType);
    let fullText = "";

    const gen = streamClaude({
      apiKey,
      systemPrompt,
      messages: msgs,
      maxTokens: 3000,
      tools: [WEB_SEARCH_TOOL],
    });

    for await (const chunk of gen) {
      fullText += chunk;
      setMessages((prev: Msg[]) => prev.map((m: Msg) => m.id === id ? { ...m, text: fullText } : m));
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    // Parse card data at end of stream
    const update: Partial<Msg> = { streaming: false, text: fullText };
    if (cardType === "world") {
      const world = parseBlock<WorldCard>(fullText, "WORLD_CARD");
      if (world) update.world = world;
    } else if (cardType === "character") {
      const character = parseBlock<CharSheet>(fullText, "CHAR_CARD");
      if (character) update.character = character;
    } else if (cardType === "mst") {
      const mst = parseBlock<MstCard>(fullText, "MST_CARD");
      if (mst) update.mst = mst;
    } else if (cardType === "ab") {
      const ab = parseBlock<AbCard>(fullText, "AB_CARD");
      if (ab) update.ab = ab;
    }

    setMessages((prev: Msg[]) => prev.map((m: Msg) => m.id === id ? { ...m, ...update } : m));
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    return fullText;
  }, [addStreamingMsg]);

  const startChat = useCallback(async () => {
    const apiKey = getAnthropicKey();
    if (!apiKey) {
      setApiError("ANTHROPIC_API_KEY가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력해주세요.");
      return;
    }
    setApiError(null);
    setStarted(true);
    setRunning(true);
    setMessages([]);
    setAbChosen(false);
    setMstDone(false);
    setCurrentStep(0);

    // Load Phase 1 data
    let phase1Summary = `장르: ${genre}`;
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.data?.summary) phase1Summary = `장르: ${genre}\nPhase 1 요약: ${p1.data.summary}`;
      if (p1?.input?.concept) phase1Summary += `\n아이디어: ${p1.input.concept}`;
    } catch { /* ignore */ }

    try {
      // ── Step 1. Worldbuilder: world design ──
      setCurrentStep(1);
      const worldText = await runStream(
        "worldbuilder",
        buildWorldbuilderPrompt(genre, phase1Summary),
        [{ role: "user", content: `${genre} 장르 웹툰의 세계관을 설계해주세요.\n\n${phase1Summary}` }],
        apiKey,
        "world",
      );
      const worldData = parseBlock<WorldCard>(worldText, "WORLD_CARD");
      const worldSummary = worldData
        ? `시대: ${worldData.era} / 분위기: ${worldData.atmosphere} / 규칙: ${worldData.rules.join(", ")}`
        : stripBlocks(worldText).slice(0, 200);

      // ── Cross-check: character reviews world ──
      setCurrentStep(2);
      await runStream(
        "character",
        buildCharacterCrossCheckPrompt(genre, worldSummary),
        [{ role: "user", content: `세계관 설계자가 완성한 세계관: ${worldSummary}` }],
        apiKey,
      );

      // ── Step 2. Character: protagonist ──
      const char1Text = await runStream(
        "character",
        buildCharacterPrompt("protagonist", genre, worldSummary, phase1Summary),
        [
          { role: "user", content: phase1Summary },
          { role: "assistant", content: `[세계관]\n${worldSummary}` },
          { role: "user", content: "주인공 캐릭터 시트를 작성해주세요." },
        ],
        apiKey,
        "character",
      );
      const char1Data = parseBlock<CharSheet>(char1Text, "CHAR_CARD");
      const char1Summary = char1Data ? `${char1Data.name} (주인공): ${char1Data.personality}` : "주인공 설계 완료";

      // ── Step 3. Character: antagonist ──
      setCurrentStep(3);
      const char2Text = await runStream(
        "character",
        buildCharacterPrompt("antagonist", genre, worldSummary, phase1Summary),
        [
          { role: "user", content: phase1Summary },
          { role: "assistant", content: `[세계관]\n${worldSummary}\n[주인공]\n${char1Summary}` },
          { role: "user", content: "빌런/대립 캐릭터 시트를 작성해주세요." },
        ],
        apiKey,
        "character",
      );
      const char2Data = parseBlock<CharSheet>(char2Text, "CHAR_CARD");
      const char2Summary = char2Data ? `${char2Data.name} (빌런): ${char2Data.personality}` : "빌런 설계 완료";
      const charsSummary = `${char1Summary}\n${char2Summary}`;

      // ── Cross-check: producer bridges to MST ──
      await runStream(
        "producer",
        buildProducerMidpointPrompt(char1Summary, char2Summary),
        [{ role: "user", content: `주인공: ${char1Summary}\n빌런: ${char2Summary}` }],
        apiKey,
      );

      // ── Step 4. Character: MST ──
      setCurrentStep(4);
      const mstText = await runStream(
        "character",
        buildMstPrompt(genre, worldSummary, charsSummary),
        [
          { role: "user", content: `장르: ${genre}\n세계관: ${worldSummary}\n캐릭터: ${charsSummary}` },
          { role: "user", content: "MST(마스터 스타일 토큰)를 설계해주세요." },
        ],
        apiKey,
        "mst",
      );
      const mstData = parseBlock<MstCard>(mstText, "MST_CARD");
      const mstSummary = mstData
        ? `선: ${mstData.line_weight} / 채색: ${mstData.coloring} / 키워드: ${mstData.style_keywords.join(", ")}`
        : "MST 설계 완료";
      setMstDone(true);

      // ── Cross-check: worldbuilder validates MST ──
      await runStream(
        "worldbuilder",
        buildWorldbuilderCrossCheckPrompt(mstSummary, worldSummary),
        [{ role: "user", content: `MST: ${mstSummary}` }],
        apiKey,
      );

      // ── Step 5. Worldbuilder: A/B options ──
      setCurrentStep(5);
      const abText = await runStream(
        "worldbuilder",
        buildAbPrompt(genre, worldSummary, mstSummary),
        [
          { role: "user", content: `장르: ${genre}\n세계관: ${worldSummary}\nMST: ${mstSummary}` },
          { role: "user", content: "디자인 방향 A/B안을 제안해주세요." },
        ],
        apiKey,
        "ab",
      );

      // Build context for follow-ups
      contextRef.current = [
        `[세계관]\n${worldSummary}`,
        `[캐릭터]\n${charsSummary}`,
        `[MST]\n${mstSummary}`,
        `[A/B 제안]\n${stripBlocks(abText).slice(0, 200)}`,
      ].join("\n\n");

      // ── Producer final summary + A/B prompt ──
      setCurrentStep(6);
      await runStream(
        "producer",
        buildProducerFinalPrompt(contextRef.current),
        [{ role: "user", content: "Phase 2 설계를 마무리해주세요." }],
        apiKey,
      );

      // Save to localStorage (include AB card for restore)
      const abData = parseBlock<AbCard>(abText, "AB_CARD");
      localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({
        data: { world: worldData, characters: [char1Data, char2Data], mst: mstData, ab: abData },
        savedAt: new Date().toISOString(),
      }));

      // Sync MST to style_registry API (fire-and-forget)
      if (mstData) {
        const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
        fetch(`${API_BASE}/api/style/${projectId}/registry`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: "Bearer local" },
          body: JSON.stringify({ mst: mstData }),
        }).catch(() => { /* non-critical: localStorage is source of truth */ });
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = raw.includes("401") || raw.includes("authentication")
        ? "API 키가 유효하지 않습니다. 설정 페이지에서 sk-ant-api03-... 형식의 키를 다시 확인해주세요."
        : `API 오류: ${raw}`;
      setApiError(msg);
    } finally {
      setRunning(false);
    }
  }, [genre, projectId, runStream]);

  const handleAbChoose = useCallback((msgId: string, label: string) => {
    setMessages((prev: Msg[]) => prev.map((m: Msg) => {
      if (m.id !== msgId || !m.ab) return m;
      return { ...m, ab: { ...m.ab, chosen: label } };
    }));
    setAbChosen(true);
    // Persist AB choice back to localStorage
    try {
      const saved = localStorage.getItem(`wts_phase2_${projectId}`);
      if (saved) {
        const parsed = JSON.parse(saved) as { data: Record<string, unknown>; savedAt: string };
        if (parsed.data?.ab) {
          (parsed.data.ab as Record<string, unknown>).chosen = label;
          localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify(parsed));
        }
      }
    } catch { /* ignore */ }

    // Sync AB choice to style_registry API (fire-and-forget)
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
    fetch(`${API_BASE}/api/style/${projectId}/registry`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer local" },
      body: JSON.stringify({ mst: {}, ab_choice: label }),
    }).catch(() => { /* non-critical */ });

    const userMsgId = uid();
    setMessages((prev: Msg[]) => [...prev, { id: userMsgId, agent: "user", text: `${label}을 선택하겠습니다.`, type: "text", streaming: false }]);

    setTimeout(() => {
      const replyId = uid();
      setMessages((prev: Msg[]) => [...prev, {
        id: replyId, agent: "producer", text: "",
        type: "text", streaming: true,
      }]);
      setTimeout(() => {
        const replyText = `${label} 방향이 확정되었습니다. 세계관 설계, 캐릭터 시트 2종, MST, 디자인 방향이 모두 확정되었습니다.\n\nPhase 3에서 이 에셋을 기반으로 100화 시나리오 로드맵을 작성할 수 있습니다.`;
        setMessages((prev: Msg[]) => prev.map((m: Msg) => m.id === replyId ? { ...m, text: replyText, streaming: false } : m));
      }, 600);
    }, 400);
  }, []);

  const handleUserSend = useCallback(async () => {
    const text = userInput.trim();
    if (!text || running) return;
    const apiKey = getAnthropicKey();
    if (!apiKey) { setApiError("ANTHROPIC_API_KEY가 설정되지 않았습니다."); return; }

    setApiError(null);
    setUserInput("");
    setMessages((prev: Msg[]) => [...prev, { id: uid(), agent: "user", text, type: "text", streaming: false }]);
    setRunning(true);

    try {
      await runStream(
        "producer",
        buildProducerFollowupPrompt(contextRef.current),
        [{ role: "user", content: text }],
        apiKey,
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setApiError(raw.includes("401") ? "API 키가 유효하지 않습니다." : `API 오류: ${raw}`);
    } finally {
      setRunning(false);
    }
  }, [userInput, running, runStream]);

  const handleKeyDown = useCallback((e: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleUserSend(); }
  }, [handleUserSend]);

  const canProceed = mstDone && abChosen && !running;

  return (
    <div className={s.page}>
      {!started ? (
        <div className={s.formWrap}>
          <h1 className={s.formTitle}>Phase 2 — 세계관 & 에셋 설계</h1>
          <p className={s.formDesc}>세계관 규칙, 캐릭터 초정밀 외형, MST(마스터 스타일 토큰)를 AI 에이전트들이 실시간으로 설계합니다.</p>

          {apiError && (
            <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "#f87171" }}>
              ⚠ {apiError}
            </div>
          )}

          <div className={s.formCard}>
            <div className={s.prereqNote}>
              Phase 1 데이터를 자동으로 불러옵니다. 바로 세계관 설계를 시작합니다.
            </div>
            <button className={s.btnStart} onClick={startChat}>✦ 세계관/에셋 설계 시작</button>
          </div>
        </div>
      ) : (
        <div className={s.chatLayout}>
          {running && (
            <div className={s.stepBar}>
              {[
                { step: 1, label: "세계관" },
                { step: 3, label: "캐릭터" },
                { step: 4, label: "MST" },
                { step: 5, label: "디자인 방향" },
                { step: 6, label: "총괄" },
              ].map(({ step, label }) => (
                <div key={step} className={`${s.stepItem} ${currentStep >= step ? s.stepDone : ""} ${currentStep === step ? s.stepActive : ""}`}>
                  <div className={s.stepDot} />
                  <span className={s.stepLabel}>{label}</span>
                </div>
              ))}
            </div>
          )}
          <div className={s.chatHeader}>
            <span className={s.chatHeaderGenre}>{genre}</span>
            <span style={{ fontSize: 13, color: "#7878a0" }}>세계관 · 캐릭터 시트 · MST · 디자인 방향</span>
            {running && (
              <span style={{ marginLeft: "auto", fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
                에이전트 작업 중 <ThinkingDots />
              </span>
            )}
            <button className={s.btnRestart} onClick={() => { setStarted(false); setMessages([]); setAbChosen(false); setMstDone(false); setApiError(null); }}>
              ↺ 다시 시작
            </button>
          </div>

          {apiError && (
            <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", margin: "12px 20px 0", borderRadius: 10, padding: "10px 16px", fontSize: 13, color: "#f87171", display: "flex", alignItems: "center", gap: 8 }}>
              <span>⚠</span><span>{apiError}</span>
              <a href="/settings" style={{ marginLeft: "auto", color: "#f87171", textDecoration: "underline", whiteSpace: "nowrap" }}>설정으로 이동</a>
            </div>
          )}

          <div className={s.chatBody}>
            {messages.map((m: Msg) => (
              <MsgBubble key={m.id} msg={m} onAbChoose={handleAbChoose} />
            ))}
            <div ref={bottomRef} />
          </div>

          <div className={s.chatBottom}>
            {canProceed && (
              <div className={s.gatingRow}>
                <span className={s.gatingMsg}>✓ 세계관 · 캐릭터 · MST · 디자인 방향 확정 — Phase 3 진행 가능</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={{
                    background: "rgba(100,116,139,0.1)", border: "1px solid rgba(100,116,139,0.3)",
                    borderRadius: 8, color: "#94a3b8", fontSize: 13, fontWeight: 600,
                    padding: "10px 14px", cursor: "pointer", whiteSpace: "nowrap",
                  }} onClick={() => {
                    localStorage.removeItem(`wts_phase2_${projectId}`);
                    setMessages([]); setStarted(false); setMstDone(false); setAbChosen(false);
                  }}>
                    재생성
                  </button>
                  <button className={s.btnGating} onClick={() => router.push(`/projects/${projectId}/phase-3`)}>Phase 3 시작 →</button>
                </div>
              </div>
            )}
            <div className={s.inputRow}>
              <textarea
                className={s.chatInput}
                rows={1}
                placeholder="수정 요청 또는 의견을 입력하세요… (Enter 전송)"
                value={userInput}
                onChange={(e: { target: HTMLTextAreaElement }) => setUserInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={running}
              />
              <button className={s.btnSend} disabled={!userInput.trim() || running} onClick={handleUserSend}>전송</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
