import { redirect } from "next/navigation";

import AdminPanel from "@/components/admin-panel";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // The JWT role can be stale (7-day token), so re-check it in the DB.
  // Service-role client + RLS-with-no-policies means only this route can read.
  const admin = createAdminClient();
  const { data: user } = await admin
    .from("users")
    .select("role")
    .eq("id", session.userId)
    .maybeSingle();

  // A silent redirect left the impression that the page had simply failed to
  // load, so say plainly that this area is admin-only. Showing this screen does
  // not grant access: every admin API call re-checks the DB role and returns 403.
  if (user?.role !== "admin") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="card text-center">
          <h1 className="text-lg font-bold text-slate-900">Access denied</h1>
          <p className="mt-2 text-sm text-slate-500">
            The knowledge-document area is only available to administrators.
          </p>
          <a href="/chat" className="btn-primary mt-6 w-full">
            Back to chat
          </a>
        </div>
      </main>
    );
  }

  // Admin confirmed server-side; the panel's API calls re-check role independently.
  return <AdminPanel />;
}
