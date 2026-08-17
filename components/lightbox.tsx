"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Retail-style zoomable image: click to expand into a fullscreen modal,
 * click anywhere / Esc / ✕ to close.
 */
export default function ZoomImage({
  src,
  alt,
  className = "",
  caption,
}: {
  src: string;
  alt: string;
  className?: string;
  caption?: string;
}) {
  const [open, setOpen] = useState(false);

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onKey]);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={() => setOpen(true)}
        className={`cursor-zoom-in ${className}`}
      />
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fade-up fixed inset-0 z-[60] flex cursor-zoom-out flex-col items-center justify-center bg-ink/92 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
        >
          <button
            aria-label="Close"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-ivory/10 text-[18px] leading-none text-ivory transition-colors hover:bg-ivory/25"
            style={{ top: "max(1rem, env(safe-area-inset-top))" }}
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="max-h-[92dvh] max-w-[95vw] rounded-xl object-contain shadow-2xl shadow-ink/50"
          />
          {caption && (
            <p className="mt-3 text-[12px] uppercase tracking-widest text-ivory/60">
              {caption}
            </p>
          )}
        </div>
      )}
    </>
  );
}
