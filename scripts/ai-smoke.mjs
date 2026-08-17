import { readFileSync } from 'fs';
import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';

for (const line of readFileSync('.env.local','utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// tiny synthetic "garment" image
const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 140, g: 160, b: 120 } } }).png().toBuffer();

// 1) vision + JSON (classification path)
const r1 = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: [{ role: 'user', parts: [
    { inlineData: { mimeType: 'image/png', data: png.toString('base64') } },
    { text: 'Respond with JSON only: {"kind":"item"|"person"|"unusable"}' },
  ]}],
  config: { responseMimeType: 'application/json' },
});
console.log('JSON path OK:', r1.text?.slice(0, 60));

// 2) image generation (nano banana path)
const r2 = await ai.models.generateContent({
  model: 'gemini-2.5-flash-image',
  contents: [{ role: 'user', parts: [{ text: 'A plain white crewneck t-shirt product photo on a pure white background, studio lighting, square.' }] }],
});
let got = null;
for (const c of r2.candidates ?? []) for (const p of c.content?.parts ?? []) if (p.inlineData?.data) got = p.inlineData;
console.log('IMAGE path OK:', got ? `${got.mimeType}, ${Math.round(got.data.length*3/4/1024)}KB` : 'NO IMAGE RETURNED');
