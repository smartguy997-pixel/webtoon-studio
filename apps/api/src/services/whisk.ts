import { getMst, buildFullPrompt, type ChapterStyle } from "./mst.js";
import { collections } from "./firestore.js";

// ─── 공통 헬퍼 ────────────────────────────────────────────────

function imageIdToUrl(imageId: string): string {
  return `https://cdn.whisk.com/images/${imageId}`;
}

async function whiskPost(body: object): Promise<string> {
  const response = await fetch("https://api.whisk.com/v1/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WHISK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Whisk API error: ${response.status} ${text}`);
  }
  const data = (await response.json()) as { image_id: string };
  return data.image_id;
}

// ─── MST 조회 (캐시 없음 — Firestore가 캐시 역할) ────────────

async function getMstText(projectId: string): Promise<string> {
  try {
    const mst = await getMst(projectId);
    return [mst.art_style, mst.line_weight, mst.color_palette, mst.rendering, mst.perspective]
      .filter(Boolean)
      .join(", ");
  } catch {
    return getDefaultMstText();
  }
}

function getDefaultMstText(): string {
  return [
    "Korean webtoon line art",
    "clean bold outlines, 3px stroke",
    "flat color, cel-shading, vivid saturation",
    "no texture, digital illustration, clean edges",
    "slight 2.5D, manga panel composition",
  ].join(", ");
}

function getDefaultNegativePrompt(): string {
  return "realistic, 3D render, photo, watercolor, pencil sketch, noise, grain";
}

// ─── L1. 기본 이미지 생성 (text-to-image) ────────────────────

/**
 * MST를 자동으로 prepend하여 이미지를 생성한다.
 *
 * prompt: [MST 자동 주입] + assetTags
 */
export async function generateImage(
  projectId: string,
  assetTags: string,
  negativePrompt?: string
): Promise<string> {
  const mstText = await getMstText(projectId);
  const finalPrompt = `${mstText}, ${assetTags}`;
  const finalNeg = negativePrompt ?? getDefaultNegativePrompt();

  return whiskPost({ prompt: finalPrompt, negative_prompt: finalNeg });
}

// ─── L2. 4-레이어 풀 프롬프트 이미지 생성 ────────────────────

/**
 * MST + 장 오버레이 + 에셋 태그 + 컷 고유 태그를 조합하여 생성한다.
 * Phase 4 SCC 파이프라인에서 호출된다.
 */
export async function generateImageFull(
  projectId: string,
  chapterStyle: ChapterStyle,
  assetTags: string,
  cutSpecificTags: string,
  negativePromptOverride?: string
): Promise<string> {
  const mst = await getMst(projectId);
  const { prompt, negative_prompt } = buildFullPrompt(
    mst,
    chapterStyle,
    assetTags,
    cutSpecificTags
  );

  return whiskPost({
    prompt,
    negative_prompt: negativePromptOverride ?? negative_prompt,
  });
}

// ─── L2. img2img 모드 (캐릭터 불일치 재생성) ─────────────────

/**
 * 참조 이미지를 기반으로 img2img 모드로 생성한다.
 * SCC 2차(캐릭터 유사도) 실패 시 strength를 낮추어 재생성.
 *
 * @param refImageId  캐릭터 시트의 ref_image_id
 * @param strength    0.0(완전 복사) ~ 1.0(완전 재생성), 기본 0.5
 */
export async function generateImageImg2Img(
  projectId: string,
  prompt: string,
  negativePrompt: string,
  refImageId: string,
  strength = 0.5
): Promise<string> {
  const refUrl = imageIdToUrl(refImageId);

  return whiskPost({
    mode: "img2img",
    prompt,
    negative_prompt: negativePrompt,
    init_image: refUrl,
    strength,
  });
}

// ─── L2. ControlNet 모드 (배경 구조 불일치 재생성) ───────────

/**
 * ControlNet 모드로 생성한다.
 * SCC 3차(배경 구조) 실패 시 depth 또는 canny 맵을 참조.
 *
 * @param depthRefId  배경 시트의 base_ref_id
 * @param controlMode "depth" | "canny"
 */
export async function generateImageControlNet(
  projectId: string,
  prompt: string,
  negativePrompt: string,
  depthRefId: string,
  controlMode: "depth" | "canny" = "depth"
): Promise<string> {
  const refUrl = imageIdToUrl(depthRefId);

  return whiskPost({
    mode: "controlnet",
    prompt,
    negative_prompt: negativePrompt,
    control_image: refUrl,
    control_mode: controlMode,
    control_weight: 0.8,
  });
}

// ─── Nano Banana A/B 대체 생성 ────────────────────────────────

/**
 * Nano Banana API를 사용하여 A/B 대체 이미지를 생성한다.
 * Phase 2 디자인 옵션 생성 시 사용.
 */
export async function generateImageNanoBanana(
  prompt: string,
  negativePrompt?: string
): Promise<string> {
  const response = await fetch("https://api.nanobanana.io/v1/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NANO_BANANA_API_KEY}`,
    },
    body: JSON.stringify({
      prompt,
      negative_prompt: negativePrompt,
    }),
  });

  if (!response.ok) throw new Error(`Nano Banana API error: ${response.status}`);
  const data = (await response.json()) as { image_id: string };
  return data.image_id;
}
