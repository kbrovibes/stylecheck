"use client";

export type Capabilities = {
  mobile: boolean;
  webgl2: boolean;
  webcodecs: boolean;
  h264Encode: boolean;
  mediaRecorder: boolean;
  frameCallback: boolean;
  wakeLock: boolean;
  shareFiles: boolean;
  cores: number | null;
  memoryGb: number | null;
};

let cached: Promise<Capabilities> | null = null;

export function detectCapabilities(): Promise<Capabilities> {
  if (cached) return cached;
  cached = (async () => {
    const nav = navigator as Navigator & { deviceMemory?: number };
    let webgl2 = false;
    try { webgl2 = !!document.createElement("canvas").getContext("webgl2"); } catch { /* no */ }
    const webcodecs = typeof VideoEncoder !== "undefined";
    let h264Encode = false;
    if (webcodecs) {
      try { h264Encode = !!(await VideoEncoder.isConfigSupported({ codec: "avc1.42001f", width: 1280, height: 720, bitrate: 4_000_000, framerate: 30 })).supported; } catch { /* no */ }
    }
    let shareFiles = false;
    try { shareFiles = !!nav.canShare?.({ files: [new File([new Uint8Array(1)], "x.mp4", { type: "video/mp4" })] }); } catch { /* no */ }
    return {
      mobile: window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth < 768,
      webgl2,
      webcodecs,
      h264Encode,
      mediaRecorder: typeof MediaRecorder !== "undefined",
      frameCallback: "requestVideoFrameCallback" in HTMLVideoElement.prototype,
      wakeLock: "wakeLock" in navigator,
      shareFiles,
      cores: nav.hardwareConcurrency ?? null,
      memoryGb: nav.deviceMemory ?? null,
    };
  })();
  return cached;
}

/** Keeps the screen on during long work (analysis/export). Returns a release function. */
export async function keepAwake(): Promise<() => void> {
  type Sentinel = { release: () => Promise<void> };
  const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Sentinel> } }).wakeLock;
  if (!wl) return () => {};
  let sentinel: Sentinel | null = null;
  const acquire = async () => { try { sentinel = await wl.request("screen"); } catch { sentinel = null; } };
  await acquire();
  const onVis = () => { if (document.visibilityState === "visible") void acquire(); };
  document.addEventListener("visibilitychange", onVis);
  return () => { document.removeEventListener("visibilitychange", onVis); void sentinel?.release().catch(() => {}); };
}
