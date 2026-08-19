"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import TileRenderButton from "@/components/fits/tile-render-button";
import RenderCarousel from "@/components/fits/render-carousel";

export interface FitCard {
  id: string;
  title: string | null;
  occasion: string | null;
  occasionLabel: string | null;
  seasons: string[];
  score: number | null;
  classicUrl: string | null;
  goofyUrl: string | null;
  goofyLead: boolean; // stable random: which take leads in goofy mode
  thumbs: { id: string; url: string | null }[];
}

type View = "grid" | "compact" | "list";
const VIEW_KEY = "sc_fits_view";

const VIEWS: { key: View; label: string; icon: React.ReactNode }[] = [
  {
    key: "grid",
    label: "Cards",
    icon: (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
        <rect x="1" y="1" width="6" height="6" rx="1.5" />
        <rect x="9" y="1" width="6" height="6" rx="1.5" />
        <rect x="1" y="9" width="6" height="6" rx="1.5" />
        <rect x="9" y="9" width="6" height="6" rx="1.5" />
      </svg>
    ),
  },
  {
    key: "compact",
    label: "Wall",
    icon: (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
        {[0, 5.5, 11].flatMap((x) =>
          [0, 5.5, 11].map((y) => (
            <rect key={`${x}-${y}`} x={x + 0.5} y={y + 0.5} width="4" height="4" rx="1" />
          ))
        )}
      </svg>
    ),
  },
  {
    key: "list",
    label: "List",
    icon: (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
        <rect x="1" y="2" width="3.5" height="3.5" rx="1" />
        <rect x="6" y="3" width="9" height="1.6" rx="0.8" />
        <rect x="1" y="9" width="3.5" height="3.5" rx="1" />
        <rect x="6" y="10" width="9" height="1.6" rx="0.8" />
      </svg>
    ),
  },
];

function leadUrl(c: FitCard, goofyMode: boolean) {
  if (goofyMode && c.goofyUrl && c.classicUrl)
    return c.goofyLead ? c.goofyUrl : c.classicUrl;
  return (goofyMode && c.goofyUrl) || c.classicUrl || c.goofyUrl;
}

