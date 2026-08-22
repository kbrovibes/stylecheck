import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateSettings } from "@/lib/account";
import { Card, PageTitle } from "@/components/ui";
import AdminPanel, { type AdminStats } from "@/components/settings/admin-panel";
import AllowlistCard from "@/components/settings/allowlist-card";
import EngineCard from "@/components/admin/engine-card";

export const dynamic = "force-dynamic";

const ADMIN_EMAILS = ["k4rthikr@gmail.com"];

interface AdminUser {
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  people: number;
  items: number;
  photos: number;
  renders: number;
  image_calls_total: number;
  image_calls_today: number;
}

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !ADMIN_EMAILS.includes(user.email)) redirect("/");

  const [settings, { data: statsData }, { data: usersData }] = await Promise.all([
    getOrCreateSettings(supabase, user.id),
    supabase.rpc("sc_admin_stats"),
    supabase.rpc("sc_admin_users"),
  ]);
  const stats = statsData as AdminStats | null;
  const users = (usersData ?? []) as AdminUser[];

  return (
    <div className="fade-up mx-auto max-w-3xl space-y-6">
      <PageTitle eyebrow="Admin console" title="Behind the" accent="curtain" />

      {/* Users */}
      <Card>
        <p className="eyebrow mb-4">Users · {users.length}</p>
        <div className="no-scrollbar overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead>
              <tr className="border-b hairline text-[10px] uppercase tracking-widest text-ink-faint">
                <th className="pb-2 pr-3 font-medium">Email</th>
                <th className="pb-2 pr-3 font-medium">Last seen</th>
                <th className="pb-2 pr-3 text-right font-medium">People</th>
                <th className="pb-2 pr-3 text-right font-medium">Uploads</th>
                <th className="pb-2 pr-3 text-right font-medium">Renders</th>
                <th className="pb-2 text-right font-medium">Img today / total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {users.map((u) => (
                <tr key={u.email}>
                  <td className="max-w-[200px] truncate py-2 pr-3">{u.email}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-ink-faint">
                    {u.last_sign_in_at
                      ? new Date(u.last_sign_in_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right">{u.people}</td>
                  <td className="py-2 pr-3 text-right">{u.items + u.photos}</td>
                  <td className="py-2 pr-3 text-right">{u.renders}</td>
                  <td className="py-2 text-right">
                    <span className={u.image_calls_today > 40 ? "font-semibold text-camel-deep" : ""}>
                      {u.image_calls_today}
                    </span>
                    <span className="text-ink-faint"> / {u.image_calls_total}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <EngineCard settings={settings} openaiConfigured={!!process.env.OPENAI_API_KEY} />
      {stats && <AdminPanel stats={stats} />}
      <AllowlistCard />
    </div>
  );
}
