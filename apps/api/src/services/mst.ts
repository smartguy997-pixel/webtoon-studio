import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { collections } from "./firestore.js";

// ─── 타입 ─────────────────────────────────────────────────────

export type ChapterStyle = "default" | "flashback" | "dream" | "climax" | "epilogue";

export interface MstRevision {
  version: number;
  snapshot: {
    art_style: string;
    line_weight: string;
    color_palette: string;
    rendering: string;
    perspective: string;
    negative_prompt: string;
  };
  changed_by: string;
  changed_at: Timestamp;
}

export interface MstDocument {
  version: number;
  art_style: string;
  line_weight: string;
  color_palette: string;
  rendering: string;
  perspective: string;
  negative_prompt: string;
  locked: boolean;
  last_modified_by: string;
  last_modified_at: Timestamp;
  revision_history: MstRevision[];
}

// ─── 장 스타일 오버레이 ────────────────────────────────────────

const CHAPTER_OVERLAYS: Record<ChapterStyle, string> = {
  default:   "",
  flashback: "desaturated, sepia tint, soft vignette, film grain",
  dream:     "pastel overlay, blurred border, dreamy glow, soft edges",
  climax:    "high contrast, dynamic speed lines, saturated shadows",
  epilogue:  "warm tone, soft light, reduced outline weight, peaceful",
};

// ─── 기본 MST ─────────────────────────────────────────────────

export const DEFAULT_MST: Omit<MstDocument, "last_modified_at" | "revision_history"> = {
  version: 1,
  art_style: "Korean webtoon line art",
  line_weight: "clean bold outlines, 3px stroke",
  color_palette: "flat color, cel-shading, vivid saturation",
  rendering: "no texture, digital illustration, clean edges",
  perspective: "slight 2.5D, manga panel composition",
  negative_prompt: "realistic, 3D render, photo, watercolor, pencil sketch, noise, grain",
  locked: true,
  last_modified_by: "system",
};

// ─── MST 조회 ─────────────────────────────────────────────────

export async function getMst(projectId: string): Promise<MstDocument> {
  const doc = await collections.styleRegistry(projectId).collection("mst").doc("v1").get();
  if (!doc.exists) {
    throw new Error(`MST가 초기화되지 않았습니다. Phase 2 GATING을 먼저 완료해주세요.`);
  }
  return doc.data() as MstDocument;
}

// ─── MST 텍스트 블록 빌드 ─────────────────────────────────────

export function buildMstText(mst: MstDocument): string {
  return [mst.art_style, mst.line_weight, mst.color_palette, mst.rendering, mst.perspective]
    .filter(Boolean)
    .join(", ");
}

// ─── 장 오버레이 태그 조회 ────────────────────────────────────

export function getChapterOverlay(chapterStyle: ChapterStyle): string {
  return CHAPTER_OVERLAYS[chapterStyle] ?? "";
}

// ─── 4-레이어 풀 프롬프트 조합 ────────────────────────────────

/**
 * 이미지 생성 풀 프롬프트 조합
 *
 * 구성 순서:
 * [L1 MST 블록] + [L2 장 오버레이] + [L2 에셋 태그] + [L3 컷별 고유 태그]
 */
export function buildFullPrompt(
  mst: MstDocument,
  chapterStyle: ChapterStyle,
  assetTags: string,
  cutSpecificTags: string
): { prompt: string; negative_prompt: string } {
  const parts: string[] = [buildMstText(mst)];

  const overlay = getChapterOverlay(chapterStyle);
  if (overlay) parts.push(overlay);
  if (assetTags) parts.push(assetTags);
  if (cutSpecificTags) parts.push(cutSpecificTags);

  return {
    prompt: parts.join(", "),
    negative_prompt: mst.negative_prompt,
  };
}

// ─── MST 화풍 이탈 시 프롬프트 강화 ──────────────────────────

/**
 * MST 검증 실패 시 art_style 태그를 반복 삽입하고 negative_prompt를 강화한다.
 */
export function reinforceMstPrompt(
  mst: MstDocument,
  originalPrompt: string
): { prompt: string; negative_prompt: string } {
  // art_style을 앞뒤로 반복 삽입
  const reinforced = `${mst.art_style}, ${originalPrompt}, ${mst.art_style}, high quality webtoon illustration`;
  const reinforcedNeg =
    `${mst.negative_prompt}, realistic skin texture, photorealistic, ` +
    `oil painting, acrylic, comic book (western), manga (japanese)`;

  return { prompt: reinforced, negative_prompt: reinforcedNeg };
}

// ─── MST 업데이트 (버전 관리) ─────────────────────────────────

export interface MstPatch {
  art_style?: string;
  line_weight?: string;
  color_palette?: string;
  rendering?: string;
  perspective?: string;
  negative_prompt?: string;
}

/**
 * MST를 업데이트한다.
 * - 현재 버전을 revision_history에 보존
 * - version +1 적용
 * - 이후 생성 컷부터 새 MST 적용 (소급 없음)
 */
export async function updateMst(
  projectId: string,
  patch: MstPatch,
  modifiedBy: string
): Promise<MstDocument> {
  const current = await getMst(projectId);

  const revision: MstRevision = {
    version: current.version,
    snapshot: {
      art_style: current.art_style,
      line_weight: current.line_weight,
      color_palette: current.color_palette,
      rendering: current.rendering,
      perspective: current.perspective,
      negative_prompt: current.negative_prompt,
    },
    changed_by: modifiedBy,
    changed_at: Timestamp.now(),
  };

  const updated: Partial<MstDocument> = {
    ...patch,
    version: current.version + 1,
    last_modified_by: modifiedBy,
    last_modified_at: Timestamp.now(),
    revision_history: [...current.revision_history, revision],
  };

  await collections.styleRegistry(projectId).collection("mst").doc("v1").update(updated);

  return { ...current, ...updated } as MstDocument;
}

// ─── 장 오버레이 Firestore 초기화 ────────────────────────────

/**
 * 모든 chapter_style 오버레이를 Firestore에 저장한다.
 * Phase 2 GATING 통과 시 한 번 호출.
 */
export async function initChapterOverlays(projectId: string): Promise<void> {
  const batch = collections.styleRegistry(projectId).firestore.batch();
  const overlayCollection = collections
    .styleRegistry(projectId)
    .collection("chapter_overlays");

  for (const [style, tags] of Object.entries(CHAPTER_OVERLAYS)) {
    if (!tags) continue;
    const ref = overlayCollection.doc(style);
    batch.set(ref, { style, tags, created_at: FieldValue.serverTimestamp() });
  }
  await batch.commit();
}
