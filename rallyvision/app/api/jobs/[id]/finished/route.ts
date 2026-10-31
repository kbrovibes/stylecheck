import { NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import { hash, read } from "@/lib/jobs/store";

type Ctx = { params: Promise<{ id: string }> };

/** Called by the worker when it exits, so the VM stops now instead of at its timeout. */
export async function POST(req: Request, { params }: Ctx) {
  const id = (await params).id;
  const s = await read(id);
  const token = req.headers.get("x-worker-token");
  if (!s || !token || s.workerHash !== hash(token) || !s.job.sandboxId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const sb = await Sandbox.get({ name: s.job.sandboxId });
    await sb.stop();
  } catch { /* already stopped */ }
  return NextResponse.json({ ok: true });
}
