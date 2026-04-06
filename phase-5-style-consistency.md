# Phase 5 — 화풍 유지 시스템

> 마스터 문서: [README.md](./README.md)  
> 연동 단계: [Phase 2](./phase-2-worldbuilding.md) · [Phase 4](./phase-4-script.md) (전 단계 병행)  
> 공통 스키마: [shared/schema.md](./shared/schema.md)  
> Firestore 모델: [shared/firestore.md](./shared/firestore.md)

---

## 개요

| 항목 | 내용 |
|------|------|
| Phase | 5 (전 단계 병행 실행) |
| 목표 | 전체 화풍·캐릭터·배경의 시각적 일관성 보장 |
| 담당 에이전트 | 캐릭터 디자이너, 총괄 프로듀서 |
| 활성화 시점 | Phase 2 A/B 선택 완료 즉시 초기화, Phase 4 컷 생성마다 실행 |
| 산출물 | MST, 캐릭터 시트, 배경 시트, SCC 검증 로그 |

> **Phase 5는 독립 실행 단계가 아니다.**  
> Phase 2에서 초기화되어 Phase 4 전체 기간 동안 백그라운드로 동작한다.

---

## 1. 3레이어 화풍 고정 아키텍처

```
┌────────────────────────────────────────────────────┐
│  L1 — 스타일 앵커 (MST)                            │
│  · 작품 전체 화풍 마스터 프롬프트                   │
│  · 모든 이미지 생성 요청에 자동 prepend            │
│  · 사용자 직접 수정 불가 (총괄 프로듀서 경유)       │
└───────────────────┬────────────────────────────────┘
                    │ 포함
┌───────────────────▼────────────────────────────────┐
│  L2 — 에셋 시트 (캐릭터 시트 + 배경 시트)          │
│  · 캐릭터별: 얼굴·체형·표정·3뷰 레퍼런스           │
│  · 배경별: 기준 이미지 + 시간대×날씨 매트릭스      │
│  · Phase 2 승인 즉시 생성, 이후 잠금               │
└───────────────────┬────────────────────────────────┘
                    │ 검증
┌───────────────────▼────────────────────────────────┐
│  L3 — Style Consistency Checker (SCC)              │
│  · 생성 이미지 → CLIP Score + ORB Match 검사       │
│  · 기준 미달 시 자동 재생성 (최대 3회)             │
│  · 결과 Firestore validation_log 기록              │
└────────────────────────────────────────────────────┘
```

---

## 2. L1 — 마스터 스타일 토큰 (MST)

### 2.1 MST 구성 필드

| 필드 | 역할 | 웹툰 기본값 |
|------|------|------------|
| `art_style` | 화풍 장르 고정 | `Korean webtoon line art` |
| `line_weight` | 선 두께·질감 | `clean bold outlines, 3px stroke` |
| `color_palette` | 채색 방식 | `flat color, cel-shading, vivid` |
| `rendering` | 렌더링 방식 | `no texture, digital illustration` |
| `perspective` | 원근감 기준 | `slight 2.5D, manga panel ratio` |
| `negative_prompt` | 화풍 이탈 차단 | `realistic, 3D render, photo, watercolor, pencil sketch` |

### 2.2 MST JSON 스키마

```json
{
  "mst": {
    "version": 1,
    "art_style": "Korean webtoon line art",
    "line_weight": "clean bold outlines, 3px stroke",
    "color_palette": "flat color, cel-shading, vivid saturation",
    "rendering": "no texture, digital illustration, clean edges",
    "perspective": "slight 2.5D, manga panel composition",
    "negative_prompt": "realistic, 3D render, photo, watercolor, pencil sketch, noise, grain",
    "locked": true,
    "last_modified_by": "string",
    "last_modified_at": "timestamp"
  }
}
```

### 2.3 MST 자동 주입 규칙

모든 이미지 프롬프트는 아래 순서로 조합된다.

```
[MST 블록] + [장 오버레이 (해당 시)] + [에셋별 태그] + [컷별 고유 태그]
```

- MST 블록은 `locked: true` 상태에서 API 래퍼가 자동 삽입
- 사용자 또는 에이전트가 직접 MST를 덮어쓸 수 없음
- MST 변경 시 `revision_history` 기록 + 전체 에셋 재검증 알림

---

## 3. L2 — 에셋 시트

### 3.1 캐릭터 시트

Phase 2에서 A/B 선택 완료 직후 캐릭터 디자이너 에이전트가 자동 생성한다.

