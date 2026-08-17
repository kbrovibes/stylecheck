import { NextResponse } from "next/server";
import { after } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateProfile, getOrCreateSettings } from "@/lib/account";
import { computeWardrobeHash, generateWardrobeScene, loadSceneItems } from "@/lib/scene";
import { imgUrl } from "@/lib/storage";

export const maxDuration = 300;

/** Force a regeneration of the wardrobe scene. Responds immediately; work happens in the background. */
export async function POST() {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;
  const settings = await getOrCreateSettings(supabase, user.id);

  const items = await loadSceneItems(supabase, user.id);
  if (!items.length) {
    return NextResponse.json(
      { error: "Add some wardrobe pieces first." },
      { status: 400 }
    );
  }

  await supabase
    .from("sc_profiles")
    .update({ wardrobe_scene_status: "pending" })
    .eq("id", user.id);

  after(() => generateWardrobeScene(supabase, user.id, settings));

  return NextResponse.json({ status: "pending" });
}

/** Poll the scene status. */
export async function GET() {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;
  const profile = await getOrCreateProfile(supabase, user);
  const items = await loadSceneItems(supabase, user.id);
  const stale =
    !!profile.wardrobe_scene_path &&
    items.length > 0 &&
    computeWardrobeHash(items) !== profile.wardrobe_scene_hash;

  return NextResponse.json({
    status: profile.wardrobe_scene_status,
    stale,
    generated_at: profile.wardrobe_scene_generated_at,
    url: profile.wardrobe_scene_path
      ? imgUrl(profile.wardrobe_scene_path)
      : null,
  });
}
