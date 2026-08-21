import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { composeOutfits } from "@/lib/ai";
import { geminiJson } from "@/lib/ai/gemini";
import { relabelOccasionsPrompt, reviveOutfitPrompt } from "@/lib/ai/prompts";
import { getWeather } from "@/lib/weather";
import type { Occasion, Outfit, Person, Settings, WardrobeItem } from "@/lib/types";

const OCCASIONS = ["work", "casual", "friends", "date", "active", "lounge"] as const;

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
  const audit = url.searchParams.get("audit") === "1";

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

      const weather =
        person.lat && person.lon && person.place_name
          ? await getWeather({
              lat: person.lat,
              lon: person.lon,
              place: person.place_name,
            }).catch(() => null)
          : null;

      // Backfill fresh fits for people with a real wardrobe.
      let composed = 0;
      const activeCount = outfits.length - retired;
      if (liveItems.length >= 6 && activeCount < target) {
        const need = Math.min(target - activeCount, 16);
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
      let auditNote = "";
      if (audit) {
        // --- Relabel pass: correct occasion labels in one batched call ---
        const { data: freshData } = await admin
          .from("sc_outfits")
          .select("*")
          .eq("person_id", person.id)
          .eq("deleted", false);
        const fresh = (freshData ?? []) as Outfit[];
        const itemName = new Map(
          liveItems.map((i) => [i.id, `${i.name ?? i.subcategory ?? i.category} (${i.category})`])
        );
        let relabeled = 0;
        if (fresh.length) {
          try {
            const res = await geminiJson<{
              corrections: { id: string; occasion: string }[];
            }>({
              model: settings.text_model,
              prompt: relabelOccasionsPrompt(
                fresh.map((f) => ({
                  id: f.id,
                  title: f.title,
                  occasion: f.occasion,
                  itemSummary: f.item_ids
                    .map((iid) => itemName.get(iid))
                    .filter(Boolean)
                    .join(", "),
                }))
              ),
            });
            const fitIds = new Set(fresh.map((f) => f.id));
            for (const c of res.corrections ?? []) {
              if (!fitIds.has(c.id)) continue;
              if (!(OCCASIONS as readonly string[]).includes(c.occasion)) continue;
              await admin
                .from("sc_outfits")
                .update({ occasion: c.occasion })
                .eq("id", c.id);
              const local = fresh.find((f) => f.id === c.id);
              if (local) local.occasion = c.occasion as Occasion;
              relabeled++;
            }
          } catch {
            // relabel is best-effort; gap-fill still runs on current labels
          }
        }

        // --- Occasion gap-fill: ensure ≥3 fits per core occasion ---
        const athleticCapable =
          liveItems.filter(
            (i) =>
              i.formality === "athletic" ||
              i.style_tags.some((t) => /athletic|sporty/i.test(t))
          ).length >= 3;
        const gapOccasions: Occasion[] = ["work", "casual", "friends", "date"];
        if (athleticCapable) gapOccasions.push("active");

        const added: string[] = [];
        let gapBudget = 12;
        for (const occ of gapOccasions) {
          if (gapBudget <= 0 || liveItems.length < 6) break;
          const have = fresh.filter((f) => f.occasion === occ).length;
          if (have >= 3) continue;
          const want = Math.min(3 - have + 1, gapBudget);
          try {
            const plans = await composeOutfits(settings, {
              profile: person,
              items: liveItems,
              weather,
              count: want,
              occasion: occ,
            });
            let inserted = 0;
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
              inserted++;
              gapBudget--;
            }
            if (inserted) added.push(`+${inserted} ${occ}`);
          } catch {
            // one occasion failing shouldn't sink the audit
          }
        }
        auditNote = `, audit: ${relabeled} relabeled${added.length ? ", " + added.join(", ") : ""}`;
      }

      summary[person.id] = `revived ${revived}, retired ${retired}, composed ${composed}${auditNote}`;
    } catch (e) {
      summary[person.id] = `error: ${(e as Error).message.slice(0, 120)}`;
    }
  }
  return NextResponse.json({ summary });
}
