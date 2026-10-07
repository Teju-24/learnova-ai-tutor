"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import FeedbackCard from "@/components/FeedbackCard";

type Props = {
  open: boolean;
  onClose: () => void;
  conceptsCompleted: number;
  /** Display name, so the check-in can greet the learner by name. */
  learnerName?: string;
};

/** Always-available check-in, opened from the floating Feedback button. */
export default function FeedbackModal({
  open,
  onClose,
  conceptsCompleted,
  learnerName,
}: Props) {
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Feedback"
    >
      <div
        className="modal-panel relative w-full max-w-md rounded-lg p-6"
        style={{
          backgroundColor: "var(--bg-card)",
          boxShadow: "0 20px 45px rgba(0,0,0,0.2)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close feedback"
          className="absolute right-4 top-4 rounded-md p-1 text-inkmuted transition-colors hover:text-ink"
        >
          <X size={18} />
        </button>

        <FeedbackCard
          variant="light"
          conceptsCompleted={conceptsCompleted}
          learnerName={learnerName}
          onDismiss={onClose}
          plain
        />
      </div>
    </div>
  );
}
