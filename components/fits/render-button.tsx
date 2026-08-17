"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

const LOADING_COPY = [
  "Steaming the garments…",
  "Setting the studio lights…",
  "Finding your angle…",
  "Pinning the hem…",
  "One more frame…",
];

export default function RenderButton({
  outfitId,
  hasRender,
  goofy = false,
}: {
  outfitId: string;
  hasRender: boolean;
  goofy?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [copyIdx, setCopyIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (loading) {
      timer.current = setInterval(
        () => setCopyIdx((i) => (i + 1) % LOADING_COPY.length),
        2600
      );
    } else if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [loading]);

  async function render() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fits/${outfitId}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goofy }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Render failed — try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={render}
        disabled={loading}
        variant={hasRender ? "secondary" : "primary"}
        className="w-full"
      >
        {loading ? (
          <span className="serif-accent">{LOADING_COPY[copyIdx]}</span>
        ) : hasRender ? (
          goofy ? "Re-render goofy take 🤪" : "Re-render"
        ) : (
          goofy ? "Generate goofy take 🤪" : "Render on me"
        )}
      </Button>
      {loading && (
        <p className="text-center text-[12px] text-ink-faint">
          This takes a minute — your look is being photographed.
        </p>
      )}
      {error && <p className="text-center text-[12px] text-blush">{error}</p>}
    </div>
  );
}
