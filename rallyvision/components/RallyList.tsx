"use client";

import type { Analysis, Rally } from "@/lib/types";

type Props = { analysis: Analysis; onOverride: (id: number, o: Rally["override"]) => void; onJump: (t: number) => void };

export default function RallyList({ analysis, onOverride, onJump }: Props) {
  const { nearLabel, farLabel } = analysis.settings;
  const name = (s: "near" | "far" | null) => (s === "near" ? nearLabel : s === "far" ? farLabel : "—");
  const scoreAfter = (r: Rally) => analysis.score.find((s) => s.f === r.endF);
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Rallies &amp; score</div>
        <div className="text-xs text-muted">{analysis.rallies.length} rallies · click to jump · fix winners inline</div>
      </div>
      {analysis.rallies.length === 0 && (
        <div className="rounded-xl bg-subtle p-3 text-sm text-muted">No rallies found. Check the court corners, try a higher analysis resolution, or make sure the camera is static.</div>
      )}
      <div className="max-h-[520px] space-y-1.5 overflow-auto pr-1">
        {analysis.rallies.map((r) => {
          const s = scoreAfter(r);
          const eff = r.override === undefined || r.override === null ? r.winner : r.override;
          return (
            <div key={r.id} className="rounded-xl bg-subtle p-2.5 text-sm" data-testid="rally-row">
              <div className="flex items-center gap-2">
                <button className="font-bold hover:text-near" onClick={() => onJump(r.startT)}>Rally {r.id + 1}</button>
                <span className="text-xs text-muted">{r.startT.toFixed(1)}–{r.endT.toFixed(1)}s · {r.hits.length} shots{r.maxSpeedKmh ? ` · ${r.maxSpeedKmh} km/h` : ""}</span>
                <span className="ml-auto rounded-md bg-subtle px-2 py-0.5 text-xs font-bold tabular-nums">{s ? `${s.near}–${s.far}` : ""}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${eff === "near" ? "bg-near" : eff === "far" ? "bg-far" : "bg-muted"}`} />
                <select className="input w-auto py-1 text-xs" value={r.override ?? "auto"} onChange={(e) => { const v = e.target.value; onOverride(r.id, v === "auto" ? undefined : (v as Rally["override"])); }}>
                  <option value="auto">Auto: {name(r.winner)}</option>
                  <option value="near">{nearLabel} won</option>
                  <option value="far">{farLabel} won</option>
                  <option value="skip">Not a point (replay / practice)</option>
                </select>
                <span className="truncate text-[11px] text-muted" title={r.winnerReason}>{r.winnerReason}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
