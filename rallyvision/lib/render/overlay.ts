/**
 * Broadcast-style overlay renderer. Draws onto a 2D context sized to the
 * original video. Pure function of (analysis, frame) so it is used both for
 * live preview and for export.
 */

import { COURT, type Analysis, type AnalysisSettings, type PlayerSample, type Pt, type ShuttleSample, type Side } from "@/lib/types";
import { courtLines, toImage } from "@/lib/cv/geometry";
import { scoreAt } from "@/lib/cv/events";

export type OverlayOptions = {
  trail: boolean;
  court: boolean;
  players: boolean;
  skeleton: boolean;
  minimap: boolean;
  score: boolean;
  speed: boolean;
  watermark: boolean;
};

export const DEFAULT_OVERLAY: OverlayOptions = { trail: true, court: true, players: true, skeleton: true, minimap: true, score: true, speed: true, watermark: true };

export type OverlayIndex = {
  shuttleByF: Map<number, ShuttleSample>;
  shuttleFrames: number[];
  playersByF: Map<number, PlayerSample[]>;
  playerFrames: number[];
};

export function buildIndex(a: Analysis): OverlayIndex {
  const shuttleByF = new Map<number, ShuttleSample>();
  for (const s of a.shuttle) shuttleByF.set(s.f, s);
  const playersByF = new Map<number, PlayerSample[]>();
  for (const p of a.players) {
    const arr = playersByF.get(p.f);
    if (arr) arr.push(p); else playersByF.set(p.f, [p]);
  }
  return { shuttleByF, shuttleFrames: [...shuttleByF.keys()].sort((x, y) => x - y), playersByF, playerFrames: [...playersByF.keys()].sort((x, y) => x - y) };
}

const POSE_EDGES: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32],
];

const C = {
  near: "#38bdf8", // sky
  far: "#fb923c", // orange
  shuttle: "#fde047",
  court: "rgba(94, 234, 212, 0.75)",
  panel: "rgba(10, 12, 18, 0.78)",
  text: "#f8fafc",
  accent: "#a3e635",
};

function sideColor(s: Side | null): string {
  return s === "near" ? C.near : s === "far" ? C.far : C.shuttle;
}

