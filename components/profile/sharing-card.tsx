"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import type { PersonShare } from "@/lib/types";

export default function SharingCard({
  personId,
  personName,
}: {
  personId: string;
  personName: string;
}) {
  const [shares, setShares] = useState<PersonShare[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "manager">("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/people/${personId}/shares`).catch(() => null);
    if (res?.ok) {
      const json = await res.json();
      setShares(json.shares ?? []);
    } else {
      setShares([]);
    }
  }, [personId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/people/${personId}/shares`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), role }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Could not share");
      return;
    }
    setEmail("");
    setRole("viewer");
    await load();
  }

  async function remove(shareId: string) {
    setBusy(true);
    setError(null);
    await fetch(`/api/people/${personId}/shares?id=${shareId}`, {
      method: "DELETE",
    }).catch(() => null);
    setBusy(false);
    await load();
  }

  return (
    <Card>
      <p className="eyebrow mb-2">Sharing</p>
      <p className="text-[13px] leading-relaxed text-ink-soft">
        Give someone access to{" "}
        <span className="serif-accent text-camel-deep">{personName}</span>&apos;s
        wardrobe — viewers browse, managers can upload, edit, and render.
      </p>

      {/* Existing shares */}
      <div className="mt-4 space-y-2">
        {shares === null ? (
          <div className="h-9 rounded-xl shimmer" />
        ) : shares.length === 0 ? (
          <p className="text-[12px] text-ink-faint">
            Not shared with anyone yet.
          </p>
        ) : (
          shares.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-xl border hairline bg-ivory/60 px-3.5 py-2"
            >
              <span className="min-w-0 truncate text-[13px]">{s.grantee_email}</span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={s.role === "manager" ? "camel" : "neutral"}>
                  {s.role}
                </Badge>
                <button
                  onClick={() => remove(s.id)}
                  disabled={busy}
                  aria-label={`Remove access for ${s.grantee_email}`}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[14px] leading-none text-ink-faint transition-colors hover:bg-hairline/60 hover:text-ink"
                >
                  ×
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {/* Add */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="their@email.com"
          className="min-w-0 flex-1 rounded-xl border hairline bg-paper px-3.5 py-2 text-[13px] outline-none placeholder:text-ink-faint/60 focus:border-camel"
        />
        <span className="flex gap-1 rounded-full border hairline bg-paper p-1 text-[12px]">
          {(["viewer", "manager"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={`rounded-full px-3 py-1 capitalize transition-colors ${
                role === r ? "bg-ink text-ivory" : "text-ink-soft hover:text-ink"
              }`}
            >
              {r}
            </button>
          ))}
        </span>
        <Button onClick={add} disabled={busy || !email.trim()} className="!px-4 !py-2">
          {busy ? "…" : "Share"}
        </Button>
      </div>
      {error && <p className="mt-2 text-[12px] text-camel-deep">{error}</p>}
      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        They&apos;ll see this profile in their account switcher when they sign in
        with that email.
      </p>
    </Card>
  );
}
