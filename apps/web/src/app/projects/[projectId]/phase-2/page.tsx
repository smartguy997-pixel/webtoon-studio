"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import s from "./page.module.css";
import { streamClaude, getAnthropicKey, getAnthropicKeyByIndex, getAllAnthropicKeys } from "@/lib/claude-client";

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

// API 키 할당 (에이전트 인덱스 → 키 인덱스, 순환)
function getApiKeyIndexForAgent(agentIdx: number): number {
  const keys = getAllAnthropicKeys();
  if (keys.length === 0) return 0;
  return (agentIdx % Math.max(1, keys.length)) + 1;
}

const AGENT_ROLE_DESC: Partial<Record<AgentId, string>> = {
  worldbuilder: "설정과 세계 규칙의 일관성·독창성을 중시한다. 세계가 어떻게 작동하는지 논리적으로 따진다.",
  character:    "캐릭터의 감정·외형·성격·말투가 살아있어야 한다고 생각한다. 인물이 입체적인지 따진다.",
  scenario:     "서사 구조와 이야기의 개연성·설득력을 최우선으로 본다. 이야기 흐름이 자연스러운지 따진다.",
  script:       "독자가 그림으로 볼 때의 연출·시각적 임팩트를 중시한다. 장면이 그려지는지 상상하며 따진다.",
  producer:     "모두의 의견을 종합해 합의를 이끌거나 더 나은 방향을 제시한다. 결론을 유도한다.",
};

// ─── Types ────────────────────────────────────────────────────────────────────

const STAGES = [
  { id: 1 as const, name: "세계관",     topic: "세계관 — 시대·배경·세계 규칙·분위기·특수 설정",  tag: "WORLD",         color: "#60a5fa", schema: '{"era":"시대/배경","atmosphere":"분위기","world_rules":["규칙1","규칙2","규칙3"],"special_elements":"특수 설정"}' },
  { id: 2 as const, name: "시놉시스",   topic: "시놉시스 — 로그라인·전제·핵심 갈등·해결 방향",    tag: "SYNOPSIS",      color: "#34d399", schema: '{"logline":"한 줄 요약","premise":"전제","conflict":"핵심 갈등","resolution_hint":"해결 방향"}' },
  { id: 3 as const, name: "캐릭터 설정", topic: "등장인물 — 이름·역할·성격·동기·외형·말투",        tag: "CHARACTERS",    color: "#fb923c", schema: '{"characters":[{"name":"이름","role":"주인공/빌런/조력자","personality":"성격","motivation":"동기","appearance":"외형","speech":"말투"}]}' },
  { id: 4 as const, name: "장소 설정",  topic: "주요 장소 — 이름·유형·분위기·서사적 의미",         tag: "LOCATIONS",     color: "#a78bfa", schema: '{"locations":[{"name":"장소명","type":"유형","atmosphere":"분위기","significance":"서사적 의미"}]}' },
  { id: 5 as const, name: "복선·암시",  topic: "복선과 암시 — 복선 장치·회수 장면·의도적 훼이크",  tag: "FORESHADOWING", color: "#f87171", schema: '{"foreshadowing":[{"setup":"복선 설정","payoff":"회수 장면"}],"hints":["암시1","암시2"],"red_herrings":["훼이크1"]}' },
];
type StageId = 1 | 2 | 3 | 4 | 5;

interface StageResult {
  stageId: StageId;
  data: Record<string, unknown>;
  summary: string;
}

// Msg는 현재 단계 채팅 메시지만 담음 (단계 구분선/결과카드는 별도 렌더)
interface Msg {
  id: string;
  agent: AgentId;
  text: string;
  streaming: boolean;
}

type DebatePhase = "idle" | "running" | "confirming" | "confirmed" | "done" | "paused";

function uid() { return Math.random().toString(36).slice(2, 10); }

// ─── JSON block parsers ───────────────────────────────────────────────────────

