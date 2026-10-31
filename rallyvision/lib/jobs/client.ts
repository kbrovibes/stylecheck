"use client";

import { useEffect, useState } from "react";
import { upload } from "@vercel/blob/client";
import type { Job, JobPatch, JobSource, WorkerSpec } from "@/lib/jobs/types";
import type { AnalysisSettings, Pt } from "@/lib/types";
import type { OverlayOptions } from "@/lib/render/overlay";
import { compressVideo } from "@/lib/video/compress";
import { keepAwake } from "@/lib/device";

const KEYS = "rallyvision.editKeys.v1";

function keys(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEYS) ?? "{}") as Record<string, string>; } catch { return {}; }
}
export function editKeyFor(id: string): string | null { return keys()[id] ?? null; }
function saveKey(id: string, key: string) {
  try { localStorage.setItem(KEYS, JSON.stringify({ ...keys(), [id]: key })); } catch { /* ignore */ }
}

async function api<T>(path: string, init?: RequestInit & { key?: string | null }): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init?.key) headers["x-edit-key"] = init.key;
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export const listJobs = () => api<{ jobs: Job[]; now: number }>("/api/jobs");
export const getJob = (id: string) => api<Job>(`/api/jobs/${id}`);
export const deleteJob = (id: string) => api<{ ok: true }>(`/api/jobs/${id}`, { method: "DELETE", key: editKeyFor(id) });
export const patchJob = (id: string, p: JobPatch) => api<Job>(`/api/jobs/${id}`, { method: "PATCH", key: editKeyFor(id), body: JSON.stringify(p) });

export type ServerConfig = {
  ai: { anthropic: boolean; gemini: boolean };
  processing: { cloud: boolean; modal: boolean };
  storage: { blob: boolean; jobs: "redis" | "memory" };
  tracknet: boolean;
};
let configP: Promise<ServerConfig> | null = null;
export function getServerConfig(): Promise<ServerConfig> {
  configP ??= api<ServerConfig>("/api/config").catch(() => ({ ai: { anthropic: false, gemini: false }, processing: { cloud: false, modal: false }, storage: { blob: false, jobs: "memory" as const }, tracknet: false }));
  return configP;
}
export function useServerConfig(): ServerConfig | null {
  const [c, setC] = useState<ServerConfig | null>(null);
  useEffect(() => { let on = true; void getServerConfig().then((x) => { if (on) setC(x); }); return () => { on = false; }; }, []);
  return c;
}

/** The mode actually used: falls back to on-device when the chosen cloud mode isn't configured. */
export function effectiveProcessing(chosen: "cloud" | "modal" | "device", cfg: ServerConfig | null): "cloud" | "modal" | "device" {
  if (!cfg || chosen === "device") return chosen;
  if (chosen === "modal") return cfg.processing.modal ? "modal" : cfg.processing.cloud ? "cloud" : "device";
  return cfg.processing.cloud ? "cloud" : "device";
}

/** Polls the job list while the page is visible. */
export function useJobs(intervalMs = 4000): { jobs: Job[] | null; now: number; error: string | null; refresh: () => void } {
  const [state, setState] = useState<{ jobs: Job[] | null; now: number; error: string | null }>({ jobs: null, now: 0, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let on = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (document.visibilityState === "visible") {
        try { const r = await listJobs(); if (on) setState({ jobs: r.jobs, now: r.now, error: null }); }
        catch (e) { if (on) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) })); }
      }
      if (on) timer = setTimeout(run, intervalMs);
    };
    void run();
    return () => { on = false; clearTimeout(timer); };
  }, [intervalMs, tick]);
  return { ...state, refresh: () => setTick((t) => t + 1) };
}

export function useJob(id: string, intervalMs = 3000): { job: Job | null; error: string | null } {
  const [state, setState] = useState<{ job: Job | null; error: string | null }>({ job: null, error: null });
  useEffect(() => {
    let on = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        const j = await getJob(id);
        if (on) setState({ job: j, error: null });
        if (j.state === "done" || j.state === "failed" || j.state === "cancelled") return;
      } catch (e) { if (on) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) })); }
      if (on) timer = setTimeout(run, document.visibilityState === "visible" ? intervalMs : intervalMs * 4);
    };
    void run();
    return () => { on = false; clearTimeout(timer); };
  }, [id, intervalMs]);
  return state;
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Device";
  const br = /CriOS|Chrome/.test(ua) ? "Chrome" : /FxiOS|Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}

