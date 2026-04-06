# Phase 4 — 30컷 제작 대본

> 마스터 문서: [README.md](./README.md)  
> 이전 단계: [Phase 3 — 100화 시리즈 로드맵](./phase-3-roadmap.md)  
> 공통 스키마: [shared/schema.md](./shared/schema.md)  
> 에이전트 정의: [shared/agents.md](./shared/agents.md)  
> 화풍 연동: [Phase 5 — 화풍 유지 시스템](./phase-5-style-consistency.md)

---

## 개요

| 항목 | 내용 |
|------|------|
| Phase | 4 / 4 |
| 목표 | 1화 단위 30컷 기술 대본 생성 (이미지 생성 즉시 실행 가능한 JSON) |
| 담당 에이전트 | 대본/연출 작가, 총괄 프로듀서 |
| 선행 조건 | Phase 3 GATING 통과 + 대본 작성 시작 화 선택 |
| 반복 실행 | Phase 4는 화별로 반복 실행 (1화 → 2화 → … → 100화) |
| 산출물 | 30컷 JSON 대본 (컷별 이미지 프롬프트 + 연출 지시 포함) |

---

## 1. 에이전트 역할 분담

```
Phase 3 에피소드 요약 + Phase 2 승인 에셋
        │
        ▼
[대본/연출 작가] ─────────────────────────────────────┐
  · 에피소드 요약 → 30컷 장면 분해                     │
  · 컷별 카메라 앵글 지정                              │
  · 세로 스크롤 웹툰 연출 최적화                       │
  · 컷별 이미지 프롬프트 작성 (MST 자동 주입됨)        │
  · 대사/효과음/지문 작성                              │
        │                                            │
        ▼                                            │
[총괄 프로듀서] ◄────────────────────────────────────┘
  · 30컷 흐름 검토 (서사 연결성, 감정 완급)
  · Phase 5 SCC에 컷 전달 (화풍 검증 트리거)
  · 최종 JSON 대본 Firestore 저장
```

---

## 2. 입력 스펙

```json
{
  "phase": "30컷_대본",
  "target_episode": 1,
  "episode_data": {
    "title": "string",
    "summary": "string",
    "episode_type": "normal | hook | peak | twist",
    "cliffhanger": "string | null",
    "featured_characters": ["char_001"],
    "featured_locations": ["loc_001"]
  },
  "approved_assets": {
    "characters": [],
    "locations": [],
    "mst": "마스터 스타일 토큰 문자열"
  }
}
```

---

## 3. 처리 로직

### 3.1 30컷 구조 설계

대본/연출 작가는 에피소드 요약을 아래 기본 구조로 분해한다.

| 컷 범위 | 역할 | 연출 기조 |
|---------|------|----------|
| 1~5컷 | 오프닝 / 상황 설정 | 넓은 앵글, 배경 중심 |
| 6~12컷 | 전개 A / 1차 갈등 | 캐릭터 클로즈업 교차 |
| 13~18컷 | 중간 전환 | 감정 또는 액션 피크 준비 |
| 19~25컷 | 전개 B / 핵심 장면 | 이 화의 핵심 감정·사건 |
| 26~29컷 | 마무리 / 감정 착지 | 여운 컷, 리액션 컷 |
| 30컷 | 훅 / 클리프행어 | 극단적 클로즈업 또는 와이드샷 반전 |

> `episode_type`이 `hook` 또는 `twist`인 경우 30컷을 강제로 클리프행어로 종료

### 3.2 카메라 앵글 사전

| 앵글 코드 | 이름 | 사용 상황 |
|-----------|------|----------|
| `ELS` | Extreme Long Shot | 배경 전체 소개, 규모 강조 |
| `LS` | Long Shot | 캐릭터 전신 + 배경 |
| `MS` | Medium Shot | 허리 위 캐릭터, 대화 장면 |
| `MCU` | Medium Close Up | 가슴 위, 감정 표현 |
| `CU` | Close Up | 얼굴 클로즈업, 강한 감정 |
| `ECU` | Extreme Close Up | 눈·손 등 신체 부위, 긴장감 |
| `OTS` | Over The Shoulder | 대화 장면 교차 |
| `POV` | Point of View | 주인공 시점 몰입 |
| `BIRD` | Bird's Eye View | 전략·위기 상황 조감 |
| `WORM` | Worm's Eye View | 위압감·공포 연출 |
| `DUTCH` | Dutch Angle | 불안·혼란 상황 |

### 3.3 세로 스크롤 웹툰 연출 규칙

- **컷 비율**: 가로 : 세로 = 1 : 1.2 ~ 1 : 3 (세로 길이는 강조 정도에 따라 조절)
- **감정 강조**: 감정 피크 컷은 세로 2~3배 길이 사용
- **시선 유도**: 독자 시선이 위→아래로 자연스럽게 흐르도록 캐릭터 위치 설계
- **페이지 브레이크**: 모바일 1뷰포트(약 10컷)마다 소결점 배치
- **효과선**: 속도감·충격은 효과선 지시(`speed_lines`, `impact_lines`)로 명시

---

## 4. 출력 스키마 — 30컷 JSON

