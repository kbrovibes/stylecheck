"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Compose fits that must feature wardrobe pieces not yet in any fit. */
export default function StyleUnusedButton({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/fits/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ focus: "unused" }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => ({}))) ?? {};
    setBusy(false);
    if (res?.ok) {
      router.push("/fits");
    } else {
      setError(json.error ?? "Generation failed");
      setTimeout(() => setError(null), 4000);
    }
  }

  return (
    <span className="relative">
      <button
        onClick={go}
        disabled={busy}
        title="Compose new fits built around pieces that aren't in any fit yet"
        className="rounded-full border hairline bg-paper px-5 py-2.5 text-[13px] font-medium transition-colors hover:bg-ivory disabled:opacity-50"
      >
        {busy ? "Styling unused pieces…" : `Style unused pieces · ${count}`}
      </button>
      {error && (
        <span className="absolute left-0 top-full z-10 mt-1.5 block w-64 rounded-lg bg-ink px-3 py-2 text-[12px] text-ivory shadow-lg">
          {error}
        </span>
      )}
    </span>
  );
}
