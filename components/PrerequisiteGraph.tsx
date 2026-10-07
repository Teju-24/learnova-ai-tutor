"use client";

import { useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { isConceptUnlocked } from "@/lib/learner";

/**
 * The curriculum as a graph: one column per difficulty, prerequisites drawn
 * between concepts.
 *
 * Plain SVG rather than a graph library, because the shape is fixed (at most
 * five columns, one node per concept) and the whole thing has to stay readable
 * without a zoom/pan interaction.
 */

export type GraphConcept = {
  id: number;
  slug: string;
  title: string;
  /** 1-5, checked by the concepts table. */
  difficulty: number;
  /** Prerequisite concept IDs. Note these are IDs while mastery is slug-keyed. */
  prerequisites: number[];
};

export type PrerequisiteGraphProps = {
  concepts: GraphConcept[];
  /** Keyed by slug, matching learners.mastery. */
  mastery: Record<string, number>;
  pathIds: number[];
  completedIds: number[];
  /** learners.current_concept. Needed to mark the "you are here" node. */
  currentId?: number | null;
};

/** The concepts table constrains difficulty to this range. */
const LEVELS = [1, 2, 3, 4, 5];

const VIEW_W = 1080;
const VIEW_H = 600;
const NODE_R = 24;
const PAD_X = 56;
const LABEL_Y = 36;
const AREA_TOP = 76;
const AREA_BOTTOM = 556;
const MAX_ROW_GAP = 88;

type NodeState = "current" | "completed" | "locked" | "available" | "outside";

type Pos = { x: number; y: number };

function edgePath(from: Pos, to: Pos): string {
  // Six of the twenty shipped concepts have a prerequisite at the same or a
  // higher difficulty, so "column N feeds column N+1" is not always true: five
  // edges stay inside one column and one runs backwards. Those leave the normal
  // left-to-right path, so they bow out to the right of both nodes instead of
  // being drawn through the circles between them.
  if (to.x - from.x > NODE_R * 2) {
    const bend = Math.max(30, (to.x - from.x) * 0.42);
    return `M ${from.x + NODE_R} ${from.y} C ${from.x + NODE_R + bend} ${from.y}, ${
      to.x - NODE_R - bend
    } ${to.y}, ${to.x - NODE_R} ${to.y}`;
  }
  const bow = Math.max(from.x, to.x) + 40;
  return `M ${from.x + NODE_R} ${from.y} C ${bow} ${from.y}, ${bow} ${to.y}, ${
    to.x + NODE_R
  } ${to.y}`;
}

export type GraphNode = {
  concept: GraphConcept;
  x: number;
  y: number;
  state: NodeState;
};

export type GraphEdge = { key: string; path: string; satisfied: boolean };

/**
 * Pure layout: concept list + learner state in, node coordinates and edge
 * paths out. Kept out of the component so the geometry can be checked without
 * a browser (see scripts/check-graph-layout.ts).
 */
export function buildGraphLayout(input: {
  concepts: GraphConcept[];
  mastery: Record<string, number>;
  pathIds: number[];
  completedIds: number[];
  currentId?: number | null;
}): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const { concepts, mastery, pathIds, completedIds, currentId = null } = input;

  const pathSet = new Set(pathIds);
  const completedSet = new Set(completedIds);
  const slugById = new Map(concepts.map((c) => [c.id, c.slug]));

  // Indexed by level - 1 rather than a Map: the project targets ES5, where
  // iterating a Map is not allowed without downlevelIteration.
  const columns: GraphConcept[][] = LEVELS.map(() => []);
  for (const concept of concepts) {
    const level = Math.min(5, Math.max(1, concept.difficulty || 1));
    columns[level - 1].push(concept);
  }

  const colStep = (VIEW_W - PAD_X * 2) / (LEVELS.length - 1);
  const area = AREA_BOTTOM - AREA_TOP;
  const placed = new Map<number, Pos>();

  for (let li = 0; li < LEVELS.length; li++) {
    const list = columns[li];
    const x = PAD_X + li * colStep;
    const gap = list.length > 1 ? Math.min(MAX_ROW_GAP, area / (list.length - 1)) : 0;
    const span = gap * (list.length - 1);
    const startY = AREA_TOP + (area - span) / 2;
    list.forEach((concept, i) => placed.set(concept.id, { x, y: startY + i * gap }));
  }

  const stateOf = (concept: GraphConcept): NodeState => {
    if (!pathSet.has(concept.id)) return "outside";
    if (completedSet.has(concept.id)) return "completed";
    if (currentId != null && concept.id === currentId) return "current";
    if (!isConceptUnlocked(concept.prerequisites, mastery, slugById)) return "locked";
    return "available";
  };

  const nodes: GraphNode[] = concepts
    .filter((c) => placed.has(c.id))
    .map((c) => {
      const pos = placed.get(c.id)!;
      return { concept: c, x: pos.x, y: pos.y, state: stateOf(c) };
    });

  const edges: GraphEdge[] = [];
  for (const concept of concepts) {
    const to = placed.get(concept.id);
    if (!to) continue;
    for (const prereqId of concept.prerequisites ?? []) {
      const from = placed.get(prereqId);
      if (!from) continue; // unresolvable id: the glossary locks on these too
      edges.push({
        key: `${prereqId}->${concept.id}`,
        path: edgePath(from, to),
        satisfied: completedSet.has(prereqId) && completedSet.has(concept.id),
      });
    }
  }

  return { nodes, edges };
}

