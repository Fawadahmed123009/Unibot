import { type NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { ingestKnowledgeFile } from "@/lib/ingest";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 2_000_000;

/**
 * requireAdmin() checks the JWT, whose role can be stale for up to 7 days,
 * so the role is re-read from the DB (same rule as app/admin/page.tsx).
 * Returns a Response to send back when access is denied, or null when allowed.
 */
async function denyUnlessAdmin(): Promise<Response | null> {
  const { session, error } = await requireAdmin();
  if (error || !session) {
    return error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: user } = await createAdminClient()
    .from("users")
    .select("role")
    .eq("id", session.userId)
    .maybeSingle();

  if (user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** POST /api/admin/ingest - multipart form, field "file" (.md or .txt). */
export async function POST(request: NextRequest) {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload one file in the 'file' field" }, { status: 400 });
  }
  if (!/\.(md|txt)$/i.test(file.name)) {
    return NextResponse.json({ error: "Only .md and .txt files are accepted" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File too large (max 2 MB)" }, { status: 413 });
  }

  try {
    const result = await ingestKnowledgeFile(await file.text(), file.name);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("ingest: failed", error);
    return NextResponse.json({ error: "Ingestion failed. Check the server logs." }, { status: 500 });
  }
}

/** DELETE /api/admin/ingest - body { documentId }; chunks go via on delete cascade. */
export async function DELETE(request: NextRequest) {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const documentId: unknown = body?.documentId;
  if (typeof documentId !== "string" || documentId.trim() === "") {
    return NextResponse.json({ error: "documentId is required" }, { status: 400 });
  }

  const { data: deleted } = await createAdminClient()
    .from("documents")
    .delete()
    .eq("id", documentId.trim())
    .select("id")
    .maybeSingle();
  if (!deleted) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, documentId: deleted.id });
}