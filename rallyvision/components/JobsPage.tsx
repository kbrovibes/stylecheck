"use client";

import Link from "next/link";
import { useState } from "react";
import type { Job } from "@/lib/jobs/types";
import { ACTIVE_STATES, isStalled } from "@/lib/jobs/types";
import { editKeyFor, useJobs } from "@/lib/jobs/client";
import { fmtAgo, fmtBytes, fmtDuration, fmtEta } from "@/lib/format";
import AppHeader from "@/components/AppHeader";
import { Badge, Segmented } from "@/components/ui";
import { Spinner } from "@/components/NewVideo";

type Filter = "all" | "running" | "done" | "failed";

const LABEL: Record<Job["state"], string> = {
  queued: "Queued", needs_court: "Needs court", preparing: "Compressing on phone", uploading: "Uploading", starting: "Starting worker",
  analyzing: "Analyzing", rendering: "Rendering", publishing: "Publishing", done: "Done", failed: "Failed", cancelled: "Cancelled",
};

/** Every job from every device, newest first, with exact state and sizes. */
export default function JobsPage() {
  const { jobs, now, error } = useJobs(3000);
  const [filter, setFilter] = useState<Filter>("all");
  const all = jobs ?? [];
  const running = all.filter((j) => ACTIVE_STATES.includes(j.state) && !isStalled(j, now));
  const failed = all.filter((j) => j.state === "failed" || j.state === "cancelled" || isStalled(j, now));
  const done = all.filter((j) => j.state === "done");
  const shown = filter === "running" ? running : filter === "done" ? done : filter === "failed" ? failed : all;

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-semibold">Jobs</h1>
            <p className="mt-1 text-sm text-muted">Every upload from every device. Updates live; processing continues after you close the app.</p>
          </div>
          <Segmented size="sm" value={filter} onChange={setFilter} options={[
            { value: "all", label: `All ${all.length}` },
            { value: "running", label: `Running ${running.length}` },
            { value: "done", label: `Done ${done.length}` },
            { value: "failed", label: `Failed ${failed.length}` },
          ]} />
        </div>
        {error && <div className="mt-6 rounded-2xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</div>}
        {!jobs && !error && <div className="mt-10 flex items-center gap-3 text-sm text-muted"><Spinner /> Loading…</div>}
        {jobs && shown.length === 0 && <div className="card mt-6 px-6 py-12 text-center text-sm text-muted">Nothing here yet.</div>}
        {shown.length > 0 && (
          <div className="card mt-6 overflow-hidden">
            <div className="hidden grid-cols-[minmax(0,2.2fr)_1.2fr_1fr_1fr_1fr_0.9fr] gap-4 border-b border-line px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted md:grid">
              <span>Video</span><span>State</span><span>Original</span><span>Uploaded</span><span>Output</span><span className="text-right">Created</span>
            </div>
            <div className="divide-y divide-line">
              {shown.map((j) => <Row key={j.id} job={j} now={now} />)}
            </div>
          </div>
        )}
      </main>
    </>
  );
}

function Row({ job, now }: { job: Job; now: number }) {
  const stalled = isStalled(job, now);
  const active = ACTIVE_STATES.includes(job.state) && !stalled;
  const pct = Math.round(job.progress * 100);
  const mine = !!editKeyFor(job.id);
  const t = job.timings ?? {};
  const total = (t.prepareMs ?? 0) + (t.uploadMs ?? 0) + (t.analysisMs ?? 0) + (t.renderMs ?? 0) + (t.publishMs ?? 0);
  return (
    <Link href={`/v/${job.id}`} className="grid gap-x-4 gap-y-1 px-4 py-3.5 text-sm transition hover:bg-subtle/60 md:grid-cols-[minmax(0,2.2fr)_1.2fr_1fr_1fr_1fr_0.9fr] md:items-center" data-testid="jobs-row">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><span className="truncate font-medium">{job.summary ? `${job.summary.nearLabel} vs ${job.summary.farLabel}` : job.source.name}</span>{mine && <Badge>yours</Badge>}</div>
        <div className="num truncate text-xs text-muted">{job.source.name} · {job.source.device} · {job.id}</div>
      </div>
      <div>
        <Badge tone={job.state === "done" ? "ok" : job.state === "failed" ? "danger" : stalled ? "warn" : active ? "live" : "neutral"}>{stalled ? "Stalled" : LABEL[job.state]}</Badge>
        {active && (
          <div className="mt-1.5">
            <div className="h-1 overflow-hidden rounded-full bg-subtle"><div className="h-full rounded-full bg-near transition-[width] duration-700" style={{ width: `${Math.max(3, pct)}%` }} /></div>
            <div className="num mt-1 text-[11px] text-muted">{pct}% {fmtEta(job.etaSec)}{job.phase ? ` · ${job.phase}` : ""}</div>
          </div>
        )}
        {job.state === "done" && total > 0 && <div className="num mt-1 text-[11px] text-muted">took {fmtDuration(total / 1000)}</div>}
        {(job.state === "failed" || stalled) && job.error && <div className="mt-1 line-clamp-2 text-[11px] text-danger">{job.error}</div>}
      </div>
      <div className="num text-xs text-ink-2"><span className="text-muted md:hidden">Original </span>{fmtBytes(job.source.sizeBytes)} · {fmtDuration(job.source.durationSec)}<div className="text-muted">{job.source.width}×{job.source.height} · {job.source.fps}fps</div></div>
      <div className="num text-xs text-ink-2"><span className="text-muted md:hidden">Uploaded </span>{job.upload ? <>{fmtBytes(job.upload.bytes)}<div className="text-muted">{job.upload.compressed ? "compressed" : "original"}{job.upload.trimSec ? ` · ${job.upload.trimSec}s` : ""}</div></> : "—"}</div>
      <div className="num text-xs text-ink-2"><span className="text-muted md:hidden">Output </span>{job.output ? <>{fmtBytes(job.output.videoBytes)}<div className="text-muted">{job.output.width}×{job.output.height}</div></> : "—"}</div>
      <div className="num text-xs text-muted md:text-right">{fmtAgo(job.createdAt, now)}</div>
    </Link>
  );
}
