"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";
import type { RenderRecord } from "@/lib/types";

export default function RenderPanel({
  currentUrl,
  history,
  historyUrls,
  hasPhotos,
}: {
  currentUrl: string | null;
  history: RenderRecord[];
  historyUrls: Record<string, string>;
  hasPhotos: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/profile/render", { method: "POST" });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Render failed");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5 md:flex-row">
      <div className="w-full max-w-[260px]">
        <div className="aspect-[3/4] overflow-hidden rounded-2xl border hairline bg-ivory">
          {busy ? (
            <div className="h-full w-full shimmer" />
          ) : currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentUrl}
              alt="Your base render"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <span className="serif-accent text-ink-faint">
                no render yet
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1">
        <p className="text-sm leading-relaxed text-ink-soft">
          This base render is used as the{" "}
          <span className="serif-accent">mannequin</span> for all your fits —
          generated once from your photos, height, and weight, then dressed in
          every outfit we style.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <Button onClick={generate} disabled={busy || !hasPhotos}>
            {busy
              ? "Rendering… ~30s"
              : currentUrl
                ? "Re-generate render"
                : "Generate my render"}
          </Button>
        </div>
        {!hasPhotos && (
          <p className="mt-2 text-[12px] text-ink-faint">
            Add at least one photo first — full-body works best.
          </p>
        )}
        {error && <p className="mt-3 text-[13px] text-camel-deep">{error}</p>}

        {history.length > 0 && (
          <div className="mt-8">
            <p className="eyebrow mb-3">Render history</p>
            <div className="flex flex-wrap gap-3">
              {history.map((r) => (
                <div key={r.id} className="w-20">
                  <div className="aspect-[3/4] overflow-hidden rounded-lg border hairline bg-ivory">
                    {historyUrls[r.storage_path] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={historyUrls[r.storage_path]}
                        alt={r.model}
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="mt-1.5">
                    <Badge>{r.model.replace(/^gemini-|^gpt-/, "")}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
