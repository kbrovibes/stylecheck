import { readFileSync } from 'fs';
import { GoogleGenAI } from '@google/genai';
for (const line of readFileSync('.env.local','utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
try {
  const res = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: [{ role: 'user', parts: [{ text: 'A single white sneaker product photo on white background.' }] }],
  });
  let got = null;
  for (const c of res.candidates ?? []) for (const p of c.content?.parts ?? []) if (p.inlineData?.data) got = p.inlineData;
  console.log('gemini-3-pro-image-preview:', got ? `OK (${Math.round(got.data.length*3/4/1024)}KB)` : 'no image');
} catch (e) {
  console.log('gemini-3-pro-image-preview FAILED:', e.message?.slice(0, 200));
}
