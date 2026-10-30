"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type Analysis, type AnalysisSettings, type CourtCalibration, type Progress, type Pt, type VideoMeta } from "@/lib/types";
import { grabFrame, loadVideo, probeFps, seekTo, type LoadedVideo } from "@/lib/video/frames";
import { buildCalibration, defaultCorners } from "@/lib/cv/geometry";
import { detectCourtCorners } from "@/lib/cv/autocourt";
import { runAnalysis, recompute } from "@/lib/cv/pipeline";
import Calibrate from "@/components/Calibrate";
import Player from "@/components/Player";
import RallyList from "@/components/RallyList";
import StatsPanel from "@/components/StatsPanel";
import ExportPanel from "@/components/ExportPanel";
import Insights from "@/components/Insights";
import { DEFAULT_OVERLAY, type OverlayOptions } from "@/lib/render/overlay";

type Step = "upload" | "calibrate" | "analyzing" | "review";

type TestHooks = {
  loadUrl: (url: string, name?: string) => Promise<void>;
  setCorners: (c: [Pt, Pt, Pt, Pt]) => void;
  setSettings: (s: Partial<AnalysisSettings>) => void;
  start: () => Promise<void>;
  getStep: () => Step;
  getAnalysis: () => Analysis | null;
  getMeta: () => VideoMeta | null;
  getCorners: () => [Pt, Pt, Pt, Pt] | null;
};

declare global {
  interface Window { __rallyvision?: TestHooks }
}

