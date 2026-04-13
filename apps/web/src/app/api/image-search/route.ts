/**
 * Server-side image search proxy.
 * Tries multiple free sources (Jikan/MyAnimeList, DuckDuckGo Instant) to find
 * real cover image URLs for manga/webtoon titles — no additional API keys needed.
 */

export const runtime = "nodejs";

interface JikanResponse {
  data: Array<{
    images?: {
      jpg?: { large_image_url?: string; image_url?: string };
      webp?: { large_image_url?: string; image_url?: string };
    };
  }>;
}

interface DdgResponse {
  Image?: string;
  RelatedTopics?: Array<{ Icon?: { URL?: string } }>;
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").trim();

  if (!query) return Response.json({ urls: [] });

  const urls: string[] = [];

  // ── 1) Jikan (MyAnimeList) — manga cover images ───────────────────────────
  try {
    const res = await fetch(
      `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(query)}&limit=4`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const data = (await res.json()) as JikanResponse;
      for (const item of data.data ?? []) {
        const img =
          item.images?.webp?.large_image_url ||
          item.images?.jpg?.large_image_url ||
          item.images?.jpg?.image_url;
        if (img && !urls.includes(img) && urls.length < 4) urls.push(img);
      }
    }
  } catch { /* ignore — try next source */ }

  // ── 2) DuckDuckGo Instant Answers — Wikipedia-sourced hero image ──────────
  if (urls.length < 2) {
    try {
      const res = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) },
      );
      if (res.ok) {
        const data = (await res.json()) as DdgResponse;
        if (data.Image && !urls.includes(data.Image)) urls.push(data.Image);
        for (const topic of data.RelatedTopics ?? []) {
          const img = topic.Icon?.URL;
          if (img && img.length > 5 && !urls.includes(img) && urls.length < 4)
            urls.push(img);
        }
      }
    } catch { /* ignore */ }
  }

  return Response.json({ urls: urls.slice(0, 4) });
}
