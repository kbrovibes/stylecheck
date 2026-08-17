import type {
  Outfit,
  Profile,
  RenderAdjustments,
  Settings,
  WardrobeItem,
  WeatherInfo,
} from "@/lib/types";

const DIAL_PHRASES: Record<string, string[]> = {
  build: [
    "noticeably leaner and less muscular than the reference suggests",
    "slightly leaner, softer muscle definition",
    "",
    "slightly more toned and athletic",
    "noticeably more muscular and built",
  ],
  shoulders: [
    "noticeably narrower shoulders",
    "slightly narrower shoulders",
    "",
    "slightly broader shoulders",
    "noticeably broader shoulders",
  ],
  waist: [
    "noticeably slimmer waist and midsection",
    "slightly slimmer waist",
    "",
    "slightly fuller waist and midsection",
    "noticeably fuller waist and midsection",
  ],
};

function bodyCalibration(adj: RenderAdjustments | null | undefined): string {
  if (!adj) return "";
  const clamp = (n: number) => Math.max(-2, Math.min(2, Math.round(n || 0)));
  const lines = (["build", "shoulders", "waist"] as const)
    .map((k) => DIAL_PHRASES[k][clamp(adj[k]) + 2])
    .filter(Boolean);
  if (adj.note?.trim()) lines.push(adj.note.trim());
  if (!lines.length) return "";
  return `\nBODY CALIBRATION (user-verified corrections — the reference photos slightly misrepresent their real physique; apply these on top of height/weight, but NEVER let them alter the face):
${lines.map((l) => `- ${l}`).join("\n")}`;
}

export const CLASSIFY_PROMPT = `You are a fashion cataloguer for a personal wardrobe app.
Look at this image and classify it. Respond with JSON only, matching this schema:

{
  "kind": "person" | "item" | "unusable",
  "person": { "photo_kind": "selfie" | "full_body" | "half_body" | "unknown", "notes": string },
  "item": {
    "category": "top" | "bottom" | "outerwear" | "footwear" | "accessory" | "belt" | "eyewear" | "headwear" | "bag" | "full_body",
    "subcategory": string,        // e.g. "crewneck t-shirt", "slim chinos", "chelsea boots"
    "name": string,               // short catalogue name, e.g. "Sage Green Crewneck Tee"
    "description": string,        // 1-2 sentence product-style description
    "colors": string[],
    "primary_color": string,
    "pattern": string,            // solid, striped, plaid, graphic, ...
    "material": string,           // best guess: cotton, denim, leather, knit, ...
    "seasons": ("spring"|"summer"|"fall"|"winter")[],
    "formality": "casual" | "smart_casual" | "business" | "formal" | "athletic" | "lounge",
    "style_tags": string[]        // e.g. ["minimal", "streetwear", "classic"]
  }
}

Rules:
- If the image shows a person (face or body visible, worn outfit, selfie), kind = "person". Include "person", omit "item".
- If it shows clothing/footwear/accessories (laid flat, hung, or on a surface), kind = "item". Include "item", omit "person".
- If it is blurry, irrelevant, or not fashion related, kind = "unusable".
- "full_body" category is for one-piece garments (dresses, jumpsuits, overalls).`;

export function composeOutfitsPrompt(opts: {
  profile: Profile;
  items: WardrobeItem[];
  weather: WeatherInfo | null;
  settings: Settings;
  count: number;
  occasion?: string;
}) {
  const { profile, items, weather, settings, count, occasion } = opts;
  const itemLines = items
    .map(
      (i) =>
        `- id=${i.id} | ${i.category}${i.subcategory ? `/${i.subcategory}` : ""} | ${i.name ?? "unnamed"} | colors: ${i.colors.join(",") || i.primary_color || "?"} | pattern: ${i.pattern ?? "?"} | material: ${i.material ?? "?"} | seasons: ${i.seasons.join(",") || "any"} | formality: ${i.formality ?? "?"} | tags: ${i.style_tags.join(",")}`
    )
    .join("\n");

  const optional: string[] = [];
  if (!settings.generate_accessories) optional.push("do NOT include accessories");
  if (!settings.generate_shoes) optional.push("footwear is optional");
  if (!settings.generate_belts) optional.push("do NOT include belts");
  optional.push("NEVER include eyewear/glasses (unsupported)");

  return `You are a modern minimal fashion stylist — think quiet luxury, clean lines, intentional color.
Build ${count} distinct outfits for this person from ONLY the wardrobe items listed below.

PERSON: height ${profile.height_cm ?? "?"} cm, weight ${profile.weight_kg ?? "?"} kg.
${weather ? `CURRENT WEATHER in ${weather.place}: ${weather.condition}, ${weather.temp_f}°F (high ${weather.high_f} / low ${weather.low_f}), season: ${weather.season}.` : "Weather unknown — cover multiple seasons."}
${occasion ? `FOCUS OCCASION: ${occasion}.` : "Cover a spread of occasions: work, casual, friends, date."}

WARDROBE:
${itemLines}

CONSTRAINTS:
- ${optional.join("\n- ")}
- Each outfit needs at minimum a top + bottom (or one full_body piece) and footwear if available.
- Match formality to occasion: no shorts/flip-flops for work; no athletic wear on date night unless styled deliberately.
- Consider color harmony, proportion for their build, season, and the current weather.
- Prefer variety across the set — different anchors, not five variations of one look.

Respond with JSON only:
{
  "outfits": [
    {
      "title": string,                    // editorial name, e.g. "Off-Duty Monochrome"
      "item_ids": string[],               // ids from the wardrobe above
      "occasion": "work"|"casual"|"friends"|"date"|"active"|"lounge",
      "seasons": ("spring"|"summer"|"fall"|"winter")[],
      "explanation": string,              // 2-3 sentences on WHY this works for THIS person (build, coloring, weather, occasion)
      "styling_notes": string,            // tuck/cuff/layer guidance
      "weather_note": string,             // one line tying it to current weather, or ""
      "score": number,                    // 0-10 stylist confidence
      "variations": [                     // subtle single-item swaps that also work
        { "label": string, "swap_out": string, "swap_in": string }   // item ids
      ]
    }
  ]
}`;
}

