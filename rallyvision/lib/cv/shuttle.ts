/**
 * Classical shuttlecock detector + tracker (no neural network needed).
 *
 * Idea: the shuttle is the only small, fast, high-contrast object whose
 * motion is consistent frame to frame. We take a 3-frame difference
 * (min(|g_t - g_{t-1}|, |g_t - g_{t-2}|)) which isolates the object at its
 * CURRENT position only, label connected blobs, keep the small ones, and let
 * an alpha-beta tracker with a constant-velocity(+gravity) model pick the
 * blob that continues the trajectory. Abrupt reversals (hits) are handled by a
 * second, wider search around the last known position.
 *
 * This is the "built-in" engine. A TrackNetV3 ONNX engine plugs into the same
 * `ShuttleEngine` interface (see tracknet.ts).
 */

import type { Pt, ShuttleSample } from "@/lib/types";

export type Box = { x: number; y: number; w: number; h: number };

export type Candidate = { x: number; y: number; area: number; contrast: number; score: number; w: number; h: number };

export interface ShuttleEngine {
  readonly name: "classical" | "tracknet" | "cloud";
  /** Feed one analysis-resolution frame; returns candidate detections in analysis px. */
  detect(frame: { gray: Uint8Array; image: ImageData; width: number; height: number }, exclude: Box[]): Promise<Candidate[]> | Candidate[];
}

export class ClassicalShuttleDetector implements ShuttleEngine {
  readonly name = "classical" as const;
  private p1: Uint8Array | null = null;
  private p2: Uint8Array | null = null;
  private mask: Uint8Array;
  private labels: Int32Array;
  private stack: Int32Array;
  readonly threshold: number;
  readonly minArea: number;
  readonly maxArea: number;
  readonly maxDim: number;
  readonly debug: Record<string, number> = { blobs: 0, excluded: 0, kept: 0 };

  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number, opts: { threshold?: number } = {}) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.mask = new Uint8Array(n);
    this.labels = new Int32Array(n);
    this.stack = new Int32Array(n);
    this.threshold = opts.threshold ?? 22;
    const s = width / 640;
    this.minArea = Math.max(2, Math.round(2 * s * s));
    this.maxArea = Math.round(260 * s * s);
    this.maxDim = Math.round(34 * s);
  }

  detect(frame: { gray: Uint8Array }, exclude: Box[]): Candidate[] {
    const g = frame.gray;
    const { width: w, height: h, mask, labels } = this;
    const n = w * h;
    const out: Candidate[] = [];
    if (!this.p1 || !this.p2) {
      this.p2 = this.p1;
      this.p1 = g;
      return out;
    }
    const p1 = this.p1, p2 = this.p2, thr = this.threshold;
    for (let i = 0; i < n; i++) {
      const a = g[i] - p1[i];
      const b = g[i] - p2[i];
      const da = a < 0 ? -a : a;
      const db = b < 0 ? -b : b;
      mask[i] = (da < db ? da : db) > thr ? 1 : 0;
    }
    // border cleanup (ignore 2px frame edge to avoid letterbox flicker)
    for (let x = 0; x < w; x++) { mask[x] = 0; mask[x + w] = 0; mask[(h - 1) * w + x] = 0; mask[(h - 2) * w + x] = 0; }
    for (let y = 0; y < h; y++) { mask[y * w] = 0; mask[y * w + 1] = 0; mask[y * w + w - 1] = 0; mask[y * w + w - 2] = 0; }

    labels.fill(0);
    let label = 0;
    const stack = this.stack;
    const big: Array<{ minx: number; maxx: number; miny: number; maxy: number }> = [];
    const small: Array<{ x: number; y: number; area: number; contrast: number; w: number; h: number; fill: number }> = [];
    for (let i = 0; i < n; i++) {
      if (mask[i] !== 1 || labels[i] !== 0) continue;
      label++;
      let sp = 0;
      stack[sp++] = i;
      labels[i] = label;
      let area = 0, sx = 0, sy = 0, sg = 0, sb = 0;
      let minx = w, maxx = 0, miny = h, maxy = 0;
      while (sp > 0) {
        const j = stack[--sp];
        const y = (j / w) | 0, x = j - y * w;
        area++; sx += x; sy += y; sg += g[j]; sb += p1[j];
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (area > this.maxArea * 4) { /* runaway blob (player); keep labelling but stop measuring */ }
        // 8-connectivity
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const k = yy * w + xx;
            if (mask[k] === 1 && labels[k] === 0) { labels[k] = label; stack[sp++] = k; }
          }
        }
      }
      const bw = maxx - minx + 1, bh = maxy - miny + 1;
      if (area < this.minArea) continue;
      if (area > this.maxArea || bw > this.maxDim || bh > this.maxDim) {
        big.push({ minx, maxx, miny, maxy }); // moving body part / racket: used as clutter context
        continue;
      }
      this.debug.blobs++;
      const cx = sx / area, cy = sy / area;
      let excluded = false;
      for (const b of exclude) {
        if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) { excluded = true; break; }
      }
      if (excluded) { this.debug.excluded++; continue; }
      this.debug.kept++;
      small.push({ x: cx, y: cy, area, contrast: (sg - sb) / area, w: bw, h: bh, fill: area / (bw * bh) });
    }
    // Score: the shuttle is bright (positive contrast = brighter than the background it uncovered),
    // compact, small, and ISOLATED — limbs/rackets come as clusters next to large moving blobs.
    const s = this.width / 640;
    const pad = 8 * s, nearR = 22 * s;
    for (const c of small) {
      let clutter = 0;
      for (const b of big) {
        if (c.x >= b.minx - pad && c.x <= b.maxx + pad && c.y >= b.miny - pad && c.y <= b.maxy + pad) { clutter += 3; break; }
      }
      for (const o of small) if (o !== c && Math.abs(o.x - c.x) < nearR && Math.abs(o.y - c.y) < nearR) clutter++;
      const sizePrior = 1 - Math.min(1, c.area / this.maxArea);
      let score = Math.min(1, Math.abs(c.contrast) / 90) * 0.45 + (c.contrast > 0 ? 0.2 : -0.1) + c.fill * 0.15 + sizePrior * 0.2;
      score -= 0.12 * Math.min(3, clutter);
      out.push({ x: c.x, y: c.y, area: c.area, contrast: c.contrast, score: Math.max(0, score), w: c.w, h: c.h });
    }
    this.p2 = p1;
    this.p1 = g;
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 48);
  }

  /** Expose the latest motion mask (analysis res) for the motion-based player fallback. */
  get motionMask(): Uint8Array {
    return this.mask;
  }
}

