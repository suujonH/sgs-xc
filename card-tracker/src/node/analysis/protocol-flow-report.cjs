function buildProtocolFlowReport(value, validation = null) {
  const snapshot = value?.snapshot || (value?.config || value?.protocol ? value : null);
  if (!snapshot || typeof snapshot !== "object") {
    return {
      ok: false,
      error: "snapshot object is missing"
    };
  }

  const protocol = snapshot.protocol || {};
  const records = Array.isArray(protocol.records) ? protocol.records : [];
  const skillEvents = Array.isArray(protocol.recentSkillEvents) ? protocol.recentSkillEvents : [];
  const planner = snapshot.rulePlanner || {};
  const plans = Array.isArray(planner.recentPlans) ? planner.recentPlans : [];
  const protocolZoneLedger = snapshot.protocolZoneLedger || {};
  const planByRecordIndex = new Map(plans.map((plan) => [Number(plan.recordIndex), plan]));
  const cardMoves = records
    .filter((record) => record?.parsed?.type === "card:move")
    .map((record) => moveRow(record, planByRecordIndex.get(Number(record.index))));
  const problems = problemRows({ protocol, records, cardMoves, planner, plans, protocolZoneLedger });

  return {
    ok: true,
    visible: snapshot.visible === true,
    reason: snapshot.reason || "",
    protocol: {
      installed: protocol.installed === true,
      installError: protocol.installError || "",
      hookTarget: protocol.hookTarget || "",
      counts: protocol.counts || {},
      context: protocol.context || null,
      maxRecords: Number(protocol.maxRecords || 0),
      recordCount: records.length,
      recentSkillEventCount: skillEvents.length
    },
    checks: {
      protocolInstalled: checkStatus(validation, "protocol.installed"),
      protocolHookTarget: checkStatus(validation, "protocol.hookTarget"),
      protocolMoveCards: checkStatus(validation, "protocol.moveCards"),
      plannerEvents: checkStatus(validation, "planner.events")
    },
    counts: {
      records: records.length,
      cardMoves: cardMoves.length,
      movesWithKnownIds: cardMoves.filter((row) => row.knownCardIds.length > 0).length,
      movesWithUnknownCount: cardMoves.filter((row) => row.unknownCount > 0).length,
      skillEvents: skillEvents.length,
      plans: plans.length,
      plannerHandled: Number(planner.handledCount || 0),
      plannerPlanned: Number(planner.plannedCount || 0),
      protocolZoneLedgerMoves: Number(protocolZoneLedger.moveCount || 0),
      protocolZoneLedgerKnownLocations: Number(protocolZoneLedger.knownLocationCount || 0),
      protocolZoneDeckTopKnown: Number(protocolZoneLedger.deckEndpoint?.knownTopCount || 0),
      protocolZoneDeckBottomKnown: Number(protocolZoneLedger.deckEndpoint?.knownBottomCount || 0),
      problems: problems.length
    },
    cardMoves: cardMoves.slice(-60),
    skillEvents: skillEvents.slice(-40).map(skillEventRow),
    planner: {
      version: planner.version || null,
      handledCount: Number(planner.handledCount || 0),
      plannedCount: Number(planner.plannedCount || 0),
      lastError: planner.lastError || "",
      categoryCounts: planner.categoryCounts || {},
      actionCounts: planner.actionCounts || {},
      aliasCounts: planner.aliasCounts || {},
      recentPlans: plans.slice(-40).map(planRow)
    },
    protocolZoneLedger: {
      version: protocolZoneLedger.version || null,
      moveCount: Number(protocolZoneLedger.moveCount || 0),
      knownMoveCount: Number(protocolZoneLedger.knownMoveCount || 0),
      unknownMoveCount: Number(protocolZoneLedger.unknownMoveCount || 0),
      cardCount: Number(protocolZoneLedger.cardCount || 0),
      knownLocationCount: Number(protocolZoneLedger.knownLocationCount || 0),
      zoneCount: Number(protocolZoneLedger.zoneCount || 0),
      byZone: protocolZoneLedger.byZone || {},
      sources: protocolZoneLedger.sources || {},
      deckEndpoint: compactDeckEndpoint(protocolZoneLedger.deckEndpoint),
      recentEvents: Array.isArray(protocolZoneLedger.recentEvents) ? protocolZoneLedger.recentEvents.slice(-20) : []
    },
    problems
  };
}

function moveRow(record, plan) {
  const parsed = record.parsed || {};
  const ids = knownCardIds(parsed);
  const count = Number(parsed.count || ids.length || 0);
  return {
    recordIndex: Number(record.index),
    time: record.time || null,
    protocol: record.name || parsed.protocol || "",
    msgId: parsed.msgId ?? null,
    type: parsed.type || "",
    skillId: Number(parsed.skillId || 0),
    skillName: parsed.skillRule?.name || plan?.skillName || "",
    skillCategories: categoryIds(parsed.skillRule),
    skillConfidence: parsed.skillRule?.confidence || "",
    from: zoneEndpoint(parsed.from),
    to: zoneEndpoint(parsed.to),
    count,
    knownCardIds: ids,
    knownCards: knownCards(parsed),
    unknownCount: Math.max(0, count - ids.length),
    moveType: parsed.moveType ?? null,
    srcSeat: parsed.srcSeat ?? null,
    context: parsed.context || null,
    plannedActions: plan?.actions || [],
    plannedCategories: plan?.categories || [],
    orderSourceSensitive: plan?.orderSourceSensitive === true || plan?.manualReview === true,
    manualReview: plan?.manualReview === true,
    ruleQueue: plan?.ruleQueue || ""
  };
}

