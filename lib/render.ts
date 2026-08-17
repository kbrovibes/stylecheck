import type { SupabaseClient } from "@supabase/supabase-js";
import type { Outfit, Profile, Settings, UserPhoto, WardrobeItem } from "@/lib/types";
import { renderOutfitImage, type ImageInput } from "@/lib/ai";
import { downloadAsImageInput, extFromMime, uploadBase64 } from "@/lib/storage";

const KIND_ORDER: Record<string, number> = {
  full_body: 0,
  half_body: 1,
  selfie: 2,
  unknown: 3,
};

/**
 * Render one outfit on the user and persist everything (storage, sc_renders,
 * outfit row). Works with a user-scoped client or the admin client.
 * Throws on failure after marking the outfit render_status = failed.
 */
export async function renderOutfitRecord(
  supabase: SupabaseClient,
  userId: string,
  outfit: Outfit,
  profile: Profile,
  settings: Settings
) {
  try {
    const personImages: ImageInput[] = [];
    if (profile.base_render_path) {
      personImages.push(await downloadAsImageInput(supabase, profile.base_render_path));
    } else {
      const { data: photosData } = await supabase
        .from("sc_user_photos")
        .select("*")
        .eq("user_id", userId)
        .eq("deleted", false);
      const photos = ((photosData ?? []) as UserPhoto[]).sort(
        (a, b) =>
          Number(b.is_primary) - Number(a.is_primary) ||
          (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)
      );
      for (const p of photos.slice(0, 3)) {
        personImages.push(await downloadAsImageInput(supabase, p.storage_path));
      }
    }
    if (!personImages.length) {
      throw new Error("Add at least one photo of yourself on the Profile page before rendering.");
    }

    const { data: itemsData } = await supabase
      .from("sc_wardrobe_items")
      .select("*")
      .in("id", outfit.item_ids);
    const items = (itemsData ?? []) as WardrobeItem[];
    if (!items.length) throw new Error("This fit's wardrobe items could not be loaded.");

    const itemImages = await Promise.all(
      items.map((i) =>
        downloadAsImageInput(supabase, i.catalog_image_path ?? i.original_image_path)
      )
    );

    await supabase
      .from("sc_outfits")
      .update({ render_status: "pending" })
      .eq("id", outfit.id);

    const image = await renderOutfitImage(settings, {
      profile,
      personImages,
      itemImages,
      items,
      outfit: { title: outfit.title, styling_notes: outfit.styling_notes },
      editBase: !!profile.base_render_path,
    });

    const path = await uploadBase64(
      supabase,
      `${userId}/renders/outfit-${outfit.id}-${Date.now()}.${extFromMime(image.mimeType)}`,
      image.data,
      image.mimeType
    );

    await supabase.from("sc_renders").insert({
      user_id: userId,
      subject_type: "outfit",
      subject_id: outfit.id,
      storage_path: path,
      model: settings.image_model,
      prompt_summary: outfit.title,
    });
    await supabase
      .from("sc_outfits")
      .update({
        render_path: path,
        render_status: "done",
        render_model: settings.image_model,
      })
      .eq("id", outfit.id);

    return path;
  } catch (e) {
    await supabase
      .from("sc_outfits")
      .update({ render_status: "failed" })
      .eq("id", outfit.id);
    throw e;
  }
}
