import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { downloadAsImageInput } from "@/lib/storage";
import { classifyImage } from "@/lib/ai";

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

  const settings = await getOrCreateSettings(supabase, user.id);

  const { count: existingPhotos } = await supabase
    .from("sc_user_photos")
    .select("*", { count: "exact", head: true })
    .eq("deleted", false);
  let claimedPrimary = (existingPhotos ?? 0) > 0;

  const settled = await Promise.allSettled(
    (paths as string[]).map(async (path) => {
      const image = await downloadAsImageInput(supabase, path);
      const result = await classifyImage(settings, image);

      if (result.kind === "person") {
        const makePrimary = !claimedPrimary;
        if (makePrimary) claimedPrimary = true;
        const { data, error } = await supabase
          .from("sc_user_photos")
          .insert({
            user_id: user.id,
            storage_path: path,
            kind: result.person?.photo_kind ?? "unknown",
            is_primary: makePrimary,
            analysis: result,
            model_used: settings.text_model,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        return {
          path,
          kind: "person" as const,
          id: data.id,
          photo_kind: result.person?.photo_kind ?? "unknown",
        };
      }

      if (result.kind === "item" && result.item) {
        const item = result.item;
        const { data, error } = await supabase
          .from("sc_wardrobe_items")
          .insert({
            user_id: user.id,
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
            analysis: result,
            model_used: settings.text_model,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        return {
          path,
          kind: "item" as const,
          id: data.id,
          name: item.name,
          category: item.category,
        };
      }

      return { path, kind: "unusable" as const };
    })
  );

  const results = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          path: (paths as string[])[i],
          kind: "error" as const,
          error:
            s.reason instanceof Error ? s.reason.message : "classification failed",
        }
  );

  return NextResponse.json({ results });
}
