"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface SwitcherPerson {
  id: string;
  name: string;
  role: "owner" | "manager" | "viewer";
  img: string | null; // mannequin render, face-cropped in the bubble
}

function Avatar({
  person,
  size = "h-7 w-7",
  text = "text-[13px]",
}: {
  person: SwitcherPerson;
  size?: string;
  text?: string;
}) {
  return person.img ? (
    // A generated face close-up (see lib/avatar.ts) — plain cover fill.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={person.img}
      alt={person.name}
      className={`${size} shrink-0 rounded-full object-cover`}
    />
  ) : (
    <span
      className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-ink font-serif ${text} italic text-camel`}
    >
      {person.name.charAt(0).toUpperCase()}
    </span>
  );
}

export default function PersonSwitcher({
  people,
  activeId,
}: {
  people: SwitcherPerson[];
  activeId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const active = people.find((p) => p.id === activeId) ?? people[0];
  const bubbles = people.length <= 3;

  useEffect(() => {
    if (!open && !adding) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
        setError(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, adding]);

  async function switchTo(id: string) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    await fetch("/api/people/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  async function createPerson() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && json.person?.id) {
      setNewName("");
      setAdding(false);
      await switchTo(json.person.id);
    } else {
      setError(json.error ?? `Could not create profile (${res.status})`);
    }
  }

  if (!active) return null;

  // ≤3 people: face bubbles inline — one tap to switch.
  if (bubbles) {
    return (
      <div ref={boxRef} className="relative flex items-center">
        <div className="flex items-center gap-1.5">
          {people.map((p) => (
            <button
              key={p.id}
              onClick={() => switchTo(p.id)}
              disabled={busy}
              title={`${p.name}${p.role !== "owner" ? ` (shared · ${p.role})` : ""}`}
              aria-label={`Switch to ${p.name}`}
              className={`rounded-full transition-all ${
                p.id === activeId
                  ? "ring-2 ring-camel ring-offset-1 ring-offset-ivory"
                  : "opacity-65 hover:opacity-100"
              }`}
            >
              <Avatar person={p} size="h-7 w-7 sm:h-8 sm:w-8" text="text-[12px]" />
            </button>
          ))}
          <button
            onClick={() => setAdding((a) => !a)}
            title="New profile"
            aria-label="New profile"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed hairline text-[14px] text-ink-faint transition-colors hover:border-camel hover:text-camel sm:h-8 sm:w-8"
          >
            +
          </button>
        </div>

        {adding && (
          <div className="sheet-up absolute left-0 top-full z-50 mt-2 w-60 rounded-2xl border hairline bg-paper p-2 shadow-xl shadow-ink/10">
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createPerson()}
                placeholder="Name — e.g. Asha"
                className="w-full rounded-lg border hairline bg-ivory px-2.5 py-1.5 text-[13px] outline-none focus:border-camel"
              />
              <button
                onClick={createPerson}
                disabled={busy || !newName.trim()}
                className="rounded-lg bg-ink px-2.5 py-1.5 text-[12px] text-ivory disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {error && (
              <p className="px-1 pt-1.5 text-[11px] text-camel-deep">{error}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // 4+ people: dropdown.
  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full border hairline bg-paper py-1 pl-1 pr-2.5 transition-colors hover:bg-ivory"
        aria-label="Switch profile"
      >
        <Avatar person={active} size="h-6 w-6" text="text-[12px]" />
        <span className="max-w-[80px] truncate text-[12px] font-medium sm:max-w-[120px]">
          {active.name}
        </span>
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-ink-faint" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2.5 4.5L6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="sheet-up absolute left-0 top-full z-50 mt-2 w-60 rounded-2xl border hairline bg-paper p-1.5 shadow-xl shadow-ink/10">
          {people.map((p) => (
            <button
              key={p.id}
              onClick={() => switchTo(p.id)}
              disabled={busy}
              className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                p.id === activeId ? "bg-ivory" : "hover:bg-ivory"
              }`}
            >
              <Avatar person={p} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{p.name}</span>
                {p.role !== "owner" && (
                  <span className="block text-[10px] uppercase tracking-widest text-ink-faint">
                    shared · {p.role}
                  </span>
                )}
              </span>
              {p.id === activeId && <span className="text-[12px] text-moss">✓</span>}
            </button>
          ))}

          {error && <p className="px-2.5 py-1 text-[11px] text-camel-deep">{error}</p>}
          <div className="mt-1 border-t hairline pt-1.5">
            {adding ? (
              <div className="flex items-center gap-1.5 px-1.5 pb-1">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createPerson()}
                  placeholder="Name — e.g. Asha"
                  className="w-full rounded-lg border hairline bg-ivory px-2.5 py-1.5 text-[13px] outline-none focus:border-camel"
                />
                <button
                  onClick={createPerson}
                  disabled={busy || !newName.trim()}
                  className="rounded-lg bg-ink px-2.5 py-1.5 text-[12px] text-ivory disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] text-ink-soft transition-colors hover:bg-ivory hover:text-ink"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed hairline text-[15px] text-ink-faint">
                  +
                </span>
                New profile
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