export default function FitsGallery({
  cards,
  goofyMode,
}: {
  cards: FitCard[];
  goofyMode: boolean;
}) {
  const [view, setView] = useState<View>("grid");

  useEffect(() => {
    const stored = localStorage.getItem(VIEW_KEY) as View | null;
    if (stored === "grid" || stored === "compact" || stored === "list") setView(stored);
  }, []);

  function pick(v: View) {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  }

  return (
    <div>
      {/* View switcher */}
      <div className="mb-4 flex justify-end">
        <div className="flex gap-0.5 rounded-full border hairline bg-paper p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => pick(v.key)}
              title={v.label}
              aria-label={`${v.label} view`}
              className={`flex h-8 w-9 items-center justify-center rounded-full transition-colors ${
                view === v.key ? "bg-ink text-ivory" : "text-ink-faint hover:text-ink"
              }`}
            >
              {v.icon}
            </button>
          ))}
        </div>
      </div>

      {view === "grid" && (
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {cards.map((c) => (
            <Link
              key={c.id}
              href={`/fits/${c.id}`}
              className="group overflow-hidden rounded-2xl border hairline bg-paper transition-shadow hover:shadow-lg hover:shadow-ink/5"
            >
              <div className="relative aspect-[3/4] overflow-hidden bg-ivory">
                <TileRenderButton
                  outfitId={c.id}
                  hasRender={goofyMode ? !!c.goofyUrl : !!c.classicUrl}
                  goofy={goofyMode}
                />
                {goofyMode && !c.goofyUrl && c.classicUrl && (
                  <span className="absolute bottom-2 left-2 z-10 rounded-full bg-ink/60 px-2.5 py-1 text-[10px] text-ivory backdrop-blur">
                    no goofy take yet
                  </span>
                )}
                {goofyMode && c.goofyUrl && c.classicUrl ? (
                  <RenderCarousel
                    slides={
                      c.goofyLead
                        ? [
                            { url: c.goofyUrl, label: "goofy" },
                            { url: c.classicUrl, label: "classic" },
                          ]
                        : [
                            { url: c.classicUrl, label: "classic" },
                            { url: c.goofyUrl, label: "goofy" },
                          ]
                    }
                    imgClass="object-cover object-top"
                  />
                ) : leadUrl(c, goofyMode) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={leadUrl(c, goofyMode)!}
                    alt={c.title ?? "Fit"}
                    className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                ) : (
                  <UnrenderedCollage thumbs={c.thumbs} />
                )}
              </div>
              <div className="flex items-start justify-between gap-2 p-4">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{c.title}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {c.occasionLabel && <Badge tone="camel">{c.occasionLabel}</Badge>}
                    {c.seasons.slice(0, 2).map((s) => (
                      <Badge key={s}>{s}</Badge>
                    ))}
                  </div>
                </div>
                {c.score != null && (
                  <span className="serif-accent shrink-0 text-lg text-camel">
                    {Number(c.score).toFixed(1)}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {view === "compact" && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {cards.map((c) => (
            <Link
              key={c.id}
              href={`/fits/${c.id}`}
              className="group relative aspect-[3/4] overflow-hidden rounded-xl border hairline bg-ivory"
            >
              {leadUrl(c, goofyMode) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={leadUrl(c, goofyMode)!}
                  alt={c.title ?? "Fit"}
                  className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.04]"
                />
              ) : (
                <UnrenderedCollage thumbs={c.thumbs} compact />
              )}
              {c.score != null && (
                <span className="absolute bottom-1 right-1.5 rounded-full bg-ink/45 px-1.5 py-0.5 text-[10px] font-medium text-ivory backdrop-blur">
                  {Number(c.score).toFixed(1)}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      {view === "list" && (
        <div className="divide-y hairline overflow-hidden rounded-2xl border hairline bg-paper">
          {cards.map((c) => (
            <Link
              key={c.id}
              href={`/fits/${c.id}`}
              className="flex items-center gap-3.5 px-3.5 py-2.5 transition-colors hover:bg-ivory"
            >
              <span className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-ivory">
                {leadUrl(c, goofyMode) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={leadUrl(c, goofyMode)!}
                    alt=""
                    className="h-full w-full object-cover object-top"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center text-[9px] uppercase tracking-widest text-ink-faint">
                    —
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{c.title}</span>
                <span className="mt-0.5 block text-[11px] uppercase tracking-widest text-ink-faint">
                  {[c.occasionLabel, ...c.seasons.slice(0, 2)].filter(Boolean).join(" · ")}
                </span>
              </span>
              {c.score != null && (
                <span className="serif-accent shrink-0 text-[15px] text-camel">
                  {Number(c.score).toFixed(1)}
                </span>
              )}
              <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 text-ink-faint" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4.5 2.5L8 6l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function UnrenderedCollage({
  thumbs,
  compact = false,
}: {
  thumbs: { id: string; url: string | null }[];
  compact?: boolean;
}) {
  return (
    <div className={`grid h-full grid-cols-2 ${compact ? "gap-0.5 p-1.5" : "gap-1 p-3"}`}>
      {thumbs.map((t) =>
        t.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={t.id} src={t.url} alt="" className="h-full w-full rounded-lg object-cover" />
        ) : (
          <div key={t.id} className="rounded-lg bg-hairline/50" />
        )
      )}
      {!compact && (
        <div className="absolute inset-x-0 bottom-2 text-center">
          <span className="rounded-full bg-paper/85 px-2.5 py-1 text-[10px] uppercase tracking-widest text-ink-faint backdrop-blur">
            unrendered
          </span>
        </div>
      )}
    </div>
  );
}
