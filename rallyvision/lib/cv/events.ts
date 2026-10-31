/**
 * Post-processing of raw tracks: smoothing, hit detection, speed estimation,
 * rally segmentation, score keeping and aggregate stats.
 */

import { COURT, type AnalysisSettings, type CourtCalibration, type HitEvent, type PlayerSample, type Pt, type Rally, type ScoreEntry, type ShuttleSample, type Side, type Stats } from "@/lib/types";
import { inBounds, sideOfCourtPoint, toCourt } from "@/lib/cv/geometry";

/**
 * Centred moving average within continuous runs. The window shrinks symmetrically near a run's ends, so the first
 * and last samples (serve point, landing) keep their measured position instead of being pulled back along the path.
 */
export function smoothTrack(track: ShuttleSample[], win = 2): ShuttleSample[] {
  const out: ShuttleSample[] = [];
  const near = (i: number, j: number) => j >= 0 && j < track.length && Math.abs(track[j].f - track[i].f) <= win * 2 + 1;
  for (let i = 0; i < track.length; i++) {
    let m = 0;
    while (m < win && near(i, i - m - 1) && near(i, i + m + 1)) m++;
    let sx = 0, sy = 0, n = 0;
    for (let j = i - m; j <= i + m; j++) {
      const w = track[j].interp ? 0.5 : 1;
      sx += track[j].x * w; sy += track[j].y * w; n += w;
    }
    out.push({ ...track[i], x: sx / n, y: sy / n });
  }
  return out;
}

function opposite(s: Side): Side {
  return s === "near" ? "far" : "near";
}

/** Split the track into continuous segments (gap in frames > maxGapF starts a new one). */
export function splitSegments(track: ShuttleSample[], maxGapF: number): ShuttleSample[][] {
  const segs: ShuttleSample[][] = [];
  let cur: ShuttleSample[] = [];
  for (const s of track) {
    if (cur.length && s.f - cur[cur.length - 1].f > maxGapF) { segs.push(cur); cur = []; }
    cur.push(s);
  }
  if (cur.length) segs.push(cur);
  return segs;
}

/** Ground-plane metres per image px (horizontal) at an image point. Over-estimates for an airborne shuttle, which only makes the stillness test below more conservative. */
function metresPerPx(cal: CourtCalibration, p: Pt): number {
  const a = toCourt(cal, p), b = toCourt(cal, { x: p.x + 10, y: p.y });
  return Math.hypot(b.x - a.x, b.y - a.y) / 10;
}

const STILL_WINDOW_S = 1.0;
const STILL_EXTENT_M = 0.75;

/**
 * Drop samples that cannot be a shuttle in play: anything whose image footprint stays inside ~0.75 m for a full
 * second. A shuttle in play never hovers (terminal velocity is ~6.8 m/s, so even a lob apex or a net shot covers
 * metres in that time; the window is a full second because flight along the court axis is heavily foreshortened
 * in the far half). What does hover is a swinging arm or racket the tracker latched onto, or a shuttle lying on
 * the floor after the rally; left in, those bridge the gap between rallies and produce phantom hits.
 */
function inPlay(track: ShuttleSample[], cal: CourtCalibration, fps: number): ShuttleSample[] {
  const dead = new Uint8Array(track.length);
  const maxStepF = 3;
  for (let j = 0; j < track.length; j++) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let k = j;
    for (; k < track.length; k++) {
      if (k > j && track[k].f - track[k - 1].f > maxStepF) break;
      if (track[k].t - track[j].t > STILL_WINDOW_S) break;
      const s = track[k];
      if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x;
      if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y;
    }
    const last = k - 1;
    if (track[last].t - track[j].t < STILL_WINDOW_S - 1.5 / fps) continue;
    const extent = Math.max(maxX - minX, maxY - minY) * metresPerPx(cal, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    if (extent < STILL_EXTENT_M) dead.fill(1, j, last + 1);
  }
  return track.filter((_, i) => !dead[i]);
}

