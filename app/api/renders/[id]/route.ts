import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";

/** Soft-delete a render from history. The image file is kept (never-delete policy). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let auth;
  try {
    auth = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = auth;
  const { id } = await params;

  const { data: render } = await supabase
    .from("sc_renders")
    .select("id, storage_path, subject_type, subject_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!render) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Block removing a render that is currently in use.
  if (render.subject_type === "profile") {
    const { data: profile } = await supabase
      .from("sc_profiles")
      .select("base_render_path")
      .eq("id", user.id)
      .single();
    if (profile?.base_render_path === render.storage_path) {
      return NextResponse.json(
        { error: "This is your active base render — generate or save another one first." },
        { status: 409 }
      );
    }
  }
  if (render.subject_type === "outfit" && render.subject_id) {
    const { data: outfit } = await supabase
      .from("sc_outfits")
      .select("render_path")
      .eq("id", render.subject_id)
      .maybeSingle();
    if (outfit?.render_path === render.storage_path) {
      return NextResponse.json(
        { error: "This is the fit's current render — re-render it first." },
        { status: 409 }
      );
    }
  }

  await supabase.from("sc_renders").update({ deleted: true }).eq("id", id);
  return NextResponse.json({ ok: true });
}
