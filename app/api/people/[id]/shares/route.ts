import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import type { Person } from "@/lib/types";
import type { SupabaseClient, User } from "@supabase/supabase-js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireOwnedPerson(
  supabase: SupabaseClient,
  user: User,
  id: string
): Promise<Person | NextResponse> {
  const { data } = await supabase
    .from("sc_people")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const person = data as Person | null;
  if (!person) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (person.owner_id !== user.id) {
    return NextResponse.json(
      { error: "Only the owner can manage sharing" },
      { status: 403 }
    );
  }
  return person;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;
  const { id } = await params;

  const person = await requireOwnedPerson(supabase, user, id);
  if (person instanceof NextResponse) return person;

  const { data } = await supabase
    .from("sc_person_shares")
    .select("*")
    .eq("person_id", id)
    .order("created_at", { ascending: true });
  return NextResponse.json({ shares: data ?? [] });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;
  const { id } = await params;

  const person = await requireOwnedPerson(supabase, user, id);
  if (person instanceof NextResponse) return person;

  const body = await request.json().catch(() => ({}));
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role === "manager" ? "manager" : body.role === "viewer" ? "viewer" : null;
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (!role) {
    return NextResponse.json({ error: "Role must be viewer or manager" }, { status: 400 });
  }
  if (email === user.email?.toLowerCase()) {
    return NextResponse.json(
      { error: "That's you — you already own this profile" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("sc_person_shares")
    .upsert(
      { person_id: id, owner_id: user.id, grantee_email: email, role },
      { onConflict: "person_id,grantee_email" }
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ share: data });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabase, user } = ctx;
  const { id } = await params;

  const person = await requireOwnedPerson(supabase, user, id);
  if (person instanceof NextResponse) return person;

  const shareId = new URL(request.url).searchParams.get("id");
  if (!shareId) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("sc_person_shares")
    .delete()
    .eq("id", shareId)
    .eq("person_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
