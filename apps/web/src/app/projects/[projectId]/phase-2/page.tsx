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
  worldbuilder:
    "세계관 설계 전문가. 이 세계가 실제로 존재하는 것처럼 만들어야 해. " +
    "설정 구멍 찾고, 논리적으로 맞지 않으면 바로 짚어. " +
    "시각적으로 어떻게 보여야 하는지도 구체적으로 얘기해줘. " +
    "빌딩, 거리, 복장, 기술 수준까지 세세하게.",
  character:
    "캐릭터 디자이너. 인물의 외형·복장·표정·몸짓까지 이미지로 그려질 수 있게 설계해. " +
    "얼굴 생김새, 키와 체형, 헤어, 패션까지 구체적으로 얘기해. " +
    "내면의 상처와 성격이 외모와 말투에 어떻게 드러나는지 연결해줘.",
  scenario:
    "서사 구조 전문가. 이야기가 100화 동안 독자를 어떻게 끌고 가는지 설계해. " +
    "복선이 어디서 심겨서 어디서 회수되는지, 감정 곡선이 어떻게 흐르는지 구체적으로.",
  script:
    "연출·비주얼 감독. 영화나 애니메이션 감독처럼 생각해. " +
    "이 장면을 어떤 앵글로 찍을지, 조명은 어떻게, 색감은 어떻게. " +
    "공간 구조, 인물 배치, 카메라 무브까지 그림으로 떠올릴 수 있게 얘기해줘.",
  producer:
    "총괄 프로듀서. 지금 우리가 만드는 건 단순한 아이디어가 아니라 실제 제작물이야. " +
    "설정이 너무 추상적이면 '그래서 구체적으로 어떻게 보여?' 하고 파고들어. " +
    "의견 충돌하거나 정리 필요할 때만 끼어들고, 진짜 필요한 결정을 내려줘.",
  editor:
    "베테랑 편집자. 독자 입장에서 생각해. " +
    "'이 설정 독자가 납득할 수 있어?', '이 캐릭터 독자가 왜 좋아해야 해?' 하고 날카롭게. " +
    "짧고 핵심만. 길게 말하지 마.",
};

// ─── Types ────────────────────────────────────────────────────────────────────

const STAGES = [
  { id: 1 as const, name: "세계관",     topic: "세계관 — 시대·배경·세계 규칙·분위기·특수 설정",  tag: "WORLD",         color: "#60a5fa", schema: '{"era":"시대/배경","atmosphere":"분위기","world_rules":["규칙1","규칙2","규칙3"],"special_elements":"특수 설정"}' },
  { id: 2 as const, name: "시놉시스",   topic: "시놉시스 — 로그라인·전제·핵심 갈등·해결 방향",    tag: "SYNOPSIS",      color: "#34d399", schema: '{"logline":"한 줄 요약","premise":"전제","conflict":"핵심 갈등","resolution_hint":"해결 방향"}' },
  { id: 3 as const, name: "캐릭터 설정", topic: "등장인물 — 이름·역할·성별·나이·외모·체형·복장·성격·동기·말투·세계관 내 역할",        tag: "CHARACTERS",    color: "#fb923c", schema: '{"characters":[{"name":"이름","role":"주인공/빌런/조력자","gender":"성별","age":"나이/나이대","face":"얼굴 특징","height":"키","build":"체형","weight":"몸무게","outfit":"복장 스타일","personality":"성격","motivation":"동기","speech":"말투","story_role":"시놉시스·세계관에서의 역할"}]}' },
  { id: 4 as const, name: "장소 설정",  topic: "주요 장소 — 이름·유형·건축/공간 구조·조명·색채·분위기·소리·서사적 의미·상징",  tag: "LOCATIONS",     color: "#a78bfa", schema: '{"locations":[{"name":"장소명","type":"유형","visual":"시각적 묘사","architecture":"건축/공간 구조","lighting":"조명 특성","color_palette":"색채 팔레트","atmosphere":"분위기","sound":"소리/냄새","significance":"서사적 의미","key_scenes":"이곳에서 일어나는 주요 장면","symbolic_meaning":"상징적 의미"}]}' },
  { id: 5 as const, name: "복선·암시",  topic: "복선과 암시 — 설치 장면·회수 장면·시각적 모티프·상징 오브젝트·훼이크·복선 타임라인",  tag: "FORESHADOWING", color: "#f87171", schema: '{"foreshadowing":[{"setup":"복선 설치 장면 (몇 화, 상황, 오브젝트/대사)","payoff":"회수 장면 (감정적 충격)","visual_marker":"시각적 표식"}],"motifs":["반복 시각 모티프"],"symbols":[{"object":"오브젝트","meaning":"상징 의미"}],"red_herrings":["훼이크와 그 효과"]}' },
];
type StageId = 1 | 2 | 3 | 4 | 5;

interface StageResult {
  stageId: StageId;
  data: Record<string, unknown>;
  summary: string;
}

