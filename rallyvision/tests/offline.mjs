/**
 * Offline tracker benchmark: decodes the synthetic clip with ffmpeg, runs the
 * classical detector + tracker + player detector + event logic in Node (no
 * browser), and scores against ground truth. Fast iteration loop for tuning.
 *
 *   node --import ./tests/register.mjs tests/offline.mjs [video] [truth.json]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { ClassicalShuttleDetector, ShuttleTracker } from "@/lib/cv/shuttle";
import { MotionPlayerDetector, PlayerAssigner } from "@/lib/cv/players";
import { buildCalibration, toCourt } from "@/lib/cv/geometry";
import { classifyHits, computeScore, computeStats, detectHits, segmentRallies, smoothTrack } from "@/lib/cv/events";
import { DEFAULT_SETTINGS } from "@/lib/types";

const video = process.argv[2] || "public/sample/synthetic-rally.mp4";
const truth = JSON.parse(fs.readFileSync(process.argv[3] || video.replace(/\.mp4$/, ".truth.json"), "utf8"));
const AW = parseInt(process.env.AW || "640");
const AH = Math.round((truth.height * AW) / truth.width);
const fps = truth.fps;

const t0 = Date.now();
const ff = spawnSync("ffmpeg", ["-loglevel", "error", "-i", video, "-vf", `scale=${AW}:${AH}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 30 });
if (ff.status !== 0) throw new Error(ff.stderr.toString());
const raw = ff.stdout;
const frames = Math.floor(raw.length / (AW * AH));
console.log(`decoded ${frames} frames at ${AW}x${AH} in ${Date.now() - t0}ms`);

const scale = truth.width / AW;
const cal = buildCalibration(truth.corners.map(([x, y]) => ({ x, y })), "singles", "manual");
const det = new ClassicalShuttleDetector(AW, AH);
const tracker = new ShuttleTracker(AW, { toCourt: (p) => toCourt(cal, { x: p.x * scale, y: p.y * scale }) });
if (process.env.LOG) tracker.log = [];
const DEBUGF = process.env.DEBUGF ? process.env.DEBUGF.split(",").map(Number) : [];
const motion = new MotionPlayerDetector(AW, AH);
const assigner = new PlayerAssigner(cal, 1, scale);
const shuttle = [], players = [];
let exclude = [];
const t1 = Date.now();
for (let f = 0; f < frames; f++) {
  const gray = raw.subarray(f * AW * AH, (f + 1) * AW * AH);
  const cands = det.detect({ gray }, exclude);
  if (DEBUGF.includes(f)) console.log(`frame ${f} truth=${JSON.stringify(truth.shuttle[f])} exclude=${JSON.stringify(exclude.map((b) => [b.x | 0, b.y | 0, b.w | 0, b.h | 0]))} cands=`, cands.slice(0, 12).map((c) => `${(c.x * scale).toFixed(0)},${(c.y * scale).toFixed(0)} a=${c.area} k=${c.contrast.toFixed(0)} s=${c.score.toFixed(2)}`));
  if (f % 2 === 0) {
    const recent = shuttle.slice(-3).map((s) => ({ x: s.x / scale, y: s.y / scale }));
    const boxes = motion.detect(det.motionMask, recent);
    if (boxes.length) { const r = assigner.fromBoxes(f, f / fps, boxes); players.push(...r.players); exclude = r.exclude; }
  }
  const tr = tracker.step(f, f / fps, cands);
  if (tr.retract) { let n = tr.retract.n; for (let k = shuttle.length - 1; k >= 0 && n > 0; k--) if (shuttle[k].tid === tr.retract.tid) { shuttle.splice(k, 1); n--; } }
  for (const s of tr.samples) shuttle.push({ ...s, x: s.x * scale, y: s.y * scale });
}
if (tracker.log) console.log(tracker.log.join("\n"));
console.log(`tracked in ${Date.now() - t1}ms (${((Date.now() - t1) / frames).toFixed(1)} ms/frame)`, tracker.debug, det.debug);
shuttle.sort((a, b) => a.f - b.f);
const smooth = smoothTrack(shuttle, 1);
const hits = detectHits(smooth, cal, fps, players);
const rallies = segmentRallies(smooth, hits, fps, cal, DEFAULT_SETTINGS);
classifyHits(hits, rallies, cal);
const score = computeScore(rallies, DEFAULT_SETTINGS);
const stats = computeStats(rallies, hits, players, fps);

// --- scoring vs truth
const byF = new Map(shuttle.map((s) => [s.f, s]));
let visible = 0, hitF = 0, errSum = 0, falseF = 0, interpOk = 0;
for (let f = 0; f < frames; f++) {
  const tr = truth.shuttle[f];
  const s = byF.get(f);
  if (tr) {
    visible++;
    if (s) { const e = Math.hypot(s.x - tr[0], s.y - tr[1]); if (e < 25) { hitF++; errSum += e; if (s.interp) interpOk++; } else falseF++; }
  } else if (s) falseF++;
}
console.log(`shuttle: recall ${(100 * hitF / visible).toFixed(1)}% of ${visible} visible frames, mean err ${(errSum / Math.max(1, hitF)).toFixed(1)}px, false/misplaced samples ${falseF}, interp ${interpOk}`);
for (const r of truth.rallies) {
  let vis = 0, got = 0;
  for (let f = Math.floor(r.start * fps); f < Math.min(frames, Math.ceil(r.end * fps)); f++) { if (truth.shuttle[f]) { vis++; const s = byF.get(f); if (s && Math.hypot(s.x - truth.shuttle[f][0], s.y - truth.shuttle[f][1]) < 25) got++; } }
  console.log(`  truth rally ${r.start.toFixed(1)}-${r.end.toFixed(1)}: recall ${(100 * got / Math.max(1, vis)).toFixed(0)}% (${got}/${vis})`);
}
const truthShots = truth.rallies.reduce((a, r) => a + r.shots, 0);
console.log(`rallies: got ${rallies.length} vs ${truth.rallies.length}; hits ${hits.length} vs ${truthShots}; players ${players.length} samples`);
for (const r of rallies) console.log(`  rally ${r.id + 1}: ${r.startT.toFixed(1)}-${r.endT.toFixed(1)}s shots=${r.hits.length} win=${r.winner} max=${r.maxSpeedKmh} (${r.winnerReason})`);
for (const r of truth.rallies) console.log(`  truth : ${r.start.toFixed(1)}-${r.end.toFixed(1)}s shots=${r.shots} win=${r.winner_by_rule}`);
// hit timing match
let hitMatch = 0;
for (const th of truth.hits) if (hits.some((h) => Math.abs(h.t - th.t) < 0.25)) hitMatch++;
console.log(`hits matched within 0.25s: ${hitMatch}/${truth.hits.length}; speeds: ${hits.map((h) => h.speedKmh).join(",")}`);
console.log("score", score.map((s) => `${s.near}-${s.far}`).join(" "), "stats top", stats.topSpeedKmh, "dist", stats.playerDistanceM);
if (process.env.DUMP) fs.writeFileSync("tests/out/offline.json", JSON.stringify({ shuttle, hits, rallies }, null, 0));
if (process.env.FALSE) {
  const rows = [];
  for (let f = 0; f < frames; f++) { const s = byF.get(f); if (s && !truth.shuttle[f]) rows.push(`${f}:${s.x.toFixed(0)},${s.y.toFixed(0)} c=${s.conf.toFixed(2)} tid=${s.tid}`); }
  console.log("false samples:", rows.length, "\n" + rows.filter((_, i) => i % 4 === 0).join("  "));
}
