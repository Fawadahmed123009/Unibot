// Groq chat-completions via plain fetch (OpenAI-compatible, no SDK).
// Server-side use only; no 'server-only' import because scripts import this.

import { GROQ_FALLBACK_MODEL, GROQ_MODEL } from "@/lib/config";

export type GroqMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MAX_TOKENS = 700;
const TEMPERATURE = 0.1;

/**
 * Streams answer tokens for the given messages. On 429/5xx BEFORE any token
 * has been yielded, retries once with the fallback model; then throws.
 */
export async function* streamGroq(messages: GroqMessage[]): AsyncGenerator<string> {
  let yielded = false;
  let usedFallback = false;

  for (;;) {
    const model = usedFallback ? GROQ_FALLBACK_MODEL : GROQ_MODEL;
    let response: Response;
    try {
      response = await groqRequest(model, messages);
    } catch (error) {
      // Network-level failure before any token: allow exactly one fallback try.
      if (!yielded && !usedFallback) {
        usedFallback = true;
        continue;
      }
      throw error;
    }

    if (!response.ok || !response.body) {
      const retryable = response.status === 429 || response.status >= 500;
      if (!yielded && retryable && !usedFallback) {
        usedFallback = true;
        continue;
      }
      throw new Error(`groq request failed with status ${response.status}`);
    }

    // Parse the SSE stream line by line; "data: [DONE]" ends it.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          const delta = parseSseLine(line);
          if (delta === "done") {
            return;
          }
          if (delta) {
            yielded = true;
            yield delta;
          }
        }
      }
      // Flush a trailing line that had no newline.
      const final = parseSseLine(buffer.trim());
      if (final && final !== "done") {
        yield final;
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
}

/**
 * Non-streaming completion for short utility calls (e.g. query translation in
 * lib/rag.ts). Uses the primary model only; throws on any failure so the caller
 * can fall back. Not used for the streamed student answer.
 */
export async function completeGroq(
  messages: GroqMessage[],
  maxTokens = 64,
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY");

  const response = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
      stream: false,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`groq completion failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("groq completion returned no content");
  }
  return content;
}

async function groqRequest(model: string, messages: GroqMessage[]): Promise<Response> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY");
  return fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature: TEMPERATURE, max_tokens: MAX_TOKENS, stream: true }),
    cache: "no-store",
  });
}

/** Returns the delta text, "done" for the terminal event, or null for ignore. */
function parseSseLine(line: string): string | "done" | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (payload === "[DONE]") return "done";
  try {
    const parsed = JSON.parse(payload) as {
      choices?: { delta?: { content?: unknown } }[];
    };
    const content = parsed.choices?.[0]?.delta?.content;
    return typeof content === "string" && content.length > 0 ? content : null;
  } catch {
    return null; // keep-alive or malformed line
  }
}
