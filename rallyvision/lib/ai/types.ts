import type { Analysis } from "@/lib/types";

/** Compact, token-cheap summary of an analysis sent to the insights endpoint. */
export type MatchSummary = {
  video: { name: string; durationSec: number; fps: number };
  labels: { near: string; far: string };
  mode: "singles" | "doubles";
  finalScore: { near: number; far: number; gamesNear: number; gamesFar: number };
  stats: Analysis["stats"];
  rallies: Array<{
    id: number;
    startSec: number;
    endSec: number;
    shots: number;
    maxSpeedKmh: number | null;
    winner: "near" | "far" | null;
    reason: string;
    landing: { x: number; y: number; inBounds: boolean | null } | null;
  }>;
  topShots: Array<{ atSec: number; by: "near" | "far" | null; kind: string; speedKmh: number | null }>;
  engine: Analysis["engine"];
};

export type Insights = {
  headline: string;
  summary: string;
  highlights: Array<{ atSec: number; title: string; detail: string }>;
  tips: Array<{ side: "near" | "far"; tip: string }>;
  caveats: string[];
  provider: "anthropic" | "gemini" | "mock";
  model: string;
};

export const INSIGHTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "summary", "highlights", "tips", "caveats"],
  properties: {
    headline: { type: "string", description: "One punchy line, max 12 words, like a reel caption." },
    summary: { type: "string", description: "2-4 sentences about how the match/rallies went." },
    highlights: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["atSec", "title", "detail"],
        properties: { atSec: { type: "number" }, title: { type: "string" }, detail: { type: "string" } },
      },
    },
    tips: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["side", "tip"],
        properties: { side: { type: "string", enum: ["near", "far"] }, tip: { type: "string" } },
      },
    },
    caveats: { type: "array", items: { type: "string" }, maxItems: 3 },
  },
} as const;

export function summarize(a: Analysis): MatchSummary {
  const last = a.score[a.score.length - 1];
  const topShots = [...a.hits]
    .filter((h) => h.speedKmh !== null)
    .sort((x, y) => (y.speedKmh ?? 0) - (x.speedKmh ?? 0))
    .slice(0, 6)
    .map((h) => ({ atSec: round(h.t), by: h.by, kind: h.kind, speedKmh: h.speedKmh }));
  return {
    video: { name: a.video.name, durationSec: round(a.video.duration), fps: a.video.fps },
    labels: { near: a.settings.nearLabel, far: a.settings.farLabel },
    mode: a.settings.mode,
    finalScore: last ? { near: last.near, far: last.far, gamesNear: last.gamesNear, gamesFar: last.gamesFar } : { near: 0, far: 0, gamesNear: 0, gamesFar: 0 },
    stats: a.stats,
    rallies: a.rallies.map((r) => ({
      id: r.id,
      startSec: round(r.startT),
      endSec: round(r.endT),
      shots: r.hits.length,
      maxSpeedKmh: r.maxSpeedKmh,
      winner: r.override && r.override !== "skip" ? r.override : r.override === "skip" ? null : r.winner,
      reason: r.winnerReason,
      landing: r.landing?.court ? { x: round(r.landing.court.x), y: round(r.landing.court.y), inBounds: r.landing.inBounds } : null,
    })),
    topShots,
    engine: a.engine,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
