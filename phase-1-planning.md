# Phase 1 — 기획 분석서

> 마스터 문서: [README.md](./README.md)  
> 공통 스키마: [shared/schema.md](./shared/schema.md)  
> 에이전트 정의: [shared/agents.md](./shared/agents.md)

---

## 개요

| 항목 | 내용 |
|------|------|
| Phase | 1 / 4 |
| 목표 | 시장 트렌드 분석 → 장르 포지셔닝 → USP 확정 |
| 담당 에이전트 | 전략 기획자, 심층 조사자, 총괄 프로듀서 |
| 선행 조건 | 없음 (첫 번째 단계) |
| 다음 단계 | [Phase 2 — 세계관 및 에셋 설계](./phase-2-worldbuilding.md) |
| 산출물 | `[기획 분석서]` JSON + 요약 리포트 |

---

## 1. 에이전트 역할 분담

```
사용자 입력 (아이디어/키워드)
        │
        ▼
[전략 기획자] ──────────────────────────────────────┐
  · 네이버 웹툰 / 카카오페이지 / 레진코믹스 트렌드 분석  │
  · 장르 포지셔닝 매트릭스 작성                        │
  · 경쟁작 3종 벤치마크                               │
        │                                            │
        ▼                                            │
[심층 조사자] ────────────────────────────────────── │
  · 설정의 현실성·논리성 검토                         │
  · 장르 클리셰 및 차별화 포인트 지적                  │
        │                                            │
        ▼                                            ▼
[총괄 프로듀서] ◄────────────────────────────────────┘
  · 두 에이전트 의견 종합
  · USP 3~5개 확정
  · 기획 분석서 JSON 출력
```

---

## 2. 입력 스펙

```json
{
  "phase": "기획 분석",
  "user_input": {
    "title": "작품 가제 (선택)",
    "genre": "장르 키워드",
    "concept": "핵심 아이디어 서술 (자유형식)",
    "target_audience": "독자층 힌트 (선택)"
  }
}
```

---

## 3. 처리 로직

### 3.1 시장 트렌드 분석

전략 기획자 에이전트가 아래 기준으로 장르 포지셔닝을 수행한다.

**분석 대상 플랫폼**

| 플랫폼 | 분석 항목 |
|--------|----------|
| 네이버 웹툰 | 요일별 상위 20위, 최근 3개월 신작 트렌드 |
| 카카오페이지 | 기다리면 무료 상위작, 완결 선호 장르 |
| 레진코믹스 | 성인 장르 트렌드, 독립 작가 성공 케이스 |

**포지셔닝 매트릭스 축**

- X축: 대중성(Mass) ↔ 마니아(Niche)
- Y축: 신규 IP ↔ 기존 클리셰 재해석

### 3.2 경쟁작 벤치마크

아래 3가지 항목을 경쟁작 3종에 대해 분석한다.

1. **강점(S)** — 독자 유인 요소
2. **약점(W)** — 비판 포인트, 독자 이탈 원인
3. **우리의 차별점** — 해당 약점을 파고드는 전략

### 3.3 USP 도출

심층 조사자의 검토 결과를 반영하여 USP를 3~5개로 확정한다.

- 각 USP는 **독자 관점 언어**로 작성 (예: "매화 끝에 반전이 있다")
- 개발팀 언어(기술 스펙)가 아닌 마케팅 언어로 표현
- 유사 USP 2개 이상 시 총괄 프로듀서가 통합 조정

---

## 4. 출력 스키마

```json
{
  "phase": "기획 분석",
  "summary": "string — 300자 이내 전체 기획 요약",
  "market_analysis": {
    "genre": "확정 장르",
    "positioning": "포지셔닝 매트릭스 설명",
    "trend_keywords": ["키워드1", "키워드2"],
    "competitors": [
      {
        "title": "경쟁작 제목",
        "strength": "강점",
        "weakness": "약점",
        "our_edge": "차별점"
      }
    ]
  },
  "usp": [
    "USP 1 (독자 관점 언어)",
    "USP 2",
    "USP 3"
  ],
  "feasibility_score": 0.0,
  "agent_notes": {
    "strategist": "전략 기획자 코멘트",
    "researcher": "심층 조사자 코멘트",
    "producer": "총괄 프로듀서 최종 판단"
  },
  "asset_list": {
    "characters": [],
    "locations": [],
    "props": []
  },
  "revision_history": []
}
```

**`feasibility_score` 판정 기준**

| 점수 | 판정 | 다음 행동 |
|------|------|----------|
| 0.8 이상 | ✅ 진행 | Phase 2 자동 진행 |
| 0.5 ~ 0.79 | ⚠️ 조건부 진행 | 사용자 확인 후 진행 |
| 0.5 미만 | ❌ 재기획 권고 | 입력 수정 후 Phase 1 재실행 |

---

## 5. GATING 조건

Phase 1 → Phase 2 진행을 위해 아래 두 조건을 모두 충족해야 한다.

- [ ] `feasibility_score` ≥ 0.5
- [ ] 사용자가 USP 목록을 확인하고 **"진행"** 버튼 클릭

조건 미충족 시 총괄 프로듀서가 수정 방향을 제안하고 재실행을 안내한다.

---

## 6. 슬라이딩 윈도우 트리거

- Phase 1 내 대화가 10회를 초과하면 총괄 프로듀서가 **[기획 요약 v1]** 생성
- 요약은 `feasibility_score`, USP, 장르, 포지셔닝 핵심만 보존
- 원본 대화 맥락은 초기화하고 Firestore `project_summary` 컬렉션에 저장

```json
// Firestore: project_summary/{project_id}/phase_1
{
  "summary_version": 1,
  "genre": "string",
  "usp": [],
  "feasibility_score": 0.0,
  "created_at": "timestamp"
}
```

---

## 7. 개발 체크리스트

### Backend
- [ ] 전략 기획자 에이전트 시스템 프롬프트 구현
- [ ] 심층 조사자 에이전트 시스템 프롬프트 구현
- [ ] 총괄 프로듀서 USP 통합 로직 구현
- [ ] `feasibility_score` 자동 산출 로직
- [ ] Phase 1 출력 스키마 유효성 검사 (JSON Schema Validation)
- [ ] Firestore `project_summary` 저장 및 로드

### Frontend
- [ ] 사용자 입력 폼 (장르·개념·타겟 독자)
- [ ] 에이전트 진행 상태 실시간 표시
- [ ] USP 목록 표시 및 확인 버튼 (GATING UI)
- [ ] `feasibility_score` 시각화 (점수 + 판정 배지)

### 연동
- [ ] Anthropic API `claude-sonnet-4` 호출
- [ ] Firestore 연결 및 인증

---

## 다음 단계

Phase 1 GATING 통과 시 → **[Phase 2 — 세계관 및 에셋 설계](./phase-2-worldbuilding.md)**
