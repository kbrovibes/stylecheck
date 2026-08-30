import { NextResponse } from "next/server";
import { creditErrorResponse, spendCredit } from "@/lib/credits";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { canManage, getActivePerson } from "@/lib/person";
import { composeOutfits } from "@/lib/ai";
import { getWeather } from "@/lib/weather";
import { blockingGaps, computeCoverage } from "@/lib/coverage";
import { RENDER_ISSUE_REASON, type UserPhoto, type WardrobeItem, type WeatherInfo } from "@/lib/types";
import { stripIncompatibleItems } from "@/lib/ai/ethnic";

export const maxDuration = 300;

export async function POST(request: Request) {
  let supabase, user;
  try {
    ({ supabase, user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await spendCredit(supabase, user, "text");
  } catch (e) {
    const c = creditErrorResponse(e);
    if (c) return NextResponse.json({ error: c.error }, { status: 429 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body.count) || 16, 1), 24);
    const occasion =
      typeof body.occasion === "string" && body.occasion.length
        ? body.occasion
        : undefined;

    const { person, role } = await getActivePerson(supabase, user);
    if (!canManage(role)) {
      return NextResponse.json(
        { error: "You have view-only access to this profile." },
        { status: 403 }
      );
    }
    const [settings, { data: itemsData }] = await Promise.all([
      getOrCreateSettings(supabase, user.id),
      supabase
        .from("sc_wardrobe_items")
        .select("*")
        .eq("person_id", person.id)
        .eq("deleted", false)
        .eq("enabled", true),
    ]);
    const items = (itemsData ?? []) as WardrobeItem[];
    {
      const { data: photosData } = await supabase
        .from("sc_user_photos")
        .select("id, kind, deleted")
        .eq("person_id", person.id)
        .eq("deleted", false);
      const cov = computeCoverage(items, (photosData ?? []) as UserPhoto[]);
      const gaps = blockingGaps(cov).filter((g) => !g.includes("photo"));
      if (gaps.length) {
        return NextResponse.json(
          {
            error: `Not quite enough to style yet — add ${gaps.join(", ")}. The Today page shows exactly what's missing.`,
          },
          { status: 400 }
        );
      }
    }

    let weather: WeatherInfo | null = null;
    if (person.lat && person.lon && person.place_name) {
      try {
        weather = await getWeather({
          lat: person.lat,
          lon: person.lon,
          place: person.place_name,
        });
      } catch {
        weather = null;
      }
    }

    // focus: "unused" — force fits around pieces not yet styled into any fit.
    let mustFeature: string[] | undefined;
    let effectiveCount = count;
    if (body.focus === "unused") {
      const { data: activeOutfits } = await supabase
        .from("sc_outfits")
        .select("item_ids")
        .eq("person_id", person.id)
        .eq("deleted", false);
      const used = new Set(
        (activeOutfits ?? []).flatMap((o) => o.item_ids as string[])
      );
      const unused = items.filter((i) => !used.has(i.id)).map((i) => i.id);
      if (!unused.length) {
        return NextResponse.json(
          { error: "Every piece is already styled into at least one fit." },
          { status: 400 }
        );
      }
      mustFeature = unused;
      effectiveCount = Math.min(Math.ceil(unused.length / 2) + 2, 16);
    }

    const { data: dislikedData } = await supabase
      .from("sc_outfits")
      .select("title, item_ids, dislike_reasons, dislike_note")
      .eq("person_id", person.id)
      .eq("reaction", -1)
      .limit(15);
    const nameById = new Map(items.map((i) => [i.id, i.name ?? i.subcategory ?? i.category]));
    const dislikes = (dislikedData ?? [])
      .filter((d) => {
        // A complaint about the image alone doesn't condemn the combination.
        const reasons = (d.dislike_reasons ?? []) as string[];
        return !(
          reasons.length > 0 &&
          reasons.every((r) => r === RENDER_ISSUE_REASON) &&
          !d.dislike_note
        );
      })
      .map((d) => {
        const pieces = (d.item_ids as string[])
          .map((iid) => nameById.get(iid))
          .filter(Boolean)
          .join(" + ");
        const reasons = ((d.dislike_reasons ?? []) as string[]).filter(
          (r) => r !== RENDER_ISSUE_REASON
        );
        const why = [
          reasons.length ? `reasons: ${reasons.join("; ")}` : "",
          d.dislike_note ? `their words: "${d.dislike_note}"` : "",
        ]
          .filter(Boolean)
          .join(" — ");
        return `${d.title}: ${pieces}${why ? ` (${why})` : ""}`;
      });
    const plans = await composeOutfits(settings, {
      profile: person,
      items,
      weather,
      count: effectiveCount,
      occasion,
      dislikes,
      mustFeature,
    });
    if (!plans.length) {
      return NextResponse.json(
        {
          error:
            "The stylist couldn't assemble looks from the current wardrobe — try adding more variety.",
        },
        { status: 502 }
      );
    }

    // A dhoti takes no belt. The stylist is told this, but models still reach
    // for one whenever a belt exists in the wardrobe — so enforce it here.
    const itemById = new Map(items.map((i) => [i.id, i]));
    const rows = plans.map((p) => ({
      user_id: user.id,
      person_id: person.id,
      title: p.title,
      item_ids: stripIncompatibleItems(p.item_ids, itemById).itemIds,
      occasion: p.occasion,
      seasons: p.seasons ?? [],
      weather_note: p.weather_note || null,
      explanation: p.explanation,
      styling_notes: p.styling_notes,
      variations: p.variations ?? [],
      score: p.score ?? null,
      render_status: "none",
    }));
    const { data: created, error } = await supabase
      .from("sc_outfits")
      .insert(rows)
      .select();
    if (error) throw error;
    return NextResponse.json({ outfits: created });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fit generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
