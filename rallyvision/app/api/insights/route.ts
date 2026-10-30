import { NextResponse } from "next/server";
import { generateInsights, resolveProvider } from "@/lib/ai";
import type { MatchSummary } from "@/lib/ai/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ provider: resolveProvider() });
}

export async function POST(req: Request) {
  let body: MatchSummary;
  try {
    body = (await req.json()) as MatchSummary;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || !Array.isArray(body.rallies) || !body.stats) {
    return NextResponse.json({ error: "Expected a MatchSummary" }, { status: 400 });
  }
  if (JSON.stringify(body).length > 200_000) {
    return NextResponse.json({ error: "Summary too large" }, { status: 413 });
  }
  const insights = await generateInsights(body);
  return NextResponse.json(insights);
}
