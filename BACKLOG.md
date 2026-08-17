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

## Backlog

| # | Item | Why |
|---|---|---|
| 1 | **Dedicated Supabase project migration** | Currently squatting in the shared "snobaddy" project (`sc_` prefix) because of the free-tier 2-project cap. A dedicated project isolates auth, storage quotas, and blast radius. Migrate when a slot frees up or on upgrade. |
| 2 | **Glasses / eyewear render support** | Settings toggle already exists (disabled). Needs eyewear item uploads + render prompts that swap glasses without breaking likeness. |
| 3 | **Web search for official product images** | Instead of generating catalogue shots, find the item's official retail image online — cheaper, pixel-accurate, no generation drift. Fall back to generation for unbranded pieces. |
| 4 | **OpenAI `gpt-image-1` reference-image support** | Current OpenAI path uses text-only generation, which can't preserve likeness. The images/edits endpoint accepts reference photos — needed before OpenAI is a real render alternative. |
| 5 | **Batch re-render on model switch + comparison UI** | `sc_renders` already keeps per-model history. Add "re-render everything with current model" and a side-by-side viewer to actually compare Gemini vs. OpenAI output. |
| 6 | **Outfit calendar / wear tracking** | Log what you actually wore; unlocks rotation stats, cost-per-wear, and "you wore this Tuesday" awareness in suggestions. |
| 7 | **Packing lists by trip + forecast** | Given a destination and dates, pull the forecast and compose a minimal packing capsule from the wardrobe. |
| 8 | **Shareable lookbook links** | Public read-only page for a fit or a collection — get a second opinion without screenshots. |
| 9 | **Mobile PWA + push** | Same web-push setup as the other apps (stonkbro/snobaddy). Morning "today's fit" notification using live weather. |
| 10 | **Dedupe detection on upload** | Embedding/hash similarity to catch re-uploads of the same garment before they pollute the catalogue. |
| 11 | **Multi-country ZIP support** | Geocoding currently assumes US zips (zippopotam.us supports more — needs country selector in profile). |
