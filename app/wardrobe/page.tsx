import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { imgUrls } from "@/lib/storage";
import { canManage, getActivePerson } from "@/lib/person";
import { EmptyState, PageTitle } from "@/components/ui";
import WardrobeGrid, { type GridItem } from "@/components/wardrobe/wardrobe-grid";
import StyleUnusedButton from "@/components/wardrobe/style-unused-button";
import { CATEGORY_LABELS, type Category, type WardrobeItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function WardrobePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { person, role } = await getActivePerson(supabase, user);

  const [{ data }, { data: activeOutfits }] = await Promise.all([
    supabase
      .from("sc_wardrobe_items")
      .select("*")
      .eq("person_id", person.id)
      .eq("deleted", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("sc_outfits")
      .select("item_ids")
      .eq("person_id", person.id)
      .eq("deleted", false),
  ]);

  const allItems = (data ?? []) as WardrobeItem[];
  const counts = allItems.reduce<Record<string, number>>((acc, i) => {
    acc[i.category] = (acc[i.category] ?? 0) + 1;
    return acc;
  }, {});

  const usedIds = new Set(
    (activeOutfits ?? []).flatMap((o) => o.item_ids as string[])
  );
  const unusedCount = allItems.filter(
    (i) => i.enabled && !usedIds.has(i.id)
  ).length;

  const items = category
    ? allItems.filter((i) => i.category === category)
    : allItems;

  const paths = items.map((i) => i.catalog_image_path ?? i.original_image_path);
  const urls = imgUrls(paths);

  const gridItems: GridItem[] = items.map((item) => ({
    id: item.id,
    name: item.name ?? item.subcategory ?? CATEGORY_LABELS[item.category],
    sub: `${item.subcategory ?? item.category}${item.primary_color ? ` · ${item.primary_color}` : ""}`,
    url: urls[item.catalog_image_path ?? item.original_image_path] ?? null,
    pending: item.catalog_source === "pending",
    benched: !item.enabled,
  }));

  const editable = canManage(role);

  return (
    <div className="fade-up">
      <PageTitle eyebrow="The catalogue" title="Your" accent="wardrobe">
        {editable && unusedCount > 0 && <StyleUnusedButton count={unusedCount} />}
        {editable && (
          <Link
            href="/upload"
            className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-ivory transition-opacity hover:opacity-85"
          >
            Add pieces
          </Link>
        )}
      </PageTitle>

      {allItems.length === 0 ? (
        <EmptyState
          title="Your rack is empty."
          body="Upload photos of your clothes, shoes and accessories — we'll classify them and build your personal catalogue."
          ctaHref="/upload"
          ctaLabel="Upload your wardrobe"
        />
      ) : (
        <>
          {/* Category chips */}
          <div className="mb-8 flex flex-wrap items-center gap-2">
            <Link
              href="/wardrobe"
              className={`rounded-full px-4 py-1.5 text-[13px] transition-colors ${
                !category
                  ? "bg-ink text-ivory"
                  : "border hairline bg-paper text-ink-soft hover:bg-ivory"
              }`}
            >
              All · {allItems.length}
            </Link>
            {(Object.keys(CATEGORY_LABELS) as Category[])
              .filter((c) => counts[c])
              .map((c) => (
                <Link
                  key={c}
                  href={`/wardrobe?category=${c}`}
                  className={`rounded-full px-4 py-1.5 text-[13px] transition-colors ${
                    category === c
                      ? "bg-ink text-ivory"
                      : "border hairline bg-paper text-ink-soft hover:bg-ivory"
                  }`}
                >
                  {CATEGORY_LABELS[c]} · {counts[c]}
                </Link>
              ))}
          </div>

          <WardrobeGrid items={gridItems} selectable={editable} />
        </>
      )}
    </div>
  );
}
