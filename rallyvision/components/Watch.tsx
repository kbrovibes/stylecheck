"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Analysis, Rally } from "@/lib/types";
import type { Job } from "@/lib/jobs/types";
import { ACTIVE_STATES, SERVER_STATES, isStalled } from "@/lib/jobs/types";
import type { Insights } from "@/lib/ai/types";
import { deleteJob, editKeyFor, useJob, useServerConfig } from "@/lib/jobs/client";
import { useSettings } from "@/lib/settings";
import { effectiveWinner, formatSpeed } from "@/lib/render/overlay";
import { fmtAgo, fmtBytes, fmtDuration, fmtEta } from "@/lib/format";
import AppHeader from "@/components/AppHeader";
import { IconBack, IconDownload, IconImage, IconShare, IconSparkle } from "@/components/Icons";
import { Badge } from "@/components/ui";
import { Spinner } from "@/components/NewVideo";

export default function Watch({ id }: { id: string }) {
  const { job, error } = useJob(id);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const settings = useSettings();

  useEffect(() => {
    const url = job?.output?.analysisUrl;
    if (!url) return;
    let on = true;
    void fetch(url).then((r) => r.json()).then((a: Analysis) => { if (on) setAnalysis(a); }).catch(() => {});
    return () => { on = false; };
  }, [job?.output?.analysisUrl]);

  const seek = (t: number) => { const v = videoRef.current; if (!v) return; v.currentTime = Math.max(0, t - 0.3); void v.play().catch(() => {}); v.scrollIntoView({ behavior: "smooth", block: "center" }); };

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-4">
        <Link href="/" className="btn-ghost -ml-3 h-9 px-3 text-muted"><IconBack size={16} /> Library</Link>
        {error && !job && <div className="mt-6 text-sm text-danger">{error === "Not found" ? "This video doesn't exist or was deleted." : error}</div>}
        {!job && !error && <div className="mt-10 flex items-center gap-3 text-sm text-muted"><Spinner /> Loading…</div>}
        {job && (
          <div className="mt-3 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-6">
              <div>
                <h1 className="font-display text-2xl font-semibold">{job.summary ? `${job.summary.nearLabel} vs ${job.summary.farLabel}` : job.source.name}</h1>
                <div className="mt-1 text-sm text-muted">{job.source.name} · {fmtAgo(job.createdAt)} · {job.source.device}</div>
              </div>
              {job.state === "done" && job.output ? (
                <video
                  ref={videoRef}
                  data-testid="watch-video"
                  src={job.output.videoUrl}
                  poster={job.output.posterUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full rounded-2xl bg-black shadow-[var(--shadow-pop)]"
                  style={{ aspectRatio: `${job.output.width} / ${job.output.height}` }}
                />
              ) : (
                <Progress job={job} />
              )}
              {job.state === "done" && job.output && <Actions job={job} />}
              {job.summary && <Stats job={job} analysis={analysis} unit={settings.overlay.speedUnit} />}
              {analysis && <Rallies analysis={analysis} onSeek={seek} unit={settings.overlay.speedUnit} />}
            </div>
            <aside className="space-y-6">
              {job.state === "done" && <Coach job={job} onSeek={seek} />}
              <Details job={job} analysis={analysis} />
            </aside>
          </div>
        )}
      </main>
    </>
  );
}