const RALLY_GAP_S = 1.2;
/** Longest a shuttle can plausibly be out of sight mid-rally (a high serve / clear is airborne ~1.5-2 s). */
const FLIGHT_GAP_S = 1.8;
const IN_FLIGHT_MPS = 3;

/** Speed (m/s, image footprint) over the last/first few real samples of a run. */
function endSpeed(seg: ShuttleSample[], cal: CourtCalibration, fromStart: boolean): number {
  const real = seg.filter((s) => !s.interp);
  const pts = fromStart ? real.slice(0, 4) : real.slice(-4);
  if (pts.length < 2) return 0;
  const a = pts[0], b = pts[pts.length - 1];
  const dt = b.t - a.t;
  if (dt <= 0) return 0;
  return (Math.hypot(b.x - a.x, b.y - a.y) * metresPerPx(cal, b)) / dt;
}

/**
 * Split the in-play track into rally candidates. A gap > 1.2 s ends a rally, except a gap of up to 1.8 s with the
 * shuttle clearly in flight on both sides: that is the tracker losing a high shot, not a rally ending (between
 * rallies the shuttle comes down and play stops for several seconds).
 */
function splitRallies(track: ShuttleSample[], cal: CourtCalibration, fps: number): ShuttleSample[][] {
  const runs = splitSegments(track, Math.round(fps * RALLY_GAP_S));
  const out: ShuttleSample[][] = [];
  for (const run of runs) {
    const prev = out[out.length - 1];
    if (prev) {
      const gap = run[0].t - prev[prev.length - 1].t;
      if (gap <= FLIGHT_GAP_S && endSpeed(prev, cal, false) > IN_FLIGHT_MPS && endSpeed(run, cal, true) > IN_FLIGHT_MPS) {
        prev.push(...run);
        continue;
      }
    }
    out.push(run);
  }
  return out;
}

/** Window after a hit used to tell its direction (long enough to get past the apex of a far player's lift). */
const SHOT_DIR_S = 0.6;

/**
 * Who hit it. With the camera behind the near baseline and above contact height, the ground projection of an
 * airborne shuttle always lands farther from the camera than the shuttle itself, never nearer. So a contact that
 * projects onto the near half is certainly the near player's. One that projects onto the far half is either the
 * far player or a high near-side contact; there the net image-y travel over the next ~0.6 s decides (a near
 * player's shot recedes up the image, a far player's comes down it). Ground-projected *velocity* is useless for
 * this: it reverses at the apex of every far-court flight.
 */
function hitterSide(seg: ShuttleSample[], court: Pt[], i: number, cal: CourtCalibration): Side {
  if (court[i].y < COURT.netY) return "near";
  let j = i;
  while (j + 1 < seg.length && seg[j + 1].t - seg[i].t <= SHOT_DIR_S) j++;
  const dy = seg[j].y - seg[i].y;
  const dyM = dy * metresPerPx(cal, seg[i]);
  if (Math.abs(dyM) < 0.3) return "far";
  return dyM < 0 ? "near" : "far";
}

