import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateProfile, getOrCreateSettings } from "@/lib/account";
import { renderOutfitImage, type ImageInput } from "@/lib/ai";
import { downloadAsImageInput, extFromMime, uploadBase64 } from "@/lib/storage";
import type { Outfit, UserPhoto, WardrobeItem } from "@/lib/types";

export const maxDuration = 300;

const KIND_ORDER: Record<string, number> = {
  full_body: 0,
  half_body: 1,
  selfie: 2,
  unknown: 3,
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let supabase, user;
  try {
    ({ supabase, user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: outfitData } = await supabase
    .from("sc_outfits")
    .select("*")
    .eq("id", id)
    .eq("deleted", false)
    .single();
  if (!outfitData) {
    return NextResponse.json({ error: "Fit not found" }, { status: 404 });
  }
  const outfit = outfitData as Outfit;

  try {
    const [profile, settings] = await Promise.all([
      getOrCreateProfile(supabase, user),
      getOrCreateSettings(supabase, user.id),
    ]);

    // Person reference: base render if built, otherwise best user photos.
    const personImages: ImageInput[] = [];
    if (profile.base_render_path) {
      personImages.push(await downloadAsImageInput(supabase, profile.base_render_path));
    } else {
      const { data: photosData } = await supabase
        .from("sc_user_photos")
        .select("*")
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
      return NextResponse.json(
        {
          error:
            "Add at least one photo of yourself on the Profile page before rendering.",
        },
        { status: 400 }
      );
    }

    const { data: itemsData } = await supabase
      .from("sc_wardrobe_items")
      .select("*")
      .in("id", outfit.item_ids);
    const items = (itemsData ?? []) as WardrobeItem[];
    if (!items.length) {
      return NextResponse.json(
        { error: "This fit's wardrobe items could not be loaded." },
        { status: 400 }
      );
    }

    const itemImages = await Promise.all(
      items.map((i) =>
        downloadAsImageInput(supabase, i.catalog_image_path ?? i.original_image_path)
      )
    );

    await supabase
      .from("sc_outfits")
      .update({ render_status: "pending" })
      .eq("id", id);

    const image = await renderOutfitImage(settings, {
      profile,
      personImages,
      itemImages,
      items,
      outfit: { title: outfit.title, styling_notes: outfit.styling_notes },
    });

    const path = await uploadBase64(
      supabase,
      `${user.id}/renders/outfit-${id}-${Date.now()}.${extFromMime(image.mimeType)}`,
      image.data,
      image.mimeType
    );

    await supabase.from("sc_renders").insert({
      user_id: user.id,
      subject_type: "outfit",
      subject_id: id,
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
      .eq("id", id);

    return NextResponse.json({ render_path: path });
  } catch (e) {
    await supabase
      .from("sc_outfits")
      .update({ render_status: "failed" })
      .eq("id", id);
    const msg = e instanceof Error ? e.message : "Render failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
