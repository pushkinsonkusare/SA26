import type { CatalogProduct } from "../../../catalog/catalog";
import type { Intent } from "../../SidecarAssistant/conversation/flow";

/* =============================================================
 * Broad sub-topic recipes
 *
 * For exploratory shopper queries (e.g. "Gear for moto vlogging",
 * "Help me pick gear for my New Zealand trip") the assistant renders a
 * BroadResultCard whose rows correspond to a narrow slice of the
 * catalog. Each slice is described by a {@link BroadSubTopicSpec}
 * combining:
 *   - `categoryToken`  — substring match against `product.category`
 *                       (matches v5 vocab like "4K drones",
 *                       "Camera microphones", "Action camera mounts")
 *   - `capabilities`   — AND-filter on the curated CSV tags
 *   - `accessoryRole`  — exact match on the v5 accessory role
 *   - `titleMatchAny`  — at-least-one substring match on the title,
 *                       used when capability tags can't disambiguate
 *                       (e.g. helmet/handlebar mounts share the same
 *                       generic mounting/sports/rugged tag set)
 *   - `titleExcludeAny`— hard exclusion list (e.g. drop "Combo"/
 *                       "Adventure"/"Fly More" SKUs that are bundles
 *                       even when not flagged `isBundle`)
 *   - `leadCount`      — hard cap on products surfaced for this row
 *
 * Each spec carries a stable `id` so the See Results handoff can put
 * `?recipe=<id>` on the URL and the PLP can re-resolve the SAME filter
 * (incl. title patterns), keeping card and PLP in lockstep.
 * ============================================================= */

export type AccessoryRoleKey =
  | "power"
  | "mounting"
  | "stabilization"
  | "visual_enhancement"
  | "storage"
  | "general"
  | "fpv_component";

export type BroadSubTopicSpec = {
  /** Stable URL-safe id so the PLP can look the spec up. */
  id: string;
  /** Display label for the row (e.g. "Action cameras"). */
  title: string;
  /**
   * Substring matched (case-insensitive) against `product.category`.
   * Aligns with `getProductsForProductListingPage`'s substring
   * semantics so card and PLP filter the same product set.
   */
  categoryToken: string;
  /** Use-case tags AND-applied against `useCaseTags`. */
  capabilities?: string[];
  /** Optional accessory role filter (`mounting`, `power`, …). */
  accessoryRole?: AccessoryRoleKey;
  /** At least one of these substrings (case-insensitive) must hit `title`. */
  titleMatchAny?: string[];
  /** Drop product if `title` contains any of these substrings. */
  titleExcludeAny?: string[];
  /** Hard cap on products surfaced for this row. Defaults to 6. */
  leadCount?: number;
  /**
   * Skip the catalog's `isBundle` guard. Set when the row's title
   * patterns are precise enough that the BUNDLE_TITLE_PATTERN is just
   * getting in the way (e.g. the wireless-mic row needs to show "Mic 2
   * Digital Wireless Microphone *Kit*" — `kit` matches the bundle
   * regex but the SKU is the base product).
   */
  allowBundles?: boolean;
  /**
   * v6: AND-filter on `product.subtypes`. Every requested subtype must
   * be present on the product. Sharper than capability AND — e.g.
   * `["mount_helmet"]` cleanly selects helmet mounts without title
   * regex.
   */
  subtypes?: string[];
  /**
   * v6: OR-filter on `product.primaryActivities`. Any single match
   * counts. e.g. `["motorcycle", "cycling"]` surfaces gear suited to
   * either activity.
   */
  primaryActivities?: string[];
  /**
   * v6.1: OR-filter on `product.series`. Any single match surfaces
   * the product. Lets a row scope to a marketing series (e.g.
   * `["mavic"]` for "Mavic essentials", `["avata", "fpv_goggles",
   * "fpv_controller"]` for an "FPV starter kit").
   */
  series?: string[];
  /**
   * v6.1: model-token compatibility filter. Lowercased substring
   * matched against EITHER `product.compatibleWithModels` (the
   * curated CSV column) OR `product.title` — surfaces accessories
   * targeted at a specific model when `series` is too coarse.
   *
   * Use cases:
   *   • Specific model accessories: `compatibleWith: "mavic 4 pro"`
   *     for an "Accessories for Mavic 4 Pro" row.
   *   • Avata-specific spare batteries: `compatibleWith: "avata"`
   *     when you want every Avata-tagged battery, not just the
   *     `series=avata` ones.
   *
   * Tip: prefer `series` for FAMILY-level scoping ("the Mavic line")
   * and `compatibleWith` for SPECIFIC-MODEL scoping ("Mavic 4 Pro").
   */
  compatibleWith?: string;
};

/* ---------- Recipe data ---------- */