export default function Studio() {
  const [step, setStep] = useState<Step>("upload");
  const [loaded, setLoaded] = useState<LoadedVideo | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [corners, setCorners] = useState<[Pt, Pt, Pt, Pt] | null>(null);
  const [cornerSource, setCornerSource] = useState<CourtCalibration["source"]>("default");
  const [settings, setSettings] = useState<AnalysisSettings>(DEFAULT_SETTINGS);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<OverlayOptions>(DEFAULT_OVERLAY);
  const [seekReq, setSeekReq] = useState<{ t: number; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef({ step, analysis, meta, corners });
  useEffect(() => { stateRef.current = { step, analysis, meta, corners }; }, [step, analysis, meta, corners]);

  const autoDetect = useCallback(async (lv: LoadedVideo, at: number) => {
    await seekTo(lv.video, at);
    const small = grabFrame(lv.video, 640);
    const img = small.getContext("2d")!.getImageData(0, 0, small.width, small.height);
    const q = detectCourtCorners(img);
    const s = lv.width / small.width;
    if (q) return q.map((p) => ({ x: p.x * s, y: p.y * s })) as [Pt, Pt, Pt, Pt];
    return null;
  }, []);

  const onSource = useCallback(async (src: File | string, name?: string) => {
    setError(null);
    setBusy(true);
    try {
      const lv = await loadVideo(src);
      const fps = await probeFps(lv.video);
      const m: VideoMeta = { width: lv.width, height: lv.height, fps, duration: lv.duration, frames: Math.floor(lv.duration * fps), name: name ?? (src instanceof File ? src.name : src.split("/").pop() ?? "video") };
      setLoaded(lv);
      setMeta(m);
      const q = await autoDetect(lv, Math.min(1, lv.duration / 3));
      setCorners(q ?? defaultCorners(lv.width, lv.height));
      setCornerSource(q ? "auto" : "default");
      await seekTo(lv.video, Math.min(1, lv.duration / 3));
      setAnalysis(null);
      setStep("calibrate");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [autoDetect]);

  const start = useCallback(async () => {
    if (!loaded || !meta || !corners) return;
    setError(null);
    setStep("analyzing");
    setProgress({ phase: "Starting", done: 0, total: 1 });
    const cal = buildCalibration(corners, settings.mode, cornerSource);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const a = await runAnalysis(loaded.video, meta, cal, settings, setProgress, ac.signal);
      setAnalysis(a);
      await seekTo(loaded.video, a.rallies[0]?.startT ?? 0);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("calibrate");
    }
  }, [loaded, meta, corners, settings, cornerSource]);

  // test / automation hooks
  useEffect(() => {
    window.__rallyvision = {
      loadUrl: (url, name) => onSource(url, name),
      setCorners: (c) => { setCorners(c); setCornerSource("manual"); },
      setSettings: (s) => setSettings((prev) => ({ ...prev, ...s })),
      start,
      getStep: () => stateRef.current.step,
      getAnalysis: () => stateRef.current.analysis,
      getMeta: () => stateRef.current.meta,
      getCorners: () => stateRef.current.corners,
    };
  }, [onSource, start]);

  const updateRally = useCallback((id: number, override: Analysis["rallies"][number]["override"]) => {
    setAnalysis((a) => {
      if (!a) return a;
      const rallies = a.rallies.map((r) => (r.id === id ? { ...r, override } : r));
      return recompute({ ...a, rallies });
    });
  }, []);

  const jump = useCallback((t: number) => setSeekReq((s) => ({ t, n: (s?.n ?? 0) + 1 })), []);

  const header = (
    <header className="flex items-center justify-between py-5">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-[#0b1220] font-black">RV</div>
        <div>
          <div className="text-lg font-extrabold tracking-tight">RallyVision</div>
          <div className="text-xs text-muted">Badminton video → shuttle track · speed · court map · score</div>
        </div>
      </div>
      {step !== "upload" && (
        <button className="btn-ghost" onClick={() => { abortRef.current?.abort(); setStep("upload"); setAnalysis(null); setLoaded(null); }}>
          New video
        </button>
      )}
    </header>
  );

  return (
    <main className="mx-auto max-w-7xl px-4 pb-20">
      {header}
      {error && <div className="card mb-4 border-red-500/40 bg-red-500/10 text-sm text-red-200">{error}</div>}

      {step === "upload" && <Upload onFile={(f) => onSource(f)} onSample={() => onSource("/sample/synthetic-rally.mp4", "synthetic-rally.mp4")} busy={busy} />}

      {step === "calibrate" && loaded && meta && corners && (
        <Calibrate
          video={loaded.video}
          meta={meta}
          corners={corners}
          source={cornerSource}
          onCorners={(c, src) => { setCorners(c); setCornerSource(src); }}
          onAutoDetect={async (t) => { const q = await autoDetect(loaded, t); if (q) { setCorners(q); setCornerSource("auto"); } return !!q; }}
          settings={settings}
          onSettings={setSettings}
          onAnalyze={start}
        />
      )}

      {step === "analyzing" && progress && (
        <div className="card mx-auto mt-10 max-w-xl text-center">
          <div className="label">{progress.phase}</div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-panel-2">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round((100 * progress.done) / Math.max(1, progress.total))}%` }} />
          </div>
          <div className="mt-3 text-sm text-muted">{progress.done} / {progress.total} frames{progress.detail ? ` · ${progress.detail}` : ""}</div>
          <p className="mt-4 text-xs text-muted">Everything runs locally in this tab — the video never leaves your device. Keep the tab in the foreground.</p>
          <button className="btn-ghost mt-4" onClick={() => abortRef.current?.abort()}>Stop early and show what was found</button>
        </div>
      )}

      {step === "review" && loaded && analysis && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <Player video={loaded.video} analysis={analysis} overlay={overlay} onOverlay={setOverlay} seekReq={seekReq} />
            <StatsPanel analysis={analysis} />
            <Insights analysis={analysis} onJump={jump} />
          </div>
          <div className="space-y-4">
            <RallyList analysis={analysis} onOverride={updateRally} onJump={jump} />
            <ExportPanel video={loaded.video} analysis={analysis} overlay={overlay} />
          </div>
        </div>
      )}
    </main>
  );
}

function Upload({ onFile, onSample, busy }: { onFile: (f: File) => void; onSample: () => void; busy: boolean }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const features = useMemo(() => [
    ["Shuttle trajectory", "Comet-trail of the shuttle, tracked frame by frame."],
    ["Smash speed", "Estimated km/h badge on every shot, with the fastest highlighted."],
    ["2D court tracker", "Top-down minimap with player positions and where rallies ended."],
    ["Auto score", "Rally detection with a heuristic scorer you can correct in one click."],
    ["Player tracking", "Pose skeletons and distance covered per player."],
    ["Export", "Burn the overlays into an MP4/WebM, or share a stats card."],
  ], []);
  return (
    <div className="grid gap-8 py-6 lg:grid-cols-2 lg:items-center">
      <div>
        <h1 className="text-4xl font-black leading-tight tracking-tight sm:text-5xl">
          Turn your phone-recorded badminton game into a <span className="text-shuttle">broadcast-style</span> breakdown.
        </h1>
        <p className="mt-4 max-w-prose text-muted">
          Upload a clip shot from behind the court. RallyVision tracks the shuttle, estimates shot speed, maps players onto a 2D court,
          finds every rally and keeps score — all in your browser, nothing uploaded.
        </p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {features.map(([t, d]) => (
            <li key={t} className="rounded-xl border border-line bg-panel p-3">
              <div className="text-sm font-bold">{t}</div>
              <div className="text-xs text-muted">{d}</div>
            </li>
          ))}
        </ul>
      </div>
      <div
        className={`card flex min-h-[320px] flex-col items-center justify-center border-dashed text-center transition ${drag ? "border-accent bg-panel-2" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      >
        <div className="text-5xl">🏸</div>
        <div className="mt-3 text-lg font-bold">Drop a match video here</div>
        <div className="mt-1 text-sm text-muted">MP4 / MOV / WebM · best results: static camera behind the baseline, whole court visible, 15–90s clips</div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button className="btn-primary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Loading…" : "Choose video"}</button>
          <button className="btn-ghost" disabled={busy} onClick={onSample} data-testid="sample">Try the sample clip</button>
        </div>
        <input ref={inputRef} data-testid="file-input" type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </div>
    </div>
  );
}
