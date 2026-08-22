import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { imgUrls } from "@/lib/storage";
import { canManage, getActivePerson } from "@/lib/person";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import WardrobeGrid, { type GridItem } from "@/components/wardrobe/wardrobe-grid";
import StyleUnusedButton from "@/components/wardrobe/style-unused-button";
import { CATEGORY_LABELS, type Category, type WardrobeItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function WardrobePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; sub?: string; build?: string }>;
}) {
  const { category, sub, build } = await searchParams;
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
      .select("item_ids, render_path")
      .eq("person_id", person.id)
      .eq("deleted", false),
  ]);
  const { data: myFitsData } = await supabase
    .from("sc_outfits")
    .select("id, title, render_path, created_at")
    .eq("person_id", person.id)
    .eq("deleted", false)
    .eq("manual", true)
    .order("created_at", { ascending: false })
    .limit(24);
  const myFits = myFitsData ?? [];

  // How many rendered fits feature each piece — shown as a caption.
  const fitCounts = new Map<string, number>();
  for (const o of activeOutfits ?? []) {
    if (!o.render_path) continue;
    for (const iid of o.item_ids as string[])
      fitCounts.set(iid, (fitCounts.get(iid) ?? 0) + 1);
  }
  // Catalogue order: by garment type, like a store — tops before bottoms,
  // then layers; within a type, a color gradient (hue wheel, then neutrals
  // light→dark) so the rack reads like a curated closet, not a shuffle.
  const TYPE_ORDER: Record<string, number> = {
    top: 0, bottom: 1, outerwear: 2, full_body: 3,
    footwear: 4, accessory: 5, belt: 6, bag: 7, headwear: 8, eyewear: 9,
  };
  const colorKey = (hex: string | null): number => {
    if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return 999;
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (s < 0.14) return 500 + (1 - l) * 100; // neutrals: white → black, after colors
    let h =
      max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return h;
  };
  const allItems = ((data ?? []) as WardrobeItem[]).sort(
    (a, b) =>
      (TYPE_ORDER[a.category] ?? 99) - (TYPE_ORDER[b.category] ?? 99) ||
      colorKey(a.color_hex) - colorKey(b.color_hex)
  );
  const counts = allItems.reduce<Record<string, number>>((acc, i) => {
    acc[i.category] = (acc[i.category] ?? 0) + 1;
    return acc;
  }, {});

  // Granular quick filters: popular subcategory buckets, shown only when the
  // wardrobe actually has a few of them.
  const SUB_BUCKETS: { key: string; label: string; test: (i: WardrobeItem) => boolean }[] = [
    { key: "tshirts", label: "T-shirts", test: (i) => /t-?shirt|\btee\b/i.test(`${i.subcategory} ${i.name}`) },
    { key: "shirts", label: "Shirts", test: (i) => /shirt/i.test(`${i.subcategory} ${i.name}`) && !/t-?shirt|sweatshirt|\btee\b/i.test(`${i.subcategory} ${i.name}`) },
    { key: "polos", label: "Polos", test: (i) => /polo/i.test(`${i.subcategory} ${i.name}`) },
    { key: "knits", label: "Knits & hoodies", test: (i) => /hoodie|sweatshirt|sweater|knit|cardigan/i.test(`${i.subcategory} ${i.name}`) },
    { key: "jeans", label: "Jeans", test: (i) => i.category === "bottom" && /jean|denim/i.test(`${i.subcategory} ${i.name}`) },
    { key: "shorts", label: "Shorts", test: (i) => /short/i.test(`${i.subcategory} ${i.name}`) && i.category === "bottom" },
    { key: "pants", label: "Pants & chinos", test: (i) => i.category === "bottom" && /chino|trouser|pant|jogger/i.test(`${i.subcategory} ${i.name}`) },
    { key: "sneakers", label: "Sneakers", test: (i) => i.category === "footwear" && /sneaker|trainer/i.test(`${i.subcategory} ${i.name}`) },
  ];
  const subBuckets = SUB_BUCKETS.map((b) => ({
    ...b,
    count: allItems.filter(b.test).length,
  })).filter((b) => b.count >= 3);
  const activeSub = subBuckets.find((b) => b.key === sub);

  const usedIds = new Set(
    (activeOutfits ?? []).flatMap((o) => o.item_ids as string[])
  );
  const unusedCount = allItems.filter(
    (i) => i.enabled && !usedIds.has(i.id)
  ).length;

  const items = activeSub
    ? allItems.filter(activeSub.test)
    : category
      ? allItems.filter((i) => i.category === category)
      : allItems;

  const paths = items.map((i) => i.catalog_image_path ?? i.original_image_path);
  for (const f of myFits) if (f.render_path) paths.push(f.render_path);
  const urls = imgUrls(paths);

  const gridItems: GridItem[] = items.map((item) => ({
    id: item.id,
    name: item.name ?? item.subcategory ?? CATEGORY_LABELS[item.category],
    sub: `${item.subcategory ?? item.category}${item.primary_color ? ` · ${item.primary_color}` : ""}${
      fitCounts.get(item.id)
        ? ` · ${fitCounts.get(item.id)} fit${fitCounts.get(item.id) === 1 ? "" : "s"}`
        : ""
    }`,
    category: item.category,
    url: urls[item.catalog_image_path ?? item.original_image_path] ?? null,
    pending: item.catalog_source === "pending",
    benched: !item.enabled,
  }));

  // Section membership for the default (unfiltered) view.
  const SECTIONS: { title: string; cats: Set<string> }[] = [
    { title: "The rack", cats: new Set(["top", "bottom", "outerwear", "full_body"]) },
    { title: "The shoes", cats: new Set(["footwear"]) },
    { title: "The accessories", cats: new Set(["accessory", "belt", "bag", "headwear"]) },
    { title: "The glasses", cats: new Set(["eyewear"]) },
  ];
  const categoryById = new Map(items.map((i) => [i.id, i.category]));
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
          {/* Category chips — scrollable rail on mobile, wraps on desktop */}
          <div className="no-scrollbar -mx-4 mb-3 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:mb-8 sm:flex-wrap sm:overflow-visible sm:px-0">
            <Link
              href="/wardrobe"
              className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] transition-colors ${
                !category && !activeSub
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
                  className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] transition-colors ${
                    category === c && !activeSub
                      ? "bg-ink text-ivory"
                      : "border hairline bg-paper text-ink-soft hover:bg-ivory"
                  }`}
                >
                  {CATEGORY_LABELS[c]} · {counts[c]}
                </Link>
              ))}
          </div>

          {subBuckets.length > 0 && (
            <div className="no-scrollbar -mx-4 mb-5 flex items-center gap-2 overflow-x-auto px-4 sm:-mt-4 sm:mx-0 sm:mb-8 sm:flex-wrap sm:overflow-visible sm:px-0">
              {subBuckets.map((b) => (
                <Link
                  key={b.key}
                  href={activeSub?.key === b.key ? "/wardrobe" : `/wardrobe?sub=${b.key}`}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1 text-[12px] transition-colors ${
                    activeSub?.key === b.key
                      ? "bg-camel text-ivory"
                      : "border border-camel/30 bg-camel/5 text-camel-deep hover:bg-camel/15"
                  }`}
                >
                  {b.label} · {b.count}
                </Link>
              ))}
            </div>
          )}

          {activeSub || category ? (
            <WardrobeGrid
              items={gridItems}
              selectable={editable}
              startSelecting={editable && build === "1"}
            />
          ) : (
            <WardrobeGrid
              items={[]}
              sections={SECTIONS.map((s) => ({
                title: s.title,
                items: gridItems.filter((g) => s.cats.has(categoryById.get(g.id) ?? "")),
              }))}
              selectable={editable}
              startSelecting={editable && build === "1"}
            />
          )}

          {/* Hand-picked experiments live here, out of the main fits gallery */}
          {myFits.length > 0 && (
            <Card className="mt-14">
              <p className="eyebrow mb-4">My own fits — looks you styled yourself</p>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {myFits.map((f) => (
                  <Link key={f.id} href={`/fits/${f.id}`} className="group w-36 shrink-0">
                    <div className="aspect-[3/4] overflow-hidden rounded-xl bg-ivory">
                      {f.render_path && urls[f.render_path] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={urls[f.render_path]}
                          alt={f.title ?? "Hand-picked fit"}
                          className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.04]"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center p-3 text-center">
                          <span className="serif-accent text-[13px] text-ink-faint">
                            rendering…
                          </span>
                        </div>
                      )}
                    </div>
                    <p className="mt-2 truncate text-[12px] font-medium group-hover:text-camel-deep">
                      {f.title ?? "Hand-picked fit"}
                    </p>
                    <p className="text-[11px] text-ink-faint">
                      {new Date(f.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
