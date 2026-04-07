/**
 * Browser-side Anthropic API client (SSE streaming via fetch)
 * API key is read from localStorage.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

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
 */
export async function* streamClaude({
  apiKey,
  systemPrompt,
  messages,
  maxTokens = 1024,
}: {
  apiKey: string;
  systemPrompt: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
}): AsyncGenerator<string, void, unknown> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

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
        try {
          const evt = JSON.parse(data);
          if (
            evt.type === "content_block_delta" &&
            evt.delta?.type === "text_delta" &&
            evt.delta.text
          ) {
            yield evt.delta.text as string;
          }
        } catch {
          // ignore malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