const VLOGGING_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "vlogging-action-cams",
    title: "Action cameras",
    categoryToken: "action camera",
    // v6: subtype + activity replace the title-pattern hack. Action
    // cams flagged for `motorcycle` (the actual moto-vlog use case)
    // surface the rugged Action 4/5 Pro/360 family naturally; the
    // `Adventure`/`Fly More` exclude trims the bundle variants.
    subtypes: ["cam_action"],
    primaryActivities: ["motorcycle"],
    titleExcludeAny: ["Adventure", "Fly More"],
    leadCount: 3,
  },
  {
    id: "vlogging-wireless-mics",
    title: "Wireless microphones",
    categoryToken: "microphone",
    // v6: every wireless mic SKU is tagged `mic_wireless` (incl.
    // transmitters, receivers, adapters, windscreens). `allowBundles`
    // keeps the two "Microphone Kit" SKUs past the bundle filter.
    subtypes: ["mic_wireless"],
    leadCount: 12,
    allowBundles: true,
  },
  {
    id: "vlogging-mobile-gimbals",
    title: "Mobile gimbals",
    categoryToken: "gimbal",
    // VLOGGING_RECIPE is now reached only by selfie/creator-tag
    // queries that don't trip an activity (e.g. "gear for selfies").
    // Phone gimbals are the natural stabilizer for that audience.
    subtypes: ["gimbal_phone"],
    titleExcludeAny: ["Combo"],
    leadCount: 3,
  },
  {
    id: "vlogging-mounts",
    title: "Mounting accessories",
    categoryToken: "mount",
    accessoryRole: "mounting",
    // v6: any moto/cycling-tagged mount surfaces — covers helmet,
    // handlebar, suction cup, chest strap without title regex.
    primaryActivities: ["motorcycle", "cycling"],
    leadCount: 4,
  },
  {
    id: "vlogging-compact-drones",
    title: "Compact drones",
    categoryToken: "4k drones",
    // v6: `drone_compact` cleanly captures Mini 3 / Mini 4K / Mini 5
    // Pro (and Flip / Air 3S / Lito). Skip capability intersection.
    subtypes: ["drone_compact"],
    titleExcludeAny: ["Combo", "Fly More"],
    leadCount: 5,
  },
];

const TRAVEL_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "travel-compact-drones",
    title: "Travel-friendly drones",
    categoryToken: "4k drones",
    subtypes: ["drone_compact"],
    primaryActivities: ["travel"],
    titleExcludeAny: ["Combo", "Fly More"],
    leadCount: 5,
  },
  {
    id: "travel-pocket-action-cams",
    title: "Pocket action cameras",
    categoryToken: "action camera",
    // Pocket OR pocket-sized action cams flagged for travel.
    subtypes: ["cam_pocket"],
    primaryActivities: ["travel"],
    titleExcludeAny: ["Adventure", "Fly More"],
    leadCount: 4,
  },
  {
    id: "travel-lightweight-gimbals",
    title: "Lightweight gimbals",
    categoryToken: "gimbal",
    subtypes: ["gimbal_compact"],
    primaryActivities: ["travel", "vlog"],
    titleExcludeAny: ["Combo"],
    leadCount: 4,
  },
  {
    id: "travel-cases",
    title: "Travel cases & bags",
    categoryToken: "case",
    subtypes: ["acc_case"],
    primaryActivities: ["travel"],
    leadCount: 4,
  },
];

const RUGGED_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "rugged-action-cams",
    title: "Rugged action cameras",
    categoryToken: "action camera",
    subtypes: ["cam_action"],
    primaryActivities: [
      "motorcycle",
      "cycling",
      "skiing_snowboarding",
      "surfing",
    ],
    titleExcludeAny: ["Adventure", "Fly More"],
    leadCount: 4,
  },
  {
    id: "rugged-wind-resistant-drones",
    title: "Wind-resistant drones",
    categoryToken: "4k drones",
    capabilities: ["wind_resistant"],
    titleExcludeAny: ["Combo", "Fly More"],
    leadCount: 4,
  },
  {
    id: "rugged-mounts",
    title: "Mounting accessories",
    categoryToken: "mount",
    accessoryRole: "mounting",
    primaryActivities: [
      "motorcycle",
      "cycling",
      "skiing_snowboarding",
      "surfing",
    ],
    leadCount: 4,
  },
  {
    id: "rugged-protective-cases",
    title: "Protective cases",
    categoryToken: "case",
    subtypes: ["acc_case"],
    leadCount: 4,
  },
];

const BEGINNER_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "beginner-drones",
    title: "Beginner drones",
    categoryToken: "4k drones",
    primaryActivities: ["beginner_creator", "family"],
    titleExcludeAny: ["Combo", "Fly More"],
    leadCount: 5,
  },
  {
    id: "beginner-action-cams",
    title: "Easy-to-use action cameras",
    categoryToken: "action camera",
    subtypes: ["cam_action"],
    primaryActivities: ["vlog", "family"],
    titleExcludeAny: ["Adventure", "Fly More"],
    leadCount: 4,
  },
  {
    id: "beginner-gimbals",
    title: "Starter gimbals",
    categoryToken: "gimbal",
    subtypes: ["gimbal_phone"],
    primaryActivities: ["beginner_creator", "family"],
    titleExcludeAny: ["Combo"],
    leadCount: 4,
  },
  {
    id: "beginner-mics",
    title: "Wireless microphones",
    categoryToken: "microphone",
    subtypes: ["mic_wireless"],
    leadCount: 6,
    allowBundles: true,
  },
];

