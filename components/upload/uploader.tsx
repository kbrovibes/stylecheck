"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import imageCompression from "browser-image-compression";
import { createClient } from "@/lib/supabase/client";
import { Badge, Card } from "@/components/ui";
import { CATEGORY_LABELS, type Category, type PhotoKind } from "@/lib/types";

type Status =
  | "queued"
  | "compressing"
  | "uploading"
  | "classifying"
  | "done"
  | "failed";

interface Entry {
  id: string;
  file: File;
  previewUrl: string;
  status: Status;
  path?: string;
  error?: string;
  kind?: "person" | "item" | "unusable";
  items?: { id: string; name: string; category: Category }[];
  photoKind?: PhotoKind;
}

interface ClassifyResult {
  path: string;
  kind: "person" | "item" | "unusable" | "error";
  photo?: { id: string; photo_kind: PhotoKind } | null;
  items?: { id: string; name: string; category: Category }[];
  error?: string;
}

const STATUS_LABELS: Record<Status, string> = {
  queued: "Queued",
  compressing: "Compressing",
  uploading: "Uploading",
  classifying: "Classifying",
  done: "Done",
  failed: "Failed",
};

export default function Uploader() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = useCallback((id: string, delta: Partial<Entry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...delta } : e)));
  }, []);

  const process = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (!images.length) return;

      const fresh: Entry[] = images.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "queued",
      }));
      setEntries((prev) => [...prev, ...fresh]);
      setBusy(true);

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        fresh.forEach((e) =>
          patch(e.id, { status: "failed", error: "Not signed in" })
        );
        setBusy(false);
        return;
      }

      // Compress + upload with limited concurrency.
      const uploaded: Entry[] = [];
      const pool = 3;
      let cursor = 0;
      async function worker() {
        while (cursor < fresh.length) {
          const entry = fresh[cursor++];
          try {
            patch(entry.id, { status: "compressing" });
            const compressed = await imageCompression(entry.file, {
              maxWidthOrHeight: 1280,
              maxSizeMB: 0.5,
              fileType: "image/jpeg",
              useWebWorker: true,
            });
            patch(entry.id, { status: "uploading" });
            const path = `${user!.id}/originals/${crypto.randomUUID()}.jpg`;
            const { error } = await supabase.storage
              .from("stylecheck")
              .upload(path, compressed, { contentType: "image/jpeg" });
            if (error) throw new Error(error.message);
            entry.path = path;
            patch(entry.id, { status: "classifying", path });
            uploaded.push(entry);
          } catch (err) {
            patch(entry.id, {
              status: "failed",
              error: err instanceof Error ? err.message : "Upload failed",
            });
          }
        }
      }
      await Promise.all(Array.from({ length: pool }, worker));

      // Classify in batches of 4.
      for (let i = 0; i < uploaded.length; i += 4) {
        const batch = uploaded.slice(i, i + 4);
        try {
          const res = await fetch("/api/classify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths: batch.map((e) => e.path) }),
          });
          if (!res.ok) throw new Error(`Classification failed (${res.status})`);
          const { results } = (await res.json()) as { results: ClassifyResult[] };
          for (const entry of batch) {
            const r = results.find((x) => x.path === entry.path);
            if (!r || r.kind === "error") {
              patch(entry.id, {
                status: "failed",
                error: r?.error ?? "No result",
              });
            } else {
              patch(entry.id, {
                status: "done",
                kind: r.kind,
                items: r.items ?? [],
                photoKind: r.photo?.photo_kind,
              });
            }
          }
        } catch (err) {
          batch.forEach((entry) =>
            patch(entry.id, {
              status: "failed",
              error: err instanceof Error ? err.message : "Classification failed",
            })
          );
        }
      }
      setBusy(false);
    },
    [patch]
  );

  const finished = entries.filter((e) => e.status === "done");
  const itemCount = finished.reduce((n, e) => n + (e.items?.length ?? 0), 0);
  const personCount = finished.filter((e) => e.kind === "person").length;
  const unusableCount = finished.filter((e) => e.kind === "unusable").length;
  const failedCount = entries.filter((e) => e.status === "failed").length;
  const allSettled =
    entries.length > 0 &&
    entries.every((e) => e.status === "done" || e.status === "failed");

  return (
    <div className="space-y-8">
      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          process(Array.from(e.dataTransfer.files));
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed px-8 py-20 text-center transition-colors ${
          dragging
            ? "border-camel bg-camel/5"
            : "hairline bg-paper/60 hover:bg-paper"
        }`}
      >
        <p className="serif-accent text-2xl text-ink-soft">
          Drop images here
        </p>
        <p className="mt-2 text-sm text-ink-faint">
          or click to browse — garments, shoes, accessories, and photos of you
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) process(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
      </div>

      {/* Progress + results */}
      {entries.length > 0 && (
        <div>
          <p className="eyebrow mb-4">
            {busy ? "Processing" : "Processed"} · {entries.length} image
            {entries.length === 1 ? "" : "s"}
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {entries.map((e) => (
              <div
                key={e.id}
                className="overflow-hidden rounded-2xl border hairline bg-paper"
              >
                <div className="relative aspect-square bg-ivory">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={e.previewUrl}
                    alt=""
                    className={`h-full w-full object-cover transition-opacity ${
                      e.status === "done" || e.status === "failed"
                        ? "opacity-100"
                        : "opacity-60"
                    }`}
                  />
                  {e.status !== "done" && e.status !== "failed" && (
                    <div className="absolute inset-x-0 bottom-0 h-1.5 shimmer" />
                  )}
                </div>
                <div className="p-3">
                  {e.status === "done" && (e.items?.length ?? 0) > 0 && (
                    <>
                      <p className="truncate text-[12px] font-medium">
                        {e.items![0].name ?? "Item"}
                        {e.items!.length > 1 && (
                          <span className="text-ink-faint"> +{e.items!.length - 1}</span>
                        )}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {e.items!.slice(0, 3).map((it, idx) => (
                          <Badge key={idx} tone="camel">
                            {CATEGORY_LABELS[it.category] ?? it.category}
                          </Badge>
                        ))}
                        {e.kind === "person" && (
                          <Badge tone="moss">
                            {(e.photoKind ?? "photo").replace("_", " ")}
                          </Badge>
                        )}
                      </div>
                    </>
                  )}
                  {e.status === "done" && e.kind === "person" && !e.items?.length && (
                    <>
                      <p className="truncate text-[12px] font-medium">
                        Profile photo
                      </p>
                      <div className="mt-1.5">
                        <Badge tone="moss">
                          {(e.photoKind ?? "photo").replace("_", " ")}
                        </Badge>
                      </div>
                    </>
                  )}
                  {e.status === "done" && e.kind === "unusable" && (
                    <>
                      <p className="truncate text-[12px] text-ink-faint">
                        Not usable
                      </p>
                      <div className="mt-1.5">
                        <Badge>skipped</Badge>
                      </div>
                    </>
                  )}
                  {e.status === "failed" && (
                    <>
                      <p
                        className="truncate text-[12px] text-ink-faint"
                        title={e.error}
                      >
                        {e.error ?? "Failed"}
                      </p>
                      <div className="mt-1.5">
                        <Badge tone="ink">failed</Badge>
                      </div>
                    </>
                  )}
                  {e.status !== "done" && e.status !== "failed" && (
                    <p className="text-[12px] text-ink-faint">
                      {STATUS_LABELS[e.status]}…
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {allSettled && (
            <Card className="mt-8">
              <p className="eyebrow mb-3">Summary</p>
              <p className="text-sm leading-relaxed text-ink-soft">
                {itemCount > 0 && (
                  <>
                    <span className="font-semibold text-ink">{itemCount}</span>{" "}
                    piece{itemCount === 1 ? "" : "s"} added to your wardrobe
                  </>
                )}
                {itemCount > 0 && personCount > 0 && " · "}
                {personCount > 0 && (
                  <>
                    <span className="font-semibold text-ink">{personCount}</span>{" "}
                    profile photo{personCount === 1 ? "" : "s"} detected
                  </>
                )}
                {itemCount === 0 && personCount === 0 && "Nothing was added."}
                {unusableCount > 0 && ` · ${unusableCount} skipped`}
                {failedCount > 0 && ` · ${failedCount} failed`}
              </p>
              <div className="mt-4 flex gap-3">
                {itemCount > 0 && (
                  <Link
                    href="/wardrobe"
                    className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-ivory transition-opacity hover:opacity-85"
                  >
                    View wardrobe →
                  </Link>
                )}
                {personCount > 0 && (
                  <Link
                    href="/profile"
                    className="rounded-full border hairline bg-paper px-5 py-2.5 text-[13px] font-medium transition-colors hover:bg-ivory"
                  >
                    View profile →
                  </Link>
                )}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
