import { Badge, Card } from "@/components/ui";

export interface AdminStats {
  users: number;
  items_active: number;
  items_total: number;
  photos: number;
  outfits_active: number;
  outfits_total: number;
  renders_total: number;
  renders_by_model: Record<string, number>;
  storage_bytes: number;
  storage_objects: number;
  storage_by_kind: Record<string, { bytes: number; objects: number }>;
}

function fmtBytes(b: number) {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} KB`;
  return `${b} B`;
}

export default function AdminPanel({ stats }: { stats: AdminStats }) {
  const kinds = Object.entries(stats.storage_by_kind ?? {}).sort(
    (a, b) => b[1].bytes - a[1].bytes
  );
  const models = Object.entries(stats.renders_by_model ?? {}).sort(
    (a, b) => b[1] - a[1]
  );
  // free-tier storage allowance shared across the whole kbro-db1 project
  const FREE_TIER_BYTES = 1e9;
  const pct = Math.min(100, (stats.storage_bytes / FREE_TIER_BYTES) * 100);

  return (
    <Card className="mt-8">
      <div className="mb-5 flex items-center justify-between">
        <p className="eyebrow">Admin</p>
        <Badge tone="ink">k4rthikr@gmail.com</Badge>
      </div>

      {/* Storage */}
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-ink-soft">
            Storage used <span className="text-ink-faint">(stylecheck bucket, all users)</span>
          </span>
          <span className="text-xl font-semibold">{fmtBytes(stats.storage_bytes)}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hairline">
          <div
            className={`h-full rounded-full ${pct > 80 ? "bg-camel-deep" : "bg-camel"}`}
            style={{ width: `${Math.max(1, pct)}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-ink-faint">
          {stats.storage_objects} objects · {pct.toFixed(1)}% of the 1 GB free-tier
          pool (shared across all apps on kbro-db1)
        </p>
        {kinds.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {kinds.map(([kind, v]) => (
              <span
                key={kind}
                className="rounded-full border hairline bg-ivory px-3 py-1 text-[11px] text-ink-soft"
              >
                {kind}: {fmtBytes(v.bytes)} ({v.objects})
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Counts */}
      <div className="mt-6 grid grid-cols-2 gap-4 border-t hairline pt-5 sm:grid-cols-4">
        {[
          { label: "Users", value: stats.users },
          { label: "Items", value: `${stats.items_active}/${stats.items_total}` },
          { label: "Outfits", value: `${stats.outfits_active}/${stats.outfits_total}` },
          { label: "Renders", value: stats.renders_total },
        ].map((s) => (
          <div key={s.label}>
            <p className="text-[11px] uppercase tracking-widest text-ink-faint">
              {s.label}
            </p>
            <p className="mt-0.5 text-xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Renders by model */}
      {models.length > 0 && (
        <div className="mt-6 border-t hairline pt-5">
          <p className="mb-2 text-[11px] uppercase tracking-widest text-ink-faint">
            Renders by model
          </p>
          <div className="flex flex-wrap gap-2">
            {models.map(([model, n]) => (
              <span
                key={model}
                className="rounded-full border hairline bg-ivory px-3 py-1 text-[11px] text-ink-soft"
              >
                {model} · {n}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
