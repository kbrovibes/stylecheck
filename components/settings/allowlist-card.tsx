"use client";

import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";

interface Entry {
  email: string;
  added_by: string | null;
  created_at: string;
}

/** Admin-only: who is allowed to sign in (invite gate). */
export default function AllowlistCard() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/allowlist");
    if (res.ok) setEntries((await res.json()).entries);
  }
  useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/allowlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Failed");
      return;
    }
    setEmail("");
    load();
  }

  async function remove(e: string) {
    setBusy(true);
    await fetch(`/api/admin/allowlist?email=${encodeURIComponent(e)}`, {
      method: "DELETE",
    });
    setBusy(false);
    load();
  }

  return (
    <Card className="mt-8">
      <p className="eyebrow mb-1">Invites</p>
      <p className="mb-4 text-[13px] leading-relaxed text-ink-soft">
        Hanger Management is invite-only — only these emails can sign in.
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="friend@example.com"
          className="w-full rounded-xl border hairline bg-ivory px-4 py-2.5 text-[14px] outline-none focus:border-camel/60 focus:bg-paper"
        />
        <Button onClick={add} disabled={busy || !email.trim()}>
          Invite
        </Button>
      </div>
      {error && <p className="mt-2 text-[12px] text-camel-deep">{error}</p>}
      <div className="mt-4 space-y-1.5">
        {entries === null ? (
          <div className="h-8 shimmer rounded-lg" />
        ) : (
          entries.map((e) => (
            <div
              key={e.email}
              className="flex items-center justify-between rounded-xl border hairline bg-ivory/60 px-3.5 py-2"
            >
              <span className="text-[13px]">{e.email}</span>
              <button
                onClick={() => remove(e.email)}
                disabled={busy}
                className="text-[12px] text-ink-faint transition-colors hover:text-camel-deep"
              >
                remove
              </button>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
