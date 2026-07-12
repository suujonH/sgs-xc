function validateSnapshotValue(value, options = {}) {
  const snapshot = value?.snapshot || (value?.config || value?.protocol ? value : null);
  const requireVisible = options.requireVisible === true;
  const checks = [];

  add(checks, "runtime.wrapper", value?.ok === true || !!snapshot, "runtime snapshot wrapper is available", "runtime snapshot wrapper is missing");
  add(checks, "snapshot.object", !!snapshot && typeof snapshot === "object", "snapshot object is available", "snapshot object is missing");

  if (!snapshot || typeof snapshot !== "object") return finish(checks, { visible: false });

  const config = snapshot.config || {};
  const protocol = snapshot.protocol || {};
  const gameModel = snapshot.gameModel || {};
  const skillSummary = config.skillRuleSummary || {};
  const visible = snapshot.visible === true;

  add(checks, "config.loaded", config.loaded === true, "config is loaded", config.error || "config is not loaded");
  addAtLeast(checks, "config.cardCount", config.cardCount, 2700, "card dictionary is populated");
  addAtLeast(checks, "config.spellCount", config.spellCount, 3000, "spell dictionary is populated");
  addAtLeast(checks, "config.skillRules", skillSummary.trackerRelevant, 1900, "skill rule index is populated");
  addAtLeast(checks, "config.standardDeck", config.standardDeckCount, 1, "standard physical deck definition is populated");
  addAtLeast(checks, "config.gameRuleDecks", config.gameRuleDeckCount, 1, "game-rule deck definitions are populated");
  add(checks, "protocol.installed", protocol.installed === true, "protocol hook is installed", protocol.installError || "protocol hook is not installed");
  add(checks, "protocol.hookTarget", !!protocol.hookTarget, `protocol hook target is ${protocol.hookTarget || ""}`, "protocol hook target is empty");
  add(
    checks,
    "gameModel.present",
    !!snapshot.gameModel && Number(gameModel.schemaVersion) === 1,
    "headless game model snapshot is present",
    "headless game model snapshot is missing or has an unsupported schema"
  );

  if (!visible) {
    add(checks, "table.visible", false, "TableGameScene is visible", requireVisible ? "TableGameScene is required but not visible" : "TableGameScene is not visible; battle validation is pending", {
      status: requireVisible ? "fail" : "pending"
    });
    return finish(checks, { visible });
  }

  add(checks, "table.visible", true, "TableGameScene is visible", "TableGameScene is not visible");
  add(checks, "table.visibilityRows", Array.isArray(snapshot.visibility) && snapshot.visibility.length > 0, "seat visibility rows are available", "seat visibility rows are missing");
  add(checks, "gameModel.initialized", gameModel.initialized === true, "game model is initialized for the current table", "game model is not initialized for the current table");
  add(checks, "gameModel.session", !!gameModel.sessionKey, `game model session is ${gameModel.sessionKey || ""}`, "game model session key is empty");
  add(checks, "gameModel.context", isRecord(gameModel.context), "turn, round, and phase context is available", "game model context is missing");
  addAtLeast(checks, "gameModel.catalog", gameModel.catalog?.count, 1, "game model card catalog is populated");
  add(
    checks,
    "gameModel.deckCount",
    Number.isInteger(Number(gameModel.deck?.count)) && Number(gameModel.deck.count) >= 0,
    `game model deck count is ${gameModel.deck?.count}`,
    "game model deck count is not observable"
  );
  const deckDefinitionReady = gameModel.deck?.definition?.known === true && Array.isArray(gameModel.deck.definition.cardIds) && gameModel.deck.definition.cardIds.length > 0;
  add(
    checks,
    "gameModel.deckDefinition",
    deckDefinitionReady,
    `physical deck definition has ${gameModel.deck.definition.cardIds.length} cards`,
    "physical deck definition is unresolved for the current mode",
    { status: "pending" }
  );
  add(
    checks,
    "gameModel.deckEndpoints",
    Array.isArray(gameModel.deck?.top) && Array.isArray(gameModel.deck?.bottom) && isRecord(gameModel.deck?.knownRanks),
    "known deck top, bottom, and sparse ranks are available",
    "deck endpoint or sparse-rank state is missing"
  );
  add(
    checks,
    "gameModel.cardDefinitions",
    isRecord(gameModel.catalog?.observedDefinitionSources) && Array.isArray(gameModel.catalog?.definitionHistory),
    "server-generated physical card definitions and provenance history are available",
    "physical card definition provenance is missing"
  );
  add(
    checks,
    "gameModel.discard",
    !!gameModel.discard && Array.isArray(gameModel.discard.exactIds) && Array.isArray(gameModel.discard.entries),
    "current discard state and movement entries are available",
    "current discard state is missing"
  );
  add(checks, "gameModel.hands", isRecord(gameModel.hands), "all-seat hand knowledge map is available", "all-seat hand knowledge map is missing");
  add(checks, "gameModel.handHistory", Array.isArray(gameModel.handHistory), "all-seat hand-count transition history is available", "hand-count transition history is missing");
  add(checks, "gameModel.handKnowledgeHistory", Array.isArray(gameModel.handKnowledgeHistory), "hand knowledge refinements are separated from membership changes", "hand knowledge refinement history is missing");
  add(checks, "gameModel.handConstraintHistory", Array.isArray(gameModel.handConstraintHistory), "hand-constraint lifecycle history is available", "hand-constraint lifecycle history is missing");
  add(checks, "gameModel.zoneExchangeHistory", Array.isArray(gameModel.zoneExchangeHistory), "atomic whole-zone exchange history is available", "atomic whole-zone exchange history is missing");
  add(checks, "gameModel.zones", isRecord(gameModel.zones), "public and special zone map is available", "public and special zone map is missing");
  add(checks, "gameModel.locationHistory", isRecord(gameModel.locations) && Array.isArray(gameModel.locationHistory), "continuous physical-card zone residence history is available", "physical-card residence history is missing");
  add(checks, "gameModel.locationGroups", isRecord(gameModel.locationGroups) && Array.isArray(gameModel.locationGroupHistory), "ambiguous physical-card location groups and history are available", "location uncertainty groups are missing");
  add(checks, "gameModel.cardTags", isRecord(gameModel.cardTags) && Array.isArray(gameModel.cardTagHistory), "physical-card tag map and lifecycle history are available", "physical-card tag lifecycle state is missing");
  add(checks, "gameModel.cardEventHistory", Array.isArray(gameModel.cardEventHistory), "physical-card event history is available", "physical-card event history is missing");
  add(checks, "gameModel.causalEvents", isRecord(gameModel.causalEvents) && Array.isArray(gameModel.causalEventHistory), "durable causal event graph and observation history are available", "causal event graph is missing");
  add(checks, "gameModel.comparisons", isRecord(gameModel.comparisons) && Array.isArray(gameModel.comparisonHistory), "multi-party comparison state and observation history are available", "comparison ledger is missing");
  add(checks, "gameModel.cardViews", isRecord(gameModel.cardViews) && Array.isArray(gameModel.cardViewHistory), "rule-effective and observer-scoped apparent card views share a provenance-preserving lifecycle ledger", "layered card view state is missing");
  add(checks, "gameModel.ruleStates", isRecord(gameModel.ruleStates) && Array.isArray(gameModel.ruleStateHistory), "generic rule state and mutation history are available", "generic rule state ledger is missing");
  add(checks, "gameModel.ruleModifiers", isRecord(gameModel.ruleModifiers) && Array.isArray(gameModel.ruleModifierHistory), "structured rule modifiers and lifecycle history are available", "structured rule modifier ledger is missing");
  add(checks, "gameModel.scheduledEffects", isRecord(gameModel.scheduledEffects) && Array.isArray(gameModel.scheduledEffectHistory), "future server-event effects and lifecycle history are available", "scheduled effect ledger is missing");
  add(checks, "gameModel.choiceSets", isRecord(gameModel.choiceSets) && Array.isArray(gameModel.choiceSetHistory), "typed candidate prompts, stochastic outcomes, and resolution history are available", "choice/stochastic set ledger is missing");
  add(checks, "gameModel.skillBindings", isRecord(gameModel.skillBindings) && Array.isArray(gameModel.skillBindingHistory), "exact active skill bindings and lifecycle history are available", "skill binding ledger is missing");
  add(checks, "gameModel.physicalPiles", isRecord(gameModel.physicalPiles) && Array.isArray(gameModel.physicalPileHistory), "independent ordered physical-card piles and history are available", "independent physical-card pile state is missing");
  add(checks, "gameModel.entityPiles", isRecord(gameModel.entityPiles) && isRecord(gameModel.entityLocations) && Array.isArray(gameModel.entityPileHistory), "non-game-card entity piles are isolated", "non-game-card entity pile state is missing");
  add(checks, "gameModel.events", Array.isArray(gameModel.recentEvents), "game model event history is available", "game model event history is missing");
  const contradictions = Array.isArray(gameModel.contradictions) ? gameModel.contradictions : [];
  add(
    checks,
    "gameModel.contradictions",
    contradictions.length === 0,
    "game model has no unresolved contradictions",
    `game model has ${contradictions.length} unresolved contradiction(s)`,
    { status: "warn", actual: contradictions.length }
  );

  const currentMoveRecords = protocolMoveRecordsSince(protocol, gameModel.createdAt);
  add(
    checks,
    "protocol.moveCards",
    currentMoveRecords.length > 0,
    `current game has ${currentMoveRecords.length} observed PubGsCMoveCard record(s)`,
    "current game has not observed PubGsCMoveCard yet",
    { status: "pending", actual: currentMoveRecords.length }
  );
  const latestMove = currentMoveRecords.at(-1) || null;
  const modeledMove = latestMove == null || Array.from(gameModel.recentEvents || []).some((event) =>
    event?.type === "card.move" && Number(event?.source?.recordIndex) === Number(latestMove.index)
  );
  add(
    checks,
    "gameModel.protocolMoves",
    modeledMove,
    latestMove ? `latest protocol movement ${latestMove.index} reached the game model` : "no current-game protocol movement requires reconciliation",
    `latest protocol movement ${latestMove?.index} did not reach the game model`,
    { status: latestMove ? "fail" : "pending" }
  );

  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const cardsWithSource = rows.flatMap((row) => row.cards || []).filter((card) => card?.source?.rule);
  add(checks, "hand.rows", Array.isArray(snapshot.rows), "known hand rows array is available", "known hand rows array is missing");
  add(checks, "hand.sources", cardsWithSource.length > 0 || rows.length === 0, "known hand card sources are present when known cards exist", "known hand cards are missing source rules", {
    status: rows.some((row) => Number(row.knownCount || 0) > 0) ? "fail" : "pending"
  });
  addPublicZoneChecks(checks, snapshot);
  addSourceProvenanceChecks(checks, snapshot);

  return finish(checks, { visible });
}

