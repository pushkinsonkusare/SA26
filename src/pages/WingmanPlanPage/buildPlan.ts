import type { CatalogProduct, ProductTier } from "../../catalog/catalog";
import {
  buildActivityConstraints,
  detectActivitiesFromQuery as detectWaveActivities,
  enforceAndRankActivityFit,
} from "../../catalog/activityProfiles";
import {
  buildRowProductsFromSpec,
  extractActivitiesFromQuery,
  pickRecipeForIntent,
} from "../../components/SideBySideAssistant/conversation/broadRecipes";
import {
  buildAccessoryBundle,
  classifyIntent,
  findAccessoriesFor,
  isAccessoryCompatibleWithAnyCoreStrict,
} from "../../components/SidecarAssistant/conversation/flow";

/* =============================================================
 * buildPlan — pure, catalog-aware planner for the Wingman Plan page.
 *
 * Given a free-text shopper query (e.g. "I want to start drone
 * photography"), it produces:
 *   - a shortened hero headline
 *   - a per-activity subhead + lifestyle banner image
 *   - three curated combos (budget / ideal / top-of-the-line) that
 *     each pair a core product with a 5-6 item accessory bundle
 *   - a list of category accordions (one per recipe row)
 *
 * Implementation reuses the existing intent + recipe + accessory
 * helpers so the curation stays consistent with what the side-by-side
 * assistant produces for the same query — no hand-authored combos,
 * no new ML calls.
 * ============================================================= */

/* Wingman-curated tiers — the three combos `buildPlan()` returns
 * for any plan. */
export type WingmanComboTier = "budget" | "ideal" | "top";

/* All combo identities, including the chat-derived "Custom" combo
 * that appears in the tab strip only after the shopper has asked the
 * Wingman chat bar to steer (see `buildCustomCombo.ts`). The custom
 * combo isn't part of `PlanResult.combos` — it's lifted into
 * `WingmanPlanPage` and concatenated for display. */
export type ComboTier = WingmanComboTier | "custom";
export type ComboBadgeTone = "green" | "blue" | "purple" | "amber";

export type Combo = {
  id: ComboTier;
  /** Human-readable kit label, e.g. "Budget Kit". */
  label: string;
  /** All-caps tagline chip, e.g. "GREAT VALUE". */
  tagline: string;
  /** Pastel badge tint that paints the "01"/"02"/"03" pill. */
  badgeTone: ComboBadgeTone;
  /** Hero/core product anchoring the combo. */
  core: CatalogProduct;
  /** 0-6 accessories returned by `buildAccessoryBundle`. */
  accessories: CatalogProduct[];
  /** core.price + sum(accessory.price). 0 when prices are missing. */
  totalPrice: number;
};

export type CategoryAccordion = {
  /** Stable id sourced from the {@link BroadSubTopicSpec} the row was
   * built from. Lets the caller key React lists without colliding even
   * across regenerated runtime specs. */
  id: string;
  /** Title from the recipe row, e.g. "Compact drones". */
  title: string;
  /** Per-category one-liner (canned, see CATEGORY_SUBTITLE map). */
  subtitle: string;
  /** First product image — used as the collapsed-row thumbnail. */
  thumbnailUrl?: string;
  products: CatalogProduct[];
};

export type PlanResult = {
  /** Best-effort hero headline derived from the query. Falls back to
   * the raw query when the shortener has nothing to strip. */
  headline: string;
  /** Original query unchanged — kept so the empty state and the CTAs
   * can echo it back to the shopper exactly as typed. */
  rawQuery: string;
  /** Short supporting copy under the headline. Varies by detected
   * activity (e.g. "perfect for travel" vs. "podcast-ready audio"). */
  subhead: string;
  /** File name inside `public/Dji_product_images/marketing-assets/
   * activity-banner/` — resolve through `activityBannerUrl()`. */
  heroImageFile: string;
  /** Activities the keyword extractor caught in the query — surfaced
   * for analytics / debugging, not currently rendered. */
  detectedActivities: string[];
  /** Exactly 3 combos when `hasResults` is true; ordered budget → ideal
   * → top so the rendering layer can map by index without re-sorting. */
  combos: Combo[];
  /** One accordion per non-empty recipe row. */
  categories: CategoryAccordion[];
  /** False when the query is empty OR when the catalog produced zero
   * usable cores AND zero category rows. Page renders an empty state. */
  hasResults: boolean;
};

/* ---------- Hero copy + imagery ---------- */

const HERO_BANNER_BASE = `${
  (import.meta.env.BASE_URL || "/").replace(/\/+$/, "")
}/Dji_product_images/marketing-assets/activity-banner`;

/** Default banner — used when no activity is detected or when an
 *  activity has no curated banner mapped. The "Mini Beginner drone"
 *  shot covers the common drone-photography starter intent that drove
 *  the v1 design. */
export const FALLBACK_HERO_FILE = "Mini Beginner drone banner.jpg";

/** Per-activity hero banner. Limited by what's actually shipped under
 *  `public/Dji_product_images/marketing-assets/activity-banner/` —
 *  unmapped activities fall through to {@link FALLBACK_HERO_FILE}. */
const ACTIVITY_BANNER_FILE: Record<string, string> = {
  motorcycle: "Moto vlog banner.jpg",
  cycling: "Mountain bike banner.jpg",
  skiing_snowboarding: "Skiing banner.jpg",
  surfing: "Surfing banner.jpg",
  watersports: "Diving Banner.jpg",
  hiking_outdoor: "Hiking banner.jpeg",
  travel: "Street photography banner.webp",
  vlog: "Vlogging Banner.jpg",
  podcast: "podcast interview banner.jpg",
  interview: "podcast interview banner.jpg",
  livestream: "Mic banner.jpg",
  wedding: "Wedding photography banner.png",
  real_estate_aerial: "Real estate banner.jpg",
  news_journalism: "Vlogging Banner.jpg",
  concert_event: "Mic banner.jpg",
  theatre: "Mic banner.jpg",
  indoor_sports: "Stabilizer banner.jpg",
  family: "Mini Beginner drone banner.jpg",
  beginner_creator: "Beginner drone banner.jpg",
  professional_filmmaker: "Advanced Film making banner.jpg",
  /* Phone-creator hero — reuse the Stabilizer banner since the
   * Osmo Mobile lineup is the visual centerpiece of the kit. */
  phone_photography: "Stabilizer banner.jpg",
};

/* Query-keyword banner overrides — cover shopper sub-themes that
 * aren't first-class primary activities (FPV racing, running) so the
 * new banners under `activity-banner/` actually surface for the
 * queries they were shot for. Each entry pairs a banner file with a
 * matching subhead so the hero copy stays in lockstep with the image.
 *
 * Order matters: more-specific patterns sit above broader ones (drone
 * racing wins over generic FPV). Overrides win over the
 * `ACTIVITY_BANNER_FILE` lookup so a query like "fpv vlog" lands on
 * the FPV banner instead of the generic vlog one — the override
 * keywords are narrower than any activity in the vocab, so existing
 * activity matches (motorcycle, surfing, wedding, …) keep firing
 * unchanged whenever the query has no override hit. */