const DEFAULT_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "default-drones",
    title: "Drones",
    categoryToken: "4k drones",
    titleExcludeAny: ["Combo", "Fly More"],
    leadCount: 6,
  },
  {
    id: "default-action-cams",
    title: "Action cameras",
    categoryToken: "action camera",
    subtypes: ["cam_action"],
    titleExcludeAny: ["Adventure", "Fly More"],
    leadCount: 6,
  },
  {
    id: "default-gimbals",
    title: "Gimbals",
    categoryToken: "gimbal",
    titleExcludeAny: ["Combo"],
    leadCount: 6,
  },
  {
    id: "default-mics",
    title: "Microphones",
    categoryToken: "microphone",
    subtypes: ["mic_wireless"],
    leadCount: 6,
    allowBundles: true,
  },
  {
    id: "default-mounts",
    title: "Mounts & accessories",
    categoryToken: "mount",
    accessoryRole: "mounting",
    leadCount: 6,
  },
];

const ALL_RECIPES: BroadSubTopicSpec[][] = [
  VLOGGING_RECIPE,
  TRAVEL_RECIPE,
  RUGGED_RECIPE,
  BEGINNER_RECIPE,
  DEFAULT_RECIPE,
];

const ALL_SPECS_BY_ID: Map<string, BroadSubTopicSpec> = (() => {
  const map = new Map<string, BroadSubTopicSpec>();
  for (const recipe of ALL_RECIPES) {
    for (const spec of recipe) {
      if (map.has(spec.id) && map.get(spec.id) !== spec) {
        // Multiple recipes can share a spec id (e.g. "rugged-mounts"
        // and "vlogging-mounts" are distinct). The constraint is that
        // every spec has a unique id; we surface a console warning if
        // we ever break that invariant.
        // eslint-disable-next-line no-console
        console.warn(`[broadRecipes] duplicate spec id: ${spec.id}`);
      }
      map.set(spec.id, spec);
    }
  }
  return map;
})();

/* =============================================================
 * Activity-driven fallback recipes
 *
 * The LLM-as-recipe-author tool is the primary path for broad
 * queries. When it doesn't fire (no API key, network error, model
 * timeout), the rule-based fallback used to drop straight to
 * DEFAULT_RECIPE — a neutral 5-category sweep that surfaced drones
 * for podcasting queries, mics for skiing queries, etc. The activity
 * keyword detector below makes the fallback v6-aware so any query
 * that mentions one of our 20 primary_activities still produces a
 * sensible card without the LLM in the loop.
 * ============================================================= */

/**
 * Per-activity row layouts. Each entry describes 3-4 categories that
 * make sense for the activity, expressed as the fields we feed into a
 * `BroadSubTopicSpec` (the `primaryActivities` filter is added on top
 * automatically). Activities not in this map fall through to the
 * existing tier/tag heuristics, then to DEFAULT_RECIPE.
 */
type ActivityRowTemplate = {
  title: string;
  categoryToken: string;
  subtypes?: string[];
  capabilities?: string[];
  accessoryRole?: AccessoryRoleKey;
  allowBundles?: boolean;
  leadCount?: number;
  /**
   * When `true`, the row's filter ANDs `primaryActivities: [activity]`
   * on top of subtype/category. Useful for action cams + mounts where
   * the activity-tagging is rich. Skip for rows where activity tags
   * are uniformly assigned (e.g. mics carry vlog/podcast/interview
   * regardless of broader context — adding `wedding` or `skiing`
   * would empty the row). Default false: subtypes alone narrow.
   */
  useActivityFilter?: boolean;
};

