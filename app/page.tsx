import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActivePerson } from "@/lib/person";
import { getWeather } from "@/lib/weather";
import { imgUrl, imgUrls } from "@/lib/storage";
import { computeWardrobeHash } from "@/lib/scene";
import { computeCoverage } from "@/lib/coverage";
import { Eyebrow, Badge } from "@/components/ui";
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
        .order("created_at", { ascending: false }),
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

  // --- Today's picks: 3 rendered fits, rotated daily, occasion-diverse ---
  const itemById = new Map(items.map((i) => [i.id, i]));
  const daySeed = `${person.id}:${new Date().toISOString().slice(0, 10)}`;
  const seedHash = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003;
    return h;
  };
  const candidates = outfits
    .filter(
      (o) =>
        o.render_path &&
        o.reaction !== -1 &&
        o.item_ids.every((iid) => itemById.has(iid))
    )
    .map((o) => ({
      o,
      pts:
        (Number(o.score) || 5) +
        (weather && o.seasons?.includes(weather.season) ? 2 : 0) +
        (o.reaction === 1 ? 2 : 0) +
        (seedHash(daySeed + o.id) % 100) / 50, // daily rotation jitter
    }))
    .sort((a, b) => b.pts - a.pts);
  const picked: Outfit[] = [];
  const take = (pred: (o: Outfit) => boolean) => {
    const hit = candidates.find(
      (c) => pred(c.o) && !picked.some((p) => p.id === c.o.id)
    );
    if (hit) picked.push(hit.o);
  };
  take((o) => o.occasion === "work");
  take((o) => o.occasion === "casual" || o.occasion === "friends" || o.occasion === "date");
  take(() => true);
  while (picked.length < 3) {
    const next = candidates.find((c) => !picked.some((p) => p.id === c.o.id));
    if (!next) break;
    picked.push(next.o);
  }

  const renderPaths = [
    ...outfits.map((o) => o.render_path),
    ...picked.map((o) => o.render_path),
  ].filter(Boolean) as string[];
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

      {/* Today's picks */}
      {picked.length > 0 && (
        <section className="mb-10">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold tracking-tight">
              Today&apos;s <span className="serif-accent text-camel">picks</span>
            </h2>
            <p className="text-[12px] text-ink-faint">
              {weather
                ? `Styled for ${weather.temp_f}° and ${weather.condition.toLowerCase()}`
                : "Rotates every day"}
              {" · "}
              <Link href="/fits" className="hover:text-ink">
                all fits →
              </Link>
            </p>
          </div>
          <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-5 sm:overflow-visible sm:px-0 sm:pb-0">
            {picked.map((o, i) => (
              <Link
                key={o.id}
                href={`/fits/${o.id}`}
                className="group w-[76vw] shrink-0 snap-center overflow-hidden rounded-2xl border hairline bg-paper transition-shadow hover:shadow-lg hover:shadow-ink/5 sm:w-auto"
              >
                <div className="relative aspect-[3/4] overflow-hidden bg-ivory">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={urls[o.render_path!]}
                    alt={o.title ?? "Fit"}
                    fetchPriority={i === 0 ? "high" : "auto"}
                    className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                  <span className="absolute left-3 top-3 rounded-full bg-ink/55 px-2.5 py-1 font-serif text-[12px] italic text-ivory backdrop-blur">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-[13px] font-medium">{o.title}</p>
                    {o.occasion && <Badge tone="camel">{o.occasion}</Badge>}
                  </div>
                  {o.explanation && (
                    <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-ink-faint">
                      {o.explanation}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

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

    </div>
  );
}