const KEYWORD_BANNER_OVERRIDES: ReadonlyArray<{
  test: RegExp;
  file: string;
  subhead: string;
}> = [
  /* ---- Drone product / family overrides ----
   * These fire when the shopper explicitly names a product line, and
   * win over activity-driven banners ("Mavic for travel" should show
   * the Mavic banner, not the generic Street-photography travel one).
   * Ordered specific → broad inside the family. */
  {
    test: /\b(inspire\s*3|inspire\s*iii)\b/i,
    file: "Inspire 3 banner.jpg",
    subhead:
      "Cinema-grade aerial cinematography paired with the lenses, batteries and rigging crews trust.",
  },
  {
    test: /\b(mini\s*3\s*pro|dji\s*mini\s*3\s*pro)\b/i,
    file: "Mini 3 pro banner.jpg",
    subhead:
      "A compact, plane-friendly aerial that punches well above its weight class.",
  },
  {
    /* Catches Mavic 4 Pro / Mavic 3 Pro / Mavic Air / generic Mavic
     * — broad enough to be a useful family fallback, but only fires
     * when the shopper actually typed "Mavic". */
    test: /\bmavic\b/i,
    file: "Mavic banner.png",
    subhead:
      "Pro-grade aerial photography with the optics, range and stabilization the Mavic line is known for.",
  },

  /* ---- FPV / racing — kept above the generic "running" / photo
   * niches because shoppers mentioning FPV almost always want the
   * goggles-on framing, even if the rest of the query mentions
   * filmmaking or vlogging. */
  {
    test: /\b(drone\s*racing|racing\s*drone|race[rsd]?\s*drone|fpv\s*racing)\b/i,
    file: "FPV 2 banner.jpg",
    subhead:
      "Race-ready FPV drones, goggles and protective gear tuned for high-speed flight.",
  },
  {
    test: /\b(fpv|first[\s-]*person[\s-]*view)\b/i,
    file: "FPV banner.jpg",
    subhead:
      "Immersive FPV drones, goggles and accessories that put you in the cockpit.",
  },
  {
    test: /\b(hik\w*|trek\w*|trail|outdoor(?:s)?|wilderness|backpack\w*)\b/i,
    file: "Hiking banner.jpeg",
    subhead:
      "Explore the outdoors with rugged, lightweight gear tuned for hiking routes and travel days.",
  },
  {
    test: /\b(paraglid\w*|base\s*jump\w*|wingsuit\w*|skydiv\w*|skydive\w*)\b/i,
    file: "Aerial activity banner optimized.jpg",
    subhead:
      "Aerial-ready kits with secure body mounts, rugged capture, and stabilized footage for high-altitude adventures.",
  },

  /* ---- Activity sub-themes that aren't first-class primary
   * activities in the v6 vocab. Each one is intentionally narrow so
   * generic queries ("photography", "video") don't get hijacked. */
  {
    test: /\b(snorkel\w*|reef\s*shoot\w*|coral\s*shoot\w*)\b/i,
    file: "Snorkeling banner.jpg",
    subhead:
      "Submersible-ready cameras and floating mounts for shallow-water and reef shoots.",
  },
  {
    test: /\b(landscape\s*photo\w*|nature\s*photo\w*|scenic\s*shoot\w*|landscape\s*shoot\w*|vista\s*shoot\w*)\b/i,
    file: "Landscape photography banner.png",
    subhead:
      "Wide-angle aerials and stabilizers for sweeping vistas and the long approach shot.",
  },
  {
    /* Cityscape sits next to landscape so urban-skyline shoppers get
     * a kit framed for buildings + lights rather than the wider
     * nature framing of the landscape banner. */
    test: /\b(cityscape\w*|city\s*sky\s*line\w*|urban\s*sky\s*line\w*|urban\s*photo\w*|skyline\s*photo\w*)\b/i,
    file: "cityscape banner.jpg",
    subhead:
      "Aerial drones and stabilized cameras tuned for skylines, neon and the long urban exposure.",
  },
  {
    /* "Night photography" is its own intent — distinct from astro /
     * milky way (which need a tracker mindset) and from generic
     * low-light vlogging. Sits above the low-light override so the
     * explicit phrase always wins. */
    test: /\b(night\s*photo\w*|night\s*time\s*photo\w*|after\s*dark\s*shoot\w*|after[\s-]*dark\s*photo\w*)\b/i,
    file: "night photography banner.jpg",
    subhead:
      "Low-light-ready cameras and tripods built for cityscapes, long exposures and the after-dark shoot.",
  },
  {
    /* "low light" alone is too broad (any creator might say "I shoot
     * in low light") — pair it with photo / capture context so a
     * vlogger asking about low-light vlogging doesn't lose their
     * vlog banner. Astro / night-sky / Milky Way are unambiguous. */
    test: /\b(astro\w*|night\s*sky|milky\s*way|star\s*scape|star[\s-]*photo\w*|low[\s-]*light\s+(?:photo\w*|video|shoot\w*|capture|content))\b/i,
    file: "Low light banner.jpg",
    subhead:
      "Low-light-ready cameras and stabilization built for the moments after the sun goes down.",
  },
  {
    /* Real-estate photo / property tour queries — covers the cases
     * where the catalog tagger doesn't flip the `real_estate_aerial`
     * activity (e.g. "real estate photography kit"). The activity
     * mapping above handles aerial-specific intent. */
    test: /\b(real\s*estate\s*(?:photo\w*|video|shoot\w*|tour\w*|listing\w*|content)|property\s*(?:photo\w*|video|shoot\w*|tour\w*|listing\w*)|listing\s*photo\w*|architectural\s*(?:photo\w*|shoot\w*))\b/i,
    file: "Real estate banner.jpg",
    subhead:
      "Aerial-first kit tuned for property reveals, listing tours and architectural shots.",
  },
  {
    /* Gym / fitness creator queries — covers home-gym workout vlogs,
     * crossfit / strength content, fitness coaching kits. Sits above
     * the bare "running" override since a gym-running query is more
     * gym-shaped than trail-shaped. */
    test: /\b(gym|home\s*gym|fitness\s*(?:vlog\w*|content|creator|coach\w*|kit|gear|setup)?|workout\s*(?:vlog\w*|content|video|kit|gear)?|cross\s*fit|weight\s*lift\w*|strength\s*train\w*|body\s*build\w*|powerlift\w*|hiit\s*(?:workout|training|content)?)\b/i,
    file: "Gym banner.jpg",
    subhead:
      "Body-mounted cameras, mics and stabilization built for the gym floor and home workout setups.",
  },
  {
    test: /\b(film\s?making|film\s?maker|short\s*film|narrative\s*film|cine(?:ma)?\s*shoot\w*|cinematic\s*shoot\w*)\b/i,
    file: "Film making banner.jpg",
    subhead:
      "Cinematic kits — drones, gimbals and audio tuned for narrative shoots and short film sets.",
  },
  {
    /* Sits below film-making and the product overrides so explicit
     * intent wins, but above generic activity matches so a "content
     * creator kit for travel" still leans creator-first visually. */
    test: /\b(content\s*creator|content\s*creation|creator\s*(?:kit|setup|gear)|youtube[r]?\s*(?:kit|setup|gear)?)\b/i,
    file: "Content creation banner 3.jpg",
    subhead:
      "All-in-one creator kits — capture, audio and stabilization built for your next post.",
  },

  /* ---- Running — most permissive override, kept last so any of the
   * narrower patterns above can claim ambiguous queries first. */
  {
    /* Bare "running" is intentionally NOT matched on its own — it
     * shows up as a verb in unrelated queries like "running a podcast"
     * or "running a small business". We only fire on tokens that are
     * almost always sport-running (jogger / marathon / trail runner /
     * the noun "runner") OR on "running" in a gear-shopping context
     * ("running gear", "kit for running", etc.). */
    test: /\b(jogg(?:ing|er)|marathon\w*|runners?|trail\s*runn\w*|running\s+(?:gear|kit|equipment|cam(?:era)?|vlog|video|content|track\w*|capture|setup|workout)|(?:gear|kit|equipment|setup)\s+for\s+(?:running|runners?|joggers?|marathon\w*))\b/i,
    file: "Running banner.jpg",
    subhead:
      "Lightweight, body-friendly capture gear that keeps up on every run.",
  },
];

