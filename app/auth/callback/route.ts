import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.email) {
      const { data: allowed } = await supabase.rpc("sc_is_allowed", {
        addr: user.email,
      });
      if (!allowed) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?denied=1`);
      }
    }
  }
  return NextResponse.redirect(`${origin}/`);
}
