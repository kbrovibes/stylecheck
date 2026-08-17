import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { generateCatalogImage } from "@/lib/ai";
import { downloadAsImageInput, extFromMime, uploadBase64 } from "@/lib/storage";
import type { WardrobeItem } from "@/lib/types";

export const maxDuration = 120;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  const { data } = await supabase
    .from("sc_wardrobe_items")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  const item = data as WardrobeItem;

  try {
    const settings = await getOrCreateSettings(supabase, user.id);
    const original = await downloadAsImageInput(supabase, item.original_image_path);
    const result = await generateCatalogImage(settings, original);

    const path = `${user.id}/catalog/${item.id}-${Date.now()}.${extFromMime(result.mimeType)}`;
    await uploadBase64(supabase, path, result.data, result.mimeType);

    await supabase
      .from("sc_wardrobe_items")
      .update({ catalog_image_path: path, catalog_source: "generated" })
      .eq("id", item.id)
      .eq("user_id", user.id);

    await supabase.from("sc_renders").insert({
      user_id: user.id,
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
