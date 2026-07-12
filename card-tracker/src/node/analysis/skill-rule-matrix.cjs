const { CATEGORY_RULE_DEFINITIONS } = require("../../runtime/tracker/skill-rule-core.cjs");
const { CATEGORY_PLANS } = require("../../runtime/tracker/rule-planner-core.cjs");
const { buildOrderSourceRuleSet } = require("../../runtime/tracker/order-source-rule-core.cjs");

const DEFAULT_EXACT_SOURCES = ["protocol card id", "visible UI", "authorized visibility", "public runtime field"];

const CATEGORY_MATRIX = {
  "hand.watch": {
    acceptedSources: ["mask-visible-card-ui", "protocol-authorized-friend-hand"],
    oldTrackerPath: "generic Zone movement plus visible/authorized hand source",
    runtimeState: ["knownHandLedger"],
    execution: "record authorized temporary hand snapshot",
    unknownHandling: "do not read hidden handCards; keep unobserved cards unknown"
  },
  "hand.show": {
    acceptedSources: ["visible card UI", "public reveal protocol card id"],
    oldTrackerPath: "generic Zone.show/remove with visible reveal",
    runtimeState: ["knownHandLedger", "protocolZoneLedger"],
    execution: "record public reveal only when the card identity is visible or listed",
    unknownHandling: "shown count without ids stays a count"
  },
  "resolved.card.gain": {
    acceptedSources: ["protocol card id", "known source card"],
    oldTrackerPath: "generic Zone.remove/add",
    runtimeState: ["knownHandLedger", "protocolZoneLedger"],
    execution: "follow the already resolved known card through the gain move",
    unknownHandling: "without a resolved id, keep the gain as unknown count"
  },
  "random.card.gain": {
    acceptedSources: ["protocol card id"],
    oldTrackerPath: "generic Zone.remove/add; old special filters can narrow candidates",
    runtimeState: ["protocolZoneLedger"],
    execution: "record random gain only when the protocol lists exact ids",
    unknownHandling: "skill text and card filters narrow candidates only"
  },
  "hand.transfer": {
    acceptedSources: ["protocol card id", "mask-visible-card-ui", "protocol-authorized-friend-hand"],
    oldTrackerPath: "generic Zone.remove/add",
    runtimeState: ["knownHandLedger", "protocolZoneLedger"],
    execution: "move known hand facts or invalidate the affected hidden hand count",
    unknownHandling: "unknown hand loss clears stale known facts for that seat"
  },
  "hand.discard": {
    acceptedSources: ["protocol card id", "mask-visible-card-ui", "protocol-authorized-friend-hand"],
    oldTrackerPath: "generic Zone.remove/add",
    runtimeState: ["knownHandLedger", "protocolZoneLedger"],
    execution: "discard exact hand cards only when the source id is known",
    unknownHandling: "unknown discard invalidates stale known hand facts"
  },
  "deck.top.reveal": {
    acceptedSources: ["protocol-listed-deck-endpoint", "visible deck top order"],
    oldTrackerPath: "Zone.remove from pile with endpoint position",
    runtimeState: ["protocolZoneLedger.deckEndpoint.top"],
    execution: "record ordered deck top only while the order is observable",
    unknownHandling: "unknown deck movement clears endpoint order"
  },
  "deck.bottom.reveal": {
    acceptedSources: ["protocol-listed-deck-endpoint", "visible deck bottom order"],
    oldTrackerPath: "Zone.remove from pile with bottom endpoint semantics",
    runtimeState: ["protocolZoneLedger.deckEndpoint.bottom"],
    execution: "record ordered deck bottom only while the order is observable",
    unknownHandling: "unknown deck movement clears endpoint order"
  },
  "deck.top.put": {
    acceptedSources: ["known source card", "protocol-listed-deck-endpoint"],
    oldTrackerPath: "Zone.add to pile top after Zone constructor position inversion",
    runtimeState: ["protocolZoneLedger.deckEndpoint.top"],
    execution: "write known ordered cards to deck top",
    unknownHandling: "unknown source or order clears endpoint order"
  },
  "deck.bottom.put": {
    acceptedSources: ["known source card", "protocol-listed-deck-endpoint"],
    oldTrackerPath: "Zone.add to pile bottom after Zone constructor position inversion",
    runtimeState: ["protocolZoneLedger.deckEndpoint.bottom"],
    execution: "write known ordered cards to deck bottom",
    unknownHandling: "unknown source or order clears endpoint order"
  },
  "deck.random.put": {
    acceptedSources: ["none for exact order"],
    oldTrackerPath: "generic Zone.add to pile without stable endpoint",
    runtimeState: ["protocolZoneLedger.deckEndpoint"],
    execution: "invalidate exact deck order",
    unknownHandling: "clear top and bottom endpoint caches"
  },
  "deck.search": {
    acceptedSources: ["protocol card id"],
    oldTrackerPath: "generic Zone.remove from pile; old filters narrow candidates",
    runtimeState: ["protocolZoneLedger"],
    execution: "remove exact deck members only when the protocol lists ids",
    unknownHandling: "card text gives candidates, not identity"
  },
  "deck.shuffle": {
    acceptedSources: ["shuffle protocol or skill category"],
    oldTrackerPath: "zone 9 is normalized to pile",
    runtimeState: ["protocolZoneLedger.deckEndpoint"],
    execution: "clear exact deck order",
    unknownHandling: "preserve known public/hand facts but drop endpoint order"
  },
  "draw.bottom": {
    acceptedSources: ["protocol card id", "deck bottom endpoint"],
    oldTrackerPath: "skill-specific source override before generic draw",
    runtimeState: ["protocolZoneLedger.deckEndpoint.bottom"],
    execution: "consume deck bottom instead of deck top for the affected draw",
    unknownHandling: "unknown bottom draw clears bottom endpoint order"
  },
  "draw.count": {
    acceptedSources: ["protocol card id when listed", "known deck top endpoint"],
    oldTrackerPath: "generic pile to hand Zone.remove/add",
    runtimeState: ["protocolZoneLedger.deckEndpoint.top"],
    execution: "consume known deck top in protocol order, otherwise move unknown count",
    unknownHandling: "listed ids that contradict known top clear endpoint order"
  },
  "judgement.replace": {
    acceptedSources: ["protocol card id", "known replacement source"],
    oldTrackerPath: "generic Zone movement plus judgement source context",
    runtimeState: ["protocolZoneLedger", "publicZones"],
    execution: "replace the judgement card from an observable source",
    unknownHandling: "unknown replacement source cannot create identity"
  },
  "judgement.gain": {
    acceptedSources: ["protocol card id", "public judgement result"],
    oldTrackerPath: "generic Zone movement from judge/process/discard",
    runtimeState: ["protocolZoneLedger", "publicZones"],
    execution: "move the resolved judgement card to the gaining player",
    unknownHandling: "unknown judgement result stays unknown"
  },
  "judgement.any": {
    acceptedSources: ["known deck top endpoint", "protocol card id"],
    oldTrackerPath: "generic pile to judgement/process movement",
    runtimeState: ["protocolZoneLedger.deckEndpoint.top"],
    execution: "consume deck top for judgement",
    unknownHandling: "unknown judgement clears or leaves endpoint state according to move evidence"
  },
  "public.equip": {
    acceptedSources: ["public-equip-runtime", "protocol card id"],
    oldTrackerPath: "generic Zone.add/remove for equip zone",
    runtimeState: ["publicZones", "protocolZoneLedger"],
    execution: "sync public equipment zone",
    unknownHandling: "missing runtime field means no exact public-zone fact"
  },
  "public.judge": {
    acceptedSources: ["public-judge-runtime", "protocol card id"],
    oldTrackerPath: "generic Zone.add/remove for judge zone",
    runtimeState: ["publicZones", "protocolZoneLedger"],
    execution: "sync public judge zone",
    unknownHandling: "missing runtime field means no exact public-zone fact"
  },
  "public.general": {
    acceptedSources: ["public-general-runtime", "protocol card id"],
    oldTrackerPath: "generic Zone movement for cards on or beside generals",
    runtimeState: ["publicZones", "protocolZoneLedger"],
    execution: "sync public general-card piles",
    unknownHandling: "unknown hidden attachments are not identity facts"
  },
  "discard.zone": {
    acceptedSources: ["protocol card id", "public discard state"],
    oldTrackerPath: "generic Zone.add/remove for discard zone",
    runtimeState: ["protocolZoneLedger", "legacyCardTracker.zoneProjection"],
    execution: "maintain exact public discard subset",
    unknownHandling: "discard counts without ids do not identify cards"
  },
  "outside.remove": {
    acceptedSources: ["protocol card id"],
    oldTrackerPath: "generic Zone.add/remove for removed zone",
    runtimeState: ["protocolZoneLedger"],
    execution: "move exact cards to removed zone",
    unknownHandling: "unknown removed cards remain unknown count"
  },
  "virtual.transform": {
    acceptedSources: ["protocol card id", "known physical source"],
    oldTrackerPath: "generic Zone movement plus virtual card context",
    runtimeState: ["protocolZoneLedger", "knownHandLedger"],
    execution: "split virtual card name from physical source cards",
    unknownHandling: "virtual name alone does not reveal physical hidden cards"
  },
  "pindian": {
    acceptedSources: ["revealed pindian card ids", "visible card UI"],
    oldTrackerPath: "generic Zone movement plus public reveal",
    runtimeState: ["protocolZoneLedger", "knownHandLedger"],
    execution: "track both revealed pindian cards as public facts",
    unknownHandling: "unlisted pindian result stays unknown until visible"
  },
  "recast": {
    acceptedSources: ["protocol card id", "known source card"],
    oldTrackerPath: "generic discard then draw Zone moves",
    runtimeState: ["protocolZoneLedger", "knownHandLedger"],
    execution: "discard the recast card, then apply normal draw source semantics",
    unknownHandling: "unknown recast source invalidates stale hand facts"
  },
  "constraint.property": {
    acceptedSources: ["card catalog only"],
    oldTrackerPath: "classifier filters for candidate narrowing",
    runtimeState: ["classifier"],
    execution: "use color, suit, number, or type only as constraints",
    unknownHandling: "never create exact identity from a constraint"
  }
};