function identityLock(personImageCount: number) {
  const n = personImageCount || 1;
  return `IDENTITY LOCK — the single most important instruction:
The first ${n} image${n > 1 ? "s" : ""} show${n > 1 ? "" : "s"} the real person. Their face is immutable ground truth — treat this task as re-photographing the SAME person, not generating a similar one.
- Copy the exact facial geometry: eye shape and spacing, eyebrows, nose, lips, jawline, cheekbones, ears.
- Copy the exact skin tone and texture, complexion marks, hairstyle, hairline, and any facial hair precisely as shown.
- Do NOT beautify, slim, de-age, stylize, or "improve" the face in any way. The output must be instantly recognizable as this exact individual, as if taken in the same photo session.
- Keep eyewear exactly as in the reference photos: do not add or remove glasses.
- If any other instruction conflicts with preserving this face, preserving the face wins.`;
}

export function renderOutfitPrompt(opts: {
  profile: Profile;
  items: WardrobeItem[];
  outfit: Pick<Outfit, "title" | "styling_notes"> | null;
  personImageCount?: number;
  adjustments?: RenderAdjustments | null;
}) {
  const { profile, items, outfit } = opts;
  const itemDesc = items
    .map((i) => `${i.category}: ${i.name ?? i.subcategory ?? "item"} (${i.primary_color ?? i.colors.join(", ")})`)
    .join("; ");
  return `${identityLock(opts.personImageCount ?? 1)}

TASK: Re-photograph this same person in a photorealistic full-body studio fashion shot, now wearing exactly these items from their wardrobe (shown in the images after the person reference${(opts.personImageCount ?? 1) > 1 ? "s" : ""}): ${itemDesc}.

REQUIREMENTS:
- The garments must match the item images faithfully — same colors, patterns, and details; do not redesign them.
- Body proportions must match their real build: height ${profile.height_cm ?? "average"} cm, weight ${profile.weight_kg ?? "average"} kg. Render an honest, realistic silhouette for that height/weight.${bodyCalibration(opts.adjustments ?? profile.render_adjustments)}
- Full frame, head to shoes fully visible, standing, relaxed natural pose, camera at chest height, natural expression consistent with the reference photos.
- Clean minimal studio background: soft ivory seamless backdrop, soft even lighting, subtle shadow.
- Editorial catalogue quality, 3:4 portrait aspect.
${outfit?.styling_notes ? `- Styling: ${outfit.styling_notes}` : ""}`;
}

export const CATALOG_IMAGE_PROMPT = `Create a clean e-commerce product photo of this exact garment/item.
- Same item, same color, same pattern and details — do not redesign it.
- Presented as a professional catalogue shot: neatly laid flat or ghost-mannequin style, centered, on a pure white background (#FFFFFF).
- Soft studio lighting, no props, no person, no text or watermarks.
- Square aspect ratio.`;

export const BASE_RENDER_PROMPT = (
  profile: Profile,
  personImageCount = 1,
  adjustments?: RenderAdjustments | null
) => `${identityLock(personImageCount)}

TASK: Re-photograph this same person as a photorealistic full-body studio photo.

REQUIREMENTS:
- Realistic body proportions for height ${profile.height_cm ?? "average"} cm and weight ${profile.weight_kg ?? "average"} kg — honest silhouette, no slimming.${bodyCalibration(adjustments ?? profile.render_adjustments)}
- Wearing a plain fitted heather-grey t-shirt and slim dark jeans, plain white sneakers.
- Full frame head to feet, standing straight, arms relaxed, facing camera, natural expression consistent with the reference photos.
- Soft ivory seamless studio backdrop, even lighting, 3:4 portrait.`;
