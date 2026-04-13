/**
 * Server-side image search proxy.
 * Primary: Google Images HTML scraping ("ou" field = original image URL)
 * Fallback: Jikan (MyAnimeList) for manga covers
 */

export const runtime = "nodejs";

// ── Google Images scraper ─────────────────────────────────────────────────────

async function fetchGoogleImages(query: string): Promise<string[]> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch&hl=ko&safe=off`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Google encodes original image URLs as `"ou":"https://..."` in the page JS
    const urls: string[] = [];
    const re = /"ou":"(https?:[^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && urls.length < 6) {
      // Decode unicode escapes (\u003d → =, \u0026 → &)
      const decoded = m[1]
        .replace(/\\u003d/gi, "=")
        .replace(/\\u0026/gi, "&")
        .replace(/\\u003c/gi, "<")
        .replace(/\\u003e/gi, ">")
        .replace(/\\\//g, "/");
      // Only accept direct image URLs
      if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(decoded)) {
        urls.push(decoded);
      }
    }
    return urls;
  } catch {
    return [];
  }
}

// ── Jikan (MyAnimeList) fallback ──────────────────────────────────────────────

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
      .map(item =>
        item.images?.webp?.large_image_url ||
        item.images?.jpg?.large_image_url ||
        item.images?.jpg?.image_url || ""
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

  // Try Google Images first
  let urls = await fetchGoogleImages(query);

  // Fallback to Jikan if Google returns nothing
  if (urls.length === 0) {
    urls = await fetchJikanImages(query);
  }

  return Response.json({ urls: urls.slice(0, 4) });
}
