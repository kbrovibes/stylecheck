---
name: backfill-wardrobe
description: Bulk-import a local directory of wardrobe/person photos into the StyleCheck profile. Use when the user says things like "backfill my wardrobe from ~/Pictures/closet", "import my closet photos", "process the images in <dir> into stylecheck", or "backfill my profile".
---

# Backfill wardrobe from a local directory

Processes every image in a local folder straight into the user's StyleCheck account:
compresses, uploads to Supabase storage, classifies with Gemini (wardrobe item vs.
person photo, with full metadata), and inserts the rows — same pipeline as the in-app
uploader, no browser needed.

## Prerequisites (check before running)

- `.env.local` at the repo root must contain `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, and `GEMINI_API_KEY`.
- The target account must have signed in to the app at least once (the script looks
  the user up by email in Supabase auth).

## Steps

1. Determine the source directory from the user's request. If they didn't name one,
   ask. Expand `~` yourself; verify the directory exists and count the images
   (`jpg/jpeg/png/webp` — HEIC is skipped with a warning, tell the user if their
   folder is HEIC-heavy so they can convert first).
2. Optionally preview with a dry run:

   ```bash
   node scripts/backfill.mjs <dir> --dry-run
   ```

3. Run the real import (email defaults to `k4rthikr@gmail.com`; pass `--email` for a
   different account, `--limit N` to cap a first batch):

   ```bash
   node scripts/backfill.mjs <dir> --email k4rthikr@gmail.com
   ```

4. Relay the script's final summary to the user: items per category, person photos
   detected, unusable images, and any failures (with filenames).
5. Remind the user: backfill only builds the catalogue. Catalogue product shots, the
   base render, and fit generation happen in the app (Wardrobe → item → "Generate
   catalogue shot"; Profile → "Generate base render"; Fits → "Generate"). A `--fits`
   flag to trigger generation from the CLI is planned but not implemented yet.

## Notes

- Images are never deleted or modified at the source; the script only reads.
- Re-running on the same folder re-uploads (no dedupe yet — see BACKLOG item 10).
  Warn the user before re-processing a folder that was already imported.