export function detectHits(track: ShuttleSample[], cal: CourtCalibration, fps: number, players: PlayerSample[]): HitEvent[] {
  const hits: HitEvent[] = [];
  const live = inPlay(track, cal, fps);
  const segs = splitSegments(live, Math.round(fps * 0.5));
  const minGapF = Math.max(3, Math.round(fps * 0.22));
  const playersByF = new Map<number, PlayerSample[]>();
  for (const p of players) {
    const arr = playersByF.get(p.f);
    if (arr) arr.push(p); else playersByF.set(p.f, [p]);
  }
  const addHit = (seg: ShuttleSample[], court: Pt[], i: number) => {
    const s = seg[i];
    let by: Side = hitterSide(seg, court, i, cal);
    // snap to the nearest player if one is close
    const ps = playersByF.get(s.f) ?? [];
    let bestD = Infinity, bestSide: Side | null = null;
    for (const p of ps) {
      const d = Math.hypot(p.feet.x - s.x, (p.box.y + p.box.h * 0.4) - s.y);
      if (d < bestD) { bestD = d; bestSide = p.side; }
    }
    if (bestSide && bestD < Math.max(60, (ps[0]?.box.h ?? 0) * 1.2)) by = bestSide;
    const { kmh, px, reliable } = speedAfter(seg, court, i, fps);
    hits.push({ f: s.f, t: s.t, pos: { x: s.x, y: s.y }, by, speedKmh: kmh, speedPx: px, kind: "shot", reliable });
  };
  for (const seg of segs) {
    if (seg.length < 4) continue;
    const court = seg.map((s) => toCourt(cal, s));
    const vimg: Pt[] = seg.map((_, i) => {
      const a = Math.max(0, i - 1), b = Math.min(seg.length - 1, i + 1);
      const dt = (seg[b].t - seg[a].t) || 1 / fps;
      return { x: (seg[b].x - seg[a].x) / dt, y: (seg[b].y - seg[a].y) / dt };
    });
    let lastHitIdx = -Infinity;
    for (let i = 1; i < seg.length - 1; i++) {
      if (i - lastHitIdx < minGapF) continue;
      const a = vimg[i - 1], b = vimg[i + 1];
      // In free flight drag only slows the shuttle and gravity only pulls it down, so its image motion can turn from
      // upward to downward (an apex) but never from downward to upward: that takes a racket.
      const minV = 0.6 / metresPerPx(cal, seg[i]);
      const upturn = a.y > minV && b.y < -minV;
      const sa = Math.hypot(a.x, a.y), sb = Math.hypot(b.x, b.y);
      const cos = sa > 1 && sb > 1 ? (a.x * b.x + a.y * b.y) / (sa * sb) : 1;
      const sharpTurn = cos < 0.25 && Math.min(sa, sb) > 40; // > ~75 deg and moving
      if (upturn || sharpTurn) { addHit(seg, court, i); lastHitIdx = i; }
    }
  }
  // Every rally starts with a serve from the server's position, and the tracker usually picks the shuttle up within
  // a few frames of it, so a rally whose first moments show no hit gets one at its first in-play sample.
  for (const run of splitRallies(live, cal, fps)) {
    if (run[run.length - 1].t - run[0].t < 1.0) continue;
    if (hits.some((h) => h.t >= run[0].t && h.t - run[0].t < 0.3)) continue;
    addHit(run, run.map((s) => toCourt(cal, s)), 0);
  }
  hits.sort((a, b) => a.f - b.f);
  return hits;
}

/** Ground-projection slack beyond the court lines before a sample is taken to be well above the floor. */
const ALOFT_MARGIN_M = 1;

function speedAfter(seg: ShuttleSample[], court: Pt[], i: number, fps: number): { kmh: number | null; px: number; reliable: boolean } {
  // Skip the frame right at the hit (the track often hops from racket to shuttle there) and take the
  // median of the next few frame-to-frame ground-plane speeds; a jumpy window is marked unreliable.
  // The ground-plane projection of a shuttle h metres up is magnified by H/(H-h) (H = camera height), so a rising
  // shot reads several times too fast. A shuttle in play is over the court, so a projection that runs more than a
  // metre past the court lines means it is high in the air and the speed is not trusted.
  const speeds: number[] = [];
  let px = 0, aloft = false;
  for (let j = i + 2; j <= Math.min(seg.length - 1, i + 7); j++) {
    if (seg[j].interp || seg[j - 1].interp) continue;
    const dt = seg[j].t - seg[j - 1].t;
    if (dt <= 0 || dt > 2.5 / fps) continue;
    const m = Math.hypot(court[j].x - court[j - 1].x, court[j].y - court[j - 1].y);
    speeds.push(m / dt);
    px = Math.max(px, Math.hypot(seg[j].x - seg[j - 1].x, seg[j].y - seg[j - 1].y) / dt);
    for (const c of [court[j - 1], court[j]]) {
      if (c.x < -ALOFT_MARGIN_M || c.x > COURT.width + ALOFT_MARGIN_M || c.y < -ALOFT_MARGIN_M || c.y > COURT.length + ALOFT_MARGIN_M) aloft = true;
    }
  }
  if (speeds.length < 1) return { kmh: null, px, reliable: false };
  const sorted = [...speeds].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const jumpy = sorted[sorted.length - 1] > 3 * Math.max(0.5, sorted[0]);
  const kmh = Math.round(med * 3.6);
  return { kmh: Math.min(kmh, 450), px, reliable: speeds.length >= 3 && !jumpy && !aloft && kmh >= 20 && kmh < 420 };
}

