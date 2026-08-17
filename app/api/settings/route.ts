import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";

const BOOL_FIELDS = [
  "generate_accessories",
  "generate_shoes",
  "generate_belts",
  "auto_render",
  "goofy_mode",
] as const;

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
    user_id: user.id,
    updated_at: new Date().toISOString(),
    generate_glasses: false, // unsupported in v1
  };
  if ("provider" in body) {
    if (!["gemini", "openai"].includes(body.provider))
      return NextResponse.json({ error: "invalid provider" }, { status: 400 });
    update.provider = body.provider;
  }
  if (typeof body.text_model === "string" && body.text_model.trim())
    update.text_model = body.text_model.trim();
  if (typeof body.image_model === "string" && body.image_model.trim())
    update.image_model = body.image_model.trim();
  for (const f of BOOL_FIELDS) {
    if (f in body) update[f] = !!body[f];
  }

  const { data, error } = await supabase
    .from("sc_settings")
    .upsert(update)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}
