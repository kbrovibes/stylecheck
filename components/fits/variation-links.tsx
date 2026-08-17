"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface VariationDisplay {
  index: number;
  label: string;
  outName: string;
  inName: string;
  outfitId?: string;
}

export default function VariationLinks({
  outfitId,
  variations,
}: {
  outfitId: string;
  variations: VariationDisplay[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(v: VariationDisplay) {
    if (v.outfitId) {
      router.push(`/fits/${v.outfitId}`);
      return;
    }
    setBusy(v.index);
    setError(null);
    try {
      const res = await fetch(`/api/fits/${outfitId}/variation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: v.index }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Couldn't open that variation.");
        return;
      }
      router.push(`/fits/${json.id}`);
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!variations.length) return null;

  return (
    <div>
      <ul className="space-y-2">
        {variations.map((v) => (
          <li key={v.index}>
            <button
              onClick={() => open(v)}
              disabled={busy !== null}
              className="group w-full rounded-xl border hairline bg-paper px-4 py-3 text-left transition-colors hover:border-camel/40 hover:bg-ivory disabled:opacity-50"
            >
              <span className="text-[13px] font-medium text-ink group-hover:text-camel-deep">
                {busy === v.index ? "Styling…" : v.label}
              </span>
              <span className="mt-0.5 block text-[12px] text-ink-faint">
                Same fit, swap {v.outName} → {v.inName}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-[12px] text-blush">{error}</p>}
    </div>
  );
}
