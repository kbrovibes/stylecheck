"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const SLIDES = [
  {
    img: "/intro/banner.jpg",
    eyebrow: "Fitcheck",
    title: "Your wardrobe,",
    accent: "styled.",
    body: "A personal stylist that knows every piece you own — and shows you wearing it before you get dressed.",
    wide: true,
  },
  {
    img: "/intro/mannequin.jpg",
    eyebrow: "Step 01",
    title: "Build your",
    accent: "mannequin",
    body: "Upload a few photos — a selfie, a full-body shot. FitCheck builds a photoreal render of you: your face, your build, your proportions. Honest, not idealized.",
  },
  {
    img: "/intro/wardrobe.jpg",
    eyebrow: "Step 02",
    title: "Catalogue your",
    accent: "closet",
    body: "Photograph your clothes — worn, hung, or heaped on the bed. Every piece is detected, named, and re-shot as a clean retail-style product image.",
  },
  {
    img: "/intro/fits.jpg",
    eyebrow: "Step 03",
    title: "Generate.",
    accent: "Voilà.",
    body: "Your stylist composes outfits from your actual wardrobe — age-aware, weather-aware, occasion-aware — and renders every look on you, head to shoes. With reasons why it works.",
  },
];

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    setDenied(new URLSearchParams(window.location.search).get("denied") === "1");
  }, []);
  const [idx, setIdx] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const touchedRef = useRef(false);

  async function signIn() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  // Gentle auto-advance until the user takes over.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => {
      if (touchedRef.current) return;
      const el = trackRef.current;
      if (!el) return;
      const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % SLIDES.length;
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    }, 5000);
    return () => clearInterval(t);
  }, []);

  function onScroll() {
    const el = trackRef.current;
    if (el) setIdx(Math.round(el.scrollLeft / el.clientWidth));
  }

  return (
    <div className="flex min-h-dvh flex-col bg-ivory">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <p className="select-none">
          <span className="font-serif text-[16px] uppercase tracking-[0.3em]">Fitcheck</span>
          <span className="font-serif text-[18px] text-camel">.</span>
        </p>
        <button
          onClick={signIn}
          disabled={loading}
          className="rounded-full border hairline bg-paper px-4 py-2 text-[13px] font-medium transition-colors hover:bg-ink hover:text-ivory disabled:opacity-50"
        >
          Sign in
        </button>
      </header>

      {/* Intro carousel */}
      <div
        ref={trackRef}
        onScroll={onScroll}
        onPointerDown={() => (touchedRef.current = true)}
        className="no-scrollbar flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto"
      >
        {SLIDES.map((s, i) => (
          <section
            key={i}
            className="flex w-full shrink-0 snap-center flex-col px-5 pb-4 sm:px-8 lg:flex-row lg:items-center lg:gap-14 lg:px-16"
          >
            <div
              className={`overflow-hidden rounded-3xl border hairline ${
                s.wide
                  ? "aspect-[16/10] lg:aspect-auto lg:h-[62dvh] lg:flex-[1.4]"
                  : "aspect-[4/4.3] sm:aspect-[4/3] lg:aspect-auto lg:h-[62dvh] lg:flex-1"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.img}
                alt=""
                fetchPriority={i === 0 ? "high" : "auto"}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-1 flex-col justify-center pt-6 lg:pt-0">
              <p className="eyebrow">{s.eyebrow}</p>
              <h2 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
                {s.title}{" "}
                <span className="serif-accent text-camel">{s.accent}</span>
              </h2>
              <p className="mt-3 max-w-md text-[14px] leading-relaxed text-ink-soft sm:text-[15px]">
                {s.body}
              </p>
            </div>
          </section>
        ))}
      </div>

      {/* Dots + primary CTA */}
      <footer className="flex flex-col items-center gap-5 px-6 pb-8 pt-2 sm:pb-10">
        {denied && (
          <p className="max-w-sm rounded-2xl border border-camel/40 bg-camel/5 px-4 py-3 text-center text-[13px] text-ink-soft">
            FitCheck is <span className="serif-accent text-camel-deep">invite-only</span> right
            now — ask Karthik to add your email, then sign in again.
          </p>
        )}
        <div className="flex gap-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              aria-label={`Slide ${i + 1}`}
              onClick={() => {
                touchedRef.current = true;
                trackRef.current?.scrollTo({
                  left: i * (trackRef.current?.clientWidth ?? 0),
                  behavior: "smooth",
                });
              }}
              className={`h-1.5 rounded-full transition-all ${
                i === idx ? "w-6 bg-ink" : "w-1.5 bg-ink/25 hover:bg-ink/40"
              }`}
            />
          ))}
        </div>
        <button
          onClick={signIn}
          disabled={loading}
          className="flex w-full max-w-sm items-center justify-center gap-3 rounded-full bg-ink px-6 py-3.5 text-[14px] font-medium text-ivory transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" opacity=".9" />
            <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" opacity=".7" />
            <path fill="#fff" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" opacity=".5" />
            <path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52Z" opacity=".8" />
          </svg>
          {loading ? "Redirecting…" : "Continue with Google"}
        </button>
      </footer>
    </div>
  );
}
