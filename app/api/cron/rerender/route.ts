import { NextResponse } from "next/server";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderOutfitRecord } from "@/lib/render";
import type { Outfit, Person, Settings } from "@/lib/types";

export const maxDuration = 300;

const DEFAULT_SETTINGS = {
  provider: "gemini",
  text_model: "gemini-2.5-flash",
  image_model: "gemini-3-pro-image-preview",
} as Settings;

/**
 * Batch re-render outfits (manual trigger, CRON_SECRET-authenticated; not on a
 * schedule). Re-renders outfits whose latest render predates `before` — call
 * repeatedly until `remaining` is 0. Powers "re-render everything after a
 * prompt/model change". With ?goofy=1, generates missing goofy takes instead.
 *
 *   GET /api/cron/rerender?before=<ISO>&limit=3
 *   GET /api/cron/rerender?goofy=1&limit=3
 */
export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const goofyBatch = url.searchParams.get("goofy") === "1";
  const before = url.searchParams.get("before");
  if (!goofyBatch && (!before || Number.isNaN(Date.parse(before)))) {
    return NextResponse.json({ error: "before=<ISO timestamp> required" }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 3, 1), 8);

  const admin = createAdminClient();
  const { data: outfitsData } = await admin
    .from("sc_outfits")
    .select("*")
    .eq("deleted", false)
    .order("created_at", { ascending: true });
  const outfits = ((outfitsData ?? []) as Outfit[]).filter((o) => o.person_id);

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

  const queue = goofyBatch
    ? outfits.filter((o) => !o.goofy_render_path)
    : outfits.filter((o) => {
        const last = latest.get(o.id);
        return !last || Date.parse(last) < Date.parse(before!);
      });

  const results: Record<string, string> = {};
  const peopleById = new Map<string, Person>();
  const settingsByOwner = new Map<string, Settings>();

  for (const outfit of queue.slice(0, limit)) {
    try {
      if (!peopleById.has(outfit.person_id!)) {
        const { data: p } = await admin
          .from("sc_people")
          .select("*")
          .eq("id", outfit.person_id!)
          .single();
        peopleById.set(outfit.person_id!, p as Person);
      }
      const person = peopleById.get(outfit.person_id!)!;
      if (!settingsByOwner.has(person.owner_id)) {
        const { data: s } = await admin
          .from("sc_settings")
          .select("*")
          .eq("user_id", person.owner_id)
          .maybeSingle();
        settingsByOwner.set(person.owner_id, (s ?? DEFAULT_SETTINGS) as Settings);
      }
      await renderOutfitRecord(
        admin,
        person.owner_id,
        outfit,
        person,
        settingsByOwner.get(person.owner_id)!,
        { goofy: goofyBatch }
      );
      results[outfit.id] = "done";
    } catch (e) {
      results[outfit.id] = `failed: ${(e as Error).message.slice(0, 120)}`;
    }
  }

  const remaining = Math.max(0, queue.length - limit);
  const depth = Number(url.searchParams.get("depth")) || 0;
  if (remaining > 0 && depth < 25) {
    const next = new URL(request.url);
    next.searchParams.set("depth", String(depth + 1));
    after(async () => {
      await fetch(next.toString(), {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }).catch(() => {});
    });
  }
  return NextResponse.json({
    processed: Object.keys(results).length,
    remaining,
    results,
    depth,
  });
}
