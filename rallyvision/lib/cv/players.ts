/**
 * Player detection.
 *  - Primary: MediaPipe Pose Landmarker (self-hosted wasm + model in /public).
 *  - Fallback: coarse motion-blob detection (no ML), one blob per court half.
 */

import type { CourtCalibration, PlayerSample, Pt, Side } from "@/lib/types";
import { sideOfCourtPoint, toCourt } from "@/lib/cv/geometry";
import type { Box } from "@/lib/cv/shuttle";

export type RawPose = { landmarks: Pt[]; conf: number }; // landmarks in analysis px

export interface PoseDetector {
  detect(source: HTMLCanvasElement | ImageData, tsMs: number): RawPose[];
  close(): void;
  readonly delegate: string;
}

let cachedPose: Promise<PoseDetector | null> | null = null;

export function createPoseDetector(numPoses: number): Promise<PoseDetector | null> {
  if (cachedPose) return cachedPose;
  cachedPose = (async () => {
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const make = (delegate: "GPU" | "CPU") =>
        vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/models/pose_landmarker_lite.task", delegate },
          runningMode: "VIDEO",
          numPoses,
          minPoseDetectionConfidence: 0.45,
          minPosePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
          outputSegmentationMasks: false,
        });
      let landmarker: Awaited<ReturnType<typeof make>>;
      let delegate = "GPU";
      try {
        landmarker = await make("GPU");
      } catch {
        landmarker = await make("CPU");
        delegate = "CPU";
      }
      let lastTs = -1;
      const det: PoseDetector = {
        delegate,
        detect(source, tsMs) {
          // MediaPipe VIDEO mode requires strictly increasing timestamps.
          const ts = tsMs <= lastTs ? lastTs + 1 : tsMs;
          lastTs = ts;
          const res = landmarker.detectForVideo(source as HTMLCanvasElement, ts);
          const w = source.width, h = source.height;
          const out: RawPose[] = [];
          for (const lm of res.landmarks) {
            let vis = 0;
            const pts: Pt[] = lm.map((p) => {
              vis += p.visibility ?? 0.5;
              return { x: p.x * w, y: p.y * h };
            });
            out.push({ landmarks: pts, conf: vis / Math.max(1, lm.length) });
          }
          return out;
        },
        close() {
          landmarker.close();
        },
      };
      return det;
    } catch (e) {
      console.warn("[rallyvision] MediaPipe pose unavailable, using motion fallback:", e);
      return null;
    }
  })();
  return cachedPose;
}

/** Motion-blob player detector on a coarse grid. */
export class MotionPlayerDetector {
  readonly cell: number;
  readonly gw: number;
  readonly gh: number;
  private energy: Float32Array;
  private labels: Int32Array;
  constructor(readonly width: number, readonly height: number) {
    this.cell = Math.max(8, Math.round(width / 40));
    this.gw = Math.ceil(width / this.cell);
    this.gh = Math.ceil(height / this.cell);
    this.energy = new Float32Array(this.gw * this.gh);
    this.labels = new Int32Array(this.gw * this.gh);
  }

  /**
   * @param mask motion mask at analysis res (1 = moving)
   * @param ignore spots to ignore (the tracked shuttle), so its trail is not mistaken for a person
   */
  detect(mask: Uint8Array, ignore: Pt[] = []): Box[] {
    const { cell, gw, gh, width: w, height: h } = this;
    const frac = new Float32Array(gw * gh);
    for (let y = 0; y < h; y++) {
      const gy = (y / cell) | 0;
      for (let x = 0; x < w; x++) if (mask[y * w + x]) frac[gy * gw + ((x / cell) | 0)]++;
    }
    const ir = Math.max(2, Math.round(w / 45));
    for (const p of ignore) {
      for (let gy = Math.max(0, ((p.y - ir) / cell) | 0); gy <= Math.min(gh - 1, ((p.y + ir) / cell) | 0); gy++)
        for (let gx = Math.max(0, ((p.x - ir) / cell) | 0); gx <= Math.min(gw - 1, ((p.x + ir) / cell) | 0); gx++) frac[gy * gw + gx] = 0;
    }
    for (let i = 0; i < frac.length; i++) {
      frac[i] /= cell * cell;
      this.energy[i] = this.energy[i] * 0.8 + frac[i] * 0.2;
    }
    const active = new Uint8Array(gw * gh);
    for (let i = 0; i < active.length; i++) active[i] = this.energy[i] > 0.035 ? 1 : 0;
    // dilate once so limbs connect to torso
    const dil = new Uint8Array(active);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      if (!active[gy * gw + gx]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = gx + dx, yy = gy + dy;
        if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) dil[yy * gw + xx] = 1;
      }
    }
    this.labels.fill(0);
    const boxes: Array<Box & { cells: number }> = [];
    let label = 0;
    const stack: number[] = [];
    for (let i = 0; i < dil.length; i++) {
      if (!dil[i] || this.labels[i]) continue;
      label++;
      stack.push(i);
      this.labels[i] = label;
      let minx = gw, maxx = 0, miny = gh, maxy = 0, cells = 0;
      while (stack.length) {
        const j = stack.pop()!;
        const gy = (j / gw) | 0, gx = j - gy * gw;
        cells += active[j];
        if (gx < minx) minx = gx; if (gx > maxx) maxx = gx; if (gy < miny) miny = gy; if (gy > maxy) maxy = gy;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = gx + dx, yy = gy + dy;
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          const k = yy * gw + xx;
          if (dil[k] && !this.labels[k]) { this.labels[k] = label; stack.push(k); }
        }
      }
      const bw = maxx - minx + 1, bh = maxy - miny + 1;
      // person-shaped: at least 2 cells wide, 3 tall, 6 active cells, and reasonably filled (a shuttle trail is a thin line)
      if (cells < 3 || bh < 2 || cells / (bw * bh) < 0.25) continue;
      boxes.push({ x: minx * cell, y: miny * cell, w: bw * cell, h: bh * cell, cells });
    }
    boxes.sort((a, b) => b.cells - a.cells);
    return boxes.slice(0, 6);
  }
}

