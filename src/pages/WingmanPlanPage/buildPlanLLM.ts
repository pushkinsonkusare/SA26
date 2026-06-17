import OpenAI from "openai";
import type { CatalogProduct } from "../../catalog/catalog";
import { buildPlan, type Combo, type PlanResult } from "./buildPlan";
import {
  buildActivityConstraints,
  detectActivitiesFromQuery,
} from "../../catalog/activityProfiles";
import {
  findAccessoriesFor,
  isAccessoryCompatibleWithCoreStrict,
} from "../../components/SidecarAssistant/conversation/flow";

const API_KEY = (import.meta.env.VITE_OPENAI_API_KEY ?? "").trim();
const MODEL = (import.meta.env.VITE_OPENAI_MODEL ?? "").trim() || "gpt-4o-mini";

let clientSingleton: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (!API_KEY) return null;
  if (!clientSingleton) {
    clientSingleton = new OpenAI({
      apiKey: API_KEY,
      dangerouslyAllowBrowser: true,
    });
  }
  return clientSingleton;
}

function byScoreDesc(a: CatalogProduct, b: CatalogProduct): number {
  const ar = a.rating ?? 0;
  const br = b.rating ?? 0;
  if (ar !== br) return br - ar;
  const ac = a.reviewCount ?? 0;
  const bc = b.reviewCount ?? 0;
  if (ac !== bc) return bc - ac;
  return (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER);
}

type LlmPlanShape = {
  headline?: unknown;
  subhead?: unknown;
  combos?: unknown;
  categoryRows?: unknown;
};

type LlmComboPick = {
  coreSlug: string;
  accessorySlugs: string[];
};

type LlmCategoryRow = {
  id: string;
  title: string;
  subtitle: string;
  productSlugs: string[];
};

const WATERSPORT_ACTIVITY_IDS = new Set([
  "scuba_diving_snorkeling",
  "freediving",
  "whitewater_rafting",
  "kayak_fishing",
  "sailing",
]);
const WATERSPORT_QUERY_PATTERN =
  /\b(scuba|snorkel\w*|freediv\w*|diving|underwater|watersport\w*|water\s*sport\w*|whitewater|rafting|kayak\w*|surf\w*|sail\w*|ocean|sea)\b/i;

const TIER_TOTAL_MIN = { budget: 3, ideal: 4, top: 7 } as const;
const TIER_TOTAL_MAX = { budget: 4, ideal: 5, top: 8 } as const;
const TIER_ACCESSORY_MAX = {
  budget: TIER_TOTAL_MAX.budget - 1,
  ideal: TIER_TOTAL_MAX.ideal - 1,
  top: TIER_TOTAL_MAX.top - 1,
} as const;

function normalizeComboPick(raw: unknown): LlmComboPick | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { coreSlug?: unknown; accessorySlugs?: unknown };
  if (typeof obj.coreSlug !== "string" || !obj.coreSlug.trim()) return null;
  const accessorySlugs = Array.isArray(obj.accessorySlugs)
    ? obj.accessorySlugs
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return { coreSlug: obj.coreSlug.trim(), accessorySlugs };
}

function normalizeCategoryRows(raw: unknown): LlmCategoryRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: LlmCategoryRow[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const row = item as {
      id?: unknown;
      title?: unknown;
      subtitle?: unknown;
      productSlugs?: unknown;
    };
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (!title) continue;
    const subtitle =
      typeof row.subtitle === "string" && row.subtitle.trim()
        ? row.subtitle.trim()
        : "Hand-picked products for this goal.";
    const productSlugs = Array.isArray(row.productSlugs)
      ? row.productSlugs
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    if (productSlugs.length === 0) continue;
    rows.push({
      id:
        typeof row.id === "string" && row.id.trim()
          ? row.id.trim()
          : `llm-row-${i + 1}`,
      title,
      subtitle,
      productSlugs,
    });
    if (rows.length >= 6) break;
  }
  return rows;
}

