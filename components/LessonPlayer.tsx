"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Clock,
  Menu,
  Sparkles,
  Target,
  TrendingDown,
  Trophy,
  XCircle,
} from "lucide-react";
import type {
  InteractionItem,
  Timeline,
  TimelineItem,
  ConceptTest,
} from "@/lib/content-schema";
import { InteractionItemSchema } from "@/lib/content-schema";
import {
  TEST_LENGTH,
  firstTestIndex,
  nextAdaptiveIndex,
} from "@/lib/adaptive-test";
import CalculatorCode from "@/components/CalculatorCode";
import FillBlank from "@/components/interactions/FillBlank";
import DragMatch from "@/components/interactions/DragMatch";
import OrderSteps from "@/components/interactions/OrderSteps";
import Predict from "@/components/interactions/Predict";
import SpotMistake from "@/components/interactions/SpotMistake";
import Explain from "@/components/interactions/Explain";
import CodeEditor from "@/components/interactions/CodeEditor";
import type { OnComplete, InteractionGrading } from "@/components/interactions/types";
import { fireToast } from "@/components/Toast";
import LessonSidebar from "@/components/LessonSidebar";
import UnlockOverlay from "@/components/UnlockOverlay";
import SpeakButton from "@/components/SpeakButton";
import { sectionSpeechText } from "@/lib/section-speech";

export type ConceptNoteForPlayer = {
  title: string;
  summary: string;
  long_intro: string | null;
  deep_explanation: { heading: string; body: string; code: string | null }[] | null;
  formal_definition: string | null;
  code_example: {
    language: string;
    code: string;
    universal_explanation: string;
  } | null;
  common_mistakes: string[] | null;
  real_world_usage: string | null;
  key_takeaways: string[] | null;
};

export type TestVerdict = "correct" | "partial" | "wrong";

export type ReviewAnswerEntry = {
  index: number;
  userAnswer: string;
  correct: boolean;
};

/** The persisted answer key behind a test attempt, index-aligned. */
export type TestReview = {
  questions: InteractionItem[];
  answers: ReviewAnswerEntry[];
  verdicts: TestVerdict[];
  reasons: string[];
  /** ISO timestamp of the stored attempt, when the server recorded one. */
  submitted_at?: string;
};

export type InitialReview = {
  weak_sections: string[];
  review_step: number;
  test_review?: TestReview;
};

/**
 * "skip_choice" is offered when the learner is already strong on a concept but
 * has never opened its lesson: reading it from step 0 feels like busywork, so
 * they pick the test or the reading.
 */
export type InitialPhase = "learn" | "skip_choice";

type Props = {
  timeline: Timeline;
  conceptNote: ConceptNoteForPlayer;
  test: ConceptTest | null;
  conceptId: number;
  tier: string;
  conceptTitle: string;
  /** Slug, used to address the header MasteryRing on live mastery updates. */
  conceptSlug: string;
  initialMastery: number;
  /** Step to open on, so a learner can resume mid-lesson. */
  initialStep?: number;
  /** Set once the lesson has been passed, which unlocks the review path. */
  initialCompletedAt?: string | null;
  /** Weak sections recorded by the last test attempt. */
  initialReview?: InitialReview;
  /** Persisted answer key for this concept's most recent test attempt. */
  storedTestReview?: TestReview;
  /** Server-side decision to ask test-or-read before showing the timeline. */
  initialPhase?: InitialPhase;
};

type Phase = "learn" | "complete" | "test" | "result" | "skip_choice";

/** Where the result screen's data came from: a fresh submission or a stored one. */
type ResultSource = "fresh" | "stored";

/** One answered test question, kept so the result page can show the answer key. */
type TestEntry = {
  index: number;
  userAnswer: string;
  verdict: TestVerdict;
  reason: string;
};

type BuiltReview = TestReview & {
  weak_sections: string[];
  review_step: number;
};

type ResultState = {
  score: number;
  passed: boolean;
  sparks: number;
  timeTakenSec: number;
  review: BuiltReview;
};

const PROGRESS_WRITE_DEBOUNCE_MS = 500;

/** Left-border accent for each interaction type. */
function interactionAccent(type: InteractionItem["type"]): string {
  switch (type) {
    case "fill_blank":
      return "var(--a-fill-blank)";
    case "drag_match":
      return "var(--a-drag-match)";
    case "order_steps":
      return "var(--a-order-steps)";
    case "predict":
      return "var(--a-predict)";
    case "spot_mistake":
      return "var(--a-spot-mistake)";
    case "explain":
      return "var(--a-explain)";
    case "code_editor":
      return "var(--a-code-editor)";
    default:
      return "var(--primary)";
  }
}