export type PlayerFrameResult = { players: PlayerSample[]; exclude: Box[] };

/** Shared bookkeeping: assigns detections to sides/ids using the court homography. */
export class PlayerAssigner {
  constructor(private cal: CourtCalibration, private perSide: number, private scale: number) {}

  fromPoses(f: number, t: number, poses: RawPose[]): PlayerFrameResult {
    const s = this.scale;
    const dets = poses.map((p) => {
      const lm = p.landmarks;
      const xs = lm.map((q) => q.x), ys = lm.map((q) => q.y);
      const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
      const la = lm[27], ra = lm[28];
      const feetA = la && ra ? { x: (la.x + ra.x) / 2, y: Math.max(la.y, ra.y) } : { x: (minx + maxx) / 2, y: maxy };
      const feet = { x: feetA.x * s, y: feetA.y * s };
      const box = { x: minx * s, y: miny * s, w: (maxx - minx) * s, h: (maxy - miny) * s };
      const landmarks = lm.map((q) => ({ x: q.x * s, y: q.y * s }));
      // whole-body exclusion zone (+12%): limbs and rackets are the main source of false shuttle blobs.
      // The tracker coasts through the few frames the shuttle spends inside it around a hit.
      const mx = (maxx - minx) * 0.12, my = (maxy - miny) * 0.12;
      const excl: Box = { x: minx - mx, y: miny - my, w: maxx - minx + 2 * mx, h: maxy - miny + 2 * my };
      return { feet, box, landmarks, conf: p.conf, excl };
    });
    return this.assign(f, t, dets);
  }

  fromBoxes(f: number, t: number, boxes: Box[]): PlayerFrameResult {
    const s = this.scale;
    const dets = boxes.map((b) => ({
      feet: { x: (b.x + b.w / 2) * s, y: (b.y + b.h) * s },
      box: { x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s },
      landmarks: undefined as Pt[] | undefined,
      conf: 0.5,
      excl: { x: b.x - b.w * 0.1, y: b.y - b.h * 0.1, w: b.w * 1.2, h: b.h * 1.2 } as Box,
    }));
    return this.assign(f, t, dets);
  }

  private assign(f: number, t: number, dets: Array<{ feet: Pt; box: Box; landmarks?: Pt[]; conf: number; excl: Box }>): PlayerFrameResult {
    const bySide: Record<Side, typeof dets> = { near: [], far: [] };
    for (const d of dets) {
      const c = toCourt(this.cal, d.feet);
      // ignore detections far outside the court (spectators)
      if (c.x < -3 || c.x > 9.1 || c.y < -4 || c.y > 17.4) continue;
      bySide[sideOfCourtPoint(c)].push(d);
    }
    const players: PlayerSample[] = [];
    const exclude: Box[] = [];
    (["near", "far"] as Side[]).forEach((side, si) => {
      const list = bySide[side].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h).slice(0, this.perSide);
      list.sort((a, b) => a.feet.x - b.feet.x);
      list.forEach((d, i) => {
        const court = toCourt(this.cal, d.feet);
        players.push({ f, t, id: si * this.perSide + i, side, box: d.box, feet: d.feet, court, landmarks: d.landmarks, conf: d.conf });
        exclude.push(d.excl);
      });
    });
    return { players, exclude };
  }
}