function parseBlock<T>(text: string, tag: string): T | null {
  const re = new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${tag}\\]`);
  const m = text.match(re);
  if (!m) return null;
  try { return JSON.parse(m[1]) as T; } catch { return null; }
}

// ─── Prompt builders (단계별 독립 API 호출 + 이전 결과 컨텍스트) ──────────────

const STAGE_PROMPTS: Record<StageId, string> = {
  1: "시대·배경, 세계 규칙 3가지, 분위기, 특수 설정을 구체적으로 합의하세요. 이 세계가 어떻게 돌아가는지 핵심 규칙을 명확히 정하세요.",
  2: "로그라인(한 줄 요약), 전제, 핵심 갈등, 해결 방향을 합의하세요. 세계관을 바탕으로 어떤 이야기가 펼쳐지는지 큰 그림을 잡으세요.",
  3: "주요 등장인물의 이름·역할·성격·동기·외형·말투를 합의하세요. 확정된 세계관과 시놉시스에 어울리는 인물을 만드세요.",
  4: "주요 장소의 이름·유형·분위기·서사적 의미를 합의하세요. 이야기에서 중요한 사건이 일어나는 공간을 구체화하세요.",
  5: "복선 장치·회수 장면·암시·의도적 훼이크를 합의하세요. 독자가 나중에 '아!'하고 깨달을 수 있는 장치를 설계하세요.",
};

// 이전 단계 결과를 구조화된 컨텍스트로 변환
function buildContext(stageId: StageId, prevResults: StageResult[]): string {
  const relevant = prevResults.filter(r => r.stageId < stageId);
  if (!relevant.length) return "";

  return relevant.map(r => {
    const stageName = STAGES.find(s => s.id === r.stageId)?.name ?? "";
    // raw_summary(평문 fallback)는 그대로 사용
    if (r.data.raw_summary) {
      return `[${stageName} — 확정됨]\n${String(r.data.raw_summary)}`;
    }
    // 구조화 data를 사람이 읽기 쉬운 형태로 변환
    const detail = Object.entries(r.data)
      .map(([k, v]) => {
        if (Array.isArray(v)) {
          const items = (v as unknown[]).map(item =>
            typeof item === "object" && item !== null
              ? Object.entries(item as Record<string, unknown>).map(([ik, iv]) => `${ik}: ${String(iv)}`).join(", ")
              : String(item)
          ).join("\n    · ");
          return `  ${k}:\n    · ${items}`;
        }
        return `  ${k}: ${String(v)}`;
      })
      .join("\n");
    return `[${stageName} — 확정됨]\n${detail}`;
  }).join("\n\n");
}

// 에이전트 1명이 이전 토론을 읽고 반응하는 단일 역할 프롬프트
function buildSingleAgentPrompt(
  stageId: StageId,
  genre: string,
  agentId: AgentId,
  prevResults: StageResult[],
): string {
  const agentLabel = AGENTS[agentId].label;
  const roleDesc = AGENT_ROLE_DESC[agentId] ?? "";
  const context = buildContext(stageId, prevResults);

  return `당신은 웹툰 기획 회의에 참여 중인 ${agentLabel}입니다.
성향: ${roleDesc}
장르: ${genre}
${context ? `\n[이미 확정된 내용 — 참고만]\n${context}\n` : ""}
[현재 토론 주제]
${STAGE_PROMPTS[stageId]}

[규칙]
- 이전 발언을 읽고 직접 반응하거나 새 관점·반론·제안을 하세요.
- 오직 당신의 대사만 출력. [이름]: 같은 접두어 없이 대사만.
- 다른 참여자 대사를 대신 쓰지 마세요. 당신 발언만.
- 1~3문장, 짧고 자연스러운 구어체 한국어.
- 마크다운, JSON, 특수 기호 금지.
- "다음 단계", "단계 완료" 등의 표현 금지.`;
}

function buildExtractionPrompt(stageId: StageId, genre: string, debateText: string): string {
  const stage = STAGES.find(s => s.id === stageId)!;
  return `다음 토론에서 "${stage.name}" 관련 합의된 내용을 JSON으로 정리하세요.

토론:
${debateText.slice(0, 4000)}

장르: ${genre}

아래 형식으로만 출력 (JSON만, 설명 없이):
[${stage.tag}]
${stage.schema}
[/${stage.tag}]`;
}


// ─── 단계별 상세 요약 프롬프트 (fallback용) ──────────────────────────────────────

const STAGE_SUMMARY_PROMPTS: Record<StageId, string> = {
  1: `다음 토론에서 합의된 세계관을 상세히 정리해주세요.
반드시 포함할 내용:
- 시대와 배경 (구체적인 시대/장소/문명 수준)
- 세계의 핵심 규칙 또는 법칙 (마법, 기술, 사회 질서 등)
- 세계의 분위기와 톤
- 독특한 설정이나 특수 요소
다음 단계(시놉시스)에서 활용할 수 있도록 빠짐없이 정리하세요.`,

  2: `다음 토론에서 합의된 시놉시스를 상세히 정리해주세요.
반드시 포함할 내용:
- 로그라인 (한 줄 핵심 요약)
- 이야기의 전제와 출발점
- 주인공이 직면하는 핵심 갈등
- 이야기가 향하는 해결 방향
다음 단계(캐릭터 설정)에서 활용할 수 있도록 구체적으로 정리하세요.`,

  3: `다음 토론에서 합의된 등장인물을 상세히 정리해주세요.
각 인물마다 반드시 포함할 내용:
- 이름과 역할 (주인공/빌런/조력자 등)
- 성격과 말투의 특징
- 행동 동기와 목표
- 외형적 특징
다음 단계(장소 설정)에서 활용할 수 있도록 빠짐없이 정리하세요.`,

  4: `다음 토론에서 합의된 주요 장소를 상세히 정리해주세요.
각 장소마다 반드시 포함할 내용:
- 장소 이름과 유형
- 분위기와 시각적 특징
- 이야기에서의 서사적 의미와 역할
다음 단계(복선/암시)에서 활용할 수 있도록 구체적으로 정리하세요.`,

  5: `다음 토론에서 합의된 복선과 암시 장치를 상세히 정리해주세요.
