"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CourtCalibration, Pt } from "@/lib/types";
import { grabFrame, loadVideo, probeFps, seekTo, type LoadedVideo } from "@/lib/video/frames";
import { defaultCorners } from "@/lib/cv/geometry";
import { detectCourtCorners } from "@/lib/cv/autocourt";
import { resolveAnalysisSettings, updateSettings, useSettings } from "@/lib/settings";
import { effectiveProcessing, submitJob, useServerConfig, type SubmitProgress } from "@/lib/jobs/client";
import { canCompress } from "@/lib/video/compress";
import { setPendingLocalVideo } from "@/lib/pending";
import CourtMarker from "@/components/CourtMarker";
import { IconCheck, IconX } from "@/components/Icons";
import { Segmented } from "@/components/ui";
import { fmtBytes, fmtDuration } from "@/lib/format";

type Loaded = { lv: LoadedVideo; file: File; fps: number; corners: [Pt, Pt, Pt, Pt]; source: CourtCalibration["source"] };

export async function autoDetectCorners(lv: LoadedVideo, at: number): Promise<[Pt, Pt, Pt, Pt] | null> {
  await seekTo(lv.video, at);
  const small = grabFrame(lv.video, 640);
  const q = detectCourtCorners(small.getContext("2d")!.getImageData(0, 0, small.width, small.height));
  const s = lv.width / small.width;
  return q ? (q.map((p) => ({ x: p.x * s, y: p.y * s })) as [Pt, Pt, Pt, Pt]) : null;
}

