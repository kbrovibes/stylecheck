import { NextResponse } from "next/server";
import { creditErrorResponse, spendCredit } from "@/lib/credits";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { generateCatalogImage, reclassifyItem } from "@/lib/ai";
import { downloadAsImageInput, extFromMime, uploadBase64 } from "@/lib/storage";
import type { WardrobeItem } from "@/lib/types";

export const maxDuration = 120;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const hint: string | null =
    typeof body?.hint === "string" ? body.hint.slice(0, 300) : null;
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  try {
    await spendCredit(supabase, user, "image");
  } catch (e) {
    const c = creditErrorResponse(e);
    if (c) return NextResponse.json({ error: c.error }, { status: 429 });
  }
  const { data } = await supabase
    .from("sc_wardrobe_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  const item = data as WardrobeItem;
  const { data: ok } = item.person_id
    ? await supabase.rpc("sc_can_manage_person", { pid: item.person_id })
    : { data: item.user_id === user.id };
  if (!ok) {
    return NextResponse.json(
      { error: "You have view-only access to this profile." },
      { status: 403 }
    );
  }

  try {
    const settings = await getOrCreateSettings(supabase, user.id);
    const original = await downloadAsImageInput(supabase, item.original_image_path);
    // A user hint corrects the whole item, not just the photo: re-derive the
    // catalogue metadata first so the extraction targets the right thing.
    if (hint) {
      try {
        const corrected = await reclassifyItem(settings, original, item, hint);
        const { data: updated } = await supabase
          .from("sc_wardrobe_items")
          .update({
            category: corrected.category ?? item.category,
            subcategory: corrected.subcategory ?? item.subcategory,
            name: corrected.name ?? item.name,
            description: corrected.description ?? item.description,
            colors: corrected.colors ?? item.colors,
            primary_color: corrected.primary_color ?? item.primary_color,
            pattern: corrected.pattern ?? item.pattern,
            material: corrected.material ?? item.material,
            seasons: corrected.seasons ?? item.seasons,
            formality: corrected.formality ?? item.formality,
            style_tags: corrected.style_tags ?? item.style_tags,
            analysis: { corrected, hint },
            model_used: settings.text_model,
          })
          .eq("id", item.id)
          .select()
          .single();
        if (updated) Object.assign(item, updated);
      } catch (e) {
        console.error("reclassify with hint failed, extracting with hint only:", e);
      }
    }
    const result = await generateCatalogImage(settings, original, item, hint);

    const path = `${user.id}/catalog/${item.id}-${Date.now()}.${extFromMime(result.mimeType)}`;
    await uploadBase64(supabase, path, result.data, result.mimeType);

    await supabase
      .from("sc_wardrobe_items")
      .update({ catalog_image_path: path, catalog_source: "generated" })
      .eq("id", item.id);

    await supabase.from("sc_renders").insert({
      user_id: user.id,
      person_id: item.person_id,
      subject_type: "item_catalog",
      subject_id: item.id,
      storage_path: path,
      model: settings.image_model,
      prompt_summary: `Catalogue shot: ${item.name ?? item.subcategory ?? item.category}`,
    });

    return NextResponse.json({ path });
  } catch (e) {
    const message = e instanceof Error ? e.message : "catalogue generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
