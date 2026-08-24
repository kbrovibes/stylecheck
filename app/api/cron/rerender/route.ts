import { NextResponse } from "next/server";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderOutfitRecord } from "@/lib/render";
import { generateCatalogShotForItem } from "@/lib/catalog";
import type { Outfit, Person, Settings, WardrobeItem } from "@/lib/types";

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
  const catalogBatch = url.searchParams.get("catalog") === "1";
  const altBatch = url.searchParams.get("alt") === "1";
  // Owner-scoped backlog runs: ?user=<uuid> limits the queue to one account,
  // ?only=missing|unrendered fills gaps instead of re-doing existing work.
  const onlyUser = url.searchParams.get("user");
  const onlyMissing = url.searchParams.get("only") === "missing";
  const onlyUnrendered = url.searchParams.get("only") === "unrendered";
  const before = url.searchParams.get("before");
  if (
    !goofyBatch &&
    !catalogBatch &&
    !altBatch &&
    !onlyUnrendered &&
    (!before || Number.isNaN(Date.parse(before)))
  ) {
    return NextResponse.json({ error: "before=<ISO timestamp> required" }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 3, 1), 8);

  const admin = createAdminClient();

  // Catalogue uniformity batch: re-shoot garment product shots in the house
  // style. Cutoff (?before=) marks which items are already done, so the chain
  // is resumable and idempotent.
  if (catalogBatch) {
    const cutoff = before && !Number.isNaN(Date.parse(before)) ? Date.parse(before) : Date.now();
    let itemQuery = admin
      .from("sc_wardrobe_items")
      .select("*")
      .eq("deleted", false)
      .order("created_at", { ascending: true });
    // Gap-filling covers every category (footwear/accessories included); the
    // uniformity sweep stays limited to garments.
    if (!onlyMissing)
      itemQuery = itemQuery.in("category", ["top", "bottom", "outerwear", "full_body"]);
    if (onlyUser) itemQuery = itemQuery.eq("user_id", onlyUser);
    if (onlyMissing) itemQuery = itemQuery.is("catalog_image_path", null);
    const { data: itemsData } = await itemQuery;
    const items = (itemsData ?? []) as WardrobeItem[];
    const { data: shotRenders } = await admin
      .from("sc_renders")
      .select("subject_id, created_at")
      .eq("subject_type", "item_catalog")
      .order("created_at", { ascending: false });
    const latestShot = new Map<string, string>();
    for (const r of shotRenders ?? []) {
      if (r.subject_id && !latestShot.has(r.subject_id)) latestShot.set(r.subject_id, r.created_at);
    }
    const queue = onlyMissing
      ? items
      : items.filter((i) => {
          const last = latestShot.get(i.id);
          return !last || Date.parse(last) < cutoff;
        });
    const settingsCache = new Map<string, Settings>();
    const results: Record<string, string> = {};
    for (const item of queue.slice(0, limit)) {
      try {
        if (!settingsCache.has(item.user_id)) {
          const { data: st } = await admin
            .from("sc_settings").select("*").eq("user_id", item.user_id).maybeSingle();
          settingsCache.set(item.user_id, (st ?? {
            provider: "gemini",
            text_model: "gemini-2.5-flash",
            image_model: "gemini-2.5-flash-image",
          }) as Settings);
        }
        await generateCatalogShotForItem(admin, item.user_id, item, settingsCache.get(item.user_id)!);
        results[item.id] = "done";
      } catch (e) {
        results[item.id] = `failed: ${(e as Error).message.slice(0, 100)}`;
      }
    }
    const remaining = Math.max(0, queue.length - limit);
    const depth = Number(url.searchParams.get("depth")) || 0;
    if (remaining > 0 && depth < 60) {
      const next = new URL(request.url);
      next.searchParams.set("depth", String(depth + 1));
      next.searchParams.set("before", new Date(cutoff).toISOString());
      after(async () => {
        await fetch(next.toString(), {
          headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        }).catch(() => {});
      });
    }
    return NextResponse.json({ mode: "catalog", processed: Object.keys(results).length, remaining, results, depth });
  }

  let outfitQuery = admin
    .from("sc_outfits")
    .select("*")
    .eq("deleted", false)
    .order("created_at", { ascending: true });
  if (onlyUser) outfitQuery = outfitQuery.eq("user_id", onlyUser);
  if (onlyUnrendered) outfitQuery = outfitQuery.is("render_path", null);
  const { data: outfitsData } = await outfitQuery;
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

  // alt=1: gpt-image-1 comparison classics for owners with alt_render_async on
  let altQueue: Outfit[] = [];
  if (altBatch) {
    const { data: altOwners } = await admin
      .from("sc_settings")
      .select("user_id")
      .eq("alt_render_async", true);
    const ownerSet = new Set((altOwners ?? []).map((o) => o.user_id));
    const { data: gptRenders } = await admin
      .from("sc_renders")
      .select("subject_id")
      .eq("subject_type", "outfit")
      .like("model", "gpt%")
      .eq("deleted", false);
    const hasGpt = new Set((gptRenders ?? []).map((r) => r.subject_id));
    altQueue = outfits.filter(
      (o) => o.render_path && ownerSet.has(o.user_id) && !hasGpt.has(o.id)
    );
  }

  const queue = altBatch
    ? altQueue
    : goofyBatch
    ? outfits.filter((o) => !o.goofy_render_path)
    : onlyUnrendered
    ? outfits
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
  if (remaining > 0 && depth < 60) {
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
