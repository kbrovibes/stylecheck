"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";
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
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [offerRegen, setOfferRegen] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenDone, setRegenDone] = useState(false);

  async function patchPhoto(body: object) {
    const res = await fetch("/api/profile/photos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function setPrimary(id: string) {
    setPending(id);
    await patchPhoto({ id, is_primary: true });
    setPending(null);
    router.refresh();
  }

  async function remove(id: string) {
    setPending(id);
    setConfirmDelete(null);
    const json = await patchPhoto({ id, deleted: true });
    setPending(null);
    setOfferRegen((json.remaining ?? 0) > 0);
    router.refresh();
  }

  async function regenerate() {
    setRegenBusy(true);
    await fetch("/api/profile/render", { method: "POST" });
    setRegenBusy(false);
    setRegenDone(true);
    setTimeout(() => {
      setOfferRegen(false);
      setRegenDone(false);
    }, 2500);
    router.refresh();
  }

  return (
    <>
      {photos.map((p) => (
        <div
          key={p.id}
          className={`group relative aspect-[3/4] overflow-hidden rounded-2xl border bg-paper transition-all ${
            p.is_primary ? "border-camel shadow-md shadow-camel/10" : "hairline"
          }`}
        >
          <button
            onClick={() => setPrimary(p.id)}
            disabled={pending !== null}
            title={p.is_primary ? "Primary photo" : "Tap to make primary"}
            className="absolute inset-0 text-left"
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

          {/* delete */}
          {confirmDelete === p.id ? (
            <div className="absolute inset-x-2 top-2 flex items-center justify-between gap-1 rounded-full bg-ink/85 px-3 py-1.5 backdrop-blur-sm">
              <span className="text-[11px] text-ivory">Remove?</span>
              <span className="flex gap-2">
                <button
                  onClick={() => remove(p.id)}
                  className="text-[11px] font-semibold text-blush"
                >
                  Yes
                </button>
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="text-[11px] text-ivory/70"
                >
                  No
                </button>
              </span>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(p.id)}
              disabled={pending !== null}
              aria-label="Remove photo"
              className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-ink/55 text-[13px] leading-none text-ivory opacity-0 backdrop-blur-sm transition-opacity hover:bg-ink/80 group-hover:opacity-100"
            >
              ×
            </button>
          )}
        </div>
      ))}

      {/* post-delete regenerate offer */}
      {offerRegen && (
        <div className="col-span-full mt-1 flex flex-wrap items-center gap-3 rounded-2xl border hairline bg-paper px-5 py-3.5">
          <p className="text-[13px] text-ink-soft">
            {regenDone
              ? "Base render refreshed with your remaining photos."
              : "Photo removed. Your base render was built from your photos — regenerate it with the remaining ones?"}
          </p>
          {!regenDone && (
            <span className="flex gap-2">
              <Button onClick={regenerate} disabled={regenBusy} className="!px-4 !py-1.5">
                {regenBusy ? "Rendering… ~30s" : "Regenerate render"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setOfferRegen(false)}
                disabled={regenBusy}
                className="!px-4 !py-1.5"
              >
                Not now
              </Button>
            </span>
          )}
        </div>
      )}
    </>
  );
}
