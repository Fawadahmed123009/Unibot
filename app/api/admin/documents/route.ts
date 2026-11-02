import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/admin/documents - every ingested document (id, name, category,
 * uploaded_at) so the admin UI can show and delete them.
 *
 * requireAdmin() checks the JWT, whose role can be stale for up to 7 days, so
 * the role is re-read from the DB (same rule as /api/admin/ingest and
 * app/admin/page.tsx). Service-role client + RLS-with-no-policies means only
 * this route can read.
 */
export async function GET() {
  const { session, error } = await requireAdmin();
  if (error || !session) {
    return error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: user } = await admin
    .from("users")
    .select("role")
    .eq("id", session.userId)
    .maybeSingle();
  if (user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error: listError } = await admin
    .from("documents")
    .select("id, document_name, category, uploaded_at")
    .order("uploaded_at", { ascending: false });
  if (listError) {
    console.error("admin documents list failed", listError);
    return NextResponse.json({ error: "Could not load documents." }, { status: 500 });
  }

  return NextResponse.json({ documents: data ?? [] });
}
