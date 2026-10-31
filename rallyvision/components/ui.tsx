"use client";

import type { ReactNode } from "react";
import { IconLock } from "@/components/Icons";

export function Segmented<T extends string | number>({ value, onChange, options, size = "md" }: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode; disabled?: boolean; title?: string }>;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" className={`inline-flex max-w-full flex-wrap rounded-full bg-subtle p-1 ${size === "sm" ? "text-xs" : "text-sm"}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3 font-medium transition ${size === "sm" ? "h-7" : "h-8"} ${o.value === value ? "bg-surface text-ink shadow-[var(--shadow-card)]" : "text-muted hover:text-ink"} disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition ${checked ? "bg-ink" : "bg-line-strong"} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-surface shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "danger" | "live" }) {
  const cls = {
    neutral: "bg-subtle text-ink-2",
    ok: "bg-ok/10 text-ok",
    warn: "bg-warn/10 text-warn",
    danger: "bg-danger/10 text-danger",
    live: "bg-near/10 text-near",
  }[tone];
  return <span className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium ${cls}`}>{children}</span>;
}

export function Unavailable({ reason }: { reason: string }) {
  return <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted"><IconLock size={11} /> {reason}</span>;
}
