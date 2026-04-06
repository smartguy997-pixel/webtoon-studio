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

  // TODO: 실제 Whisk API 호출 구현
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

async function getMST(projectId: string): Promise<string> {
  const doc = await collections.styleRegistry(projectId).collection("mst").get();
  if (doc.empty) return getDefaultMST();
  // MST를 태그 문자열로 직렬화
  const mst = doc.docs[0].data();
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