function Progress({ job }: { job: Job }) {
  const stalled = isStalled(job);
  const server = SERVER_STATES.includes(job.state);
  const pct = Math.round(job.progress * 100);
  return (
    <div className="card grid aspect-video place-items-center p-6 text-center">
      <div className="w-full max-w-sm">
        {job.state === "failed" ? (
          <>
            <div className="text-sm font-medium text-danger">Processing failed</div>
            <div className="mt-1 break-words text-xs text-muted">{job.error}</div>
          </>
        ) : job.state === "cancelled" ? (
          <div className="text-sm text-muted">Cancelled.</div>
        ) : (
          <>
            <div className="eyebrow">{stalled ? "Stalled" : job.phase ?? job.state}</div>
            <div className="num mt-3 font-display text-5xl font-semibold">{pct}%</div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-subtle"><div className="h-full rounded-full bg-ink transition-[width] duration-700" style={{ width: `${Math.max(2, pct)}%` }} /></div>
            <div className="mt-3 text-xs text-muted">
              {stalled
                ? server ? "The cloud worker stopped reporting. It may have timed out." : "The phone that uploaded this stopped responding (app closed before the upload finished)."
                : server ? <>Running in the cloud. {fmtEta(job.etaSec)} · safe to close the app.</> : "Waiting for the uploading phone…"}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Actions({ job }: { job: Job }) {
  const router = useRouter();
  const mine = !!editKeyFor(job.id);
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${location.origin}/v/${job.id}`;
    if (navigator.share) { try { await navigator.share({ title: "RallyVision", url }); return; } catch { /* dismissed */ } }
    await navigator.clipboard.writeText(url);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <button className="btn-primary" onClick={share}><IconShare size={16} /> {copied ? "Link copied" : "Share"}</button>
      <a className="btn-secondary" href={`${job.output!.videoUrl}?download=1`} download><IconDownload size={16} /> Video <span className="num text-xs text-muted">{fmtBytes(job.output!.videoBytes)}</span></a>
      {job.output!.cardUrl && <a className="btn-secondary" href={`${job.output!.cardUrl}?download=1`} download><IconImage size={16} /> Stats card</a>}
      {mine && (
        <button className="btn-ghost ml-auto text-danger" onClick={async () => { if (window.confirm("Delete this video for everyone?")) { await deleteJob(job.id); router.push("/"); } }}>Delete</button>
      )}
    </div>
  );
}

function Stats({ job, analysis, unit }: { job: Job; analysis: Analysis | null; unit: "kmh" | "mph" }) {
  const s = job.summary!;
  const top = s.topSpeedKmh ? formatSpeed(s.topSpeedKmh, unit) : null;
  const st = analysis?.stats;
  const tiles: Array<[string, string, string?]> = [
    ["Score", `${s.scoreNear}–${s.scoreFar}`, `${s.nearLabel} – ${s.farLabel}`],
    ["Top speed", top ? `${top.value}` : "—", top ? `${top.unit} · estimated` : "not measured"],
    ["Rallies", `${s.rallies}`, `${s.shots} shots`],
    ["Longest rally", st ? `${st.longestRallyShots}` : "—", st ? `shots · ${st.longestRallySec}s` : undefined],
    ["Smashes", `${s.smashes}`, undefined],
    ["Distance", st ? `${st.playerDistanceM.near} / ${st.playerDistanceM.far}` : "—", "metres · near / far"],
  ];
  return (
    <section>
      <h2 className="eyebrow mb-3">Match stats</h2>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
        {tiles.map(([k, v, sub]) => (
          <div key={k} className="bg-surface p-4">
            <div className="label">{k}</div>
            <div className="num mt-1 text-2xl font-semibold">{v}</div>
            {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

function Rallies({ analysis, onSeek, unit }: { analysis: Analysis; onSeek: (t: number) => void; unit: "kmh" | "mph" }) {
  const { nearLabel, farLabel } = analysis.settings;
  const name = (w: ReturnType<typeof effectiveWinner>) => (w === "near" ? nearLabel : w === "far" ? farLabel : "—");
  const scoreAfter = (r: Rally) => analysis.score.find((e) => e.f === r.endF);
  return (
    <section>
      <h2 className="eyebrow mb-3">Rallies</h2>
      <div className="card divide-y divide-line">
        {analysis.rallies.length === 0 && <div className="p-4 text-sm text-muted">No rallies found. Check that the camera was steady and the whole court was visible.</div>}
        {analysis.rallies.map((r) => {
          const w = effectiveWinner(r);
          const sc = scoreAfter(r);
          return (
            <button key={r.id} onClick={() => onSeek(r.startT)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-subtle/60">
              <span className="num w-10 shrink-0 text-xs text-muted">{fmtDuration(r.startT)}</span>
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium">Rally {r.id + 1}</span>
                <span className="ml-2 text-xs text-muted">{r.hits.length} shots{r.maxSpeedKmh ? ` · ${formatSpeed(r.maxSpeedKmh, unit).value} ${formatSpeed(1, unit).unit}` : ""}</span>
                <span className="block truncate text-xs text-muted" title={r.winnerReason}>Point {name(w)} · {r.winnerReason}</span>
              </span>
              <span className={`h-2 w-2 shrink-0 rounded-full ${w === "near" ? "bg-near" : w === "far" ? "bg-far" : "bg-line-strong"}`} />
              <span className="num w-12 shrink-0 text-right text-sm font-semibold">{sc ? `${sc.near}–${sc.far}` : ""}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">Winners are an automatic guess from where the shuttle landed.</p>
    </section>
  );
}

function Coach({ job, onSeek }: { job: Job; onSeek: (t: number) => void }) {
  const settings = useSettings();
  const config = useServerConfig();
  const [data, setData] = useState<Insights | null>(job.insights ?? null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/insights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: job.id, provider: settings.aiProvider === "auto" ? undefined : settings.aiProvider, model: settings.claudeModel }) });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData((await res.json()) as Insights);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  };
  const hasAi = config ? config.ai.anthropic || config.ai.gemini : false;
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><IconSparkle size={16} /> Coach notes</h2>
        <button className="btn-secondary h-8 px-3 text-xs" onClick={run} disabled={loading} data-testid="insights">{loading ? "Writing…" : data ? "Regenerate" : "Generate"}</button>
      </div>
      {!data && !loading && <p className="mt-2 text-xs text-muted">{hasAi ? "Written by AI from the measured stats." : "Template notes from the measured stats (no AI key configured)."}</p>}
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
      {data && (
        <div className="mt-3 space-y-3 text-sm" data-testid="insights-result">
          <div className="font-display text-base font-semibold" data-testid="insights-headline">{data.headline}</div>
          <p className="text-ink-2">{data.summary}</p>
          {data.highlights.length > 0 && (
            <ul className="space-y-1.5">
              {data.highlights.map((h, i) => (
                <li key={i} className="flex gap-2"><button className="num shrink-0 rounded-md bg-subtle px-1.5 text-xs text-ink" onClick={() => onSeek(h.atSec)}>{fmtDuration(h.atSec)}</button><span className="text-ink-2"><b className="font-medium text-ink">{h.title}.</b> {h.detail}</span></li>
              ))}
            </ul>
          )}
          {data.tips.length > 0 && (
            <ul className="space-y-1.5">
              {data.tips.map((t, i) => <li key={i} className="text-ink-2"><span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${t.side === "near" ? "bg-near" : "bg-far"}`} />{t.tip}</li>)}
            </ul>
          )}
          <div className="text-[11px] text-muted">{data.provider === "mock" ? "Template notes" : `${data.provider} · ${data.model}`}</div>
        </div>
      )}
    </section>
  );
}

