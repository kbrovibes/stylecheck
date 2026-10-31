"use client";

import { useSyncExternalStore } from "react";
import type { AnalysisSettings, CourtMode, Side } from "@/lib/types";
import { DEFAULT_OVERLAY, type OverlayOptions } from "@/lib/render/overlay";

export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Best notes · ~$0.05 per video" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Balanced · ~$0.02 per video" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Fastest · ~$0.002 per video" },
] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number]["id"];

export type AiProvider = "auto" | "anthropic" | "gemini" | "mock";

export type ProcessingMode = "cloud" | "modal" | "device";

export type AppSettings = {
  processing: ProcessingMode;
  trimSeconds: 60 | 90 | 120;
  compressOnPhone: boolean;
  shuttleEngine: AnalysisSettings["shuttleEngine"];
  players: "pose" | "motion";
  analysisWidth: "auto" | 480 | 640 | 960;
  stride: 1 | 2;

  mode: CourtMode;
  pointsToWin: 21 | 15 | 11;
  startServer: Side;
  nearLabel: string;
  farLabel: string;

  aiProvider: AiProvider;
  claudeModel: ClaudeModel;
  autoInsights: boolean;

  overlay: OverlayOptions;

  exportFormat: "auto" | "webm";
  exportWidth: 720 | 1080 | 1280 | 1920;

  maxClipMinutes: 2 | 5 | 10;
  maxFileMb: 500 | 1000 | 2000;

  theme: "light" | "dark" | "system";
  keepAwake: boolean;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  processing: "cloud",
  trimSeconds: 90,
  compressOnPhone: true,
  shuttleEngine: "classical",
  players: "pose",
  analysisWidth: "auto",
  stride: 1,
  mode: "singles",
  pointsToWin: 21,
  startServer: "near",
  nearLabel: "Near",
  farLabel: "Far",
  aiProvider: "auto",
  claudeModel: "claude-opus-5-5",
  autoInsights: false,
  overlay: DEFAULT_OVERLAY,
  exportFormat: "auto",
  exportWidth: 1080,
  maxClipMinutes: 5,
  maxFileMb: 1000,
  theme: "light",
  keepAwake: true,
};

const KEY = "rallyvision.settings.v1";
const listeners = new Set<() => void>();
let current: AppSettings = DEFAULT_APP_SETTINGS;
let loaded = false;

function load(): AppSettings {
  if (loaded) return current;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      current = { ...DEFAULT_APP_SETTINGS, ...parsed, overlay: { ...DEFAULT_OVERLAY, ...(parsed.overlay ?? {}) } };
    }
  } catch { /* storage unavailable: defaults */ }
  return current;
}

export function getSettings(): AppSettings {
  return typeof window === "undefined" ? DEFAULT_APP_SETTINGS : load();
}

export function updateSettings(patch: Partial<AppSettings>): void {
  current = { ...getSettings(), ...patch };
  try { window.localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* ignore */ }
  for (const l of listeners) l();
}

export function resetSettings(): void {
  current = DEFAULT_APP_SETTINGS;
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { loaded = false; l(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(l); window.removeEventListener("storage", onStorage); };
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSettings, () => DEFAULT_APP_SETTINGS);
}

/** Phones and tablets: coarse pointer or a small screen. */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth < 768;
}

export function resolveAnalysisSettings(s: AppSettings): AnalysisSettings {
  return {
    mode: s.mode,
    startServer: s.startServer,
    nearLabel: s.nearLabel.trim() || "Near",
    farLabel: s.farLabel.trim() || "Far",
    analysisWidth: s.analysisWidth === "auto" ? (isMobileDevice() ? 480 : 640) : s.analysisWidth,
    stride: s.stride,
    usePose: s.players === "pose",
    shuttleEngine: s.shuttleEngine,
    pointsToWin: s.pointsToWin,
  };
}
