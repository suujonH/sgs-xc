const { buildMissingGeneralSkillRefReport } = require("./skill-audit-report.cjs");
const { buildSkillRuleMatrix } = require("./skill-rule-matrix.cjs");
const { buildOrderSourceRuleSet } = require("../../runtime/tracker/order-source-rule-core.cjs");

const STRATEGY_QUEUE_SPECS = [
  {
    id: "manual-order-or-source",
    strategy: "order-or-source-sensitive",
    label: "order/source-sensitive validation",
    priority: 10,
    reason: "source, endpoint, or order can change the tracker result",
    sources: ["recording-report", "recording-timeline", "visible/protocol/public source"]
  },
  {
    id: "visible-identity",
    strategy: "visible-identity-tracking",
    label: "visible identity tracking",
    priority: 20,
    reason: "identity is valid only when visible, authorized, public, or protocol-listed",
    sources: ["mask-visible-card-ui", "protocol-authorized-friend-hand", "public runtime field", "protocol card id"]
  },
  {
    id: "deck-endpoint",
    strategy: "deck-endpoint-tracking",
    label: "deck endpoint tracking",
    priority: 30,
    reason: "deck top/bottom order must stay observable and stable",
    sources: ["protocol card id", "visible deck reveal", "endpoint order in recording"]
  },
  {
    id: "protocol-listed",
    strategy: "protocol-listed-identity",
    label: "protocol-listed identity",
    priority: 40,
    reason: "random/search effects cannot create identity unless protocol lists ids",
    sources: ["protocol card id"]
  },
  {
    id: "public-zone",
    strategy: "public-zone-sync",
    label: "public zone sync",
    priority: 50,
    reason: "equipment, judge, discard, and general-card zones are public runtime state",
    sources: ["public-zone-report", "legacy zone projection"]
  },
  {
    id: "generic-movement",
    strategy: "generic-protocol-movement",
    label: "generic protocol movement",
    priority: 60,
    reason: "normal protocol movement plus unknown invalidation is enough",
    sources: ["protocol-flow-report", "legacy-tracker-contract"]
  },
  {
    id: "constraint-only",
    strategy: "constraint-only",
    label: "constraint only",
    priority: 70,
    reason: "skill text narrows candidates but cannot identify a hidden card",
    sources: ["card catalog constraint only"]
  },
  {
    id: "no-card-fact",
    strategy: "no-card-fact",
    label: "no card fact",
    priority: 80,
    reason: "skill text does not create tracker card facts",
    sources: ["ignore skill text for card identity"]
  }
];

const CATEGORY_QUEUE_SPECS = [
  { id: "hand.watch", priority: 10, sources: ["mask-visible-card-ui", "protocol-authorized-friend-hand"] },
  { id: "hand.show", priority: 20, sources: ["visible card ui", "public reveal protocol"] },
  { id: "hand.transfer", priority: 21, sources: ["known hand-source evidence", "protocol card id"] },
  { id: "hand.discard", priority: 22, sources: ["known hand-source evidence", "protocol card id"] },
  { id: "deck.bottom.reveal", priority: 30, sources: ["visible deck bottom reveal"] },
  { id: "deck.bottom.put", priority: 31, sources: ["known source card", "deck bottom endpoint"] },
  { id: "deck.shuffle", priority: 32, sources: ["deck order invalidation"] },
  { id: "draw.bottom", priority: 33, sources: ["deck bottom draw protocol"] },
  { id: "judgement.replace", priority: 40, sources: ["known replacement source", "judgement zone"] },
  { id: "judgement.gain", priority: 41, sources: ["judgement result card id"] },
  { id: "resolved.card.gain", priority: 42, sources: ["known hand-source evidence", "protocol card id"] },
  { id: "random.card.gain", priority: 50, sources: ["protocol card id"] },
  { id: "deck.search", priority: 51, sources: ["protocol card id"] },
  { id: "public.equip", priority: 58, sources: ["public runtime field"] },
  { id: "public.judge", priority: 59, sources: ["public runtime field"] },
  { id: "public.general", priority: 60, sources: ["public runtime field"] },
  { id: "virtual.transform", priority: 70, sources: ["physical source ids", "virtual card marker"] },
  { id: "pindian", priority: 80, sources: ["revealed pindian card ids"] }
];

