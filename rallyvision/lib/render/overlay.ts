/**
 * Broadcast-style overlay renderer. Draws in ORIGINAL video coordinates onto a
 * context whose transform maps those to the target canvas (identity for the
 * live player, a scale for export). Pure function of (analysis, frame) so the
 * preview and the exported video always match.
 */

import { COURT, type Analysis, type HitEvent, type PlayerSample, type Pt, type Rally, type ShuttleSample, type Side } from "@/lib/types";
import { courtLines, toImage } from "@/lib/cv/geometry";
import { scoreAt } from "@/lib/cv/events";

export type OverlayOptions = {
  trail: boolean;
  speed: boolean;
  players: boolean;
  skeleton: boolean;
  court: boolean;
  minimap: boolean;
  score: boolean;
  banner: boolean;
  watermark: boolean;
  speedUnit: "kmh" | "mph";
  /** also show speeds the estimator flagged as unreliable */
  showUnreliable: boolean;
};

export const DEFAULT_OVERLAY: OverlayOptions = {
  trail: true,
  speed: true,
  players: true,
  skeleton: false,
  court: false,
  minimap: true,
  score: true,
  banner: true,
  watermark: true,
  speedUnit: "kmh",
  showUnreliable: false,
};

export type OverlayIndex = {
  shuttleByF: Map<number, ShuttleSample>;
  /** smoothed player samples grouped by frame */
  playersByF: Map<number, PlayerSample[]>;
  playerFrames: number[];
  /** smoothed per-player series (key = side:id) for minimap tails */
  series: Map<string, PlayerSample[]>;
  topHit: HitEvent | null;
};

const SMOOTH_SEC = 0.25;

export function buildIndex(a: Analysis): OverlayIndex {
  const shuttleByF = new Map<number, ShuttleSample>();
  for (const s of a.shuttle) shuttleByF.set(s.f, s);

  const raw = new Map<string, PlayerSample[]>();
  for (const p of a.players) {
    const k = `${p.side}:${p.id}`;
    const arr = raw.get(k);
    if (arr) arr.push(p); else raw.set(k, [p]);
  }
  const series = new Map<string, PlayerSample[]>();
  const playersByF = new Map<number, PlayerSample[]>();
  const win = Math.max(1, Math.round(a.video.fps * SMOOTH_SEC));
  for (const [k, arr] of raw) {
    arr.sort((x, y) => x.f - y.f);
    const out = arr.map((p, i) => {
      let fx = 0, fy = 0, cx = 0, cy = 0, n = 0, nc = 0;
      for (let j = i; j >= 0 && p.f - arr[j].f <= win; j--) acc(arr[j]);
      for (let j = i + 1; j < arr.length && arr[j].f - p.f <= win; j++) acc(arr[j]);
      function acc(q: PlayerSample) {
        fx += q.feet.x; fy += q.feet.y; n++;
        if (q.court) { cx += q.court.x; cy += q.court.y; nc++; }
      }
      return { ...p, feet: { x: fx / n, y: fy / n }, court: nc ? { x: cx / nc, y: cy / nc } : p.court };
    });
    series.set(k, out);
    for (const p of out) {
      const list = playersByF.get(p.f);
      if (list) list.push(p); else playersByF.set(p.f, [p]);
    }
  }
  let topHit: HitEvent | null = null;
  for (const h of a.hits) if (h.reliable && h.speedKmh !== null && (!topHit || h.speedKmh > (topHit.speedKmh ?? 0))) topHit = h;
  return { shuttleByF, playersByF, playerFrames: [...playersByF.keys()].sort((x, y) => x - y), series, topHit };
}

const POSE_EDGES: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

export const OVERLAY_COLORS = {
  near: "#60a5fa",
  far: "#fb923c",
  shuttle: "#fde68a",
  glass: "rgba(14, 14, 18, 0.62)",
  glassLine: "rgba(255, 255, 255, 0.14)",
  text: "#ffffff",
  dim: "rgba(255, 255, 255, 0.62)",
};
const C = OVERLAY_COLORS;
const FONT = `ui-sans-serif, -apple-system, "SF Pro Display", "Inter", system-ui, "Segoe UI", Roboto, sans-serif`;
const font = (weight: number, px: number) => `${weight} ${px}px ${FONT}`;

