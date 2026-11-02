import { cookies } from "next/headers";
import { compare } from "bcryptjs";
import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const GENERIC_ERROR = "Invalid email or password";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limited = rateLimit(`login:${ip}`);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const email: unknown = body?.email;
  const password: unknown = body?.password;
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const admin = createAdminClient();
  // Select password_hash for verification, but never send it back in a response.
  const { data: user } = await admin
    .from("users")
    .select("id, email, role, password_hash")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  const valid = user && (await compare(password, user.password_hash));
  if (!user || !valid) {
    // Same error for unknown email and wrong password: no account enumeration.
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const token = await signSession({ id: user.id, email: user.email, role: user.role });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());

  return NextResponse.json({ ok: true });
}
