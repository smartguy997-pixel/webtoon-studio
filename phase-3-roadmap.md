# Phase 3 — 100화 시리즈 로드맵

> 마스터 문서: [README.md](./README.md)  
> 이전 단계: [Phase 2 — 세계관 및 에셋 설계](./phase-2-worldbuilding.md)  
> 공통 스키마: [shared/schema.md](./shared/schema.md)  
> 에이전트 정의: [shared/agents.md](./shared/agents.md)

---

## 개요

| 항목 | 내용 |
|------|------|
| Phase | 3 / 4 |
| 목표 | 전체 100화 서사 구조 설계 + 에피소드별 요약 + 완급 조절 플랜 |
| 담당 에이전트 | 시나리오 작가, 총괄 프로듀서 |
| 선행 조건 | Phase 2 GATING 통과 (ASSET_LIST 확정 + A/B 선택 완료) |
| 다음 단계 | [Phase 4 — 30컷 제작 대본](./phase-4-script.md) |
| 산출물 | 100화 로드맵 JSON + 완급 조절 플랜 |

---

## 1. 에이전트 역할 분담

```
Phase 2 결과 (세계관 + 확정 ASSET_LIST)
        │
        ▼
[시나리오 작가] ──────────────────────────────────────┐
  · 4막 서사 구조 설계                                │
  · 아크(Arc) 분류: 소아크(5화) · 중아크(20화) · 대아크(50화) │
  · 에피소드별 1~2줄 요약 (1화~100화)                 │
  · 훅 화, 감정 피크 화, 반전 화 지정                 │
        │                                            │
        ▼                                            │
[총괄 프로듀서] ◄────────────────────────────────────┘
  · 완급 조절 플랜 검토 (독자 피로도 관리)
  · 플랫폼별 연재 주기 최적화 (주 1회 / 주 2회)
  · 100화 로드맵 JSON 출력 및 Firestore 저장
```

---

## 2. 입력 스펙

```json
{
  "phase": "100화_로드맵",
  "from_phase_2": {
    "world_design": {},
    "asset_list": {
      "characters": [],
      "locations": [],
      "props": []
    }
  },
  "series_config": {
    "total_episodes": 100,
    "episodes_per_week": 1,
    "platform": "naver | kakao | lezhin | other"
  }
}
```

---

## 3. 처리 로직

### 3.1 4막 서사 구조

시나리오 작가는 전체 100화를 아래 4막으로 설계한다.

| 막 | 화수 범위 | 비율 | 핵심 역할 |
|----|-----------|------|----------|
| 1막 — 발단 | 1~15화 | 15% | 세계관 소개, 주인공 일상, 핵심 갈등 씨앗 |
| 2막 — 전개 | 16~55화 | 40% | 갈등 심화, 동료 합류, 빌런 등장, 소아크 완결 |
| 3막 — 위기 | 56~80화 | 25% | 주인공 최대 위기, 세계관 진실 폭로, 독자 이탈 방지 훅 |
| 4막 — 결말 | 81~100화 | 20% | 클라이맥스, 해소, 에필로그 |

### 3.2 아크(Arc) 분류 체계

```
대아크 (50화) ─────────────────────────────────
  └─ 중아크 (20화) ─────────────────────────
        └─ 소아크 (5화) ──────────────────
              └─ 에피소드 (1화)
```

**아크 설계 규칙**

- 소아크는 반드시 **독립적 해소**가 있어야 한다 (읽다가 멈춰도 완결감)
- 중아크 마지막 화는 **중간 클라이맥스** + 다음 아크 훅
- 대아크 전환점에서 세계관 규칙의 **반전 또는 확장**

### 3.3 완급 조절 플랜

시나리오 작가가 지정하는 특수 화 유형:

| 화 유형 | 빈도 | 역할 |
|---------|------|------|
| 훅 화 (Hook) | 매 소아크 마지막 | 다음 화 강제 읽기 유도 |
| 감정 피크 화 | 매 20화 | 독자 감정 최고조 장면 |
| 반전 화 | 매 30화 이상 간격 | 세계관/캐릭터 인식 전환 |
| 팬서비스 화 | 선택 (중아크 후) | 감정 해소 + 캐릭터 관계 강화 |
| 정보 화 | 필요 시 | 복선 회수, 세계관 설명 |

