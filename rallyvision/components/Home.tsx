"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { Job } from "@/lib/jobs/types";
import { ACTIVE_STATES, isStalled } from "@/lib/jobs/types";
import { editKeyFor, effectiveProcessing, useJobs, useServerConfig } from "@/lib/jobs/client";
import { useSettings } from "@/lib/settings";
import { fmtAgo, fmtBytes, fmtDuration, fmtEta } from "@/lib/format";
import AppHeader from "@/components/AppHeader";
import NewVideo from "@/components/NewVideo";
import { IconPlay, IconUpload } from "@/components/Icons";
import { Badge } from "@/components/ui";

const STATE_LABEL: Record<Job["state"], string> = {
  queued: "Queued", needs_court: "Needs court", preparing: "Compressing on phone", uploading: "Uploading", starting: "Starting",
  analyzing: "Analyzing", rendering: "Rendering", publishing: "Publishing", done: "Ready", failed: "Failed", cancelled: "Cancelled",
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { jobs, now, error } = useJobs();
  const settings = useSettings();
  const mode = effectiveProcessing(settings.processing, useServerConfig());
  const active = (jobs ?? []).filter((j) => ACTIVE_STATES.includes(j.state) || j.state === "failed" || j.state === "cancelled");
  const done = (jobs ?? []).filter((j) => j.state === "done" && j.output);

  const pickSample = async () => {
    const res = await fetch("/sample/synthetic-rally.mp4");
    setFile(new File([await res.blob()], "synthetic-rally.mp4", { type: "video/mp4" }));
  };

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 pb-24">
        <section className="py-10 sm:py-14">
          <h1 className="font-display max-w-2xl text-[34px] font-semibold leading-[1.08] sm:text-5xl">Your badminton, broadcast-ready.</h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-2">
            Upload a phone video shot from behind the court. RallyVision tracks the shuttle, estimates shot speed, maps the players, keeps score and renders a shareable reel.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-2">
            <button className="btn-primary h-11 px-5" onClick={() => inputRef.current?.click()} data-testid="choose-video"><IconUpload size={17} /> Upload a video</button>
            <button className="btn-secondary h-11 px-5" onClick={pickSample} data-testid="sample">Try the sample</button>
            <input ref={inputRef} data-testid="file-input" type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }} />
          </div>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            <span>Phone behind the baseline</span><span>Whole court in frame</span><span>Steady, no zoom</span>
            <span>{mode === "device" ? "Processed on this device" : `Clips over ${settings.trimSeconds}s can be trimmed`}</span>
          </div>
        </section>

        {error && <div className="mb-6 rounded-2xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">Couldn&apos;t load the library: {error}</div>}

        {active.length > 0 && (
          <section className="mb-12">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-display text-lg font-semibold">Jobs</h2>
              <span className="text-xs text-muted">{active.filter((j) => ACTIVE_STATES.includes(j.state)).length} running · live</span>
            </div>
            <div className="card divide-y divide-line overflow-hidden">
              {active.map((j) => <JobRow key={j.id} job={j} now={now} />)}
            </div>
          </section>
        )}

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-lg font-semibold">Library</h2>
            <span className="text-xs text-muted">{jobs ? `${done.length} video${done.length === 1 ? "" : "s"} · visible to everyone` : "Loading…"}</span>
          </div>
          {jobs && done.length === 0 && (
            <div className="card grid place-items-center px-6 py-14 text-center">
              <div className="text-sm font-medium">No videos yet</div>
              <div className="mt-1 max-w-xs text-sm text-muted">Finished analyses appear here with their score, top speed and a player you can share.</div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {done.map((j) => <VideoCard key={j.id} job={j} now={now} />)}
          </div>
        </section>
      </main>
      {file && <NewVideo file={file} onClose={() => setFile(null)} />}
    </>
  );
}

function JobRow({ job, now }: { job: Job; now: number }) {
  const stalled = isStalled(job, now);
  const running = ACTIVE_STATES.includes(job.state) && !stalled;
  const mine = typeof window !== "undefined" && !!editKeyFor(job.id);
  const tone = job.state === "failed" ? "danger" : stalled ? "warn" : job.state === "cancelled" ? "neutral" : "live";
  return (
    <Link href={`/v/${job.id}`} className="flex items-center gap-4 px-4 py-3.5 transition hover:bg-subtle/60" data-testid="job-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{job.source.name}</span>
          {mine && <Badge>yours</Badge>}
        </div>
        <div className="num mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
          <span>{fmtDuration(job.upload?.trimSec ?? job.source.durationSec)}{job.upload?.trimSec ? ` of ${fmtDuration(job.source.durationSec)}` : ""}</span>
          <span>{fmtBytes(job.upload?.bytes ?? job.source.sizeBytes)}{job.upload?.compressed ? " (compressed)" : ""}</span>
          <span>{job.source.width}×{job.source.height}</span>
          <span>{job.source.device}</span>
          <span>{fmtAgo(job.createdAt, now)}</span>
        </div>
        {running && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-subtle">
            <div className="h-full rounded-full bg-near transition-[width] duration-700" style={{ width: `${Math.max(3, Math.round(job.progress * 100))}%` }} />
          </div>
        )}
        {job.state === "failed" && job.error && <div className="mt-1 truncate text-xs text-danger">{job.error}</div>}
      </div>
      <div className="shrink-0 text-right">
        <Badge tone={tone}>{stalled ? "Stalled" : STATE_LABEL[job.state]}</Badge>
        <div className="num mt-1 text-[11px] text-muted">{running ? `${Math.round(job.progress * 100)}% ${fmtEta(job.etaSec)}` : ""}</div>
      </div>
    </Link>
  );
}

function VideoCard({ job, now }: { job: Job; now: number }) {
  const s = job.summary;
  return (
    <Link href={`/v/${job.id}`} className="group card overflow-hidden transition hover:shadow-[var(--shadow-pop)]" data-testid="video-card">
      <div className="relative aspect-video bg-subtle">
        {/* eslint-disable-next-line @next/next/no-img-element -- Blob posters, already sized */}
        {job.output?.posterUrl && <img src={job.output.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />}
        <div className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white backdrop-blur"><IconPlay size={20} /></span>
        </div>
        <span className="num absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white">{fmtDuration(job.upload?.trimSec ?? job.source.durationSec)}</span>
      </div>
      <div className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="truncate text-sm font-medium">{s ? `${s.nearLabel} vs ${s.farLabel}` : job.source.name}</div>
          {s && <div className="num shrink-0 text-sm font-semibold">{s.scoreNear}–{s.scoreFar}</div>}
        </div>
        <div className="num mt-1 flex gap-3 text-xs text-muted">
          {s && <span>{s.rallies} rallies</span>}
          {s?.topSpeedKmh ? <span>top {s.topSpeedKmh} km/h</span> : null}
          <span className="ml-auto">{fmtAgo(job.createdAt, now)}</span>
        </div>
      </div>
    </Link>
  );
}