```json
{
  "phase": "30컷_대본",
  "episode": 1,
  "episode_title": "string",
  "chapter_style": "default | flashback | dream | climax | epilogue",
  "script_data": [
    {
      "cut": 1,
      "angle": "ELS",
      "aspect_ratio": "1:2",
      "scene_description": "string — 장면 상황 설명",
      "characters": [
        {
          "char_id": "char_001",
          "position": "left | center | right | background",
          "expression": "기쁨 | 분노 | 슬픔 | 놀람 | 무표정 | 긴장",
          "pose": "string"
        }
      ],
      "location_id": "loc_001",
      "background_variant": "day_clear | day_cloudy | night | rain | snow",
      "dialogue": [
        {
          "char_id": "char_001",
          "text": "string",
          "balloon_type": "normal | shout | whisper | thought | narration"
        }
      ],
      "sfx": ["string"],
      "effect": "none | speed_lines | impact_lines | glow | blur",
      "image_prompt": {
        "auto_injected_mst": "※ Phase 5에서 자동 주입",
        "cut_specific_tags": "string — 이 컷 고유 태그",
        "negative_prompt": "string"
      },
      "director_note": "string — 연출 의도 메모"
    }
  ],
  "episode_summary_for_next": "string — 다음 화 연속성을 위한 상태 요약",
  "assets_used": {
    "characters": ["char_001"],
    "locations": ["loc_001"],
    "props": ["prop_001"]
  },
  "agent_notes": {
    "script_writer": "string",
    "producer": "string"
  },
  "revision_history": []
}
```

---

## 5. 화풍 유지 자동 연동

Phase 4는 Phase 5와 실시간으로 연동된다.

```
대본/연출 작가가 컷 생성
        │
        ▼
각 컷의 image_prompt 완성
        │
        ▼
Phase 5 MST 자동 주입 → 최종 프롬프트 완성
        │
        ▼
Whisk API 이미지 생성
        │
        ▼
Phase 5 SCC 검증 (CLIP Score + ORB Match)
        │
   ┌────┴────┐
 통과       실패
   │         │
Firestore   자동 재생성 (최대 3회)
   저장          │
            3회 실패 시 플래그
```

> 상세: [Phase 5 — 화풍 유지 시스템](./phase-5-style-consistency.md)

---

## 6. GATING 조건

Phase 4는 화별로 독립적인 GATING을 가진다.

| 조건 | 내용 |
|------|------|
| 조건 1 | `script_data` 배열에 정확히 30개 컷 존재 |
| 조건 2 | 모든 컷의 SCC 검증 통과 (Phase 5 연동) |
| 조건 3 | 사용자가 대본 검토 후 **"다음 화"** 또는 **"완료"** 클릭 |

---

## 7. 반복 실행 프로토콜

Phase 4는 화별 반복 실행 구조를 가진다.

```
[1화 대본 완성 + GATING]
        │
        ▼
[슬라이딩 윈도우 체크]
  10화마다 총괄 프로듀서가
  진행된 화의 요약 압축 + Firestore 저장
        │
        ▼
[2화 대본 시작]
  Phase 3 로드맵의 2화 에피소드 요약 로드
  Phase 2 승인 에셋 로드
  이전 화 episode_summary_for_next 로드
        │
        ▼
    … 반복 …
```

---

## 8. Firestore 저장 구조

```
scripts/{project_id}/
  └── episodes/
      ├── ep_001/
      │   ├── metadata    { title, type, chapter_style }
      │   ├── cuts/
      │   │   ├── cut_01  { angle, description, dialogue, sfx, prompt... }
      │   │   └── cut_30  { ... }
      │   └── summary_for_next  "string"
      └── ep_002/
          └── ...
```

---

## 9. 개발 체크리스트

### Backend
- [ ] 대본/연출 작가 에이전트 시스템 프롬프트 구현 (30컷 구조 강제)
- [ ] `chapter_style` 자동 감지 로직 (에피소드 타입 → 스타일 매핑)
- [ ] 카메라 앵글 코드 사전 검증 (허용 값 외 입력 거부)
- [ ] `episode_summary_for_next` 자동 추출 로직
- [ ] 30컷 JSON 유효성 검사 (컷 수, 필수 필드 누락 확인)
- [ ] Firestore `scripts` 저장 및 화별 버전 관리
- [ ] Phase 5 SCC 연동 훅 구현

### Frontend
- [ ] 30컷 스크롤 뷰어 UI (컷 카드 + 이미지 + 대사)
- [ ] 컷별 이미지 생성 요청 버튼 (Phase 5 연동)
- [ ] SCC 검증 결과 배지 (통과/재생성/플래그)
- [ ] 화별 진행 상태 바 (1/100, 2/100 …)
- [ ] 대본 수동 편집 모드 (컷 설명·대사 직접 수정)

### 연동
- [ ] Phase 3 에피소드 데이터 자동 로드
- [ ] Phase 2 승인 에셋 자동 참조
- [ ] Phase 5 MST 주입 및 SCC 파이프라인 연동

---

## 다음 단계

- 화별 반복 실행으로 최대 **100화 대본** 완성
- 각 화 완성 시 Phase 5 SCC 자동 검증 실행
- 전체 완료 시 Firestore에 프로젝트 `status: completed` 업데이트