export function classifyHits(hits: HitEvent[], rallies: Rally[], cal: CourtCalibration): void {
  const firstHitF = new Set(rallies.map((r) => r.hits[0]?.f));
  for (const h of hits) {
    if (firstHitF.has(h.f)) { h.kind = "serve"; continue; }
    // an unreliable (projection-inflated) speed would turn every rising lift into a "smash"
    const v = h.reliable ? h.speedKmh ?? 0 : 0;
    if (v >= 170) h.kind = "smash";
    else if (v >= 110) h.kind = "drive";
    else if (v >= 60) h.kind = "clear";
    else if (v > 0) h.kind = "drop";
    else h.kind = "shot";
  }
  void cal;
}

export function segmentRallies(track: ShuttleSample[], hits: HitEvent[], fps: number, cal: CourtCalibration, settings: AnalysisSettings): Rally[] {
  const segs = splitRallies(inPlay(track, cal, fps), cal, fps);
  const rallies: Rally[] = [];
  let id = 0;
  for (const seg of segs) {
    const startF = seg[0].f, endF = seg[seg.length - 1].f;
    const dur = (endF - startF) / fps;
    const rh = hits.filter((h) => h.f >= startF && h.f <= endF);
    if (dur < 0.6 && rh.length === 0) continue;
    if (rh.length === 0 && dur < 1.2) continue;
    const real = [...seg].reverse().find((s) => !s.interp) ?? seg[seg.length - 1];
    const lc = toCourt(cal, real);
    const landing = { pt: { x: real.x, y: real.y }, court: lc, inBounds: inBounds(lc, settings.mode), half: sideOfCourtPoint(lc) };
    // Decide from where the shuttle came down, not from who we think hit it last (hitter attribution is the weaker
    // signal): in on half S means S failed to return it; out beyond half S means the shot aimed at S missed. This
    // also covers net faults (the shuttle drops in on the hitter's own half). The one case the landing cannot
    // explain is a track lost right after a shot, still on the hitter's half, away from the net and heading for
    // the opponent; then the hitter is assumed to have won it.
    let winner: Side;
    let reason: string;
    const last = rh[rh.length - 1];
    const k = seg.indexOf(real);
    const prev = seg[Math.max(0, k - 3)];
    const vy = (lc.y - toCourt(cal, prev).y) / Math.max(1e-3, real.t - prev.t); // m/s, + = toward far
    const lostAfterHit = last?.by === landing.half && (last.by === "near" ? vy > 1.5 : vy < -1.5) && Math.abs(lc.y - COURT.netY) >= 1.2;
    const after = last?.by ? ` after ${last.by}'s shot` : "";
    if (lostAfterHit) {
      winner = landing.half;
      reason = `Lost the shuttle in flight after ${landing.half}'s shot; assuming ${opposite(landing.half)} could not return it.`;
    } else if (landing.inBounds) {
      winner = opposite(landing.half);
      reason = `Shuttle came down in on the ${landing.half} side${after}.`;
    } else {
      winner = landing.half;
      reason = `Shuttle went out on the ${landing.half} side${after}.`;
    }
    const speeds = rh.filter((h) => h.reliable).map((h) => h.speedKmh).filter((v): v is number => v !== null);
    rallies.push({
      id: id++, startF, endF, startT: seg[0].t, endT: seg[seg.length - 1].t, hits: rh, landing, winner, winnerReason: reason,
      override: undefined, maxSpeedKmh: speeds.length ? Math.max(...speeds) : null,
    });
  }
  return rallies;
}

