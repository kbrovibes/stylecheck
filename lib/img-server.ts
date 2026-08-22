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
 * Catalogue alignment: trim the shot's white margins, then place the garment on
 * a fixed 1000px white square filling ~76% of the frame, centered. Every tile
 * ends up with identical scale and padding, like a real retail catalogue.
 */
export async function normalizeProductShot(base64: string): Promise<{ data: string; mimeType: string }> {
  const src = sharp(Buffer.from(base64, "base64"));
  const trimmed = await src
    .flatten({ background: "#ffffff" })
    .trim({ threshold: 18 })
    .toBuffer();
  const CANVAS = 1000;
  const BOX = Math.round(CANVAS * 0.76);
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
