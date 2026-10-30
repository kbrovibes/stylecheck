import type { Insights, MatchSummary } from "@/lib/ai/types";
import { mockInsights } from "@/lib/ai/mock";

export type ProviderName = "anthropic" | "gemini" | "mock";

/** Picks the provider: explicit AI_PROVIDER, else whichever key exists, else mock. */
export function resolveProvider(): ProviderName {
  const forced = (process.env.AI_PROVIDER || "").toLowerCase();
  if (forced === "anthropic" || forced === "gemini" || forced === "mock") return forced;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "mock";
}

export async function generateInsights(s: MatchSummary): Promise<Insights> {
  const provider = resolveProvider();
  try {
    if (provider === "anthropic") return (await import("@/lib/ai/anthropic")).anthropicInsights(s);
    if (provider === "gemini") return (await import("@/lib/ai/gemini")).geminiInsights(s);
  } catch (e) {
    console.error(`[rallyvision] ${provider} insights failed, using mock:`, e);
    const m = mockInsights(s);
    m.caveats.unshift(`The ${provider} provider failed (${e instanceof Error ? e.message : "unknown error"}); showing template notes instead.`);
    return m;
  }
  return mockInsights(s);
}