반드시 포함할 내용:
- 주요 복선 장치와 회수 장면
- 독자에게 던지는 암시
- 의도적인 훼이크(red herring)
이후 시나리오 작성 시 활용할 수 있도록 구체적으로 정리하세요.`,
};

// ─── 단계 결과 추출 (3단계 fallback — 반드시 StageResult 반환) ───────────────────

async function extractStageData(
  stage: typeof STAGES[number],
  genre: string,
  debateText: string,
  apiKey: string,
): Promise<{ data: Record<string, unknown>; summary: string }> {

  // ① 구조화 JSON 추출 (태그 형식)
  let fullText = "";
  try {
    for await (const chunk of streamClaude({
      apiKey,
      systemPrompt: "토론 결과를 정확한 JSON으로 변환하는 전문가입니다. 지정된 형식 외에 아무것도 출력하지 마세요.",
      messages: [{ role: "user", content: buildExtractionPrompt(stage.id, genre, debateText) }],
      maxTokens: 1500,
    })) fullText += chunk;
  } catch { /* ignore, try fallbacks */ }

  const structured = parseBlock<Record<string, unknown>>(fullText, stage.tag);
  if (structured) {
    const summary = Object.entries(structured)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as unknown[]).slice(0, 2).join(", ") : String(v).slice(0, 80)}`)
      .join(" / ");
    return { data: structured, summary };
  }

  // ② 루즈 JSON 파싱 (태그 없이 JSON 블록만 찾기)
  const jsonMatch = fullText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const loose = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const summary = Object.entries(loose)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as unknown[]).slice(0, 2).join(", ") : String(v).slice(0, 80)}`)
        .join(" / ");
      return { data: loose, summary };
    } catch { /* ignore */ }
  }

  // ③ 단계별 상세 평문 요약 (최후 fallback — 항상 성공)
  let summaryText = "";
  try {
    for await (const chunk of streamClaude({
      apiKey,
      systemPrompt: `당신은 웹툰 기획 전문가입니다. 장르: ${genre}. 토론 결과를 다음 단계 작업에 바로 활용할 수 있도록 상세하고 정확하게 정리합니다.`,
      messages: [{
        role: "user",
        content: `${STAGE_SUMMARY_PROMPTS[stage.id]}\n\n[토론 내용]\n${debateText.slice(0, 4000)}`,
      }],
      maxTokens: 1200,
    })) summaryText += chunk;
  } catch { summaryText = "(요약 실패 — 토론 내용을 직접 확인해주세요)"; }

  return { data: { raw_summary: summaryText }, summary: summaryText.slice(0, 300) };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThinkingDots() {
  return <div className={s.dots}><span /><span /><span /></div>;
}

function StreamCursor() {
  return <span style={{ display: "inline-block", width: 2, height: 13, background: "#7c6cfc", marginLeft: 2, verticalAlign: "middle", borderRadius: 1, animation: "blink 0.9s step-start infinite" }} />;
}

function StageResultCard({ result, onViewDebate, isViewingDebate }: { key?: StageId; result: StageResult; onViewDebate?: () => void; isViewingDebate?: boolean }) {
  const stage = STAGES.find(s => s.id === result.stageId)!;
  const { data } = result;
  const c = stage.color;
  const row = (label: string, val: unknown) => val ? (
    <div key={label} style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"6px 0", borderBottom:"1px solid #1e1e2a" }}>
      <span style={{ fontSize:10, fontWeight:700, color:"#4a4a68", minWidth:72, flexShrink:0, paddingTop:2, textTransform:"uppercase" as const, letterSpacing:"0.4px" }}>{label}</span>
      <span style={{ fontSize:13, color:"#eeeef5", lineHeight:1.6 }}>{Array.isArray(val) ? (val as unknown[]).join(" · ") : String(val)}</span>
    </div>
  ) : null;

  return (
    <div style={{ background:`${c}08`, border:`1px solid ${c}30`, borderRadius:10, padding:"14px 16px", marginBottom:6 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
        <div style={{ fontSize:10, fontWeight:800, color:c, textTransform:"uppercase" as const, letterSpacing:"0.7px" }}>✓ {stage.name} 완료</div>
        {onViewDebate && (
          <button
            onClick={onViewDebate}
            style={{ fontSize:11, fontWeight:700, color: isViewingDebate ? c : "#4a4a6a", background: isViewingDebate ? `${c}18` : "transparent", border:`1px solid ${isViewingDebate ? c : "#2a2a3d"}`, borderRadius:6, padding:"3px 10px", cursor:"pointer" }}>
            {isViewingDebate ? "▲ 닫기" : "💬 토론 보기"}
          </button>
        )}
      </div>
      {result.stageId === 1 && <>{row("시대/배경", data.era)}{row("분위기", data.atmosphere)}{row("세계 규칙", data.world_rules)}{row("특수 설정", data.special_elements)}</>}
      {result.stageId === 2 && <>{row("로그라인", data.logline)}{row("전제", data.premise)}{row("갈등", data.conflict)}{row("해결 방향", data.resolution_hint)}</>}
      {result.stageId === 3 && Array.isArray(data.characters) && (data.characters as Record<string,string>[]).map((ch, i) => (
        <div key={i} style={{ marginBottom:8, paddingBottom:8, borderBottom:"1px solid #2a2a3d" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#eeeef5", marginBottom:4 }}>{ch.name} <span style={{ fontSize:11, color:"#7878a0" }}>({ch.role})</span></div>
          {row("성격", ch.personality)}{row("동기", ch.motivation)}{row("외형", ch.appearance)}{row("말투", ch.speech)}
        </div>
      ))}
      {result.stageId === 4 && Array.isArray(data.locations) && (data.locations as Record<string,string>[]).map((loc, i) => (
        <div key={i} style={{ marginBottom:8, paddingBottom:8, borderBottom:"1px solid #2a2a3d" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#eeeef5", marginBottom:4 }}>{loc.name} <span style={{ fontSize:11, color:"#7878a0" }}>({loc.type})</span></div>
          {row("분위기", loc.atmosphere)}{row("서사적 의미", loc.significance)}
        </div>
      ))}
      {result.stageId === 5 && <>
        {Array.isArray(data.foreshadowing) && (data.foreshadowing as Record<string,string>[]).map((f, i) => (
          <div key={i} style={{ marginBottom:8, paddingBottom:8, borderBottom:"1px solid #2a2a3d" }}>
            {row(`복선 ${i+1}`, f.setup)}{row("회수", f.payoff)}
          </div>
        ))}
        {Array.isArray(data.hints) && row("암시", (data.hints as string[]).join(", "))}
        {Array.isArray(data.red_herrings) && row("훼이크", (data.red_herrings as string[]).join(", "))}
      </>}
      {/* Fallback: 구조화 실패 시 단계별 상세 요약 */}
      {data.raw_summary && (
        <div style={{ fontSize:13, color:"#d4d4e8", lineHeight:1.85, whiteSpace:"pre-wrap" as const, background:"#12121c", borderRadius:8, padding:"12px 14px" }}>
          {String(data.raw_summary)}
        </div>
      )}
    </div>
  );
}

function MsgBubble({ msg }: { key?: string; msg: Msg }) {
  const ag = AGENTS[msg.agent];
  const isUser = msg.agent === "user";
  return (
    <div className={`${s.msgRow} ${isUser ? s.msgRowUser : ""}`}>
      {!isUser && <div className={s.avatar} style={{ background: ag.bg, color: ag.color, border: `1px solid ${ag.color}40` }}>{ag.ini}</div>}
      <div className={s.msgMain}>
        {!isUser && <div className={s.agentName} style={{ color: ag.color }}>{ag.label}</div>}
        <div className={`${s.bubble} ${isUser ? s.bubbleUser : ""}`} style={!isUser ? { borderLeft: `3px solid ${ag.color}60` } : {}}>
          {msg.streaming && !msg.text ? <ThinkingDots /> : (
            <span className={s.msgText}>{msg.text}{msg.streaming && <StreamCursor />}</span>
          )}
        </div>
      </div>
      {isUser && <div className={s.avatar} style={{ background: ag.bg, color: ag.color, border: `1px solid ${ag.color}40` }}>나</div>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Phase2Page({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();

  // ── State ──
  const [genre, setGenre] = useState("판타지");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [debatePhase, setDebatePhase] = useState<DebatePhase>("idle");
  const [currentStageIdx, setCurrentStageIdx] = useState(0); // index into STAGES
  const [stageResults, setStageResults] = useState<StageResult[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [stageHistoryMsgs, setStageHistoryMsgs] = useState<Record<number, Msg[]>>({}); // 단계별 토론 기록
  const [viewingStageIdx, setViewingStageIdx] = useState<number | null>(null); // 열람 중인 이전 단계

  // ── Refs ──
  const bottomRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const abortRef = useRef(false);
  const pendingUserMsgRef = useRef<string | null>(null);
  const convRef = useRef<string[]>([]); // transcript: 각 에이전트 발언 문자열 배열
  const stageResultsRef = useRef<StageResult[]>([]);
  const msgsRef = useRef<Msg[]>([]); // msgs의 최신값 추적용
  const resumeDataRef = useRef<{ transcript: string[]; msgs: Msg[] } | null>(null);

  // ── Mount: restore from localStorage ──
  useEffect(() => {
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.genre) setGenre(p1.input.genre);

      const savedData = localStorage.getItem(`wts_phase2_${projectId}`);
      if (savedData) {
        const parsed = JSON.parse(savedData) as { stageResults: StageResult[]; currentStageIdx: number; stageHistoryMsgs?: Record<number, Msg[]> };
        if (parsed.stageResults?.length) {
          stageResultsRef.current = parsed.stageResults;
          setStageResults(parsed.stageResults);
          if (parsed.stageHistoryMsgs) setStageHistoryMsgs(parsed.stageHistoryMsgs);
          const idx = parsed.currentStageIdx ?? 0;
          setCurrentStageIdx(idx);
          if (idx >= STAGES.length) {
            setDebatePhase("done");
          } else {
            // 진행 중인 토론이 저장되어 있으면 "이어하기" 상태로
            const savedConv = localStorage.getItem(`p2_conv_${idx}_${projectId}`);
            const savedMsgs = localStorage.getItem(`p2_msgs_${idx}_${projectId}`);
            if (savedConv && savedMsgs) {
              resumeDataRef.current = {
                transcript: JSON.parse(savedConv) as string[],
                msgs: JSON.parse(savedMsgs) as Msg[],
              };
              setDebatePhase("paused");
            } else {
              setDebatePhase("confirmed");
            }
          }
          return;
        }
      }
    } catch { /* ignore */ }
  }, [projectId]);

  useEffect(() => { msgsRef.current = msgs; }, [msgs]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  useEffect(() => {
    if (!projectId || msgs.length === 0) return;
    if (msgs.some((m: Msg) => m.streaming)) return;
    localStorage.setItem(`p2_msgs_${projectId}`, JSON.stringify(msgs));
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

  // ── Message helpers ──
  const addMsg = useCallback((agent: AgentId, text = "", streaming = false): string => {
    const id = uid();
    setMsgs((prev: Msg[]) => [...prev, { id, agent, text, streaming }]);
    return id;
  }, []);

  const updateMsg = useCallback((id: string, text: string, streaming: boolean) => {
    setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === id ? { ...m, text, streaming } : m));
  }, []);

  // ── Run debate: 자연스러운 토론 루프 (Phase 1과 동일 방식) ──
  const runDebate = useCallback(async (stageIdx: number) => {
    if (runningRef.current) return;
    runningRef.current = true;
    abortRef.current = false;
    setDebatePhase("running");
    setApiError(null);

    const stage = STAGES[stageIdx];

    // 롤링 요약 + 사용자 컨텍스트 상태
    let conversationSummary = "";
    let turnsSinceLastSummary = 0;
    let lastUserMsg = "";
    let userTurnCount = 0;
    let wrapUpProposed = false;
    let wrapUpProposedAt = 0;
    let naturalExit = false;
    const WRAP_UP_AFTER = 12;
    const WRAP_UP_AUTO_MS = 30_000;
    const AGREE_RE = /^(그래|응|ㅇㅇ|좋아|해줘|시작|정리|맞아|그렇게|ㄱ|ok|오케|ㅇㅋ|확인|다음)/i;

    // 이어하기: 저장된 트랜스크립트 복원 / 새 시작: 빈 배열
    let transcript: string[];
    if (resumeDataRef.current) {
      transcript = [...resumeDataRef.current.transcript];
      setMsgs(resumeDataRef.current.msgs);
      resumeDataRef.current = null;
    } else {
      transcript = [];
    }
    convRef.current = transcript;

    // Phase 2 에이전트 동적 선택
    const P2_AGENTS: AgentId[] = ["worldbuilder", "character", "scenario", "script", "editor"];
    let agentIndex = 0;
    let lastSpeaker: AgentId | null = null;

    function pickNextSpeaker(lastLine: string, last: AgentId | null): AgentId {
      const available = P2_AGENTS.filter(a => a !== last);
      if (!available.length) return P2_AGENTS[0];
      const lower = lastLine.toLowerCase();
      if (/세계|배경|규칙|설정|시대|문명|마법|공간/.test(lower) && available.includes("worldbuilder")) return "worldbuilder";
      if (/캐릭터|인물|주인공|감정|성격|외형|말투|빌런/.test(lower) && available.includes("character")) return "character";
      if (/이야기|서사|플롯|갈등|전개|장르|훅|전제/.test(lower) && available.includes("scenario")) return "scenario";
      if (/그림|연출|장면|시각|컷|화면|비주얼|그려/.test(lower) && available.includes("script")) return "script";
      if (/편집|구조|흐름|전반적|연결/.test(lower) && available.includes("editor")) return "editor";
      return available[agentIndex % available.length];
    }

    // 롤링 요약 (백그라운드 비동기, 누적 갱신)
    const refreshSummary = () => {
      if (transcript.length < 3) return;
      const key = getAnthropicKeyByIndex(getApiKeyIndexForAgent(agentIndex));
      if (!key) return;
      void (async () => {
        let next = "";
        try {
          for await (const chunk of streamClaude({
            apiKey: key,
            systemPrompt: "웹툰 기획 토론 요약 전문가. 핵심만 2문장 이내로.",
            messages: [{
              role: "user",
              content: `${conversationSummary ? `이전 요약: ${conversationSummary}\n\n` : ""}최근 대화:\n${transcript.slice(-5).join("\n")}\n\n합쳐서 2문장 이내 요약. 핵심 합의사항·의견 포함. 마크다운 금지.`,
            }],
            maxTokens: 120,
            tools: [],
          })) next += chunk;
        } catch { /* ignore */ }
        if (next.trim()) conversationSummary = next.trim();
      })();
    };

    // 단일 에이전트 타이프라이터 효과 (백그라운드 스트림 → 재생)
    const runSingleAgent = async (agentId: AgentId, userContent: string, tokens: number) => {
      const key = getAnthropicKeyByIndex(getApiKeyIndexForAgent(agentIndex));
      if (!key) return;
      const msgId = addMsg(agentId, "", true);
      let text = "";
      try {
        for await (const chunk of streamClaude({
          apiKey: key,
          systemPrompt: buildSingleAgentPrompt(stage.id, genre, agentId, stageResultsRef.current),
          messages: [{ role: "user", content: userContent }],
          maxTokens: tokens,
          tools: [],
        })) {
          if (abortRef.current) break;
          text += chunk;
        }
      } catch (err) {
        setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== msgId));
        const raw = err instanceof Error ? err.message : String(err);
        if (!raw.includes("abort") && !abortRef.current) setApiError(`API 오류: ${raw}`);
        return;
      }
      const clean = text.trim().replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/[#>_`]/g, "");
      if (!clean) { setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== msgId)); return; }
      // 타이프라이터: 2자씩 120ms
      const CHARS = 2; const TICK = 120;
      for (let i = CHARS; i < clean.length; i += CHARS) {
        if (abortRef.current) break;
        updateMsg(msgId, clean.slice(0, i), true);
        await sleep(TICK);
      }
      updateMsg(msgId, clean, false);
      transcript.push(`[${AGENTS[agentId].label}]: ${clean}`);
      convRef.current = transcript;
      agentIndex++;
      lastSpeaker = agentId;
      // 진행 저장 (이어하기 지원)
      try {
        localStorage.setItem(`p2_conv_${stageIdx}_${projectId}`, JSON.stringify(transcript));
        localStorage.setItem(`p2_msgs_${stageIdx}_${projectId}`, JSON.stringify(msgsRef.current.filter((m: Msg) => !m.streaming)));
      } catch { /* ignore */ }
    };

    try {
      debateLoop: while (true) {
        if (abortRef.current) break;

        const agentTurnsSoFar = transcript.filter(l => !l.startsWith("[사용자]")).length;

        // 자동 마무리: wrapUp 제안 후 30초 동안 응답 없으면 자동 종료
        if (wrapUpProposed && !pendingUserMsgRef.current && Date.now() - wrapUpProposedAt > WRAP_UP_AUTO_MS) {
          addMsg("producer", "그럼 이 단계 확인하고 넘어갈게요.", false);
          transcript.push(`[총괄프로듀서]: 그럼 이 단계 확인하고 넘어갈게요.`);
          convRef.current = transcript;
          await sleep(1500);
          naturalExit = true;
          break debateLoop;
        }

        // 에이전트 간 대기 (9~15초), 사용자 입력 폴링
        if (agentTurnsSoFar > 0) {
          const waitMs = 9000 + Math.random() * 6000;
          const startWait = Date.now();
          while (Date.now() - startWait < waitMs) {
            if (abortRef.current || pendingUserMsgRef.current) break;
            await sleep(150);
          }
          if (abortRef.current) break;
        }

        // 사용자 메시지 처리
        const pendingMsg = pendingUserMsgRef.current;
        if (pendingMsg) {
          pendingUserMsgRef.current = null;
          addMsg("user", pendingMsg, false);
          transcript.push(`[사용자]: ${pendingMsg}`);
          convRef.current = transcript;
          lastUserMsg = pendingMsg;
          userTurnCount = 4;
          refreshSummary();
          turnsSinceLastSummary = 0;
          if (wrapUpProposed) {
            if (AGREE_RE.test(pendingMsg.trim())) { naturalExit = true; break debateLoop; }
            wrapUpProposed = false;
          }
        }

        // 주기적 요약 갱신
        turnsSinceLastSummary++;
        if (turnsSinceLastSummary >= 5) { refreshSummary(); turnsSinceLastSummary = 0; }

        // 히스토리 텍스트 구성
        const lastLine = transcript.filter(l => !l.startsWith("[사용자]")).slice(-1)[0] ?? "";
        const historyText = conversationSummary
          ? `[지금까지]: ${conversationSummary}\n${userTurnCount > 0 ? `[사용자 의견]: ${lastUserMsg}\n` : ""}[직전 발언]: ${lastLine}\n\n`
          : `[대화 내용]\n${transcript.slice(-3).join("\n")}\n\n`;
        if (userTurnCount > 0) userTurnCount--;

        // 마무리 조건 체크
        const recentLines = transcript.slice(-4).join(" ");
        const converging = agentTurnsSoFar >= 8 &&
          (recentLines.match(/정리|결론|충분|이 정도|마무리|확인|다음 단계/g) ?? []).length >= 2;

        if (!wrapUpProposed && (agentTurnsSoFar >= WRAP_UP_AFTER || converging)) {
          wrapUpProposed = true;
          wrapUpProposedAt = Date.now();
          await runSingleAgent("producer",
            `${historyText}[${stage.name}] 단계 토론이 충분히 됐어. 프로듀서로서 이 단계를 마무리하고 확인하자고 자연스럽게 제안해줘. 1~2문장.`,
            80);
          lastSpeaker = "producer";
          continue;
        }

        // 다음 발언자 선택 및 실행
        const isFirst = agentTurnsSoFar === 0;
        const nextAgent = isFirst ? "worldbuilder" : pickNextSpeaker(lastLine, lastSpeaker);

        const agentPrompt = isFirst
          ? `"${stage.topic}" 주제로 첫 의견을 자연스럽게 말해줘. 짧고 구어체로.`
          : userTurnCount > 0
            ? `${historyText}사용자 의견을 자연스럽게 반영해서 토론을 이어가줘.`
            : `${historyText}앞 대화 받아서 네 관점으로 짧게 한마디.`;

        await runSingleAgent(nextAgent, agentPrompt, 220);
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (!raw.includes("abort") && !abortRef.current) setApiError(`API 오류: ${raw}`);
    }

    runningRef.current = false;

    // 자연 종료 시 자동 확정 (inline — handleConfirm과 동일 로직)
    if (!abortRef.current && naturalExit) {
      setDebatePhase("confirming");
      const apiKey = getAnthropicKey();
      if (apiKey) {
        const debateText = convRef.current.join("\n");
        const extractId = addMsg("producer", "결과 정리 중...", true);
        const { data, summary } = await extractStageData(stage, genre, debateText, apiKey);
        updateMsg(extractId, "", false);
        setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== extractId));

        localStorage.removeItem(`p2_conv_${stageIdx}_${projectId}`);
        localStorage.removeItem(`p2_msgs_${stageIdx}_${projectId}`);

        const result: StageResult = { stageId: stage.id, data, summary };
        const newResults = [...stageResultsRef.current, result];
        stageResultsRef.current = newResults;
        setStageResults(newResults);

        const savedMsgs = msgsRef.current.filter((m: Msg) => !m.streaming);
        setStageHistoryMsgs((prev: Record<number, Msg[]>) => {
          const next = { ...prev, [stageIdx]: savedMsgs };
          localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({
            stageResults: newResults,
            currentStageIdx: stageIdx + 1,
            stageHistoryMsgs: next,
          }));
          return next;
        });

        setDebatePhase("confirmed");
      }
    }
  }, [genre, addMsg, updateMsg, projectId]);

  // ── Confirm current stage: stop debate → extract JSON → save ──
  const handleConfirm = useCallback(async (stageIdx: number) => {
    abortRef.current = true;
    setDebatePhase("confirming");

    while (runningRef.current) {
      await new Promise<void>(r => setTimeout(r, 100));
    }

    const stage = STAGES[stageIdx];
    const apiKey = getAnthropicKey();
    if (!apiKey) { setDebatePhase("running"); abortRef.current = false; return; }

    const debateText = convRef.current.join("\n");
    const extractId = addMsg("producer", "결과 정리 중...", true);

    const { data, summary } = await extractStageData(stage, genre, debateText, apiKey);

    updateMsg(extractId, "", false);
    setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== extractId));

    // 확정 완료 → in-progress 대화 삭제
    localStorage.removeItem(`p2_conv_${stageIdx}_${projectId}`);
    localStorage.removeItem(`p2_msgs_${stageIdx}_${projectId}`);

    const result: StageResult = { stageId: stage.id, data, summary };
    const newResults = [...stageResultsRef.current, result];
    stageResultsRef.current = newResults;
    setStageResults(newResults);

    // 현재 단계 토론 메시지 저장
    const savedMsgs = msgsRef.current.filter((m: Msg) => !m.streaming);
    setStageHistoryMsgs((prev: Record<number, Msg[]>) => {
      const next = { ...prev, [stageIdx]: savedMsgs };
      localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({
        stageResults: newResults,
        currentStageIdx: stageIdx + 1,
        stageHistoryMsgs: next,
      }));
      return next;
    });

    setDebatePhase("confirmed");
  }, [genre, projectId, addMsg, updateMsg]);

  // ── Move to next stage (only via button) ──
  const handleNextStage = useCallback((stageIdx: number) => {
    const nextIdx = stageIdx + 1;
    setMsgs([]);
    convRef.current = [];
    setCurrentStageIdx(nextIdx);
    if (nextIdx >= STAGES.length) {
      setDebatePhase("done");
    } else {
      void runDebate(nextIdx);
    }
  }, [runDebate]);

  const handleRestartNew = useCallback(() => {
    abortRef.current = true;
    localStorage.removeItem(`p2_msgs_${projectId}`);
    localStorage.removeItem(`wts_phase2_${projectId}`);
    STAGES.forEach((_, idx) => {
      localStorage.removeItem(`p2_conv_${idx}_${projectId}`);
      localStorage.removeItem(`p2_msgs_${idx}_${projectId}`);
    });
    resumeDataRef.current = null;
    convRef.current = [];
    stageResultsRef.current = [];
    runningRef.current = false;
    setMsgs([]); setStageResults([]); setCurrentStageIdx(0); setApiError(null);
    setStageHistoryMsgs({}); setViewingStageIdx(null);
    setDebatePhase("idle");
  }, [projectId]);

  // ── UI ──

  if (debatePhase === "idle") {
    return (
      <div className={s.page}>
        <div className={s.formWrap}>
          <h1 className={s.formTitle}>Phase 2 — 세계관 & 스토리 설계</h1>
          <p className={s.formDesc}>6단계 순차 토론으로 세계관·시놉시스·관계·인물·장소·구체화를 함께 완성합니다. 언제든 의견을 입력할 수 있습니다.</p>
          {apiError && <div style={{ background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.3)", borderRadius:10, padding:"10px 16px", marginBottom:16, fontSize:13, color:"#f87171" }}>⚠ {apiError}</div>}
          <div className={s.formCard}>
            <div className={s.prereqNote}>Phase 1 기획 데이터를 자동으로 불러옵니다.</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, margin:"12px 0" }}>
              {STAGES.map(st => (
                <div key={st.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:"#1a1a26", borderRadius:8 }}>
                  <span style={{ fontSize:12, fontWeight:800, color:st.color, minWidth:20 }}>{st.id}</span>
                  <span style={{ fontSize:13, color:"#c8d0dc", fontWeight:600 }}>{st.name}</span>
                  <span style={{ fontSize:11, color:"#4a4a6a", marginLeft:"auto" }}>{st.topic}</span>
                </div>
              ))}
            </div>
            <button className={s.btnStart} onClick={() => { void runDebate(0); }}>✦ 1단계부터 토론 시작</button>
          </div>
        </div>
      </div>
    );
  }

  const stage = STAGES[currentStageIdx] ?? STAGES[STAGES.length - 1];

  return (
    <div className={s.page}>
      <div className={s.chatLayout}>
        {/* Stage progress header */}
        <div className={s.chatHeader}>
          <div className={s.stepBar} style={{ padding:"0", background:"transparent", border:"none", flex:1 }}>
            {STAGES.map((st, idx) => {
              const isDone = stageResults.some((r: StageResult) => r.stageId === st.id);
              const isActive = idx === currentStageIdx && debatePhase !== "done";
              return (
                <div key={st.id} className={`${s.stepItem} ${isDone ? s.stepDone : ""} ${isActive ? s.stepActive : ""}`}>
                  <div className={s.stepDot} style={isDone || isActive ? { background:st.color } : {}} />
                  <span className={s.stepLabel} style={isDone || isActive ? { color:st.color } : {}}>{st.name}</span>
                </div>
              );
            })}
          </div>
          <button className={s.btnRestart} onClick={handleRestartNew} style={{ flexShrink:0, marginLeft:12 }}>↺ 초기화</button>
        </div>

        {apiError && (
          <div style={{ background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.3)", margin:"8px 16px", borderRadius:8, padding:"8px 14px", fontSize:13, color:"#f87171" }}>
            ⚠ {apiError}
          </div>
        )}

        {/* Confirmed stage results (above chat) */}
        {stageResults.length > 0 && (
          <div style={{ padding:"12px 16px 0" }}>
            {stageResults.map((r: StageResult, idx: number) => (
              <div key={r.stageId}>
                <StageResultCard
                  result={r}
                  onViewDebate={() => setViewingStageIdx(viewingStageIdx === idx ? null : idx)}
                  isViewingDebate={viewingStageIdx === idx}
                />
                {/* 토론 내용 인라인 뷰어 */}
                {viewingStageIdx === idx && (
                  <div style={{ background:"#0e0e1a", border:"1px solid #2a2a3d", borderRadius:10, padding:"12px 16px", marginBottom:8, maxHeight:400, overflowY:"auto" as const }}>
                    <div style={{ fontSize:11, fontWeight:700, color:"#4a4a6a", marginBottom:10, letterSpacing:"0.05em" }}>
                      {STAGES[idx].name} 토론 기록
                    </div>
                    {(stageHistoryMsgs[idx] ?? []).length === 0
                      ? <div style={{ fontSize:13, color:"#4a4a6a" }}>저장된 토론 내용이 없습니다.</div>
                      : (stageHistoryMsgs[idx] ?? []).map((m: Msg) => <MsgBubble key={m.id} msg={m} />)
                    }
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className={s.chatBody}>
          {msgs.map((m: Msg) => <MsgBubble key={m.id} msg={m} />)}
          <div ref={bottomRef} />
        </div>

        <div className={s.chatBottom}>
          {/* Paused: 이전 토론 이어하기 */}
          {debatePhase === "paused" && (
            <div className={s.gatingRow}>
              <div>
                <div className={s.gatingMsg}>⏸ 이전에 진행하던 토론이 있습니다</div>
                <div style={{ fontSize:11, color:"#64748b", marginTop:3 }}>이어하기를 누르면 중단된 지점부터 재개됩니다</div>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button className={s.btnGating} style={{ width:"auto", padding:"10px 16px" }} onClick={() => void runDebate(currentStageIdx)}>이어하기 →</button>
                <button className={s.btnRestart} onClick={() => { resumeDataRef.current = null; void runDebate(currentStageIdx); }}>새로 시작</button>
              </div>
            </div>
          )}

          {/* Running: confirm button */}
          {debatePhase === "running" && (
            <div style={{ padding:"6px 16px 0" }}>
              <button
                onClick={() => { void handleConfirm(currentStageIdx); }}
                style={{
                  width:"100%", background:"rgba(52,211,153,0.08)", border:"1px solid rgba(52,211,153,0.3)",
                  borderRadius:8, color:"#34d399", fontSize:13, fontWeight:700,
                  padding:"9px 0", cursor:"pointer", letterSpacing:"0.02em",
                }}>
                ✓ 이 단계 확정하고 결과 정리
              </button>
            </div>
          )}

          {/* Confirming: spinner */}
          {debatePhase === "confirming" && (
            <div style={{ padding:"10px 20px", fontSize:13, color:"#fbbf24" }}>📝 결과 정리 중...</div>
          )}

          {/* Confirmed: next stage button */}
          {debatePhase === "confirmed" && (
            <div className={s.gatingRow}>
              <div>
                <div className={s.gatingMsg}>✓ {stage.name} 확정 완료</div>
                <div style={{ fontSize:11, color:"#64748b", marginTop:3 }}>
                  {currentStageIdx + 1 < STAGES.length
                    ? `다음: ${STAGES[currentStageIdx + 1].name} 토론`
                    : "모든 단계 완료 — Phase 3 진행 가능"}
                </div>
              </div>
              <button
                className={s.btnGating}
                style={{ width:"auto", padding:"10px 20px" }}
                onClick={() => handleNextStage(currentStageIdx)}>
                {currentStageIdx + 1 < STAGES.length
                  ? `${STAGES[currentStageIdx + 1].name} 시작 →`
                  : "Phase 3 시작 →"}
              </button>
            </div>
          )}

          {/* Done — all stages complete */}
          {debatePhase === "done" && (
            <div className={s.gatingRow}>
              <span className={s.gatingMsg}>✓ Phase 2 전체 완료 — Phase 3 진행 가능</span>
              <div style={{ display:"flex", gap:8 }}>
                <button className={s.btnRestart} onClick={handleRestartNew}>재생성</button>
                <button className={s.btnGating} style={{ width:"auto", padding:"10px 20px" }} onClick={() => router.push(`/projects/${projectId}/phase-3`)}>Phase 3 시작 →</button>
              </div>
            </div>
          )}

          {/* Chat input during running */}
          {debatePhase === "running" && (
            <div className={s.inputRow}>
              <textarea
                className={s.chatInput} rows={1}
                placeholder="의견 입력 (Enter 전송) · 토론에 개입하려면 여기에 입력"
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

