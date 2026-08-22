import sharp from "sharp";

/**
 * Server-only: convert generated images (Gemini returns hefty PNGs, ~1.5 MB)
 * to JPEG before storage — ~6× smaller with no visible quality loss, which
 * matters on a shared storage pool.
 */
export async function toJpegBase64(
  base64: string,
  quality = 86
): Promise<{ data: string; mimeType: string }> {
  const out = await sharp(Buffer.from(base64, "base64"))
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  return { data: out.toString("base64"), mimeType: "image/jpeg" };
}

/**
 * Dominant garment color from a product shot on white: quantize non-background
 * pixels to coarse buckets and average the biggest bucket. Null when the image
 * is essentially all white (detection failed / white garment edge case).
 */
export async function dominantColorHex(base64: string): Promise<string | null> {
  const { data, info } = await sharp(Buffer.from(base64, "base64"))
    .flatten({ background: "#ffffff" })
    .resize(64, 64, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 235 && g > 235 && b > 235) continue; // white background
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    counts.set(key, e);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  if (!best || best.n < 20) return null;
  const hex = (sum: number) =>
    Math.round(sum / best!.n).toString(16).padStart(2, "0");
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

/**
 * Catalogue alignment: trim the shot's white margins, then place the garment on
 * a fixed 1000px white square filling ~90% of the frame, centered. Every tile
 * ends up with identical scale and padding, like a real retail catalogue.
 */
export async function normalizeProductShot(base64: string): Promise<{ data: string; mimeType: string }> {
  const flat = await sharp(Buffer.from(base64, "base64"))
    .flatten({ background: "#ffffff" })
    .toBuffer();
  // sharp's trim() gives up on the faint background gradients AI shots often
  // have, leaving the garment tiny in the frame. Find the content bounding box
  // ourselves: scan greyscale pixels darker than near-white, ignoring speckle.
  const { data, info } = await sharp(flat)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const THRESH = 225; // strong content only — faint bg gradients stay invisible
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
  // Percentile bbox: clip a sliver of dark mass per side so a stray smudge or
  // compression artifact can't stretch the box — the garment defines it.
  const CLIP = Math.max(1, Math.round(total * 0.004));
  const edge = (counts: Uint32Array, from: "start" | "end") => {
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
  const minY = edge(rowCounts, "start");
  const maxY = edge(rowCounts, "end");
  const minX = edge(colCounts, "start");
  const maxX = edge(colCounts, "end");

  let trimmed: Buffer;
  if (maxX - minX < width * 0.04 || maxY - minY < height * 0.04) {
    // Detection found (almost) nothing — likely a white-on-white garment.
    // Fall back to sharp's trim rather than cropping to noise.
    trimmed = await sharp(flat).trim({ threshold: 45 }).toBuffer();
  } else {
    const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.02);
    const left = Math.max(0, minX - pad);
    const top = Math.max(0, minY - pad);
    trimmed = await sharp(flat)
      .extract({
        left,
        top,
        width: Math.min(width, maxX + pad + 1) - left,
        height: Math.min(height, maxY + pad + 1) - top,
      })
      .toBuffer();
  }
  const CANVAS = 1000;
  const BOX = Math.round(CANVAS * 0.9); // garment fills ~90% — just a little breathing room
  const inner = await sharp(trimmed)
    .resize(BOX, BOX, { fit: "inside", withoutEnlargement: false })
    .toBuffer();
  const meta = await sharp(inner).metadata();
  const left = Math.round((CANVAS - (meta.width ?? BOX)) / 2);
  const top = Math.round((CANVAS - (meta.height ?? BOX)) / 2);
  const out = await sharp({
    create: { width: CANVAS, height: CANVAS, channels: 3, background: "#ffffff" },
  })
    .composite([{ input: inner, left, top }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return { data: out.toString("base64"), mimeType: "image/jpeg" };
}
