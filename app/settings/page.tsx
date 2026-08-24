import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { PageTitle } from "@/components/ui";
import SettingsForm from "@/components/settings/settings-form";
import CreditsCard from "@/components/settings/credits-card";
import { getCreditStatus } from "@/lib/credits";

export const dynamic = "force-dynamic";

const ADMIN_EMAILS = ["k4rthikr@gmail.com"];

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [settings, credits] = await Promise.all([
    getOrCreateSettings(supabase, user.id),
    getCreditStatus(supabase, user),
  ]);
  const isAdmin = !!user.email && ADMIN_EMAILS.includes(user.email);

  return (
    <div className="fade-up mx-auto max-w-2xl">
      <PageTitle eyebrow="Settings" title="Tune your" accent="stylist" />
      <CreditsCard status={credits} />
      <SettingsForm settings={settings} />
      {isAdmin && (
        <Link
          href="/admin"
          className="mt-8 flex items-center justify-between rounded-2xl border hairline bg-paper px-6 py-4 transition-colors hover:bg-ivory"
        >
          <span>
            <span className="eyebrow !mb-0 block">Admin console</span>
            <span className="text-[13px] text-ink-faint">
              Users, engine, invites, usage
            </span>
          </span>
          <span className="text-ink-faint">→</span>
        </Link>
      )}
    </div>
  );
}
