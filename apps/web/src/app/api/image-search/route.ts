/**
 * Server-side image search — DuckDuckGo two-step (vqd token → JSON results)
 * Fallback: Jikan (MyAnimeList) for manga covers
 */

export const runtime = "nodejs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── DuckDuckGo image search ───────────────────────────────────────────────────

async function fetchDDGImages(query: string): Promise<string[]> {
  try {
    // Step 1: load the search page to obtain the vqd token
    const initRes = await fetch(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iar=images&iax=images&ia=images`,
      {
        headers: { "User-Agent": UA, "Accept": "text/html" },
        signal: AbortSignal.timeout(7000),
      },
    );
    if (!initRes.ok) return [];
    const html = await initRes.text();

    // vqd appears as  vqd='4-abc...'  or  vqd="4-abc..."
    const vqdMatch = html.match(/vqd[=:]['"]([^'"&\s]+)['"]/);
    if (!vqdMatch) return [];
    const vqd = vqdMatch[1];

    // Step 2: fetch JSON image results
    const params = new URLSearchParams({ q: query, o: "json", vqd, f: ",,,,,", p: "1" });
    const imgRes = await fetch(`https://duckduckgo.com/i.js?${params.toString()}`, {
      headers: {
        "User-Agent": UA,
        "Referer": "https://duckduckgo.com/",
        "Accept": "application/json, */*",
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!imgRes.ok) return [];

    const data = (await imgRes.json()) as { results?: Array<{ image?: string }> };
    return (data.results ?? [])
      .map((r) => r.image ?? "")
      .filter((u) => u.startsWith("http"))
      .slice(0, 6);
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

  let urls = await fetchDDGImages(query);
  if (urls.length === 0) urls = await fetchJikanImages(query);

  // Return proxied URLs so hotlinking / CORS never blocks the browser
  const proxied = urls
    .slice(0, 4)
    .map((u) => `/api/image-proxy?url=${encodeURIComponent(u)}`);

  return Response.json({ urls: proxied });
}
