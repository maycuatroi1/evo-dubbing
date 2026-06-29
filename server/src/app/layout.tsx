import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "evo-dubbing",
  description: "Shared AI dubs for online videos"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
