import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { checkKey, deleteJob, getJob, patchJob } from "@/lib/jobs/store";
import type { JobPatch, JobState } from "@/lib/jobs/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const job = await getJob((await params).id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(job, { headers: { "cache-control": "no-store" } });
}

/** The phone reports its own phases (preparing/uploading) and failures; the worker writes server phases directly. */
const CLIENT_STATES: JobState[] = ["queued", "needs_court", "preparing", "uploading", "failed", "cancelled"];

export async function PATCH(req: Request, { params }: Ctx) {
  const id = (await params).id;
  const s = await checkKey(id, req.headers.get("x-edit-key"));
  if (!s) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json()) as JobPatch;
  const patch: JobPatch = {};
  if (body.state) { if (!CLIENT_STATES.includes(body.state)) return NextResponse.json({ error: "Bad state" }, { status: 400 }); patch.state = body.state; }
  if (typeof body.phase === "string") patch.phase = body.phase.slice(0, 80);
  if (typeof body.progress === "number") patch.progress = body.progress;
  if (body.etaSec === null || typeof body.etaSec === "number") patch.etaSec = body.etaSec;
  if (typeof body.error === "string") patch.error = body.error.slice(0, 500);
  if (body.timings) patch.timings = { ...s.job.timings, prepareMs: body.timings.prepareMs, uploadMs: body.timings.uploadMs };
  return NextResponse.json(await patchJob(s, patch));
}

export async function DELETE(req: Request, { params }: Ctx) {
  const id = (await params).id;
  const s = await checkKey(id, req.headers.get("x-edit-key"));
  if (!s) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const urls = [s.job.upload?.url, s.job.output?.videoUrl, s.job.output?.posterUrl, s.job.output?.cardUrl, s.job.output?.analysisUrl].filter((u): u is string => !!u);
  if (urls.length && process.env.BLOB_READ_WRITE_TOKEN) await del(urls).catch(() => {});
  await deleteJob(id);
  return NextResponse.json({ ok: true });
}