export default function PrerequisiteGraph({
  concepts,
  mastery,
  pathIds,
  completedIds,
  currentId = null,
}: PrerequisiteGraphProps) {
  const [tip, setTip] = useState<{ id: number; x: number; y: number } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const { nodes, edges } = useMemo(
    () => buildGraphLayout({ concepts, mastery, pathIds, completedIds, currentId }),
    [concepts, mastery, pathIds, completedIds, currentId]
  );

  const tipNode = tip ? nodes.find((n) => n.concept.id === tip.id) : null;

  if (nodes.length === 0) return null;

  const showTip = (id: number, e: React.MouseEvent) => {
    const host = hostRef.current;
    if (!host) return;
    const box = host.getBoundingClientRect();
    // Clamp so a node near either edge still shows its tooltip in full.
    const x = Math.min(Math.max(e.clientX - box.left, 90), box.width - 90);
    setTip({ id, x, y: e.clientY - box.top });
  };

  return (
    <div className="relative">
      <div className="overflow-x-auto pb-1" ref={hostRef} onMouseLeave={() => setTip(null)}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-[600px] w-full min-w-[900px]"
          role="img"
          aria-label={`Curriculum prerequisite graph: ${nodes.length} concepts across ${LEVELS.length} difficulty levels, ${edges.length} prerequisite links.`}
        >
          {/* Column headers */}
          {LEVELS.map((level) => {
            const x = PAD_X + (level - 1) * ((VIEW_W - PAD_X * 2) / (LEVELS.length - 1));
            return (
              <text
                key={level}
                x={x}
                y={LABEL_Y}
                textAnchor="middle"
                className="fill-inkfaint font-ui text-[13px] font-semibold uppercase tracking-wider"
              >
                Level {level}
              </text>
            );
          })}

          {/* Edges sit under the nodes so a line never crosses a label. */}
          <g>
            {edges.map((edge) => (
              <path
                key={edge.key}
                d={edge.path}
                fill="none"
                stroke={edge.satisfied ? "var(--success)" : "var(--ink-faint)"}
                strokeWidth={edge.satisfied ? 2 : 1.5}
                strokeOpacity={edge.satisfied ? 0.5 : 0.32}
              />
            ))}
          </g>

          {/* Nodes */}
          {nodes.map(({ concept, x, y, state }) => {
            const completed = state === "completed";
            const current = state === "current";
            const outside = state === "outside";
            const locked = state === "locked";

            const fill = completed
              ? "var(--success)"
              : current || state === "available"
                ? "var(--primary)"
                : "var(--bg-subtle)";
            const stroke = locked ? "var(--ink-faint)" : "none";
            const label =
              completed || current || state === "available"
                ? "#FFFFFF"
                : "var(--ink-faint)";

            return (
              <g
                key={concept.id}
                onMouseEnter={(e) => showTip(concept.id, e)}
                onMouseMove={(e) => showTip(concept.id, e)}
                className="cursor-default"
              >
                {/* Native tooltip as a fallback, and what a screen reader reads. */}
                <title>{concept.title}</title>

                {current && !reduced && (
                  <circle
                    className="ring-pulse"
                    cx={x}
                    cy={y}
                    r={NODE_R}
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    style={{ transformOrigin: `${x}px ${y}px` }}
                  />
                )}

                <circle
                  cx={x}
                  cy={y}
                  r={NODE_R}
                  fill={fill}
                  fillOpacity={outside ? 0.6 : 1}
                  stroke={stroke}
                  strokeWidth={locked ? 2 : 0}
                  strokeDasharray={locked ? "4 4" : undefined}
                />
                <text
                  x={x}
                  y={y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={label}
                  fillOpacity={outside ? 0.9 : 1}
                  className="pointer-events-none select-none font-heading text-[18px] font-bold"
                >
                  {concept.title.trim().charAt(0).toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Hover tooltip */}
      {tip && tipNode && (
        <div
          className="pointer-events-none absolute z-20 max-w-[220px] -translate-x-1/2 -translate-y-full rounded-md border border-bgsubtle bg-bgcard px-2.5 py-1.5 text-left shadow-lg"
          style={{ left: tip.x, top: tip.y - 10 }}
          role="tooltip"
        >
          <p className="text-sm font-semibold leading-snug">{tipNode.concept.title}</p>
          <p className="mt-0.5 text-[11px] text-inkmuted">
            Level {tipNode.concept.difficulty} ·{" "}
            {Math.round((mastery[tipNode.concept.slug] ?? 0) * 100)}% mastery
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-inkmuted">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-primary" />
          In your path
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-success" />
          Completed
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-full border-2 border-dashed border-inkfaint"
            style={{ borderStyle: "dashed" }}
          />
          Locked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-bgsubtle opacity-60" />
          Not in path
        </span>
      </div>
    </div>
  );
}
