"use client";

import { useEffect } from "react";

const STORAGE_KEY = "theme";

/**
 * Re-applies the saved theme on the document root after mount and on
 * every client navigation. The pre-paint script in app/layout.tsx sets
 * data-theme before first paint, but React can strip attributes it does
 * not manage when it hydrates or re-renders <html>. Running this in the
 * persistent root layout keeps dark mode alive across routes.
 */
export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    function apply() {
      try {
        const theme = window.localStorage.getItem(STORAGE_KEY);
        if (theme === "dark") {
          document.documentElement.setAttribute("data-theme", "dark");
        } else {
          document.documentElement.removeAttribute("data-theme");
        }
      } catch {
        // private mode / blocked storage — leave the current attribute alone
      }
    }

    apply();

    // Re-apply when the tab becomes visible again (bfcache / multi-tab).
    window.addEventListener("pageshow", apply);
    document.addEventListener("visibilitychange", apply);
    return () => {
      window.removeEventListener("pageshow", apply);
      document.removeEventListener("visibilitychange", apply);
    };
  }, []);

  return <>{children}</>;
}
