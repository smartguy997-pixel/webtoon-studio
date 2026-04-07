# AI Webtoon Studio — 개발 문서 마스터

> 토큰 최적화 SaaS 웹툰 제작 플랫폼  
> 버전: v1.3.0 | 상태: Production-ready

---

## 빠른 시작

### 설치

```bash
# 저장소 클론 후 루트에서 의존성 설치
npm install
```

### 환경변수 설정

```bash
cp .env.example .env.local
```

`.env.local`에 필수 값 입력:

| 변수 | 설명 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 키 (필수) |
| `FIREBASE_PROJECT_ID` | Firebase 프로젝트 ID |
| `FIREBASE_PRIVATE_KEY` | Firebase 서비스 계정 Private Key |
| `FIREBASE_CLIENT_EMAIL` | Firebase 서비스 계정 이메일 |
| `WHISK_API_KEY` | Whisk 이미지 생성 API |
| `NANO_BANANA_API_KEY` | Nano Banana API |
| `REPLICATE_API_KEY` | Replicate (CLIP Score) |

> **로컬 개발**: Firebase 자격증명 없이도 실행 가능. `Bearer local` 토큰으로 인증이 자동 우회됩니다.

### 개발 서버 실행

```bash
# web + api 동시 실행
npm run dev

# 개별 실행
npm run dev --workspace=apps/web   # http://localhost:3000
npm run dev --workspace=apps/api   # http://localhost:4000
```

### 타입 체크 & 빌드

```bash
npm run typecheck
npm run build
```

---

## 디렉토리 구조

```
webtoon-studio/
├── apps/
│   ├── web/          ← Next.js 14 (App Router) 프론트엔드
│   └── api/          ← Express 백엔드 API
├── packages/
│   └── shared/       ← 공유 TypeScript 타입 & 상수
├── firebase/         ← Firestore 보안 규칙 & 인덱스
└── docs/             ← 기획/설계 문서
```

---

## 아키텍처

### 7인 에이전트 파이프라인

각 Phase는 전용 AI 에이전트가 처리하며, `apps/api/src/agents/`에 개별 파일로 관리됩니다.

| 에이전트 | 파일 | 활성 Phase |
|----------|------|-----------|
| 전략 기획자 | `strategist.ts` | Phase 1 |
| 심층 조사자 | `researcher.ts` | Phase 1–2 |
| 세계관 설계자 | `worldbuilder.ts` | Phase 2 |
| 캐릭터 디자이너 | `character.ts` | Phase 2, 5 |
| 시나리오 작가 | `scenario.ts` | Phase 3 |
| 대본/연출 작가 | `script.ts` | Phase 4 |
| 총괄 프로듀서 | `producer.ts` | 전 Phase |

### Phase GATING 조건

| 전환 | 조건 |
|------|------|
| Phase 1 → 2 | `feasibility_score ≥ 0.5` + 사용자 확인 |
| Phase 2 → 3 | `ASSET_LIST` 최소 1명/1배경 + A/B 선택 완료 |
| Phase 3 → 4 | 1~100화 에피소드 전체 + 사용자 확인 |
| Phase 4 화 전환 | 30컷 완성 + SCC 통과 + 사용자 확인 |

### 데이터 흐름

- **localStorage**: Phase 2~5 생성 데이터 임시 캐시 (새로고침 복원)
- **Firestore**: `projects`, `style_registry`, `series_roadmap`, `scripts` 컬렉션
- **SSE Streaming**: 모든 에이전트 응답은 Server-Sent Events로 실시간 스트리밍

---

## 문서 구조

이 저장소는 AI Webtoon Studio의 전체 개발 문서를 단계별로 관리합니다.  
각 Phase 문서는 독립적으로 읽을 수 있으며, 본 마스터 문서가 전체 컨텍스트를 제공합니다.

```
webtoon-studio-docs/
├── README.md                        ← 마스터 문서 (현재 파일)
├── phase-1-planning.md              ← Phase 1: 기획 분석서
├── phase-2-worldbuilding.md         ← Phase 2: 세계관 및 에셋 설계
├── phase-3-roadmap.md               ← Phase 3: 100화 시리즈 로드맵
├── phase-4-script.md                ← Phase 4: 30컷 제작 대본
├── phase-5-style-consistency.md     ← Phase 5: 화풍 유지 시스템
└── shared/
    ├── agents.md                    ← 7인 에이전트 페르소나 정의
    ├── schema.md                    ← 공통 JSON 출력 스키마
    └── firestore.md                 ← Firestore 데이터 모델
```

---

## 제품 비전

AI Webtoon Studio는 **7인의 전문 AI 에이전트**가 협업하여 고품질 웹툰 제작 파이프라인을 자동화하는 SaaS 플랫폼이다. 기획 분석부터 30컷 기술 대본까지, 반복적이고 시간 집약적인 콘텐츠 제작 과정을 AI가 대체하여 창작자가 핵심 창의 작업에만 집중할 수 있게 한다.

---

## 핵심 가치 제안 (USP)

