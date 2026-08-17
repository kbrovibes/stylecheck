import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";

const EDITABLE_FIELDS = [
  "enabled",
  "deleted",
  "name",
  "subcategory",
  "formality",
  "seasons",
  "style_tags",
  "colors",
] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  const body = await request.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) update[field] = body[field];
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no editable fields" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("sc_wardrobe_items")
    .select("id, user_id, person_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data: ok } = existing.person_id
    ? await supabase.rpc("sc_can_manage_person", { pid: existing.person_id })
    : { data: existing.user_id === user.id };
  if (!ok) {
    return NextResponse.json(
      { error: "You have view-only access to this profile." },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from("sc_wardrobe_items")
    .update(update)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item: data });
}
