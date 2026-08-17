"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

const LOADING_COPY = [
  "Pinning looks…",
  "Consulting the mood board…",
  "Weighing color stories…",
  "Checking the forecast…",
  "Balancing proportions…",
  "Editing down the rack…",
];

const OCCASIONS = [
  { value: "", label: "Surprise me" },
  { value: "work", label: "Work" },
  { value: "casual", label: "Casual" },
  { value: "friends", label: "Friends" },
  { value: "date", label: "Date" },
];

export default function GenerateButton() {
  const router = useRouter();
  const [occasion, setOccasion] = useState("");
  const [loading, setLoading] = useState(false);
  const [copyIdx, setCopyIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (loading) {
      timer.current = setInterval(
        () => setCopyIdx((i) => (i + 1) % LOADING_COPY.length),
        2200
      );
    } else if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [loading]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fits/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occasion: occasion || undefined, count: 6 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Something went wrong — try again.");
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
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <select
          value={occasion}
          onChange={(e) => setOccasion(e.target.value)}
          disabled={loading}
          className="rounded-full border hairline bg-paper px-4 py-2.5 text-[13px] text-ink-soft outline-none focus:border-camel"
        >
          {OCCASIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Button onClick={generate} disabled={loading}>
          {loading ? (
            <span className="serif-accent">{LOADING_COPY[copyIdx]}</span>
          ) : (
            "Generate fits"
          )}
        </Button>
      </div>
      {error && <p className="text-[12px] text-blush">{error}</p>}
    </div>
  );
}
