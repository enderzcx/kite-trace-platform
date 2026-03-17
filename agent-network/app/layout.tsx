import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kite Trace Platform",
  description: "Trust + Commerce + Audit for open agent networks on Kite testnet.",
  openGraph: {
    title: "Kite Trace Platform",
    description: "Discover services, pay via AA sessions, and export audit evidence on Kite testnet.",
    url: "https://kiteclaw.duckdns.org",
    siteName: "Kite Trace Platform",
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
