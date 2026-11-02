import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";

export async function GET() {
  const { session, error } = await requireUser();
  if (error) return error;

  return NextResponse.json({ email: session.email, role: session.role });
}
