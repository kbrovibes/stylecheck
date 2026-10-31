"use client";

import type { CourtCalibration, Pt } from "@/lib/types";
import type { LoadedVideo } from "@/lib/video/frames";

/** Hands a picked video from the library page to the on-device studio (same SPA session). */
export type PendingLocalVideo = { lv: LoadedVideo; file: File; fps: number; corners: [Pt, Pt, Pt, Pt]; source: CourtCalibration["source"]; trimSec: number | null };

let pending: PendingLocalVideo | null = null;
export function setPendingLocalVideo(p: PendingLocalVideo) { pending = p; }
export function takePendingLocalVideo(): PendingLocalVideo | null { const p = pending; pending = null; return p; }
