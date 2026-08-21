import { NextResponse } from "next/server";
import { creditErrorResponse, spendCredit } from "@/lib/credits";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { canManage, getActivePerson } from "@/lib/person";
import { geminiJson } from "@/lib/ai/gemini";
import { openaiJson } from "@/lib/ai/openai";
import { composeExactPrompt } from "@/lib/ai/prompts";
import { renderOutfitRecord } from "@/lib/render";
import { getWeather } from "@/lib/weather";
import type { Outfit, WardrobeItem, WeatherInfo } from "@/lib/types";

export const maxDuration = 300;

interface ComposedFit {
  title: string;
  occasion: string;
  seasons: string[];
  explanation: string;
  styling_notes: string;
  score: number;
}

/** Style a hand-picked set of items as one fit — exactly those pieces. */
export async function POST(request: Request) {
  let supabase, user;
  try {
    ({ supabase, user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const itemIds: string[] = Array.isArray(body.item_ids)
    ? body.item_ids.filter((x: unknown) => typeof x === "string").slice(0, 8)
    : [];
  if (itemIds.length < 2) {
    return NextResponse.json(
      { error: "Pick at least two pieces to style." },
      { status: 400 }
    );
  }

  const { person, role } = await getActivePerson(supabase, user);
  if (!canManage(role)) {
    return NextResponse.json(
      { error: "You have view-only access to this profile." },
      { status: 403 }
    );
  }

  try {
    await spendCredit(supabase, user, "text");
    await spendCredit(supabase, user, "image");
  } catch (e) {
    const c = creditErrorResponse(e);
    if (c) return NextResponse.json({ error: c.error }, { status: 429 });
  }

  const { data: itemsData } = await supabase
    .from("sc_wardrobe_items")
    .select("*")
    .eq("person_id", person.id)
    .eq("deleted", false)
    .eq("enabled", true)
    .in("id", itemIds);
  const items = (itemsData ?? []) as WardrobeItem[];
  if (items.length !== itemIds.length) {
    return NextResponse.json(
      { error: "Some selected pieces are no longer available." },
      { status: 400 }
    );
  }

  // Completeness: a renderable fit needs top+bottom (or a one-piece) and shoes.
  const has = (c: string) => items.some((i) => i.category === c);
  const onePiece = has("full_body");
  const missing: string[] = [];
  if (!onePiece && !has("top")) missing.push("a top");
  if (!onePiece && !has("bottom")) missing.push("bottoms");
  if (!has("footwear")) missing.push("shoes");
  if (missing.length) {
    return NextResponse.json(
      {
        error: `Add ${missing.join(" and ")} to complete this fit.`,
        missing,
      },
      { status: 422 }
    );
  }

  const settings = await getOrCreateSettings(supabase, user.id);
  let weather: WeatherInfo | null = null;
  if (person.lat && person.lon && person.place_name) {
    weather = await getWeather({
      lat: person.lat,
      lon: person.lon,
      place: person.place_name,
    }).catch(() => null);
  }

  try {
    const prompt = composeExactPrompt({ profile: person, items, weather });
    const call =
      settings.provider === "openai" ? openaiJson<ComposedFit> : geminiJson<ComposedFit>;
    const fit = await call({ model: settings.text_model, prompt });

    const { data: created, error } = await supabase
      .from("sc_outfits")
      .insert({
        user_id: user.id,
        person_id: person.id,
        title: fit.title ?? "Hand-picked fit",
        item_ids: itemIds,
        occasion: fit.occasion ?? "casual",
        seasons: fit.seasons ?? [],
        explanation: fit.explanation ?? null,
        styling_notes: fit.styling_notes ?? null,
        variations: [],
        score: fit.score ?? null,
        render_status: "none",
      })
      .select()
      .single();
    if (error) throw error;

    await renderOutfitRecord(supabase, user.id, created as Outfit, person, settings);
    return NextResponse.json({ id: (created as Outfit).id });
  } catch (e) {
    return NextResponse.json(
      { error: `Styling failed: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}