function sideColor(s: Side | null): string {
  return s === "near" ? C.near : s === "far" ? C.far : "#e5e7eb";
}

function latestBefore(frames: number[], f: number, maxBack: number): number | null {
  let lo = 0, hi = frames.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid] <= f) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (ans < 0) return null;
  return f - frames[ans] <= maxBack ? frames[ans] : null;
}

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

export function effectiveWinner(r: Rally): Side | null | "skip" {
  return r.override === undefined || r.override === null ? r.winner : r.override;
}

export function formatSpeed(kmh: number, unit: OverlayOptions["speedUnit"]): { value: string; unit: string } {
  return unit === "mph" ? { value: String(Math.round(kmh * 0.621371)), unit: "mph" } : { value: String(Math.round(kmh)), unit: "km/h" };
}

export function drawOverlay(ctx: CanvasRenderingContext2D, a: Analysis, idx: OverlayIndex, f: number, opts: OverlayOptions = DEFAULT_OVERLAY): void {
  const W = a.video.width, H = a.video.height;
  const u = Math.min(W, H) / 720;
  const fps = a.video.fps;
  const t = f / fps;
  const reserved: Rect[] = [];
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (opts.court) drawCourt(ctx, a, u, "rgba(255,255,255,0.35)");

  if (opts.players) {
    const pf = latestBefore(idx.playerFrames, f, Math.round(fps * 0.4));
    if (pf !== null) for (const p of idx.playersByF.get(pf) ?? []) drawPlayer(ctx, p, a, u, opts.skeleton);
  }

  if (opts.trail) drawTrail(ctx, idx, f, fps, u);

  // hit flash rings
  if (opts.trail || opts.speed) {
    for (const h of a.hits) {
      const age = t - h.t;
      if (age < 0 || age > 0.4) continue;
      const k = age / 0.4;
      ctx.strokeStyle = `rgba(255,255,255,${0.75 * (1 - k)})`;
      ctx.lineWidth = 2 * u;
      ctx.beginPath(); ctx.arc(h.pos.x, h.pos.y, (8 + 26 * ease(k)) * u, 0, Math.PI * 2); ctx.stroke();
    }
  }

  if (opts.score) reserved.push(drawScoreBug(ctx, a, f, u));
  if (opts.minimap) reserved.push(drawMinimap(ctx, a, idx, f, u, W));
  if (opts.banner) drawPointBanner(ctx, a, f, u, W);
  if (opts.speed) drawSpeedBadges(ctx, a, idx, t, u, W, H, opts, reserved);

  if (opts.watermark) {
    ctx.font = font(600, 12 * u);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.textAlign = "right"; ctx.textBaseline = "bottom";
    ctx.fillText("RallyVision · speeds estimated", W - 16 * u, H - 12 * u);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
}

function glass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, u: number) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 18 * u; ctx.shadowOffsetY = 4 * u;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = C.glass; ctx.fill();
  ctx.restore();
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.strokeStyle = C.glassLine; ctx.lineWidth = 1 * u; ctx.stroke();
}

