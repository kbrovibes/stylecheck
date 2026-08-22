import { createClient } from "@/lib/supabase/server";
import { canManage, getActivePerson } from "@/lib/person";
import { getWeather } from "@/lib/weather";
import { imgUrl, imgUrls } from "@/lib/storage";
import { computeCoverage } from "@/lib/coverage";
import { Badge, Card, PageTitle } from "@/components/ui";
import MeasurementsForm from "@/components/profile/measurements-form";
import PhotoUploader from "@/components/profile/photo-uploader";
import PhotoGrid from "@/components/profile/photo-grid";
import RenderPanel from "@/components/profile/render-panel";
import SharingCard from "@/components/profile/sharing-card";
import type { RenderRecord, UserPhoto, WeatherInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { person, role } = await getActivePerson(supabase, user);
  const readOnly = !canManage(role);

  const [{ data: photosData }, { data: rendersData }] = await Promise.all([
    supabase
      .from("sc_user_photos")
      .select("*")
      .eq("person_id", person.id)
      .eq("deleted", false)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("sc_renders")
      .select("*")
      .eq("deleted", false)
      .eq("person_id", person.id)
      .eq("subject_type", "profile")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const photos = (photosData ?? []) as UserPhoto[];
  const renders = (rendersData ?? []) as RenderRecord[];

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

  const photoUrls = imgUrls(photos.map((p) => p.storage_path));
  const renderUrls = imgUrls(renders.map((r) => r.storage_path));
  const baseRenderUrl = person.base_render_path
    ? imgUrl(person.base_render_path)
    : null;

  return (
    <div className="fade-up">
      <PageTitle eyebrow={`Profile — ${person.name}`} title="The person behind the" accent="fits">
        {role !== "owner" && (
          <Badge tone={role === "manager" ? "camel" : "neutral"}>
            shared · {role === "manager" ? "manager" : "view only"}
          </Badge>
        )}
      </PageTitle>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <p className="eyebrow mb-5">Measurements & location</p>
          <MeasurementsForm person={person} readOnly={readOnly} />
        </Card>

        <Card className="lg:col-span-2">
          <p className="eyebrow mb-5">Weather</p>
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
              Set a ZIP code and the stylist will dress {person.name} for the
              forecast — not against it.
            </p>
          )}
        </Card>
      </div>

      <section className="mt-12">
        <h2 className="mb-5 text-xl font-semibold tracking-tight">
          {person.name}&apos;s <span className="serif-accent text-camel">render</span>
        </h2>
        <Card>
          <RenderPanel
            currentUrl={baseRenderUrl}
            currentPath={person.base_render_path}
            history={renders}
            historyUrls={renderUrls}
            hasPhotos={photos.length > 0}
            savedAdjustments={person.render_adjustments}
            showModelBadge={pageSettings.show_model_badge}
            readOnly={readOnly}
          />
        </Card>
      </section>
      <section className="mt-12">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-tight">
            {photos.length > 0 ? (
              <>{person.name}&apos;s <span className="serif-accent text-camel">photos</span></>
            ) : (
              <>Add <span className="serif-accent text-camel">photos</span></>
            )}
          </h2>
          {!readOnly && (
            <p className="text-[12px] text-ink-faint">
              Selfies and full-body shots are auto-detected · tap one to make it
              primary
            </p>
          )}
        </div>
        {!readOnly &&
          (() => {
            const gaps = computeCoverage([], photos).photoSlots.filter(
              (s) => s.have < s.want
            );
            if (!gaps.length) return null;
            return (
              <p className="mb-4 rounded-xl border hairline bg-paper px-4 py-2.5 text-[13px] text-ink-soft">
                <span className="serif-accent text-camel-deep">For the best likeness: </span>
                {gaps
                  .map((s) => `${s.want - s.have} more ${s.label.toLowerCase()} — ${s.hint}`)
                  .join(" · ")}
              </p>
            );
          })()}
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {!readOnly && <PhotoUploader userId={user.id} />}
          <PhotoGrid photos={photos} urls={photoUrls} readOnly={readOnly} />
        </div>
      </section>

      {role === "owner" && (
        <section className="mt-12">
          <SharingCard personId={person.id} personName={person.name} />
        </section>
      )}
    </div>
  );
}
