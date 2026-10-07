"use client";

import { useEffect, useState } from "react";
import { Sparkles, Trophy } from "lucide-react";

export type ToastVariant = "default" | "badge" | "spark";

type ToastDetail = {
  message: string;
  variant?: ToastVariant;
};

type ToastItem = ToastDetail & { id: number; leaving?: boolean };

const EXIT_MS = 200;

/**
 * Toasts use CSS enter/exit classes only — no Framer Motion springs.
 * Springs under React DevTools previously crashed Chrome on fireToast().
 */
export default function Toast() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      if (!detail?.message) return;
      const id = Date.now() + Math.random();
      const variant = detail.variant ?? "default";
      setItems((prev) => [...prev, { id, message: detail.message, variant }]);
      const duration = variant === "badge" ? 5000 : 3000;
      window.setTimeout(() => {
        setItems((prev) =>
          prev.map((t) => (t.id === id ? { ...t, leaving: true } : t))
        );
        window.setTimeout(() => {
          setItems((prev) => prev.filter((t) => t.id !== id));
        }, EXIT_MS);
      }, duration);
    }
    window.addEventListener("learnova:toast", onToast);
    return () => window.removeEventListener("learnova:toast", onToast);
  }, []);

  return (
    <div
      className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col gap-2"
      aria-live="polite"
    >
      {items.map((item) => {
        const isBadge = item.variant === "badge";
        const isSpark = item.variant === "spark";

        return (
          <div
            key={item.id}
            className={`toast-item pointer-events-auto flex items-center gap-2.5 rounded-lg px-4 py-3 text-sm font-semibold shadow-xl ${
              item.leaving ? "toast-item-exit" : "toast-item-enter"
            } ${isBadge ? "text-ink" : "text-white"}`}
            style={{
              backgroundColor: isBadge
                ? "var(--gold-soft)"
                : isSpark
                  ? "var(--sparks)"
                  : "var(--ink)",
              border: isBadge ? "1px solid rgba(245,158,11,0.35)" : "none",
            }}
          >
            {isBadge && <Trophy size={16} className="text-gold" />}
            {isSpark && <Sparkles size={16} />}
            {!isBadge && !isSpark ? (
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: "var(--success)" }}
              />
            ) : null}
            {item.message}
          </div>
        );
      })}
    </div>
  );
}

export function fireToast(message: string, variant?: ToastVariant) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("learnova:toast", {
      detail: { message, variant },
    })
  );
}
