# StyleCheck

Personal wardrobe catalogue + AI fit checks — **rendered on you**.

**Live:** https://mystylecheck.vercel.app · GitHub: [kbrovibes/stylecheck](https://github.com/kbrovibes/stylecheck)
(`stylecheck.vercel.app` was taken by another project; `stylecheck-mu.vercel.app` remains as a secondary alias.)

Upload photos of your clothes and yourself. StyleCheck classifies every piece into a
retail-style catalogue, builds a profile that knows your height, weight, and local
weather, then acts as a modern-minimal stylist: composing outfits from *your* wardrobe,
explaining why each one works on *your* frame, and generating photorealistic full-body
renders of you wearing them — head to shoes.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Styling | Tailwind CSS 4, light editorial theme (Inter + Instrument Serif) |
| Auth / DB / Storage | Supabase (Google OAuth, Postgres with RLS, private storage bucket) |
| AI | Gemini via `@google/genai` (text + vision + image gen), with an OpenAI provider slot |
| Hosting | Vercel (project `stylecheck`) |

### ⚠️ Shared Supabase project

The Supabase free tier is at its 2-project limit, so StyleCheck lives **inside the
shared project `zwwkcwdqsplztlmyfpyf` ("kbro-db1")** — the same project that backs
snobaddy/opencourt/deadcode:

- All tables are prefixed `sc_` and RLS-scoped to the signed-in user.
- Storage uses a dedicated private bucket named `stylecheck` (paths are `{userId}/…`).
- Google OAuth was already configured on that project; StyleCheck's redirect URLs
  (`https://stylecheck.vercel.app/**`, `https://stylecheck-*.vercel.app/**`,
  `http://localhost:3000/**`) are already in the auth allow-list. **No manual auth
  setup is required.**
- Migration to a dedicated Supabase project is tracked in [BACKLOG.md](BACKLOG.md).

## Environment variables

Set in `.env.local` for dev and in Vercel project settings for deploys.

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL (browser + server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key (RLS enforced) |
| `SUPABASE_URL` | ✅ | Same URL, used by scripts |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ (scripts only) | Backfill script — bypasses RLS, never shipped to the browser |
| `GEMINI_API_KEY` | ✅ | Classification, styling, and image rendering (default provider) |
| `OPENAI_API_KEY` | optional | Enables the OpenAI provider toggle in Settings |

## Local dev

```bash
npm install
npm run dev   # http://localhost:3000
```

Sign in with Google — localhost is already on the auth allow-list.

## Deploy

Deployed on Vercel as project **stylecheck**. Every push to `main` deploys;
`vercel --prod` promotes to production. Environment variables above must exist in
Vercel (all environments; the service-role key is only needed if server code starts
using it).

## Data model

All tables `public.sc_*`, all RLS: `auth.uid()` owns its rows.

| Table | Holds |
|---|---|
| `sc_profiles` | height/weight, ZIP → lat/lon/place for weather, pointer to base body render |
| `sc_user_photos` | your uploaded photos (selfie / full-body auto-detected), soft-delete only |
| `sc_wardrobe_items` | one row per piece: category, colors, seasons, formality, style tags, original + catalogue image paths, model used |
| `sc_outfits` | composed fits: item ids, occasion, explanation, styling notes, variations (swap links), render pointer + status |
| `sc_renders` | **append-only render history** — every generated image (catalogue shot, base render, outfit render) with the model that made it |
| `sc_settings` | provider (gemini/openai), text/image model ids, feature toggles (accessories, shoes, belts, glasses=disabled, auto-render) |

**Images are never deleted.** Item/photo removal is a soft-delete flag; re-renders
append to `sc_renders` rather than overwrite, so you can switch models and compare
outputs later.

## Features

1. **Upload** — drag in a batch of photos. Client-side compression (≤~1280px JPEG)
   keeps uploads tiny. Each image is auto-classified: clothing/shoes/accessories become
   wardrobe items with full metadata; photos of *you* (including selfies) are detected
   and routed to your profile.
2. **Wardrobe** — a retail-style catalogue of everything you own. Each item can get a
   generated clean product shot (white background, catalogue lighting), created once
   and saved. Filter by category; disable pieces you don't want styled.
3. **Profile** — your photos, height, weight, and ZIP code. Weather for your location
   shows on the dashboard with a what-to-wear hint. Generate (and re-generate) a
   **base render**: a studio full-body image of you that anchors likeness for outfit
   renders.
4. **Fits** — the stylist composes as many outfits as your wardrobe supports, scored
   and classified by occasion (work / casual / friends / date / active / lounge) and
   season, weather-aware. Every fit has an explanation of *why it works for you*,
   styling notes, and **variation links** ("same tee, different pants") that render on
   click. Renders are full-frame, head to shoes, honest to your height/weight.
5. **Settings** — switch provider (Gemini default, OpenAI optional), pick models,
   toggle optional pieces (accessories/shoes/belts). Glasses support exists as a
   disabled toggle (v1 renders keep whatever eyewear your reference photos show).

## Backfilling from a local folder

A project-local Claude Code skill (`.claude/skills/backfill-wardrobe/`) processes a
directory of images on this machine straight into your profile — no browser uploads:

```bash
node scripts/backfill.mjs ~/Pictures/closet --email k4rthikr@gmail.com
```

Or just tell Claude: *"backfill my wardrobe from ~/Pictures/closet"*. Flags:
`--dry-run` (list only), `--limit N`. Requires `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `GEMINI_API_KEY` in `.env.local`, and that the
account has signed in to the app at least once.

## Roadmap

See [BACKLOG.md](BACKLOG.md).
