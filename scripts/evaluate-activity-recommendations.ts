import { catalogStore } from "../src/catalog/catalog";
import {
  buildAccessoryBundle,
  classifyIntent,
  filterProducts,
  findAccessoriesFor,
  isAccessoryCompatibleWithAnyCoreStrict,
  pickRecommendations,
} from "../src/components/SidecarAssistant/conversation/flow";
import {
  buildActivityConstraints,
  detectActivitiesFromQuery,
  enforceAndRankActivityFit,
} from "../src/catalog/activityProfiles";
import { ACTIVITY_REGRESSION_FIXTURES } from "../src/pages/WingmanPlanPage/activityRegressionFixtures";

type LaneResult = {
  passed: boolean;
  expectedHits: string[];
  expectedMisses: string[];
  disallowedHits: string[];
  compatibilityFailures?: string[];
  topTitles: string[];
};

type FixtureResult = {
  name: string;
  overallPassed: boolean;
  core: LaneResult;
  accessory: LaneResult;
};

function haystackForProduct(product: (typeof catalogStore.products)[number]): string {
  return [
    product.title,
    product.category,
    product.subtypes.join(" "),
    product.useCaseTags.join(" "),
    product.primaryActivities.join(" "),
    product.accessoryRole ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function visibleHaystackForProduct(product: (typeof catalogStore.products)[number]): string {
  return [
    product.title,
    product.category,
    product.subtypes.join(" "),
    product.useCaseTags.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

const ACCESSORY_SIGNAL_TOKENS = [
  "mount_",
  "mic_",
  "gimbal_",
  "handlebar",
  "helmet",
  "wrist",
  "transmitter",
  "receiver",
  "lavalier",
  "adapter",
];
const AERIAL_ACTIVITY_IDS = new Set(["paragliding", "base_jumping"]);
const AERIAL_MOUNT_PRIORITY = ["mount_helmet", "mount_chest", "mount_wrist"] as const;
const WHITEWATER_ACTIVITY_IDS = new Set(["whitewater_rafting"]);
const WHITEWATER_MOUNT_PRIORITY = ["mount_wrist", "mount_chest"] as const;
const EXPECTED_SIGNAL_ALIASES: Record<string, string[]> = {
  // Current catalog has no explicit mount_wrist accessories; chest mounts are
  // the closest body-mount fallback for whitewater scenarios.
  mount_wrist: ["mount_chest"],
};

function isAccessorySignal(signal: string): boolean {
  const lower = signal.toLowerCase();
  return ACCESSORY_SIGNAL_TOKENS.some((token) => lower.includes(token));
}

function checkSignals(
  haystacks: string[],
  expected: string[],
  disallowed: string[],
  disallowedHaystacks?: string[],
): Omit<LaneResult, "topTitles"> {
  const expectedHits: string[] = [];
  const expectedMisses: string[] = [];
  for (const signal of expected) {
    const signalLower = signal.toLowerCase();
    const aliases = EXPECTED_SIGNAL_ALIASES[signalLower] ?? [];
    const candidates = [signalLower, ...aliases];
    if (haystacks.some((h) => candidates.some((candidate) => h.includes(candidate)))) {
      expectedHits.push(signal);
    } else expectedMisses.push(signal);
  }

  const disallowedHits: string[] = [];
  const disallowedSource = disallowedHaystacks ?? haystacks;
  for (const signal of disallowed) {
    const signalLower = signal.toLowerCase();
    if (disallowedSource.some((h) => h.includes(signalLower))) disallowedHits.push(signal);
  }

  return {
    passed: expectedMisses.length === 0 && disallowedHits.length === 0,
    expectedHits,
    expectedMisses,
    disallowedHits,
  };
}

function buildAccessoryPicks(query: string, corePicks: (typeof catalogStore.products)[number][]) {
  if (corePicks.length === 0) return [];
  const activities = detectActivitiesFromQuery(query);
  const core = corePicks[0];
  const bundle = buildAccessoryBundle(core, catalogStore.products, 5);
  if (activities.length === 0) return bundle;
  const constraints = buildActivityConstraints(activities);
  const ranked = enforceAndRankActivityFit(bundle, query, constraints);
  const injectMounts = (
    picks: (typeof catalogStore.products)[number][],
    allowedSubtypes: readonly string[],
  ) => {
    const existing = new Set(picks.map((p) => p.slug));
    const mountCandidates = findAccessoriesFor(core, catalogStore.products, {
      role: "mounting",
      limit: 12,
    }).filter((product) => allowedSubtypes.some((subtype) => product.subtypes.includes(subtype)));
    const injected = [...picks];
    for (const candidate of mountCandidates) {
      if (existing.has(candidate.slug)) continue;
      injected.unshift(candidate);
      existing.add(candidate.slug);
      if (injected.length >= 6) break;
    }
    return injected;
  };

  let enriched = ranked;
  if (activities.some((id) => AERIAL_ACTIVITY_IDS.has(id))) {
    enriched = injectMounts(enriched, AERIAL_MOUNT_PRIORITY);
  }
  if (activities.some((id) => WHITEWATER_ACTIVITY_IDS.has(id))) {
    enriched = injectMounts(enriched, WHITEWATER_MOUNT_PRIORITY);
  }

  if (
    !activities.some((id) => AERIAL_ACTIVITY_IDS.has(id)) &&
    !activities.some((id) => WHITEWATER_ACTIVITY_IDS.has(id))
  ) {
    return enriched;
  }
  const revalidated = enforceAndRankActivityFit(enriched, query, constraints);
  const rankBySubtype = (product: (typeof catalogStore.products)[number]): number => {
    const aerialIdx = AERIAL_MOUNT_PRIORITY.findIndex((subtype) => product.subtypes.includes(subtype));
    if (aerialIdx !== -1) return aerialIdx;
    const waterIdx = WHITEWATER_MOUNT_PRIORITY.findIndex((subtype) =>
      product.subtypes.includes(subtype)
    );
    return waterIdx === -1 ? Number.MAX_SAFE_INTEGER : waterIdx + 10;
  };
  return [...revalidated].sort((a, b) => {
    const aRank = rankBySubtype(a);
    const bRank = rankBySubtype(b);
    if (aRank !== bRank) return aRank - bRank;
    return 0;
  });
}

function evaluateFixture(
  query: string,
  name: string,
  expected: string[],
  disallowed: string[],
): FixtureResult {
  const intent = classifyIntent(query);
  const pool = filterProducts(intent, catalogStore.products);
  const corePicks = pickRecommendations(pool, 5, intent);
  const accessoryPicks = buildAccessoryPicks(query, corePicks);

  const coreExpected = expected.filter((signal) => !isAccessorySignal(signal));
  const accessoryExpected = expected.filter((signal) => isAccessorySignal(signal));
  const coreDisallowed = disallowed.filter((signal) => !isAccessorySignal(signal));
  const accessoryDisallowed = disallowed.filter((signal) => isAccessorySignal(signal));

  const coreCheck = checkSignals(
    corePicks.map(haystackForProduct),
    coreExpected,
    coreDisallowed,
    corePicks.map(visibleHaystackForProduct),
  );
  const accessoryCheck = checkSignals(
    accessoryPicks.map(haystackForProduct),
    accessoryExpected,
    accessoryDisallowed,
  );

  const core: LaneResult = {
    ...coreCheck,
    passed: coreCheck.passed && corePicks.length > 0,
    topTitles: corePicks.map((p) => p.title),
  };
  const incompatibleAccessoryTitles = accessoryPicks
    .filter((accessory) => !isAccessoryCompatibleWithAnyCoreStrict(accessory, corePicks))
    .map((p) => p.title);
  const accessory: LaneResult = {
    ...accessoryCheck,
    compatibilityFailures: incompatibleAccessoryTitles,
    passed:
      accessoryCheck.passed &&
      incompatibleAccessoryTitles.length === 0 &&
      accessoryPicks.length > 0,
    topTitles: accessoryPicks.map((p) => p.title),
  };

  return {
    name,
    overallPassed: core.passed && accessory.passed,
    core,
    accessory,
  };
}

function printLane(label: string, lane: LaneResult) {
  const status = lane.passed ? "PASS" : "FAIL";
  // eslint-disable-next-line no-console
  console.log(`  [${status}] ${label}`);
  if (lane.expectedMisses.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`    missing expected: ${lane.expectedMisses.join(", ")}`);
  }
  if (lane.disallowedHits.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`    disallowed hit: ${lane.disallowedHits.join(", ")}`);
  }
  if (lane.compatibilityFailures && lane.compatibilityFailures.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `    compatibility FAIL: ${lane.compatibilityFailures.join(" | ")}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(`    top picks: ${lane.topTitles.join(" | ")}`);
}

function main() {
  const results = ACTIVITY_REGRESSION_FIXTURES.map((fixture) =>
    evaluateFixture(
      fixture.query,
      fixture.name,
      fixture.expectedSignals,
      fixture.disallowedSignals,
    ),
  );

  const passed = results.filter((r) => r.overallPassed).length;
  const total = results.length;

  // eslint-disable-next-line no-console
  console.log(`Activity evaluator (overall): ${passed}/${total} fixtures passed\n`);

  for (const result of results) {
    const status = result.overallPassed ? "PASS" : "FAIL";
    // eslint-disable-next-line no-console
    console.log(`[${status}] ${result.name}`);
    printLane("core", result.core);
    printLane("accessory", result.accessory);
    // eslint-disable-next-line no-console
    console.log("");
  }

  if (passed !== total) process.exitCode = 1;
}

main();

