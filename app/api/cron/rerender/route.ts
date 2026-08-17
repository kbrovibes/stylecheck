import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderOutfitRecord } from "@/lib/render";
import type { Outfit, Profile, Settings } from "@/lib/types";

export const maxDuration = 300;

/**
 * Batch re-render outfits (manual trigger, CRON_SECRET-authenticated; not on a
 * schedule). Re-renders outfits whose latest render predates `before` — call
 * repeatedly until `remaining` is 0. Powers "re-render everything after a
 * prompt/model change".
 *
 *   GET /api/cron/rerender?before=<ISO>&limit=3
 */
export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const before = url.searchParams.get("before");
  if (!before || Number.isNaN(Date.parse(before))) {
    return NextResponse.json({ error: "before=<ISO timestamp> required" }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 3, 1), 8);

  const admin = createAdminClient();
  const { data: outfitsData } = await admin
    .from("sc_outfits")
    .select("*")
    .eq("deleted", false)
    .order("created_at", { ascending: true });
  const outfits = (outfitsData ?? []) as Outfit[];

  // Latest render timestamp per outfit — only touch ones from before the cutoff.
  const { data: renders } = await admin
    .from("sc_renders")
    .select("subject_id, created_at")
    .eq("subject_type", "outfit")
    .order("created_at", { ascending: false });
  const latest = new Map<string, string>();
  for (const r of renders ?? []) {
    if (r.subject_id && !latest.has(r.subject_id)) latest.set(r.subject_id, r.created_at);
  }

  const queue = outfits.filter((o) => {
    const last = latest.get(o.id);
    return !last || Date.parse(last) < Date.parse(before);
  });

  const results: Record<string, string> = {};
  const profiles = new Map<string, Profile>();
  const settingsMap = new Map<string, Settings>();

  for (const outfit of queue.slice(0, limit)) {
    try {
      if (!profiles.has(outfit.user_id)) {
        const { data: p } = await admin
          .from("sc_profiles").select("*").eq("id", outfit.user_id).single();
        const { data: s } = await admin
          .from("sc_settings").select("*").eq("user_id", outfit.user_id).maybeSingle();
        profiles.set(outfit.user_id, p as Profile);
        settingsMap.set(
          outfit.user_id,
          (s ?? {
            provider: "gemini",
            text_model: "gemini-2.5-flash",
            image_model: "gemini-2.5-flash-image",
          }) as Settings
        );
      }
      await renderOutfitRecord(
        admin,
        outfit.user_id,
        outfit,
        profiles.get(outfit.user_id)!,
        settingsMap.get(outfit.user_id)!
      );
      results[outfit.id] = "done";
    } catch (e) {
      results[outfit.id] = `failed: ${(e as Error).message.slice(0, 120)}`;
    }
  }

  return NextResponse.json({
    processed: Object.keys(results).length,
    remaining: Math.max(0, queue.length - limit),
    results,
  });
}
