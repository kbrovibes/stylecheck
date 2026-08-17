import { requireUser } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/storage";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Authenticated image proxy with immutable caching. Storage paths are
 * timestamped and never rewritten, so the browser can cache them forever —
 * unlike signed URLs, whose per-request tokens defeat caching entirely.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  let supabase, user;
  try {
    ({ supabase, user } = await requireUser());
  } catch {
    return new Response("unauthorized", { status: 401 });
  }
  const { path: parts } = await params;
  const path = parts.map(decodeURIComponent).join("/");
  if (!path.startsWith(`${user.id}/`) || path.includes("..")) {
    return new Response("forbidden", { status: 403 });
  }

  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return new Response("not found", { status: 404 });

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return new Response(data.stream(), {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
