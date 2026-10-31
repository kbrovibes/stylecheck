"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CourtCalibration, CourtMode, Pt } from "@/lib/types";
import { buildCalibration, courtLines, toImage } from "@/lib/cv/geometry";
import { seekTo } from "@/lib/video/frames";
import { IconWand } from "@/components/Icons";

type Props = {
  video: HTMLVideoElement;
  width: number;
  height: number;
  duration: number;
  corners: [Pt, Pt, Pt, Pt];
  source: CourtCalibration["source"];
  mode: CourtMode;
  onCorners: (c: [Pt, Pt, Pt, Pt], source: CourtCalibration["source"]) => void;
  onAutoDetect: (t: number) => Promise<boolean>;
};

const HANDLE_CSS_PX = 11;
/** Room around the video so a corner that's cut off by the frame can still be placed. */
const MARGIN = 0.18;
const GRAB_CSS_PX = 30;

/** Drag four handles onto the court corners. Touch-friendly: big grab radius + magnifier while dragging. */
export default function CourtMarker({ video, width, height, duration, corners, source, mode, onCorners, onAutoDetect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [t, setT] = useState(Math.min(1, duration / 3));
  const [drag, setDrag] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cssW, setCssW] = useState(0);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ro = new ResizeObserver(() => setCssW(cv.getBoundingClientRect().width));
    ro.observe(cv);
    return () => ro.disconnect();
  }, []);

  const mx = Math.round(Math.min(width, height) * MARGIN), my = mx;
  const CW = width + 2 * mx, CH = height + 2 * my;
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !cssW) return;
    const ctx = cv.getContext("2d")!;
    if (cv.width !== CW) { cv.width = CW; cv.height = CH; }
    const px = CW / cssW; // canvas px per CSS px
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#18181b"; ctx.fillRect(0, 0, CW, CH);
    ctx.translate(mx, my);
    ctx.drawImage(video, 0, 0, width, height);
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1 * px; ctx.strokeRect(0, 0, width, height);
    try {
      const cal = buildCalibration(corners, mode, source);
      ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 1.5 * px;
      for (const [p, q] of courtLines(mode)) {
        const a = toImage(cal, p), b = toImage(cal, q);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    } catch { /* degenerate quad while dragging */ }
    ctx.strokeStyle = "#facc15"; ctx.lineWidth = 2 * px;
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
    ctx.closePath(); ctx.stroke();
    corners.forEach((c, i) => {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.arc(c.x, c.y + 1.5 * px, HANDLE_CSS_PX * px, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = i === drag ? "#ffffff" : "#facc15";
      ctx.beginPath(); ctx.arc(c.x, c.y, HANDLE_CSS_PX * px, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0a0a0b"; ctx.font = `700 ${11 * px}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), c.x, c.y + 0.5 * px);
    });
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    // magnifier
    if (drag !== null) {
      const c = corners[drag];
      const R = Math.min(width, height) * 0.16, zoom = 3;
      const cx = c.x < width / 2 ? width - R - 12 * px : R + 12 * px, cy = R + 12 * px; // inside the video area
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      const sw = (2 * R) / zoom;
      ctx.drawImage(video, c.x - sw / 2, c.y - sw / 2, sw, sw, cx - R, cy - R, 2 * R, 2 * R);
      ctx.strokeStyle = "#facc15"; ctx.lineWidth = 1.5 * px;
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3 * px;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    }
  }, [video, width, height, corners, mode, source, drag, cssW, CW, CH, mx, my]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => { let on = true; void seekTo(video, t).then(() => { if (on) draw(); }); return () => { on = false; }; }, [t, video, draw]);

  const toVideo = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * CW - mx, y: ((e.clientY - r.top) / r.height) * CH - my };
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toVideo(e);
    const r = (GRAB_CSS_PX * CW) / Math.max(1, cssW);
    let best = -1, bd = Infinity;
    corners.forEach((c, i) => { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < r && d < bd) { bd = d; best = i; } });
    if (best >= 0) { setDrag(best); e.currentTarget.setPointerCapture(e.pointerId); }
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag === null) return;
    const p = toVideo(e);
    onCorners(corners.map((c, i) => (i === drag ? { x: Math.max(-mx, Math.min(width + mx, p.x)), y: Math.max(-my, Math.min(height + my, p.y)) } : c)) as [Pt, Pt, Pt, Pt], "manual");
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        data-testid="calib-canvas"
        className="block w-full touch-none select-none rounded-2xl bg-black"
        style={{ aspectRatio: `${CW} / ${CH}` }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}
      />
      <div className="mt-3 flex items-center gap-3">
        <input aria-label="Frame" type="range" min={0} max={Math.max(0.1, duration - 0.05)} step={0.05} value={t} onChange={(e) => setT(parseFloat(e.target.value))} className="w-full" />
        <span className="num w-12 text-right text-xs text-muted">{t.toFixed(1)}s</span>
        <button
          className="btn-secondary h-9 shrink-0 px-3"
          disabled={busy}
          onClick={async () => {
            setBusy(true); setMsg(null);
            const ok = await onAutoDetect(t);
            setBusy(false);
            setMsg(ok ? "Court found. Check the fit." : "No court lines found on this frame. Try another frame or drag the handles.");
          }}
        >
          <IconWand size={16} /> {busy ? "Finding…" : "Auto"}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        {msg ?? (source === "auto" ? "Court detected automatically. Drag a corner if it's off." : "Drag the yellow handles onto the four outer court corners: 1 near-left, 2 near-right, 3 far-right, 4 far-left. If a corner is cut off, drag it into the dark border where it would be.")}
      </p>
    </div>
  );
}
