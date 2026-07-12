const ORDER_SOURCE_CATEGORY_RULES = [
  {
    categoryId: "hand.watch",
    operate: "hand-source",
    order: "authorized-snapshot",
    plannerAction: "record-authorized-hand-snapshot",
    evidenceCheck: "handWatch",
    requiredSources: ["mask-visible-card-ui", "protocol-authorized-friend-hand"],
    exactIdentity: "visible-or-authorized-only",
    runtimeState: ["knownHandLedger"]
  },
  {
    categoryId: "hand.show",
    operate: "visible-source",
    order: "public-reveal",
    plannerAction: "record-public-reveal",
    evidenceCheck: "handShow",
    requiredSources: ["visible card UI", "public reveal protocol card id"],
    exactIdentity: "visible-or-protocol-card-id-only",
    runtimeState: ["knownHandLedger", "protocolZoneLedger"]
  },
  {
    categoryId: "hand.transfer",
    operate: "hand-source",
    order: "move-exact-or-invalidate",
    plannerAction: "move-known-hand-card-or-invalidate-count",
    evidenceCheck: "knownHandMovement",
    requiredSources: ["known hand-source evidence", "protocol card id"],
    exactIdentity: "known-source-or-protocol-card-id-only",
    runtimeState: ["knownHandLedger", "protocolZoneLedger"]
  },
  {
    categoryId: "hand.discard",
    operate: "hand-source",
    order: "discard-exact-or-invalidate",
    plannerAction: "discard-known-hand-card-or-invalidate-count",
    evidenceCheck: "knownHandMovement",
    requiredSources: ["known hand-source evidence", "protocol card id"],
    exactIdentity: "known-source-or-protocol-card-id-only",
    runtimeState: ["knownHandLedger", "protocolZoneLedger"]
  },
  {
    categoryId: "resolved.card.gain",
    operate: "resolved-source",
    order: "follow-known-card",
    plannerAction: "follow-resolved-known-card",
    evidenceCheck: "knownHandMovement",
    requiredSources: ["known source card", "protocol card id"],
    exactIdentity: "known-source-or-protocol-card-id-only",
    runtimeState: ["knownHandLedger", "protocolZoneLedger"]
  },
  {
    categoryId: "deck.top.reveal",
    operate: "deck-endpoint",
    order: "top-reveal-order",
    plannerAction: "record-deck-top-order-if-observable",
    evidenceCheck: "deckEndpoint",
    requiredSources: ["protocol-listed-deck-endpoint", "visible deck top order"],
    exactIdentity: "visible-or-protocol-card-id-only",
    runtimeState: ["protocolZoneLedger.deckEndpoint.top"]
  },
  {
    categoryId: "deck.bottom.reveal",
    operate: "deck-endpoint",
    order: "bottom-reveal-order",
    plannerAction: "record-deck-bottom-order-if-observable",
    evidenceCheck: "deckEndpoint",
    requiredSources: ["protocol-listed-deck-endpoint", "visible deck bottom order"],
    exactIdentity: "visible-or-protocol-card-id-only",
    runtimeState: ["protocolZoneLedger.deckEndpoint.bottom"]
  },
  {
    categoryId: "deck.top.put",
    operate: "deck-endpoint",
    order: "top-put-source-order",
    plannerAction: "put-known-source-on-deck-top",
    evidenceCheck: "deckEndpoint",
    requiredSources: ["known source card", "protocol-listed-deck-endpoint"],
    exactIdentity: "known-source-or-protocol-card-id-only",
    runtimeState: ["protocolZoneLedger.deckEndpoint.top"]
  },
  {
    categoryId: "deck.bottom.put",
    operate: "deck-endpoint",
    order: "bottom-put-source-order",
    plannerAction: "put-known-source-on-deck-bottom",
    evidenceCheck: "deckEndpoint",
    requiredSources: ["known source card", "protocol-listed-deck-endpoint"],
    exactIdentity: "known-source-or-protocol-card-id-only",
    runtimeState: ["protocolZoneLedger.deckEndpoint.bottom"]
  },
  {
    categoryId: "deck.random.put",
    operate: "deck-endpoint",
    order: "clear-random-insert",
    plannerAction: "invalidate-deck-order-for-random-insert",
    evidenceCheck: "deckOrderInvalidation",
    requiredSources: ["deck order invalidation"],
    exactIdentity: "none",
    runtimeState: ["protocolZoneLedger.deckEndpoint"]
  },
  {
    categoryId: "deck.search",
    operate: "protocol-listed-source",
    order: "deck-selected-id",
    plannerAction: "remove-deck-card-only-if-protocol-lists-id",
    evidenceCheck: "protocolListedRandomSearch",
    requiredSources: ["protocol card id"],
    exactIdentity: "protocol-card-id-only",
    runtimeState: ["protocolZoneLedger"]
  },
  {
    categoryId: "deck.shuffle",
    operate: "deck-endpoint",
    order: "clear-known-order",
    plannerAction: "clear-known-deck-order",
    evidenceCheck: "deckOrderInvalidation",
    requiredSources: ["deck order invalidation"],
    exactIdentity: "none",
    runtimeState: ["protocolZoneLedger.deckEndpoint"]
  },
  {
    categoryId: "draw.count",
    operate: "deck-endpoint",
    order: "consume-active-end-or-unknown",
    plannerAction: "consume-active-deck-end-or-unknown-count",
    evidenceCheck: "deckEndpoint",
    requiredSources: ["protocol card id when listed", "known deck endpoint"],
    exactIdentity: "known-endpoint-or-protocol-card-id-only",
    runtimeState: ["protocolZoneLedger.deckEndpoint"]
  },
  {
    categoryId: "draw.bottom",
    operate: "deck-endpoint",
    order: "consume-bottom-for-draw",
    plannerAction: "consume-deck-bottom-for-draw",
    evidenceCheck: "deckEndpoint",
    requiredSources: ["protocol card id when listed", "known deck bottom endpoint"],
    exactIdentity: "known-bottom-endpoint-or-protocol-card-id-only",
    runtimeState: ["protocolZoneLedger.deckEndpoint.bottom"]
  },
  {
    categoryId: "judgement.any",
    operate: "deck-endpoint",
    order: "consume-top-for-judgement",
    plannerAction: "consume-deck-top-for-judgement",
    evidenceCheck: "deckEndpoint",
    requiredSources: ["known deck top endpoint", "protocol card id"],
    exactIdentity: "known-endpoint-or-protocol-card-id-only",
    runtimeState: ["protocolZoneLedger.deckEndpoint.top"]
  },
  {
    categoryId: "public.equip",
    operate: "public-zone",
    order: "sync-equip-zone",
    plannerAction: "sync-public-equip-zone",
    evidenceCheck: "publicEquip",
    requiredSources: ["public-equip-runtime", "protocol card id"],
    exactIdentity: "public-runtime-field-or-protocol-card-id",
    runtimeState: ["publicZones"]
  },
  {
    categoryId: "public.judge",
    operate: "public-zone",
    order: "sync-judge-zone",
    plannerAction: "sync-public-judge-zone",
    evidenceCheck: "publicJudge",
    requiredSources: ["public-judge-runtime", "protocol card id"],
    exactIdentity: "public-runtime-field-or-protocol-card-id",
    runtimeState: ["publicZones"]
  },
  {
    categoryId: "public.general",
    operate: "public-zone",
    order: "sync-general-zone",
    plannerAction: "sync-public-general-card-zone",
    evidenceCheck: "publicGeneral",
    requiredSources: ["public-general-runtime", "protocol card id"],
    exactIdentity: "public-runtime-field-or-protocol-card-id",
    runtimeState: ["publicZones"]
  },
  {
    categoryId: "discard.zone",
    operate: "public-zone",
    order: "sync-discard-subset",
    plannerAction: "maintain-public-discard-subset",
    evidenceCheck: "publicDiscard",
    requiredSources: ["protocol card id", "public discard state"],
    exactIdentity: "public-or-protocol-card-id-only",
    runtimeState: ["gameModel", "protocolZoneLedger"]
  },
  {
    categoryId: "virtual.transform",
    operate: "virtual-source",
    order: "split-physical-source",
    plannerAction: "split-virtual-card-from-physical-sources",
    evidenceCheck: "protocolListedJudgementVirtualPindian",
    requiredSources: ["physical source ids", "virtual card marker"],
    exactIdentity: "known-physical-source-or-protocol-card-id-only",
    runtimeState: ["protocolZoneLedger", "knownHandLedger"]
  },
  {
    categoryId: "recast",
    operate: "card-flow",
    order: "discard-then-draw",
    plannerAction: "discard-then-draw",
    evidenceCheck: "knownHandMovement",
    requiredSources: ["known source card", "protocol card id"],
    exactIdentity: "known-source-or-protocol-card-id-only",
    runtimeState: ["protocolZoneLedger", "knownHandLedger"]
  },
  {
    categoryId: "constraint.property",
    operate: "candidate-filter",
    order: "card-catalog-constraint-only",
    plannerAction: "use-card-catalog-as-constraint-only",
    evidenceCheck: "candidateConstraint",
    requiredSources: ["card catalog only"],
    exactIdentity: "none",
    runtimeState: ["classifier"]
  }
];

