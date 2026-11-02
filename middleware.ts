import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { SESSION_COOKIE, verifySession } from "@/lib/auth";

const PROTECTED_PATHS = ["/chat", "/admin"];
const AUTH_PATHS = ["/login"];

function isUnder(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  // Only the JWT in the session cookie is checked here (Edge-safe: jose only).
  // Role-based authorization is re-checked against the DB in the pages/routes,
  // so a stale role inside the 7-day token can never grant extra access.
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  const { pathname } = request.nextUrl;

  if (!session && isUnder(pathname, PROTECTED_PATHS)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (session && isUnder(pathname, AUTH_PATHS)) {
    return NextResponse.redirect(new URL("/chat", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