const EXACT_IDENTITY_CATEGORY_IDS = [
  "hand.watch",
  "hand.show",
  "hand.transfer",
  "hand.discard",
  "deck.bottom.reveal",
  "judgement.replace",
  "judgement.gain",
  "resolved.card.gain",
  "random.card.gain",
  "deck.search",
  "public.equip",
  "public.judge",
  "public.general",
  "virtual.transform",
  "pindian"
];

function buildSkillRuleWorklist(audit = {}, options = {}) {
  const sampleLimit = positiveNumber(options.sampleLimit, 20);
  const skills = array(audit.skills);
  const problems = [];

  if (!audit || typeof audit !== "object" || !skills.length) {
    problems.push({ severity: "error", id: "skill-audit-missing", message: "skill audit has no skills array" });
  }

  const missingStrategy = skills.filter((skill) => !strategyId(skill));
  if (missingStrategy.length) {
    problems.push({
      severity: "error",
      id: "skills-missing-strategy",
      message: "some skills have no strategy id",
      count: missingStrategy.length,
      samples: missingStrategy.slice(0, sampleLimit).map(compactSkill)
    });
  }

  const declaredTotal = Number(audit.counts?.totalSkills || 0);
  if (declaredTotal && declaredTotal !== skills.length) {
    problems.push({
      severity: "warn",
      id: "skill-count-mismatch",
      message: "audit counts.totalSkills does not match skills array length",
      expected: declaredTotal,
      actual: skills.length
    });
  }

  const missingGeneralSkillRefs = array(audit.missingGeneralSkillRefs);
  const missingGeneralSkillRefReport = audit.missingGeneralSkillRefReport || buildMissingGeneralSkillRefReport(missingGeneralSkillRefs);
  if (missingGeneralSkillRefs.length) {
    problems.push({
      severity: "warn",
      id: "missing-general-skill-refs",
      message: "some playable general skill ids are missing from cha_spell",
      count: missingGeneralSkillRefs.length
    });
  }

  const strategyQueues = STRATEGY_QUEUE_SPECS.map((spec) => {
    const rows = skills.filter((skill) => strategyId(skill) === spec.strategy);
    return {
      id: spec.id,
      strategy: spec.strategy,
      label: spec.label,
      priority: spec.priority,
      count: rows.length,
      reason: spec.reason,
      requiredSources: spec.sources,
      sourceTypes: countBy(rows, (skill) => skill.sourceType || "unknown"),
      categories: countBy(rows.flatMap(categoryIds), (id) => id),
      samples: rows.slice(0, sampleLimit).map(compactSkill)
    };
  });

  const categoryQueues = CATEGORY_QUEUE_SPECS.map((spec) => {
    const rows = skills.filter((skill) => categoryIds(skill).includes(spec.id));
    return {
      id: spec.id,
      priority: spec.priority,
      count: rows.length,
      requiredSources: spec.sources,
      strategies: countBy(rows, strategyId),
      sourceTypes: countBy(rows, (skill) => skill.sourceType || "unknown"),
      samples: rows.slice(0, sampleLimit).map(compactSkill)
    };
  }).filter((queue) => queue.count > 0);

  const exactIdentityQueues = categoryQueues.filter((queue) => EXACT_IDENTITY_CATEGORY_IDS.includes(queue.id));
  const ruleMatrix = buildSkillRuleMatrix(audit, { sampleLimit });
  const orderSourceRules = buildOrderSourceRuleSet(skills, { sampleLimit });
  const candidateRuleSummary = buildCandidateRuleSummary(skills);
  if (orderSourceRules.mappingIncompleteCount) {
    problems.push({
      severity: "error",
      id: "order-source-rule-mapping-incomplete",
      message: "some order/source-sensitive skills have categories without operation mapping",
      count: orderSourceRules.mappingIncompleteCount,
      unmappedCategoryCounts: orderSourceRules.unmappedCategoryCounts || {}
    });
  }

  const nextActions = buildNextActions({ skills, strategyQueues, categoryQueues, missingGeneralSkillRefs });
  const counts = {
    totalSkills: skills.length,
    trackerRelevant: Number(audit.counts?.trackerRelevant || skills.filter((skill) => skill.priority === "tracker-relevant").length || 0),
    supporting: Number(audit.counts?.supporting || skills.filter((skill) => skill.priority === "supporting").length || 0),
    none: Number(audit.counts?.none || skills.filter((skill) => skill.priority === "none").length || 0),
    strategyQueues: strategyQueues.length,
    categoryQueues: categoryQueues.length,
    exactIdentityQueues: exactIdentityQueues.length,
    manualOrderOrSource: queueCount(strategyQueues, "manual-order-or-source"),
    orderSourceRules: orderSourceRules.count,
    orderSourceRuleMappingIncomplete: Number(orderSourceRules.mappingIncompleteCount || 0),
    visibleIdentity: queueCount(strategyQueues, "visible-identity"),
    deckEndpoint: queueCount(strategyQueues, "deck-endpoint"),
    protocolListed: queueCount(strategyQueues, "protocol-listed"),
    publicZone: queueCount(strategyQueues, "public-zone"),
    skillTextCandidateRuleSkills: candidateRuleSummary.skillCount,
    skillTextCandidateRules: candidateRuleSummary.ruleCount,
    missingGeneralSkillRefs: missingGeneralSkillRefs.length,
    missingGeneralSkillRefUnresolved: Number(missingGeneralSkillRefReport.counts?.unresolved || 0),
    missingGeneralSkillRefPlaceholderCandidates: Number(missingGeneralSkillRefReport.counts?.placeholderCandidates || 0),
    problems: problems.length
  };

  return {
    ok: problems.every((problem) => problem.severity !== "error"),
    source: audit.source || "",
    generatedAt: audit.generatedAt || "",
    boundary: {
      exactIdentityRequires: [
        "protocol card id",
        "visible UI",
        "authorized visibility",
        "public runtime field"
      ],
      forbiddenSources: ["hidden opponent handCards"],
      hiddenUnknownRule: "keep unknown hidden cards as counts or constraints"
    },
    counts,
    strategyQueues,
    categoryQueues,
    exactIdentityQueues,
    candidateRules: candidateRuleSummary,
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
      categories: array(item.categories)
    })),
    orderSourceRules,
    missingGeneralSkillRefs,
    missingGeneralSkillRefReport,
    ruleMatrix,
    nextActions,
    problems
  };
}

