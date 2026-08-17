import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateProfile, getOrCreateSettings } from "@/lib/account";
import { generateBaseRender } from "@/lib/ai";
import { downloadAsImageInput, uploadBase64 } from "@/lib/storage";
import type { UserPhoto } from "@/lib/types";

export const maxDuration = 300;

export async function POST() {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;
  const [profile, settings] = await Promise.all([
    getOrCreateProfile(supabase, user),
    getOrCreateSettings(supabase, user.id),
  ]);

  const { data: photos } = await supabase
    .from("sc_user_photos")
    .select("*")
    .eq("user_id", user.id)
    .eq("deleted", false);

  const all = (photos ?? []) as UserPhoto[];
  if (!all.length) {
    return NextResponse.json(
      { error: "Add at least one photo of yourself first — a full-body shot works best." },
      { status: 400 }
    );
  }

  const rank = (p: UserPhoto) =>
    (p.is_primary ? 0 : 4) +
    (p.kind === "full_body" ? 0 : p.kind === "half_body" ? 1 : p.kind === "selfie" ? 2 : 3);
  const picked = all.sort((a, b) => rank(a) - rank(b)).slice(0, 4);

  try {
    const images = await Promise.all(
      picked.map((p) => downloadAsImageInput(supabase, p.storage_path))
    );
    const result = await generateBaseRender(settings, profile, images);
    const path = `${user.id}/renders/base-${Date.now()}.png`;
    await uploadBase64(supabase, path, result.data, result.mimeType);

    await supabase
      .from("sc_profiles")
      .update({ base_render_path: path, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    await supabase.from("sc_renders").insert({
      user_id: user.id,
      subject_type: "profile",
      subject_id: user.id,
      storage_path: path,
      model: settings.image_model,
      prompt_summary: `base render from ${picked.length} photo(s), ${profile.height_cm ?? "?"}cm/${profile.weight_kg ?? "?"}kg`,
    });

    return NextResponse.json({ path });
  } catch (e) {
    return NextResponse.json(
      { error: `Render failed: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}
