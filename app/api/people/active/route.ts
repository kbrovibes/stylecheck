import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { ACTIVE_PERSON_COOKIE, listPeople } from "@/lib/person";

/** Switch the active person (validated against visibility). */
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;
  const { id } = await request.json().catch(() => ({}));
  const people = await listPeople(supabase, user);
  if (!id || !people.some((p) => p.person.id === id)) {
    return NextResponse.json({ error: "unknown person" }, { status: 404 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACTIVE_PERSON_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return res;
}