function buildNextActions({ skills, strategyQueues, categoryQueues, missingGeneralSkillRefs }) {
  const actions = [];
  const manual = queueCount(strategyQueues, "manual-order-or-source");
  if (manual) {
    actions.push({
      priority: 1,
      id: "validate-manual-order-source",
      count: manual,
      command: "npm run record -> npm run recording-report -> npm run recording-timeline",
      reason: "order/source-sensitive skills can change deck endpoint or source semantics"
    });
  }
  const handWatch = queueById(categoryQueues, "hand.watch");
  if (handWatch?.count) {
    actions.push({
      priority: 2,
      id: "verify-hand-watch-sources",
      count: handWatch.count,
      command: "npm run source-report",
      reason: "hand-watch skills should become mask or protocol-authorized known-hand sources only when visible or authorized"
    });
  }
  const knownHandMovementCount = countSkillsWithAnyCategory(skills, ["hand.transfer", "hand.discard", "resolved.card.gain"]);
  if (knownHandMovementCount) {
    actions.push({
      priority: 3,
      id: "verify-known-hand-movement-sources",
      count: knownHandMovementCount,
      command: "npm run recording-report",
      reason: "known hand movement and resolved-card gain should preserve exact ids only from known hand sources or protocol-listed card ids"
    });
  }
  const protocolListed = queueCount(strategyQueues, "protocol-listed");
  if (protocolListed) {
    actions.push({
      priority: 4,
      id: "verify-protocol-listed-random-search",
      count: protocolListed,
      command: "npm run protocol-flow-report",
      reason: "random/search gains are exact only when protocols list card ids"
    });
  }
  const publicZone = queueCount(strategyQueues, "public-zone");
  if (publicZone) {
    actions.push({
      priority: 5,
      id: "verify-public-zone-sync",
      count: publicZone,
      command: "npm run public-zone-report",
      reason: "public equipment, judge, and general-card facts should come from public runtime fields"
    });
  }
  if (missingGeneralSkillRefs.length) {
    actions.push({
      priority: 6,
      id: "review-missing-general-skill-refs",
      count: missingGeneralSkillRefs.length,
      command: "npm run audit:skills",
      reason: "some playable general skill slots reference ids missing from cha_spell"
    });
  }
  return actions;
}

