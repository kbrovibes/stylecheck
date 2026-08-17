import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { geocodeZip } from "@/lib/weather";

export async function PATCH(request: Request) {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;
  const body = await request.json();

  const update: Record<string, unknown> = {
    id: user.id,
    email: user.email,
    updated_at: new Date().toISOString(),
  };
  if ("display_name" in body) update.display_name = body.display_name || null;
  if ("age" in body) {
    const age = Math.round(Number(body.age));
    update.birth_year =
      body.age && age > 0 && age < 120 ? new Date().getFullYear() - age : null;
  }
  if ("height_cm" in body)
    update.height_cm = body.height_cm ? Math.round(Number(body.height_cm)) : null;
  if ("weight_kg" in body)
    update.weight_kg = body.weight_kg ? Number(body.weight_kg) : null;

  let warning: string | null = null;
  if ("zip_code" in body) {
    const zip = (body.zip_code ?? "").toString().trim();
    const country = (body.country_code ?? "US").toString().trim() || "US";
    update.zip_code = zip || null;
    update.country_code = country;
    if (zip) {
      try {
        const geo = await geocodeZip(zip, country);
        update.lat = geo.lat;
        update.lon = geo.lon;
        update.place_name = geo.place_name;
      } catch {
        warning = `Couldn't find ${zip} — saved anyway, weather won't show until it resolves.`;
        update.lat = null;
        update.lon = null;
        update.place_name = null;
      }
    } else {
      update.lat = null;
      update.lon = null;
      update.place_name = null;
    }
  }

  const { data, error } = await supabase
    .from("sc_profiles")
    .upsert(update)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data, warning });
}
