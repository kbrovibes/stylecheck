import { NextResponse } from "next/server";
import { checkKey } from "@/lib/jobs/store";
import { cloudConfigured, startJob, type StartBody } from "@/lib/jobs/start";

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const id = (await params).id;
  const s = await checkKey(id, req.headers.get("x-edit-key"));
  if (!s) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!cloudConfigured()) return NextResponse.json({ error: "Cloud processing is not configured on this deployment." }, { status: 503 });
  const b = (await req.json()) as StartBody;
  const blobHost = (u: string) => { try { return new URL(u).hostname.endsWith(".blob.vercel-storage.com"); } catch { return false; } };
  if (!blobHost(b.sourceUrl)) return NextResponse.json({ error: "Source must be an uploaded file" }, { status: 400 });
  return NextResponse.json(await startJob(s, b, new URL(req.url).origin));
}
