/**
 * The end-to-end in-browser analysis pipeline.
 */

import { type Analysis, type AnalysisSettings, type CourtCalibration, type PlayerSample, type Progress, type ShuttleSample, type VideoMeta } from "@/lib/types";
import { iterateFrames } from "@/lib/video/frames";
import { ClassicalShuttleDetector, ShuttleTracker, type Box, type ShuttleEngine } from "@/lib/cv/shuttle";
import { MotionPlayerDetector, PlayerAssigner, createPoseDetector } from "@/lib/cv/players";
import { classifyHits, computeScore, computeStats, detectHits, segmentRallies, smoothTrack } from "@/lib/cv/events";
import { TrackNetEngine, trackNetModelUrl } from "@/lib/cv/tracknet";
import { toCourt } from "@/lib/cv/geometry";

export async function runAnalysis(
  video: HTMLVideoElement,
  meta: VideoMeta,
  cal: CourtCalibration,
  settings: AnalysisSettings,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<Analysis> {
  const t0 = performance.now();
  const aw = Math.min(settings.analysisWidth, meta.width);
  const ah = Math.round((meta.height * aw) / meta.width);
  const scale = meta.width / aw;
  const perSide = settings.mode === "doubles" ? 2 : 1;

  onProgress({ phase: "Loading models", done: 0, total: 1 });
  const classical = new ClassicalShuttleDetector(aw, ah);
  let engine: ShuttleEngine = classical;
  let engineName: Analysis["engine"]["shuttle"] = "classical";
  if (settings.shuttleEngine === "tracknet") {
    const url = trackNetModelUrl();
    if (url) {
      try {
        engine = await TrackNetEngine.create(url, aw, ah);
        engineName = "tracknet";
      } catch (e) {
        console.warn("[rallyvision] TrackNet unavailable, falling back to classical:", e);
      }
    }
  }
  const pose = settings.usePose ? await createPoseDetector(perSide * 2) : null;
  const motion = new MotionPlayerDetector(aw, ah);
  const assigner = new PlayerAssigner(cal, perSide, scale);
  const tracker = new ShuttleTracker(aw, { toCourt: (p) => toCourt(cal, { x: p.x * scale, y: p.y * scale }) });

  const poseCanvas = document.createElement("canvas");
  poseCanvas.width = aw; poseCanvas.height = ah;
  const poseCtx = poseCanvas.getContext("2d")!;

  const shuttle: ShuttleSample[] = [];
  const players: PlayerSample[] = [];
  let exclude: Box[] = [];
  let poseHits = 0;
  const poseEvery = settings.stride >= 2 ? 1 : 2;
  let i = 0;
  const total = Math.ceil(meta.frames / settings.stride);
  let lastYield = performance.now();

  for await (const frame of iterateFrames(video, { fps: meta.fps, stride: settings.stride, analysisWidth: aw, signal })) {
    // --- players (pose first so its torso boxes can mask the shuttle search)
    let gotPlayers = false;
    if (pose && i % poseEvery === 0) {
      poseCtx.putImageData(frame.image, 0, 0);
      const poses = pose.detect(poseCanvas, Math.round(frame.t * 1000));
      if (poses.length) {
        const r = assigner.fromPoses(frame.f, frame.t, poses);
        players.push(...r.players);
        exclude = r.exclude;
        gotPlayers = r.players.length > 0;
        poseHits += r.players.length;
      }
    }
    // --- shuttle
    const cands = await engine.detect({ gray: frame.gray, image: frame.image, width: aw, height: ah }, exclude);
    if (engine !== classical) classical.detect({ gray: frame.gray }, []); // keep the motion mask alive for the player fallback
    if (!gotPlayers && (!pose || i % poseEvery === 0)) {
      const recentShuttle = shuttle.slice(-3).map((s) => ({ x: s.x / scale, y: s.y / scale }));
      const boxes = motion.detect(classical.motionMask, recentShuttle);
      if (boxes.length) {
        const r = assigner.fromBoxes(frame.f, frame.t, boxes);
        players.push(...r.players);
        if (!pose) exclude = r.exclude;
      }
    }
    const tr = tracker.step(frame.f, frame.t, cands);
    if (tr.retract) { let n = tr.retract.n; for (let k = shuttle.length - 1; k >= 0 && n > 0; k--) if (shuttle[k].tid === tr.retract.tid) { shuttle.splice(k, 1); n--; } }
    for (const s of tr.samples) shuttle.push({ ...s, x: s.x * scale, y: s.y * scale });
    i++;
    if (i % 5 === 0 || performance.now() - lastYield > 250) {
      onProgress({ phase: "Tracking", done: i, total, detail: `${shuttle.length} shuttle samples · ${players.length} player samples` });
      await new Promise((r) => setTimeout(r, 0));
      lastYield = performance.now();
    }
    if (signal?.aborted) break;
  }
  pose?.close();

  onProgress({ phase: "Finding rallies", done: total, total });
  shuttle.sort((a, b) => a.f - b.f);
  const smooth = smoothTrack(shuttle, 1);
  const hits = detectHits(smooth, cal, meta.fps / settings.stride, players);
  const rallies = segmentRallies(smooth, hits, meta.fps / settings.stride, cal, settings);
  classifyHits(hits, rallies, cal);
  for (const r of rallies) {
    const speeds = r.hits.filter((h) => h.reliable).map((h) => h.speedKmh).filter((v): v is number => v !== null);
    r.maxSpeedKmh = speeds.length ? Math.max(...speeds) : null;
  }
  const score = computeScore(rallies, settings);
  const stats = computeStats(rallies, hits, players, meta.fps / settings.stride);
  return {
    version: 1,
    video: meta,
    calibration: cal,
    shuttle: smooth,
    players,
    hits,
    rallies,
    score,
    stats,
    engine: {
      shuttle: engineName,
      players: pose && poseHits > 0 ? "mediapipe" : players.length ? "motion" : "none",
      analysisWidth: aw,
      stride: settings.stride,
      ms: Math.round(performance.now() - t0),
      debug: { ...tracker.debug, ...classical.debug },
    },
    settings,
  };
}

/** Recompute score + stats after the user overrides rally winners. */
export function recompute(a: Analysis): Analysis {
  const score = computeScore(a.rallies, a.settings);
  const stats = computeStats(a.rallies, a.hits, a.players, a.video.fps / a.settings.stride);
  return { ...a, score, stats };
}
