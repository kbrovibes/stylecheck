"use client";

/**
 * On-device "WhatsApp-style" compression before upload: re-encodes the first
 * `durationSec` of the video to H.264 at ≤720p (short side) with WebCodecs.
 * Video only (audio is dropped). Returns null when the browser cannot encode.
 */

import { seekTo } from "@/lib/video/frames";

export type Compressed = { blob: Blob; width: number; height: number; fps: number; durationSec: number };

export async function canCompress(): Promise<boolean> {
  if (typeof VideoEncoder === "undefined") return false;
  try { return !!(await VideoEncoder.isConfigSupported({ codec: "avc1.42001f", width: 1280, height: 720, bitrate: 3_000_000, framerate: 30 })).supported; } catch { return false; }
}

export async function compressVideo(
  video: HTMLVideoElement,
  opts: { durationSec: number; fps: number; shortSide?: number; onProgress?: (p: number) => void; signal?: AbortSignal },
): Promise<Compressed | null> {
  if (!(await canCompress())) return null;
  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
  const short = Math.min(video.videoWidth, video.videoHeight);
  const k = Math.min(1, (opts.shortSide ?? 720) / short);
  const W = Math.round((video.videoWidth * k) / 2) * 2, H = Math.round((video.videoHeight * k) / 2) * 2;
  const fps = Math.min(60, opts.fps);
  const codecs = ["avc1.640028", "avc1.4d0028", "avc1.42001f"];
  let codec: string | null = null;
  for (const c of codecs) {
    try { if ((await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate: 4_000_000, framerate: fps })).supported) { codec = c; break; } } catch { /* next */ }
  }
  if (!codec) return null;
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: "avc", width: W, height: H, frameRate: fps }, fastStart: "in-memory" });
  let error: unknown = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { error = e; } });
  // ~0.09 bits per pixel per frame: 720p30 ≈ 2.5 Mbps — plenty for analysis, small to upload
  encoder.configure({ codec, width: W, height: H, bitrate: Math.round(W * H * fps * 0.09), framerate: fps, avc: { format: "avc" } });
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const total = Math.floor(opts.durationSec * fps);
  const us = 1e6 / fps;
  for (let f = 0; f < total; f++) {
    if (opts.signal?.aborted) throw new Error("cancelled");
    if (error) throw error;
    await seekTo(video, (f + 0.5) / fps);
    ctx.drawImage(video, 0, 0, W, H);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(f * us), duration: Math.round(us) });
    encoder.encode(frame, { keyFrame: f % Math.round(fps * 2) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
    if (f % 10 === 0) opts.onProgress?.(f / total);
  }
  await encoder.flush();
  encoder.close();
  muxer.finalize();
  opts.onProgress?.(1);
  const buf = (muxer.target as InstanceType<typeof ArrayBufferTarget>).buffer;
  return { blob: new Blob([buf], { type: "video/mp4" }), width: W, height: H, fps, durationSec: total / fps };
}
