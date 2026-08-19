import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Person } from "@/lib/types";
import { geminiJson } from "@/lib/ai/gemini";
import { BUCKET, downloadAsImageInput, uploadBase64 } from "@/lib/storage";

const BBOX_PROMPT = `Locate the person's head (including all hair) in this image. Respond with JSON only:
{"x": number, "y": number, "w": number, "h": number}
— the tightest bounding box around the head, normalized 0..1 relative to image width/height.`;

/**
 * Cut a proper face close-up from the person's base render (vision-located,
 * sharp-cropped) and store it as their avatar. Called after mannequin saves.
 */
export async function generateFaceAvatar(
  supabase: SupabaseClient,
  writerUserId: string,
  person: Person
) {
  if (!person.base_render_path) return null;
  const img = await downloadAsImageInput(supabase, person.base_render_path);
  const buf = Buffer.from(img.data, "base64");
  const meta = await sharp(buf).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error("could not read render dimensions");

  const box = await geminiJson<{ x: number; y: number; w: number; h: number }>({
    model: "gemini-2.5-flash",
    prompt: BBOX_PROMPT,
    images: [img],
  });

  // Expand to a comfortable square headshot around the head box.
  const cx = (box.x + box.w / 2) * W;
  const cy = (box.y + box.h / 2) * H;
  const side = Math.min(
    Math.max(box.w * W, box.h * H) * 1.7,
    Math.min(W, H)
  );
  const left = Math.round(Math.min(Math.max(cx - side / 2, 0), W - side));
  const top = Math.round(Math.min(Math.max(cy - side / 2, 0), H - side));

  const out = await sharp(buf)
    .extract({ left, top, width: Math.round(side), height: Math.round(side) })
    .resize(256, 256)
    .jpeg({ quality: 85 })
    .toBuffer();

  const path = `${writerUserId}/avatars/${person.id}-${Date.now()}.jpg`;
  await uploadBase64(supabase, path, out.toString("base64"), "image/jpeg");
  await supabase.from("sc_people").update({ avatar_path: path }).eq("id", person.id);
  return path;
}

export { BUCKET };
