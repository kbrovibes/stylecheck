"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisSettings, CourtCalibration, Pt, VideoMeta } from "@/lib/types";
import { buildCalibration, courtLines, toImage } from "@/lib/cv/geometry";
import { seekTo } from "@/lib/video/frames";
import { trackNetModelUrl } from "@/lib/cv/tracknet";

type Props = {
  video: HTMLVideoElement;
  meta: VideoMeta;
  corners: [Pt, Pt, Pt, Pt];
  source: CourtCalibration["source"];
  onCorners: (c: [Pt, Pt, Pt, Pt], source: CourtCalibration["source"]) => void;
  onAutoDetect: (t: number) => Promise<boolean>;
  settings: AnalysisSettings;
  onSettings: (s: AnalysisSettings) => void;
  onAnalyze: () => void;
};

const LABELS = ["Near-left", "Near-right", "Far-right", "Far-left"];

export default function Calibrate({ video, meta, corners, source, onCorners, onAutoDetect, settings, onSettings, onAnalyze }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [t, setT] = useState(Math.min(1, meta.duration / 3));
  const [drag, setDrag] = useState<number | null>(null);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  const hasTrackNet = !!trackNetModelUrl();

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    cv.width = meta.width; cv.height = meta.height;
    ctx.drawImage(video, 0, 0, meta.width, meta.height);
    const u = meta.height / 720;
    // projected court
    try {
      const cal = buildCalibration(corners, settings.mode, source);
      ctx.strokeStyle = "rgba(94,234,212,0.85)"; ctx.lineWidth = 2 * u;
      for (const [p, q] of courtLines(settings.mode)) {
        const a = toImage(cal, p), b = toImage(cal, q);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    } catch { /* degenerate quad while dragging */ }
    // quad + handles
    ctx.strokeStyle = "#fde047"; ctx.lineWidth = 2.5 * u;
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
    ctx.closePath(); ctx.stroke();
    corners.forEach((c, i) => {
      ctx.fillStyle = i === drag ? "#a3e635" : "#fde047";
      ctx.beginPath(); ctx.arc(c.x, c.y, 11 * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0b1220"; ctx.font = `800 ${13 * u}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), c.x, c.y);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    });
  }, [video, meta, corners, settings.mode, source, drag]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => { let on = true; seekTo(video, t).then(() => { if (on) draw(); }); return () => { on = false; }; }, [t, video, draw]);

  const toVideoCoords = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * meta.width, y: ((e.clientY - r.top) / r.height) * meta.height };
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toVideoCoords(e);
    const r = Math.max(22, meta.width / 40);
    let best = -1, bd = Infinity;
    corners.forEach((c, i) => { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < r && d < bd) { bd = d; best = i; } });
    if (best >= 0) { setDrag(best); e.currentTarget.setPointerCapture(e.pointerId); }
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag === null) return;
    const p = toVideoCoords(e);
    const next = corners.map((c, i) => (i === drag ? { x: Math.max(0, Math.min(meta.width, p.x)), y: Math.max(0, Math.min(meta.height, p.y)) } : c)) as [Pt, Pt, Pt, Pt];
    onCorners(next, "manual");
  };
  const onUp = () => setDrag(null);

  const set = (patch: Partial<AnalysisSettings>) => onSettings({ ...settings, ...patch });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-base font-bold">1 · Mark the court</div>
            <div className="text-xs text-muted">Drag the four yellow handles onto the outer court corners (1 near-left → 4 far-left). The teal lines preview the fit.</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-panel-2 px-2 py-1 text-[11px] text-muted">corners: {source}</span>
            <button className="btn-ghost" onClick={async () => { setAutoMsg(null); const ok = await onAutoDetect(t); setAutoMsg(ok ? "Lines detected — check the fit." : "Could not find court lines automatically on this frame. Try another frame or drag the handles."); }}>Auto-detect</button>
          </div>
        </div>
        <canvas ref={canvasRef} data-testid="calib-canvas" className="w-full cursor-crosshair touch-none rounded-xl bg-black" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        {autoMsg && <div className="mt-2 text-xs text-shuttle">{autoMsg}</div>}
        <div className="mt-3 flex items-center gap-3">
          <span className="label">Frame</span>
          <input type="range" min={0} max={Math.max(0.1, meta.duration - 0.05)} step={0.05} value={t} onChange={(e) => setT(parseFloat(e.target.value))} className="w-full" />
          <span className="w-14 text-right text-xs tabular-nums text-muted">{t.toFixed(1)}s</span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2 text-[11px] text-muted">
          {corners.map((c, i) => <div key={i}>{i + 1}. {LABELS[i]}: {Math.round(c.x)}, {Math.round(c.y)}</div>)}
        </div>
      </div>

      <div className="space-y-4">
        <div className="card space-y-3">
          <div className="text-base font-bold">2 · Match settings</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">Format</span>
              <select className="input mt-1" value={settings.mode} onChange={(e) => set({ mode: e.target.value as AnalysisSettings["mode"] })}>
                <option value="singles">Singles</option><option value="doubles">Doubles</option>
              </select></label>
            <label className="block"><span className="label">First server</span>
              <select className="input mt-1" value={settings.startServer} onChange={(e) => set({ startServer: e.target.value as AnalysisSettings["startServer"] })}>
                <option value="near">Near side</option><option value="far">Far side</option>
              </select></label>
            <label className="block"><span className="label">Near player / team</span><input className="input mt-1" value={settings.nearLabel} onChange={(e) => set({ nearLabel: e.target.value })} /></label>
            <label className="block"><span className="label">Far player / team</span><input className="input mt-1" value={settings.farLabel} onChange={(e) => set({ farLabel: e.target.value })} /></label>
          </div>
        </div>
        <div className="card space-y-3">
          <div className="text-base font-bold">3 · Engine</div>
          <label className="block"><span className="label">Shuttle tracker</span>
            <select className="input mt-1" value={settings.shuttleEngine} onChange={(e) => set({ shuttleEngine: e.target.value as AnalysisSettings["shuttleEngine"] })}>
              <option value="classical">Built-in motion tracker (works offline)</option>
              <option value="tracknet" disabled={!hasTrackNet}>TrackNetV3 neural tracker {hasTrackNet ? "" : "(needs model URL — see docs/UNBLOCK.md)"}</option>
              <option value="cloud" disabled>Cloud GPU worker (needs NEXT_PUBLIC_ML_WORKER_URL)</option>
            </select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.usePose} onChange={(e) => set({ usePose: e.target.checked })} /> Player pose tracking (MediaPipe, slower but draws skeletons)</label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">Analysis resolution</span>
              <select className="input mt-1" value={settings.analysisWidth} onChange={(e) => set({ analysisWidth: parseInt(e.target.value) })}>
                <option value={480}>480p (fast)</option><option value={640}>640p (default)</option><option value={960}>960p (accurate)</option>
              </select></label>
            <label className="block"><span className="label">Frame stride</span>
              <select className="input mt-1" value={settings.stride} onChange={(e) => set({ stride: parseInt(e.target.value) })}>
                <option value={1}>Every frame</option><option value={2}>Every 2nd frame</option>
              </select></label>
          </div>
          <div className="text-xs text-muted">{meta.width}×{meta.height} · {meta.fps} fps · {meta.duration.toFixed(1)}s · ~{Math.ceil(meta.frames / settings.stride)} frames to process</div>
        </div>
        <button className="btn-primary w-full py-3 text-base" data-testid="analyze" onClick={onAnalyze}>Analyze video →</button>
      </div>
    </div>
  );
}
