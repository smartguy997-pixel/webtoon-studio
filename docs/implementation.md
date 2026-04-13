# AI Webtoon Studio — 구현 상세 문서

> **브랜치**: `claude/rebuild-webtoon-planning-qRcYg`  
> **최종 업데이트**: 2026-04-12

---

## 목차

1. [전체 아키텍처](#1-전체-아키텍처)
2. [로컬스토리지 데이터 맵](#2-로컬스토리지-데이터-맵)
3. [페이즈 간 데이터 흐름](#3-페이즈-간-데이터-흐름)
4. [Phase 1 — 기획 분석](#4-phase-1--기획-분석)
5. [Phase 2 — 세계관·캐릭터·화풍](#5-phase-2--세계관캐릭터화풍)
6. [Phase 3 — 시리즈 로드맵](#6-phase-3--시리즈-로드맵)
7. [Phase 4 — 30컷 대본](#7-phase-4--30컷-대본)
8. [Phase 5 — 이미지 프롬프트·SCC](#8-phase-5--이미지-프롬프트scc)
9. [프로젝트 홈 대시보드](#9-프로젝트-홈-대시보드)
10. [에이전트 시스템](#10-에이전트-시스템)
11. [화수 유연성 설계](#11-화수-유연성-설계)
12. [Gating 조건 요약](#12-gating-조건-요약)

---

## 1. 전체 아키텍처

```
apps/web/src/app/projects/[projectId]/
├── page.tsx                  ← 프로젝트 홈 대시보드
├── phase-1/page.tsx          ← 기획 분석 (7에이전트 토론)
├── phase-2/page.tsx          ← 세계관·캐릭터·화풍 (5단계 협업)
├── phase-3/page.tsx          ← 시리즈 로드맵 (동적 막 구조)
├── phase-4/page.tsx          ← 30컷 대본 (3에이전트 순차)
└── phase-5/page.tsx          ← 이미지 프롬프트·SCC (MST 자동 주입)
```

**클라이언트 상태 저장소**: 모든 페이즈 결과는 `localStorage`에 JSON으로 저장.  
**Firebase Firestore**: Phase 1에서 선택적 클라우드 동기화 지원.  
**AI**: `claude-sonnet-4-6` — 에이전트별 고유 시스템 프롬프트, 스트리밍 출력.

---

## 2. 로컬스토리지 데이터 맵

| 키 이름 | 저장 위치 | 내용 |
|---|---|---|
| `wts_phase1_{id}` | Phase 1 완료 시 | `{input: {genre, concept, episodeCount, platform}, data: {feasibility_score, verdict, usp[], competitors[], positioning, radar, worldbuilding_notes[], final_report}}` |
| `wts_phase2_{id}` | Phase 2 완료 시 | `{data: {world, characters[], mst}, savedAt}` |
| `wts_phase3_{id}` | Phase 3 완료 시 | `{roadmapCard, episodeCards[], context, savedAt}` |
| `wts_phase3_start_ep_{id}` | Phase 3 gating | 숫자 (Phase 4 시작 화 번호) |
| `wts_phase4_ep_{id}_{ep}` | Phase 4 화별 | `{sccRate, savedAt}` |
| `wts_phase4_card_{id}_{ep}` | Phase 4 화별 | `{card: {ep, cuts[], sccRate}, savedAt}` |
| `wts_phase5_ep_{id}_{ep}` | Phase 5 화별 | `{sccRate, savedAt}` |
| `wts_phase5_done_{id}` | Phase 5 완료 시 | `{completedEps[], savedAt}` |
| `wts_projects` | 프로젝트 목록 | `[{id, title}]` |

---

## 3. 페이즈 간 데이터 흐름

```
Phase 1
  └─ worldbuilding_notes[] ──────→ Phase 2 Stage 1·2 집중 보완
  └─ concept, summary ───────────→ Phase 2 모든 단계 컨텍스트
  └─ episodeCount ───────────────→ Phase 3 episodeTarget 초기값
  └─ platform ───────────────────→ Phase 3 플랫폼 최적화 힌트

Phase 2
  └─ characters[], world ────────→ Phase 3 세계관 기반
  └─ mst (Master Style Token) ──→ Phase 4 SCC 기준
                                  Phase 5 이미지 프롬프트 자동 prepend
  └─ characters[] ───────────────→ Phase 4 SCC 캐릭터 일관성 검증
                                  Phase 5 이미지 프롬프트 등장인물

Phase 3
  └─ roadmapCard (arc 구조) ────→ Phase 4 서사 컨텍스트
  └─ episodeCards[][episodes] ──→ Phase 4 화별 제목·사건·긴장도·클리프행어
  └─ startEp ───────────────────→ Phase 4 시작 화 번호

Phase 4
  └─ cuts[] (30컷 JSON) ─────────→ Phase 5 이미지 프롬프트 생성 기반
  └─ sccRate ────────────────────→ Phase 5 대기 화 목록 표시
```

---

## 4. Phase 1 — 기획 분석

**파일**: `apps/web/src/app/projects/[projectId]/phase-1/page.tsx`

### 에이전트 구성

7인 에이전트가 순서대로 발언:

| 에이전트 | 역할 |
|---|---|
| `strategist` | 전략 기획자 — 시장 포지셔닝 |
| `researcher` | 심층 조사자 — 유사작 비교 |
| `worldbuilder` | 세계관 설계자 — 설정 논리 |
| `character` | 캐릭터 디자이너 — 캐릭터 차별화 |
| `scenario` | 시나리오 작가 — 서사 구조 |
| `script` | 대본 작가 — 연출 가능성 |
| `producer` | 총괄 프로듀서 — 항상 마지막 발언, 최종 결론 |

### 주요 함수

```typescript
buildAgentPromptP1(agentId, genre, concept, platLabel, ep): string
// 에이전트별 시스템 프롬프트. 페르소나·장르·기획개요·플랫폼·목표화수 포함.

parsePhase1Result(text): Phase1Result | null
// [PHASE1_RESULT]...[/PHASE1_RESULT] 블록에서 JSON 파싱.

pickNextSpeaker(msgs, queue): AgentId
// 마지막 메시지 내용을 정규식으로 분석해 다음 발언자 결정.
```

### Phase1Result 스키마

```typescript
interface Phase1Result {
  feasibility_score: number;           // 0~1
  feasibility_breakdown: {
    market: number;                    // 0~100
    originality: number;
    producibility: number;
    commercial: number;
  };
  verdict: "go" | "conditional" | "reject";
  summary: string;
  genre_analysis: { genre, trend, audience, key_success };
  market_analysis: { platform, market_size, growth, competition_level, opportunity };
  similar_works: Array<{ title, platform, similarity, lesson }>;
  adoption_strategy: Array<{ from_work, good_point, how_to_apply }>;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
  worldbuilding_notes: Array<{ issue, suggestion, priority: "high"|"medium"|"low" }>;
  usp: USP[];
  competitors: Competitor[];
  positioning: { ours: PositioningPoint; competitors: PositioningPoint[] };
  radar: { ours: number[]; avg: number[]; categories: string[] };
  final_report: string;
}
```

### 입력 폼 설정

| 필드 | 옵션 | 기본값 |
|---|---|---|
| 장르 | 판타지, 로맨스, 스릴러 등 | 판타지 |
| 플랫폼 | 네이버, 카카오, 레진 등 | 네이버 |
| 목표화수 | 30화, 50화, 100화, 150화, 200화, 미정 | **30화** |

### Gating 조건

- `feasibility_score >= 0.5` — Phase 2 진행 버튼 활성화
- `score >= 0.7` → "GO", `0.5~0.7` → "CONDITIONAL", `< 0.5` → "REJECT"

---

## 5. Phase 2 — 세계관·캐릭터·화풍

**파일**: `apps/web/src/app/projects/[projectId]/phase-2/page.tsx`

### 5단계 파이프라인

| 단계 | ID | 내용 |
|---|---|---|
| 1 | `world` | 세계관 (시대, 분위기, 능력 체계, 금기) |
| 2 | `synopsis` | 시놉시스 (전체 서사 구조 3~5줄) |
| 3 | `characters` | 주요 캐릭터 3~5인 (외모·성격·역할·관계) |
| 4 | `locations` | 주요 배경 2~3곳 (분위기·색감·상징) |
| 5 | `props` | 소품·장비·도구 (스토리 기능, 시각 특징) |

각 단계는 독립된 에이전트 토론 → JSON 추출 → 컨셉 이미지 A/B 생성 순으로 진행.

### Master Style Token (MST)

```typescript
interface MST {
  line_weight: string;         // e.g., "2px bold outline"
  coloring: string;            // e.g., "flat cel-shading"
  perspective: string;         // e.g., "low-angle dynamic"
  style_keywords: string[];    // e.g., ["manhwa", "action", "cinematic"]
  forbidden_tags: string[];    // e.g., ["photorealistic", "3D render"]
}
```

- MST는 Phase 2 완료 후 **잠금(locked)** 상태.  
- Phase 5에서 모든 이미지 프롬프트에 자동 prepend.  
- 에이전트가 직접 수정 불가.

### 컨셉 이미지 생성 흐름

```
에이전트 토론 → 캐릭터/배경 JSON 확정
  → buildImageGenPrompt() → Claude API (이미지 프롬프트 생성)
  → Whisk API / Nano Banana API (A/B 이미지 렌더링)
  → 에이전트 A/B 추천 토론
  → 사용자 최종 선택 (또는 에이전트 다수결)
```

### Gating 조건

- 5단계 전체 완료 (stage result confirmed)
- MST 자동 생성 완료

---

## 6. Phase 3 — 시리즈 로드맵

**파일**: `apps/web/src/app/projects/[projectId]/phase-3/page.tsx`

### 동적 화수·막 구조

Phase 1의 `episodeCount` 값을 읽어 Phase 3 초기 목표화수로 사용.  
에이전트들이 토론에서 확장 여부를 논의하고 최종 막 구조를 결정.

```typescript
function parseEpCount(raw: string): number {
  const m = raw.match(/(\d+)/);
  return m ? parseInt(m[1]) : 0;  // "미정" → 0
}

function getArcGuide(epCount: number): string {
  if (epCount === 0) return "화수 미정 — 막 구조를 자유롭게 제안하세요";
  if (epCount <= 40) return `${epCount}화 — 2막 구조 권장`;
  if (epCount <= 60) return `${epCount}화 — 3막 구조 권장`;
  if (epCount <= 80) return `${epCount}화 — 3~4막 구조 권장`;
  return `${epCount}화 — 4막 구조 권장`;
}
```

| 화수 범위 | 권장 막 구조 |
|---|---|
| ~40화 | 2막 (발단·해소) |
| 41~60화 | 3막 (발단·전개·결말) |
| 61~80화 | 3~4막 |
| 81화+ | 4막 (발단·전개·위기·결말) |

### 에이전트 구성

```
DEBATE_AGENTS_P3 = ["scenario", "researcher", "worldbuilder", "producer"]
```

- API 키 부하 분산: scenario+researcher → Key 1, worldbuilder+producer → Key 2

### 로드맵 생성 흐름

```
1. 토론 (4에이전트, N라운드)
   └─ 화수 확장 여부 논의
   └─ 막 구조 결정
   └─ [ROADMAP_CARD] JSON 블록 생성

2. buildRoadmapGenPrompt() → Claude API
   └─ arcs[]: [{num, name, theme, eps:[start,end], color}]
   └─ totalEps: number

3. arc별 buildEpisodeGenPrompt() → Claude API (병렬)
   └─ maxTokens: Math.max(3000, epCount * 120)
   └─ [EPISODE_CARD_N] JSON 블록 생성
   └─ episodes[]: [{ep, title, event, chars, emotion, foreshadow, tension:1~5, cliffhanger}]
```

### PacingTimeline 컴포넌트

전체 화수를 가로 막대로 시각화:

- **색상**: 긴장도 1=녹색(#16a34a) → 5=빨강(#dc2626)
- **⚡ 마커**: cliffhanger 화 표시
- **호버 툴팁**: 화 번호, 제목, 사건 요약
- **범례**: 막 색상 + 긴장도 스케일

### Gating 조건

- 로드맵 카드 생성 완료
- 전체 화 에피소드 카드 생성 완료
- 사용자 "대본 작성 시작" 버튼 확인 + 시작 화 번호 선택

---

## 7. Phase 4 — 30컷 대본

**파일**: `apps/web/src/app/projects/[projectId]/phase-4/page.tsx`

### 에이전트 순서 (3단계 순차)

```
Step 1: script    → 30컷 JSON 대본 생성
Step 2: character → SCC(화풍 일관성) 검증
Step 3: producer  → 최종 승인 및 요약
```

### 컷 카드 스키마

```typescript
interface CutCard {
  ep: number;
  cuts: Cut[];
  sccRate: number;  // 0~1
}

interface Cut {
  num: number;           // 1~30
  panel_type: string;    // "full_page" | "half" | "quarter" | ...
  angle: string;         // "extreme_close_up" | "wide" | ...
  characters: string[];
  expression: string;
  dialogue: string;
  sfx: string;
  direction: string;
  mst_tags: string[];
  scc_status: "pass" | "warn" | "fail";
  scc_score: number;     // 0~1
}
```

### SCC 기준

| 등급 | 점수 | 색상 |
|---|---|---|
| PASS | ≥0.85 | 녹색 |
| WARN | 0.70~0.84 | 노랑 |
| FAIL | <0.70 | 빨강 |

`sccRate = PASS 컷 수 / 30`

### Phase 3 컨텍스트 연동

Phase 4 마운트 시:
- `wts_phase3_start_ep_{id}` → 시작 화 번호 자동 로드
- `wts_phase3_{id}.episodeCards` → 현재 화의 제목·사건·긴장도·클리프행어 표시

### Gating 조건

- 30컷 생성 완료
- SCC rate ≥0.7 권장 (하드 게이팅 아님)
- 사용자 "다음 화" 또는 "Phase 5 시작" 클릭

---

## 8. Phase 5 — 이미지 프롬프트·SCC

**파일**: `apps/web/src/app/projects/[projectId]/phase-5/page.tsx`

### 에이전트 순서 (3단계 순차)

```
Step 1: character  → 5개 핵심컷 이미지 프롬프트 생성 (MST 자동 prepend)
Step 2: worldbuilder → SCC 분석 및 일관성 검증
Step 3: producer   → 최종 승인
```

### MST 자동 주입

```typescript
// apps/api/src/services/whisk.ts 의 API 래퍼에서 처리
function buildImagePrompt(userPrompt: string, mst: MST): string {
  return [
    mst.style_keywords.join(", "),
    `line: ${mst.line_weight}`,
    `coloring: ${mst.coloring}`,
    `perspective: ${mst.perspective}`,
    userPrompt,
    `--no ${mst.forbidden_tags.join(", ")}`,
  ].join(". ");
}
```

### SCC 기준 (Phase 5)

| 등급 | 점수 |
|---|---|
| 이미지 생성 가능 | ≥0.82 (82%) |
| 재검증 필요 | <0.82 |

### Phase 4 대기 패널

Phase 4에서 완료(sccRate 저장)됐지만 Phase 5 미완료인 화를 클릭 가능한 버튼으로 표시:

```typescript
const [p4DoneEps, setP4DoneEps] = useState<number[]>([]);
// 마운트 시 1~100 화 순회: wts_phase4_ep_{id}_{ep} 존재 + wts_phase5_ep_{id}_{ep} 없음
```

### SCC 이력 패널

완료된 모든 화의 SCC 점수를 색상 코드 칩으로 표시:

```typescript
const [sccHistory, setSccHistory] = useState<{ep: number; sccRate: number}[]>([]);
// 색상: sccRate >= 0.82 → 녹색, >= 0.70 → 노랑, < 0.70 → 빨강
```

### 이미지 프롬프트 스키마 (화당 5개)

```typescript
interface ImagePrompt {
  cut: number;
  angle: string;
  scene: string;
  prompt: string;      // MST prepend 포함
  negative: string;    // forbidden_tags 기반
  scc_status: "pass" | "warn" | "fail";
  scc_score: number;
}
```

---

## 9. 프로젝트 홈 대시보드

**파일**: `apps/web/src/app/projects/[projectId]/page.tsx`

### 진행도 계산

```
currentPhase:
  0 = 아무것도 없음
  1 = Phase 1 완료 (feasibility_score ≥ 0.5)
  2 = Phase 2 완료 (wts_phase2 존재)
  3 = Phase 3 완료 (wts_phase3_done)
  4 = Phase 4 일부 완료 (wts_phase4_ep_*_1 존재)
  5 = Phase 5 일부 완료 (wts_phase5_ep_*_1 존재)
```

### 대시보드 카드 내용

| Phase | 표시 정보 |
|---|---|
| Phase 1 | 실현가능성 점수, verdict 배지, USP 태그, 최종 요약 |
| Phase 2 | 세계관 시대·분위기, 캐릭터 이름·역할, 대본 진행률 바 |
| Phase 3 | 로드맵 완성 여부, 총 화 수 |
| Phase 4 | 완료 화 수 / 전체, SCC rate 평균 |
| Phase 5 | 완료 화 수, 이미지 프롬프트 생성 완료 |

---

## 10. 에이전트 시스템

### 에이전트 ID 및 역할

```typescript
const AGENTS = {
  strategist:   { label: "전략 기획자",   emoji: "🎯" },
  researcher:   { label: "심층 조사자",   emoji: "🔍" },
  worldbuilder: { label: "세계관 설계자", emoji: "🌍" },
  character:    { label: "캐릭터 디자이너", emoji: "🎨" },
  scenario:     { label: "시나리오 작가", emoji: "📖" },
  script:       { label: "대본 작가",     emoji: "🎬" },
  producer:     { label: "총괄 프로듀서", emoji: "🎭" },
};
```

### 공통 규칙 (DEBATE_RULES)

모든 에이전트에 공통으로 주입되는 토론 규칙:
- 한 번에 3~5문장
- 이전 발언 인용 후 본인 주장
- 구체적 근거 (수치, 유사작 사례)
- 합의 지향 (반박 시 대안 제시)

### 슬라이딩 윈도우

대화 10회마다 `producer` 에이전트가 `[프로젝트 요약]` 생성.  
요약은 Firestore `project_summary/{projectId}/phase_N`에 저장.  
다음 대화 시 요약으로 시작하여 토큰 사용 최적화.

---

## 11. 화수 유연성 설계

### 기본값 변경 이력

| 버전 | 기본 목표화수 | 비고 |
|---|---|---|
| 초기 | 100화 | 고정 4막 구조 |
| 현재 | **30화** | 동적 막 구조 |

### 데이터 흐름

```
Phase 1 폼 → episodeCount 선택 (기본: "30화")
  ↓ localStorage wts_phase1_{id}.input.episodeCount 저장
Phase 3 마운트 → episodeTarget = wts_phase1_{id}.input.episodeCount
  ↓ 에이전트 토론 시 "Phase 1 목표 화수: 30화" 제시
  ↓ 에이전트들이 확장(50화, 100화) 또는 유지 논의
  ↓ 최종 roadmapCard.totalEps 결정
Phase 3 이후 → 모든 UI가 실제 totalEps 기반으로 표시
```

### 동적 호큰 예산

에피소드 생성 시 화수에 비례한 토큰 배정:

```typescript
const maxTokens = Math.max(3000, epCount * 120);
// 30화: 3600 tokens
// 100화: 12000 tokens
```

---

## 12. Gating 조건 요약

| 전환 | 조건 |
|---|---|
| Phase 1 → 2 | `feasibility_score >= 0.5` + 사용자 "진행" 클릭 |
| Phase 2 → 3 | 5단계 모두 완료 + MST 생성 완료 |
| Phase 3 → 4 | 로드맵 + 전체 에피소드 카드 완료 + 사용자 "대본 시작" 클릭 |
| Phase 4 → 5 | 화별 30컷 완료 (SCC ≥0.7 권장) + 사용자 "다음 화" 클릭 |
| Phase 5 완료 | SCC ≥0.82 (권장, 하드 게이팅 아님) |

---

## 부록: 주요 파서 패턴

에이전트 출력에서 구조화 데이터를 추출하는 공통 패턴:

```typescript
// 범용 블록 파서
function parseBlock(text: string, tag: string): unknown | null {
  const re = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[/${tag}\\]`);
  const m = text.match(re);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()); }
  catch { return null; }
}

// 사용 예
const roadmapCard = parseBlock(text, "ROADMAP_CARD") as RoadmapCard;
const episodeCard = parseBlock(text, `EPISODE_CARD_${arcIdx}`) as EpisodeCard;
const phase1Result = parseBlock(text, "PHASE1_RESULT") as Phase1Result;
```
