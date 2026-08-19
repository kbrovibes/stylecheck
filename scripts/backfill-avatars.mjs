// One-off: generate face-close-up avatars for all people with a base render.
import { readFileSync } from 'fs';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

for (const line of readFileSync('.env.local','utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const { data: people } = await supabase.from('sc_people').select('*').eq('deleted', false).not('base_render_path', 'is', null);
for (const person of people ?? []) {
  try {
    const { data: file } = await supabase.storage.from('stylecheck').download(person.base_render_path);
    const buf = Buffer.from(await file.arrayBuffer());
    const meta = await sharp(buf).metadata();
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType: 'image/png', data: buf.toString('base64') } },
        { text: 'Locate the person\'s head (including all hair). Respond JSON only: {"x":n,"y":n,"w":n,"h":n} — tightest head bounding box, normalized 0..1.' },
      ]}],
      config: { responseMimeType: 'application/json' },
    });
    const box = JSON.parse(res.text.replace(/^```(json)?|```$/g, '').trim());
    const W = meta.width, H = meta.height;
    const cx = (box.x + box.w / 2) * W, cy = (box.y + box.h / 2) * H;
    const side = Math.min(Math.max(box.w * W, box.h * H) * 1.7, Math.min(W, H));
    const left = Math.round(Math.min(Math.max(cx - side / 2, 0), W - side));
    const top = Math.round(Math.min(Math.max(cy - side / 2, 0), H - side));
    const out = await sharp(buf).extract({ left, top, width: Math.round(side), height: Math.round(side) }).resize(256, 256).jpeg({ quality: 85 }).toBuffer();
    const path = `${person.owner_id}/avatars/${person.id}-${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage.from('stylecheck').upload(path, out, { contentType: 'image/jpeg' });
    if (upErr) throw upErr;
    await supabase.from('sc_people').update({ avatar_path: path }).eq('id', person.id);
    console.log(person.name, '→', path);
  } catch (e) {
    console.log(person.name, 'FAILED:', e.message?.slice(0, 120));
  }
}
