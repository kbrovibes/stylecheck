import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { renderOutfitRecord } from "@/lib/render";
import type { Outfit, Person } from "@/lib/types";

export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const goofy = !!body?.goofy;

  let supabase, user;
  try {
    ({ supabase, user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: outfitData } = await supabase
    .from("sc_outfits")
    .select("*")
    .eq("id", id)
    .eq("deleted", false)
    .single();
  if (!outfitData) {
    return NextResponse.json({ error: "Fit not found" }, { status: 404 });
  }
  const outfit = outfitData as Outfit;

  const { data: ok } = outfit.person_id
    ? await supabase.rpc("sc_can_manage_person", { pid: outfit.person_id })
    : { data: outfit.user_id === user.id };
  if (!ok) {
    return NextResponse.json(
      { error: "You have view-only access to this profile." },
      { status: 403 }
    );
  }
  const { data: personData } = await supabase
    .from("sc_people")
    .select("*")
    .eq("id", outfit.person_id!)
    .single();
  if (!personData) {
    return NextResponse.json({ error: "profile not found" }, { status: 404 });
  }

  try {
    const settings = await getOrCreateSettings(supabase, user.id);
// The classic render is canonical — a goofy request on an unrendered fit
    // produces the normal version first, then the goofy take.
    if (goofy && !outfit.render_path) {
      await renderOutfitRecord(supabase, user.id, outfit, personData as Person, settings);
    }
    const path = await renderOutfitRecord(supabase, user.id, outfit, personData as Person, settings, { goofy });
    return NextResponse.json({ render_path: path });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Render failed";
    const status = msg.startsWith("Add at least") || msg.startsWith("This fit") ? 400 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
