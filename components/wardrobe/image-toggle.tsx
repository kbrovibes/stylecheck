"use client";

import { useState } from "react";
import ZoomImage from "@/components/lightbox";

export default function ImageToggle({
  catalogUrl,
  originalUrl,
  alt,
}: {
  catalogUrl: string | null;
  originalUrl: string | null;
  alt: string;
}) {
  const [view, setView] = useState<"catalog" | "original">(
    catalogUrl ? "catalog" : "original"
  );
  const url = view === "catalog" ? catalogUrl : originalUrl;

  return (
    <div>
      <div className="aspect-square overflow-hidden rounded-2xl border hairline bg-paper">
        {url ? (
          <ZoomImage
            src={url}
            alt={alt}
            caption={view === "catalog" ? "catalogue shot" : "original photo"}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="serif-accent text-ink-faint">no image</span>
          </div>
        )}
      </div>
      {catalogUrl && originalUrl && (
        <div className="mt-3 flex justify-center gap-1 rounded-full border hairline bg-paper p-1 text-[12px] w-fit mx-auto">
          <button
            onClick={() => setView("catalog")}
            className={`rounded-full px-4 py-1 transition-colors ${
              view === "catalog" ? "bg-ink text-ivory" : "text-ink-soft hover:text-ink"
            }`}
          >
            Catalogue
          </button>
          <button
            onClick={() => setView("original")}
            className={`rounded-full px-4 py-1 transition-colors ${
              view === "original" ? "bg-ink text-ivory" : "text-ink-soft hover:text-ink"
            }`}
          >
            Original
          </button>
        </div>
      )}
    </div>
  );
}
