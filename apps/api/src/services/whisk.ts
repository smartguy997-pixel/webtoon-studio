import { collections } from "./firestore.js";

/**
 * Whisk API 이미지 생성 서비스
 *
 * MST(마스터 스타일 토큰)를 모든 요청에 자동 prepend.
 * 에이전트는 MST를 직접 작성하지 않는다.
 */
export async function generateImage(
  projectId: string,
  assetTags: string,
  negativePrompt?: string
): Promise<string> {
  const mst = await getMST(projectId);
  const finalPrompt = buildPrompt(mst, assetTags);

  const response = await fetch("https://api.whisk.com/v1/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WHISK_API_KEY}`,
    },
    body: JSON.stringify({
      prompt: finalPrompt,
      negative_prompt: negativePrompt,
    }),
  });

  if (!response.ok) throw new Error(`Whisk API error: ${response.status}`);
  const data = (await response.json()) as { image_id: string };
  return data.image_id;
}

/**
 * 컨셉 이미지 생성 (Phase 2 스타일 정의 & 에셋 시각화용)
 * MST 없이 직접 프롬프트로 생성. URL 또는 data URI 반환.
 */
export async function generateConceptImage(
  prompt: string,
  negativePrompt?: string,
): Promise<string> {
  const key = process.env.WHISK_API_KEY;
  if (!key) throw new Error("WHISK_API_KEY not configured");

  const res = await fetch("https://api.whisk.com/v1/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ prompt, negative_prompt: negativePrompt }),
  });
  if (!res.ok) throw new Error(`Whisk generate error: ${res.status}`);

  const genData = await res.json() as {
    image_id?: string;
    url?: string;
    image_url?: string;
    data?: string; // base64
  };

  // URL이 바로 오면 반환
  if (genData.url) return genData.url;
  if (genData.image_url) return genData.image_url;
  if (genData.data) return `data:image/png;base64,${genData.data}`;
  if (!genData.image_id) throw new Error("Whisk: no image_id or URL returned");

  // image_id 방식: 폴링으로 완료 대기 (최대 60초)
  const imageId = genData.image_id;
  for (let i = 0; i < 30; i++) {
    await new Promise<void>((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`https://api.whisk.com/v1/images/${imageId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!pollRes.ok) continue;
    const pollData = await pollRes.json() as {
      status?: string;
      url?: string;
      image_url?: string;
      data?: string;
    };
    if (pollData.url) return pollData.url;
    if (pollData.image_url) return pollData.image_url;
    if (pollData.data) return `data:image/png;base64,${pollData.data}`;
  }
  throw new Error("Whisk image generation timed out");
}

async function getMST(projectId: string): Promise<string> {
  const doc = await collections.styleRegistry(projectId).get();
  if (!doc.exists) return getDefaultMST();
  const data = doc.data();
  const mst = data?.mst as Record<string, string> | undefined;
  if (!mst) return getDefaultMST();
  return [mst.art_style, mst.line_weight, mst.color_palette, mst.rendering, mst.perspective]
    .filter(Boolean)
    .join(", ");
}

function getDefaultMST(): string {
  return "Korean webtoon line art, clean bold outlines, 3px stroke, flat color, cel-shading, vivid saturation, no texture, digital illustration, slight 2.5D, manga panel composition";
}

function buildPrompt(mst: string, assetTags: string): string {
  return `${mst}, ${assetTags}`;
}
