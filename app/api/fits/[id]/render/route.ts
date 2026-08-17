import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateProfile, getOrCreateSettings } from "@/lib/account";
import { renderOutfitRecord } from "@/lib/render";
import type { Outfit } from "@/lib/types";

export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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

  try {
    const [profile, settings] = await Promise.all([
      getOrCreateProfile(supabase, user),
      getOrCreateSettings(supabase, user.id),
    ]);
    const path = await renderOutfitRecord(supabase, user.id, outfit, profile, settings);
    return NextResponse.json({ render_path: path });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Render failed";
    const status = msg.startsWith("Add at least") || msg.startsWith("This fit") ? 400 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
