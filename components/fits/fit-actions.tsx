"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/** Delete-fit control + revive banner for fits with removed pieces. */
export default function FitActions({
  outfitId,
  deadCount,
  readOnly = false,
}: {
  outfitId: string;
  deadCount: number;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"revive" | "delete" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revive() {
    setBusy("revive");
    setError(null);
    const res = await fetch(`/api/fits/${outfitId}/revive`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(json.error ?? "Revive failed");
      return;
    }
    router.refresh();
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    const res = await fetch(`/api/fits/${outfitId}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Could not remove fit");
      return;
    }
    router.push("/fits");
    router.refresh();
  }

  if (readOnly) return null;

  return (
    <div className="mt-4 space-y-3">
      {deadCount > 0 && (
        <div className="rounded-2xl border border-camel/40 bg-camel/5 p-4">
          <p className="text-[13px] leading-relaxed text-ink-soft">
            <span className="font-medium text-camel-deep">
              {deadCount === 1 ? "A piece" : `${deadCount} pieces`} in this fit{" "}
              {deadCount === 1 ? "is" : "are"} no longer in the wardrobe.
            </span>{" "}
            The stylist can swap in the closest match and re-render — or you can
            retire the fit.
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={revive} disabled={busy !== null} className="!px-4 !py-2">
              {busy === "revive" ? "Restyling & re-rendering… ~1 min" : "Revive with a swap"}
            </Button>
            <Button
              variant="secondary"
              onClick={remove}
              disabled={busy !== null}
              className="!px-4 !py-2"
            >
              {busy === "delete" ? "Removing…" : "Remove fit"}
            </Button>
          </div>
        </div>
      )}

      {deadCount === 0 &&
        (confirming ? (
          <p className="text-center text-[12px] text-ink-soft">
            Remove this fit?{" "}
            <button
              onClick={remove}
              disabled={busy !== null}
              className="font-semibold text-camel-deep hover:underline"
            >
              {busy === "delete" ? "Removing…" : "Yes, remove"}
            </button>{" "}
            ·{" "}
            <button onClick={() => setConfirming(false)} className="text-ink-faint hover:text-ink">
              Keep it
            </button>
          </p>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="mx-auto block text-[12px] text-ink-faint transition-colors hover:text-camel-deep"
          >
            Remove this fit
          </button>
        ))}

      {error && (
        <p className="rounded-lg bg-blush/15 px-3 py-2 text-[12px] text-camel-deep">{error}</p>
      )}
    </div>
  );
}
