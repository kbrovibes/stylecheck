"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import type { UserPhoto } from "@/lib/types";

const KIND_LABEL: Record<string, string> = {
  selfie: "Selfie",
  full_body: "Full body",
  half_body: "Half body",
  unknown: "Photo",
};

export default function PhotoGrid({
  photos,
  urls,
}: {
  photos: UserPhoto[];
  urls: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function setPrimary(id: string) {
    setPending(id);
    await fetch("/api/profile/photos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, is_primary: true }),
    });
    setPending(null);
    router.refresh();
  }

  return (
    <>
      {photos.map((p) => (
        <button
          key={p.id}
          onClick={() => setPrimary(p.id)}
          disabled={pending !== null}
          title={p.is_primary ? "Primary photo" : "Tap to make primary"}
          className={`group relative aspect-[3/4] overflow-hidden rounded-2xl border bg-paper text-left transition-all ${
            p.is_primary ? "border-camel shadow-md shadow-camel/10" : "hairline"
          }`}
        >
          {urls[p.storage_path] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={urls[p.storage_path]}
              alt={KIND_LABEL[p.kind]}
              className="h-full w-full object-cover object-top"
            />
          ) : (
            <div className="h-full w-full shimmer" />
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-ink/60 to-transparent p-2.5">
            <span className="text-[11px] font-medium text-ivory">
              {pending === p.id ? "…" : KIND_LABEL[p.kind]}
            </span>
            {p.is_primary && <Badge tone="camel">Primary</Badge>}
          </div>
        </button>
      ))}
    </>
  );
}