/** File picked -> court + options -> (compress) upload -> cloud worker. Full-screen sheet. */
export default function NewVideo({ file, onClose }: { file: File; onClose: () => void }) {
  const router = useRouter();
  const settings = useSettings();
  const config = useServerConfig();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trim, setTrim] = useState<"trim" | "full">("trim");
  const [compressOk, setCompressOk] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<SubmitProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let on = true;
    void canCompress().then((ok) => on && setCompressOk(ok));
    (async () => {
      try {
        const lv = await loadVideo(file);
        const fps = await probeFps(lv.video);
        const at = Math.min(1, lv.duration / 3);
        const q = await autoDetectCorners(lv, at);
        await seekTo(lv.video, at);
        if (on) setLoaded({ lv, file, fps, corners: q ?? defaultCorners(lv.width, lv.height), source: q ? "auto" : "default" });
      } catch (e) { if (on) setError(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { on = false; };
  }, [file]);

  const onCorners = useCallback((c: [Pt, Pt, Pt, Pt], source: CourtCalibration["source"]) => setLoaded((l) => (l ? { ...l, corners: c, source } : l)), []);

  if (error) {
    return (
      <Sheet onClose={onClose} title="Couldn't open this video">
        <p className="text-sm text-ink-2">{error}</p>
        <p className="mt-2 text-sm text-muted">Try exporting it as MP4 (H.264) from your phone&apos;s Photos app.</p>
      </Sheet>
    );
  }
  if (!loaded) {
    return (
      <Sheet onClose={onClose} title="Opening video">
        <div className="flex items-center gap-3 text-sm text-muted"><Spinner /> Reading {file.name} ({fmtBytes(file.size)}) and looking for the court…</div>
      </Sheet>
    );
  }

  const { lv } = loaded;
  const long = lv.duration > settings.trimSeconds + 5;
  const useTrim = long && trim === "trim";
  const tooLong = lv.duration > settings.maxClipMinutes * 60;
  const tooBig = file.size > settings.maxFileMb * 1e6;
  const mode = effectiveProcessing(settings.processing, config);
  // compress whenever we trim (don't upload minutes we won't use) or the original is over the size cap
  const willCompress = settings.compressOnPhone && compressOk === true && (useTrim || tooBig);
  const effDur = useTrim ? settings.trimSeconds : lv.duration;
  const blocked = (!useTrim && tooLong) ? `Full video is longer than your ${settings.maxClipMinutes}-minute limit (Settings).`
    : (!willCompress && tooBig) ? `This file is ${fmtBytes(file.size)}, over your ${settings.maxFileMb} MB limit, and this browser can't compress it. Trim it in Photos first.`
    : null;
  const estMB = willCompress ? (effDur * 2.6) / 8 : file.size / 1e6;

  const start = async () => {
    if (mode === "device") {
      setPendingLocalVideo({ lv, file, fps: loaded.fps, corners: loaded.corners, source: loaded.source, trimSec: useTrim ? settings.trimSeconds : null });
      router.push("/local");
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const job = await submitJob({
        file, video: lv.video, meta: { width: lv.width, height: lv.height, fps: loaded.fps, duration: lv.duration },
        trimSec: useTrim ? settings.trimSeconds : null, compress: willCompress,
        corners: loaded.corners, cornerSource: loaded.source,
        settings: resolveAnalysisSettings(settings), overlay: settings.overlay,
        exportShortSide: settings.exportWidth >= 1080 ? 1080 : 720, engine: mode === "modal" ? "modal" : "cloud",
      }, setProgress, ac.signal);
      setProgress({ stage: "started", progress: 1, jobId: job.id });
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (progress) {
    const steps: Array<[SubmitProgress["stage"], string]> = [
      ...(willCompress ? [["preparing", useTrim ? `Trimming to ${settings.trimSeconds}s and compressing on this phone` : "Compressing on this phone"] as [SubmitProgress["stage"], string]] : []),
      ["uploading", `Uploading ${willCompress ? `~${estMB.toFixed(0)} MB` : fmtBytes(file.size)}`],
      ["starting", "Starting the cloud worker"],
    ];
    const order = ["creating", "preparing", "uploading", "starting", "started"];
    const cur = order.indexOf(progress.stage);
    return (
      <Sheet onClose={progress.stage === "started" ? onClose : undefined} title={progress.stage === "started" ? "Processing in the cloud" : "Sending your video"}>
        <ol className="space-y-3">
          {steps.map(([st, label]) => {
            const i = order.indexOf(st);
            const done = cur > i, active = cur === i;
            return (
              <li key={st} className="flex items-start gap-3">
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${done ? "border-ink bg-ink text-bg" : active ? "border-ink" : "border-line"}`}>
                  {done ? <IconCheck size={12} /> : active ? <span className="h-1.5 w-1.5 rounded-full bg-ink" /> : null}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${done || active ? "text-ink" : "text-muted"}`}>{label}</div>
                  {active && (
                    <div className="mt-2">
                      <div className="h-1 overflow-hidden rounded-full bg-subtle"><div className="h-full bg-ink transition-[width]" style={{ width: `${Math.round(progress.progress * 100)}%` }} /></div>
                      <div className="num mt-1 text-xs text-muted">{Math.round(progress.progress * 100)}%{progress.detail ? ` · ${progress.detail}` : ""}</div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {progress.stage === "started" ? (
          <div className="mt-6 rounded-2xl bg-subtle p-4 text-sm text-ink-2">
            <b className="text-ink">You can close the app now.</b> The analysis runs on our servers and the finished video shows up in the library for everyone.
            <div className="mt-4 flex gap-2">
              <button className="btn-primary" onClick={() => router.push(`/v/${progress.jobId}`)}>Watch progress</button>
              <button className="btn-secondary" onClick={onClose}>Back to library</button>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex items-center justify-between gap-3 text-xs text-muted">
            <span>Keep this screen open until the upload finishes{willCompress ? " (the screen stays awake)" : ""}.</span>
            <button className="btn-ghost h-8 px-3" onClick={() => abortRef.current?.abort()}>Cancel</button>
          </div>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} title="New analysis" wide>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="eyebrow mb-2">1 · Mark the court</div>
          <CourtMarker video={lv.video} width={lv.width} height={lv.height} duration={lv.duration} corners={loaded.corners} source={loaded.source} mode={settings.mode}
            onCorners={onCorners} onAutoDetect={async (t) => { const q = await autoDetectCorners(lv, t); if (q) onCorners(q, "auto"); return !!q; }} />
        </div>
        <div className="space-y-5">
          <div>
            <div className="eyebrow mb-2">2 · Clip</div>
            <div className="num text-sm text-ink-2">{fmtDuration(lv.duration)} · {lv.width}×{lv.height} · {loaded.fps} fps · {fmtBytes(file.size)}</div>
            {long && (
              <div className="mt-3">
                <Segmented
                  value={trim}
                  onChange={(v) => setTrim(v)}
                  options={[{ value: "trim", label: `First ${settings.trimSeconds}s` }, { value: "full", label: `Full ${fmtDuration(lv.duration)}` }]}
                />
                <p className="mt-2 text-xs text-muted">
                  {useTrim ? `Only the first ${settings.trimSeconds} seconds are ${willCompress ? "compressed on your phone and " : ""}uploaded.` : tooLong ? "" : `Processing ${fmtDuration(lv.duration)} takes roughly ${Math.max(2, Math.round(lv.duration / 45))}–${Math.max(4, Math.round(lv.duration / 20))} minutes in the cloud.`}
                </p>
              </div>
            )}
          </div>
          <div>
            <div className="eyebrow mb-2">3 · Players</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="label">Near side</span><input className="input mt-1" value={settings.nearLabel} onChange={(e) => updateSettings({ nearLabel: e.target.value })} /></label>
              <label className="block"><span className="label">Far side</span><input className="input mt-1" value={settings.farLabel} onChange={(e) => updateSettings({ farLabel: e.target.value })} /></label>
            </div>
            <div className="mt-3"><Segmented value={settings.mode} onChange={(v) => updateSettings({ mode: v })} options={[{ value: "singles", label: "Singles" }, { value: "doubles", label: "Doubles" }]} /></div>
          </div>
          <div className="rounded-2xl bg-subtle p-3 text-xs text-ink-2">
            {mode === "device" ? "Processing on this device. Keep the tab open until it finishes (Settings → Processing)."
              : <>Upload {willCompress ? <>≈ <b>{estMB.toFixed(0)} MB</b> (compressed on phone)</> : <b>{fmtBytes(file.size)}</b>}, then the cloud does the rest. {mode === "modal" ? "GPU (Modal) engine." : "CPU engine."}</>}
            {mode !== settings.processing && <div className="mt-1 text-warn">{settings.processing === "modal" ? "Cloud GPU" : "Cloud"} processing isn&apos;t set up on this deployment yet, so this runs {mode === "device" ? "on this device" : "on the cloud CPU"}.</div>}
          </div>
          {blocked && <div className="text-xs font-medium text-danger">{blocked}</div>}
          <button className="btn-primary h-12 w-full text-base" data-testid="analyze" disabled={!!blocked || config === null} onClick={start}>
            {mode === "device" ? "Analyze on this device" : "Upload & analyze"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function Sheet({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg/80 backdrop-blur-sm">
      <div className={`mx-auto min-h-full bg-surface px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))] sm:my-8 sm:min-h-0 sm:rounded-3xl sm:border sm:border-line sm:px-6 sm:shadow-[var(--shadow-pop)] ${wide ? "max-w-5xl" : "max-w-lg"}`}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          {onClose && <button className="btn-icon -mr-2" onClick={onClose} aria-label="Close"><IconX /></button>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-ink" />;
}
