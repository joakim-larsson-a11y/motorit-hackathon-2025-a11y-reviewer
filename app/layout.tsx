import type { Metadata } from "next";
import { ReactNode } from "react";

import "./globals.css";

const themeScript = `(() => {
  const storageKey = "motorit-theme";
  const root = document.documentElement;
  const applyTheme = (value) => {
    const theme = value === "dark" ? "dark" : "light";
    root.dataset.theme = theme;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  };

  try {
    const storedPreference = window.localStorage.getItem(storageKey);
    if (storedPreference === "light" || storedPreference === "dark") {
      applyTheme(storedPreference);
      return;
    }
  } catch (error) {
    /* no-op */
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  applyTheme(mediaQuery.matches ? "dark" : "light");
})();`;

export const metadata: Metadata = {
  title: "Motorit A11y Reviewer",
  description:
    "Automated accessibility audit pipeline powered by Playwright, axe-core, and AI.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sv" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
        <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-10">
          {children}
        </div>
      </body>
    </html>
  );
}
