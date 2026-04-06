# 공유 — Firestore 데이터 모델

> 마스터 문서: [README.md](../README.md)  
> 스키마 정의: [schema.md](./schema.md)

---

## 컬렉션 구조 전체 맵

```
firestore/
│
├── projects/{project_id}                    ← 프로젝트 메타데이터
│
├── project_summary/{project_id}/            ← 슬라이딩 윈도우 요약
│   ├── phase_1
│   ├── phase_2
│   ├── phase_3
│   └── phase_4
│
├── approved_assets/{project_id}/            ← Phase 2 확정 에셋
│   ├── characters/{char_id}
│   ├── locations/{loc_id}
│   └── props/{prop_id}
│
├── style_registry/{project_id}/             ← Phase 5 화풍 시스템
│   ├── mst
│   ├── chapter_overlays/{overlay_type}
│   ├── character_sheets/{char_id}
│   ├── background_sheets/{loc_id}
│   └── validation_log/{ep}_{cut}
│
├── series_roadmap/{project_id}/             ← Phase 3 로드맵
│   ├── arc_structure
│   ├── arcs/{arc_id}
│   └── episodes/{ep_id}
│
└── scripts/{project_id}/                   ← Phase 4 대본
    └── episodes/{ep_id}/
        ├── metadata
        ├── cuts/{cut_id}
        └── summary_for_next
```

---

## 컬렉션별 스키마

### `projects/{project_id}`

```json
{
  "project_id": "string — UUID",
  "title": "string — 작품 가제",
  "owner_uid": "string — Firebase Auth UID",
  "status": "draft | phase_1 | phase_2 | phase_3 | phase_4 | completed",
  "current_phase": 1,
  "genre": "string",
  "created_at": "timestamp",
  "updated_at": "timestamp",
  "platform": "naver | kakao | lezhin | other",
  "total_episodes": 100,
  "completed_episodes": 0
}
```

---

### `project_summary/{project_id}/phase_{N}`

총괄 프로듀서가 슬라이딩 윈도우 10회마다 생성하는 요약.

```json
{
  "summary_version": 1,
  "phase": 1,
  "key_decisions": ["string"],
  "genre": "string",
  "usp": [],
  "feasibility_score": 0.0,
  "approved_asset_ids": {
    "characters": ["char_001"],
    "locations": ["loc_001"],
    "props": []
  },
  "next_phase_ready": true,
  "created_at": "timestamp"
}
```

---

### `approved_assets/{project_id}/characters/{char_id}`

Phase 2 A/B 선택 완료 후 저장되는 확정 캐릭터 에셋.

```json
{
  "id": "char_001",
  "name": "string",
  "role": "protagonist | antagonist | supporting",
  "selected_option": "A | B",
  "final_prompt": "string — 선택된 Whisk 프롬프트",
  "ref_image_id": "string — 생성된 기준 이미지 Storage 경로",
  "appearance": {},
  "ability": "string",
  "arc": "string",
  "locked": true,
  "created_at": "timestamp"
}
```

---

### `approved_assets/{project_id}/locations/{loc_id}`

```json
{
  "id": "loc_001",
  "name": "string",
  "type": "interior | exterior | landmark",
  "selected_option": "A | B",
  "final_prompt": "string",
  "ref_image_id": "string",
  "atmosphere": "string",
  "structure": "string",
  "locked": true,
  "created_at": "timestamp"
}
```

---

### `style_registry/{project_id}/mst`

```json
{
  "version": 1,
  "art_style": "Korean webtoon line art",
  "line_weight": "clean bold outlines, 3px stroke",
  "color_palette": "flat color, cel-shading, vivid saturation",
  "rendering": "no texture, digital illustration, clean edges",
  "perspective": "slight 2.5D, manga panel composition",
  "negative_prompt": "realistic, 3D render, photo, watercolor, pencil sketch, noise, grain",
  "locked": true,
  "last_modified_by": "string — agent_id | user",
  "last_modified_at": "timestamp",
  "revision_history": []
}
```

