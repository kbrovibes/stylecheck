import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signedUrls } from "@/lib/storage";
import { Badge, EmptyState, PageTitle } from "@/components/ui";
import GenerateButton from "@/components/fits/generate-button";
import {
  OCCASION_LABELS,
  type Occasion,
  type Outfit,
  type WardrobeItem,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function FitsPage({
  searchParams,
}: {
  searchParams: Promise<{ occasion?: string }>;
}) {
  const { occasion } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let query = supabase
    .from("sc_outfits")
    .select("*")
    .eq("deleted", false)
    .order("created_at", { ascending: false });
  if (occasion && occasion in OCCASION_LABELS) {
    query = query.eq("occasion", occasion);
  }
  const [{ data: outfitsData }, { data: itemsData }] = await Promise.all([
    query,
    supabase.from("sc_wardrobe_items").select("*").eq("deleted", false),
  ]);
  const outfits = (outfitsData ?? []) as Outfit[];
  const items = (itemsData ?? []) as WardrobeItem[];
  const itemById = new Map(items.map((i) => [i.id, i]));

  const paths = new Set<string>();
  for (const o of outfits) {
    if (o.render_path) {
      paths.add(o.render_path);
    } else {
      for (const iid of o.item_ids.slice(0, 4)) {
        const item = itemById.get(iid);
        if (item) paths.add(item.catalog_image_path ?? item.original_image_path);
      }
    }
  }
  const urls = await signedUrls(supabase, [...paths]);

  const tabs: { value: string; label: string }[] = [
    { value: "", label: "All" },
    ...Object.entries(OCCASION_LABELS).map(([value, label]) => ({ value, label })),
  ];

  return (
    <div className="fade-up">
      <PageTitle eyebrow="The lookbook" title="Your" accent="fits">
        <GenerateButton />
      </PageTitle>

      <div className="mb-8 flex flex-wrap gap-2">
        {tabs.map((t) => {
          const active = (occasion ?? "") === t.value;
          return (
            <Link
              key={t.value}
              href={t.value ? `/fits?occasion=${t.value}` : "/fits"}
              className={`rounded-full px-4 py-1.5 text-[13px] transition-colors ${
                active
                  ? "bg-ink text-ivory"
                  : "border hairline bg-paper text-ink-soft hover:bg-ivory"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {outfits.length === 0 ? (
        <EmptyState
          title="Nothing on the rack yet."
          body={
            occasion
              ? "No fits for this occasion yet — generate a fresh set."
              : "Your stylist is ready. Generate fits from your wardrobe and see them rendered on you."
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {outfits.map((o) => {
            const thumbs = o.item_ids
              .slice(0, 4)
              .map((iid) => itemById.get(iid))
              .filter(Boolean) as WardrobeItem[];
            return (
              <Link
                key={o.id}
                href={`/fits/${o.id}`}
                className="group overflow-hidden rounded-2xl border hairline bg-paper transition-shadow hover:shadow-lg hover:shadow-ink/5"
              >
                <div className="relative aspect-[3/4] overflow-hidden bg-ivory">
                  {o.render_path && urls[o.render_path] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={urls[o.render_path]}
                      alt={o.title ?? "Fit"}
                      className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="grid h-full grid-cols-2 gap-1 p-3">
                      {thumbs.map((t) => {
                        const p = t.catalog_image_path ?? t.original_image_path;
                        return urls[p] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={t.id}
                            src={urls[p]}
                            alt={t.name ?? t.category}
                            className="h-full w-full rounded-lg object-cover"
                          />
                        ) : (
                          <div key={t.id} className="rounded-lg bg-hairline/50" />
                        );
                      })}
                      <div className="absolute inset-x-0 bottom-2 text-center">
                        <span className="rounded-full bg-paper/85 px-2.5 py-1 text-[10px] uppercase tracking-widest text-ink-faint backdrop-blur">
                          unrendered
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-start justify-between gap-2 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{o.title}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {o.occasion && (
                        <Badge tone="camel">
                          {OCCASION_LABELS[o.occasion as Occasion] ?? o.occasion}
                        </Badge>
                      )}
                      {o.seasons.slice(0, 2).map((s) => (
                        <Badge key={s}>{s}</Badge>
                      ))}
                    </div>
                  </div>
                  {o.score != null && (
                    <span className="serif-accent shrink-0 text-lg text-camel">
                      {Number(o.score).toFixed(1)}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
