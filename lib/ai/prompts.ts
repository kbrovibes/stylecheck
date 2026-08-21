import { ageFromBirthYear } from "@/lib/types";
import type {
  BodyProfile,
  Outfit,
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
  profile: BodyProfile;
  items: WardrobeItem[];
  weather: WeatherInfo | null;
  settings: Settings;
  count: number;
  occasion?: string;
  dislikes?: string[];
  mustFeature?: string[];
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
Build EXACTLY ${count} distinct outfits for this person from ONLY the wardrobe items listed below. Reuse pieces across outfits freely — a small wardrobe still yields many combinations (different pairings, layers, occasions). Do not return fewer than ${count} unless the wardrobe makes it truly impossible.
CRITICAL: every value in "item_ids" must be copied character-for-character from an id in the wardrobe list. Never invent or alter ids.

PERSON: ${ageFromBirthYear(profile.birth_year) ? `${ageFromBirthYear(profile.birth_year)} years old, ` : ""}height ${profile.height_cm ?? "?"} cm, weight ${profile.weight_kg ?? "?"} kg.
${weather ? `CURRENT WEATHER in ${weather.place}: ${weather.condition}, ${weather.temp_f}°F (high ${weather.high_f} / low ${weather.low_f}), season: ${weather.season}.` : "Weather unknown — cover multiple seasons."}
${occasion ? `FOCUS OCCASION: ${occasion}.` : "Cover a spread of occasions: work, casual, friends, date."}

OCCASION DEFINITIONS — label strictly; a wrong label is worse than a missing occasion:
- work: office-appropriate. Smart casual to business. Never shorts, flip-flops, or athletic wear.
- casual: relaxed everyday — errands, coffee, weekends.
- friends: social hangs — expressive, relaxed-cool, personality welcome.
- date: elevated and intentional — best-fitting trousers/dark denim, a refined top, overshirt or blazer, clean leather shoes or crisp minimal sneakers. Never gym wear, never sloppy. If the wardrobe can't produce a genuinely date-worthy look, do NOT force one — label it differently.
- active: ONLY real athletic pieces (performance tees, gym shorts, joggers, trainers). If the wardrobe has none, produce zero "active" fits.
- lounge: home comfort — soft layers, easy fits.

WARDROBE:
${itemLines}

CONSTRAINTS:
- ${optional.join("\n- ")}
- Each outfit needs at minimum a top + bottom (or one full_body piece), and MUST include footwear whenever any footwear exists in the wardrobe.
- Finish the looks: belts, watches, bags, headwear and other accessories are there to be USED — at least half the outfits should feature one when available, chosen deliberately (leather tones matched to shoes, metals consistent). Never dump every accessory on one look.
- Match formality to occasion: no shorts/flip-flops for work; no athletic wear on date night unless styled deliberately.
- Consider color harmony, proportion for their build, season, and the current weather.
- Prefer variety across the set — different anchors, not five variations of one look.
${ageFromBirthYear(profile.birth_year) ? `- AGE-APPROPRIATE STYLING (important): they are ${ageFromBirthYear(profile.birth_year)}. Style for that exact life stage — modern and current, never skewing younger or older. For someone in their mid-30s+: refined fits over juniors' trends, elevated basics, intentional palettes, quality-signaling pieces; skip styling that reads college/early-20s (logo-forward streetwear energy, deliberately sloppy oversizing) unless the occasion truly calls for it. Equally: nothing dowdy or prematurely aging. When relevant, the explanation should say why the look suits a ${ageFromBirthYear(profile.birth_year)}-year-old.` : ""}

${opts.dislikes?.length ? `DISLIKED BY THE USER — they thumbed these combinations down; do not propose close variants of them:\n${opts.dislikes.map((d) => `- ${d}`).join("\n")}\n\n` : ""}${opts.mustFeature?.length ? `UNDERUSED PIECES — these item ids are in no current fit. EVERY outfit you produce must feature at least one of them, and across the set cover as many as possible:\n${opts.mustFeature.map((m) => `- ${m}`).join("\n")}\n\n` : ""}SCORING — be a genuinely critical stylist, not a cheerleader:
- Calibrate: 5 = wearable but forgettable · 6 = good · 7 = strong · 8 = excellent, lookbook-worthy · 9 = near-perfect (rare: at most ONE per batch) · 10 = never given.
- Use the full 4-9 range with decimals (e.g. 5.8, 7.2). Spread scores out — the batch average should land around 6.5, and no two outfits should share a score unless they are truly equal.
- Penalize: safe/boring combinations, formality mismatches, muddy color stories, season conflicts, repetitive anchors across the batch.

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
      "score": number,                    // see SCORING below — be a harsh critic
      "variations": [                     // subtle single-item swaps that also work
        { "label": string, "swap_out": string, "swap_in": string }   // item ids
      ]
    }
  ]
}`;
}

function identityLock(personImageCount: number, labeled = false, identityNotes?: string | null) {
  const n = personImageCount || 1;
  const ref = labeled
    ? `The image${n > 1 ? "s" : ""} labeled "THE PERSON" show${n > 1 ? "" : "s"} the real person`
    : `The first ${n} image${n > 1 ? "s" : ""} show${n > 1 ? "" : "s"} the real person`;
  return `IDENTITY LOCK — the single most important instruction:
${ref}. Their face is immutable ground truth${identityNotes ? `\nVERIFIED IDENTITY DESCRIPTION (cross-check the output against every detail): ${identityNotes}` : ""} — treat this task as re-photographing the SAME person, not generating a similar one.
- Copy the exact facial geometry: eye shape and spacing, eyebrows, nose, lips, jawline, cheekbones, ears.
- Copy the exact skin tone and texture, complexion marks, hairstyle, hairline, and any facial hair precisely as shown.
- Do NOT beautify, slim, de-age, stylize, or "improve" the face in any way. The output must be instantly recognizable as this exact individual, as if taken in the same photo session.
- Keep eyewear exactly as in the reference photos: do not add or remove glasses.
- If any other instruction conflicts with preserving this face, preserving the face wins.`;
}


const GOOFY_POSES = [
  "a dramatic superhero landing, one fist on the ground",
  "mid-air jump with a heel click and jazz hands",
  "an exaggerated runway strut with a way-too-serious fashion face",
  "riding an invisible horse",
  "mowing with an invisible lawnmower, mid-stride",
  "a dramatic hair-flip pose (regardless of hair length)",
  "T-rex arms with an over-the-top roar face",
  "the 'sudden realization I left the stove on' freeze",
  "a very intense ballet arabesque attempted with zero training",
  "finger guns at the camera with a wink",
  "the classic 'sneaking away on tiptoes' pose",
  "flexing like a 1900s circus strongman",
];

export function goofyPoseInstruction() {
  const picks = [...GOOFY_POSES].sort(() => Math.random() - 0.5).slice(0, 3);
  return `COMEDY POSE — instead of a standard pose, the person is doing something ridiculous. Pick whichever of these reads funniest with this outfit: ${picks.join("; or ")}. Commit to the bit — dynamic, theatrical, laugh-out-loud staging. A playful, exaggerated expression is welcome, but the face must remain 100% unmistakably the same person (same features, glasses, hair — never a caricature, never distorted).`;
}

/**
 * Edit-framing variant: used when a base render exists. Editing ONE image
 * ("change only the clothes") preserves identity far better than asking the
 * model to generate a new photo of a referenced person.
 */
export function outfitEditPrompt(opts: {
  profile: BodyProfile;
  items: WardrobeItem[];
  outfit: Pick<Outfit, "title" | "styling_notes"> | null;
  adjustments?: RenderAdjustments | null;
  goofy?: boolean;
  identityNotes?: string | null;
  identityPhotoCount?: number;
}) {
  const { profile, items, outfit } = opts;
  const itemDesc = items
    .map((i) => `${i.category}: ${i.name ?? i.subcategory ?? "item"} (${i.primary_color ?? i.colors.join(", ")})`)
    .join("; ");
  return `TASK: Wardrobe swap${opts.goofy ? " + comedy pose" : ""}. Edit the BASE IMAGE — change ONLY the clothing${opts.goofy ? " and the pose" : ""}.

${opts.identityPhotoCount ? `IDENTITY PROOF — the ${opts.identityPhotoCount} image(s) labeled "IDENTITY PROOF" are REAL photographs of this person. The output face must match these photos even more than the BASE IMAGE: if the BASE IMAGE has drifted from the photos in any facial detail, correct toward the photos.\n` : ""}${opts.identityNotes ? `VERIFIED IDENTITY DESCRIPTION (cross-check every detail): ${opts.identityNotes}\n` : ""}
KEEP IDENTICAL TO THE BASE IMAGE (do not regenerate or alter): the person — their exact face, ${opts.goofy ? "" : "expression, "}hair, skin tone, facial hair, glasses/no-glasses, body proportions — plus ${opts.goofy ? "the lighting and the ivory studio background" : "the pose, camera framing, lighting and the ivory studio background"}. This must remain the same person${opts.goofy ? "" : ", with new clothes on"}. Treat the head region as protected: reproduce the face, hairline and glasses with photographic fidelity — no smoothing, no restyling, no drift.
${opts.goofy ? `\n${goofyPoseInstruction()}\n` : ""}

