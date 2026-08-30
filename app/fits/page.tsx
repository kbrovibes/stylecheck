import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { getActivePerson } from "@/lib/person";
import { imgUrls } from "@/lib/storage";
import { PageTitle } from "@/components/ui";
import GenerateButton from "@/components/fits/generate-button";
import FitsBrowser from "@/components/fits/fits-browser";
import { type FitCard } from "@/components/fits/fits-gallery";
import {
  OCCASION_LABELS,
  type Occasion,
  type Outfit,
  type WardrobeItem,
} from "@/lib/types";

function goofyFirst(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) % 997;
  return h % 2 === 0;
}

export const dynamic = "force-dynamic";

export default async function FitsPage({
  searchParams,
}: {
  searchParams: Promise<{ occasion?: string; min?: string; mine?: string }>;
}) {
  const { occasion, min, mine } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { person } = await getActivePerson(supabase, user);
  const gallerySettings = await getOrCreateSettings(supabase, user.id);

  // Load the whole lookbook once — filtering happens in the browser, so a
  // filter change costs nothing rather than a full dynamic page render.
  const [{ data: outfitsData }, { data: itemsData }] = await Promise.all([
    supabase
      .from("sc_outfits")
      .select("*")
      .eq("person_id", person.id)
      .eq("deleted", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("sc_wardrobe_items")
      .select("*")
      .eq("person_id", person.id)
      .eq("deleted", false),
  ]);

  const outfits = (outfitsData ?? []) as Outfit[];
  const items = (itemsData ?? []) as WardrobeItem[];
  const itemById = new Map(items.map((i) => [i.id, i]));

  const paths = new Set<string>();
  for (const o of outfits) {
    if (o.goofy_render_path) paths.add(o.goofy_render_path);
    if (o.render_path) {
      paths.add(o.render_path);
    } else {
      for (const iid of o.item_ids.slice(0, 4)) {
        const item = itemById.get(iid);
        if (item) paths.add(item.catalog_image_path ?? item.original_image_path);
      }
    }
  }
  const urls = imgUrls([...paths]);

  const cards: FitCard[] = outfits.map((o) => ({
    id: o.id,
    title: o.title,
    occasion: o.occasion,
    occasionLabel: o.occasion
      ? (OCCASION_LABELS[o.occasion as Occasion] ?? o.occasion)
      : null,
    seasons: o.seasons ?? [],
    score: o.score,
    classicUrl: o.render_path ? (urls[o.render_path] ?? null) : null,
    goofyUrl: o.goofy_render_path ? (urls[o.goofy_render_path] ?? null) : null,
    goofyLead: goofyFirst(o.id),
    degraded: o.item_ids.some((iid) => !itemById.has(iid)),
    reaction: o.reaction,
    manual: !!o.manual,
    thumbs: o.item_ids.slice(0, 4).map((iid) => {
      const item = itemById.get(iid);
      const path = item ? (item.catalog_image_path ?? item.original_image_path) : null;
      return { id: iid, url: path ? (urls[path] ?? null) : null };
    }),
  }));

  return (
    <div className="fade-up">
      <PageTitle eyebrow="The lookbook" title="Your" accent="fits">
        <Link
          href="/wardrobe?build=1"
          className="rounded-full bg-camel px-5 py-2.5 text-[13px] font-medium text-ivory shadow-lg shadow-camel/30 transition-all hover:bg-camel-deep hover:shadow-camel/40"
        >
          Build my own fit
        </Link>
        <GenerateButton />
      </PageTitle>

      <FitsBrowser
        cards={cards}
        goofyMode={gallerySettings.goofy_mode}
        initial={{
          occasion: occasion && occasion in OCCASION_LABELS ? occasion : "",
          mine: mine === "1",
          min: min === "8" || min === "9" ? min : "",
        }}
      />
    </div>
  );
}
