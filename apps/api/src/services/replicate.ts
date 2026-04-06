/**
 * Replicate API — CLIP Score 계산 (Style Consistency Checker)
 * 모델: CLIP ViT-L/14
 */
export async function computeClipScore(
  imageUrl: string,
  referenceText: string
): Promise<number> {
  // TODO: 실제 Replicate API 호출 구현
  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${process.env.REPLICATE_API_KEY}`,
    },
    body: JSON.stringify({
      version: "openai/clip-vit-large-patch14",
      input: { image: imageUrl, text: referenceText },
    }),
  });

  if (!response.ok) throw new Error(`Replicate API error: ${response.status}`);
  const data = (await response.json()) as { output: number };
  return data.output;
}

/**
 * ORB Feature Match — 배경 구조 일치도 (Python OpenCV 서버 호출)
 */
export async function computeOrbMatch(
  imageUrl: string,
  referenceImageUrl: string
): Promise<number> {
  // TODO: Python OpenCV 서버 연동 구현
  const response = await fetch(`${process.env.OPENCV_SERVER_URL}/orb-match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageUrl, reference: referenceImageUrl }),
  });

  if (!response.ok) throw new Error(`ORB match error: ${response.status}`);
  const data = (await response.json()) as { match_ratio: number };
  return data.match_ratio;
}
