import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeWardrobeHash, generateWardrobeScene, loadSceneItems } from "@/lib/scene";
import { backfillPendingCatalogShots } from "@/lib/catalog";
import type { Person, Settings } from "@/lib/types";

export const maxDuration = 300;

const DEFAULT_SETTINGS = {
  provider: "gemini",
  text_model: "gemini-2.5-flash",
  image_model: "gemini-3-pro-image-preview",
} as Settings;

/**
 * Nightly wardrobe-scene refresh (Vercel cron). For each person whose wardrobe
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
  const { data: peopleData } = await admin
    .from("sc_people")
    .select("*")
    .eq("deleted", false);
  const people = (peopleData ?? []) as Person[];

  // Owner settings, fetched once per account.
  const settingsByOwner = new Map<string, Settings>();
  async function ownerSettings(ownerId: string): Promise<Settings> {
    if (!settingsByOwner.has(ownerId)) {
      const { data: s } = await admin
        .from("sc_settings")
        .select("*")
        .eq("user_id", ownerId)
        .maybeSingle();
      settingsByOwner.set(ownerId, (s ?? DEFAULT_SETTINGS) as Settings);
    }
    return settingsByOwner.get(ownerId)!;
  }

  const summary: Record<string, string> = {};

  // 1) catch up on missing product shots, once per owner account
  const owners = [...new Set(people.map((p) => p.owner_id))];
  const shotsByOwner = new Map<string, number>();
  for (const ownerId of owners) {
    try {
      const shots = await backfillPendingCatalogShots(
        admin,
        ownerId,
        await ownerSettings(ownerId),
        10
      );
      shotsByOwner.set(ownerId, shots);
    } catch (e) {
      summary[`owner:${ownerId}`] = `catalog error: ${(e as Error).message.slice(0, 100)}`;
    }
  }

  // 2) refresh each person's scene only if their wardrobe changed
  for (const person of people) {
    try {
      const items = await loadSceneItems(admin, person.id);
      if (!items.length) {
        summary[person.id] = "no items";
        continue;
      }
      const hash = computeWardrobeHash(items);
      if (hash === person.wardrobe_scene_hash && person.wardrobe_scene_status === "done") {
        summary[person.id] = "cached";
        continue;
      }
      const settings = await ownerSettings(person.owner_id);
      const result = await generateWardrobeScene(admin, person.owner_id, person, settings);
      const shots = shotsByOwner.get(person.owner_id) ?? 0;
      summary[person.id] = `${result.status}${shots ? `, ${shots} shots` : ""}`;
    } catch (e) {
      summary[person.id] = `error: ${(e as Error).message.slice(0, 120)}`;
    }
  }
  return NextResponse.json({ summary });
}