const ORDER_SOURCE_PRIMARY_CATEGORY_IDS = [
  "deck.bottom.reveal",
  "deck.bottom.put",
  "deck.random.put",
  "deck.shuffle",
  "deck.top.reveal",
  "deck.top.put",
  "draw.bottom",
  "draw.count",
  "hand.watch",
  "hand.show",
  "hand.transfer",
  "hand.discard",
  "public.general"
];

const ORDER_SOURCE_TRIGGER_CATEGORY_IDS = [
  "deck.bottom.reveal",
  "deck.bottom.put",
  "deck.random.put",
  "deck.shuffle",
  "draw.bottom"
];

const ORDER_SOURCE_CATEGORY_RULE_BY_ID = Object.fromEntries(
  ORDER_SOURCE_CATEGORY_RULES.map((rule) => [rule.categoryId, rule])
);

function orderSourceCategoryRule(categoryId) {
  const rule = ORDER_SOURCE_CATEGORY_RULE_BY_ID[String(categoryId || "")];
  return rule ? cloneRule(rule) : null;
}

function isOrderSourceSensitiveSkill(skill) {
  if (!skill) return false;
  if (strategyId(skill) === "order-or-source-sensitive") return true;
  if (skill.confidence === "manual-order-or-source-required") return true;
  return categoryIds(skill).some((id) => ORDER_SOURCE_TRIGGER_CATEGORY_IDS.includes(id));
}

