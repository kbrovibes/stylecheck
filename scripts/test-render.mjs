import { readFileSync, writeFileSync } from 'fs';
import { GoogleGenAI } from '@google/genai';
for (const line of readFileSync('.env.local','utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}
const S = process.argv[2]; // scratch dir
const img = (f) => ({ inlineData: { mimeType: 'image/png', data: readFileSync(`${S}/${f}`).toString('base64') } });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const res = await ai.models.generateContent({
  model: 'gemini-3-pro-image-preview',
  contents: [{ role: 'user', parts: [
    { text: 'BASE IMAGE — the photograph to edit. The person in it must remain pixel-faithful except for their clothing:' },
    img('base.png'),
    { text: 'ITEM 1 — Jack & Jones Yellow Crewneck T-shirt (top, yellow):' }, img('tee.png'),
    { text: 'ITEM 2 — Light Blue Washed Jeans (bottom, blue):' }, img('jeans.png'),
    { text: 'ITEM 3 — White Puma Low-Top Sneakers (footwear, white):' }, img('shoes.png'),
    { text: `TASK: Wardrobe swap. Edit the BASE IMAGE — change ONLY the clothing.

KEEP IDENTICAL TO THE BASE IMAGE (do not regenerate or alter): the person — their exact face, expression, hair, skin tone, facial hair, glasses/no-glasses, body proportions — plus the pose, camera framing, lighting and the ivory studio background. This must remain the same photograph of the same person, with new clothes on.

REPLACE the outfit with exactly these labeled wardrobe items: top: Jack & Jones Yellow Crewneck T-shirt (yellow); bottom: Light Blue Washed Jeans (blue); footwear: White Puma Low-Top Sneakers (white).
- Each garment must match its reference image faithfully: same color, pattern, fabric and details. Do not redesign or substitute.
- Fit the garments naturally to this person's build.
- Full frame, head to shoes visible, photorealistic, 3:4 portrait.` },
  ]}],
});
let got = null;
for (const c of res.candidates ?? []) for (const p of c.content?.parts ?? []) if (p.inlineData?.data) got = p.inlineData;
if (!got) { console.log('NO IMAGE:', res.text?.slice(0,200)); process.exit(1); }
writeFileSync(`${S}/test-out.png`, Buffer.from(got.data, 'base64'));
console.log('render ok', Math.round(got.data.length*3/4/1024), 'KB');
