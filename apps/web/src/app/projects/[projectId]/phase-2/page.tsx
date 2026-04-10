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

const STAGES = [
  { id: 1 as const, name: "세계관 형성",    desc: "시대·배경·세계 규칙",         tag: "WORLD"           },
  { id: 2 as const, name: "시놉시스 제작",  desc: "로그라인·전제·갈등",           tag: "SYNOPSIS"        },
  { id: 3 as const, name: "관계 구조",      desc: "대립·발전·상생·최종목표",      tag: "RELATIONS"       },
  { id: 4 as const, name: "등장인물 설정",  desc: "주요 캐릭터 상세",             tag: "CHARACTERS"      },
  { id: 5 as const, name: "장소 설정",      desc: "주요 배경 공간",               tag: "LOCATIONS"       },
  { id: 6 as const, name: "시놉시스 구체화",desc: "전체 시놉시스 완성",           tag: "SYNOPSIS_DETAIL" },
];
type StageId = 1 | 2 | 3 | 4 | 5 | 6;

interface StageResult {
  stageId: StageId;
  data: Record<string, unknown>;
  summary: string;
}

interface Msg {
  id: string;
  agent: AgentId;
  text: string;
  type: "text" | "stage_divider" | "stage_result";
  streaming: boolean;
  round?: number;
  stageId?: StageId;
  stageData?: Record<string, unknown>;
}

type DebatePhase = "idle" | "running" | "paused" | "extracting" | "stage_complete" | "all_done";

function uid() { return Math.random().toString(36).slice(2, 10); }

// ─── JSON block parsers ───────────────────────────────────────────────────────

function parseBlock<T>(text: string, tag: string): T | null {
  const re = new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${tag}\\]`);
  const m = text.match(re);
  if (!m) return null;
  try { return JSON.parse(m[1]) as T; } catch { return null; }
}

// ─── Stage system prompt builder ──────────────────────────────────────────────

const STAGE_GUIDES: Record<StageId, string> = {
  1: "세계관 형성 — 시대적 배경, 세계의 핵심 규칙 3가지, 분위기, 특수 설정을 논의합니다.",
  2: "시놉시스 제작 — 이야기 한 줄 요약(로그라인), 전제, 핵심 갈등, 해결 방향을 논의합니다.",
  3: "관계 구조 — 캐릭터 간 대립/발전/상생 관계와 시리즈 최종 목표를 논의합니다.",
  4: "등장인물 설정 — 주요 캐릭터들의 이름·역할·성격·동기·외형·말투를 구체화합니다.",
  5: "장소 설정 — 주요 배경 장소의 이름·유형·분위기·서사적 의미를 논의합니다.",
  6: "시놉시스 구체화 — 전체 시놉시스, 3막 구조, 핵심 장면을 완성합니다.",
};

function buildStageSystemPrompt(
  stageId: StageId,
  genre: string,
  stageResults: StageResult[],
  currentCharacter?: string,
): string {
  const get = (id: StageId): string => stageResults.find(r => r.stageId === id)?.summary ?? "";
  const stageName = STAGES.find(s => s.id === stageId)?.name ?? "";

  // 단계별로 필요한 이전 결과만 정확히 주입
  const prevLines: string[] = [];
  if (stageId >= 2 && get(1)) prevLines.push(`세계관: ${get(1)}`);
  if (stageId >= 3 && get(2)) prevLines.push(`시놉시스: ${get(2)}`);
  if (stageId >= 4 && get(3)) prevLines.push(`관계구조: ${get(3)}`);
  if (stageId >= 5 && get(4)) prevLines.push(`등장인물: ${get(4)}`);
  if (stageId >= 6 && get(5)) prevLines.push(`장소: ${get(5)}`);

  const prevCtx = prevLines.length > 0
    ? `\n### 확정된 이전 단계 결과 (반드시 이것을 기반으로 토론)\n${prevLines.join("\n")}`
    : "";

  // Stage 4 전용: 현재 토론 중인 인물
  const charCtx = (stageId === 4 && currentCharacter)
    ? `\n\n### 지금 집중할 인물\n${currentCharacter}\n이 인물 논의가 충분하면 총괄프로듀서가 "이 인물 정리됐습니다. 다음 인물로 넘어갈까요?" 라고만 묻는다. 절대 자동 진행 금지.`
    : "";

  return `너는 웹툰 기획팀 전문가들이 참여하는 Phase 2 ${stageId}단계 "${stageName}" 회의를 진행한다.

### ⚠️ 단계 고정 규칙 (최우선)
- 지금은 오직 ${stageId}단계 "${stageName}"만 토론한다.
- 다른 단계 내용을 미리 언급하거나 진행하는 것을 절대 금지한다.
- 사용자가 명시적으로 승인하기 전까지 절대 다음 단계로 넘어가지 않는다.

### 현재 단계
${STAGE_GUIDES[stageId]}
장르: ${genre}
${prevCtx}${charCtx}

### 참여자와 성격
- [세계관설계자]: 설정 규칙 집착. 논리적 근거 요구.
- [캐릭터디자이너]: 외형과 감정 우선.
- [시나리오작가]: 서사 연결 관점.
- [연출작가]: 시각적 구현 관점.
- [총괄프로듀서]: 중재자. 현재 단계 논의가 충분하다고 판단되면 "이 단계 정리됐습니다. 다음으로 넘어갈까요?" 라고만 묻는다. 절대 다음 단계를 선언하거나 자동 진행하지 않는다.
- [편집자]: 평소 침묵. 토론이 길어지면 앞 대화를 직접 인용하며 현재 단계 마무리를 유도한다.

### 출력 형식
[이름]: 대사

### 출력 규칙
- 직전 발언에 직접 반응하는 사람 1명만 말한다.
- 1~2문장. 마크다운 절대 금지. 카카오톡처럼 짧고 자연스러운 한국어.
- [사용자]: 발언 시 반드시 직접 반응한다.
- JSON 블록 출력 절대 금지. 오직 대화만.`;
}

