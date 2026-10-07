"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Loader2,
  RotateCcw,
  XCircle,
} from "lucide-react";
import type { InteractionItem } from "@/lib/content-schema";
import type { ReviewReason } from "@/lib/learner";
import FillBlank from "@/components/interactions/FillBlank";
import OrderSteps from "@/components/interactions/OrderSteps";
import Predict from "@/components/interactions/Predict";
import SpotMistake from "@/components/interactions/SpotMistake";
import Explain from "@/components/interactions/Explain";
import type { OnComplete, InteractionGrading } from "@/components/interactions/types";

export type ReviewItem = {
  conceptId: number;
  title: string;
  reason: ReviewReason;
  tier: string;
  questionIndex: number;
  question: InteractionItem;
};

type Props = {
  items: ReviewItem[];
};

type Outcome = {
  conceptId: number;
  title: string;
  reason: ReviewReason;
  correct: boolean;
  /** Null when the answer could not be graded deterministically. */
  newMastery: number | null;
  failed: boolean;
};

const REASON_TEXT: Record<ReviewReason, string> = {
  "stale-partial": "Half-learnt, and going stale",
  "failed-test": "You did not pass this one last time",
};

/**
 * Only the five types a test is actually built from. drag_match, python_code and
 * code_editor are lesson-only and are not reachable here, but the fallback keeps
 * an unexpected type from crashing the session mid-way.
 */
function Question({
  item,
  conceptId,
  tier,
  locked,
  onComplete,
}: {
  item: InteractionItem;
  conceptId: number;
  tier: string;
  locked: boolean;
  onComplete: OnComplete;
}) {
  switch (item.type) {
    case "fill_blank":
      return <FillBlank item={item} onComplete={onComplete} locked={locked} />;
    case "predict":
      return <Predict item={item} onComplete={onComplete} locked={locked} />;
    case "order_steps":
      return <OrderSteps item={item} onComplete={onComplete} locked={locked} />;
    case "spot_mistake":
      return <SpotMistake item={item} onComplete={onComplete} locked={locked} />;
    case "explain":
      return (
        <Explain
          item={item}
          conceptId={conceptId}
          tier={tier}
          // Reviews draw a question straight from the test bank rather than a
          // timeline position, so the sequence index is not meaningful here.
          sequenceIndex={0}
          onComplete={onComplete}
          locked={locked}
        />
      );
    default:
      return (
        <p className="card text-inkfaded">
          This question type cannot be shown in a review session.
        </p>
      );
  }
}

