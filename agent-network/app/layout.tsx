import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kite Trace Platform",
  description: "Built on Kite testnet with XMTP x x402 x ERC8004 and full auditability",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
