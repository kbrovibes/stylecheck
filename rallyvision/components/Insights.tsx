"use client";

import { useState } from "react";
import type { Analysis } from "@/lib/types";
import { summarize, type Insights as InsightsT } from "@/lib/ai/types";

export default function Insights({ analysis, onJump }: { analysis: Analysis; onJump: (t: number) => void }) {
  const [data, setData] = useState<InsightsT | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/insights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(summarize(analysis)) });
      if (!res.ok) throw new Error(`Insights request failed (${res.status})`);
      setData((await res.json()) as InsightsT);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  const name = (s: "near" | "far") => (s === "near" ? analysis.settings.nearLabel : analysis.settings.farLabel);
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Coach notes</div>
          <div className="text-xs text-muted">AI-written from the measured stats (Claude or Gemini when a key is set; otherwise template notes).</div>
        </div>
        <button className="btn-ghost" data-testid="insights" onClick={run} disabled={loading}>{loading ? "Thinking…" : data ? "Regenerate" : "Generate"}</button>
      </div>
      {err && <div className="mt-2 text-xs text-danger">{err}</div>}
      {data && (
        <div className="mt-3 space-y-3" data-testid="insights-result">
          <div className="text-lg font-semibold">{data.headline}</div>
          <p className="text-sm text-ink-2">{data.summary}</p>
          {data.highlights.length > 0 && (
            <div>
              <div className="label mb-1">Highlights</div>
              <ul className="space-y-1">
                {data.highlights.map((h, i) => (
                  <li key={i} className="flex gap-2 text-sm"><button className="shrink-0 rounded bg-subtle px-1.5 text-xs tabular-nums text-near" onClick={() => onJump(h.atSec)}>{h.atSec.toFixed(1)}s</button><span><b>{h.title}</b> — {h.detail}</span></li>
                ))}
              </ul>
            </div>
          )}
          {data.tips.length > 0 && (
            <div>
              <div className="label mb-1">Tips</div>
              <ul className="space-y-1">
                {data.tips.map((t, i) => (
                  <li key={i} className="text-sm"><span className={`mr-2 rounded px-1.5 text-xs font-bold ${t.side === "near" ? "bg-near/20 text-near" : "bg-far/20 text-far"}`}>{name(t.side)}</span>{t.tip}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-[11px] text-muted">{data.caveats.join(" ")} · provider: {data.provider} ({data.model})</div>
        </div>
      )}
    </div>
  );
}