function formatTimeTaken(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

/** Which lesson section each test question exercises. */
const SECTION_FOR_QUESTION_INDEX: Record<number, string> = {
  0: "deep_explanation.0",
  1: "deep_explanation.0",
  2: "deep_explanation.1",
  3: "common_mistakes",
  4: "real_world_usage",
};

function localVerdict(score: number): TestVerdict {
  if (score >= 0.8) return "correct";
  if (score >= 0.4) return "partial";
  return "wrong";
}

function questionText(item: InteractionItem | undefined): string {
  if (!item) return "";
  switch (item.type) {
    case "fill_blank":
      return item.sentence;
    case "predict":
      return item.question;
    case "spot_mistake":
      return item.code;
    case "order_steps":
      return `Put these steps in order:\n${item.items
        .map((text, i) => `${i + 1}. ${text}`)
        .join("\n")}`;
    case "drag_match":
      return `Match the terms:\n${item.pairs
        .map((pair) => `${pair.term}: ?`)
        .join("\n")}`;
    case "explain":
      return item.prompt;
    case "code_editor":
      return item.prompt;
    default:
      return "";
  }
}

/**
 * Why an answer scored what it did. Only `explain` questions are graded by the
 * model, so the rest get a short deterministic note derived from the score.
 */
function localReason(
  item: InteractionItem | undefined,
  score: number,
  verdict: TestVerdict
): string {
  if (item?.type === "order_steps") {
    return `You placed ${Math.round(score * item.items.length)} of ${
      item.items.length
    } steps in the right place.`;
  }
  if (item?.type === "drag_match") {
    return `You matched ${Math.round(score * item.pairs.length)} of ${
      item.pairs.length
    } pairs correctly.`;
  }
  if (verdict === "correct") return "You got this right.";
  return "This one was not right — the correct answer is below.";
}

/** Renders a stored attempt's ISO timestamp as a short, readable date. */
function formatStoredDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function firstSectionIndex(
  timeline: Timeline,
  sectionIds: string[]
): number {
  for (let i = 0; i < timeline.length; i += 1) {
    const item: TimelineItem | undefined = timeline[i];
    if (
      item &&
      item.type === "section" &&
      sectionIds.includes(item.section_id)
    ) {
      return i;
    }
  }
  return 0;
}

function buildReview(
  entries: TestEntry[],
  questions: InteractionItem[],
  timeline: Timeline
): BuiltReview {
  const weakSections: string[] = [];
  for (const entry of entries) {
    if (entry.verdict === "correct") continue;
    const section = SECTION_FOR_QUESTION_INDEX[entry.index];
    if (section && !weakSections.includes(section)) {
      weakSections.push(section);
    }
  }

  return {
    questions,
    answers: entries.map((entry) => ({
      index: entry.index,
      userAnswer: entry.userAnswer,
      correct: entry.verdict === "correct",
    })),
    verdicts: entries.map((entry) => entry.verdict),
    reasons: entries.map((entry) => entry.reason),
    weak_sections: weakSections,
    review_step: firstSectionIndex(timeline, weakSections),
  };
}

function sectionHeading(
  sectionId: string,
  note: ConceptNoteForPlayer
): string {
  const deepMatch = /^deep_explanation\.(\d+)$/.exec(sectionId);
  if (deepMatch) {
    const idx = Number.parseInt(deepMatch[1], 10);
    return note.deep_explanation?.[idx]?.heading ?? sectionId;
  }
  switch (sectionId) {
    case "long_intro":
      return "Introduction";
    case "code_example":
      return "Code example";
    case "common_mistakes":
      return "Common mistakes";
    case "real_world_usage":
      return "In the real world";
    case "key_takeaways":
      return "Key takeaways";
    case "formal_definition":
      return "Formal definition";
    default:
      return sectionId;
  }
}

/** Renders one lesson section from the concept note. */
function SectionRenderer({
  sectionId,
  note,
}: {
  sectionId: string;
  note: ConceptNoteForPlayer;
}) {
  if (sectionId === "long_intro") {
    const text = note.long_intro ?? note.summary;
    return (
      <article className="prose-lesson">
        <h2 className="font-heading text-[28px] leading-tight">Introduction</h2>
        {text.split(/\n\n+/).map((p, i) => (
          <p key={i} className="mt-4 text-lg leading-[1.75]">
            {p}
          </p>
        ))}
      </article>
    );
  }

  const deepMatch = /^deep_explanation\.(\d+)$/.exec(sectionId);
  if (deepMatch) {
    const idx = Number.parseInt(deepMatch[1], 10);
    const section = note.deep_explanation?.[idx];
    if (!section) {
      return <p className="text-inkfaded">Section not available.</p>;
    }
    return (
      <article className="prose-lesson">
        <h2 className="font-heading text-[28px] leading-tight">{section.heading}</h2>
        {section.body.split(/\n\n+/).map((p, i) => (
          <p key={i} className="mt-4 text-lg leading-[1.75]">
            {p}
          </p>
        ))}
        {section.code && (
          <div className="mt-6">
            <CalculatorCode code={section.code} universal_explanation="" />
          </div>
        )}
      </article>
    );
  }

  if (sectionId === "code_example" && note.code_example) {
    return (
      <article className="prose-lesson">
        <h2 className="font-heading text-[28px] leading-tight">Code example</h2>
        <div className="mt-4">
          <CalculatorCode
            code={note.code_example.code}
            universal_explanation={note.code_example.universal_explanation}
          />
        </div>
      </article>
    );
  }

  if (sectionId === "common_mistakes") {
    const mistakes = note.common_mistakes ?? [];
    return (
      <article className="prose-lesson">
        <h2 className="font-heading text-[28px] leading-tight">Common mistakes</h2>
        <ul className="mt-4 flex flex-col gap-3">
          {mistakes.map((m, i) => (
            <li
              key={i}
              className="rounded-sm border-l-4 px-4 py-3"
              style={{
                borderLeftColor: "var(--terracotta)",
                backgroundColor: "var(--paper-dark)",
              }}
            >
              {m}
            </li>
          ))}
        </ul>
      </article>
    );
  }

  if (sectionId === "real_world_usage") {
    return (
      <article className="prose-lesson">
        <h2 className="font-heading text-[28px] leading-tight">In the real world</h2>
        <blockquote
          className="mt-4 border-l-4 pl-5 text-lg leading-[1.75] italic"
          style={{ borderLeftColor: "var(--brass)" }}
        >
          {note.real_world_usage ?? "—"}
        </blockquote>
      </article>
    );
  }

  if (sectionId === "key_takeaways") {
    const takes = note.key_takeaways ?? [];
    return (
      <article className="prose-lesson">
        <h2 className="font-heading text-[28px] leading-tight">Key takeaways</h2>
        <ul className="mt-4 flex flex-col gap-2">
          {takes.map((t, i) => (
            <li key={i} className="flex gap-2 text-lg leading-[1.75]">
              <span style={{ color: "var(--moss)" }}>✓</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </article>
    );
  }

  if (sectionId === "formal_definition" && note.formal_definition) {
    return (
      <article className="prose-lesson">
        <h2 className="font-heading text-[28px] leading-tight">Formal definition</h2>
        <p className="mt-4 text-lg leading-[1.75]">{note.formal_definition}</p>
      </article>
    );
  }

  return <p className="text-inkfaded">Unknown section: {sectionId}</p>;
}

/** The right answer, rendered from data already in the question. No AI call. */
function CorrectAnswer({
  item,
  reason,
}: {
  item: InteractionItem | undefined;
  reason: string | null;
}) {
  if (!item) return null;
  switch (item.type) {
    case "fill_blank":
      return (
        <p className="text-sm text-ink">
          Correct: {item.options[item.correct_index] ?? "—"}
        </p>
      );
    case "predict":
      return (
        <p className="text-sm text-ink">
          Correct: {item.choices[item.correct_index] ?? "—"}
        </p>
      );
    case "spot_mistake":
      return (
        <p className="text-sm text-ink">
          Correct: line {item.wrong_line} is the mistake
        </p>
      );
    case "order_steps":
      return (
        <div className="text-sm text-ink">
          <p>Correct order:</p>
          <ol className="ml-5 list-decimal">
            {item.correct_order.map((value, i) => (
              <li key={`${i}-${value}`}>{item.items[value] ?? `Step ${value + 1}`}</li>
            ))}
          </ol>
        </div>
      );
    case "drag_match":
      return (
        <ul className="text-sm text-ink">
          {item.pairs.map((pair) => (
            <li key={pair.term}>
              {pair.term} — {pair.definition}
            </li>
          ))}
        </ul>
      );
    case "explain":
      return (
        <div className="text-sm text-ink">
          {reason && <p>{reason}</p>}
          <p className="mt-1 text-inkfaded">Your answer was graded by AI.</p>
        </div>
      );
    case "code_editor":
      return (
        <div className="text-sm text-ink">
          {reason && <p>{reason}</p>}
          <p className="mt-1 text-inkfaded">Your code was graded by AI.</p>
          <pre
            className="mt-2 overflow-x-auto rounded-md p-3 font-mono text-xs"
            style={{ backgroundColor: "var(--bg-code)", color: "#E2E8F0" }}
          >
            {item.reference_code}
          </pre>
        </div>
      );
    default:
      return null;
  }
}

function QuestionReviewCard({
  number,
  item,
  answer,
  reason,
}: {
  number: number;
  item: InteractionItem | undefined;
  answer: ReviewAnswerEntry | undefined;
  reason: string | null;
}) {
  const correct = answer?.correct ?? false;
  const text = questionText(item);

  return (
    <div
      className="card"
      style={{
        borderLeft: `4px solid ${
          correct ? "var(--success)" : "var(--error)"
        }`,
      }}
    >
      <div className="flex items-center gap-2">
        {correct ? (
          <CheckCircle2 size={18} className="text-success" />
        ) : (
          <XCircle size={18} className="text-error" />
        )}
        <p className="text-sm font-semibold uppercase tracking-wide text-inkmuted">
          Question {number}
        </p>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-ink">{text || "—"}</p>
      <p className="mt-3 text-sm text-ink">
        <span className="text-inkfaint">Your answer: </span>
        {answer?.userAnswer || "—"}
      </p>
      <div className="mt-1">
        <CorrectAnswer item={item} reason={reason} />
      </div>
      <p
        className={`mt-2 text-sm font-semibold ${
          correct ? "text-success" : "text-error"
        }`}
      >
        {correct ? "Correct" : "Incorrect"}
      </p>
    </div>
  );
}

function InteractionRenderer({
  item,
  conceptId,
  tier,
  sequenceIndex,
  onComplete,
  locked,
}: {
  item: InteractionItem;
  conceptId: number;
  tier: string;
  sequenceIndex: number;
  onComplete: OnComplete;
  locked?: boolean;
}) {
  switch (item.type) {
    case "fill_blank":
      return <FillBlank item={item} onComplete={onComplete} locked={locked} />;
    case "drag_match":
      return <DragMatch item={item} onComplete={onComplete} locked={locked} />;
    case "order_steps":
      return <OrderSteps item={item} onComplete={onComplete} locked={locked} />;
    case "predict":
      return <Predict item={item} onComplete={onComplete} locked={locked} />;
    case "spot_mistake":
      return <SpotMistake item={item} onComplete={onComplete} locked={locked} />;
    case "explain":
      return (
        <Explain
          item={item}
          conceptId={conceptId}
          tier={tier}
          sequenceIndex={sequenceIndex}
          onComplete={onComplete}
          locked={locked}
        />
      );
    case "code_editor":
      return (
        <CodeEditor
          item={item}
          conceptId={conceptId}
          tier={tier}
          sequenceIndex={sequenceIndex}
          onComplete={onComplete}
          locked={locked}
        />
      );
    default:
      return (
        <p className="card text-inkfaded">
          This interaction type is not supported in the player.
        </p>
      );
  }
}

export default function LessonPlayer({
  timeline,
  conceptNote,
  test,
  conceptId,
  tier,
  conceptTitle,
  conceptSlug,
  initialMastery,
  initialStep = 0,
  initialCompletedAt = null,
  initialReview,
  storedTestReview,
  initialPhase = "learn",
}: Props) {
  const router = useRouter();
  const total = timeline.length;
  // The bank size and how many of it the test asks. Equal at five questions;
  // kept separate so a longer bank is still capped at TEST_LENGTH.
  const testPoolSize = test?.questions.length ?? 0;
  const testLength = Math.min(TEST_LENGTH, testPoolSize);

  const [step, setStep] = useState(() =>
    Math.max(0, Math.min(initialStep, Math.max(total - 1, 0)))
  );
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [answeredSteps, setAnsweredSteps] = useState<Set<number>>(() => new Set());
  // Adaptive test: `testSequence` is the ordered list of question-bank indices
  // and `currentIndex` points at the one on screen. The bank index (not the
  // display position) identifies a question for grading and the answer key.
  const [testSequence, setTestSequence] = useState<number[]>(() => [
    firstTestIndex(testPoolSize),
  ]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const testQuestionIndex =
    testSequence[currentIndex] ??
    testSequence[testSequence.length - 1] ??
    firstTestIndex(testPoolSize);
  const [testScores, setTestScores] = useState<number[]>([]);
  const [testEntries, setTestEntries] = useState<TestEntry[]>([]);
  // True once the current question has been graded. The learner advances with
  // an explicit button so the feedback is actually read.
  const [testAnswered, setTestAnswered] = useState(false);
  const [testResult, setTestResult] = useState<ResultState | null>(null);
  // Distinguishes a freshly-submitted result from one rebuilt from the stored
  // test_reviews answer key, which changes the header and the actions.
  const [resultSource, setResultSource] = useState<ResultSource>("fresh");
  // Holds the result card back while the unlock overlay plays, so a pass
  // lands on the celebration instead of a wall of text.
  const [unlockCelebration, setUnlockCelebration] = useState(false);
  const [sessionSparks, setSessionSparks] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [completedAt, setCompletedAt] = useState<string | null>(initialCompletedAt);
  const [banner, setBanner] = useState<"resume" | "completed" | null>(() => {
    if (initialCompletedAt) return "completed";
    if (initialStep > 0) return "resume";
    return null;
  });
  const [reviewStep, setReviewStep] = useState(initialReview?.review_step ?? 0);
  // "Review weak spots" is only honest when a test attempt actually recorded
  // weak sections; otherwise the button just jumps back to step 0.
  const [hasReviewData, setHasReviewData] = useState(
    () => initialReview != null
  );
  // Hidden by default, even on a revisit.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Per-step reframed activities, keyed by timeline index (the same
  // `sequence` the grading routes already use). The base activity is always
  // rendered first and only swapped once a reframe lands, so nothing waits on
  // the network.
  const [reframes, setReframes] = useState<Record<number, InteractionItem>>(
    {}
  );
  // Steps with a request already sent this session, so the mount fetch and the
  // prefetch never double-call the same activity.
  const reframeRequested = useRef<Set<number>>(new Set());
  // Mirrored in a ref so the reframe updater can read it without the closure
  // going stale: a prefetched reframe must not land on a step the learner has
  // already answered, or it rewords the question above their own submitted
  // answer and leaves the graded result describing text they never read.
  const answeredStepsRef = useRef<Set<number>>(answeredSteps);
  answeredStepsRef.current = answeredSteps;

  // Only offered once the lesson has been completed (completed_at is written
  // when the test is passed), so a first-timer never sees it.
  const sidebarAvailable = completedAt !== null;

  // The furthest step reached this visit or any previous one. A ref, because
  // it only ever grows and must not re-render the sidebar.
  const furthestStepRef = useRef(initialStep);
  if (step > furthestStepRef.current) {
    furthestStepRef.current = step;
  }

  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStep = useRef<number | null>(null);
  // When the current test attempt began, for the "time taken" stat.
  const testStartRef = useRef<number | null>(null);
  // Last mastery value the server has confirmed, so the toast can show the
  // real delta and the ring gets a "no change" guard. Mirrored in a ref: the
  // callbacks that read it must not re-subscribe on every answer.
  const knownMastery = useRef(initialMastery);

  /**
   * Publish a confirmed mastery value to the header MasteryRing.
   *
   * The ring is rendered by the server page, so it never re-renders while the
   * learner works through the lesson. Without this the ring sits at the value
   * fetched on page load until they navigate away and back. Every write path
   * (mastery-update, answer, test-submit) funnels through here.
   */
  const announceMastery = useCallback((mastery: number) => {
    const previous = knownMastery.current;
    const next = Math.max(0, Math.min(1, mastery));
    knownMastery.current = next;
    if (Math.abs(next - previous) < 0.0005) return;

    window.dispatchEvent(
      new CustomEvent("learnova:mastery-update", {
        detail: { conceptSlug: conceptSlug, mastery: next },
      })
    );
    const delta = Math.round((next - previous) * 100);
    if (delta > 0) {
      fireToast(`Mastery +${delta}%`, "spark");
    }
  }, [conceptSlug]);

  void conceptTitle;

  useEffect(() => {
    void fetch("/api/concept-open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conceptId }),
    }).catch(() => {});
  }, [conceptId]);

  // —— Lesson progress persistence (Bug 1) ——
  // Mirrored in a ref so posting progress does not depend on the answered set
  // changing identity.
  const answeredCountRef = useRef(answeredSteps.size);
  answeredCountRef.current = answeredSteps.size;

  const postProgress = useCallback(
    (lastStep: number) => {
      void fetch("/api/lesson-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conceptId,
          tier,
          lastStep,
          activitiesAnswered: answeredCountRef.current,
        }),
      }).catch(() => {});
    },
    [conceptId, tier]
  );

  const clearProgressWrite = useCallback(() => {
    if (progressTimer.current !== null) {
      clearTimeout(progressTimer.current);
      progressTimer.current = null;
    }
    pendingStep.current = null;
  }, []);

  const flushProgressWrite = useCallback(() => {
    if (progressTimer.current !== null) {
      clearTimeout(progressTimer.current);
      progressTimer.current = null;
    }
    const target = pendingStep.current;
    pendingStep.current = null;
    if (target === null) return;
    postProgress(target);
  }, [postProgress]);

  const scheduleProgressWrite = useCallback(
    (nextStep: number) => {
      if (progressTimer.current !== null) {
        clearTimeout(progressTimer.current);
      }
      pendingStep.current = nextStep;
      progressTimer.current = setTimeout(() => {
        progressTimer.current = null;
        flushProgressWrite();
      }, PROGRESS_WRITE_DEBOUNCE_MS);
    },
    [flushProgressWrite]
  );

  // Every step change (Next, Back, activity complete) persists a step.
  // Leaving the learn phase flushes rather than drops the pending write: the
  // last step is what records "the lesson was finished", so stepping straight
  // into the test must not lose it.
  useEffect(() => {
    if (phase === "learn") {
      scheduleProgressWrite(step);
    } else {
      flushProgressWrite();
    }
  }, [step, phase, scheduleProgressWrite, flushProgressWrite]);

  // Don't lose the final step when the tab is closed mid-lesson.
  useEffect(() => {
    return () => {
      flushProgressWrite();
    };
  }, [flushProgressWrite]);

  const current: TimelineItem | undefined = timeline[step];

  const requestReframe = useCallback(
    (targetStep: number) => {
      if (reframeRequested.current.has(targetStep)) return;
      reframeRequested.current.add(targetStep);

      void fetch("/api/reframe-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conceptId,
          tier,
          sequenceIndex: targetStep,
        }),
      })
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as {
            ok?: boolean;
            framed?: boolean;
            activity?: unknown;
          };
          const parsed = InteractionItemSchema.safeParse(data.activity);
          if (!data.ok || !parsed.success) return;
          // A `framed: false` response is the base activity handed back on a
          // generation failure. Storing it would pin unpersonalised wording for
          // the rest of the session, so it is deliberately not remembered.
          if (data.framed !== true) return;
          setReframes((prev) => {
            if (answeredStepsRef.current.has(targetStep)) return prev;
            return { ...prev, [targetStep]: parsed.data };
          });
        })
        // Non-blocking by contract: a failed reframe leaves the base activity
        // in place and the learner is never shown an error.
        .catch(() => {});
    },
    [conceptId, tier]
  );

  // Reframes the activity on screen plus the next three. Fire-and-forget, and
  // only for positions that actually hold a reframable activity, so a lesson
  // costs one request per new activity rather than one per render.
  useEffect(() => {
    if (phase !== "learn") return;
    const upcoming: number[] = [];
    for (let i = step; i < Math.min(step + 4, total); i++) {
      if (timeline[i]?.type === "activity") upcoming.push(i);
    }
    for (const target of upcoming) requestReframe(target);
  }, [phase, step, total, timeline, requestReframe]);

  /**
   * What the learner reads for the current step: the reframe when one has
   * landed, otherwise the authored activity. Never a partial merge — the route
   * returns a whole validated activity, so the shape can never drift.
   */
  const displayActivity = useMemo(() => {
    if (!current || current.type !== "activity") return null;
    return reframes[step] ?? current.activity;
  }, [current, reframes, step]);

  // Next unlocks as soon as the activity has been *attempted*, whatever the
  // score — a wrong answer still shows feedback and the learner must be able
  // to move on. `answeredSteps` is written on every `onComplete`.
  const isActivityUnanswered = useMemo(() => {
    if (!current || current.type !== "activity") return false;
    return !answeredSteps.has(step);
  }, [current, answeredSteps, step]);

  const startOver = useCallback(() => {
    // Drop the pending write so the stale step is not persisted; the effect
    // below immediately schedules a write for step 0.
    clearProgressWrite();
    setBanner(null);
    setStep(0);
  }, [clearProgressWrite]);

  const goToReviewStep = useCallback(() => {
    clearProgressWrite();
    setBanner(null);
    setStep(reviewStep);
    setPhase("learn");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [clearProgressWrite, reviewStep]);

  /** Sidebar jump. Only ever called with a step the learner has reached. */
  const goToStep = useCallback(
    (target: number) => {
      clearProgressWrite();
      setBanner(null);
      setStep(Math.max(0, Math.min(target, Math.max(total - 1, 0))));
      setPhase("learn");
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [clearProgressWrite, total]
  );

  // Steps the sidebar may offer: everything up to the furthest reached.
  const reachedSteps = useMemo(
    () => Array.from({ length: furthestStepRef.current + 1 }, (_, i) => i),
    // Recomputed when the learner moves forward.
    [step, initialStep]
  );

  const handleActivityComplete: OnComplete = useCallback(
    (score, userAnswer, grading) => {
      // The reframe the learner was shown, not the authored base: grading
      // against text they never read is how a correct answer scores as wrong.
      const interaction = displayActivity;

      setAnsweredSteps((prev) => {
        const next = new Set(prev);
        next.add(step);
        return next;
      });

      // explain and code_editor grade themselves through /api/answer, which
      // already moved mastery. Announce that value first so the ring responds
      // to the same tap that produced it.
      if (typeof grading?.newMastery === "number") {
        announceMastery(grading.newMastery);
      }

      void fetch("/api/mastery-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // tier + sequence + interaction_type let the server record the attempt
        // and tell a first try (Sparks) from a retry (mastery only).
        body: JSON.stringify({
          concept_id: conceptId,
          score,
          tier,
          sequence: step,
          interaction_type: interaction?.type,
          question: interaction ? questionText(interaction) : undefined,
          user_answer: userAnswer,
        }),
      })
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as {
            sparks?: number;
            newBadges?: { name: string }[];
            new_mastery?: number;
          };
          if (typeof data.new_mastery === "number") {
            announceMastery(data.new_mastery);
          }
          if (typeof data.sparks === "number" && data.sparks > 0) {
            fireToast(`+${data.sparks} Sparks`, "spark");
            setSessionSparks((s) => s + data.sparks!);
          }
          if (data.newBadges) {
            for (const b of data.newBadges) {
              fireToast(`🏆 Badge unlocked: ${b.name}`, "badge");
            }
          }
        })
        .catch(() => {});
    },
    [step, conceptId, tier, timeline, announceMastery]
  );

  function goNext() {
    if (step + 1 >= total) {
      // Lesson complete. Persist the final step before leaving "learn".
      flushProgressWrite();
      void fetch("/api/lesson-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptId, tier }),
      })
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as {
            sparks?: number;
            newBadges?: { name: string }[];
          };
          if (typeof data.sparks === "number" && data.sparks > 0) {
            fireToast(`+${data.sparks} Sparks`, "spark");
            setSessionSparks((s) => s + data.sparks!);
          }
          if (data.newBadges) {
            for (const b of data.newBadges) {
              fireToast(`🏆 Badge unlocked: ${b.name}`, "badge");
            }
          }
        })
        .catch(() => {});
      setPhase("complete");
      return;
    }
    // Reading a section deliberately does not touch mastery. It used to post a
    // 0.6 score to /api/mastery-update here, which meant rereading material
    // drifted mastery toward 0.6 and the ring moved for work that was not
    // work. Reading is tracked by /api/lesson-progress and paid for in Sparks
    // by /api/section-read, which never writes learners.mastery.
    if (current?.type === "section") {
      void fetch("/api/section-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptId }),
      })
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json().catch(() => ({}))) as {
            sparks?: number;
            newBadges?: { name: string }[];
          };
          if (typeof data.sparks === "number" && data.sparks > 0) {
            fireToast(`+${data.sparks} Sparks`, "spark");
            setSessionSparks((s) => s + data.sparks!);
          }
          if (data.newBadges) {
            for (const b of data.newBadges) {
              fireToast(`🏆 Badge unlocked: ${b.name}`, "badge");
            }
          }
        })
        .catch(() => {});
    }
    setStep((s) => s + 1);
  }

  function goBack() {
    if (step > 0) setStep((s) => s - 1);
  }

  function startTest() {
    flushProgressWrite();
    testStartRef.current = Date.now();
    setTestSequence([firstTestIndex(testPoolSize)]);
    setCurrentIndex(0);
    setTestScores([]);
    setTestEntries([]);
    setTestAnswered(false);
    setTestResult(null);
    setResultSource("fresh");
    // Never leave the overlay armed across a new attempt.
    setUnlockCelebration(false);
    setPhase("test");
  }

  /**
   * Raised when a fresh attempt passes. The result card stays withheld while
   * the overlay plays, so the pass lands on the celebration rather than on a
   * wall of text. The paired toast is fired on completion instead of here: at
   * this point the overlay is on top, and toasts render beneath it.
   */
  function celebrateUnlock() {
    setUnlockCelebration(true);
  }

  function submitTest(entries: TestEntry[], scores: number[]) {
    const avg = scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1);
    const passed = avg >= 0.8;
    const questions: InteractionItem[] = test?.questions ?? [];
    const timeTakenSec = testStartRef.current
      ? Math.max(1, Math.round((Date.now() - testStartRef.current) / 1000))
      : 0;
    // Built locally so the result screen still works if the write fails.
    const localReview = buildReview(entries, questions, timeline);
    setHasReviewData(true);

    setSubmitting(true);
    void fetch("/api/test-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conceptId,
        tier,
        score: avg,
        passed,
        answers: entries.map((entry) => ({
          index: entry.index,
          question: questionText(questions[entry.index]),
          userAnswer: entry.userAnswer,
          correct: entry.verdict === "correct",
          verdict: entry.verdict,
          reason: entry.reason,
        })),
      }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          sparks?: number;
          newBadges?: { name: string }[];
          new_mastery?: number | null;
          review?: {
            weak_sections?: string[];
            review_step?: number;
          };
        };
        if (typeof data.new_mastery === "number") {
          announceMastery(data.new_mastery);
        }
        const sparks = data.sparks ?? 0;
        if (sparks > 0) {
          setSessionSparks((s) => s + sparks);
          // On a pass the award is reported in the unlock toast instead, so
          // the learner does not get two competing Spark notifications.
          if (!passed) fireToast(`+${sparks} Sparks`, "spark");
        }
        if (data.newBadges) {
          for (const b of data.newBadges) {
            fireToast(`🏆 Badge unlocked: ${b.name}`, "badge");
          }
        }
        const serverStep =
          typeof data.review?.review_step === "number"
            ? data.review.review_step
            : null;
        const nextStep = serverStep ?? localReview.review_step;
        if (passed) {
          setCompletedAt(new Date().toISOString());
          setBanner("completed");
          celebrateUnlock();
        }
        setReviewStep(nextStep);
        setTestResult({
          score: avg,
          passed,
          sparks,
          timeTakenSec,
          review: {
            ...localReview,
            weak_sections:
              data.review?.weak_sections ?? localReview.weak_sections,
            review_step: nextStep,
          },
        });
        setPhase("result");
      })
      .catch(() => {
        setTestResult({
          score: avg,
          passed,
          sparks: 0,
          timeTakenSec,
          review: localReview,
        });
        setReviewStep(localReview.review_step);
        if (passed) {
          setCompletedAt(new Date().toISOString());
          setBanner("completed");
          celebrateUnlock();
        }
        setPhase("result");
      })
      .finally(() => setSubmitting(false));
  }

  function handleTestAnswer(
    score: number,
    userAnswer: string,
    grading?: InteractionGrading
  ) {
    // One entry per question, however many times onComplete fires.
    if (testAnswered || submitting) return;

    const index = testQuestionIndex;
    const verdict = grading?.verdict ?? localVerdict(score);
    const nextScores = [...testScores, score];
    setTestScores(nextScores);

    const nextEntries: TestEntry[] = [
      ...testEntries,
      {
        index,
        userAnswer,
        verdict,
        reason:
          grading?.reason ??
          localReason(test?.questions[index], score, verdict),
      },
    ];
    setTestEntries(nextEntries);

    // Feedback now stays on screen. Moving to the next question is the
    // learner's decision, made with the button rendered below.
    setTestAnswered(true);
  }

  function advanceTest() {
    if (submitting || !testAnswered) return;

    // Stop once the test has asked its full length.
    if (currentIndex + 1 >= testLength) {
      submitTest(testEntries, testScores);
      return;
    }

    // The next question follows the verdict of the one just answered: correct
    // moves harder, anything else (partial or wrong) moves easier.
    const lastVerdict = testEntries[testEntries.length - 1]?.verdict ?? "wrong";
    const next = nextAdaptiveIndex(
      testSequence,
      testQuestionIndex,
      lastVerdict === "correct",
      testPoolSize
    );

    // Only reachable if the bank is smaller than TEST_LENGTH.
    if (next === null) {
      submitTest(testEntries, testScores);
      return;
    }

    setTestSequence((seq) => [...seq, next]);
    setCurrentIndex((i) => i + 1);
    setTestAnswered(false);
  }

  /**
   * Rebuilds the result screen from the stored answer key. No submission and
   * no AI call happen here — the review was already graded and persisted.
   */
  const openStoredReview = useCallback(() => {
    if (!storedTestReview) return;
    const correct = storedTestReview.verdicts.filter(
      (v) => v === "correct"
    ).length;
    const totalQuestions = Math.max(storedTestReview.verdicts.length, 1);
    const score = correct / totalQuestions;
    const weakSections = initialReview?.weak_sections ?? [];
    setReviewStep(initialReview?.review_step ?? 0);
    setTestResult({
      score,
      passed: score >= 0.8,
      sparks: 0,
      timeTakenSec: 0,
      review: {
        questions: storedTestReview.questions,
        answers: storedTestReview.answers,
        verdicts: storedTestReview.verdicts,
        reasons: storedTestReview.reasons,
        weak_sections: weakSections,
        review_step: initialReview?.review_step ?? 0,
      },
    });
    setResultSource("stored");
    // Re-opening a past attempt is not a new unlock, so no celebration.
    setUnlockCelebration(false);
    setPhase("result");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [storedTestReview, initialReview]);

  /** Leaves a stored result and returns to the lesson the learner was reading. */
  const backToLesson = useCallback(() => {
    setResultSource("fresh");
    setUnlockCelebration(false);
    setPhase("learn");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // —— RENDER phases ——
  // Strong on the concept from a diagnostic or earlier training, but this
  // lesson has never been opened. Offer the test instead of forcing a re-read.
  if (phase === "skip_choice") {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft">
          <Sparkles size={26} className="text-primary" />
        </span>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-primary">
          Already strong on this
        </p>
        <h2 className="mt-3 font-heading text-3xl">
          You&apos;ve tested at {Math.round(initialMastery * 100)}% mastery on
          &quot;{conceptTitle}&quot;.
        </h2>
        <p className="mt-2 text-inkmuted">
          What would you like to do?
        </p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            className="btn-primary"
            onClick={startTest}
            disabled={!test}
          >
            Take the test directly <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setStep(0);
              setPhase("learn");
            }}
          >
            <BookOpen size={16} /> Read the lesson from the start
          </button>
        </div>

        {!test && (
          <p className="mt-4 text-sm text-inkmuted">
            Test not available for this concept yet.
          </p>
        )}
      </div>
    );
  }

  if (phase === "complete") {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-soft">
          <Trophy size={32} className="text-success" />
        </span>
        <h2 className="mt-4 font-heading text-3xl">
          You&apos;ve finished reading.
        </h2>
        <p className="mt-2 text-inkmuted">Ready for the test?</p>
        {sessionSparks > 0 && (
          <p className="mt-2 text-sm font-semibold text-success">
            +{sessionSparks} Sparks this session
          </p>
        )}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            className="btn-primary"
            onClick={startTest}
            disabled={!test}
          >
            Take the test <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setStep(0);
              setPhase("learn");
            }}
          >
            Review sections
          </button>
        </div>
        {!test && (
          <p className="mt-4 text-sm text-inkmuted">
            Test not available yet. You can return to the dashboard.
          </p>
        )}
      </div>
    );
  }

  if (phase === "test" && test) {
    const q = test.questions[testQuestionIndex];
    return (
      <div className="mx-auto max-w-[720px]">
        <div className="mb-5 flex items-center justify-between gap-4">
          <p className="text-sm font-semibold text-inkmuted">
            Question {currentIndex + 1} <span className="text-inkfaint">of {testLength}</span>
          </p>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bgsubtle">
            <div
              className="progress-fill h-full rounded-full bg-primary"
              style={{
                width: `${testLength === 0 ? 0 : ((currentIndex + 1) / testLength) * 100}%`,
              }}
            />
          </div>
        </div>
        {submitting ? (
          <p className="card text-center text-inkmuted">Scoring…</p>
        ) : (
          <>
            <div
              className="card"
              style={{ borderLeft: `4px solid ${interactionAccent(q.type)}` }}
            >
              <InteractionRenderer
                item={q}
                conceptId={conceptId}
                tier={tier}
                // The bank index, not the display position, so a graded answer
                // is recorded against the question that was actually asked.
                sequenceIndex={testQuestionIndex}
                // Same reason as the lesson call site: two test questions of the
                // same type would otherwise share one instance.
                key={`${conceptId}-${tier}-test-${testQuestionIndex}`}
                // A test question is scored once: the graded interaction stays on
                // screen for the feedback, but it stops accepting input.
                locked={testAnswered}
                onComplete={(score, userAnswer, grading) =>
                  handleTestAnswer(score, userAnswer, grading)
                }
              />
            </div>
            {testAnswered && (
              <div className="mt-8 flex justify-end border-t border-bgsubtle pt-6">
                <button type="button" className="btn-primary" onClick={advanceTest}>
                  {currentIndex + 1 >= testLength ? "Finish test" : "Next question"}
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  if (phase === "result" && testResult) {
    const { passed, review, timeTakenSec } = testResult;
    const isStoredResult = resultSource === "stored";
    const correctCount = review.verdicts.filter((v) => v === "correct").length;
    const totalQuestions = review.verdicts.length;
    const pct = totalQuestions === 0 ? 0 : Math.round((correctCount / totalQuestions) * 100);
    const weakHeadings = review.weak_sections.map((id) =>
      sectionHeading(id, conceptNote)
    );

    const reviewSection = (
      <div className="mt-10 text-left">
        <h3 className="font-heading text-xl">Answer key</h3>
        <div className="mt-4 flex flex-col gap-4">
          {review.answers.map((answer, i) => (
            <QuestionReviewCard
              key={i}
              number={i + 1}
              // The bank index, not the display position: with an adaptive
              // order the two differ, and `review.questions` is the full bank.
              item={review.questions[answer.index] ?? test?.questions[answer.index]}
              answer={answer}
              reason={review.reasons[i] ?? null}
            />
          ))}
        </div>
      </div>
    );

    const weakSection =
      weakHeadings.length > 0 ? (
        <div className="card mt-8 text-left" style={{ borderLeft: "4px solid var(--warning)" }}>
          <div className="flex items-center gap-2">
            <TrendingDown size={18} className="text-warning" />
            <p className="font-semibold">
              You struggled with: {weakHeadings.join(", ")}
            </p>
          </div>
          <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row">
            <button type="button" className="btn-primary" onClick={goToReviewStep}>
              Review these sections
            </button>
            {passed && !isStoredResult && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => router.push("/me")}
              >
                Back to dashboard
              </button>
            )}
            {!passed && (
              <button type="button" className="btn-secondary" onClick={startTest}>
                Retake test
              </button>
            )}
          </div>
        </div>
      ) : null;

    // A fresh pass celebrates first; the card is withheld until the overlay
    // steps aside. A stored attempt or a fail goes straight to the card.
    const celebrating = passed && !isStoredResult && unlockCelebration;

    const resultCard = (
      <div className="mx-auto max-w-[720px] py-8 text-center">
        {isStoredResult ? (
          <div className="mb-6 flex flex-col items-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft">
              <ClipboardList size={26} className="text-primary" />
            </span>
            <h2 className="mt-4 font-heading text-3xl">
              Your last test attempt
              {storedTestReview?.submitted_at
                ? ` on ${formatStoredDate(storedTestReview.submitted_at)}`
                : ""}
            </h2>
            <p className="mt-1 text-inkmuted">
              You scored {correctCount} of {totalQuestions}.
            </p>
          </div>
        ) : passed ? (
          <div className="modal-panel">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-soft">
              <Trophy size={32} className="text-success" />
            </span>
            <h2 className="mt-4 font-heading text-3xl">
              You scored {correctCount} of {totalQuestions}.
            </h2>
            <p className="mt-3 font-heading text-[56px] leading-none text-success">
              {pct}%
            </p>
          </div>
        ) : (
          <div className="modal-panel">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-error-soft">
              <Target size={32} className="text-error" />
            </span>
            <h2 className="mt-4 font-heading text-3xl">Not quite.</h2>
            <p className="mt-3 font-heading text-[56px] leading-none text-error">
              {pct}%
            </p>
            <p className="mt-2 text-inkmuted">
              You scored {correctCount} of {totalQuestions}. The answer key
              below shows what to revisit.
            </p>
          </div>
        )}

        {(testResult.sparks > 0 || timeTakenSec > 0 || !isStoredResult) && (
          <div className="mx-auto mt-8 flex max-w-md items-center justify-center gap-8 rounded-lg border border-bgsubtle bg-bgcard px-4 py-3 text-sm">
            {testResult.sparks > 0 && (
              <span className="text-inkmuted">
                <Sparkles size={14} className="mr-1 inline text-sparks" />
                +{testResult.sparks} Sparks
              </span>
            )}
            {timeTakenSec > 0 && (
              <span className="text-inkmuted">
                <Clock size={14} className="mr-1 inline text-inkfaint" />
                {formatTimeTaken(timeTakenSec)}
              </span>
            )}
            <span className="text-inkmuted">
              {correctCount} of {totalQuestions} correct
            </span>
          </div>
        )}

        {reviewSection}
        {weakSection}
        {isStoredResult ? (
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button type="button" className="btn-primary" onClick={startTest}>
              Take a new test <ArrowRight size={16} />
            </button>
            <button type="button" className="btn-secondary" onClick={backToLesson}>
              <ArrowLeft size={16} /> Back to lesson
            </button>
          </div>
        ) : passed ? (
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                if (initialCompletedAt === null) {
                  // First completion: the server had no completed_at for this
                  // lesson, so nudge the learner toward the sidebar toggle
                  // that will be waiting for them next visit.
                  fireToast(
                    "You can now open the contents (☰) to jump between sections on future visits.",
                    "badge"
                  );
                }
                router.push("/me");
              }}
            >
              Continue to next concept <ArrowRight size={16} />
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                fireToast(
                  "Your review is saved — open this lesson later and pick 'View your last test' from the banner."
                )
              }
            >
              Review this later from the banner
            </button>
          </div>
        ) : weakSection ? null : (
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <button type="button" className="btn-primary" onClick={startTest}>
              Retake test
            </button>
          </div>
        )}
      </div>
    );

    return (
      <>
        {!celebrating && resultCard}
        <UnlockOverlay
          show={celebrating}
          onComplete={() => {
            setUnlockCelebration(false);
            // Fired here rather than at pass time so it is not hidden behind
            // the overlay, and so it lands with the revealed result card.
            fireToast(
              testResult.sparks > 0
                ? `+${testResult.sparks} Sparks · Next concept unlocked!`
                : "Next concept unlocked!",
              "spark"
            );
          }}
          conceptTitle={conceptTitle}
        />
      </>
    );
  }

  // phase === "learn"
  return (
    <div className="flex gap-4">
      {sidebarAvailable && (
        <LessonSidebar
          timeline={timeline}
          note={conceptNote}
          currentStep={step}
          completedSteps={reachedSteps}
          open={sidebarOpen}
          onNavigate={goToStep}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-[720px]">
          {banner === "resume" && (
            <div
              className="sticky top-0 z-10 mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border-l-4 bg-warning-soft px-4 py-3 text-sm"
              style={{ borderLeftWidth: 4, borderLeftColor: "var(--warning)" }}
            >
              <span>Resuming from where you left off.</span>
              <button
                type="button"
                className="font-semibold text-warning underline-offset-2 hover:underline"
                onClick={startOver}
              >
                Start over
              </button>
            </div>
          )}

          {banner === "completed" && completedAt !== null && (
            <div
              className="mb-6 rounded-lg border-l-4 bg-success-soft px-4 py-4"
              style={{ borderLeftWidth: 4, borderLeftColor: "var(--success)" }}
            >
              <p className="font-semibold text-success">
                You&apos;ve completed this lesson before.
              </p>
              <p className="mt-0.5 text-sm text-inkmuted">
                Review your weak spots, view the saved test, or start from the
                beginning.
              </p>
              <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row">
                {hasReviewData && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={goToReviewStep}
                  >
                    Review weak spots
                  </button>
                )}
                {storedTestReview && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={openStoredReview}
                  >
                    <ClipboardList size={15} /> View your last test
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={startOver}
                >
                  Start from beginning
                </button>
              </div>
            </div>
          )}

          {storedTestReview && (
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md border border-bgsubtle bg-bgcard px-3 py-1.5 text-sm font-semibold text-inkmuted transition-colors hover:border-primary hover:text-primary"
                onClick={openStoredReview}
              >
                <ClipboardList size={14} /> View last test review
              </button>
            </div>
          )}

          <div className="mb-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {sidebarAvailable && (
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-bgsubtle bg-bgcard text-inkmuted transition-colors hover:border-primary hover:text-primary"
                  onClick={() => setSidebarOpen((open) => !open)}
                  aria-expanded={sidebarOpen}
                  aria-controls="lesson-contents"
                  aria-label={sidebarOpen ? "Hide contents" : "Show contents"}
                >
                  <Menu size={15} />
                </button>
              )}
              <p className="text-sm font-semibold text-inkmuted">
                {step + 1} <span className="text-inkfaint">of {total}</span>
              </p>
            </div>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bgsubtle">
              <div
                className="progress-fill h-full rounded-full bg-primary"
                style={{ width: `${total === 0 ? 0 : ((step + 1) / total) * 100}%` }}
              />
            </div>
          </div>

          <div className="min-h-[320px]">
            {current?.type === "section" && (
              <div className="card relative">
                <div className="absolute right-4 top-4 z-10">
                  <SpeakButton
                    key={current.section_id}
                    text={sectionSpeechText(current.section_id, conceptNote)}
                  />
                </div>
                <div className="pr-12">
                  <SectionRenderer sectionId={current.section_id} note={conceptNote} />
                </div>
              </div>
            )}
            {current?.type === "activity" && displayActivity && (
              <div
                className="card"
                style={{ borderLeft: `4px solid ${interactionAccent(displayActivity.type)}` }}
              >
                <InteractionRenderer
                  item={displayActivity}
                conceptId={conceptId}
                tier={tier}
                sequenceIndex={step}
                // Without a key React reuses this instance when the learner
                // moves between two activities of the same type, and the
                // previous question's answer (chosen, clicked, revealed,
                // result) carries over — so the new activity renders as if it
                // were already answered.
                key={`${conceptId}-${tier}-learn-${step}`}
                onComplete={handleActivityComplete}
              />
              </div>
            )}
          </div>

          <div className="mt-10 flex items-center justify-between border-t border-bgsubtle pt-6">
            {step > 0 ? (
              <button
                type="button"
                className="btn-secondary !py-2.5"
                onClick={goBack}
              >
                <ArrowLeft size={15} /> Back
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="btn-primary"
              disabled={isActivityUnanswered}
              onClick={goNext}
            >
              Next <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