/**
 * Multi-hypothesis alpha-beta tracker.
 *
 * Several tracks live at once (the shuttle plus whatever limbs/rackets look
 * shuttle-like for a moment). Each track must prove itself by travelling
 * `confirmDist` within `confirmWindow` frames; confirmed tracks are ranked by
 * how far they moved recently and only the best one ("primary") is emitted.
 * A confirmed track that stops going anywhere (jitter in place) is killed and
 * its recent samples retracted. This keeps a false track from ever blocking
 * the real shuttle, which a single-target tracker cannot guarantee.
 */
class Track {
  pos: Pt;
  vel: Pt;
  misses = 0;
  confirmed = false;
  readonly startPos: Pt;
  readonly startF: number;
  /** all samples of this track in order */
  samples: ShuttleSample[] = [];
  /** coasted samples waiting for the track to survive the gap */
  pending: ShuttleSample[] = [];
  emitted = 0;
  readonly id: number;
  constructor(id: number, init: ShuttleSample[], vel: Pt) {
    this.id = id;
    this.samples = init.map((s) => ({ ...s, tid: id }));
    this.pos = { x: init[init.length - 1].x, y: init[init.length - 1].y };
    this.startPos = { x: init[0].x, y: init[0].y };
    this.startF = init[init.length - 1].f;
    this.vel = vel;
  }
  get last(): ShuttleSample { return this.samples[this.samples.length - 1]; }
  /** net displacement (via `travel`) over the last n samples, weighted by how shuttle-like the detections were */
  quality(travel: (a: Pt, b: Pt) => number, n = 10): number {
    const i0 = Math.max(0, this.samples.length - n);
    const a = this.samples[i0], b = this.last;
    let conf = 0, k = 0;
    for (let i = i0; i < this.samples.length; i++) if (!this.samples[i].interp) { conf += this.samples[i].conf; k++; }
    const meanConf = k ? conf / k : 0.3;
    return travel(a, b) * this.straightness(travel, n) * (0.3 + meanConf);
  }
  meanConf(n = 10): number {
    let conf = 0, k = 0;
    for (let i = Math.max(0, this.samples.length - n); i < this.samples.length; i++) if (!this.samples[i].interp) { conf += this.samples[i].conf; k++; }
    return k ? conf / k : 0;
  }
  /** net / path length over the last n samples: ~1 for a flying shuttle, low for a swinging limb */
  straightness(travel: (a: Pt, b: Pt) => number, n: number): number {
    const i0 = Math.max(0, this.samples.length - n);
    let path = 0;
    for (let i = i0 + 1; i < this.samples.length; i++) path += travel(this.samples[i - 1], this.samples[i]);
    if (path < 1e-6) return 0;
    return Math.min(1, travel(this.samples[i0], this.last) / path);
  }
}

