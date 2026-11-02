import { type NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import {
  HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  REFUSAL,
  SIMILARITY_THRESHOLD,
} from "@/lib/config";
import { streamGroq } from "@/lib/groq";
import { buildMessages, extractCitations, isRefusal, retrieve, toEnglishForRetrieval } from "@/lib/rag";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const REFUSAL_TEXT = `${REFUSAL} Please contact the Computer Engineering department office to confirm.`;
const GENERIC_ERROR = "Something went wrong. Please try again.";

export async function POST(request: NextRequest) {
  const { session, error } = await requireUser();
  if (error || !session) {
    return error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.userId; // from the JWT only, never from the body

  const body = await request.json().catch(() => null);
  const rawMessage: unknown = body?.message;
  const conversationId: unknown = body?.conversationId;
  if (typeof rawMessage !== "string" || rawMessage.trim() === "") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  const message = rawMessage.trim();
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `message too long (max ${MAX_MESSAGE_CHARS} characters)` },
      { status: 400 },
    );
  }
  if (conversationId !== undefined && typeof conversationId !== "string") {
    return NextResponse.json({ error: "conversationId must be a string" }, { status: 400 });
  }

  const limited = rateLimit(`chat:${userId}`, 20, 60 * 1000); // 20 requests / minute
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many messages. Try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const admin = createAdminClient();

  // Resolve the conversation: an existing one must belong to this user
  // (id AND user_id filter; same 404 either way so other users' ids aren't revealed).
  let conversation: { id: string; title: string | null } | null = null;
  if (typeof conversationId === "string" && conversationId.trim() !== "") {
    const { data } = await admin
      .from("conversations")
      .select("id, title")
      .eq("id", conversationId.trim())
      .eq("user_id", userId)
      .maybeSingle();
    conversation = data;
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
  } else {
    const { data } = await admin
      .from("conversations")
      .insert({ user_id: userId, title: "New chat" })
      .select("id, title")
      .single();
    conversation = data;
    if (!conversation) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
    }
  }
  const chatId = conversation.id;

  // History comes from the DB only; the client never sends past messages.
  const { data: historyRows } = await admin
    .from("messages")
    .select("role, content")
    .eq("conversation_id", chatId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_MESSAGES);
  const history = (historyRows ?? [])
    .reverse()
    .map((row) => ({ role: row.role as "user" | "assistant", content: row.content }));
  const previousUserMessage = [...history].reverse().find((m) => m.role === "user")?.content;

  const { data: userRow, error: insertError } = await admin
    .from("messages")
    .insert({ conversation_id: chatId, role: "user", content: message })
    .select("id")
    .single();
  if (insertError || !userRow) {
    console.error("chat: failed to store user message", insertError);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }

  // First message names the conversation.
  if (conversation.title === "New chat") {
    await admin
      .from("conversations")
      .update({ title: message.slice(0, 60) })
      .eq("id", chatId);
  }

  let retrieval: Awaited<ReturnType<typeof retrieve>>;
  try {
    // Translate the (possibly Urdu / Roman Urdu) query to English for embedding
    // only - the answer still uses the original message below. Best-effort; the
    // helper falls back to the raw text if the translation call fails.
    const englishMessage = await toEnglishForRetrieval(message);
    const englishPrevious = previousUserMessage
      ? await toEnglishForRetrieval(previousUserMessage)
      : undefined;
    retrieval = await retrieve(englishMessage, englishPrevious);
  } catch (err) {
    console.error("chat: retrieve failed", err);
    return streamResponse(chatId, refuseOnlyStream());
  }

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `chat: topSimilarity=${retrieval.topSimilarity.toFixed(4)} passed=${retrieval.chunks.length}/${SIMILARITY_THRESHOLD}`,
    );
  }

  if (retrieval.chunks.length === 0) {
    // Below threshold: Groq is not called; log for the admin later.
    await admin.from("unanswered_questions").insert({ user_id: userId, question: message });
    return streamResponse(chatId, refuseOnlyStream());
  }

  const messages = buildMessages(message, retrieval.chunks, history);

  async function* answerStream(): AsyncGenerator<Record<string, unknown>> {
    let fullText = "";
    try {
      for await (const token of streamGroq(messages)) {
        fullText += token;
        yield { type: "delta", text: token };
      }
    } catch (err) {
      // User message stays; no assistant message is saved on Groq failure.
      console.error("chat: groq stream failed", err);
      yield { type: "error", message: GENERIC_ERROR };
      return;
    }

    // Groq occasionally returns 200 with no content tokens. Persisting an empty
    // assistant row leaves the UI with a blank bubble and no error, so treat it
    // as a failure instead (the client drops the empty placeholder on error).
    if (fullText.trim() === "") {
      console.error("chat: groq returned an empty completion");
      yield { type: "error", message: GENERIC_ERROR };
      return;
    }

    const refused = isRefusal(fullText);
    if (refused) {
      await admin.from("unanswered_questions").insert({ user_id: userId, question: message });
    }
    const sources = refused ? [] : extractCitations(fullText, retrieval.chunks);

    const { data: saved } = await admin
      .from("messages")
      .insert({
        conversation_id: chatId,
        role: "assistant",
        content: fullText,
        sources: refused ? [] : sources,
      })
      .select("id")
      .single();

    yield { type: "done", messageId: saved?.id ?? "", sources, refused };
  }

  return streamResponse(chatId, answerStream());

  function streamResponse(
    conversationIdValue: string,
    events: AsyncGenerator<Record<string, unknown>>,
  ): Response {
    const encoder = new TextEncoder();
    const bodyStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        try {
          send({ type: "start", conversationId: conversationIdValue });
          for await (const event of events) {
            send(event);
          }
        } catch (err) {
          console.error("chat: stream error", err);
          send({ type: "error", message: GENERIC_ERROR });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(bodyStream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
      },
    });
  }

  async function* refuseOnlyStream(): AsyncGenerator<Record<string, unknown>> {
    yield { type: "delta", text: REFUSAL_TEXT };
    const { data: saved } = await admin
      .from("messages")
      .insert({ conversation_id: chatId, role: "assistant", content: REFUSAL_TEXT, sources: [] })
      .select("id")
      .single();
    yield { type: "done", messageId: saved?.id ?? "", sources: [], refused: true };
  }
}
