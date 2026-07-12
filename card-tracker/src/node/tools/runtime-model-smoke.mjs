import { evaluateOnSgs } from "../cdp/client.mjs";

const result = await evaluateOnSgs(`(() => {
  const root = window.__SgsScripts;
  const model = root?.tracker?.gameModel;
  const expectedMethods = [
    "snapshot",
    "remainingDeck",
    "observePhysicalCardDefinition",
  "physicalCardDefinition",
  "physicalCardGeneration",
  "observePhysicalCardLifecycle",
    "destroyPhysicalCard",
    "physicalCardLifecycle",
    "physicalCardLifecycles",
    "recast",
    "nextCardProbability",
    "searchProbability",
    "segmentedSearch",
    "orderedMatchSearch",
    "takeFromDeckAtRank",
    "aggregateSubsetFeasibility",
    "observeDeckRanks",
    "insertAtRank",
    "partitionDeckWindow",
    "revealUntilResult",
    "observeHandConstraint",
    "handTransitions",
    "handKnowledgeChanges",
    "exchangeZones",
    "zoneExchanges",
    "cardResidence",
    "cardLocationAt",
    "cardsContinuouslyInZone",
    "cardEvents",
    "movements",
    "observeMovementAttempt",
    "resolveMovementAttempt",
    "movementAttempts",
    "observeJudgementOutcome",
    "invertJudgementOutcome",
    "judgementOutcome",
    "judgementOutcomes",
    "observeBooleanConstraint",
    "booleanConstraint",
    "booleanConstraints",
    "observeCausalEvent",
    "causalEvent",
    "queryCausalEvents",
    "causalLineage",
    "observeCardAction",
    "cardAction",
    "queryCardActions",
    "cardActionMaterials",
    "moveCardActionMaterials",
    "observeComparison",
    "comparison",
    "queryComparisons",
    "swapComparisonAssignments",
    "queryCurrentDiscard",
    "queryCardSources",
    "resolveCardSourceResult",
    "observeNamedCardZone",
    "rehostNamedCardZone",
    "visibleZone",
    "namedCardZones",
    "observePhysicalPile",
    "takeFromPhysicalPile",
    "putIntoPhysicalPile",
    "shufflePhysicalPile",
    "physicalPile",
    "physicalPileHistory",
    "physicalPileNextProbability",
    "observeGeneralCardEntity",
    "replaceGeneralCardEntity",
    "generalCardEntity",
    "generalCardEntities",
    "observeZoneCapability",
    "zoneCapability",
    "zoneCapabilities",
    "observeEquipmentProjection",
    "equipmentProjection",
    "equipmentProjections",
    "removeEquipmentProjection",
    "observeEntityPile",
    "moveEntityPile",
    "entityPile",
    "observeLocationGroup",
    "locationGroup",
    "activeLocationGroups",
    "invalidateLocationGroup",
    "updateRuleState",
    "ruleState",
    "registerRuleModifier",
    "activeRuleModifiers",
    "removeRuleModifier",
    "scheduleEffect",
    "scheduledEffects",
    "dueScheduledEffects",
    "resolveScheduledEffect",
    "observeChoiceSet",
    "choiceSets",
    "resolveChoiceSet",
    "choiceSetHistory",
    "observeStochasticEvent",
    "stochasticEvents",
    "resolveStochasticEvent",
    "stochasticEventHistory",
    "stochasticProbability",
    "observeSkillBinding",
    "activeSkillBindings",
    "removeSkillBinding",
    "observeEffectiveCardAttributes",
    "effectiveCard",
    "observeApparentCardAttributes",
    "apparentCard",
    "cardAttributeViews",
    "clearApparentCardAttributes",
    "tagCard",
    "applyOperation"
  ];
  const suspiciousPattern = /(?:sgs-scripts|card-tracker|known-card|legacy-zone)/i;
  const suspiciousDom = Array.from(document.querySelectorAll("[id], [class]"))
    .map((node) => ({ tag: node.tagName, id: node.id || "", className: String(node.className || "") }))
    .filter((row) => suspiciousPattern.test(row.id) || suspiciousPattern.test(row.className))
    .slice(0, 20);
  const suspiciousLaya = [];
  const queue = window.Laya?.stage ? [window.Laya.stage] : [];
  let visited = 0;
  while (queue.length && visited < 5000) {
    const node = queue.shift();
    visited++;
    const name = String(node?.name || "");
    if (suspiciousPattern.test(name)) suspiciousLaya.push({ name, className: node?.constructor?.name || "" });
    for (const child of Array.from(node?._children || [])) queue.push(child);
  }
  const coverage = root?.tracker?.skillResearchCoverage?.() || null;
  const skill816 = root?.tracker?.skillKnowledgeFor?.(816) || null;
  const cardDict = root?.sources?.configState?.cardDict || {};
  return {
    version: root?.version || "",
    modelPresent: !!model,
    methods: Object.fromEntries(expectedMethods.map((name) => [name, typeof model?.[name] === "function"])),
    semanticCoverage: coverage?.coverage?.semantic || null,
    embeddedReviewedSkills: coverage?.embeddedReviewedSkills ?? null,
    skill816: skill816 ? {
      id: skill816.id,
      name: skill816.name,
      reviewStatus: skill816.reviewStatus,
      executableRuleStatus: skill816.executableRuleStatus,
      reviewBatch: skill816.reviewBatch
    } : null,
    catalogTraits: {
      damageCard72: cardDict[72]?.isDamageCard === true && cardDict[72]?.isOrdinaryTrick === true,
      delayedTrick32: cardDict[32]?.isDelayedTrick === true,
      equipSubtype67: cardDict[67]?.equipSubtype === 2
    },
    uiNamespacePresent: !!root?.ui,
    suspiciousDom,
    suspiciousLaya,
    layaNodesVisited: visited
  };
})()`);

const value = result.value || {};
const missingMethods = Object.entries(value.methods || {}).filter(([, present]) => present !== true).map(([name]) => name);
const ok =
  value.version === "0.5.0" &&
  value.modelPresent === true &&
  value.embeddedReviewedSkills === Number(value.semanticCoverage?.reviewed || 0) &&
  value.skill816?.reviewStatus === "researched" &&
  Object.values(value.catalogTraits || {}).every((present) => present === true) &&
  value.uiNamespacePresent === false &&
  Array.isArray(value.suspiciousDom) && value.suspiciousDom.length === 0 &&
  Array.isArray(value.suspiciousLaya) && value.suspiciousLaya.length === 0 &&
  missingMethods.length === 0;

console.log(JSON.stringify({ ok, target: result.target, missingMethods, value }, null, 2));
if (!ok) process.exitCode = 1;
