import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/account";
import { getWeather } from "@/lib/weather";
import { signedUrls } from "@/lib/storage";
import { Card, EmptyState, Eyebrow, Badge } from "@/components/ui";
import type { Outfit, WeatherInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await getOrCreateProfile(supabase, user);

  const [{ count: itemCount }, { count: photoCount }, { data: fits }] =
    await Promise.all([
      supabase
        .from("sc_wardrobe_items")
        .select("*", { count: "exact", head: true })
        .eq("deleted", false),
      supabase
        .from("sc_user_photos")
        .select("*", { count: "exact", head: true })
        .eq("deleted", false),
      supabase
        .from("sc_outfits")
        .select("*")
        .eq("deleted", false)
        .order("created_at", { ascending: false })
        .limit(4),
    ]);

  let weather: WeatherInfo | null = null;
  if (profile.lat && profile.lon && profile.place_name) {
    try {
      weather = await getWeather({
        lat: profile.lat,
        lon: profile.lon,
        place: profile.place_name,
      });
    } catch {
      weather = null;
    }
  }

  const outfits = (fits ?? []) as Outfit[];
  const renderPaths = outfits.map((o) => o.render_path).filter(Boolean) as string[];
  const urls = await signedUrls(supabase, renderPaths);

  const firstName =
    profile.display_name?.split(" ")[0] ?? user.email?.split("@")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const setupSteps = [
    { done: (photoCount ?? 0) > 0, label: "Add your photos", href: "/profile" },
    { done: !!(profile.height_cm && profile.weight_kg), label: "Height & weight", href: "/profile" },
    { done: !!profile.zip_code, label: "Set your ZIP for weather", href: "/profile" },
    { done: (itemCount ?? 0) > 0, label: "Upload wardrobe items", href: "/upload" },
    { done: outfits.length > 0, label: "Generate your first fits", href: "/fits" },
  ];
  const incomplete = setupSteps.filter((s) => !s.done);

  return (
    <div className="fade-up">
      <div className="mb-12">
        <Eyebrow>
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </Eyebrow>
        <h1 className="text-4xl font-semibold tracking-tight">
          {greeting}, <span className="serif-accent text-camel">{firstName}</span>
        </h1>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Weather */}
        <Card className="md:col-span-2">
          {weather ? (
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <p className="eyebrow">{weather.place}</p>
                  <p className="mt-1 text-5xl font-semibold tracking-tight">
                    {weather.temp_f}°
                    <span className="ml-3 serif-accent text-2xl text-ink-faint">
                      {weather.condition.toLowerCase()}
                    </span>
                  </p>
                  <p className="mt-1 text-[13px] text-ink-faint">
                    H {weather.high_f}° · L {weather.low_f}°
                    {weather.precip_chance > 20 && ` · ${weather.precip_chance}% rain`}
                  </p>
                </div>
                <Badge tone="camel">{weather.season}</Badge>
              </div>
              <p className="mt-5 border-t hairline pt-4 text-sm leading-relaxed text-ink-soft">
                {weather.clothing_hint}
              </p>
            </div>
          ) : (
            <div className="flex h-full flex-col justify-center py-4 text-center">
              <p className="serif-accent text-xl text-ink-soft">
                What&apos;s the weather wearing?
              </p>
              <p className="mt-1 text-sm text-ink-faint">
                Add your ZIP code and we&apos;ll style around the forecast.
              </p>
              <Link
                href="/profile"
                className="mx-auto mt-4 rounded-full border hairline bg-paper px-4 py-2 text-[13px] font-medium hover:bg-ivory"
              >
                Set location
              </Link>
            </div>
          )}
        </Card>

        {/* Stats */}
        <Card>
          <p className="eyebrow mb-4">Your closet</p>
          <div className="space-y-4">
            <Link href="/wardrobe" className="flex items-baseline justify-between group">
              <span className="text-sm text-ink-soft group-hover:text-ink">Pieces</span>
              <span className="text-2xl font-semibold">{itemCount ?? 0}</span>
            </Link>
            <Link href="/fits" className="flex items-baseline justify-between group">
              <span className="text-sm text-ink-soft group-hover:text-ink">Fits</span>
              <span className="text-2xl font-semibold">{outfits.length}</span>
            </Link>
            <Link href="/profile" className="flex items-baseline justify-between group">
              <span className="text-sm text-ink-soft group-hover:text-ink">Photos</span>
              <span className="text-2xl font-semibold">{photoCount ?? 0}</span>
            </Link>
          </div>
        </Card>
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
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
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
