// RE: n/a (NEITHER - standard Next.js App Router root layout)
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ask the firm's documents",
  description: "Cited answers over a synthetic firm document set, with one agent step (email draft). Demo with synthetic data.",
  robots: { index: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
