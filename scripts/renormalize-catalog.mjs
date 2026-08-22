// Re-normalize stored catalogue shots whose garment sits too small in the
// frame (sharp trim() missed faint AI background gradients). Content-bbox
// logic mirrors lib/img-server.ts normalizeProductShot. Old files are kept;
// new uploads get an -n3 suffix and catalog_image_path is repointed.
//
//   node scripts/renormalize-catalog.mjs          # dry run: report only
//   node scripts/renormalize-catalog.mjs --apply  # re-process + repoint
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
const APPLY = process.argv.includes("--apply");

async function contentBBox(flat) {
  const { data, info } = await sharp(flat)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const THRESH = 225;
  const rowCounts = new Uint32Array(height);
  const colCounts = new Uint32Array(width);
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] < THRESH) {
        rowCounts[y]++;
        colCounts[x]++;
        total++;
      }
    }
  }
  const CLIP = Math.max(1, Math.round(total * 0.004));
  const edge = (counts, from) => {
    let acc = 0;
    if (from === "start") {
      for (let i = 0; i < counts.length; i++) {
        acc += counts[i];
        if (acc > CLIP) return i;
      }
      return counts.length - 1;
    }
    for (let i = counts.length - 1; i >= 0; i--) {
      acc += counts[i];
      if (acc > CLIP) return i;
    }
    return 0;
  };
  return {
    minX: edge(colCounts, "start"),
    maxX: edge(colCounts, "end"),
    minY: edge(rowCounts, "start"),
    maxY: edge(rowCounts, "end"),
    width,
    height,
  };
}

async function renormalize(buf) {
  const flat = await sharp(buf).flatten({ background: "#ffffff" }).toBuffer();
  const b = await contentBBox(flat);
  let trimmed;
  if (b.maxX - b.minX < b.width * 0.04 || b.maxY - b.minY < b.height * 0.04) {
    trimmed = await sharp(flat).trim({ threshold: 45 }).toBuffer();
  } else {
    const pad = Math.round(Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.02);
    const left = Math.max(0, b.minX - pad);
    const top = Math.max(0, b.minY - pad);
    trimmed = await sharp(flat)
      .extract({
        left,
        top,
        width: Math.min(b.width, b.maxX + pad + 1) - left,
        height: Math.min(b.height, b.maxY + pad + 1) - top,
      })
      .toBuffer();
  }
  const CANVAS = 1000;
  const BOX = Math.round(CANVAS * 0.9);
  const inner = await sharp(trimmed)
    .resize(BOX, BOX, { fit: "inside", withoutEnlargement: false })
    .toBuffer();
  const meta = await sharp(inner).metadata();
  return sharp({
    create: { width: CANVAS, height: CANVAS, channels: 3, background: "#ffffff" },
  })
    .composite([
      {
        input: inner,
        left: Math.round((CANVAS - (meta.width ?? BOX)) / 2),
        top: Math.round((CANVAS - (meta.height ?? BOX)) / 2),
      },
    ])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

const { data: items, error } = await admin
  .from("sc_wardrobe_items")
  .select("id, name, catalog_image_path")
  .eq("deleted", false)
  .not("catalog_image_path", "is", null);
if (error) throw error;

let fixed = 0, ok = 0, failed = 0;
for (const item of items) {
  try {
    const { data: file, error: dlErr } = await admin.storage
      .from("stylecheck")
      .download(item.catalog_image_path);
    if (dlErr) throw dlErr;
    const buf = Buffer.from(await file.arrayBuffer());
    const flat = await sharp(buf).flatten({ background: "#ffffff" }).toBuffer();
    const b = await contentBBox(flat);
    const fill = Math.max(
      (b.maxX - b.minX) / b.width,
      (b.maxY - b.minY) / b.height
    );
    if (fill >= 0.85 || fill <= 0.04) {
      ok++;
      continue; // already well-framed (or white-on-white — leave alone)
    }
    console.log(`${item.name ?? item.id}: garment fills ${Math.round(fill * 100)}% → renormalizing`);
    if (!APPLY) { fixed++; continue; }
    const out = await renormalize(buf);
    const newPath =
      item.catalog_image_path.replace(/(-n\d+)*\.\w+$/, "") + "-n4.jpg";
    const { error: upErr } = await admin.storage
      .from("stylecheck")
      .upload(newPath, out, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw upErr;
    const { error: dbErr } = await admin
      .from("sc_wardrobe_items")
      .update({ catalog_image_path: newPath })
      .eq("id", item.id);
    if (dbErr) throw dbErr;
    fixed++;
  } catch (e) {
    failed++;
    console.log(`${item.name ?? item.id}: FAILED — ${e.message}`);
  }
}
console.log(`\n${APPLY ? "fixed" : "would fix"} ${fixed}, already fine ${ok}, failed ${failed} (of ${items.length})`);
