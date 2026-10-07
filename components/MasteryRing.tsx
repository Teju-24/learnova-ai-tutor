"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  size?: number;
  conceptSlug?: string;
  /** When true, shows a small caption under the ring. */
  showLabel?: boolean;
};

type MasteryEvent = {
  conceptSlug?: string;
  mastery?: number;
};

function ringColor(value: number): string {
  if (value >= 0.7) return "var(--success)";
  if (value >= 0.4) return "var(--warning)";
  return "var(--error)";
}

/**
 * CSS-only ring + pulse. Framer Motion stroke springs were instrumented by
 * React DevTools on every mastery tick and contributed to click crashes.
 */
export default function MasteryRing({
  value,
  size = 56,
  conceptSlug,
  showLabel,
}: Props) {
  const [display, setDisplay] = useState(value);
  const [pulse, setPulse] = useState(false);
  const isFirstRender = useRef(true);

  useEffect(() => {
    setDisplay(value);
  }, [value]);

  useEffect(() => {
    if (!conceptSlug) return;

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<MasteryEvent>).detail;
      if (
        detail &&
        detail.conceptSlug === conceptSlug &&
        typeof detail.mastery === "number"
      ) {
        setDisplay(detail.mastery);
        if (!isFirstRender.current) {
          setPulse(true);
          window.setTimeout(() => setPulse(false), 400);
        }
        isFirstRender.current = false;
      }
    };

    window.addEventListener("learnova:mastery-update", handler);
    return () => window.removeEventListener("learnova:mastery-update", handler);
  }, [conceptSlug]);

  const clamped = Math.max(0, Math.min(1, display));
  const stroke = Math.max(4, Math.round(size * 0.09));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);

  return (
    <div
      className={`flex flex-col items-center ${pulse ? "mastery-ring-pulse" : ""}`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Mastery ${Math.round(clamped * 100)}%`}
        style={{ display: "block" }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--bg-subtle)"
          strokeWidth={stroke}
        />
        <circle
          className="mastery-ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={ringColor(clamped)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          style={{
            transform: "rotate(-90deg)",
            transformOrigin: "center",
          }}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size * 0.26}
          fontFamily="var(--font-heading)"
          fontWeight={700}
          fill="var(--ink)"
        >
          {Math.round(clamped * 100)}%
        </text>
      </svg>
      {showLabel && (
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-inkfaint">
          Mastery
        </span>
      )}
    </div>
  );
}
