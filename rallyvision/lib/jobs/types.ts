import type { Insights } from "@/lib/ai/types";

export type JobState = "queued" | "needs_court" | "preparing" | "uploading" | "starting" | "analyzing" | "rendering" | "publishing" | "done" | "failed" | "cancelled";

export const ACTIVE_STATES: JobState[] = ["queued", "needs_court", "preparing", "uploading", "starting", "analyzing", "rendering", "publishing"];
/** States driven by the server worker (the phone can be closed). */
export const SERVER_STATES: JobState[] = ["starting", "analyzing", "rendering", "publishing"];
export const STALL_MS = 45_000;

export type JobSource = {
  name: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  device: string;
};

export type JobOutput = {
  videoUrl: string;
  videoBytes: number;
  width: number;
  height: number;
  codec: string;
  posterUrl?: string;
  cardUrl?: string;
  analysisUrl?: string;
  version: number;
};

export type JobSummary = {
  nearLabel: string;
  farLabel: string;
  scoreNear: number;
  scoreFar: number;
  rallies: number;
  shots: number;
  topSpeedKmh: number | null;
  smashes: number;
};

export type Job = {
  id: string;
  createdAt: number;
  updatedAt: number;
  heartbeatAt: number;
  state: JobState;
  phase?: string;
  progress: number;
  etaSec?: number | null;
  error?: string;
  source: JobSource;
  output?: JobOutput;
  summary?: JobSummary;
  insights?: Insights;
  timings?: { prepareMs?: number; uploadMs?: number; analysisMs?: number; renderMs?: number; publishMs?: number };
  /** what the phone uploaded (after optional on-device trim/compress) */
  upload?: { url: string; bytes: number; compressed: boolean; trimSec: number | null };
  sandboxId?: string;
};

/** Everything the server worker needs to process a job. */
export type WorkerSpec = {
  jobId: string;
  sourceUrl: string;
  /** seconds of the source to use; null = full video */
  trimSec: number | null;
  /** display size of the source (rotation applied); corners are in this space */
  width: number;
  height: number;
  corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  cornerSource: "manual" | "auto" | "default";
  settings: import("@/lib/types").AnalysisSettings;
  overlay: import("@/lib/render/overlay").OverlayOptions;
  exportShortSide: number;
  version: number;
  callbackUrl: string;
  workerToken: string;
};

/** Fields a client may PATCH (with the job's edit key). */
export type JobPatch = Partial<Pick<Job, "state" | "phase" | "progress" | "etaSec" | "error" | "output" | "summary" | "timings" | "upload" | "sandboxId">>;

export function isStalled(j: Job, now = Date.now()): boolean {
  return ACTIVE_STATES.includes(j.state) && j.state !== "needs_court" && now - j.heartbeatAt > STALL_MS;
}

export const LIMITS = {
  maxUploadBytes: 2000 * 1024 * 1024,
  maxDurationSec: 10 * 60,
  maxJobsPerIpPerDay: 40,
  maxJobsPerDay: 300,
};
