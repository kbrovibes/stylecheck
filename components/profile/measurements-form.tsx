"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import type { Person } from "@/lib/types";

function toFtIn(cm: number | null) {
  if (!cm) return "";
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round(totalIn % 12);
  return `${ft}′${inch}″`;
}

function toLb(kg: number | null) {
  if (!kg) return "";
  return `${Math.round(kg * 2.20462)} lb`;
}

export default function MeasurementsForm({
  person,
  readOnly = false,
}: {
  person: Person;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(person.name ?? "");
  const [age, setAge] = useState(
    person.birth_year ? String(new Date().getFullYear() - person.birth_year) : ""
  );
  const [heightCm, setHeightCm] = useState(person.height_cm?.toString() ?? "");
  const [weightKg, setWeightKg] = useState(person.weight_kg?.toString() ?? "");
  const [zip, setZip] = useState(person.zip_code ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; warn: boolean } | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: displayName,
        age: age ? Number(age) : null,
        height_cm: heightCm ? Number(heightCm) : null,
        weight_kg: weightKg ? Number(weightKg) : null,
        zip_code: zip,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMsg({ text: json.error ?? "Save failed", warn: true });
      return;
    }
    setMsg(
      json.warning
        ? { text: json.warning, warn: true }
        : { text: "Saved", warn: false }
    );
    router.refresh();
  }

  const inputCls =
    "w-full rounded-xl border hairline bg-ivory px-4 py-2.5 text-[14px] outline-none transition-colors focus:border-camel/60 focus:bg-paper disabled:opacity-60";

  return (
    <div className="space-y-5">
      <div>
        <label className="eyebrow mb-1.5 block">Name</label>
        <input
          className={inputCls}
          value={displayName}
          disabled={readOnly}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="How should we address you?"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="eyebrow mb-1.5 block">
            Age{" "}
            {age && (
              <span className="normal-case tracking-normal text-camel">
                styles for your life stage
              </span>
            )}
          </label>
          <input
            className={inputCls}
            type="number"
            inputMode="numeric"
            value={age}
          disabled={readOnly}
            onChange={(e) => setAge(e.target.value)}
            placeholder="36"
          />
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">
            Height · cm{" "}
            {heightCm && (
              <span className="normal-case tracking-normal text-camel">
                {toFtIn(Number(heightCm))}
              </span>
            )}
          </label>
          <input
            className={inputCls}
            type="number"
            inputMode="numeric"
            value={heightCm}
          disabled={readOnly}
            onChange={(e) => setHeightCm(e.target.value)}
            placeholder="175"
          />
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">
            Weight · kg{" "}
            {weightKg && (
              <span className="normal-case tracking-normal text-camel">
                {toLb(Number(weightKg))}
              </span>
            )}
          </label>
          <input
            className={inputCls}
            type="number"
            inputMode="decimal"
            value={weightKg}
          disabled={readOnly}
            onChange={(e) => setWeightKg(e.target.value)}
            placeholder="72"
          />
        </div>
      </div>
      <div>
        <label className="eyebrow mb-1.5 block">ZIP code · for weather</label>
        <input
          className={inputCls}
          value={zip}
          disabled={readOnly}
          onChange={(e) => setZip(e.target.value)}
          placeholder="94105"
        />
      </div>
      <p className="text-[12px] leading-relaxed text-ink-faint">
        Height and weight shape every render — we aim for an honest silhouette
        that looks like <span className="serif-accent">you</span>, not a
        mannequin.
      </p>
      <div className="flex items-center gap-3">
        {readOnly ? (
          <p className="text-[12px] text-ink-faint">View-only access.</p>
        ) : (
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save profile"}
        </Button>
        )}
        {msg && (
          <span
            className={`text-[13px] ${msg.warn ? "text-camel-deep" : "text-moss"}`}
          >
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