/** Resolve a banner file name to a fully-qualified URL, BASE_URL-aware
 *  so dev and the GitHub Pages build both work. Per-segment
 *  `encodeURIComponent` keeps spaces and the `.webp` extension safe. */
export function activityBannerUrl(file: string): string {
  return `${HERO_BANNER_BASE}/${encodeURIComponent(file)}`;
}

/* ---------- Per-product marketing imagery ---------- */

/* Curated marketing photography per product *family* (lives under
 * `public/Dji_product_images/marketing-assets/Product type/`). The
 * default PDP image (Image_URL) is a transparent product cut-out
 * suitable for thumbnails; the marketing assets are full lifestyle /
 * editorial shots that read better as the kit's hero tile.
 *
 * Lookup is by regex match against the product's title (case-insensitive,
 * with `\b` boundaries). Order matters — more-specific patterns sit
 * above broader ones so "Mavic 4 Pro" beats "Mavic 3 Pro" beats a
 * hypothetical bare "Mavic", "Mic Mini 2" beats "Mic Mini" beats
 * "Mic 2" beats bare "Mic", etc. The list only covers products that
 * actually ship a curated image — anything unmatched falls through to
 * the PDP image at the call site. */
const PRODUCT_TYPE_IMAGE_BASE = `${
  (import.meta.env.BASE_URL || "/").replace(/\/+$/, "")
}/Dji_product_images/marketing-assets/Product type`;

const PRODUCT_TYPE_IMAGE_FILES: ReadonlyArray<{ test: RegExp; file: string }> =
  [
    /* Action cameras (Osmo Action series) */
    { test: /\bosmo\s*action\s*6\b/i, file: "Action 6.jpg" },
    { test: /\bosmo\s*action\s*5\s*pro\b/i, file: "Action 5 pro.jpg" },
    { test: /\bosmo\s*action\s*2\b/i, file: "Action 2.jpg" },

    /* Drones — most-specific names first so "Mini 5 Pro" beats
     * a "Mini" prefix match etc. */
    { test: /\bair\s*3s\b/i, file: "Air 3S.jpg" },
    { test: /\bavata\s*2\b/i, file: "Avata 2.jpg" },
    { test: /\bavata\b/i, file: "Avata.jpg" },
    { test: /\bflip\b/i, file: "Flip.jpg" },
    { test: /\blito\s*x1\b/i, file: "Lito X1.jpg" },
    { test: /\bmavic\s*4\s*pro\b/i, file: "Mavic 4 pro.jpg" },
    { test: /\bmavic\s*3\s*pro\b/i, file: "Mavic 3 Pro.jpg" },
    { test: /\bmini\s*5\s*pro\b/i, file: "Mini 5 pro.jpg" },
    { test: /\bmini\s*4\s*pro\b/i, file: "Mini 4 Pro.jpg" },
    { test: /\bneo\s*2\b/i, file: "Neo 2.jpg" },

    /* Microphones — Mini 2 > Mini > 3 > 2 > bare Mic */
    { test: /\bmic\s*mini\s*2\b/i, file: "Mic Mini 2.jpg" },
    { test: /\bmic\s*mini\b/i, file: "Mic mini.jpg" },
    { test: /\bmic\s*3\b/i, file: "Mic 3.jpg" },
    { test: /\bmic\s*2\b/i, file: "Mic 2.jpg" },
    { test: /\bdji\s*mic\b/i, file: "Mic.jpg" },

    /* Pocket / Nano / 360 */
    { test: /\bosmo\s*nano\b/i, file: "Osmo Nano.jpg" },
    { test: /\bosmo\s*360\b/i, file: "osmo 360.jpg" },
    { test: /\bosmo\s*pocket\b/i, file: "Osmo pocket.jpg" },

    /* Mobile gimbals — version numbers first, SE last so the bare
     * "Osmo Mobile SE" doesn't get clobbered by a numeric match. */
    { test: /\bosmo\s*mobile\s*8\b/i, file: "Osmo mobile 8.jpg" },
    { test: /\bosmo\s*mobile\s*7\b/i, file: "Osmo mobile 7.jpg" },
    { test: /\bosmo\s*mobile\s*6\b/i, file: "Osmo mobile 6.jpg" },
    { test: /\bosmo\s*mobile\s*se\b/i, file: "Osmo mobile SE.jpg" },

    /* Camera gimbals (RS series) — accept "RS4", "RS 4", "RS-4". */
    { test: /\brs[\s-]*3[\s-]*mini\b/i, file: "RS3 mini.jpg" },
    { test: /\brs[\s-]*4[\s-]*mini\b/i, file: "RS4 Mini.jpg" },
    { test: /\brs[\s-]*4[\s-]*pro\b/i, file: "RS4 Pro.jpg" },
    { test: /\brs[\s-]*5\b/i, file: "RS5.jpg" },
    { test: /\brs[\s-]*4\b/i, file: "RS4.jpg" },
  ];

/** Resolve a curated marketing image for the given product. Returns
 *  `undefined` when no curated image is mapped — callers should fall
 *  back to `product.imageUrl` (the PDP cut-out). */
export function productTypeImageUrl(
  product: { title?: string | null } | null | undefined,
): string | undefined {
  const title = product?.title;
  if (!title) return undefined;
  for (const { test, file } of PRODUCT_TYPE_IMAGE_FILES) {
    if (test.test(title)) {
      return `${PRODUCT_TYPE_IMAGE_BASE}/${encodeURIComponent(file)}`;
    }
  }
  return undefined;
}

/**
 * Pick the hero banner + subhead for a Wingman query.
 *
 * Order:
 *   1. {@link KEYWORD_BANNER_OVERRIDES} — narrow shopper sub-themes
 *      (FPV racing, FPV, running) that don't map to a first-class
 *      primary activity but ship with a curated banner under
 *      `activity-banner/`.
 *   2. {@link ACTIVITY_BANNER_FILE} / {@link ACTIVITY_SUBHEAD} —
 *      banner + copy for the first detected v6 primary activity
 *      (motorcycle, vlog, wedding, …).
 *   3. {@link FALLBACK_HERO_FILE} / {@link DEFAULT_SUBHEAD} — a
 *      neutral beginner-drone visual when nothing else matches.
 *
 * Returning the pair from a single helper keeps banner and subhead in
 * lockstep — they used to be looked up from parallel maps at each
 * call site, which made it easy to update one and forget the other.
 */
