"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";
import type { RenderAdjustments, RenderRecord } from "@/lib/types";

const DIALS: {
  key: keyof Pick<RenderAdjustments, "build" | "shoulders" | "waist">;
  label: string;
  low: string;
  high: string;
}[] = [
  { key: "build", label: "Build", low: "leaner", high: "more built" },
  { key: "shoulders", label: "Shoulders", low: "narrower", high: "broader" },
  { key: "waist", label: "Waist", low: "slimmer", high: "fuller" },
];

function Dial({
  label,
  low,
  high,
  value,
  onChange,
}: {
  label: string;
  low: string;
  high: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium">{label}</span>
        <span className="text-[11px] text-ink-faint">
          {value === 0 ? "as-is" : value > 0 ? `${high} +${value}` : `${low} ${value}`}
        </span>
      </div>
      <div className="mt-1.5 flex gap-1">
        {[-2, -1, 0, 1, 2].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-label={`${label} ${v}`}
            className={`h-7 flex-1 rounded-full border text-[11px] transition-colors ${
              value === v
                ? "border-ink bg-ink text-ivory"
                : "hairline bg-paper text-ink-faint hover:bg-ivory"
            }`}
          >
            {v > 0 ? `+${v}` : v}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function RenderPanel({
  currentUrl,
  currentPath,
  history,
  historyUrls,
  hasPhotos,
  savedAdjustments,
  readOnly = false,
}: {
  currentUrl: string | null;
  currentPath: string | null;
  history: RenderRecord[];
  historyUrls: Record<string, string>;
  hasPhotos: boolean;
  savedAdjustments: RenderAdjustments | null;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"generate" | "preview" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tuning, setTuning] = useState(false);
  const [adj, setAdj] = useState<RenderAdjustments>({
    build: savedAdjustments?.build ?? 0,
    shoulders: savedAdjustments?.shoulders ?? 0,
    waist: savedAdjustments?.waist ?? 0,
    note: savedAdjustments?.note ?? "",
  });
  const [candidate, setCandidate] = useState<{ path: string; url: string } | null>(null);

  async function call(body: object, method = "POST") {
    const res = await fetch("/api/profile/render", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Request failed");
    return json;
  }

  async function generate() {
    setBusy("generate");
    setError(null);
    try {
      await call({});
      setCandidate(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function previewTuned() {
    setBusy("preview");
    setError(null);
    try {
      const json = await call({ adjustments: adj, preview: true });
      setCandidate({ path: json.path, url: json.url });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveCandidate() {
    if (!candidate) return;
    setBusy("save");
    setError(null);
    try {
      await call({ path: candidate.path, adjustments: adj }, "PUT");
      setCandidate(null);
      setTuning(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const rendering = busy === "generate" || busy === "preview";

  return (
    <div>
      <div className="flex flex-col gap-5 md:flex-row">
        {/* Current + candidate side by side */}
        <div className="flex gap-4">
          <div className="w-[160px] sm:w-[200px]">
            {candidate && <p className="eyebrow mb-2">Current</p>}
            <div className="aspect-[3/4] overflow-hidden rounded-2xl border hairline bg-ivory">
              {busy === "generate" ? (
                <div className="h-full w-full shimmer" />
              ) : currentUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentUrl}
                  alt="Your base render"
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-center">
                  <span className="serif-accent text-ink-faint">no render yet</span>
                </div>
              )}
            </div>
          </div>
          {(candidate || busy === "preview") && (
            <div className="w-[160px] sm:w-[200px]">
              <p className="eyebrow mb-2 text-camel-deep">Tuned preview</p>
              <div className="aspect-[3/4] overflow-hidden rounded-2xl border-2 border-camel/40 bg-ivory">
                {busy === "preview" ? (
                  <div className="h-full w-full shimmer" />
                ) : candidate ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={candidate.url}
                    alt="Tuned preview"
                    className="h-full w-full object-contain"
                  />
                ) : null}
              </div>
              {candidate && (
                <div className="mt-3 flex gap-2">
                  <Button
                    onClick={saveCandidate}
                    disabled={busy !== null}
                    className="!px-4 !py-1.5"
                  >
                    {busy === "save" ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setCandidate(null)}
                    disabled={busy !== null}
                    className="!px-4 !py-1.5"
                  >
                    Discard
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-1">
          <p className="text-sm leading-relaxed text-ink-soft">
            This base render is used as the{" "}
            <span className="serif-accent">mannequin</span> for all your fits —
            generated once from your photos, height, and weight, then dressed in
            every outfit we style.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {readOnly ? (
              <p className="text-[12px] text-ink-faint">View-only access — rendering is managed by the owner.</p>
            ) : (
            <>
            <Button onClick={generate} disabled={rendering || !hasPhotos}>
              {busy === "generate"
                ? "Rendering… ~30s"
                : currentUrl
                  ? "Re-generate render"
                  : "Generate my render"}
            </Button>
            {currentUrl && (
              <Button
                variant="secondary"
                onClick={() => setTuning((t) => !t)}
                disabled={rendering}
              >
                {tuning ? "Hide tuning" : "Tune the render"}
              </Button>
            )}
            </>
            )}
          </div>
          {!hasPhotos && (
            <p className="mt-2 text-[12px] text-ink-faint">
              Add at least one photo first — full-body works best.
            </p>
          )}
          {error && <p className="mt-3 text-[13px] text-camel-deep">{error}</p>}

          {tuning && (
            <div className="mt-6 rounded-2xl border hairline bg-ivory/60 p-5">
              <p className="eyebrow mb-1">Body calibration</p>
              <p className="mb-4 text-[12px] leading-relaxed text-ink-faint">
                The render slightly off? Dial in corrections, preview, and save
                only if it looks more like you. Previews are kept in history —
                nothing is deleted.
              </p>
              <div className="space-y-4">
                {DIALS.map((d) => (
                  <Dial
                    key={d.key}
                    label={d.label}
                    low={d.low}
                    high={d.high}
                    value={adj[d.key]}
                    onChange={(v) => setAdj((a) => ({ ...a, [d.key]: v }))}
                  />
                ))}
                <div>
                  <label className="text-[13px] font-medium" htmlFor="adj-note">
                    Anything else?
                  </label>
                  <input
                    id="adj-note"
                    type="text"
                    value={adj.note ?? ""}
                    onChange={(e) => setAdj((a) => ({ ...a, note: e.target.value }))}
                    placeholder="e.g. slightly less defined arms"
                    className="mt-1.5 w-full rounded-xl border hairline bg-paper px-3.5 py-2 text-[13px] outline-none placeholder:text-ink-faint/60 focus:border-camel"
                  />
                </div>
              </div>
              <div className="mt-5">
                <Button onClick={previewTuned} disabled={rendering}>
                  {busy === "preview" ? "Rendering preview… ~30s" : "Preview tuned render"}
                </Button>
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div className="mt-8">
              <p className="eyebrow mb-3">Render history</p>
              <div className="flex flex-wrap gap-3">
                {history.map((r) => (
                  <div key={r.id} className="group/hist relative w-20">
                    <div className={`aspect-[3/4] overflow-hidden rounded-lg border bg-ivory ${r.storage_path === currentPath ? "border-camel" : "hairline"}`}>
                      {historyUrls[r.storage_path] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={historyUrls[r.storage_path]}
                          alt="Previous render"
                          className="h-full w-full object-cover object-top"
                        />
                      )}
                    </div>
                    {!readOnly && (
                    <button
                      onClick={async () => {
                        setError(null);
                        const res = await fetch(`/api/renders/${r.id}`, {
                          method: "DELETE",
                        });
                        if (!res.ok) {
                          const j = await res.json().catch(() => ({}));
                          setError(j.error ?? "Could not remove render");
                        } else {
                          router.refresh();
                        }
                      }}
                      aria-label="Remove render"
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink/55 text-[12px] leading-none text-ivory opacity-70 backdrop-blur-sm transition-opacity hover:bg-ink/80 hover:opacity-100 sm:opacity-0 sm:group-hover/hist:opacity-100"
                    >
                      ×
                    </button>
                    )}
                    <div className="mt-1.5 space-y-1">
                      <Badge>{new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</Badge>
                      {!readOnly && r.storage_path !== currentPath && (
                        <button
                          onClick={async () => {
                            setError(null);
                            const res = await fetch("/api/profile/render", {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ path: r.storage_path }),
                            });
                            if (!res.ok) {
                              const j = await res.json().catch(() => ({}));
                              setError(j.error ?? "Could not switch render");
                            } else {
                              router.refresh();
                            }
                          }}
                          className="block w-full rounded-full border hairline bg-paper py-0.5 text-[10px] font-medium text-ink-soft transition-colors hover:bg-ink hover:text-ivory"
                        >
                          Use as mannequin
                        </button>
                      )}
                      {r.storage_path === currentPath && (
                        <p className="text-center text-[10px] uppercase tracking-widest text-camel-deep">
                          active
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