function drawTrail(ctx: CanvasRenderingContext2D, idx: OverlayIndex, f: number, fps: number, u: number) {
  const len = Math.round(fps * 0.6);
  // collect the contiguous run ending at (or just before) f: stop at gaps or track switches
  const pts: ShuttleSample[] = [];
  let ff = f;
  while (ff >= f - 2 && !idx.shuttleByF.has(ff)) ff--;
  const head = idx.shuttleByF.get(ff);
  if (!head) return;
  pts.push(head);
  let missing = 0;
  for (let g = ff - 1; g >= f - len; g--) {
    const s = idx.shuttleByF.get(g);
    if (!s) { if (++missing > 2) break; continue; }
    const prev = pts[pts.length - 1];
    if ((s.tid !== undefined && prev.tid !== undefined && s.tid !== prev.tid) || Math.hypot(s.x - prev.x, s.y - prev.y) > 160 * u * (missing + 1)) break;
    missing = 0;
    pts.push(s);
  }
  pts.reverse();
  if (pts.length >= 2) {
    const passes: Array<[string, number, number]> = [["253, 230, 138", 9, 0.22], ["255, 255, 255", 3.2, 0.95]];
    for (const [rgb, width, alpha] of passes) {
      for (let i = 1; i < pts.length; i++) {
        const k = i / (pts.length - 1);
        const p0 = pts[i - 1], p1 = pts[i];
        const m0 = i > 1 ? mid(pts[i - 2], p0) : p0;
        const m1 = mid(p0, p1);
        ctx.strokeStyle = `rgba(${rgb}, ${alpha * k * k})`;
        ctx.lineWidth = width * u * (0.35 + 0.65 * k);
        ctx.beginPath(); ctx.moveTo(m0.x, m0.y); ctx.quadraticCurveTo(p0.x, p0.y, m1.x, m1.y); ctx.stroke();
        if (i === pts.length - 1) { ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); }
      }
    }
  }
  if (f - head.f <= 2) {
    ctx.save();
    ctx.shadowColor = C.shuttle; ctx.shadowBlur = 16 * u;
    ctx.fillStyle = head.interp ? "rgba(255,255,255,0.55)" : "#ffffff";
    ctx.beginPath(); ctx.arc(head.x, head.y, 4.5 * u, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function drawSpeedBadges(ctx: CanvasRenderingContext2D, a: Analysis, idx: OverlayIndex, t: number, u: number, W: number, H: number, opts: OverlayOptions, reserved: Rect[]) {
  for (const h of a.hits) {
    const age = t - h.t;
    if (age < 0 || age > 1.5 || h.speedKmh === null) continue;
    if (!h.reliable && !opts.showUnreliable) continue;
    const pop = ease(age / 0.18);
    const alpha = age > 1.15 ? 1 - (age - 1.15) / 0.35 : 1;
    const sp = formatSpeed(h.speedKmh, opts.speedUnit);
    const isTop = idx.topHit === h;
    const tag = `${h.kind.toUpperCase()}${isTop ? "  ·  FASTEST" : ""}${h.reliable ? "" : "  ·  ROUGH"}`;

    const numPx = 30 * u, unitPx = 12 * u, tagPx = 10 * u, padX = 14 * u, padY = 10 * u;
    ctx.font = font(800, numPx); const nw = ctx.measureText(sp.value).width;
    ctx.font = font(600, unitPx); const uw = ctx.measureText(sp.unit).width;
    ctx.font = font(700, tagPx); const tw = ctx.measureText(tag).width + tag.length * 0.8 * u;
    const bw = Math.max(nw + 6 * u + uw, tw) + padX * 2 + 6 * u;
    const bh = numPx + tagPx + padY * 2 + 6 * u;

    const off = 34 * u;
    const candidates: Rect[] = [
      { x: h.pos.x + off, y: h.pos.y - off - bh, w: bw, h: bh },
      { x: h.pos.x - off - bw, y: h.pos.y - off - bh, w: bw, h: bh },
      { x: h.pos.x + off, y: h.pos.y + off, w: bw, h: bh },
      { x: h.pos.x - off - bw, y: h.pos.y + off, w: bw, h: bh },
    ];
    const m = 12 * u;
    const inFrame = (r: Rect) => r.x >= m && r.y >= m && r.x + r.w <= W - m && r.y + r.h <= H - m;
    let box = candidates.find((r) => inFrame(r) && !reserved.some((q) => overlaps(r, q))) ?? candidates.find(inFrame) ?? candidates[0];
    box = { ...box, x: Math.min(W - m - bw, Math.max(m, box.x)), y: Math.min(H - m - bh, Math.max(m, box.y)) };

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    // leader line from the hit point to the badge corner
    const anchor = { x: box.x + (box.x > h.pos.x ? 0 : bw), y: box.y + (box.y > h.pos.y ? 0 : bh) };
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.2 * u;
    ctx.beginPath(); ctx.moveTo(h.pos.x, h.pos.y); ctx.lineTo(h.pos.x + (anchor.x - h.pos.x) * pop, h.pos.y + (anchor.y - h.pos.y) * pop); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(h.pos.x, h.pos.y, 2.5 * u, 0, Math.PI * 2); ctx.fill();

    const s = 0.9 + 0.1 * pop;
    ctx.translate(box.x + bw / 2, box.y + bh / 2); ctx.scale(s, s); ctx.translate(-bw / 2, -bh / 2);
    glass(ctx, 0, 0, bw, bh, 12 * u, u);
    // side accent bar
    ctx.fillStyle = sideColor(h.by);
    roundRect(ctx, padX - 6 * u, padY + 2 * u, 3 * u, bh - padY * 2 - 4 * u, 1.5 * u); ctx.fill();
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = isTop ? C.shuttle : C.text;
    ctx.font = font(800, numPx); ctx.fillText(sp.value, padX + 4 * u, padY + numPx * 0.86);
    ctx.fillStyle = C.dim; ctx.font = font(600, unitPx); ctx.fillText(sp.unit, padX + 4 * u + nw + 6 * u, padY + numPx * 0.86);
    ctx.fillStyle = sideColor(h.by); ctx.font = font(700, tagPx);
    spaced(ctx, tag, padX + 4 * u, padY + numPx + tagPx + 2 * u, 0.8 * u);
    ctx.restore();
  }
}

function spaced(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, tracking: number) {
  let cx = x;
  for (const ch of s) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + tracking; }
}

export function drawCourt(ctx: CanvasRenderingContext2D, a: Analysis | { calibration: Analysis["calibration"] }, u: number, color = "rgba(255,255,255,0.35)") {
  const cal = a.calibration;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * u;
  for (const [p, q] of courtLines(cal.mode)) {
    const ip = toImage(cal, p), iq = toImage(cal, q);
    ctx.beginPath(); ctx.moveTo(ip.x, ip.y); ctx.lineTo(iq.x, iq.y); ctx.stroke();
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: PlayerSample, a: Analysis, u: number, skeleton: boolean) {
  const settings = a.settings;
  const col = sideColor(p.side);
  // ring = 0.45 m around the feet on the court plane, so it is the right size at any depth
  let rx = 22 * u, ry = 7 * u;
  if (p.court) {
    const c = toImage(a.calibration, p.court);
    const ex = toImage(a.calibration, { x: p.court.x + 0.35, y: p.court.y });
    const ey = toImage(a.calibration, { x: p.court.x, y: p.court.y + 0.35 });
    rx = Math.min(80 * u, Math.max(10 * u, Math.hypot(ex.x - c.x, ex.y - c.y)));
    ry = Math.min(rx * 0.6, Math.max(3 * u, Math.hypot(ey.x - c.x, ey.y - c.y)));
  }
  const hasPose = !!p.landmarks && p.landmarks.length >= 33;
  if (skeleton && hasPose) {
    ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = 2 * u;
    for (const [i, j] of POSE_EDGES) {
      ctx.beginPath(); ctx.moveTo(p.landmarks![i].x, p.landmarks![i].y); ctx.lineTo(p.landmarks![j].x, p.landmarks![j].y); ctx.stroke();
    }
    ctx.fillStyle = col;
    for (const k of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      ctx.beginPath(); ctx.arc(p.landmarks![k].x, p.landmarks![k].y, 2.6 * u, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.save();
  ctx.fillStyle = col; ctx.globalAlpha = 0.2;
  ctx.beginPath(); ctx.ellipse(p.feet.x, p.feet.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.95; ctx.strokeStyle = col; ctx.lineWidth = 2 * u;
  ctx.beginPath(); ctx.ellipse(p.feet.x, p.feet.y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  // name tag above the head: pose box top when available, else ~1.2 m above the feet estimated from the ring
  const headY = hasPose ? p.box.y : p.feet.y - rx * 3.4;
  const name = p.side === "near" ? settings.nearLabel : settings.farLabel;
  const label = settings.mode === "doubles" ? `${name} ${(p.id % 2) + 1}` : name;
  ctx.font = font(650, 12 * u);
  const tw = ctx.measureText(label).width;
  const w = tw + 22 * u, h = 22 * u;
  const x = p.feet.x - w / 2, y = Math.max(4 * u, headY - h - 6 * u);
  glass(ctx, x, y, w, h, h / 2, u);
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + 10 * u, y + h / 2, 3 * u, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.text; ctx.textBaseline = "middle";
  ctx.fillText(label, x + 16 * u, y + h / 2 + 0.5 * u);
  ctx.textBaseline = "alphabetic";
}

function drawScoreBug(ctx: CanvasRenderingContext2D, a: Analysis, f: number, u: number): Rect {
  const s = scoreAt(a.score, f, a.settings);
  const x = 20 * u, y = 20 * u, rowH = 30 * u, w = 232 * u;
  const rally = a.rallies.find((r) => f >= r.startF && f <= r.endF + Math.round(a.video.fps * 0.8));
  const footer = 24 * u;
  const h = rowH * 2 + 10 * u + footer;
  glass(ctx, x, y, w, h, 14 * u, u);
  const rows: Array<[Side, string, number, number]> = [
    ["near", a.settings.nearLabel, s.near, s.gamesNear],
    ["far", a.settings.farLabel, s.far, s.gamesFar],
  ];
  rows.forEach(([side, name, pts, games], i) => {
    const cy = y + 5 * u + i * rowH + rowH / 2;
    ctx.fillStyle = sideColor(side);
    ctx.beginPath(); ctx.arc(x + 16 * u, cy, 4 * u, 0, Math.PI * 2); ctx.fill();
    ctx.textBaseline = "middle";
    ctx.font = font(600, 14 * u); ctx.fillStyle = C.text;
    ctx.fillText(name.length > 14 ? name.slice(0, 13) + "…" : name, x + 28 * u, cy);
    if (s.server === side) {
      ctx.fillStyle = C.shuttle;
      ctx.beginPath(); ctx.moveTo(x + w - 84 * u, cy - 4 * u); ctx.lineTo(x + w - 78 * u, cy); ctx.lineTo(x + w - 84 * u, cy + 4 * u); ctx.closePath(); ctx.fill();
    }
    ctx.textAlign = "right";
    if (s.gamesNear || s.gamesFar) { ctx.font = font(600, 13 * u); ctx.fillStyle = C.dim; ctx.fillText(String(games), x + w - 56 * u, cy); }
    ctx.font = font(800, 19 * u); ctx.fillStyle = C.text;
    ctx.fillText(String(pts), x + w - 16 * u, cy);
    ctx.textAlign = "left";
  });
  // divider + footer
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fillRect(x + 12 * u, y + rowH * 2 + 8 * u, w - 24 * u, 1 * u);
  ctx.font = font(700, 10 * u); ctx.fillStyle = C.dim; ctx.textBaseline = "middle";
  const shots = rally ? rally.hits.filter((hh) => hh.f <= f).length : 0;
  const played = a.rallies.filter((r) => r.endF < f).length;
  const label = rally ? `RALLY ${rally.id + 1}   ${shots} SHOT${shots === 1 ? "" : "S"}` : `${played} RALL${played === 1 ? "Y" : "IES"} PLAYED`;
  spaced(ctx, label, x + 14 * u, y + rowH * 2 + 10 * u + footer / 2, 0.9 * u);
  if (rally && f <= rally.endF) {
    ctx.fillStyle = "#4ade80";
    ctx.beginPath(); ctx.arc(x + w - 18 * u, y + rowH * 2 + 10 * u + footer / 2, 3.2 * u, 0, Math.PI * 2); ctx.fill();
  }
  ctx.textBaseline = "alphabetic";
  return { x, y, w, h };
}

function drawPointBanner(ctx: CanvasRenderingContext2D, a: Analysis, f: number, u: number, W: number) {
  const fps = a.video.fps;
  for (const r of a.rallies) {
    const age = (f - r.endF) / fps;
    if (age < 0.15 || age > 2.2) continue;
    const win = effectiveWinner(r);
    if (win !== "near" && win !== "far") continue;
    const s = a.score.find((e) => e.f === r.endF);
    const name = win === "near" ? a.settings.nearLabel : a.settings.farLabel;
    const k = ease((age - 0.15) / 0.25);
    const alpha = age > 1.8 ? 1 - (age - 1.8) / 0.4 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha) * k;
    const title = `POINT ${name.toUpperCase()}`;
    const score = s ? `${s.near} – ${s.far}` : "";
    ctx.font = font(800, 16 * u); const tw = ctx.measureText(title).width + title.length * 1.2 * u;
    ctx.font = font(700, 16 * u); const sw = ctx.measureText(score).width;
    const w = tw + sw + 64 * u, h = 40 * u;
    // portrait frames are too narrow for a top-centre banner next to the score bug: put it near the bottom
    const H = a.video.height;
    const x = W / 2 - w / 2, y = (W < H * 1.2 ? H - h - 44 * u : 20 * u) + (1 - k) * -12 * u;
    glass(ctx, x, y, w, h, h / 2, u);
    ctx.fillStyle = sideColor(win); ctx.beginPath(); ctx.arc(x + 20 * u, y + h / 2, 5 * u, 0, Math.PI * 2); ctx.fill();
    ctx.textBaseline = "middle"; ctx.fillStyle = C.text; ctx.font = font(800, 16 * u);
    spaced(ctx, title, x + 34 * u, y + h / 2 + 0.5 * u, 1.2 * u);
    ctx.fillStyle = C.dim; ctx.font = font(700, 16 * u); ctx.textAlign = "right";
    ctx.fillText(score, x + w - 18 * u, y + h / 2 + 0.5 * u);
    ctx.restore();
    return;
  }
}

function drawMinimap(ctx: CanvasRenderingContext2D, a: Analysis, idx: OverlayIndex, f: number, u: number, W: number): Rect {
  const fps = a.video.fps;
  const mh = 168 * u, mw = mh * (COURT.width / COURT.length);
  const pad = 12 * u;
  const bx = W - mw - pad * 2 - 20 * u, by = 20 * u;
  const bw = mw + pad * 2, bh = mh + pad * 2 + 14 * u;
  glass(ctx, bx, by, bw, bh, 14 * u, u);
  const x0 = bx + pad, y0 = by + pad + 7 * u;
  const map = (c: Pt): Pt => ({ x: x0 + (c.x / COURT.width) * mw, y: y0 + (1 - c.y / COURT.length) * mh });
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(x0, y0, mw, mh);
  ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1 * u;
  for (const [p, q] of courtLines(a.calibration.mode)) {
    const mp = map(p), mq = map(q);
    ctx.beginPath(); ctx.moveTo(mp.x, mp.y); ctx.lineTo(mq.x, mq.y); ctx.stroke();
  }
  const nl = map({ x: -0.15, y: COURT.netY }), nr = map({ x: COURT.width + 0.15, y: COURT.netY });
  ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = 2 * u;
  ctx.beginPath(); ctx.moveTo(nl.x, nl.y); ctx.lineTo(nr.x, nr.y); ctx.stroke();

  // where recent rallies ended: dot = in, cross = out
  const ended = a.rallies.filter((r) => r.endF <= f && r.landing?.court).slice(-6);
  ended.forEach((r, i) => {
    const m = map(clampCourt(r.landing!.court!));
    const fresh = i === ended.length - 1 && (f - r.endF) / fps < 2.5;
    ctx.globalAlpha = fresh ? 1 : 0.55;
    if (r.landing!.inBounds === false) {
      ctx.strokeStyle = "#fca5a5"; ctx.lineWidth = 1.6 * u; const d = 3.5 * u;
      ctx.beginPath(); ctx.moveTo(m.x - d, m.y - d); ctx.lineTo(m.x + d, m.y + d); ctx.moveTo(m.x + d, m.y - d); ctx.lineTo(m.x - d, m.y + d); ctx.stroke();
    } else {
      ctx.fillStyle = C.shuttle; ctx.beginPath(); ctx.arc(m.x, m.y, (fresh ? 3.5 : 2.5) * u, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  });

  // players with a short movement tail
  for (const arr of idx.series.values()) {
    const recent: PlayerSample[] = [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      if (p.f > f) continue;
      if (f - p.f > fps * 1.2) break;
      if (p.court) recent.push(p);
    }
    if (!recent.length || f - recent[0].f > fps * 0.5) continue;
    recent.reverse();
    const col = sideColor(recent[0].side);
    for (let i = 1; i < recent.length; i++) {
      const p0 = map(clampCourt(recent[i - 1].court!)), p1 = map(clampCourt(recent[i].court!));
      ctx.strokeStyle = col; ctx.globalAlpha = 0.5 * (i / recent.length); ctx.lineWidth = 2 * u;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const m = map(clampCourt(recent[recent.length - 1].court!));
    ctx.fillStyle = col; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5 * u;
    ctx.beginPath(); ctx.arc(m.x, m.y, 4.5 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  return { x: bx, y: by, w: bw, h: bh };
}

function clampCourt(c: Pt): Pt {
  return { x: Math.min(COURT.width + 0.8, Math.max(-0.8, c.x)), y: Math.min(COURT.length + 1.2, Math.max(-1.2, c.y)) };
}

/** 1080x1350 shareable summary card. */
type CanvasLike = { getContext(id: "2d"): unknown };
export function renderStatsCard(a: Analysis, unit?: OverlayOptions["speedUnit"]): HTMLCanvasElement;
export function renderStatsCard<T extends CanvasLike>(a: Analysis, unit: OverlayOptions["speedUnit"], make: (w: number, h: number) => T): T;
export function renderStatsCard(a: Analysis, unit: OverlayOptions["speedUnit"] = "kmh", make?: (w: number, h: number) => CanvasLike): CanvasLike {
  const cv: CanvasLike = make ? make(1080, 1350) : Object.assign(document.createElement("canvas"), { width: 1080, height: 1350 });
  const ctx = cv.getContext("2d") as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 1080, 1350);
  g.addColorStop(0, "#0c0c0f"); g.addColorStop(1, "#17171c");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1350);
  const last = a.score[a.score.length - 1];
  const name = (s: Side | null) => (s === "near" ? a.settings.nearLabel : s === "far" ? a.settings.farLabel : "—");
  const top = a.stats.topSpeedKmh !== null ? formatSpeed(a.stats.topSpeedKmh, unit) : null;

  ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = font(700, 26);
  spaced(ctx, "RALLYVISION", 80, 120, 4);
  ctx.fillStyle = "#fff"; ctx.font = font(800, 84);
  ctx.fillText(last ? `${last.near} – ${last.far}` : "0 – 0", 80, 250);
  ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = font(500, 32);
  ctx.fillText(`${a.settings.nearLabel}  vs  ${a.settings.farLabel}`, 80, 305);

  // hero: top speed
  ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.beginPath(); ctx.roundRect(80, 370, 920, 300, 36); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = font(700, 24);
  spaced(ctx, "TOP SHUTTLE SPEED", 128, 438, 3);
  ctx.fillStyle = C.shuttle; ctx.font = font(800, 150);
  const tv = top ? top.value : "—";
  ctx.fillText(tv, 120, 600);
  const tw = ctx.measureText(tv).width;
  ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.font = font(600, 40);
  ctx.fillText(top ? top.unit : "", 140 + tw, 600);
  ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = font(500, 26);
  ctx.fillText(top ? `by ${name(a.stats.topSpeedBy)} · estimated from one camera` : "not measured", 128, 640);

  const tiles: Array<[string, string, string]> = [
    ["RALLIES", `${a.stats.rallies}`, `${a.stats.shots} shots`],
    ["LONGEST RALLY", `${a.stats.longestRallyShots}`, `shots · ${a.stats.longestRallySec}s`],
    ["SMASHES", `${a.stats.smashes}`, a.stats.avgSpeedKmh ? `avg ${formatSpeed(a.stats.avgSpeedKmh, unit).value} ${formatSpeed(1, unit).unit}` : ""],
    ["DISTANCE", `${a.stats.playerDistanceM.near}m`, `${a.settings.nearLabel} · ${a.settings.farLabel} ${a.stats.playerDistanceM.far}m`],
  ];
  tiles.forEach(([k, v, sub], i) => {
    const x = 80 + (i % 2) * 470, y = 710 + Math.floor(i / 2) * 250;
    ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.beginPath(); ctx.roundRect(x, y, 450, 220, 32); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = font(700, 22); spaced(ctx, k, x + 40, y + 62, 3);
    ctx.fillStyle = "#fff"; ctx.font = font(800, 76); ctx.fillText(v, x + 36, y + 150);
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = font(500, 24); ctx.fillText(sub, x + 40, y + 192);
  });
  ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = font(500, 22);
  ctx.fillText(a.video.name.slice(0, 60), 80, 1280);
  return cv;
}
