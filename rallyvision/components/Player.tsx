"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Analysis } from "@/lib/types";
import { buildIndex, drawOverlay, type OverlayOptions } from "@/lib/render/overlay";
import { seekTo } from "@/lib/video/frames";
import { IconNext, IconPause, IconPlay, IconPrev } from "@/components/Icons";

type Props = {
  video: HTMLVideoElement;
  analysis: Analysis;
  overlay: OverlayOptions;
  onOverlay: (o: OverlayOptions) => void;
  seekReq: { t: number; n: number } | null;
};

function prepareVideoElement(v: HTMLVideoElement) {
  v.className = "absolute inset-0 h-full w-full";
  v.controls = false;
  v.muted = false;
  v.loop = false;
}

function applyRate(v: HTMLVideoElement, rate: number) {
  v.playbackRate = rate;
}

export default function Player({ video, analysis, overlay, onOverlay, seekReq }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(video.currentTime);
  const [rate, setRate] = useState(1);
  const idx = useMemo(() => buildIndex(analysis), [analysis]);
  const fps = analysis.video.fps;

  const render = useCallback((time: number) => {
    const cv = canvasRef.current;
    if (!cv) return;
    if (cv.width !== analysis.video.width) { cv.width = analysis.video.width; cv.height = analysis.video.height; }
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const f = Math.min(analysis.video.frames - 1, Math.max(0, Math.round(time * fps - 0.5)));
    drawOverlay(ctx, analysis, idx, f, overlay);
  }, [analysis, idx, overlay, fps]);

  // mount the shared <video> element
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    prepareVideoElement(video);
    host.prepend(video);
    return () => { if (video.parentElement === host) host.removeChild(video); };
  }, [video]);

  // frame loop
  useEffect(() => {
    let alive = true;
    type RVFC = (cb: (now: number, meta: { mediaTime: number }) => void) => number;
    const rvfc = (video as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback?.bind(video);
    const tick = (_n: number, meta: { mediaTime: number }) => {
      if (!alive) return;
      render(meta.mediaTime);
      setT(meta.mediaTime);
      rvfc?.(tick);
    };
    if (rvfc) rvfc(tick);
    else {
      const loop = () => { if (!alive) return; render(video.currentTime); setT(video.currentTime); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
    const onPlay = () => setPlaying(true), onPause = () => setPlaying(false);
    const onSeeked = () => { render(video.currentTime); setT(video.currentTime); };
    video.addEventListener("play", onPlay); video.addEventListener("pause", onPause); video.addEventListener("ended", onPause); video.addEventListener("seeked", onSeeked);
    render(video.currentTime);
    return () => { alive = false; video.removeEventListener("play", onPlay); video.removeEventListener("pause", onPause); video.removeEventListener("ended", onPause); video.removeEventListener("seeked", onSeeked); };
  }, [video, render]);

  useEffect(() => { render(video.currentTime); }, [overlay, render, video]);

  useEffect(() => {
    if (!seekReq) return;
    video.pause();
    seekTo(video, seekReq.t).then(() => render(video.currentTime));
  }, [seekReq, video, render]);

  useEffect(() => { applyRate(video, rate); }, [rate, video]);

  const toggle = () => { if (video.paused) void video.play(); else video.pause(); };
  const stepFrame = (d: number) => { video.pause(); void seekTo(video, video.currentTime + d / fps); };

  const toggles: Array<[keyof OverlayOptions, string]> = [["trail", "Trail"], ["speed", "Speed"], ["players", "Players"], ["skeleton", "Skeleton"], ["minimap", "Minimap"], ["score", "Score"], ["banner", "Points"], ["court", "Court"]];

  return (
    <div className="card p-4">
      <div ref={hostRef} className="relative w-full overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: `${analysis.video.width} / ${analysis.video.height}` }}>
        <canvas ref={canvasRef} data-testid="overlay-canvas" className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-icon" onClick={() => stepFrame(-1)} title="Previous frame" aria-label="Previous frame"><IconPrev /></button>
        <button className="btn-primary w-11 px-0" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>{playing ? <IconPause size={16} /> : <IconPlay size={16} />}</button>
        <button className="btn-icon" onClick={() => stepFrame(1)} title="Next frame" aria-label="Next frame"><IconNext /></button>
        <select className="input h-9 w-auto rounded-full" value={rate} onChange={(e) => setRate(parseFloat(e.target.value))}>
          {[0.25, 0.5, 1, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
        <span className="num ml-auto text-xs text-muted">{t.toFixed(2)}s / {analysis.video.duration.toFixed(1)}s · frame {Math.round(t * fps)}</span>
      </div>
      <div className="relative mt-2 h-8">
        {/* rally bands */}
        <div className="absolute inset-x-0 top-3 h-2 rounded-full bg-subtle">
          {analysis.rallies.map((r) => (
            <button
              key={r.id}
              title={`Rally ${r.id + 1}: ${r.hits.length} shots`}
              onClick={() => { video.pause(); void seekTo(video, r.startT); }}
              className="absolute top-0 h-2 rounded-full bg-ink/50 hover:bg-ink"
              style={{ left: `${(100 * r.startT) / analysis.video.duration}%`, width: `${Math.max(0.5, (100 * (r.endT - r.startT)) / analysis.video.duration)}%` }}
            />
          ))}
        </div>
        <input type="range" className="absolute inset-x-0 top-0 w-full opacity-80" min={0} max={analysis.video.duration} step={1 / fps} value={t}
          onChange={(e) => { video.pause(); const v = parseFloat(e.target.value); setT(v); void seekTo(video, v); }} />
      </div>
      <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
        {toggles.map(([k, label]) => (
          <button key={k} onClick={() => onOverlay({ ...overlay, [k]: !overlay[k] })} className={`h-7 shrink-0 rounded-full px-3 text-xs font-medium transition ${overlay[k] ? "bg-ink text-bg" : "bg-subtle text-muted"}`}>{label}</button>
        ))}
      </div>
    </div>
  );
}
