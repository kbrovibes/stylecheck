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