const ACTIVITY_ROW_TEMPLATES: Record<string, ActivityRowTemplate[]> = {
  motorcycle: [
    { title: "Action cameras", categoryToken: "action camera", subtypes: ["cam_action"], useActivityFilter: true, leadCount: 3 },
    { title: "Wireless microphones", categoryToken: "microphone", subtypes: ["mic_wireless"], allowBundles: true, leadCount: 6 },
    { title: "Mounting accessories", categoryToken: "mount", accessoryRole: "mounting", useActivityFilter: true, leadCount: 4 },
    { title: "Compact drones", categoryToken: "4k drones", subtypes: ["drone_compact"], leadCount: 5 },
  ],
  cycling: [
    { title: "Action cameras", categoryToken: "action camera", subtypes: ["cam_action"], useActivityFilter: true, leadCount: 3 },
    { title: "Mounting accessories", categoryToken: "mount", accessoryRole: "mounting", useActivityFilter: true, leadCount: 4 },
    { title: "Compact drones", categoryToken: "4k drones", subtypes: ["drone_compact"], leadCount: 4 },
  ],
  skiing_snowboarding: [
    { title: "Rugged action cameras", categoryToken: "action camera", subtypes: ["cam_action"], useActivityFilter: true, leadCount: 4 },
    { title: "Mounting accessories", categoryToken: "mount", accessoryRole: "mounting", useActivityFilter: true, leadCount: 4 },
    { title: "Travel cases", categoryToken: "case", subtypes: ["acc_case"], leadCount: 4 },
    { title: "Wind-resistant drones", categoryToken: "4k drones", capabilities: ["wind_resistant"], leadCount: 4 },
  ],
  surfing: [
    { title: "Waterproof action cameras", categoryToken: "action camera", subtypes: ["cam_action"], capabilities: ["waterproof"], leadCount: 4 },
    { title: "Wrist & chest mounts", categoryToken: "mount", accessoryRole: "mounting", useActivityFilter: true, leadCount: 4 },
    { title: "Travel cases", categoryToken: "case", subtypes: ["acc_case"], leadCount: 4 },
  ],
  watersports: [
    { title: "Waterproof action cameras", categoryToken: "action camera", subtypes: ["cam_action"], capabilities: ["waterproof"], leadCount: 4 },
    { title: "Mounting accessories", categoryToken: "mount", accessoryRole: "mounting", useActivityFilter: true, leadCount: 4 },
    { title: "Protective cases", categoryToken: "case", subtypes: ["acc_case"], leadCount: 4 },
  ],
  hiking_outdoor: [
    { title: "Compact drones", categoryToken: "4k drones", subtypes: ["drone_compact"], leadCount: 4 },
    { title: "Rugged action cameras", categoryToken: "action camera", subtypes: ["cam_action"], leadCount: 4 },
    { title: "Travel cases", categoryToken: "case", subtypes: ["acc_case"], leadCount: 4 },
    { title: "Wireless microphones", categoryToken: "microphone", subtypes: ["mic_wireless"], allowBundles: true, leadCount: 4 },
  ],
  travel: [
    { title: "Compact drones", categoryToken: "4k drones", subtypes: ["drone_compact"], leadCount: 5 },
    { title: "Pocket cameras", categoryToken: "action camera", subtypes: ["cam_pocket"], leadCount: 3 },
    { title: "Lightweight gimbals", categoryToken: "gimbal", subtypes: ["gimbal_compact"], leadCount: 4 },
    { title: "Travel cases", categoryToken: "case", subtypes: ["acc_case"], leadCount: 4 },
  ],
  vlog: [
    { title: "Vlogging cameras", categoryToken: "action camera", subtypes: ["cam_pocket"], leadCount: 3 },
    { title: "Wireless microphones", categoryToken: "microphone", subtypes: ["mic_wireless"], allowBundles: true, leadCount: 6 },
    { title: "Mobile gimbals", categoryToken: "gimbal", subtypes: ["gimbal_phone"], leadCount: 4 },
    { title: "Mini tripods", categoryToken: "tripod", subtypes: ["mount_tripod"], leadCount: 4 },
  ],
  podcast: [
    { title: "Wireless microphones", categoryToken: "microphone", subtypes: ["mic_wireless"], allowBundles: true, leadCount: 8 },
    { title: "Lavalier mics", categoryToken: "microphone", subtypes: ["mic_lavalier"], leadCount: 4 },
    { title: "Mini tripods", categoryToken: "tripod", subtypes: ["mount_tripod"], leadCount: 4 },
    { title: "Carrying cases", categoryToken: "case", subtypes: ["acc_case"], leadCount: 4 },
  ],
  interview: [
    { title: "Wireless microphones", categoryToken: "microphone", subtypes: ["mic_wireless"], allowBundles: true, leadCount: 8 },
    { title: "Lavalier mics", categoryToken: "microphone", subtypes: ["mic_lavalier"], leadCount: 4 },
    { title: "Vlogging cameras", categoryToken: "action camera", subtypes: ["cam_pocket"], leadCount: 3 },
  ],
  livestream: [
    { title: "Wireless microphones", categoryToken: "microphone", subtypes: ["mic_wireless"], allowBundles: true, leadCount: 6 },
    { title: "Mobile gimbals", categoryToken: "gimbal", subtypes: ["gimbal_phone"], leadCount: 4 },
    { title: "Vlogging cameras", categoryToken: "action camera", subtypes: ["cam_pocket"], leadCount: 3 },
  ],
  wedding: [
    { title: "Cinema drones", categoryToken: "4k drones", subtypes: ["drone_cinema"], leadCount: 3 },
    { title: "Camera gimbals", categoryToken: "gimbal", subtypes: ["gimbal_camera"], leadCount: 4 },
    { title: "Wireless microphones", categoryToken: "microphone", subtypes: ["mic_wireless"], allowBundles: true, leadCount: 6 },
    { title: "ND filters", categoryToken: "lens filter", subtypes: ["acc_filter_nd"], leadCount: 4 },
  ],
  real_estate_aerial: [
    { title: "Cinema drones", categoryToken: "4k drones", subtypes: ["drone_cinema"], leadCount: 3 },
    { title: "Wide-angle lenses", categoryToken: "lens", subtypes: ["acc_lens_wide"], leadCount: 4 },
    { title: "ND filters", categoryToken: "lens filter", subtypes: ["acc_filter_nd"], leadCount: 4 },
    { title: "Travel cases", categoryToken: "case", subtypes: ["acc_case"], leadCount: 4 },
  ],
  news_journalism: [
    { title: "Wireless microphones", categoryToken: "microphone", subtypes: ["mic_wireless"], allowBundles: true, leadCount: 6 },
    { title: "Pocket cameras", categoryToken: "action camera", subtypes: ["cam_pocket"], leadCount: 3 },
    { title: "Mobile gimbals", categoryToken: "gimbal", subtypes: ["gimbal_phone"], leadCount: 4 },
  ],
  concert_event: [
    { title: "Wireless microphones", categoryToken: "microphone", subtypes: ["mic_wireless"], allowBundles: true, leadCount: 6 },
    { title: "Camera gimbals", categoryToken: "gimbal", subtypes: ["gimbal_camera"], leadCount: 4 },
    { title: "Compact drones", categoryToken: "4k drones", subtypes: ["drone_compact"], leadCount: 4 },
  ],
  theatre: [
    { title: "Wireless microphones", categoryToken: "microphone", subtypes: ["mic_wireless"], allowBundles: true, leadCount: 6 },
    { title: "Camera gimbals", categoryToken: "gimbal", subtypes: ["gimbal_camera"], leadCount: 4 },
  ],
  indoor_sports: [
    { title: "Action cameras", categoryToken: "action camera", subtypes: ["cam_action"], leadCount: 3 },
    { title: "FPV drones", categoryToken: "4k drones", subtypes: ["drone_fpv"], leadCount: 3 },
    { title: "Mobile gimbals", categoryToken: "gimbal", subtypes: ["gimbal_phone"], leadCount: 4 },
  ],
  family: [
    { title: "Beginner drones", categoryToken: "4k drones", subtypes: ["drone_compact"], leadCount: 4 },
    { title: "Mobile gimbals", categoryToken: "gimbal", subtypes: ["gimbal_phone"], leadCount: 4 },
    { title: "Pocket cameras", categoryToken: "action camera", subtypes: ["cam_pocket"], leadCount: 3 },
    { title: "Wireless microphones", categoryToken: "microphone", subtypes: ["mic_wireless"], allowBundles: true, leadCount: 4 },
  ],
  beginner_creator: [
    { title: "Beginner drones", categoryToken: "4k drones", subtypes: ["drone_compact"], leadCount: 5 },
    { title: "Easy-to-use action cams", categoryToken: "action camera", subtypes: ["cam_action"], leadCount: 4 },
    { title: "Mobile gimbals", categoryToken: "gimbal", subtypes: ["gimbal_phone"], leadCount: 4 },
    { title: "Wireless microphones", categoryToken: "microphone", subtypes: ["mic_wireless"], allowBundles: true, leadCount: 4 },
  ],
  professional_filmmaker: [
    { title: "Cinema drones", categoryToken: "4k drones", subtypes: ["drone_cinema"], leadCount: 4 },
    { title: "Camera gimbals", categoryToken: "gimbal", subtypes: ["gimbal_camera"], leadCount: 4 },
    { title: "Wireless microphones", categoryToken: "microphone", subtypes: ["mic_wireless"], allowBundles: true, leadCount: 6 },
    { title: "ND filters", categoryToken: "lens filter", subtypes: ["acc_filter_nd"], leadCount: 4 },
  ],
  /* Phone-creator kit — the shopper is shooting on their phone and
   * needs the stabilizer + mounts + filters + mic stack, not a drone.
   * The first row sets the corePool via buildPlan's flagshipRow
   * detection, so Mobile gimbals MUST come first or every tier will
   * fall back to drones again. The remaining rows feed the accessory
   * bundle and the PLP category drawers. */
  phone_photography: [
    { title: "Mobile gimbals", categoryToken: "gimbal", subtypes: ["gimbal_phone"], leadCount: 4 },
    { title: "Phone mounts & clamps", categoryToken: "mount", accessoryRole: "mounting", leadCount: 4 },
    { title: "ND filters & lens kits", categoryToken: "lens filter", subtypes: ["acc_filter_nd"], leadCount: 4 },
    { title: "Wireless microphones", categoryToken: "microphone", subtypes: ["mic_wireless"], allowBundles: true, leadCount: 6 },
    { title: "Grips & extension rods", categoryToken: "grip", leadCount: 4 },
  ],
};

