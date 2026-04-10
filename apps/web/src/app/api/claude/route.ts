/**
 * Next.js API route — Anthropic API 프록시
 * 브라우저 직접 호출 대신 서버 사이드로 중계해서 CORS/네트워크 문제 해결
 */

export const runtime = "nodejs";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const apiKey = req.headers.get("x-api-key") ?? "";

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API 키가 없습니다." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const upstream = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    // 스트리밍 응답 그대로 중계
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