function compactSkill(skill) {
  return {
    id: Number(skill.id || 0),
    name: skill.name || "",
    sourceType: skill.sourceType || "",
    ownerCount: Number(skill.ownerCount || array(skill.owners).length || 0),
    owners: array(skill.owners).slice(0, 6).map((owner) => owner?.name || owner?.className || "").filter(Boolean),
    categories: categoryIds(skill),
    actions: array(skill.actions),
    strategy: strategyId(skill),
    confidence: skill.confidence || "",
    priority: skill.priority || "",
    legacySpecialRule: skill.legacySpecialRule || "",
    candidateRuleCount: array(skill.candidateRules).length,
    candidateRuleFields: Array.from(new Set(array(skill.candidateRules)
      .flatMap(candidateRuleConstraints)
      .map((constraint) => constraint?.field)
      .filter(Boolean))),
    reviewReasons: array(skill.reviewReasons),
    desc: skill.desc || ""
  };
}

function buildCandidateRuleSummary(skills) {
  const rows = array(skills).filter((skill) => array(skill.candidateRules).length);
  const rules = rows.flatMap((skill) => array(skill.candidateRules).map((rule) => ({ skill, rule })));
  return {
    skillCount: rows.length,
    ruleCount: rules.length,
    sourceRules: countBy(rules, (item) => item.rule?.sourceRule || "unknown"),
    fields: countBy(rules.flatMap((item) => candidateRuleConstraints(item.rule)), (constraint) => constraint?.field || "unknown"),
    appliesTo: countBy(rules, (item) => item.rule?.appliesTo || "any"),
    samples: rows.slice(0, 20).map((skill) => ({
      id: Number(skill.id || 0),
      name: skill.name || "",
      rules: array(skill.candidateRules).slice(0, 4).map((rule) => ({
        display: rule.display || "",
        sourceRule: rule.sourceRule || "",
        appliesTo: rule.appliesTo || "any",
        constraints: candidateRuleConstraints(rule).map((constraint) => ({
          field: constraint?.field || "",
          op: constraint?.op || "in",
          values: array(constraint?.values)
        }))
      }))
    }))
  };
}

function categoryIds(skill) {
  return array(skill?.categories).map((item) => typeof item === "string" ? item : item?.id).filter(Boolean);
}

function candidateRuleConstraints(rule) {
  return [
    ...array(rule?.constraints),
    ...array(rule?.alternatives).flatMap((alternative) => array(alternative?.constraints))
  ];
}

function strategyId(skill) {
  return typeof skill?.strategy === "string" ? skill.strategy : skill?.strategy?.id || "";
}

function queueCount(queues, id) {
  return Number(queueById(queues, id)?.count || 0);
}

function queueById(queues, id) {
  return array(queues).find((queue) => queue.id === id) || null;
}

function countSkillsWithAnyCategory(skills, categoryIdsToMatch) {
  const wanted = new Set(categoryIdsToMatch);
  return array(skills).filter((skill) => categoryIds(skill).some((id) => wanted.has(id))).length;
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
  buildSkillRuleWorklist,
  STRATEGY_QUEUE_SPECS,
  CATEGORY_QUEUE_SPECS
};
