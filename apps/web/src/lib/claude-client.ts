/**
 * Browser-side Anthropic API helper.
 * Uses the `anthropic-dangerous-direct-browser-access` header to allow
 * direct browser → Anthropic API calls without a proxy server.
 *
 * 429 rate-limit handling: automatic exponential-backoff retry
 * (yields a status line into the stream so the UI can show progress).
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// ─── Web search tool definition ───────────────────────────────────────────────

export const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
} as const;

// ─── API key helper ───────────────────────────────────────────────────────────

export function getAnthropicKey(): string | null {
  if (typeof window === "undefined") return null;
  const raw =
    localStorage.getItem("wts_anthropic_key") ||
    localStorage.getItem("ANTHROPIC_API_KEY") ||
    "";
  return raw.trim() || null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamClaudeOptions {
  apiKey: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  /** Tools to enable. Pass [] to disable all tools. */
  tools?: Array<{ type: string; name: string }>;
  model?: string;
}

// ─── Streaming generator (with 429 auto-retry) ───────────────────────────────

/**
 * Streams a Claude response as an async generator of text chunks.
 *
 * 429 rate-limit: waits [12 s, 25 s, 50 s] then retries (max 3 retries).
 * Yields a human-readable wait message into the stream so the UI stays live.
 *
 * Handles:
 * - `content_block_delta` text deltas → yields the text chunk
 * - `tool_use` blocks (web_search) → yields a human-readable search indicator
 * - `tool_result` blocks → silently skipped (internal plumbing)
 *
 * Throws on non-200 / non-429 responses (including 401 authentication errors).
 */
export async function* streamClaude(opts: StreamClaudeOptions): AsyncGenerator<string> {
  const {
    apiKey,
    systemPrompt,
    messages,
    maxTokens = 2048,
    tools = [],
    model = "claude-haiku-4-5-20251001",
  } = opts;

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
    stream: true,
  };

  if (tools.length > 0) {
    body.tools = tools;
  }

  // 429 backoff schedule (ms): 8 s, 20 s, 40 s  → up to 3 retries
  const BACKOFF = [8_000, 20_000, 40_000] as const;

  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    // ── Wait on retry ──
    if (attempt > 0) {
      const wait = BACKOFF[attempt - 1];
      const secs = Math.round(wait / 1000);
      yield `\n\n⏳ API 요청이 너무 많아요. ${secs}초 후 재시도합니다... (${attempt}/${BACKOFF.length})\n\n`;
      // Countdown yield every 5s so UI doesn't look frozen
      const steps = Math.floor(wait / 5000);
      for (let s = 1; s <= steps; s++) {
        await new Promise<void>((r) => setTimeout(r, 5000));
        const remaining = secs - s * 5;
        if (remaining > 0) yield `⏳ ${remaining}초...\n`;
      }
      const leftover = wait % 5000;
      if (leftover > 0) await new Promise<void>((r) => setTimeout(r, leftover));
    }

    // ── Fetch ──
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 429 && attempt < BACKOFF.length) {
        continue; // will retry
      }
      const errText = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${errText}`);
    }

    if (!res.body) throw new Error("No response body");

    // ── Stream ──
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let blockType: string | null = null;
    let toolName: string | null = null;
    let toolInputBuf = "";

    try {
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break outer;

          let event: Record<string, unknown>;
          try { event = JSON.parse(data) as Record<string, unknown>; }
          catch { continue; }

          const type = event.type as string;

          // ── Content block start ──
          if (type === "content_block_start") {
            const block = event.content_block as Record<string, unknown> | undefined;
            blockType = (block?.type as string) ?? null;
            toolName = blockType === "tool_use" ? (block?.name as string) ?? null : null;
            toolInputBuf = "";
          }

          // ── Content block delta ──
          if (type === "content_block_delta") {
            const delta = event.delta as Record<string, unknown> | undefined;
            const dt = delta?.type as string;
            if (dt === "text_delta") {
              yield (delta?.text as string) ?? "";
            } else if (dt === "input_json_delta" && blockType === "tool_use") {
              toolInputBuf += (delta?.partial_json as string) ?? "";
            }
          }

          // ── Content block stop ──
          if (type === "content_block_stop") {
            if (blockType === "tool_use" && toolName === "web_search" && toolInputBuf) {
              try {
                const input = JSON.parse(toolInputBuf) as { query?: string };
                if (input.query) yield `\n\n🔍 **웹 검색**: "${input.query}"\n\n`;
              } catch { /* ignore */ }
            }
            blockType = null;
            toolName = null;
            toolInputBuf = "";
          }

          // ── Top-level error ──
          if (type === "error") {
            const err = event.error as Record<string, unknown> | undefined;
            throw new Error((err?.message as string) ?? "Anthropic stream error");
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return; // ← success: exit retry loop
  }
}
