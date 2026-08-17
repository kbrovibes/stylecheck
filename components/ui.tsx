import Link from "next/link";
import type { ReactNode } from "react";

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow mb-2">{children}</p>;
}

export function PageTitle({
  eyebrow,
  title,
  accent,
  children,
}: {
  eyebrow: string;
  title: string;
  accent?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 sm:mb-10">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
          {accent && <span className="serif-accent text-camel"> {accent}</span>}
        </h1>
      </div>
      {children && <div className="flex shrink-0 items-center gap-3">{children}</div>}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border hairline bg-paper p-6 ${className}`}>
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "camel" | "moss" | "ink";
}) {
  const tones = {
    neutral: "bg-ivory text-ink-soft border hairline",
    camel: "bg-camel/10 text-camel-deep",
    moss: "bg-moss/10 text-moss",
    ink: "bg-ink text-ivory",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed hairline bg-paper/60 px-8 py-16 text-center">
      <p className="serif-accent text-2xl text-ink-soft">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-faint">{body}</p>
      {ctaHref && ctaLabel && (
        <Link
          href={ctaHref}
          className="mt-6 inline-flex rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-ivory transition-opacity hover:opacity-85"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants = {
    primary:
      "bg-ink text-ivory hover:opacity-85 disabled:opacity-40",
    secondary:
      "border hairline bg-paper text-ink hover:bg-ivory disabled:opacity-40",
    ghost: "text-ink-soft hover:bg-hairline/60 disabled:opacity-40",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium transition-all ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
