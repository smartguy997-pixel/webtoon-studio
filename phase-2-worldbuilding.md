# Phase 2 — 세계관 및 에셋 설계

> 마스터 문서: [README.md](./README.md)  
> 이전 단계: [Phase 1 — 기획 분석서](./phase-1-planning.md)  
> 공통 스키마: [shared/schema.md](./shared/schema.md)  
> 에이전트 정의: [shared/agents.md](./shared/agents.md)

---

## 개요

| 항목 | 내용 |
|------|------|
| Phase | 2 / 4 |
| 목표 | 세계관 규칙 확립 → ASSET_LIST 자동 추출 → A/B 디자인 선택 확정 |
| 담당 에이전트 | 세계관 설계자, 캐릭터 디자이너, 심층 조사자, 총괄 프로듀서 |
| 선행 조건 | Phase 1 GATING 통과 (`feasibility_score` ≥ 0.5 + 사용자 확인) |
| 다음 단계 | [Phase 3 — 100화 시리즈 로드맵](./phase-3-roadmap.md) |
| 산출물 | 세계관 문서 + `ASSET_LIST` JSON + 승인된 디자인 에셋 |

---

## 1. 에이전트 역할 분담

```
Phase 1 결과 (장르 + USP + feasibility_score)
        │
        ▼
[세계관 설계자] ─────────────────────────────────────┐
  · 물리적 환경 설계 (지리, 기후, 시대)               │
  · 사회 시스템 설계 (계급, 권력, 경제)               │
  · 세계관 고유 규칙 정의 (능력 체계, 금기, 법칙)      │
        │                                            │
        ▼                                            │
[심층 조사자] ────────────────────────────────────── │
  · 설정 내부 모순 검토                               │
  · 현실 레퍼런스와 충돌 여부 팩트 체크               │
        │                                            │
        ▼                                            │
[캐릭터 디자이너] ────────────────────────────────── │
  · 등장인물 외형 및 성격 정의                        │
  · ASSET_LIST JSON 자동 생성                        │
  · 각 에셋별 A/B 비주얼 프롬프트 작성               │
        │                                            ▼
[총괄 프로듀서] ◄────────────────────────────────────┘
  · 에셋 A/B 선택 UI 제시 (GATING)
  · 사용자 선택 수집 → Firestore approved_assets 저장
  · Phase 5 화풍 시스템과 동기화
```

---

## 2. 입력 스펙

```json
{
  "phase": "세계관_에셋_설계",
  "from_phase_1": {
    "genre": "string",
    "usp": [],
    "feasibility_score": 0.0,
    "summary": "string"
  },
  "user_additions": {
    "world_hints": "추가 세계관 힌트 (선택)",
    "character_hints": "주요 캐릭터 힌트 (선택)"
  }
}
```

---

## 3. 처리 로직

### 3.1 세계관 설계 (세계관 설계자)

세계관 설계자는 아래 4개 레이어를 순서대로 설계한다.

**레이어 1 — 물리 환경**

| 항목 | 정의 내용 |
|------|----------|
| 시대·배경 | 현대/근미래/판타지/이세계 등 |
| 지리 | 주요 거점 도시, 금지 구역, 이동 제약 |
| 기후·자연 | 작품 분위기에 영향을 주는 환경 요소 |

**레이어 2 — 사회 시스템**

| 항목 | 정의 내용 |
|------|----------|
| 권력 구조 | 지배 집단, 저항 세력, 중립 세력 |
| 계급 체계 | 캐릭터 계층별 행동 제약 |
| 경제 시스템 | 화폐, 거래, 희소 자원 |

**레이어 3 — 고유 규칙 (세계관 핵심)**

- 능력/마법/기술 체계: 발동 조건, 한계, 부작용
- 금기 및 터부: 위반 시 패널티
- 세계관 내 과학/논리 법칙

**레이어 4 — 정보 비대칭**

- 독자는 알고 캐릭터는 모르는 설정
- 캐릭터는 알고 독자는 모르는 설정 (복선 장치)

### 3.2 ASSET_LIST 자동 추출

세계관 설계 완료 즉시 캐릭터 디자이너가 `ASSET_LIST`를 자동 생성한다.

```json
{
  "asset_list": {
    "characters": [
      {
        "id": "char_001",
        "name": "string",
        "role": "protagonist | antagonist | supporting",
        "age": "string",
        "personality": "string",
        "appearance": {
          "face": "string",
          "body": "string",
          "hair": "string",
          "outfit": "string",
          "distinguishing_features": "string"
        },
        "ability": "string",
        "arc": "string"
      }
    ],
    "locations": [
      {
        "id": "loc_001",
        "name": "string",
        "type": "interior | exterior | landmark",
        "atmosphere": "string",
        "structure": "string",
        "first_appearance": "화 번호"
      }
    ],
    "props": [
      {
        "id": "prop_001",
        "name": "string",
        "function": "string",
        "appearance": "string",
        "owner": "char_id"
      }
    ]
  }
}
```

