// Backfill sc_wardrobe_items.color_hex from catalogue shots (dominant color).
// Mirrors dominantColorHex in lib/img-server.ts.
//   node scripts/backfill-colors.mjs
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function dominantColorHex(buf) {
  const { data, info } = await sharp(buf)
    .flatten({ background: "#ffffff" })
    .resize(64, 64, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map();
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 235 && g > 235 && b > 235) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    counts.set(key, e);
  }
  let best = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  if (!best || best.n < 20) return null;
  const hex = (sum) => Math.round(sum / best.n).toString(16).padStart(2, "0");
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

const { data: items, error } = await admin
  .from("sc_wardrobe_items")
  .select("id, name, category, catalog_image_path, original_image_path")
  .eq("deleted", false);
if (error) throw error;

let done = 0, skipped = 0, failed = 0;
for (const item of items) {
  const path = item.catalog_image_path ?? item.original_image_path;
  if (!path) { skipped++; continue; }
  try {
    const { data: file, error: dlErr } = await admin.storage.from("stylecheck").download(path);
    if (dlErr) throw dlErr;
    const hex = await dominantColorHex(Buffer.from(await file.arrayBuffer()));
    await admin.from("sc_wardrobe_items").update({ color_hex: hex }).eq("id", item.id);
    console.log(`${(item.name ?? item.id).padEnd(45)} ${item.category.padEnd(10)} ${hex ?? "null"}`);
    done++;
  } catch (e) {
    failed++;
    console.log(`${item.name ?? item.id}: FAILED — ${e.message}`);
  }
}
console.log(`\ndone ${done}, skipped ${skipped}, failed ${failed} (of ${items.length})`);