/**
 * Maps shopper-facing keywords to v6 activity tokens. Compiled to
 * regex on first use so the rule-based fallback can scan any query in
 * a single pass. e.g. "podcast at home" → `podcast`; "I'm filming a
 * wedding" → `wedding`; "real estate aerial" → `real_estate_aerial`.
 */
const ACTIVITY_KEYWORD_PATTERNS: Array<{
  activity: string;
  test: RegExp;
}> = [
  { activity: "motorcycle", test: /\b(moto(?:rcycle|rbike)?|bike\s*(?:cam|riding)|riding|rider)\b/i },
  { activity: "cycling", test: /\b(cycl(?:e|ing|ist)|bicycl\w*|mtb|mountain\s*bik\w*|road\s*bik\w*|peloton)\b/i },
  { activity: "skiing_snowboarding", test: /\b(ski(?:ing)?|snowboard\w*|snowsport\w*)\b/i },
  { activity: "surfing", test: /\b(surf\w*|paddleboard\w*)\b/i },
  { activity: "watersports", test: /\b(scuba|diving|snorkel\w*|kayak\w*|jet\s*ski|wakeboard\w*|watersport\w*|underwater|swimming|pool|freediv\w*|whitewater|rafting|sail\w*|yacht\w*|offshore)\b/i },
  { activity: "hiking_outdoor", test: /\b(hik\w*|trek\w*|backpack\w*|camping|outdoor(?:s)?|trail|wilderness|landscape|paraglid\w*|base\s*jump\w*|wingsuit\w*)\b/i },
  /* Phone-creator intent. Must sit ABOVE `travel` / `vlog` so compound
   * queries like "smartphone vlog" or "travel with my phone for video"
   * route to the phone_photography recipe (Osmo Mobile + mounts +
   * filters + mic) instead of the drone-centric vlog/travel recipes.
   *
   * Three alternatives:
   *   1. Bare `iphone` / `smartphone` always count as phone-creator
   *      intent — on a DJI commerce site there's no other reading.
   *   2. `phone` / `mobile` / `android` paired with a creator modifier
   *      (photo / video / vlog / gimbal / mount / filmmak…) — keeps
   *      generic mentions like "mobile rugged drone" out of the
   *      phone bucket.
   *   3. Specific phrases like "phone photography" and "mobile video"
   *      to catch the obvious natural-language framings. */
  {
    activity: "phone_photography",
    test:
      /\b(iphone|smartphone)\b|\b(phone|mobile|android)\s+(photo\w*|video\w*|filmmak\w*|cinematograph\w*|creator|shoot\w*|content|gear|kit|setup|gimbal|mount|stream\w*|vlog\w*|recording)\b|\bphone\s*photography\b|\bmobile\s*(photo\w*|video\w*)\b/i,
  },
  { activity: "travel", test: /\b(travel\w*|trip|vacation|holiday|tour\w*|nomad|backpacking)\b/i },
  { activity: "vlog", test: /\b(vlog\w*|content\s*creator|youtub\w*|tiktok\w*|reels?)\b/i },
  { activity: "podcast", test: /\b(podcast\w*|radio\s*show)\b/i },
  { activity: "interview", test: /\b(interview\w*|reporter)\b/i },
  { activity: "livestream", test: /\b(livestream\w*|live\s*streaming|streaming|twitch)\b/i },
  { activity: "wedding", test: /\b(wedding\w*|bridal|engagement)\b/i },
  { activity: "real_estate_aerial", test: /\b(real\s*estate|property|listing|architecture|aerial)\b/i },
  { activity: "news_journalism", test: /\b(news|journalist|broadcast(?:ing)?|press|documentary|docu\s*film\w*|run\s*and\s*gun)\b/i },
  { activity: "concert_event", test: /\b(concert|gig|festival|live\s*music|event\s*video|live\s*event|multi\s*cam|multicam|stage\s*show)\b/i },
  { activity: "theatre", test: /\b(theatre|theater|stage\s*production|musical\s*theatre)\b/i },
  { activity: "indoor_sports", test: /\b(indoor\s*sports|gym|basketball|volleyball|martial\s*arts|dance|crossfit|hyrox|workout)\b/i },
  { activity: "family", test: /\b(famil\w*|kids?|children|baby|birthday|home\s*video)\b/i },
  { activity: "beginner_creator", test: /\b(beginner|first[- ]time|starter|just\s*starting|getting\s*into|new\s*to)\b/i },
  { activity: "professional_filmmaker", test: /\b(professional\s*film\w*|filmmaker|cinematogr\w*|cinema\s*production|broadcast\s*production)\b/i },
];

