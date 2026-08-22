"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import type { Settings } from "@/lib/types";

const TEXT_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-pro-preview"];
const IMAGE_MODELS = ["gemini-3-pro-image-preview", "gemini-2.5-flash-image"];
const PERSON_MODELS = [
  { id: "gemini-3-pro-image-preview", label: "Gemini 3 Pro (default)" },
  { id: "gemini-2.5-flash-image", label: "Gemini Flash" },
  { id: "gpt-image-1", label: "OpenAI GPT Image" },
];

const selectCls =
  "w-full rounded-xl border hairline bg-ivory px-3 py-2 text-[13px] outline-none focus:border-camel/60 focus:bg-paper";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[130px_1fr] items-center gap-3">
      <span className="text-[12px] font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

function Switch({ on, toggle }: { on: boolean; toggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={toggle}
      className={`relative h-[22px] w-[38px] shrink-0 justify-self-start rounded-full transition-colors ${on ? "bg-camel" : "bg-hairline"}`}
    >
      <span className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-paper shadow-sm transition-all ${on ? "left-[18px]" : "left-[2px]"}`} />
    </button>
  );
}

/** Admin: model engine controls. Person renders use the person model; wardrobe stays Gemini. */
export default function EngineCard({
  settings,
  openaiConfigured,
}: {
  settings: Settings;
  openaiConfigured: boolean;
}) {
  const router = useRouter();
  const [s, setS] = useState({
    text_model: settings.text_model,
    image_model: settings.image_model,
    person_image_model: settings.person_image_model,
    alt_render_async: settings.alt_render_async,
    show_model_badge: settings.show_model_badge,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    setSaving(false);
    setMsg(res.ok ? "Saved" : "Save failed");
    if (res.ok) router.refresh();
  }

  return (
    <Card>
      <p className="eyebrow mb-1">Engine</p>
      <p className="mb-4 text-[12px] leading-relaxed text-ink-faint">
        People (mannequins, fits) render with the person model. Wardrobe product
        shots and closet scenes always use Gemini.{" "}
        OpenAI key: {openaiConfigured ? "configured ✓" : "NOT configured — GPT Image will fail"}
      </p>
      <div className="space-y-3">
        <Row label="Person renders">
          <select
            className={selectCls}
            value={s.person_image_model}
            onChange={(e) => setS((v) => ({ ...v, person_image_model: e.target.value }))}
          >
            {PERSON_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </Row>
        <Row label="Text & vision">
          <select
            className={selectCls}
            value={s.text_model}
            onChange={(e) => setS((v) => ({ ...v, text_model: e.target.value }))}
          >
            {TEXT_MODELS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Row>
        <Row label="Wardrobe images">
          <select
            className={selectCls}
            value={s.image_model}
            onChange={(e) => setS((v) => ({ ...v, image_model: e.target.value }))}
          >
            {IMAGE_MODELS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Row>
        <Row label="Alt-model compare">
          <Switch on={s.alt_render_async} toggle={() => setS((v) => ({ ...v, alt_render_async: !v.alt_render_async }))} />
        </Row>
        <Row label="Model badges">
          <Switch on={s.show_model_badge} toggle={() => setS((v) => ({ ...v, show_model_badge: !v.show_model_badge }))} />
        </Row>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        {msg && <span className={`text-[13px] ${msg === "Saved" ? "text-moss" : "text-camel-deep"}`}>{msg}</span>}
      </div>
    </Card>
  );
}
