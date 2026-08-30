import type { WardrobeItem } from "@/lib/types";

/**
 * South Asian / ethnic wear support.
 *
 * The stylist and the renderer both need to know when a look is ethnic, because
 * the rules differ from western tailoring in ways a general fashion model gets
 * wrong: a dhoti is draped rather than worn, it takes no belt, and it pairs with
 * sandals rather than dress shoes.
 *
 * Everything here is keyed off free text (subcategory / name / style tags), so
 * it keeps working as the cataloguer invents new vocabulary.
 */

/** Unstitched or drape-style lower garments — the ones with the special rules. */
const DHOTI_TERMS = [
  "dhoti",
  "dhothi",
  "veshti",
  "vaeshti",
  "mundu",
  "lungi",
  "sarong",
  "panche",
  "kaili",
  "angavastram lower",
];

/** Stitched ethnic lower garments — normal trousers rules, ethnic pairing. */
const ETHNIC_BOTTOM_TERMS = [
  "pyjama",
  "pajama churidar",
  "churidar",
  "salwar",
  "shalwar",
  "patiala",
  "dhoti pants",
  "dhoti-style trouser",
  "harem pant",
];

/** Ethnic upper garments. */
const ETHNIC_TOP_TERMS = [
  "kurta",
  "kurtha",
  "kurti",
  "panjabi",
  "pathani",
  "guayabera kurta",
  "angarkha",
  "jubba",
  "sherwani",
  "achkan",
  "bandhgala",
  "nehru jacket",
  "modi jacket",
  "waistcoat ethnic",
  "koti",
];

/** One-piece / draped ensembles. */
const ETHNIC_FULLBODY_TERMS = [
  "saree",
  "sari",
  "lehenga",
  "anarkali",
  "salwar kameez",
  "shalwar kameez",
  "sherwani set",
  "kurta set",
  "kurta pyjama",
  "langa voni",
  "half saree",
];

/** Shawls, stoles and drapes worn over ethnic looks. */
const ETHNIC_LAYER_TERMS = [
  "angavastram",
  "angavastra",
  "uttariya",
  "dupatta",
  "chunni",
  "odhani",
  "stole ethnic",
  "shawl ethnic",
  "pattu",
];

/** Footwear that actually belongs with ethnic wear. */
const ETHNIC_FOOTWEAR_TERMS = [
  "kolhapuri",
  "jutti",
  "juti",
  "mojari",
  "mojri",
  "nagra",
  "peshawari",
  "chappal",
  "sandal",
  "slide",
  "croc",
  "flip flop",
  "flip-flop",
  "thong sandal",
  "espadrille",
  "loafer",
];

const ALL_ETHNIC_TERMS = [
  ...DHOTI_TERMS,
  ...ETHNIC_BOTTOM_TERMS,
  ...ETHNIC_TOP_TERMS,
  ...ETHNIC_FULLBODY_TERMS,
  ...ETHNIC_LAYER_TERMS,
];

