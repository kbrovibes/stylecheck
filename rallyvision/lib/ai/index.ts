import type { Insights, MatchSummary } from "@/lib/ai/types";
import { mockInsights } from "@/lib/ai/mock";

export type ProviderName = "anthropic" | "gemini" | "mock";
export type InsightOptions = { provider?: string; model?: string };

const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

/** Picks the provider: the client's choice when its key exists, else AI_PROVIDER, else whichever key exists, else mock. */
export function resolveProvider(requested?: string): ProviderName {
  if (requested === "mock") return "mock";
  if (requested === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (requested === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  const forced = (process.env.AI_PROVIDER || "").toLowerCase();
  if (forced === "anthropic" || forced === "gemini" || forced === "mock") return forced;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "mock";
}

export async function generateInsights(s: MatchSummary, opts: InsightOptions = {}): Promise<Insights> {
  const provider = resolveProvider(opts.provider);
  try {
    if (provider === "anthropic") {
      const model = opts.model && CLAUDE_MODELS.includes(opts.model) ? opts.model : undefined;
      return await (await import("@/lib/ai/anthropic")).anthropicInsights(s, model);
    }
    if (provider === "gemini") return await (await import("@/lib/ai/gemini")).geminiInsights(s);
  } catch (e) {
    console.error(`[rallyvision] ${provider} insights failed, using mock:`, e);
    const m = mockInsights(s);
    m.caveats.unshift(`The ${provider} provider failed (${e instanceof Error ? e.message : "unknown error"}); showing template notes instead.`);
    return m;
  }
  return mockInsights(s);
}
