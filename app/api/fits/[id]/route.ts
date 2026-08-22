import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { DISLIKE_REASONS, type Outfit } from "@/lib/types";

/** Soft-delete a fit (renders and history are kept). */
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
    .from("sc_outfits")
    .select("id, person_id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  const outfit = data as Pick<Outfit, "id" | "person_id" | "user_id">;

  const { data: ok } = outfit.person_id
    ? await supabase.rpc("sc_can_manage_person", { pid: outfit.person_id })
    : { data: outfit.user_id === user.id };
  if (!ok) {
    return NextResponse.json(
      { error: "You have view-only access to this profile." },
      { status: 403 }
    );
  }

  await supabase.from("sc_outfits").update({ deleted: true }).eq("id", id);
  return NextResponse.json({ ok: true });
}

/**
 * Set or clear a thumbs reaction on a fit. A thumbs-down may carry feedback:
 * standard reasons + a free-text note, stored on the outfit and fed back to
 * the stylist on future compositions. Anything but a thumbs-down clears them.
 */
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
  const { supabase, user } = ctx;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reaction =
    body.reaction === 1 || body.reaction === -1 ? body.reaction : null;
  const valid = new Set<string>(DISLIKE_REASONS);
  const reasons =
    reaction === -1 && Array.isArray(body.reasons)
      ? [...new Set(body.reasons.filter((r: unknown) => typeof r === "string" && valid.has(r)))]
      : [];
  const note =
    reaction === -1 && typeof body.note === "string"
      ? body.note.trim().slice(0, 300)
      : "";

  const { data } = await supabase
    .from("sc_outfits")
    .select("id, person_id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  const outfit = data as Pick<Outfit, "id" | "person_id" | "user_id">;
  const { data: ok } = outfit.person_id
    ? await supabase.rpc("sc_can_manage_person", { pid: outfit.person_id })
    : { data: outfit.user_id === user.id };
  if (!ok) {
    return NextResponse.json(
      { error: "You have view-only access to this profile." },
      { status: 403 }
    );
  }
  await supabase
    .from("sc_outfits")
    .update({
      reaction,
      dislike_reasons: reasons.length ? reasons : null,
      dislike_note: note || null,
    })
    .eq("id", id);
  return NextResponse.json({ ok: true, reaction });
}
