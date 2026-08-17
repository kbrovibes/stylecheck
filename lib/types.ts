export type Category =
  | "top"
  | "bottom"
  | "outerwear"
  | "footwear"
  | "accessory"
  | "belt"
  | "eyewear"
  | "headwear"
  | "bag"
  | "full_body";

export type Formality =
  | "casual"
  | "smart_casual"
  | "business"
  | "formal"
  | "athletic"
  | "lounge";

export type Occasion = "work" | "casual" | "friends" | "date" | "active" | "lounge";

export type Season = "spring" | "summer" | "fall" | "winter";

export type PhotoKind = "selfie" | "full_body" | "half_body" | "unknown";

export type Provider = "gemini" | "openai";

// User-verified silhouette corrections applied on top of height/weight.
// Each dial is -2..+2, 0 = as inferred from photos.
export interface RenderAdjustments {
  build: number; // leaner .. more muscular
  shoulders: number; // narrower .. broader
  waist: number; // slimmer .. fuller
  note?: string; // free-text correction, e.g. "slightly rounder face"
}

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  birth_year: number | null;
  zip_code: string | null;
  country_code: string;
  lat: number | null;
  lon: number | null;
  place_name: string | null;
  base_render_path: string | null;
  render_adjustments: RenderAdjustments | null;
  wardrobe_scene_path: string | null;
  wardrobe_scene_hash: string | null;
  wardrobe_scene_status: "none" | "pending" | "done" | "failed";
  wardrobe_scene_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPhoto {
  id: string;
  user_id: string;
  storage_path: string;
  kind: PhotoKind;
  is_primary: boolean;
  analysis: Record<string, unknown> | null;
  model_used: string | null;
  deleted: boolean;
  created_at: string;
}

export interface WardrobeItem {
  id: string;
  user_id: string;
  category: Category;
  subcategory: string | null;
  name: string | null;
  description: string | null;
  colors: string[];
  primary_color: string | null;
  pattern: string | null;
  material: string | null;
  seasons: Season[];
  formality: Formality | null;
  style_tags: string[];
  original_image_path: string;
  catalog_image_path: string | null;
  catalog_source: "pending" | "generated" | "web" | "original";
  enabled: boolean;
  deleted: boolean;
  analysis: Record<string, unknown> | null;
  model_used: string | null;
  created_at: string;
}

export interface OutfitVariation {
  label: string;
  swap_out: string; // item id
  swap_in: string; // item id
  outfit_id?: string; // populated once the variation has been materialized
}

export interface Outfit {
  id: string;
  user_id: string;
  title: string | null;
  item_ids: string[];
  occasion: Occasion | null;
  seasons: Season[];
  weather_note: string | null;
  explanation: string | null;
  styling_notes: string | null;
  variations: OutfitVariation[] | null;
  parent_outfit_id: string | null;
  render_path: string | null;
  render_status: "none" | "pending" | "done" | "failed";
  render_model: string | null;
  score: number | null;
  deleted: boolean;
  created_at: string;
}

export interface RenderRecord {
  id: string;
  user_id: string;
  subject_type: "outfit" | "profile" | "item_catalog";
  subject_id: string | null;
  storage_path: string;
  model: string;
  prompt_summary: string | null;
  created_at: string;
}

export interface Settings {
  user_id: string;
  provider: Provider;
  text_model: string;
  image_model: string;
  generate_accessories: boolean;
  generate_shoes: boolean;
  generate_belts: boolean;
  generate_glasses: boolean; // unsupported in v1, kept disabled
  auto_render: boolean;
  restyle_requested_at: string | null;
  updated_at: string;
}

export interface WeatherInfo {
  place: string;
  temp_f: number;
  high_f: number;
  low_f: number;
  condition: string;
  code: number;
  wind_mph: number;
  precip_chance: number;
  season: Season;
  clothing_hint: string;
}

export interface ItemAnalysis {
  category: Category;
  subcategory: string;
  name: string;
  description: string;
  colors: string[];
  primary_color: string;
  pattern: string;
  material: string;
  seasons: Season[];
  formality: Formality;
  style_tags: string[];
}

// Result of classifying one uploaded image. A single photo can yield a person
// AND multiple wardrobe items (e.g. a selfie wearing several pieces).
export interface ClassificationResult {
  kind: "person" | "item" | "unusable";
  person?: { photo_kind: PhotoKind; notes: string };
  items?: ItemAnalysis[];
}

export interface OutfitPlan {
  title: string;
  item_ids: string[];
  occasion: Occasion;
  seasons: Season[];
  explanation: string;
  styling_notes: string;
  weather_note: string;
  score: number;
  variations: { label: string; swap_out: string; swap_in: string }[];
}

export const CATEGORY_LABELS: Record<Category, string> = {
  top: "Tops",
  bottom: "Bottoms",
  outerwear: "Outerwear",
  footwear: "Footwear",
  accessory: "Accessories",
  belt: "Belts",
  eyewear: "Eyewear",
  headwear: "Headwear",
  bag: "Bags",
  full_body: "Full-body",
};

export const OCCASION_LABELS: Record<Occasion, string> = {
  work: "Work",
  casual: "Casual",
  friends: "Friends",
  date: "Date",
  active: "Active",
  lounge: "Lounge",
};

export function ageFromBirthYear(birthYear: number | null | undefined): number | null {
  if (!birthYear || birthYear < 1900) return null;
  const age = new Date().getFullYear() - birthYear;
  return age > 0 && age < 120 ? age : null;
}
