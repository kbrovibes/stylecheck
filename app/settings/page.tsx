import { createClient } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { PageTitle } from "@/components/ui";
import SettingsForm from "@/components/settings/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const settings = await getOrCreateSettings(supabase, user.id);
  const openaiConfigured = !!process.env.OPENAI_API_KEY;

  return (
    <div className="fade-up mx-auto max-w-2xl">
      <PageTitle eyebrow="Settings" title="Tune your" accent="stylist" />
      <SettingsForm settings={settings} openaiConfigured={openaiConfigured} />
    </div>
  );
}
