/**
 * Post-processing of raw tracks: smoothing, hit detection, speed estimation,
 * rally segmentation, score keeping and aggregate stats.
 */

import { COURT, type AnalysisSettings, type CourtCalibration, type HitEvent, type PlayerSample, type Pt, type Rally, type ScoreEntry, type ShuttleSample, type Side, type Stats } from "@/lib/types";
import { inBounds, sideOfCourtPoint, toCourt } from "@/lib/cv/geometry";

export function smoothTrack(track: ShuttleSample[], win = 2): ShuttleSample[] {
  const out: ShuttleSample[] = [];
  for (let i = 0; i < track.length; i++) {
    let sx = 0, sy = 0, n = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(track.length - 1, i + win); j++) {
      // only average within the same continuous segment
      if (Math.abs(track[j].f - track[i].f) > win * 2 + 1) continue;
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

export function detectHits(track: ShuttleSample[], cal: CourtCalibration, fps: number, players: PlayerSample[]): HitEvent[] {
  const hits: HitEvent[] = [];
  const segs = splitSegments(track, Math.round(fps * 0.5));
  const minGapF = Math.max(3, Math.round(fps * 0.22));
  const playersByF = new Map<number, PlayerSample[]>();
  for (const p of players) {
    const arr = playersByF.get(p.f);
    if (arr) arr.push(p); else playersByF.set(p.f, [p]);
  }
  for (const seg of segs) {
    if (seg.length < 4) continue;
    const court = seg.map((s) => toCourt(cal, s));
    // along-court velocity (m/s) smoothed over 3 samples
    const vy: number[] = seg.map((_, i) => {
      const a = Math.max(0, i - 1), b = Math.min(seg.length - 1, i + 1);
      const dt = (seg[b].t - seg[a].t) || 1 / fps;
      return (court[b].y - court[a].y) / dt;
    });
    const vimg: Pt[] = seg.map((_, i) => {
      const a = Math.max(0, i - 1), b = Math.min(seg.length - 1, i + 1);
      const dt = (seg[b].t - seg[a].t) || 1 / fps;
      return { x: (seg[b].x - seg[a].x) / dt, y: (seg[b].y - seg[a].y) / dt };
    });
    let lastHitIdx = -Infinity;
    const addHit = (i: number) => {
      const s = seg[i];
      // direction after the hit tells us who hit it
      let by: Side | null = null;
      const after = vy[Math.min(seg.length - 1, i + 2)];
      if (Math.abs(after) > 0.3) by = after > 0 ? "near" : "far";
      else by = sideOfCourtPoint(court[i]);
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
      lastHitIdx = i;
    };
    // first sample of a segment that begins with a fast shuttle is a hit (serve or the first visible shot)
    for (let i = 1; i < seg.length - 1; i++) {
      if (i - lastHitIdx < minGapF) continue;
      const signChange = vy[i - 1] * vy[i + 1] < 0 && Math.abs(vy[i - 1]) > 0.6 && Math.abs(vy[i + 1]) > 0.6;
      const a = vimg[i - 1], b = vimg[i + 1];
      const sa = Math.hypot(a.x, a.y), sb = Math.hypot(b.x, b.y);
      const cos = sa > 1 && sb > 1 ? (a.x * b.x + a.y * b.y) / (sa * sb) : 1;
      const sharpTurn = cos < 0.25 && Math.min(sa, sb) > 40; // > ~75 deg and moving
      if (signChange || sharpTurn) addHit(i);
    }
    // crude kind classification
  }
  hits.sort((a, b) => a.f - b.f);
  return hits;
}

function speedAfter(seg: ShuttleSample[], court: Pt[], i: number, fps: number): { kmh: number | null; px: number; reliable: boolean } {
  // Skip the frame right at the hit (the track often hops from racket to shuttle there) and take the
  // median of the next few frame-to-frame ground-plane speeds; a jumpy window is marked unreliable.
  const speeds: number[] = [];
  let px = 0;
  for (let j = i + 2; j <= Math.min(seg.length - 1, i + 7); j++) {
    if (seg[j].interp || seg[j - 1].interp) continue;
    const dt = seg[j].t - seg[j - 1].t;
    if (dt <= 0 || dt > 2.5 / fps) continue;
    const m = Math.hypot(court[j].x - court[j - 1].x, court[j].y - court[j - 1].y);
    speeds.push(m / dt);
    px = Math.max(px, Math.hypot(seg[j].x - seg[j - 1].x, seg[j].y - seg[j - 1].y) / dt);
  }
  if (speeds.length < 1) return { kmh: null, px, reliable: false };
  const sorted = [...speeds].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const jumpy = sorted[sorted.length - 1] > 3 * Math.max(0.5, sorted[0]);
  const kmh = Math.round(med * 3.6);
  return { kmh: Math.min(kmh, 450), px, reliable: speeds.length >= 3 && !jumpy && kmh >= 20 && kmh < 420 };
}

export function classifyHits(hits: HitEvent[], rallies: Rally[], cal: CourtCalibration): void {
  const firstHitF = new Set(rallies.map((r) => r.hits[0]?.f));
  for (const h of hits) {
    if (firstHitF.has(h.f)) { h.kind = "serve"; continue; }
    const v = h.speedKmh ?? 0;
    if (v >= 170) h.kind = "smash";
    else if (v >= 110) h.kind = "drive";
    else if (v >= 60) h.kind = "clear";
    else if (v > 0) h.kind = "drop";
    else h.kind = "shot";
  }
  void cal;
}

export function segmentRallies(track: ShuttleSample[], hits: HitEvent[], fps: number, cal: CourtCalibration, settings: AnalysisSettings): Rally[] {
  const segs = splitSegments(track, Math.round(fps * 1.2));
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
    let winner: Side | null = null;
    let reason = "No shots detected in this rally.";
    const last = rh[rh.length - 1];
    if (last && last.by) {
      if (landing.half === opposite(last.by)) {
        if (landing.inBounds) { winner = last.by; reason = `Last shot by ${last.by} landed in on the ${landing.half} side.`; }
        else { winner = opposite(last.by); reason = `Last shot by ${last.by} went out.`; }
      } else {
        // Track ended on the hitter's own side. Was it a net fault, or did we just lose the shuttle in flight?
        const k = seg.indexOf(real);
        const prev = seg[Math.max(0, k - 3)];
        const vy = (lc.y - toCourt(cal, prev).y) / Math.max(1e-3, real.t - prev.t); // m/s, + = toward far
        const towardOpponent = last.by === "near" ? vy > 1.5 : vy < -1.5;
        const nearNet = Math.abs(lc.y - COURT.netY) < 1.2;
        if (towardOpponent && !nearNet) {
          winner = last.by;
          reason = `Lost the shuttle in flight after ${last.by}'s shot; assuming ${opposite(last.by)} could not return it.`;
        } else {
          winner = opposite(last.by);
          reason = `Last shot by ${last.by} did not cross to the other side (net / fault).`;
        }
      }
    } else if (last) {
      reason = "Could not tell who hit the last shot.";
    }
    const speeds = rh.map((h) => h.speedKmh).filter((v): v is number => v !== null);
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
