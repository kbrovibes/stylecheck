"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card } from "@/components/ui";
import type { Settings } from "@/lib/types";


function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-ink" : "bg-hairline"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-paper shadow-sm transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  badge,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div>
        <p className={`text-[14px] font-medium ${disabled ? "text-ink-faint" : ""}`}>
          {label}
          {badge && (
            <span className="ml-2 align-middle">
              <Badge tone="camel">{badge}</Badge>
            </span>
          )}
        </p>
        <p className="mt-0.5 text-[12px] text-ink-faint">{hint}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export default function SettingsForm({
  settings,
  }: {
  settings: Settings;
  }) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
  }


  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generate_accessories: s.generate_accessories,
        generate_shoes: s.generate_shoes,
        generate_belts: s.generate_belts,
        auto_render: s.auto_render,
        goofy_mode: s.goofy_mode,
      }),
    });
    const json = await res.json();
    setSaving(false);
    setMsg(res.ok ? "Saved" : (json.error ?? "Save failed"));
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <p className="eyebrow mb-2">Pieces to style into fits</p>
        <div className="divide-y divide-hairline">
          <ToggleRow
            label="Accessories"
            hint="Watches, jewelry, scarves — styled in when they elevate the look"
            checked={s.generate_accessories}
            onChange={(v) => set("generate_accessories", v)}
          />
          <ToggleRow
            label="Shoes"
            hint="Include footwear in outfit composition and renders"
            checked={s.generate_shoes}
            onChange={(v) => set("generate_shoes", v)}
          />
          <ToggleRow
            label="Belts"
            hint="Optional finishing piece"
            checked={s.generate_belts}
            onChange={(v) => set("generate_belts", v)}
          />
          <ToggleRow
            label="Glasses"
            hint="Your renders keep whatever eyewear appears in your photos"
            checked={false}
            disabled
            badge="Coming soon"
          />
        </div>
      </Card>

      <Card>
        <p className="eyebrow mb-2">Generation</p>
        <ToggleRow
          label="Auto-render new fits"
          hint="Render every generated fit immediately (uses more image-model credits)"
          checked={s.auto_render}
          onChange={(v) => set("auto_render", v)}
        />
        <ToggleRow
          label="Goofy mode"
          hint="Fits show you doing something ridiculous — same outfit, same you, zero dignity. Generated on demand per fit."
          checked={s.goofy_mode}
          onChange={(v) => set("goofy_mode", v)}
        />
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
        {msg && (
          <span
            className={`text-[13px] ${msg === "Saved" ? "text-moss" : "text-camel-deep"}`}
          >
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}
