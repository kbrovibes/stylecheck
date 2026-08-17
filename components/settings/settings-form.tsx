"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card } from "@/components/ui";
import type { Provider, Settings } from "@/lib/types";

const MODEL_OPTIONS: Record<
  Provider,
  { text: string[]; image: string[] }
> = {
  gemini: {
    text: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-pro-preview"],
    image: ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"],
  },
  openai: {
    text: ["gpt-4o", "gpt-5"],
    image: ["gpt-image-1"],
  },
};

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
  openaiConfigured,
}: {
  settings: Settings;
  openaiConfigured: boolean;
}) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  function switchProvider(p: Provider) {
    setS((prev) => ({
      ...prev,
      provider: p,
      text_model: MODEL_OPTIONS[p].text[0],
      image_model: MODEL_OPTIONS[p].image[0],
    }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: s.provider,
        text_model: s.text_model,
        image_model: s.image_model,
        generate_accessories: s.generate_accessories,
        generate_shoes: s.generate_shoes,
        generate_belts: s.generate_belts,
        auto_render: s.auto_render,
      }),
    });
    const json = await res.json();
    setSaving(false);
    setMsg(res.ok ? "Saved" : (json.error ?? "Save failed"));
    if (res.ok) router.refresh();
  }

  const selectCls =
    "w-full rounded-xl border hairline bg-ivory px-4 py-2.5 text-[14px] outline-none focus:border-camel/60 focus:bg-paper";

  return (
    <div className="space-y-6">
      <Card>
        <p className="eyebrow mb-4">Model provider</p>
        <div className="flex rounded-full border hairline bg-ivory p-1">
          {(["gemini", "openai"] as Provider[]).map((p) => (
            <button
              key={p}
              onClick={() => switchProvider(p)}
              className={`flex-1 rounded-full py-2 text-[13px] font-medium capitalize transition-all ${
                s.provider === p
                  ? "bg-ink text-ivory"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              {p === "gemini" ? "Gemini" : "OpenAI"}
            </button>
          ))}
        </div>
        {s.provider === "openai" && !openaiConfigured && (
          <p className="mt-3 text-[12px] leading-relaxed text-camel-deep">
            OPENAI_API_KEY isn&apos;t configured yet — generation will fail until
            it&apos;s added to the environment. Your Gemini setup keeps working if
            you switch back.
          </p>
        )}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="eyebrow mb-1.5 block">Text & vision model</label>
            <input
              className={selectCls}
              list="text-models"
              value={s.text_model}
              onChange={(e) => set("text_model", e.target.value)}
            />
            <datalist id="text-models">
              {MODEL_OPTIONS[s.provider].text.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">Image model</label>
            <input
              className={selectCls}
              list="image-models"
              value={s.image_model}
              onChange={(e) => set("image_model", e.target.value)}
            />
            <datalist id="image-models">
              {MODEL_OPTIONS[s.provider].image.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-ink-faint">
          Every render is stamped with the model that made it, so you can switch
          models and compare side by side — nothing is ever overwritten.
        </p>
      </Card>

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
