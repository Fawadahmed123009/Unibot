import { type NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/conversations/[id] - one conversation the user owns, with its
 * messages (oldest first) so the UI can show past history. Next 15+/16 passes
 * dynamic params as a Promise that must be awaited.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireUser();
  if (error || !session) {
    return error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const admin = createAdminClient();
  const { data: conversation } = await admin
    .from("conversations")
    .select("id, title, created_at")
    .eq("id", id)
    .eq("user_id", session.userId)
    .maybeSingle();
  // Same 404 whether the id is missing or belongs to someone else.
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { data: messages, error: messagesError } = await admin
    .from("messages")
    .select("id, role, content, sources, created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true });
  if (messagesError) {
    console.error("conversation messages failed", messagesError);
    return NextResponse.json({ error: "Could not load messages." }, { status: 500 });
  }

  return NextResponse.json({ conversation, messages: messages ?? [] });
}
