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
Look at this image, detect the person (if any) AND every distinct wardrobe item visible — including items being WORN by a person. Respond with JSON only, matching this schema:

{
  "kind": "person" | "item" | "unusable",
  "person": { "photo_kind": "selfie" | "full_body" | "half_body" | "unknown", "notes": string },
  "items": [
    {
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
  ]
}

Rules:
- If a person is visible (face or body, selfie, mirror shot), kind = "person" and include "person". ALSO list each clearly identifiable garment/footwear/accessory they are wearing in "items" — each piece as its own entry.
- If it shows only clothing/footwear/accessories (laid flat, hung, on a surface), kind = "item" and list EVERY distinct piece in "items" (a flat-lay of 3 pieces = 3 entries), omit "person".
- Only include items you can describe confidently (visible enough to catalogue). Skip barely visible slivers.
- Do not catalogue underwear or socks unless they are clearly the subject of the photo.
- If the image is blurry, irrelevant, or not fashion related, kind = "unusable" with empty "items".
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

export function catalogImagePrompt(
  item?: Pick<WardrobeItem, "name" | "category" | "subcategory" | "description" | "primary_color"> | null,
  hint?: string | null
) {
  const target = item
    ? `TARGET ITEM — extract exactly this one item from the photo (the photo may show a person wearing several pieces, or multiple items together): ${item.name ?? item.subcategory ?? item.category} — ${item.description ?? ""} (${item.category}${item.subcategory ? `, ${item.subcategory}` : ""}${item.primary_color ? `, ${item.primary_color}` : ""}).`
    : `TARGET ITEM: the main garment/item in the photo.`;
  return `Create a clean e-commerce product photo of one specific item from this photo.
${target}${hint?.trim() ? `\nUSER CONTEXT (trust this over your own guess about which item is meant and what it is): ${hint.trim()}` : ""}
- Same exact item: same color, pattern, fabric and details — do not redesign it. If it is being worn, isolate it off the body.
- Presented as a professional catalogue shot: neatly laid flat or ghost-mannequin style, centered, on a pure white background (#FFFFFF).
- Soft studio lighting, no props, no person, no other items, no text or watermarks.
- Square aspect ratio.`;
}

export function wardrobeScenePrompt(itemNames: {
  hanging: string[];
  folded: string[];
  shoes: string[];
  tray: string[];
}) {
  return `Create a single wide editorial photograph of a luxurious minimal walk-in wardrobe, photographed straight-on. Ivory walls, light oak wood, brushed brass details, soft warm studio light. Aspect ratio 16:9.

COMPOSITION — follow this layout EXACTLY:
- LEFT HALF: one long brass hanging rail with the following pieces hung neatly on wooden hangers, in order: ${itemNames.hanging.join("; ") || "a few elegant garments"}.
- RIGHT THIRD, TOP SHELF: these pieces folded in neat stacks: ${itemNames.folded.join("; ") || "folded knits and denim"}.
- RIGHT THIRD, MIDDLE SHELF: these shoes displayed side by side: ${itemNames.shoes.join("; ") || "a pair of clean sneakers"}.
- RIGHT THIRD, BOTTOM SHELF: a low tray/shelf with: ${itemNames.tray.join("; ") || "small leather accessories"}.

RULES:
- Render ONLY the garments listed (reference images of the actual items are provided) — reproduce their real colors, patterns and materials faithfully. Do not invent extra items.
- No people, no mannequins, no text, no labels.
- Everything tidy, generous negative space, quiet-luxury aesthetic (think Aesop store meets The Row lookbook).`;
}

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
