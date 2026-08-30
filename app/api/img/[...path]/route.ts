import { createClient } from "@/lib/supabase/server";
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
 *
 * A gallery fires dozens of these at once, so the auth check is the hot path:
 * `getUser()` calls the auth server over the network every time, which on a
 * cold gallery meant one round trip per image before a single byte moved.
 * `getClaims()` verifies the JWT locally with WebCrypto against a cached JWKS
 * (this project signs with ES256), so it is the same guarantee without the
 * round trip. It falls back to `getUser()` if local verification isn't
 * possible, which is also what it does internally for symmetric secrets.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const supabase = await createClient();

  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    if (typeof sub === "string") userId = sub;
  } catch {
    // fall through to the network check
  }
  if (!userId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }
  if (!userId) return new Response("unauthorized", { status: 401 });

  const { path: parts } = await params;
  const path = parts.map(decodeURIComponent).join("/");
  if (path.includes("..")) return new Response("forbidden", { status: 403 });

  // Own-folder files are always visible; anything else must be referenced by a
  // row (photo/item/render/person) the caller can view — covers shared people.
  if (!path.startsWith(`${userId}/`)) {
    const { data: allowed } = await supabase.rpc("sc_can_view_path", { p: path });
    if (!allowed) return new Response("forbidden", { status: 403 });
  }

  // Content at a given path never changes, so the path itself is the version.
  const etag = `"${Buffer.from(path).toString("base64url").slice(0, 32)}"`;
  const cacheHeaders = {
    "Cache-Control": "private, max-age=31536000, immutable",
    // Keeps one browser profile from serving another account's image after a
    // sign-out, since `private` caches are keyed only by URL.
    Vary: "Cookie",
    ETag: etag,
  };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }

  // Admin download: storage RLS is folder-based and doesn't know about shares.
  const { data, error } = await createAdminClient()
    .storage.from(BUCKET)
    .download(path);
  if (error || !data) return new Response("not found", { status: 404 });

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return new Response(data.stream(), {
    headers: {
      ...cacheHeaders,
      "Content-Type": MIME[ext] ?? "application/octet-stream",
    },
  });
}