---

### `style_registry/{project_id}/character_sheets/{char_id}`

```json
{
  "char_id": "char_001",
  "ref_image_id": "string",
  "facial_tags": ["string"],
  "body_tags": ["string"],
  "pose_anchors": {
    "front": "string — Storage 경로",
    "side": "string",
    "back": "string"
  },
  "expression_set": {
    "happy": "string",
    "angry": "string",
    "sad": "string",
    "surprised": "string",
    "neutral": "string",
    "tense": "string"
  },
  "forbidden_tags": ["string"],
  "locked": true,
  "created_at": "timestamp"
}
```

---

### `style_registry/{project_id}/background_sheets/{loc_id}`

```json
{
  "loc_id": "loc_001",
  "base_ref_id": "string",
  "structure_tags": ["string"],
  "mood_variants": {
    "day_clear": "string",
    "day_cloudy": "string",
    "evening": "string",
    "night": "string",
    "rain": "string",
    "snow": "string"
  },
  "color_grade": {
    "temperature": "cool | warm | neutral",
    "saturation_range": [0.0, 1.0],
    "hue_bias": "string"
  },
  "forbidden_elements": ["string"],
  "locked": true,
  "created_at": "timestamp"
}
```

---

### `style_registry/{project_id}/validation_log/{ep}_{cut}`

```json
{
  "project_id": "string",
  "episode": 1,
  "cut": 1,
  "attempts": [
    {
      "attempt": 1,
      "mst_clip_score": 0.0,
      "char_clip_score": 0.0,
      "bg_orb_match": 0.0,
      "overall": "pass | fail",
      "image_id": "string",
      "timestamp": "timestamp"
    }
  ],
  "final_status": "pass | flagged",
  "flagged_reason": "string | null",
  "created_at": "timestamp"
}
```

---

### `series_roadmap/{project_id}/episodes/{ep_id}`

```json
{
  "ep": 1,
  "title": "string",
  "summary": "string",
  "arc_id": "arc_001",
  "episode_type": "normal | hook | peak | twist | fanservice | info",
  "featured_characters": ["char_001"],
  "featured_locations": ["loc_001"],
  "cliffhanger": "string | null",
  "script_status": "not_started | in_progress | completed"
}
```

---

### `scripts/{project_id}/episodes/{ep_id}/cuts/{cut_id}`

```json
{
  "cut": 1,
  "angle": "string",
  "aspect_ratio": "string",
  "scene_description": "string",
  "characters": [],
  "location_id": "string",
  "background_variant": "string",
  "dialogue": [],
  "sfx": [],
  "effect": "string",
  "image_prompt": {
    "final_prompt": "string — MST 주입 완료된 최종 프롬프트",
    "cut_specific_tags": "string",
    "negative_prompt": "string"
  },
  "generated_image_id": "string | null",
  "scc_status": "pending | pass | flagged",
  "director_note": "string"
}
```

---

## 보안 규칙 요약

```javascript
// Firestore Security Rules (개요)
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // 프로젝트: 소유자만 읽기/쓰기
    match /projects/{projectId} {
      allow read, write: if request.auth.uid == resource.data.owner_uid;
    }

    // 에셋 시트: 소유자만 읽기, locked=true이면 쓰기 불가
    match /style_registry/{projectId}/{document=**} {
      allow read: if isOwner(projectId);
      allow write: if isOwner(projectId) && !resource.data.locked;
    }

    function isOwner(projectId) {
      return request.auth.uid ==
        get(/databases/$(database)/documents/projects/$(projectId)).data.owner_uid;
    }
  }
}
```

---

## 관련 문서

- [README.md](../README.md) — 마스터 문서
- [Phase 2 — 에셋 설계](../phase-2-worldbuilding.md) — approved_assets 저장 트리거
- [Phase 5 — 화풍 시스템](../phase-5-style-consistency.md) — style_registry 전체 관리
