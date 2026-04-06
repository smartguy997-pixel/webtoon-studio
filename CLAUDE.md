# CLAUDE.md — AI Webtoon Studio 개발 가이드

## 프로젝트 개요

AI Webtoon Studio는 7인의 전문 AI 에이전트가 협업하여 고품질 웹툰 제작 파이프라인을 자동화하는 SaaS 플랫폼이다.

- **Anthropic API**: `claude-sonnet-4-6` 모델 사용
- **Firebase**: Firestore 데이터 영속성, Firebase Auth 인증
- **이미지 생성**: Whisk API + Nano Banana API (A/B 게이팅)
- **화풍 검증**: Replicate API (CLIP ViT-L/14)

## 디렉토리 구조

```
webtoon-studio/
├── CLAUDE.md
├── apps/
│   ├── web/          ← Next.js 14 (App Router) 프론트엔드
│   └── api/          ← Express 백엔드 API
├── packages/
│   └── shared/       ← 공유 TypeScript 타입 & 상수
├── firebase/         ← Firestore 보안 규칙 & 인덱스
└── docs/             ← 기획/설계 문서
```

## 개발 명령어

```bash
# 루트에서 전체 설치
npm install

# 개발 서버 실행 (web + api 동시)
npm run dev

# 개별 앱 실행
npm run dev --workspace=apps/web
npm run dev --workspace=apps/api

# 타입 체크
npm run typecheck

# 빌드
npm run build
```

## 환경변수 설정

`.env.example`을 복사해서 `.env.local` 생성:

```bash
cp .env.example .env.local
```

필수 환경변수:
- `ANTHROPIC_API_KEY` — Anthropic API 키
- `FIREBASE_*` — Firebase 프로젝트 설정
- `WHISK_API_KEY` — Whisk 이미지 생성 API
- `NANO_BANANA_API_KEY` — Nano Banana API
- `REPLICATE_API_KEY` — Replicate (CLIP Score)

## 아키텍처 핵심 원칙

### 1. 에이전트 시스템 (`apps/api/src/agents/`)

7인 에이전트 각각의 시스템 프롬프트가 개별 파일로 관리된다.

- `producer.ts` — 총괄 프로듀서 (항상 마지막 발언, 슬라이딩 윈도우)
- `strategist.ts` — 전략 기획자 (Phase 1)
- `researcher.ts` — 심층 조사자 (Phase 1-2)
- `worldbuilder.ts` — 세계관 설계자 (Phase 2)
- `character.ts` — 캐릭터 디자이너 (Phase 2, 5)
- `scenario.ts` — 시나리오 작가 (Phase 3)
- `script.ts` — 대본/연출 작가 (Phase 4)

### 2. 슬라이딩 윈도우 토큰 관리

대화 10회마다 총괄 프로듀서가 `[프로젝트 요약]`을 생성하고 Firestore에 저장.
`apps/api/src/utils/sliding-window.ts` 참조.

### 3. Phase GATING

각 Phase는 다음 Phase로 진행하기 전에 GATING 조건을 충족해야 한다:
- Phase 1 → 2: `feasibility_score ≥ 0.5` + 사용자 "진행" 확인
- Phase 2 → 3: `ASSET_LIST` 최소 1명/1배경 + A/B 선택 완료
- Phase 3 → 4: 1~100화 에피소드 전체 + 사용자 "대본 작성 시작" 확인
- Phase 4: 화별 30컷 + SCC 검증 통과 + 사용자 "다음 화" 확인

### 4. MST 자동 주입

Phase 5의 MST(마스터 스타일 토큰)는 `apps/api/src/services/whisk.ts`의
API 래퍼에서 모든 이미지 생성 요청에 자동으로 prepend된다.
에이전트가 직접 MST를 수정할 수 없다.

### 5. JSON 스키마 검증

모든 에이전트 출력은 `packages/shared/src/types/`의 TypeScript 타입과
`apps/api/src/utils/json-validator.ts`로 검증된다.

## Firestore 컬렉션 구조

```
projects/{project_id}                  ← 프로젝트 메타
project_summary/{project_id}/phase_N   ← 슬라이딩 윈도우 요약
approved_assets/{project_id}/          ← Phase 2 확정 에셋
style_registry/{project_id}/           ← Phase 5 MST + 시트
series_roadmap/{project_id}/           ← Phase 3 로드맵
scripts/{project_id}/episodes/         ← Phase 4 대본
```

상세 스키마: `docs/firestore.md`

## 상세 문서

- `docs/phase-1-planning.md` — Phase 1 기획 분석
- `docs/phase-2-worldbuilding.md` — Phase 2 세계관/에셋
- `docs/phase-3-roadmap.md` — Phase 3 100화 로드맵
- `docs/phase-4-script.md` — Phase 4 30컷 대본
- `docs/phase-5-style-consistency.md` — Phase 5 화풍 유지
- `docs/agents.md` — 7인 에이전트 페르소나
- `docs/schema.md` — 공통 JSON 출력 스키마
- `docs/firestore.md` — Firestore 데이터 모델
