"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DISLIKE_REASONS } from "@/lib/types";

function Thumb({ down = false }: { down?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-[15px] w-[15px] ${down ? "rotate-180" : ""}`}
    >
      <path d="M6 9v8H3.5A1.5 1.5 0 0 1 2 15.5V10.5A1.5 1.5 0 0 1 3.5 9H6zm0 0l3-6.5a1.8 1.8 0 0 1 3.4 1L11.5 7H16a2 2 0 0 1 2 2.4l-1.1 5.5a2 2 0 0 1-2 1.6H6" />
    </svg>
  );
}

export default function ReactionButtons({
  outfitId,
  initial,
  readOnly = false,
}: {
  outfitId: string;
  initial: 1 | -1 | null;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [reaction, setReaction] = useState<1 | -1 | null>(initial);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  async function set(next: 1 | -1) {
    const value = reaction === next ? null : next;
    setReaction(value); // optimistic
    setFeedbackOpen(value === -1);
    if (value !== -1) {
      setPicked(new Set());
      setNote("");
    }
    await fetch(`/api/fits/${outfitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction: value }),
    }).catch(() => {});
    router.refresh();
  }

  function toggleReason(r: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  }

  async function sendFeedback() {
    setSending(true);
    await fetch(`/api/fits/${outfitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reaction: -1,
        reasons: [...picked],
        note,
      }),
    }).catch(() => {});
    setSending(false);
    setFeedbackOpen(false);
    router.refresh();
  }

  if (readOnly) return null;

  return (
    <span className="relative flex items-center gap-1.5">
      <button
        onClick={() => set(1)}
        aria-label="Thumbs up"
        aria-pressed={reaction === 1}
        className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all ${
          reaction === 1
            ? "border-moss bg-moss text-ivory"
            : "hairline bg-paper text-ink-faint hover:text-moss"
        }`}
      >
        <Thumb />
      </button>
      <button
        onClick={() => set(-1)}
        aria-label="Thumbs down"
        aria-pressed={reaction === -1}
        className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all ${
          reaction === -1
            ? "border-camel-deep bg-camel-deep text-ivory"
            : "hairline bg-paper text-ink-faint hover:text-camel-deep"
        }`}
      >
        <Thumb down />
      </button>

      {feedbackOpen && (
        <div className="sheet-up absolute right-0 top-10 z-30 w-[300px] rounded-2xl border hairline bg-paper p-4 shadow-xl shadow-ink/10">
          <p className="eyebrow mb-2.5">What&rsquo;s off?</p>
          <div className="flex flex-wrap gap-1.5">
            {DISLIKE_REASONS.map((r) => (
              <button
                key={r}
                onClick={() => toggleReason(r)}
                className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                  picked.has(r)
                    ? "border-ink bg-ink text-ivory"
                    : "hairline bg-ivory text-ink-soft hover:bg-paper"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Tell the stylist more — e.g. I never tuck in t-shirts"
            className="mt-3 min-h-[64px] w-full resize-y rounded-xl border hairline bg-ivory px-3 py-2 text-[13px] leading-relaxed outline-none transition-colors focus:border-camel/60 focus:bg-paper"
          />
          <div className="mt-2.5 flex items-center justify-end gap-3">
            <button
              onClick={() => setFeedbackOpen(false)}
              className="text-[12px] text-ink-faint transition-colors hover:text-ink"
            >
              Skip
            </button>
            <button
              onClick={sendFeedback}
              disabled={sending || (picked.size === 0 && !note.trim())}
              className="rounded-full bg-ink px-4 py-1.5 text-[12px] font-medium text-ivory transition-opacity hover:opacity-85 disabled:opacity-40"
            >
              {sending ? "Sending…" : "Send to stylist"}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
