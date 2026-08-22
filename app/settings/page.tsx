import { createClient } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { PageTitle } from "@/components/ui";
import SettingsForm from "@/components/settings/settings-form";
import AdminPanel, { type AdminStats } from "@/components/settings/admin-panel";
import AllowlistCard from "@/components/settings/allowlist-card";
import PersonImageCard from "@/components/settings/person-image-card";

export const dynamic = "force-dynamic";

const ADMIN_EMAILS = ["k4rthikr@gmail.com"];

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const settings = await getOrCreateSettings(supabase, user.id);
  const openaiConfigured = !!process.env.OPENAI_API_KEY;

  let adminStats: AdminStats | null = null;
  if (user.email && ADMIN_EMAILS.includes(user.email)) {
    const { data } = await supabase.rpc("sc_admin_stats");
    adminStats = (data as AdminStats) ?? null;
  }

  return (
    <div className="fade-up mx-auto max-w-2xl">
      <PageTitle eyebrow="Settings" title="Tune your" accent="stylist" />
      <SettingsForm settings={settings} openaiConfigured={openaiConfigured} />
      {adminStats && <PersonImageCard settings={settings} />}
      {adminStats && <AdminPanel stats={adminStats} />}
      {adminStats && <AllowlistCard />}
    </div>
  );
}
