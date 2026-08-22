"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import PersonSwitcher, { type SwitcherPerson } from "@/components/person-switcher";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/wardrobe", label: "Wardrobe" },
  { href: "/fits", label: "Fits" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
];

const ICONS: Record<string, ReactNode> = {
  "/": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </svg>
  ),
  "/wardrobe": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8.5a2 2 0 1 1 2-2c0 1.2-2 1.6-2 3v.5" />
      <path d="M12 10l8.2 5.6a1.2 1.2 0 0 1-.7 2.2H4.5a1.2 1.2 0 0 1-.7-2.2L12 10z" />
    </svg>
  ),
  "/fits": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4l1.8 4.6L18 10.5l-4.2 1.9L12 17l-1.8-4.6L6 10.5l4.2-1.9L12 4z" />
      <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
    </svg>
  ),
  "/profile": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.8-3.2 3.6-5 7-5s6.2 1.8 7 5" />
    </svg>
  ),
};

function matches(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export default function Nav({
  email,
  switcher,
}: {
  email: string;
  switcher: { people: SwitcherPerson[]; activeId: string } | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // Warm the tab routes so taps resolve fast.
  useEffect(() => {
    LINKS.forEach((l) => router.prefetch(l.href));
  }, [router]);

  // Navigation landed — clear the optimistic highlight.
  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  // Hide the bottom tab bar while a text field is focused (keyboard open) —
  // otherwise iOS pushes fixed-bottom elements up and they float around.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const editable = (el: EventTarget | null) => {
      const t = el as HTMLElement | null;
      return (
        !!t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      );
    };
    const onFocusIn = (e: FocusEvent) => setKeyboardOpen(editable(e.target));
    const onFocusOut = () => setKeyboardOpen(false);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  function go(href: string) {
    if (matches(pathname, href) && pathname === href) return;
    setPendingHref(href); // instant feedback: tab flips immediately
    startTransition(() => router.push(href));
  }

  const isActive = (href: string) =>
    pendingHref !== null ? pendingHref === href : matches(pathname, href);

  return (
    <>
      {/* Page dim while the next page loads */}
      <div
        aria-hidden
        className={`pointer-events-none fixed inset-0 z-30 bg-ivory/55 backdrop-blur-[1px] transition-opacity duration-200 ${
          isPending ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b hairline bg-ivory/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="group select-none shrink-0">
              <span className="font-serif text-[14px] uppercase tracking-[0.18em] text-ink sm:text-[16px]">
                Hanger
              </span>
              <span className="serif-accent text-[15px] text-camel transition-colors group-hover:text-camel-deep sm:text-[17px]">
                {" "}management.
              </span>
            </Link>
            {switcher && switcher.people.length > 0 && (
              <PersonSwitcher people={switcher.people} activeId={switcher.activeId} />
            )}
          </div>

          {/* Desktop links */}
          <nav className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <button
                key={l.href}
                onClick={() => go(l.href)}
                className={`rounded-full px-3.5 py-1.5 text-[13px] transition-colors ${
                  isActive(l.href)
                    ? "bg-ink text-ivory"
                    : "text-ink-soft hover:bg-hairline/60 hover:text-ink"
                }`}
              >
                {l.label}
              </button>
            ))}
            <form action="/auth/signout" method="post" className="ml-3">
              <button
                type="submit"
                title={email}
                className="text-[12px] text-ink-faint transition-colors hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </nav>

          {/* Mobile: settings gear + sign out */}
          <div className="flex items-center gap-1 md:hidden">
            <button
              onClick={() => go("/settings")}
              aria-label="Settings"
              className={`rounded-full p-2 transition-colors ${
                isActive("/settings") ? "bg-ink text-ivory" : "text-ink-soft"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <circle cx="12" cy="12" r="3" />
                <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.1-1.3L14 3h-4l-.5 2.6a7 7 0 0 0-2.1 1.3l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.1 1.3L10 21h4l.5-2.6a7 7 0 0 0 2.1-1.3l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" />
              </svg>
            </button>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                aria-label={`Sign out (${email})`}
                className="rounded-full p-2 text-ink-soft"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
                  <path d="M15 16l4-4-4-4M19 12H9" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar */}
      <nav
        className={`fixed inset-x-0 bottom-0 z-40 border-t hairline bg-ivory/92 backdrop-blur-md transition-transform duration-200 md:hidden ${
          keyboardOpen ? "translate-y-full" : "translate-y-0"
        }`}
        style={{
          paddingBottom: "max(calc(env(safe-area-inset-bottom) - 12px), 0px)",
          transform: keyboardOpen ? undefined : "translateZ(0)",
        }}
      >
        <div className="mx-auto flex max-w-md items-stretch justify-around">
          {LINKS.filter((l) => l.href !== "/settings").map((l) => {
            const active = isActive(l.href);
            const loading = pendingHref === l.href && isPending;
            return (
              <button
                key={l.href}
                onClick={() => go(l.href)}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2 transition-all duration-150 active:scale-90 ${
                  active ? "text-ink" : "text-ink-faint"
                }`}
              >
                <span
                  className={`h-[22px] w-[22px] transition-transform duration-150 ${
                    active ? "scale-105" : "opacity-80"
                  } ${loading ? "animate-pulse" : ""}`}
                >
                  {ICONS[l.href]}
                </span>
                <span
                  className={`text-[10px] tracking-wide ${
                    active ? "font-semibold" : "font-medium"
                  }`}
                >
                  {l.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