// Phase 1 → Phase 2 인계 데이터 타입 (최소한만)
interface P1Data {
  concept?: string;
  worldbuilding_notes?: Array<{ issue: string; suggestion: string; priority: string }>;
  similar_works?: Array<{ title: string; lesson: string }>;
  strengths?: string[];
  weaknesses?: string[];
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

// ─── Phase 1 결과를 Phase 2 컨텍스트로 변환 ──────────────────────────────────

function buildPhase1Context(p1: P1Data): string {
  const parts: string[] = [];

  if (p1.concept) {
    parts.push(`[기획 개요]\n${p1.concept.slice(0, 150)}`);
  }

  if (p1.worldbuilding_notes?.length) {
    const order = { high: 0, medium: 1, low: 2 };
    const sorted = [...p1.worldbuilding_notes]
      .sort((a, b) => (order[a.priority as keyof typeof order] ?? 2) - (order[b.priority as keyof typeof order] ?? 2))
      .slice(0, 3);
    parts.push(`[Phase 1→2 인계 사항 — 반드시 반영]\n${sorted.map(n => `· ${n.issue}: ${n.suggestion}`).join("\n")}`);
  }

  const lines = [
    ...(p1.strengths?.slice(0, 2).map(s => `+ ${s}`) ?? []),
    ...(p1.weaknesses?.slice(0, 2).map(w => `- ${w}`) ?? []),
  ];
  if (lines.length) parts.push(`[기획 강점/약점]\n${lines.join("\n")}`);

  if (p1.similar_works?.length) {
    const works = p1.similar_works.slice(0, 2).map(w => `· ${w.title}: ${w.lesson}`).join("\n");
    parts.push(`[참고 유사 작품]\n${works}`);
  }

  return parts.join("\n\n");
}

// ─── Prompt builders (단계별 독립 API 호출 + 이전 결과 컨텍스트) ──────────────

const STAGE_PROMPTS: Record<StageId, string> = {
  1: "세계관 — 이 세계의 시대·배경·핵심 규칙·분위기·특수 설정. 독자가 이 세계에 발을 들여놓는 순간 느끼는 감각까지 구체적으로.",
  2: "시놉시스 — 로그라인·전제·핵심 갈등·3막 구조·해결 방향. 나중에 100화 로드맵을 짤 수 있을 만큼 구체적으로.",
  3: "등장인물 — 이름·역할·성별·나이·얼굴·키·체형·복장·성격·말투·동기·내면의 상처·세계관 역할. 이미지 생성 프롬프트로 쓸 수 있을 만큼 시각적으로 구체적으로. 인물당 충분히 깊이 파고들어.",
  4: "주요 장소 — 이름·유형·건축 구조·조명·색채·소리·분위기·서사적 의미·상징. 영화 프로덕션 디자이너가 현장을 지을 수 있을 만큼 구체적으로 묘사해. 시각적 이미지가 눈에 그려져야 해.",
  5: "복선과 암시 — 설치 장면·회수 장면·시각적 모티프·상징 오브젝트·훼이크. 독자가 재독 시 '아 이때 이미 나왔었구나' 하는 순간을 설계해. 타임라인과 시각적 표식까지 구체적으로.",
};

// 단계별 구조화 데이터 → 에이전트용 풍부한 다줄 요약 (모든 필드 포함)
function formatStageSummary(stageId: StageId, data: Record<string, unknown>): string {
  if (data.raw_summary) return String(data.raw_summary).slice(0, 800);
  const line = (...parts: (string | false | null | undefined)[]) =>
    parts.filter(Boolean).join(" ");
  try {
    switch (stageId) {
      case 1: {
        const rules = Array.isArray(data.world_rules)
          ? (data.world_rules as string[]).map((r, i) => `  ${i + 1}. ${r}`).join("\n")
          : data.world_rules ? `  ${String(data.world_rules)}` : "";
        return [
          data.era            && `시대/배경: ${data.era}`,
          data.atmosphere     && `분위기: ${data.atmosphere}`,
          rules               && `세계 규칙:\n${rules}`,
          data.special_elements && `특수 설정: ${data.special_elements}`,
        ].filter(Boolean).join("\n");
      }
      case 2:
        return [
          data.logline         && `로그라인: ${data.logline}`,
          data.premise         && `전제: ${data.premise}`,
          data.conflict        && `핵심 갈등: ${data.conflict}`,
          data.resolution_hint && `해결 방향: ${data.resolution_hint}`,
        ].filter(Boolean).join("\n");
      case 3:
        if (Array.isArray(data.characters)) {
          return (data.characters as Record<string, string>[]).map(c =>
            [
              `▸ ${c.name} (${c.role})`,
              c.personality && `  성격: ${c.personality}`,
              c.motivation  && `  동기: ${c.motivation}`,
              c.appearance  && `  외형: ${c.appearance}`,
              c.speech      && `  말투: ${c.speech}`,
            ].filter(Boolean).join("\n")
          ).join("\n");
        }
        break;
      case 4:
        if (Array.isArray(data.locations)) {
          return (data.locations as Record<string, string>[]).map(l =>
            [
              `▸ ${l.name}${l.type ? ` (${l.type})` : ""}`,
              l.visual       && `  시각: ${l.visual}`,
              l.architecture && `  구조: ${l.architecture}`,
              l.lighting     && `  조명: ${l.lighting}`,
              l.color_palette && `  색채: ${l.color_palette}`,
              l.atmosphere   && `  분위기: ${l.atmosphere}`,
              l.sound        && `  소리: ${l.sound}`,
              l.significance && `  서사적 의미: ${l.significance}`,
              l.key_scenes   && `  주요 장면: ${l.key_scenes}`,
              l.symbolic_meaning && `  상징: ${l.symbolic_meaning}`,
            ].filter(Boolean).join("\n")
          ).join("\n\n");
        }
        break;
      case 5: {
        const fw = Array.isArray(data.foreshadowing)
          ? (data.foreshadowing as Record<string, string>[])
              .map((f, i) => line(`  ${i + 1}.`, f.setup && `설치: ${f.setup}`, f.payoff && `→ 회수: ${f.payoff}`, f.visual_marker && `[표식: ${f.visual_marker}]`))
              .join("\n")
          : "";
        const motifs = Array.isArray(data.motifs)
          ? `반복 모티프: ${(data.motifs as string[]).join(", ")}`
          : "";
        const symbols = Array.isArray(data.symbols)
          ? `상징 오브젝트:\n${(data.symbols as Record<string,string>[]).map(s => `  · ${s.object}: ${s.meaning}`).join("\n")}`
          : "";
        const rh = Array.isArray(data.red_herrings)
          ? `훼이크: ${(data.red_herrings as string[]).join(", ")}`
          : "";
        return [fw && `복선:\n${fw}`, motifs, symbols, rh].filter(Boolean).join("\n");
      }
    }
  } catch { /* ignore */ }
  return Object.entries(data).slice(0, 8)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 120)}`).join("\n");
}

// 이전 단계 결과를 에이전트가 읽기 쉬운 컨텍스트로 변환 (summary 필드 사용)
function buildContext(stageId: StageId, prevResults: StageResult[]): string {
  const relevant = prevResults.filter(r => r.stageId < stageId);
  if (!relevant.length) return "";
  return relevant.map(r => {
    const stage = STAGES.find(s => s.id === r.stageId)!;
    return `[${stage.name} 확정]\n${r.summary}`;
  }).join("\n\n");
}

// 에이전트 1명이 이전 토론을 읽고 반응하는 단일 역할 프롬프트
function buildSingleAgentPrompt(
  stageId: StageId,
  genre: string,
  agentId: AgentId,
  prevResults: StageResult[],
  p1Data?: P1Data | null,
): string {
  const agentLabel = AGENTS[agentId].label;
  const roleDesc = AGENT_ROLE_DESC[agentId] ?? "";
  const context = buildContext(stageId, prevResults);
  const p1Context = p1Data ? buildPhase1Context(p1Data) : "";

  return `너는 웹툰 기획 팀의 ${agentLabel}야.
