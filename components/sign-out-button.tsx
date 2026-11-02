"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    // The session cookie is httpOnly, so logout must go through the server route.
    const res = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    if (res?.ok) {
      router.replace("/login");
      router.refresh();
    } else {
      setLoading(false);
    }
  }

  return (
    <button type="button" onClick={signOut} disabled={loading} className="btn-ghost">
      {loading ? "Signing out..." : "Sign out"}
    </button>
  );
}
