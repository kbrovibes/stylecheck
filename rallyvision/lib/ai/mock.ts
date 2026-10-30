import type { Insights, MatchSummary } from "@/lib/ai/types";

/**
 * Deterministic, template-based "coach" used when no AI key is configured.
 * It only states things the analysis actually measured.
 */
export function mockInsights(s: MatchSummary): Insights {
  const { near, far } = s.labels;
  const lead = s.finalScore.near === s.finalScore.far ? null : s.finalScore.near > s.finalScore.far ? near : far;
  const top = s.topShots[0];
  const longest = [...s.rallies].sort((a, b) => b.shots - a.shots)[0];
  const headline = top?.speedKmh
    ? `${top.speedKmh} km/h ${top.kind} headlines a ${s.rallies.length}-rally session`
    : `${s.rallies.length} rallies, ${s.stats.shots} shots tracked`;
  const summaryParts = [
    `${s.rallies.length} rallies were detected across ${s.video.durationSec}s of video, with ${s.stats.shots} shots in total.`,
    lead ? `${lead} finished ahead ${Math.max(s.finalScore.near, s.finalScore.far)}–${Math.min(s.finalScore.near, s.finalScore.far)} on the heuristic score.` : `The heuristic score finished level at ${s.finalScore.near}–${s.finalScore.far}.`,
    longest ? `The longest exchange ran ${longest.shots} shots (${longest.endSec - longest.startSec}s).` : "",
    s.stats.topSpeedKmh ? `Peak shuttle speed was an estimated ${s.stats.topSpeedKmh} km/h by ${s.stats.topSpeedBy === "near" ? near : far}.` : "",
  ].filter(Boolean);
  const highlights = s.topShots.slice(0, 3).map((h) => ({
    atSec: h.atSec,
    title: `${h.speedKmh} km/h ${h.kind}`,
    detail: `${h.by === "near" ? near : h.by === "far" ? far : "Unknown player"} — one of the fastest shots in the clip.`,
  }));
  if (longest) highlights.push({ atSec: longest.startSec, title: `${longest.shots}-shot rally`, detail: `Longest rally of the clip, won by ${longest.winner === "near" ? near : longest.winner === "far" ? far : "nobody (undecided)"}.` });
  const outs = s.rallies.filter((r) => r.landing && r.landing.inBounds === false);
  const nets = s.rallies.filter((r) => /did not cross/.test(r.reason));
  const tips: Insights["tips"] = [];
  const loserOf = (r: MatchSummary["rallies"][number]) => (r.winner === "near" ? "far" : r.winner === "far" ? "near" : null);
  const outLosers = outs.map(loserOf).filter(Boolean) as Array<"near" | "far">;
  const netLosers = nets.map(loserOf).filter(Boolean) as Array<"near" | "far">;
  const most = (arr: Array<"near" | "far">) => (arr.filter((x) => x === "near").length >= arr.filter((x) => x === "far").length ? "near" : "far");
  if (outLosers.length) tips.push({ side: most(outLosers), tip: `${outLosers.length} rall${outLosers.length === 1 ? "y" : "ies"} ended with a shot landing out. Aim for a bigger margin inside the lines on attacking shots.` });
  if (netLosers.length) tips.push({ side: most(netLosers), tip: `${netLosers.length} rall${netLosers.length === 1 ? "y" : "ies"} ended at the net. Lift higher when under pressure instead of forcing tight net shots.` });
  if (s.stats.playerDistanceM.near && s.stats.playerDistanceM.far) {
    const busier = s.stats.playerDistanceM.near > s.stats.playerDistanceM.far ? "near" : "far";
    tips.push({ side: busier, tip: `${busier === "near" ? near : far} covered the most ground (${Math.max(s.stats.playerDistanceM.near, s.stats.playerDistanceM.far)} m). Recover to base position between shots to save energy.` });
  }
  if (!tips.length) tips.push({ side: "near", tip: "Record from behind the baseline, slightly elevated, so the whole court is in frame — tracking and speed estimates get much better." });
  return {
    headline,
    summary: summaryParts.join(" "),
    highlights: highlights.slice(0, 5),
    tips: tips.slice(0, 4),
    caveats: [
      "These notes are generated from measured stats only (no AI key configured).",
      "Speeds are single-camera ground-plane estimates and can be off by 15-30%.",
    ],
    provider: "mock",
    model: "template-v1",
  };
}
