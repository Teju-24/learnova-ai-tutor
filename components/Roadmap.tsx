"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Car, Check, Circle, Lock, Play } from "lucide-react";

export type RoadmapPathItem = {
  concept_id: number;
  tier: string;
  why: string;
};

export type RoadmapStatus = "mastered" | "completed" | "current" | "locked" | "upcoming";

export type RoadmapProps = {
  path: RoadmapPathItem[];
  /** concept_ids whose lesson was finished (timeline done or test passed). */
  completedIds: number[];
  /** concept_ids whose mastery has reached the mastered threshold. */
  masteredIds: number[];
  /**
   * The concept the car parks on: the first one the learner has not finished.
   * Derived on /me from completion rather than from learner.current_concept,
   * which can lag behind real progress. It drives both the car and the pulsing
   * "current" stop, so the two can never disagree.
   */
  carConceptId: number | null;
  /** id -> title, for the labels. */
  conceptTitles: Record<number, string>;
  /**
   * Not in the original brief, but the roadmap cannot tell locked from
   * upcoming on its own — that depends on the prerequisite and position-window
   * rules the dashboard already applies. Passed in so both agree.
   */
  lockedIds: number[];
};

/** Horizontal gap between stops, in SVG user units. */
const SPACING = 200;

/** Compact gap used when the winding road collapses to a straight line. */
const MOBILE_SPACING = 120;

const ROAD_HEIGHT = 200;

/**
 * Height of the scrolling box, in CSS pixels. Taller than the canvas so the
 * border does not squeeze it: 30px of number labels above the peaks, 200px of
 * road, and the titles hanging below the last stop all stay inside without the
 * box ever scrolling vertically.
 */
const ROAD_BOX_HEIGHT = 220;
const STOP_SIZE = 40;

/** Right inset so the last stop's label is not clipped or scrolled off. */
const PAD = 70;

const STOP_Y_HIGH = 100;
const STOP_Y_LOW = 60;

const STATUS_LABEL: Record<RoadmapStatus, string> = {
  mastered: "Mastered",
  completed: "Completed",
  current: "Current",
  upcoming: "Upcoming",
  locked: "Locked",
};

type Point = { x: number; y: number };

function statusOf(
  conceptId: number,
  masteredIds: number[],
  completedIds: number[],
  lockedIds: number[],
  carConceptId: number | null
): RoadmapStatus {
  // The stop under the car is the current stop by definition, so this is
  // checked first: a stale car position must not leave a finished concept
  // wearing a pulsing Play icon, and a car that legitimately sits on a
  // completed concept (whole path finished) still reads as current.
  if (conceptId === carConceptId) return "current";
  if (masteredIds.includes(conceptId)) return "mastered";
  if (completedIds.includes(conceptId)) return "completed";
  if (lockedIds.includes(conceptId)) return "locked";
  return "upcoming";
}

/** Stop centres: alternating peaks and troughs on desktop, flat on mobile. */
function stopPoints(count: number, mobile: boolean): Point[] {
  return Array.from({ length: count }, (_, i) => ({
    x: i * (mobile ? MOBILE_SPACING : SPACING) + (mobile ? MOBILE_SPACING / 2 : SPACING / 2),
    y: mobile ? STOP_Y_HIGH : i % 2 === 0 ? STOP_Y_HIGH : STOP_Y_LOW,
  }));
}

/**
 * The road itself: a cubic bezier between each pair of stops, so the line dips
 * and rises through them instead of running straight.
 */
function roadPath(points: Point[]): string {
  if (points.length === 0) return "";
  const first = points[0];
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const handle = (to.x - from.x) * 0.25;
    d += ` C ${from.x + handle} ${from.y}, ${to.x - handle} ${to.y}, ${to.x} ${to.y}`;
  }
  return d;
}

