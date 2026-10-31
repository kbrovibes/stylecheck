import type { Job } from "@/lib/jobs/types";

/**
 * Rough compute cost of a job from its recorded timings. List prices (2026-10), estimates only:
 *  - Vercel Sandbox: active CPU $0.128 per vCPU-hour (4 vCPU, ~80 % busy while working) + memory $0.0106 per GB-hour (8 GB)
 *  - Modal T4 container (GPU + 4 cores + 12 GB): ≈ $0.000243 per second
 *  - Gemini Flash "is this badminton?" check: ≈ $0.0003
 *  - On-device processing: $0
 */
export function estimateCost(job: Job): { usd: number; lines: string[] } {
  const engine = job.engine ?? (job.upload ? "cloud" : "device");
  if (engine === "device") return { usd: 0, lines: ["On-device: $0"] };
  const t = job.timings ?? {};
  const wallSec = (t.workerMs ?? (t.analysisMs ?? 0) + (t.renderMs ?? 0) + (t.publishMs ?? 0) + 3000) / 1000;
  const gpuSec = engine === "modal" ? (t.gpuMs ?? t.analysisMs ?? 0) / 1000 : 0;
  const busySec = Math.max(0, wallSec - gpuSec); // the VM idles while it waits for the GPU
  const sandbox = (busySec / 3600) * 4 * 0.128 * 0.8 + (wallSec / 3600) * 8 * 0.0106;
  const modal = gpuSec * 0.000243;
  const gemini = job.screen?.by === "gemini" ? 0.0003 : 0;
  const lines = [`Vercel Sandbox ${wallSec.toFixed(0)}s ≈ $${sandbox.toFixed(4)}`];
  if (modal) lines.push(`Modal GPU ${gpuSec.toFixed(0)}s ≈ $${modal.toFixed(4)}`);
  if (gemini) lines.push(`Gemini check ≈ $${gemini.toFixed(4)}`);
  return { usd: sandbox + modal + gemini, lines };
}

export function fmtUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.001) return "<$0.001";
  return `~$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;
}

export const ENGINE_LABEL: Record<NonNullable<Job["engine"]>, string> = { cloud: "Cloud CPU", modal: "Modal GPU", device: "On device" };
