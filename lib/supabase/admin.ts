import WebSocket from "ws";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

// supabase-js v2 builds a Realtime client eagerly, which needs a global
// WebSocket. Node 20 has none (native WebSocket arrives in Node 22), so provide
// it once here; API routes and scripts both import this module. No-op when the
// runtime already has a native WebSocket.
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as { WebSocket: unknown }).WebSocket = WebSocket;
}

/**
 * SERVER ONLY - never import this file from client code.
 *
 * It uses the service role key, which bypasses RLS entirely and must stay out
 * of the browser bundle. Only API routes and server utilities may call it.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
