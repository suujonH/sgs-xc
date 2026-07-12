const CATEGORY_PLANS = {
  "hand.watch": ["record-authorized-hand-snapshot"],
  "hand.show": ["record-public-reveal"],
  "resolved.card.gain": ["follow-resolved-known-card"],
  "random.card.gain": ["record-random-gain-only-if-protocol-lists-id"],
  "hand.transfer": ["move-known-hand-card-or-invalidate-count"],
  "hand.discard": ["discard-known-hand-card-or-invalidate-count"],
  "deck.top.reveal": ["record-deck-top-order-if-observable"],
  "deck.bottom.reveal": ["record-deck-bottom-order-if-observable"],
  "deck.top.put": ["put-known-source-on-deck-top"],
  "deck.bottom.put": ["put-known-source-on-deck-bottom"],
  "deck.random.put": ["invalidate-deck-order-for-random-insert"],
  "deck.search": ["remove-deck-card-only-if-protocol-lists-id"],
  "deck.shuffle": ["clear-known-deck-order"],
  "draw.bottom": ["consume-deck-bottom-for-draw"],
  "draw.count": ["consume-active-deck-end-or-unknown-count"],
  "judgement.any": ["consume-deck-top-for-judgement"],
  "judgement.replace": ["replace-judgement-from-known-source"],
  "judgement.gain": ["gain-resolved-judgement-card"],
  "public.equip": ["sync-public-equip-zone"],
  "public.judge": ["sync-public-judge-zone"],
  "public.general": ["sync-public-general-card-zone"],
  "discard.zone": ["maintain-public-discard-subset"],
  "outside.remove": ["move-exact-card-to-removed-zone"],
  "virtual.transform": ["split-virtual-card-from-physical-sources"],
  "pindian": ["track-revealed-pindian-cards"],
  "recast": ["discard-then-draw"],
  "constraint.property": ["use-card-catalog-as-constraint-only"]
};

function makeRulePlanner(options = {}) {
  const maxPlans = positiveNumber(options.maxPlans, 120);
  const state = {
    version: 1,
    handledCount: 0,
    plannedCount: 0,
    lastError: "",
    categoryCounts: {},
    actionCounts: {},
    aliasCounts: {},
    plans: []
  };

  function handleProtocolRecord(record) {
    state.handledCount++;
    try {
      const plan = buildRulePlan(record, options);
      if (!plan) return null;
      state.plannedCount++;
      countAll(state.categoryCounts, plan.categories);
      countAll(state.actionCounts, plan.actions);
      if (plan.aliasOf) state.aliasCounts[`${plan.skillId}->${plan.aliasOf}`] = (state.aliasCounts[`${plan.skillId}->${plan.aliasOf}`] || 0) + 1;
      state.plans.push(compactPlan(plan));
      if (state.plans.length > maxPlans) state.plans.splice(0, state.plans.length - maxPlans);
      return plan;
    } catch (error) {
      state.lastError = String(error?.stack || error);
      return null;
    }
  }

  function summary() {
    return {
      version: state.version,
      handledCount: state.handledCount,
      plannedCount: state.plannedCount,
      lastError: state.lastError,
      categoryCounts: { ...state.categoryCounts },
      actionCounts: { ...state.actionCounts },
      aliasCounts: { ...state.aliasCounts },
      recentPlans: state.plans.slice(-20)
    };
  }

  return {
    state,
    handleProtocolRecord,
    summary
  };
}

function buildRulePlan(record, options = {}) {
  const parsed = record?.parsed;
  if (!parsed) return null;
  const skillId = normalizedSkillId(parsed);
  const resolved = resolveRule(parsed.skillRule, skillId, options.skillRuleInfo);
  const categories = unique(categoryIds(resolved.rule));
  const categoryActions = unique(categories.flatMap((category) => CATEGORY_PLANS[category] || [`unmapped:${category}`]));
  const zoneActions = zoneActionsFor(parsed);
  const noCardFact = skillId && !categories.length && !zoneActions.length;
  const orderSourceSensitive = resolved.rule?.confidence === "manual-order-or-source-required";
  const actions = unique([
    ...categoryActions,
    ...zoneActions.map((item) => item.action),
    ...(noCardFact ? ["ignore-no-card-fact"] : [])
  ]);

  if (!skillId && !actions.length) return null;

  return {
    recordIndex: record.index,
    time: record.time,
    protocol: record.name || parsed.protocol || "",
    eventType: parsed.type || "",
    skillId,
    effectiveSkillId: resolved.effectiveSkillId || skillId,
    aliasOf: resolved.aliasOf || 0,
    skillName: resolved.rule?.name || "",
    sourceType: resolved.rule?.sourceType || "",
    confidence: resolved.rule?.confidence || "",
    priority: resolved.rule?.priority || "",
    categories,
    actions,
    zoneActions,
    knownCardIds: knownCardIds(parsed),
    cardCount: eventCardCount(parsed),
    orderSourceSensitive,
    manualReview: orderSourceSensitive,
    ruleQueue: orderSourceSensitive ? "manual-order-or-source" : ""
  };
}

