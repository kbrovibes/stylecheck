import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActivePerson } from "@/lib/person";
import { getWeather } from "@/lib/weather";
import { imgUrl, imgUrls } from "@/lib/storage";
import { computeWardrobeHash } from "@/lib/scene";
import { computeCoverage } from "@/lib/coverage";
import { Card, EmptyState, Eyebrow, Badge } from "@/components/ui";
import WardrobeHero, { type HeroGroup } from "@/components/home/wardrobe-hero";
import type { Category, Outfit, UserPhoto, WardrobeItem, WeatherInfo } from "@/lib/types";

const HERO_GROUPS: { key: string; label: string; cats: Category[]; href: string }[] = [
  { key: "hanging", label: "Tops & layers", cats: ["top", "outerwear", "full_body"], href: "/wardrobe?category=top" },
  { key: "folded", label: "Bottoms", cats: ["bottom"], href: "/wardrobe?category=bottom" },
  { key: "shoes", label: "Footwear", cats: ["footwear"], href: "/wardrobe?category=footwear" },
  { key: "tray", label: "Accessories", cats: ["accessory", "belt", "bag", "headwear", "eyewear"], href: "/wardrobe?category=accessory" },
];

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { person } = await getActivePerson(supabase, user);

  const [{ data: itemsData }, { data: photosData }, { data: fits }] =
    await Promise.all([
      supabase
        .from("sc_wardrobe_items")
        .select("*")
        .eq("person_id", person.id)
        .eq("deleted", false)
        .eq("enabled", true)
        .order("created_at", { ascending: true }),
      supabase
        .from("sc_user_photos")
        .select("id, kind, deleted")
        .eq("person_id", person.id)
        .eq("deleted", false),
      supabase
        .from("sc_outfits")
        .select("*")
        .eq("person_id", person.id)
        .eq("deleted", false)
        .order("created_at", { ascending: false })
        .limit(4),
    ]);

  const items = (itemsData ?? []) as WardrobeItem[];
  const itemCount = items.length;
  const photosLite = (photosData ?? []) as UserPhoto[];
  const photoCount = photosLite.length;
  const coverage = computeCoverage(items, photosLite);

  // Wardrobe hero: cached scene image + grouped items for the hotspot sheets.
  const heroThumbPaths = items
    .slice(0, 40)
    .map((i) => i.catalog_image_path ?? i.original_image_path);
  const sceneUrlResolved = person.wardrobe_scene_path
    ? imgUrl(person.wardrobe_scene_path)
    : null;
  const heroThumbUrls = imgUrls(heroThumbPaths);
  const heroGroups: HeroGroup[] = HERO_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    href: g.href,
    items: items
      .filter((i) => g.cats.includes(i.category))
      .slice(0, 8)
      .map((i) => ({
        id: i.id,
        name: i.name ?? i.subcategory ?? i.category,
        url: heroThumbUrls[i.catalog_image_path ?? i.original_image_path] ?? null,
      })),
  }));
  const sceneStale =
    !!person.wardrobe_scene_path &&
    itemCount > 0 &&
    computeWardrobeHash(items) !== person.wardrobe_scene_hash;

  let weather: WeatherInfo | null = null;
  if (person.lat && person.lon && person.place_name) {
    try {
      weather = await getWeather({
        lat: person.lat,
        lon: person.lon,
        place: person.place_name,
      });
    } catch {
      weather = null;
    }
  }

  const outfits = (fits ?? []) as Outfit[];
  const renderPaths = outfits.map((o) => o.render_path).filter(Boolean) as string[];
  const urls = imgUrls(renderPaths);

  const firstName = person.name.split(" ")[0] || "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const setupSteps = [
    { done: (photoCount ?? 0) > 0, label: "Add your photos", href: "/profile" },
    { done: !!(person.height_cm && person.weight_kg), label: "Height & weight", href: "/profile" },
    { done: !!person.zip_code, label: "Set your ZIP for weather", href: "/profile" },
    { done: (itemCount ?? 0) > 0, label: "Upload wardrobe items", href: "/upload" },
    { done: outfits.length > 0, label: "Generate your first fits", href: "/fits" },
  ];
  const incomplete = setupSteps.filter((s) => !s.done);

  return (
    <div className="fade-up">
      <div className="mb-8 sm:mb-12">
        <Eyebrow>
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </Eyebrow>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {greeting}, <span className="serif-accent text-camel">{firstName}</span>
        </h1>
      </div>

      {itemCount > 0 && (
        <WardrobeHero
          sceneUrl={sceneUrlResolved}
          status={person.wardrobe_scene_status}
          stale={sceneStale}
          groups={heroGroups}
        />
      )}

      {/* Slim info strip: weather is a profile attribute, not a hero feature */}
      <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-2xl border hairline bg-paper px-5 py-3.5 text-[13px]">
        {weather ? (
          <>
            <span className="font-medium">
              {weather.temp_f}° {weather.condition.toLowerCase()}
            </span>
            <span className="text-ink-faint">
              H {weather.high_f}° · L {weather.low_f}°
              {weather.precip_chance > 20 ? ` · ${weather.precip_chance}% rain` : ""}
            </span>
            <span
              className="hidden min-w-0 flex-1 truncate text-ink-soft lg:inline"
              title={weather.clothing_hint}
            >
              {weather.clothing_hint}
            </span>
          </>
        ) : (
          <Link href="/profile" className="text-ink-faint transition-colors hover:text-ink">
            Add a ZIP in the profile for weather-aware styling →
          </Link>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-4">
          <Link href="/wardrobe" className="text-ink-soft transition-colors hover:text-ink">
            <span className="font-semibold text-ink">{itemCount}</span> pieces
          </Link>
          <Link href="/fits" className="text-ink-soft transition-colors hover:text-ink">
            <span className="font-semibold text-ink">{outfits.length}</span> fits
          </Link>
          <Link href="/profile" className="text-ink-soft transition-colors hover:text-ink">
            <span className="font-semibold text-ink">{photoCount}</span> photos
          </Link>
        </span>
      </div>

      {/* Setup checklist */}
      {incomplete.length > 0 && (
        <div className="mt-6 rounded-2xl border hairline bg-paper p-6">
          <p className="eyebrow mb-4">Finish your profile</p>
          <div className="flex flex-wrap gap-3">
            {setupSteps.map((s) => (
              <Link
                key={s.label}
                href={s.href}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] transition-colors ${
                  s.done
                    ? "border-moss/30 bg-moss/5 text-moss line-through decoration-moss/40"
                    : "hairline hover:bg-ivory"
                }`}
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${s.done ? "bg-moss text-ivory" : "border hairline"}`}>
                  {s.done ? "✓" : ""}
                </span>
                {s.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Coverage: what to upload for better fits */}
      {(itemCount > 0 || photoCount > 0) && !coverage.complete && (
        <div className="mt-6 rounded-2xl border hairline bg-paper p-6">
          <div className="mb-1 flex items-baseline justify-between">
            <p className="eyebrow">Get better fits</p>
            <p className="text-[11px] text-ink-faint">
              {coverage.ready
                ? "Generation works — more variety = better looks"
                : "A few things are still needed before fits can render well"}
            </p>
          </div>
          <div className="mt-4 grid gap-x-10 gap-y-3 sm:grid-cols-2">
            {[...coverage.photoSlots, ...coverage.itemSlots].map((s) => {
              const pct = Math.min(100, (s.have / s.want) * 100);
              const met = s.have >= s.want;
              return (
                <Link key={s.key} href={s.href} className="group" title={s.hint}>
                  <div className="flex items-baseline justify-between">
                    <span
                      className={`text-[13px] ${met ? "text-ink-faint" : "text-ink-soft group-hover:text-ink"}`}
                    >
                      {s.label}
                      {s.optional && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-widest text-ink-faint/70">
                          optional
                        </span>
                      )}
                    </span>
                    <span className={`text-[12px] font-medium ${met ? "text-moss" : "text-ink"}`}>
                      {met ? "✓" : `${s.have} / ${s.want}`}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-hairline">
                    <div
                      className={`h-full rounded-full transition-all ${met ? "bg-moss/70" : "bg-camel"}`}
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
          {coverage.suggestions.length > 0 && (
            <div className="mt-5 border-t hairline pt-4">
              <p className="text-[13px] leading-relaxed text-ink-soft">
                <span className="serif-accent text-camel-deep">Next up: </span>
                {coverage.suggestions.slice(0, 3).join(" · ")}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Latest fits */}
      <div className="mt-14">
        <div className="mb-6 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold tracking-tight">
            Latest <span className="serif-accent text-camel">fits</span>
          </h2>
          <Link href="/fits" className="text-[13px] text-ink-faint hover:text-ink">
            View all →
          </Link>
        </div>
        {outfits.length === 0 ? (
          <EmptyState
            title="No fits yet."
            body="Upload your wardrobe and photos, then let your stylist put looks together — rendered on you."
            ctaHref="/upload"
            ctaLabel="Start uploading"
          />
        ) : (
          <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
            {outfits.map((o) => (
              <Link
                key={o.id}
                href={`/fits/${o.id}`}
                className="group overflow-hidden rounded-2xl border hairline bg-paper transition-shadow hover:shadow-lg hover:shadow-ink/5"
              >
                <div className="aspect-[3/4] overflow-hidden bg-ivory">
                  {o.render_path && urls[o.render_path] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={urls[o.render_path]}
                      alt={o.title ?? "Outfit"}
                      className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <span className="serif-accent text-ink-faint">unrendered</span>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <p className="truncate text-[13px] font-medium">{o.title}</p>
                  <p className="mt-0.5 text-[11px] uppercase tracking-widest text-ink-faint">
                    {o.occasion}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