function mapComboFromPick(
  id: Combo["id"],
  fallback: Combo | undefined,
  pick: LlmComboPick | null,
  productsBySlug: Map<string, CatalogProduct>,
  accessoryCap: number,
): Combo | null {
  const fallbackCore = fallback?.core;
  const pickedCore = pick ? productsBySlug.get(pick.coreSlug) ?? null : null;
  const core = id === "budget" ? (fallbackCore ?? pickedCore) : (pickedCore ?? fallbackCore);
  if (!core) return null;
  const chosen = new Set<string>();
  const accessories: CatalogProduct[] = [];
  const pickAccessorySlugs = pick?.accessorySlugs ?? [];

  for (const slug of pickAccessorySlugs) {
    const p = productsBySlug.get(slug);
    if (!p) continue;
    if (p.slug === core.slug) continue;
    if (p.isBundle) continue;
    if (!isAccessoryCompatibleWithCoreStrict(p, core)) continue;
    if (chosen.has(p.slug)) continue;
    chosen.add(p.slug);
    accessories.push(p);
    if (accessories.length >= accessoryCap) break;
  }

  if (accessories.length < Math.min(3, accessoryCap) && fallback) {
    for (const p of fallback.accessories) {
      if (p.slug === core.slug) continue;
      if (!isAccessoryCompatibleWithCoreStrict(p, core)) continue;
      if (chosen.has(p.slug)) continue;
      chosen.add(p.slug);
      accessories.push(p);
      if (accessories.length >= accessoryCap) break;
    }
  }

  const totalPrice = accessories.reduce(
    (sum, p) => sum + (p.price ?? 0),
    core.price ?? 0,
  );

  return {
    id,
    label: fallback?.label ?? `${id} kit`,
    tagline: fallback?.tagline ?? "AI-CURATED",
    badgeTone: fallback?.badgeTone ?? "blue",
    core,
    accessories,
    totalPrice,
  };
}

function ensureWatersportCaseSlotForCombo(
  combo: Combo,
  catalog: CatalogProduct[],
  detectedActivities: string[],
  query: string,
): Combo {
  if (
    !detectedActivities.some((id) => WATERSPORT_ACTIVITY_IDS.has(id)) &&
    !WATERSPORT_QUERY_PATTERN.test(query)
  ) {
    return combo;
  }
  if (combo.accessories.some((a) => a.subtypes.includes("acc_case"))) return combo;

  const waterproofCandidates = findAccessoriesFor(combo.core, catalog, {
    role: "storage",
    limit: 20,
    subtypes: ["acc_case"],
    capabilities: ["waterproof"],
  }).filter((a) => isAccessoryCompatibleWithCoreStrict(a, combo.core));
  const fallbackCandidates =
    waterproofCandidates.length > 0
      ? waterproofCandidates
      : findAccessoriesFor(combo.core, catalog, {
          role: "storage",
          limit: 20,
          subtypes: ["acc_case"],
        }).filter((a) => isAccessoryCompatibleWithCoreStrict(a, combo.core));
  const replacement = fallbackCandidates[0];
  if (!replacement) return combo;

  const cap = combo.id === "top" ? 6 : 4;
  const nextAccessories = [...combo.accessories];
  if (nextAccessories.length < cap) {
    nextAccessories.push(replacement);
  } else {
    const replaceIndex = nextAccessories.findIndex((a) => !a.subtypes.includes("acc_case"));
    if (replaceIndex === -1) return combo;
    nextAccessories[replaceIndex] = replacement;
  }
  const totalPrice = nextAccessories.reduce(
    (sum, p) => sum + (p.price ?? 0),
    combo.core.price ?? 0,
  );
  return { ...combo, accessories: nextAccessories, totalPrice };
}

