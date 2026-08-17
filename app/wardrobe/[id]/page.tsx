import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signedUrls } from "@/lib/storage";
import { Badge, Eyebrow } from "@/components/ui";
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

  const urls = await signedUrls(
    supabase,
    [item.catalog_image_path, item.original_image_path].filter(Boolean) as string[]
  );
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

          <div className="mt-8 border-t hairline pt-6">
            <ItemActions
              itemId={item.id}
              enabled={item.enabled}
              hasCatalog={!!item.catalog_image_path}
            />
          </div>

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
    </div>
  );
}