function protocolMoveRecordsSince(protocol, createdAt) {
  const start = Number(createdAt || 0);
  return Array.from(protocol?.records || []).filter((record) => {
    if (start > 0 && Number(record?.time || 0) < start) return false;
    return record?.parsed?.type === "card:move" || record?.name === "PubGsCMoveCard";
  });
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function addPublicZoneChecks(checks, snapshot) {
  const publicZones = snapshot.publicZones || null;
  const hasPublicZones = !!publicZones && Array.isArray(publicZones.seats);
  add(checks, "publicZones.present", hasPublicZones, "public zone snapshot is available", "public zone snapshot is missing");
  if (!hasPublicZones) return;

  const cards = publicZones.seats.flatMap((seat) => [
    ...Object.values(seat?.zones || {}).flatMap((zone) => zone?.cards || []),
    ...(seat?.namedZones || [])
      .filter((zone) => !zone.representationKind || zone.representationKind === "physical-card-zone")
      .flatMap((zone) => zone?.cards || [])
  ]);
  const publicSourceOk = cards.every((card) => isPublicZoneSource(card?.source));
  add(checks, "publicZones.sources", publicSourceOk, "public zone cards keep runtime source provenance", "public zone cards are missing runtime source provenance", {
    actual: cards.length
  });
}

function addSourceProvenanceChecks(checks, snapshot) {
  const visibleRows = Array.isArray(snapshot.visibleRows) ? snapshot.visibleRows : [];
  const rawMaskCards = visibleRows
    .flatMap((row) => row.cards || [])
    .filter((card) => card?.source?.rule === "mask-visible-card-ui");
  const rawMaskOk = rawMaskCards.every((card) => isRawMaskSource(card.source));
  add(checks, "hand.maskSource.raw", rawMaskOk, "raw mask-visible card sources keep CardUI provenance", "raw mask-visible card sources are missing CardUI provenance", {
    status: rawMaskCards.length ? "fail" : "pending",
    actual: rawMaskCards.length
  });

  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const ledgerMaskCards = rows
    .flatMap((row) => row.cards || [])
    .filter((card) => {
      const source = card?.source || {};
      return source.rule === "known-hand-ledger" && sourceHasUnderlyingRule(source, "mask-visible-card-ui");
    });
  const ledgerMaskOk = ledgerMaskCards.every((card) => {
    const source = card.source || {};
    const last = source.lastSource || {};
    const history = Array.isArray(source.sourceHistory) ? source.sourceHistory : [];
    return history.some(isRawMaskSource) && (isRawMaskSource(last) || source.seenRules?.includes?.("mask-visible-card-ui"));
  });
  add(checks, "hand.maskSource.ledger", ledgerMaskOk, "ledger mask-derived cards keep source history", "ledger mask-derived cards are missing source history", {
    status: ledgerMaskCards.length ? "fail" : "pending",
    actual: ledgerMaskCards.length
  });

  const ledgerProtocolAuthorizedCards = rows
    .flatMap((row) => row.cards || [])
    .filter((card) => {
      const source = card?.source || {};
      return source.rule === "known-hand-ledger" && sourceHasUnderlyingRule(source, "protocol-authorized-friend-hand");
    });
  const ledgerProtocolAuthorizedOk = ledgerProtocolAuthorizedCards.every((card) => {
    const source = card.source || {};
    const history = Array.isArray(source.sourceHistory) ? source.sourceHistory : [];
    return history.some(isProtocolAuthorizedSource);
  });
  add(checks, "hand.protocolAuthorized.ledger", ledgerProtocolAuthorizedOk, "ledger protocol-authorized hand cards keep protocol provenance", "ledger protocol-authorized hand cards are missing protocol provenance", {
    status: ledgerProtocolAuthorizedCards.length ? "fail" : "pending",
    actual: ledgerProtocolAuthorizedCards.length
  });
}

function isRawMaskSource(source) {
  if (!source || source.rule !== "mask-visible-card-ui") return false;
  return (
    source.legacySource === "mask" &&
    source.origin === "laya-card-ui" &&
    !!source.mask &&
    !!source.rect &&
    !!source.node?.path &&
    !!source.groupNode?.path
  );
}

function isProtocolAuthorizedSource(source) {
  if (!source || source.rule !== "protocol-authorized-friend-hand") return false;
  return (
    source.legacySource === "protocol" &&
    source.origin === "protocol" &&
    !!source.protocol &&
    source.msgId !== undefined &&
    source.msgId !== null
  );
}

function isPublicZoneSource(source) {
  if (!source) return false;
  const named = source.rule === "public-named-general-runtime" && source.origin === "runtime-public-named-field";
  return (
    (named || ["public-equip-runtime", "public-judge-runtime", "public-general-runtime"].includes(source.rule)) &&
    source.legacySource === "public-zone" &&
    (named || source.origin === "runtime-public-field") &&
    !!source.zoneName &&
    !!source.fieldName &&
    Number.isInteger(Number(source.seatIndex))
  );
}

function sourceHasUnderlyingRule(source, rule) {
  return (
    source?.firstRule === rule ||
    source?.lastRule === rule ||
    Array.from(source?.seenRules || []).includes(rule)
  );
}

function addAtLeast(checks, id, actual, expected, passMessage) {
  const number = Number(actual || 0);
  add(checks, id, number >= expected, passMessage, `${id} expected >= ${expected}, got ${number}`, { actual: number, expected });
}

function add(checks, id, condition, passMessage, failMessage, options = {}) {
  const forced = options.status;
  const status = condition ? "pass" : (forced || "fail");
  checks.push({
    id,
    status,
    message: condition ? passMessage : failMessage,
    ...(options.actual !== undefined ? { actual: options.actual } : {}),
    ...(options.expected !== undefined ? { expected: options.expected } : {})
  });
}

function finish(checks, extra = {}) {
  const counts = countBy(checks, (check) => check.status);
  const ok = !counts.fail;
  return {
    ok,
    status: counts.fail ? "fail" : counts.pending ? "pending" : counts.warn ? "warn" : "pass",
    counts,
    ...extra,
    checks
  };
}

function countBy(rows, keyFn) {
  const result = { pass: 0, fail: 0, warn: 0, pending: 0 };
  for (const row of rows) {
    const key = keyFn(row);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

module.exports = {
  validateSnapshotValue
};
