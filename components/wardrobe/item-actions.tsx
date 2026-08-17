"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export default function ItemActions({
  itemId,
  enabled,
  hasCatalog,
}: {
  itemId: string;
  enabled: boolean;
  hasCatalog: boolean;
}) {
  const router = useRouter();
  const [shooting, setShooting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState("");

  async function generateCatalog() {
    setShooting(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${itemId}/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hint: hint.trim() || undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setShooting(false);
    }
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      if (body.deleted) {
        router.push("/wardrobe");
        router.refresh();
      } else {
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={hint}
        onChange={(e) => setHint(e.target.value)}
        disabled={shooting}
        placeholder='Optional context for extraction — e.g. "this is a jeans"'
        className="w-full rounded-xl border hairline bg-paper px-3.5 py-2 text-[13px] outline-none placeholder:text-ink-faint/60 focus:border-camel"
      />
      {shooting ? (
        <div className="shimmer flex h-11 items-center justify-center rounded-full border hairline text-[13px] text-ink-soft">
          Extracting your product…
        </div>
      ) : (
        <Button onClick={generateCatalog} className="w-full">
          {hasCatalog ? "Re-extract product shot" : "Extract product shot"}
        </Button>
      )}

      <Button
        variant="secondary"
        className="w-full"
        disabled={busy || shooting}
        onClick={() => patch({ enabled: !enabled })}
      >
        {enabled ? "Bench this piece" : "Bring back into rotation"}
      </Button>

      <Button
        variant="ghost"
        className="w-full !text-ink-faint hover:!text-ink"
        disabled={busy || shooting}
        onClick={() => patch({ deleted: true })}
      >
        Remove from wardrobe
      </Button>
      <p className="text-center text-[11px] leading-relaxed text-ink-faint">
        Removing hides the piece from your catalogue and fits. The photo and its
        history are kept — nothing is ever deleted.
      </p>

      {error && (
        <p className="rounded-lg bg-blush/15 px-3 py-2 text-[12px] text-camel-deep">
          {error}
        </p>
      )}
    </div>
  );
}