---

## 4. 출력 스키마

```json
{
  "phase": "100화_로드맵",
  "summary": "string — 전체 서사 500자 이내 요약",
  "arc_structure": {
    "act_1": { "range": [1, 15], "theme": "string", "key_events": [] },
    "act_2": { "range": [16, 55], "theme": "string", "key_events": [] },
    "act_3": { "range": [56, 80], "theme": "string", "key_events": [] },
    "act_4": { "range": [81, 100], "theme": "string", "key_events": [] }
  },
  "arcs": [
    {
      "arc_id": "arc_001",
      "arc_type": "small | medium | large",
      "title": "string",
      "episode_range": [1, 5],
      "theme": "string",
      "resolution": "string"
    }
  ],
  "episodes": [
    {
      "ep": 1,
      "title": "string",
      "summary": "string — 1~2줄",
      "arc_id": "arc_001",
      "episode_type": "normal | hook | peak | twist | fanservice | info",
      "featured_characters": ["char_001"],
      "featured_locations": ["loc_001"],
      "cliffhanger": "string | null"
    }
  ],
  "pacing_plan": {
    "hook_episodes": [5, 10, 15],
    "peak_episodes": [20, 40, 60, 80],
    "twist_episodes": [30, 65, 90],
    "estimated_weekly_schedule": "string"
  },
  "agent_notes": {
    "scenario_writer": "string",
    "producer": "string"
  },
  "revision_history": []
}
```

---

## 5. GATING 조건

**두 조건 모두 충족 시 Phase 4 진행**

| 조건 | 내용 |
|------|------|
| 조건 1 | `episodes` 배열에 1화~100화 전체 항목 존재 |
| 조건 2 | 사용자가 로드맵을 확인하고 **"대본 작성 시작"** 클릭 |

**대본 작성 시작 화 선택**

사용자가 GATING 통과 시 Phase 4에서 대본을 작성할 화를 지정한다.  
기본값은 **1화**이나, 특정 화(예: 30화 반전 화)부터 시작하는 것도 가능하다.

---

## 6. Firestore 저장 구조

```
series_roadmap/{project_id}/
  ├── arc_structure    { act_1, act_2, act_3, act_4 }
  ├── arcs/
  │   ├── arc_001     { arc_type, title, range, theme }
  │   └── arc_002     { ... }
  └── episodes/
      ├── ep_001      { title, summary, type, characters, locations, cliffhanger }
      ├── ep_002      { ... }
      └── ep_100      { ... }
```

---

## 7. 개발 체크리스트

### Backend
- [ ] 시나리오 작가 에이전트 시스템 프롬프트 구현 (4막 구조 강제)
- [ ] 아크 분류 자동 태깅 로직
- [ ] 완급 조절 플랜 자동 생성 (훅·피크·반전 화 자동 배치)
- [ ] 100화 분량 출력 토큰 최적화 (배치 처리: 25화씩 4회)
- [ ] 로드맵 JSON 유효성 검사 (1~100화 누락 없음 확인)
- [ ] Firestore `series_roadmap` 저장

### Frontend
- [ ] 100화 타임라인 시각화 UI (막/아크/특수 화 색상 구분)
- [ ] 에피소드 카드 목록 (접기/펼치기 지원)
- [ ] 완급 그래프 (훅·피크·반전 화 인디케이터)
- [ ] 대본 시작 화 선택 UI (GATING)

### 연동
- [ ] Phase 2 `asset_list` → 에피소드별 `featured_characters/locations` 자동 참조
- [ ] Phase 4 시작 시 선택된 화의 에피소드 데이터 자동 로드

---

## 다음 단계

Phase 3 GATING 통과 + 시작 화 선택 시 → **[Phase 4 — 30컷 제작 대본](./phase-4-script.md)**
