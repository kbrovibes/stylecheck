import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { classifyImage } from "@/lib/ai";
import { downloadAsImageInput } from "@/lib/storage";
import type { PhotoKind } from "@/lib/types";

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;
  const { paths } = (await request.json()) as { paths: string[] };
  if (!paths?.length)
    return NextResponse.json({ error: "no paths" }, { status: 400 });

  const settings = await getOrCreateSettings(supabase, user.id);
  const created = [];
  const problems: string[] = [];

  for (const path of paths) {
    if (!path.startsWith(`${user.id}/`)) continue;
    let kind: PhotoKind = "unknown";
    let analysis: Record<string, unknown> | null = null;
    try {
      const image = await downloadAsImageInput(supabase, path);
      const result = await classifyImage(settings, image);
      analysis = result as unknown as Record<string, unknown>;
      if (result.kind === "person" && result.person) {
        kind = result.person.photo_kind;
      } else if (result.kind === "item") {
        problems.push(
          "One photo looks like a wardrobe item — registered here anyway; upload items via the Upload page for cataloguing."
        );
      }
    } catch (e) {
      problems.push(`Couldn't analyze one photo (${(e as Error).message}) — saved without a label.`);
    }
    const { data, error } = await supabase
      .from("sc_user_photos")
      .insert({
        user_id: user.id,
        storage_path: path,
        kind,
        analysis,
        model_used: settings.text_model,
      })
      .select()
      .single();
    if (error) problems.push(error.message);
    else created.push(data);
  }

  return NextResponse.json({ photos: created, problems });
}

export async function PATCH(request: Request) {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;
  const { id, is_primary, deleted } = await request.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Soft-delete: the image file is kept (never-delete policy).
  if (deleted) {
    const { data, error } = await supabase
      .from("sc_user_photos")
      .update({ deleted: true, is_primary: false })
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { count } = await supabase
      .from("sc_user_photos")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("deleted", false);
    return NextResponse.json({ photo: data, remaining: count ?? 0 });
  }

  if (is_primary) {
    await supabase
      .from("sc_user_photos")
      .update({ is_primary: false })
      .eq("user_id", user.id);
  }
  const { data, error } = await supabase
    .from("sc_user_photos")
    .update({ is_primary: !!is_primary })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ photo: data });
}
