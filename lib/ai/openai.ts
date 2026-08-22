// OpenAI provider slot. Wired but intentionally minimal for v1 — enable by
// setting OPENAI_API_KEY and flipping the provider in Settings.
import type { ImageInput } from "./gemini";

function assertKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OpenAI provider selected but OPENAI_API_KEY is not set. Add it to .env.local / Vercel env, or switch back to Gemini in Settings."
    );
  }
}

export async function openaiJson<T>(opts: {
  model: string;
  prompt: string;
  images?: ImageInput[];
}): Promise<T> {
  assertKey();
  const content: object[] = [
    { type: "text", text: opts.prompt },
    ...(opts.images ?? []).map((img) => ({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.data}` },
    })),
  ];
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: "user", content }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return JSON.parse(json.choices[0].message.content) as T;
}

export async function openaiImage(opts: {
  model: string;
  prompt: string;
  images?: ImageInput[];
}): Promise<{ data: string; mimeType: string }> {
  assertKey();
  // gpt-image-1 edit endpoint supports reference images; v1 uses generation with
  // a descriptive prompt only. Reference-image support tracked in BACKLOG.
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      prompt: opts.prompt,
      size: "1024x1536",
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return { data: json.data[0].b64_json, mimeType: "image/png" };
}

/** gpt-image-1 edits endpoint: reference images + prompt (identity-capable). */
export async function openaiImageEdit(opts: {
  model: string;
  prompt: string;
  images: ImageInput[];
}): Promise<{ data: string; mimeType: string }> {
  assertKey();
  const form = new FormData();
  form.append("model", opts.model);
  form.append("prompt", opts.prompt.slice(0, 30000));
  form.append("size", "1024x1536");
  form.append("quality", "high");
  for (const [i, img] of opts.images.slice(0, 10).entries()) {
    const bytes = Buffer.from(img.data, "base64");
    form.append(
      "image[]",
      new Blob([new Uint8Array(bytes)], { type: img.mimeType }),
      `ref-${i}.${img.mimeType.includes("png") ? "png" : "jpg"}`
    );
  }
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI edit error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return { data: json.data[0].b64_json, mimeType: "image/png" };
}
