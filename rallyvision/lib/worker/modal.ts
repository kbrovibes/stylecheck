/**
 * Client for the Modal GPU detector (worker/modal_app.py). Bundled for Node by esbuild:
 * plain fetch, no Next imports. Coordinates come back in ORIGINAL display px.
 */

import type { Pt, ShuttleSample } from "@/lib/types";

export type ModalPoseFrame = { f: number; people: Array<{ landmarks: Pt[]; conf: number }> };

export type ModalDetectResult = {
  shuttle: ShuttleSample[];
  poses: ModalPoseFrame[];
  fps: number;
  frames: number;
};

type WirePerson = { landmarks: Array<[number, number] | null>; conf: number };
type WireResult = {
  shuttle: ShuttleSample[];
  poses: Array<{ f: number; people: WirePerson[] }>;
  fps: number;
  frames: number;
};
type WireStatus = { status: "running" | "done" | "error"; progress?: number; error?: string; result?: WireResult };

const POLL_MS = 3000;
const MAX_WAIT_MS = 40 * 60 * 1000;

function config(): { base: string; secret: string } {
  const base = process.env.MODAL_DETECT_URL?.replace(/\/+$/, "");
  const secret = process.env.RALLYVISION_SECRET;
  if (!base) throw new Error("MODAL_DETECT_URL is not set");
  if (!secret) throw new Error("RALLYVISION_SECRET is not set");
  return { base, secret };
}

async function call<T>(url: string, secret: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", "x-rallyvision-secret": secret, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Modal detector ${init?.method ?? "GET"} ${new URL(url).pathname} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/** Fill null landmarks (COCO joints the mapping lacks) with the nearest non-null one so box maths never sees null. */
function toPts(lm: Array<[number, number] | null>): Pt[] {
  const firstValid = lm.find((p): p is [number, number] => p !== null) ?? [0, 0];
  let prev: [number, number] = firstValid;
  return lm.map((p) => {
    if (p) prev = p;
    return { x: prev[0], y: prev[1] };
  });
}

export async function detectWithModal(
  input: { videoUrl: string; trimSec: number | null; fps: number; width: number; height: number },
  onProgress: (p: number) => Promise<void> | void,
): Promise<ModalDetectResult> {
  const { base, secret } = config();
  const { call_id } = await call<{ call_id: string }>(`${base}/detect`, secret, {
    method: "POST",
    body: JSON.stringify({ video_url: input.videoUrl, trim_sec: input.trimSec, fps: input.fps, width: input.width, height: input.height }),
  });

  const deadline = Date.now() + MAX_WAIT_MS;
  let transientErrors = 0;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`Modal detector timed out after ${MAX_WAIT_MS / 60000} min (call ${call_id})`);
    await new Promise((r) => setTimeout(r, POLL_MS));
    let s: WireStatus;
    try {
      s = await call<WireStatus>(`${base}/result/${encodeURIComponent(call_id)}`, secret);
      transientErrors = 0;
    } catch (e) {
      if (++transientErrors >= 5) throw e;
      continue;
    }
    if (s.status === "error") throw new Error(`Modal detector failed: ${s.error ?? "unknown error"}`);
    if (s.status === "done" && s.result) {
      await onProgress(1);
      const r = s.result;
      return {
        shuttle: r.shuttle,
        poses: r.poses.map((p) => ({ f: p.f, people: p.people.map((q) => ({ landmarks: toPts(q.landmarks), conf: q.conf })) })),
        fps: r.fps,
        frames: r.frames,
      };
    }
    await onProgress(Math.max(0, Math.min(1, s.progress ?? 0)));
  }
}
