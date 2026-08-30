"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui";
import FitsGallery, { type FitCard } from "@/components/fits/fits-gallery";
import { OCCASION_LABELS, type Occasion } from "@/lib/types";

/**
 * Every fit is loaded once and filtered in the browser.
 *
 * These used to be <Link>s into the same dynamic page, so changing a filter
 * meant a full server round trip — auth, four Supabase queries, re-render —
 * for data the client already had. Filtering locally makes it instant, and the
 * URL is kept in sync with replaceState so links stay shareable without
 * triggering a navigation.
 */
export default function FitsBrowser({
  cards,
  goofyMode,
  initial,
}: {
  cards: FitCard[];
  goofyMode: boolean;
  initial: { occasion: string; mine: boolean; min: string };
}) {
  const [occasion, setOccasion] = useState(initial.occasion);
  const [mine, setMine] = useState(initial.mine);
  const [min, setMin] = useState(initial.min);

  // Shareable URL without a navigation — replaceState leaves the router alone.
  useEffect(() => {
    const params = new URLSearchParams();
    if (occasion) params.set("occasion", occasion);
    if (min) params.set("min", min);
    if (mine) params.set("mine", "1");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `/fits?${qs}` : "/fits");
  }, [occasion, min, mine]);

  const manualCount = useMemo(() => cards.filter((c) => c.manual).length, [cards]);
  const stylistCount = cards.length - manualCount;

  const byAuthor = useMemo(
    () => cards.filter((c) => c.manual === mine),
    [cards, mine]
  );

  // Occasion counts reflect the current author split, so a zero is honest.
  const occasionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of byAuthor) {
      if (c.occasion) m.set(c.occasion, (m.get(c.occasion) ?? 0) + 1);
    }
    return m;
  }, [byAuthor]);

  const visible = useMemo(() => {
    const minScore = min === "8" || min === "9" ? Number(min) : null;
    return byAuthor.filter((c) => {
      if (occasion && c.occasion !== occasion) return false;
      if (minScore !== null && (c.score ?? 0) < minScore) return false;
      return true;
    });
  }, [byAuthor, occasion, min]);

  const tabs = [
    { value: "", label: "All", count: byAuthor.length },
    ...(Object.keys(OCCASION_LABELS) as Occasion[]).map((value) => ({
      value,
      label: OCCASION_LABELS[value],
      count: occasionCounts.get(value) ?? 0,
    })),
  ];

  const chip = (active: boolean) =>
    `shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] transition-colors ${
      active ? "bg-ink text-ivory" : "border hairline bg-paper text-ink-soft hover:bg-ivory"
    }`;

  return (
    <>
      {/* Who styled it — the primary split, always in reach rather than at the
          end of a scrolling rail. */}
      <div className="mb-4 flex rounded-full border hairline bg-paper p-1 sm:mb-5 sm:w-fit">
        {[
          { value: false, label: "Stylist picks", count: stylistCount },
          { value: true, label: "Styled by me", count: manualCount },
        ].map((seg) => {
          const active = mine === seg.value;
          return (
            <button
              key={seg.label}
              type="button"
              onClick={() => setMine(seg.value)}
              aria-pressed={active}
              className={`flex-1 whitespace-nowrap rounded-full px-4 py-2 text-center text-[13px] font-medium transition-colors sm:flex-none ${
                active ? "bg-ink text-ivory" : "text-ink-soft hover:bg-ivory"
              }`}
            >
              {seg.label}
              <span className={`ml-1.5 text-[11px] ${active ? "text-ivory/60" : "text-ink-faint"}`}>
                {seg.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:mb-8 sm:flex-wrap sm:overflow-visible sm:px-0">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setOccasion(t.value)}
            aria-pressed={occasion === t.value}
            disabled={t.count === 0 && t.value !== ""}
            className={`${chip(occasion === t.value)} disabled:cursor-default disabled:opacity-35`}
          >
            {t.label}
            {t.value !== "" && (
              <span className="ml-1.5 text-[11px] opacity-60">{t.count}</span>
            )}
          </button>
        ))}

        <span className="mx-1 hidden self-center text-ink-faint/40 sm:inline">|</span>

        {[
          { v: "", label: "Any rating" },
          { v: "8", label: "8+" },
          { v: "9", label: "9+" },
        ].map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setMin(f.v)}
            aria-pressed={min === f.v}
            className={
              min === f.v
                ? "shrink-0 whitespace-nowrap rounded-full bg-camel px-4 py-1.5 text-[13px] text-ivory transition-colors"
                : chip(false)
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nothing on the rack yet."
          body={
            mine
              ? "You haven't styled a fit yourself yet — hit Build my own fit on the Wardrobe page."
              : occasion
                ? "No fits for this occasion yet — generate a fresh set."
                : "Your stylist is ready. Generate fits from your wardrobe and see them rendered on you."
          }
        />
      ) : (
        <FitsGallery key={`${mine}-${occasion}-${min}`} cards={visible} goofyMode={goofyMode} />
      )}
    </>
  );
}
