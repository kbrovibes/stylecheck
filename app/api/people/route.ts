import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { listPeople } from "@/lib/person";

/** People visible to this account (own + shared-in), with the caller's role. */
export async function GET() {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;
  const people = await listPeople(supabase, user);
  return NextResponse.json({
    people: people.map((p) => ({ ...p.person, role: p.role })),
  });
}

/** Create a new profile (person) inside this account. */
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) {
    return NextResponse.json({ error: "A name is required" }, { status: 400 });
  }
  const relationship =
    typeof body.relationship === "string"
      ? body.relationship.trim().slice(0, 60) || null
      : null;

  const { data, error } = await supabase
    .from("sc_people")
    .insert({ owner_id: user.id, name, relationship })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ person: data });
}
