"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconSettings, Logo } from "@/components/Icons";

export default function AppHeader() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/80 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={26} />
          <span className="font-display text-[15px] font-semibold">RallyVision</span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/" className={`btn-ghost h-9 px-3 ${path === "/" ? "text-ink" : ""}`}>Library</Link>
          <Link href="/settings" className={`btn-icon ${path === "/settings" ? "bg-subtle text-ink" : ""}`} aria-label="Settings"><IconSettings /></Link>
        </nav>
      </div>
    </header>
  );
}
