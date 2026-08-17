import type { Category, UserPhoto, WardrobeItem } from "@/lib/types";

export interface CoverageSlot {
  key: string;
  label: string;
  have: number;
  want: number; // target for "good" fit variety
  min: number; // minimum for generation to work well at all
  optional: boolean;
  href: string;
  hint: string;
}

// Targets tuned for enough variety that the stylist can compose distinct,
// occasion-spread outfits (work/casual/friends/date).
const ITEM_SLOTS: {
  key: string;
  label: string;
  cats: Category[];
  min: number;
  want: number;
  optional: boolean;
  hint: string;
}[] = [
  { key: "tops", label: "Tops", cats: ["top", "full_body"], min: 2, want: 4, optional: false, hint: "tees, shirts, knits — variety drives distinct looks" },
  { key: "bottoms", label: "Bottoms", cats: ["bottom"], min: 2, want: 3, optional: false, hint: "at least one dressier pair for work fits" },
  { key: "footwear", label: "Shoes", cats: ["footwear"], min: 1, want: 2, optional: false, hint: "one casual + one smarter pair covers most occasions" },
  { key: "outerwear", label: "Outerwear", cats: ["outerwear"], min: 0, want: 1, optional: true, hint: "a jacket or overshirt unlocks layered + cold-weather fits" },
  { key: "accessories", label: "Accessories", cats: ["accessory", "belt", "bag", "headwear"], min: 0, want: 2, optional: true, hint: "belts and bags finish a look" },
];

export interface Coverage {
  itemSlots: CoverageSlot[];
  photoSlots: CoverageSlot[];
  ready: boolean; // enough to generate decent fits
  complete: boolean; // all non-optional targets met
  suggestions: string[]; // human sentences, most important first
}

export function computeCoverage(
  items: WardrobeItem[],
  photos: UserPhoto[]
): Coverage {
  const active = items.filter((i) => !i.deleted && i.enabled);
  const itemSlots: CoverageSlot[] = ITEM_SLOTS.map((s) => ({
    key: s.key,
    label: s.label,
    have: active.filter((i) => s.cats.includes(i.category)).length,
    want: s.want,
    min: s.min,
    optional: s.optional,
    href: "/upload",
    hint: s.hint,
  }));

  const livePhotos = photos.filter((p) => !p.deleted);
  const fullBody = livePhotos.filter((p) => p.kind === "full_body").length;
  const faceShots = livePhotos.filter(
    (p) => p.kind === "selfie" || p.kind === "half_body"
  ).length;
  const photoSlots: CoverageSlot[] = [
    {
      key: "photo_full_body",
      label: "Full-body photo",
      have: fullBody,
      want: 1,
      min: 1,
      optional: false,
      href: "/profile",
      hint: "head-to-shoes, good light — this anchors your proportions",
    },
    {
      key: "photo_face",
      label: "Face photos",
      have: faceShots,
      want: 2,
      min: 1,
      optional: false,
      href: "/profile",
      hint: "one sharp frontal + one three-quarter angle locks your likeness",
    },
  ];

  const suggestions: string[] = [];
  for (const s of photoSlots) {
    if (s.have < s.want) {
      const need = s.want - s.have;
      suggestions.push(
        s.key === "photo_full_body"
          ? `Add ${need} full-body photo${need > 1 ? "s" : ""} (head to shoes)`
          : `Add ${need} more face photo${need > 1 ? "s" : ""} (frontal + three-quarter angle)`
      );
    }
  }
  for (const s of itemSlots) {
    if (s.have < s.want && !s.optional) {
      const need = s.want - s.have;
      suggestions.push(`Add ${need} more ${s.label.toLowerCase()} (have ${s.have}, ${s.want} makes for real variety)`);
    }
  }
  for (const s of itemSlots) {
    if (s.have < s.want && s.optional) {
      suggestions.push(`Optional: ${s.hint}`);
    }
  }

  const ready =
    itemSlots.every((s) => s.have >= s.min) &&
    photoSlots.every((s) => s.have >= s.min);
  const complete =
    itemSlots.filter((s) => !s.optional).every((s) => s.have >= s.want) &&
    photoSlots.every((s) => s.have >= s.want);

  return { itemSlots, photoSlots, ready, complete, suggestions };
}

/** Short human summary of what's missing to start generating at all. */
export function blockingGaps(cov: Coverage): string[] {
  const gaps: string[] = [];
  for (const s of [...cov.photoSlots, ...cov.itemSlots]) {
    if (s.have < s.min) {
      const need = s.min - s.have;
      gaps.push(`${need} ${s.label.toLowerCase()}${need > 1 && !s.label.endsWith("s") ? "s" : ""}`);
    }
  }
  return gaps;
}