function buildOrderSourceSkillRule(skill) {
  if (!isOrderSourceSensitiveSkill(skill)) return null;
  const categories = categoryIds(skill);
  const operations = categories
    .map(orderSourceCategoryRule)
    .filter(Boolean)
    .map((rule) => ({
      categoryId: rule.categoryId,
      operate: rule.operate,
      order: rule.order,
      plannerAction: rule.plannerAction,
      evidenceCheck: rule.evidenceCheck,
      requiredSources: rule.requiredSources.slice(),
      exactIdentity: rule.exactIdentity,
      runtimeState: rule.runtimeState.slice()
    }));
  const primary = primaryOperation(operations);
  const mappedCategoryIds = new Set(operations.map((item) => item.categoryId));
  const unmappedCategories = categories.filter((categoryId) => !mappedCategoryIds.has(categoryId));
  return {
    id: Number(skill?.id || skill?.spellId || 0),
    spellId: Number(skill?.id || skill?.spellId || 0),
    name: skill?.name || "",
    sourceType: skill?.sourceType || "",
    owners: ownerNames(skill?.owners),
    ownerCount: Number(skill?.ownerCount || array(skill?.owners).length || 0),
    categories,
    actions: array(skill?.actions),
    strategy: strategyId(skill),
    confidence: skill?.confidence || "",
    priority: skill?.priority || "",
    operate: summarizeDistinct(operations.map((item) => item.operate)),
    order: summarizeDistinct(operations.map((item) => item.order)),
    primaryOperate: primary?.operate || "",
    primaryOrder: primary?.order || "",
    requiredSources: unique(operations.flatMap((item) => item.requiredSources)),
    evidenceChecks: unique(operations.map((item) => item.evidenceCheck)),
    exactIdentity: summarizeDistinct(operations.map((item) => item.exactIdentity)),
    runtimeState: unique(operations.flatMap((item) => item.runtimeState)),
    operations,
    mappingComplete: operations.length > 0 && unmappedCategories.length === 0,
    unmappedCategories,
    reviewReasons: array(skill?.reviewReasons),
    desc: skill?.desc || ""
  };
}

