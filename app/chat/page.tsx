import { redirect } from "next/navigation";

import ChatApp from "@/components/chat-app";
import { getSession } from "@/lib/auth";

export default async function ChatPage() {
  const session = await getSession();

  // Middleware already guards this, but a direct check keeps the page safe on its own.
  if (!session) redirect("/login");

  // All chat state lives in the client component; it reads history from the API.
  // email/role come from the verified session, so nothing sensitive is leaked here.
  return <ChatApp email={session.email} role={session.role} />;
}
