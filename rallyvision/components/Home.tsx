"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useJobs } from "@/lib/jobs/client";
import AppHeader from "@/components/AppHeader";
import NewVideo from "@/components/NewVideo";
import JobTable from "@/components/JobTable";
import { IconUpload } from "@/components/Icons";
import { Spinner } from "@/components/NewVideo";

const RECENT = 6;

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { jobs, now, error } = useJobs();
  const visible = (jobs ?? []).filter((j) => j.state !== "rejected");

  const pickSample = async () => {
    const res = await fetch("/sample/synthetic-rally.mp4");
    setFile(new File([await res.blob()], "synthetic-rally.mp4", { type: "video/mp4" }));
  };
  const upload = () => inputRef.current?.click();

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:pt-8">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-semibold">Uploads</h1>
          <div className="flex items-center gap-2">
            <button className="btn-ghost h-9 px-3 text-xs" onClick={pickSample} data-testid="sample">Try a sample</button>
            <button className="btn-primary" onClick={upload} data-testid="choose-video"><IconUpload size={16} /> Upload video</button>
          </div>
        </div>
        <input ref={inputRef} data-testid="file-input" type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }} />

        {error && <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">Couldn&apos;t load uploads: {error}</div>}
        {!jobs && !error && <div className="mt-10 flex items-center gap-3 text-sm text-muted"><Spinner /> Loading…</div>}

        {jobs && visible.length === 0 && (
          <button onClick={upload} className="card mt-5 grid w-full place-items-center px-6 py-14 text-center transition hover:bg-subtle/50">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-ink text-bg"><IconUpload size={20} /></span>
            <span className="mt-4 text-base font-medium">Upload your first game</span>
            <span className="mt-1 max-w-sm text-sm text-muted">Film from behind the baseline with the whole court in view. You get a shareable video with shuttle trail, shot speeds and score.</span>
          </button>
        )}

        {visible.length > 0 && (
          <div className="mt-5">
            <JobTable jobs={visible.slice(0, RECENT)} now={now} />
            <div className="mt-3 flex items-center justify-between text-xs text-muted">
              <span>Everyone using this app can see these.</span>
              <Link href="/jobs" className="font-medium text-ink hover:underline" data-testid="view-all">{visible.length > RECENT ? `View all ${visible.length} uploads →` : "View all →"}</Link>
            </div>
          </div>
        )}

      </main>
      <button onClick={upload} aria-label="Upload video" className="btn-primary fixed bottom-[max(20px,env(safe-area-inset-bottom))] right-5 h-14 w-14 rounded-full p-0 shadow-[var(--shadow-pop)] sm:hidden"><IconUpload size={22} /></button>
      {file && <NewVideo file={file} onClose={() => setFile(null)} />}
    </>
  );
}
