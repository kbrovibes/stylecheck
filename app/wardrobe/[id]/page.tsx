import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { imgUrls } from "@/lib/storage";
import { Badge, Eyebrow } from "@/components/ui";
import type { Outfit } from "@/lib/types";
import { CATEGORY_LABELS, type WardrobeItem } from "@/lib/types";
import ImageToggle from "@/components/wardrobe/image-toggle";
import ItemActions from "@/components/wardrobe/item-actions";

export const dynamic = "force-dynamic";

export default async function ItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("sc_wardrobe_items")
    .select("*")
    .eq("id", id)
    .eq("deleted", false)
    .maybeSingle();
  if (!data) notFound();
  const item = data as WardrobeItem;
  const { data: canEdit } = item.person_id
    ? await supabase.rpc("sc_can_manage_person", { pid: item.person_id })
    : { data: item.user_id === user.id };

  const { data: fitsData } = await supabase
    .from("sc_outfits")
    .select("*")
    .eq("deleted", false)
    .contains("item_ids", [item.id])
    .order("created_at", { ascending: false })
    .limit(12);
  const fits = (fitsData ?? []) as Outfit[];

  const urls = imgUrls([
    item.catalog_image_path,
    item.original_image_path,
    ...fits.map((f) => f.render_path),
  ].filter(Boolean) as string[]);
  const catalogUrl = item.catalog_image_path ? urls[item.catalog_image_path] ?? null : null;
  const originalUrl = urls[item.original_image_path] ?? null;

  return (
    <div className="fade-up">
      <Link href="/wardrobe" className="text-[13px] text-ink-faint hover:text-ink">
        ← Wardrobe
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <ImageToggle
          catalogUrl={catalogUrl}
          originalUrl={originalUrl}
          alt={item.name ?? "Wardrobe item"}
        />

        <div>
          <Eyebrow>
            {CATEGORY_LABELS[item.category] ?? item.category}
            {item.subcategory ? ` — ${item.subcategory}` : ""}
          </Eyebrow>
          <h1 className="text-3xl font-semibold tracking-tight">
            {item.name ?? item.subcategory ?? "Untitled piece"}
          </h1>
          {item.description && (
            <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-soft">
              {item.description}
            </p>
          )}

          <dl className="mt-8 space-y-4 border-t hairline pt-6 text-sm">
            {item.colors.length > 0 && (
              <div className="flex items-start justify-between gap-6">
                <dt className="text-ink-faint">Colors</dt>
                <dd className="flex flex-wrap justify-end gap-1.5">
                  {item.colors.map((c) => (
                    <Badge key={c}>{c}</Badge>
                  ))}
                </dd>
              </div>
            )}
            {item.pattern && (
              <div className="flex justify-between gap-6">
                <dt className="text-ink-faint">Pattern</dt>
                <dd className="capitalize">{item.pattern}</dd>
              </div>
            )}
            {item.material && (
              <div className="flex justify-between gap-6">
                <dt className="text-ink-faint">Material</dt>
                <dd className="capitalize">{item.material}</dd>
              </div>
            )}
            {item.formality && (
              <div className="flex justify-between gap-6">
                <dt className="text-ink-faint">Formality</dt>
                <dd>
                  <Badge tone="camel">{item.formality.replace("_", " ")}</Badge>
                </dd>
              </div>
            )}
            {item.seasons.length > 0 && (
              <div className="flex items-start justify-between gap-6">
                <dt className="text-ink-faint">Seasons</dt>
                <dd className="flex flex-wrap justify-end gap-1.5">
                  {item.seasons.map((s) => (
                    <Badge key={s} tone="moss">
                      {s}
                    </Badge>
                  ))}
                </dd>
              </div>
            )}
            {item.style_tags.length > 0 && (
              <div className="flex items-start justify-between gap-6">
                <dt className="text-ink-faint">Style</dt>
                <dd className="flex flex-wrap justify-end gap-1.5">
                  {item.style_tags.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </dd>
              </div>
            )}
          </dl>

          {canEdit ? (
            <div className="mt-8 border-t hairline pt-6">
              <ItemActions
                itemId={item.id}
                enabled={item.enabled}
                hasCatalog={!!item.catalog_image_path}
              />
            </div>
          ) : (
            <p className="mt-8 border-t hairline pt-6 text-[12px] text-ink-faint">
              Shared with you — view only.
            </p>
          )}

          <p className="mt-8 text-[11px] tracking-wide text-ink-faint">
            Classified by {item.model_used ?? "—"} ·{" "}
            {new Date(item.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            {item.catalog_source !== "pending" && ` · catalogue: ${item.catalog_source}`}
          </p>
        </div>
      </div>

      {/* Worn in these fits */}
      <section className="mt-14">
        <h2 className="mb-5 text-xl font-semibold tracking-tight">
          Worn in these <span className="serif-accent text-camel">fits</span>
        </h2>
        {fits.length === 0 ? (
          <p className="text-sm text-ink-faint">
            Not styled into any fit yet — select it with a few other pieces on
            the wardrobe page and hit{" "}
            <span className="serif-accent text-camel-deep">Style these</span>.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {fits.map((f) => (
              <Link key={f.id} href={`/fits/${f.id}`} className="group">
                <div className="aspect-[3/4] overflow-hidden rounded-xl border hairline bg-ivory">
                  {f.render_path && urls[f.render_path] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={urls[f.render_path]}
                      alt={f.title ?? "Fit"}
                      className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <span className="serif-accent text-[12px] text-ink-faint">
                        unrendered
                      </span>
                    </div>
                  )}
                </div>
                <p className="mt-2 truncate text-[12px] font-medium">{f.title}</p>
                {f.occasion && (
                  <p className="text-[10px] uppercase tracking-widest text-ink-faint">
                    {f.occasion}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
