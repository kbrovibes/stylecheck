"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/wardrobe", label: "Wardrobe" },
  { href: "/fits", label: "Fits" },
  { href: "/upload", label: "Upload" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
];

export default function Nav({ email }: { email: string }) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b hairline bg-ivory/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="group flex items-baseline gap-1.5">
          <span className="text-[15px] font-semibold tracking-[0.28em] uppercase">
            Style
          </span>
          <span className="serif-accent text-[19px] text-camel group-hover:text-camel-deep transition-colors">
            check
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map((l) => {
            const active =
              l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3.5 py-1.5 text-[13px] transition-colors ${
                  active
                    ? "bg-ink text-ivory"
                    : "text-ink-soft hover:bg-hairline/60 hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <form action="/auth/signout" method="post" className="ml-3">
            <button
              type="submit"
              title={email}
              className="text-[12px] text-ink-faint hover:text-ink transition-colors"
            >
              Sign out
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
