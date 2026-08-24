import { Card } from "@/components/ui";
import type { CreditStatus } from "@/lib/credits";

function Meter({
  label,
  hint,
  used,
  limit,
}: {
  label: string;
  hint: string;
  used: number;
  limit: number;
}) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const spent = used >= limit;
  const low = !spent && used / limit >= 0.8;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium">{label}</span>
        <span
          className={`text-[13px] tabular-nums ${
            spent ? "text-blush" : low ? "text-camel-deep" : "text-ink-faint"
          }`}
        >
          {Math.min(used, limit)} / {limit}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ivory">
        <div
          className={`h-full rounded-full transition-all ${
            spent ? "bg-blush" : "bg-camel"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-[12px] text-ink-faint">
        {spent ? "Used up — refills at midnight PT." : hint}
      </p>
    </div>
  );
}

export default function CreditsCard({ status }: { status: CreditStatus }) {
  if (status.unlimited) {
    return (
      <Card className="mb-8">
        <p className="eyebrow mb-1">Daily allowance</p>
        <p className="text-[14px] text-ink-soft">
          Unlimited — this account isn&rsquo;t metered.
        </p>
      </Card>
    );
  }
  return (
    <Card className="mb-8 space-y-5">
      <div>
        <p className="eyebrow !mb-1">Daily allowance</p>
        <p className="text-[12px] text-ink-faint">
          Resets at midnight Pacific.
        </p>
      </div>
      <Meter
        label="Image generations"
        hint="Renders, product shots and wardrobe scenes."
        used={status.imageUsed}
        limit={status.imageLimit}
      />
      <Meter
        label="Styling calls"
        hint="Composing fits, classifying uploads."
        used={status.textUsed}
        limit={status.textLimit}
      />
    </Card>
  );
}
