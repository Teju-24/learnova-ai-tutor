"use client";

import { useEffect, useRef } from "react";
import { Lock, LockOpen, Sparkles } from "lucide-react";

/**
 * How long the sequence runs before the caller reveals the result card.
 * Stages finish by ~2000ms; the tail keeps "Unlocked!" readable.
 */
const COMPLETE_AT_MS = 2200;

/** Four CSS-driven sparkles — enough for a burst without 10 motion nodes. */
const SPARKLES = [
  { dx: 88, dy: 0, size: 7, delay: "0s" },
  { dx: -62, dy: 62, size: 5, delay: "0.04s" },
  { dx: -62, dy: -62, size: 6, delay: "0.08s" },
  { dx: 0, dy: -88, size: 5, delay: "0.02s" },
] as const;

type Props = {
  show: boolean;
  onComplete: () => void;
  /** The concept just passed. Named in the confirmation line. */
  conceptTitle: string;
};

/**
 * Pure CSS unlock celebration. Framer Motion particle springs + React
 * DevTools previously OOM'd Chrome on click; every frame here is CSS only.
 */
export default function UnlockOverlay({ show, onComplete, conceptTitle }: Props) {
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!show) return;
    const timer = window.setTimeout(
      () => onCompleteRef.current(),
      COMPLETE_AT_MS
    );
    return () => window.clearTimeout(timer);
  }, [show]);

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Next concept unlocked after ${conceptTitle}`}
      className="unlock-overlay fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-6"
    >
      <div className="relative flex flex-col items-center text-center">
        <span
          aria-hidden="true"
          className="unlock-halo pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full"
        />

        {SPARKLES.map((s, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="unlock-spark pointer-events-none absolute left-1/2 top-1/2 rounded-full"
            style={
              {
                width: s.size,
                height: s.size,
                marginLeft: -s.size / 2,
                marginTop: -s.size / 2,
                // CSS custom props drive the keyframe endpoints
                ["--sx" as string]: `${s.dx}px`,
                ["--sy" as string]: `${s.dy}px`,
                animationDelay: `calc(1.4s + ${s.delay})`,
              } as React.CSSProperties
            }
          />
        ))}

        <span className="relative flex h-24 w-24 items-center justify-center">
          <span
            className="unlock-lock-ring absolute flex h-24 w-24 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--primary-soft)" }}
          />
          <span className="unlock-lock-closed absolute text-primary">
            <Lock size={40} />
          </span>
          <span className="unlock-lock-open absolute text-primary">
            <LockOpen size={40} />
          </span>
        </span>

        <p className="unlock-status mt-6 font-heading text-lg text-white">
          Unlocking next concept...
        </p>

        <div className="unlock-confirm mt-2 flex flex-col items-center">
          <p className="flex items-center gap-2 font-heading text-2xl text-white">
            <Sparkles size={22} className="text-gold" />
            Unlocked!
          </p>
          <p className="mt-1 text-sm text-white/70">{conceptTitle}</p>
        </div>
      </div>
    </div>
  );
}
