"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import type { Settings } from "@/lib/types";

const MODELS = [
  { id: "gemini-3-pro-image-preview", label: "Gemini 3 Pro" },
  { id: "gemini-2.5-flash-image", label: "Gemini Flash" },
  { id: "gpt-image-1", label: "GPT Image" },
];

/** Admin: model options for renders OF PEOPLE (mannequin + fits). Wardrobe stays Gemini. */
export default function PersonImageCard({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [model, setModel] = useState(settings.person_image_model);
  const [altAsync, setAltAsync] = useState(settings.alt_render_async);
  const [badge, setBadge] = useState(settings.show_model_badge);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person_image_model: model,
        alt_render_async: altAsync,
        show_model_badge: badge,
      }),
    });
    setSaving(false);
    setMsg(res.ok ? "Saved" : "Save failed");
    if (res.ok) router.refresh();
  }

  return (
    <Card className="mt-8">
      <p className="eyebrow mb-1">Image generation · people</p>
      <p className="mb-4 text-[13px] leading-relaxed text-ink-soft">
        Model used for renders of <span className="serif-accent">people</span> — mannequins
        and fits. Wardrobe product shots and closet scenes always use Gemini.
      </p>
      <div className="flex gap-1 rounded-full border hairline bg-ivory p-1">
        {MODELS.map((m) => (
          <button
            key={m.id}
            onClick={() => setModel(m.id)}
            className={`flex-1 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
              model === m.id ? "bg-ink text-ivory" : "text-ink-soft hover:text-ink"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        <label className="flex items-center justify-between gap-4">
          <span className="text-[13px] text-ink-soft">
            Also render with the alternate model (async, history-only — for comparison)
          </span>
          <button
            role="switch"
            aria-checked={altAsync}
            onClick={() => setAltAsync(!altAsync)}
            className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${altAsync ? "bg-camel" : "bg-hairline"}`}
          >
            <span className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-paper shadow-sm transition-all ${altAsync ? "left-[18px]" : "left-[2px]"}`} />
          </button>
        </label>
        <label className="flex items-center justify-between gap-4">
          <span className="text-[13px] text-ink-soft">Show model badge on render history</span>
          <button
            role="switch"
            aria-checked={badge}
            onClick={() => setBadge(!badge)}
            className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${badge ? "bg-camel" : "bg-hairline"}`}
          >
            <span className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-paper shadow-sm transition-all ${badge ? "left-[18px]" : "left-[2px]"}`} />
          </button>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {msg && <span className={`text-[13px] ${msg === "Saved" ? "text-moss" : "text-camel-deep"}`}>{msg}</span>}
      </div>
    </Card>
  );
}