export type TrackerStep = { samples: ShuttleSample[]; retract: { tid: number; n: number } | null };

export class ShuttleTracker {
  private tracks: Track[] = [];
  private nextId = 1;
  private primary: Track | null = null;
  private lastF = -1;
  private lastEmittedF = -1;
  private pool: Array<{ f: number; t: number; cands: Candidate[] }> = [];
  private suppress: Array<{ x: number; y: number; r: number; until: number }> = [];
  readonly debug: Record<string, number> = { init: 0, confirmed: 0, killSlow: 0, killOscillation: 0, killLost: 0, killUnconfirmed: 0, suppressed: 0, switches: 0 };
  /** optional event log for offline debugging */
  log: string[] | null = null;
  readonly s: number;
  readonly maxMisses: number;
  readonly maxTracks = 5;
  readonly minInitSpeed: number;
  readonly maxSpeed: number;
  /** a new track must move `confirmTravel` within confirmWindow frames or it is dropped */
  readonly confirmWindow = 14;
  /** a confirmed track whose last `oscWindow` positions fit in a box smaller than oscTravel is jitter, not a shuttle */
  readonly oscWindow = 30;
  /** tracks shorter than this (samples) that die are treated as noise and retracted */
  readonly minTrackLen = 15;

  /** analysis px -> court metres (ground plane). When provided, travel thresholds are metric, so the
   *  compressed far court is judged fairly. */
  private toCourt: ((p: Pt) => Pt) | null;

  readonly width: number;
  constructor(width: number, opts: { maxMisses?: number; toCourt?: (p: Pt) => Pt } = {}) {
    this.width = width;
    this.s = width / 640;
    this.toCourt = opts.toCourt ?? null;
    this.maxMisses = opts.maxMisses ?? 7;
    this.minInitSpeed = 1.6 * this.s;
    this.maxSpeed = 90 * this.s;
  }

  get tracking(): boolean {
    return this.primary !== null;
  }

  /** distance between two analysis-px points: metres when calibrated, else px scaled to 640p */
  private travel(a: Pt, b: Pt): number {
    if (this.toCourt) {
      const ca = this.toCourt(a), cb = this.toCourt(b);
      // clamp absurd projections (points far above the horizon)
      return Math.min(40, Math.hypot(cb.x - ca.x, cb.y - ca.y));
    }
    return Math.hypot(b.x - a.x, b.y - a.y) / this.s;
  }
  /** thresholds in the unit `travel` returns */
  private get confirmTravel(): number { return this.toCourt ? 1.5 : 45; }
  private get oscTravel(): number { return this.toCourt ? 2.2 : 70; }
  private get minPrimaryTravel(): number { return this.toCourt ? 0.8 : 22; }
  private get minInitTravel(): number { return this.toCourt ? 0.06 : 1.6; } // per frame

  private pendingRetract: TrackerStep["retract"] = null;