| # | 기능 | 설명 |
|---|------|------|
| 1 | 7인 멀티 에이전트 | 전략 기획자·조사자·세계관 설계자·캐릭터 디자이너·시나리오 작가·대본 작가·총괄 프로듀서 역할 분담 |
| 2 | 토큰 최적화 | 10회 대화마다 슬라이딩 윈도우 압축으로 장기 프로젝트 비용 효율 유지 |
| 3 | 자동 에셋 추출 | 스토리 생성 시 캐릭터·배경·소품 `ASSET_LIST` JSON 자동 출력 |
| 4 | A/B 디자인 게이팅 | Whisk/Nano Banana API 호환 비주얼 프롬프트 2종 제시 후 사용자 확정 |
| 5 | 화풍 일관성 | MST(마스터 스타일 토큰) + 캐릭터 시트 + SCC 자동 검증 3레이어 구조 |
| 6 | Firestore 영속성 | 승인된 에셋과 프로젝트 상태가 세션 간 유지 |

---

## 전체 제작 워크플로우

```
[사용자 입력]
      │
      ▼
┌─────────────────────────────────────────────────┐
│  Phase 1: 기획 분석                              │
│  → 시장 트렌드, 장르 적합성, USP 도출           │
│  → 담당: 전략 기획자 + 총괄 프로듀서            │
│  → 문서: phase-1-planning.md                    │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  Phase 2: 세계관 및 에셋 설계                    │
│  → ASSET_LIST 자동 추출 + A/B 디자인 선택       │
│  → 담당: 세계관 설계자 + 캐릭터 디자이너        │
│  → 문서: phase-2-worldbuilding.md               │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  Phase 3: 100화 시리즈 로드맵                    │
│  → 전체 서사 구조, 에피소드별 요약              │
│  → 담당: 시나리오 작가 + 총괄 프로듀서          │
│  → 문서: phase-3-roadmap.md                     │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  Phase 4: 30컷 제작 대본                         │
│  → 컷별 JSON 대본, 카메라 앵글, 세로 스크롤 연출│
│  → 담당: 대본/연출 작가                         │
│  → 문서: phase-4-script.md                      │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  Phase 5: 화풍 유지 시스템 (전 단계 병행)        │
│  → MST 고정, 캐릭터/배경 시트, SCC 검증         │
│  → 담당: 캐릭터 디자이너 + 총괄 프로듀서        │
│  → 문서: phase-5-style-consistency.md           │
└─────────────────────────────────────────────────┘
```

---

## 7인 에이전트 요약

> 상세 정의: [shared/agents.md](./shared/agents.md)

| 에이전트 | 활성 Phase | 핵심 산출물 |
|----------|-----------|------------|
| 전략 기획자 | Phase 1 | 기획 분석서, USP, 장르 포지셔닝 |
| 심층 조사자 | Phase 1–2 | 팩트 체크 보고, 개연성 검토 |
| 세계관 설계자 | Phase 2 | 환경·사회 시스템·세계관 규칙 |
| 캐릭터 디자이너 | Phase 2, 5 | ASSET_LIST, Whisk 태그, 캐릭터 시트 |
| 시나리오 작가 | Phase 3 | 100화 로드맵, 완급 조절 플랜 |
| 대본/연출 작가 | Phase 4 | 30컷 JSON 대본, 카메라 앵글 |
| 총괄 프로듀서 | 전 Phase | 슬라이딩 윈도우 요약, 사용자 인터페이스 |

---

## 공통 출력 스키마

> 상세 정의: [shared/schema.md](./shared/schema.md)

모든 에이전트 산출물은 아래 JSON 구조를 준수한다.

```json
{
  "phase": "단계명",
  "summary": "현재까지 요약된 상태",
  "asset_list": {
    "characters": [],
    "locations": [],
    "props": []
  },
  "design_options": {
    "target_entity": "대상 이름",
    "options": ["프롬프트 A", "프롬프트 B"]
  },
  "script_data": [],
  "revision_history": []
}
```

---

## 토큰 관리 — 슬라이딩 윈도우

| 트리거 | 동작 | 담당 |
|--------|------|------|
| 대화 10회 도달 | [프로젝트 요약] 압축 생성, 이전 맥락 초기화 | 총괄 프로듀서 |
| 신규 세션 시작 | Firestore에서 최신 요약 자동 로드 | 총괄 프로듀서 |
| MST 변경 | 전체 에셋 시트 재검증 알림 | 총괄 프로듀서 |

---

## 외부 API 연동

| 서비스 | 용도 | 연동 방식 |
|--------|------|----------|
| Google Firestore | 프로젝트 상태·에셋 저장 | Firebase SDK |
| Whisk API | 이미지 생성 프롬프트 실행 | REST, 태그 문자열 |
| Nano Banana API | A/B 대체 이미지 생성 | REST |
| Anthropic API | 에이전트 LLM 백엔드 | claude-sonnet-4 |
| Replicate API | CLIP Score 계산 (SCC) | CLIP ViT-L/14 |

> Firestore 데이터 모델 상세: [shared/firestore.md](./shared/firestore.md)

---

## 개정 이력

| 버전 | 날짜 | 변경 내용 |
|------|------|----------|
| v1.0.0 | 2026-04 | 최초 PRD 작성 |
| v1.1.0 | 2026-04 | 화풍 유지 전략 섹션 추가 |
| v1.2.0 | 2026-04 | 단계별 MD 문서 분리 |
| v1.3.0 | 2026-04 | Phase 2~5 완전 구현, 에이전트 SDK 연동, 설치 가이드 추가 |