export type SubmitInput = {
  file: File;
  video: HTMLVideoElement;
  meta: { width: number; height: number; fps: number; duration: number };
  trimSec: number | null;
  compress: boolean;
  corners: [Pt, Pt, Pt, Pt];
  cornerSource: "manual" | "auto" | "default";
  settings: AnalysisSettings;
  overlay: OverlayOptions;
  exportShortSide: number;
  engine: "cloud" | "modal";
};

export type SubmitProgress = { stage: "creating" | "preparing" | "uploading" | "starting" | "started"; progress: number; jobId?: string; detail?: string };

/** Create job -> (trim/compress on device) -> upload to Blob -> start the cloud worker. */
export async function submitJob(input: SubmitInput, onProgress: (p: SubmitProgress) => void, signal?: AbortSignal): Promise<Job> {
  const release = await keepAwake();
  let jobId: string | null = null;
  try {
    onProgress({ stage: "creating", progress: 0 });
    const durationSec = input.trimSec ? Math.min(input.trimSec, input.meta.duration) : input.meta.duration;
    const source: JobSource = { name: input.file.name, sizeBytes: input.file.size, durationSec: input.meta.duration, width: input.meta.width, height: input.meta.height, fps: input.meta.fps, device: deviceLabel() };
    const created = await api<{ job: Job; editKey: string }>("/api/jobs", { method: "POST", body: JSON.stringify(source) });
    jobId = created.job.id;
    saveKey(jobId, created.editKey);

    let body: Blob = input.file;
    let width = input.meta.width, height = input.meta.height;
    let compressed = false;
    const t0 = Date.now();
    if (input.compress) {
      await patchJob(jobId, { state: "preparing", phase: "Compressing on phone", progress: 0 });
      let last = 0;
      const c = await compressVideo(input.video, {
        durationSec, fps: input.meta.fps, signal,
        onProgress: (p) => {
          onProgress({ stage: "preparing", progress: p, jobId: jobId! });
          if (Date.now() - last > 2500) { last = Date.now(); void patchJob(jobId!, { state: "preparing", phase: "Compressing on phone", progress: p * 0.5 }).catch(() => {}); }
        },
      });
      if (c) { body = c.blob; width = c.width; height = c.height; compressed = true; }
    }
    const prepareMs = Date.now() - t0;
    const k = width / input.meta.width;
    const corners = input.corners.map((p) => ({ x: p.x * k, y: p.y * k })) as WorkerSpec["corners"];

    const t1 = Date.now();
    await patchJob(jobId, { state: "uploading", phase: `Uploading ${(body.size / 1e6).toFixed(0)} MB`, progress: 0, timings: { prepareMs } });
    let lastUp = 0;
    const ext = compressed ? "mp4" : (input.file.name.split(".").pop() ?? "mp4").toLowerCase().slice(0, 5);
    const blob = await upload(`uploads/${jobId}/source.${ext}`, body, {
      access: "public",
      handleUploadUrl: "/api/upload",
      clientPayload: JSON.stringify({ jobId, editKey: created.editKey }),
      contentType: compressed ? "video/mp4" : input.file.type || "video/mp4",
      multipart: body.size > 20e6,
      abortSignal: signal,
      onUploadProgress: ({ percentage }) => {
        const p = percentage / 100;
        onProgress({ stage: "uploading", progress: p, jobId: jobId!, detail: `${(body.size * p / 1e6).toFixed(0)} / ${(body.size / 1e6).toFixed(0)} MB` });
        if (Date.now() - lastUp > 2500) { lastUp = Date.now(); void patchJob(jobId!, { state: "uploading", progress: p }).catch(() => {}); }
      },
    });
    const uploadMs = Date.now() - t1;
    await patchJob(jobId, { timings: { prepareMs, uploadMs } }).catch(() => {});

    onProgress({ stage: "starting", progress: 1, jobId });
    const job = await api<Job>(`/api/jobs/${jobId}/start`, {
      method: "POST", key: created.editKey,
      body: JSON.stringify({
        sourceUrl: blob.url, uploadBytes: body.size, compressed, trimSec: compressed ? null : input.trimSec,
        width, height, corners, cornerSource: input.cornerSource, settings: input.settings, overlay: input.overlay,
        exportShortSide: input.exportShortSide, engine: input.engine,
      }),
    });
    onProgress({ stage: "started", progress: 1, jobId });
    return job;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (jobId) await patchJob(jobId, { state: msg === "cancelled" ? "cancelled" : "failed", error: msg, phase: "Failed" }).catch(() => {});
    throw e;
  } finally {
    release();
  }
}
