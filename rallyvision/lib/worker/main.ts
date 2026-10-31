/**
 * Server-side job worker. Runs inside a Vercel Sandbox VM (Node + ffmpeg), so
 * a job keeps going after the uploader closes the app. Uses the same CV,
 * event and overlay code as the in-browser pipeline; players come from the
 * motion detector because MediaPipe Pose only runs in browsers.
 *
 *   node worker.mjs /vercel/sandbox/spec.json
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { del, put } from "@vercel/blob";
import type { Analysis, PlayerSample, ShuttleSample } from "@/lib/types";
import type { Job, JobPatch, WorkerSpec } from "@/lib/jobs/types";
import { read, write } from "@/lib/jobs/core";
import { ClassicalShuttleDetector, ShuttleTracker, type Box } from "@/lib/cv/shuttle";
import { MotionPlayerDetector, PlayerAssigner } from "@/lib/cv/players";
import { buildCalibration, toCourt } from "@/lib/cv/geometry";
import { classifyHits, computeScore, computeStats, detectHits, segmentRallies, smoothTrack } from "@/lib/cv/events";
import { buildIndex, drawOverlay, renderStatsCard } from "@/lib/render/overlay";
import { detectWithModal } from "@/lib/worker/modal";

const TMP = process.env.WORK_DIR ?? "/tmp/rallyvision";
const WORKER_START = Date.now();
const ANALYSIS_WIDTH = 640;

const spec = JSON.parse(fs.readFileSync(process.argv[2] ?? "/vercel/sandbox/spec.json", "utf8")) as WorkerSpec;
const timings: NonNullable<Job["timings"]> = {};
let lastBeat = 0;
/** WORKER_DRY=1: no Redis/Blob; log progress and keep outputs in WORK_DIR (local testing). */
const DRY = process.env.WORKER_DRY === "1";

async function patch(p: JobPatch, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastBeat < 2000) return;
  lastBeat = now;
  if (DRY) { console.log(`[worker] ${p.state} ${p.phase ?? ""} ${Math.round((p.progress ?? 0) * 100)}% eta=${p.etaSec ?? "-"}`, p.output ? JSON.stringify(p.output) : "", p.summary ? JSON.stringify(p.summary) : ""); return; }
  const s = await read(spec.jobId);
  if (!s) throw new Error("job vanished");
  if (s.job.state === "cancelled") throw new Error("cancelled");
  await write({ ...s, job: { ...s.job, ...p, timings: { ...s.job.timings, ...timings }, updatedAt: now, heartbeatAt: now } });
}

type Probe = { fps: number; duration: number; hasAudio: boolean };
function probe(file: string): Probe {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,avg_frame_rate,r_frame_rate:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const j = JSON.parse(r.stdout) as { streams: Array<{ codec_type: string; avg_frame_rate?: string; r_frame_rate?: string }>; format: { duration?: string } };
  const v = j.streams.find((s) => s.codec_type === "video");
  if (!v) throw new Error("no video stream");
  const rate = (q?: string) => { const [a, b] = (q ?? "0/1").split("/").map(Number); return b ? a / b : 0; };
  let fps = rate(v.avg_frame_rate) || rate(v.r_frame_rate) || 30;
  fps = Math.min(60, Math.max(10, Math.round(fps * 100) / 100));
  return { fps, duration: parseFloat(j.format.duration ?? "0"), hasAudio: j.streams.some((s) => s.codec_type === "audio") };
}

/** Streams fixed-size raw frames from an ffmpeg stdout. */
async function* rawFrames(args: string[], frameBytes: number): AsyncGenerator<Buffer> {
  const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  ff.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
  let buf: Buffer = Buffer.alloc(0);
  for await (const chunk of ff.stdout as AsyncIterable<Buffer>) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= frameBytes) {
      yield buf.subarray(0, frameBytes);
      buf = buf.subarray(frameBytes);
    }
  }
  const code: number = await new Promise((r) => (ff.exitCode !== null ? r(ff.exitCode) : ff.on("close", r)));
  if (code !== 0) throw new Error(`ffmpeg decode failed: ${err}`);
}

