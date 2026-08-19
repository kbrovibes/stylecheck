"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

  async function set(next: 1 | -1) {
    const value = reaction === next ? null : next;
    setReaction(value); // optimistic
    await fetch(`/api/fits/${outfitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction: value }),
    }).catch(() => {});
    router.refresh();
  }

  if (readOnly) return null;

  return (
    <span className="flex items-center gap-1.5">
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
    </span>
  );
}
