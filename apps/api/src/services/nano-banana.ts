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

/**
 * 컨셉 이미지 생성 (URL 반환)
 */
export async function generateConceptImageNanoBanana(
  prompt: string,
  negativePrompt?: string,
): Promise<string> {
  const key = process.env.NANO_BANANA_API_KEY;
  if (!key) throw new Error("NANO_BANANA_API_KEY not configured");

  const res = await fetch("https://api.nanobanana.io/v1/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ prompt, negative_prompt: negativePrompt }),
  });
  if (!res.ok) throw new Error(`Nano Banana generate error: ${res.status}`);

  const genData = await res.json() as {
    image_id?: string;
    url?: string;
    image_url?: string;
    data?: string;
  };

  if (genData.url) return genData.url;
  if (genData.image_url) return genData.image_url;
  if (genData.data) return `data:image/png;base64,${genData.data}`;
  if (!genData.image_id) throw new Error("Nano Banana: no image_id or URL returned");

  const imageId = genData.image_id;
  for (let i = 0; i < 30; i++) {
    await new Promise<void>((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`https://api.nanobanana.io/v1/images/${imageId}`, {
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
  throw new Error("Nano Banana image generation timed out");
}