성격: ${roleDesc}
장르: ${genre}
${p1Context ? `\n[Phase 1 분석 결과 — 우리 작품의 방향]\n${p1Context}\n` : ""}${context ? `\n[우리 팀이 함께 만든 세계 — 이미 알고 있는 내용]\n${context}\n` : ""}지금 주제: ${STAGE_PROMPTS[stageId]}

[대화 방식]
- 앞 사람 말 받아서 자연스럽게 이어가.
- 딱 1~2문장. 짧을수록 좋아.
- ㅋㅋ ㅎㅎ 같은 자연스러운 표현 써도 돼.
- 이미 나온 얘기 반복하지 마.
- 대사만. 이름이나 접두어 붙이지 마.
- 마크다운(#, *, >, -) 금지. JSON 금지.
- "다음 단계", "단계 완료" 같은 말 하지 마.`;
}

// 백엔드 API URL
const API_BASE = "http://localhost:4000";

// 스타일 토론 에이전트 프롬프트
function buildStyleAgentPrompt(
  genre: string,
  agentId: AgentId,
  worldSummary: string,
  synopsisSummary: string,
): string {
  const agentLabel = AGENTS[agentId].label;
  const roleDesc = AGENT_ROLE_DESC[agentId] ?? "";
  return `너는 웹툰 기획 팀의 ${agentLabel}야.
성격: ${roleDesc}
장르: ${genre}

[우리 팀이 함께 만든 작품 — 이미 알고 있는 내용]
세계관: ${worldSummary.slice(0, 600)}
시놉시스: ${synopsisSummary.slice(0, 400)}

지금 주제: 이 작품에 맞는 시각적 스타일 정의
목표: 선화 스타일, 색채 팔레트, 분위기/톤을 구체적으로 합의

[대화 방식]
- 앞 사람 말 받아서 자연스럽게 이어가.
- 딱 1~2문장.
- 구체적인 작품명·스타일 이름을 들어서 얘기해. (예: "귀멸의 칼날 색채에 헌터X헌터 선화 조합")
- 대사만. 이름 접두어 없음. 마크다운 금지. JSON 금지.`;
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
  1: `다음 토론에서 합의된 세계관을 A4 용지 2~3장 분량으로 상세히 정리해주세요.
이 문서는 이후 모든 단계(시놉시스·캐릭터·장소·복선)에서 참고할 세계관 바이블입니다.

반드시 포함할 내용 (각 항목을 충분히 서술):
■ 시대와 배경
  - 구체적인 시대 (몇 세기, 근미래, 판타지 세계 등)
  - 지리적 배경과 문명 수준
  - 사회 구조와 계급 체계
  - 역사적 맥락 (어떤 사건이 이 세계를 만들었는가)

■ 세계의 핵심 규칙과 법칙
  - 마법/기술/초능력 등 특수 시스템 (상세히)
  - 사회 질서와 법률
  - 일반인의 일상생활 방식

■ 세계의 분위기와 톤
  - 전반적인 무드 (어둡고 절망적, 희망적, 혼돈 등)
  - 시각적 이미지 (색감, 건축, 풍경)
  - 독자가 느껴야 할 감정

■ 특수 설정과 독창적 요소
  - 이 세계만의 고유한 개념/규칙
  - 다른 작품과 차별화되는 설정

■ 세계의 문제와 갈등 구조
  - 세계 전체가 직면한 근본적 문제
  - 다양한 세력/집단 간의 갈등 구도

서술형 문장으로 풍부하게 작성하세요. 목록보다 문단 형식을 섞어서.`,

  2: `다음 토론에서 합의된 시놉시스를 A4 용지 2~3장 분량으로 상세히 정리해주세요.
이 문서는 이후 캐릭터·장소·복선 설계의 기반이 됩니다.

반드시 포함할 내용 (각 항목을 충분히 서술):
■ 로그라인 (한 줄 핵심 요약)

■ 이야기의 전제와 출발점
  - 이야기가 시작되는 상황
  - 주인공의 초기 상태와 일상
  - 사건의 도화선이 되는 계기

■ 주요 등장인물 관계도 (캐릭터 설정 전 큰 그림)
  - 주인공과 주변 인물의 관계 구도
  - 대립 구조

■ 핵심 갈등
  - 내적 갈등 (주인공 내면)
  - 외적 갈등 (주인공 vs 적대 세력/환경)
  - 갈등이 고조되는 방식

■ 이야기의 3막 구조
  - 1막: 도입부와 사건 발단
  - 2막: 갈등 심화와 위기
  - 3막: 클라이맥스와 해결 방향

■ 핵심 테마와 메시지
  - 이 이야기가 독자에게 전달할 주제

■ 예상 분위기와 타겟 독자층

서술형 문장으로 풍부하게 작성하세요.`,

  3: `다음 토론에서 합의된 등장인물을 상세히 정리해주세요.
각 인물은 이미지 생성과 시나리오 집필에 바로 활용할 수 있는 수준으로 작성합니다.

각 인물마다 반드시 포함할 내용:
■ 기본 정보: 이름, 나이/나이대, 성별
■ 시각적 특징 (이미지 생성용)
  - 얼굴: 이목구비 특징, 인상, 표정 습관
  - 키와 체형: 구체적 수치 또는 묘사 (예: 180cm, 마른 근육형)
  - 몸무게 또는 체형 묘사
  - 복장 스타일: 주로 입는 옷, 색상, 특징적 아이템
  - 헤어스타일과 색상
  - 눈에 띄는 특징 (흉터, 문신, 특이한 눈색 등)
■ 성격: 3~5가지 핵심 성격 특성 (상세히)
■ 말투: 구체적인 말하는 방식, 자주 쓰는 표현
■ 행동 동기와 목표: 무엇을 원하는가, 왜 그것을 원하는가
■ 내면의 상처나 비밀
■ 시놉시스·세계관에서의 역할: 이야기 전체에서 어떤 기능을 하는가
■ 다른 주요 인물과의 관계

각 인물을 풍부하게 서술하세요.`,

  4: `다음 토론에서 합의된 주요 장소를 프로덕션 디자인 바이블 수준으로 상세히 정리해주세요.
영화·애니메이션 프로덕션 디자이너가 실제로 공간을 설계할 수 있는 수준이어야 합니다.

각 장소마다 반드시 포함할 내용 (장소당 충분히 서술):
■ 장소 기본 정보
  - 이름, 유형 (실내/실외, 도시/자연 등)
  - 세계관에서의 위치와 규모

■ 시각적 묘사 — 눈에 그려질 수 있도록 구체적으로
  - 건축/공간 구조: 형태, 재질, 높이, 구획
  - 조명: 자연광/인공광, 방향, 시간대별 변화, 그림자
  - 색채 팔레트: 지배색, 보조색, 금지색 (이 공간에 어울리지 않는 색)
  - 주요 오브젝트와 소품: 눈에 띄는 것들
  - 소리 풍경: 어떤 소리가 들리는가 (바람, 기계, 군중, 침묵...)
  - 냄새: 어떤 냄새가 나는가

■ 분위기와 감정적 기능
  - 이 공간에 들어서는 순간 느끼는 감정
  - 계절/날씨/시간에 따른 분위기 변화
  - 캐릭터별로 이 공간이 다르게 느껴지는 방식

■ 서사적 역할
  - 이곳에서 일어나는 주요 장면/사건 (구체적으로)
  - 이 공간이 인물에게 갖는 개인적 의미
  - 이야기 전체에서의 상징적 기능

■ 이 장소의 역사와 비밀
  - 과거에 어떤 일이 있었는가
  - 숨겨진 공간이나 비밀이 있는가

서술형 문단과 구체적 묘사를 섞어 작성하세요.`,

  5: `다음 토론에서 합의된 복선·암시 체계를 시나리오 작가가 실제로 사용할 수 있는 수준으로 상세히 정리해주세요.

반드시 포함할 내용:
■ 핵심 복선 체계 (각 복선 상세)
  - 설치 장면: 몇 화쯤, 어떤 상황에서, 어떤 오브젝트/대사/장면으로 심는가
  - 회수 장면: 어떤 감정적 충격을 주는가, 독자의 반응
  - 시각적 표식: 독자가 나중에 돌아봤을 때 알아볼 수 있는 시각적 단서
  - 설치-회수 사이의 간격 (몇 화, 어느 시점)

■ 반복 시각 모티프
  - 작품 전체를 관통하는 반복 이미지 (색, 형태, 오브젝트)
  - 각 모티프의 의미와 변주 방식

■ 상징 오브젝트 체계
  - 특정 오브젝트가 가진 상징적 의미
  - 오브젝트가 등장할 때마다 달라지는 의미의 레이어

■ 의도적 훼이크 (Red Herring)
  - 독자를 잘못된 방향으로 유도하는 장치
  - 훼이크가 드러나는 순간의 효과

■ 복선 전체 타임라인
  - 설치 → 강화 → 회수 흐름을 일목요연하게

서술형으로 풍부하게 작성하세요.`,
};

// ─── 단계 결과 추출 ────────────────────────────────────────────────────────────
//
// 두 가지를 항상 병렬로 생성:
//   data    → 구조화 JSON (카드 UI 표시, 필드별 렌더링)
//   summary → 상세 내러티브 요약 (다음 단계 에이전트 컨텍스트용)
//
// summary는 STAGE_SUMMARY_PROMPTS 기반 LLM 생성 — JSON 스키마에 없는
// 토론 뉘앙스·관계성·배경 설명까지 포함.

async function extractStageData(
  stage: typeof STAGES[number],
  genre: string,
  debateText: string,
  apiKey: string,
): Promise<{ data: Record<string, unknown>; summary: string }> {

  const slicedDebate = debateText.slice(0, 8000);

  // ① JSON 추출 + ② 상세 내러티브 요약 — 병렬 실행
  const [jsonResult, narrativeResult] = await Promise.allSettled([

    // JSON 추출 (카드 UI용)
    (async () => {
      let fullText = "";
      try {
        for await (const chunk of streamClaude({
          apiKey,
          systemPrompt: "토론 결과를 정확한 JSON으로 변환하는 전문가입니다. 지정된 형식 외에 아무것도 출력하지 마세요.",
          messages: [{ role: "user", content: buildExtractionPrompt(stage.id, genre, slicedDebate) }],
          maxTokens: (stage.id === 3 || stage.id === 4) ? 3000 : 1500,
        })) fullText += chunk;
      } catch { /* ignore */ }
      // 태그 파싱 → 루즈 JSON 파싱 순서로 시도
      const tagged = parseBlock<Record<string, unknown>>(fullText, stage.tag);
      if (tagged) return tagged;
      const m = fullText.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { /* ignore */ } }
      return null;
    })(),

    // 상세 내러티브 요약 (에이전트 컨텍스트용)
    (async () => {
      let text = "";
      try {
        for await (const chunk of streamClaude({
          apiKey,
          systemPrompt: `웹툰 기획 전문가. 장르: ${genre}. 토론에서 합의된 내용을 다음 단계 작업자가 바로 활용할 수 있도록 빠짐없이, 구체적으로 정리합니다.`,
          messages: [{
            role: "user",
            content: `${STAGE_SUMMARY_PROMPTS[stage.id]}\n\n[토론 내용]\n${slicedDebate}`,
          }],
          maxTokens: 4000,
        })) text += chunk;
      } catch { /* ignore */ }
      return text.trim();
    })(),
  ]);

  const structured = jsonResult.status === "fulfilled" ? jsonResult.value : null;
  const narrative  = narrativeResult.status === "fulfilled" ? narrativeResult.value : "";

  // data: 구조화 JSON 우선, 없으면 내러티브를 raw_summary로
  const data: Record<string, unknown> = structured ?? (narrative ? { raw_summary: narrative } : { raw_summary: "(추출 실패)" });

  // summary: 내러티브 우선 (가장 상세), 없으면 JSON 기반 포맷
  const summary = narrative || formatStageSummary(stage.id, data);

  return { data, summary };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThinkingDots() {
  return <div className={s.dots}><span /><span /><span /></div>;
}

function StreamCursor() {
  return <span style={{ display: "inline-block", width: 2, height: 13, background: "#7c6cfc", marginLeft: 2, verticalAlign: "middle", borderRadius: 1, animation: "blink 0.9s step-start infinite" }} />;
}

function StageResultCard({ result, onViewDebate, isViewingDebate }: { key?: StageId; result: StageResult; onViewDebate?: () => void; isViewingDebate?: boolean }) {
  const [showContext, setShowContext] = useState(false);
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
        <div style={{ display:"flex", gap:6 }}>
          <button
            onClick={() => setShowContext((v: boolean) => !v)}
            style={{ fontSize:11, fontWeight:700, color: showContext ? c : "#4a4a6a", background: showContext ? `${c}18` : "transparent", border:`1px solid ${showContext ? c : "#2a2a3d"}`, borderRadius:6, padding:"3px 10px", cursor:"pointer" }}>
            {showContext ? "▲" : "📋"} 전달 내용
          </button>
          {onViewDebate && (
            <button
              onClick={onViewDebate}
              style={{ fontSize:11, fontWeight:700, color: isViewingDebate ? c : "#4a4a6a", background: isViewingDebate ? `${c}18` : "transparent", border:`1px solid ${isViewingDebate ? c : "#2a2a3d"}`, borderRadius:6, padding:"3px 10px", cursor:"pointer" }}>
              {isViewingDebate ? "▲ 닫기" : "💬 토론"}
            </button>
          )}
        </div>
      </div>
      {/* 다음 단계 에이전트에게 전달되는 내용 */}
      {showContext && result.summary && (
        <div style={{ marginBottom:12, padding:"10px 12px", background:"#0d0d1a", border:`1px solid ${c}30`, borderRadius:8 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#4a4a68", marginBottom:6, letterSpacing:"0.05em" }}>📋 다음 단계 에이전트 전달 내용</div>
          <pre style={{ fontSize:12, color:`${c}dd`, lineHeight:1.75, whiteSpace:"pre-wrap" as const, margin:0, fontFamily:"inherit" }}>{result.summary}</pre>
        </div>
      )}
      {result.stageId === 1 && <>{row("시대/배경", data.era)}{row("분위기", data.atmosphere)}{row("세계 규칙", data.world_rules)}{row("특수 설정", data.special_elements)}</>}
      {result.stageId === 2 && <>{row("로그라인", data.logline)}{row("전제", data.premise)}{row("갈등", data.conflict)}{row("해결 방향", data.resolution_hint)}</>}
      {result.stageId === 3 && Array.isArray(data.characters) && (data.characters as Record<string,string>[]).map((ch, i) => (
        <div key={i} style={{ marginBottom:10, paddingBottom:10, borderBottom:"1px solid #2a2a3d" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#eeeef5", marginBottom:6 }}>
            {ch.name} <span style={{ fontSize:11, color:"#7878a0" }}>({ch.role})</span>
            {ch.gender && <span style={{ fontSize:11, color:"#7878a0", marginLeft:6 }}>{ch.gender}{ch.age ? ` · ${ch.age}` : ""}</span>}
          </div>
          {row("얼굴", ch.face)}{row("키 / 체형", ch.height || ch.build ? [ch.height, ch.build, ch.weight].filter(Boolean).join(" · ") : undefined)}{row("복장", ch.outfit)}{row("성격", ch.personality)}{row("동기", ch.motivation)}{row("말투", ch.speech)}{row("세계관 역할", ch.story_role)}
        </div>
      ))}
      {result.stageId === 4 && Array.isArray(data.locations) && (data.locations as Record<string,string>[]).map((loc, i) => (
        <div key={i} style={{ marginBottom:10, paddingBottom:10, borderBottom:"1px solid #2a2a3d" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#eeeef5", marginBottom:6 }}>{loc.name} <span style={{ fontSize:11, color:"#7878a0" }}>({loc.type})</span></div>
          {row("시각", loc.visual)}{row("구조", loc.architecture)}{row("조명", loc.lighting)}{row("색채", loc.color_palette)}{row("분위기", loc.atmosphere)}{row("소리", loc.sound)}{row("서사적 의미", loc.significance)}{row("주요 장면", loc.key_scenes)}{row("상징", loc.symbolic_meaning)}
        </div>
      ))}
      {result.stageId === 5 && <>
        {Array.isArray(data.foreshadowing) && (data.foreshadowing as Record<string,string>[]).map((f, i) => (
          <div key={i} style={{ marginBottom:8, paddingBottom:8, borderBottom:"1px solid #2a2a3d" }}>
            {row(`복선 ${i+1} 설치`, f.setup)}{row("회수", f.payoff)}{row("시각 표식", f.visual_marker)}
          </div>
        ))}
        {Array.isArray(data.motifs) && row("반복 모티프", (data.motifs as string[]).join(" · "))}
        {Array.isArray(data.symbols) && (data.symbols as Record<string,string>[]).map((s, i) => (
          <div key={i}>{row(`상징 오브젝트`, `${s.object} — ${s.meaning}`)}</div>
        ))}
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

  // ── 스타일 정의 State (Stage 2 완료 후 삽입) ──
  type StylePhase = "idle" | "debating" | "reviewing" | "generating" | "confirmed";
  const [stylePhase, setStylePhase] = useState<StylePhase>("idle");
  const [conceptStyle, setConceptStyle] = useState(""); // 확정된 스타일 프롬프트
  const [styleTestImages, setStyleTestImages] = useState<string[]>([]); // 테스트 이미지 URL들
  const [styleGenLoading, setStyleGenLoading] = useState(false);
  const [styleGenError, setStyleGenError] = useState<string | null>(null);
  const [styleInput, setStyleInput] = useState(""); // 사용자가 편집하는 스타일 텍스트

  // ── Refs ──
  const bottomRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const abortRef = useRef(false);
  const pendingUserMsgRef = useRef<string | null>(null);
  const convRef = useRef<string[]>([]); // transcript: 각 에이전트 발언 문자열 배열
  const stageResultsRef = useRef<StageResult[]>([]);
  const msgsRef = useRef<Msg[]>([]); // msgs의 최신값 추적용
  const resumeDataRef = useRef<{ transcript: string[]; msgs: Msg[] } | null>(null);
  const p1DataRef = useRef<P1Data | null>(null); // Phase 1 분석 결과 인계용
  const styleRunningRef = useRef(false);
  const styleConvRef = useRef<string[]>([]);
  const pendingStyleMsgRef = useRef<string | null>(null);

  // ── Mount: restore from localStorage ──
  useEffect(() => {
    try {
      const p1 = JSON.parse(localStorage.getItem(`wts_phase1_${projectId}`) ?? "null");
      if (p1?.input?.genre) setGenre(p1.input.genre);
      if (p1?.data) {
        p1DataRef.current = {
          concept:             p1.data.concept,
          worldbuilding_notes: p1.data.worldbuilding_notes,
          similar_works:       p1.data.similar_works,
          strengths:           p1.data.strengths,
          weaknesses:          p1.data.weaknesses,
        };
      }

      // 확정된 스타일 복원
      const savedStyle = localStorage.getItem(`wts_style_${projectId}`);
      if (savedStyle) { setConceptStyle(savedStyle); setStyleInput(savedStyle); setStylePhase("confirmed"); }

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
    // 캐릭터(3)·장소(4)는 시각적 디테일이 많아서 더 긴 토론 필요
    const WRAP_UP_AFTER = (stage.id === 3 || stage.id === 4) ? 18 : 14;
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
      // 키워드 매칭: 주제에 맞는 전문가 우선
      if (/세계|배경|규칙|설정|시대|문명|마법|공간/.test(lower) && available.includes("worldbuilder")) return "worldbuilder";
      if (/캐릭터|인물|주인공|감정|성격|외형|말투|빌런/.test(lower) && available.includes("character")) return "character";
      if (/이야기|서사|플롯|갈등|전개|장르|훅|전제/.test(lower) && available.includes("scenario")) return "scenario";
      if (/그림|연출|장면|시각|컷|화면|비주얼|그려/.test(lower) && available.includes("script")) return "script";
      if (/편집|구조|흐름|전반적|연결/.test(lower) && available.includes("editor")) return "editor";
      // 매칭 없으면: editor는 3턴에 한 번꼴로만 끼어들게 (흐름 끊지 않도록)
      const nonEditor = available.filter(a => a !== "editor");
      const pool = (nonEditor.length > 0 && agentIndex % 3 !== 2) ? nonEditor : available;
      return pool[Math.floor(Math.random() * pool.length)];
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
          systemPrompt: buildSingleAgentPrompt(stage.id, genre, agentId, stageResultsRef.current, p1DataRef.current),
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

    // 스테이지 오프닝: 이전 단계 내용을 팀에게 자연스럽게 환기
    if (stageIdx > 0 && stageResultsRef.current.length > 0 && transcript.length === 0) {
      const prevContext = buildContext(stage.id, stageResultsRef.current);
      if (prevContext) {
        await runSingleAgent(
          "producer",
          `팀에게 "${stage.name}" 단계를 시작하면서, 우리가 앞에서 함께 만들어온 내용을 자연스럽게 2~3문장으로 환기시켜줘. 마치 함께 작업해온 동료처럼, 자연스럽게. 딱딱한 브리핑이 아니라 팀워크 느낌으로.\n\n[우리가 함께 만든 내용]\n${prevContext}`,
          200,
        );
      }
    }

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

  // ── Style Definition: 스타일 토론 (Stage 2 완료 후) ──
  const runStyleDebate = useCallback(async () => {
    if (styleRunningRef.current) return;
    styleRunningRef.current = true;
    abortRef.current = false;
    setMsgs([]);
    styleConvRef.current = [];

    const worldRes  = stageResultsRef.current.find((r: StageResult) => r.stageId === 1);
    const synRes    = stageResultsRef.current.find((r: StageResult) => r.stageId === 2);
    const worldSum  = worldRes?.summary  ?? "";
    const synSum    = synRes?.summary    ?? "";

    let agentIdx = 0;
    let lastSpeaker: AgentId | null = null;
    const transcript: string[] = [];
    const STYLE_AGENTS: AgentId[] = ["script", "worldbuilder", "character", "scenario", "editor"];

    const runOne = async (agentId: AgentId, prompt: string) => {
      const key = getAnthropicKeyByIndex(getApiKeyIndexForAgent(agentIdx));
      if (!key) return;
      const msgId = addMsg(agentId, "", true);
      let text = "";
      try {
        for await (const chunk of streamClaude({
          apiKey: key,
          systemPrompt: buildStyleAgentPrompt(genre, agentId, worldSum, synSum),
          messages: [{ role: "user", content: prompt }],
          maxTokens: 180,
          tools: [],
        })) {
          if (abortRef.current) break;
          text += chunk;
        }
      } catch {
        setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== msgId));
        return;
      }
      const clean = text.trim().replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/[#>_`]/g, "");
      if (!clean) { setMsgs((prev: Msg[]) => prev.filter((m: Msg) => m.id !== msgId)); return; }
      for (let i = 2; i < clean.length; i += 2) {
        if (abortRef.current) break;
        updateMsg(msgId, clean.slice(0, i), true);
        await sleep(120);
      }
      updateMsg(msgId, clean, false);
      transcript.push(`[${AGENTS[agentId].label}]: ${clean}`);
      styleConvRef.current = transcript;
      agentIdx++;
      lastSpeaker = agentId;
    };

    try {
      for (let turn = 0; turn < 8; turn++) {
        if (abortRef.current) break;
        if (turn > 0) {
          const wait = 6000 + Math.random() * 3000;
          const start = Date.now();
          while (Date.now() - start < wait) {
            if (abortRef.current || pendingStyleMsgRef.current) break;
            await sleep(150);
          }
        }
        const pending = pendingStyleMsgRef.current;
        if (pending) {
          pendingStyleMsgRef.current = null;
          addMsg("user", pending, false);
          transcript.push(`[사용자]: ${pending}`);
          styleConvRef.current = transcript;
        }
        if (abortRef.current) break;

        const hist = transcript.length > 0
          ? `[지금까지 논의]\n${transcript.slice(-4).join("\n")}\n\n`
          : "";
        const avail = STYLE_AGENTS.filter(a => a !== lastSpeaker);
        const next  = avail[Math.floor(Math.random() * avail.length)] ?? STYLE_AGENTS[0];

        if (turn === 0) {
          await runOne("script", "세계관과 시놉시스를 보고 어떤 시각적 스타일이 어울릴지 첫 제안을 해줘. 구체적인 작품 레퍼런스로.");
        } else {
          await runOne(next, `${hist}앞 얘기 받아서 스타일에 대한 네 생각 한마디.`);
        }
      }
      // 마무리: 프로듀서가 합의 요약
      await runOne("producer", `${transcript.slice(-4).join("\n")}\n\n지금까지 나온 스타일 방향을 자연스럽게 한 문장으로 정리해줘.`);
    } catch { /* ignore */ }

    // 스타일 키워드 자동 추출 (Claude)
    const apiKey = getAnthropicKey();
    if (apiKey && transcript.length > 0) {
      try {
        let extracted = "";
        for await (const chunk of streamClaude({
          apiKey,
          systemPrompt: "이미지 생성 프롬프트 전문가.",
          messages: [{
            role: "user",
            content:
              `다음 스타일 토론 내용을 영문 이미지 생성 스타일 키워드로 40~70단어 이내로 정리하세요.\n` +
              `예시: "Korean webtoon line art, dark fantasy, detailed ink lines, muted earth tones with glowing blue accents, dramatic shadows, cinematic widescreen"\n` +
              `[토론]\n${transcript.join("\n")}\n\n영문 키워드만 출력. 설명 없이.`,
          }],
          maxTokens: 150,
          tools: [],
        })) { extracted += chunk; }
        const trimmed = extracted.trim();
        if (trimmed) { setStyleInput(trimmed); setConceptStyle(trimmed); }
      } catch { /* ignore */ }
    }

    styleRunningRef.current = false;
    setStylePhase("reviewing");
  }, [genre, addMsg, updateMsg]);

  // ── Style: 테스트 이미지 생성 ──
  const generateStyleTestImage = useCallback(async () => {
    setStyleGenLoading(true);
    setStyleGenError(null);
    setStylePhase("generating");
    try {
      const description = `${genre} 장르 웹툰 스타일 테스트 씬 — 세계관과 분위기를 보여주는 대표 컷`;
      const res = await fetch(`${API_BASE}/api/assets/${projectId}/generate-concept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          style: styleInput || conceptStyle,
          type: "style_test",
          anthropicApiKey: getAnthropicKey(),
        }),
      });
      if (!res.ok) {
        const errData = await res.json() as { error?: string };
        throw new Error(errData.error ?? `서버 오류 ${res.status}`);
      }
      const { imageUrl } = await res.json() as { imageUrl: string };
      setStyleTestImages((prev: string[]) => [...prev, imageUrl]);
    } catch (err) {
      setStyleGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setStyleGenLoading(false);
      setStylePhase("reviewing");
    }
  }, [projectId, styleInput, conceptStyle, genre]);

  // ── Style: 확정 & Stage 3 진행 ──
  const confirmStyle = useCallback(() => {
    const style = styleInput.trim() || conceptStyle;
    setConceptStyle(style);
    localStorage.setItem(`wts_style_${projectId}`, style);
    setStylePhase("confirmed");
    setMsgs([]);
    convRef.current = [];
    setCurrentStageIdx(2);
    setDebatePhase("idle");
    void runDebate(2);
  }, [styleInput, conceptStyle, projectId, runDebate]);

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
    // Stage 2(index=1) 완료 후 → 스타일 정의 단계 삽입
    if (stageIdx === 1 && stylePhase === "idle") {
      setMsgs([]);
      convRef.current = [];
      setStylePhase("debating");
      void runStyleDebate();
      return;
    }
    const nextIdx = stageIdx + 1;
    setMsgs([]);
    convRef.current = [];
    setCurrentStageIdx(nextIdx);
    if (nextIdx >= STAGES.length) {
      setDebatePhase("done");
    } else {
      void runDebate(nextIdx);
    }
  }, [runDebate, runStyleDebate, stylePhase]);

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
              const isActive = idx === currentStageIdx && debatePhase !== "done" && stylePhase === "idle";
              return (
                <div key={st.id} className={`${s.stepItem} ${isDone ? s.stepDone : ""} ${isActive ? s.stepActive : ""}`}>
                  <div className={s.stepDot} style={isDone || isActive ? { background:st.color } : {}} />
                  <span className={s.stepLabel} style={isDone || isActive ? { color:st.color } : {}}>{st.name}</span>
                </div>
              );
            })}
            {/* 스타일 정의 단계 표시기 */}
            {stylePhase !== "idle" && (
              <div className={s.stepItem} style={{ opacity: stylePhase === "confirmed" ? 0.5 : 1 }}>
                <div className={s.stepDot} style={{ background: stylePhase === "confirmed" ? "#34d399" : "#f59e0b", boxShadow: stylePhase !== "confirmed" ? "0 0 6px #f59e0b" : "none" }} />
                <span className={s.stepLabel} style={{ color: stylePhase === "confirmed" ? "#34d399" : "#f59e0b" }}>
                  {stylePhase === "confirmed" ? "✓ 스타일" : "🎨 스타일 정의"}
                </span>
              </div>
            )}
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

          {/* ── 스타일 정의 단계 UI (stylePhase가 활성이면 일반 바텀바 대체) ── */}
          {stylePhase === "debating" && (
            <>
              <div style={{ padding:"6px 16px 0" }}>
                <button
                  onClick={() => { abortRef.current = true; styleRunningRef.current = false; setStylePhase("reviewing"); }}
                  style={{ width:"100%", background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.3)", borderRadius:8, color:"#f59e0b", fontSize:13, fontWeight:700, padding:"9px 0", cursor:"pointer" }}>
                  ✓ 토론 마무리 & 스타일 정리로 이동
                </button>
              </div>
              <div className={s.inputRow}>
                <textarea
                  className={s.chatInput} rows={1}
                  placeholder="스타일에 대한 의견 입력 (Enter 전송)"
                  value={chatInput}
                  onChange={(e: { target: HTMLTextAreaElement }) => setChatInput(e.target.value)}
                  onKeyDown={(e: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (chatInput.trim()) { pendingStyleMsgRef.current = chatInput.trim(); setChatInput(""); }
                    }
                  }}
                />
                <button className={s.btnSend} disabled={!chatInput.trim()} onClick={() => { if (chatInput.trim()) { pendingStyleMsgRef.current = chatInput.trim(); setChatInput(""); } }}>전송</button>
              </div>
            </>
          )}

          {(stylePhase === "reviewing" || stylePhase === "generating") && (
            <div>
              {/* 생성된 테스트 이미지들 */}
              {styleTestImages.length > 0 && (
                <div style={{ padding:"10px 16px 0", overflowX:"auto" }}>
                  <div style={{ display:"flex", gap:8 }}>
                    {styleTestImages.map((url: string, i: number) => (
                      <img key={i} src={url} alt={`스타일 테스트 ${i+1}`}
                        style={{ height:180, borderRadius:8, objectFit:"cover", border:"1px solid #2a2a3d", flexShrink:0 }} />
                    ))}
                  </div>
                </div>
              )}
              {styleGenError && (
                <div style={{ padding:"6px 16px", fontSize:12, color:"#f87171" }}>⚠ {styleGenError}</div>
              )}
              {/* 스타일 텍스트 편집 영역 */}
              <div style={{ padding:"8px 16px 0" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#4a4a68", marginBottom:4, letterSpacing:"0.05em" }}>스타일 프롬프트 — 직접 편집 가능</div>
                <textarea
                  value={styleInput}
                  onChange={(e: { target: HTMLTextAreaElement }) => setStyleInput(e.target.value)}
                  placeholder="스타일 키워드 (영문). 예: Korean webtoon, dark fantasy, detailed ink lines, muted earth tones..."
                  rows={2}
                  style={{ width:"100%", background:"#12121c", border:"1px solid #2a2a3d", borderRadius:6, color:"#eeeef5", fontSize:12, padding:"8px 10px", resize:"none", boxSizing:"border-box", fontFamily:"inherit" }}
                />
              </div>
              <div style={{ padding:"6px 16px 10px", display:"flex", gap:8 }}>
                <button
                  onClick={() => void generateStyleTestImage()}
                  disabled={styleGenLoading || stylePhase === "generating"}
                  style={{ flex:1, background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.3)", borderRadius:8, color:"#f59e0b", fontSize:13, fontWeight:700, padding:"9px 0", cursor:"pointer", opacity: styleGenLoading ? 0.5 : 1 }}>
                  {stylePhase === "generating" ? "🎨 생성 중..." : "🎨 테스트 이미지 생성"}
                </button>
                <button
                  onClick={confirmStyle}
                  disabled={stylePhase === "generating"}
                  style={{ flex:1, background:"rgba(52,211,153,0.08)", border:"1px solid rgba(52,211,153,0.3)", borderRadius:8, color:"#34d399", fontSize:13, fontWeight:700, padding:"9px 0", cursor:"pointer" }}>
                  ✓ 이 스타일로 확정 →
                </button>
              </div>
            </div>
          )}

          {/* 스타일 단계 활성 중엔 아래 일반 바텀바 숨김 */}
          {stylePhase !== "idle" && stylePhase !== "confirmed" ? null : (<>

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
          </>)}
        </div>
      </div>
    </div>
  );
}

