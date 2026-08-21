import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ADMIN_EMAILS = ["k4rthikr@gmail.com"];

async function requireAdmin() {
  const { user } = await requireUser();
  if (!user.email || !ADMIN_EMAILS.includes(user.email)) throw new Error("forbidden");
  return user;
}

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { data } = await createAdminClient()
    .from("sc_allowlist")
    .select("*")
    .order("created_at", { ascending: false });
  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { email } = await request.json().catch(() => ({}));
  if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
  }
  await createAdminClient()
    .from("sc_allowlist")
    .upsert({ email: email.toLowerCase().trim(), added_by: admin.email });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const email = new URL(request.url).searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  await createAdminClient().from("sc_allowlist").delete().eq("email", email.toLowerCase());
  return NextResponse.json({ ok: true });
}