function latestBefore(frames: number[], f: number, maxBack: number): number | null {
  // binary search last frame <= f
  let lo = 0, hi = frames.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid] <= f) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (ans < 0) return null;
  return f - frames[ans] <= maxBack ? frames[ans] : null;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, a: Analysis, idx: OverlayIndex, f: number, opts: OverlayOptions = DEFAULT_OVERLAY): void {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const u = H / 720; // unit scale
  const fps = a.video.fps / a.settings.stride;
  const t = f / a.video.fps;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (opts.court) drawCourt(ctx, a, u);

  // --- players
  if (opts.players) {
    const pf = latestBefore(idx.playerFrames, f, Math.round(fps * 0.4));
    if (pf !== null) {
      for (const p of idx.playersByF.get(pf) ?? []) drawPlayer(ctx, p, a.settings, u, opts.skeleton);
    }
  }

  // --- shuttle trail
  if (opts.trail) {
    const trailLen = Math.round(fps * 0.7);
    const pts: ShuttleSample[] = [];
    for (let ff = f - trailLen; ff <= f; ff++) {
      const s = idx.shuttleByF.get(ff);
      if (s) pts.push(s);
    }
    if (pts.length > 1) {
      for (let i = 1; i < pts.length; i++) {
        const k = i / pts.length;
        ctx.strokeStyle = `rgba(253, 224, 71, ${0.15 + 0.85 * k})`;
        ctx.lineWidth = (1.5 + 4 * k) * u;
        if (pts[i].interp) ctx.setLineDash([4 * u, 4 * u]); else ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    const cur = idx.shuttleByF.get(f) ?? (pts.length ? pts[pts.length - 1] : null);
    if (cur && f - cur.f <= 2) {
      ctx.shadowColor = C.shuttle; ctx.shadowBlur = 18 * u;
      ctx.fillStyle = cur.interp ? "rgba(253,224,71,0.5)" : C.shuttle;
      ctx.beginPath(); ctx.arc(cur.x, cur.y, 6 * u, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5 * u;
      ctx.beginPath(); ctx.arc(cur.x, cur.y, 11 * u, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // --- hit markers + speed badges
  if (opts.speed) {
    for (const h of a.hits) {
      const age = t - h.t;
      if (age < 0 || age > 1.6) continue;
      const k = Math.min(1, age / 0.15); // pop-in
      const fade = age > 1.2 ? 1 - (age - 1.2) / 0.4 : 1;
      ctx.globalAlpha = fade;
      // ring at the hit point
      ctx.strokeStyle = sideColor(h.by); ctx.lineWidth = 2.5 * u;
      ctx.beginPath(); ctx.arc(h.pos.x, h.pos.y, (10 + 14 * k) * u, 0, Math.PI * 2); ctx.stroke();
      if (h.speedKmh !== null) {
        const label = `${h.speedKmh} km/h`;
        const sub = h.kind.toUpperCase() + (h.reliable ? "" : " · est.");
        const fs = (22 + 6 * k) * u;
        ctx.font = `700 ${fs}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
        const tw = ctx.measureText(label).width;
        const pw = tw + 28 * u, ph = fs * 1.9;
        let bx = h.pos.x + 18 * u, by = h.pos.y - ph - 18 * u;
        if (bx + pw > W - 8 * u) bx = h.pos.x - pw - 18 * u;
        if (by < 8 * u) by = h.pos.y + 18 * u;
        roundRect(ctx, bx, by, pw, ph, 10 * u);
        ctx.fillStyle = C.panel; ctx.fill();
        ctx.strokeStyle = sideColor(h.by); ctx.lineWidth = 2 * u; ctx.stroke();
        ctx.fillStyle = C.text; ctx.textBaseline = "alphabetic";
        ctx.fillText(label, bx + 14 * u, by + fs * 1.05);
        ctx.font = `600 ${fs * 0.5}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = sideColor(h.by);
        ctx.fillText(sub, bx + 14 * u, by + fs * 1.65);
      }
      ctx.globalAlpha = 1;
    }
  }

  if (opts.score) drawScoreBug(ctx, a, f, u);
  if (opts.minimap) drawMinimap(ctx, a, idx, f, u, fps);
  if (opts.watermark) {
    ctx.font = `600 ${13 * u}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.textAlign = "right"; ctx.textBaseline = "bottom";
    ctx.fillText("RallyVision · speeds are estimates", W - 12 * u, H - 8 * u);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawCourt(ctx: CanvasRenderingContext2D, a: Analysis | { calibration: Analysis["calibration"] }, u: number, color = C.court) {
  const cal = a.calibration;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * u;
  for (const [p, q] of courtLines(cal.mode)) {
    const ip = toImage(cal, p), iq = toImage(cal, q);
    ctx.beginPath(); ctx.moveTo(ip.x, ip.y); ctx.lineTo(iq.x, iq.y); ctx.stroke();
  }
  // net posts
  const nl = toImage(cal, { x: 0, y: COURT.netY }), nr = toImage(cal, { x: COURT.width, y: COURT.netY });
  const postH = Math.abs(toImage(cal, { x: 0, y: COURT.netY - 1.5 }).y - nl.y);
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath(); ctx.moveTo(nl.x, nl.y); ctx.lineTo(nl.x, nl.y - postH); ctx.moveTo(nr.x, nr.y); ctx.lineTo(nr.x, nr.y - postH); ctx.stroke();
  ctx.setLineDash([6 * u, 6 * u]);
  ctx.beginPath(); ctx.moveTo(nl.x, nl.y - postH); ctx.lineTo(nr.x, nr.y - postH); ctx.stroke();
  ctx.setLineDash([]);
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: PlayerSample, settings: AnalysisSettings, u: number, skeleton: boolean) {
  const col = sideColor(p.side);
  if (skeleton && p.landmarks && p.landmarks.length >= 33) {
    ctx.strokeStyle = col; ctx.lineWidth = 3 * u; ctx.globalAlpha = 0.9;
    for (const [i, j] of POSE_EDGES) {
      ctx.beginPath(); ctx.moveTo(p.landmarks[i].x, p.landmarks[i].y); ctx.lineTo(p.landmarks[j].x, p.landmarks[j].y); ctx.stroke();
    }
    ctx.fillStyle = "#fff";
    for (const k of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      ctx.beginPath(); ctx.arc(p.landmarks[k].x, p.landmarks[k].y, 3 * u, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.strokeStyle = col; ctx.lineWidth = 2.5 * u;
    roundRect(ctx, p.box.x, p.box.y, p.box.w, p.box.h, 8 * u); ctx.stroke();
  }
  // ground ellipse under the feet
  ctx.strokeStyle = col; ctx.lineWidth = 3 * u; ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.ellipse(p.feet.x, p.feet.y, 26 * u, 9 * u, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  const name = p.side === "near" ? settings.nearLabel : settings.farLabel;
  const label = settings.mode === "doubles" ? `${name} ${(p.id % 2) + 1}` : name;
  ctx.font = `700 ${14 * u}px ui-sans-serif, system-ui, sans-serif`;
  const tw = ctx.measureText(label).width;
  const bx = p.feet.x - tw / 2 - 8 * u, by = p.feet.y + 12 * u;
  roundRect(ctx, bx, by, tw + 16 * u, 22 * u, 6 * u);
  ctx.fillStyle = col; ctx.fill();
  ctx.fillStyle = "#0b1220"; ctx.textBaseline = "middle";
  ctx.fillText(label, bx + 8 * u, by + 11 * u);
  ctx.textBaseline = "alphabetic";
}

function drawScoreBug(ctx: CanvasRenderingContext2D, a: Analysis, f: number, u: number) {
  const s = scoreAt(a.score, f, a.settings);
  const x = 16 * u, y = 16 * u, rowH = 30 * u, w = 230 * u;
  roundRect(ctx, x, y, w, rowH * 2 + 8 * u, 10 * u);
  ctx.fillStyle = C.panel; ctx.fill();
  const rows: Array<[Side, string, number, number]> = [
    ["near", a.settings.nearLabel, s.near, s.gamesNear],
    ["far", a.settings.farLabel, s.far, s.gamesFar],
  ];
  rows.forEach(([side, name, pts, games], i) => {
    const ry = y + 4 * u + i * rowH;
    ctx.fillStyle = sideColor(side);
    ctx.fillRect(x, ry + 4 * u, 5 * u, rowH - 8 * u);
    ctx.font = `600 ${15 * u}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = C.text; ctx.textBaseline = "middle";
    ctx.fillText(name.slice(0, 14), x + 14 * u, ry + rowH / 2);
    if (s.server === side) {
      ctx.fillStyle = C.accent;
      ctx.beginPath(); ctx.arc(x + w - 86 * u, ry + rowH / 2, 4 * u, 0, Math.PI * 2); ctx.fill();
    }
    ctx.font = `700 ${16 * u}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(248,250,252,0.55)"; ctx.textAlign = "right";
    ctx.fillText(String(games), x + w - 62 * u, ry + rowH / 2);
    ctx.fillStyle = C.text; ctx.font = `800 ${20 * u}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(String(pts), x + w - 14 * u, ry + rowH / 2);
    ctx.textAlign = "left";
  });
  ctx.textBaseline = "alphabetic";
  // rally pill
  const rally = a.rallies.find((r) => f >= r.startF && f <= r.endF + Math.round(a.video.fps * 0.8));
  if (rally) {
    const shots = rally.hits.filter((h) => h.f <= f).length;
    const label = `RALLY ${rally.id + 1}  ·  ${shots} ${shots === 1 ? "shot" : "shots"}`;
    ctx.font = `700 ${12 * u}px ui-sans-serif, system-ui, sans-serif`;
    const tw = ctx.measureText(label).width;
    const py = y + rowH * 2 + 16 * u;
    roundRect(ctx, x, py, tw + 20 * u, 22 * u, 11 * u);
    ctx.fillStyle = C.panel; ctx.fill();
    ctx.fillStyle = C.accent; ctx.textBaseline = "middle";
    ctx.fillText(label, x + 10 * u, py + 11 * u);
    ctx.textBaseline = "alphabetic";
  }
}

function drawMinimap(ctx: CanvasRenderingContext2D, a: Analysis, idx: OverlayIndex, f: number, u: number, fps: number) {
  const W = ctx.canvas.width;
  const mh = 150 * u, mw = mh * (COURT.width / COURT.length) + 0; // court drawn with far side at top
  const pad = 14 * u;
  const x0 = W - mw - pad - 10 * u, y0 = pad;
  roundRect(ctx, x0 - 10 * u, y0 - 10 * u, mw + 20 * u, mh + 20 * u, 10 * u);
  ctx.fillStyle = C.panel; ctx.fill();
  const map = (c: Pt): Pt => ({ x: x0 + (c.x / COURT.width) * mw, y: y0 + (1 - c.y / COURT.length) * mh });
  ctx.fillStyle = "rgba(16, 185, 129, 0.25)";
  ctx.fillRect(x0, y0, mw, mh);
  ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1 * u;
  for (const [p, q] of courtLines(a.calibration.mode)) {
    const mp = map(p), mq = map(q);
    ctx.beginPath(); ctx.moveTo(mp.x, mp.y); ctx.lineTo(mq.x, mq.y); ctx.stroke();
  }
  // landings so far
  for (const r of a.rallies) {
    if (r.endF > f || !r.landing?.court) continue;
    const age = (f - r.endF) / fps;
    if (age > 30) continue;
    const m = map(r.landing.court);
    ctx.strokeStyle = r.landing.inBounds ? "rgba(253,224,71,0.9)" : "rgba(248,113,113,0.9)";
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath(); ctx.moveTo(m.x - 3 * u, m.y - 3 * u); ctx.lineTo(m.x + 3 * u, m.y + 3 * u); ctx.moveTo(m.x + 3 * u, m.y - 3 * u); ctx.lineTo(m.x - 3 * u, m.y + 3 * u); ctx.stroke();
  }
  // players
  const pf = latestBefore(idx.playerFrames, f, Math.round(fps * 0.5));
  if (pf !== null) {
    for (const p of idx.playersByF.get(pf) ?? []) {
      if (!p.court) continue;
      const m = map({ x: Math.min(COURT.width + 1, Math.max(-1, p.court.x)), y: Math.min(COURT.length + 1.5, Math.max(-1.5, p.court.y)) });
      ctx.fillStyle = sideColor(p.side);
      ctx.beginPath(); ctx.arc(m.x, m.y, 5 * u, 0, Math.PI * 2); ctx.fill();
    }
  }
  // shuttle (ground projection, fades when interp)
  const s = idx.shuttleByF.get(f);
  if (s) {
    const c = toCourtClamped(a, s);
    const m = map(c);
    ctx.fillStyle = s.interp ? "rgba(253,224,71,0.5)" : C.shuttle;
    ctx.beginPath(); ctx.arc(m.x, m.y, 3.5 * u, 0, Math.PI * 2); ctx.fill();
  }
  ctx.font = `600 ${10 * u}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText(a.settings.farLabel.slice(0, 10), x0, y0 - 2 * u);
  ctx.fillText(a.settings.nearLabel.slice(0, 10), x0, y0 + mh + 9 * u);
}

function toCourtClamped(a: Analysis, p: Pt): Pt {
  const H = a.calibration.H;
  const w = H[6] * p.x + H[7] * p.y + H[8] || 1e-9;
  const c = { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
  return { x: Math.min(COURT.width + 1, Math.max(-1, c.x)), y: Math.min(COURT.length + 1.5, Math.max(-1.5, c.y)) };
}

/** 1080x1350 shareable summary card. */
export function renderStatsCard(a: Analysis): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = 1080; cv.height = 1350;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 1350);
  g.addColorStop(0, "#0b1220"); g.addColorStop(1, "#111827");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = C.accent; ctx.font = "800 34px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("RALLYVISION", 72, 110);
  ctx.fillStyle = C.text; ctx.font = "800 72px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("Match card", 72, 200);
  ctx.fillStyle = "rgba(248,250,252,0.6)"; ctx.font = "500 28px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(a.video.name.slice(0, 48), 72, 248);
  const last = a.score[a.score.length - 1];
  const tiles: Array<[string, string, string]> = [
    ["Top shuttle speed", a.stats.topSpeedKmh ? `${a.stats.topSpeedKmh}` : "—", a.stats.topSpeedKmh ? `km/h · ${a.stats.topSpeedBy === "near" ? a.settings.nearLabel : a.settings.farLabel}` : "not measured"],
    ["Score", last ? `${last.near}–${last.far}` : "0–0", `${a.settings.nearLabel} vs ${a.settings.farLabel}`],
    ["Rallies", `${a.stats.rallies}`, `${a.stats.shots} shots total`],
    ["Longest rally", `${a.stats.longestRallyShots}`, `shots · ${a.stats.longestRallySec}s`],
    ["Smashes", `${a.stats.smashes}`, `avg shot ${a.stats.avgSpeedKmh ?? "—"} km/h`],
    ["Distance covered", `${a.stats.playerDistanceM.near}m`, `${a.settings.nearLabel} · ${a.settings.farLabel} ${a.stats.playerDistanceM.far}m`],
  ];
  tiles.forEach(([k, v, sub], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 72 + col * 480, y = 310 + row * 230;
    roundRect(ctx, x, y, 456, 200, 24);
    ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fill();
    ctx.fillStyle = "rgba(248,250,252,0.6)"; ctx.font = "600 24px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(k.toUpperCase(), x + 28, y + 48);
    ctx.fillStyle = i === 0 ? C.shuttle : C.text; ctx.font = "800 72px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(v, x + 28, y + 128);
    ctx.fillStyle = "rgba(248,250,252,0.6)"; ctx.font = "500 22px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(sub, x + 28, y + 170);
  });
  // landing heatmap
  const hx = 72, hy = 1010, hw = 936, hh = 250;
  ctx.fillStyle = "rgba(248,250,252,0.6)"; ctx.font = "600 24px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("WHERE RALLIES ENDED", hx, hy - 16);
  const cw = hw / 14, ch = hh / 6;
  const mx = Math.max(1, ...a.stats.landingHeat.flat());
  for (let r = 0; r < 14; r++) for (let c = 0; c < 6; c++) {
    const v = a.stats.landingHeat[r][c] / mx;
    ctx.fillStyle = `rgba(253, 224, 71, ${0.08 + v * 0.85})`;
    ctx.fillRect(hx + r * cw + 1, hy + c * ch + 1, cw - 2, ch - 2);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 2;
  ctx.strokeRect(hx, hy, hw, hh);
  ctx.beginPath(); ctx.moveTo(hx + hw / 2, hy); ctx.lineTo(hx + hw / 2, hy + hh); ctx.stroke();
  ctx.fillStyle = "rgba(248,250,252,0.6)"; ctx.font = "500 20px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(a.settings.nearLabel, hx, hy + hh + 30);
  ctx.textAlign = "right"; ctx.fillText(a.settings.farLabel, hx + hw, hy + hh + 30); ctx.textAlign = "left";
  ctx.fillStyle = "rgba(248,250,252,0.35)"; ctx.font = "500 18px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("Speeds are ground-plane estimates from a single phone camera.", 72, 1320);
  return cv;
}
