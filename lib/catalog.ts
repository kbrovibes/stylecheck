import type { SupabaseClient } from "@supabase/supabase-js";
import type { Settings, WardrobeItem } from "@/lib/types";
import { generateCatalogImage } from "@/lib/ai";
import { downloadAsImageInput, extFromMime, uploadBase64 } from "@/lib/storage";

/** Generate + persist a clean product shot for one item. */
export async function generateCatalogShotForItem(
  supabase: SupabaseClient,
  userId: string,
  item: WardrobeItem,
  settings: Settings,
  hint?: string | null
) {
  const original = await downloadAsImageInput(supabase, item.original_image_path);
  const shot = await generateCatalogImage(settings, original, item, hint);
  const path = `${userId}/catalog/${item.id}-${Date.now()}.${extFromMime(shot.mimeType)}`;
  await uploadBase64(supabase, path, shot.data, shot.mimeType);
  await supabase
    .from("sc_wardrobe_items")
    .update({ catalog_image_path: path, catalog_source: "generated" })
    .eq("id", item.id);
  await supabase.from("sc_renders").insert({
    user_id: userId,
    subject_type: "item_catalog",
    subject_id: item.id,
    storage_path: path,
    model: settings.image_model,
    prompt_summary: `catalogue shot: ${item.name ?? item.category}`,
  });
  return path;
}

/** Catch up on items still missing a catalogue shot. Returns how many were generated. */
export async function backfillPendingCatalogShots(
  supabase: SupabaseClient,
  userId: string,
  settings: Settings,
  limit = 10
) {
  const { data } = await supabase
    .from("sc_wardrobe_items")
    .select("*")
    .eq("user_id", userId)
    .eq("deleted", false)
    .is("catalog_image_path", null)
    .limit(limit);
  const pending = (data ?? []) as WardrobeItem[];
  let done = 0;
  for (const item of pending) {
    try {
      await generateCatalogShotForItem(supabase, userId, item, settings);
      done++;
    } catch (e) {
      console.error(`catalog backfill failed for ${item.id}:`, e);
    }
  }
  return done;
}
