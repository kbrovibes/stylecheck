import { NextResponse } from "next/server";
import { generateInsights, resolveProvider, type InsightOptions } from "@/lib/ai";
import { summarize, type MatchSummary } from "@/lib/ai/types";
import type { Analysis } from "@/lib/types";
import { getJob, setInsights } from "@/lib/jobs/store";

export async function GET() {
  return NextResponse.json({ provider: resolveProvider(), available: { anthropic: !!process.env.ANTHROPIC_API_KEY, gemini: !!process.env.GEMINI_API_KEY } });
}

/** Body: a MatchSummary (on-device mode) or { jobId } (cloud jobs: notes are stored on the job). Optional { provider, model }. */
export async function POST(req: Request) {
  let body: (Partial<MatchSummary> & { jobId?: string; summary?: MatchSummary } & InsightOptions) | null;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body) return NextResponse.json({ error: "Empty body" }, { status: 400 });
  const opts: InsightOptions = { provider: body.provider, model: body.model };
  let summary: MatchSummary;
  if (body.jobId) {
    const job = await getJob(body.jobId);
    if (!job?.output?.analysisUrl) return NextResponse.json({ error: "Job has no analysis yet" }, { status: 404 });
    const a = (await (await fetch(job.output.analysisUrl)).json()) as Analysis;
    a.video.name = job.source.name;
    summary = summarize(a);
  } else {
    summary = (body.summary ?? body) as MatchSummary;
    if (!Array.isArray(summary.rallies) || !summary.stats) return NextResponse.json({ error: "Expected a MatchSummary" }, { status: 400 });
    if (JSON.stringify(summary).length > 200_000) return NextResponse.json({ error: "Summary too large" }, { status: 413 });
  }
  const insights = await generateInsights(summary, opts);
  if (body.jobId) await setInsights(body.jobId, insights);
  return NextResponse.json(insights);
}
