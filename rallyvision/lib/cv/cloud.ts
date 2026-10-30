/**
 * Client for the optional cloud GPU worker (worker/modal_app.py).
 * Only active when NEXT_PUBLIC_ML_WORKER_URL is set. Not exercised by tests.
 */

import type { PlayerSample, ShuttleSample } from "@/lib/types";

export function cloudWorkerUrl(): string | null {
  const u = process.env.NEXT_PUBLIC_ML_WORKER_URL;
  return u && u.length > 0 ? u.replace(/\/$/, "") : null;
}

export type CloudResult = { fps: number; width: number; height: number; frames: number; shuttle: ShuttleSample[]; players: PlayerSample[] };

export async function analyzeInCloud(file: Blob, fps: number, onStatus: (s: string) => void, signal?: AbortSignal): Promise<CloudResult> {
  const base = cloudWorkerUrl();
  if (!base) throw new Error("Cloud worker not configured");
  const fd = new FormData();
  fd.append("file", file, "video.mp4");
  const start = await fetch(`${base}/analyze?fps=${fps}`, { method: "POST", body: fd, signal });
  if (!start.ok) throw new Error(`worker upload failed (${start.status})`);
  const { job } = (await start.json()) as { job: string };
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    if (signal?.aborted) throw new Error("cancelled");
    const res = await fetch(`${base}/status/${job}`, { signal });
    const s = (await res.json()) as { state: string; result?: CloudResult; error?: string };
    onStatus(s.state);
    if (s.state === "done" && s.result) return s.result;
    if (s.state === "error") throw new Error(s.error ?? "worker error");
  }
}
