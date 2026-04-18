import type { Metadata } from "next";
import "./globals.css";

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:3399").replace(/\/+$/, "");

export const metadata: Metadata = {
  title: "KTrace Platform",
  description: "Trust + Commerce + Audit for open agent networks on HashKey Testnet.",
  openGraph: {
    title: "KTrace Platform",
    description: "Discover services, pay via AA sessions, and export audit evidence on HashKey Testnet.",
    url: BACKEND_URL,
    siteName: "KTrace Platform",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;1,400;1,600&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}