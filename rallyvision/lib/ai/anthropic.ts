import Anthropic from "@anthropic-ai/sdk";
import { INSIGHTS_JSON_SCHEMA, type Insights, type MatchSummary } from "@/lib/ai/types";
import { COACH_SYSTEM, coachUserMessage } from "@/lib/ai/prompt";

export async function anthropicInsights(s: MatchSummary): Promise<Insights> {
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
  const response = await client.beta.messages.create({
    model,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: COACH_SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: INSIGHTS_JSON_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content: coachUserMessage(s) }],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to write notes for this input.");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No text in model response");
  const parsed = JSON.parse(text.text) as Omit<Insights, "provider" | "model">;
  return { ...parsed, provider: "anthropic", model: response.model };
}
