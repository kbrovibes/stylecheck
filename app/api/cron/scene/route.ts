import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeWardrobeHash, generateWardrobeScene, loadSceneItems } from "@/lib/scene";
import { backfillPendingCatalogShots } from "@/lib/catalog";
import type { Settings } from "@/lib/types";

export const maxDuration = 300;

/**
 * Nightly wardrobe-scene refresh (Vercel cron). For each user whose wardrobe
 * changed since the last scene (hash mismatch) — or whose last attempt failed —
 * regenerate. Unchanged wardrobes keep the cached scene, so the home page stays
 * instant.
 */
export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("sc_profiles")
    .select("id, wardrobe_scene_hash, wardrobe_scene_status");

  const summary: Record<string, string> = {};
  for (const p of profiles ?? []) {
    try {
      const { data: s } = await admin
        .from("sc_settings")
        .select("*")
        .eq("user_id", p.id)
        .maybeSingle();
      const settings = (s ?? {
        provider: "gemini",
        text_model: "gemini-2.5-flash",
        image_model: "gemini-2.5-flash-image",
      }) as Settings;

      // 1) catch up on missing product shots (widgets are catalog-image-first)
      const shots = await backfillPendingCatalogShots(admin, p.id, settings, 10);

      // 2) refresh the wardrobe scene only if the wardrobe changed
      const items = await loadSceneItems(admin, p.id);
      if (!items.length) {
        summary[p.id] = "no items";
        continue;
      }
      const hash = computeWardrobeHash(items);
      if (hash === p.wardrobe_scene_hash && p.wardrobe_scene_status === "done") {
        summary[p.id] = shots ? `cached scene, ${shots} shots` : "cached";
        continue;
      }
      const result = await generateWardrobeScene(admin, p.id, settings);
      summary[p.id] = `${result.status}${shots ? `, ${shots} shots` : ""}`;
    } catch (e) {
      summary[p.id] = `error: ${(e as Error).message}`;
    }
  }
  return NextResponse.json({ summary });
}
