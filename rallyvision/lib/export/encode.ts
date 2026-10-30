/**
 * Export the analysed video with overlays burned in.
 *
 *  1. WebCodecs + mp4-muxer -> MP4 (H.264 if the browser can encode it,
 *     otherwise VP9-in-MP4). Frame-accurate, runs faster than realtime.
 *  2. Fallback: MediaRecorder on a canvas stream while the video plays ->
 *     WebM (VP9). Realtime, keeps the original audio when captureStream exists.
 */

import type { Analysis } from "@/lib/types";
import { buildIndex, drawOverlay, type OverlayOptions } from "@/lib/render/overlay";
import { seekTo } from "@/lib/video/frames";

export type ExportResult = { blob: Blob; ext: "mp4" | "webm"; codec: string; seconds: number };

export type ExportOptions = {
  overlay: OverlayOptions;
  maxWidth?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  forceFallback?: boolean;
};

export async function exportVideo(video: HTMLVideoElement, a: Analysis, opts: ExportOptions): Promise<ExportResult> {
  const t0 = performance.now();
  const maxW = opts.maxWidth ?? 1920;
  const scale = Math.min(1, maxW / a.video.width);
  const W = Math.round((a.video.width * scale) / 2) * 2;
  const H = Math.round((a.video.height * scale) / 2) * 2;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const idx = buildIndex(a);
  const draw = (f: number) => {
    ctx.drawImage(video, 0, 0, W, H);
    ctx.save();
    ctx.scale(scale, scale);
    // overlay expects original-size coordinates; canvas size for text scaling is handled via ctx.canvas (W,H) -> acceptable
    drawOverlay(ctx, a, idx, f, opts.overlay);
    ctx.restore();
  };

  if (!opts.forceFallback && typeof VideoEncoder !== "undefined") {
    const pick = await pickCodec(W, H, a.video.fps);
    if (pick) {
      try {
        const r = await encodeWebCodecs(video, a, canvas, draw, pick, opts);
        return { ...r, seconds: Math.round((performance.now() - t0) / 100) / 10 };
      } catch (e) {
        console.warn("[rallyvision] WebCodecs export failed, falling back to MediaRecorder:", e);
      }
    }
  }
  const r = await recordRealtime(video, a, canvas, draw, opts);
  return { ...r, seconds: Math.round((performance.now() - t0) / 100) / 10 };
}

type CodecPick = { codec: string; mux: "avc" | "vp9" | "av1"; ext: "mp4" };

async function pickCodec(W: number, H: number, fps: number): Promise<CodecPick | null> {
  const tries: CodecPick[] = [
    { codec: "avc1.640028", mux: "avc", ext: "mp4" },
    { codec: "avc1.4d0028", mux: "avc", ext: "mp4" },
    { codec: "avc1.42001f", mux: "avc", ext: "mp4" },
    { codec: "vp09.00.10.08", mux: "vp9", ext: "mp4" },
  ];
  for (const t of tries) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec: t.codec, width: W, height: H, bitrate: 8_000_000, framerate: fps });
      if (s.supported) return t;
    } catch { /* try next */ }
  }
  return null;
}

async function encodeWebCodecs(video: HTMLVideoElement, a: Analysis, canvas: HTMLCanvasElement, draw: (f: number) => void, pick: CodecPick, opts: ExportOptions): Promise<Omit<ExportResult, "seconds">> {
  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
  const fps = a.video.fps;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: pick.mux, width: canvas.width, height: canvas.height, frameRate: fps },
    fastStart: "in-memory",
  });
  let error: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { error = e; },
  });
  encoder.configure({ codec: pick.codec, width: canvas.width, height: canvas.height, bitrate: Math.min(12_000_000, Math.round(canvas.width * canvas.height * fps * 0.12)), framerate: fps, ...(pick.mux === "avc" ? { avc: { format: "avc" as const } } : {}) });
  const total = a.video.frames;
  const usPerFrame = 1e6 / fps;
  for (let f = 0; f < total; f++) {
    if (opts.signal?.aborted) throw new Error("cancelled");
    if (error) throw error;
    await seekTo(video, (f + 0.5) / fps);
    draw(f);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(f * usPerFrame), duration: Math.round(usPerFrame) });
    encoder.encode(frame, { keyFrame: f % Math.round(fps * 2) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
    if (f % 5 === 0) opts.onProgress?.(f, total);
  }
  await encoder.flush();
  encoder.close();
  muxer.finalize();
  const buf = (muxer.target as InstanceType<typeof ArrayBufferTarget>).buffer;
  opts.onProgress?.(total, total);
  return { blob: new Blob([buf], { type: "video/mp4" }), ext: "mp4", codec: pick.codec };
}

async function recordRealtime(video: HTMLVideoElement, a: Analysis, canvas: HTMLCanvasElement, draw: (f: number) => void, opts: ExportOptions): Promise<Omit<ExportResult, "seconds">> {
  if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot export video (no WebCodecs or MediaRecorder).");
  const fps = a.video.fps;
  const stream = canvas.captureStream(fps);
  // keep original audio if available
  type Cap = { captureStream?: () => MediaStream };
  const vcap = (video as unknown as Cap).captureStream?.call(video);
  if (vcap) for (const tr of vcap.getAudioTracks()) stream.addTrack(tr);
  const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<Blob>((resolve) => { rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" })); });
  await seekTo(video, 0);
  video.muted = true;
  video.playbackRate = 1;
  rec.start(250);
  type RVFC = (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  const rvfc = (video as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback?.bind(video);
  let running = true;
  const tick = (_n: number, meta: { mediaTime: number }) => {
    if (!running) return;
    const f = Math.min(a.video.frames - 1, Math.floor(meta.mediaTime * fps));
    draw(f);
    opts.onProgress?.(f, a.video.frames);
    rvfc?.(tick);
  };
  if (rvfc) rvfc(tick);
  else {
    const loop = () => { if (!running) return; draw(Math.floor(video.currentTime * fps)); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  await video.play();
  await new Promise<void>((resolve) => {
    const onEnd = () => resolve();
    video.addEventListener("ended", onEnd, { once: true });
    opts.signal?.addEventListener("abort", () => { video.pause(); resolve(); }, { once: true });
  });
  running = false;
  rec.stop();
  const blob = await done;
  return { blob, ext: "webm", codec: mime };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
