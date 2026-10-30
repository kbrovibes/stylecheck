/**
 * Video loading, fps probing and deterministic frame stepping.
 *
 * Design decision: we step through the video by seeking (`currentTime` +
 * `seeked`) instead of WebCodecs. Seeking works for every container the
 * browser can play (incl. iPhone .mov/HEVC where supported) and never drops
 * frames; WebCodecs would be faster but needs a demuxer and codec support.
 */

export type LoadedVideo = { video: HTMLVideoElement; url: string; width: number; height: number; duration: number };

export function loadVideo(src: File | Blob | string): Promise<LoadedVideo> {
  return new Promise((resolve, reject) => {
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.src = url;
    const onMeta = async () => {
      let duration = video.duration;
      if (!Number.isFinite(duration)) {
        // MediaRecorder WebM has Infinity duration until the end is seeked.
        duration = await fixInfiniteDuration(video);
      }
      resolve({ video, url, width: video.videoWidth, height: video.videoHeight, duration });
    };
    video.addEventListener("loadedmetadata", onMeta, { once: true });
    video.addEventListener("error", () => reject(new Error("Could not decode this video in the browser. Try an MP4 (H.264) export.")), { once: true });
  });
}

function fixInfiniteDuration(video: HTMLVideoElement): Promise<number> {
  return new Promise((resolve) => {
    const onUpdate = () => {
      if (Number.isFinite(video.duration)) {
        video.removeEventListener("timeupdate", onUpdate);
        video.currentTime = 0;
        resolve(video.duration);
      }
    };
    video.addEventListener("timeupdate", onUpdate);
    video.currentTime = 1e6;
  });
}

const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 120, 240];

/**
 * Estimate fps by playing ~1s and timing presented frames via
 * requestVideoFrameCallback. Falls back to 30.
 */
export async function probeFps(video: HTMLVideoElement, maxMs = 1500): Promise<number> {
  type RVFC = (cb: (now: number, meta: { mediaTime: number; presentedFrames: number }) => void) => number;
  const rvfc = (video as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback?.bind(video);
  if (!rvfc) return 30;
  const times: number[] = [];
  const start = Math.min(0.2, Math.max(0, video.duration / 4));
  await seekTo(video, start);
  video.playbackRate = 1;
  let done = false;
  const tick = (_now: number, meta: { mediaTime: number }) => {
    times.push(meta.mediaTime);
    if (!done) rvfc(tick);
  };
  rvfc(tick);
  try {
    await video.play();
  } catch {
    return 30;
  }
  await new Promise((r) => setTimeout(r, maxMs));
  done = true;
  video.pause();
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 1 / 300 && d < 0.5) deltas.push(d);
  }
  if (deltas.length < 5) return 30;
  deltas.sort((a, b) => a - b);
  const med = deltas[Math.floor(deltas.length / 2)];
  const fps = 1 / med;
  let best = fps;
  for (const c of COMMON_FPS) if (Math.abs(c - fps) / c < 0.08 && Math.abs(c - fps) < Math.abs(best - fps)) best = c;
  if (best === fps) best = Math.round(fps * 100) / 100;
  return Math.min(240, Math.max(10, best));
}

export function seekTo(video: HTMLVideoElement, t: number, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    const target = Math.max(0, Math.min(t, Math.max(0, video.duration - 1e-3)));
    if (Math.abs(video.currentTime - target) < 1e-4 && video.readyState >= 2) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    video.addEventListener("seeked", finish);
    video.currentTime = target;
  });
}

export type FrameInfo = { f: number; t: number; image: ImageData; gray: Uint8Array };

export type FrameIteratorOptions = {
  fps: number;
  stride: number;
  analysisWidth: number;
  startT?: number;
  endT?: number;
  signal?: AbortSignal;
};

/** Yields downscaled frames (RGBA ImageData + luma) by seeking through the video. */
export async function* iterateFrames(video: HTMLVideoElement, opts: FrameIteratorOptions): AsyncGenerator<FrameInfo> {
  const { fps, stride, analysisWidth } = opts;
  const scale = analysisWidth / video.videoWidth;
  const aw = Math.round(video.videoWidth * scale);
  const ah = Math.round(video.videoHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = aw;
  canvas.height = ah;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const startT = opts.startT ?? 0;
  const endT = opts.endT ?? video.duration;
  const startF = Math.floor(startT * fps);
  const endF = Math.floor(endT * fps);
  const gray = new Uint8Array(aw * ah);
  for (let f = startF; f < endF; f += stride) {
    if (opts.signal?.aborted) return;
    const t = (f + 0.5) / fps;
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, aw, ah);
    const image = ctx.getImageData(0, 0, aw, ah);
    const d = image.data;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    yield { f, t, image, gray: gray.slice() };
  }
}

export function grabFrame(video: HTMLVideoElement, width?: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const w = width ?? video.videoWidth;
  const h = Math.round((video.videoHeight * w) / video.videoWidth);
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(video, 0, 0, w, h);
  return canvas;
}
