import { NextResponse } from "next/server";
import { after } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { canManage, getActivePerson } from "@/lib/person";
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
  const { person, role } = await getActivePerson(supabase, user);
  if (!canManage(role)) {
    return NextResponse.json(
      { error: "You have view-only access to this profile." },
      { status: 403 }
    );
  }
  const settings = await getOrCreateSettings(supabase, user.id);

  const items = await loadSceneItems(supabase, person.id);
  if (!items.length) {
    return NextResponse.json(
      { error: "Add some wardrobe pieces first." },
      { status: 400 }
    );
  }

  await supabase
    .from("sc_people")
    .update({ wardrobe_scene_status: "pending" })
    .eq("id", person.id);

  after(() => generateWardrobeScene(supabase, user.id, person, settings));

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
  const { person } = await getActivePerson(supabase, user);
  const items = await loadSceneItems(supabase, person.id);
  const stale =
    !!person.wardrobe_scene_path &&
    items.length > 0 &&
    computeWardrobeHash(items) !== person.wardrobe_scene_hash;

  return NextResponse.json({
    status: person.wardrobe_scene_status,
    stale,
    generated_at: person.wardrobe_scene_generated_at,
    url: person.wardrobe_scene_path
      ? imgUrl(person.wardrobe_scene_path)
      : null,
  });
}
