// One-off: normalize every existing catalogue shot to the fixed-scale house
// canvas (trim → 76% box on 1000px white square). No AI involved.
import { readFileSync } from 'fs';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
for (const line of readFileSync('.env.local','utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: items } = await admin.from('sc_wardrobe_items')
  .select('id, user_id, name, catalog_image_path')
  .eq('deleted', false).not('catalog_image_path', 'is', null);

let ok = 0, fail = 0;
for (const item of items ?? []) {
  try {
    const { data: file, error } = await admin.storage.from('stylecheck').download(item.catalog_image_path);
    if (error) throw error;
    const buf = Buffer.from(await file.arrayBuffer());
    const trimmed = await sharp(buf).flatten({ background: '#ffffff' }).trim({ threshold: 18 }).toBuffer();
    const CANVAS = 1000, BOX = 760;
    const inner = await sharp(trimmed).resize(BOX, BOX, { fit: 'inside', withoutEnlargement: false }).toBuffer();
    const meta = await sharp(inner).metadata();
    const out = await sharp({ create: { width: CANVAS, height: CANVAS, channels: 3, background: '#ffffff' } })
      .composite([{ input: inner, left: Math.round((CANVAS - meta.width) / 2), top: Math.round((CANVAS - meta.height) / 2) }])
      .jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    const path = `${item.user_id}/catalog/${item.id}-${Date.now()}-norm.jpg`;
    const { error: upErr } = await admin.storage.from('stylecheck').upload(path, out, { contentType: 'image/jpeg' });
    if (upErr) throw upErr;
    await admin.from('sc_wardrobe_items').update({ catalog_image_path: path }).eq('id', item.id);
    ok++;
  } catch (e) { fail++; console.log('fail:', item.name, e.message?.slice(0, 80)); }
}
console.log(`normalized ${ok}, failed ${fail} of ${(items ?? []).length}`);
