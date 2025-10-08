import type { Metadata } from "next";
import { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Motorit A11y Reviewer",
  description: "Automated accessibility audit pipeline powered by Playwright, axe-core, and AI."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sv">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-10">
          {children}
        </div>
      </body>
    </html>
  );
}
