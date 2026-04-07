/**
 * Browser-side Anthropic API helper.
 * Uses the `anthropic-dangerous-direct-browser-access` header to allow
 * direct browser → Anthropic API calls without a proxy server.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// ─── Web search tool definition ───────────────────────────────────────────────

export const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
} as const;

// ─── API key helper ───────────────────────────────────────────────────────────

/**
 * Reads the Anthropic API key from localStorage.
 * Tries `wts_anthropic_key` first, then falls back to `ANTHROPIC_API_KEY`.
 * Always trims whitespace.
 */
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

// ─── Streaming generator ──────────────────────────────────────────────────────

/**
 * Streams a Claude response as an async generator of text chunks.
 *
 * Handles:
 * - `content_block_delta` text deltas → yields the text chunk
 * - `tool_use` blocks (web_search) → yields a human-readable search indicator
 * - `tool_result` blocks → silently skipped (internal plumbing)
 *
 * Throws on non-200 responses (including 401 authentication errors).
 */
export async function* streamClaude(opts: StreamClaudeOptions): AsyncGenerator<string> {
  const {
    apiKey,
    systemPrompt,
    messages,
    maxTokens = 2048,
    tools = [],
    model = "claude-sonnet-4-6",
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
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText}`);
  }

  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  // Track current tool_use block for web search indicator
  let blockType: string | null = null;
  let toolName: string | null = null;
  let toolInputBuf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });

    // Process complete SSE lines
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }

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
        const deltaType = delta?.type as string;

        if (deltaType === "text_delta") {
          yield (delta?.text as string) ?? "";
        } else if (deltaType === "input_json_delta" && blockType === "tool_use") {
          toolInputBuf += (delta?.partial_json as string) ?? "";
        }
      }

      // ── Content block stop ──
      if (type === "content_block_stop") {
        // Emit web search indicator when search tool completes
        if (blockType === "tool_use" && toolName === "web_search" && toolInputBuf) {
          try {
            const input = JSON.parse(toolInputBuf) as { query?: string };
            if (input.query) {
              yield `\n\n🔍 **웹 검색**: "${input.query}"\n\n`;
            }
          } catch {
            // ignore malformed JSON
          }
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
}