REPLACE the outfit with exactly these labeled wardrobe items: ${itemDesc}.
- Each garment must match its reference image faithfully: same color, pattern, fabric and details. Do not redesign or substitute.
- Fit the garments naturally to this person's build (height ${profile.height_cm ?? "average"} cm, weight ${profile.weight_kg ?? "average"} kg).${ageFromBirthYear(profile.birth_year) ? `\n- The person is ${ageFromBirthYear(profile.birth_year)} years old: style the garments (fit, tuck, drape) the way a stylist would for that age — and never de-age or age the face.` : ""}${bodyCalibration(opts.adjustments ?? profile.render_adjustments)}
- Full frame, head to shoes visible, photorealistic, 3:4 portrait.
${outfit?.styling_notes ? `- Styling: ${outfit.styling_notes}` : ""}`;
}

export function renderOutfitPrompt(opts: {
  profile: BodyProfile;
  items: WardrobeItem[];
  outfit: Pick<Outfit, "title" | "styling_notes"> | null;
  personImageCount?: number;
  adjustments?: RenderAdjustments | null;
}) {
  const { profile, items, outfit } = opts;
  const itemDesc = items
    .map((i) => `${i.category}: ${i.name ?? i.subcategory ?? "item"} (${i.primary_color ?? i.colors.join(", ")})`)
    .join("; ");
  return `${identityLock(opts.personImageCount ?? 1, true)}

TASK: Re-photograph this same person in a photorealistic full-body studio fashion shot, now wearing exactly the labeled wardrobe items: ${itemDesc}.

REQUIREMENTS:
- The garments must match the item images faithfully — same colors, patterns, and details; do not redesign them.
- Body proportions must match their real build: height ${profile.height_cm ?? "average"} cm, weight ${profile.weight_kg ?? "average"} kg. Render an honest, realistic silhouette for that height/weight.${ageFromBirthYear(profile.birth_year) ? ` The person is ${ageFromBirthYear(profile.birth_year)} years old — render true to age, never younger or older.` : ""}${bodyCalibration(opts.adjustments ?? profile.render_adjustments)}
- Full frame, head to shoes fully visible, standing, relaxed natural pose, camera at chest height, natural expression consistent with the reference photos.
- Clean minimal studio background: soft ivory seamless backdrop, soft even lighting, subtle shadow.
- Editorial catalogue quality, 3:4 portrait aspect.
${outfit?.styling_notes ? `- Styling: ${outfit.styling_notes}` : ""}`;
}

export function reclassifyItemPrompt(
  current: Pick<WardrobeItem, "name" | "category" | "subcategory" | "description">,
  hint: string
) {
  return `You are a fashion cataloguer. This item was previously catalogued as: ${current.name ?? "?"} (${current.category}${current.subcategory ? `, ${current.subcategory}` : ""}) — ${current.description ?? ""}.

The user corrected it: "${hint}"

Look at the photo again with that correction in mind — the user knows their own wardrobe, so TRUST their correction over your own reading. Return the corrected catalogue entry as JSON only, exactly this schema:
{
  "category": "top" | "bottom" | "outerwear" | "footwear" | "accessory" | "belt" | "eyewear" | "headwear" | "bag" | "full_body",
  "subcategory": string,
  "name": string,
  "description": string,
  "colors": string[],
  "primary_color": string,
  "pattern": string,
  "material": string,
  "seasons": ("spring"|"summer"|"fall"|"winter")[],
  "formality": "casual" | "smart_casual" | "business" | "formal" | "athletic" | "lounge",
  "style_tags": string[]
}`;
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
- Each provided reference image shows ONE real item from this wardrobe. Reproduce every referenced item 1:1 — exact same color, pattern, material, cut and details — as if the actual garment were photographed inside this closet. Do NOT substitute similar-looking items, do NOT invent extra items, do NOT generify.
- The listed items above map to the reference images in the same order.
- No people, no mannequins, no text, no labels.
- Everything tidy, generous negative space, quiet-luxury aesthetic (think Aesop store meets The Row lookbook).`;
}

export const BASE_RENDER_PROMPT = (
  profile: BodyProfile,
  personImageCount = 1,
  adjustments?: RenderAdjustments | null
) => `${identityLock(personImageCount)}

TASK: Re-photograph this same person as a photorealistic full-body studio photo.

REQUIREMENTS:
- Realistic body proportions for height ${profile.height_cm ?? "average"} cm and weight ${profile.weight_kg ?? "average"} kg — honest silhouette, no slimming.${ageFromBirthYear(profile.birth_year) ? ` They are ${ageFromBirthYear(profile.birth_year)} years old — render true to age, do not de-age.` : ""}${bodyCalibration(adjustments ?? profile.render_adjustments)}
- Wearing a plain fitted heather-grey t-shirt and slim dark jeans, plain white sneakers.
- Full frame head to feet, standing straight, arms relaxed, facing camera, natural expression consistent with the reference photos.
- Soft ivory seamless studio backdrop, even lighting, 3:4 portrait.`;


