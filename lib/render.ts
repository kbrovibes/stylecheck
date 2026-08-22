import type { SupabaseClient } from "@supabase/supabase-js";
import type { Outfit, Person, Settings, UserPhoto, WardrobeItem } from "@/lib/types";
import {
  renderOutfitImage,
  resolvePersonModel,
  verifyFaceMatch,
  type ImageInput,
} from "@/lib/ai";
import { downloadAsImageInput, extFromMime, uploadBase64 } from "@/lib/storage";
import { toJpegBase64 } from "@/lib/img-server";

/** Below this face-match score a GPT render gets one corrective retake. */
const FACE_MATCH_MIN = 7;

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
  writerUserId: string,
  outfit: Outfit,
  person: Person,
  settings: Settings,
  opts?: { goofy?: boolean; modelOverride?: string | null; recordOnly?: boolean }
) {
  try {
    const { data: photosData } = await supabase
      .from("sc_user_photos")
      .select("*")
      .eq("person_id", person.id)
      .eq("deleted", false);
    const rankedPhotos = ((photosData ?? []) as UserPhoto[]).sort(
      (a, b) =>
        Number(b.is_primary) - Number(a.is_primary) ||
        (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)
    );

    const personImages: ImageInput[] = [];
    let identityPhotos: ImageInput[] = [];
    if (person.base_render_path) {
      personImages.push(await downloadAsImageInput(supabase, person.base_render_path));
      // Ground every edit in real photos too, so identity errors never compound
      // off a synthetic copy alone.
      identityPhotos = await Promise.all(
        rankedPhotos.slice(0, 2).map((p) => downloadAsImageInput(supabase, p.storage_path))
      );
    } else {
      for (const p of rankedPhotos.slice(0, 3)) {
        personImages.push(await downloadAsImageInput(supabase, p.storage_path));
      }
    }
    if (!personImages.length) {
      throw new Error("Add at least one photo of yourself on the Profile page before rendering.");
    }

    const { data: itemsData } = await supabase
      .from("sc_wardrobe_items")
      .select("*")
      .in("id", outfit.item_ids)
      .eq("deleted", false)
      .eq("enabled", true);
    const items = (itemsData ?? []) as WardrobeItem[];
    if (!items.length)
      throw new Error(
        "None of this fit's pieces are in the wardrobe anymore — revive it with a swap or remove it."
      );

    const itemImages = await Promise.all(
      items.map((i) =>
        downloadAsImageInput(supabase, i.catalog_image_path ?? i.original_image_path)
      )
    );

    if (!opts?.recordOnly) {
      await supabase
        .from("sc_outfits")
        .update({ render_status: "pending" })
        .eq("id", outfit.id);
    }

    const renderOpts = {
      profile: person,
      personImages,
      itemImages,
      items,
      outfit: { title: outfit.title, styling_notes: outfit.styling_notes },
      editBase: !!person.base_render_path,
      goofy: !!opts?.goofy,
      identityPhotos,
      identityNotes: person.identity_notes,
      modelOverride: opts?.modelOverride,
    };
    const usedModel = resolvePersonModel(settings, opts?.modelOverride);
    let image = await renderOutfitImage(settings, renderOpts);

    // GPT renders get an independent face-match review against the real
    // photos, with one corrective retake — likeness is the whole product.
    let faceNote = "";
    if (usedModel.startsWith("gpt") && identityPhotos.length) {
      const judge = (img: ImageInput) =>
        verifyFaceMatch(settings, img, identityPhotos).catch((e) => {
          console.error("face-match check failed:", e);
          return null;
        });
      let check = await judge(image);
      let retook = false;
      if (check && check.score < FACE_MATCH_MIN) {
        try {
          const retry = await renderOutfitImage(settings, {
            ...renderOpts,
            faceFixNotes: check.mismatches,
          });
          const retryCheck = await judge(retry);
          if (retryCheck && retryCheck.score >= check.score) {
            image = retry;
            check = retryCheck;
            retook = true;
          }
        } catch (e) {
          console.error("face-fix retake failed:", e);
        }
      }
      if (check)
        faceNote = ` · face-match ${check.score}/10${retook ? " after retake" : ""}`;
    }

    const jpeg = await toJpegBase64(image.data);
    const path = await uploadBase64(
      supabase,
      `${writerUserId}/renders/outfit-${outfit.id}${opts?.goofy ? "-goofy" : ""}-${Date.now()}.${extFromMime(jpeg.mimeType)}`,
      jpeg.data,
      jpeg.mimeType
    );

    await supabase.from("sc_renders").insert({
      user_id: writerUserId,
      person_id: outfit.person_id ?? person.id,
      subject_type: opts?.goofy ? "outfit_goofy" : "outfit",
      subject_id: outfit.id,
      storage_path: path,
      model: usedModel,
      prompt_summary: `${outfit.title ?? "fit"}${faceNote}`,
    });
    // Casual re-renders shouldn't pile up: retire prior renders of this type
    // for this fit (soft delete — files are kept, per the never-delete policy).
    await supabase
      .from("sc_renders")
      .update({ deleted: true })
      .eq("subject_type", opts?.goofy ? "outfit_goofy" : "outfit")
      .eq("subject_id", outfit.id)
      .eq("model", usedModel) // history keeps the latest take PER MODEL
      .eq("deleted", false)
      .neq("storage_path", path);
    if (!opts?.recordOnly) {
      await supabase
        .from("sc_outfits")
        .update(
          opts?.goofy
            ? { goofy_render_path: path, render_status: "done" }
            : {
                render_path: path,
                render_status: "done",
                render_model: usedModel,
              }
        )
        .eq("id", outfit.id);
    }

    return path;
  } catch (e) {
    if (!opts?.recordOnly) {
      await supabase
        .from("sc_outfits")
        .update({ render_status: "failed" })
        .eq("id", outfit.id);
    }
    throw e;
  }
}
