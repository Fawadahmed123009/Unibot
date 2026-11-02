import { cookies } from "next/headers";
import { hash } from "bcryptjs";
import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limited = rateLimit(`register:${ip}`);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  // A malformed body must not surface as "Invalid email address" - that
  // misleads users (and testers) about what actually went wrong.
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const email: unknown = body.email;
  const password: unknown = body?.password;
  const fullName: unknown = body?.fullName;
  const studentId: unknown = body?.studentId;

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase();
  const admin = createAdminClient();

  // Never return password_hash: select only what this route needs.
  const { data: existing } = await admin
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const passwordHash = await hash(password, 10);

  // Role is always 'student'; the client can never set it.
  const { data: user, error: insertError } = await admin
    .from("users")
    .insert({
      email: normalizedEmail,
      password_hash: passwordHash,
      full_name: typeof fullName === "string" && fullName.trim() ? fullName.trim() : null,
      student_id: typeof studentId === "string" && studentId.trim() ? studentId.trim() : null,
      role: "student",
    })
    .select("id, email, role")
    .single();

  if (insertError || !user) {
    // Race condition: another register inserted the same email in the meantime.
    if (insertError?.code === "23505") {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not create the account" }, { status: 500 });
  }

  const token = await signSession({
    id: user.id,
    email: user.email,
    role: user.role,
  });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());

  return NextResponse.json({ ok: true });
}