function Details({ job, analysis }: { job: Job; analysis: Analysis | null }) {
  const t = job.timings ?? {};
  const sec = (ms?: number) => (ms ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s` : "—");
  const stalled = isStalled(job);
  const rows: Array<[string, React.ReactNode]> = [
    ["State", <Badge key="s" tone={job.state === "done" ? "ok" : job.state === "failed" ? "danger" : stalled ? "warn" : ACTIVE_STATES.includes(job.state) ? "live" : "neutral"}>{stalled ? "stalled" : job.state.replace("_", " ")}</Badge>],
    ["Original", `${fmtBytes(job.source.sizeBytes)} · ${fmtDuration(job.source.durationSec)} · ${job.source.width}×${job.source.height} · ${job.source.fps} fps`],
    ["Uploaded", job.upload ? `${fmtBytes(job.upload.bytes)}${job.upload.compressed ? " · compressed on phone" : " · original"}${job.upload.trimSec ? ` · first ${job.upload.trimSec}s` : ""}` : "—"],
    ["Output", job.output ? `${fmtBytes(job.output.videoBytes)} · ${job.output.width}×${job.output.height} · H.264` : "—"],
    ["Engine", analysis ? `${analysis.engine.shuttle} shuttle · ${analysis.engine.players} players` : "—"],
    ["Timings", `prep ${sec(t.prepareMs)} · upload ${sec(t.uploadMs)} · analyse ${sec(t.analysisMs)} · render ${sec(t.renderMs)}`],
    ["Updated", fmtAgo(job.updatedAt)],
    ["ID", <span key="id" className="num">{job.id}</span>],
  ];
  return (
    <section>
      <h2 className="eyebrow mb-3">Details</h2>
      <dl className="card divide-y divide-line text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 px-4 py-2.5">
            <dt className="w-20 shrink-0 text-muted">{k}</dt>
            <dd className="min-w-0 flex-1 break-words text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
