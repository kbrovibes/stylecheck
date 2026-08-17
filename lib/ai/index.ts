import type {
  ClassificationResult,
  Outfit,
  OutfitPlan,
  Profile,
  RenderAdjustments,
  Settings,
  WardrobeItem,
  WeatherInfo,
} from "@/lib/types";
import { geminiImage, geminiJson, type ImageInput } from "./gemini";
import { openaiImage, openaiJson } from "./openai";
import {
  BASE_RENDER_PROMPT,
  CATALOG_IMAGE_PROMPT,
  CLASSIFY_PROMPT,
  composeOutfitsPrompt,
  renderOutfitPrompt,
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
    profile: Profile;
    items: WardrobeItem[];
    weather: WeatherInfo | null;
    count: number;
    occasion?: string;
  }
): Promise<OutfitPlan[]> {
  const prompt = composeOutfitsPrompt({ ...opts, settings });
  const res = await jsonCall<{ outfits: OutfitPlan[] }>(settings)(prompt);
  const validIds = new Set(opts.items.map((i) => i.id));
  return (res.outfits ?? []).filter(
    (o) => o.item_ids?.length && o.item_ids.every((id) => validIds.has(id))
  );
}

export async function generateCatalogImage(settings: Settings, original: ImageInput) {
  return imageCall(settings)(CATALOG_IMAGE_PROMPT, [original]);
}

export async function generateBaseRender(
  settings: Settings,
  profile: Profile,
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
    profile: Profile;
    personImages: ImageInput[]; // base render (preferred) or user photos
    itemImages: ImageInput[];
    items: WardrobeItem[];
    outfit: Pick<Outfit, "title" | "styling_notes"> | null;
  }
) {
  const prompt = renderOutfitPrompt({
    ...opts,
    personImageCount: opts.personImages.length,
  });
  return imageCall(settings)(prompt, [...opts.personImages, ...opts.itemImages]);
}
