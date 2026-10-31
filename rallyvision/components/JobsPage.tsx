"use client";

import Link from "next/link";
import { useState } from "react";
import type { Job } from "@/lib/jobs/types";
import { ACTIVE_STATES, isStalled } from "@/lib/jobs/types";
import { useJobs } from "@/lib/jobs/client";
import { estimateCost, fmtUsd } from "@/lib/jobs/cost";
import { fmtAgo, fmtDuration } from "@/lib/format";
import AppHeader from "@/components/AppHeader";
import JobTable from "@/components/JobTable";
import { Segmented } from "@/components/ui";
import { Spinner } from "@/components/NewVideo";
import { IconPlay } from "@/components/Icons";

type Filter = "all" | "running" | "done" | "issues";

/** All uploads from every device: table (live state, engine, cost) or video grid. */
export default function JobsPage() {
  const { jobs, now, error } = useJobs(3000);
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"table" | "grid">("table");
  const all = jobs ?? [];
  const running = all.filter((j) => ACTIVE_STATES.includes(j.state) && !isStalled(j, now));
  const done = all.filter((j) => j.state === "done");
  const issues = all.filter((j) => ["failed", "cancelled", "rejected"].includes(j.state) || isStalled(j, now));
  const shown = filter === "running" ? running : filter === "done" ? done : filter === "issues" ? issues : all;
  const spend = all.reduce((s, j) => s + estimateCost(j).usd, 0);

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:pt-8">
        <Link href="/" className="text-xs text-muted hover:text-ink">← Home</Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold">All uploads</h1>
            <p className="num mt-1 text-xs text-muted">{all.length} uploads · {done.length} ready · compute so far {fmtUsd(spend)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Segmented size="sm" value={filter} onChange={setFilter} options={[
              { value: "all", label: `All ${all.length}` }, { value: "running", label: `Running ${running.length}` },
              { value: "done", label: `Ready ${done.length}` }, { value: "issues", label: `Issues ${issues.length}` },
            ]} />
            <Segmented size="sm" value={view} onChange={setView} options={[{ value: "table", label: "Table" }, { value: "grid", label: "Grid" }]} />
          </div>
        </div>
        {error && <div className="mt-6 rounded-2xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</div>}
        {!jobs && !error && <div className="mt-10 flex items-center gap-3 text-sm text-muted"><Spinner /> Loading…</div>}
        {jobs && (
          <div className="mt-5">
            {view === "table" ? <JobTable jobs={shown} now={now} empty="Nothing here." /> : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shown.filter((j) => j.state === "done").map((j) => <Card key={j.id} job={j} now={now} />)}
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}

function Card({ job, now }: { job: Job; now: number }) {
  const s = job.summary;
  return (
    <Link href={`/v/${job.id}`} className="group card overflow-hidden transition hover:shadow-[var(--shadow-pop)]" data-testid="video-card">
      <div className="relative aspect-video bg-subtle">
        {/* eslint-disable-next-line @next/next/no-img-element -- Blob poster */}
        {job.output?.posterUrl && <img src={job.output.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />}
        <div className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100"><span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white backdrop-blur"><IconPlay size={20} /></span></div>
        <span className="num absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white">{fmtDuration(job.upload?.trimSec ?? job.source.durationSec)}</span>
      </div>
      <div className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="truncate text-sm font-medium">{s ? `${s.nearLabel} vs ${s.farLabel}` : job.source.name}</div>
          {s && <div className="num shrink-0 text-sm font-semibold">{s.scoreNear}–{s.scoreFar}</div>}
        </div>
        <div className="num mt-1 flex gap-3 text-xs text-muted">{s && <span>{s.rallies} rallies</span>}{s?.topSpeedKmh ? <span>top {s.topSpeedKmh} km/h</span> : null}<span className="ml-auto">{fmtAgo(job.createdAt, now)}</span></div>
      </div>
    </Link>
  );
}