const LEGACY_ZONE_CONTRACT = [
  {
    id: "zone-movement",
    oldPath: "card:move -> Zone.remove(ids, skillId, count) -> Zone.add(cards)",
    currentPath: "legacyCardTracker plus protocolZoneLedger plus knownHandLedger",
    rule: "protocol movement is the primary state transition; skill text only adjusts source/order semantics"
  },
  {
    id: "old-special-reverse",
    oldPath: "Zone.remove pile fixed-position reverse for 0xc88, 0x1b63, 0x3db, 0x3dc",
    currentPath: "legacySpecial hints plus category actions",
    rule: "keep as compatibility hint and map to current config names"
  },
  {
    id: "old-special-filter",
    oldPath: "Zone.remove pile/discard candidate filters for 0x2b60, 0xda0, 0x35e",
    currentPath: "legacySpecial hints plus classifier constraints",
    rule: "filters narrow candidates only; exact identity still requires a listed or visible id"
  },
  {
    id: "deck-endpoint",
    oldPath: "Zone constructor DING/DI inversion for pile endpoints",
    currentPath: "protocolZoneLedger.deckEndpoint",
    rule: "track top/bottom only while positive ids and stable endpoint order are known"
  },
  {
    id: "hidden-hand-boundary",
    oldPath: "old tracker infers from visible/protocol moves, not hidden opponent hand reads",
    currentPath: "knownHandLedger accepted source rules",
    rule: "hidden opponent handCards are forbidden as known-card evidence"
  }
];

