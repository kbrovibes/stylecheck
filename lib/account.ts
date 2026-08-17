import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Profile, Settings } from "@/lib/types";

/** Lazy-create profile + settings on first use (shared auth pool — no signup trigger). */
export async function getOrCreateProfile(
  supabase: SupabaseClient,
  user: User
): Promise<Profile> {
  const { data } = await supabase
    .from("sc_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (data) return data as Profile;
  const { data: created, error } = await supabase
    .from("sc_profiles")
    .upsert({
      id: user.id,
      email: user.email,
      display_name:
        (user.user_metadata?.full_name as string | undefined) ??
        user.email?.split("@")[0] ??
        null,
    })
    .select()
    .single();
  if (error) throw error;
  return created as Profile;
}

export async function getOrCreateSettings(
  supabase: SupabaseClient,
  userId: string
): Promise<Settings> {
  const { data } = await supabase
    .from("sc_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as Settings;
  const { data: created, error } = await supabase
    .from("sc_settings")
    .upsert({ user_id: userId })
    .select()
    .single();
  if (error) throw error;
  return created as Settings;
}
