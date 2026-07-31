import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LabBench",
  description: "Learn ML & systems by building — courses, sandboxed test runs, and a Claude tutor.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
