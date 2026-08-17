"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <div className="flex min-h-screen">
      {/* Editorial panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-ink p-12 text-ivory lg:flex">
        <p className="eyebrow !text-ivory/50">Personal styling, rendered</p>
        <div>
          <p className="serif-accent text-[64px] leading-[1.05] text-ivory/95">
            Wear what
            <br />
            works on
            <br />
            <span className="text-camel">you.</span>
          </p>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-ivory/60">
            Catalogue your wardrobe, build your profile, and see every outfit
            rendered on your own frame — before you get dressed.
          </p>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[13px] font-semibold tracking-[0.28em] uppercase">
            Style
          </span>
          <span className="serif-accent text-[17px] text-camel">check</span>
        </div>
      </div>

      {/* Sign-in panel */}
      <div className="flex w-full items-center justify-center p-8 lg:w-1/2">
        <div className="w-full max-w-sm fade-up">
          <div className="mb-10 flex items-baseline gap-1.5 lg:hidden">
            <span className="text-[15px] font-semibold tracking-[0.28em] uppercase">
              Style
            </span>
            <span className="serif-accent text-[19px] text-camel">check</span>
          </div>
          <p className="eyebrow">Welcome</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Step into your <span className="serif-accent text-camel">closet</span>
          </h1>
          <p className="mt-3 text-sm text-ink-faint">
            Sign in to build your wardrobe and generate fit checks.
          </p>
          <button
            onClick={signIn}
            disabled={loading}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-full border hairline bg-paper px-6 py-3.5 text-[14px] font-medium transition-all hover:bg-ivory disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52Z"
              />
            </svg>
            {loading ? "Redirecting…" : "Continue with Google"}
          </button>
        </div>
      </div>
    </div>
  );
}
