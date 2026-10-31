"use client";

import Link from "next/link";
import type { Job } from "@/lib/jobs/types";
import { ACTIVE_STATES, isStalled } from "@/lib/jobs/types";
import { editKeyFor } from "@/lib/jobs/client";
import { ENGINE_LABEL, estimateCost, fmtUsd } from "@/lib/jobs/cost";
import { fmtAgo, fmtBytes, fmtDuration, fmtEta } from "@/lib/format";
import { Badge } from "@/components/ui";

export const STATE_LABEL: Record<Job["state"], string> = {
  queued: "Queued", needs_court: "Needs court", preparing: "Compressing", uploading: "Uploading", starting: "Starting",
  analyzing: "Analyzing", rendering: "Rendering", publishing: "Publishing", done: "Ready", failed: "Failed", cancelled: "Cancelled",
  rejected: "Removed",
};

export function stateTone(job: Job, now: number): "ok" | "danger" | "warn" | "live" | "neutral" {
  if (job.state === "done") return "ok";
  if (job.state === "failed") return "danger";
  if (job.state === "rejected" || isStalled(job, now)) return "warn";
  return ACTIVE_STATES.includes(job.state) ? "live" : "neutral";
}

const COLS = "md:grid-cols-[88px_minmax(0,2fr)_1.3fr_1fr_1fr_0.8fr_0.7fr]";

/** Uploads table: thumbnail, title, live state, engine, size/length, cost, age. */
export default function JobTable({ jobs, now, empty }: { jobs: Job[]; now: number; empty?: React.ReactNode }) {
  if (!jobs.length) return <div className="card px-6 py-10 text-center text-sm text-muted">{empty ?? "No uploads yet."}</div>;
  return (
    <div className="card overflow-hidden">
      <div className={`hidden gap-4 border-b border-line px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted md:grid ${COLS}`}>
        <span /><span>Video</span><span>Status</span><span>Engine</span><span>Clip</span><span>Cost</span><span className="text-right">Added</span>
      </div>
      <div className="divide-y divide-line">{jobs.map((j) => <Row key={j.id} job={j} now={now} />)}</div>
    </div>
  );
}

function Row({ job, now }: { job: Job; now: number }) {
  const stalled = isStalled(job, now);
  const active = ACTIVE_STATES.includes(job.state) && !stalled;
  const pct = Math.round(job.progress * 100);
  const mine = typeof window !== "undefined" && !!editKeyFor(job.id);
  const cost = estimateCost(job);
  const engine = job.engine ?? (job.upload ? "cloud" : "device");
  const len = job.upload?.trimSec ?? job.source.durationSec;
  return (
    <Link href={`/v/${job.id}`} className={`grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 text-sm transition hover:bg-subtle/60 md:items-center md:gap-4 ${COLS}`} data-testid="job-row">
      <div className="row-span-3 aspect-video w-[72px] overflow-hidden rounded-lg bg-subtle md:row-span-1 md:w-[88px]">
        {/* eslint-disable-next-line @next/next/no-img-element -- Blob poster */}
        {job.output?.posterUrl && <img src={job.output.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{job.summary ? `${job.summary.nearLabel} vs ${job.summary.farLabel}` : job.source.name}</span>
          {job.summary && <span className="num shrink-0 text-xs font-semibold">{job.summary.scoreNear}–{job.summary.scoreFar}</span>}
          {mine && <Badge>yours</Badge>}
        </div>
        <div className="num truncate text-xs text-muted">{job.source.name} · {job.source.device}</div>
      </div>
      <div className="min-w-0">
        <Badge tone={stateTone(job, now)}>{stalled ? "Stalled" : STATE_LABEL[job.state]}</Badge>
        {active && (
          <div className="mt-1.5 max-w-[180px]">
            <div className="h-1 overflow-hidden rounded-full bg-subtle"><div className="h-full rounded-full bg-near transition-[width] duration-700" style={{ width: `${Math.max(3, pct)}%` }} /></div>
            <div className="num mt-1 truncate text-[11px] text-muted">{pct}% {fmtEta(job.etaSec)}</div>
          </div>
        )}
        {(job.state === "failed" || job.state === "rejected" || stalled) && job.error && <div className="mt-1 line-clamp-1 text-[11px] text-muted" title={job.error}>{job.error}</div>}
      </div>
      <div className="text-xs text-ink-2"><span className="text-muted md:hidden">Engine </span>{ENGINE_LABEL[engine]}<div className="hidden text-muted md:block">{engine === "device" ? "browser" : engine === "modal" ? "T4 GPU + Sandbox" : "Sandbox 4 vCPU"}</div></div>
      <div className="num text-xs text-ink-2"><span className="text-muted md:hidden">Clip </span>{fmtDuration(len)} · {fmtBytes(job.upload?.bytes ?? job.source.sizeBytes)}<div className="hidden text-muted md:block">{job.output ? `out ${fmtBytes(job.output.videoBytes)}` : job.upload?.compressed ? "compressed" : ""}</div></div>
      <div className="num text-xs text-ink-2" title={cost.lines.join("\n")}><span className="text-muted md:hidden">Cost </span>{job.state === "done" || job.state === "rejected" || job.state === "failed" ? fmtUsd(cost.usd) : "…"}</div>
      <div className="num text-xs text-muted md:text-right">{fmtAgo(job.createdAt, now)}</div>
    </Link>
  );
}
