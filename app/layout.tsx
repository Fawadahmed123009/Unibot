import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "UET Department Assistant",
  description:
    "AI assistant for the Computer Engineering Department at UET Lahore, answering only from verified department documents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900">{children}</body>
    </html>
  );
}
