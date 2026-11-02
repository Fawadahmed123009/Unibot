import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

export type SessionRole = "student" | "admin";

export type Session = {
  userId: string;
  email: string;
  role: SessionRole;
};

export const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing JWT_SECRET");
  return new TextEncoder().encode(secret);
}

/**
 * Edge-safe: only `jose` is used here, because middleware.ts imports
 * verifySession and runs on the Edge runtime. Never add bcrypt or DB
 * access to this file.
 */
export async function signSession(user: {
  id: string;
  email: string;
  role: SessionRole;
}): Promise<string> {
  return new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());
}

export async function verifySession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: ["HS256"],
    });
    const email = payload.email;
    const role = payload.role;
    if (
      typeof payload.sub !== "string" ||
      typeof email !== "string" ||
      (role !== "student" && role !== "admin")
    ) {
      return null;
    }
    return { userId: payload.sub, email, role };
  } catch {
    // Invalid signature, expired token or malformed payload -> not signed in.
    return null;
  }
}

/** Attributes for the session cookie; httpOnly so client JS can never read it. */
export function sessionCookieOptions(maxAgeSeconds = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSeconds,
  };
}

/** Read the current session from the `session` cookie (server side only). */
export async function getSession(): Promise<Session | null> {
  // Next 15+/16: cookies() is async and must be awaited before access.
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/**
 * Route-handler guard: returns the session, or a 401/403 Response the caller
 * must return directly. Authorization is enforced per route by filtering on
 * session.userId (RLS is enabled with no policies, so the anon key reads nothing).
 */
export async function requireUser(): Promise<
  { session: Session; error?: never } | { session?: never; error: Response }
> {
  const session = await getSession();
  if (!session) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { session };
}

export async function requireAdmin(): Promise<
  { session: Session; error?: never } | { session?: never; error: Response }
> {
  const { session, error } = await requireUser();
  if (error) return { error };
  if (session.role !== "admin") {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}
