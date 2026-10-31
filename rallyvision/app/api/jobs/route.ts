import { NextResponse } from "next/server";
import { bumpDaily, createJob, listJobs } from "@/lib/jobs/store";
import { LIMITS, type JobSource } from "@/lib/jobs/types";

export async function GET() {
  const jobs = await listJobs(120);
  return NextResponse.json({ jobs, now: Date.now() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  let src: JobSource;
  try { src = (await req.json()) as JobSource; } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!src || typeof src.name !== "string" || !(src.sizeBytes > 0) || !(src.durationSec > 0) || !(src.width > 0) || !(src.height > 0)) {
    return NextResponse.json({ error: "Expected video metadata" }, { status: 400 });
  }
  if (src.sizeBytes > LIMITS.maxUploadBytes) return NextResponse.json({ error: "File too large" }, { status: 413 });
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if ((await bumpDaily(`ip:${ip}`)) > LIMITS.maxJobsPerIpPerDay || (await bumpDaily("all")) > LIMITS.maxJobsPerDay) {
    return NextResponse.json({ error: "Daily upload limit reached. Try again tomorrow." }, { status: 429 });
  }
  const clean: JobSource = {
    name: src.name.slice(0, 120), sizeBytes: Math.round(src.sizeBytes), durationSec: src.durationSec,
    width: Math.round(src.width), height: Math.round(src.height), fps: src.fps || 30, device: String(src.device ?? "").slice(0, 80),
  };
  return NextResponse.json(await createJob(clean));
}
