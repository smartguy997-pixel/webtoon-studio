/**
 * Browser-side Anthropic API client (SSE streaming via fetch)
 * API key is read from localStorage.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

/** Web search server-side tool (Anthropic-hosted, no beta header required) */
export const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
} as const;

export type AnthropicTool = typeof WEB_SEARCH_TOOL;

/** Returns the stored API key (trimmed) or null. */
export function getAnthropicKey(): string | null {
  if (typeof window === "undefined") return null;
  const raw =
    localStorage.getItem("wts_anthropic_key") ||
    localStorage.getItem("ANTHROPIC_API_KEY") ||
    "";
  const key = raw.trim();
  return key || null;
}

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Calls the Anthropic Messages API with streaming enabled.
 * Yields text chunks as they arrive.
 *
 * When web_search tool is included, the generator also yields
 * human-readable search indicators like:
 *   "\n\n🔍 웹 검색: \"query\"\n\n"
 */
export async function* streamClaude({
  apiKey,
  systemPrompt,
  messages,
  maxTokens = 2048,
  tools = [],
}: {
  apiKey: string;
  systemPrompt: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  tools?: AnthropicTool[];
}): AsyncGenerator<string, void, unknown> {
  const body: Record<string, unknown> = {
    model: MODEL,
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
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  // Block-level state for tool-use tracking
  let blockType = "";   // "text" | "tool_use" | "server_tool_use" | "tool_result" | "web_search_tool_result" | ...
  let toolName = "";
  let toolInputBuf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;

        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue; // ignore malformed lines
        }

        if (evt.type === "content_block_start") {
          const cb = (evt.content_block ?? {}) as Record<string, string>;
          blockType = cb.type ?? "";
          toolName = cb.name ?? "";
          toolInputBuf = "";

        } else if (evt.type === "content_block_delta") {
          const delta = (evt.delta ?? {}) as Record<string, string>;

          if (blockType === "text" && delta.type === "text_delta" && delta.text) {
            // Regular response text — yield directly
            yield delta.text;

          } else if (
            (blockType === "tool_use" || blockType === "server_tool_use") &&
            delta.type === "input_json_delta" &&
            delta.partial_json
          ) {
            // Accumulate tool input JSON to extract search query at block stop
            toolInputBuf += delta.partial_json;
          }
          // tool_result / web_search_tool_result deltas → skip (raw search data)

        } else if (evt.type === "content_block_stop") {
          const isSearch =
            (blockType === "tool_use" || blockType === "server_tool_use") &&
            toolName === "web_search";

          if (isSearch) {
            // Parse the search query and emit a readable indicator
            let query = "";
            try {
              const input = JSON.parse(toolInputBuf) as Record<string, string>;
              query = input.query ?? input.q ?? "";
            } catch {
              query = toolInputBuf.slice(0, 120);
            }
            const label = query ? `"${query}"` : "…";
            yield `\n\n🔍 **웹 검색**: ${label}\n\n`;
          }

          // Reset block state
          blockType = "";
          toolName = "";
          toolInputBuf = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
