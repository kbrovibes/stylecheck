// Re-shoot catalogue product shots for specific items (house style), keeping
// old images in place — only catalog_image_path moves to the new file.
//   node scripts/reshoot-items.mjs <itemId> [itemId...]
// Mirrors lib/catalog.ts + lib/ai/prompts.ts catalogImagePrompt + lib/img-server.ts.
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
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
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
const IMAGE_MODEL = "gemini-2.5-flash-image";

function catalogPrompt(item) {
  const target = `TARGET ITEM — extract exactly this one item from the photo (the photo may show a person wearing several pieces, or multiple items together): ${item.name ?? item.subcategory ?? item.category} — ${item.description ?? ""} (${item.category}${item.subcategory ? `, ${item.subcategory}` : ""}${item.primary_color ? `, ${item.primary_color}` : ""}).`;
  return `Create a clean e-commerce product photo of one specific item from this photo.
${target}
- Same exact item: same color, pattern, fabric and details — do not redesign it. If it is being worn, isolate it off the body.
- PRESENTATION — follow the house style for the item's type EXACTLY (every catalogue image must match this standard):
  - Tops, shirts, t-shirts, knits, outerwear, dresses/jumpsuits: GHOST-MANNEQUIN style — the garment filled out in its natural worn 3D shape (invisible person), facing straight-on, sleeves relaxed at the sides. Never folded, never flat-lay, never on a hanger.
  - Bottoms (jeans, trousers, shorts): ghost-mannequin worn shape, straight-on, full length, waistband at top.
  - Footwear: the PAIR side by side, angled 3/4 view with the toes pointing toward the LEFT edge of the frame, ground shadow only. NEVER facing right, never a single shoe, never a straight-on front view.
  - Accessories, belts, bags, headwear, eyewear: single centered product shot, natural presentation (belt coiled once, bag upright).
- Centered on a pure white background (#FFFFFF); the item fills roughly three-quarters of the frame height with even margins.
- Soft studio lighting, no props, no person, no other items, no text or watermarks.
- Square aspect ratio.`;
}

async function contentBBox(flat) {
  const { data, info } = await sharp(flat).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rowCounts = new Uint32Array(height);
  const colCounts = new Uint32Array(width);
  let total = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[y * width + x] < 225) { rowCounts[y]++; colCounts[x]++; total++; }
  const CLIP = Math.max(1, Math.round(total * 0.004));
  const edge = (counts, from) => {
    let acc = 0;
    if (from === "start") {
      for (let i = 0; i < counts.length; i++) { acc += counts[i]; if (acc > CLIP) return i; }
      return counts.length - 1;
    }
    for (let i = counts.length - 1; i >= 0; i--) { acc += counts[i]; if (acc > CLIP) return i; }
    return 0;
  };
  return { minX: edge(colCounts, "start"), maxX: edge(colCounts, "end"), minY: edge(rowCounts, "start"), maxY: edge(rowCounts, "end"), width, height };
}

async function normalize(buf) {
  const flat = await sharp(buf).flatten({ background: "#ffffff" }).toBuffer();
  const b = await contentBBox(flat);
  let trimmed;
  if (b.maxX - b.minX < b.width * 0.04 || b.maxY - b.minY < b.height * 0.04) {
    trimmed = await sharp(flat).trim({ threshold: 45 }).toBuffer();
  } else {
    const pad = Math.round(Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.02);
    const left = Math.max(0, b.minX - pad);
    const top = Math.max(0, b.minY - pad);
    trimmed = await sharp(flat).extract({
      left, top,
      width: Math.min(b.width, b.maxX + pad + 1) - left,
      height: Math.min(b.height, b.maxY + pad + 1) - top,
    }).toBuffer();
  }
  const CANVAS = 1000, BOX = 900;
  const inner = await sharp(trimmed).resize(BOX, BOX, { fit: "inside", withoutEnlargement: false }).toBuffer();
  const meta = await sharp(inner).metadata();
  return sharp({ create: { width: CANVAS, height: CANVAS, channels: 3, background: "#ffffff" } })
    .composite([{ input: inner, left: Math.round((CANVAS - meta.width) / 2), top: Math.round((CANVAS - meta.height) / 2) }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

async function dominantColorHex(buf) {
  const { data, info } = await sharp(buf).flatten({ background: "#ffffff" }).resize(64, 64, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
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
  const hex = (s) => Math.round(s / best.n).toString(16).padStart(2, "0");
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

for (const id of process.argv.slice(2)) {
  try {
    const { data: item, error } = await admin.from("sc_wardrobe_items").select("*").eq("id", id).single();
    if (error || !item) throw new Error(error?.message ?? "not found");
    const { data: orig, error: dlErr } = await admin.storage.from("stylecheck").download(item.original_image_path);
    if (dlErr) throw dlErr;
    const origB64 = Buffer.from(await orig.arrayBuffer()).toString("base64");

    const res = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ role: "user", parts: [
        { inlineData: { mimeType: "image/jpeg", data: origB64 } },
        { text: catalogPrompt(item) },
      ]}],
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) throw new Error("no image in response");

    const jpeg = await normalize(Buffer.from(part.inlineData.data, "base64"));
    const colorHex = await dominantColorHex(jpeg);
    const path = `${item.user_id}/catalog/${item.id}-${Date.now()}-r1.jpg`;
    const { error: upErr } = await admin.storage.from("stylecheck").upload(path, jpeg, { contentType: "image/jpeg" });
    if (upErr) throw upErr;
    await admin.from("sc_wardrobe_items").update({ catalog_image_path: path, catalog_source: "generated", color_hex: colorHex }).eq("id", item.id);
    await admin.from("sc_renders").insert({
      user_id: item.user_id,
      subject_type: "item_catalog",
      subject_id: item.id,
      storage_path: path,
      model: IMAGE_MODEL,
      prompt_summary: `catalogue re-shoot: ${item.name ?? item.category}`,
    });
    console.log(`OK   ${item.name} → ${path} (${colorHex})`);
  } catch (e) {
    console.log(`FAIL ${id}: ${e.message}`);
  }
}
