"use client";

import { useRef, useState } from "react";
import type { Analysis } from "@/lib/types";
import { useSettings } from "@/lib/settings";
import { downloadBlob, exportVideo, type ExportResult } from "@/lib/export/encode";
import { renderStatsCard, type OverlayOptions } from "@/lib/render/overlay";

type Props = { video: HTMLVideoElement; analysis: Analysis; overlay: OverlayOptions };

export default function ExportPanel({ video, analysis, overlay }: Props) {
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const settings = useSettings();
  const [maxWidth, setMaxWidth] = useState<number>(settings.exportWidth >= 1080 ? 1080 : 720);
  const abortRef = useRef<AbortController | null>(null);
  const base = analysis.video.name.replace(/\.[^.]+$/, "");

  const run = async () => {
    setErr(null); setResult(null); setProgress(0);
    const ac = new AbortController(); abortRef.current = ac;
    video.pause();
    try {
      const r = await exportVideo(video, analysis, { overlay, maxWidth, forceFallback: settings.exportFormat === "webm", onProgress: (d, t) => setProgress(d / Math.max(1, t)), signal: ac.signal });
      setResult(r);
      downloadBlob(r.blob, `${base}-rallyvision.${r.ext}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const card = () => {
    const cv = renderStatsCard(analysis, settings.overlay.speedUnit);
    cv.toBlob((b) => b && downloadBlob(b, `${base}-match-card.png`), "image/png");
  };
  const json = () => {
    const slim = { ...analysis, players: analysis.players.map((p) => ({ ...p, landmarks: undefined })) };
    downloadBlob(new Blob([JSON.stringify(slim)], { type: "application/json" }), `${base}-analysis.json`);
  };

  return (
    <div className="card space-y-3 p-4">
      <div className="text-sm font-semibold">Export</div>
      <div className="flex items-center gap-2">
        <label className="eyebrow">Quality</label>
        <select className="input w-auto py-1" value={maxWidth} onChange={(e) => setMaxWidth(parseInt(e.target.value))}>
          <option value={720}>720p</option><option value={1080}>1080p</option>
        </select>
      </div>
      {progress === null ? (
        <button className="btn-primary w-full" data-testid="export-video" onClick={run}>Export video with overlays</button>
      ) : (
        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-subtle"><div className="h-full bg-accent" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <div className="mt-1 flex items-center justify-between text-xs text-muted"><span>Rendering {Math.round(progress * 100)}%</span><button className="underline" onClick={() => abortRef.current?.abort()}>cancel</button></div>
        </div>
      )}
      {result && <div className="text-xs text-muted" data-testid="export-result">Saved .{result.ext} ({(result.blob.size / 1e6).toFixed(1)} MB, {result.codec}) in {result.seconds}s.</div>}
      {err && <div className="text-xs text-danger">{err}</div>}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-ghost" onClick={card}>Stats card (PNG)</button>
        <button className="btn-ghost" onClick={json}>Analysis JSON</button>
      </div>
      <p className="text-[11px] text-muted">MP4 export uses WebCodecs (Chrome/Edge; video only). Other browsers fall back to a realtime WebM recording that keeps audio.</p>
    </div>
  );
}