function buildOrderSourceRuleSet(skills, options = {}) {
  const sampleLimit = positiveNumber(options.sampleLimit, 20);
  const rules = array(skills)
    .map(buildOrderSourceSkillRule)
    .filter(Boolean)
    .sort((a, b) => a.spellId - b.spellId || a.name.localeCompare(b.name));
  const mappingIncomplete = rules.filter((rule) => rule.mappingComplete !== true);
  return {
    version: 1,
    count: rules.length,
    operateCounts: countBy(rules.flatMap((rule) => rule.operations.map((item) => item.operate)), (value) => value),
    orderCounts: countBy(rules.flatMap((rule) => rule.operations.map((item) => item.order)), (value) => value),
    evidenceCheckCounts: countBy(rules.flatMap((rule) => rule.evidenceChecks), (value) => value),
    requiredSources: unique(rules.flatMap((rule) => rule.requiredSources)),
    mappingIncompleteCount: mappingIncomplete.length,
    unmappedCategoryCounts: countBy(mappingIncomplete.flatMap((rule) => rule.unmappedCategories), (value) => value),
    categoryRules: ORDER_SOURCE_CATEGORY_RULES.map(cloneRule),
    rules,
    samples: rules.slice(0, sampleLimit)
  };
}

function primaryOperation(operations) {
  for (const categoryId of ORDER_SOURCE_PRIMARY_CATEGORY_IDS) {
    const found = operations.find((item) => item.categoryId === categoryId);
    if (found) return found;
  }
  return operations[0] || null;
}

function summarizeDistinct(values) {
  const distinct = unique(values);
  if (distinct.length === 0) return "";
  if (distinct.length === 1) return distinct[0];
  return "compound";
}

function categoryIds(skill) {
  return array(skill?.categories).map((item) => typeof item === "string" ? item : item?.id).filter(Boolean);
}

function strategyId(skill) {
  const strategy = skill?.strategy;
  return typeof strategy === "string" ? strategy : strategy?.id || "";
}

function ownerNames(owners) {
  return array(owners).map((owner) => owner?.name || owner?.className || "").filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(array(values).filter((value) => value !== "" && value != null)));
}

function countBy(rows, getKey) {
  const result = {};
  for (const row of rows || []) {
    const key = getKey(row);
    const keys = Array.isArray(key) ? key : [key];
    for (const item of keys) {
      if (!item) continue;
      result[item] = (result[item] || 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function cloneRule(rule) {
  return {
    ...rule,
    requiredSources: array(rule.requiredSources).slice(),
    runtimeState: array(rule.runtimeState).slice()
  };
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  ORDER_SOURCE_CATEGORY_RULES,
  ORDER_SOURCE_CATEGORY_RULE_BY_ID,
  ORDER_SOURCE_PRIMARY_CATEGORY_IDS,
  ORDER_SOURCE_TRIGGER_CATEGORY_IDS,
  orderSourceCategoryRule,
  isOrderSourceSensitiveSkill,
  buildOrderSourceSkillRule,
  buildOrderSourceRuleSet,
  categoryIds,
  strategyId
};
