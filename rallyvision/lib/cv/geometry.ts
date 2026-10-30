import { COURT, type CourtCalibration, type CourtMode, type Pt, type Side } from "@/lib/types";

/** Solve a 3x3 homography (row-major) mapping src[i] -> dst[i] via DLT (4+ points). */
export function computeHomography(src: Pt[], dst: Pt[]): number[] {
  if (src.length < 4 || src.length !== dst.length) throw new Error("need >= 4 point pairs");
  // Build A (2n x 9), solve A h = 0 via normal equations + inverse power iteration.
  const n = src.length;
  const A: number[][] = [];
  for (let i = 0; i < n; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([-x, -y, -1, 0, 0, 0, u * x, u * y, u]);
    A.push([0, 0, 0, -x, -y, -1, v * x, v * y, v]);
  }
  // For exactly 4 points, fix h33 = 1 and solve the 8x8 linear system; this is
  // robust enough for calibration and avoids an SVD implementation.
  const M: number[][] = [];
  const b: number[] = [];
  for (let r = 0; r < A.length; r++) {
    M.push(A[r].slice(0, 8));
    b.push(-A[r][8]);
  }
  const h = solveLeastSquares(M, b);
  return [...h, 1];
}

/** Least-squares solve (M^T M) x = M^T b with Gaussian elimination. */
function solveLeastSquares(M: number[][], b: number[]): number[] {
  const cols = M[0].length;
  const N: number[][] = Array.from({ length: cols }, () => new Array(cols + 1).fill(0));
  for (let r = 0; r < M.length; r++) {
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < cols; j++) N[i][j] += M[r][i] * M[r][j];
      N[i][cols] += M[r][i] * b[r];
    }
  }
  for (let c = 0; c < cols; c++) {
    let piv = c;
    for (let r = c + 1; r < cols; r++) if (Math.abs(N[r][c]) > Math.abs(N[piv][c])) piv = r;
    [N[c], N[piv]] = [N[piv], N[c]];
    const d = N[c][c] || 1e-12;
    for (let j = c; j <= cols; j++) N[c][j] /= d;
    for (let r = 0; r < cols; r++) {
      if (r === c) continue;
      const f = N[r][c];
      for (let j = c; j <= cols; j++) N[r][j] -= f * N[c][j];
    }
  }
  return N.map((row) => row[cols]);
}

export function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

export function applyH(H: number[], p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8] || 1e-12;
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

export function courtCorners(mode: CourtMode): [Pt, Pt, Pt, Pt] {
  const w = mode === "singles" ? COURT.singlesWidth : COURT.width;
  const x0 = (COURT.width - w) / 2;
  return [
    { x: x0, y: 0 },
    { x: x0 + w, y: 0 },
    { x: x0 + w, y: COURT.length },
    { x: x0, y: COURT.length },
  ];
}

export function buildCalibration(corners: [Pt, Pt, Pt, Pt], mode: CourtMode, source: CourtCalibration["source"]): CourtCalibration {
  const H = computeHomography(corners, courtCorners(mode));
  return { corners, mode, H, Hinv: invert3(H), source };
}

/** A reasonable default trapezoid for a camera behind the near baseline. */
export function defaultCorners(width: number, height: number): [Pt, Pt, Pt, Pt] {
  return [
    { x: width * 0.12, y: height * 0.92 },
    { x: width * 0.88, y: height * 0.92 },
    { x: width * 0.66, y: height * 0.42 },
    { x: width * 0.34, y: height * 0.42 },
  ];
}

export function toCourt(cal: CourtCalibration, p: Pt): Pt {
  return applyH(cal.H, p);
}
export function toImage(cal: CourtCalibration, c: Pt): Pt {
  return applyH(cal.Hinv, c);
}

export function sideOfCourtPoint(c: Pt): Side {
  return c.y < COURT.netY ? "near" : "far";
}

export function inBounds(c: Pt, mode: CourtMode, marginM = 0.25): boolean {
  const w = mode === "singles" ? COURT.singlesWidth : COURT.width;
  const x0 = (COURT.width - w) / 2;
  return c.x >= x0 - marginM && c.x <= x0 + w + marginM && c.y >= -marginM && c.y <= COURT.length + marginM;
}

/** All court line segments in court metres, for drawing. */
export function courtLines(mode: CourtMode): Array<[Pt, Pt]> {
  const L = COURT.length, W = COURT.width, sw = COURT.singlesWidth;
  const sx = (W - sw) / 2;
  const net = COURT.netY, ss = COURT.shortServiceFromNet, dl = COURT.doublesLongServiceFromBack;
  const lines: Array<[Pt, Pt]> = [
    [{ x: 0, y: 0 }, { x: W, y: 0 }], [{ x: 0, y: L }, { x: W, y: L }], // baselines
    [{ x: 0, y: 0 }, { x: 0, y: L }], [{ x: W, y: 0 }, { x: W, y: L }], // doubles sidelines
    [{ x: sx, y: 0 }, { x: sx, y: L }], [{ x: W - sx, y: 0 }, { x: W - sx, y: L }], // singles sidelines
    [{ x: 0, y: net }, { x: W, y: net }], // net
    [{ x: 0, y: net - ss }, { x: W, y: net - ss }], [{ x: 0, y: net + ss }, { x: W, y: net + ss }], // short service
    [{ x: 0, y: dl }, { x: W, y: dl }], [{ x: 0, y: L - dl }, { x: W, y: L - dl }], // doubles long service
    [{ x: W / 2, y: 0 }, { x: W / 2, y: net - ss }], [{ x: W / 2, y: net + ss }, { x: W / 2, y: L }], // centre lines
  ];
  void mode;
  return lines;
}

/** Metres per pixel at image point p along displacement d (ground-plane projection). */
export function groundSpeedMps(cal: CourtCalibration, a: Pt, b: Pt, dtSec: number): number {
  const ca = toCourt(cal, a), cb = toCourt(cal, b);
  return Math.hypot(cb.x - ca.x, cb.y - ca.y) / Math.max(dtSec, 1e-6);
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Order 4 arbitrary points into near-left, near-right, far-right, far-left (image coords, y down). */
export function orderCorners(pts: Pt[]): [Pt, Pt, Pt, Pt] {
  const s = [...pts].sort((a, b) => b.y - a.y);
  const near = s.slice(0, 2).sort((a, b) => a.x - b.x);
  const far = s.slice(2, 4).sort((a, b) => a.x - b.x);
  return [near[0], near[1], far[1], far[0]];
}
