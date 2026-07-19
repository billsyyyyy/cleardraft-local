import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClearDraft Local",
  description: "A private, browser-based academic and clinical writing assistant.",
  icons: {
    icon: process.env.NODE_ENV === "production" ? "/cleardraft-local/favicon.svg" : "/favicon.svg",
    shortcut: process.env.NODE_ENV === "production" ? "/cleardraft-local/favicon.svg" : "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
