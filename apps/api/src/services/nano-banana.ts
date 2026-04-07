/**
 * Nano Banana API — A/B 대체 이미지 생성
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
    body: JSON.stringify({ prompt, negative_prompt: negativePrompt }),
  });

  if (!response.ok) throw new Error(`Nano Banana API error: ${response.status}`);
  const data = (await response.json()) as { image_id: string };
  return data.image_id;
}
