/**
 * Next Best Action (NBA) logic for the Wingman plan page selection.
 *
 * When the shopper ticks product checkboxes (in "Create your own kit"
 * or the combo tiles), the picks land in `wingmanSelectionStore` and
 * surface as pills in the agent bar. This module decides what the
 * shopper most likely wants to do next with that selection and returns
 * a small set of tappable actions rendered right below the pills:
 *
 *   • 1 product          → contextual FAQ chips ("Is it waterproof?",
 *                          "Is it beginner friendly?", …). Tapping asks
 *                          Wingman and gets a templated answer built
 *                          from the product's own catalog data.
 *   • 2-3, same category  → "Compare these" — drops a side-by-side
 *                          comparison into the chat thread.
 *   • 2-3, mixed category → a single "Ask Wingman about these" fallback
 *                          (a cross-category spec comparison isn't
 *                          meaningful).
 *
 * All answers are templated from `CatalogProduct` fields (specs,
 * useCaseTags, tier, …) so they're deterministic and instant — no
 * network / LLM round-trip. Wording can be upgraded later without
 * touching the resolver shape.
 */

import type { CatalogProduct, ProductTier } from "../../catalog/catalog";
import { isAccessoryCompatibleWithCoreStrict } from "../../components/SidecarAssistant/conversation/flow";

export type WingmanNbaItem = {
  /** Stable id for the React key. */
  id: string;
  /** Button copy shown in the NBA row. */
  label: string;
  /** Fired when the shopper taps the chip. */
  run: () => void;
};

/**
 * Callbacks the resolver's action closures need. Kept as a dependency
 * bag so `resolveSelectionNbas` stays a pure function of (products,
 * context, deps) and the page owns the actual chat / kit side-effects.
 */
export type WingmanNbaDeps = {
  /** Append a shopper question + the templated Wingman answer to chat. */
  askInChat: (question: string, answer: string) => void;
  /** Remove the given slugs from the active kit AND untick them. */
  removeFromKit: (slugs: string[]) => void;
  /** Add a browsed product into the (custom) kit. */
  addToKit: (slug: string) => void;
  /** Swap an in-kit product for a higher-tier alternative in place. */
  swapForBetter: (oldSlug: string, newSlug: string) => void;
};

/**
 * The active-kit context the resolver needs to decide whether a ticked
 * product is part of the kit the shopper is currently looking at, what
 * role it plays, and whether a higher-tier alternative exists.
 */
export type SelectionContext = {
  /** Slugs currently in the active kit (core + accessories). */
  activeKitSlugs: Set<string>;
  /** The active kit's core/hero product slug, if any. */
  coreSlug: string | null;
  /** Full catalog — used to look up a "better version". */
  catalog: CatalogProduct[];
};

/* ============================================================
 * Spec lookup helper
 * ============================================================ */

/**
 * Find the first spec whose label OR value mentions any of `keywords`
 * (case-insensitive). Returns the raw `CatalogSpec` so callers can
 * decide how to phrase the answer, or null when nothing matches.
 */
function findSpec(
  product: CatalogProduct,
  keywords: string[],
): { label: string; value: string } | null {
  const lowered = keywords.map((k) => k.toLowerCase());
  for (const spec of product.specs) {
    const haystack = `${spec.label} ${spec.value}`.toLowerCase();
    if (lowered.some((k) => haystack.includes(k))) return spec;
  }
  return null;
}

function hasTag(product: CatalogProduct, ...tags: string[]): boolean {
  const set = new Set([...product.useCaseTags, ...product.capabilities]);
  return tags.some((t) => set.has(t));
}

function isCore(product: CatalogProduct): boolean {
  return !product.isAccessory;
}

/* ============================================================
 * FAQ rule library
 * ============================================================ */

type FaqRule = {
  id: string;
  question: (product: CatalogProduct) => string;
  applies: (product: CatalogProduct) => boolean;
  answer: (product: CatalogProduct) => string;
};