function skillEventRow(event) {
  return {
    time: event?.time || null,
    protocol: event?.protocol || "",
    type: event?.type || "",
    skillId: Number(event?.skillId || 0),
    skillName: event?.skillRule?.name || "",
    categories: categoryIds(event?.skillRule),
    confidence: event?.skillRule?.confidence || "",
    priority: event?.skillRule?.priority || ""
  };
}

function planRow(plan) {
  return {
    recordIndex: plan?.recordIndex ?? null,
    time: plan?.time || null,
    protocol: plan?.protocol || "",
    eventType: plan?.eventType || "",
    skillId: Number(plan?.skillId || 0),
    effectiveSkillId: Number(plan?.effectiveSkillId || 0),
    aliasOf: Number(plan?.aliasOf || 0),
    skillName: plan?.skillName || "",
    confidence: plan?.confidence || "",
    categories: Array.from(plan?.categories || []),
    actions: Array.from(plan?.actions || []),
    knownCardIds: normalizeIds(plan?.knownCardIds || []),
    cardCount: Number(plan?.cardCount || 0),
    orderSourceSensitive: plan?.orderSourceSensitive === true || plan?.manualReview === true,
    manualReview: plan?.manualReview === true,
    ruleQueue: plan?.ruleQueue || ""
  };
}

function compactDeckEndpoint(endpoint) {
  if (!endpoint) return null;
  return {
    version: endpoint.version || null,
    top: normalizeIds(endpoint.top || []),
    bottom: normalizeIds(endpoint.bottom || []),
    knownTopCount: Number(endpoint.knownTopCount || endpoint.top?.length || 0),
    knownBottomCount: Number(endpoint.knownBottomCount || endpoint.bottom?.length || 0),
    invalidationCount: Number(endpoint.invalidationCount || 0),
    lastInvalidationReason: endpoint.lastInvalidationReason || "",
    lastReason: endpoint.lastReason || "",
    topSource: endpoint.topSource || null,
    bottomSource: endpoint.bottomSource || null,
    recentEvents: Array.isArray(endpoint.recentEvents) ? endpoint.recentEvents.slice(-20) : []
  };
}

function problemRows({ protocol, records, cardMoves, planner, plans, protocolZoneLedger }) {
  const rows = [];
  const protocolMoveCount = Number(protocol?.counts?.PubGsCMoveCard || 0);
  const plannedCount = Number(planner?.plannedCount || 0);
  const protocolZoneMoveCount = Number(protocolZoneLedger?.moveCount || 0);

  if (protocol?.installed !== true) {
    rows.push({
      severity: "warn",
      id: "protocol-hook-not-installed",
      message: protocol?.installError || "protocol hook is not installed"
    });
  }
  if (protocolMoveCount > 0 && plannedCount === 0) {
    rows.push({
      severity: "warn",
      id: "protocol-move-without-rule-plan",
      message: "card movement protocols were observed but rulePlanner has no plans",
      actual: { protocolMoveCount, plannedCount }
    });
  }
  if (protocolMoveCount > 0 && protocolZoneMoveCount === 0) {
    rows.push({
      severity: "warn",
      id: "protocol-move-without-zone-ledger",
      message: "card movement protocols were observed but protocolZoneLedger has no moves",
      actual: { protocolMoveCount, protocolZoneMoveCount }
    });
  }
  if (protocolMoveCount > 0 && cardMoves.length === 0) {
    rows.push({
      severity: "info",
      id: "move-records-not-in-retained-window",
      message: "PubGsCMoveCard was counted but retained recent records do not include a parsed card move",
      actual: { protocolMoveCount, retainedRecords: records.length }
    });
  }
  if (cardMoves.length > plans.length && protocolMoveCount > 0) {
    rows.push({
      severity: "info",
      id: "more-card-moves-than-retained-plans",
      message: "retained card moves outnumber retained rule plans",
      actual: { cardMoves: cardMoves.length, plans: plans.length }
    });
  }
  if (planner?.lastError) {
    rows.push({
      severity: "warn",
      id: "rule-planner-last-error",
      message: String(planner.lastError)
    });
  }
  if (protocolZoneLedger?.lastError) {
    rows.push({
      severity: "warn",
      id: "protocol-zone-ledger-last-error",
      message: String(protocolZoneLedger.lastError)
    });
  }
  return rows;
}

function zoneEndpoint(endpoint) {
  return {
    seat: endpoint?.seat ?? null,
    zone: endpoint?.zone || "",
    code: endpoint?.code ?? null
  };
}

function knownCards(parsed) {
  return (parsed?.cards || [])
    .filter((card) => Number(card?.id || 0) > 0)
    .map((card) => ({
      id: Number(card.id),
      name: card.name || null,
      suit: card.suit || "",
      rank: card.rank || "",
      color: card.color || null,
      number: card.number || null,
      spellId: Number(card.spellId || 0)
    }));
}

function knownCardIds(parsed) {
  return normalizeIds([
    ...(parsed?.cards || []).map((card) => card?.id),
    parsed?.card?.id
  ]);
}

function normalizeIds(ids) {
  return Array.from(new Set((ids || []).map(Number).filter((id) => Number.isFinite(id) && id > 0)));
}

function categoryIds(rule) {
  return Array.from(rule?.categories || []).map((item) => typeof item === "string" ? item : item?.id).filter(Boolean);
}

function checkStatus(validation, id) {
  const check = validation?.checks?.find?.((item) => item.id === id);
  if (!check) return null;
  return {
    status: check.status,
    message: check.message,
    actual: check.actual
  };
}

module.exports = {
  buildProtocolFlowReport,
  moveRow,
  skillEventRow,
  planRow
};