const STOP_COLOR: Record<RoadmapStatus, { background: string; color: string }> = {
  mastered: { background: "var(--success)", color: "#FFFFFF" },
  completed: { background: "var(--bg-subtle)", color: "var(--ink-muted)" },
  current: { background: "var(--primary)", color: "#FFFFFF" },
  upcoming: { background: "var(--bg-subtle)", color: "var(--ink-faint)" },
  locked: { background: "var(--bg-subtle)", color: "var(--ink-faint)" },
};

export default function Roadmap({
  path,
  completedIds,
  masteredIds,
  carConceptId,
  conceptTitles,
  lockedIds,
}: RoadmapProps) {
  const router = useRouter();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const carRef = useRef<HTMLDivElement | null>(null);

  // Rendered desktop-first so the server and the first client render agree;
  // the effect narrows it to a straight line on small screens.
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setMobile(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const points = useMemo(() => stopPoints(path.length, mobile), [path.length, mobile]);
  const d = useMemo(() => roadPath(points), [points]);
  const width = Math.max(
    (points.length ? points[points.length - 1].x + PAD : MOBILE_SPACING),
    MOBILE_SPACING
  );

  const carIndex = path.findIndex((item) => item.concept_id === carConceptId);
  const car = carIndex >= 0 ? points[carIndex] : null;

  // Re-keyed when the car lands, so the hop and the spark replay on each
  // arrival rather than on page load.
  const [arrival, setArrival] = useState(0);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = window.setTimeout(() => setArrival((n) => n + 1), 800);
    return () => window.clearTimeout(timer);
  }, [carConceptId]);

  // Keep the car in view: center it in the scroll container on load and
  // whenever it moves. Depends on car.x too because the layout switches to its
  // compact mobile spacing after mount, which moves the car.
  useEffect(() => {
    const container = scrollRef.current;
    const carEl = carRef.current;
    if (!container || !carEl) return;

    const containerRect = container.getBoundingClientRect();
    const carRect = carEl.getBoundingClientRect();
    // carRect.left is measured against the current scroll offset, so add
    // container.scrollLeft back to get the car's absolute position in the
    // content before solving for the scroll that centers it.
    const centered =
      carRect.left -
      containerRect.left +
      container.scrollLeft -
      containerRect.width / 2 +
      carRect.width / 2;
    // scrollTo clamps anyway; doing it explicitly keeps the first/last stops at
    // the edges rather than relying on that.
    const max = container.scrollWidth - container.clientWidth;
    const left = Math.max(0, Math.min(centered, max));

    container.scrollTo({ left, behavior: "smooth" });
  }, [carConceptId, car?.x]);

  if (path.length === 0) return null;

  return (
    <section aria-label="Your learning roadmap">
      <h2 className="font-heading text-2xl">Roadmap</h2>
      <p className="mt-1 text-sm text-inkmuted">
        {completedIds.length} of {path.length} done — the car sits where you are now.
      </p>

      <div
        ref={scrollRef}
        className="card mt-4 overflow-x-auto overflow-y-hidden"
        // Taller than the canvas on purpose: .card carries a 1px top and bottom
        // border, and under border-box a height equal to the canvas would leave
        // 2px of vertical overflow — which overflow-x:auto turns into a second
        // scrollbar. overflow-y-hidden also states the intent rather than
        // relying on the computed value.
        style={{ height: ROAD_BOX_HEIGHT, padding: 0 }}
      >
        <div className="relative" style={{ width, height: ROAD_HEIGHT }}>
          <svg
            width={width}
            height={ROAD_HEIGHT}
            viewBox={`0 0 ${width} ${ROAD_HEIGHT}`}
            className="absolute inset-0"
            aria-hidden="true"
          >
            {/* Base road, with a faint rim for depth. */}
            <motion.path
              d={d}
              fill="none"
              stroke="var(--bg-subtle)"
              strokeWidth={8}
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1, ease: "easeInOut" }}
            />
            <motion.path
              d={d}
              fill="none"
              stroke="var(--ink-faint)"
              strokeWidth={2}
              strokeDasharray="12 12"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1, ease: "easeInOut" }}
            />
          </svg>

          {/* Car, parked above the current stop. */}
          {car && (
            <motion.div
              ref={carRef}
              className="pointer-events-none absolute left-0 top-0 z-10 flex items-center justify-center"
              style={{ width: 40, height: 40 }}
              initial={{ opacity: 0, x: car.x - 20, y: car.y - 48 }}
              animate={{
                opacity: 1,
                x: car.x - 20,
                y: car.y - 48,
                // Replays on arrival: a small hop as the car settles.
              }}
              transition={{ type: "spring", stiffness: 100, damping: 15 }}
            >
              <motion.span
                key={arrival}
                className="flex items-center justify-center"
                initial={{ y: 0 }}
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.2))" }}
              >
                <Car size={36} className="text-primary" />
              </motion.span>

              {/* Spark burst at the arrival point. */}
              <motion.span
                key={`spark-${arrival}`}
                className="absolute"
                initial={{ opacity: 0.85, scale: 0.4 }}
                animate={{ opacity: 0, scale: 1.9 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  backgroundColor: "var(--gold)",
                }}
              />
            </motion.div>
          )}

          {/* Stops */}
          {path.map((item, index) => {
            const point = points[index];
            const status = statusOf(
              item.concept_id,
              masteredIds,
              completedIds,
              lockedIds,
              carConceptId
            );
            const color = STOP_COLOR[status];
            const title = conceptTitles[item.concept_id] ?? `Concept #${item.concept_id}`;
            const isLocked = status === "locked";
            const Icon =
              status === "locked"
                ? Lock
                : status === "upcoming"
                  ? Circle
                  : status === "current"
                    ? Play
                    : Check;

            return (
              <div key={item.concept_id}>
                {/* Stop number */}
                <motion.span
                  className="absolute w-8 text-center font-mono text-xs font-semibold text-inkmuted"
                  style={{ left: point.x - 16, top: point.y - STOP_SIZE / 2 - 22 }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 + index * 0.06 }}
                >
                  {index + 1}
                </motion.span>

                <motion.button
                  type="button"
                  className={`absolute flex items-center justify-center rounded-full ${
                    isLocked ? "cursor-not-allowed" : "cursor-pointer"
                  } ${status === "current" ? "scale-pulse" : ""}`}
                  style={{
                    left: point.x - STOP_SIZE / 2,
                    top: point.y - STOP_SIZE / 2,
                    width: STOP_SIZE,
                    height: STOP_SIZE,
                    backgroundColor: color.background,
                    color: color.color,
                    opacity: isLocked ? 0.6 : 1,
                    boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
                    border:
                      status === "current" ? "2px solid var(--primary)" : "1px solid var(--ink-faint)",
                  }}
                  onClick={() => {
                    if (isLocked) return;
                    router.push(`/me/lesson/${item.concept_id}`);
                  }}
                  aria-label={`${title} — ${STATUS_LABEL[status]}`}
                  title={
                    isLocked ? `${title} — complete earlier concepts to unlock` : `${title} — ${STATUS_LABEL[status]}`
                  }
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{
                    delay: 0.4 + index * 0.06,
                    duration: 0.25,
                  }}
                >
                  <Icon size={20} strokeWidth={isLocked ? 2 : 2.5} />
                </motion.button>

                {/* Title */}
                <motion.span
                  className="absolute block max-w-[120px] truncate text-center"
                  style={{
                    left: point.x - 60,
                    top: point.y + STOP_SIZE / 2 + 6,
                    width: 120,
                    fontSize: 13,
                    fontWeight: 600,
                    color:
                      status === "current" || status === "mastered"
                        ? "var(--ink)"
                        : "var(--ink-muted)",
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.45 + index * 0.06 }}
                >
                  {title}
                </motion.span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}