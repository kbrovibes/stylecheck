import type {
  ClassificationResult,
  ItemAnalysis,
  Outfit,
  OutfitPlan,
  BodyProfile,
  RenderAdjustments,
  Settings,
  WardrobeItem,
  WeatherInfo,
} from "@/lib/types";
import {
  geminiImage,
  geminiImageParts,
  geminiJson,
  type ImageInput,
  type MixedPart,
} from "./gemini";
import { openaiImage, openaiJson } from "./openai";
import {
  BASE_RENDER_PROMPT,
  IDENTITY_NOTES_PROMPT,
  catalogImagePrompt,
  CLASSIFY_PROMPT,
  composeOutfitsPrompt,
  outfitEditPrompt,
  reclassifyItemPrompt,
  renderOutfitPrompt,
  wardrobeScenePrompt,
} from "./prompts";

export type { ImageInput };

function jsonCall<T>(settings: Settings) {
  return settings.provider === "openai"
    ? (prompt: string, images?: ImageInput[]) =>
        openaiJson<T>({ model: settings.text_model, prompt, images })
    : (prompt: string, images?: ImageInput[]) =>
        geminiJson<T>({ model: settings.text_model, prompt, images });
}

function imageCall(settings: Settings) {
  return settings.provider === "openai"
    ? (prompt: string, images?: ImageInput[]) =>
        openaiImage({ model: settings.image_model, prompt, images })
    : (prompt: string, images?: ImageInput[]) =>
        geminiImage({ model: settings.image_model, prompt, images });
}

export async function classifyImage(
  settings: Settings,
  image: ImageInput
): Promise<ClassificationResult> {
  return jsonCall<ClassificationResult>(settings)(CLASSIFY_PROMPT, [image]);
}

export async function composeOutfits(
  settings: Settings,
  opts: {
    profile: BodyProfile;
    items: WardrobeItem[];
    weather: WeatherInfo | null;
    count: number;
    occasion?: string;
    dislikes?: string[];
  }
): Promise<OutfitPlan[]> {
  const prompt = composeOutfitsPrompt({ ...opts, settings });
  const res = await jsonCall<{ outfits: OutfitPlan[] }>(settings)(prompt);
  const validIds = new Set(opts.items.map((i) => i.id));
  // Salvage outfits with a hallucinated id instead of dropping them wholesale:
  // strip invalid ids and keep the outfit if it still has a wearable core.
  return (res.outfits ?? [])
    .map((o) => ({
      ...o,
      item_ids: (o.item_ids ?? []).filter((id) => validIds.has(id)),
      variations: (o.variations ?? []).filter(
        (v) => validIds.has(v.swap_out) && validIds.has(v.swap_in)
      ),
    }))
    .filter((o) => o.item_ids.length >= 2);
}

/** Compact physical description ("identity passport") from real photos. */
export async function generateIdentityNotes(
  settings: Settings,
  photos: ImageInput[]
): Promise<string> {
  const res = await jsonCall<{ notes: string }>(settings)(
    IDENTITY_NOTES_PROMPT,
    photos.slice(0, 3)
  );
  return (res.notes ?? "").slice(0, 900);
}

/** Re-derive an item's catalogue metadata from its photo + a user correction. */
export async function reclassifyItem(
  settings: Settings,
  image: ImageInput,
  current: WardrobeItem,
  hint: string
): Promise<ItemAnalysis> {
  return jsonCall<ItemAnalysis>(settings)(reclassifyItemPrompt(current, hint), [image]);
}

export async function generateCatalogImage(
  settings: Settings,
  original: ImageInput,
  item?: Pick<
    WardrobeItem,
    "name" | "category" | "subcategory" | "description" | "primary_color"
  > | null,
  hint?: string | null
) {
  return imageCall(settings)(catalogImagePrompt(item, hint), [original]);
}

export async function generateWardrobeSceneImage(
  settings: Settings,
  itemNames: Parameters<typeof wardrobeScenePrompt>[0],
  referenceImages: ImageInput[]
) {
  return imageCall(settings)(wardrobeScenePrompt(itemNames), referenceImages);
}

export async function generateBaseRender(
  settings: Settings,
  profile: BodyProfile,
  photos: ImageInput[],
  adjustments?: RenderAdjustments | null
) {
  return imageCall(settings)(
    BASE_RENDER_PROMPT(profile, photos.length, adjustments),
    photos
  );
}

export async function renderOutfitImage(
  settings: Settings,
  opts: {
    profile: BodyProfile;
    personImages: ImageInput[]; // base render (preferred) or user photos
    itemImages: ImageInput[];
    items: WardrobeItem[];
    outfit: Pick<Outfit, "title" | "styling_notes"> | null;
    editBase?: boolean; // true when personImages[0] is the saved base render
    goofy?: boolean; // comedy pose, identity still locked
    identityPhotos?: ImageInput[]; // REAL photos grounding the face each render
    identityNotes?: string | null; // stored identity passport
  }
) {
  if (settings.provider === "openai") {
    return openaiImage({
      model: settings.image_model,
      prompt: renderOutfitPrompt({
        ...opts,
        personImageCount: opts.personImages.length,
      }),
      images: [...opts.personImages, ...opts.itemImages],
    });
  }

  const itemParts: MixedPart[] = opts.items.flatMap((item, i) => {
    const img = opts.itemImages[i];
    if (!img) return [];
    return [
      {
        text: `ITEM ${i + 1} — ${item.name ?? item.subcategory ?? item.category} (${item.category}${item.primary_color ? `, ${item.primary_color}` : ""}):`,
      } as MixedPart,
      { image: img } as MixedPart,
    ];
  });

  // With a base render: edit that ONE image ("change only the clothes") —
  // dramatically better identity preservation than generate-from-references.
  const identityParts: MixedPart[] = (opts.identityPhotos ?? []).flatMap(
    (image, i) => [
      { text: `IDENTITY PROOF ${i + 1} — real photograph of the person:` } as MixedPart,
      { image } as MixedPart,
    ]
  );
  const parts: MixedPart[] = opts.editBase
    ? [
        {
          text: "BASE IMAGE — the photograph to edit. The person in it must remain pixel-faithful except for their clothing:",
        },
        { image: opts.personImages[0] },
        ...identityParts,
        ...itemParts,
        {
          text: outfitEditPrompt({
            ...opts,
            identityPhotoCount: opts.identityPhotos?.length ?? 0,
          }),
        },
      ]
    : [
        {
          text: `THE PERSON — authoritative identity reference. The generated photo MUST show exactly this person (same face, hair, skin tone, build). This is not a model or a stand-in:`,
        },
        ...opts.personImages.map((image) => ({ image })),
        ...itemParts,
        {
          text: renderOutfitPrompt({
            ...opts,
            personImageCount: opts.personImages.length,
          }),
        },
      ];
  return geminiImageParts({ model: settings.image_model, parts });
}
