import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateProfile, getOrCreateSettings } from "@/lib/account";
import { composeOutfits } from "@/lib/ai";
import { getWeather } from "@/lib/weather";
import { blockingGaps, computeCoverage } from "@/lib/coverage";
import type { UserPhoto, WardrobeItem, WeatherInfo } from "@/lib/types";

export const maxDuration = 300;

export async function POST(request: Request) {
  let supabase, user;
  try {
    ({ supabase, user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body.count) || 10, 1), 16);
    const occasion =
      typeof body.occasion === "string" && body.occasion.length
        ? body.occasion
        : undefined;

    const [profile, settings, { data: itemsData }] = await Promise.all([
      getOrCreateProfile(supabase, user),
      getOrCreateSettings(supabase, user.id),
      supabase
        .from("sc_wardrobe_items")
        .select("*")
        .eq("deleted", false)
        .eq("enabled", true),
    ]);
    const items = (itemsData ?? []) as WardrobeItem[];
    {
      const { data: photosData } = await supabase
        .from("sc_user_photos")
        .select("id, kind, deleted")
        .eq("user_id", user.id)
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
    if (profile.lat && profile.lon && profile.place_name) {
      try {
        weather = await getWeather({
          lat: profile.lat,
          lon: profile.lon,
          place: profile.place_name,
        });
      } catch {
        weather = null;
      }
    }

    const plans = await composeOutfits(settings, {
      profile,
      items,
      weather,
      count,
      occasion,
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

    const rows = plans.map((p) => ({
      user_id: user.id,
      title: p.title,
      item_ids: p.item_ids,
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