function resolveRule(rule, skillId, skillRuleInfo) {
  if (hasCategories(rule) || !skillId) {
    return { rule: rule || null, effectiveSkillId: skillId, aliasOf: 0 };
  }
  return { rule: rule || null, effectiveSkillId: skillId, aliasOf: 0 };
}

function hasCategories(rule) {
  return categoryIds(rule).length > 0;
}

function categoryIds(rule) {
  return Array.from(rule?.categories || []).map((item) => typeof item === "string" ? item : item?.id).filter(Boolean);
}

function normalizedSkillId(parsed) {
  const direct = Number(parsed?.skillId || parsed?.skillRule?.id || 0);
  if (direct) return direct;
  const cardSkill = Number(parsed?.card?.spellId || 0);
  return cardSkill || 0;
}

function zoneActionsFor(parsed) {
  if (parsed.type !== "card:move") return [];
  const fromCode = Number(parsed.from?.code);
  const toCode = Number(parsed.to?.code);
  const ids = knownCardIds(parsed);
  const count = eventCardCount(parsed);
  const actions = [];
  if (fromCode === 5) {
    actions.push({
      action: ids.length ? "remove-known-from-hand-ledger" : "invalidate-hand-ledger-seat",
      seat: parsed.from?.seat,
      known: ids.length,
      count
    });
  }
  if (toCode === 5) {
    actions.push({
      action: ids.length ? "add-known-to-hand-ledger" : "add-unknown-hand-count",
      seat: parsed.to?.seat,
      known: ids.length,
      count
    });
  }
  if (toCode === 6 || fromCode === 6) actions.push({ action: "sync-public-equip-zone", seat: parsed.to?.seat ?? parsed.from?.seat, known: ids.length, count });
  if (toCode === 7 || fromCode === 7) actions.push({ action: "sync-public-judge-zone", seat: parsed.to?.seat ?? parsed.from?.seat, known: ids.length, count });
  if (toCode === 2 || fromCode === 2) actions.push({ action: "maintain-public-discard-subset", known: ids.length, count });
  if (toCode === 12 || fromCode === 12) actions.push({ action: "move-exact-card-to-removed-zone", known: ids.length, count });
  if (fromCode === 1 || toCode === 1 || fromCode === 9 || toCode === 9) {
    actions.push({ action: ids.length ? "update-known-deck-membership" : "update-unknown-deck-count", known: ids.length, count });
  }
  return dedupeObjects(actions);
}

function knownCardIds(parsed) {
  const ids = [];
  for (const card of parsed.cards || []) {
    const id = Number(card?.id || 0);
    if (id > 0) ids.push(id);
  }
  const cardId = Number(parsed.card?.id || 0);
  if (cardId > 0) ids.push(cardId);
  return unique(ids);
}

function eventCardCount(parsed) {
  return Number(parsed.count || parsed.cards?.length || (parsed.card?.id ? 1 : 0) || 0);
}

function compactPlan(plan) {
  return {
    recordIndex: plan.recordIndex,
    time: plan.time,
    protocol: plan.protocol,
    eventType: plan.eventType,
    skillId: plan.skillId,
    effectiveSkillId: plan.effectiveSkillId,
    aliasOf: plan.aliasOf,
    skillName: plan.skillName,
    confidence: plan.confidence,
    categories: plan.categories,
    actions: plan.actions,
    knownCardIds: plan.knownCardIds.slice(0, 12),
    cardCount: plan.cardCount,
    orderSourceSensitive: plan.orderSourceSensitive,
    manualReview: plan.manualReview,
    ruleQueue: plan.ruleQueue
  };
}

function countAll(target, keys) {
  for (const key of keys || []) target[key] = (target[key] || 0) + 1;
}

function unique(values) {
  return Array.from(new Set((values || []).filter((value) => value !== "" && value != null)));
}

function dedupeObjects(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

module.exports = {
  makeRulePlanner,
  buildRulePlan,
  CATEGORY_PLANS
};
