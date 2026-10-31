"use client";

import { useEffect, useRef } from "react";
import { COURT, type Analysis } from "@/lib/types";

export default function StatsPanel({ analysis }: { analysis: Analysis }) {
  const { stats, settings, engine } = analysis;
  const last = analysis.score[analysis.score.length - 1];
  const heatRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = heatRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const cw = W / 14, ch = H / 6;
    const mx = Math.max(1, ...stats.landingHeat.flat());
    for (let r = 0; r < 14; r++) for (let c = 0; c < 6; c++) {
      const v = stats.landingHeat[r][c] / mx;
      ctx.fillStyle = `rgba(253,224,71,${0.06 + v * 0.9})`;
      ctx.fillRect(r * cw + 1, c * ch + 1, cw - 2, ch - 2);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.5;
    ctx.strokeRect(0.75, 0.75, W - 1.5, H - 1.5);
    const netX = (COURT.netY / COURT.length) * W;
    ctx.beginPath(); ctx.moveTo(netX, 0); ctx.lineTo(netX, H); ctx.stroke();
  }, [stats]);

  const tiles: Array<[string, string, string?]> = [
    ["Top speed", stats.topSpeedKmh ? `${stats.topSpeedKmh} km/h` : "—", stats.topSpeedBy ? (stats.topSpeedBy === "near" ? settings.nearLabel : settings.farLabel) : "est."],
    ["Score", last ? `${last.near}–${last.far}` : "0–0", last && (last.gamesNear || last.gamesFar) ? `games ${last.gamesNear}–${last.gamesFar}` : `${settings.nearLabel} – ${settings.farLabel}`],
    ["Rallies", `${stats.rallies}`, `${stats.shots} shots`],
    ["Longest rally", `${stats.longestRallyShots} shots`, `${stats.longestRallySec}s`],
    ["Smashes", `${stats.smashes}`, stats.avgSpeedKmh ? `avg ${stats.avgSpeedKmh} km/h` : undefined],
    ["Distance", `${stats.playerDistanceM.near}m / ${stats.playerDistanceM.far}m`, `${settings.nearLabel} / ${settings.farLabel}`],
  ];
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Match stats</div>
        <div className="text-[11px] text-muted">engine: {engine.shuttle} shuttle · {engine.players} players · {engine.analysisWidth}p · {(engine.ms / 1000).toFixed(1)}s</div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map(([k, v, sub]) => (
          <div key={k} className="rounded-xl bg-subtle p-3">
            <div className="eyebrow">{k}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{v}</div>
            {sub && <div className="text-[11px] text-muted">{sub}</div>}
          </div>
        ))}
      </div>
      <div className="mt-3">
        <div className="label mb-1">Where rallies ended ({settings.nearLabel} left → {settings.farLabel} right)</div>
        <canvas ref={heatRef} width={560} height={240} className="w-full rounded-lg bg-subtle" />
      </div>
    </div>
  );
}
