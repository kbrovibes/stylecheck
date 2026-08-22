import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { imgUrls } from "@/lib/storage";
import { Badge, Card, Eyebrow } from "@/components/ui";
import RenderButton from "@/components/fits/render-button";
import FitActions from "@/components/fits/fit-actions";
import ReactionButtons from "@/components/fits/reaction-buttons";
import RenderCarousel from "@/components/fits/render-carousel";
import ZoomImage from "@/components/lightbox";
import VariationLinks, {
  type VariationDisplay,
} from "@/components/fits/variation-links";
import {
  CATEGORY_LABELS,
  OCCASION_LABELS,
  type Occasion,
  type Outfit,
  type OutfitVariation,
  type RenderRecord,
  type WardrobeItem,
} from "@/lib/types";

const ADMIN_EMAILS = ["k4rthikr@gmail.com"];

function goofyFirst(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) % 997;
  return h % 2 === 0;
}

export const dynamic = "force-dynamic";

export default async function FitDetailPage({
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

  const { data: outfitData } = await supabase
    .from("sc_outfits")
    .select("*")
    .eq("id", id)
    .eq("deleted", false)
    .single();
  if (!outfitData) notFound();
  const outfit = outfitData as Outfit;
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  const fitSettings = authUser
    ? await getOrCreateSettings(supabase, authUser.id)
    : null;
  const goofyMode = fitSettings?.goofy_mode ?? false;
  const showModelBadge = fitSettings?.show_model_badge ?? false;
  const displayPath =
    goofyMode && outfit.goofy_render_path
      ? outfit.goofy_render_path
      : outfit.render_path;

  const [{ data: allItemsData }, { data: rendersData }] = await Promise.all([
    supabase.from("sc_wardrobe_items").select("*").eq("deleted", false),
    supabase
      .from("sc_renders")
      .select("*")
      .eq("deleted", false)
      .in("subject_type", ["outfit", "outfit_goofy"])
      .eq("subject_id", id)
      .order("created_at", { ascending: false }),
  ]);
  const allItems = (allItemsData ?? []) as WardrobeItem[];
  const itemById = new Map(allItems.map((i) => [i.id, i]));
  const items = outfit.item_ids
    .map((iid) => itemById.get(iid))
    .filter(Boolean) as WardrobeItem[];
  const { data: canManage } = outfit.person_id
    ? await supabase.rpc("sc_can_manage_person", { pid: outfit.person_id })
    : { data: true };
  const liveIds = new Set(items.map((i) => i.id));
  const deadCount = outfit.item_ids.filter((iid) => !liveIds.has(iid)).length;
  const renders = (rendersData ?? []) as RenderRecord[];
  const isAdmin = !!user.email && ADMIN_EMAILS.includes(user.email);
  const hasGptRender = renders.some((r) => r.model.startsWith("gpt"));

  const paths = new Set<string>();
  if (outfit.render_path) paths.add(outfit.render_path);
  if (outfit.goofy_render_path) paths.add(outfit.goofy_render_path);
  items.forEach((i) => paths.add(i.catalog_image_path ?? i.original_image_path));
  renders.forEach((r) => paths.add(r.storage_path));
  const urls = imgUrls([...paths]);

  // Carousel: primary renders only — GPT takes live in Additional renders below.
  const slides = [
    outfit.render_path && urls[outfit.render_path]
      ? { url: urls[outfit.render_path], label: showModelBadge ? `classic · ${(outfit.render_model ?? "gemini").replace("-preview", "")}` : "classic" }
      : null,
    ...(goofyMode
      ? [
          outfit.goofy_render_path && urls[outfit.goofy_render_path]
            ? { url: urls[outfit.goofy_render_path], label: "goofy" }
            : null,
        ]
      : []),
  ].filter(Boolean) as { url: string; label: string }[];

  const variations = ((outfit.variations ?? []) as OutfitVariation[]).map(
    (v, index): VariationDisplay => ({
      index,
      label: v.label,
      outName:
        itemById.get(v.swap_out)?.name ??
        itemById.get(v.swap_out)?.subcategory ??
        "item",
      inName:
        itemById.get(v.swap_in)?.name ??
        itemById.get(v.swap_in)?.subcategory ??
        "item",
      outfitId: v.outfit_id,
    })
  );

  return (
    <div className="fade-up">
      <Link
        href="/fits"
        className="mb-6 inline-block text-[13px] text-ink-faint hover:text-ink"
      >
        ← All fits
      </Link>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* Render */}
        <div>
          <div className="overflow-hidden rounded-2xl border hairline bg-paper">
            <div className="bg-ivory">
              {slides.length > 0 ? (
                <RenderCarousel slides={slides} zoomable showLabels={showModelBadge} />
              ) : (
                <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 p-8 text-center">
                  <p className="serif-accent text-2xl text-ink-soft">
                    Not yet photographed.
                  </p>
                  <p className="max-w-xs text-[13px] text-ink-faint">
                    Render this look on your own frame — full length, head to
                    shoes.
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <RenderButton outfitId={outfit.id} hasRender={!!outfit.render_path} />
            {goofyMode && (
              <RenderButton
                outfitId={outfit.id}
                hasRender={!!outfit.goofy_render_path}
                goofy
              />
            )}
            {isAdmin && (
              <RenderButton outfitId={outfit.id} hasRender={hasGptRender} gpt />
            )}
            <FitActions
              outfitId={outfit.id}
              deadCount={deadCount}
              readOnly={!canManage}
            />
          </div>
        </div>

        {/* Details */}
        <div>
          <Eyebrow>
            {outfit.parent_outfit_id ? "Variation" : "The look"}
          </Eyebrow>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              <span className="serif-accent text-camel">{outfit.title}</span>
          </h1>
            <ReactionButtons
              outfitId={outfit.id}
              initial={outfit.reaction}
              readOnly={!canManage}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {outfit.occasion && (
              <Badge tone="ink">
                {OCCASION_LABELS[outfit.occasion as Occasion] ?? outfit.occasion}
              </Badge>
            )}
            {outfit.seasons.map((s) => (
              <Badge key={s}>{s}</Badge>
            ))}
            {outfit.score != null && (
              <Badge tone="camel">stylist score {Number(outfit.score).toFixed(1)}</Badge>
            )}
          </div>

          {outfit.weather_note && (
            <p className="mt-4 rounded-xl bg-moss/10 px-4 py-3 text-[13px] leading-relaxed text-moss">
              {outfit.weather_note}
            </p>
          )}

          {outfit.explanation && (
            <div className="mt-7">
              <p className="eyebrow mb-2">Why this works on you</p>
              <p className="text-[15px] leading-relaxed text-ink-soft">
                {outfit.explanation}
              </p>
            </div>
          )}

          {outfit.styling_notes && (
            <div className="mt-6">
              <p className="eyebrow mb-2">Styling notes</p>
              <p className="text-[14px] leading-relaxed text-ink-soft">
                {outfit.styling_notes}
              </p>
            </div>
          )}

          <div className="mt-8">
            <p className="eyebrow mb-3">The pieces</p>
            <div className="grid grid-cols-2 gap-3">
              {items.map((i) => {
                const p = i.catalog_image_path ?? i.original_image_path;
                return (
                  <Link
                    key={i.id}
                    href={`/wardrobe/${i.id}`}
                    className="group flex items-center gap-3 rounded-xl border hairline bg-paper p-2.5 transition-colors hover:bg-ivory"
                  >
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-ivory">
                      {urls[p] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={urls[p]}
                          alt={i.name ?? i.category}
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium group-hover:text-camel-deep">
                        {i.name ?? i.subcategory ?? i.category}
                      </p>
                      <p className="text-[11px] uppercase tracking-widest text-ink-faint">
                        {CATEGORY_LABELS[i.category] ?? i.category}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {variations.length > 0 && (
            <div className="mt-8">
              <p className="eyebrow mb-3">Make it subtle</p>
              <VariationLinks outfitId={outfit.id} variations={variations} />
            </div>
          )}
        </div>
      </div>

      {/* Additional renders: model comparisons + history, never the main carousel */}
      {renders.length > 1 && (
        <Card className="mt-12">
          <p className="eyebrow mb-4">Additional renders — compare models</p>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {renders.map((r) => (
              <div key={r.id} className="w-36 shrink-0">
                <div className="aspect-[3/4] overflow-hidden rounded-xl bg-ivory">
                  {urls[r.storage_path] ? (
                    <ZoomImage
                      src={urls[r.storage_path]}
                      alt="Previous render"
                      caption={new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      className="h-full w-full object-cover object-top"
                    />
                  ) : null}
                </div>
                <div className="mt-2 space-y-1">
                  <Badge>{r.subject_type === "outfit_goofy" ? "goofy" : "classic"}</Badge>
                  {showModelBadge && <Badge tone="camel">{r.model.replace(/-preview$/, "")}</Badge>}
                  <p className="text-[11px] text-ink-faint">
                    {new Date(r.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