function pickHero(
  query: string,
  detectedActivities: string[],
): { heroImageFile: string; subhead: string } {
  for (const override of KEYWORD_BANNER_OVERRIDES) {
    if (override.test.test(query)) {
      return { heroImageFile: override.file, subhead: override.subhead };
    }
  }
  const primary = detectedActivities[0] ?? "";
  return {
    heroImageFile: ACTIVITY_BANNER_FILE[primary] ?? FALLBACK_HERO_FILE,
    subhead: ACTIVITY_SUBHEAD[primary] ?? DEFAULT_SUBHEAD,
  };
}

/** Per-activity subhead. Mirrors the Figma's tone — punchy, present
 *  tense, "we're going to help you get there". */
const ACTIVITY_SUBHEAD: Record<string, string> = {
  motorcycle: "Built to ride: rugged cameras, mounts and mics for capturing every twist of the road.",
  cycling: "Hands-free shots from the saddle — action cams, mounts and aerial pairings ready to roll.",
  skiing_snowboarding: "Wind-resistant gear that keeps shooting when the temperature drops.",
  surfing: "Waterproof rigs and floating mounts so the next set is the only thing you have to worry about.",
  watersports: "Submersible-ready cameras and protective cases tuned for the water.",
  hiking_outdoor: "Lightweight kit that travels well and shoots better off-grid.",
  travel: "Compact, plane-friendly gear that captures the trip without weighing down the bag.",
  vlog: "Talking-head ready: pocket cameras, mics and gimbals tuned for creator workflows.",
  podcast: "Studio-quality audio in a kit that fits in a backpack — ready when guests are.",
  interview: "Two-mic, one-camera setups built for clean dialogue in any room.",
  livestream: "Stream-ready cameras and audio that look professional from frame one.",
  wedding: "Cinematic drones, smooth gimbals and dependable wireless audio for the day that has to come out perfect.",
  real_estate_aerial: "Aerial-first kit tuned for property reveals and architectural shots.",
  news_journalism: "Run-and-gun ready: pocket cams, wireless mics and stabilization for fast turnarounds.",
  concert_event: "Capture the crowd and the stage with gear sized for tight venues.",
  theatre: "Discreet audio + stable visuals for stage productions where reshoots aren't an option.",
  indoor_sports: "Court-side action cams and FPV stabilization built for fast indoor motion.",
  family: "Easy-to-fly drones and pocket cameras the whole family can pick up and use.",
  beginner_creator: "Beginner-friendly kits with everything you need to start creating from day one.",
  professional_filmmaker: "Pro-grade aerials, gimbals and audio for sets that demand cinematic results.",
  phone_photography:
    "Phone-first kits — Osmo Mobile gimbals, magnetic clamps, ND filters and wireless audio for shooting straight from your pocket.",
};

/** Subhead shown when no activity is detected — calibrated to the
 *  drone-photography starter intent the page was designed around. */
const DEFAULT_SUBHEAD =
  "Here are beginner-friendly kits curated by Wingman to help you start creating right away.";

/** Eyebrow + chips copy lives on the page component itself rather than
 *  the planner — they don't depend on the query. */

/* ---------- Combo presentation labels ----------
 *
 * Branded names + tagline chips don't come from the catalog — they're
 * a product-marketing layer the planner stamps on top of the dynamic
 * core/accessory selection. Keeping them here (vs. in the page
 * component) lets us swap copy per-tier without touching JSX.
 */

type ComboCopy = { label: string; tagline: string; badgeTone: ComboBadgeTone };

/* Only the three wingman-curated tiers carry built-in copy — the
 * "custom" combo built from a chat message authors its own copy in
 * `buildCustomCombo.ts`. */
const COMBO_COPY: Record<WingmanComboTier, ComboCopy> = {
  budget: {
    label: "Budget Kit",
    tagline: "BEST VALUE",
    badgeTone: "green",
  },
  ideal: {
    label: "Ideal Kit",
    tagline: "MOST POPULAR",
    badgeTone: "blue",
  },
  top: {
    label: "Top of the Line",
    tagline: "PRO-GRADE PERFORMANCE",
    badgeTone: "purple",
  },
};

const TIER_TOTAL_MIN: Record<WingmanComboTier, number> = {
  // Total products includes core + accessories.
  budget: 3,
  ideal: 4,
  top: 7,
};

const TIER_TOTAL_MAX: Record<WingmanComboTier, number> = {
  budget: 4,
  ideal: 5,
  top: 8,
};

const BUNDLE_MAX_BY_TIER: Record<WingmanComboTier, number> = {
  budget: TIER_TOTAL_MAX.budget - 1,
  ideal: TIER_TOTAL_MAX.ideal - 1,
  top: TIER_TOTAL_MAX.top - 1,
};

const AERIAL_ACTIVITY_IDS = new Set(["paragliding", "base_jumping"]);
const AERIAL_MOUNT_PRIORITY = ["mount_helmet", "mount_chest", "mount_wrist"] as const;
const WHITEWATER_ACTIVITY_IDS = new Set(["whitewater_rafting"]);
const WHITEWATER_MOUNT_PRIORITY = ["mount_wrist", "mount_chest"] as const;
const WATERSPORT_ACTIVITY_IDS = new Set([
  "scuba_diving_snorkeling",
  "freediving",
  "whitewater_rafting",
  "kayak_fishing",
  "sailing",
]);
const WATERSPORT_QUERY_PATTERN =
  /\b(scuba|snorkel\w*|freediv\w*|diving|underwater|watersport\w*|water\s*sport\w*|whitewater|rafting|kayak\w*|surf\w*|sail\w*|ocean|sea)\b/i;
const AUDIO_FIRST_QUERY_PATTERN =
  /\b(podcast\w*|interview\w*|livestream\w*|live\s*stream\w*|radio\s*show|microphone\w*|\bmic\b)\b/i;
const EXPLICIT_DRONE_QUERY_PATTERN =
  /\b(drone\w*|mavic|avata|fpv|aerial|mini\s*\d|air\s*\d)\b/i;

function isDroneLikeCore(product: CatalogProduct): boolean {
  if (product.productTypeGroup === "drone") return true;
  if (product.category === "drone") return true;
  if (product.subtypes.some((subtype) => subtype.startsWith("drone_"))) return true;
  return /\b(drone|mavic|avata|fpv|aerial)\b/i.test(product.title);
}

function isAudioFirstSignal(query: string): boolean {
  return AUDIO_FIRST_QUERY_PATTERN.test(query) && !EXPLICIT_DRONE_QUERY_PATTERN.test(query);
}

