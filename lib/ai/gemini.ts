import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | null = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export interface ImageInput {
  mimeType: string;
  data: string; // base64
}

function stripFences(text: string) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
}

/** Vision + text call returning parsed JSON. */
export async function geminiJson<T>(opts: {
  model: string;
  prompt: string;
  images?: ImageInput[];
}): Promise<T> {
  const ai = getClient();
  const parts: object[] = [
    ...(opts.images ?? []).map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.data },
    })),
    { text: opts.prompt },
  ];
  const res = await ai.models.generateContent({
    model: opts.model,
    contents: [{ role: "user", parts }],
    config: { responseMimeType: "application/json" },
  });
  const text = res.text;
  if (!text) throw new Error("empty response from Gemini");
  return JSON.parse(stripFences(text)) as T;
}

export type MixedPart = { text: string } | { image: ImageInput };

/**
 * Image generation from interleaved text/image parts. Labeling each reference
 * image with a text part right before it ("THE PERSON:", "ITEM 1:") makes the
 * model bind references correctly — critical for identity preservation.
 */
export async function geminiImageParts(opts: {
  model: string;
  parts: MixedPart[];
}): Promise<{ data: string; mimeType: string }> {
  const ai = getClient();
  const parts: object[] = opts.parts.map((p) =>
    "text" in p
      ? { text: p.text }
      : { inlineData: { mimeType: p.image.mimeType, data: p.image.data } }
  );
  const res = await ai.models.generateContent({
    model: opts.model,
    contents: [{ role: "user", parts }],
  });
  for (const c of res.candidates ?? []) {
    for (const part of c.content?.parts ?? []) {
      const inline = (part as { inlineData?: { data?: string; mimeType?: string } }).inlineData;
      if (inline?.data) {
        return { data: inline.data, mimeType: inline.mimeType ?? "image/png" };
      }
    }
  }
  const textOut = res.text?.slice(0, 300);
  throw new Error(`Gemini returned no image${textOut ? `: ${textOut}` : ""}`);
}

/** Image generation (nano banana). Returns base64 PNG. */
export async function geminiImage(opts: {
  model: string;
  prompt: string;
  images?: ImageInput[];
}): Promise<{ data: string; mimeType: string }> {
  const ai = getClient();
  const parts: object[] = [
    ...(opts.images ?? []).map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.data },
    })),
    { text: opts.prompt },
  ];
  const res = await ai.models.generateContent({
    model: opts.model,
    contents: [{ role: "user", parts }],
  });
  const candidates = res.candidates ?? [];
  for (const c of candidates) {
    for (const part of c.content?.parts ?? []) {
      const inline = (part as { inlineData?: { data?: string; mimeType?: string } }).inlineData;
      if (inline?.data) {
        return { data: inline.data, mimeType: inline.mimeType ?? "image/png" };
      }
    }
  }
  const textOut = res.text?.slice(0, 300);
  throw new Error(`Gemini returned no image${textOut ? `: ${textOut}` : ""}`);
}
