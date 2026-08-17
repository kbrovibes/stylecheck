import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
  if (path.includes("..")) return new Response("forbidden", { status: 403 });

  // Own-folder files are always visible; anything else must be referenced by a
  // row (photo/item/render/person) the caller can view — covers shared people.
  if (!path.startsWith(`${user.id}/`)) {
    const { data: allowed } = await supabase.rpc("sc_can_view_path", { p: path });
    if (!allowed) return new Response("forbidden", { status: 403 });
  }

  // Admin download: storage RLS is folder-based and doesn't know about shares.
  const { data, error } = await createAdminClient()
    .storage.from(BUCKET)
    .download(path);
  if (error || !data) return new Response("not found", { status: 404 });

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return new Response(data.stream(), {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
