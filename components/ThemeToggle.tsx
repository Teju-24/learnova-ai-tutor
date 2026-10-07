"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

/** Always mutate <html>, never a page wrapper — CSS tokens live on :root. */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.setAttribute("data-theme", "dark");
  } else {
    root.removeAttribute("data-theme");
  }
}

/**
 * Light/dark switch. The theme lives in localStorage and on
 * document.documentElement's data-theme attribute; the pre-paint script in
 * app/layout.tsx applies it before first paint so there is no flash. Initial
 * state is "light" on both server and client to keep hydration deterministic —
 * the mount effect then adopts whatever was saved.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    let saved: Theme = "light";
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "dark") saved = "dark";
    } catch {
      // localStorage can be unavailable (private mode); fall back to light.
    }
    setTheme(saved);
    applyTheme(saved);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persisting is best-effort; the DOM still switches for this session.
    }
  }

  const dark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      className="inline-flex items-center gap-2 rounded-md border border-bgsubtle bg-bgcard px-3 py-1.5 text-sm font-semibold text-inkmuted transition-colors hover:border-primary hover:text-primary"
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
      <span>{dark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
