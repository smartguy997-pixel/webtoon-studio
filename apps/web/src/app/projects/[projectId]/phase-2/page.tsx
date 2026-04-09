"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import s from "./page.module.css";
import { streamClaude, getAnthropicKey, WEB_SEARCH_TOOL } from "@/lib/claude-client";

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = {
  worldbuilder: { label: "세계관설계자",   color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  ini: "세" },
  character:    { label: "캐릭터디자이너", color: "#fb923c", bg: "rgba(251,146,60,0.12)",  ini: "캐" },
  scenario:     { label: "시나리오작가",   color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  ini: "시" },
  script:       { label: "연출작가",       color: "#f87171", bg: "rgba(248,113,113,0.12)", ini: "연" },
  producer:     { label: "총괄프로듀서",   color: "#f1f5f9", bg: "rgba(241,245,249,0.12)", ini: "총" },
  editor:       { label: "편집자",         color: "#fb923c", bg: "rgba(251,146,60,0.10)",  ini: "편" },
  user:         { label: "나",             color: "#7c6cfc", bg: "rgba(124,108,252,0.12)", ini: "나" },
} as const;
type AgentId = keyof typeof AGENTS;

const NAME_TO_AGENT: Record<string, AgentId> = {
  "세계관설계자": "worldbuilder",
  "캐릭터디자이너": "character",
  "시나리오작가": "scenario",
  "연출작가": "script",
  "총괄프로듀서": "producer",
  "편집자": "editor",
  "사용자": "user",
};

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
  round?: number;
}

type DebatePhase = "idle" | "running" | "paused" | "generating" | "done";

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

// ─── Debate system prompt ─────────────────────────────────────────────────────

const DEBATE_SYSTEM_PROMPT = `너는 웹툰 기획팀 전문가 6명이 참여하는 Phase 2 세계관·에셋 설계 회의를 진행한다.
Phase 1에서 확정된 기획안을 바탕으로 세계관, 캐릭터, 화풍을 함께 설계한다.

### 참여자와 성격
- [세계관설계자]: 설정 규칙 집착. "이 세계에서 그게 가능하려면 근거가 있어야 해요." 스타일.
- [캐릭터디자이너]: 외형과 감정 우선. "독자가 처음 봤을 때 어떤 인상이어야 하는지가 먼저예요." 스타일.
- [시나리오작가]: 서사 연결. "그 설정이 실제 이야기에서 어떻게 쓰일지가 더 중요해요." 스타일.
- [연출작가]: 시각적 구현. "이 분위기, 화면에 담으려면 화풍부터 결정해야 해요." 스타일.
- [총괄프로듀서]: 중재자. 갈등 정리, 합의 유도만 담당.
- [편집자]: 베테랑 편집자. 평소 침묵. 토론이 길어지면 앞 대화를 직접 인용하며 마무리를 유도한다.

### 출력 형식
[이름]: 대사

### 출력 규칙 (반드시 준수)
- 매 응답마다 직전 발언을 읽고, 그 내용에 직접 반응하는 사람 1명만 말한다.
- 반드시 앞 발언을 인식했음을 드러내야 한다. ("방금 말씀하신..." "그건 맞는데...")
- 각 대사는 1~2문장. 마크다운(#, *, >, -) 절대 금지.
- 카카오톡 메시지처럼 짧고 자연스러운 한국어.
- 침묵 표현, 말 끊기 표현, 불완전한 문장 허용.
- [사용자]: 가 발언하면 반드시 그 내용에 직접 반응한다.
- JSON 블록, [WORLD_CARD] 같은 출력 절대 금지. 오직 대화만.

### 편집자 등장 조건
- [시스템: 마무리 단계] 신호가 오면 편집자가 앞 대화의 실제 발언을 언급하며 정리를 유도한다.`;

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