/**
 * Scan a query for v6 primary-activity keywords. Returns the first 1-3
 * activities that hit, in priority order (specific activities like
 * `motorcycle` win over broad ones like `travel`).
 */
export function extractActivitiesFromQuery(query: string | undefined): string[] {
  const trimmed = (query ?? "").trim();
  if (!trimmed) return [];
  const out: string[] = [];
  for (const { activity, test } of ACTIVITY_KEYWORD_PATTERNS) {
    if (test.test(trimmed) && !out.includes(activity)) {
      out.push(activity);
      if (out.length >= 3) break;
    }
  }
  return out;
}

let activityRecipeIdCounter = 0;
function nextActivityRecipeId(activity: string): string {
  activityRecipeIdCounter += 1;
  return `activity-${activity}-${activityRecipeIdCounter}`;
}

/**
 * Build a recipe for a detected activity by composing its row
 * templates with `primaryActivities: [activity]` so the deterministic
 * filter narrows each row to the activity-tagged subset. Specs are
 * registered in the runtime registry so the PLP click handler can
 * resolve them via `?recipe=<id>`.
 */
function buildActivityRecipe(activity: string): BroadSubTopicSpec[] {
  const templates = ACTIVITY_ROW_TEMPLATES[activity];
  if (!templates) return [];
  const specs: BroadSubTopicSpec[] = [];
  for (const t of templates) {
    const spec: BroadSubTopicSpec = {
      id: nextActivityRecipeId(activity),
      title: t.title,
      categoryToken: t.categoryToken,
      ...(t.subtypes ? { subtypes: t.subtypes } : {}),
      ...(t.capabilities ? { capabilities: t.capabilities } : {}),
      ...(t.accessoryRole ? { accessoryRole: t.accessoryRole } : {}),
      ...(t.allowBundles ? { allowBundles: t.allowBundles } : {}),
      ...(t.leadCount !== undefined ? { leadCount: t.leadCount } : {}),
      // Apply the activity AND-filter ONLY when the row template
      // explicitly opts in. Most rows narrow on subtype + category
      // alone — applying the activity filter universally would empty
      // mic / case / filter rows whose activity-tagging is uniform.
      ...(t.useActivityFilter ? { primaryActivities: [activity] } : {}),
    };
    specs.push(spec);
    RUNTIME_SPECS.set(spec.id, spec);
  }
  return specs;
}

