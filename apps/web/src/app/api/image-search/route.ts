/**
 * Server-side image search.
 * Primary  : Google Images HTML scraping ("ou" field = original image URL)
 * Fallback1: DuckDuckGo two-step (vqd token → i.js JSON)
 * Fallback2: Jikan (MyAnimeList) for manga covers
 *
 * All URLs are wrapped in /api/image-proxy so the browser never hits
 * the origin directly (bypasses hotlinking / CORS entirely).
 */

export const runtime = "nodejs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── Google Images ─────────────────────────────────────────────────────────────

async function fetchGoogleImages(query: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch&hl=ko&safe=off`,
      {
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
          "Accept-Encoding": "gzip, deflate",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return [];
    const html = await res.text();

    // Google encodes original image URLs as `"ou":"https://..."` in page JS
    const urls: string[] = [];
    const re = /"ou":"(https?:[^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && urls.length < 8) {
      const decoded = m[1]
        .replace(/\\u003d/gi, "=")
        .replace(/\\u0026/gi, "&")
        .replace(/\\u003c/gi, "<")
        .replace(/\\u003e/gi, ">")
        .replace(/\\\//g, "/");
      if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(decoded)) {
        urls.push(decoded);
      }
    }
    return urls;
  } catch {
    return [];
  }
}

// ── DuckDuckGo ────────────────────────────────────────────────────────────────

async function fetchDDGImages(query: string): Promise<string[]> {
  try {
    const initRes = await fetch(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iar=images&iax=images&ia=images`,
      { headers: { "User-Agent": UA, "Accept": "text/html" }, signal: AbortSignal.timeout(7000) },
    );
    if (!initRes.ok) return [];
    const html = await initRes.text();
    const vqdMatch = html.match(/vqd[=:]['"]([^'"&\s]+)['"]/);
    if (!vqdMatch) return [];

    const params = new URLSearchParams({ q: query, o: "json", vqd: vqdMatch[1], f: ",,,,,", p: "1" });
    const imgRes = await fetch(`https://duckduckgo.com/i.js?${params.toString()}`, {
      headers: { "User-Agent": UA, "Referer": "https://duckduckgo.com/", "Accept": "application/json" },
      signal: AbortSignal.timeout(7000),
    });
    if (!imgRes.ok) return [];
    const data = (await imgRes.json()) as { results?: Array<{ image?: string }> };
    return (data.results ?? []).map((r) => r.image ?? "").filter((u) => u.startsWith("http")).slice(0, 6);
  } catch {
    return [];
  }
}

// ── Jikan (MyAnimeList) ───────────────────────────────────────────────────────

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
      .map((item) =>
        item.images?.webp?.large_image_url ||
        item.images?.jpg?.large_image_url ||
        item.images?.jpg?.image_url || "")
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

  // Try sources in order until we get results
  let urls = await fetchGoogleImages(query);
  if (urls.length === 0) urls = await fetchDDGImages(query);
  if (urls.length === 0) urls = await fetchJikanImages(query);

  // Wrap in image proxy — browser never touches the origin directly
  const proxied = urls
    .slice(0, 4)
    .map((u) => `/api/image-proxy?url=${encodeURIComponent(u)}`);

  return Response.json({ urls: proxied });
}