```json
{
  "character_sheet": {
    "char_id": "char_001",
    "ref_image_id": "firestore://approved_assets/characters/char_001/ref_base",
    "facial_tags": [
      "oval face", "double eyelid", "sharp almond eyes",
      "small nose", "thin lips", "high cheekbones",
      "fair skin", "no freckles"
    ],
    "body_tags": [
      "slim athletic build", "165cm", "long legs",
      "dark navy trench coat", "black turtleneck",
      "silver earrings", "no visible tattoos"
    ],
    "pose_anchors": {
      "front": "firestore://...char_001/pose_front",
      "side": "firestore://...char_001/pose_side",
      "back": "firestore://...char_001/pose_back"
    },
    "expression_set": {
      "happy": "firestore://...char_001/expr_happy",
      "angry": "firestore://...char_001/expr_angry",
      "sad": "firestore://...char_001/expr_sad",
      "surprised": "firestore://...char_001/expr_surprised",
      "neutral": "firestore://...char_001/expr_neutral",
      "tense": "firestore://...char_001/expr_tense"
    },
    "forbidden_tags": [
      "blonde hair", "blue eyes", "heavy makeup",
      "muscular build", "tattoos"
    ],
    "locked": true,
    "created_at": "timestamp"
  }
}
```

### 3.2 배경 시트

```json
{
  "background_sheet": {
    "loc_id": "loc_001",
    "base_ref_id": "firestore://approved_assets/locations/loc_001/ref_base",
    "structure_tags": [
      "modern Seoul alley", "brick walls", "neon signs",
      "narrow 3m width", "overhead cables",
      "low camera angle", "vanishing point center"
    ],
    "mood_variants": {
      "day_clear":   "firestore://...loc_001/day_clear",
      "day_cloudy":  "firestore://...loc_001/day_cloudy",
      "evening":     "firestore://...loc_001/evening",
      "night":       "firestore://...loc_001/night",
      "rain":        "firestore://...loc_001/rain",
      "snow":        "firestore://...loc_001/snow"
    },
    "color_grade": {
      "temperature": "cool",
      "saturation_range": [0.6, 0.85],
      "hue_bias": "blue-gray"
    },
    "forbidden_elements": [
      "trees", "suburban houses", "mountains"
    ],
    "locked": true,
    "created_at": "timestamp"
  }
}
```

### 3.3 장(Chapter) 스타일 오버레이

| 타입 | 오버레이 태그 | 적용 화 |
|------|-------------|---------|
| `default` | (없음, MST 기본) | 일반 에피소드 |
| `flashback` | `desaturated, sepia tint, soft vignette, film grain` | 과거 회상 |
| `dream` | `pastel overlay, blurred border, dreamy glow, soft edges` | 꿈·환상 |
| `climax` | `high contrast, dynamic speed lines, saturated shadows` | 클라이맥스·보스전 |
| `epilogue` | `warm tone, soft light, reduced outline weight, peaceful` | 에필로그 |

Phase 4 대본의 `chapter_style` 필드가 오버레이 타입을 결정한다.

---

## 4. L3 — Style Consistency Checker (SCC)

### 4.1 3단계 검증 파이프라인

```
이미지 생성 완료
      │
      ▼
[1차] MST 화풍 일치도
  · 기준: CLIP Score ≥ 0.82
  · 참조: MST 블록 텍스트 vs 생성 이미지
  · 실패 → 자동 재생성 (프롬프트 강화)
      │
      ▼
[2차] 캐릭터 유사도
  · 기준: CLIP Score ≥ 0.85
  · 참조: 캐릭터 시트 ref_image_id vs 생성 이미지
  · 실패 → 캐릭터 디자이너 에이전트 플래그
      │
      ▼
[3차] 배경 구조 일치도
  · 기준: ORB Feature Match ≥ 70%
  · 참조: 배경 시트 base_ref_id vs 생성 이미지
  · 실패 → 배경 시트 업데이트 요청
      │
      ▼
전체 통과 → Firestore scripts 저장
```

### 4.2 재생성 프롬프트 강화 전략

| 실패 항목 | 강화 방법 |
|----------|----------|
| 화풍 이탈 | negative_prompt 강화 + art_style 태그 반복 삽입 |
| 캐릭터 불일치 | img2img strength 0.7→0.5 조정, ref_image 가중치 상승 |
| 배경 구조 불일치 | ControlNet Depth/Canny 모드로 전환 |

### 4.3 SCC 검증 로그 스키마