/** Every text field the cataloguer might have put the garment name in. */
function haystack(item: Pick<WardrobeItem, "name" | "subcategory" | "description" | "style_tags">) {
  return [
    item.name ?? "",
    item.subcategory ?? "",
    item.description ?? "",
    ...(item.style_tags ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function matches(item: Parameters<typeof haystack>[0], terms: string[]) {
  const hay = haystack(item);
  return terms.some((t) => hay.includes(t));
}

/** A draped lower garment: dhoti, veshti, mundu, lungi, sarong. */
export function isDhotiStyle(item: Pick<WardrobeItem, "name" | "subcategory" | "description" | "style_tags">) {
  return matches(item, DHOTI_TERMS);
}

/** Any ethnic garment — top, bottom, layer or full-body. */
export function isEthnicItem(item: Pick<WardrobeItem, "name" | "subcategory" | "description" | "style_tags">) {
  return matches(item, ALL_ETHNIC_TERMS) || (item.style_tags ?? []).some((t) => t.toLowerCase() === "ethnic");
}

/** Sandals, crocs, kolhapuris, juttis — the footwear ethnic looks actually take. */
export function isEthnicFootwear(item: Pick<WardrobeItem, "name" | "subcategory" | "description" | "style_tags">) {
  return matches(item, ETHNIC_FOOTWEAR_TERMS);
}

export interface EthnicContext {
  /** Any ethnic garment present. */
  ethnic: boolean;
  /** A draped lower garment is present — triggers the no-belt rule. */
  dhoti: boolean;
}

export function ethnicContext(items: Pick<WardrobeItem, "name" | "subcategory" | "description" | "style_tags">[]): EthnicContext {
  return {
    ethnic: items.some(isEthnicItem),
    dhoti: items.some(isDhotiStyle),
  };
}

/**
 * Hard rule, enforced in code rather than left to the model: a dhoti/veshti/
 * lungi is tied at the waist and takes no belt. The stylist is told this, but
 * models reach for a belt anyway whenever one exists in the wardrobe, so we
 * strip it on the way into the database.
 *
 * Returns the surviving ids plus whatever was dropped, so callers can log it.
 */
export function stripIncompatibleItems<T extends Pick<WardrobeItem, "id" | "category" | "name" | "subcategory" | "description" | "style_tags">>(
  itemIds: string[],
  byId: Map<string, T>
): { itemIds: string[]; dropped: T[] } {
  const chosen = itemIds.map((id) => byId.get(id)).filter(Boolean) as T[];
  if (!chosen.some(isDhotiStyle)) return { itemIds, dropped: [] };

  const dropped: T[] = [];
  const kept = itemIds.filter((id) => {
    const item = byId.get(id);
    if (item && item.category === "belt") {
      dropped.push(item);
      return false;
    }
    return true;
  });
  return { itemIds: kept, dropped };
}

/** Vocabulary block for the cataloguer, so ethnic garments are named properly. */
export const ETHNIC_CATALOGUE_RULES = `- ETHNIC / SOUTH ASIAN WEAR — recognise and name these precisely rather than falling back to generic western labels:
  · Upper (category "top"): kurta, kurti, pathani, angarkha, sherwani, achkan, bandhgala, Nehru jacket, Nehru/Modi waistcoat.
  · Lower (category "bottom"): dhoti, veshti, mundu, lungi, sarong (unstitched drapes) — and pyjama, churidar, salwar, patiala, dhoti-pants (stitched).
  · One-piece (category "full_body"): saree, lehenga, anarkali, salwar kameez, a matched kurta-pyjama or sherwani set.
  · Layers (category "accessory"): angavastram, uttariya, dupatta, chunni, stole.
  · Footwear: kolhapuri, jutti, mojari, nagra, Peshawari chappal.
- A dhoti/veshti/mundu is usually plain white or cream with a coloured or zari border — record the border colour in "colors" and mention it in the description; do not mistake the border for a stripe pattern.
- Always add "ethnic" to style_tags for any of the above, plus a regional tag when it is obvious ("south-indian", "north-indian"). This is what lets the app filter and style them correctly.
- Never catalogue a dhoti or lungi as "shorts", "wrap skirt", "trousers" or "towel".`;

/** Occasion definition injected into the stylist prompt. */
export const ETHNIC_OCCASION_RULE = `- ethnic: traditional South Asian wear — festivals, poojas, weddings, family functions, temple visits. Anchored by a genuinely ethnic piece (kurta, sherwani, dhoti/veshti, saree, salwar kameez). Never label a western outfit "ethnic" just because it is loose or earth-toned. If the wardrobe has no ethnic pieces, produce zero "ethnic" fits.`;

/**
 * Styling rules for the stylist. Only injected when the wardrobe actually has
 * ethnic pieces, so western-only wardrobes don't get irrelevant instructions.
 */
export function ethnicStylistBlock(ctx: EthnicContext): string {
  if (!ctx.ethnic) return "";
  const lines = [
    "ETHNIC WEAR RULES — this wardrobe contains South Asian pieces. When you build an ethnic look, these override the general styling guidance:",
    "- Pair ethnic with ethnic. A kurta goes with a dhoti/veshti, pyjama, churidar or well-cut plain trousers — never with jeans, cargo shorts or athletic bottoms.",
    "- Footwear: sandals, kolhapuris, juttis, mojaris, slides or crocs. Never lace-up dress shoes, never running shoes, never boots. If the wardrobe has no open footwear, say so in styling_notes and leave footwear out rather than forcing sneakers.",
    "- Keep accessorising restrained: a shawl/angavastram or a watch is plenty. No western statement belts, no baseball caps.",
    "- Layering: a Nehru jacket, bandhgala or waistcoat over a kurta is the correct way to dress a look up.",
    "- Label these fits occasion=\"ethnic\" unless they are genuinely office-appropriate ethnic formals, which may be \"work\".",
  ];
  if (ctx.dhoti) {
    lines.push(
      "- DHOTI / VESHTI / LUNGI — hard rules, no exceptions:",
      "  · NEVER include a belt with a dhoti, veshti, mundu or lungi. It is tied at the waist; a belt is simply wrong. This holds even when belts exist in the wardrobe and even when the belt settings are enabled.",
      "  · Do not tuck a kurta into a dhoti. The kurta hangs over it.",
      "  · Footwear is sandals/kolhapuris/crocs only.",
      "  · In styling_notes, say whether the drape is worn FULL LENGTH (ankle-length, formal — temple, wedding, ceremony) or FOLDED AND TUCKED at knee height (the everyday South Indian way: the lower half is lifted and tucked at the waist, hem sitting around the knee). Pick whichever suits the occasion and say why."
    );
  }
  return `\n${lines.join("\n")}\n`;
}

/**
 * Drape instructions for the image models. Getting a dhoti to render correctly
 * is mostly a matter of telling the model it is a wrapped garment, not trousers.
 */
export function ethnicRenderBlock(
  items: Pick<WardrobeItem, "category" | "name" | "subcategory" | "description" | "style_tags">[],
  stylingNotes?: string | null
): string {
  const ctx = ethnicContext(items);
  if (!ctx.ethnic) return "";

  const lines = [
    "ETHNIC GARMENT DRAPE — render these as the real garments, not western lookalikes:",
    "- A kurta is a long straight tunic falling to mid-thigh or below the knee, with a mandarin/band collar or placket. It hangs loose and is never tucked in.",
    "- Keep authentic construction visible: side slits on a kurta, the mandarin collar, the button placket, any zari or embroidered border.",
  ];

  if (ctx.dhoti) {
    const folded = /fold|knee|tuck|half|kaccha|everyday/i.test(stylingNotes ?? "");
    lines.push(
      "- The lower garment is a DHOTI / VESHTI / LUNGI: a single rectangle of unstitched cloth wrapped around the waist and knotted or tucked at the front. It is NOT trousers, NOT a skirt, and has no fly, no pockets, no waistband and no seams down the legs.",
      "- Render the wrap honestly: the vertical fall of the cloth, the pleated fan of fabric at the front where it is tucked, and the coloured or zari border running along the hem.",
      "- NO BELT. Absolutely no belt, no buckle, no waist strap of any kind — the cloth is held by its own knot. Do not add one even if the look seems to need definition at the waist.",
      folded
        ? "- DRAPE STYLE — FOLDED AND TUCKED: the lower half of the cloth is lifted and tucked into the waist so the hem sits at knee height, with the folded edge falling in a clean horizontal line across the knees and the doubled fabric visible. This is the relaxed everyday South Indian way of wearing it. Legs are bare below the knee."
        : "- DRAPE STYLE — FULL LENGTH: the cloth falls straight to the ankles, covering the legs completely, hem just above the feet."
    );
  }

  lines.push(
    "- Footwear must be open: sandals, kolhapuri chappals, juttis, slides or crocs. Never render lace-up dress shoes, sneakers or boots with this outfit."
  );

  return `\n${lines.join("\n")}\n`;
}

/**
 * Goofy poses that actually suit ethnic wear. The dhoti fold-and-tuck is itself
 * a comedic beat in South Indian film, so it earns its own set.
 */
const ETHNIC_GOOFY_POSES = [
  "mid-lungi-dance, both hands flicking the folded hem out to the sides like a film hero",
  "caught in the act of hitching the dhoti up to knee height, one leg lifted, deeply serious face",
  "a full Tamil-cinema swagger walk, angavastram flung over one shoulder mid-flourish",
  "spinning so the dhoti flares out, arms wide, hair everywhere",
  "the 'ready to fight but make it dignified' stance, dhoti tucked, sleeves rolled",
  "an exaggerated wedding-buffet plate-balancing act, kurta immaculate, panic in the eyes",
  "attempting a very ambitious bhangra shoulder-pump entirely alone",
  "the classic uncle pose: hands clasped behind the back, surveying an empty room like it owes him money",
];

/** Extra poses to fold into the comedy set when the outfit is ethnic. */
export function ethnicGoofyPoses(
  items: Pick<WardrobeItem, "category" | "name" | "subcategory" | "description" | "style_tags">[]
): string[] {
  const ctx = ethnicContext(items);
  if (!ctx.ethnic) return [];
  return ctx.dhoti ? ETHNIC_GOOFY_POSES : ETHNIC_GOOFY_POSES.slice(2);
}

/**
 * Even in goofy mode the belt rule holds, but the footwear rule is allowed to
 * break — "unless you want to make it really freaky" was the ask.
 */
export const ETHNIC_GOOFY_LICENCE =
  "The outfit is ethnic wear: the comedy may extend to absurd footwear (crocs with socks, mismatched sandals, one shoe missing) — but the drape itself stays authentic and there is still NO BELT on a dhoti.";