const FAQ_RULES: FaqRule[] = [
  {
    id: "beginner",
    question: () => "Is this beginner friendly?",
    applies: (p) => isCore(p),
    answer: (p) => {
      if (p.tier === "beginner" || hasTag(p, "beginner")) {
        return `Yes — the ${p.title} is a great pick if you're just starting out. It's approachable out of the box with sensible defaults.`;
      }
      if (p.tier === "pro" || hasTag(p, "professional")) {
        return `The ${p.title} is a pro-tier product — very capable, but you'll get the most from it once you have some experience.`;
      }
      return `The ${p.title} is a solid intermediate choice — easy enough to start with, but with room to grow into.`;
    },
  },
  {
    id: "waterproof",
    question: () => "Is this waterproof?",
    applies: (p) =>
      p.productTypeGroup === "action_camera" ||
      p.productTypeGroup === "gimbal" ||
      p.productTypeGroup === "drone",
    answer: (p) => {
      if (hasTag(p, "waterproof", "underwater")) {
        const spec = findSpec(p, ["waterproof", "depth", "ip", "water"]);
        return spec
          ? `Yes — the ${p.title} is built for water. ${spec.label}: ${spec.value}.`
          : `Yes — the ${p.title} is built to handle water and wet conditions.`;
      }
      return `No — the ${p.title} isn't waterproof. Keep it dry, or pair it with a protective case for wet conditions.`;
    },
  },
  {
    id: "range",
    question: () => "What's the flight range and time?",
    applies: (p) => p.productTypeGroup === "drone",
    answer: (p) => {
      const range = findSpec(p, ["range", "distance", "transmission"]);
      const time = findSpec(p, ["flight time", "battery", "runtime"]);
      const parts: string[] = [];
      if (range) parts.push(`${range.label}: ${range.value}`);
      if (time) parts.push(`${time.label}: ${time.value}`);
      if (parts.length > 0) {
        return `For the ${p.title} — ${parts.join(" · ")}.`;
      }
      return `The ${p.title}'s exact range and flight time are on its product page — most DJI drones in this class cover several kilometres with 20-45 min of flight per battery.`;
    },
  },
  {
    id: "battery",
    question: (p) =>
      p.productTypeGroup === "drone"
        ? "How long is the flight time?"
        : "How long does the battery last?",
    applies: (p) => p.productTypeGroup !== "drone",
    answer: (p) => {
      const spec = findSpec(p, ["battery", "runtime", "flight time", "operating"]);
      return spec
        ? `For the ${p.title} — ${spec.label}: ${spec.value}.`
        : `Battery life for the ${p.title} varies with usage; check its product page for the rated runtime.`;
    },
  },
  {
    id: "video",
    question: () => "What video quality does it shoot?",
    applies: (p) =>
      p.productTypeGroup === "action_camera" || p.productTypeGroup === "drone",
    answer: (p) => {
      const spec = findSpec(p, ["resolution", "video", "photo", "sensor", "4k", "fps"]);
      if (spec) return `The ${p.title} — ${spec.label}: ${spec.value}.`;
      if (hasTag(p, "lowlight")) {
        return `The ${p.title} shoots high-resolution video and holds up well in low light.`;
      }
      return `The ${p.title} shoots crisp high-resolution video — the exact modes are listed on its product page.`;
    },
  },
  {
    id: "compatibility",
    question: (p) =>
      p.productType === "mobile_gimbal"
        ? "Will it hold my phone?"
        : "What does it work with?",
    applies: (p) => p.productTypeGroup === "gimbal",
    answer: (p) => {
      if (p.productType === "mobile_gimbal") {
        return `Yes — the ${p.title} is a phone gimbal, designed to hold and stabilise a smartphone.`;
      }
      if (p.productType === "camera_gimbal") {
        return `The ${p.title} is a camera gimbal, built for mirrorless / DSLR bodies. Check its payload rating against your camera on the product page.`;
      }
      const types = p.compatibleWithType.filter((t) => t !== "universal");
      return types.length > 0
        ? `The ${p.title} works with: ${types.join(", ")}.`
        : `The ${p.title} is a versatile stabiliser — see its product page for the supported devices.`;
    },
  },
  {
    id: "in-the-box",
    question: () => "What's in the box?",
    applies: (p) => p.inTheBox.length > 0,
    answer: (p) => {
      const items = p.inTheBox.slice(0, 6).join(", ");
      const more = p.inTheBox.length > 6 ? ", and more" : "";
      return `The ${p.title} box includes: ${items}${more}.`;
    },
  },
  {
    id: "value",
    question: () => "Is it worth the price?",
    applies: () => true,
    answer: (p) => {
      const ratingPart =
        p.rating != null
          ? ` It's rated ${p.rating.toFixed(1)}${p.reviewCount ? ` across ${p.reviewCount} reviews` : ""}.`
          : "";
      return `The ${p.title} is ${p.priceFormatted}.${ratingPart} For its ${p.tier} tier it's a strong value in the DJI lineup.`;
    },
  },
];

/** Max FAQ chips surfaced for a single-product selection. */
const MAX_FAQS = 4;

/**
 * Build the contextual FAQ list for a single product — the first
 * `MAX_FAQS` rules that apply, each carrying its templated answer.
 */
export function buildProductFaqs(
  product: CatalogProduct,
): Array<{ id: string; question: string; answer: string }> {
  return FAQ_RULES.filter((rule) => rule.applies(product))
    .slice(0, MAX_FAQS)
    .map((rule) => ({
      id: rule.id,
      question: rule.question(product),
      answer: rule.answer(product),
    }));
}

