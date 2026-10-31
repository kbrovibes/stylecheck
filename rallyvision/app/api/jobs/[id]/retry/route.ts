import { NextResponse } from "next/server";
import { checkKey } from "@/lib/jobs/store";
import { cloudConfigured, startJob, type StartBody } from "@/lib/jobs/start";

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** Re-runs a failed or stalled job with the same upload and settings (uploader only). */
export async function POST(req: Request, { params }: Ctx) {
  const id = (await params).id;
  const s = await checkKey(id, req.headers.get("x-edit-key"));
  if (!s) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!s.startBody) return NextResponse.json({ error: "Nothing to retry: the upload never finished." }, { status: 409 });
  if (!cloudConfigured()) return NextResponse.json({ error: "Cloud processing is not configured." }, { status: 503 });
  if (s.job.state === "done") return NextResponse.json({ error: "Already done" }, { status: 409 });
  return NextResponse.json(await startJob(s, s.startBody as StartBody, new URL(req.url).origin));
}
