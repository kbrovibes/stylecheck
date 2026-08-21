import { NextResponse } from "next/server";
import { creditErrorResponse, spendCredit } from "@/lib/credits";
import { requireUser } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { canManage, getActivePerson } from "@/lib/person";
import { generateBaseRender, generateIdentityNotes } from "@/lib/ai";
import { generateFaceAvatar } from "@/lib/avatar";
import { toJpegBase64 } from "@/lib/img-server";
import { downloadAsImageInput, imgUrl, uploadBase64 } from "@/lib/storage";
import type { RenderAdjustments, UserPhoto } from "@/lib/types";

export const maxDuration = 300;

function sanitizeAdjustments(raw: unknown): RenderAdjustments | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const dial = (v: unknown) =>
    Math.max(-2, Math.min(2, Math.round(Number(v) || 0)));
  const adj: RenderAdjustments = {
    build: dial(a.build),
    shoulders: dial(a.shoulders),
    waist: dial(a.waist),
    note: typeof a.note === "string" ? a.note.slice(0, 300) : undefined,
  };
  if (!adj.build && !adj.shoulders && !adj.waist && !adj.note?.trim())
    return null;
  return adj;
}

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;

  let body: { adjustments?: unknown; preview?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    // no body — plain re-generate with saved adjustments
  }
  const preview = !!body.preview;

  const { person, role } = await getActivePerson(supabase, user);
  if (!canManage(role)) {
    return NextResponse.json(
      { error: "You have view-only access to this profile." },
      { status: 403 }
    );
  }
  try {
    await spendCredit(supabase, user, "image");
  } catch (e) {
    const c = creditErrorResponse(e);
    if (c) return NextResponse.json({ error: c.error }, { status: 429 });
  }
  const settings = await getOrCreateSettings(supabase, user.id);
  const adjustments =
    body.adjustments !== undefined
      ? sanitizeAdjustments(body.adjustments)
      : (person.render_adjustments ?? null);

  const { data: photos } = await supabase
    .from("sc_user_photos")
    .select("*")
    .eq("person_id", person.id)
    .eq("deleted", false);

  const all = (photos ?? []) as UserPhoto[];
  if (!all.length) {
    return NextResponse.json(
      { error: "Add at least one photo of yourself first — a full-body shot works best." },
      { status: 400 }
    );
  }

  const rank = (p: UserPhoto) =>
    (p.is_primary ? 0 : 4) +
    (p.kind === "full_body" ? 0 : p.kind === "half_body" ? 1 : p.kind === "selfie" ? 2 : 3);
  const picked = all.sort((a, b) => rank(a) - rank(b)).slice(0, 4);

  try {
    const images = await Promise.all(
      picked.map((p) => downloadAsImageInput(supabase, p.storage_path))
    );
    // Refresh the identity passport from the real photos — future renders
    // cross-check the face against this description.
    try {
      const identityNotes = await generateIdentityNotes(settings, images);
      await supabase
        .from("sc_people")
        .update({ identity_notes: identityNotes })
        .eq("id", person.id);
    } catch (e) {
      console.error("identity notes failed:", e);
    }
    const result = await generateBaseRender(settings, person, images, adjustments);
    const jpeg = await toJpegBase64(result.data, 90);
    const path = `${user.id}/renders/base-${Date.now()}.jpg`;
    await uploadBase64(supabase, path, jpeg.data, jpeg.mimeType);

    const adjSummary = adjustments
      ? ` adj[b${adjustments.build}/s${adjustments.shoulders}/w${adjustments.waist}${adjustments.note ? " +note" : ""}]`
      : "";
    await supabase.from("sc_renders").insert({
      user_id: user.id,
      person_id: person.id,
      subject_type: "profile",
      subject_id: person.id,
      storage_path: path,
      model: settings.image_model,
      prompt_summary: `base render from ${picked.length} photo(s), ${person.height_cm ?? "?"}cm/${person.weight_kg ?? "?"}kg${adjSummary}${preview ? " (preview)" : ""}`,
    });

    if (!preview) {
      await supabase
        .from("sc_people")
        .update({
          base_render_path: path,
          render_adjustments: adjustments,
        })
        .eq("id", person.id);
    }

    const url = imgUrl(path);
    return NextResponse.json({ path, url, preview });
  } catch (e) {
    return NextResponse.json(
      { error: `Render failed: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}

/** Promote a previously generated (preview) render to the active base render. */
export async function PUT(request: Request) {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;
  const { person, role } = await getActivePerson(supabase, user);
  if (!canManage(role)) {
    return NextResponse.json(
      { error: "You have view-only access to this profile." },
      { status: 403 }
    );
  }
  const body = await request.json().catch(() => ({}));
  const path = typeof body.path === "string" ? body.path : null;
  if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });

  const { data: render } = await supabase
    .from("sc_renders")
    .select("id")
    .eq("person_id", person.id)
    .eq("subject_type", "profile")
    .eq("storage_path", path)
    .maybeSingle();
  if (!render) {
    return NextResponse.json({ error: "unknown render" }, { status: 404 });
  }

  const update: Record<string, unknown> = { base_render_path: path };
  if (body.adjustments !== undefined) {
    update.render_adjustments = sanitizeAdjustments(body.adjustments);
  }
  await supabase.from("sc_people").update(update).eq("id", person.id);
  try {
    await generateFaceAvatar(supabase, user.id, { ...person, base_render_path: path });
  } catch (e) {
    console.error("avatar generation failed:", e);
  }
  return NextResponse.json({ ok: true });
}