/**
 * Pick the most-specific recipe that matches the inferred intent.
 *
 * Selection priority (first match wins):
 *  1. v6 ACTIVITY KEYWORD detected in the raw query (motorcycle, travel,
 *     podcast, wedding, skiing, surfing, real estate, vlog, …) —
 *     generates a tailored recipe on the fly using
 *     `ACTIVITY_ROW_TEMPLATES`. Activities are checked FIRST so a
 *     compound query like "gear for travel vlogging" routes to the
 *     `travel` template (which already includes a Lightweight gimbals
 *     row) rather than being short-circuited to the moto-flavoured
 *     `VLOGGING_RECIPE` by the `vlog\w*` tag.
 *  2. `vlogging` tag (covers selfie/creator-tag queries that don't
 *     trip an activity, e.g. "gear for selfies", "kit for creators").
 *  3. `rugged` tag (extreme/outdoor/adventure queries with no specific
 *     activity).
 *  4. `compact` / `travel` tag.
 *  5. `tier === "beginner"`.
 *  6. fallback to the neutral 5-category roster.
 */
export function pickRecipeForIntent(
  intent: Intent | undefined,
  query?: string,
): BroadSubTopicSpec[] {
  const tags = new Set(intent?.requiredTags ?? []);

  const detectedActivities = extractActivitiesFromQuery(query);
  if (detectedActivities.length > 0) {
    // Prefer the first specific activity match. If the templates for
    // that activity yield no rows after catalog filtering, the caller
    // (`buildBroadSubTopics` / `resolveRecipe`) will retry with the
    // default recipe — same fallback we already do for empty matches.
    for (const activity of detectedActivities) {
      const recipe = buildActivityRecipe(activity);
      if (recipe.length > 0) return recipe;
    }
  }

  if (tags.has("vlogging")) return VLOGGING_RECIPE;
  if (tags.has("rugged")) return RUGGED_RECIPE;
  if (tags.has("compact") || tags.has("travel")) return TRAVEL_RECIPE;
  if (intent?.tier === "beginner") return BEGINNER_RECIPE;
  return DEFAULT_RECIPE;
}

/** Default recipe exposed for callers that want a guaranteed fallback. */
export function getDefaultRecipe(): BroadSubTopicSpec[] {
  return DEFAULT_RECIPE;
}

/**
 * Runtime registry — receives LLM-emitted specs from the
 * `propose_broad_recipe` tool. In-memory only (lost on page refresh,
 * which is fine — refresh URLs degrade gracefully via the existing
 * `?recipe=` fallback path).
 *
 * Runtime entries are checked BEFORE static specs in `getRecipeSpecById`,
 * so a freshly-emitted spec wins over any stale id collision.
 */
const RUNTIME_SPECS: Map<string, BroadSubTopicSpec> = new Map();

/**
 * Register an LLM-emitted spec so the PLP can resolve it on row click
 * via `?recipe=<spec.id>`. Returns the id (caller is expected to have
 * already minted a unique one — typically `llm-{ts}-{idx}`).
 */
export function registerRuntimeSpec(spec: BroadSubTopicSpec): string {
  RUNTIME_SPECS.set(spec.id, spec);
  return spec.id;
}

/** Look up a spec by its id (e.g. for the PLP recipe-aware filter). */
export function getRecipeSpecById(id: string | null | undefined): BroadSubTopicSpec | null {
  if (!id) return null;
  return RUNTIME_SPECS.get(id) ?? ALL_SPECS_BY_ID.get(id) ?? null;
}

