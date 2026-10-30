/**
 * Best-effort automatic court corner detection: find bright thin ridges
 * (court lines), run a Hough transform, pick the outermost near-horizontal
 * pair (baselines) and the two most-tilted opposing lines (sidelines), and
 * intersect them. Returns null when the result does not look like a court;
 * the UI then falls back to a default trapezoid that the user drags.
 */

import type { Pt } from "@/lib/types";
import { orderCorners } from "@/lib/cv/geometry";

type Line = { rho: number; theta: number; votes: number };

export function detectCourtCorners(image: ImageData): [Pt, Pt, Pt, Pt] | null {
  const { width: w, height: h, data } = image;
  const gray = new Float32Array(w * h);
  let sum = 0, sum2 = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const g = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    gray[j] = g; sum += g; sum2 += g * g;
  }
  const n = w * h, mean = sum / n, std = Math.sqrt(Math.max(1, sum2 / n - mean * mean));
  const brightThr = mean + 0.8 * std;
  const pts: Array<[number, number]> = [];
  const r = Math.max(3, Math.round(w / 180));
  for (let y = r; y < h - r; y += 1) {
    for (let x = r; x < w - r; x += 1) {
      const g = gray[y * w + x];
      if (g < brightThr) continue;
      const hz = g - Math.max(gray[y * w + x - r], gray[y * w + x + r]);
      const vt = g - Math.max(gray[(y - r) * w + x], gray[(y + r) * w + x]);
      if (hz > 35 || vt > 35) pts.push([x, y]);
    }
  }
  if (pts.length < 200) return null;
  // Hough
  const thetas = 180, rhoRes = 2;
  const diag = Math.hypot(w, h);
  const rhoBins = Math.ceil((2 * diag) / rhoRes);
  const acc = new Int32Array(thetas * rhoBins);
  const cosT = new Float32Array(thetas), sinT = new Float32Array(thetas);
  for (let t = 0; t < thetas; t++) { cosT[t] = Math.cos((t * Math.PI) / 180); sinT[t] = Math.sin((t * Math.PI) / 180); }
  const step = Math.max(1, Math.floor(pts.length / 6000));
  for (let i = 0; i < pts.length; i += step) {
    const [x, y] = pts[i];
    for (let t = 0; t < thetas; t++) {
      const rho = x * cosT[t] + y * sinT[t];
      const rb = Math.round((rho + diag) / rhoRes);
      acc[t * rhoBins + rb]++;
    }
  }
  const lines: Line[] = [];
  let maxVotes = 0;
  for (let i = 0; i < acc.length; i++) if (acc[i] > maxVotes) maxVotes = acc[i];
  const minVotes = Math.max(12, maxVotes * 0.18);
  for (let t = 0; t < thetas; t++) for (let rb = 1; rb < rhoBins - 1; rb++) {
    const v = acc[t * rhoBins + rb];
    if (v < minVotes) continue;
    // local max in a 5x5 neighbourhood (theta wraps)
    let isMax = true;
    for (let dt = -3; dt <= 3 && isMax; dt++) for (let dr = -3; dr <= 3; dr++) {
      const tt = (t + dt + thetas) % thetas, rr = rb + dr;
      if (rr < 0 || rr >= rhoBins || (dt === 0 && dr === 0)) continue;
      if (acc[tt * rhoBins + rr] > v) { isMax = false; break; }
    }
    if (isMax) lines.push({ rho: rb * rhoRes - diag, theta: (t * Math.PI) / 180, votes: v });
  }
  lines.sort((a, b) => b.votes - a.votes);
  const top = lines.slice(0, 24);
  const deg = (x: number) => (x * 180) / Math.PI;
  const horiz = top.filter((l) => Math.abs(deg(l.theta) - 90) < 22);
  const others = top.filter((l) => Math.abs(deg(l.theta) - 90) >= 22);
  if (horiz.length < 2 || others.length < 2) return null;
  const yAtCentre = (l: Line) => (l.rho - (w / 2) * Math.cos(l.theta)) / (Math.sin(l.theta) || 1e-6);
  const hs = horiz.slice(0, 8).sort((a, b) => yAtCentre(a) - yAtCentre(b));
  const far = hs[0], near = hs[hs.length - 1];
  if (yAtCentre(near) - yAtCentre(far) < h * 0.2) return null;
  // sidelines: pick the leftmost and rightmost at the near baseline's y
  const xAtY = (l: Line, y: number) => (l.rho - y * Math.sin(l.theta)) / (Math.cos(l.theta) || 1e-6);
  const yn = yAtCentre(near), yf = yAtCentre(far);
  const sides = others.filter((l) => {
    const xn = xAtY(l, yn), xf = xAtY(l, yf);
    return xn > -w * 0.5 && xn < w * 1.5 && xf > 0 && xf < w; // far end of the line must be inside the frame
  });
  if (sides.length < 2) return null;
  sides.sort((a, b) => xAtY(a, yn) - xAtY(b, yn));
  const left = sides[0], right = sides[sides.length - 1];
  const corners = [intersect(near, left), intersect(near, right), intersect(far, right), intersect(far, left)];
  if (corners.some((c) => !c || !Number.isFinite(c.x) || !Number.isFinite(c.y))) return null;
  const q = orderCorners(corners as Pt[]);
  const nearW = Math.abs(q[1].x - q[0].x), farW = Math.abs(q[2].x - q[3].x);
  if (nearW < w * 0.25 || farW < w * 0.08 || farW > nearW * 1.05) return null;
  if (q[0].y < q[3].y + h * 0.15) return null;
  return q;
}

function intersect(a: Line, b: Line): Pt | null {
  const ca = Math.cos(a.theta), sa = Math.sin(a.theta), cb = Math.cos(b.theta), sb = Math.sin(b.theta);
  const det = ca * sb - sa * cb;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (a.rho * sb - b.rho * sa) / det, y: (ca * b.rho - cb * a.rho) / det };
}
