import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signedUrls } from "@/lib/storage";
import { Badge, EmptyState, PageTitle } from "@/components/ui";
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

  const { data } = await supabase
    .from("sc_wardrobe_items")
    .select("*")
    .eq("deleted", false)
    .order("created_at", { ascending: false });

  const allItems = (data ?? []) as WardrobeItem[];
  const counts = allItems.reduce<Record<string, number>>((acc, i) => {
    acc[i.category] = (acc[i.category] ?? 0) + 1;
    return acc;
  }, {});

  const items = category
    ? allItems.filter((i) => i.category === category)
    : allItems;

  const paths = items.map((i) => i.catalog_image_path ?? i.original_image_path);
  const urls = await signedUrls(supabase, paths);

  return (
    <div className="fade-up">
      <PageTitle eyebrow="The catalogue" title="Your" accent="wardrobe">
        <Link
          href="/upload"
          className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-ivory transition-opacity hover:opacity-85"
        >
          Add pieces
        </Link>
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

          <p className="eyebrow mb-6">
            {items.length} piece{items.length === 1 ? "" : "s"}
            {category ? ` — ${CATEGORY_LABELS[category as Category] ?? category}` : ""}
          </p>

          {/* Product grid */}
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => {
              const path = item.catalog_image_path ?? item.original_image_path;
              const url = urls[path];
              return (
                <Link key={item.id} href={`/wardrobe/${item.id}`} className="group">
                  <div className="relative aspect-square overflow-hidden rounded-xl border hairline bg-paper">
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={url}
                        alt={item.name ?? "Wardrobe item"}
                        className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04] ${
                          !item.enabled ? "opacity-40 grayscale" : ""
                        }`}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <span className="serif-accent text-ink-faint">no image</span>
                      </div>
                    )}
                    {item.catalog_source === "pending" && (
                      <div className="absolute left-2 top-2">
                        <Badge tone="neutral">original shot</Badge>
                      </div>
                    )}
                    {!item.enabled && (
                      <div className="absolute right-2 top-2">
                        <Badge tone="ink">benched</Badge>
                      </div>
                    )}
                  </div>
                  <div className="mt-3">
                    <p className="truncate text-[13px] font-medium tracking-tight">
                      {item.name ?? item.subcategory ?? CATEGORY_LABELS[item.category]}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] uppercase tracking-widest text-ink-faint">
                      {item.subcategory ?? item.category}
                      {item.primary_color ? ` · ${item.primary_color}` : ""}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
