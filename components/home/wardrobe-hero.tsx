"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface HeroGroup {
  key: string;
  label: string;
  href: string;
  items: { id: string; name: string; url: string | null }[];
}

// Hotspot geometry matches the prescribed composition in wardrobeScenePrompt:
// left half = hanging rail, right side = three shelves top-to-bottom.
const REGIONS: Record<string, { left: string; top: string; width: string; height: string }> = {
  hanging: { left: "0%", top: "0%", width: "55%", height: "100%" },
  folded: { left: "55%", top: "0%", width: "45%", height: "34%" },
  shoes: { left: "55%", top: "34%", width: "45%", height: "33%" },
  tray: { left: "55%", top: "67%", width: "45%", height: "33%" },
};

export default function WardrobeHero({
  sceneUrl,
  status,
  stale,
  groups,
}: {
  sceneUrl: string | null;
  status: string;
  stale: boolean;
  groups: HeroGroup[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState(status === "pending");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!pending) return;
    pollRef.current = setInterval(async () => {
      const res = await fetch("/api/scene").catch(() => null);
      if (!res?.ok) return;
      const json = await res.json();
      if (json.status !== "pending") {
        setPending(false);
        if (pollRef.current) clearInterval(pollRef.current);
        router.refresh();
      }
    }, 10000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pending, router]);

  async function restyle() {
    setError(null);
    setPending(true);
    const res = await fetch("/api/scene", { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Could not start restyling");
      setPending(false);
    }
  }

  const active = groups.find((g) => g.key === open);

  return (
    <div className="relative mb-10 overflow-hidden rounded-3xl border hairline bg-ink">
      <div className="relative aspect-[16/10] sm:aspect-[16/8]">
        {sceneUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sceneUrl}
            alt="Your wardrobe"
            fetchPriority="high"
            className="kenburns h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-b from-ink to-[#241f18] px-8 text-center">
            <p className="serif-accent text-2xl text-ivory/90 sm:text-3xl">
              Your closet, as a place.
            </p>
            <p className="max-w-sm text-[13px] leading-relaxed text-ivory/50">
              We&apos;ll compose your actual pieces into a walk-in wardrobe you
              can browse. It regenerates itself when your wardrobe changes.
            </p>
            {!pending && (
              <button
                onClick={restyle}
                className="mt-2 rounded-full bg-ivory px-5 py-2.5 text-[13px] font-medium text-ink transition-opacity hover:opacity-90"
              >
                Style my closet
              </button>
            )}
          </div>
        )}

        {/* soft vignette for legibility */}
        {sceneUrl && (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/35 via-transparent to-ink/10" />
        )}

        {/* hotspots */}
        {sceneUrl &&
          groups
            .filter((g) => g.items.length > 0)
            .map((g) => {
              const r = REGIONS[g.key];
              if (!r) return null;
              return (
                <button
                  key={g.key}
                  onClick={() => setOpen(open === g.key ? null : g.key)}
                  style={r}
                  aria-label={g.label}
                  className="group absolute rounded-2xl outline-none"
                >
                  <span className="absolute inset-2 rounded-2xl border border-ivory/0 transition-all duration-300 group-hover:border-ivory/50 group-hover:bg-ivory/5 group-focus-visible:border-ivory/70" />
                  <span
                    className={`absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium tracking-wide backdrop-blur-md transition-all duration-300 ${
                      open === g.key
                        ? "bg-ivory text-ink"
                        : "bg-ink/45 text-ivory/90 opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    {g.label}
                    <span className="opacity-60">{g.items.length}</span>
                  </span>
                </button>
              );
            })}

        {/* status chip + restyle */}
        <div className="absolute right-3 top-3 flex items-center gap-2">
          {pending && (
            <span className="flex items-center gap-2 rounded-full bg-ink/60 px-3.5 py-1.5 text-[11px] font-medium tracking-wide text-ivory backdrop-blur-md">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-camel" />
              Restyling your closet…
            </span>
          )}
          {!pending && stale && sceneUrl && (
            <span className="rounded-full bg-ink/50 px-3 py-1.5 text-[11px] text-ivory/80 backdrop-blur-md">
              wardrobe changed — refreshes tonight
            </span>
          )}
          {!pending && sceneUrl && (
            <button
              onClick={restyle}
              title="Regenerate this scene now"
              className="rounded-full bg-ink/50 px-3.5 py-1.5 text-[11px] font-medium text-ivory backdrop-blur-md transition-colors hover:bg-ink/75"
            >
              ↻ Restyle
            </button>
          )}
        </div>
        {error && (
          <p className="absolute bottom-3 right-3 rounded-full bg-ink/70 px-3 py-1.5 text-[11px] text-blush backdrop-blur-md">
            {error}
          </p>
        )}
      </div>

      {/* category sheet */}
      {active && (
        <div className="sheet-up border-t border-ivory/10 bg-ink/95 px-5 py-4 backdrop-blur-md">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-[0.22em] text-ivory/50">
              {active.label} · {active.items.length}
            </p>
            <span className="flex items-center gap-4">
              <Link
                href={active.href}
                className="text-[12px] text-camel transition-colors hover:text-ivory"
              >
                Open in wardrobe →
              </Link>
              <button
                onClick={() => setOpen(null)}
                aria-label="Close"
                className="text-[14px] leading-none text-ivory/50 hover:text-ivory"
              >
                ×
              </button>
            </span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {active.items.map((i) => (
              <Link
                key={i.id}
                href={`/wardrobe/${i.id}`}
                className="group/item w-20 shrink-0"
              >
                <span className="block aspect-square overflow-hidden rounded-xl bg-ivory transition-transform duration-300 group-hover/item:scale-[1.04]">
                  {i.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={i.url} alt={i.name} className="h-full w-full object-cover" />
                  ) : null}
                </span>
                <span className="mt-1.5 block truncate text-[11px] text-ivory/70 group-hover/item:text-ivory">
                  {i.name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