/** Asks Gemini whether sampled frames show badminton. Null when no key or on any error (never blocks a job). */
async function screenWithGemini(src: string, duration: number): Promise<{ badminton: boolean; confidence: number; reason: string } | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const parts: Array<Record<string, unknown>> = [];
    for (const frac of [0.15, 0.4, 0.65, 0.9]) {
      const out = `${TMP}/screen-${frac}.jpg`;
      spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", (duration * frac).toFixed(2), "-i", src, "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "5", out]);
      if (fs.existsSync(out)) parts.push({ inline_data: { mime_type: "image/jpeg", data: fs.readFileSync(out).toString("base64") } });
    }
    if (!parts.length) return null;
    parts.push({ text: [
      "These are 4 frames sampled from one uploaded video. Decide if it shows badminton play: a badminton court (net, court lines) with players, a rally, practice or drills.",
      "Count as badminton: phone recordings, broadcasts, screen recordings, low quality or dark footage, and rendered/animated/simulated badminton play.",
      "Answer badminton=false only when the video clearly is something else (another sport, people talking, scenery, pets, documents, games or animations unrelated to badminton).",
      "Give confidence 0-1 in your answer and a one-sentence reason. Answer as JSON.",
    ].join(" ") });
    const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: { type: "OBJECT", properties: { badminton: { type: "BOOLEAN" }, confidence: { type: "NUMBER" }, reason: { type: "STRING" } }, required: ["badminton", "confidence", "reason"] },
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? (JSON.parse(text) as { badminton: boolean; confidence: number; reason: string }) : null;
  } catch { return null; }
}

class Rejected extends Error {}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

