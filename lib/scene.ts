import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, Settings, WardrobeItem } from "@/lib/types";
import { generateWardrobeSceneImage } from "@/lib/ai";
import { downloadAsImageInput, uploadBase64 } from "@/lib/storage";

const HANGING: Category[] = ["top", "outerwear", "full_body"];
const FOLDED: Category[] = ["bottom"];
const SHOES: Category[] = ["footwear"];
const TRAY: Category[] = ["accessory", "belt", "bag", "headwear", "eyewear"];

export function computeWardrobeHash(items: WardrobeItem[]) {
  const parts = items
    .map((i) => `${i.id}:${i.catalog_image_path ?? i.original_image_path}`)
    .sort();
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

function pick(items: WardrobeItem[], cats: Category[], n: number) {
  return items.filter((i) => cats.includes(i.category)).slice(0, n);
}

export async function loadSceneItems(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("sc_wardrobe_items")
    .select("*")
    .eq("user_id", userId)
    .eq("deleted", false)
    .eq("enabled", true)
    .order("created_at", { ascending: true });
  return (data ?? []) as WardrobeItem[];
}

/**
 * Generate the wardrobe scene for a user and update their profile pointer.
 * Safe to run in the background (after()) or from cron with an admin client.
 */
export async function generateWardrobeScene(
  supabase: SupabaseClient,
  userId: string,
  settings: Settings
) {
  const items = await loadSceneItems(supabase, userId);
  if (!items.length) {
    await supabase
      .from("sc_profiles")
      .update({ wardrobe_scene_status: "none" })
      .eq("id", userId);
    return { status: "none" as const };
  }
  const hash = computeWardrobeHash(items);

  try {
    const groups = {
      hanging: pick(items, HANGING, 8),
      folded: pick(items, FOLDED, 4),
      shoes: pick(items, SHOES, 4),
      tray: pick(items, TRAY, 4),
    };
    const chosen = [
      ...groups.hanging,
      ...groups.folded,
      ...groups.shoes,
      ...groups.tray,
    ].slice(0, 14);
    const itemNames = {
      hanging: groups.hanging.map((i) => i.name ?? i.subcategory ?? i.category),
      folded: groups.folded.map((i) => i.name ?? i.subcategory ?? i.category),
      shoes: groups.shoes.map((i) => i.name ?? i.subcategory ?? i.category),
      tray: groups.tray.map((i) => i.name ?? i.subcategory ?? i.category),
    };
    const refs = await Promise.all(
      chosen.map((i) =>
        downloadAsImageInput(supabase, i.catalog_image_path ?? i.original_image_path)
      )
    );

    const result = await generateWardrobeSceneImage(settings, itemNames, refs);
    const path = `${userId}/scenes/scene-${Date.now()}.png`;
    await uploadBase64(supabase, path, result.data, result.mimeType);

    await supabase.from("sc_renders").insert({
      user_id: userId,
      subject_type: "wardrobe_scene",
      subject_id: userId,
      storage_path: path,
      model: settings.image_model,
      prompt_summary: `wardrobe scene, ${chosen.length} of ${items.length} items`,
    });
    await supabase
      .from("sc_profiles")
      .update({
        wardrobe_scene_path: path,
        wardrobe_scene_hash: hash,
        wardrobe_scene_status: "done",
        wardrobe_scene_generated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    return { status: "done" as const, path };
  } catch (e) {
    await supabase
      .from("sc_profiles")
      .update({ wardrobe_scene_status: "failed" })
      .eq("id", userId);
    console.error(`scene generation failed for ${userId}:`, e);
    return { status: "failed" as const, error: (e as Error).message };
  }
}