// ─── Card generation prompts (run AFTER conversation ends) ────────────────────

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
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [debatePhase, setDebatePhase] = useState<DebatePhase>("idle");
  const [abChosen, setAbChosen] = useState(false);
  const [mstDone, setMstDone] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const pendingUserMsgRef = useRef<string | null>(null);
  const savedConvRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const contextRef = useRef<string>("");

  useEffect(() => {
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.genre) setGenre(p1.input.genre);

      // Restore saved conversation messages
      let hasMsgs = false;
      const rawMsgs = localStorage.getItem(`p2_msgs_${projectId}`);
      if (rawMsgs) {
        const savedMsgs = JSON.parse(rawMsgs) as Msg[];
        if (savedMsgs.length > 0) { setMsgs(savedMsgs); hasMsgs = true; }
      }

      // Restore conv history for resume
      const rawConv = localStorage.getItem(`p2_conv_${projectId}`);
      if (rawConv) {
        const saved = JSON.parse(rawConv) as { conv: Array<{ role: "user"|"assistant"; content: string }> };
        savedConvRef.current = saved.conv ?? [];
      }

      // Restore saved Phase 2 cards
      const saved = localStorage.getItem(`wts_phase2_${projectId}`);
      if (saved) {
        const { data } = JSON.parse(saved) as {
          data: { world?: WorldCard; characters?: (CharSheet | null)[]; mst?: MstCard; ab?: AbCard };
        };
        if (data) {
          const cards: Msg[] = [];
          if (data.world) cards.push({ id: uid(), agent: "worldbuilder", text: "", type: "card", cardType: "world", world: data.world, streaming: false });
          data.characters?.filter(Boolean).forEach(c => {
            if (c) cards.push({ id: uid(), agent: "character", text: "", type: "card", cardType: "character", character: c, streaming: false });
          });
          if (data.mst) { cards.push({ id: uid(), agent: "character", text: "", type: "card", cardType: "mst", mst: data.mst, streaming: false }); setMstDone(true); }
          if (data.ab) cards.push({ id: uid(), agent: "worldbuilder", text: "", type: "card", cardType: "ab", ab: data.ab, streaming: false });
          if (cards.length > 0) {
            setMsgs((prev: Msg[]) => [...prev, ...cards]);
            setDebatePhase("done");
            setAbChosen(!!data.ab);
            return;
          }
        }
      }
      if (hasMsgs) setDebatePhase("paused");
    } catch { /* ignore */ }
  }, [projectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // Auto-save conversation (text msgs only) when streaming is done
  useEffect(() => {
    if (!projectId || msgs.length === 0) return;
    if (msgs.some((m: Msg) => m.streaming)) return;
    const textOnly = msgs.filter((m: Msg) => m.type === "text");
    if (textOnly.length > 0) localStorage.setItem(`p2_msgs_${projectId}`, JSON.stringify(msgs));
  }, [msgs, projectId]);

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

  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  const addMsg = useCallback((agent: AgentId, round: number, text = "", streaming = false, type: "text"|"card" = "text", cardType?: CardType): string => {
    const id = uid();
    setMsgs((prev: Msg[]) => [...prev, { id, agent, text, type, cardType, streaming, round }]);
    return id;
  }, []);

  const updateMsg = useCallback((id: string, text: string, streaming: boolean, extra?: Partial<Msg>) => {
    setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === id ? { ...m, text, streaming, ...extra } : m));
  }, []);

  // ── Card generation helper (runs AFTER debate ends) ──
  const generateCards = useCallback(async (apiKey: string, debateContext: string) => {
    setDebatePhase("generating");

    let phase1Summary = `장르: ${genre}`;
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.data?.summary) phase1Summary += `\nPhase 1 요약: ${p1.data.summary}`;
      if (p1?.input?.concept) phase1Summary += `\n아이디어: ${p1.input.concept}`;
    } catch { /* ignore */ }

    const context = `${phase1Summary}\n\n[토론 내용 요약]\n${debateContext.slice(0, 2000)}`;

    const runCard = async (agent: AgentId, systemPrompt: string, userMsg: string, cardType: CardType): Promise<string> => {
      const id = addMsg(agent, 0, "", true, "card", cardType);
      let fullText = "";
      for await (const chunk of streamClaude({ apiKey, systemPrompt, messages: [{ role: "user", content: userMsg }], maxTokens: 3000, tools: [{ ...WEB_SEARCH_TOOL, allowed_callers: ["direct"] }] })) {
        fullText += chunk;
        updateMsg(id, fullText, true);
      }
      const extra: Partial<Msg> = { streaming: false };
      if (cardType === "world") { const w = parseBlock<WorldCard>(fullText, "WORLD_CARD"); if (w) extra.world = w; }
      if (cardType === "character") { const c = parseBlock<CharSheet>(fullText, "CHAR_CARD"); if (c) extra.character = c; }
      if (cardType === "mst") { const m = parseBlock<MstCard>(fullText, "MST_CARD"); if (m) extra.mst = m; }
      if (cardType === "ab") { const a = parseBlock<AbCard>(fullText, "AB_CARD"); if (a) extra.ab = a; }
      updateMsg(id, fullText, false, extra);
      return fullText;
    };

    try {
      const worldText = await runCard("worldbuilder", buildWorldbuilderPrompt(genre, context), `${genre} 장르 웹툰의 세계관을 설계해주세요.\n\n${context}`, "world");
      const worldData = parseBlock<WorldCard>(worldText, "WORLD_CARD");
      const worldSummary = worldData ? `시대: ${worldData.era} / 분위기: ${worldData.atmosphere} / 규칙: ${worldData.rules.join(", ")}` : stripBlocks(worldText).slice(0, 200);
      await sleep(800);

      const char1Text = await runCard("character", buildCharacterPrompt("protagonist", genre, worldSummary, context), `세계관: ${worldSummary}\n주인공 캐릭터 시트를 작성해주세요.`, "character");
      const char1Data = parseBlock<CharSheet>(char1Text, "CHAR_CARD");
      const char1Summary = char1Data ? `${char1Data.name} (주인공): ${char1Data.personality}` : "주인공 설계 완료";
      await sleep(800);

      const char2Text = await runCard("character", buildCharacterPrompt("antagonist", genre, worldSummary, context), `세계관: ${worldSummary}\n주인공: ${char1Summary}\n빌런 캐릭터 시트를 작성해주세요.`, "character");
      const char2Data = parseBlock<CharSheet>(char2Text, "CHAR_CARD");
      const char2Summary = char2Data ? `${char2Data.name} (빌런): ${char2Data.personality}` : "빌런 설계 완료";
      await sleep(800);

      const mstText = await runCard("character", buildMstPrompt(genre, worldSummary, `${char1Summary}\n${char2Summary}`), `장르: ${genre}\n세계관: ${worldSummary}\nMST를 설계해주세요.`, "mst");
      const mstData = parseBlock<MstCard>(mstText, "MST_CARD");
      const mstSummary = mstData ? `선: ${mstData.line_weight} / 채색: ${mstData.coloring} / 키워드: ${mstData.style_keywords.join(", ")}` : "MST 설계 완료";
      setMstDone(true);
      await sleep(800);

      const abText = await runCard("worldbuilder", buildAbPrompt(genre, worldSummary, mstSummary), `장르: ${genre}\n세계관: ${worldSummary}\nMST: ${mstSummary}\nA/B 디자인 방향을 제안해주세요.`, "ab");
      const abData = parseBlock<AbCard>(abText, "AB_CARD");

      contextRef.current = [`[세계관]\n${worldSummary}`, `[캐릭터]\n${char1Summary}\n${char2Summary}`, `[MST]\n${mstSummary}`].join("\n\n");

      localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({
        data: { world: worldData, characters: [char1Data, char2Data], mst: mstData, ab: abData },
        savedAt: new Date().toISOString(),
      }));

      if (mstData) {
        const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
        fetch(`${API_BASE}/api/style/${projectId}/registry`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer local" }, body: JSON.stringify({ mst: mstData }) }).catch(() => {});
      }
      setDebatePhase("done");
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setApiError(raw.includes("401") ? "API 키가 유효하지 않습니다." : `API 오류: ${raw}`);
      setDebatePhase("done");
    }
  }, [genre, projectId, addMsg, updateMsg]);

  // ── Main debate loop (Phase 1 style) ──
  const runDebate = useCallback(async (resumeConv?: Array<{ role: "user"|"assistant"; content: string }>) => {
    if (runningRef.current) return;
    runningRef.current = true;
    const apiKey = getAnthropicKey();
    if (!apiKey) { setApiError("ANTHROPIC_API_KEY가 설정되지 않았습니다."); runningRef.current = false; return; }

    setApiError(null);
    setDebatePhase("running");
    setTurnCount(1);

    let phase1Summary = `장르: ${genre}`;
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.data?.summary) phase1Summary += `\nPhase 1 요약: ${p1.data.summary}`;
      if (p1?.input?.concept) phase1Summary += `\n아이디어: ${p1.input.concept}`;
    } catch { /* ignore */ }

    const convHistory: Array<{ role: "user"|"assistant"; content: string }> = resumeConv ? [...resumeConv] : [];
    if (!resumeConv || resumeConv.length === 0) {
      convHistory.push({ role: "user", content: `Phase 2 세계관·에셋 설계를 시작해줘.\n${phase1Summary}` });
    } else {
      convHistory.push({ role: "user", content: "이전 논의를 이어서 계속해줘." });
    }

    const END_TRIGGERS = ["정리하자", "확정하자", "결정하자", "끝내자", "카드 만들어"];
    const MAX_ROUNDS = 120;
    let round = 0;

    const compressHistory = async () => {
      if (convHistory.length < 14) return;
      const initial = convHistory[0];
      const recent = convHistory.slice(-8);
      const old = convHistory.slice(1, -8).filter(m => m.role === "assistant");
      if (!old.length) return;
      let summary = "";
      for await (const chunk of streamClaude({ apiKey, systemPrompt: "토론 요약 전문가. 핵심 쟁점만 간결하게.", messages: [{ role: "user", content: `요약:\n\n${old.map(m => m.content).join("\n\n").slice(0, 3000)}` }], maxTokens: 400, tools: [] })) summary += chunk;
      convHistory.length = 0;
      convHistory.push(initial, { role: "assistant", content: `[이전 토론 요약]\n${summary}` }, { role: "user", content: "위 요약을 참고해서 계속해줘." }, ...recent);
    };

    debateLoop: for (round = 1; round <= MAX_ROUNDS; round++) {
      setTurnCount(round);
      let roundText = "";
      const roundMsgIds = new Map<AgentId, string>();

      for await (const chunk of streamClaude({ apiKey, systemPrompt: DEBATE_SYSTEM_PROMPT, messages: convHistory, maxTokens: 150, tools: [] })) {
        roundText += chunk;
        for (const { agentId, text } of parseAgentMessages(roundText)) {
          if (!roundMsgIds.has(agentId)) roundMsgIds.set(agentId, addMsg(agentId, round, text, true));
          else updateMsg(roundMsgIds.get(agentId)!, text, true);
        }
      }
      const finalParsed = parseAgentMessages(roundText);
      for (const [agentId, id] of roundMsgIds) updateMsg(id, finalParsed.find(m => m.agentId === agentId)?.text ?? "", false);

      convHistory.push({ role: "assistant", content: roundText });

      if (round % 10 === 0) await compressHistory();

      localStorage.setItem(`p2_conv_${projectId}`, JSON.stringify({ conv: convHistory }));

      await sleep(4000);

      const pendingMsg = pendingUserMsgRef.current;
      if (pendingMsg) {
        pendingUserMsgRef.current = null;
        addMsg("user", round, pendingMsg, false);
        if (END_TRIGGERS.some(t => pendingMsg.includes(t))) break debateLoop;
        convHistory.push({ role: "user", content: `[사용자]: ${pendingMsg}\n위 내용에 에이전트들이 즉시 반응해줘.` });
      } else if (round === 80) {
        convHistory.push({ role: "user", content: "[시스템: 마무리 단계] 편집자가 앞 대화를 인용하며 마무리를 유도하고, 에이전트들이 핵심 결론을 정리해줘." });
      } else if (round > 80) {
        convHistory.push({ role: "user", content: "에이전트들이 하나씩 최종 입장을 정리해줘." });
      } else {
        convHistory.push({ role: "user", content: "계속 토론해줘." });
      }
    }

    const debateContext = convHistory.filter(m => m.role === "assistant").map(m => m.content).join("\n\n");
    runningRef.current = false;
    await generateCards(apiKey, debateContext);
    localStorage.removeItem(`p2_conv_${projectId}`);
    savedConvRef.current = [];
  }, [genre, projectId, addMsg, updateMsg, generateCards]);

  const handleAbChoose = useCallback((msgId: string, label: string) => {
    setMsgs((prev: Msg[]) => prev.map((m: Msg) => {
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

    setMsgs((prev: Msg[]) => [...prev, { id: uid(), agent: "user", text: `${label}을 선택하겠습니다.`, type: "text", streaming: false }]);
    const replyId = uid();
    setMsgs((prev: Msg[]) => [...prev, { id: replyId, agent: "producer", text: "", type: "text", streaming: true }]);
    setTimeout(() => {
      setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === replyId ? { ...m, text: `${label} 방향이 확정되었습니다. 세계관·캐릭터·MST·디자인 방향 모두 확정. Phase 3에서 100화 시나리오 로드맵을 작성할 수 있습니다.`, streaming: false } : m));
    }, 600);
  }, []);

  const handleRestartNew = useCallback(() => {
    localStorage.removeItem(`p2_msgs_${projectId}`);
    localStorage.removeItem(`p2_conv_${projectId}`);
    localStorage.removeItem(`wts_phase2_${projectId}`);
    savedConvRef.current = [];
    setMsgs([]); setAbChosen(false); setMstDone(false); setApiError(null);
    setDebatePhase("idle"); setTurnCount(0);
    runningRef.current = false;
  }, [projectId]);

  const canProceed = mstDone && abChosen && debatePhase === "done";

  if (debatePhase === "idle") {
    return (
      <div className={s.page}>
        <div className={s.formWrap}>
          <h1 className={s.formTitle}>Phase 2 — 세계관 & 에셋 설계</h1>
          <p className={s.formDesc}>에이전트들이 자유 토론으로 세계관·캐릭터·화풍을 함께 설계합니다. 의견을 입력하거나 &quot;정리하자&quot;로 카드를 확정할 수 있습니다.</p>
          {apiError && <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "#f87171" }}>⚠ {apiError}</div>}
          <div className={s.formCard}>
            <div className={s.prereqNote}>Phase 1 기획 데이터를 자동으로 불러옵니다.</div>
            <button className={s.btnStart} onClick={() => runDebate()}>✦ 세계관/에셋 설계 토론 시작</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <div className={s.chatLayout}>
        <div className={s.chatHeader}>
          <span className={s.chatHeaderGenre}>{genre}</span>
          <span style={{ fontSize: 12, color: "#475569" }}>
            {debatePhase === "running" ? `Turn ${turnCount}` : debatePhase === "generating" ? "카드 생성 중..." : debatePhase === "paused" ? "⏸ 일시중지" : "✅ 완료"}
          </span>
          {debatePhase === "running" && <ThinkingDots />}
          <button className={s.btnRestart} onClick={handleRestartNew}>↺ 다시 시작</button>
        </div>

        {apiError && (
          <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", margin: "12px 20px 0", borderRadius: 10, padding: "10px 16px", fontSize: 13, color: "#f87171", display: "flex", alignItems: "center", gap: 8 }}>
            <span>⚠</span><span>{apiError}</span>
            <a href="/settings" style={{ marginLeft: "auto", color: "#f87171", textDecoration: "underline", whiteSpace: "nowrap" }}>설정으로 이동</a>
          </div>
        )}

        <div className={s.chatBody}>
          {msgs.map((m: Msg) => (
            <MsgBubble key={m.id} msg={m} onAbChoose={handleAbChoose} />
          ))}

          {debatePhase === "paused" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "24px 16px" }}>
              <p style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", margin: 0 }}>이전 토론이 저장되어 있습니다.</p>
              <div style={{ display: "flex", gap: 10 }}>
                <button className={s.btnGating} onClick={() => runDebate(savedConvRef.current)}>토론 계속하기 →</button>
                <button className={s.btnRestart} onClick={handleRestartNew}>새로 시작</button>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className={s.chatBottom}>
          {canProceed && (
            <div className={s.gatingRow}>
              <span className={s.gatingMsg}>✓ 세계관 · 캐릭터 · MST · 디자인 방향 확정 — Phase 3 진행 가능</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ background: "rgba(100,116,139,0.1)", border: "1px solid rgba(100,116,139,0.3)", borderRadius: 8, color: "#94a3b8", fontSize: 13, fontWeight: 600, padding: "10px 14px", cursor: "pointer" }} onClick={handleRestartNew}>재생성</button>
                <button className={s.btnGating} onClick={() => router.push(`/projects/${projectId}/phase-3`)}>Phase 3 시작 →</button>
              </div>
            </div>
          )}
          {debatePhase === "running" && (
            <div className={s.inputRow}>
              <textarea
                className={s.chatInput} rows={1}
                placeholder="의견 입력 (Enter) · &quot;정리하자&quot; 입력 시 카드 생성"
                value={chatInput}
                onChange={(e: { target: HTMLTextAreaElement }) => setChatInput(e.target.value)}
                onKeyDown={(e: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (chatInput.trim()) { pendingUserMsgRef.current = chatInput.trim(); setChatInput(""); }
                  }
                }}
              />
              <button className={s.btnSend} disabled={!chatInput.trim()} onClick={() => { if (chatInput.trim()) { pendingUserMsgRef.current = chatInput.trim(); setChatInput(""); } }}>전송</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