async function main() {
  fs.mkdirSync(TMP, { recursive: true });
  for (const f of ["/usr/share/fonts/opentype/inter", "/usr/share/fonts/truetype/inter"]) if (fs.existsSync(f)) GlobalFonts.loadFontsFromDir(f);

  // 1. download
  await patch({ state: "analyzing", phase: "Downloading video", progress: 0 }, true);
  const src = `${TMP}/source`;
  const t0 = Date.now();
  if (spec.sourceUrl.startsWith("/")) fs.copyFileSync(spec.sourceUrl, src);
  else {
    const res = await fetch(spec.sourceUrl);
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), fs.createWriteStream(src));
  }
  timings.prepareMs = Date.now() - t0;
  const info = probe(src);
  const fps = info.fps;
  const duration = Math.min(info.duration, spec.trimSec ?? Infinity);
  const frames = Math.floor(duration * fps);
  const trimArgs = ["-t", duration.toFixed(3)];

  // 1b. reject uploads that aren't badminton (keeps the public library clean)
  await patch({ state: "analyzing", phase: "Checking it's badminton", progress: 0.01 }, true);
  const verdict = await screenWithGemini(src, duration);
  if (verdict) {
    await patch({ screen: { ...verdict, by: "gemini" } }, true);
    if (!verdict.badminton && verdict.confidence >= 0.8) throw new Rejected(verdict.reason || "This doesn't look like badminton.");
  }

  // 2. analyse (same detector/tracker/event code as the browser)
  const W = spec.width, H = spec.height;
  // the tracker was tuned at 640x360 (~230k px): keep that pixel budget for portrait clips too
  const aw = Math.min(W, Math.round(Math.sqrt((ANALYSIS_WIDTH * 360 * W) / H))) & ~1, ah = even((H * aw) / W);
  const scale = W / aw;
  const cal = buildCalibration(spec.corners, spec.settings.mode, spec.cornerSource);
  const det = new ClassicalShuttleDetector(aw, ah);
  const tracker = new ShuttleTracker(aw, { toCourt: (p) => toCourt(cal, { x: p.x * scale, y: p.y * scale }) });
  const motion = new MotionPlayerDetector(aw, ah);
  const assigner = new PlayerAssigner(cal, spec.settings.mode === "doubles" ? 2 : 1, scale);
  let shuttle: ShuttleSample[] = [];
  const players: PlayerSample[] = [];
  const useModal = process.env.DETECT_ENGINE === "modal";
  const tA = Date.now();
  let f = 0;
  if (useModal) {
    // GPU path: TrackNetV3 shuttle + pose model on Modal; everything downstream is identical
    const r = await detectWithModal({ videoUrl: spec.sourceUrl, trimSec: duration, fps, width: W, height: H },
      (p) => patch({ state: "analyzing", phase: "Tracking on GPU (TrackNetV3)", progress: 0.5 * p, etaSec: null }));
    shuttle = r.shuttle;
    f = r.frames;
    timings.gpuMs = Date.now() - tA;
    for (const pf of r.poses) {
      const poses = pf.people.map((p) => ({ conf: p.conf, landmarks: p.landmarks.map((q) => ({ x: q.x / scale, y: q.y / scale })) }));
      if (poses.length) players.push(...assigner.fromPoses(pf.f, pf.f / fps, poses).players);
    }
  }
  // CPU pass: the whole tracker when not on Modal; just players if the GPU pose model found too few
  const cpuPlayers = !useModal || players.length < f * 0.2;
  if (cpuPlayers) {
    if (useModal) players.length = 0;
    let cf = 0;
    let exclude: Box[] = [];
    // Slow running-average background: unlike frame differencing it also finds players who stand still.
    const bg = new Float32Array(aw * ah);
    const fg = new Uint8Array(aw * ah);
    for await (const gray of rawFrames(["-v", "error", "-i", src, ...trimArgs, "-vf", `fps=${fps},scale=${aw}:${ah}:flags=bilinear`, "-f", "rawvideo", "-pix_fmt", "gray", "-"], aw * ah)) {
      const t = cf / fps;
      const cands = det.detect({ gray }, exclude);
      if (cf === 0) for (let i = 0; i < bg.length; i++) bg[i] = gray[i];
      const rate = cf < fps * 2 ? 0.1 : 0.01;
      for (let i = 0; i < bg.length; i++) {
        const d = gray[i] - bg[i];
        fg[i] = d > 28 || d < -28 ? 1 : det.motionMask[i];
        bg[i] += rate * d;
      }
      if (cf % 2 === 0) {
        const recent = (useModal ? [] : shuttle.slice(-3)).map((s) => ({ x: s.x / scale, y: s.y / scale }));
        const boxes = motion.detect(fg, recent);
        if (boxes.length) { const r = assigner.fromBoxes(cf, t, boxes); players.push(...r.players); exclude = r.exclude; }
      }
      if (!useModal) {
        const tr = tracker.step(cf, t, cands);
        if (tr.retract) { let n = tr.retract.n; for (let k = shuttle.length - 1; k >= 0 && n > 0; k--) if (shuttle[k].tid === tr.retract.tid) { shuttle.splice(k, 1); n--; } }
        for (const s of tr.samples) shuttle.push({ ...s, x: s.x * scale, y: s.y * scale });
      }
      cf++;
      if (!useModal) f = cf;
      if (cf % 30 === 0) {
        const fpsDone = cf / ((Date.now() - tA) / 1000);
        await patch({ state: "analyzing", phase: useModal ? "Finding players" : "Tracking shuttle & players", progress: (useModal ? 0.45 : 0) + (useModal ? 0.05 : 0.5) * (cf / frames), etaSec: Math.round((frames - cf) / fpsDone + frames / Math.max(1, fpsDone * 0.6)) });
      }
    }

  }
  timings.analysisMs = Date.now() - tA;
  shuttle.sort((a, b) => a.f - b.f);
  const smooth = smoothTrack(shuttle, 1);
  const hits = detectHits(smooth, cal, fps, players);
  const rallies = segmentRallies(smooth, hits, fps, cal, spec.settings);
  classifyHits(hits, rallies, cal);
  for (const r of rallies) {
    const sp = r.hits.filter((h) => h.reliable).map((h) => h.speedKmh).filter((v): v is number => v !== null);
    r.maxSpeedKmh = sp.length ? Math.max(...sp) : null;
  }
  const score = computeScore(rallies, spec.settings);
  const stats = computeStats(rallies, hits, players, fps);
  if (!verdict && rallies.length === 0 && hits.length < 2 && players.length < f * 0.05) {
    await patch({ screen: { badminton: false, confidence: 0.6, reason: "No court play found: no rallies, shots or players detected.", by: "heuristic" } }, true);
    throw new Rejected("No badminton play found: no rallies, shots or players were detected.");
  }
  const analysis: Analysis = {
    version: 1,
    video: { width: W, height: H, fps, duration, frames: f, name: spec.jobId },
    calibration: cal,
    shuttle: smooth,
    players,
    hits,
    rallies,
    score,
    stats,
    engine: { shuttle: useModal ? "cloud" : "classical", players: !players.length ? "none" : useModal && !cpuPlayers ? "pose" : "motion", analysisWidth: aw, stride: 1, ms: timings.analysisMs, debug: { ...tracker.debug, ...det.debug } },
    settings: spec.settings,
  };

  // 3. render: overlay frames (RGBA, transparent) composited by ffmpeg over the source, audio kept
  const short = Math.min(W, H);
  const k = Math.min(1, spec.exportShortSide / short);
  const OW = even(W * k), OH = even(H * k);
  const out = `${TMP}/out.mp4`;
  const enc = spawn("ffmpeg", [
    "-v", "error", "-y",
    "-i", src,
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${OW}x${OH}`, "-r", String(fps), "-i", "-",
    "-filter_complex", `[0:v]fps=${fps},scale=${OW}:${OH},setsar=1[base];[base][1:v]overlay=0:0:format=auto:shortest=1[v]`,
    "-map", "[v]", ...(info.hasAudio ? ["-map", "0:a:0", "-c:a", "aac", "-b:a", "128k"] : []),
    ...trimArgs,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    out,
  ], { stdio: ["pipe", "ignore", "pipe"] });
  let encErr = "";
  enc.stderr.on("data", (d) => { encErr = (encErr + d).slice(-4000); });
  const encDone = new Promise<number>((r) => enc.on("close", r));
  const canvas = createCanvas(OW, OH);
  const ctx = canvas.getContext("2d");
  const idx = buildIndex(analysis);
  const tR = Date.now();
  for (let i = 0; i < f; i++) {
    ctx.clearRect(0, 0, OW, OH);
    ctx.save();
    ctx.scale(OW / W, OH / H);
    drawOverlay(ctx as unknown as CanvasRenderingContext2D, analysis, idx, i, spec.overlay);
    ctx.restore();
    const px = ctx.getImageData(0, 0, OW, OH).data;
    if (!enc.stdin.write(Buffer.from(px.buffer, px.byteOffset, px.byteLength))) await new Promise((r) => enc.stdin.once("drain", r));
    if (i % 30 === 0) {
      const rate = (i + 1) / ((Date.now() - tR) / 1000);
      await patch({ state: "rendering", phase: "Rendering overlays", progress: 0.5 + 0.45 * (i / f), etaSec: Math.round((f - i) / rate) + 10 });
    }
  }
  enc.stdin.end();
  if ((await encDone) !== 0) throw new Error(`ffmpeg encode failed: ${encErr}`);
  timings.renderMs = Date.now() - tR;

  // 4. poster (fastest shot, else middle), stats card, analysis JSON
  await patch({ state: "publishing", phase: "Publishing", progress: 0.96, etaSec: 15 }, true);
  const tP = Date.now();
  const top = idx.topHit;
  const posterAt = top ? Math.min(duration - 0.1, top.t + 0.25) : duration / 2;
  const poster = `${TMP}/poster.jpg`;
  spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", posterAt.toFixed(2), "-i", out, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "4", poster]);
  const card = renderStatsCard(analysis, spec.overlay.speedUnit, (w, h) => createCanvas(w, h));
  const base = `jobs/${spec.jobId}/v${spec.version}`;
  const opts = { access: "public" as const, addRandomSuffix: false, allowOverwrite: true };
  const outBytes = fs.statSync(out).size;
  const slim = { ...analysis, players: analysis.players.map((p) => ({ ...p, landmarks: undefined })) };
  const cardPng = await card.encode("png");
  if (DRY) {
    fs.writeFileSync(`${TMP}/card.png`, cardPng);
    fs.writeFileSync(`${TMP}/analysis.json`, JSON.stringify(slim));
  }
  const upload: typeof put = DRY ? (async (pathname: string) => ({ url: `file://${TMP}/${pathname.split("/").pop()}` })) as unknown as typeof put : put;
  const [video, posterBlob, cardBlob, json] = await Promise.all([
    upload(`${base}/rallyvision.mp4`, fs.createReadStream(out), { ...opts, contentType: "video/mp4", multipart: outBytes > 50e6 }),
    fs.existsSync(poster) ? upload(`${base}/poster.jpg`, fs.readFileSync(poster), { ...opts, contentType: "image/jpeg" }) : null,
    upload(`${base}/card.png`, cardPng, { ...opts, contentType: "image/png" }),
    upload(`${base}/analysis.json`, JSON.stringify(slim), { ...opts, contentType: "application/json" }),
  ]);
  timings.publishMs = Date.now() - tP;
  timings.workerMs = Date.now() - WORKER_START;
  if (!DRY && spec.sourceUrl.startsWith("https://")) await del(spec.sourceUrl).catch(() => {}); // outputs are kept; the raw upload isn't needed any more
  const last = score[score.length - 1];
  await patch({
    state: "done", phase: "Done", progress: 1, etaSec: null,
    output: { videoUrl: video.url, videoBytes: outBytes, width: OW, height: OH, codec: "h264", posterUrl: posterBlob?.url, cardUrl: cardBlob.url, analysisUrl: json.url, version: spec.version },
    summary: {
      nearLabel: spec.settings.nearLabel, farLabel: spec.settings.farLabel,
      scoreNear: last?.near ?? 0, scoreFar: last?.far ?? 0,
      rallies: stats.rallies, shots: stats.shots, topSpeedKmh: stats.topSpeedKmh, smashes: stats.smashes,
    },
  }, true);
}

async function finish(ok: boolean) {
  if (DRY) return;
  try {
    await fetch(spec.callbackUrl, { method: "POST", headers: { "content-type": "application/json", "x-worker-token": spec.workerToken }, body: JSON.stringify({ ok }) });
  } catch { /* the sandbox times out on its own */ }
}

main()
  .then(() => finish(true))
  .catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Rejected) {
      timings.workerMs = Date.now() - WORKER_START;
      try { await patch({ state: "rejected", phase: "Removed: not badminton", error: msg.slice(0, 300), etaSec: null, progress: 1 }, true); } catch { /* ignore */ }
      if (!DRY && spec.sourceUrl.startsWith("https://")) await del(spec.sourceUrl).catch(() => {});
      await finish(true);
      return;
    }
    console.error("[worker] failed:", msg);
    if (msg !== "cancelled") {
      try { await patch({ state: "failed", phase: "Failed", error: msg.slice(0, 500), etaSec: null }, true); } catch { /* ignore */ }
    }
    await finish(false);
    process.exitCode = 1;
  });