function buildSkillRuleMatrix(audit = {}, options = {}) {
  const sampleLimit = positiveNumber(options.sampleLimit, 8);
  const skills = array(audit.skills);
  const orderSourceRules = buildOrderSourceRuleSet(skills, { sampleLimit });
  const categoryRows = CATEGORY_RULE_DEFINITIONS.map((rule) => {
    const rows = skills.filter((skill) => categoryIds(skill).includes(rule.id));
    const matrix = CATEGORY_MATRIX[rule.id] || {};
    return {
      id: rule.id,
      label: rule.label,
      count: rows.length,
      tier: rule.tier,
      coreAction: rule.action,
      plannerActions: array(CATEGORY_PLANS[rule.id]),
      acceptedSources: matrix.acceptedSources || DEFAULT_EXACT_SOURCES,
      oldTrackerPath: matrix.oldTrackerPath || "generic Zone movement",
      runtimeState: matrix.runtimeState || [],
      execution: matrix.execution || rule.action,
      unknownHandling: matrix.unknownHandling || "keep unknown hidden cards as counts or constraints",
      strategies: countBy(rows, strategyId),
      sourceTypes: countBy(rows, (skill) => skill.sourceType || "unknown"),
      samples: rows.slice(0, sampleLimit).map(compactSkill)
    };
  });

  const strategyRows = strategyIds(skills).map((id) => {
    const rows = skills.filter((skill) => strategyId(skill) === id);
    return {
      id,
      count: rows.length,
      categories: countBy(rows.flatMap(categoryIds), (categoryId) => categoryId),
      sourceTypes: countBy(rows, (skill) => skill.sourceType || "unknown"),
      samples: rows.slice(0, sampleLimit).map(compactSkill)
    };
  });

  const bottomOrShuffleSkills = skills
    .filter((skill) => categoryIds(skill).some((id) => [
      "deck.bottom.reveal",
      "deck.bottom.put",
      "draw.bottom",
      "deck.shuffle",
      "deck.random.put"
    ].includes(id)))
    .map(compactSkill);

  return {
    version: 1,
    source: audit.source || "",
    generatedAt: audit.generatedAt || "",
    boundary: {
      exactIdentityRequires: DEFAULT_EXACT_SOURCES,
      forbiddenSources: ["hidden opponent handCards"],
      skillTextRule: "classify event semantics only; never invent card identity"
    },
    counts: {
      totalSkills: skills.length,
      categories: categoryRows.length,
      categoriesWithSkills: categoryRows.filter((row) => row.count > 0).length,
      orderSourceSensitive: orderSourceRules.count,
      orderSourceRuleOperations: Object.values(orderSourceRules.orderCounts || {}).reduce((sum, count) => sum + Number(count || 0), 0),
      bottomOrShuffle: bottomOrShuffleSkills.length,
      legacySpecial: array(audit.legacySpecial).length
    },
    legacyZoneContract: LEGACY_ZONE_CONTRACT,
    categoryMatrix: categoryRows,
    strategyMatrix: strategyRows,
    orderSourceSensitiveSkills: orderSourceRules.rules,
    orderSourceRules,
    bottomOrShuffleSkills,
    legacySpecial: array(audit.legacySpecial).map((item) => ({
      spellId: Number(item.spellId || 0),
      oldHex: item.oldHex || "",
      name: item.name || "",
      currentRule: item.currentRule || "",
      operate: item.operate || "",
      order: item.order || "",
      sourceZones: array(item.sourceZones).map(Number).filter(Number.isFinite),
      zoneRemove: item.zoneRemove || null,
      strategy: item.strategy || "",
      categories: array(item.categories),
      execution: legacyExecution(item.currentRule)
    }))
  };
}

