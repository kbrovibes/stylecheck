import { NextResponse } from "next/server";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { composeOutfits } from "@/lib/ai";
import { renderOutfitRecord } from "@/lib/render";
import { getWeather } from "@/lib/weather";
import type { Outfit, Person, Settings, WardrobeItem } from "@/lib/types";

export const maxDuration = 300;

const DEFAULT_SETTINGS = {
  provider: "gemini",
  text_model: "gemini-2.5-flash",
  image_model: "gemini-3-pro-image-preview",
} as Settings;

/**
 * Nightly restyle (2am PT cron). Only acts for accounts that queued a restyle
 * (sc_settings.restyle_requested_at): for each of the account's people,
 * soft-deletes their current fits, composes a fresh set with the latest styling
 * context (age, weather, wardrobe), then renders each — self-chaining across
 * invocations to beat maxDuration.
 */
export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const depth = Number(url.searchParams.get("depth")) || 0;
  const admin = createAdminClient();

  const summary: Record<string, string> = {};

  // Phase 1: compose for accounts with a queued restyle — every person they own.
  const { data: queued } = await admin
    .from("sc_settings")
    .select("*")
    .not("restyle_requested_at", "is", null);
  for (const s of (queued ?? []) as Settings[]) {
    try {
      const { data: peopleData } = await admin
        .from("sc_people")
        .select("*")
        .eq("owner_id", s.user_id)
        .eq("deleted", false);
      for (const person of (peopleData ?? []) as Person[]) {
        try {
          const { data: itemsData } = await admin
            .from("sc_wardrobe_items")
            .select("*")
            .eq("person_id", person.id)
            .eq("deleted", false)
            .eq("enabled", true);
          const items = (itemsData ?? []) as WardrobeItem[];
          if (items.length < 3) {
            summary[person.id] = "too few items";
            continue;
          }
          let weather = null;
          if (person.lat && person.lon && person.place_name) {
            weather = await getWeather({
              lat: person.lat,
              lon: person.lon,
              place: person.place_name,
            }).catch(() => null);
          }
          const plans = await composeOutfits(s, {
            profile: person,
            items,
            weather,
            count: 10,
          });
          // Retire the old set (soft delete — renders and history retained).
          await admin
            .from("sc_outfits")
            .update({ deleted: true })
            .eq("person_id", person.id)
            .eq("deleted", false);
          for (const plan of plans) {
            await admin.from("sc_outfits").insert({
              user_id: s.user_id,
              person_id: person.id,
              title: plan.title,
              item_ids: plan.item_ids,
              occasion: plan.occasion,
              seasons: plan.seasons,
              explanation: plan.explanation,
              styling_notes: plan.styling_notes,
              weather_note: plan.weather_note,
              variations: plan.variations,
              score: plan.score,
              render_status: "none",
            });
          }
          summary[person.id] = `composed ${plans.length}`;
        } catch (e) {
          summary[person.id] = `compose error: ${(e as Error).message.slice(0, 120)}`;
        }
      }
      await admin
        .from("sc_settings")
        .update({ restyle_requested_at: null })
        .eq("user_id", s.user_id);
    } catch (e) {
      summary[s.user_id] = `account error: ${(e as Error).message.slice(0, 120)}`;
    }
  }

  // Phase 2: render up to 2 unrendered fits, then self-chain if more remain.
  const { data: pendingData } = await admin
    .from("sc_outfits")
    .select("*")
    .eq("deleted", false)
    .is("render_path", null)
    .order("created_at", { ascending: true });
  const pending = ((pendingData ?? []) as Outfit[]).filter((o) => o.person_id);

  for (const outfit of pending.slice(0, 1)) {
    try {
      const { data: p } = await admin
        .from("sc_people")
        .select("*")
        .eq("id", outfit.person_id!)
        .single();
      const person = p as Person;
      const { data: st } = await admin
        .from("sc_settings")
        .select("*")
        .eq("user_id", person.owner_id)
        .maybeSingle();
      await renderOutfitRecord(
        admin,
        person.owner_id,
        outfit,
        person,
        (st ?? DEFAULT_SETTINGS) as Settings
      );
      summary[`render:${outfit.id}`] = "done";
    } catch (e) {
      summary[`render:${outfit.id}`] = `failed: ${(e as Error).message.slice(0, 100)}`;
    }
  }

  const remaining = Math.max(0, pending.length - 1);
  if (remaining > 0 && depth < 60) {
    const next = new URL(request.url);
    next.searchParams.set("depth", String(depth + 1));
    after(async () => {
      await fetch(next.toString(), {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }).catch(() => {});
    });
  }

  return NextResponse.json({ summary, remaining, depth });
}