export const IDENTITY_NOTES_PROMPT = `You are building an identity passport for consistent AI rendering of one real person. Study the photo(s) and return JSON only: {"notes": string}.
"notes" is a compact (max 110 words) physical description a portrait artist could verify against: face shape, skin tone (be specific), eye shape/color if visible, eyebrows, nose, lips, jawline, hairstyle + hairline + color, facial hair (exact style/length), eyewear (exact frame style/color or "no glasses"), ears, and any distinguishing features (moles, dimples, smile lines). Objective and neutral — no flattery, no guesses about things not visible.`;


export function reviveOutfitPrompt(opts: {
  outfit: Pick<Outfit, "title" | "occasion" | "explanation">;
  deadItemIds: string[];
  liveItems: WardrobeItem[];
  keptItems: WardrobeItem[];
}) {
  const wardrobe = opts.liveItems
    .map((i) => `- id=${i.id} | ${i.category}${i.subcategory ? `/${i.subcategory}` : ""} | ${i.name ?? "unnamed"} | ${i.primary_color ?? i.colors.join(",")} | formality: ${i.formality ?? "?"}`)
    .join("\n");
  const kept = opts.keptItems
    .map((i) => `- ${i.category}: ${i.name ?? i.subcategory} (${i.primary_color ?? ""})`)
    .join("\n");
  return `You are a minimal fashion stylist. The outfit "${opts.outfit.title}" (occasion: ${opts.outfit.occasion ?? "any"}) lost ${opts.deadItemIds.length} piece(s) — they were removed from the wardrobe. Revive the outfit by picking the best replacement for each lost piece from the CURRENT wardrobe, keeping the look coherent with the remaining pieces.

REMAINING PIECES (keep these):
${kept}

CURRENT WARDROBE (choose replacements from here — copy ids exactly):
${wardrobe}

Respond with JSON only:
{
  "replacement_ids": string[],          // one id per lost piece; [] if no sensible replacement exists
  "explanation": string,                // refreshed 2-3 sentence "why this works" for the revived outfit
  "styling_notes": string
}`;
}

export function composeExactPrompt(opts: {
  profile: BodyProfile;
  items: WardrobeItem[];
  weather: WeatherInfo | null;
}) {
  const list = opts.items
    .map((i) => `- id=${i.id} | ${i.category}${i.subcategory ? `/${i.subcategory}` : ""} | ${i.name ?? "unnamed"} | ${i.primary_color ?? i.colors.join(",")}`)
    .join("\n");
  return `You are a minimal fashion stylist. The user hand-picked EXACTLY these pieces and wants them styled as one outfit — use every listed item, add nothing, drop nothing:
${list}

${opts.weather ? `Current weather: ${opts.weather.condition}, ${opts.weather.temp_f}°F.` : ""}
Person: ${ageFromBirthYear(opts.profile.birth_year) ? `${ageFromBirthYear(opts.profile.birth_year)} years old, ` : ""}height ${opts.profile.height_cm ?? "?"} cm, weight ${opts.profile.weight_kg ?? "?"} kg.

Respond with JSON only:
{
  "title": string,                 // editorial name
  "occasion": "work"|"casual"|"friends"|"date"|"active"|"lounge",
  "seasons": ("spring"|"summer"|"fall"|"winter")[],
  "explanation": string,           // honest 2-3 sentences: why it works — or what's off, if the combo is awkward
  "styling_notes": string,
  "score": number                  // honest 0-10; hand-picked combos can absolutely score low
}`;
}

export function relabelOccasionsPrompt(
  fits: { id: string; title: string | null; occasion: string | null; itemSummary: string }[]
) {
  return `You audit outfit occasion labels for a wardrobe app. For each fit below, decide the CORRECT occasion using these strict definitions:
- work: office-appropriate, no shorts/flip-flops/athletic wear
- casual: relaxed everyday
- friends: social, expressive
- date: elevated + intentional (refined top, best bottoms, clean shoes) — a plain tee + shorts is NOT a date fit
- active: ONLY real athletic pieces (performance wear, trainers)
- lounge: home comfort

FITS:
${fits.map((f) => `- id=${f.id} | current="${f.occasion}" | ${f.title} | pieces: ${f.itemSummary}`).join("\n")}

Respond with JSON only — ONLY the fits whose label should change:
{ "corrections": [ { "id": string, "occasion": "work"|"casual"|"friends"|"date"|"active"|"lounge" } ] }`;
}