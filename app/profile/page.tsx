import { createClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/account";
import { getWeather } from "@/lib/weather";
import { signedUrl, signedUrls } from "@/lib/storage";
import { Badge, Card, PageTitle } from "@/components/ui";
import MeasurementsForm from "@/components/profile/measurements-form";
import PhotoUploader from "@/components/profile/photo-uploader";
import PhotoGrid from "@/components/profile/photo-grid";
import RenderPanel from "@/components/profile/render-panel";
import type { RenderRecord, UserPhoto, WeatherInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await getOrCreateProfile(supabase, user);

  const [{ data: photosData }, { data: rendersData }] = await Promise.all([
    supabase
      .from("sc_user_photos")
      .select("*")
      .eq("user_id", user.id)
      .eq("deleted", false)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("sc_renders")
      .select("*")
      .eq("user_id", user.id)
      .eq("subject_type", "profile")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const photos = (photosData ?? []) as UserPhoto[];
  const renders = (rendersData ?? []) as RenderRecord[];

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

  const photoUrls = await signedUrls(
    supabase,
    photos.map((p) => p.storage_path)
  );
  const renderUrls = await signedUrls(
    supabase,
    renders.map((r) => r.storage_path)
  );
  const baseRenderUrl = profile.base_render_path
    ? await signedUrl(supabase, profile.base_render_path).catch(() => null)
    : null;

  return (
    <div className="fade-up">
      <PageTitle eyebrow="Your profile" title="The person behind the" accent="fits" />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <p className="eyebrow mb-5">Measurements & location</p>
          <MeasurementsForm profile={profile} />
        </Card>

        <Card className="lg:col-span-2">
          <p className="eyebrow mb-5">Your weather</p>
          {weather ? (
            <div>
              <p className="text-[13px] text-ink-faint">{weather.place}</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight">
                {weather.temp_f}°
                <span className="ml-2 serif-accent text-xl text-ink-faint">
                  {weather.condition.toLowerCase()}
                </span>
              </p>
              <p className="mt-1 text-[13px] text-ink-faint">
                H {weather.high_f}° · L {weather.low_f}°
              </p>
              <div className="mt-3">
                <Badge tone="camel">{weather.season}</Badge>
              </div>
              <p className="mt-4 border-t hairline pt-4 text-[13px] leading-relaxed text-ink-soft">
                {weather.clothing_hint}
              </p>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-ink-faint">
              Set your ZIP code and your stylist will dress you for the
              forecast — not against it.
            </p>
          )}
        </Card>
      </div>

      <section className="mt-12">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold tracking-tight">
            Your <span className="serif-accent text-camel">photos</span>
          </h2>
          <p className="text-[12px] text-ink-faint">
            Selfies and full-body shots are auto-detected · tap one to make it
            primary
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          <PhotoUploader userId={user.id} />
          <PhotoGrid photos={photos} urls={photoUrls} />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="mb-5 text-xl font-semibold tracking-tight">
          Your <span className="serif-accent text-camel">render</span>
        </h2>
        <Card>
          <RenderPanel
            currentUrl={baseRenderUrl}
            history={renders}
            historyUrls={renderUrls}
            hasPhotos={photos.length > 0}
            savedAdjustments={profile.render_adjustments}
          />
        </Card>
      </section>
    </div>
  );
}
