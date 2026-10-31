/** Job persistence shared by API routes and the sandbox worker (no Next.js imports). */
import { Redis } from "@upstash/redis";
import { randomBytes, createHash } from "node:crypto";
import type { Job, JobPatch, JobSource } from "@/lib/jobs/types";

export type Stored = { job: Job; keyHash: string; workerHash?: string; startBody?: unknown };

export function redisEnv(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}
const env = redisEnv();
const redis = env ? new Redis(env) : null;

// Local development without Redis credentials: keep jobs in this process only.
const memory = new Map<string, Stored>();
const memCounters = new Map<string, number>();
if (!redis) console.warn("[rallyvision] No Upstash Redis env vars; jobs are kept in memory (dev only).");

export const storeBackend = redis ? "redis" : "memory";

export const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export async function read(id: string): Promise<Stored | null> {
  if (!redis) return memory.get(id) ?? null;
  return (await redis.get<Stored>(`job:${id}`)) ?? null;
}

export async function write(s: Stored): Promise<void> {
  if (!redis) { memory.set(s.job.id, s); return; }
  await redis.set(`job:${s.job.id}`, s);
}

export async function createJob(source: JobSource): Promise<{ job: Job; editKey: string }> {
  const id = randomBytes(6).toString("base64url");
  const editKey = randomBytes(18).toString("base64url");
  const now = Date.now();
  const job: Job = { id, createdAt: now, updatedAt: now, heartbeatAt: now, state: "queued", progress: 0, source };
  await write({ job, keyHash: hash(editKey) });
  if (redis) await redis.zadd("jobs", { score: now, member: id });
  return { job, editKey };
}

export async function getJob(id: string): Promise<Job | null> {
  return (await read(id))?.job ?? null;
}

export async function checkKey(id: string, editKey: string | null): Promise<Stored | null> {
  if (!editKey) return null;
  const s = await read(id);
  return s && s.keyHash === hash(editKey) ? s : null;
}

export async function patchJob(s: Stored, patch: JobPatch): Promise<Job> {
  const now = Date.now();
  const job: Job = { ...s.job, ...patch, updatedAt: now, heartbeatAt: now };
  if (patch.progress !== undefined) job.progress = Math.min(1, Math.max(0, patch.progress));
  await write({ ...s, job });
  return job;
}

export async function setInsights(id: string, insights: Job["insights"]): Promise<void> {
  const s = await read(id);
  if (!s) return;
  await write({ ...s, job: { ...s.job, insights, updatedAt: Date.now() } });
}

export async function listJobs(limit = 100): Promise<Job[]> {
  if (!redis) return [...memory.values()].map((s) => s.job).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  const ids = await redis.zrange<string[]>("jobs", 0, limit - 1, { rev: true });
  if (!ids.length) return [];
  const rows = await redis.mget<(Stored | null)[]>(...ids.map((id) => `job:${id}`));
  return rows.filter((r): r is Stored => !!r).map((r) => r.job);
}

export async function deleteJob(id: string): Promise<void> {
  if (!redis) { memory.delete(id); return; }
  await redis.del(`job:${id}`);
  await redis.zrem("jobs", id);
}

/** Fixed-window daily counter; returns the new count. */
export async function bumpDaily(key: string): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const k = `rl:${day}:${key}`;
  if (!redis) { const n = (memCounters.get(k) ?? 0) + 1; memCounters.set(k, n); return n; }
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, 60 * 60 * 26);
  return n;
}
