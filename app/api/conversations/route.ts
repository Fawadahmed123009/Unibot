import { type NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** GET /api/conversations - the signed-in user's conversations, newest first. */
export async function GET() {
  const { session, error } = await requireUser();
  if (error || !session) {
    return error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error: fetchError } = await createAdminClient()
    .from("conversations")
    .select("id, title, created_at")
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false });
  if (fetchError) {
    console.error("conversations list failed", fetchError);
    return NextResponse.json({ error: "Could not load conversations." }, { status: 500 });
  }

  return NextResponse.json({ conversations: data ?? [] });
}

/** DELETE /api/conversations - body { conversationId }; scoped to the owner. */
export async function DELETE(request: NextRequest) {
  const { session, error } = await requireUser();
  if (error || !session) {
    return error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const conversationId: unknown = body?.conversationId;
  if (typeof conversationId !== "string" || conversationId.trim() === "") {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  // Filter on id AND user_id so a foreign id returns the same 404, never a leak.
  // messages cascade on delete (schema.sql on delete cascade).
  const { data: deleted } = await createAdminClient()
    .from("conversations")
    .delete()
    .eq("id", conversationId.trim())
    .eq("user_id", session.userId)
    .select("id")
    .maybeSingle();
  if (!deleted) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, conversationId: deleted.id });
}