```json
{
  "validation_log": {
    "project_id": "string",
    "episode": 1,
    "cut": 1,
    "attempts": [
      {
        "attempt": 1,
        "mst_clip_score": 0.87,
        "char_clip_score": 0.91,
        "bg_orb_match": 0.78,
        "overall": "pass",
        "image_id": "string",
        "timestamp": "timestamp"
      }
    ],
    "final_status": "pass | flagged",
    "flagged_reason": "string | null"
  }
}
```

---

## 5. MST 변경 프로세스

MST는 잠금 상태이나, 작가가 화풍 방향을 변경하고자 할 때 아래 프로세스를 따른다.

```
사용자: "화풍을 더 어둡게 바꾸고 싶어"
        │
        ▼
총괄 프로듀서: 변경 범위 확인
  · 일부 컷만 변경 → 장 오버레이 사용 (MST 유지)
  · 전체 화풍 변경 → MST 업데이트 프로세스 진행
        │
        ▼
MST 변경 시:
  1. 현재 MST를 revision_history에 보존
  2. 새 MST 적용 (version +1)
  3. 기존 승인 에셋 전체에 재검증 알림
  4. 이미 생성된 컷은 유지 (소급 적용 없음)
  5. 이후 생성 컷부터 새 MST 적용
```

---

## 6. Firestore 저장 구조

```
style_registry/{project_id}/
  ├── mst                    { version, art_style, line_weight, ... locked: true }
  ├── chapter_overlays/
  │   ├── flashback          { tags: [...] }
  │   └── climax             { tags: [...] }
  ├── character_sheets/
  │   ├── char_001           { facial_tags, body_tags, pose_anchors, expression_set }
  │   └── char_002           { ... }
  ├── background_sheets/
  │   ├── loc_001            { structure_tags, mood_variants, color_grade }
  │   └── loc_002            { ... }
  └── validation_log/
      ├── ep_001_cut_01      { attempts, final_status }
      └── ep_001_cut_02      { ... }
```

> 전체 Firestore 스키마: [shared/firestore.md](./shared/firestore.md)

---

## 7. 개발 체크리스트

### Backend — MST 시스템
- [ ] MST JSON 스키마 정의 및 Firestore `style_registry` 초기화
- [ ] MST 자동 주입 API 래퍼 구현 (모든 이미지 생성 요청에 prepend)
- [ ] 장 오버레이 매핑 로직 (`chapter_style` → overlay tags)
- [ ] MST 변경 프로세스 구현 (버전 관리 + 재검증 알림)

### Backend — 에셋 시트
- [ ] 캐릭터 시트 자동 생성 로직 (Phase 2 A/B 선택 트리거)
- [ ] 배경 시트 자동 생성 로직
- [ ] 시트 잠금(`locked: true`) 및 수정 권한 제어
- [ ] `mood_variants` 6종 자동 생성 (기준 이미지 → 변형)

### Backend — SCC
- [ ] CLIP Score 계산 연동 (Replicate API / CLIP ViT-L/14)
- [ ] ORB Feature Match 계산 (Python OpenCV 서버)
- [ ] 3단계 검증 파이프라인 순차 실행 로직
- [ ] 재생성 프롬프트 강화 전략 구현 (실패 유형별 분기)
- [ ] 검증 로그 Firestore 저장

### Frontend
- [ ] SCC 검증 진행 상태 UI (1차·2차·3차 단계 표시)
- [ ] 화풍 일탈 경보 알림 (FCM Push 또는 인앱 배지)
- [ ] MST 정보 뷰어 (읽기 전용, 변경 요청 버튼 포함)
- [ ] 에셋 시트 뷰어 (캐릭터·배경별 레퍼런스 이미지 + 태그 목록)
- [ ] 검증 로그 대시보드 (화·컷별 점수 히스토리)

### 연동
- [ ] Whisk API img2img 모드 연동 (ref_image_id 전달)
- [ ] ControlNet Depth/Canny 모드 폴백 연동
- [ ] Phase 2 → Phase 5 에셋 시트 생성 트리거
- [ ] Phase 4 → Phase 5 SCC 실행 훅

---

## 관련 문서

- [Phase 2 — 세계관 및 에셋 설계](./phase-2-worldbuilding.md) — A/B 선택 → 에셋 시트 생성 트리거
- [Phase 4 — 30컷 제작 대본](./phase-4-script.md) — 컷 생성 → SCC 실행 훅
- [shared/firestore.md](./shared/firestore.md) — 전체 Firestore 데이터 모델
