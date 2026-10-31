/**
 * Shared analysis types. Every pixel coordinate is in ORIGINAL video pixels
 * unless a field is explicitly named `court` (metres on the court plane).
 */

export type Pt = { x: number; y: number };

export type Side = "near" | "far";

export type CourtMode = "singles" | "doubles";

/** Court plane coordinate system (metres): x across (0..6.1), y along (0..13.4). Near baseline is y=0. */
export const COURT = {
  length: 13.4,
  width: 6.1,
  singlesWidth: 5.18,
  netY: 6.7,
  shortServiceFromNet: 1.98,
  doublesLongServiceFromBack: 0.76,
  netHeightCentre: 1.524,
} as const;

export type CourtCalibration = {
  /** Image corners in order: near-left, near-right, far-right, far-left (from the camera's view). */
  corners: [Pt, Pt, Pt, Pt];
  mode: CourtMode;
  /** 3x3 row-major homography: image px -> court metres. */
  H: number[];
  /** Inverse: court metres -> image px. */
  Hinv: number[];
  source: "manual" | "auto" | "default";
};

export type ShuttleSample = {
  f: number;
  t: number;
  x: number;
  y: number;
  conf: number;
  /** true when the tracker coasted without a detection */
  interp: boolean;
  /** internal track id (lets the pipeline retract a track that turned out to be jitter) */
  tid?: number;
};

export type PlayerSample = {
  f: number;
  t: number;
  id: number;
  side: Side;
  box: { x: number; y: number; w: number; h: number };
  feet: Pt;
  court: Pt | null;
  /** 33 MediaPipe landmarks in image px (absent for motion-based detection) */
  landmarks?: Pt[];
  conf: number;
};

export type HitEvent = {
  f: number;
  t: number;
  pos: Pt;
  by: Side | null;
  /** peak estimated shuttle speed right after the hit; null if unmeasurable */
  speedKmh: number | null;
  /** speed in px/s on the original frame, for debugging */
  speedPx: number;
  /** crude classification from speed + direction */
  kind: "smash" | "drive" | "clear" | "drop" | "serve" | "shot";
  reliable: boolean;
};

export type Landing = {
  pt: Pt;
  court: Pt | null;
  inBounds: boolean | null;
  half: Side | null;
};

export type Rally = {
  id: number;
  startF: number;
  endF: number;
  startT: number;
  endT: number;
  hits: HitEvent[];
  landing: Landing | null;
  /** heuristic winner; null when the heuristic cannot decide */
  winner: Side | null;
  winnerReason: string;
  /** user override (wins over `winner`) */
  override?: Side | "skip" | null;
  maxSpeedKmh: number | null;
};

export type ScoreEntry = { f: number; t: number; near: number; far: number; server: Side; game: number; gamesNear: number; gamesFar: number };

export type VideoMeta = { width: number; height: number; fps: number; duration: number; frames: number; name: string };

export type EngineInfo = {
  shuttle: "classical" | "tracknet" | "cloud";
  players: "mediapipe" | "pose" | "motion" | "none";
  analysisWidth: number;
  stride: number;
  ms: number;
  /** tracker diagnostics (counts) */
  debug?: Record<string, number>;
};

export type Stats = {
  rallies: number;
  shots: number;
  longestRallyShots: number;
  longestRallySec: number;
  topSpeedKmh: number | null;
  topSpeedBy: Side | null;
  avgSpeedKmh: number | null;
  smashes: number;
  playerDistanceM: Record<Side, number>;
  /** 14 rows (along court, near->far) x 6 cols (across) landing counts */
  landingHeat: number[][];
};

export type Analysis = {
  version: 1;
  video: VideoMeta;
  calibration: CourtCalibration;
  shuttle: ShuttleSample[];
  players: PlayerSample[];
  hits: HitEvent[];
  rallies: Rally[];
  score: ScoreEntry[];
  stats: Stats;
  engine: EngineInfo;
  settings: AnalysisSettings;
};

export type AnalysisSettings = {
  mode: CourtMode;
  startServer: Side;
  nearLabel: string;
  farLabel: string;
  analysisWidth: number;
  /** process every Nth frame (1 = every frame) */
  stride: number;
  usePose: boolean;
  shuttleEngine: "classical" | "tracknet" | "cloud";
  pointsToWin: number;
};

export const DEFAULT_SETTINGS: AnalysisSettings = {
  mode: "singles",
  startServer: "near",
  nearLabel: "Near",
  farLabel: "Far",
  analysisWidth: 640,
  stride: 1,
  usePose: true,
  shuttleEngine: "classical",
  pointsToWin: 21,
};

export type Progress = { phase: string; done: number; total: number; detail?: string };