### 3.3 A/B 디자인 옵션 생성 (GATING)

`ASSET_LIST`의 각 캐릭터 및 주요 배경에 대해 Whisk API 호환 프롬프트 2종을 생성한다.

**프롬프트 구조**

```
[MST 고정 블록] + [에셋별 고유 태그]
```

- MST 블록은 Phase 5 화풍 시스템에서 자동 주입 → [phase-5-style-consistency.md](./phase-5-style-consistency.md) 참조
- Option A / Option B는 **에셋별 고유 태그**만 다르게 작성

**예시 — 주인공 캐릭터**

```
Option A:
  short black hair, sharp eyes, dark navy trench coat,
  slim athletic build, 24yo Korean woman,
  detective badge on belt, serious expression

Option B:
  long tied hair, calm expression, casual streetwear hoodie,
  subtle energy aura, 24yo Korean woman,
  glowing left eye, contemplative mood
```

---

## 4. 출력 스키마

```json
{
  "phase": "세계관_에셋_설계",
  "summary": "string — 500자 이내 세계관 핵심 요약",
  "world_design": {
    "physical_env": {
      "era": "string",
      "geography": "string",
      "climate": "string"
    },
    "social_system": {
      "power_structure": "string",
      "class_system": "string",
      "economy": "string"
    },
    "unique_rules": [
      {
        "rule_name": "string",
        "description": "string",
        "limitation": "string"
      }
    ],
    "information_asymmetry": {
      "reader_knows": [],
      "character_knows": []
    }
  },
  "asset_list": {
    "characters": [],
    "locations": [],
    "props": []
  },
  "design_options": [
    {
      "target_id": "char_001",
      "target_name": "string",
      "target_type": "character | location",
      "option_a": "Whisk 프롬프트 문자열",
      "option_b": "Whisk 프롬프트 문자열",
      "selected": null
    }
  ],
  "approved_assets": [],
  "agent_notes": {
    "worldbuilder": "string",
    "researcher": "string",
    "character_designer": "string",
    "producer": "string"
  },
  "revision_history": []
}
```

---

## 5. GATING 조건

**두 조건 모두 충족 시 Phase 3 진행**

| 조건 | 내용 |
|------|------|
| 조건 1 | `ASSET_LIST`에 캐릭터 최소 1명, 배경 최소 1개 존재 |
| 조건 2 | 모든 `design_options[].selected` 값이 `null`이 아님 (사용자가 A/B 선택 완료) |

**미충족 처리**

- 조건 1 미충족: 캐릭터 디자이너 에이전트가 자동 보충 제안
- 조건 2 미충족: 미선택 에셋 목록 표시 후 사용자 선택 대기

---

## 6. Firestore 저장 구조

```
approved_assets/{project_id}/
  ├── characters/
  │   ├── char_001    { ...character_sheet, selected_prompt, ref_image_id }
  │   └── char_002    { ... }
  ├── locations/
  │   └── loc_001     { ...background_sheet, mood_variants }
  └── props/
      └── prop_001    { ... }
```

> 전체 Firestore 스키마: [shared/firestore.md](./shared/firestore.md)

---

## 7. Phase 5 화풍 시스템 연동

A/B 선택이 완료된 에셋은 즉시 Phase 5 화풍 유지 시스템에 등록된다.

- 캐릭터 → **캐릭터 시트 자동 생성** 트리거
- 배경 → **배경 시트 자동 생성** 트리거

> 상세: [Phase 5 — 화풍 유지 시스템](./phase-5-style-consistency.md)

---

## 8. 개발 체크리스트

### Backend
- [ ] 세계관 설계자 에이전트 시스템 프롬프트 구현 (4레이어 구조)
- [ ] `ASSET_LIST` 자동 추출 파서 (에이전트 응답 → JSON 변환)
- [ ] A/B 프롬프트 생성 로직 (MST 주입 포함)
- [ ] GATING 조건 검사 로직
- [ ] Firestore `approved_assets` 저장 및 Phase 5 트리거

### Frontend
- [ ] 세계관 설계 진행 상태 시각화
- [ ] `ASSET_LIST` 카드 목록 UI
- [ ] A/B 디자인 선택 카드 UI (이미지 + 프롬프트 표시)
- [ ] 선택 완료 배지 및 GATING 진행 버튼

### 연동
- [ ] Whisk API 호출 (A/B 이미지 생성)
- [ ] Nano Banana API 호출 (대체 옵션)
- [ ] Phase 5 SCC 초기화 연동

---

## 다음 단계

Phase 2 GATING 통과 시 → **[Phase 3 — 100화 시리즈 로드맵](./phase-3-roadmap.md)**
