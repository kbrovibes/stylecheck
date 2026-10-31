import "server-only";
import { randomBytes } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { bumpDaily, hash, patchJob, write, type Stored } from "@/lib/jobs/core";
import type { Job, WorkerSpec } from "@/lib/jobs/types";
import { redisEnv } from "@/lib/jobs/core";

export type StartBody = Omit<WorkerSpec, "jobId" | "callbackUrl" | "workerToken" | "version"> & { uploadBytes: number; compressed: boolean; engine?: "cloud" | "modal" };

/** Caps paid GPU usage: after this many Modal jobs per day, jobs fall back to the free CPU engine. */
const MODAL_JOBS_PER_DAY = Number(process.env.MODAL_JOBS_PER_DAY ?? 40);

export function cloudConfigured(): boolean {
  return !!process.env.SANDBOX_SNAPSHOT_ID && !!redisEnv() && !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Boots a Sandbox VM from the prepared snapshot and runs the worker detached; the phone can close after this. */
export async function startJob(s: Stored, b: StartBody, origin: string): Promise<Job> {
  const id = s.job.id;
  const redis = redisEnv()!;
  const workerToken = randomBytes(18).toString("base64url");
  const version = (s.job.output?.version ?? 0) + 1;
  const spec: WorkerSpec = {
    jobId: id, sourceUrl: b.sourceUrl, trimSec: b.trimSec, width: b.width, height: b.height,
    corners: b.corners, cornerSource: b.cornerSource, settings: b.settings, overlay: b.overlay,
    exportShortSide: Math.min(1080, Math.max(480, b.exportShortSide || 1080)), version,
    callbackUrl: `${origin}/api/jobs/${id}/finished`, workerToken,
  };
  const workerRes = await fetch(`${origin}/worker/worker.mjs`, { cache: "no-store" });
  if (!workerRes.ok) throw new Error("worker bundle missing");
  const workerJs = Buffer.from(await workerRes.arrayBuffer());

  const seconds = Math.min(s.job.source.durationSec, b.trimSec ?? Infinity);
  const timeout = Math.min(45 * 60_000, Math.max(10 * 60_000, (300 + seconds * 3) * 1000));
  const name = `rv-${id}-v${version}-${Date.now().toString(36)}`;
  const sandbox = await Sandbox.create({ name, source: { type: "snapshot", snapshotId: process.env.SANDBOX_SNAPSHOT_ID! }, resources: { vcpus: 4 }, timeout, persistent: false });
  await sandbox.writeFiles([
    { path: "/vercel/sandbox/rt/worker.mjs", content: workerJs },
    { path: "/vercel/sandbox/rt/spec.json", content: Buffer.from(JSON.stringify(spec)) },
  ]);
  const env: Record<string, string> = {
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN!,
    UPSTASH_REDIS_REST_URL: redis.url,
    UPSTASH_REDIS_REST_TOKEN: redis.token,
  };
  if (process.env.GEMINI_API_KEY) env.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (process.env.GEMINI_MODEL) env.GEMINI_MODEL = process.env.GEMINI_MODEL;
  const useModal = b.engine === "modal" && !!process.env.MODAL_DETECT_URL && !!process.env.RALLYVISION_SECRET && (await bumpDaily("modal")) <= MODAL_JOBS_PER_DAY;
  if (useModal) {
    env.MODAL_DETECT_URL = process.env.MODAL_DETECT_URL!;
    env.RALLYVISION_SECRET = process.env.RALLYVISION_SECRET!;
    env.DETECT_ENGINE = "modal";
  }
  await sandbox.runCommand({ cmd: "node", args: ["/vercel/sandbox/rt/worker.mjs", "/vercel/sandbox/rt/spec.json"], cwd: "/vercel/sandbox/rt", env, detached: true });

  const fresh: Stored = { ...s, workerHash: hash(workerToken), startBody: b };
  await write(fresh);
  return patchJob(fresh, {
    state: "starting", phase: useModal ? "Starting GPU worker" : "Starting cloud worker", progress: 0, etaSec: null, error: undefined, sandboxId: name,
    engine: useModal ? "modal" : "cloud", upload: { url: b.sourceUrl, bytes: b.uploadBytes, compressed: b.compressed, trimSec: b.trimSec },
  });
}
