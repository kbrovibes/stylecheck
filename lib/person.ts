import { cookies } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Person, PersonRole, PersonShare } from "@/lib/types";

export const ACTIVE_PERSON_COOKIE = "sc_person";

export interface PersonWithRole {
  person: Person;
  role: PersonRole;
}

/** All people visible to this account (own + shared-in), with the caller's role. */
export async function listPeople(
  supabase: SupabaseClient,
  user: User
): Promise<PersonWithRole[]> {
  const [{ data: peopleData }, { data: sharesData }] = await Promise.all([
    supabase
      .from("sc_people")
      .select("*")
      .eq("deleted", false)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("sc_person_shares")
      .select("*")
      .or(
        `grantee_user_id.eq.${user.id},grantee_email.ilike.${(user.email ?? "").replaceAll(",", "")}`
      ),
  ]);
  const shares = (sharesData ?? []) as PersonShare[];
  return ((peopleData ?? []) as Person[]).map((person) => ({
    person,
    role:
      person.owner_id === user.id
        ? ("owner" as const)
        : shares.find((s) => s.person_id === person.id)?.role === "manager"
          ? ("manager" as const)
          : ("viewer" as const),
  }));
}

/** Lazy-create the account's default person (first login / legacy accounts). */
async function ensureDefaultPerson(
  supabase: SupabaseClient,
  user: User
): Promise<Person> {
  const { data, error } = await supabase
    .from("sc_people")
    .insert({
      owner_id: user.id,
      name:
        (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ??
        user.email?.split("@")[0] ??
        "Me",
      is_default: true,
    })
    .select()
    .single();
  if (error) {
    // Unique partial index guards against concurrent lazy-creates (layout +
    // page render race) — on conflict, the winner's row is ours.
    const { data: existing } = await supabase
      .from("sc_people")
      .select("*")
      .eq("owner_id", user.id)
      .eq("is_default", true)
      .eq("deleted", false)
      .maybeSingle();
    if (existing) return existing as Person;
    throw error;
  }
  return data as Person;
}

/**
 * The active person for this request: the sc_person cookie if it points at a
 * person the caller can see, else their own default person (created if needed).
 */
export async function getActivePerson(
  supabase: SupabaseClient,
  user: User
): Promise<PersonWithRole> {
  const people = await listPeople(supabase, user);
  const cookieStore = await cookies();
  const wanted = cookieStore.get(ACTIVE_PERSON_COOKIE)?.value;
  const hit = wanted ? people.find((p) => p.person.id === wanted) : undefined;
  if (hit) return hit;
  const own =
    people.find((p) => p.role === "owner" && p.person.is_default) ??
    people.find((p) => p.role === "owner");
  if (own) return own;
  return { person: await ensureDefaultPerson(supabase, user), role: "owner" };
}

export function canManage(role: PersonRole) {
  return role === "owner" || role === "manager";
}