function normalizeTierAccessoryCountForCombo(
  combo: Combo,
  fallback: Combo | undefined,
  catalog: CatalogProduct[],
): Combo {
  const tier = combo.id as keyof typeof TIER_TOTAL_MIN;
  const minAccessories = Math.max(0, TIER_TOTAL_MIN[tier] - 1);
  const maxAccessories = Math.max(minAccessories, TIER_TOTAL_MAX[tier] - 1);
  const accessories = [...combo.accessories].slice(0, maxAccessories);
  const seen = new Set(accessories.map((a) => a.slug));

  if (accessories.length < minAccessories && fallback) {
    for (const candidate of fallback.accessories) {
      if (accessories.length >= minAccessories) break;
      if (seen.has(candidate.slug)) continue;
      if (!isAccessoryCompatibleWithCoreStrict(candidate, combo.core)) continue;
      accessories.push(candidate);
      seen.add(candidate.slug);
    }
  }
  if (accessories.length < minAccessories) {
    const strictCandidates = findAccessoriesFor(combo.core, catalog, {
      limit: Math.max(12, maxAccessories * 4),
      requireModelMatch: true,
    });
    for (const candidate of strictCandidates) {
      if (accessories.length >= minAccessories) break;
      if (seen.has(candidate.slug)) continue;
      if (!isAccessoryCompatibleWithCoreStrict(candidate, combo.core)) continue;
      accessories.push(candidate);
      seen.add(candidate.slug);
    }
  }
  if (accessories.length < minAccessories) {
    const broadCandidates = findAccessoriesFor(combo.core, catalog, {
      limit: Math.max(12, maxAccessories * 5),
    });
    for (const candidate of broadCandidates) {
      if (accessories.length >= minAccessories) break;
      if (seen.has(candidate.slug)) continue;
      if (!isAccessoryCompatibleWithCoreStrict(candidate, combo.core)) continue;
      accessories.push(candidate);
      seen.add(candidate.slug);
    }
  }
  if (accessories.length < minAccessories && fallback) {
    // Hard guardrail: never show a "kit" tab as core-only if the
    // deterministic planner already has a valid tier bundle.
    const fallbackAccessories = fallback.accessories.slice(0, maxAccessories);
    if (fallbackAccessories.length >= minAccessories) {
      const fallbackTotal = fallbackAccessories.reduce(
        (sum, p) => sum + (p.price ?? 0),
        fallback.core.price ?? 0,
      );
      return {
        ...fallback,
        accessories: fallbackAccessories,
        totalPrice: fallbackTotal,
      };
    }
  }
  const totalPrice = accessories.reduce(
    (sum, p) => sum + (p.price ?? 0),
    combo.core.price ?? 0,
  );
  return { ...combo, accessories, totalPrice };
}

/* Flagship hint — captures the productType + subtype signature of
 * the deterministic planner's chosen cores so we can bias the LLM's
 * candidate buckets to the same kit shape. Without this, a
 * phone-photography query gets a phone-gimbal core from `buildPlan`
 * but the LLM still sees a drone-heavy candidate list (filtered by
 * tier only) and happily picks a Mavic for the ideal slot. */
type FlagshipHint = {
  productType: CatalogProduct["productType"] | null;
  /** Subset of subtypes the candidate must share. For phone gimbals
   * this is `["gimbal_phone"]`; for drones it stays empty so we don't
   * over-narrow. */
  subtypes: string[];
};

function deriveFlagshipHint(fallback: PlanResult): FlagshipHint {
  /* Use the deterministic planner's cores as ground truth — all
   * three tiers come from one corePool, so any tier that has a
   * picked core gives us the same hint. Budget is tried first
   * because it's the most likely to be populated (the deterministic
   * pass always returns a budget core when the catalog is
   * non-empty). */
  const core =
    fallback.combos.find((c) => c.id === "budget")?.core ??
    fallback.combos.find((c) => c.id === "ideal")?.core ??
    fallback.combos.find((c) => c.id === "top")?.core ??
    null;
  if (!core) return { productType: null, subtypes: [] };
  /* Only narrow by subtype when the productType is itself broad —
   * e.g. `Gimbals` covers both phone gimbals and camera gimbals, and
   * without a `gimbal_phone` / `gimbal_camera` narrowing the LLM
   * candidate list would still mix the two. Drones don't need
   * subtype narrowing because the productType `drone` is already
   * specific enough. */
  const subtypes: string[] = [];
  if (core.productType === "mobile_gimbal" || core.productType === "camera_gimbal") {
    const gimbalSubtype = core.subtypes.find((s) => s.startsWith("gimbal_"));
    if (gimbalSubtype) subtypes.push(gimbalSubtype);
  }
  return { productType: core.productType || null, subtypes };
}