// ─── Stage JSON extraction prompt ─────────────────────────────────────────────

const STAGE_SCHEMAS: Record<StageId, string> = {
  1: '{"era":"시대/배경","atmosphere":"분위기","world_rules":["규칙1","규칙2","규칙3"],"special_elements":"특수 설정"}',
  2: '{"logline":"한 줄 요약","premise":"전제","conflict":"핵심 갈등","resolution_hint":"해결 방향"}',
  3: '{"opposition":[{"a":"A","b":"B","desc":"대립 이유"}],"development":[{"character":"캐릭터","arc":"성장"}],"symbiosis":[{"a":"A","b":"B","desc":"상생"}],"final_goal":"최종 목표"}',
  4: '{"characters":[{"name":"이름","role":"주인공/빌런/조력자","age":"나이","personality":"성격","motivation":"동기","appearance":"외형","speech":"말투"}]}',
  5: '{"locations":[{"name":"장소명","type":"유형","atmosphere":"분위기","significance":"서사적 의미"}]}',
  6: '{"full_synopsis":"전체 시놉시스","act1":"1막","act2":"2막","act3":"3막","key_scenes":["핵심 장면1","핵심 장면2"]}',
};

function buildExtractionPrompt(stageId: StageId, genre: string, debateContext: string): string {
  const st = STAGES.find(s => s.id === stageId)!;
  return `당신은 Phase 2 "${st.name}" 토론 결과를 JSON으로 정리합니다.
토론: ${debateContext.slice(0, 3000)}
장르: ${genre}
아래 형식으로만 출력 (JSON만, 설명 없이):
[${st.tag}]
${STAGE_SCHEMAS[stageId]}
[/${st.tag}]`;
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

function StreamCursor() {
  return <span style={{ display: "inline-block", width: 2, height: 13, background: "#7c6cfc", marginLeft: 2, verticalAlign: "middle", borderRadius: 1, animation: "blink 0.9s step-start infinite" }} />;
}

const STAGE_COLORS: Record<StageId, string> = { 1:"#60a5fa", 2:"#34d399", 3:"#fbbf24", 4:"#fb923c", 5:"#a78bfa", 6:"#f87171" };

function StageDivider({ stageId, done }: { stageId: StageId; done?: boolean }) {
  const st = STAGES.find(s => s.id === stageId)!;
  const c = STAGE_COLORS[stageId];
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", margin:"8px 0" }}>
      <div style={{ flex:1, height:1, background:"#2a2a3d" }} />
      <span style={{ fontSize:11, fontWeight:800, color:c, border:`1px solid ${c}40`, borderRadius:99, padding:"3px 12px", background:`${c}10`, letterSpacing:"0.05em" }}>
        {done ? "✓" : "▶"} {stageId}단계 — {st.name}
      </span>
      <div style={{ flex:1, height:1, background:"#2a2a3d" }} />
    </div>
  );
}

