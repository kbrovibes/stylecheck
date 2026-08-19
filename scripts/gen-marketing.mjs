import { readFileSync, writeFileSync } from 'fs';
import { GoogleGenAI } from '@google/genai';
for (const line of readFileSync('.env.local','utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const STYLE = "Quiet-luxury editorial aesthetic: ivory and warm bone backgrounds, camel/tan accents, soft studio light, generous negative space, minimal, premium — The Row lookbook meets Aesop store. No text, no logos, no watermarks.";
const SHOTS = [
  ["banner", `A wide cinematic photograph of a luxurious minimal walk-in wardrobe: long brass rail with neutral-toned garments on wooden hangers on the left, folded knits and clean sneakers on light-oak shelves right, one camel overshirt as the color accent. 16:9. ${STYLE}`],
  ["mannequin", `Full-body studio photograph of a stylish man in his 30s standing relaxed against a soft ivory seamless backdrop, wearing a plain heather-grey t-shirt and dark slim jeans, white sneakers — like a fashion-app avatar render. 3:4 portrait. ${STYLE}`],
  ["wardrobe", `A tidy grid flat-lay of wardrobe pieces photographed like premium e-commerce product shots on pure white tiles: a sage tee, camel overshirt, washed denim, white leather sneakers, a woven belt, arranged with perfect spacing. 3:4 portrait. ${STYLE}`],
  ["fits", `Fashion lookbook triptych feel: the same man from a studio avatar shown in one elegant outfit — camel overshirt over white tee, dark jeans, white sneakers — full body, head to shoes, ivory backdrop, editorial catalogue quality. 3:4 portrait. ${STYLE}`],
];
for (const [name, prompt] of SHOTS) {
  const res = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });
  let got = null;
  for (const c of res.candidates ?? []) for (const p of c.content?.parts ?? []) if (p.inlineData?.data) got = p.inlineData;
  if (!got) { console.log(name, 'FAILED'); continue; }
  const buf = Buffer.from(got.data, 'base64');
  writeFileSync(`public/intro/${name}.jpg`, buf);
  writeFileSync(`docs/media/${name}.jpg`, buf);
  console.log(name, 'ok', Math.round(buf.length/1024), 'KB');
}