/* ============================================================
 * Comparison composer
 * ============================================================ */

/**
 * Compose a plain-text side-by-side comparison of the selected
 * products for an assistant bubble. One line per product covering
 * price, rating, tier, and the most differentiating spec available.
 */
export function buildComparisonReply(products: CatalogProduct[]): string {
  const lines = products.map((p) => {
    const bits: string[] = [p.priceFormatted];
    if (p.rating != null) bits.push(`${p.rating.toFixed(1)}★`);
    bits.push(`${p.tier} tier`);
    const highlight =
      findSpec(p, ["range", "resolution", "flight time", "battery", "sensor"]) ??
      p.specs[0] ??
      null;
    if (highlight) bits.push(`${highlight.label}: ${highlight.value}`);
    return `• ${p.title} — ${bits.join(" · ")}`;
  });
  return `Here's how they stack up:\n${lines.join("\n")}`;
}

/* ============================================================
 * Resolver
 * ============================================================ */

function sameCategory(products: CatalogProduct[]): boolean {
  if (products.length < 2) return false;
  const first = products[0].productTypeGroup;
  if (!first) return false;
  return products.every((p) => p.productTypeGroup === first);
}

/* Ordinal ladder for the "better version" upgrade path. */
const TIER_ORDER: Record<ProductTier, number> = {
  beginner: 0,
  intermediate: 1,
  pro: 2,
};

/**
 * Find the best "better version" of `product` while staying strictly
 * within the same fine-grained kind — so an ND filter never becomes a
 * mic, and a Mini drone upgrades to another drone rather than a gimbal.
 *
 * Kind matching:
 *   • Core products (drones, cameras, gimbals): same `productType`
 *     (keeps drone->drone, mobile_gimbal->mobile_gimbal, etc.).
 *     "Better" means a strictly higher tier.
 *   • Accessories: same `accessoryRole` AND still compatible with the
 *     kit's `core` (or, when browsing without a kit, sharing the
 *     source's `compatible_with_type`). Accessory tiers are near-
 *     uniform, so "better" also accepts a same-tier SKU that's pricier
 *     and at least as well rated (a premium version). When the
 *     accessory has no `accessoryRole` we can't identify its kind, so
 *     we bail (no swap) rather than risk crossing categories.
 *
 * Candidates are ranked by series / subtype / productType affinity,
 * then tier, then rating. Returns null when no genuine upgrade exists
 * (the NBA is then omitted).
 */
