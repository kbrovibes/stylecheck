import { GoogleGenAI } from "@google/genai";
import { INSIGHTS_JSON_SCHEMA, type Insights, type MatchSummary } from "@/lib/ai/types";
import { COACH_SYSTEM, coachUserMessage } from "@/lib/ai/prompt";

export async function geminiInsights(s: MatchSummary): Promise<Insights> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const res = await ai.models.generateContent({
    model,
    contents: coachUserMessage(s),
    config: { systemInstruction: COACH_SYSTEM, responseMimeType: "application/json", responseJsonSchema: INSIGHTS_JSON_SCHEMA },
  });
  const text = res.text;
  if (!text) throw new Error("Empty Gemini response");
  const parsed = JSON.parse(text) as Omit<Insights, "provider" | "model">;
  return { ...parsed, provider: "gemini", model };
}