  step(f: number, t: number, candsIn: Candidate[]): TrackerStep {
    const out: ShuttleSample[] = [];
    this.pendingRetract = null;
    const dtF = this.lastF < 0 ? 1 : Math.max(1, f - this.lastF);
    this.suppress = this.suppress.filter((z) => z.until > f);
    const cands = this.suppress.length ? candsIn.filter((c) => !this.suppress.some((z) => Math.hypot(c.x - z.x, c.y - z.y) < z.r)) : candsIn;
    this.debug.suppressed += candsIn.length - cands.length;
    const used = new Set<Candidate>();

    // --- associate: confirmed tracks first, best quality first
    const q = (tr: Track) => tr.quality(this.travel.bind(this));
    const order = [...this.tracks].sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || q(b) - q(a));
    for (const tr of order) {
      const pred = { x: tr.pos.x + tr.vel.x * dtF, y: tr.pos.y + tr.vel.y * dtF };
      const speed = Math.hypot(tr.vel.x, tr.vel.y);
      const gate = Math.min(70 * this.s, Math.max(10 * this.s, 2.2 * speed * dtF));
      let best: Candidate | null = null, bestCost = Infinity;
      for (const c of cands) {
        if (used.has(c)) continue;
        const d = Math.hypot(c.x - pred.x, c.y - pred.y);
        if (d > gate) continue;
        const cost = d / gate - 0.6 * c.score;
        if (cost < bestCost) { bestCost = cost; best = c; }
      }
      let reversal = false;
      if (!best) {
        // hit / reversal: search around the last position instead of the prediction
        const gate2 = Math.min(90 * this.s, Math.max(16 * this.s, 2.5 * speed * dtF));
        for (const c of cands) {
          if (used.has(c)) continue;
          const d = Math.hypot(c.x - tr.pos.x, c.y - tr.pos.y);
          if (d > gate2 || d < 1.0 * this.s) continue;
          const cost = d / gate2 - 0.8 * c.score;
          if (cost < bestCost) { bestCost = cost; best = c; }
        }
        reversal = !!best;
      }
      if (best) {
        used.add(best);
        const meas = { x: best.x, y: best.y };
        const vMeas = { x: (meas.x - tr.pos.x) / dtF, y: (meas.y - tr.pos.y) / dtF };
        tr.vel = reversal ? vMeas : { x: 0.55 * tr.vel.x + 0.45 * vMeas.x, y: 0.55 * tr.vel.y + 0.45 * vMeas.y };
        tr.pos = reversal ? meas : { x: 0.2 * pred.x + 0.8 * meas.x, y: 0.2 * pred.y + 0.8 * meas.y };
        tr.misses = 0;
        tr.samples.push(...tr.pending, { f, t, x: tr.pos.x, y: tr.pos.y, conf: best.score, interp: false, tid: tr.id });
        tr.pending = [];
        if (!tr.confirmed) {
          if (this.travel(tr.startPos, tr.pos) >= this.confirmTravel && tr.straightness(this.travel.bind(this), 99) >= 0.6) {
            tr.confirmed = true;
            this.debug.confirmed++;
            this.log?.push(`confirm#${tr.id}@${f}`);
          } else if (f - tr.startF > this.confirmWindow) {
            this.kill(tr, f, "slow");
          }
        } else if (tr.samples.length >= this.oscWindow) {
          let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
          for (let i = tr.samples.length - this.oscWindow; i < tr.samples.length; i++) {
            const p = tr.samples[i];
            if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
          }
          if (this.travel({ x: minx, y: miny }, { x: maxx, y: maxy }) < this.oscTravel) {
            // jitter in place (arm, racket, head)
            this.suppress.push({ x: (minx + maxx) / 2, y: (miny + maxy) / 2, r: 36 * this.s, until: f + 45 });
            this.kill(tr, f, "oscillation");
          }
        }
      } else {
        tr.misses++;
        if (tr.misses > this.maxMisses) {
          this.kill(tr, f, tr.confirmed ? "lost" : "unconfirmed");
        } else {
          tr.pos = pred;
          tr.vel = { x: tr.vel.x * 0.985, y: tr.vel.y * 0.985 + 0.12 * this.s * dtF };
          tr.pending.push({ f, t, x: pred.x, y: pred.y, conf: 0.2, interp: true, tid: tr.id });
        }
      }
    }

    // --- initiate new tracks from unused candidates
    if (this.tracks.length < this.maxTracks) {
      const free = cands.filter((c) => !used.has(c));
      const init = this.tryInitiate(f, t, free, dtF);
      if (init) {
        const tr = new Track(this.nextId++, init.samples, init.vel);
        this.tracks.push(tr);
        this.debug.init++;
        this.log?.push(`init#${tr.id}@${f} at ${tr.pos.x.toFixed(0)},${tr.pos.y.toFixed(0)} v=${init.vel.x.toFixed(1)},${init.vel.y.toFixed(1)}`);
        used.add(init.c2);
      }
    }
    this.pool.push({ f, t, cands: cands.filter((c) => !used.has(c)) });
    if (this.pool.length > 3) this.pool.shift();