function isAudioPrimaryProduct(product: CatalogProduct): boolean {
  if (product.category === "microphone") return true;
  if (product.subtypes.some((subtype) => subtype.startsWith("mic_"))) return true;
  if (product.useCaseTags.some((tag) => ["podcast", "interview", "livestream"].includes(tag))) {
    return true;
  }
  return /\b(mic|microphone|transmitter|receiver|lavalier)\b/i.test(product.title);
}

function hasWatersportSignal(activityIds: string[], query: string): boolean {
  return activityIds.some((id) => WATERSPORT_ACTIVITY_IDS.has(id)) || WATERSPORT_QUERY_PATTERN.test(query);
}

function prioritizeAerialMountAccessories(
  accessories: CatalogProduct[],
  activityIds: string[],
): CatalogProduct[] {
  if (!activityIds.some((id) => AERIAL_ACTIVITY_IDS.has(id))) return accessories;
  const rankBySubtype = (product: CatalogProduct): number => {
    const idx = AERIAL_MOUNT_PRIORITY.findIndex((subtype) => product.subtypes.includes(subtype));
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  return [...accessories].sort((a, b) => {
    const aRank = rankBySubtype(a);
    const bRank = rankBySubtype(b);
    if (aRank !== bRank) return aRank - bRank;
    return 0;
  });
}

function prioritizeWhitewaterMountAccessories(
  accessories: CatalogProduct[],
  activityIds: string[],
): CatalogProduct[] {
  if (!activityIds.some((id) => WHITEWATER_ACTIVITY_IDS.has(id))) return accessories;
  const rankBySubtype = (product: CatalogProduct): number => {
    const idx = WHITEWATER_MOUNT_PRIORITY.findIndex((subtype) =>
      product.subtypes.includes(subtype),
    );
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  return [...accessories].sort((a, b) => {
    const aRank = rankBySubtype(a);
    const bRank = rankBySubtype(b);
    if (aRank !== bRank) return aRank - bRank;
    return 0;
  });
}

function injectAerialMountFallbacks(
  core: CatalogProduct,
  catalog: CatalogProduct[],
  accessories: CatalogProduct[],
  activityIds: string[],
  size: number,
): CatalogProduct[] {
  if (!activityIds.some((id) => AERIAL_ACTIVITY_IDS.has(id))) return accessories;
  const bySlug = new Set(accessories.map((a) => a.slug));
  const mountCandidates = findAccessoriesFor(core, catalog, {
    role: "mounting",
    limit: 12,
  }).filter((product) =>
    AERIAL_MOUNT_PRIORITY.some((subtype) => product.subtypes.includes(subtype)),
  );
  const injected: CatalogProduct[] = [];
  for (const candidate of mountCandidates) {
    if (bySlug.has(candidate.slug)) continue;
    injected.push(candidate);
    bySlug.add(candidate.slug);
    if (injected.length >= 2) break;
  }
  return [...injected, ...accessories].slice(0, Math.max(1, size));
}

function injectWhitewaterMountFallbacks(
  core: CatalogProduct,
  catalog: CatalogProduct[],
  accessories: CatalogProduct[],
  activityIds: string[],
  size: number,
): CatalogProduct[] {
  if (!activityIds.some((id) => WHITEWATER_ACTIVITY_IDS.has(id))) return accessories;
  const bySlug = new Set(accessories.map((a) => a.slug));
  const mountCandidates = findAccessoriesFor(core, catalog, {
    role: "mounting",
    limit: 12,
  }).filter((product) =>
    WHITEWATER_MOUNT_PRIORITY.some((subtype) => product.subtypes.includes(subtype)),
  );
  const injected: CatalogProduct[] = [];
  for (const candidate of mountCandidates) {
    if (bySlug.has(candidate.slug)) continue;
    injected.push(candidate);
    bySlug.add(candidate.slug);
    if (injected.length >= 2) break;
  }
  return [...injected, ...accessories].slice(0, Math.max(1, size));
}

function injectWatersportCaseFallbacks(
  core: CatalogProduct,
  catalog: CatalogProduct[],
  accessories: CatalogProduct[],
  activityIds: string[],
  query: string,
  size: number,
): CatalogProduct[] {
  if (!hasWatersportSignal(activityIds, query)) return accessories;
  const bySlug = new Set(accessories.map((a) => a.slug));
  const caseCandidates = findAccessoriesFor(core, catalog, {
    role: "storage",
    limit: 12,
    subtypes: ["acc_case"],
    capabilities: ["waterproof"],
  });
  const fallbackCandidates =
    caseCandidates.length > 0
      ? caseCandidates
      : findAccessoriesFor(core, catalog, {
          role: "storage",
          limit: 12,
          subtypes: ["acc_case"],
        });
  const injected: CatalogProduct[] = [];
  for (const candidate of fallbackCandidates) {
    if (bySlug.has(candidate.slug)) continue;
    injected.push(candidate);
    bySlug.add(candidate.slug);
    if (injected.length >= 2) break;
  }
  return [...injected, ...accessories].slice(0, Math.max(1, size));
}

function filterAccessoriesByDisplayedCores(
  accessories: CatalogProduct[],
  cores: CatalogProduct[],
): CatalogProduct[] {
  return accessories.filter((accessory) =>
    isAccessoryCompatibleWithAnyCoreStrict(accessory, cores),
  );
}

function refillStrictCompatibleAccessories(
  accessories: CatalogProduct[],
  cores: CatalogProduct[],
  catalog: CatalogProduct[],
  size: number,
): CatalogProduct[] {
  if (accessories.length >= size) return accessories.slice(0, size);
  const out = [...accessories];
  const seen = new Set(out.map((p) => p.slug));

  const addCandidates = (candidates: CatalogProduct[]) => {
    for (const candidate of candidates) {
      if (out.length >= size) break;
      if (seen.has(candidate.slug)) continue;
      if (!isAccessoryCompatibleWithAnyCoreStrict(candidate, cores)) continue;
      out.push(candidate);
      seen.add(candidate.slug);
    }
  };

  for (const core of cores) {
    if (out.length >= size) break;
    addCandidates(
      findAccessoriesFor(core, catalog, {
        limit: Math.max(10, size * 4),
        requireModelMatch: true,
      }),
    );
  }

  for (const core of cores) {
    if (out.length >= size) break;
    addCandidates(
      findAccessoriesFor(core, catalog, {
        limit: Math.max(10, size * 4),
      }),
    );
  }

  return out.slice(0, size);
}

function normalizeTierAccessoryCount(
  accessories: CatalogProduct[],
  core: CatalogProduct,
  catalog: CatalogProduct[],
  tier: WingmanComboTier,
): CatalogProduct[] {
  const minAccessories = Math.max(0, TIER_TOTAL_MIN[tier] - 1);
  const maxAccessories = Math.max(minAccessories, TIER_TOTAL_MAX[tier] - 1);
  const out = [...accessories].slice(0, maxAccessories);
  if (out.length >= minAccessories) return out;

  const seen = new Set(out.map((a) => a.slug));
  const refill = findAccessoriesFor(core, catalog, {
    limit: Math.max(10, maxAccessories * 4),
    requireModelMatch: true,
  });
  for (const candidate of refill) {
    if (out.length >= minAccessories) break;
    if (seen.has(candidate.slug)) continue;
    out.push(candidate);
    seen.add(candidate.slug);
  }
  if (out.length < minAccessories) {
    const relaxedRefill = findAccessoriesFor(core, catalog, {
      limit: Math.max(12, maxAccessories * 5),
    });
    for (const candidate of relaxedRefill) {
      if (out.length >= minAccessories) break;
      if (seen.has(candidate.slug)) continue;
      out.push(candidate);
      seen.add(candidate.slug);
    }
  }
  if (out.length < minAccessories) {
    const broadRefill = buildAccessoryBundle(core, catalog, Math.max(minAccessories, maxAccessories));
    for (const candidate of broadRefill) {
      if (out.length >= minAccessories) break;
      if (seen.has(candidate.slug)) continue;
      out.push(candidate);
      seen.add(candidate.slug);
    }
  }
  return out.slice(0, maxAccessories);
}

function ensureAudioFirstBundleSize(
  accessories: CatalogProduct[],
  core: CatalogProduct,
  catalog: CatalogProduct[],
  tier: WingmanComboTier,
): CatalogProduct[] {
  const minAccessories = Math.max(0, TIER_TOTAL_MIN[tier] - 1);
  const maxAccessories = Math.max(minAccessories, TIER_TOTAL_MAX[tier] - 1);
  const out = [...accessories].slice(0, maxAccessories);
  if (out.length >= minAccessories) return out;

  const seen = new Set(out.map((a) => a.slug));
  const audioCandidates = catalog
    .filter((product) => {
      if (product.slug === core.slug) return false;
      if (isDroneLikeCore(product)) return false;
      if (!product.isAccessory && !product.isBundle && product.category !== "microphone") return false;
      if (isAudioPrimaryProduct(product)) return true;
      if (product.useCaseTags.some((tag) => ["podcast", "interview", "livestream"].includes(tag))) {
        return true;
      }
      return /\b(tripod|stand|adapter|receiver|transmitter|windscreen|charging\s*case)\b/i.test(
        product.title,
      );
    })
    .sort(byRatingDesc);

  for (const candidate of audioCandidates) {
    if (out.length >= minAccessories) break;
    if (seen.has(candidate.slug)) continue;
    out.push(candidate);
    seen.add(candidate.slug);
  }
  return out.slice(0, maxAccessories);
}

function ensureWatersportCaseSlot(
  accessories: CatalogProduct[],
  core: CatalogProduct,
  catalog: CatalogProduct[],
  activityIds: string[],
  query: string,
  size: number,
): CatalogProduct[] {
  if (!hasWatersportSignal(activityIds, query)) return accessories;
  const alreadyHasCase = accessories.some((a) => a.subtypes.includes("acc_case"));
  if (alreadyHasCase) return accessories;
  const candidates = findAccessoriesFor(core, catalog, {
    role: "storage",
    limit: 20,
    subtypes: ["acc_case"],
    capabilities: ["waterproof"],
  });
  const fallbackCandidates =
    candidates.length > 0
      ? candidates
      : findAccessoriesFor(core, catalog, {
          role: "storage",
          limit: 20,
          subtypes: ["acc_case"],
        });
  const replacement = fallbackCandidates.find(
    (c) => !accessories.some((a) => a.slug === c.slug),
  );
  if (!replacement) return accessories;
  const out = [...accessories];
  if (out.length < size) return [...out, replacement].slice(0, size);
  const replaceIndex = out.findIndex((a) => !a.subtypes.includes("acc_case"));
  if (replaceIndex === -1) return out;
  out[replaceIndex] = replacement;
  return out;
}

/* ---------- Headline shortening ----------
 *
 * Shoppers type conversational sentences ("I want to start drone
 * photography"). The hero looks better with a punchy fragment ("Drone
 * photography starter kit"). Strip the leading "I want to / help me /
 * etc.", strip trailing question marks, capitalize, cap to ~60 chars.
 *
 * Falls back to the raw trimmed query when stripping leaves nothing —
 * we never return a blank headline. */

const HEADLINE_LEADING_PATTERNS: RegExp[] = [
  /^i\s+(want|need|would\s+like|hope)\s+to\s+/i,
  /^i'?m\s+(looking\s+to|trying\s+to|going\s+to|planning\s+to)\s+/i,
  /^help\s+me\s+(with\s+)?/i,
  /^show\s+me\s+/i,
  /^build\s+(me\s+)?/i,
  /^find\s+me\s+/i,
  /^get\s+(me\s+)?/i,
  /^let'?s\s+/i,
  /^can\s+you\s+(help\s+me\s+)?/i,
  /^how\s+do\s+i\s+/i,
  /^what'?s\s+(the\s+)?(best|right)\s+(gear|kit|setup|equipment)\s+for\s+/i,
];

const HEADLINE_MAX_LENGTH = 64;

export function shortenQuery(query: string): string {
  let working = query.trim();
  if (!working) return "";

  /* Strip the leading conversational verb phrase. Loop so chains like
   * "I want to start to ..." get progressively trimmed; cap at 3
   * iterations to avoid pathological inputs eating CPU. */
  for (let i = 0; i < 3; i += 1) {
    let matched = false;
    for (const pattern of HEADLINE_LEADING_PATTERNS) {
      const next = working.replace(pattern, "");
      if (next !== working) {
        working = next.trim();
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }

  /* Drop a trailing punctuation tail; keep internal punctuation intact
   * so phrases like "drones, gimbals & mics" still read naturally. */
  working = working.replace(/[?!.,;:]+$/g, "").trim();

  if (!working) return query.trim();

  /* Ellipsize over-long headlines at a word boundary so we don't
   * truncate mid-token. Shoppers can still see the full query in the
   * subhead/empty-state copy if needed. */
  if (working.length > HEADLINE_MAX_LENGTH) {
    const slice = working.slice(0, HEADLINE_MAX_LENGTH);
    const lastSpace = slice.lastIndexOf(" ");
    working = (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim() + "…";
  }

  /* Capitalize the first letter only — preserve any intentional camel-
   * casing or proper nouns the shopper typed (e.g. "Mavic", "DJI"). */
  return working.charAt(0).toUpperCase() + working.slice(1);
}

function buildHeroHeadline(
  query: string,
  audioFirst: boolean,
  detectedActivities: string[],
): string {
  if (!audioFirst) return shortenQuery(query);
  if (detectedActivities.includes("podcast")) return "Podcast recording kit";
  if (detectedActivities.includes("interview")) return "Interview audio kit";
  if (detectedActivities.includes("livestream")) return "Livestream audio kit";
  if (/\bpodcast\w*\b/i.test(query)) return "Podcast recording kit";
  if (/\binterview\w*\b/i.test(query)) return "Interview audio kit";
  if (/\b(livestream\w*|live\s*stream\w*)\b/i.test(query)) return "Livestream audio kit";
  return shortenQuery(query);
}

/* ---------- Per-row subtitle copy ---------- */

/** Map a recipe row title to a single-sentence sub-copy used by the
 *  collapsed accordion row. Keys are matched by lower-cased substring
 *  so renamed rows ("Wireless microphones" vs. "Microphones") still
 *  hit the same template. Order matters — first hit wins. */
const ROW_SUBTITLE_RULES: Array<{ test: string; subtitle: string }> = [
  { test: "drone", subtitle: "Compact, beginner-friendly aerial cameras" },
  { test: "action camera", subtitle: "Rugged cameras tuned for movement" },
  { test: "pocket camera", subtitle: "Vlog-ready handhelds that fit in a pocket" },
  { test: "vlogging camera", subtitle: "Vlog-ready handhelds tuned for talking heads" },
  { test: "gimbal", subtitle: "Stabilize phone or camera footage in any light" },
  { test: "microphone", subtitle: "Capture clean audio anywhere" },
  { test: "lavalier", subtitle: "Discreet clip-on mics for interviews and dialogue" },
  { test: "filter", subtitle: "Control light and add cinematic depth" },
  { test: "lens", subtitle: "Expand framing with optical add-ons" },
  { test: "case", subtitle: "Protect and carry your gear" },
  { test: "bag", subtitle: "Travel-ready storage for the full kit" },
  { test: "tripod", subtitle: "Steady, repeatable shots — solo or studio" },
  { test: "mount", subtitle: "Attach your camera to anything" },
  { test: "battery", subtitle: "Extend shoot time without swaps" },
  { test: "charger", subtitle: "Top up the kit between flights" },
];

const DEFAULT_ROW_SUBTITLE = "Hand-picked products that match your goal.";

function subtitleFor(rowTitle: string): string {
  const lower = rowTitle.toLowerCase();
  const hit = ROW_SUBTITLE_RULES.find(({ test }) => lower.includes(test));
  return hit?.subtitle ?? DEFAULT_ROW_SUBTITLE;
}

/* ---------- Core picking ---------- */

function byRatingDesc(a: CatalogProduct, b: CatalogProduct): number {
  const ar = a.rating ?? 0;
  const br = b.rating ?? 0;
  if (ar !== br) return br - ar;
  /* Tie-breaker: review count, then price asc so cheaper-but-equally-
   * rated cores naturally land in the budget combo. */
  const av = a.reviewCount ?? 0;
  const bv = b.reviewCount ?? 0;
  if (av !== bv) return bv - av;
  return (a.price ?? Infinity) - (b.price ?? Infinity);
}

/* ---------- Public entry point ---------- */

/**
 * Build a curated plan for the Wingman Plan page.
 *
 * Returns `hasResults: false` (and stable empty arrays) when:
 *   • the query is blank, OR
 *   • the catalog hasn't loaded yet, OR
 *   • the recipe yields zero usable cores AND zero category rows.
 *
 * The page component is responsible for switching to the empty-state
 * UI in those cases — the planner stays pure and side-effect-free.
 */
export function buildPlan(query: string, catalog: CatalogProduct[]): PlanResult {
  const trimmed = query.trim();
  const audioFirst = isAudioFirstSignal(trimmed);
  const waveActivities = detectWaveActivities(trimmed);
  const activityConstraints = buildActivityConstraints(waveActivities);

  const baseEmpty: PlanResult = {
    headline: trimmed ? shortenQuery(trimmed) : "Tell Wingman what you want to shoot",
    rawQuery: trimmed,
    subhead: DEFAULT_SUBHEAD,
    heroImageFile: FALLBACK_HERO_FILE,
    detectedActivities: [],
    combos: [],
    categories: [],
    hasResults: false,
  };

  if (!trimmed || catalog.length === 0) {
    return baseEmpty;
  }

  const detectedActivities = extractActivitiesFromQuery(trimmed);
  const intent = classifyIntent(trimmed);
  const recipe = pickRecipeForIntent(intent, trimmed);

  /* Resolve every recipe row against the live catalog up-front so
   * combo selection and category accordions share the same product
   * pool. Empty rows are dropped — the recipe templates intentionally
   * over-provide so a couple of empty buckets is normal. */
  let rows = recipe
    .map((spec) => ({
      spec,
      products: buildRowProductsFromSpec(spec, catalog),
    }))
    .filter((row) => row.products.length > 0);

  if (rows.length === 0 && hasWatersportSignal(activityConstraints.activities, trimmed)) {
    const fallbackCores = catalog
      .filter((product) => {
        if (product.isAccessory || product.isBundle) return false;
        if (product.category === "action_camera") return true;
        if (product.useCaseTags.includes("underwater")) return true;
        if (product.useCaseTags.includes("waterproof")) return true;
        return /action|osmo/i.test(product.title);
      })
      .sort(byRatingDesc)
      .slice(0, 12);
    if (fallbackCores.length > 0) {
      rows = [
        {
          spec: {
            id: "watersport_fallback_core",
            title: "Underwater-ready cameras",
          },
          products: fallbackCores,
        },
      ];
    }
  }
  if (rows.length === 0 && audioFirst) {
    const fallbackAudioCores = catalog
      .filter((product) => {
        if (product.isBundle && !isAudioPrimaryProduct(product)) return false;
        if (isDroneLikeCore(product)) return false;
        return isAudioPrimaryProduct(product);
      })
      .sort(byRatingDesc)
      .slice(0, 12);
    if (fallbackAudioCores.length > 0) {
      rows = [
        {
          spec: {
            id: "audio_fallback_core",
            title: "Podcast and interview audio gear",
          },
          products: fallbackAudioCores,
        },
      ];
    }
  }

  if (rows.length === 0) {
    return {
      ...baseEmpty,
      detectedActivities,
      ...pickHero(trimmed, detectedActivities),
    };
  }

  /* Core pool = first row whose products include at least one non-
   * accessory. For activity recipes that lead with a flagship category
   * (drones / action cams / pocket cams) this naturally lands on the
   * lead row. If the entire recipe is accessory-flavoured (rare —
   * e.g. an explicit "ND filter" query), fall back to using the
   * union of every row so we still have something to anchor combos
   * around. */
  const flagshipRow = rows.find((row) =>
    row.products.some((p) => !p.isAccessory),
  );
  const corePoolSeed: CatalogProduct[] = flagshipRow
    ? flagshipRow.products.filter((p) => !p.isAccessory)
    : rows.flatMap((row) => row.products);
  let corePool: CatalogProduct[] = corePoolSeed.filter((product) => {
    if (audioFirst && isAudioPrimaryProduct(product) && !isDroneLikeCore(product)) return true;
    return !product.isAccessory && !product.isBundle;
  });
  if (corePool.length === 0 && hasWatersportSignal(activityConstraints.activities, trimmed)) {
    corePool = catalog
      .filter((product) => {
        if (product.isAccessory || product.isBundle) return false;
        if (product.category === "action_camera") return true;
        if (product.useCaseTags.includes("underwater")) return true;
        if (product.useCaseTags.includes("waterproof")) return true;
        return /action|osmo/i.test(product.title);
      })
      .sort(byRatingDesc)
      .slice(0, 12);
  }
  if (corePool.length === 0 && audioFirst) {
    corePool = catalog
      .filter((product) => {
        if (!isAudioPrimaryProduct(product) && (product.isAccessory || product.isBundle)) return false;
        if (isDroneLikeCore(product)) return false;
        return isAudioPrimaryProduct(product);
      })
      .sort(byRatingDesc)
      .slice(0, 12);
  }
  if (corePool.length === 0) {
    corePool = catalog
      .filter((product) => !product.isAccessory && !product.isBundle)
      .sort(byRatingDesc)
      .slice(0, 12);
  }

  const uniqueCorePool = [...new Map(corePool.map((p) => [p.slug, p])).values()];
  const rankedCoresPre =
    waveActivities.length > 0
      ? enforceAndRankActivityFit(uniqueCorePool, trimmed, activityConstraints)
      : [...uniqueCorePool].sort(byRatingDesc);
  const rankedCoresRaw =
    audioFirst
      ? rankedCoresPre.filter((product) => !isDroneLikeCore(product))
      : rankedCoresPre;
  const rankedCores = rankedCoresRaw.length > 0 ? rankedCoresRaw : [...uniqueCorePool].sort(byRatingDesc);

  const byTier = {
    beginner: rankedCores.filter((p) => p.tier === "beginner"),
    intermediate: rankedCores.filter((p) => p.tier === "intermediate"),
    pro: rankedCores.filter((p) => p.tier === "pro"),
    other: rankedCores.filter(
      (p) => p.tier !== "beginner" && p.tier !== "intermediate" && p.tier !== "pro",
    ),
  };
  const accessorySupplyCache = new Map<string, number>();
  const accessorySupplyForCore = (core: CatalogProduct): number => {
    const cached = accessorySupplyCache.get(core.slug);
    if (cached !== undefined) return cached;
    const strict = findAccessoriesFor(core, catalog, {
      limit: 12,
      requireModelMatch: true,
    }).length;
    const broad =
      strict > 0
        ? strict
        : findAccessoriesFor(core, catalog, {
            limit: 12,
          }).length;
    const score = Math.max(strict, broad);
    accessorySupplyCache.set(core.slug, score);
    return score;
  };
  const chosen = new Set<string>();
  const takeFirstDistinct = (
    candidates: CatalogProduct[],
    minAccessories: number,
  ): CatalogProduct | null => {
    for (const candidate of candidates) {
      if (chosen.has(candidate.slug)) continue;
      if (accessorySupplyForCore(candidate) < minAccessories) continue;
      chosen.add(candidate.slug);
      return candidate;
    }
    for (const candidate of candidates) {
      if (chosen.has(candidate.slug)) continue;
      chosen.add(candidate.slug);
      return candidate;
    }
    return null;
  };

  const budgetCore =
    takeFirstDistinct([
      ...byTier.beginner,
      ...byTier.intermediate,
      ...byTier.pro,
      ...byTier.other,
    ], TIER_TOTAL_MIN.budget - 1) ?? null;
  const idealCore =
    takeFirstDistinct([
      ...byTier.intermediate,
      ...byTier.beginner,
      ...byTier.pro,
      ...byTier.other,
    ], TIER_TOTAL_MIN.ideal - 1) ?? null;
  const topCore =
    takeFirstDistinct([
      ...byTier.pro,
      ...byTier.intermediate,
      ...byTier.beginner,
      ...byTier.other,
    ], TIER_TOTAL_MIN.top - 1) ?? null;

  const fallbackCore =
    budgetCore ?? idealCore ?? topCore ?? rankedCores[0] ?? uniqueCorePool[0] ?? null;

  const combos: Combo[] = [];
  const orderedSelections: Array<[WingmanComboTier, CatalogProduct | null]> = [
    ["budget", budgetCore ?? fallbackCore],
    ["ideal", idealCore ?? fallbackCore],
    ["top", topCore ?? fallbackCore],
  ];

  for (const [id, core] of orderedSelections) {
    if (!core) continue;
    const displayedCores: CatalogProduct[] = [core];
    const bundle = buildAccessoryBundle(core, catalog, BUNDLE_MAX_BY_TIER[id]);
    const constrained =
      waveActivities.length > 0
        ? enforceAndRankActivityFit(bundle, trimmed, activityConstraints)
        : bundle;
    const withAerialFallbacks = injectAerialMountFallbacks(
      core,
      catalog,
      constrained,
      activityConstraints.activities,
      BUNDLE_MAX_BY_TIER[id],
    );
    const withWhitewaterFallbacks = injectWhitewaterMountFallbacks(
      core,
      catalog,
      withAerialFallbacks,
      activityConstraints.activities,
      BUNDLE_MAX_BY_TIER[id],
    );
    const withWatersportCases = injectWatersportCaseFallbacks(
      core,
      catalog,
      withWhitewaterFallbacks,
      activityConstraints.activities,
      trimmed,
      BUNDLE_MAX_BY_TIER[id],
    );
    const revalidated =
      waveActivities.length > 0
        ? enforceAndRankActivityFit(withWatersportCases, trimmed, activityConstraints)
        : withWatersportCases;
    const aerialPrioritized = prioritizeAerialMountAccessories(revalidated, activityConstraints.activities);
    const whitewaterPrioritized = prioritizeWhitewaterMountAccessories(
      aerialPrioritized,
      activityConstraints.activities,
    );
    const compatibleOnly = filterAccessoriesByDisplayedCores(
      whitewaterPrioritized,
      displayedCores,
    );
    const accessories = refillStrictCompatibleAccessories(
      compatibleOnly,
      displayedCores,
      catalog,
      BUNDLE_MAX_BY_TIER[id],
    );
    const caseGuaranteed = ensureWatersportCaseSlot(
      accessories,
      core,
      catalog,
      activityConstraints.activities,
      trimmed,
      BUNDLE_MAX_BY_TIER[id],
    );
    const sizeNormalized = normalizeTierAccessoryCount(
      caseGuaranteed,
      core,
      catalog,
      id,
    );
    const tierSizedAccessories = audioFirst
      ? ensureAudioFirstBundleSize(sizeNormalized, core, catalog, id)
      : sizeNormalized;
    const totalPrice =
      (core.price ?? 0) +
      tierSizedAccessories.reduce((sum, accessory) => sum + (accessory.price ?? 0), 0);
    const copy = COMBO_COPY[id];
    combos.push({
      id,
      label: copy.label,
      tagline: copy.tagline,
      badgeTone: copy.badgeTone,
      core,
      accessories: tierSizedAccessories,
      totalPrice,
    });
  }

  const categories: CategoryAccordion[] = rows.map((row) => ({
    id: row.spec.id,
    title: row.spec.title,
    subtitle: subtitleFor(row.spec.title),
    thumbnailUrl: row.products[0]?.imageUrl,
    products: row.products,
  }));

  return {
    headline: buildHeroHeadline(trimmed, audioFirst, detectedActivities),
    rawQuery: trimmed,
    ...pickHero(trimmed, detectedActivities),
    detectedActivities,
    combos,
    categories,
    hasResults: combos.length > 0 && categories.length > 0,
  };
}

/* ---------- Price formatting ----------
 *
 * The catalog already exports a USD-formatted price string per
 * product, but combo totals are computed in this module so we mint a
 * matching formatter here. Kept as a module-level Intl instance so
 * we don't allocate one per render.
 */

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatPriceUsd(priceCents: number): string {
  return usdFormatter.format(Math.max(0, Math.round(priceCents)));
}
