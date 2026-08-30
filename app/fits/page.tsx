import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { getActivePerson } from "@/lib/person";
import { imgUrls } from "@/lib/storage";
import { EmptyState, PageTitle } from "@/components/ui";
import GenerateButton from "@/components/fits/generate-button";
import FitsGallery, { type FitCard } from "@/components/fits/fits-gallery";
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
  const mineOnly = mine === "1";
  const minScore = min === "8" || min === "9" ? Number(min) : null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { person } = await getActivePerson(supabase, user);
  const gallerySettings = await getOrCreateSettings(supabase, user.id);
  const goofyMode = gallerySettings.goofy_mode;

  let query = supabase
    .from("sc_outfits")
    .select("*")
    .eq("person_id", person.id)
    .eq("deleted", false)
    // Hand-picked fits live behind their own "Styled by me" filter.
    .eq("manual", mineOnly)
    .order("created_at", { ascending: false });
  if (occasion && occasion in OCCASION_LABELS) {
    query = query.eq("occasion", occasion);
  }
  const [{ data: outfitsData }, { data: itemsData }, { count: manualCount }, { count: stylistCount }] =
    await Promise.all([
      query,
      supabase
        .from("sc_wardrobe_items")
        .select("*")
        .eq("person_id", person.id)
        .eq("deleted", false),
      supabase
        .from("sc_outfits")
        .select("id", { count: "exact", head: true })
        .eq("person_id", person.id)
        .eq("deleted", false)
        .eq("manual", true),
      supabase
        .from("sc_outfits")
        .select("id", { count: "exact", head: true })
        .eq("person_id", person.id)
        .eq("deleted", false)
        .eq("manual", false),
    ]);

  const outfits = (outfitsData ?? []) as Outfit[];
  const visibleOutfits =
    minScore === null
      ? outfits
      : outfits.filter((o) => (o.score ?? 0) >= minScore);
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

  const cards: FitCard[] = visibleOutfits.map((o) => ({
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
    thumbs: o.item_ids.slice(0, 4).map((iid) => {
      const item = itemById.get(iid);
      const path = item ? (item.catalog_image_path ?? item.original_image_path) : null;
      return { id: iid, url: path ? (urls[path] ?? null) : null };
    }),
  }));

  const tabs: { value: string; label: string }[] = [
    { value: "", label: "All" },
    ...Object.entries(OCCASION_LABELS).map(([value, label]) => ({ value, label })),
  ];

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

      {/* Who styled it — the primary split, so it never scrolls out of reach
          on mobile the way it did when it sat at the end of the chip rail. */}
      <div className="mb-4 flex rounded-full border hairline bg-paper p-1 sm:mb-5 sm:w-fit">
        {[
          { mine: false, label: "Stylist picks", count: stylistCount },
          { mine: true, label: "Styled by me", count: manualCount },
        ].map((seg) => {
          const params = new URLSearchParams();
          if (occasion) params.set("occasion", occasion);
          if (min) params.set("min", min);
          if (seg.mine) params.set("mine", "1");
          const qs = params.toString();
          const active = mineOnly === seg.mine;
          return (
            <Link
              key={seg.label}
              href={qs ? `/fits?${qs}` : "/fits"}
              aria-current={active ? "true" : undefined}
              className={`flex-1 whitespace-nowrap rounded-full px-4 py-2 text-center text-[13px] font-medium transition-colors sm:flex-none ${
                active
                  ? "bg-ink text-ivory"
                  : "text-ink-soft hover:bg-ivory"
              }`}
            >
              {seg.label}
              <span className={`ml-1.5 text-[11px] ${active ? "text-ivory/60" : "text-ink-faint"}`}>
                {seg.count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* One scrollable chip rail on mobile; wraps on desktop */}
      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:mb-8 sm:flex-wrap sm:overflow-visible sm:px-0">
        {tabs.map((t) => {
          const active = (occasion ?? "") === t.value;
          const params = new URLSearchParams();
          if (t.value) params.set("occasion", t.value);
          if (min) params.set("min", min);
          if (mineOnly) params.set("mine", "1");
          const qs = params.toString();
          return (
            <Link
              key={t.value}
              href={qs ? `/fits?${qs}` : "/fits"}
              aria-current={active ? "true" : undefined}
              className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] transition-colors ${
                active
                  ? "bg-ink text-ivory"
                  : "border hairline bg-paper text-ink-soft hover:bg-ivory"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
        <span className="mx-1 hidden self-center text-ink-faint/40 sm:inline">|</span>
        {[
          { v: "", label: "Any rating" },
          { v: "8", label: "8+" },
          { v: "9", label: "9+" },
        ].map((f) => {
          const active = (min ?? "") === f.v;
          const params = new URLSearchParams();
          if (occasion) params.set("occasion", occasion);
          if (f.v) params.set("min", f.v);
          if (mineOnly) params.set("mine", "1");
          const qs = params.toString();
          return (
            <Link
              key={f.label}
              href={qs ? `/fits?${qs}` : "/fits"}
              className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] transition-colors ${
                active
                  ? "bg-camel text-ivory"
                  : "border hairline bg-paper text-ink-soft hover:bg-ivory"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {visibleOutfits.length === 0 ? (
        <EmptyState
          title="Nothing on the rack yet."
          body={
            mineOnly
              ? "You haven't styled a fit yourself yet — hit Build my own fit on the Wardrobe page."
              : occasion
                ? "No fits for this occasion yet — generate a fresh set."
                : "Your stylist is ready. Generate fits from your wardrobe and see them rendered on you."
          }
        />
      ) : (
        <FitsGallery cards={cards} goofyMode={goofyMode} />
      )}
    </div>
  );
}
