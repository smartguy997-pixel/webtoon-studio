/**
 * Server-side image search proxy.
 * Primary  : Bing Images HTML scraping (murl field = original image URL)
 * Fallback : Jikan (MyAnimeList) manga covers
 */

export const runtime = "nodejs";

// ── Bing Images scraper ───────────────────────────────────────────────────────

async function fetchBingImages(query: string): Promise<string[]> {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1&tsc=ImageBasicHover`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        "Referer": "https://www.bing.com/",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    const urls: string[] = [];

    // Bing stores original URLs as `"murl":"https://..."` in inline JSON
    const re = /"murl":"(https?:[^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && urls.length < 6) {
      const decoded = decodeURIComponent(m[1]);
      if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(decoded)) {
        urls.push(decoded);
      }
    }

    // Second pattern: mediaurl inside href attributes
    if (urls.length === 0) {
      const re2 = /mediaurl=([^&"]+)/g;
      while ((m = re2.exec(html)) !== null && urls.length < 6) {
        try {
          const decoded = decodeURIComponent(m[1]);
          if (decoded.startsWith("http") && /\.(jpe?g|png|webp|gif)/i.test(decoded)) {
            urls.push(decoded);
          }
        } catch { /* ignore */ }
      }
    }

    return urls;
  } catch {
    return [];
  }
}

// ── Jikan (MyAnimeList) fallback — manga covers ───────────────────────────────

interface JikanResponse {
  data: Array<{
    images?: {
      jpg?: { large_image_url?: string; image_url?: string };
      webp?: { large_image_url?: string; image_url?: string };
    };
  }>;
}

async function fetchJikanImages(query: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(query)}&limit=4`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as JikanResponse;
    return (data.data ?? [])
      .map(
        (item) =>
          item.images?.webp?.large_image_url ||
          item.images?.jpg?.large_image_url ||
          item.images?.jpg?.image_url ||
          "",
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").trim();

  if (!query) return Response.json({ urls: [] });

  // Try Bing first (good bot tolerance, broad coverage including K-dramas/movies)
  let urls = await fetchBingImages(query);

  // Fallback to Jikan if Bing returns nothing (e.g. specific manga titles)
  if (urls.length === 0) {
    urls = await fetchJikanImages(query);
  }

  return Response.json({ urls: urls.slice(0, 4) });
}
