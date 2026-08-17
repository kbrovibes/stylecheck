"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface SwitcherPerson {
  id: string;
  name: string;
  role: "owner" | "manager" | "viewer";
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
  const boxRef = useRef<HTMLDivElement>(null);

  const active = people.find((p) => p.id === activeId) ?? people[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

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
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setNewName("");
    setAdding(false);
    if (res.ok && json.person?.id) await switchTo(json.person.id);
  }

  if (!active) return null;

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full border hairline bg-paper py-1 pl-1 pr-2.5 transition-colors hover:bg-ivory"
        aria-label="Switch profile"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink font-serif text-[12px] italic text-camel">
          {active.name.charAt(0).toUpperCase()}
        </span>
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
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink font-serif text-[13px] italic text-camel">
                {p.name.charAt(0).toUpperCase()}
              </span>
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
