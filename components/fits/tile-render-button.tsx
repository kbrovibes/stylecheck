"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Small overlay button on a fit tile: render/re-render this fit on the user. */
export default function TileRenderButton({
  outfitId,
  hasRender,
  goofy = false,
}: {
  outfitId: string;
  hasRender: boolean;
  goofy?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function render(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/fits/${outfitId}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goofy }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(true);
      setTimeout(() => setError(false), 3000);
      return;
    }
    router.refresh();
  }

  return (
    <button
      onClick={render}
      title={
        error
          ? "Render failed — open the fit for details"
          : goofy
            ? hasRender
              ? "Re-render the goofy take"
              : "Generate the goofy take"
            : hasRender
              ? "Re-render on me"
              : "Render on me"
      }
      aria-label="Render this fit on me"
      className={`absolute right-2.5 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full text-[14px] backdrop-blur-md transition-all ${
        error
          ? "bg-blush/80 text-ink"
          : "bg-ink/50 text-ivory hover:bg-ink/80"
      } ${busy ? "cursor-wait" : ""}`}
    >
      {busy ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-ivory/30 border-t-ivory" />
      ) : error ? (
        "!"
      ) : (
        "↻"
      )}
    </button>
  );
}
