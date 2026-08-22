// Download all footwear catalogue shots for visual review.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const outDir = process.argv[2];
const { data: items } = await admin
  .from("sc_wardrobe_items")
  .select("id, name, catalog_image_path")
  .eq("deleted", false)
  .eq("category", "footwear")
  .not("catalog_image_path", "is", null);
for (const item of items) {
  const { data: file, error } = await admin.storage
    .from("stylecheck")
    .download(item.catalog_image_path);
  if (error) { console.log(item.id, "DL FAIL", error.message); continue; }
  const out = `${outDir}/shoe-${item.id}.jpg`;
  writeFileSync(out, Buffer.from(await file.arrayBuffer()));
  console.log(`${item.id} | ${item.name}`);
}
