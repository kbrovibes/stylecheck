import { NextResponse } from "next/server";
import { creditErrorResponse, spendCredit } from "@/lib/credits";
import { after } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { canManage, getActivePerson } from "@/lib/person";
import { downloadAsImageInput, extFromMime, uploadBase64 } from "@/lib/storage";
import { classifyImage, generateCatalogImage } from "@/lib/ai";
import { toJpegBase64 } from "@/lib/img-server";
import type { ItemAnalysis } from "@/lib/types";

export const maxDuration = 300;

export async function POST(request: Request) {
  let auth;
  try {
    auth = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = auth;

  const body = await request.json().catch(() => null);
  const paths: unknown = body?.paths;
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    paths.length > 10 ||
    !paths.every((p) => typeof p === "string" && p.startsWith(`${user.id}/`))
  ) {
    return NextResponse.json({ error: "invalid paths" }, { status: 400 });
  }

  const { person, role } = await getActivePerson(supabase, user);
  if (!canManage(role)) {
    return NextResponse.json(
      { error: "You have view-only access to this profile." },
      { status: 403 }
    );
  }
  try {
    await spendCredit(supabase, user, "text", (paths as string[]).length);
  } catch (e) {
    const c = creditErrorResponse(e);
    if (c) return NextResponse.json({ error: c.error }, { status: 429 });
  }
  const settings = await getOrCreateSettings(supabase, user.id);

  const { count: existingPhotos } = await supabase
    .from("sc_user_photos")
    .select("*", { count: "exact", head: true })
    .eq("person_id", person.id)
    .eq("deleted", false);
  let claimedPrimary = (existingPhotos ?? 0) > 0;

  async function insertItem(path: string, item: ItemAnalysis, analysis: object) {
    const { data, error } = await supabase
      .from("sc_wardrobe_items")
      .insert({
        user_id: user.id,
        person_id: person.id,
        category: item.category,
        subcategory: item.subcategory,
        name: item.name,
        description: item.description,
        colors: item.colors ?? [],
        primary_color: item.primary_color,
        pattern: item.pattern,
        material: item.material,
        seasons: item.seasons ?? [],
        formality: item.formality,
        style_tags: item.style_tags ?? [],
        original_image_path: path,
        catalog_source: "pending",
        analysis,
        model_used: settings.text_model,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id as string, name: item.name, category: item.category };
  }

  const settled = await Promise.allSettled(
    (paths as string[]).map(async (path) => {
      const image = await downloadAsImageInput(supabase, path);
      const result = await classifyImage(settings, image);

      let photo: { id: string; photo_kind: string } | null = null;
      if (result.kind === "person") {
        const makePrimary = !claimedPrimary;
        if (makePrimary) claimedPrimary = true;
        const { data, error } = await supabase
          .from("sc_user_photos")
          .insert({
            user_id: user.id,
            person_id: person.id,
            storage_path: path,
            kind: result.person?.photo_kind ?? "unknown",
            is_primary: makePrimary,
            analysis: result,
            model_used: settings.text_model,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        photo = { id: data.id, photo_kind: result.person?.photo_kind ?? "unknown" };
      }

      // A single photo can yield several wardrobe items (worn or flat-lay).
      const items = [];
      for (const item of result.items ?? []) {
        try {
          items.push(await insertItem(path, item, result));
        } catch {
          // one bad item shouldn't sink the rest of the photo
        }
      }

      const kind =
        photo !== null ? ("person" as const)
        : items.length ? ("item" as const)
        : ("unusable" as const);
      return { path, kind, photo, items };
    })
  );

  const results = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          path: (paths as string[])[i],
          kind: "error" as const,
          photo: null,
          items: [],
          error:
            s.reason instanceof Error ? s.reason.message : "classification failed",
        }
  );

  // Auto-generate clean product shots in the background (bounded; the manual
  // "Generate catalogue shot" button remains the fallback for any that fail).
  const createdItemIds = results
    .flatMap((r) => r.items ?? [])
    .map((i) => i.id)
    .slice(0, 12);
  if (createdItemIds.length) {
    try {
      await spendCredit(supabase, user, "image", createdItemIds.length);
    } catch {
      // over budget: skip auto product shots; manual button still available
      createdItemIds.length = 0;
    }
  }
  if (createdItemIds.length) {
    after(async () => {
      for (const itemId of createdItemIds) {
        try {
          const { data: item } = await supabase
            .from("sc_wardrobe_items")
            .select("*")
            .eq("id", itemId)
            .single();
          if (!item || item.catalog_image_path) continue;
          const original = await downloadAsImageInput(supabase, item.original_image_path);
          const shot = await generateCatalogImage(settings, original, item);
          const jpeg = await toJpegBase64(shot.data, 90);
          const path = `${user.id}/catalog/${item.id}-${Date.now()}.${extFromMime(jpeg.mimeType)}`;
          await uploadBase64(supabase, path, jpeg.data, jpeg.mimeType);
          await supabase
            .from("sc_wardrobe_items")
            .update({ catalog_image_path: path, catalog_source: "generated" })
            .eq("id", item.id);
          await supabase.from("sc_renders").insert({
            user_id: user.id,
            person_id: person.id,
            subject_type: "item_catalog",
            subject_id: item.id,
            storage_path: path,
            model: settings.image_model,
            prompt_summary: `auto catalogue shot: ${item.name ?? item.category}`,
          });
        } catch (e) {
          console.error(`auto-catalog failed for ${itemId}:`, e);
        }
      }
    });
  }

  return NextResponse.json({ results });
}
