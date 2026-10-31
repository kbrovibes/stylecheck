"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Analysis, AnalysisSettings, CourtCalibration, Progress, Pt, VideoMeta } from "@/lib/types";
import { loadVideo, probeFps, seekTo, type LoadedVideo } from "@/lib/video/frames";
import { buildCalibration, defaultCorners } from "@/lib/cv/geometry";
import { runAnalysis, recompute } from "@/lib/cv/pipeline";
import { resolveAnalysisSettings, updateSettings, useSettings } from "@/lib/settings";
import { takePendingLocalVideo } from "@/lib/pending";
import { keepAwake } from "@/lib/device";
import { fmtDuration } from "@/lib/format";
import AppHeader from "@/components/AppHeader";
import CourtMarker from "@/components/CourtMarker";
import Player from "@/components/Player";
import RallyList from "@/components/RallyList";
import StatsPanel from "@/components/StatsPanel";
import ExportPanel from "@/components/ExportPanel";
import Insights from "@/components/Insights";
import { autoDetectCorners } from "@/components/NewVideo";
import { Segmented } from "@/components/ui";
import { IconUpload } from "@/components/Icons";

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

/** On-device mode: the whole pipeline runs in this tab; nothing is uploaded. */
export default function Studio() {
  const appSettings = useSettings();
  const [step, setStep] = useState<Step>("upload");
  const [loaded, setLoaded] = useState<LoadedVideo | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [corners, setCorners] = useState<[Pt, Pt, Pt, Pt] | null>(null);
  const [cornerSource, setCornerSource] = useState<CourtCalibration["source"]>("default");
  const [overrides, setOverrides] = useState<Partial<AnalysisSettings>>({});
  const [progress, setProgress] = useState<Progress | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seekReq, setSeekReq] = useState<{ t: number; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rate, setRate] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const settings: AnalysisSettings = useMemo(() => ({ ...resolveAnalysisSettings(appSettings), ...overrides }), [appSettings, overrides]);
  const stateRef = useRef({ step, analysis, meta, corners });
  useEffect(() => { stateRef.current = { step, analysis, meta, corners }; }, [step, analysis, meta, corners]);

  const onSource = useCallback(async (src: File | string, name?: string, trimSec: number | null = null) => {
    setError(null);
    setBusy(true);
    try {
      const lv = await loadVideo(src);
      const fps = await probeFps(lv.video);
      const duration = trimSec ? Math.min(trimSec, lv.duration) : lv.duration;
      setLoaded(lv);
      setMeta({ width: lv.width, height: lv.height, fps, duration, frames: Math.floor(duration * fps), name: name ?? (src instanceof File ? src.name : src.split("/").pop() ?? "video") });
      const at = Math.min(1, lv.duration / 3);
      const q = await autoDetectCorners(lv, at);
      setCorners(q ?? defaultCorners(lv.width, lv.height));
      setCornerSource(q ? "auto" : "default");
      await seekTo(lv.video, at);
      setAnalysis(null);
      setStep("calibrate");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // video handed over from the library page
  useEffect(() => {
    const p = takePendingLocalVideo();
    if (!p) return;
    const duration = p.trimSec ? Math.min(p.trimSec, p.lv.duration) : p.lv.duration;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hand-off from another route */
    setLoaded(p.lv);
    setMeta({ width: p.lv.width, height: p.lv.height, fps: p.fps, duration, frames: Math.floor(duration * p.fps), name: p.file.name });
    setCorners(p.corners);
    setCornerSource(p.source);
    setStep("calibrate");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const start = useCallback(async () => {
    if (!loaded || !meta || !corners) return;
    setError(null);
    setStep("analyzing");
    setProgress({ phase: "Starting", done: 0, total: 1 });
    const cal = buildCalibration(corners, settings.mode, cornerSource);
    const ac = new AbortController();
    abortRef.current = ac;
    const release = appSettings.keepAwake ? await keepAwake() : () => {};
    const t0 = performance.now();
    try {
      const a = await runAnalysis(loaded.video, meta, cal, settings, (p) => { setProgress(p); if (p.done > 10) setRate(p.done / ((performance.now() - t0) / 1000)); }, ac.signal);
      setAnalysis(a);
      await seekTo(loaded.video, a.rallies[0]?.startT ?? 0);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("calibrate");
    } finally {
      release();
    }
  }, [loaded, meta, corners, settings, cornerSource, appSettings.keepAwake]);

  useEffect(() => {
    window.__rallyvision = {
      loadUrl: (url, name) => onSource(url, name),
      setCorners: (c) => { setCorners(c); setCornerSource("manual"); },
      setSettings: (s) => setOverrides((prev) => ({ ...prev, ...s })),
      start,
      getStep: () => stateRef.current.step,
      getAnalysis: () => stateRef.current.analysis,
      getMeta: () => stateRef.current.meta,
      getCorners: () => stateRef.current.corners,
    };
  }, [onSource, start]);

  const updateRally = useCallback((id: number, override: Analysis["rallies"][number]["override"]) => {
    setAnalysis((a) => (a ? recompute({ ...a, rallies: a.rallies.map((r) => (r.id === id ? { ...r, override } : r)) }) : a));
  }, []);
  const jump = useCallback((t: number) => setSeekReq((s) => ({ t, n: (s?.n ?? 0) + 1 })), []);

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">On-device mode</div>
            <h1 className="font-display mt-1 text-2xl font-semibold">{meta ? meta.name : "Analyze on this device"}</h1>
          </div>
          {step !== "upload" && (
            <button className="btn-secondary" onClick={() => { abortRef.current?.abort(); setStep("upload"); setAnalysis(null); setLoaded(null); }}>New video</button>
          )}
        </div>
        {error && <div className="mb-4 rounded-2xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</div>}

        {step === "upload" && (
          <div className="card grid place-items-center px-6 py-16 text-center">
            <p className="max-w-md text-sm text-ink-2">Everything runs in this browser tab and nothing is uploaded. Keep the tab open while it works. On phones, cloud mode (Settings) is much faster.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <button className="btn-primary" disabled={busy} onClick={() => inputRef.current?.click()}><IconUpload size={16} /> {busy ? "Opening…" : "Choose video"}</button>
              <button className="btn-secondary" disabled={busy} onClick={() => onSource("/sample/synthetic-rally.mp4", "synthetic-rally.mp4")} data-testid="sample">Try the sample</button>
              <Link href="/" className="btn-ghost">Back to library</Link>
            </div>
            <input ref={inputRef} data-testid="file-input" type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onSource(f, undefined, f.size > 0 ? null : null); }} />
          </div>
        )}

        {step === "calibrate" && loaded && meta && corners && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              <div className="eyebrow mb-2">Mark the court</div>
              <CourtMarker video={loaded.video} width={meta.width} height={meta.height} duration={meta.duration} corners={corners} source={cornerSource} mode={settings.mode}
                onCorners={(c, src) => { setCorners(c); setCornerSource(src); }}
                onAutoDetect={async (t) => { const q = await autoDetectCorners(loaded, t); if (q) { setCorners(q); setCornerSource("auto"); } return !!q; }} />
            </div>
            <div className="space-y-5">
              <div>
                <div className="eyebrow mb-2">Players</div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" aria-label="Near side" value={appSettings.nearLabel} onChange={(e) => { updateSettings({ nearLabel: e.target.value }); setOverrides((o) => ({ ...o, nearLabel: undefined })); }} />
                  <input className="input" aria-label="Far side" value={appSettings.farLabel} onChange={(e) => { updateSettings({ farLabel: e.target.value }); setOverrides((o) => ({ ...o, farLabel: undefined })); }} />
                </div>
                <div className="mt-3"><Segmented value={appSettings.mode} onChange={(v) => updateSettings({ mode: v })} options={[{ value: "singles", label: "Singles" }, { value: "doubles", label: "Doubles" }]} /></div>
              </div>
              <div className="rounded-2xl bg-subtle p-3 text-xs text-ink-2">
                <span className="num">{fmtDuration(meta.duration)} · {meta.fps} fps · ~{Math.ceil(meta.frames / settings.stride)} frames</span> · {settings.analysisWidth}p · {settings.usePose ? "pose" : "motion"} players. <Link className="underline" href="/settings">Change engine</Link>
              </div>
              <button className="btn-primary h-12 w-full text-base" data-testid="analyze" onClick={start}>Analyze</button>
            </div>
          </div>
        )}

        {step === "analyzing" && progress && (
          <div className="card mx-auto mt-6 max-w-md p-6 text-center">
            <div className="eyebrow">{progress.phase}</div>
            <div className="num font-display mt-3 text-5xl font-semibold">{Math.round((100 * progress.done) / Math.max(1, progress.total))}%</div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-subtle"><div className="h-full bg-ink transition-[width]" style={{ width: `${Math.round((100 * progress.done) / Math.max(1, progress.total))}%` }} /></div>
            <div className="num mt-3 text-xs text-muted">{progress.done} / {progress.total} frames{rate ? ` · ${rate.toFixed(0)} fps · ${fmtDuration((progress.total - progress.done) / rate)} left` : ""}</div>
            <p className="mt-4 text-xs text-muted">Runs locally in this tab. Keep it in the foreground.</p>
            <button className="btn-secondary mt-4" onClick={() => abortRef.current?.abort()}>Stop and show results so far</button>
          </div>
        )}

        {step === "review" && loaded && analysis && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-6">
              <Player video={loaded.video} analysis={analysis} overlay={appSettings.overlay} onOverlay={(o) => updateSettings({ overlay: o })} seekReq={seekReq} />
              <StatsPanel analysis={analysis} />
              <Insights analysis={analysis} onJump={jump} />
            </div>
            <div className="space-y-6">
              <RallyList analysis={analysis} onOverride={updateRally} onJump={jump} />
              <ExportPanel video={loaded.video} analysis={analysis} overlay={appSettings.overlay} />
            </div>
          </div>
        )}
      </main>
    </>
  );
}