function matchesFlagshipHint(p: CatalogProduct, hint: FlagshipHint): boolean {
  if (!hint.productType) return true;
  if (p.productType !== hint.productType) return false;
  if (hint.subtypes.length === 0) return true;
  return hint.subtypes.some((s) => p.subtypes.includes(s));
}

function buildPrompt(query: string, catalog: CatalogProduct[], fallback: PlanResult): string {
  const waveActivities = detectActivitiesFromQuery(query);
  const waveConstraints = buildActivityConstraints(waveActivities);
  const flagshipHint = deriveFlagshipHint(fallback);
  /* Cores displayed by the deterministic planner — accessory
   * candidates surfaced to the LLM are pre-filtered to those that
   * pass strict compatibility with at least one of these. That way
   * the LLM can't pick a drone propeller pack for an Osmo Mobile
   * kit even if the slug shows up in the global accessory list. */
  const fallbackCores = fallback.combos
    .map((c) => c.core)
    .filter((p): p is CatalogProduct => Boolean(p));

  const pickCandidates = (items: CatalogProduct[], n: number) =>
    items
      .filter((p) => !p.isBundle && !p.isAccessory)
      .sort(byScoreDesc)
      .slice(0, n)
      .map((p) => ({
        slug: p.slug,
        title: p.title,
        category: p.category,
        tier: p.tier,
        price: p.priceFormatted,
        activities: p.primaryActivities,
        useCaseTags: p.useCaseTags,
      }));

  /* Hint-biased candidate picker. Strict-filters by flagship
   * productType/subtype first; if the hinted pool is too thin
   * (< 3 entries) we top up with the unhinted pool so the LLM
   * still has options and doesn't fall back to inventing slugs. */
  const pickCandidatesBiased = (items: CatalogProduct[], n: number) => {
    if (!flagshipHint.productType) return pickCandidates(items, n);
    const hinted = items.filter((p) => matchesFlagshipHint(p, flagshipHint));
    const minCount = Math.min(3, n);
    if (hinted.length < minCount) {
      const seen = new Set(hinted.map((p) => p.slug));
      const topup = items.filter((p) => !seen.has(p.slug));
      return pickCandidates([...hinted, ...topup], n);
    }
    return pickCandidates(hinted, n);
  };

  const budgetCandidates = pickCandidatesBiased(
    catalog.filter((p) => p.tier === "beginner" || p.tier === "intermediate"),
    12,
  );
  const idealCandidates = pickCandidatesBiased(
    catalog.filter((p) => p.tier === "intermediate" || p.tier === "pro"),
    12,
  );
  const topCandidates = pickCandidatesBiased(
    catalog.filter((p) => p.tier === "pro"),
    12,
  );

  /* Accessory candidates — when the deterministic planner picked a
   * non-drone core (e.g. a phone gimbal) we restrict the accessory
   * pool to those strictly compatible with at least one fallback
   * core. For drone kits we keep the full pool because the LLM
   * usually needs the breadth (FPV components, props, batteries
   * across multiple drone families). */
  const accessoryPool =
    flagshipHint.productType && flagshipHint.productType !== "drone" && fallbackCores.length > 0
      ? catalog.filter(
          (p) =>
            p.isAccessory &&
            !p.isBundle &&
            fallbackCores.some((core) => isAccessoryCompatibleWithCoreStrict(p, core)),
        )
      : catalog.filter((p) => p.isAccessory && !p.isBundle);

  const accessoryCandidates = accessoryPool
    .sort(byScoreDesc)
    .slice(0, 50)
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      category: p.category,
      role: p.accessoryRole,
      compatibleWith: p.compatibleWithModels.slice(0, 4),
      activities: p.primaryActivities,
      price: p.priceFormatted,
    }));

  const categoryCandidates = fallback.categories.slice(0, 8).map((row) => ({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    products: row.products.slice(0, 8).map((p) => ({
      slug: p.slug,
      title: p.title,
      category: p.category,
      tier: p.tier,
      price: p.priceFormatted,
    })),
  }));

  return [
    `Shopper query: "${query}"`,
    "",
    "Pick a page plan from the candidates below.",
    "Return STRICT JSON only with this shape:",
    `{
  "headline": "string <= 64 chars",
  "subhead": "string <= 180 chars",
  "combos": {
    "budget": { "coreSlug": "slug", "accessorySlugs": ["slug"... up to 3] },
    "ideal": { "coreSlug": "slug", "accessorySlugs": ["slug"... up to 4] },
    "top": { "coreSlug": "slug", "accessorySlugs": ["slug"... up to 7] }
  },
  "categoryRows": [
    { "id": "id", "title": "string", "subtitle": "string", "productSlugs": ["slug"... up to 4] }
  ]
}`,
    "",
    "Rules:",
    "- Use only provided slugs.",
    "- Keep combos coherent with query intent.",
    "- Category rows should be useful and diverse.",
    "- Prefer activity alignment over random popular picks.",
    `- Detected activities (wave1): ${JSON.stringify(waveActivities)}`,
    `- Preferred use-case tags: ${JSON.stringify(waveConstraints.preferredUseCaseTags)}`,
    `- Preferred primary activities: ${JSON.stringify(
      waveConstraints.preferredPrimaryActivities,
    )}`,
    `- Preferred subtypes: ${JSON.stringify(waveConstraints.preferredSubtypes)}`,
    `- Disallowed subtypes unless explicitly requested: ${JSON.stringify(
      waveConstraints.disallowedSubtypes,
    )}`,
    `- Disallowed title tokens unless explicitly requested: ${JSON.stringify(
      waveConstraints.disallowedTitleTokens,
    )}`,
    /* Flagship hint — communicates the kit shape the deterministic
     * planner already settled on (e.g. phone gimbal vs drone). The
     * LLM should pick cores matching this productType/subtype unless
     * the query clearly asks for something else. */
    flagshipHint.productType
      ? `- Flagship core type: ${flagshipHint.productType}${
          flagshipHint.subtypes.length > 0
            ? ` (subtypes: ${JSON.stringify(flagshipHint.subtypes)})`
            : ""
        }`
      : "",
    "",
    `Budget core candidates: ${JSON.stringify(budgetCandidates)}`,
    `Ideal core candidates: ${JSON.stringify(idealCandidates)}`,
    `Top core candidates: ${JSON.stringify(topCandidates)}`,
    `Accessory candidates: ${JSON.stringify(accessoryCandidates)}`,
    `Category row candidates: ${JSON.stringify(categoryCandidates)}`,
  ].join("\n");
}

