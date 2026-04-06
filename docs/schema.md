# 공유 — 공통 JSON 출력 스키마

> 마스터 문서: [README.md](../README.md)  
> 에이전트 정의: [agents.md](./agents.md)

---

## 표준 응답 구조

모든 에이전트 산출물은 아래 최상위 스키마를 준수한다.  
각 Phase별 확장 필드는 해당 Phase 문서에 정의되어 있다.

```json
{
  "phase": "string — 기획 분석 | 세계관_에셋_설계 | 100화_로드맵 | 30컷_대본",
  "summary": "string — 현재까지 요약된 상태 (300~500자)",
  "asset_list": {
    "characters": [],
    "locations": [],
    "props": []
  },
  "design_options": {
    "target_entity": "string — 대상 에셋 이름",
    "options": [
      "string — Whisk API 호환 영문 프롬프트 A",
      "string — Whisk API 호환 영문 프롬프트 B"
    ]
  },
  "script_data": [],
  "revision_history": []
}
```

---

## 필드 정의

### `phase`

| 값 | 대응 Phase |
|----|-----------|
| `"기획 분석"` | Phase 1 |
| `"세계관_에셋_설계"` | Phase 2 |
| `"100화_로드맵"` | Phase 3 |
| `"30컷_대본"` | Phase 4 |

---

### `asset_list`

스토리 또는 시놉시스 생성 시 자동 추출된다.

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
        "first_appearance": "string — 화 번호"
      }
    ],
    "props": [
      {
        "id": "prop_001",
        "name": "string",
        "function": "string",
        "appearance": "string",
        "owner": "string — char_id | null"
      }
    ]
  }
}
```

---

### `design_options`

A/B 디자인 게이팅에 사용된다. Phase 2에서 생성되며 사용자 선택 전까지 `selected`는 `null`이다.

```json
{
  "design_options": [
    {
      "target_id": "char_001 | loc_001",
      "target_name": "string",
      "target_type": "character | location",
      "option_a": "string — Whisk API 영문 프롬프트",
      "option_b": "string — Whisk API 영문 프롬프트",
      "selected": "A | B | null"
    }
  ]
}
```

**프롬프트 작성 규칙**

- 반드시 영문으로 작성 (Whisk API 요구사항)
- MST 블록은 포함하지 않음 (Phase 5에서 자동 주입)
- Option A와 B는 분명히 다른 방향성 (미세한 차이 금지)
- 태그 형식: `comma, separated, descriptive, tags`

---

### `script_data`

Phase 4에서 생성되는 30컷 대본 배열이다.

```json
{
  "script_data": [
    {
      "cut": 1,
      "angle": "ELS | LS | MS | MCU | CU | ECU | OTS | POV | BIRD | WORM | DUTCH",
      "aspect_ratio": "1:1 | 1:1.5 | 1:2 | 1:3",
      "scene_description": "string",
      "characters": [
        {
          "char_id": "string",
          "position": "left | center | right | background",
          "expression": "기쁨 | 분노 | 슬픔 | 놀람 | 무표정 | 긴장",
          "pose": "string"
        }
      ],
      "location_id": "string",
      "background_variant": "day_clear | day_cloudy | evening | night | rain | snow",
      "dialogue": [
        {
          "char_id": "string",
          "text": "string",
          "balloon_type": "normal | shout | whisper | thought | narration"
        }
      ],
      "sfx": ["string"],
      "effect": "none | speed_lines | impact_lines | glow | blur",
      "image_prompt": {
        "auto_injected_mst": "Phase 5 자동 주입",
        "cut_specific_tags": "string",
        "negative_prompt": "string"
      },
      "director_note": "string"
    }
  ]
}
```

---

### `revision_history`

모든 수정 이력을 기록한다.

```json
{
  "revision_history": [
    {
      "version": 1,
      "changed_by": "agent_id | user",
      "changed_at": "timestamp",
      "description": "string — 변경 내용 요약",
      "prev_value": "string | object | null"
    }
  ]
}
```

---

## Phase별 확장 스키마 참조

| Phase | 확장 스키마 위치 |
|-------|----------------|
| Phase 1 | [phase-1-planning.md — 섹션 4](../phase-1-planning.md) |
| Phase 2 | [phase-2-worldbuilding.md — 섹션 4](../phase-2-worldbuilding.md) |
| Phase 3 | [phase-3-roadmap.md — 섹션 4](../phase-3-roadmap.md) |
| Phase 4 | [phase-4-script.md — 섹션 4](../phase-4-script.md) |
| Phase 5 | [phase-5-style-consistency.md — 섹션 4](../phase-5-style-consistency.md) |

---

## JSON 유효성 검사 규칙

- `phase` 필드는 위 4개 값 중 하나여야 함
- `asset_list.characters[].id` 형식: `char_NNN` (3자리 숫자)
- `asset_list.locations[].id` 형식: `loc_NNN`
- `asset_list.props[].id` 형식: `prop_NNN`
- `script_data` 배열 길이: 정확히 30 (Phase 4에서)
- `design_options[].selected` 값: `"A" | "B" | null` 외 허용 안 함
