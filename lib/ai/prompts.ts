import type { Outfit, Profile, Settings, WardrobeItem, WeatherInfo } from "@/lib/types";

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

export function renderOutfitPrompt(opts: {
  profile: Profile;
  items: WardrobeItem[];
  outfit: Pick<Outfit, "title" | "styling_notes"> | null;
}) {
  const { profile, items, outfit } = opts;
  const itemDesc = items
    .map((i) => `${i.category}: ${i.name ?? i.subcategory ?? "item"} (${i.primary_color ?? i.colors.join(", ")})`)
    .join("; ");
  return `Generate a photorealistic full-body fashion photo of the person shown in the reference photo(s), wearing exactly these items from their wardrobe (shown in the following images): ${itemDesc}.

CRITICAL REQUIREMENTS:
- The person must look 100% like the reference photos: identical face, skin tone, hair, and facial features. Do not beautify or alter their identity.
- Body proportions must match their real build: height ${profile.height_cm ?? "average"} cm, weight ${profile.weight_kg ?? "average"} kg. Render an honest, realistic silhouette for that height/weight.
- Full frame, head to shoes fully visible, standing, relaxed natural pose.
- Keep the person's current eyewear situation exactly as in the reference photos (do not add or remove glasses).
- Clean minimal studio background: soft ivory seamless backdrop, soft even lighting, subtle shadow.
- Editorial catalogue quality, 3:4 portrait aspect.
${outfit?.styling_notes ? `- Styling: ${outfit.styling_notes}` : ""}`;
}

export const CATALOG_IMAGE_PROMPT = `Create a clean e-commerce product photo of this exact garment/item.
- Same item, same color, same pattern and details — do not redesign it.
- Presented as a professional catalogue shot: neatly laid flat or ghost-mannequin style, centered, on a pure white background (#FFFFFF).
- Soft studio lighting, no props, no person, no text or watermarks.
- Square aspect ratio.`;

export const BASE_RENDER_PROMPT = (profile: Profile) => `Generate a photorealistic full-body studio photo of the person in the reference photo(s).

CRITICAL REQUIREMENTS:
- Identical face, skin tone, and hair to the reference photos — 100% likeness, no beautification.
- Realistic body proportions for height ${profile.height_cm ?? "average"} cm and weight ${profile.weight_kg ?? "average"} kg.
- Wearing a plain fitted heather-grey t-shirt and slim dark jeans, barefoot or plain white sneakers.
- Full frame head to feet, standing straight, arms relaxed, facing camera.
- Keep eyewear exactly as in the reference photos.
- Soft ivory seamless studio backdrop, even lighting, 3:4 portrait.`;