function lower(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

/**
 * Resolve a single {@link BroadSubTopicSpec} against the loaded catalog.
 * Returns the filtered, de-duped, leadCount-capped product list. The
 * caller decides how many to slice for slugs and which one to use as
 * the lead thumb.
 *
 * Returns an empty array when no products match. Callers should drop
 * empty rows so the card never renders an empty bucket.
 */
export function buildRowProductsFromSpec(
  spec: BroadSubTopicSpec,
  products: CatalogProduct[],
): CatalogProduct[] {
  const categoryToken = lower(spec.categoryToken);
  const includeNeedles = (spec.titleMatchAny ?? []).map(lower).filter(Boolean);
  const excludeNeedles = (spec.titleExcludeAny ?? []).map(lower).filter(Boolean);

  // A row is "accessory-class" when it explicitly points at one — via
  // accessory_role, an `acc_*` / `mic_*` / `mount_*` subtype, OR an
  // accessory-flavoured category token. For accessory-class rows we
  // must NOT filter out `isAccessory` products (otherwise mic kits,
  // helmet mounts, ND filters, etc. would all silently disappear).
  // For flagship rows (categoryToken = "drone" / "action camera" /
  // "gimbal" / "camcorder") we keep the filter so e.g. drone batteries
  // don't leak into a "Drones" row.
  const ACCESSORY_CATEGORY_TOKENS = [
    "mount", "case", "bag", "backpack", "filter", "microphone",
    "strap", "battery", "charger", "lens", "tripod", "monopod",
    "remote", "adaptor", "adapter", "grip", "stick",
  ];
  const accessorySubtypePrefixes = ["acc_", "mic_", "mount_"];
  const isAccessoryRow =
    Boolean(spec.accessoryRole) ||
    (spec.subtypes ?? []).some((s) =>
      accessorySubtypePrefixes.some((prefix) => s.startsWith(prefix)),
    ) ||
    (categoryToken !== "" &&
      ACCESSORY_CATEGORY_TOKENS.some((t) => categoryToken.includes(t)));

  const seenSlugs = new Set<string>();
  const out: CatalogProduct[] = [];

  for (const p of products) {
    if (p.isBundle && !spec.allowBundles) continue;
    if (categoryToken && !lower(p.category).includes(categoryToken)) continue;

    if (spec.accessoryRole) {
      if (p.accessoryRole !== spec.accessoryRole) continue;
    } else if (p.isAccessory && !isAccessoryRow) {
      // Hide accessories from flagship rows — otherwise drone batteries
      // would surface inside the "Drones" row, etc.
      continue;
    }

    if (spec.capabilities && spec.capabilities.length > 0) {
      // Filter against the RAW CSV capability tokens (e.g. `portable`,
      // `lightweight`, `wind_resistant`) rather than the canonical
      // `useCaseTags` — the canonical set collapses some tokens (e.g.
      // `portable` + `lightweight` both fold to `compact`) which makes
      // AND-intersection lossy.
      const tokens = p.capabilities;
      if (!spec.capabilities.every((tag) => tokens.includes(tag))) continue;
    }

    if (spec.subtypes && spec.subtypes.length > 0) {
      // AND on subtypes — every requested subtype must be on the
      // product. e.g. `["mount_helmet"]` matches helmet mounts;
      // `["mic_wireless", "mic_kit"]` matches the wireless mic kits.
      const tokens = p.subtypes;
      if (!spec.subtypes.every((tag) => tokens.includes(tag))) continue;
    }

    if (spec.primaryActivities && spec.primaryActivities.length > 0) {
      // OR on primary activities — any single match surfaces the
      // product. e.g. `["motorcycle", "cycling"]` keeps mounts and
      // cams flagged for either.
      const tokens = p.primaryActivities;
      if (!spec.primaryActivities.some((tag) => tokens.includes(tag))) continue;
    }

    if (spec.series && spec.series.length > 0) {
      // OR on product series — any single match surfaces the product.
      // Products with `series === null` are dropped from series-scoped
      // rows (a row that asks for `["mavic"]` shouldn't include a
      // generic third-party case that we couldn't bucket).
      if (!p.series || !spec.series.includes(p.series)) continue;
    }

    if (spec.compatibleWith) {
      // Model-token compat: match against the curated v5
      // `compatibleWithModels` array OR the product title. We OR with
      // the title because many series-tagged accessories list their
      // host explicitly in the title (e.g. "DJI Avata 2 Intelligent
      // Flight Battery") even when `compatibleWithModels` is sparse.
      const token = lower(spec.compatibleWith);
      const titleHit = lower(p.title).includes(token);
      const modelHit = p.compatibleWithModels.some((m) =>
        lower(m).includes(token),
      );
      if (!titleHit && !modelHit) continue;
    }

    const titleLower = lower(p.title);
    if (excludeNeedles.length > 0 && excludeNeedles.some((n) => titleLower.includes(n))) {
      continue;
    }
    if (includeNeedles.length > 0 && !includeNeedles.some((n) => titleLower.includes(n))) {
      continue;
    }

    if (seenSlugs.has(p.slug)) continue;
    seenSlugs.add(p.slug);
    out.push(p);
  }

  const cap = Math.max(1, spec.leadCount ?? 6);
  return out.slice(0, cap);
}
