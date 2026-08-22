import { NextResponse } from "next/server";
import { creditErrorResponse, spendCredit } from "@/lib/credits";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { after } from "next/server";
import { renderOutfitRecord } from "@/lib/render";
import { GPT_PERSON_MODEL, altPersonModel, resolvePersonModel } from "@/lib/ai";
import type { Outfit, Person } from "@/lib/types";

export const maxDuration = 300;

const ADMIN_EMAILS = ["k4rthikr@gmail.com"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const goofy = !!body?.goofy;
  const gpt = !!body?.gpt;

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
    await spendCredit(supabase, user, "image", goofy && !outfit.render_path ? 2 : 1);
  } catch (e) {
    const c = creditErrorResponse(e);
    if (c) return NextResponse.json({ error: c.error }, { status: 429 });
  }
  if (outfit.render_status === "pending") {
    return NextResponse.json(
      { error: "Already rendering this fit — give it a moment." },
      { status: 409 }
    );
  }

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
    // Admin-only comparison render with GPT: recorded in render history
    // ("Additional renders") only — never becomes the fit's main render.
    if (gpt) {
      if (!user.email || !ADMIN_EMAILS.includes(user.email)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      const path = await renderOutfitRecord(
        supabase,
        user.id,
        outfit,
        personData as Person,
        settings,
        { modelOverride: GPT_PERSON_MODEL, recordOnly: true }
      );
      return NextResponse.json({ render_path: path });
    }
    // The classic render is canonical — a goofy request on an unrendered fit
    // produces the normal version first, then the goofy take.
    if (goofy && !outfit.render_path) {
      await renderOutfitRecord(supabase, user.id, outfit, personData as Person, settings);
    }
    const path = await renderOutfitRecord(supabase, user.id, outfit, personData as Person, settings, { goofy });
    // Admin option: also render with the other model family for comparison
    // (history-only — the primary pointer stays with the chosen model).
    if (settings.alt_render_async) {
      const alt = altPersonModel(resolvePersonModel(settings));
      after(() =>
        renderOutfitRecord(supabase, user.id, outfit, personData as Person, settings, {
          goofy,
          modelOverride: alt,
          recordOnly: true,
        }).catch((e) => console.error("alt render failed:", e))
      );
    }
    return NextResponse.json({ render_path: path });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Render failed";
    const status = msg.startsWith("Add at least") || msg.startsWith("This fit") ? 400 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
