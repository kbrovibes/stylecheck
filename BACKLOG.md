# StyleCheck — Backlog

## Shipped

### v1 — 2026-08-16

- Google auth (shared Supabase project, allow-list wired), RLS on all `sc_` tables.
- Batch upload with client-side compression; auto-classification of items vs. person
  photos (selfie detection) via Gemini vision.
- Wardrobe catalogue with generated clean product shots (created once, saved forever).
- Profile: photos, height/weight, ZIP → weather with what-to-wear hint; base body
  render with re-generate.
- Fit generation: stylist-composed outfits from your wardrobe, occasion + season
  classified, weather-aware, per-fit explanation + styling notes, variation swap
  links that materialize and render on click.
- Full-body outfit renders (head to shoes, honest height/weight, likeness-anchored).
- Settings: Gemini/OpenAI provider toggle, model pickers, optional-piece toggles,
  glasses toggle present but disabled (unsupported in v1).
- Append-only render history (`sc_renders`) with model metadata — nothing is ever
  deleted, enabling cross-model comparison later.
- Project-local `backfill-wardrobe` skill + `scripts/backfill.mjs` for bulk-importing
  a local image directory.

### v1.1 — 2026-08-16

- App icon (editorial "S." mark) + full favicon/apple-icon set.
- PWA: web manifest, installable, standalone display, safe-area support.
- Mobile-first layout: bottom tab bar navigation on phones (settings + sign-out in
  the top bar), responsive headings and page padding.

### v1.2 — 2026-08-16

- Face-safe previews: person photos and fit cards crop from the top (face stays
  visible); large render views letterbox instead of cropping.
- Render tuning: body-calibration dials (build / shoulders / waist, −2..+2) plus a
  free-text note; preview the tuned render side-by-side, then save or discard.
  Saved calibration persists on the profile and applies to all future outfit renders.
- Admin section in Settings (k4rthikr@gmail.com): storage used vs. free-tier pool
  with per-folder breakdown, user/item/outfit/render counts, renders by model —
  backed by a SECURITY DEFINER SQL function with the email gate in the database.
- Renamed shared Supabase projects: kbro-db1 (snobaddy, opencourt, deadcode,
  stylecheck) and kbro-db2 (stonkbro, brokebro, marketmath).

### v1.3 — 2026-08-16

- Multi-item extraction: one photo (selfie, mirror shot, flat-lay) now yields every
  visible garment/accessory as its own wardrobe item, plus the profile photo when a
  person is detected. Backfill script updated to match.
- Auto product shots: catalogue images are generated in the background right after
  upload; item page adds a context hint ("this is a jeans") for re-extraction.
- Wardrobe scene home page: an AI-composed walk-in-closet image built from your
  actual pieces — clickable hotspot regions (rail / shelves) open animated category
  sheets, slow ken-burns motion, "Restyle" forces async regeneration, and a nightly
  cron regenerates only when the wardrobe hash changed (cached scene = instant load).
- Deletable render history and profile photos (soft delete, files kept); deleting a
  photo offers to regenerate the base render; active renders are protected.
- Premium full-bleed app icon: gold serif monogram with double hairline frame on
  deep ink — no baked corners, so home-screen masking looks right.

## Backlog

| # | Item | Why |
|---|---|---|
| 1 | **Dedicated Supabase project migration** | Currently squatting in the shared "kbro-db1" project (`sc_` prefix) because of the free-tier 2-project cap. A dedicated project isolates auth, storage quotas, and blast radius. Migrate when a slot frees up or on upgrade. |
| 2 | **Glasses / eyewear render support** | Settings toggle already exists (disabled). Needs eyewear item uploads + render prompts that swap glasses without breaking likeness. |
| 3 | **Web search for official product images** | Instead of generating catalogue shots, find the item's official retail image online — cheaper, pixel-accurate, no generation drift. Fall back to generation for unbranded pieces. |
| 4 | **OpenAI `gpt-image-1` reference-image support** | Current OpenAI path uses text-only generation, which can't preserve likeness. The images/edits endpoint accepts reference photos — needed before OpenAI is a real render alternative. |
| 5 | **Batch re-render on model switch + comparison UI** | `sc_renders` already keeps per-model history. Add "re-render everything with current model" and a side-by-side viewer to actually compare Gemini vs. OpenAI output. |
| 6 | **Outfit calendar / wear tracking** | Log what you actually wore; unlocks rotation stats, cost-per-wear, and "you wore this Tuesday" awareness in suggestions. |
| 7 | **Packing lists by trip + forecast** | Given a destination and dates, pull the forecast and compose a minimal packing capsule from the wardrobe. |
| 8 | **Shareable lookbook links** | Public read-only page for a fit or a collection — get a second opinion without screenshots. |
| 9 | **Web push notifications** | PWA base (manifest, icons, installable, mobile tab bar) shipped in v1.1. Remaining: web-push setup like stonkbro/snobaddy — morning "today's fit" notification using live weather. |
| 10 | **Dedupe detection on upload** | Embedding/hash similarity to catch re-uploads of the same garment before they pollute the catalogue. |
| 11 | **Multi-country ZIP support** | Geocoding currently assumes US zips (zippopotam.us supports more — needs country selector in profile). |
| ~~12~~ | ~~**Rename shared Supabase projects to neutral names**~~ | ✅ Done 2026-08-16. Renamed via management API after scanning all apps for display-name dependencies (none — apps connect by ref/URL). Mapping: **kbro-db1** (`zwwkcwdqsplztlmyfpyf`) backs snobaddy, opencourt, deadcode, stylecheck; **kbro-db2** (`enbevnxmowcqdypqyyio`) backs stonkbro, brokebro, marketmath. |
