#!/usr/bin/env node
// Backfill a local directory of images into a StyleCheck account.
// Usage: node scripts/backfill.mjs <dir> [--email k4rthikr@gmail.com] [--dry-run] [--limit N]
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";

// ---------- env (parse .env.local; no dotenv dependency) ----------
function loadEnv() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) die(".env.local not found — run from the repo root.");
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ---------- args ----------
const args = process.argv.slice(2);
const flags = { email: "k4rthikr@gmail.com", dryRun: false, limit: Infinity };
let dir = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--email") flags.email = args[++i];
  else if (a === "--dry-run") flags.dryRun = true;
  else if (a === "--limit") flags.limit = parseInt(args[++i], 10);
  else if (!a.startsWith("--")) dir = a;
}
if (!dir) die("Usage: node scripts/backfill.mjs <dir> [--email x] [--dry-run] [--limit N]");
dir = resolve(dir.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
if (!existsSync(dir) || !statSync(dir).isDirectory()) die(`Not a directory: ${dir}`);

loadEnv();
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) die("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
if (!GEMINI_API_KEY && !flags.dryRun) die("GEMINI_API_KEY missing from .env.local");

// ---------- collect images ----------
const EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
function collect(d) {
  const out = [];
  for (const name of readdirSync(d)) {
    if (name.startsWith(".")) continue;
    const p = join(d, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...collect(p));
    else {
      const ext = extname(name).toLowerCase();
      if (EXTS.has(ext)) out.push(p);
      else if (ext === ".heic" || ext === ".heif")
        console.warn(`⚠ skipping HEIC (convert to JPEG first): ${p}`);
    }
  }
  return out;
}

const files = collect(dir).slice(0, flags.limit);
console.log(`Found ${files.length} image(s) in ${dir}`);
if (files.length === 0) process.exit(0);

if (flags.dryRun) {
  files.forEach((f) => console.log(`  would process: ${f}`));
  console.log(`\nDry run — nothing uploaded. Re-run without --dry-run to import.`);
  process.exit(0);
}

// ---------- clients ----------
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const MODEL = "gemini-2.5-flash";
const BUCKET = "stylecheck";

// Duplicated from lib/ai/prompts.ts (CLASSIFY_PROMPT) — keep in sync if the app
// schema changes. Scripts are plain Node and can't import the TS lib.
const CLASSIFY_PROMPT = `You are a fashion cataloguer for a personal wardrobe app.
Look at this image, detect the person (if any) AND every distinct wardrobe item visible — including items being WORN by a person. Respond with JSON only, matching this schema:

{
  "kind": "person" | "item" | "unusable",
  "person": { "photo_kind": "selfie" | "full_body" | "half_body" | "unknown", "notes": string },
  "items": [{
    "category": "top" | "bottom" | "outerwear" | "footwear" | "accessory" | "belt" | "eyewear" | "headwear" | "bag" | "full_body",
    "subcategory": string,
    "name": string,
    "description": string,
    "colors": string[],
    "primary_color": string,
    "pattern": string,
    "material": string,
    "seasons": ("spring"|"summer"|"fall"|"winter")[],
    "formality": "casual" | "smart_casual" | "business" | "formal" | "athletic" | "lounge",
    "style_tags": string[]
  }]
}

Rules:
- If a person is visible (face or body, selfie, mirror shot), kind = "person" and include "person". ALSO list each clearly identifiable garment/footwear/accessory they are wearing in "items" — each piece as its own entry.
- If it shows only clothing/footwear/accessories (laid flat, hung, on a surface), kind = "item" and list EVERY distinct piece in "items", omit "person".
- Only include items you can describe confidently. Do not catalogue underwear or socks unless clearly the subject.
- If the image is blurry, irrelevant, or not fashion related, kind = "unusable" with empty "items".
- "full_body" category is for one-piece garments (dresses, jumpsuits, overalls).`;

// ---------- resolve user ----------
async function findUserId(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die(`auth lookup failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
    page++;
  }
}

const userId = await findUserId(flags.email);
if (!userId)
  die(`No Supabase user for ${flags.email}. Sign in to the app once first, then re-run.`);
console.log(`User: ${flags.email} (${userId})\n`);

// ---------- pipeline ----------
const summary = { items: {}, persons: 0, unusable: 0, failures: [] };

async function processFile(file) {
  const jpeg = await sharp(file)
    .rotate()
    .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  const path = `${userId}/originals/${randomUUID()}.jpg`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, jpeg, { contentType: "image/jpeg" });
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: jpeg.toString("base64") } },
          { text: CLASSIFY_PROMPT },
        ],
      },
    ],
    config: { responseMimeType: "application/json" },
  });
  const c = JSON.parse(
    res.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()
  );

  const modelUsed = `${MODEL} (backfill)`;
  const labels = [];
  if (c.kind === "person") {
    const { error } = await supabase.from("sc_user_photos").insert({
      user_id: userId,
      storage_path: path,
      kind: c.person?.photo_kind ?? "unknown",
      analysis: c.person ?? null,
      model_used: modelUsed,
    });
    if (error) throw new Error(`insert photo: ${error.message}`);
    summary.persons++;
    labels.push(`person (${c.person?.photo_kind ?? "unknown"})`);
  }
  // A single photo can yield several wardrobe items (worn or flat-lay).
  for (const it of c.items ?? []) {
    const { error } = await supabase.from("sc_wardrobe_items").insert({
      user_id: userId,
      category: it.category,
      subcategory: it.subcategory ?? null,
      name: it.name ?? null,
      description: it.description ?? null,
      colors: it.colors ?? [],
      primary_color: it.primary_color ?? null,
      pattern: it.pattern ?? null,
      material: it.material ?? null,
      seasons: it.seasons ?? [],
      formality: it.formality ?? null,
      style_tags: it.style_tags ?? [],
      original_image_path: path,
      catalog_source: "pending",
      analysis: it,
      model_used: modelUsed,
    });
    if (error) throw new Error(`insert item: ${error.message}`);
    summary.items[it.category] = (summary.items[it.category] ?? 0) + 1;
    labels.push(`${it.category}: ${it.name ?? it.subcategory ?? "item"}`);
  }
  if (labels.length) return labels.join(" · ");
  summary.unusable++;
  return "unusable";
}

const CONCURRENCY = 3;
let idx = 0;
let done = 0;
async function worker() {
  while (idx < files.length) {
    const file = files[idx++];
    try {
      const label = await processFile(file);
      console.log(`[${++done}/${files.length}] ${file} → ${label}`);
    } catch (err) {
      done++;
      summary.failures.push({ file, error: err.message });
      console.error(`[${done}/${files.length}] ${file} → FAILED: ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// ---------- summary ----------
console.log("\n— Backfill complete —");
const totalItems = Object.values(summary.items).reduce((a, b) => a + b, 0);
console.log(`Wardrobe items: ${totalItems}`);
for (const [cat, n] of Object.entries(summary.items).sort((a, b) => b[1] - a[1]))
  console.log(`  ${cat}: ${n}`);
console.log(`Person photos: ${summary.persons}`);
console.log(`Unusable: ${summary.unusable}`);
console.log(`Failures: ${summary.failures.length}`);
summary.failures.forEach((f) => console.log(`  ${f.file}: ${f.error}`));
if (totalItems > 0)
  console.log(
    "\nNext: open the app → Wardrobe for catalogue shots, Profile for your base render, Fits to generate looks."
  );
