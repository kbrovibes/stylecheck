import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImageInput } from "@/lib/ai/gemini";

export const BUCKET = "stylecheck";

export async function downloadAsImageInput(
  supabase: SupabaseClient,
  path: string
): Promise<ImageInput> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`storage download failed: ${path} ${error?.message}`);
  const buf = Buffer.from(await data.arrayBuffer());
  const ext = path.split(".").pop()?.toLowerCase();
  const mimeType =
    ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return { mimeType, data: buf.toString("base64") };
}

export async function uploadBase64(
  supabase: SupabaseClient,
  path: string,
  base64: string,
  contentType: string
) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, Buffer.from(base64, "base64"), { contentType, upsert: true });
  if (error) throw new Error(`storage upload failed: ${path} ${error.message}`);
  return path;
}

export async function signedUrl(
  supabase: SupabaseClient,
  path: string,
  expiresIn = 3600
) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error || !data) throw new Error(`sign failed: ${path} ${error?.message}`);
  return data.signedUrl;
}

export async function signedUrls(
  supabase: SupabaseClient,
  paths: string[],
  expiresIn = 3600
): Promise<Record<string, string>> {
  const clean = paths.filter(Boolean);
  if (!clean.length) return {};
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(clean, expiresIn);
  if (error || !data) return {};
  const map: Record<string, string> = {};
  data.forEach((d) => {
    if (d.signedUrl && d.path) map[d.path] = d.signedUrl;
  });
  return map;
}

export function extFromMime(mime: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}
