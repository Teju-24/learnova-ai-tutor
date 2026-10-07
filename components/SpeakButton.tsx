"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Volume2, VolumeX } from "lucide-react";

type SpeakStatus = "idle" | "loading" | "speaking";

/**
 * Reads the given text aloud with the Web Speech API. Click to play, click
 * again while it is playing to stop. The button owns its utterance, and stops
 * speech when the section it belongs to unmounts or changes.
 */
export default function SpeakButton({ text }: { text: string }) {
  const [status, setStatus] = useState<SpeakStatus>("idle");
  const [supported, setSupported] = useState(true);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" && "speechSynthesis" in window
    );
  }, []);

  // Stop whatever is playing when this button leaves the page or the section's
  // text changes underneath it. Do NOT call setState in cleanup — that races
  // unmount and can thrash under React DevTools.
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      utteranceRef.current = null;
    };
  }, [text]);

  function stop() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setStatus("idle");
  }

  function handleClick() {
    if (!supported || !text.trim()) return;

    // Already reading this section: the button toggles it off.
    if (status !== "idle") {
      stop();
      return;
    }

    // Never let two sections speak at once.
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.rate = 1.0;
    // Leave the voice unset so the browser's default is used.

    utteranceRef.current = utterance;
    setStatus("loading");

    utterance.onstart = () => {
      if (utteranceRef.current === utterance) setStatus("speaking");
    };
    utterance.onend = () => {
      if (utteranceRef.current === utterance) {
        utteranceRef.current = null;
        setStatus("idle");
      }
    };
    utterance.onerror = () => {
      if (utteranceRef.current === utterance) {
        utteranceRef.current = null;
        setStatus("idle");
      }
    };

    window.speechSynthesis.speak(utterance);
  }

  const label =
    status === "speaking"
      ? "Stop reading"
      : status === "loading"
        ? "Starting…"
        : "Read section aloud";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!supported || !text.trim()}
      aria-label={label}
      title={supported ? label : "Text-to-speech is not supported in this browser"}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-bgsubtle bg-bgcard text-inkmuted transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
    >
      {status === "loading" ? (
        <Loader2 size={15} className="animate-spin" />
      ) : status === "speaking" ? (
        <VolumeX size={15} />
      ) : (
        <Volume2 size={15} />
      )}
    </button>
  );
}
