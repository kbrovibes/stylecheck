import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";

const ADMIN_EMAILS = ["k4rthikr@gmail.com"];

const BOOL_FIELDS = [
  "generate_accessories",
  "generate_shoes",
  "generate_belts",
  "auto_render",
  "goofy_mode",
  "alt_render_async",
  "show_model_badge",
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
  if (
    typeof body.person_image_model === "string" &&
    ["gemini-3-pro-image-preview", "gemini-2.5-flash-image", "gpt-image-1.5", "gpt-image-1"].includes(
      body.person_image_model
    )
  )
    update.person_image_model = body.person_image_model;
  for (const f of BOOL_FIELDS) {
    if (f in body) update[f] = !!body[f];
  }

  // Non-admin accounts are Gemini-only: no OpenAI provider/models, no
  // alt-model comparison renders.
  if (!user.email || !ADMIN_EMAILS.includes(user.email)) {
    if (update.provider === "openai") update.provider = "gemini";
    for (const f of ["text_model", "image_model", "person_image_model"] as const) {
      if (typeof update[f] === "string" && !(update[f] as string).startsWith("gemini"))
        delete update[f];
    }
    update.alt_render_async = false;
  }

  const { data, error } = await supabase
    .from("sc_settings")
    .upsert(update)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}
