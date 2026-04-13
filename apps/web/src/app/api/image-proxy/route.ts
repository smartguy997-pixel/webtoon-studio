/**
 * Image proxy — fetches a remote image server-side and streams it to the browser.
 * Solves hotlinking / CORS restrictions on third-party image hosts.
 */

export const runtime = "nodejs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const targetUrl = (searchParams.get("url") ?? "").trim();

  if (!targetUrl.startsWith("http")) {
    return new Response("Invalid URL", { status: 400 });
  }

  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": UA,
        "Accept": "image/*,*/*;q=0.8",
        // No Referer header — bypasses most hotlink protection
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return new Response("Upstream error", { status: res.status });
    }

    const contentType = res.headers.get("Content-Type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return new Response("Not an image", { status: 415 });
    }

    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("Fetch failed", { status: 502 });
  }
}