function legacyExecution(rule) {
  if (rule === "deck-top-reveal-secret-exchange") return "reverse old pile extraction, then track visible/protocol endpoint ids";
  if (rule === "deck-top-select-return") return "reverse old pile extraction, gain selected id, return known remainder to deck top";
  if (rule === "watch-hand-top-five-exchange") return "authorized hand watch plus deck top exchange";
  if (rule === "alias-watch-hand-top-five-exchange") return "delegate to the watch-hand-top-five-exchange rule";
  if (rule === "random-hand-reveal-slash-exchange") return "visible random hand reveal plus Slash candidate filter";
  if (rule === "number-six-filter") return "number-6 candidate filter only unless protocol lists exact ids";
  if (rule === "not-present-in-current-skill-catalog") return "compatibility branch only; no current config skill fact";
  return "";
}

function compactSkill(skill) {
  return {
    id: Number(skill.id || 0),
    name: skill.name || "",
    sourceType: skill.sourceType || "",
    owners: array(skill.owners).slice(0, 6).map((owner) => owner?.name || owner?.className || "").filter(Boolean),
    categories: categoryIds(skill),
    strategy: strategyId(skill),
    confidence: skill.confidence || "",
    legacySpecialRule: skill.legacySpecialRule || ""
  };
}

function strategyIds(skills) {
  return Array.from(new Set(array(skills).map(strategyId).filter(Boolean))).sort();
}

function categoryIds(skill) {
  return array(skill?.categories).map((item) => typeof item === "string" ? item : item?.id).filter(Boolean);
}

function strategyId(skill) {
  return typeof skill?.strategy === "string" ? skill.strategy : skill?.strategy?.id || "";
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

function array(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  buildSkillRuleMatrix,
  CATEGORY_MATRIX,
  LEGACY_ZONE_CONTRACT
};
