import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import type { Person } from "@/lib/types";

/** Rename / relabel a person. Owner or manager. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase } = ctx;
  const { id } = await params;

  const { data: allowed } = await supabase.rpc("sc_can_manage_person", { pid: id });
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    update.name = body.name.trim().slice(0, 60);
  }
  if ("relationship" in body) {
    update.relationship =
      typeof body.relationship === "string"
        ? body.relationship.trim().slice(0, 60) || null
        : null;
  }
  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("sc_people")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ person: data });
}

/** Soft-delete a person. Owner only; the default profile is protected. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;
  const { id } = await params;

  const { data } = await supabase
    .from("sc_people")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const person = data as Person | null;
  if (!person) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (person.owner_id !== user.id) {
    return NextResponse.json({ error: "Only the owner can remove a profile" }, { status: 403 });
  }
  if (person.is_default) {
    return NextResponse.json(
      { error: "Your primary profile can't be removed" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("sc_people")
    .update({ deleted: true })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