export function isWingmanPlanLlmAvailable(): boolean {
  return Boolean(API_KEY);
}

export async function buildPlanWithLlm(
  query: string,
  catalog: CatalogProduct[],
  signal: AbortSignal,
): Promise<PlanResult | null> {
  const client = getClient();
  const trimmed = query.trim();
  if (!client || !trimmed || catalog.length === 0) return null;

  const fallback = buildPlan(trimmed, catalog);
  const detectedActivities = detectActivitiesFromQuery(trimmed);
  if (!fallback.hasResults) return fallback;
  if (signal.aborted) return null;

  try {
    const response = await client.chat.completions.create(
      {
        model: MODEL,
        temperature: 0.35,
        max_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a DJI commerce planner. Output strict JSON only. Never invent unknown slugs.",
          },
          { role: "user", content: buildPrompt(trimmed, catalog, fallback) },
        ],
      },
      { signal },
    );

    if (signal.aborted) return null;
    const raw = response.choices[0]?.message?.content?.trim();
    if (!raw) return null;

    const parsed = JSON.parse(raw) as LlmPlanShape;
    const productsBySlug = new Map(catalog.map((p) => [p.slug, p] as const));

    const comboObject =
      parsed.combos && typeof parsed.combos === "object"
        ? (parsed.combos as Record<string, unknown>)
        : {};

    /* Flagship hint guard — if the LLM still picks a core whose
     * productType/subtype doesn't match the deterministic kit shape
     * (e.g. a Mavic for a phone-photography ideal slot), we swap in
     * the deterministic combo wholesale rather than mixing a drone
     * core with phone-gimbal accessories. Budget tier is already
     * forced to the deterministic core inside `mapComboFromPick`. */
    const hint = deriveFlagshipHint(fallback);
    const enforceFlagshipHint = (
      combo: Combo | null,
      fallbackCombo: Combo | undefined,
    ): Combo | null => {
      if (!combo || !hint.productType) return combo;
      if (matchesFlagshipHint(combo.core, hint)) return combo;
      return fallbackCombo ?? combo;
    };

    const budgetFallback = fallback.combos.find((c) => c.id === "budget");
    const idealFallback = fallback.combos.find((c) => c.id === "ideal");
    const topFallback = fallback.combos.find((c) => c.id === "top");

    const budget = enforceFlagshipHint(
      mapComboFromPick(
        "budget",
        budgetFallback,
        normalizeComboPick(comboObject.budget),
        productsBySlug,
        TIER_ACCESSORY_MAX.budget,
      ),
      budgetFallback,
    );
    const ideal = enforceFlagshipHint(
      mapComboFromPick(
        "ideal",
        idealFallback,
        normalizeComboPick(comboObject.ideal),
        productsBySlug,
        TIER_ACCESSORY_MAX.ideal,
      ),
      idealFallback,
    );
    const top = enforceFlagshipHint(
      mapComboFromPick(
        "top",
        topFallback,
        normalizeComboPick(comboObject.top),
        productsBySlug,
        TIER_ACCESSORY_MAX.top,
      ),
      topFallback,
    );
    const combos = [budget, ideal, top]
      .filter((c): c is Combo => Boolean(c))
      .map((combo) =>
        ensureWatersportCaseSlotForCombo(combo, catalog, detectedActivities, trimmed),
      )
      .map((combo) =>
        normalizeTierAccessoryCountForCombo(
          combo,
          fallback.combos.find((c) => c.id === combo.id),
          catalog,
        ),
      );

    const categoryRows = normalizeCategoryRows(parsed.categoryRows).map((row) => {
      const products = row.productSlugs
        .map((slug) => productsBySlug.get(slug))
        .filter((p): p is CatalogProduct => Boolean(p))
        .slice(0, 4);
      return {
        id: row.id,
        title: row.title,
        subtitle: row.subtitle,
        thumbnailUrl: products[0]?.imageUrl,
        products,
      };
    });
    const categories = categoryRows.filter((r) => r.products.length > 0);

    const headline =
      typeof parsed.headline === "string" && parsed.headline.trim()
        ? parsed.headline.trim()
        : fallback.headline;
    const subhead =
      typeof parsed.subhead === "string" && parsed.subhead.trim()
        ? parsed.subhead.trim()
        : fallback.subhead;

    if (combos.length === 0 || categories.length === 0) {
      return fallback;
    }

    return {
      ...fallback,
      headline,
      subhead,
      combos,
      categories,
      hasResults: true,
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name?: string }).name === "AbortError"
    ) {
      return null;
    }
    // eslint-disable-next-line no-console
    console.warn("[wingman-plan-llm] build failed, falling back to local planner", error);
    return null;
  }
}
