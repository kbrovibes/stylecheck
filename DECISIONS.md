# FitCheck — Decision Log

Decisions made autonomously (2026-08-21 sprint). Flag anything you'd change.

## Rename
- **Display name → FitCheck** everywhere (wordmark "FITCHECK.", PWA name, icon "F.",
  favicon, login carousel, README). `fitcheck.vercel.app` was taken → **myfitcheck.vercel.app**
  (your stated fallback). `mystylecheck.vercel.app` and `stylecheck-mu` still work as aliases.
- GitHub repo name, Vercel project name, DB table prefixes (`sc_`), and the storage
  bucket stay `stylecheck` — internal identifiers, zero user visibility, not worth the
  migration risk before a friends launch.

## Cost safety (credits)
- Per-user daily budgets, reset at midnight PT: **60 image ops** (renders, product
  shots, scenes) and **300 text ops** (classify, compose, audits) per day.
- Enforced server-side via an atomic SQL counter (`sc_spend_credit`, SECURITY DEFINER)
  — not bypassable from the client. 429 with a friendly message when exhausted.
- Admin (k4rthikr@gmail.com) is exempt. Nightly crons are not metered (owner-scheduled,
  their own caps). Metering fails open — a metering outage can never break the product.
- Rough worst case per rogue user/day: 60 Pro images ≈ $8-10. Adjust limits in
  `lib/credits.ts`.

## Today's picks
- 3 picks/day, deterministic per (person, date) so they don't reshuffle on reload;
  rotate daily. Selection favors current-season fits, thumbs-up, high scores, and
  occasion diversity (one work-ish, one casual/social, one wildcard); thumbs-down and
  degraded fits are excluded.

## Occasion accuracy
- Strict occasion definitions baked into composition ("date = elevated + intentional,
  never gym wear"; "active = ONLY real athletic pieces, else zero active fits").
- One-time audit relabels existing fits and gap-fills occasions with <3 fits (active
  only gap-filled if the wardrobe actually contains athletic pieces).

## Build-a-fit (select & style)
- Minimum viable outfit = (top or full-body) + bottoms + shoes; anything less returns
  a plain-English "add X" message instead of generating. Hand-picked combos get honest
  scores — the stylist may politely say the combo is awkward.

## UX validation
- Google-login can't be automated, so the study uses a password-auth **test account**
  created via the Supabase admin API (`fitcheck.tester@…`) exercising the real API
  surface as a brand-new user, plus a heuristic UX audit of every screen. Report
  delivered as a Google Doc. Test account is flagged for deletion post-study.
