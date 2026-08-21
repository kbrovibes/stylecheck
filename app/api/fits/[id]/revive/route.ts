import { NextResponse } from "next/server";
import { creditErrorResponse, spendCredit } from "@/lib/credits";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { geminiJson } from "@/lib/ai/gemini";
import { openaiJson } from "@/lib/ai/openai";
import { reviveOutfitPrompt } from "@/lib/ai/prompts";
import { renderOutfitRecord } from "@/lib/render";
import type { Outfit, Person, WardrobeItem } from "@/lib/types";

export const maxDuration = 300;

/**
 * Revive a fit whose piece(s) were removed from the wardrobe: the stylist picks
 * the best replacements from the current wardrobe, then the fit re-renders.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;
  const { id } = await params;

  const { data: outfitData } = await supabase
    .from("sc_outfits")
    .select("*")
    .eq("id", id)
    .eq("deleted", false)
    .maybeSingle();
  if (!outfitData) return NextResponse.json({ error: "not found" }, { status: 404 });
  const outfit = outfitData as Outfit;

  const { data: ok } = outfit.person_id
    ? await supabase.rpc("sc_can_manage_person", { pid: outfit.person_id })
    : { data: outfit.user_id === user.id };
  if (!ok) {
    return NextResponse.json(
      { error: "You have view-only access to this profile." },
      { status: 403 }
    );
  }

  try {
    await spendCredit(supabase, user, "text");
  } catch (e) {
    const c = creditErrorResponse(e);
    if (c) return NextResponse.json({ error: c.error }, { status: 429 });
  }
  try {
    await spendCredit(supabase, user, "image");
  } catch (e) {
    const c = creditErrorResponse(e);
    if (c) return NextResponse.json({ error: c.error }, { status: 429 });
  }
  const settings = await getOrCreateSettings(supabase, user.id);
  const { data: liveData } = await supabase
    .from("sc_wardrobe_items")
    .select("*")
    .eq("person_id", outfit.person_id!)
    .eq("deleted", false)
    .eq("enabled", true);
  const liveItems = (liveData ?? []) as WardrobeItem[];
  const liveIds = new Set(liveItems.map((i) => i.id));

  const deadItemIds = outfit.item_ids.filter((iid) => !liveIds.has(iid));
  if (!deadItemIds.length) {
    return NextResponse.json(
      { error: "All of this fit's pieces are still in the wardrobe." },
      { status: 400 }
    );
  }
  const keptItems = liveItems.filter((i) => outfit.item_ids.includes(i.id));
  const candidates = liveItems.filter((i) => !outfit.item_ids.includes(i.id));
  if (!candidates.length) {
    return NextResponse.json(
      { error: "No replacement pieces available — add more items first." },
      { status: 400 }
    );
  }

  try {
    const prompt = reviveOutfitPrompt({
      outfit,
      deadItemIds,
      liveItems: candidates,
      keptItems,
    });
    const call =
      settings.provider === "openai"
        ? openaiJson<{ replacement_ids: string[]; explanation: string; styling_notes: string }>
        : geminiJson<{ replacement_ids: string[]; explanation: string; styling_notes: string }>;
    const res = await call({ model: settings.text_model, prompt });
    const replacements = (res.replacement_ids ?? []).filter((rid) => liveIds.has(rid));
    if (!replacements.length) {
      return NextResponse.json(
        { error: "The stylist couldn't find a coherent replacement — consider removing this fit." },
        { status: 422 }
      );
    }

    const newItemIds = [
      ...outfit.item_ids.filter((iid) => liveIds.has(iid)),
      ...replacements,
    ];
    await supabase
      .from("sc_outfits")
      .update({
        item_ids: newItemIds,
        explanation: res.explanation ?? outfit.explanation,
        styling_notes: res.styling_notes ?? outfit.styling_notes,
        variations: [],
      })
      .eq("id", id);

    // Re-render immediately so the fit image matches its revived pieces.
    const { data: personData } = await supabase
      .from("sc_people")
      .select("*")
      .eq("id", outfit.person_id!)
      .single();
    const updated = { ...outfit, item_ids: newItemIds } as Outfit;
    await renderOutfitRecord(supabase, user.id, updated, personData as Person, settings);

    return NextResponse.json({ ok: true, swapped: replacements.length });
  } catch (e) {
    return NextResponse.json(
      { error: `Revive failed: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}
