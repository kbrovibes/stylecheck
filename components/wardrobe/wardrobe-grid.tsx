"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";

export interface GridItem {
  id: string;
  name: string;
  sub: string;
  category: string;
  url: string | null;
  pending: boolean;
  benched: boolean;
}

/**
 * Wardrobe product grid with a selection mode: pick pieces, then have the
 * stylist compose and render them as one fit (exactly those items).
 */
export default function WardrobeGrid({
  items,
  sections,
  selectable = true,
  startSelecting = false,
}: {
  items: GridItem[];
  sections?: { title: string; items: GridItem[] }[] | null;
  selectable?: boolean;
  startSelecting?: boolean;
}) {
  const router = useRouter();
  const [selecting, setSelecting] = useState(startSelecting);
  // The header "Build my own fit" link lands on ?build=1 — enter select mode
  // even when the client component doesn't remount on that navigation.
  useEffect(() => {
    if (startSelecting) setSelecting(true);
  }, [startSelecting]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The action bar portals to <body>: the page wrapper's fade-up animation
  // leaves a transform behind, which would re-anchor position:fixed to it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function toggle(id: string) {
    setError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 8) next.add(id);
      return next;
    });
  }

  function reset() {
    setSelecting(false);
    setSelected(new Set());
    setError(null);
    if (window.location.search.includes("build=1"))
      router.replace("/wardrobe", { scroll: false });
  }

  async function styleThese() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/fits/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_ids: [...selected] }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => ({}))) ?? {};
    setBusy(false);
    if (res?.ok && json.id) {
      reset();
      router.push(`/fits/${json.id}`);
    } else {
      setError(json.error ?? "Styling failed — try again.");
    }
  }

  const allItems = sections?.length
    ? sections.flatMap((sec) => sec.items)
    : items;

  // A fit needs a top and a bottom (or a one-piece) — the rest is optional.
  const selectedCats = new Set(
    allItems.filter((i) => selected.has(i.id)).map((i) => i.category)
  );
  const wearable =
    selectedCats.has("full_body") ||
    (selectedCats.has("top") && selectedCats.has("bottom"));

  const renderGrid = (list: GridItem[]) => (
      <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
        {list.map((item) => {
          const isSel = selected.has(item.id);
          const media = (
            <>
              <div
                className={`relative aspect-square overflow-hidden rounded-xl border bg-paper transition-all ${
                  isSel ? "border-camel ring-2 ring-camel" : "hairline"
                }`}
              >
                {item.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.url}
                    alt={item.name}
                    className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04] ${
                      item.benched ? "opacity-40 grayscale" : ""
                    }`}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <span className="serif-accent text-ink-faint">no image</span>
                  </div>
                )}
                {item.pending && (
                  <div className="absolute left-2 top-2">
                    <Badge tone="neutral">original shot</Badge>
                  </div>
                )}
                {item.benched && (
                  <div className="absolute right-2 top-2">
                    <Badge tone="ink">benched</Badge>
                  </div>
                )}
                {selecting && (
                  <span
                    className={`absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full text-[15px] shadow-sm transition-all ${
                      isSel
                        ? "bg-camel text-ivory"
                        : "border border-camel/50 bg-paper/95 text-camel-deep"
                    }`}
                  >
                    {isSel ? "✓" : "+"}
                  </span>
                )}
              </div>
              <div className="mt-3">
                <p className="truncate text-[13px] font-medium tracking-tight">
                  {item.name}
                </p>
                <p className="mt-0.5 truncate text-[11px] uppercase tracking-widest text-ink-faint">
                  {item.sub}
                </p>
              </div>
            </>
          );
          return selecting ? (
            <button
              key={item.id}
              onClick={() => toggle(item.id)}
              disabled={item.benched}
              className={`group text-left ${item.benched ? "cursor-not-allowed opacity-60" : ""}`}
            >
              {media}
            </button>
          ) : (
            <Link key={item.id} href={`/wardrobe/${item.id}`} className="group">
              {media}
            </Link>
          );
        })}
      </div>
  );

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <p className="eyebrow !mb-0">
          {allItems.length} piece{allItems.length === 1 ? "" : "s"}
        </p>
      </div>

      {selecting && (
        <div className="sheet-up mb-8 rounded-2xl border border-camel/30 bg-camel/10 px-5 py-4 text-[14px] leading-relaxed text-camel-deep">
          <span className="font-semibold">You&rsquo;re building a fit.</span>{" "}
          Tap the pieces you want to wear — at least a top and a bottom, plus
          anything else you like. Then hit{" "}
          <span className="font-semibold">Render my fit</span> in the bar below.
        </div>
      )}

      {sections && sections.length ? (
        sections
          .filter((sec) => sec.items.length > 0)
          .map((sec, si) => (
            <div key={sec.title} className={si > 0 ? "mt-14" : ""}>
              <h2 className="mb-5 text-xl font-semibold tracking-tight">
                {sec.title.split(" ")[0]}{" "}
                <span className="serif-accent text-camel">
                  {sec.title.split(" ").slice(1).join(" ")}
                </span>
              </h2>
              {renderGrid(sec.items)}
            </div>
          ))
      ) : (
        renderGrid(items)
      )}

      {/* Floating action bar */}
      {selecting && mounted && createPortal(
        <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-6">
          <div className="sheet-up flex max-w-md flex-1 flex-col gap-1.5 rounded-3xl bg-ink px-5 py-3.5 shadow-2xl shadow-ink/30">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[13px] text-ivory/80">
                {selected.size
                  ? `${selected.size} selected`
                  : "Tap pieces above to start"}
              </span>
              <span className="flex items-center gap-3">
                <button
                  onClick={reset}
                  disabled={busy}
                  className="text-[13px] text-ivory/60 transition-colors hover:text-ivory"
                >
                  Cancel
                </button>
                <button
                  onClick={styleThese}
                  disabled={busy || !wearable}
                  className="rounded-full bg-ivory px-4 py-2 text-[13px] font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {busy ? "Styling & rendering… ~1 min" : "Render my fit"}
                </button>
              </span>
            </div>
            {!wearable && !busy && (
              <p className="text-[12px] text-ivory/60">
                Pick at least a top and a bottom — everything else is optional.
              </p>
            )}
            {error && <p className="text-[12px] text-blush">{error}</p>}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
