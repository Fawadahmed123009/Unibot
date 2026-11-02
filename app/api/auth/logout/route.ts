import { cookies } from "next/headers";

import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export async function POST() {
  // Clearing the httpOnly cookie is the only logout step (JWTs are stateless).
  (await cookies()).set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return Response.json({ ok: true });
}
