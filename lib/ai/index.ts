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
import { openaiImage, openaiImageEdit, openaiJson } from "./openai";
import {
  BASE_RENDER_PROMPT,
  FACE_MATCH_PROMPT,
  IDENTITY_NOTES_PROMPT,
  catalogImagePrompt,
  CLASSIFY_PROMPT,
  composeOutfitsPrompt,
  gptTryOnPrompt,
  outfitEditPrompt,
  reclassifyItemPrompt,
  renderOutfitPrompt,
  wardrobeScenePrompt,
} from "./prompts";

export type { ImageInput };

/** Preferred OpenAI model for person renders — 1.5 is built for likeness preservation. */
export const GPT_PERSON_MODEL = "gpt-image-1.5";

export const PERSON_IMAGE_MODELS = [
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
  "gpt-image-1.5",
  "gpt-image-1",
] as const;

/** Model used for renders OF PEOPLE (mannequin, fits). Wardrobe/scene stay Gemini. */
export function resolvePersonModel(settings: Settings, override?: string | null) {
  return override ?? settings.person_image_model ?? settings.image_model;
}

/** The comparison model from the other family. */
export function altPersonModel(model: string) {
  return model.startsWith("gpt") ? "gemini-3-pro-image-preview" : GPT_PERSON_MODEL;
}

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
    mustFeature?: string[];
  }
): Promise<OutfitPlan[]> {
  const prompt = composeOutfitsPrompt({ ...opts, settings });
  const res = await jsonCall<{ outfits: OutfitPlan[] }>(settings)(prompt);
  const validIds = new Set(opts.items.map((i) => i.id));
  const categoryById = new Map(opts.items.map((i) => [i.id, i.category]));
  // Salvage outfits with a hallucinated id instead of dropping them wholesale:
  // strip invalid ids — but only keep the outfit if what remains is still a
  // wearable look. Stripping can amputate the torso piece (the model named a
  // real-sounding but invalid id), leaving e.g. two pants + sneakers.
  return (res.outfits ?? [])
    .map((o) => {
      const ids = (o.item_ids ?? []).filter((id) => validIds.has(id));
      // One bottom max — a second pair of pants is model confusion, not layering.
      let bottomSeen = false;
      const kept = ids.filter((id) => {
        if (categoryById.get(id) !== "bottom") return true;
        if (bottomSeen) return false;
        bottomSeen = true;
        return true;
      });
      return {
        ...o,
        item_ids: kept,
        variations: (o.variations ?? []).filter(
          (v) => validIds.has(v.swap_out) && validIds.has(v.swap_in)
        ),
      };
    })
    .filter((o) => {
      if (o.item_ids.length < 2) return false;
      const cats = o.item_ids.map((id) => categoryById.get(id));
      const torso = cats.some((c) => c === "top" || c === "outerwear" || c === "full_body");
      const legs = cats.some((c) => c === "bottom" || c === "full_body");
      return torso && legs;
    });
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
  adjustments?: RenderAdjustments | null,
  modelOverride?: string | null
) {
  const model = resolvePersonModel(settings, modelOverride);
  const prompt = BASE_RENDER_PROMPT(profile, photos.length, adjustments);
  if (model.startsWith("gpt")) {
    return openaiImageEdit({ model, prompt, images: photos });
  }
  return geminiImage({ model, prompt, images: photos });
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
    modelOverride?: string | null;
    faceFixNotes?: string[] | null; // corrections from a failed face-match check
  }
) {
  const model = resolvePersonModel(settings, opts.modelOverride);
  if (model.startsWith("gpt")) {
    // gpt-image edits: the FIRST image is the one preserved with the most
    // fidelity — person anchor first, then real face refs, then garments.
    // Roles are declared by index since the edits endpoint takes a flat array.
    const manifest = [
      ...opts.personImages.map((_, i) =>
        opts.editBase && i === 0
          ? "BASE IMAGE — the studio photograph of the person to edit"
          : "the person (identity reference)"
      ),
      ...(opts.identityPhotos ?? []).map(
        () => "REAL photograph of the person — authoritative face reference"
      ),
      ...opts.itemImages.map((_, i) => {
        const item = opts.items[i];
        return `wardrobe item to dress them in — ${item?.name ?? item?.subcategory ?? item?.category ?? "garment"}${item?.primary_color ? ` (${item.primary_color})` : ""}`;
      }),
    ];
    return openaiImageEdit({
      model,
      prompt: gptTryOnPrompt({
        profile: opts.profile,
        items: opts.items,
        outfit: opts.outfit,
        manifest,
        editBase: !!opts.editBase,
        goofy: opts.goofy,
        identityNotes: opts.identityNotes,
        faceFixNotes: opts.faceFixNotes,
      }),
      images: [
        ...opts.personImages,
        ...(opts.identityPhotos ?? []),
        ...opts.itemImages,
      ],
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
  return geminiImageParts({ model, parts });
}

export type FaceMatchResult = {
  same_person: boolean;
  score: number; // 0-10
  mismatches: string[];
};

/**
 * Judge whether a rendered face matches the person's REAL photos. Always
 * judged by Gemini so the check is independent of the generating model.
 */
export async function verifyFaceMatch(
  settings: Settings,
  render: ImageInput,
  references: ImageInput[]
): Promise<FaceMatchResult> {
  const res = await geminiJson<FaceMatchResult>({
    model: settings.text_model?.startsWith("gemini")
      ? settings.text_model
      : "gemini-2.5-flash",
    prompt: FACE_MATCH_PROMPT,
    images: [render, ...references.slice(0, 3)],
  });
  return {
    same_person: !!res.same_person,
    score: Math.max(0, Math.min(10, Number(res.score) || 0)),
    mismatches: (res.mismatches ?? []).slice(0, 6),
  };
}
