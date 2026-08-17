import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import type { Outfit, OutfitVariation } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let supabase, user;
  try {
    ({ supabase, user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const index = Number(body.index);
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "invalid variation index" }, { status: 400 });
  }

  const { data: parentData } = await supabase
    .from("sc_outfits")
    .select("*")
    .eq("id", id)
    .eq("deleted", false)
    .single();
  if (!parentData) {
    return NextResponse.json({ error: "Fit not found" }, { status: 404 });
  }
  const parent = parentData as Outfit;
  const variations = (parent.variations ?? []) as OutfitVariation[];
  const variation = variations[index];
  if (!variation) {
    return NextResponse.json({ error: "Variation not found" }, { status: 404 });
  }
  if (variation.outfit_id) {
    return NextResponse.json({ id: variation.outfit_id, existing: true });
  }

  const itemIds = parent.item_ids.map((iid) =>
    iid === variation.swap_out ? variation.swap_in : iid
  );
  if (!itemIds.includes(variation.swap_in)) itemIds.push(variation.swap_in);

  const { data: created, error } = await supabase
    .from("sc_outfits")
    .insert({
      user_id: user.id,
      title: `${parent.title ?? "Fit"} — ${variation.label}`,
      item_ids: itemIds,
      occasion: parent.occasion,
      seasons: parent.seasons,
      weather_note: parent.weather_note,
      explanation: `${parent.explanation ?? ""} Variation: ${variation.label}.`.trim(),
      styling_notes: parent.styling_notes,
      variations: [],
      parent_outfit_id: parent.id,
      render_status: "none",
    })
    .select("id")
    .single();
  if (error || !created) {
    return NextResponse.json(
      { error: error?.message ?? "Could not create variation" },
      { status: 500 }
    );
  }

  const updatedVariations = variations.map((v, i) =>
    i === index ? { ...v, outfit_id: created.id } : v
  );
  await supabase
    .from("sc_outfits")
    .update({ variations: updatedVariations })
    .eq("id", parent.id);

  return NextResponse.json({ id: created.id });
}