export function findBetterVersion(
  product: CatalogProduct,
  catalog: CatalogProduct[],
  excludeSlugs: Set<string>,
  core?: CatalogProduct | null,
): CatalogProduct | null {
  const baseTier = TIER_ORDER[product.tier];
  const basePrice = product.price ?? 0;
  const baseRating = product.rating ?? 0;
  const isAccessory = product.isAccessory;

  /* Accessories with no role can't be safely kind-matched; cores need a
   * concrete productType to match against. Bail in either gap. */
  if (isAccessory && !product.accessoryRole) return null;
  if (!isAccessory && !product.productType) return null;

  /* Does `c` count as a genuine step up? Higher tier always wins;
   * otherwise (same tier) require a pricier SKU that's at least as well
   * rated, so we never swap sideways or downward. */
  const isBetter = (c: CatalogProduct): boolean => {
    const cTier = TIER_ORDER[c.tier];
    if (cTier > baseTier) return true;
    if (cTier < baseTier) return false;
    return (c.price ?? 0) > basePrice && (c.rating ?? 0) >= baseRating;
  };

  const sharesSubtype = (c: CatalogProduct): boolean =>
    product.subtypes.length > 0 &&
    c.subtypes.some((s) => product.subtypes.includes(s));

  /* Keep an accessory swap compatible with the same host. With a kit
   * core, reuse the strict combo-assembly check; when browsing without
   * a core, fall back to compatible_with_type overlap (universal is a
   * free pass). */
  const compatibleAccessory = (c: CatalogProduct): boolean => {
    if (core) return isAccessoryCompatibleWithCoreStrict(c, core);
    if (
      product.compatibleWithType.includes("universal") ||
      c.compatibleWithType.includes("universal")
    ) {
      return true;
    }
    if (product.compatibleWithType.length === 0) return true;
    return c.compatibleWithType.some((t) =>
      product.compatibleWithType.includes(t),
    );
  };

  const candidates = catalog.filter((c) => {
    if (c.slug === product.slug) return false;
    if (excludeSlugs.has(c.slug)) return false;
    if (c.isBundle) return false;
    if (!isBetter(c)) return false;

    if (isAccessory) {
      if (!c.isAccessory) return false;
      if (c.accessoryRole !== product.accessoryRole) return false;
      return compatibleAccessory(c);
    }
    return c.productType === product.productType;
  });
  if (candidates.length === 0) return null;

  const scored = candidates.map((c) => {
    let score = TIER_ORDER[c.tier] * 10;
    if (product.series && c.series === product.series) score += 100;
    if (isAccessory && sharesSubtype(c)) score += 40;
    if (c.productType === product.productType) score += 50;
    if (c.rating != null) score += c.rating;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].c;
}

/**
 * Resolve the Next Best Actions for the current selection. Returns an
 * ordered list of tappable items (empty when nothing is selected).
 *
 * The list is contextual to the active kit: ticked products that are
 * part of the kit the shopper is looking at get build-your-kit actions
 * (swap for a better version, remove), while products browsed outside
 * the kit keep the discovery actions (add to kit, FAQs, compare).
 */
export function resolveSelectionNbas(
  products: CatalogProduct[],
  context: SelectionContext,
  deps: WingmanNbaDeps,
): WingmanNbaItem[] {
  if (products.length === 0) return [];

  const inKit = (p: CatalogProduct) => context.activeKitSlugs.has(p.slug);
  const core = context.coreSlug
    ? context.catalog.find((p) => p.slug === context.coreSlug) ?? null
    : null;

  if (products.length === 1) {
    const product = products[0];
    const better = findBetterVersion(
      product,
      context.catalog,
      context.activeKitSlugs,
      core,
    );
    const items: WingmanNbaItem[] = [];

    if (inKit(product)) {
      /* In-kit: help the shopper refine the kit. */
      if (better) {
        items.push({
          id: `swap-${product.slug}`,
          label: "Suggest a better version",
          run: () => deps.swapForBetter(product.slug, better.slug),
        });
      }
      if (context.coreSlug === product.slug) {
        /* Never offer "remove" on the core — it would empty the kit.
         * Round out the row with a single contextual FAQ instead. */
        const faq = buildProductFaqs(product)[0];
        if (faq) {
          items.push({
            id: `faq-${product.slug}-${faq.id}`,
            label: faq.question,
            run: () => deps.askInChat(faq.question, faq.answer),
          });
        }
      } else {
        items.push({
          id: `remove-${product.slug}`,
          label: "Remove this",
          run: () => deps.removeFromKit([product.slug]),
        });
      }
      return items;
    }

    /* Browsing (not in the active kit): discovery actions. */
    items.push({
      id: `add-${product.slug}`,
      label: "Add to kit",
      run: () => deps.addToKit(product.slug),
    });
    if (better) {
      items.push({
        id: `swap-${product.slug}`,
        label: "Suggest a better version",
        run: () => deps.swapForBetter(product.slug, better.slug),
      });
    }
    for (const faq of buildProductFaqs(product).slice(0, 2)) {
      items.push({
        id: `faq-${product.slug}-${faq.id}`,
        label: faq.question,
        run: () => deps.askInChat(faq.question, faq.answer),
      });
    }
    return items;
  }

  /* 2-3 products. */
  const titles = products.map((p) => p.title);
  const listForPrompt =
    titles.length === 2
      ? `${titles[0]} and ${titles[1]}`
      : `${titles.slice(0, -1).join(", ")}, and ${titles[titles.length - 1]}`;

  if (products.every(inKit)) {
    const items: WingmanNbaItem[] = [
      {
        id: "remove-these",
        label: "Remove these",
        run: () => deps.removeFromKit(products.map((p) => p.slug)),
      },
    ];
    const upgradable = products
      .map((p) => ({
        p,
        better: findBetterVersion(
          p,
          context.catalog,
          context.activeKitSlugs,
          core,
        ),
      }))
      .filter(
        (x): x is { p: CatalogProduct; better: CatalogProduct } =>
          x.better !== null,
      );
    if (upgradable.length > 0) {
      items.push({
        id: "swap-these",
        label: "Suggest better versions",
        run: () => {
          for (const { p, better } of upgradable) {
            deps.swapForBetter(p.slug, better.slug);
          }
        },
      });
    }
    return items;
  }

  /* Browsing selection — compare only makes sense within one category. */
  if (sameCategory(products)) {
    return [
      {
        id: "compare",
        label: "Compare these",
        run: () =>
          deps.askInChat(
            `Compare ${listForPrompt}`,
            buildComparisonReply(products),
          ),
      },
    ];
  }

  return [
    {
      id: "ask-about-these",
      label: "Ask Wingman about these",
      run: () =>
        deps.askInChat(
          `Tell me about ${listForPrompt}`,
          buildComparisonReply(products),
        ),
    },
  ];
}