export function computeScore(rallies: Rally[], settings: AnalysisSettings): ScoreEntry[] {
  const out: ScoreEntry[] = [];
  let near = 0, far = 0, server: Side = settings.startServer, game = 1, gamesNear = 0, gamesFar = 0;
  const target = settings.pointsToWin;
  for (const r of rallies) {
    const w = r.override === undefined || r.override === null ? r.winner : r.override === "skip" ? null : r.override;
    if (w) {
      if (w === "near") near++; else far++;
      server = w;
      const lead = Math.abs(near - far);
      const mx = Math.max(near, far);
      if ((mx >= target && lead >= 2) || mx >= target + 9) {
        if (near > far) gamesNear++; else gamesFar++;
        out.push({ f: r.endF, t: r.endT, near, far, server, game, gamesNear, gamesFar });
        near = 0; far = 0; game++;
        continue;
      }
    }
    out.push({ f: r.endF, t: r.endT, near, far, server, game, gamesNear, gamesFar });
  }
  return out;
}

export function scoreAt(score: ScoreEntry[], f: number, settings: AnalysisSettings): ScoreEntry {
  let cur: ScoreEntry = { f: 0, t: 0, near: 0, far: 0, server: settings.startServer, game: 1, gamesNear: 0, gamesFar: 0 };
  for (const s of score) {
    if (s.f <= f) cur = s; else break;
  }
  return cur;
}

export function computeStats(rallies: Rally[], hits: HitEvent[], players: PlayerSample[], fps: number): Stats {
  const speeds = hits.filter((h) => h.speedKmh !== null && h.reliable) as Array<HitEvent & { speedKmh: number }>;
  const top = speeds.length ? speeds.reduce((a, b) => (b.speedKmh > a.speedKmh ? b : a)) : null;
  const heat: number[][] = Array.from({ length: 14 }, () => new Array(6).fill(0));
  for (const r of rallies) {
    const c = r.landing?.court;
    if (!c) continue;
    const col = Math.min(5, Math.max(0, Math.floor((c.x / COURT.width) * 6)));
    const row = Math.min(13, Math.max(0, Math.floor((c.y / COURT.length) * 14)));
    heat[row][col]++;
  }
  const distance: Record<Side, number> = { near: 0, far: 0 };
  const lastBySide: Partial<Record<Side, PlayerSample>> = {};
  for (const p of players) {
    if (p.id % 2 !== 0 && p.id !== 2) { /* doubles partner: counted via id ordering below */ }
    const prev = lastBySide[p.side];
    if (prev && p.court && prev.court && p.f > prev.f && p.f - prev.f <= fps * 0.5) {
      const d = Math.hypot(p.court.x - prev.court.x, p.court.y - prev.court.y);
      if (d < 2.5) distance[p.side] += d;
    }
    lastBySide[p.side] = p;
  }
  const longest = rallies.reduce((a, r) => (r.hits.length > a ? r.hits.length : a), 0);
  const longestSec = rallies.reduce((a, r) => Math.max(a, r.endT - r.startT), 0);
  return {
    rallies: rallies.length,
    shots: hits.length,
    longestRallyShots: longest,
    longestRallySec: Math.round(longestSec * 10) / 10,
    topSpeedKmh: top?.speedKmh ?? null,
    topSpeedBy: top?.by ?? null,
    avgSpeedKmh: speeds.length ? Math.round(speeds.reduce((a, b) => a + b.speedKmh, 0) / speeds.length) : null,
    smashes: hits.filter((h) => h.kind === "smash").length,
    playerDistanceM: { near: Math.round(distance.near), far: Math.round(distance.far) },
    landingHeat: heat,
  };
}