function StageResultCard({ stageId, data }: { stageId: StageId; data: Record<string, unknown> }) {
  const st = STAGES.find(s => s.id === stageId)!;
  const c = STAGE_COLORS[stageId];
  const row = (label: string, val: unknown) => val ? (
    <div key={label} style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"6px 0", borderBottom:"1px solid #1e1e2a" }}>
      <span style={{ fontSize:10, fontWeight:700, color:"#4a4a68", minWidth:72, flexShrink:0, paddingTop:2, textTransform:"uppercase" as const, letterSpacing:"0.4px" }}>{label}</span>
      <span style={{ fontSize:13, color:"#eeeef5", lineHeight:1.6 }}>{Array.isArray(val) ? (val as unknown[]).join(" · ") : String(val)}</span>
    </div>
  ) : null;

  return (
    <div style={{ background:`${c}08`, border:`1px solid ${c}30`, borderRadius:10, padding:"14px 16px", margin:"6px 0" }}>
      <div style={{ fontSize:10, fontWeight:800, color:c, textTransform:"uppercase" as const, letterSpacing:"0.7px", marginBottom:10 }}>✓ {st.name} 완료</div>
      {stageId === 1 && <>{row("시대/배경", data.era)}{row("분위기", data.atmosphere)}{row("세계 규칙", data.world_rules)}{row("특수 설정", data.special_elements)}</>}
      {stageId === 2 && <>{row("로그라인", data.logline)}{row("전제", data.premise)}{row("갈등", data.conflict)}{row("해결 방향", data.resolution_hint)}</>}
      {stageId === 3 && <>
        {row("최종 목표", data.final_goal)}
        {Array.isArray(data.opposition) && (data.opposition as Record<string,string>[]).map((o, i) => row(`대립${i+1}`, `${o.a} ↔ ${o.b}: ${o.desc}`))}
        {Array.isArray(data.development) && (data.development as Record<string,string>[]).map((d, i) => row(`발전${i+1}`, `${d.character}: ${d.arc}`))}
        {Array.isArray(data.symbiosis) && (data.symbiosis as Record<string,string>[]).map((sy, i) => row(`상생${i+1}`, `${sy.a} + ${sy.b}: ${sy.desc}`))}
      </>}
      {stageId === 4 && Array.isArray(data.characters) && (data.characters as Record<string,string>[]).map((ch, i) => (
        <div key={i} style={{ marginBottom:8, paddingBottom:8, borderBottom:"1px solid #2a2a3d" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#eeeef5", marginBottom:4 }}>{ch.name} <span style={{ fontSize:11, color:"#7878a0" }}>({ch.role})</span></div>
          {row("성격", ch.personality)}{row("동기", ch.motivation)}{row("외형", ch.appearance)}{row("말투", ch.speech)}
        </div>
      ))}
      {stageId === 5 && Array.isArray(data.locations) && (data.locations as Record<string,string>[]).map((loc, i) => (
        <div key={i} style={{ marginBottom:8, paddingBottom:8, borderBottom:"1px solid #2a2a3d" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#eeeef5", marginBottom:4 }}>{loc.name} <span style={{ fontSize:11, color:"#7878a0" }}>({loc.type})</span></div>
          {row("분위기", loc.atmosphere)}{row("서사적 의미", loc.significance)}
        </div>
      ))}
      {stageId === 6 && <>{row("시놉시스", data.full_synopsis)}{row("1막", data.act1)}{row("2막", data.act2)}{row("3막", data.act3)}{row("핵심 장면", data.key_scenes)}</>}
    </div>
  );
}

function MsgBubble({ msg }: { key?: string; msg: Msg }) {
  if (msg.type === "stage_divider") return <StageDivider stageId={msg.stageId!} done />;
  if (msg.type === "stage_result" && msg.stageData) return <StageResultCard stageId={msg.stageId!} data={msg.stageData} />;
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
  const [currentStage, setCurrentStage] = useState<StageId>(1);
  const [stageResults, setStageResults] = useState<StageResult[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  // Stage 4 전용: 현재 토론 중인 인물
  const [currentCharacter, setCurrentCharacter] = useState("주인공");

  // ── Refs ──
  const bottomRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const pendingUserMsgRef = useRef<string | null>(null);
  const stageConvRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const stageResultsRef = useRef<StageResult[]>([]);
  const currentCharacterRef = useRef("주인공");

  // ── Mount: restore from localStorage ──
  useEffect(() => {
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.genre) setGenre(p1.input.genre);

      const savedData = localStorage.getItem(`wts_phase2_${projectId}`);
      if (savedData) {
        const parsed = JSON.parse(savedData) as { stageResults: StageResult[]; currentStage: StageId; msgs: Msg[] };
        if (parsed.stageResults?.length) {
          stageResultsRef.current = parsed.stageResults;
          setStageResults(parsed.stageResults);
          setCurrentStage(parsed.currentStage ?? 1);
          if (parsed.msgs?.length) setMsgs(parsed.msgs);
          // If all 6 stages done
          if (parsed.currentStage > 6) {
            setDebatePhase("all_done");
          } else {
            setDebatePhase("paused");
          }
          return;
        }
      }

      const savedMsgs = localStorage.getItem(`p2_msgs_${projectId}`);
      if (savedMsgs) {
        const ms = JSON.parse(savedMsgs) as Msg[];
        if (ms.length > 0) { setMsgs(ms); setDebatePhase("paused"); }
      }
      const savedConv = localStorage.getItem(`p2_conv_${projectId}`);
      if (savedConv) stageConvRef.current = JSON.parse(savedConv) as Array<{ role: "user" | "assistant"; content: string }>;
    } catch { /* ignore */ }
  }, [projectId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  useEffect(() => {
    if (!projectId || msgs.length === 0) return;
    if (msgs.some((m: Msg) => m.streaming)) return;
    localStorage.setItem(`p2_msgs_${projectId}`, JSON.stringify(msgs.filter((m: Msg) => m.type === "text")));
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
  const addMsg = useCallback((agent: AgentId, round: number, text = "", streaming = false, type: Msg["type"] = "text", extra?: Partial<Msg>): string => {
    const id = uid();
    setMsgs((prev: Msg[]) => [...prev, { id, agent, text, type, streaming, round, ...extra }]);
    return id;
  }, []);

  const updateMsg = useCallback((id: string, text: string, streaming: boolean, extra?: Partial<Msg>) => {
    setMsgs((prev: Msg[]) => prev.map((m: Msg) => m.id === id ? { ...m, text, streaming, ...extra } : m));
  }, []);

  // ── Extract stage JSON after debate ends ──
  const extractStageResult = useCallback(async (
    stageId: StageId,
    apiKey: string,
    debateText: string,
  ): Promise<StageResult | null> => {
    setDebatePhase("extracting");
    const extractId = addMsg("producer", 0, "결과 정리 중...", true);
    let fullText = "";
    try {
      for await (const chunk of streamClaude({
        apiKey,
        systemPrompt: "당신은 토론 결과를 정확한 JSON으로 변환하는 전문가입니다.",
        messages: [{ role: "user", content: buildExtractionPrompt(stageId, genre, debateText) }],
        maxTokens: 1500,
      })) {
        fullText += chunk;
        updateMsg(extractId, `결과 정리 중... (${fullText.length}자)`, true);
      }
    } catch { /* ignore */ }

    const st = STAGES.find(s => s.id === stageId)!;
    const data = parseBlock<Record<string, unknown>>(fullText, st.tag);
    updateMsg(extractId, "", false, { type: "text", text: "" });
    // Remove loading msg, show result card instead
    setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== extractId));

    if (!data) return null;
    const summary = Object.entries(data)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as unknown[]).slice(0, 2).join(", ") : String(v).slice(0, 60)}`)
      .join(" / ");
    return { stageId, data, summary };
  }, [genre, addMsg, updateMsg]);

  // ── Single stage debate loop ──
  const runStageDebate = useCallback(async (stageId: StageId, resumeConv?: Array<{ role: "user" | "assistant"; content: string }>) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setDebatePhase("running");
    setApiError(null);

    const apiKey = getAnthropicKey();
    if (!apiKey) { setApiError("ANTHROPIC_API_KEY가 설정되지 않았습니다."); runningRef.current = false; return; }

    const systemPrompt = buildStageSystemPrompt(
      stageId, genre, stageResultsRef.current,
      stageId === 4 ? currentCharacterRef.current : undefined,
    );
    const convHistory: Array<{ role: "user" | "assistant"; content: string }> =
      resumeConv ? [...resumeConv] : [];

    const st = STAGES.find(s => s.id === stageId)!;
    if (convHistory.length === 0) {
      const charHint = stageId === 4 ? ` 첫 번째 인물(${currentCharacterRef.current})부터 시작합니다.` : "";
      convHistory.push({ role: "user", content: `${stageId}단계 "${st.name}" 토론을 시작합니다. 장르: ${genre}${charHint}` });
    } else {
      convHistory.push({ role: "user", content: "이전 논의를 이어서 계속해주세요." });
    }

    // 사용자가 명시적으로 입력해야만 단계 전환 — AI 발언으로는 절대 전환 금지
    // "다음 인물"은 stage 4 내부 이동이므로 단계 전환 트리거에서 제외
    const USER_ADVANCE_TRIGGERS = ["다음 단계", "단계 완료", "단계 넘어가"];
    const MAX_ROUNDS = 80;
    let round = 0;

    try {
      debateLoop: for (round = 1; round <= MAX_ROUNDS; round++) {
        setTurnCount(round);
        let roundText = "";
        const roundMsgIds = new Map<AgentId, string>();

        for await (const chunk of streamClaude({ apiKey, systemPrompt, messages: convHistory, maxTokens: 200, tools: [] })) {
          roundText += chunk;
          for (const { agentId, text } of parseAgentMessages(roundText)) {
            if (!roundMsgIds.has(agentId)) roundMsgIds.set(agentId, addMsg(agentId, round, text, true));
            else updateMsg(roundMsgIds.get(agentId)!, text, true);
          }
        }
        const finalParsed = parseAgentMessages(roundText);
        for (const [agentId, id] of roundMsgIds)
          updateMsg(id, finalParsed.find(m => m.agentId === agentId)?.text ?? "", false);

        convHistory.push({ role: "assistant", content: roundText });

        // Compress every 10 rounds
        if (round % 10 === 0 && convHistory.length > 12) {
          const initial = convHistory[0];
          const recent = convHistory.slice(-6);
          const old = convHistory.slice(1, -6).filter(m => m.role === "assistant");
          if (old.length) {
            let summary = "";
            for await (const c of streamClaude({ apiKey, systemPrompt: "토론 요약 전문가. 핵심 쟁점만 간결하게.", messages: [{ role: "user", content: `요약:\n${old.map(m => m.content).join("\n").slice(0, 2000)}` }], maxTokens: 300, tools: [] })) summary += c;
            convHistory.length = 0;
            convHistory.push(initial, { role: "assistant", content: `[이전 토론 요약] ${summary}` }, { role: "user", content: "위 요약을 참고해서 계속해줘." }, ...recent);
          }
        }

        localStorage.setItem(`p2_conv_${projectId}`, JSON.stringify(convHistory));
        stageConvRef.current = convHistory;

        // ← AI 발언으로는 단계 전환하지 않음

        await sleep(3500);

        const pending = pendingUserMsgRef.current;
        if (pending) {
          pendingUserMsgRef.current = null;
          addMsg("user", round, pending, false);
          // 사용자가 명시적으로 승인할 때만 단계 종료
          if (USER_ADVANCE_TRIGGERS.some(t => pending.includes(t))) break debateLoop;
          convHistory.push({ role: "user", content: `[사용자]: ${pending}\n위 내용에 직접 반응해줘.` });
        } else if (round === 40) {
          // 40라운드: 편집자가 마무리 유도, 프로듀서가 사용자에게 묻도록 (선언 X)
          convHistory.push({ role: "user", content: "[시스템] 편집자가 앞 대화를 인용해 현재 단계 논의를 정리하고, 총괄프로듀서가 '이 단계 정리됐습니다. 다음으로 넘어갈까요?' 라고만 물어봐. 절대 다음 단계를 선언하거나 진행하지 마." });
        } else {
          convHistory.push({ role: "user", content: "계속 토론해줘." });
        }
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setApiError(raw.includes("401") ? "API 키가 유효하지 않습니다." : `API 오류: ${raw}`);
      runningRef.current = false;
      setDebatePhase("paused");
      return;
    }

    runningRef.current = false;

    // Extract stage JSON
    const debateText = convHistory.filter(m => m.role === "assistant").map(m => m.content).join("\n\n");
    const result = await extractStageResult(stageId, apiKey, debateText);

    if (result) {
      const newResults = [...stageResultsRef.current, result];
      stageResultsRef.current = newResults;
      setStageResults(newResults);
      addMsg("producer", 0, "", false, "stage_divider", { stageId });
      addMsg("producer", 0, "", false, "stage_result", { stageId, stageData: result.data });
      // Save
      const nextStage = (stageId < 6 ? stageId + 1 : 7) as StageId | 7;
      localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({
        stageResults: newResults,
        currentStage: nextStage,
        msgs: msgs,
      }));
      localStorage.removeItem(`p2_conv_${projectId}`);
      stageConvRef.current = [];
    }

    setDebatePhase("stage_complete");
  }, [genre, projectId, msgs, addMsg, updateMsg, extractStageResult]);

  const handleNextStage = useCallback(() => {
    const nextStage = (currentStage + 1) as StageId;
    if (nextStage > 6) {
      // Save final cross-phase data
      const finalData: Record<string, unknown> = {};
      stageResultsRef.current.forEach((r: StageResult) => { finalData[`stage${r.stageId}`] = r.data; });
      localStorage.setItem(`wts_phase2_${projectId}`, JSON.stringify({
        stageResults: stageResultsRef.current,
        currentStage: 7,
        finalData,
        msgs,
      }));
      setDebatePhase("all_done");
    } else {
      setCurrentStage(nextStage);
      stageConvRef.current = [];
      void runStageDebate(nextStage);
    }
  }, [currentStage, projectId, msgs, runStageDebate]);

  const handleRestartNew = useCallback(() => {
    localStorage.removeItem(`p2_msgs_${projectId}`);
    localStorage.removeItem(`p2_conv_${projectId}`);
    localStorage.removeItem(`wts_phase2_${projectId}`);
    stageConvRef.current = [];
    stageResultsRef.current = [];
    setMsgs([]); setStageResults([]); setCurrentStage(1); setApiError(null);
    setDebatePhase("idle"); setTurnCount(0);
    runningRef.current = false;
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
                  <span style={{ fontSize:12, fontWeight:800, color:STAGE_COLORS[st.id], minWidth:20 }}>{st.id}</span>
                  <span style={{ fontSize:13, color:"#c8d0dc", fontWeight:600 }}>{st.name}</span>
                  <span style={{ fontSize:11, color:"#4a4a6a", marginLeft:"auto" }}>{st.desc}</span>
                </div>
              ))}
            </div>
            <button className={s.btnStart} onClick={() => { void runStageDebate(1); }}>✦ 1단계부터 토론 시작</button>
          </div>
        </div>
      </div>
    );
  }

  const allDone = debatePhase === "all_done";

  return (
    <div className={s.page}>
      <div className={s.chatLayout}>
        {/* Stage progress header */}
        <div className={s.chatHeader}>
          <div className={s.stepBar} style={{ padding:"0", background:"transparent", border:"none", flex:1 }}>
            {STAGES.map(st => {
              const isDone = stageResults.some((r: StageResult) => r.stageId === st.id);
              const isActive = currentStage === st.id && !allDone;
              const c = STAGE_COLORS[st.id];
              return (
                <div key={st.id} className={`${s.stepItem} ${isDone ? s.stepDone : ""} ${isActive ? s.stepActive : ""}`}>
                  <div className={s.stepDot} style={isDone ? { background:c } : isActive ? { background:c } : {}} />
                  <span className={s.stepLabel} style={isDone||isActive ? { color:c } : {}}>{st.name}</span>
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

        <div className={s.chatBody}>
          {msgs.map((m: Msg) => <MsgBubble key={m.id} msg={m} />)}
          <div ref={bottomRef} />
        </div>

        <div className={s.chatBottom}>
          {/* Stage complete — 확정 버튼: 사용자가 결과 확인 후 명시적으로 다음 단계 진행 */}
          {debatePhase === "stage_complete" && currentStage < 6 && (
            <div className={s.gatingRow}>
              <div>
                <div className={s.gatingMsg}>✓ {currentStage}단계 결과 확정 — {STAGES.find(s=>s.id===currentStage)?.name}</div>
                <div style={{ fontSize:11, color:"#64748b", marginTop:3 }}>위 결과 카드를 확인하고 확정하면 {currentStage+1}단계가 시작됩니다</div>
              </div>
              <button className={s.btnGating} style={{ width:"auto", padding:"10px 20px" }} onClick={handleNextStage}>
                확정 — {currentStage + 1}단계 시작 →
              </button>
            </div>
          )}
          {debatePhase === "stage_complete" && currentStage === 6 && (
            <div className={s.gatingRow}>
              <div>
                <div className={s.gatingMsg}>✓ 6단계 모두 완료</div>
                <div style={{ fontSize:11, color:"#64748b", marginTop:3 }}>위 결과를 확인하고 확정하면 Phase 3로 이동합니다</div>
              </div>
              <button className={s.btnGating} style={{ width:"auto", padding:"10px 20px" }} onClick={handleNextStage}>
                확정 — Phase 3 시작 →
              </button>
            </div>
          )}

          {/* Paused — resume or restart */}
          {debatePhase === "paused" && (
            <div className={s.gatingRow}>
              <span className={s.gatingMsg}>⏸ {currentStage}단계 토론 일시중지</span>
              <div style={{ display:"flex", gap:8 }}>
                <button className={s.btnGating} style={{ width:"auto", padding:"10px 16px" }} onClick={() => void runStageDebate(currentStage, stageConvRef.current)}>계속하기 →</button>
                <button className={s.btnRestart} onClick={handleRestartNew}>새로 시작</button>
              </div>
            </div>
          )}

          {/* All done — go to Phase 3 */}
          {allDone && (
            <div className={s.gatingRow}>
              <span className={s.gatingMsg}>✓ Phase 2 전체 완료 — Phase 3 진행 가능</span>
              <div style={{ display:"flex", gap:8 }}>
                <button className={s.btnRestart} onClick={handleRestartNew}>재생성</button>
                <button className={s.btnGating} style={{ width:"auto", padding:"10px 20px" }} onClick={() => router.push(`/projects/${projectId}/phase-3`)}>Phase 3 시작 →</button>
              </div>
            </div>
          )}

          {/* Extracting indicator */}
          {debatePhase === "extracting" && (
            <div style={{ padding:"10px 20px", fontSize:13, color:"#fbbf24" }}>📝 단계 결과 정리 중...</div>
          )}

          {/* Stage 4 전용: 인물 전환 UI */}
          {debatePhase === "running" && currentStage === 4 && turnCount >= 2 && (
            <div style={{ padding:"6px 16px 0", display:"flex", gap:8, alignItems:"center" }}>
              <span style={{ fontSize:12, color:"#64748b", flexShrink:0 }}>현재 인물:</span>
              <input
                value={currentCharacter}
                onChange={(e: { target: HTMLInputElement }) => {
                  setCurrentCharacter(e.target.value);
                  currentCharacterRef.current = e.target.value;
                }}
                style={{
                  flex:1, background:"#1a1a26", border:"1px solid #2a2a3d", borderRadius:6,
                  color:"#f1f5f9", fontSize:12, padding:"5px 10px", outline:"none",
                }}
                placeholder="인물 이름 입력"
              />
              <button
                onClick={() => {
                  const msg = `이 인물(${currentCharacter}) 논의 완료. 다음 인물로 넘어갑니다.`;
                  pendingUserMsgRef.current = msg;
                }}
                style={{
                  background:"rgba(251,146,60,0.1)", border:"1px solid rgba(251,146,60,0.3)",
                  borderRadius:6, color:"#fb923c", fontSize:12, fontWeight:700,
                  padding:"5px 12px", cursor:"pointer", whiteSpace:"nowrap" as const, flexShrink:0,
                }}>
                다음 인물 →
              </button>
            </div>
          )}

          {/* 이 단계 완료 버튼 — 사용자가 명시적으로 클릭해야만 다음 단계로 이동 */}
          {debatePhase === "running" && turnCount >= 3 && (
            <div style={{ padding:"6px 16px 0" }}>
              <button
                onClick={() => { pendingUserMsgRef.current = "단계 완료"; }}
                style={{
                  width:"100%", background:"rgba(52,211,153,0.08)", border:"1px solid rgba(52,211,153,0.3)",
                  borderRadius:8, color:"#34d399", fontSize:13, fontWeight:700,
                  padding:"9px 0", cursor:"pointer", letterSpacing:"0.02em",
                }}>
                ✓ {currentStage}단계 완료 — 결과 정리 후 확정
              </button>
            </div>
          )}

          {/* Chat input during running */}
          {(debatePhase === "running" || debatePhase === "extracting") && (
            <div className={s.inputRow}>
              <textarea
                className={s.chatInput} rows={1}
                placeholder={`의견 입력 (Enter) · "단계 완료" 또는 버튼 클릭 시 ${currentStage}단계 결과 정리`}
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

