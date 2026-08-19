import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { composeOutfits } from "@/lib/ai";
import { geminiJson } from "@/lib/ai/gemini";
import { reviveOutfitPrompt } from "@/lib/ai/prompts";
import { getWeather } from "@/lib/weather";
import type { Outfit, Person, Settings, WardrobeItem } from "@/lib/types";

export const maxDuration = 300;

const DEFAULT_SETTINGS = {
  provider: "gemini",
  text_model: "gemini-2.5-flash",
  image_model: "gemini-3-pro-image-preview",
} as Settings;

/**
 * Wardrobe groom (manual trigger, CRON_SECRET): for every person —
 * 1) fits referencing removed pieces are revived with a stylist swap when a
 *    coherent replacement exists, else retired;
 * 2) the collection is backfilled with fresh fits up to ?target= (default 30)
 *    for people with enough items.
 * Rendering is deferred: revived/new fits get null render pointers and the
 * restyle/goofy batch endpoints pick them up.
 */
export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const target = Math.min(Math.max(Number(url.searchParams.get("target")) || 30, 4), 60);

  const admin = createAdminClient();
  const { data: peopleData } = await admin
    .from("sc_people")
    .select("*")
    .eq("deleted", false);
  const summary: Record<string, string> = {};

  for (const person of (peopleData ?? []) as Person[]) {
    try {
      const { data: s } = await admin
        .from("sc_settings")
        .select("*")
        .eq("user_id", person.owner_id)
        .maybeSingle();
      const settings = (s ?? DEFAULT_SETTINGS) as Settings;

      const { data: liveData } = await admin
        .from("sc_wardrobe_items")
        .select("*")
        .eq("person_id", person.id)
        .eq("deleted", false)
        .eq("enabled", true);
      const liveItems = (liveData ?? []) as WardrobeItem[];
      const liveIds = new Set(liveItems.map((i) => i.id));

      const { data: outfitsData } = await admin
        .from("sc_outfits")
        .select("*")
        .eq("person_id", person.id)
        .eq("deleted", false);
      const outfits = (outfitsData ?? []) as Outfit[];

      let revived = 0;
      let retired = 0;
      for (const outfit of outfits) {
        const deadIds = outfit.item_ids.filter((iid) => !liveIds.has(iid));
        if (!deadIds.length) continue;
        const keptItems = liveItems.filter((i) => outfit.item_ids.includes(i.id));
        const candidates = liveItems.filter((i) => !outfit.item_ids.includes(i.id));
        let done = false;
        if (candidates.length && keptItems.length) {
          try {
            const res = await geminiJson<{
              replacement_ids: string[];
              explanation: string;
              styling_notes: string;
            }>({
              model: settings.text_model,
              prompt: reviveOutfitPrompt({
                outfit,
                deadItemIds: deadIds,
                liveItems: candidates,
                keptItems,
              }),
            });
            const reps = (res.replacement_ids ?? []).filter((rid) => liveIds.has(rid));
            if (reps.length) {
              await admin
                .from("sc_outfits")
                .update({
                  item_ids: [
                    ...outfit.item_ids.filter((iid) => liveIds.has(iid)),
                    ...reps,
                  ],
                  explanation: res.explanation ?? outfit.explanation,
                  styling_notes: res.styling_notes ?? outfit.styling_notes,
                  variations: [],
                  render_path: null,
                  goofy_render_path: null,
                  render_status: "none",
                })
                .eq("id", outfit.id);
              revived++;
              done = true;
            }
          } catch {
            // fall through to retire
          }
        }
        if (!done) {
          await admin.from("sc_outfits").update({ deleted: true }).eq("id", outfit.id);
          retired++;
        }
      }

      // Backfill fresh fits for people with a real wardrobe.
      let composed = 0;
      const activeCount = outfits.length - retired;
      if (liveItems.length >= 6 && activeCount < target) {
        const need = Math.min(target - activeCount, 16);
        const weather =
          person.lat && person.lon && person.place_name
            ? await getWeather({
                lat: person.lat,
                lon: person.lon,
                place: person.place_name,
              }).catch(() => null)
            : null;
        const plans = await composeOutfits(settings, {
          profile: person,
          items: liveItems,
          weather,
          count: need,
        });
        for (const plan of plans) {
          await admin.from("sc_outfits").insert({
            user_id: person.owner_id,
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
          composed++;
        }
      }
      summary[person.id] = `revived ${revived}, retired ${retired}, composed ${composed}`;
    } catch (e) {
      summary[person.id] = `error: ${(e as Error).message.slice(0, 120)}`;
    }
  }
  return NextResponse.json({ summary });
}