    // --- choose primary (best confirmed track, with hysteresis) and emit its new samples
    const confirmed = this.tracks.filter((tr) => tr.confirmed);
    let primary: Track | null = null;
    for (const tr of confirmed) if (!primary || q(tr) > q(primary)) primary = tr;
    if (primary && (q(primary) < this.minPrimaryTravel || primary.meanConf() < 0.4)) primary = null;
    if (this.primary && this.tracks.includes(this.primary) && this.primary.confirmed && primary && primary !== this.primary && q(primary) < q(this.primary) * 1.3) primary = this.primary;
    if (primary !== this.primary) {
      if (this.primary && primary) this.debug.switches++;
      this.primary = primary;
      if (primary) this.log?.push(`primary#${primary.id}@${f} q=${q(primary).toFixed(1)}`);
    }
    if (this.primary) {
      const tr = this.primary;
      for (let i = tr.emitted; i < tr.samples.length; i++) {
        if (tr.samples[i].f > this.lastEmittedF) { out.push(tr.samples[i]); this.lastEmittedF = tr.samples[i].f; }
      }
      tr.emitted = tr.samples.length;
    }
    this.lastF = f;
    return { samples: out, retract: this.pendingRetract };
  }

  private kill(tr: Track, f: number, reason: "slow" | "oscillation" | "lost" | "unconfirmed") {
    this.debug["kill" + reason[0].toUpperCase() + reason.slice(1)]++;
    // Retract emitted samples that we now know were not the shuttle: the jittering tail of an
    // oscillating track, or everything from a track that died young.
    if (tr.emitted > 0) {
      const n = reason === "oscillation" ? Math.min(tr.emitted, this.oscWindow) : tr.samples.length < this.minTrackLen ? tr.emitted : 0;
      if (n > 0) this.pendingRetract = { tid: tr.id, n: (this.pendingRetract?.tid === tr.id ? this.pendingRetract.n : 0) + n };
    }
    this.log?.push(`kill#${tr.id}:${reason}@${f} start=${tr.startPos.x.toFixed(0)},${tr.startPos.y.toFixed(0)} pos=${tr.pos.x.toFixed(0)},${tr.pos.y.toFixed(0)} len=${tr.samples.length}`);
    this.tracks = this.tracks.filter((x) => x !== tr);
    if (this.primary === tr) this.primary = null;
  }

  private tryInitiate(f: number, t: number, cands: Candidate[], dtF: number): { samples: ShuttleSample[]; vel: Pt; c2: Candidate } | null {
    if (this.pool.length < 2) return null;
    const a = this.pool[this.pool.length - 2], b = this.pool[this.pool.length - 1];
    if (f - b.f > 2 * dtF + 1 || b.f - a.f > 2 * dtF + 1) return null;
    let best: { c0: Candidate; c1: Candidate; c2: Candidate; v: Pt; q: number } | null = null;
    const d1 = Math.max(1, b.f - a.f), d2 = Math.max(1, f - b.f);
    const minScore = 0.3; // weak, cluttered blobs never start a track
    for (const c2 of cands.slice(0, 24)) {
      if (c2.score < minScore) continue;
      for (const c1 of b.cands.slice(0, 24)) {
        if (c1.score < minScore) continue;
        const v2 = { x: (c2.x - c1.x) / d2, y: (c2.y - c1.y) / d2 };
        const s2 = Math.hypot(v2.x, v2.y);
        if (s2 < 0.7 * this.s || s2 > this.maxSpeed) continue;
        if (this.travel(c1, c2) / d2 < this.minInitTravel) continue;
        for (const c0 of a.cands.slice(0, 24)) {
          if (c0.score < minScore) continue;
          const v1 = { x: (c1.x - c0.x) / d1, y: (c1.y - c0.y) / d1 };
          const s1 = Math.hypot(v1.x, v1.y);
          if (s1 < 0.7 * this.s || s1 > this.maxSpeed) continue;
          if (this.travel(c0, c1) / d1 < this.minInitTravel) continue;
          const dv = Math.hypot(v2.x - v1.x, v2.y - v1.y);
          const tol = 0.45 * Math.max(s1, s2) + 3 * this.s;
          if (dv > tol) continue;
          const q = (1 - dv / tol) * 0.5 + (c0.score + c1.score + c2.score) / 6;
          if (!best || q > best.q) best = { c0, c1, c2, v: v2, q };
        }
      }
    }
    if (!best) return null;
    const mk = (c: Candidate, ff: number, tt: number): ShuttleSample => ({ f: ff, t: tt, x: c.x, y: c.y, conf: c.score, interp: false });
    return { samples: [mk(best.c0, a.f, a.t), mk(best.c1, b.f, b.t), mk(best.c2, f, t)], vel: best.v, c2: best.c2 };
  }
}