export default function ReviewSession({ items }: Props) {
  const [step, setStep] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<Outcome[]>([]);
  const [finished, setFinished] = useState(false);

  const total = items.length;
  const current = items[step];
  const done = finished || step >= total;

  async function handleComplete(
    score: number,
    userAnswer: string,
    grading?: InteractionGrading
  ) {
    if (outcome || saving) return;
    setSaving(true);

    try {
      const res = await fetch("/api/review-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conceptId: current.conceptId,
          tier: current.tier,
          questionIndex: current.questionIndex,
          userAnswer,
          // explain graded itself through /api/answer, so mastery is already
          // recorded there and must not be written again here.
          alreadyGraded: grading !== undefined,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        correct?: boolean;
        new_mastery?: number | null;
        newMastery?: number | null;
      };

      if (!res.ok || !data.ok) {
        // The answer still stands as an attempt; only the bookkeeping failed, so
        // the learner is not blocked from finishing the session.
        setOutcome({
          conceptId: current.conceptId,
          title: current.title,
          reason: current.reason,
          correct: score >= 0.8,
          newMastery: null,
          failed: true,
        });
        return;
      }

      setOutcome({
        conceptId: current.conceptId,
        title: current.title,
        reason: current.reason,
        correct: data.correct === true,
        newMastery:
          typeof data.newMastery === "number"
            ? data.newMastery
            : typeof data.new_mastery === "number"
              ? data.new_mastery
              : null,
        failed: false,
      });
    } catch {
      setOutcome({
        conceptId: current.conceptId,
        title: current.title,
        reason: current.reason,
        correct: false,
        newMastery: null,
        failed: true,
      });
    } finally {
      setSaving(false);
    }
  }

  function advance() {
    if (!outcome) return;
    const collected = [...results, outcome];
    setResults(collected);
    setOutcome(null);

    if (step + 1 >= total) {
      setFinished(true);
    } else {
      setStep(step + 1);
    }
  }

  // —— Summary ——
  if (done) {
    const correctCount = results.filter((r) => r.correct).length;

    return (
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-lg"
            style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
          >
            <CheckCircle2 size={20} />
          </span>
          <div>
            <h1 className="font-heading text-2xl">Review complete</h1>
            <p className="mt-0.5 text-inkmuted">
              You got {correctCount}/{total}.
            </p>
          </div>
        </div>

        <ul className="mt-5 space-y-2">
          {results.map((result) => (
            <li
              key={result.conceptId}
              className="flex items-start gap-3 rounded-lg border border-bgsubtle px-3 py-3"
            >
              {result.correct ? (
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
              ) : (
                <XCircle size={18} className="mt-0.5 shrink-0 text-error" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-heading font-bold">{result.title}</p>
                <p className="text-sm text-inkmuted">
                  {REASON_TEXT[result.reason]}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {result.newMastery !== null ? (
                  <>
                    <p className="font-mono text-sm">
                      {(result.newMastery * 100).toFixed(0)}%
                    </p>
                    <p className="text-xs text-inkfaint">mastery</p>
                  </>
                ) : (
                  <p className="text-xs text-inkfaint">
                    {result.failed ? "not saved" : "graded"}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/me"
            className="btn-primary"
            style={{ textDecoration: "none" }}
          >
            Back to dashboard
            <ChevronRight size={15} />
          </Link>
          <Link
            href={`/me/lesson/${results[0]?.conceptId ?? current.conceptId}`}
            className="btn-secondary"
            style={{ textDecoration: "none" }}
          >
            Reread the first one
          </Link>
        </div>
      </motion.section>
    );
  }

  // —— One question ——
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="font-heading text-sm font-bold uppercase tracking-wide text-inkmuted">
          Review session
        </p>
        <p className="font-mono text-sm text-inkmuted">
          {step + 1} of {total}
        </p>
      </div>

      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: "var(--bg-subtle)" }}
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step + 1}
        aria-label="Review progress"
      >
        <div
          className="progress-fill h-full rounded-full"
          style={{
            backgroundColor: "var(--primary)",
            width: `${((step + (outcome ? 1 : 0)) / total) * 100}%`,
          }}
        />
      </div>

      <motion.div
        key={current.conceptId}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="card mt-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip bg-bgsubtle text-inkmuted text-xs">
            {current.title}
          </span>
          <span className="chip bg-bgsubtle text-inkfaint text-xs">
            {REASON_TEXT[current.reason]}
          </span>
        </div>

        <div className="mt-4">
          <Question
            item={current.question}
            conceptId={current.conceptId}
            tier={current.tier}
            locked={outcome !== null || saving}
            onComplete={handleComplete}
          />
        </div>

        {outcome && (
          <div className="mt-6 border-t border-bgsubtle pt-4">
            <button
              type="button"
              onClick={advance}
              className="btn-primary"
              autoFocus
            >
              {step + 1 >= total ? "See results" : "Next question"}
              <ArrowRight size={15} />
            </button>
          </div>
        )}

        {saving && (
          <p className="mt-4 flex items-center gap-2 text-sm text-inkmuted">
            <Loader2 size={14} className="animate-spin" />
            Saving your answer...
          </p>
        )}
      </motion.div>
    </div>
  );
}

/** Shown when a learner lands here with nothing to review. */
export function NothingToReview() {
  return (
    <section className="card text-center">
      <span
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg"
        style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
      >
        <RotateCcw size={20} />
      </span>
      <h1 className="mt-3 font-heading text-2xl">Nothing to review right now</h1>
      <p className="mx-auto mt-1 max-w-sm text-inkmuted">
        We bring a concept back when it starts to fade, or when a test did not go
        well and you have not had another go at it.
      </p>
      <Link
        href="/me"
        className="btn-primary mt-5"
        style={{ textDecoration: "none" }}
      >
        Back to dashboard
      </Link>
    </section>
  );
}
