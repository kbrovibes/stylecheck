"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CLAUDE_MODELS, resetSettings, updateSettings, useSettings, type AppSettings } from "@/lib/settings";
import { effectiveProcessing, useServerConfig } from "@/lib/jobs/client";
import { detectCapabilities, type Capabilities } from "@/lib/device";
import type { OverlayOptions } from "@/lib/render/overlay";
import AppHeader from "@/components/AppHeader";
import { Segmented, Switch, Unavailable } from "@/components/ui";
import { IconCheck, IconX } from "@/components/Icons";

export default function SettingsPage() {
  const saved = useSettings();
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const s = draft ?? saved;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const cfg = useServerConfig();
  const [caps, setCaps] = useState<Capabilities | null>(null);
  useEffect(() => { void detectCapabilities().then(setCaps); }, []);
  const set = (p: Partial<AppSettings>) => { setJustSaved(false); setDraft({ ...(draft ?? saved), ...p }); };
  const ov = (p: Partial<OverlayOptions>) => set({ overlay: { ...s.overlay, ...p } });
  const save = () => { if (draft) updateSettings(draft); setDraft(null); setJustSaved(true); setTimeout(() => setJustSaved(false), 2500); };
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const cloud = cfg?.processing.cloud ?? false, modal = cfg?.processing.modal ?? false;
  const eff = effectiveProcessing(s.processing, cfg);
  const local = eff === "device";

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 pb-36 pt-8">
        <h1 className="font-display text-3xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted">Saved on this device when you press Save. Greyed-out options need setup on the server or aren&apos;t supported by this browser.</p>

        <Section title="Processing" note="Where the analysis runs.">
          <Row label="Mode" desc={
            s.processing === "cloud" ? "Upload, then our servers analyse and render on CPU. You can close the app after the upload."
            : s.processing === "modal" ? "Upload, then a GPU runs the TrackNetV3 neural shuttle tracker and pose model. Most accurate; you can close the app."
            : "Everything runs in this browser and nothing is uploaded. The tab must stay open; slow on phones."
          } wide>
            <Segmented value={eff} onChange={(v) => set({ processing: v })} options={[
              { value: "cloud", label: "Cloud CPU", disabled: !cloud, title: cloud ? undefined : "Needs Vercel Sandbox + storage env vars" },
              { value: "modal", label: "Cloud GPU (Modal)", disabled: !modal, title: modal ? undefined : "Needs MODAL_DETECT_URL" },
              { value: "device", label: "On this device" },
            ]} />
            {cfg && !cloud && <Unavailable reason="Cloud CPU needs the job store (Upstash Redis) and Sandbox snapshot configured." />}
            {cfg && !modal && <Unavailable reason="Cloud GPU needs the Modal worker deployed (MODAL_DETECT_URL)." />}
          </Row>
          <Row label="Trim long videos to" desc="Default for clips longer than this. You can still pick the full video per upload.">
            <Segmented size="sm" value={s.trimSeconds} onChange={(v) => set({ trimSeconds: v })} options={[{ value: 60, label: "60s" }, { value: 90, label: "90s" }, { value: 120, label: "2 min" }]} />
          </Row>
          <Row label="Compress on phone before upload" desc="Re-encodes to 720p H.264 (like WhatsApp). Uploads ~25 MB instead of the original." disabled={caps ? !caps.h264Encode : false} reason="This browser can't encode H.264 (needs WebCodecs).">
            <Switch label="Compress" checked={s.compressOnPhone && (caps?.h264Encode ?? true)} disabled={caps ? !caps.h264Encode : false} onChange={(v) => set({ compressOnPhone: v })} />
          </Row>
          <Row label="Max clip length" desc="Longer videos must be trimmed.">
            <Segmented size="sm" value={s.maxClipMinutes} onChange={(v) => set({ maxClipMinutes: v })} options={[{ value: 2, label: "2 min" }, { value: 5, label: "5 min" }, { value: 10, label: "10 min" }]} />
          </Row>
          <Row label="Max upload size" desc="Larger files are compressed first, or blocked if the browser can't.">
            <Segmented size="sm" value={s.maxFileMb} onChange={(v) => set({ maxFileMb: v })} options={[{ value: 500, label: "500 MB" }, { value: 1000, label: "1 GB" }, { value: 2000, label: "2 GB" }]} />
          </Row>
        </Section>

        <Section title="Analysis engine" note={local ? "Used by on-device mode." : "On-device mode only: the cloud picks its own engine from the mode above."}>
          <Row label="Shuttle tracker" desc="The built-in motion tracker needs no download. TrackNetV3 in the browser needs an ONNX model URL." disabled={!local}>
            <Segmented size="sm" value={s.shuttleEngine} onChange={(v) => set({ shuttleEngine: v })} options={[
              { value: "classical", label: "Motion tracker", disabled: !local },
              { value: "tracknet", label: "TrackNetV3", disabled: !local || !cfg?.tracknet, title: "Needs NEXT_PUBLIC_TRACKNET_ONNX_URL" },
            ]} />
            {cfg && !cfg.tracknet && <Unavailable reason="TrackNetV3 in the browser needs an exported ONNX model (docs/UNBLOCK.md)." />}
          </Row>
          <Row label="Player detection" desc="Pose (MediaPipe on the GPU via WebGL) draws skeletons and is more accurate. Motion-only is faster." disabled={!local || (caps ? !caps.webgl2 : false)} reason={caps && !caps.webgl2 ? "Needs WebGL2." : undefined}>
            <Segmented size="sm" value={s.players} onChange={(v) => set({ players: v })} options={[{ value: "pose", label: "Pose", disabled: !local || (caps ? !caps.webgl2 : false) }, { value: "motion", label: "Motion only", disabled: !local }]} />
          </Row>
          <Row label="Analysis resolution" desc="Auto picks 480p on phones and 640p on computers." disabled={!local}>
            <Segmented size="sm" value={s.analysisWidth} onChange={(v) => set({ analysisWidth: v })} options={[{ value: "auto", label: "Auto", disabled: !local }, { value: 480, label: "480p", disabled: !local }, { value: 640, label: "640p", disabled: !local }, { value: 960, label: "960p", disabled: !local }]} />
          </Row>
          <Row label="Frames" desc="Every 2nd frame halves the time but misses fast shots." disabled={!local}>
            <Segmented size="sm" value={s.stride} onChange={(v) => set({ stride: v })} options={[{ value: 1, label: "Every frame", disabled: !local }, { value: 2, label: "Every 2nd", disabled: !local }]} />
          </Row>
        </Section>

        <Section title="Match defaults">
          <Row label="Format"><Segmented size="sm" value={s.mode} onChange={(v) => set({ mode: v })} options={[{ value: "singles", label: "Singles" }, { value: "doubles", label: "Doubles" }]} /></Row>
          <Row label="Game to"><Segmented size="sm" value={s.pointsToWin} onChange={(v) => set({ pointsToWin: v })} options={[{ value: 21, label: "21" }, { value: 15, label: "15" }, { value: 11, label: "11" }]} /></Row>
          <Row label="First server"><Segmented size="sm" value={s.startServer} onChange={(v) => set({ startServer: v })} options={[{ value: "near", label: "Near side" }, { value: "far", label: "Far side" }]} /></Row>
          <Row label="Player names" wide>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" aria-label="Near side name" value={s.nearLabel} onChange={(e) => set({ nearLabel: e.target.value })} />
              <input className="input" aria-label="Far side name" value={s.farLabel} onChange={(e) => set({ farLabel: e.target.value })} />
            </div>
          </Row>
        </Section>

        <Section title="Coach notes (AI)">
          <Row label="Provider" desc="Template notes are built from the stats with no AI." wide>
            <Segmented size="sm" value={s.aiProvider} onChange={(v) => set({ aiProvider: v })} options={[
              { value: "auto", label: "Auto" },
              { value: "anthropic", label: "Claude", disabled: !cfg?.ai.anthropic },
              { value: "gemini", label: "Gemini", disabled: !cfg?.ai.gemini },
              { value: "mock", label: "Template only" },
            ]} />
            {cfg && !cfg.ai.anthropic && <Unavailable reason="Claude needs ANTHROPIC_API_KEY on the server." />}
            {cfg && !cfg.ai.gemini && <Unavailable reason="Gemini needs GEMINI_API_KEY on the server." />}
          </Row>
          <Row label="Claude model" disabled={!cfg?.ai.anthropic} wide>
            <div className="grid gap-1.5">
              {CLAUDE_MODELS.map((m) => (
                <button key={m.id} disabled={!cfg?.ai.anthropic} onClick={() => set({ claudeModel: m.id })}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${s.claudeModel === m.id ? "border-ink" : "border-line hover:bg-subtle"}`}>
                  <span><span className="font-medium">{m.label}</span><span className="ml-2 text-xs text-muted">{m.note}</span></span>
                  {s.claudeModel === m.id && <IconCheck size={16} />}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        <Section title="Video overlays" note="What gets drawn on the rendered video.">
          {([
            ["trail", "Shuttle trail", "Glowing trail behind the shuttle"],
            ["speed", "Speed badges", "Estimated km/h after each measured shot"],
            ["players", "Player rings & names", "Ground ring and name tag under each player"],
            ["skeleton", "Pose skeletons", "Only when pose data exists (GPU or on-device modes)"],
            ["minimap", "Court minimap", "Top-down view with players and landing spots"],
            ["score", "Scoreboard", "Score, server and rally counter"],
            ["banner", "Point banner", "Who won each rally"],
            ["court", "Court lines", "Re-draws the court lines (helps check calibration)"],
            ["watermark", "Watermark", "“RallyVision · speeds estimated”"],
          ] as Array<[keyof OverlayOptions, string, string]>).map(([k, label, desc]) => (
            <Row key={k} label={label} desc={desc}><Switch label={label} checked={!!s.overlay[k]} onChange={(v) => ov({ [k]: v } as Partial<OverlayOptions>)} /></Row>
          ))}
          <Row label="Rough speeds" desc="Also show speeds the estimator flags as unreliable."><Switch label="Rough speeds" checked={s.overlay.showUnreliable} onChange={(v) => ov({ showUnreliable: v })} /></Row>
          <Row label="Speed unit"><Segmented size="sm" value={s.overlay.speedUnit} onChange={(v) => ov({ speedUnit: v })} options={[{ value: "kmh", label: "km/h" }, { value: "mph", label: "mph" }]} /></Row>
        </Section>

        <Section title="Export">
          <Row label="Rendered video quality"><Segmented size="sm" value={s.exportWidth >= 1080 ? 1080 : 720} onChange={(v) => set({ exportWidth: v })} options={[{ value: 720, label: "720p" }, { value: 1080, label: "1080p" }]} /></Row>
          <Row label="Audio in the rendered video" desc="Cloud renders keep the original audio. On-device MP4 export is video-only.">
            <span className="text-xs text-muted">{local ? "Video only" : "Kept"}</span>
          </Row>
          <Row label="On-device export format" desc="MP4 needs WebCodecs; WebM records in real time and keeps audio." disabled={!local}>
            <Segmented size="sm" value={s.exportFormat} onChange={(v) => set({ exportFormat: v })} options={[{ value: "auto", label: "MP4 (fast)", disabled: !local || (caps ? !caps.h264Encode : false) }, { value: "webm", label: "WebM", disabled: !local || (caps ? !caps.mediaRecorder : false) }]} />
          </Row>
        </Section>

        <Section title="Appearance & device">
          <Row label="Theme"><Segmented size="sm" value={s.theme} onChange={(v) => set({ theme: v })} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} /></Row>
          <Row label="Keep screen awake" desc="While compressing, uploading or analysing on this device." disabled={caps ? !caps.wakeLock : false} reason="This browser has no Wake Lock API.">
            <Switch label="Keep awake" checked={s.keepAwake} disabled={caps ? !caps.wakeLock : false} onChange={(v) => set({ keepAwake: v })} />
          </Row>
          <Row label="This device" wide>
            {caps ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                {([
                  ["GPU (WebGL2)", caps.webgl2], ["Hardware video encode", caps.h264Encode], ["WebCodecs", caps.webcodecs],
                  ["Frame callbacks", caps.frameCallback], ["Screen wake lock", caps.wakeLock], ["Share to Photos", caps.shareFiles],
                ] as Array<[string, boolean]>).map(([k, ok]) => (
                  <span key={k} className={`flex items-center gap-1.5 ${ok ? "text-ink-2" : "text-muted line-through"}`}>{ok ? <IconCheck size={13} /> : <IconX size={13} />}{k}</span>
                ))}
                <span className="text-muted">{caps.cores ?? "?"} cores{caps.memoryGb ? ` · ${caps.memoryGb} GB` : ""}</span>
              </div>
            ) : <span className="text-xs text-muted">Checking…</span>}
          </Row>
          <Row label="Storage" desc="Where finished videos are kept." wide>
            <span className="text-xs text-ink-2">{cfg ? `${cfg.storage.blob ? "Vercel Blob" : "No blob store"} · jobs in ${cfg.storage.jobs === "redis" ? "Upstash Redis" : "server memory (not shared; dev only)"}` : "…"}</span>
          </Row>
        </Section>

        <div className="mt-10 flex justify-end">
          <button className="btn-ghost text-danger" onClick={() => { if (window.confirm("Reset all settings to defaults?")) { resetSettings(); setDraft(null); setJustSaved(true); } }}>Reset to defaults</button>
        </div>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4">
          <span className={`text-sm ${dirty ? "font-medium text-ink" : justSaved ? "text-ok" : "text-muted"}`} data-testid="settings-state">
            {dirty ? "Unsaved changes" : justSaved ? "Saved ✓" : "All changes saved"}
          </span>
          <div className="flex gap-2">
            <button className="btn-ghost" disabled={!dirty} onClick={() => setDraft(null)}>Discard</button>
            <button className="btn-primary px-6" disabled={!dirty} onClick={save} data-testid="settings-save">Save</button>
          </div>
        </div>
      </div>
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-base font-semibold">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
      <div className="card mt-3 divide-y divide-line">{children}</div>
    </section>
  );
}

function Row({ label, desc, children, disabled, reason, wide }: { label: string; desc?: string; children: ReactNode; disabled?: boolean; reason?: string; wide?: boolean }) {
  return (
    <div className={`gap-3 px-4 py-3.5 ${wide ? "grid" : "flex flex-wrap items-center justify-between"} ${disabled ? "opacity-50" : ""}`}>
      <div className="min-w-0 max-w-md">
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="mt-0.5 text-xs text-muted">{desc}</div>}
        {disabled && reason && <Unavailable reason={reason} />}
      </div>
      <div className={wide ? "" : "shrink-0"}>{children}</div>
    </div>
  );
}
