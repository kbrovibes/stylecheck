"use client";

import { useRef, useState } from "react";
import ZoomImage from "@/components/lightbox";

export interface CarouselSlide {
  url: string;
  label: string; // e.g. "🤪 goofy", "classic"
}

/**
 * Side-scrollable snap carousel for fit renders. Slides are shown in the given
 * order (goofy first when goofy mode is on).
 */
export default function RenderCarousel({
  slides,
  aspect = "aspect-[3/4]",
  zoomable = false,
  imgClass = "object-contain",
  rounded = "",
}: {
  slides: CarouselSlide[];
  aspect?: string;
  zoomable?: boolean;
  imgClass?: string;
  rounded?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    setIdx(Math.round(el.scrollLeft / el.clientWidth));
  }

  function go(e: React.MouseEvent, to: number) {
    // inside <Link> tiles — don't navigate
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(slides.length - 1, to));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
  }

  if (!slides.length) return null;

  return (
    <div className={`relative overflow-hidden ${rounded}`}>
      <div
        ref={ref}
        onScroll={onScroll}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
      >
        {slides.map((s) => (
          <div key={s.url} className={`w-full shrink-0 snap-center ${aspect} bg-ivory`}>
            {zoomable ? (
              <ZoomImage
                src={s.url}
                alt={s.label}
                caption={s.label}
                className={`h-full w-full ${imgClass}`}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.url} alt={s.label} className={`h-full w-full ${imgClass}`} />
            )}
          </div>
        ))}
      </div>

      {slides.length > 1 && (
        <>
          {/* Desktop arrows — mice can't swipe */}
          {idx > 0 && (
            <button
              onClick={(e) => go(e, idx - 1)}
              aria-label="Previous image"
              className="absolute left-1.5 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-ink/45 text-ivory backdrop-blur transition-colors hover:bg-ink/75 [@media(hover:hover)]:flex"
            >
              ‹
            </button>
          )}
          {idx < slides.length - 1 && (
            <button
              onClick={(e) => go(e, idx + 1)}
              aria-label="Next image"
              className="absolute right-1.5 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-ink/45 text-ivory backdrop-blur transition-colors hover:bg-ink/75 [@media(hover:hover)]:flex"
            >
              ›
            </button>
          )}
          <div className="absolute inset-x-0 bottom-2 z-10 flex justify-center gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.url}
                onClick={(e) => go(e, i)}
                aria-label={`Image ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === idx ? "w-4 bg-ivory" : "w-1.5 bg-ivory/45 hover:bg-ivory/70"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
