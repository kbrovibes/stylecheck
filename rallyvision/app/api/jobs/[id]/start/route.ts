import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { checkKey, hash, patchJob, write } from "@/lib/jobs/store";
import type { WorkerSpec } from "@/lib/jobs/types";
import { redisEnv } from "@/lib/jobs/core";

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };
type StartBody = Omit<WorkerSpec, "jobId" | "callbackUrl" | "workerToken" | "version"> & { uploadBytes: number; compressed: boolean; engine?: "cloud" | "modal" };

/** Boots a Sandbox VM from the prepared snapshot and runs the worker detached; the phone can close after this. */
export async function POST(req: Request, { params }: Ctx) {
  const id = (await params).id;
  const s = await checkKey(id, req.headers.get("x-edit-key"));
  if (!s) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const snapshotId = process.env.SANDBOX_SNAPSHOT_ID;
  const redis = redisEnv();
  if (!snapshotId || !redis || !process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: "Cloud processing is not configured on this deployment." }, { status: 503 });
  const b = (await req.json()) as StartBody;
  const blobHost = (u: string) => { try { return new URL(u).hostname.endsWith(".blob.vercel-storage.com"); } catch { return false; } };
  if (!blobHost(b.sourceUrl)) return NextResponse.json({ error: "Source must be an uploaded file" }, { status: 400 });

  const origin = new URL(req.url).origin;
  const workerToken = randomBytes(18).toString("base64url");
  const version = (s.job.output?.version ?? 0) + 1;
  const spec: WorkerSpec = {
    jobId: id, sourceUrl: b.sourceUrl, trimSec: b.trimSec, width: b.width, height: b.height,
    corners: b.corners, cornerSource: b.cornerSource, settings: b.settings, overlay: b.overlay,
    exportShortSide: Math.min(1080, Math.max(480, b.exportShortSide || 1080)), version,
    callbackUrl: `${origin}/api/jobs/${id}/finished`, workerToken,
  };
  const workerRes = await fetch(`${origin}/worker/worker.mjs`, { cache: "no-store" });
  if (!workerRes.ok) return NextResponse.json({ error: "worker bundle missing" }, { status: 500 });
  const workerJs = Buffer.from(await workerRes.arrayBuffer());

  const seconds = Math.min(s.job.source.durationSec, b.trimSec ?? Infinity);
  const timeout = Math.min(45 * 60_000, Math.max(10 * 60_000, (300 + seconds * 3) * 1000));
  const name = `rv-${id}-v${version}`;
  const sandbox = await Sandbox.create({ name, source: { type: "snapshot", snapshotId }, resources: { vcpus: 4 }, timeout, persistent: false });
  await sandbox.writeFiles([
    { path: "/vercel/sandbox/rt/worker.mjs", content: workerJs },
    { path: "/vercel/sandbox/rt/spec.json", content: Buffer.from(JSON.stringify(spec)) },
  ]);
  const env: Record<string, string> = {
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN!,
    UPSTASH_REDIS_REST_URL: redis.url,
    UPSTASH_REDIS_REST_TOKEN: redis.token,
  };
  if (b.engine === "modal" && process.env.MODAL_DETECT_URL && process.env.RALLYVISION_SECRET) {
    env.MODAL_DETECT_URL = process.env.MODAL_DETECT_URL;
    env.RALLYVISION_SECRET = process.env.RALLYVISION_SECRET;
    env.DETECT_ENGINE = "modal";
  }
  await sandbox.runCommand({ cmd: "node", args: ["/vercel/sandbox/rt/worker.mjs", "/vercel/sandbox/rt/spec.json"], cwd: "/vercel/sandbox/rt", env, detached: true });

  const fresh = { ...s, workerHash: hash(workerToken) };
  await write(fresh);
  const job = await patchJob(fresh, {
    state: "starting", phase: "Starting cloud worker", progress: 0, etaSec: null, error: undefined, sandboxId: name,
    upload: { url: b.sourceUrl, bytes: b.uploadBytes, compressed: b.compressed, trimSec: b.trimSec },
  });
  return NextResponse.json(job);
}
