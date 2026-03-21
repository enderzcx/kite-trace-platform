import type { Metadata } from "next";
import { Crimson_Text, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-dm-sans-next",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono-next",
});

const crimsonText = Crimson_Text({
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  variable: "--font-crimson-next",
});

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
      <body className={`${dmSans.variable} ${jetBrainsMono.variable} ${crimsonText.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
