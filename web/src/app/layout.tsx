import type { Metadata } from "next";
// Fonts are bundled with the app (no call to Google Fonts at build or run time)
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deal Suite · ScaleForce Capital",
  description: "ScaleForce Capital deal pipeline, deal files and credit memos",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-ZA" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
