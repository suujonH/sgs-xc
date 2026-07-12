const SCHEMA_VERSION = 1;

const ZONE = Object.freeze({
  DECK: "deck",
  DISCARD: "discard",
  PROCESS: "process",
  REMOVED: "removed",
  OUTSIDE: "outside",
  SHUFFLE: "shuffle"
});

const AUTHORITY = Object.freeze({
  "server-protocol": 100,
  "runtime-public": 90,
  "runtime-seat-hand": 85,
  "visible-ui": 80,
  "game-log": 70,
  "rule-feedback": 60,
  "skill-text": 50,
  "statistical": 10,
  unknown: 0
});

const DECK_POSITION = Object.freeze({
  BOTTOM: 0,
  TOP: 65280,
  RANDOM: 65281,
  NEEDLESS: 65282
});

function makeGameModel(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const maxEvents = positiveInteger(options.maxEvents, 400);
  const maxContradictions = positiveInteger(options.maxContradictions, 100);

  const state = makeInitialState(now);

  function reset(reason = "reset") {
    const next = makeInitialState(now);
    next.version = state.version + 1;
    next.resetReason = String(reason || "reset");
    replaceObject(state, next);
    recordEvent("model.reset", { reason: state.resetReason });
    return snapshot();
  }

  function setCatalog(value, source = sourceOf("config-card-catalog", "runtime-public")) {
    const catalog = normalizeCatalog(value);
    const normalizedSource = normalizeSource(source, now);
    for (const [cardId, definitionSourceValue] of Object.entries(state.cardDefinitionSources)) {
      const current = state.catalog[cardId];
      if (!current) continue;
      const definitionSource = normalizeSource(definitionSourceValue, now);
      if (!catalog[cardId] || definitionSource.authority >= normalizedSource.authority) {
        catalog[cardId] = cloneJson(current);
      }
    }
    state.catalog = catalog;
    state.catalogSource = normalizedSource;
    state.updatedAt = now();
    return Object.keys(catalog).length;
  }

  function observePhysicalCardDefinition(input = {}) {
    const payload = physicalCardDefinitionPayload(input);
    const cardId = finiteInteger(payload.id ?? input.cardId ?? input.id, 0);
    if (cardId <= 0 || Object.keys(payload).every((key) => ["id", "cardId", "CardID"].includes(key))) return null;
    const source = normalizeSource(input.source || sourceOf("physical-card-definition", "server-protocol", {
      skillId: finiteInteger(input.skillId, 0)
    }), now);
    const existing = state.catalog[cardId] ? cloneJson(state.catalog[cardId]) : null;
    const priorSource = normalizeSource(state.cardDefinitionSources[cardId] || state.catalogSource || sourceOf("unknown-card-definition", "unknown"), now);
    const next = normalizeCard({ ...(existing || {}), ...payload, id: cardId });
    const conflicts = physicalCardDefinitionConflicts(existing, next, payload);
    const accepted = !conflicts.length || source.authority >= priorSource.authority;
    const history = {
      index: state.nextCardDefinitionHistoryIndex++,
      cardId,
      accepted,
      before: existing,
      after: accepted ? cloneJson(next) : existing,
      conflicts,
      priorSource,
      source,
      reason: String(input.reason || ""),
      context: mergeTurnContext(state.context, input.context),
      eventIndex: state.nextEventIndex,
      time: now()
    };
    state.cardDefinitionHistory.push(history);
    if (state.cardDefinitionHistory.length > maxEvents) {
      state.cardDefinitionHistory.splice(0, state.cardDefinitionHistory.length - maxEvents);
    }
    if (!accepted) {
      contradiction("physical-card-definition-lower-authority-conflict", {
        cardId,
        conflicts,
        priorSource,
        source
      });
      recordEvent("card.definition.rejected", { cardId, conflicts, priorSource, source });
      return { applied: false, cardId, conflicts, card: existing, source: priorSource };
    }
    if (conflicts.length) {
      contradiction("physical-card-definition-authoritative-revision", {
        cardId,
        conflicts,
        priorSource,
        source
      });
    }
    state.catalog[cardId] = next;
    state.cardDefinitionSources[cardId] = source;
    registerDynamicIds([cardId]);
    recordEvent("card.definition.observed", {
      cardId,
      card: next,
      conflicts,
      source
    });
    return { applied: true, cardId, conflicts, card: cloneJson(next), source: cloneJson(source) };
  }

  function physicalCardDefinition(cardIdValue) {
    const cardId = finiteInteger(cardIdValue, 0);
    if (cardId <= 0 || !state.catalog[cardId]) return null;
    return {
      cardId,
      card: cloneJson(state.catalog[cardId]),
      source: cloneJson(state.cardDefinitionSources[cardId] || state.catalogSource),
      history: state.cardDefinitionHistory.filter((row) => row.cardId === cardId).map(cloneJson)
    };
  }

  function physicalCardGeneration(cardIdValue) {
    const cardId = finiteInteger(cardIdValue?.cardId || cardIdValue?.id || cardIdValue, 0);
    if (cardId <= 0) return 0;
    return positiveIntegerOrNull(state.physicalCardLifecycles[cardId]?.generation) || 1;
  }

  function observePhysicalCardLifecycle(input = {}) {
    const cardId = finiteInteger(input.cardId ?? input.id, 0);
    if (cardId <= 0) return { applied: false, reason: "physical-card-id-required" };
    const existing = state.physicalCardLifecycles[cardId] || null;
    const source = normalizeSource(input.source || sourceOf("physical-card-lifecycle", "server-protocol", {
      skillId: finiteInteger(input.skillId, 0)
    }), now);
    const terminalStatuses = new Set(["destroyed", "retired", "consumed", "terminal-removed"]);
    const rawStatus = String(input.status || (input.terminal === true ? "destroyed" : existing?.status || "active")).trim().toLowerCase();
    if (!["active", "available", "reserved", ...terminalStatuses].includes(rawStatus)) {
      return { applied: false, reason: "physical-card-lifecycle-status-invalid", cardId };
    }
    if (input.terminal != null && typeof input.terminal !== "boolean") {
      return { applied: false, reason: "physical-card-lifecycle-terminal-must-be-boolean", cardId };
    }
    const terminal = input.terminal == null ? terminalStatuses.has(rawStatus) : input.terminal;
    if (terminal !== terminalStatuses.has(rawStatus)) {
      return { applied: false, reason: "physical-card-lifecycle-status-terminal-conflict", cardId };
    }
    const priorSource = normalizeSource(existing?.source || sourceOf("unobserved-physical-card-lifecycle", "unknown"), now);
    const semanticChanged = !existing || existing.status !== rawStatus || existing.terminal !== terminal;
    if (existing && semanticChanged && source.authority < priorSource.authority) {
      contradiction("physical-card-lifecycle-lower-authority-conflict", {
        cardId,
        previous: existing,
        observed: { status: rawStatus, terminal },
        priorSource,
        source
      });
      return { applied: false, reason: "physical-card-lifecycle-lower-authority-conflict", cardId };
    }
    const reactivating = existing?.terminal === true && terminal === false;
    if (reactivating && input.allowReactivation !== true) {
      contradiction("terminal-card-reactivation-not-authorized", { cardId, previous: existing, observedStatus: rawStatus, source });
      return { applied: false, reason: "terminal-card-reactivation-not-authorized", cardId };
    }

    const currentZone = state.locations[cardId]?.zoneKey || "";
    const requestedDestination = normalizeZoneKey(input.to || input.destination || input.zoneKey || input.terminalZoneKey);
    const destination = terminal
      ? requestedDestination || `terminal:${rawStatus}`
      : requestedDestination;
    if (reactivating && !destination) {
      return { applied: false, reason: "terminal-card-reactivation-destination-required", cardId };
    }
    const before = existing ? cloneJson(existing) : null;
    const row = existing ? cloneJson(existing) : {
      cardId,
      generation: 1,
      status: "active",
      terminal: false,
      recyclable: true,
      terminalZoneKey: null,
      reason: null,
      skillId: null,
      ruleIdentityKey: null,
      causalEventId: null,
      metadata: {},
      revision: 0,
      context: mergeTurnContext(state.context, input.context),
      source,
      createdAt: now(),
      updatedAt: now()
    };
    const beforeSemantic = existing ? canonicalJsonKey(physicalCardLifecycleSemantic(row)) : null;
    row.generation = reactivating
      ? physicalCardGeneration(cardId) + 1
      : positiveIntegerOrNull(row.generation) || 1;
    row.status = rawStatus;
    row.terminal = terminal;
    row.recyclable = terminal ? false : input.recyclable !== false;
    row.terminalZoneKey = terminal ? destination : null;
    if (input.reason != null || input.terminalReason != null) row.reason = stringOrNull(input.reason || input.terminalReason);
    const skillId = finiteInteger(input.skillId, 0);
    if (skillId > 0) row.skillId = skillId;
    if (input.ruleIdentityKey != null) row.ruleIdentityKey = stringOrNull(input.ruleIdentityKey);
    if (input.causalEventId != null || input.eventId != null) row.causalEventId = stringOrNull(input.causalEventId || input.eventId);
    if (input.metadata != null) row.metadata = cloneJson(input.metadata || {});
    row.context = mergeTurnContext(state.context, input.context || row.context);
    row.source = source;
    row.updatedAt = now();
    row.revision = Number(row.revision || 0) + 1;
    state.physicalCardLifecycles[cardId] = row;
    registerDynamicIds([cardId]);
    if (terminal && existing?.terminal !== true) {
      expirePhysicalCardInstanceBindings(cardId, row.generation, `physical-generation-${row.generation}-terminal`, source);
    }

    let movement = null;
    if (destination && currentZone !== destination) {
      if (terminal) {
        const terminalZone = ensureZone(destination);
        terminalZone.zoneKind = "terminal-card-zone";
        terminalZone.pileKey = rawStatus;
        terminalZone.ordered = false;
        terminalZone.orderKnown = false;
        terminalZone.visibilityAudience = String(input.visibilityAudience || "public-state");
        terminalZone.metadata = { ...terminalZone.metadata, terminal: true, lifecycleStatus: rawStatus };
      }
      const from = normalizeZoneKey(input.from || input.sourceZone) || currentZone;
      if (from) {
        movement = observeMove({
          from,
          to: destination,
          count: 1,
          cardIds: [cardId],
          movementId: input.movementId,
          movementGroupId: input.movementGroupId,
          movementAttemptId: input.movementAttemptId,
          sequenceIndex: input.sequenceIndex,
          movementReason: input.movementReason || (terminal ? "terminal-destroy" : "terminal-reactivate"),
          reasonTags: uniqueStrings([...(asList(input.reasonTags)), terminal ? "terminal" : "reactivated"]),
          skillId,
          causalEventId: row.causalEventId,
          context: input.context,
          reason: input.reason || rawStatus,
          source
        });
      } else {
        placeExactCard(cardId, destination, source);
        const zone = ensureZone(destination);
        zone.count = Math.max(nonNegativeIntegerOrNull(zone.count) ?? 0, zone.exactIds.length);
        zone.complete = zone.count === zone.exactIds.length;
        zone.updatedAt = now();
      }
    }
    const afterSemantic = canonicalJsonKey(physicalCardLifecycleSemantic(row));
    const locationChanged = currentZone !== (state.locations[cardId]?.zoneKey || "");
    if (existing && beforeSemantic === afterSemantic && !locationChanged) {
      state.physicalCardLifecycles[cardId] = existing;
      return { applied: true, duplicate: true, lifecycle: cloneJson(existing), movement: null };
    }
    const history = {
      index: state.nextPhysicalCardLifecycleHistoryIndex++,
      cardId,
      type: reactivating ? "reactivate" : terminal ? "terminal" : existing ? "update" : "observe",
      before,
      after: cloneJson(row),
      from: currentZone || null,
      to: state.locations[cardId]?.zoneKey || destination || null,
      movementId: stringOrNull(movement?.movementId),
      source,
      eventIndex: state.nextEventIndex,
      time: now()
    };
    state.physicalCardLifecycleHistory.push(history);
    if (state.physicalCardLifecycleHistory.length > maxEvents) {
      state.physicalCardLifecycleHistory.splice(0, state.physicalCardLifecycleHistory.length - maxEvents);
    }
    recordEvent("physical-card.lifecycle", {
      cardId,
      generation: row.generation,
      status: row.status,
      terminal: row.terminal,
      recyclable: row.recyclable,
      from: history.from,
      to: history.to,
      movementId: history.movementId,
      source
    });
    validatePhysicalWorld();
    return { applied: true, duplicate: false, lifecycle: cloneJson(row), movement: cloneJson(movement) };
  }

  function destroyPhysicalCard(input = {}) {
    return observePhysicalCardLifecycle({ ...input, status: input.status || "destroyed", terminal: true });
  }

  function physicalCardLifecycle(cardIdValue) {
    const cardId = finiteInteger(cardIdValue?.cardId || cardIdValue?.id || cardIdValue, 0);
    return cardId > 0 && state.physicalCardLifecycles[cardId]
      ? cloneJson(state.physicalCardLifecycles[cardId])
      : null;
  }

  function physicalCardLifecycles(input = {}) {
    const status = String(input.status || "").trim().toLowerCase();
    const skillId = finiteInteger(input.skillId, 0);
    return Object.values(state.physicalCardLifecycles).filter((row) => {
      if (status && row.status !== status) return false;
      if (skillId > 0 && row.skillId !== skillId) return false;
      if (input.terminal != null && row.terminal !== (input.terminal === true)) return false;
      if (input.recyclable != null && row.recyclable !== (input.recyclable === true)) return false;
      return true;
    }).sort((left, right) => left.cardId - right.cardId).map(cloneJson);
  }

  function expirePhysicalCardInstanceBindings(cardId, generation, reason, source) {
    for (const [tag, row] of Object.entries(state.cardTags[cardId] || {})) {
      if (row.physicalGeneration != null && row.physicalGeneration !== generation) continue;
      expireCardTag(cardId, tag, reason, source);
    }
    invalidateCardViews(cardId, reason, source, (row) =>
      row.physicalGeneration == null || row.physicalGeneration === generation
    );
    removeEquipmentProjection({ sourceCardId: cardId, reason, source });
    for (const [key, row] of Object.entries(state.ruleModifiers)) {
      if (row.whileCardId !== cardId) continue;
      if (row.whileCardGeneration != null && row.whileCardGeneration !== generation) continue;
      removeRuleModifier({ key, reason, source });
    }
    for (const row of Object.values(state.scheduledEffects)) {
      if (row.whileCardId !== cardId) continue;
      if (row.whileCardGeneration != null && row.whileCardGeneration !== generation) continue;
      resolveScheduledEffect({ key: row.key, status: "expired", reason, source });
    }
  }

  function physicalCardLifecycleSemantic(row) {
    const result = cloneJson(row);
    delete result.revision;
    delete result.createdAt;
    delete result.updatedAt;
    delete result.source;
    return result;
  }

  function configureGame(config = {}) {
    reset(config.reason || "game.configure");
    if (config.catalog) setCatalog(config.catalog, config.catalogSource);
    if (config.deckCardIds) {
      setDeckDefinition(config.deckCardIds, config.deckSource || sourceOf("explicit-deck-definition", "runtime-public"));
    }
    if (config.deckCount != null) {
      observeDeckCount(config.deckCount, config.deckCountSource || sourceOf("initial-deck-count", "runtime-public"), {
        initial: true
      });
    } else if (state.deck.definition.known) {
      state.deck.count = state.deck.definition.cardIds.length;
      syncDeckZone(config.deckSource || sourceOf("explicit-deck-definition", "runtime-public"));
    }
    state.initialized = true;
    state.sessionKey = String(config.sessionKey || "");
    recordEvent("game.configured", {
      sessionKey: state.sessionKey,
      deckDefinitionKnown: state.deck.definition.known,
      deckDefinitionCount: state.deck.definition.cardIds.length,
      deckCount: state.deck.count
    });
    return snapshot();
  }

  function observeGameEvent(event = {}) {
    const type = String(event.type || "protocol");
    const previousContext = { ...state.context };
    const incoming = normalizeTurnContext(event.context || event);
    if (incoming.turn != null) state.context.turn = incoming.turn;
    if (incoming.round != null) state.context.round = incoming.round;
    if (incoming.phase != null) state.context.phase = incoming.phase;
    if (event.seat != null && ["game:turn", "game:phase"].includes(type)) state.context.activeSeat = finiteNumber(event.seat);
    if (type === "game:stage") {
      state.context.stage = event.stage ?? null;
      state.context.gameOver = false;
    }
    if (type === "game:over") state.context.gameOver = true;
    expireCardTagsForEvent(type, previousContext, state.context, event);
    expireCardViewsForEvent(type, previousContext, state.context);
    expireRuleStatesForEvent(type, previousContext, state.context);
    expireRuleModifiersForEvent(type, previousContext, state.context);
    expireSkillBindingsForEvent(type, previousContext, state.context);
    expireChoiceSetsForEvent(type, previousContext, state.context);
    const source = normalizeSource(event.source || sourceOf("protocol-game-event", "server-protocol", {
      protocol: event.protocol || "",
      recordIndex: event.recordIndex ?? null
    }), now);
    const eventIndex = state.nextEventIndex;
    const cardId = finiteInteger(event.card?.id ?? event.cardId, 0) || null;
    const tags = uniqueStrings([
      ...(Array.isArray(event.tags) ? event.tags : event.tags ? [event.tags] : []),
      ...(type === "card:use" ? ["used"] : []),
      ...(type === "card:respond" ? ["responded"] : []),
      ...(type === "card:offset" ? ["offset"] : [])
    ]);
    const targetSeats = explicitTargetSeats(event);
    const detail = {
      eventIndex,
      eventType: type,
      protocol: String(event.protocol || ""),
      recordIndex: event.recordIndex ?? null,
      seat: finiteNumber(event.seat),
      casterSeat: finiteNumber(event.casterSeat),
      targetSeats,
      cardId,
      skillId: finiteInteger(event.skillId, 0) || null,
      count: finiteNumber(event.count),
      tags,
      stage: event.stage ?? null,
      context: { ...state.context },
      source
    };
    const causal = observeCausalEvent({
      ...event,
      eventType: type,
      eventIndex,
      cardId,
      tags,
      targetSeats,
      context: detail.context,
      source,
      suppressRecentEvent: true
    });
    detail.causalEventId = causal?.eventId || null;
    if (cardId != null) {
      detail.printedCard = normalizedCardForId(cardId);
      detail.effectiveCard = effectiveCard(cardId, {
        scope: event.scope,
        causalEventId: causal?.eventId || event.causalEventId,
        targetSeat: targetSeats.length === 1 ? targetSeats[0] : event.targetSeat,
        channelKey: event.channelKey || event.channel
      }).effective;
      appendCardEvent(detail);
    }
    recordEvent("game.event", detail);
    if (causalEventIsSettled(causal?.status)) {
      expireRuleModifiersForCausalEvent(causal.eventId);
      expireCardViewsForCausalEvent(causal.eventId);
      expireChoiceSetsForCausalEvent(causal.eventId);
    }
    activateScheduledEffectsForEvent({
      ...event,
      type,
      eventType: type,
      eventIndex,
      causalEventId: causal?.eventId || null,
      targetSeats,
      context: {
        ...state.context,
        ...(event.context || {}),
        turn: event.turn ?? event.context?.turn ?? state.context.turn,
        round: event.round ?? event.context?.round ?? state.context.round,
        phase: event.phase ?? event.context?.phase ?? state.context.phase,
        activeSeat: event.activeSeat ?? event.context?.activeSeat ?? state.context.activeSeat,
        stage: event.stage ?? event.context?.stage ?? state.context.stage
      },
      source
    });
    expireScheduledEffectsForEvent(type, eventIndex);
    return cloneJson(detail);
  }

  function observeCausalEvent(input = {}) {
    const eventType = String(input.eventType || input.type || "protocol").trim() || "protocol";
    const source = normalizeSource(input.source || sourceOf("causal-game-event", "server-protocol", {
      protocol: input.protocol || "",
      recordIndex: input.recordIndex ?? null
    }), now);
    const requestedId = String(input.eventId || input.id || input.protocolEventId || "").trim();
    const recordIndex = nonNegativeIntegerOrNull(input.recordIndex);
    const eventId = requestedId || (recordIndex != null ? `protocol-record:${recordIndex}` : `local:${state.nextCausalEventId++}`);
    const parentEventId = String(input.parentEventId || input.parentId || "").trim();
    if (parentEventId && wouldCreateCausalCycle(eventId, parentEventId)) {
      contradiction("causal-event-cycle", { eventId, parentEventId, source });
      return null;
    }
    const cardIds = uniquePositiveIds([
      ...asList(input.cardIds),
      ...asList(input.subcardIds),
      input.cardId,
      input.card?.id
    ]);
    const targetSeats = uniqueFiniteNumbers(asList(input.targetSeats || input.targets));
    const roles = normalizeCausalRoles(input.roles || input, targetSeats);
    const causeEventIds = uniqueStrings(asList(input.causeEventIds || input.causedByEventIds || input.causedBy));
    const linkedEventIds = uniqueStrings(asList(input.linkedEventIds || input.links));
    const declaredRootEventId = String(input.rootEventId || "").trim();
    const incoming = {
      eventId,
      eventType,
      parentEventId: parentEventId || null,
      declaredRootEventId: declaredRootEventId || null,
      rootEventId: declaredRootEventId || parentEventId || eventId,
      causeEventIds,
      linkedEventIds,
      channelKey: String(input.channelKey || input.channel || "").trim() || null,
      sequenceIndex: nonNegativeIntegerOrNull(input.sequenceIndex ?? input.targetIndex ?? input.order),
      roles,
      targetSeats,
      cardIds,
      skillId: finiteInteger(input.skillId, 0) || null,
      effectiveName: String(input.effectiveName || input.cardName || "").trim() || null,
      status: String(input.status || "").trim() || null,
      outcome: String(input.outcome || input.result || "").trim() || null,
      tags: uniqueStrings(asList(input.tags)),
      context: mergeTurnContext(state.context, input.context || input),
      metadata: cloneJson(input.metadata || {}),
      source,
      firstObservedAt: now(),
      updatedAt: now(),
      revision: 1
    };
    const existing = state.causalEvents[eventId];
    if (!existing) {
      state.causalEvents[eventId] = incoming;
    } else {
      mergeCausalEvent(existing, incoming);
    }
    refreshCausalRoots();
    const current = state.causalEvents[eventId];
    const observation = {
      index: state.nextCausalEventHistoryIndex++,
      eventId,
      eventType,
      parentEventId: parentEventId || null,
      causeEventIds,
      linkedEventIds,
      cardIds,
      targetSeats,
      roles,
      status: incoming.status,
      outcome: incoming.outcome,
      metadata: cloneJson(incoming.metadata),
      context: incoming.context,
      source,
      observedAt: now()
    };
    state.causalEventHistory.push(observation);
    if (input.suppressRecentEvent !== true) {
      recordEvent("causal.event.observed", {
        eventId,
        eventType,
        parentEventId: current.parentEventId,
        rootEventId: current.rootEventId,
        revision: current.revision,
        source
      });
      if (causalEventIsSettled(current.status)) {
        expireRuleModifiersForCausalEvent(current.eventId);
        expireCardViewsForCausalEvent(current.eventId);
        expireChoiceSetsForCausalEvent(current.eventId);
      }
    }
    return cloneJson(current);
  }

  function causalEvent(eventIdValue) {
    const eventId = String(eventIdValue || "").trim();
    return eventId && state.causalEvents[eventId] ? cloneJson(state.causalEvents[eventId]) : null;
  }

  function queryCausalEvents(input = {}) {
    const eventId = String(input.eventId || input.id || "").trim();
    const rootEventId = String(input.rootEventId || "").trim();
    const parentEventId = String(input.parentEventId || "").trim();
    const channelKey = String(input.channelKey || input.channel || "").trim();
    const eventTypes = new Set(uniqueStrings(asList(input.eventTypes || input.eventType)));
    const tags = new Set(uniqueStrings(asList(input.tags || input.tag)));
    const cardId = finiteInteger(input.cardId, 0);
    const skillId = finiteInteger(input.skillId, 0);
    const seat = finiteInteger(input.seat, -1);
    const status = String(input.status || "").trim();
    return Object.values(state.causalEvents).filter((row) => {
      if (eventId && row.eventId !== eventId) return false;
      if (rootEventId && row.rootEventId !== rootEventId) return false;
      if (parentEventId && row.parentEventId !== parentEventId) return false;
      if (channelKey && row.channelKey !== channelKey) return false;
      if (eventTypes.size && !eventTypes.has(row.eventType)) return false;
      if (tags.size && !Array.from(tags).every((tag) => row.tags.includes(tag))) return false;
      if (cardId > 0 && !row.cardIds.includes(cardId)) return false;
      if (skillId > 0 && row.skillId !== skillId) return false;
      if (seat >= 0 && !causalEventSeats(row).includes(seat)) return false;
      if (status && row.status !== status) return false;
      return true;
    }).sort(compareCausalEvents).map(cloneJson);
  }

  function causalLineage(eventIdValue) {
    const eventId = String(eventIdValue || "").trim();
    const current = state.causalEvents[eventId];
    if (!current) return { eventId, current: null, ancestors: [], descendants: [] };
    const ancestors = [];
    const visited = new Set([eventId]);
    let cursor = current.parentEventId;
    while (cursor && state.causalEvents[cursor] && !visited.has(cursor)) {
      visited.add(cursor);
      ancestors.unshift(cloneJson(state.causalEvents[cursor]));
      cursor = state.causalEvents[cursor].parentEventId;
    }
    const descendants = Object.values(state.causalEvents)
      .filter((row) => row.eventId !== eventId && isCausalDescendant(row.eventId, eventId))
      .sort(compareCausalEvents)
      .map(cloneJson);
    return { eventId, current: cloneJson(current), ancestors, descendants };
  }

  function observeCardAction(input = {}) {
    const action = String(input.action || input.actionType || input.cardAction || "use").trim().toLowerCase();
    if (!action) return null;
    const source = normalizeSource(input.source || sourceOf("card-action-binding", "server-protocol", {
      skillId: finiteInteger(input.skillId, 0)
    }), now);
    const requestedIdentityKind = String(input.identityKind || "").trim().toLowerCase();
    const virtualIdentity = input.virtual === true || requestedIdentityKind.startsWith("virtual");
    const mainCardId = finiteInteger(input.mainCardId ?? (virtualIdentity ? null : input.cardId), 0) || null;
    const subcards = normalizeCardActionSubcards(input.subcards || input.materialCards || input.subcardIds, source);
    const costCards = normalizeCardActionSubcards(input.costCards || input.costCardIds, source, "cost");
    const referenceCards = normalizeCardActionSubcards(input.referenceCards || input.referenceCardIds || input.conditionCards, source, "reference");
    const subcardIds = subcards.map((row) => row.cardId);
    const identityKind = normalizeCardIdentityKind(input.identityKind, input.virtual, mainCardId, subcardIds);
    if (identityKind === "physical" && !mainCardId) {
      contradiction("card-action-physical-id-missing", { action, eventId: input.eventId || null, source });
      return null;
    }
    if (identityKind === "virtual-zero-subcard" && subcardIds.length) {
      contradiction("card-action-zero-subcard-conflict", { action, eventId: input.eventId || null, subcardIds, source });
      return null;
    }
    if (identityKind === "virtual-with-subcards" && !subcardIds.length) {
      contradiction("card-action-subcards-missing", { action, eventId: input.eventId || null, source });
      return null;
    }
    const physicalCardIds = uniquePositiveIds([mainCardId, ...subcardIds]);
    const relatedCardIds = uniquePositiveIds([
      ...physicalCardIds,
      ...costCards.map((row) => row.cardId),
      ...referenceCards.map((row) => row.cardId)
    ]);
    const physicalCardGenerations = Object.fromEntries(relatedCardIds.map((cardId) => [cardId, physicalCardGeneration(cardId)]));
    const effectiveIdentity = normalizeCardActionIdentity(input.effectiveIdentity || input.effectiveCard || input.cardName || input.effectiveName);
    const declaredIdentity = normalizeCardActionIdentity(input.declaredIdentity || input.declaredCard || input.declaredName);
    const revealedIdentity = normalizeCardActionIdentity(input.revealedIdentity || input.revealedCard);
    const eventId = String(input.eventId || input.actionId || input.useId || "").trim();
    const binding = {
      action,
      identityKind,
      identityStatus: String(input.identityStatus || "observed"),
      mainCardId,
      mainCardGeneration: mainCardId ? physicalCardGenerations[mainCardId] : null,
      logicalCardToken: stringOrNull(input.logicalCardToken ?? input.virtualCardId ?? input.logicalCardId ?? (virtualIdentity ? input.cardId : null)),
      physicalCardIds,
      physicalCardGenerations,
      subcards,
      costCards,
      referenceCards,
      declaredIdentity,
      revealedIdentity,
      effectiveIdentity,
      providerSeat: finiteNumber(input.providerSeat ?? input.roles?.providerSeat),
      effectiveUserSeat: finiteNumber(input.effectiveUserSeat ?? input.userSeat ?? input.roles?.effectiveUserSeat),
      physicalFlow: cloneJson(input.physicalFlow || input.flow || null),
      visibility: cloneJson(input.visibility || null),
      source
    };
    const existingBinding = eventId ? state.causalEvents[eventId]?.metadata?.cardBinding : null;
    const mergedBinding = mergeCardActionBinding(existingBinding, binding, eventId, source);
    const roles = {
      ...(input.roles || {}),
      providerSeat: binding.providerSeat,
      effectiveUserSeat: binding.effectiveUserSeat
    };
    const eventType = String(input.eventType || (action.includes(":") ? action : `card:${action}`));
    const observed = observeCausalEvent({
      ...input,
      eventId,
      eventType,
      roles,
      cardId: null,
      card: null,
      cardIds: relatedCardIds,
      effectiveName: effectiveIdentity?.name || input.effectiveName,
      metadata: {
        ...(input.metadata || {}),
        cardBinding: mergedBinding
      },
      source
    });
    if (observed) registerDynamicIds(relatedCardIds);
    return observed;
  }

  function cardAction(eventIdValue) {
    const event = causalEvent(eventIdValue);
    if (!event?.metadata?.cardBinding) return null;
    return { event, binding: cloneJson(event.metadata.cardBinding) };
  }

  function queryCardActions(input = {}) {
    const identityKind = String(input.identityKind || "").trim();
    const effectiveName = String(input.effectiveName || input.cardName || "").trim();
    const providerSeat = finiteInteger(input.providerSeat, -1);
    const effectiveUserSeat = finiteInteger(input.effectiveUserSeat ?? input.userSeat, -1);
    return queryCausalEvents(input).filter((event) => {
      const binding = event.metadata?.cardBinding;
      if (!binding) return false;
      if (identityKind && binding.identityKind !== identityKind) return false;
      if (effectiveName && binding.effectiveIdentity?.name !== effectiveName) return false;
      if (providerSeat >= 0 && binding.providerSeat !== providerSeat) return false;
      if (effectiveUserSeat >= 0 && binding.effectiveUserSeat !== effectiveUserSeat) return false;
      return true;
    }).map((event) => ({ event, binding: cloneJson(event.metadata.cardBinding) }));
  }

  function cardActionMaterials(eventIdValue, options = {}) {
    const action = cardAction(eventIdValue);
    if (!action) return null;
    const includeMain = options.includeMain !== false;
    const includeSubcards = options.includeSubcards !== false;
    const includeCostCards = options.includeCostCards === true;
    const includeReferenceCards = options.includeReferenceCards === true || options.includeReferences === true;
    const requestedZone = normalizeZoneKey(options.zoneKey || options.zone);
    const rows = [];
    if (includeMain && action.binding.mainCardId) {
      rows.push({
        cardId: action.binding.mainCardId,
        physicalGeneration: action.binding.mainCardGeneration
          || action.binding.physicalCardGenerations?.[action.binding.mainCardId]
          || 1,
        role: "main",
        fromZone: null,
        providerSeat: action.binding.providerSeat ?? null
      });
    }
    if (includeSubcards) rows.push(...(action.binding.subcards || []).map(cloneJson));
    if (includeCostCards) rows.push(...(action.binding.costCards || []).map(cloneJson));
    if (includeReferenceCards) rows.push(...(action.binding.referenceCards || []).map(cloneJson));
    const uniqueRows = [];
    for (const row of rows) {
      if (!uniqueRows.some((item) => item.cardId === row.cardId)) uniqueRows.push(row);
    }
    const materials = uniqueRows.map((row) => {
      const expectedGeneration = positiveIntegerOrNull(row.physicalGeneration)
        || positiveIntegerOrNull(action.binding.physicalCardGenerations?.[row.cardId])
        || 1;
      const currentGeneration = physicalCardGeneration(row.cardId);
      const samePhysicalGeneration = expectedGeneration === currentGeneration;
      const currentLocation = state.locations[row.cardId] ? cloneJson(state.locations[row.cardId]) : null;
      const location = samePhysicalGeneration ? currentLocation : null;
      const groups = samePhysicalGeneration ? activeLocationGroups({ cardId: row.cardId }) : [];
      const possibleZoneKeys = location
        ? [location.zoneKey]
        : uniqueStrings(groups.flatMap((group) => group.zoneKeys));
      return {
        ...cloneJson(row),
        physicalGeneration: expectedGeneration,
        currentPhysicalGeneration: currentGeneration,
        samePhysicalGeneration,
        printedCard: normalizedCardForId(row.cardId),
        location,
        currentLocation,
        possibleZoneKeys,
        locationGroupKeys: groups.map((group) => group.key),
        exactLocationKnown: !!location,
        inRequestedZone: requestedZone ? location?.zoneKey === requestedZone : null
      };
    });
    const exactZoneKeys = uniqueStrings(materials.map((row) => row.location?.zoneKey).filter(Boolean));
    const missingLocationCardIds = materials.filter((row) => !row.location).map((row) => row.cardId);
    const staleGenerationCardIds = materials.filter((row) => !row.samePhysicalGeneration).map((row) => row.cardId);
    const outsideRequestedZoneCardIds = requestedZone
      ? materials.filter((row) => row.location?.zoneKey && row.location.zoneKey !== requestedZone).map((row) => row.cardId)
      : [];
    const unresolvedForRequestedZoneCardIds = requestedZone
      ? materials.filter((row) => !row.location).map((row) => row.cardId)
      : [];
    return {
      eventId: action.event.eventId,
      action: action.binding.action,
      identityKind: action.binding.identityKind,
      effectiveIdentity: cloneJson(action.binding.effectiveIdentity),
      requestedZone: requestedZone || null,
      materialCount: materials.length,
      cardIds: materials.map((row) => row.cardId),
      materials,
      allExactLocationsKnown: missingLocationCardIds.length === 0,
      allInSameExactZone: materials.length > 0 && missingLocationCardIds.length === 0 && exactZoneKeys.length === 1,
      exactZoneKey: materials.length > 0 && missingLocationCardIds.length === 0 && exactZoneKeys.length === 1 ? exactZoneKeys[0] : null,
      allInRequestedZone: requestedZone
        ? materials.length > 0 && outsideRequestedZoneCardIds.length === 0 && unresolvedForRequestedZoneCardIds.length === 0
        : null,
      missingLocationCardIds,
      staleGenerationCardIds,
      outsideRequestedZoneCardIds,
      unresolvedForRequestedZoneCardIds
    };
  }

  function moveCardActionMaterials(input = {}) {
    const eventId = String(input.eventId || input.actionId || input.useId || "").trim();
    const to = normalizeZoneKey(input.to || input.destination);
    if (!eventId || !to) return { applied: false, reason: "event-id-and-destination-required" };
    const materialState = cardActionMaterials(eventId, {
      includeMain: input.includeMain !== false,
      includeSubcards: input.includeSubcards !== false,
      includeCostCards: input.includeCostCards === true,
      includeReferenceCards: input.includeReferenceCards === true || input.includeReferences === true,
      zone: input.from || input.sourceZone
    });
    if (!materialState) return { applied: false, reason: "card-action-not-found" };
    if (!materialState.materialCount) return { applied: false, reason: "card-action-has-no-physical-materials" };
    if (materialState.staleGenerationCardIds.length) {
      return {
        applied: false,
        reason: "card-action-material-generation-changed",
        cardIds: materialState.staleGenerationCardIds
      };
    }
    const requestedFrom = normalizeZoneKey(input.from || input.sourceZone);
    const from = requestedFrom || materialState.exactZoneKey;
    if (!from) return { applied: false, reason: "material-source-zone-not-proven" };
    if (!materialState.allExactLocationsKnown) {
      return {
        applied: false,
        reason: "material-locations-not-fully-proven",
        cardIds: materialState.missingLocationCardIds
      };
    }
    const misplaced = materialState.materials
      .filter((row) => row.location?.zoneKey !== from)
      .map((row) => row.cardId);
    if (misplaced.length) {
      return { applied: false, reason: "not-all-materials-in-source-zone", cardIds: misplaced };
    }
    if (from === to) return { applied: false, reason: "source-and-destination-must-differ" };
    const source = input.sourceEvidence || input.evidence || sourceOf("card-action-material-group-move", "rule-feedback", {
      eventId,
      skillId: finiteInteger(input.skillId, 0) || null
    });
    const causalEventId = stringOrNull(input.causalEventId) || eventId;
    const reasonTags = uniqueStrings(["parent-material-group", `parent-event:${eventId}`, ...asList(input.reasonTags)]);
    const move = observeMove({
      from,
      to,
      count: materialState.materialCount,
      cardIds: materialState.cardIds,
      context: input.context,
      causalEventId,
      movementReason: input.movementReason || input.reasonKind || "gain",
      reasonTags,
      moveType: input.moveType,
      skillId: input.skillId,
      protocol: input.protocol,
      source,
      visibility: input.visibility,
      reason: input.reason || "resolved-card-action-material-group-move"
    });
    recordEvent("card.action.materials.move", {
      eventId,
      causalEventId,
      from,
      to,
      cardIds: materialState.cardIds,
      source: normalizeSource(source, now)
    });
    return { applied: true, eventId, causalEventId, from, to, cardIds: materialState.cardIds, move };
  }

  function normalizeCardActionSubcards(value, source, defaultRole = "material") {
    const rows = [];
    for (const item of asList(value)) {
      const cardId = finiteInteger(typeof item === "object" ? item?.cardId ?? item?.id : item, 0);
      if (cardId <= 0 || rows.some((row) => row.cardId === cardId)) continue;
      rows.push({
        cardId,
        physicalGeneration: positiveIntegerOrNull(typeof item === "object" ? item?.physicalGeneration ?? item?.generation : null)
          || physicalCardGeneration(cardId),
        role: String(typeof item === "object" ? item?.role || defaultRole : defaultRole),
        fromZone: normalizeZoneKey(typeof item === "object" ? item?.fromZone || item?.from : "") || null,
        providerSeat: finiteNumber(typeof item === "object" ? item?.providerSeat : null),
        printedCard: normalizedCardForId(cardId),
        source: normalizeSource(typeof item === "object" ? item?.source || source : source, now)
      });
    }
    return rows;
  }

  function normalizeCardActionIdentity(value) {
    if (value == null || value === "") return null;
    const input = typeof value === "string" ? { name: value } : value;
    const result = {};
    for (const field of ["name", "type", "subtype", "color", "suit", "number", "spellId", "nature", "isDamageCard", "isDelayedTrick", "isOrdinaryTrick", "equipSubtype", "spellClass"]) {
      if (input?.[field] == null) continue;
      result[field] = ["nature"].includes(field) ? String(input[field]) : normalizePredicateValue(field, input[field]);
    }
    return Object.keys(result).length ? result : null;
  }

  function mergeCardActionBinding(existing, incoming, eventId, source) {
    if (!existing) return incoming;
    const result = cloneJson(existing);
    if (result.identityKind === "unknown" && incoming.identityKind !== "unknown") {
      result.identityKind = incoming.identityKind;
    } else if (result.identityKind && incoming.identityKind && incoming.identityKind !== "unknown" && result.identityKind !== incoming.identityKind) {
      contradiction("card-action-identity-kind-conflict", {
        eventId,
        previous: result.identityKind,
        observed: incoming.identityKind,
        source
      });
    } else if (!result.identityKind) {
      result.identityKind = incoming.identityKind;
    }
    result.action = incoming.action || result.action;
    result.identityStatus = incoming.identityStatus || result.identityStatus;
    result.mainCardId = incoming.mainCardId || result.mainCardId || null;
    if (result.mainCardGeneration != null && incoming.mainCardGeneration != null
      && result.mainCardGeneration !== incoming.mainCardGeneration) {
      contradiction("card-action-main-generation-conflict", {
        eventId,
        cardId: result.mainCardId,
        previous: result.mainCardGeneration,
        observed: incoming.mainCardGeneration,
        source
      });
    } else if (result.mainCardGeneration == null) {
      result.mainCardGeneration = incoming.mainCardGeneration || null;
    }
    result.logicalCardToken = incoming.logicalCardToken || result.logicalCardToken || null;
    result.physicalCardIds = uniquePositiveIds([...(result.physicalCardIds || []), ...incoming.physicalCardIds]);
    result.physicalCardGenerations ||= {};
    for (const [cardId, generation] of Object.entries(incoming.physicalCardGenerations || {})) {
      if (result.physicalCardGenerations[cardId] != null && result.physicalCardGenerations[cardId] !== generation) {
        contradiction("card-action-physical-generation-conflict", {
          eventId,
          cardId: Number(cardId),
          previous: result.physicalCardGenerations[cardId],
          observed: generation,
          source
        });
        continue;
      }
      result.physicalCardGenerations[cardId] = generation;
    }
    result.subcards = mergeCardActionRows(result.subcards, incoming.subcards, eventId, "subcard", source);
    result.costCards = mergeCardActionRows(result.costCards, incoming.costCards, eventId, "cost-card", source);
    result.referenceCards = mergeCardActionRows(result.referenceCards, incoming.referenceCards, eventId, "reference-card", source);
    result.declaredIdentity = incoming.declaredIdentity || result.declaredIdentity || null;
    result.revealedIdentity = incoming.revealedIdentity || result.revealedIdentity || null;
    result.effectiveIdentity = incoming.effectiveIdentity || result.effectiveIdentity || null;
    result.providerSeat = incoming.providerSeat ?? result.providerSeat ?? null;
    result.effectiveUserSeat = incoming.effectiveUserSeat ?? result.effectiveUserSeat ?? null;
    result.physicalFlow = incoming.physicalFlow || result.physicalFlow || null;
    result.visibility = incoming.visibility || result.visibility || null;
    result.source = source;
    return result;
  }

  function mergeCardActionRows(previousRows = [], incomingRows = [], eventId = "", label = "card", source = null) {
    const rows = previousRows.map(cloneJson);
    for (const incoming of incomingRows || []) {
      const current = rows.find((row) => row.cardId === incoming.cardId);
      if (!current) {
        rows.push(cloneJson(incoming));
        continue;
      }
      if (current.role !== incoming.role || current.fromZone && incoming.fromZone && current.fromZone !== incoming.fromZone) {
        contradiction("card-action-binding-conflict", { eventId, label, cardId: incoming.cardId, previous: current, observed: incoming, source });
      }
    }
    return rows;
  }

  function observeComparison(input = {}) {
    const kind = String(input.kind || input.comparisonKind || "pindian").trim().toLowerCase() || "pindian";
    const source = normalizeSource(input.source || sourceOf("comparison-observation", "server-protocol", {
      skillId: finiteInteger(input.skillId, 0)
    }), now);
    const requestedId = String(input.comparisonId || input.eventId || input.id || "").trim();
    const recordIndex = nonNegativeIntegerOrNull(input.recordIndex);
    const comparisonId = requestedId || (recordIndex != null ? `comparison-record:${recordIndex}` : `comparison-local:${state.nextComparisonId++}`);
    const initiatorInput = typeof input.initiator === "object"
      ? input.initiator
      : {
        seat: input.initiatorSeat ?? input.userSeat ?? input.fromSeat,
        cardId: input.initiatorCardId ?? input.userCardId ?? input.fromCardId,
        printedNumber: input.initiatorPrintedNumber,
        effectiveNumber: input.initiatorEffectiveNumber,
        outcome: input.initiatorOutcome
      };
    const initiator = normalizeComparisonSide(initiatorInput, "initiator", 0, source);
    if (initiator.seat == null && initiator.cardId == null) {
      contradiction("comparison-initiator-missing", { comparisonId, kind, source });
      return null;
    }
    const opponents = asList(input.opponents || input.participants || input.targets)
      .filter((item) => String(item?.role || "opponent").toLowerCase() !== "initiator")
      .map((item, index) => normalizeComparisonSide(item, "opponent", index, source))
      .filter((row) => row.seat != null || row.cardId != null);
    const incoming = {
      comparisonId,
      kind,
      parentEventId: stringOrNull(input.parentEventId),
      channelKey: stringOrNull(input.channelKey || input.channel),
      sequenceIndex: nonNegativeIntegerOrNull(input.sequenceIndex ?? input.order),
      skillId: finiteInteger(input.skillId, 0) || null,
      initiator,
      opponents,
      status: String(input.status || input.stage || "observed").trim() || "observed",
      outcome: String(input.outcome || input.result || "").trim() || null,
      sharedInitiatorCard: input.sharedInitiatorCard == null ? opponents.length > 1 && initiator.cardId != null : input.sharedInitiatorCard === true,
      context: mergeTurnContext(state.context, input.context || input),
      metadata: cloneJson(input.metadata || {}),
      source,
      createdAt: now(),
      updatedAt: now(),
      revision: 1
    };
    const current = state.comparisons[comparisonId];
    if (!current) {
      state.comparisons[comparisonId] = incoming;
    } else {
      mergeComparison(current, incoming, source);
    }
    const row = state.comparisons[comparisonId];
    validateComparisonCards(row, source);
    const physicalCardIds = uniquePositiveIds([
      row.initiator.cardId,
      ...row.opponents.map((item) => item.cardId)
    ]);
    observeCausalEvent({
      eventId: comparisonId,
      eventType: kind,
      parentEventId: row.parentEventId,
      channelKey: row.channelKey,
      sequenceIndex: row.sequenceIndex,
      roles: { initiatorSeat: row.initiator.seat },
      targetSeats: row.opponents.map((item) => item.seat).filter((seat) => seat != null),
      cardIds: physicalCardIds,
      skillId: row.skillId,
      status: row.status,
      outcome: row.outcome,
      context: row.context,
      metadata: { comparisonId, comparisonKind: kind },
      source,
      suppressRecentEvent: true
    });
    const observation = {
      index: state.nextComparisonHistoryIndex++,
      comparisonId,
      kind,
      revision: row.revision,
      initiator: cloneJson(initiator),
      opponents: opponents.map(cloneJson),
      status: incoming.status,
      outcome: incoming.outcome,
      context: incoming.context,
      source,
      observedAt: now()
    };
    state.comparisonHistory.push(observation);
    recordEvent("comparison.observed", {
      comparisonId,
      kind,
      revision: row.revision,
      initiatorSeat: row.initiator.seat,
      opponentSeats: row.opponents.map((item) => item.seat),
      physicalCardIds,
      status: row.status,
      source
    });
    return cloneJson(row);
  }

  function comparison(comparisonIdValue) {
    const comparisonId = String(comparisonIdValue || "").trim();
    return comparisonId && state.comparisons[comparisonId] ? cloneJson(state.comparisons[comparisonId]) : null;
  }

  function queryComparisons(input = {}) {
    const comparisonId = String(input.comparisonId || input.eventId || input.id || "").trim();
    const kind = String(input.kind || input.comparisonKind || "").trim().toLowerCase();
    const status = String(input.status || input.stage || "").trim();
    const skillId = finiteInteger(input.skillId, 0);
    const seat = finiteInteger(input.seat, -1);
    const cardId = finiteInteger(input.cardId, 0);
    const turn = finiteNumber(input.turn);
    const round = finiteNumber(input.round);
    return Object.values(state.comparisons).filter((row) => {
      if (comparisonId && row.comparisonId !== comparisonId) return false;
      if (kind && row.kind !== kind) return false;
      if (status && row.status !== status) return false;
      if (skillId > 0 && row.skillId !== skillId) return false;
      if (seat >= 0 && row.initiator.seat !== seat && !row.opponents.some((item) => item.seat === seat)) return false;
      if (cardId > 0 && row.initiator.cardId !== cardId && !row.opponents.some((item) => item.cardId === cardId)) return false;
      if (turn != null && row.context?.turn !== turn) return false;
      if (round != null && row.context?.round !== round) return false;
      return true;
    }).sort((left, right) => (left.sequenceIndex ?? Number.MAX_SAFE_INTEGER) - (right.sequenceIndex ?? Number.MAX_SAFE_INTEGER) || left.createdAt - right.createdAt).map(cloneJson);
  }

  function swapComparisonAssignments(input = {}) {
    const comparisonId = String(input.comparisonId || input.eventId || input.id || "").trim();
    const row = state.comparisons[comparisonId];
    if (!row) return { applied: false, reason: "comparison-not-found" };
    if (row.opponents.length !== 1) {
      return { applied: false, reason: "single-opponent-comparison-required-for-assignment-swap" };
    }
    const opponentSeat = finiteInteger(input.opponentSeat ?? input.targetSeat, -1);
    const opponentIndex = nonNegativeIntegerOrNull(input.opponentIndex ?? input.index);
    const opponent = opponentSeat >= 0
      ? row.opponents.find((item) => item.seat === opponentSeat)
      : opponentIndex != null
        ? row.opponents[opponentIndex]
        : row.opponents.length === 1
          ? row.opponents[0]
          : null;
    if (!opponent) return { applied: false, reason: "exact-opponent-required" };
    const statusRank = comparisonStatusRank(row.status);
    const hasResolvedValues = [row.initiator, opponent].some((side) =>
      side.effectiveNumber != null || side.winnerSeat != null || side.tie != null || side.outcome != null
    );
    if (statusRank >= comparisonStatusRank("revealed") || hasResolvedValues) {
      return { applied: false, reason: "comparison-assignment-already-revealed-or-resolved" };
    }
    const initiatorCardId = finiteInteger(row.initiator.cardId, 0);
    const opponentCardId = finiteInteger(opponent.cardId, 0);
    if (initiatorCardId > 0 && opponentCardId > 0 && initiatorCardId === opponentCardId) {
      return { applied: false, reason: "committed-card-ids-must-be-distinct" };
    }
    const initiatorLocation = state.locations[initiatorCardId]?.zoneKey || null;
    const opponentLocation = state.locations[opponentCardId]?.zoneKey || null;
    if (initiatorLocation && opponentLocation && initiatorLocation !== opponentLocation) {
      contradiction("comparison-assignment-swap-location-mismatch", {
        comparisonId,
        initiatorCardId,
        initiatorLocation,
        opponentCardId,
        opponentLocation
      });
      return { applied: false, reason: "committed-cards-must-share-process-zone" };
    }
    const source = normalizeSource(input.source || sourceOf("comparison-assignment-swap", "rule-feedback", {
      skillId: finiteInteger(input.skillId ?? row.skillId, 0) || null
    }), now);
    const before = {
      initiator: cloneJson(row.initiator),
      opponent: cloneJson(opponent)
    };
    const assignmentFields = ["cardId", "printedNumber", "reportedNumber", "effectiveNumber"];
    for (const field of assignmentFields) {
      const value = row.initiator[field];
      row.initiator[field] = opponent[field];
      opponent[field] = value;
    }
    row.initiator.source = source;
    opponent.source = source;
    row.assignmentHistory ||= [];
    const assignment = {
      index: row.assignmentHistory.length,
      operation: "swap",
      initiatorSeat: row.initiator.seat,
      opponentSeat: opponent.seat,
      before,
      after: {
        initiator: cloneJson(row.initiator),
        opponent: cloneJson(opponent)
      },
      physicalMovement: false,
      source,
      eventIndex: state.nextEventIndex,
      time: now()
    };
    row.assignmentHistory.push(assignment);
    row.revision = positiveInteger(row.revision, 1) + 1;
    row.updatedAt = now();
    row.source = source;
    state.comparisonHistory.push({
      index: state.nextComparisonHistoryIndex++,
      comparisonId,
      kind: row.kind,
      revision: row.revision,
      operation: "assignment-swap",
      initiator: cloneJson(row.initiator),
      opponents: row.opponents.map(cloneJson),
      status: row.status,
      outcome: row.outcome,
      context: cloneJson(row.context),
      source,
      observedAt: now()
    });
    recordEvent("comparison.assignment.swap", {
      comparisonId,
      initiatorSeat: row.initiator.seat,
      opponentSeat: opponent.seat,
      beforeCardIds: uniquePositiveIds([initiatorCardId, opponentCardId]),
      afterCardIds: uniquePositiveIds([row.initiator.cardId, opponent.cardId]),
      physicalMovement: false,
      source
    });
    return { applied: true, comparison: cloneJson(row), assignment: cloneJson(assignment) };
  }

  function normalizeComparisonSide(value, role, index, source) {
    const item = value && typeof value === "object" ? value : { cardId: value };
    const seat = finiteInteger(item.seat ?? item.seatIndex ?? item.playerSeat ?? item.userSeat, -1);
    const cardId = finiteInteger(item.cardId ?? item.id, 0);
    const sequenceIndex = nonNegativeIntegerOrNull(item.sequenceIndex ?? item.order ?? index);
    const printed = cardId > 0 ? normalizedCardForId(cardId) : null;
    const catalogPrintedNumber = finiteNumber(printed?.number);
    const observedPrintedNumber = finiteNumber(item.printedNumber);
    if (catalogPrintedNumber != null && observedPrintedNumber != null && catalogPrintedNumber !== observedPrintedNumber) {
      contradiction("comparison-printed-number-conflicts-catalog", {
        cardId,
        catalogPrintedNumber,
        observedPrintedNumber,
        source
      });
    }
    return {
      key: String(item.key || item.participantId || `${role}:seat:${seat >= 0 ? seat : "?"}:sequence:${sequenceIndex ?? index}`),
      role,
      seat: seat >= 0 ? seat : null,
      cardId: cardId > 0 ? cardId : null,
      printedNumber: catalogPrintedNumber ?? observedPrintedNumber,
      reportedNumber: finiteNumber(item.reportedNumber ?? item.number),
      effectiveNumber: finiteNumber(item.effectiveNumber),
      winnerSeat: finiteInteger(item.winnerSeat, -1) >= 0 ? finiteInteger(item.winnerSeat, -1) : null,
      tie: item.tie == null ? null : item.tie === true,
      outcome: String(item.outcome || item.result || "").trim() || null,
      sequenceIndex,
      metadata: cloneJson(item.metadata || {}),
      source: normalizeSource(item.source || source, now)
    };
  }

  function mergeComparison(existing, incoming, source) {
    for (const field of ["kind", "parentEventId", "channelKey", "sequenceIndex", "skillId"]) {
      const next = incoming[field];
      if (next == null || next === "") continue;
      if (existing[field] == null || existing[field] === "") existing[field] = next;
      else if (String(existing[field]) !== String(next)) {
        contradiction("comparison-field-conflict", { comparisonId: existing.comparisonId, field, previous: existing[field], observed: next, source });
      }
    }
    existing.initiator = mergeComparisonSide(existing.initiator, incoming.initiator, existing.comparisonId, source);
    for (const side of incoming.opponents) {
      const current = existing.opponents.find((item) => item.key === side.key) ||
        existing.opponents.find((item) => item.seat != null && item.seat === side.seat && item.sequenceIndex === side.sequenceIndex);
      if (current) mergeComparisonSide(current, side, existing.comparisonId, source);
      else existing.opponents.push(cloneJson(side));
    }
    if (incoming.status) {
      const previousRank = comparisonStatusRank(existing.status);
      const incomingRank = comparisonStatusRank(incoming.status);
      if (previousRank >= 0 && incomingRank >= 0 && incomingRank < previousRank) {
        contradiction("comparison-status-regression", {
          comparisonId: existing.comparisonId,
          previous: existing.status,
          observed: incoming.status,
          source
        });
      } else {
        existing.status = incoming.status;
      }
    }
    if (incoming.outcome != null) {
      if (existing.outcome != null && existing.outcome !== incoming.outcome) {
        contradiction("comparison-outcome-conflict", {
          comparisonId: existing.comparisonId,
          previous: existing.outcome,
          observed: incoming.outcome,
          source
        });
        if ((incoming.source?.authority || 0) > (existing.source?.authority || 0)) existing.outcome = incoming.outcome;
      } else {
        existing.outcome = incoming.outcome;
      }
    }
    existing.sharedInitiatorCard = existing.sharedInitiatorCard || incoming.sharedInitiatorCard;
    existing.context = mergeTurnContext(existing.context, incoming.context);
    existing.metadata = { ...(existing.metadata || {}), ...(incoming.metadata || {}) };
    if ((incoming.source?.authority || 0) >= (existing.source?.authority || 0)) existing.source = incoming.source;
    existing.updatedAt = now();
    existing.revision = positiveInteger(existing.revision, 1) + 1;
  }

  function mergeComparisonSide(existing, incoming, comparisonId, source) {
    if (!existing) return cloneJson(incoming);
    for (const field of ["seat", "cardId", "printedNumber", "reportedNumber", "effectiveNumber", "winnerSeat", "tie", "outcome", "sequenceIndex"]) {
      const next = incoming[field];
      if (next == null || next === "") continue;
      if (existing[field] == null || existing[field] === "") existing[field] = next;
      else if (String(existing[field]) !== String(next)) {
        contradiction("comparison-side-conflict", {
          comparisonId,
          participantKey: existing.key,
          field,
          previous: existing[field],
          observed: next,
          source
        });
        if ((incoming.source?.authority || 0) > (existing.source?.authority || 0)) existing[field] = next;
      }
    }
    existing.metadata = { ...(existing.metadata || {}), ...(incoming.metadata || {}) };
    if ((incoming.source?.authority || 0) >= (existing.source?.authority || 0)) existing.source = incoming.source;
    return existing;
  }

  function validateComparisonCards(row, source) {
    const cards = [];
    if (row.initiator.cardId) cards.push({ role: "initiator", seat: row.initiator.seat, cardId: row.initiator.cardId });
    for (const side of row.opponents) {
      if (side.cardId) cards.push({ role: "opponent", seat: side.seat, cardId: side.cardId });
    }
    const byCard = new Map();
    for (const side of cards) {
      const previous = byCard.get(side.cardId);
      if (previous && (previous.role !== side.role || previous.seat !== side.seat)) {
        contradiction("comparison-physical-card-reused-by-distinct-sides", {
          comparisonId: row.comparisonId,
          cardId: side.cardId,
          previous,
          observed: side,
          source
        });
      } else {
        byCard.set(side.cardId, side);
      }
    }
  }

  function mergeCausalEvent(existing, incoming) {
    const scalarFields = ["eventType", "parentEventId", "declaredRootEventId", "channelKey", "sequenceIndex", "skillId", "effectiveName"];
    for (const field of scalarFields) {
      const next = incoming[field];
      if (next == null || next === "") continue;
      const previous = existing[field];
      if (previous == null || previous === "" || previous === "protocol" && field === "eventType") {
        existing[field] = next;
      } else if (String(previous) !== String(next)) {
        contradiction("causal-event-field-conflict", { eventId: existing.eventId, field, previous, observed: next, source: incoming.source });
        if ((incoming.source?.authority || 0) > (existing.source?.authority || 0)) existing[field] = next;
      }
    }
    existing.causeEventIds = uniqueStrings([...(existing.causeEventIds || []), ...incoming.causeEventIds]);
    existing.linkedEventIds = uniqueStrings([...(existing.linkedEventIds || []), ...incoming.linkedEventIds]);
    existing.cardIds = uniquePositiveIds([...(existing.cardIds || []), ...incoming.cardIds]);
    existing.targetSeats = uniqueFiniteNumbers([...(existing.targetSeats || []), ...incoming.targetSeats]);
    existing.tags = uniqueStrings([...(existing.tags || []), ...incoming.tags]);
    existing.roles = mergeCausalRoles(existing.roles, incoming.roles, existing.eventId, incoming.source);
    existing.context = mergeTurnContext(existing.context, incoming.context);
    existing.metadata = { ...(existing.metadata || {}), ...(incoming.metadata || {}) };
    if (incoming.status != null) existing.status = incoming.status;
    if (incoming.outcome != null) existing.outcome = incoming.outcome;
    if ((incoming.source?.authority || 0) >= (existing.source?.authority || 0)) existing.source = incoming.source;
    existing.updatedAt = now();
    existing.revision = positiveInteger(existing.revision, 1) + 1;
  }

  function mergeCausalRoles(existing = {}, incoming = {}, eventId = "", source = null) {
    const result = { ...existing };
    for (const [role, seat] of Object.entries(incoming)) {
      if (seat == null) continue;
      if (result[role] != null && result[role] !== seat) {
        contradiction("causal-event-role-conflict", { eventId, role, previous: result[role], observed: seat, source });
        continue;
      }
      result[role] = seat;
    }
    return result;
  }

  function wouldCreateCausalCycle(eventId, parentEventId) {
    if (!parentEventId) return false;
    if (eventId === parentEventId) return true;
    const visited = new Set();
    let cursor = parentEventId;
    while (cursor && !visited.has(cursor)) {
      if (cursor === eventId) return true;
      visited.add(cursor);
      cursor = state.causalEvents[cursor]?.parentEventId || null;
    }
    return false;
  }

  function refreshCausalRoots() {
    for (const row of Object.values(state.causalEvents)) {
      row.rootEventId = resolveCausalRoot(row);
    }
  }

  function resolveCausalRoot(row) {
    if (row.declaredRootEventId) return row.declaredRootEventId;
    const visited = new Set([row.eventId]);
    let root = row.eventId;
    let cursor = row.parentEventId;
    while (cursor && !visited.has(cursor)) {
      root = cursor;
      visited.add(cursor);
      cursor = state.causalEvents[cursor]?.parentEventId || null;
    }
    return root;
  }

  function isCausalDescendant(eventId, ancestorEventId) {
    const visited = new Set();
    let cursor = state.causalEvents[eventId]?.parentEventId || null;
    while (cursor && !visited.has(cursor)) {
      if (cursor === ancestorEventId) return true;
      visited.add(cursor);
      cursor = state.causalEvents[cursor]?.parentEventId || null;
    }
    return false;
  }

  function cardEvents(input = {}) {
    const cardId = finiteInteger(input.cardId ?? input.id, 0);
    const eventTypes = new Set(uniqueStrings(input.eventTypes || (input.eventType ? [input.eventType] : [])));
    const tags = new Set(uniqueStrings(input.tags || (input.tag ? [input.tag] : [])));
    const turn = finiteNumber(input.turn);
    const round = finiteNumber(input.round);
    const phase = finiteNumber(input.phase);
    const from = input.from ? normalizeZoneKey(input.from) : "";
    const to = input.to ? normalizeZoneKey(input.to) : "";
    const causalEventId = String(input.causalEventId || input.gameEventId || "").trim();
    const movementReasons = new Set(uniqueStrings(asList(input.movementReasons || input.movementReason)));
    const moveType = input.moveType == null ? null : finiteNumber(input.moveType);
    const predicate = normalizePredicate(input.predicate || {});
    const hasPredicate = Object.keys(predicate).length > 0;
    const predicateExecutable = !hasPredicate || predicateIsExecutable(predicate);
    if (!predicateExecutable) return [];
    return state.cardEventHistory.filter((row) => {
      if (cardId > 0 && row.cardId !== cardId) return false;
      if (eventTypes.size && !eventTypes.has(row.eventType)) return false;
      if (tags.size && !Array.from(tags).every((tag) => row.tags.includes(tag))) return false;
      if (turn != null && row.context?.turn !== turn) return false;
      if (round != null && row.context?.round !== round) return false;
      if (phase != null && row.context?.phase !== phase) return false;
      if (from && row.from !== from) return false;
      if (to && row.to !== to) return false;
      if (causalEventId && row.causalEventId !== causalEventId && row.context?.causalEventId !== causalEventId) return false;
      if (movementReasons.size && !movementReasons.has(row.movementReason)) return false;
      if (moveType != null && row.moveType !== moveType) return false;
      if (hasPredicate && !matchesPredicate(input.attributeView === "printed" ? row.printedCard : row.effectiveCard, predicate, row.cardId)) return false;
      return true;
    }).map(cloneJson);
  }

  function movements(input = {}) {
    const movementId = String(input.movementId || input.id || "").trim();
    const movementGroupId = String(input.movementGroupId || input.groupId || input.batchId || "").trim();
    const causalEventId = String(input.causalEventId || input.eventId || "").trim();
    const from = input.from ? normalizeZoneKey(input.from) : "";
    const to = input.to ? normalizeZoneKey(input.to) : "";
    const cardId = finiteInteger(input.cardId, 0);
    const skillId = finiteInteger(input.skillId, 0);
    const turn = finiteNumber(input.turn);
    const round = finiteNumber(input.round);
    const phase = finiteNumber(input.phase);
    return state.movementHistory.filter((row) => {
      if (movementId && row.movementId !== movementId) return false;
      if (movementGroupId && row.movementGroupId !== movementGroupId) return false;
      if (causalEventId && row.causalEventId !== causalEventId) return false;
      if (from && row.from !== from) return false;
      if (to && row.to !== to) return false;
      if (cardId > 0 && !row.cardIds.includes(cardId)) return false;
      if (skillId > 0 && row.skillId !== skillId) return false;
      if (turn != null && row.context?.turn !== turn) return false;
      if (round != null && row.context?.round !== round) return false;
      if (phase != null && row.context?.phase !== phase) return false;
      return true;
    }).sort(compareMovements).map(cloneJson);
  }

  function observeMovementAttempt(input = {}) {
    const attemptId = String(input.attemptId || input.movementAttemptId || input.id || `movement-attempt:${state.nextMovementAttemptId++}`).trim();
    if (!attemptId) return null;
    const existing = state.movementAttempts[attemptId] || null;
    const source = normalizeSource(input.source || sourceOf("movement-attempt", "server-protocol"), now);
    const before = existing ? cloneJson(existing) : null;
    const row = existing || {
      attemptId,
      from: "",
      to: "",
      count: 0,
      cardIds: [],
      unknownCount: 0,
      actorSeat: null,
      targetSeat: null,
      actionType: null,
      status: "pending",
      prevented: false,
      preventionSkillId: null,
      preventionReason: null,
      movementApplied: false,
      movementId: null,
      causalEventId: null,
      metadata: {},
      context: mergeTurnContext(state.context, input.context),
      source,
      createdAt: now(),
      updatedAt: now()
    };
    if (input.from != null || input.sourceZone != null) row.from = normalizeZoneKey(input.from || input.sourceZone);
    if (input.to != null || input.destination != null) row.to = normalizeZoneKey(input.to || input.destination);
    const idsObserved = input.cardIds != null || input.cards != null;
    if (idsObserved) row.cardIds = uniquePositiveIds(input.cardIds || input.cards);
    const count = nonNegativeIntegerOrNull(input.count);
    if (count != null || idsObserved) row.count = Math.max(count ?? row.cardIds.length, row.cardIds.length);
    row.unknownCount = Math.max(0, Number(row.count || 0) - row.cardIds.length);
    for (const [field, value] of [
      ["actorSeat", finiteInteger(input.actorSeat ?? input.srcSeat, -1)],
      ["targetSeat", finiteInteger(input.targetSeat ?? input.dstSeat, -1)]
    ]) {
      if (value >= 0) row[field] = value;
    }
    if (input.actionType != null || input.kind != null) row.actionType = stringOrNull(input.actionType || input.kind);
    const status = normalizeMovementAttemptStatus(input.status || input.result, input.prevented);
    if (status) row.status = status;
    row.prevented = row.status === "prevented";
    if (input.preventionSkillId != null || input.skillId != null && row.prevented) {
      row.preventionSkillId = finiteInteger(input.preventionSkillId ?? input.skillId, 0) || null;
    }
    if (input.preventionReason != null || input.reason != null && row.prevented) {
      row.preventionReason = stringOrNull(input.preventionReason || input.reason);
    }
    if (input.movementApplied != null) row.movementApplied = input.movementApplied === true;
    if (input.movementId != null) row.movementId = stringOrNull(input.movementId);
    if (input.causalEventId != null || input.eventId != null) row.causalEventId = stringOrNull(input.causalEventId || input.eventId);
    if (input.metadata != null) row.metadata = cloneJson(input.metadata || {});
    row.context = mergeTurnContext(state.context, input.context || row.context);
    row.source = source;
    row.updatedAt = now();
    state.movementAttempts[attemptId] = row;
    const history = {
      index: state.nextMovementAttemptHistoryIndex++,
      attemptId,
      type: existing ? "update" : "observe",
      before,
      after: cloneJson(row),
      source,
      eventIndex: state.nextEventIndex,
      time: now()
    };
    state.movementAttemptHistory.push(history);
    recordEvent("card.move.attempt", {
      attemptId,
      from: row.from,
      to: row.to,
      count: row.count,
      cardIds: row.cardIds,
      status: row.status,
      prevented: row.prevented,
      movementApplied: row.movementApplied,
      source
    });
    return cloneJson(row);
  }

  function resolveMovementAttempt(input = {}) {
    const attemptId = String(input.attemptId || input.movementAttemptId || input.id || "").trim();
    if (!attemptId || !state.movementAttempts[attemptId]) return null;
    return observeMovementAttempt({
      ...input,
      attemptId,
      status: input.status || input.result || (input.prevented === true ? "prevented" : "resolved")
    });
  }

  function movementAttempts(input = {}) {
    const status = String(input.status || "").trim().toLowerCase();
    const cardId = finiteInteger(input.cardId, 0);
    const actorSeat = finiteInteger(input.actorSeat, -1);
    const targetSeat = finiteInteger(input.targetSeat, -1);
    const causalEventId = String(input.causalEventId || input.eventId || "").trim();
    return Object.values(state.movementAttempts).filter((row) => {
      if (status && row.status !== status) return false;
      if (cardId > 0 && !row.cardIds.includes(cardId)) return false;
      if (actorSeat >= 0 && row.actorSeat !== actorSeat) return false;
      if (targetSeat >= 0 && row.targetSeat !== targetSeat) return false;
      if (causalEventId && row.causalEventId !== causalEventId) return false;
      if (input.prevented != null && row.prevented !== (input.prevented === true)) return false;
      return true;
    }).sort((left, right) => left.createdAt - right.createdAt).map(cloneJson);
  }

  function observeJudgementOutcome(input = {}) {
    const judgementId = String(input.judgementId || input.eventId || input.id || `judgement:${state.nextJudgementOutcomeId++}`).trim();
    if (!judgementId) return null;
    const existing = state.judgementOutcomes[judgementId] || null;
    const source = normalizeSource(input.source || sourceOf("judgement-outcome", "server-protocol"), now);
    const before = existing ? cloneJson(existing) : null;
    const row = existing || {
      judgementId,
      judgementCardId: null,
      delayedTrickCardId: null,
      subjectSeat: null,
      effectiveName: null,
      baseSuccess: null,
      reportedFinalSuccess: null,
      derivedSuccess: null,
      finalSuccess: null,
      inversionCount: 0,
      layers: [],
      status: "observed",
      causalEventId: null,
      context: mergeTurnContext(state.context, input.context),
      metadata: {},
      source,
      createdAt: now(),
      updatedAt: now()
    };
    const judgementCardId = finiteInteger(input.judgementCardId ?? input.cardId, 0);
    const delayedTrickCardId = finiteInteger(input.delayedTrickCardId ?? input.parentCardId, 0);
    const subjectSeat = finiteInteger(input.subjectSeat ?? input.targetSeat ?? input.seatIndex, -1);
    if (judgementCardId > 0) row.judgementCardId = judgementCardId;
    if (delayedTrickCardId > 0) row.delayedTrickCardId = delayedTrickCardId;
    if (subjectSeat >= 0) row.subjectSeat = subjectSeat;
    if (input.effectiveName != null || input.delayedTrickName != null) row.effectiveName = stringOrNull(input.effectiveName || input.delayedTrickName);
    if (Object.prototype.hasOwnProperty.call(input, "baseSuccess") || Object.prototype.hasOwnProperty.call(input, "success")) {
      const value = input.baseSuccess ?? input.success;
      row.baseSuccess = value == null ? null : value === true;
    }
    if (Object.prototype.hasOwnProperty.call(input, "reportedFinalSuccess") || Object.prototype.hasOwnProperty.call(input, "finalSuccess")) {
      const value = input.reportedFinalSuccess ?? input.finalSuccess;
      row.reportedFinalSuccess = value == null ? null : value === true;
    }
    if (input.status != null) row.status = String(input.status || "observed");
    if (input.causalEventId != null || input.parentEventId != null) row.causalEventId = stringOrNull(input.causalEventId || input.parentEventId);
    if (input.metadata != null) row.metadata = cloneJson(input.metadata || {});
    refreshJudgementOutcome(row);
    row.context = mergeTurnContext(state.context, input.context || row.context);
    row.source = source;
    row.updatedAt = now();
    state.judgementOutcomes[judgementId] = row;
    appendJudgementOutcomeHistory(existing ? "update" : "observe", row, before, source);
    recordEvent("judgement.outcome.observed", {
      judgementId,
      judgementCardId: row.judgementCardId,
      baseSuccess: row.baseSuccess,
      finalSuccess: row.finalSuccess,
      inversionCount: row.inversionCount,
      source
    });
    return cloneJson(row);
  }

  function invertJudgementOutcome(input = {}) {
    const judgementId = String(input.judgementId || input.eventId || input.id || "").trim();
    const row = state.judgementOutcomes[judgementId];
    if (!row) return { applied: false, reason: "judgement-outcome-not-found" };
    const source = normalizeSource(input.source || sourceOf("judgement-outcome-inversion", "rule-feedback", {
      skillId: finiteInteger(input.skillId, 0)
    }), now);
    const skillId = finiteInteger(input.skillId, 0) || null;
    const layerId = String(input.layerId || input.modifierId || [
      "judgement-inversion",
      judgementId,
      skillId || "rule",
      input.ruleIdentityKey || "",
      input.causalEventId || ""
    ].join(":"));
    if (row.layers.some((layer) => layer.layerId === layerId)) {
      return { applied: true, duplicate: true, outcome: cloneJson(row) };
    }
    const before = cloneJson(row);
    row.layers.push({
      layerId,
      kind: "invert-success",
      skillId,
      ruleIdentityKey: stringOrNull(input.ruleIdentityKey),
      causalEventId: stringOrNull(input.causalEventId),
      reason: stringOrNull(input.reason),
      source,
      appliedAt: now()
    });
    refreshJudgementOutcome(row);
    row.source = source;
    row.updatedAt = now();
    appendJudgementOutcomeHistory("invert", row, before, source);
    recordEvent("judgement.outcome.inverted", {
      judgementId,
      layerId,
      skillId,
      baseSuccess: row.baseSuccess,
      derivedSuccess: row.derivedSuccess,
      finalSuccess: row.finalSuccess,
      source
    });
    return { applied: true, duplicate: false, outcome: cloneJson(row) };
  }

  function judgementOutcome(idValue) {
    const judgementId = String(idValue?.judgementId || idValue?.eventId || idValue || "").trim();
    return judgementId && state.judgementOutcomes[judgementId] ? cloneJson(state.judgementOutcomes[judgementId]) : null;
  }

  function judgementOutcomes(input = {}) {
    const cardId = finiteInteger(input.judgementCardId ?? input.cardId, 0);
    const subjectSeat = finiteInteger(input.subjectSeat ?? input.targetSeat ?? input.seatIndex, -1);
    const status = String(input.status || "").trim();
    const causalEventId = String(input.causalEventId || input.parentEventId || "").trim();
    return Object.values(state.judgementOutcomes).filter((row) => {
      if (cardId > 0 && row.judgementCardId !== cardId) return false;
      if (subjectSeat >= 0 && row.subjectSeat !== subjectSeat) return false;
      if (status && row.status !== status) return false;
      if (causalEventId && row.causalEventId !== causalEventId) return false;
      return true;
    }).sort((left, right) => left.createdAt - right.createdAt).map(cloneJson);
  }

  function refreshJudgementOutcome(row) {
    row.inversionCount = row.layers.filter((layer) => layer.kind === "invert-success").length;
    row.derivedSuccess = row.baseSuccess == null
      ? null
      : row.inversionCount % 2 === 0
        ? row.baseSuccess
        : !row.baseSuccess;
    row.finalSuccess = row.reportedFinalSuccess == null ? row.derivedSuccess : row.reportedFinalSuccess;
  }

  function appendJudgementOutcomeHistory(type, row, before, source) {
    state.judgementOutcomeHistory.push({
      index: state.nextJudgementOutcomeHistoryIndex++,
      judgementId: row.judgementId,
      type,
      before,
      after: cloneJson(row),
      source,
      eventIndex: state.nextEventIndex,
      time: now()
    });
  }

  function observeBooleanConstraint(input = {}) {
    const key = String(input.key || input.constraintKey || input.id || `boolean:${state.nextBooleanConstraintId++}`).trim();
    if (!key) return { applied: false, reason: "boolean-constraint-key-required" };
    const existing = state.booleanConstraints[key] || null;
    const source = normalizeSource(input.source || sourceOf("boolean-cardinality-constraint", "rule-feedback", {
      skillId: finiteInteger(input.skillId, 0)
    }), now);
    const before = existing ? cloneJson(existing) : null;
    const row = existing ? cloneJson(existing) : {
      key,
      propositions: {},
      constraints: [],
      subjectSeat: null,
      handGeneration: null,
      bindToCurrentHand: false,
      skillId: null,
      ruleIdentityKey: null,
      causalEventId: null,
      status: "observed",
      active: true,
      solutionStatus: "unresolved",
      solutionComplete: false,
      solutionCount: null,
      solutionSamples: [],
      entailedFacts: [],
      metadata: {},
      context: mergeTurnContext(state.context, input.context),
      source,
      createdAt: now(),
      updatedAt: now()
    };
    const beforeSemantic = existing ? canonicalJsonKey(booleanConstraintSemantic(row)) : null;
    const subjectSeat = finiteInteger(input.subjectSeat ?? input.targetSeat ?? input.seatIndex, -1);
    const explicitHandGeneration = nonNegativeIntegerOrNull(input.handGeneration);
    const bindToCurrentHand = input.bindToCurrentHand === true || input.scope === "hand-generation";
    const handGeneration = explicitHandGeneration != null
      ? explicitHandGeneration
      : bindToCurrentHand && subjectSeat >= 0
        ? ensureHand(subjectSeat).generation
        : null;
    for (const [field, incoming] of [["subjectSeat", subjectSeat >= 0 ? subjectSeat : null], ["handGeneration", handGeneration]]) {
      if (incoming == null) continue;
      if (row[field] != null && row[field] !== incoming) {
        contradiction("boolean-constraint-scope-conflict", { key, field, previous: row[field], observed: incoming, source });
        return { applied: false, reason: "boolean-constraint-scope-conflict", key, field };
      }
      row[field] = incoming;
    }
    if (bindToCurrentHand) row.bindToCurrentHand = true;
    const skillId = finiteInteger(input.skillId, 0);
    if (skillId > 0 && row.skillId != null && row.skillId !== skillId) {
      contradiction("boolean-constraint-identity-conflict", { key, field: "skillId", previous: row.skillId, observed: skillId, source });
      return { applied: false, reason: "boolean-constraint-identity-conflict", key, field: "skillId" };
    }
    if (skillId > 0) row.skillId = skillId;
    const ruleIdentityKey = input.ruleIdentityKey != null ? stringOrNull(input.ruleIdentityKey) : null;
    if (ruleIdentityKey && row.ruleIdentityKey && row.ruleIdentityKey !== ruleIdentityKey) {
      contradiction("boolean-constraint-identity-conflict", { key, field: "ruleIdentityKey", previous: row.ruleIdentityKey, observed: ruleIdentityKey, source });
      return { applied: false, reason: "boolean-constraint-identity-conflict", key, field: "ruleIdentityKey" };
    }
    if (ruleIdentityKey) row.ruleIdentityKey = ruleIdentityKey;
    const causalEventId = input.causalEventId != null || input.eventId != null
      ? stringOrNull(input.causalEventId || input.eventId)
      : null;
    if (causalEventId && row.causalEventId && row.causalEventId !== causalEventId) {
      contradiction("boolean-constraint-identity-conflict", { key, field: "causalEventId", previous: row.causalEventId, observed: causalEventId, source });
      return { applied: false, reason: "boolean-constraint-identity-conflict", key, field: "causalEventId" };
    }
    if (causalEventId) row.causalEventId = causalEventId;
    if (input.status != null) row.status = String(input.status || "observed");
    if (input.active != null) row.active = input.active === true;
    if (input.metadata != null) row.metadata = cloneJson(input.metadata || {});

    const rawPropositions = Array.isArray(input.propositions)
      ? input.propositions
      : input.propositions && typeof input.propositions === "object"
        ? Object.entries(input.propositions).map(([propositionKey, value]) => value && typeof value === "object"
          ? { ...value, key: value.key || propositionKey }
          : { key: propositionKey, value })
        : [];
    const incomingPropositionKeys = new Set();
    for (let index = 0; index < rawPropositions.length; index++) {
      const raw = typeof rawPropositions[index] === "string"
        ? { key: rawPropositions[index] }
        : rawPropositions[index] || {};
      const propositionKey = String(raw.key || raw.propositionKey || raw.id || "").trim();
      if (!propositionKey) {
        contradiction("boolean-proposition-key-missing", { key, propositionIndex: index, source });
        return { applied: false, reason: "boolean-proposition-key-required", key, propositionIndex: index };
      }
      if (incomingPropositionKeys.has(propositionKey)) {
        contradiction("boolean-proposition-duplicate", { key, propositionKey, source });
        return { applied: false, reason: "boolean-proposition-duplicate", key, propositionKey };
      }
      incomingPropositionKeys.add(propositionKey);
      const proposition = row.propositions[propositionKey] || {
        key: propositionKey,
        label: null,
        statement: null,
        observedValue: null,
        observedSource: null,
        linkedValue: null,
        linkedSource: null,
        linkedReason: null,
        derivedValue: null,
        value: null,
        possibleValues: [false, true],
        metadata: {}
      };
      if (raw.label != null || raw.name != null) proposition.label = stringOrNull(raw.label || raw.name);
      if (raw.statement != null || raw.predicate != null) {
        const statement = cloneJson(raw.statement ?? raw.predicate);
        if (statement?.kind === "hand-any" && !predicateIsExecutable(statement.predicate || {})) {
          contradiction("boolean-hand-predicate-not-executable", { key, propositionKey, statement, source });
          return { applied: false, reason: "boolean-hand-predicate-not-executable", key, propositionKey };
        }
        proposition.statement = statement;
      }
      if (raw.metadata != null) proposition.metadata = cloneJson(raw.metadata || {});
      const hasValue = Object.prototype.hasOwnProperty.call(raw, "observedValue")
        || Object.prototype.hasOwnProperty.call(raw, "actualValue")
        || Object.prototype.hasOwnProperty.call(raw, "value");
      if (hasValue) {
        const incoming = raw.observedValue ?? raw.actualValue ?? raw.value;
        if (incoming != null && typeof incoming !== "boolean") {
          contradiction("boolean-proposition-value-invalid", { key, propositionKey, observed: incoming, source });
          return { applied: false, reason: "boolean-proposition-value-must-be-boolean", key, propositionKey };
        }
        const value = incoming == null ? null : incoming;
        if (value != null && proposition.observedValue != null && proposition.observedValue !== value) {
          const priorSource = normalizeSource(proposition.observedSource || sourceOf("prior-boolean-proposition", "unknown"), now);
          const revisionAccepted = source.authority > priorSource.authority;
          contradiction(revisionAccepted
            ? "boolean-proposition-authoritative-revision"
            : "boolean-proposition-value-conflict", {
            key,
            propositionKey,
            previous: proposition.observedValue,
            observed: value,
            priorSource,
            revisionAccepted,
            source
          });
          if (!revisionAccepted) {
            return { applied: false, reason: "boolean-proposition-value-conflict", key, propositionKey };
          }
        }
        if (value != null) {
          proposition.observedValue = value;
          if (!proposition.observedSource || source.authority > normalizeSource(proposition.observedSource, now).authority) {
            proposition.observedSource = source;
          }
        }
      }
      row.propositions[propositionKey] = proposition;
    }

    for (const [propositionKey, incoming] of Object.entries(input.assignments || {})) {
      const normalizedKey = String(propositionKey || "").trim();
      if (!normalizedKey || incoming == null) continue;
      const proposition = row.propositions[normalizedKey] || {
        key: normalizedKey,
        label: null,
        statement: null,
        observedValue: null,
        observedSource: null,
        linkedValue: null,
        linkedSource: null,
        linkedReason: null,
        derivedValue: null,
        value: null,
        possibleValues: [false, true],
        metadata: {}
      };
      if (typeof incoming !== "boolean") {
        contradiction("boolean-proposition-value-invalid", { key, propositionKey: normalizedKey, observed: incoming, source });
        return { applied: false, reason: "boolean-proposition-value-must-be-boolean", key, propositionKey: normalizedKey };
      }
      const value = incoming;
      if (proposition.observedValue != null && proposition.observedValue !== value) {
        const priorSource = normalizeSource(proposition.observedSource || sourceOf("prior-boolean-proposition", "unknown"), now);
        const revisionAccepted = source.authority > priorSource.authority;
        contradiction(revisionAccepted
          ? "boolean-proposition-authoritative-revision"
          : "boolean-proposition-value-conflict", {
          key,
          propositionKey: normalizedKey,
          previous: proposition.observedValue,
          observed: value,
          priorSource,
          revisionAccepted,
          source
        });
        if (!revisionAccepted) {
          return { applied: false, reason: "boolean-proposition-value-conflict", key, propositionKey: normalizedKey };
        }
      }
      proposition.observedValue = value;
      if (!proposition.observedSource || source.authority > normalizeSource(proposition.observedSource, now).authority) {
        proposition.observedSource = source;
      }
      row.propositions[normalizedKey] = proposition;
    }

    const rawConstraints = Array.isArray(input.constraints)
      ? input.constraints.slice()
      : Array.isArray(input.cardinalities)
        ? input.cardinalities.slice()
        : [];
    if (input.correctCount != null || input.matchCount != null) {
      rawConstraints.push({
        constraintId: input.cardinalityId || input.resultId || "correct-count",
        terms: input.terms || input.claims || [],
        count: input.correctCount ?? input.matchCount
      });
    }
    for (let index = 0; index < rawConstraints.length; index++) {
      const normalized = normalizeBooleanCardinality(rawConstraints[index], index);
      if (!normalized.ok) {
        contradiction("boolean-cardinality-invalid", { key, constraintIndex: index, reason: normalized.reason, source });
        return { applied: false, reason: normalized.reason, key, constraintIndex: index };
      }
      const constraint = normalized.constraint;
      for (const term of constraint.terms) {
        if (!row.propositions[term.propositionKey]) {
          row.propositions[term.propositionKey] = {
            key: term.propositionKey,
            label: null,
            statement: null,
            observedValue: null,
            observedSource: null,
            linkedValue: null,
            linkedSource: null,
            linkedReason: null,
            derivedValue: null,
            value: null,
            possibleValues: [false, true],
            metadata: {}
          };
        }
      }
      const prior = row.constraints.find((item) => item.constraintId === constraint.constraintId);
      const priorSemantic = prior ? canonicalJsonKey(booleanCardinalitySemantic(prior)) : null;
      const incomingSemantic = canonicalJsonKey(booleanCardinalitySemantic(constraint));
      if (prior && priorSemantic !== incomingSemantic) {
        const priorSource = normalizeSource(prior.source || sourceOf("prior-boolean-cardinality", "unknown"), now);
        const revisionAccepted = source.authority > priorSource.authority;
        contradiction(revisionAccepted
          ? "boolean-cardinality-authoritative-revision"
          : "boolean-cardinality-identity-conflict", {
          key,
          constraintId: constraint.constraintId,
          previous: prior,
          observed: constraint,
          priorSource,
          revisionAccepted,
          source
        });
        if (!revisionAccepted) {
          return { applied: false, reason: "boolean-cardinality-identity-conflict", key, constraintId: constraint.constraintId };
        }
        row.constraints[row.constraints.indexOf(prior)] = { ...constraint, source };
      } else if (!prior) {
        row.constraints.push({ ...constraint, source });
      } else if (!prior.source || source.authority > normalizeSource(prior.source, now).authority) {
        prior.source = source;
      }
    }
    if (!Object.keys(row.propositions).length || !row.constraints.length && !Object.values(row.propositions).some((item) => item.observedValue != null)) {
      return { applied: false, reason: "boolean-propositions-and-evidence-required", key };
    }

    if (row.bindToCurrentHand && row.subjectSeat != null && row.handGeneration != null) {
      const currentGeneration = ensureHand(row.subjectSeat).generation;
      if (currentGeneration !== row.handGeneration) {
        row.active = false;
        row.status = "expired";
        row.invalidatedAt = row.invalidatedAt || now();
        row.invalidationReason = row.invalidationReason || "stale-hand-generation-at-observation";
        row.invalidationSource = row.invalidationSource || source;
      }
    }
    refreshBooleanConstraint(row);
    if (row.solutionStatus === "inconsistent" && (!before || before.solutionStatus !== "inconsistent")) {
      contradiction("boolean-cardinality-inconsistent", {
        key,
        propositions: row.propositions,
        constraints: row.constraints,
        source
      });
    }
    row.context = mergeTurnContext(state.context, input.context || row.context);
    row.source = source;
    const afterSemantic = canonicalJsonKey(booleanConstraintSemantic(row));
    if (existing && beforeSemantic === afterSemantic) {
      return { applied: true, duplicate: true, constraint: cloneJson(existing) };
    }
    row.updatedAt = now();
    state.booleanConstraints[key] = row;
    appendBooleanConstraintHistory(existing ? "update" : "observe", row, before, source);
    recordEvent("boolean.constraint.observed", {
      key,
      propositionCount: Object.keys(row.propositions).length,
      constraintCount: row.constraints.length,
      solutionStatus: row.solutionStatus,
      solutionCount: row.solutionCount,
      subjectSeat: row.subjectSeat,
      handGeneration: row.handGeneration,
      source
    });
    return { applied: true, duplicate: false, constraint: cloneJson(row) };
  }

  function booleanConstraint(keyValue) {
    const key = String(keyValue?.key || keyValue?.constraintKey || keyValue || "").trim();
    return key && state.booleanConstraints[key] ? cloneJson(state.booleanConstraints[key]) : null;
  }

  function booleanConstraints(input = {}) {
    const subjectSeat = finiteInteger(input.subjectSeat ?? input.targetSeat ?? input.seatIndex, -1);
    const skillId = finiteInteger(input.skillId, 0);
    const causalEventId = String(input.causalEventId || input.eventId || "").trim();
    const status = String(input.status || "").trim();
    return Object.values(state.booleanConstraints).filter((row) => {
      if (subjectSeat >= 0 && row.subjectSeat !== subjectSeat) return false;
      if (skillId > 0 && row.skillId !== skillId) return false;
      if (causalEventId && row.causalEventId !== causalEventId) return false;
      if (status && row.status !== status) return false;
      if (input.active != null && row.active !== (input.active === true)) return false;
      return true;
    }).sort((left, right) => left.createdAt - right.createdAt).map(cloneJson);
  }

  function normalizeBooleanCardinality(rawValue = {}, index = 0) {
    const raw = rawValue || {};
    const rawTerms = asList(raw.terms || raw.propositions || raw.claims);
    const terms = [];
    const seen = new Set();
    for (const rawTermValue of rawTerms) {
      const rawTerm = typeof rawTermValue === "string" ? { propositionKey: rawTermValue } : rawTermValue || {};
      const propositionKey = String(rawTerm.propositionKey || rawTerm.key || rawTerm.id || "").trim();
      if (!propositionKey) return { ok: false, reason: "boolean-cardinality-term-key-required" };
      if (seen.has(propositionKey)) return { ok: false, reason: "boolean-cardinality-duplicate-term" };
      seen.add(propositionKey);
      const hasExpected = Object.prototype.hasOwnProperty.call(rawTerm, "equals")
        || Object.prototype.hasOwnProperty.call(rawTerm, "expectedValue")
        || Object.prototype.hasOwnProperty.call(rawTerm, "claimedValue");
      const expected = Object.prototype.hasOwnProperty.call(rawTerm, "equals")
        ? rawTerm.equals
        : Object.prototype.hasOwnProperty.call(rawTerm, "expectedValue")
          ? rawTerm.expectedValue
          : Object.prototype.hasOwnProperty.call(rawTerm, "claimedValue")
            ? rawTerm.claimedValue
            : true;
      if (hasExpected && typeof expected !== "boolean") {
        return { ok: false, reason: "boolean-cardinality-expected-value-must-be-boolean" };
      }
      terms.push({ propositionKey, equals: expected });
    }
    if (!terms.length) return { ok: false, reason: "boolean-cardinality-terms-required" };
    const exactFields = ["count", "exactCount", "correctCount", "matchCount"];
    const exactField = exactFields.find((field) => Object.prototype.hasOwnProperty.call(raw, field));
    const exactRaw = exactField ? raw[exactField] : null;
    const exact = exactField ? nonNegativeIntegerOrNull(exactRaw) : null;
    if (exactField && exact == null) return { ok: false, reason: "boolean-cardinality-count-must-be-nonnegative-integer" };
    const hasMinimum = Object.prototype.hasOwnProperty.call(raw, "minCount");
    const hasMaximum = Object.prototype.hasOwnProperty.call(raw, "maxCount");
    const parsedMinimum = hasMinimum ? nonNegativeIntegerOrNull(raw.minCount) : null;
    const parsedMaximum = hasMaximum ? nonNegativeIntegerOrNull(raw.maxCount) : null;
    if (exact == null && hasMinimum && parsedMinimum == null) {
      return { ok: false, reason: "boolean-cardinality-minimum-must-be-nonnegative-integer" };
    }
    if (exact == null && hasMaximum && parsedMaximum == null) {
      return { ok: false, reason: "boolean-cardinality-maximum-must-be-nonnegative-integer" };
    }
    const minimum = exact != null ? exact : parsedMinimum ?? 0;
    const maximum = exact != null ? exact : parsedMaximum ?? terms.length;
    if (minimum < 0 || maximum < minimum || maximum > terms.length) {
      return { ok: false, reason: "boolean-cardinality-count-out-of-range" };
    }
    const constraintId = String(raw.constraintId || raw.cardinalityId || raw.id || `cardinality:${index}`).trim();
    if (!constraintId) return { ok: false, reason: "boolean-cardinality-id-required" };
    return {
      ok: true,
      constraint: {
        constraintId,
        kind: "cardinality",
        terms,
        minCount: minimum,
        maxCount: maximum,
        metadata: cloneJson(raw.metadata || {}),
        source: null
      }
    };
  }

  function refreshBooleanConstraint(row) {
    linkBooleanConstraintToHand(row);
    const keys = Object.keys(row.propositions);
    const inputConflicts = [];
    const explicit = {};
    for (const key of keys) {
      const proposition = row.propositions[key];
      if (proposition.observedValue != null && proposition.linkedValue != null && proposition.observedValue !== proposition.linkedValue) {
        inputConflicts.push({
          propositionKey: key,
          observedValue: proposition.observedValue,
          observedSource: proposition.observedSource,
          linkedValue: proposition.linkedValue,
          linkedSource: proposition.linkedSource,
          linkedReason: proposition.linkedReason
        });
      }
      const value = proposition.observedValue ?? proposition.linkedValue;
      if (value != null) explicit[key] = value;
    }
    row.inputConflicts = inputConflicts;
    if (inputConflicts.length) {
      row.solutionStatus = "inconsistent";
      row.solutionComplete = true;
      row.solutionCount = 0;
      row.solutionSamples = [];
      row.entailedFacts = [];
      for (const proposition of Object.values(row.propositions)) {
        proposition.possibleValues = [];
        proposition.derivedValue = null;
        proposition.value = proposition.observedValue ?? proposition.linkedValue;
      }
      return;
    }
    const unknownKeys = keys.filter((key) => !Object.prototype.hasOwnProperty.call(explicit, key));
    const enumerationLimit = 16;
    if (unknownKeys.length <= enumerationLimit) {
      const solutions = [];
      const total = 2 ** unknownKeys.length;
      for (let mask = 0; mask < total; mask++) {
        const assignment = { ...explicit };
        for (let index = 0; index < unknownKeys.length; index++) {
          assignment[unknownKeys[index]] = (mask & (1 << index)) !== 0;
        }
        if (row.constraints.every((constraint) => booleanCardinalitySatisfied(constraint, assignment))) {
          solutions.push(assignment);
        }
      }
      row.solutionStatus = solutions.length ? "consistent" : "inconsistent";
      row.solutionComplete = true;
      row.solutionCount = solutions.length;
      row.solutionSamples = solutions.slice(0, 32).map(cloneJson);
      for (const key of keys) {
        const proposition = row.propositions[key];
        const possibleValues = solutions.length
          ? Array.from(new Set(solutions.map((solution) => solution[key]))).sort()
          : [];
        proposition.possibleValues = possibleValues;
        proposition.derivedValue = proposition.observedValue == null && proposition.linkedValue == null && possibleValues.length === 1
          ? possibleValues[0]
          : null;
        proposition.value = proposition.observedValue ?? proposition.linkedValue ?? proposition.derivedValue;
      }
      row.entailedFacts = solutions.length
        ? keys.filter((key) => row.propositions[key].derivedValue != null)
          .map((key) => ({ propositionKey: key, value: row.propositions[key].derivedValue }))
        : [];
      return;
    }

    const assignment = { ...explicit };
    let changed = true;
    let inconsistent = false;
    while (changed && !inconsistent) {
      changed = false;
      for (const constraint of row.constraints) {
        let knownMatches = 0;
        const unknown = [];
        for (const term of constraint.terms) {
          if (!Object.prototype.hasOwnProperty.call(assignment, term.propositionKey)) {
            unknown.push(term);
          } else if (assignment[term.propositionKey] === term.equals) {
            knownMatches++;
          }
        }
        if (knownMatches > constraint.maxCount || knownMatches + unknown.length < constraint.minCount) {
          inconsistent = true;
          break;
        }
        const forcedMatch = knownMatches + unknown.length === constraint.minCount;
        const forcedNonMatch = knownMatches === constraint.maxCount;
        if (!forcedMatch && !forcedNonMatch) continue;
        for (const term of unknown) {
          const value = forcedMatch ? term.equals : !term.equals;
          if (Object.prototype.hasOwnProperty.call(assignment, term.propositionKey) && assignment[term.propositionKey] !== value) {
            inconsistent = true;
            break;
          }
          if (!Object.prototype.hasOwnProperty.call(assignment, term.propositionKey)) {
            assignment[term.propositionKey] = value;
            changed = true;
          }
        }
      }
    }
    row.solutionStatus = inconsistent ? "inconsistent" : "consistent-partial";
    row.solutionComplete = inconsistent || keys.every((key) => Object.prototype.hasOwnProperty.call(assignment, key));
    row.solutionCount = inconsistent ? 0 : row.solutionComplete ? 1 : null;
    row.solutionSamples = inconsistent ? [] : row.solutionComplete ? [cloneJson(assignment)] : [];
    for (const key of keys) {
      const proposition = row.propositions[key];
      const value = Object.prototype.hasOwnProperty.call(assignment, key) ? assignment[key] : null;
      proposition.possibleValues = inconsistent ? [] : value == null ? [false, true] : [value];
      proposition.derivedValue = proposition.observedValue == null && proposition.linkedValue == null ? value : null;
      proposition.value = proposition.observedValue ?? proposition.linkedValue ?? proposition.derivedValue;
    }
    row.entailedFacts = inconsistent
      ? []
      : keys.filter((key) => row.propositions[key].derivedValue != null)
        .map((key) => ({ propositionKey: key, value: row.propositions[key].derivedValue }));
  }

  function linkBooleanConstraintToHand(row) {
    if (!row.active || !row.bindToCurrentHand || row.subjectSeat == null || row.handGeneration == null) return;
    const hand = ensureHand(row.subjectSeat);
    if (hand.generation !== row.handGeneration) return;
    for (const proposition of Object.values(row.propositions)) {
      const statement = proposition.statement;
      if (statement?.kind !== "hand-any") continue;
      proposition.linkedValue = null;
      proposition.linkedSource = null;
      proposition.linkedReason = null;
      const predicate = normalizePredicate(statement.predicate || {});
      if (!predicateIsExecutable(predicate)) continue;
      const predicateKey = canonicalJsonKey(predicate);
      const matchingConstraint = hand.constraints.find((constraint) =>
        canonicalJsonKey(normalizePredicate(constraint.predicate || {})) === predicateKey && (
          constraint.kind === "none-match"
          || constraint.kind === "at-most" && constraint.count === 0
          || constraint.kind === "exact-count"
          || constraint.kind === "at-least" && constraint.count > 0
          || constraint.kind === "all-match" && hand.count > 0
        ));
      if (matchingConstraint) {
        const linkedValue = matchingConstraint.kind === "none-match"
          || matchingConstraint.kind === "at-most"
          || matchingConstraint.kind === "exact-count" && matchingConstraint.count === 0
          ? false
          : true;
        proposition.linkedValue = linkedValue;
        proposition.linkedSource = cloneJson(matchingConstraint.source);
        proposition.linkedReason = `hand-constraint:${matchingConstraint.id}`;
        continue;
      }
      const truths = hand.exactIds.map((cardId) => booleanHandPredicateTruth(cardId, predicate));
      if (truths.some((value) => value === true)) {
        proposition.linkedValue = true;
        proposition.linkedSource = cloneJson(hand.source || sourceOf("known-hand-identity", "rule-feedback"));
        proposition.linkedReason = "known-matching-hand-card";
        continue;
      }
      const completeIdentitySnapshot = hand.complete === true && hand.exactIds.length === hand.count;
      if (hand.count === 0 || completeIdentitySnapshot && truths.every((value) => value === false)) {
        proposition.linkedValue = false;
        proposition.linkedSource = cloneJson(hand.source || sourceOf("complete-hand-identity", "rule-feedback"));
        proposition.linkedReason = hand.count === 0 ? "known-empty-hand" : "complete-hand-has-no-match";
      }
    }
  }

  function booleanHandPredicateTruth(cardId, predicate) {
    const card = state.catalog[cardId];
    if (!card) return null;
    const canonical = normalizePredicate(predicate);
    if (!predicateIsExecutable(canonical)) return null;
    let undecided = false;
    for (const [field, values] of Object.entries(canonical)) {
      if (["all", "any", "not", "comparisons", "_unsupported"].includes(field) || !values.length) continue;
      const fact = knownBooleanPredicateAttribute(card, cardId, field);
      if (!fact.known) {
        undecided = true;
      } else if (!values.some((value) => String(value) === String(fact.value))) {
        return false;
      }
    }
    for (const child of canonical.all || []) {
      const value = booleanHandPredicateTruth(cardId, child);
      if (value === false) return false;
      if (value == null) undecided = true;
    }
    if (canonical.any?.length) {
      const values = canonical.any.map((child) => booleanHandPredicateTruth(cardId, child));
      if (!values.some((value) => value === true)) {
        if (values.every((value) => value === false)) return false;
        undecided = true;
      }
    }
    if (canonical.not) {
      const value = booleanHandPredicateTruth(cardId, canonical.not);
      if (value === true) return false;
      if (value == null) undecided = true;
    }
    for (const comparison of canonical.comparisons || []) {
      const fact = knownBooleanPredicateAttribute(card, cardId, comparison.field);
      if (!fact.known) {
        undecided = true;
      } else if (!matchesComparison(card, comparison)) {
        return false;
      }
    }
    return undecided ? null : true;
  }

  function knownBooleanPredicateAttribute(card, cardId, field) {
    if (field === "id") return { known: cardId > 0, value: cardId };
    const value = cardAttribute(card, field);
    if (field === "type") return { known: value != null && value !== "unknown", value };
    if (["name", "color", "spellClass", "nature"].includes(field)) return { known: value != null && value !== "", value };
    if (["number", "suit", "subtype", "spellId", "equipSubtype"].includes(field)) return { known: value != null, value };
    if (field === "isDelayedTrick" || field === "isOrdinaryTrick") {
      if (card.type && card.type !== "unknown" && card.type !== "trick") return { known: true, value: false };
      if (card.type === "trick" && card.subtype != null) return { known: true, value };
      return { known: value === true, value };
    }
    if (field === "isDamageCard") return { known: value === true, value };
    return { known: false, value: null };
  }

  function booleanCardinalitySatisfied(constraint, assignment) {
    const matches = constraint.terms.reduce((count, term) => count + (assignment[term.propositionKey] === term.equals ? 1 : 0), 0);
    return matches >= constraint.minCount && matches <= constraint.maxCount;
  }

  function booleanConstraintSemantic(row) {
    const result = cloneJson(row);
    delete result.createdAt;
    delete result.updatedAt;
    delete result.source;
    return result;
  }

  function booleanCardinalitySemantic(row) {
    const result = cloneJson(row);
    delete result.source;
    return result;
  }

  function appendBooleanConstraintHistory(type, row, before, source, detail = {}) {
    state.booleanConstraintHistory.push({
      index: state.nextBooleanConstraintHistoryIndex++,
      key: row.key,
      type,
      before,
      after: cloneJson(row),
      reason: stringOrNull(detail.reason),
      source,
      eventIndex: state.nextEventIndex,
      time: now()
    });
    if (state.booleanConstraintHistory.length > maxEvents) {
      state.booleanConstraintHistory.splice(0, state.booleanConstraintHistory.length - maxEvents);
    }
  }

  function expireBooleanConstraintsForHandGeneration(seatIndex, generation, reason, source = null) {
    const normalizedSource = normalizeSource(source || sourceOf("hand-generation-change", "rule-feedback"), now);
    const rows = Object.values(state.booleanConstraints).filter((row) =>
      row.active && row.bindToCurrentHand && row.subjectSeat === seatIndex && row.handGeneration === generation);
    for (const row of rows) {
      const before = cloneJson(row);
      row.active = false;
      row.status = "expired";
      row.invalidatedAt = now();
      row.invalidationReason = String(reason || "hand-generation-changed");
      row.invalidationSource = normalizedSource;
      row.updatedAt = now();
      appendBooleanConstraintHistory("expire", row, before, normalizedSource, { reason: row.invalidationReason });
    }
    if (rows.length) {
      recordEvent("boolean.constraints.expired", {
        subjectSeat: seatIndex,
        handGeneration: generation,
        keys: rows.map((row) => row.key),
        reason,
        source: normalizedSource
      });
    }
    return rows.length;
  }

  function refreshBooleanConstraintsForHandKnowledge(seatIndex, generation, reason, source = null) {
    const normalizedSource = normalizeSource(source || sourceOf("hand-knowledge-refinement", "rule-feedback"), now);
    const rows = Object.values(state.booleanConstraints).filter((row) =>
      row.active && row.bindToCurrentHand && row.subjectSeat === seatIndex && row.handGeneration === generation);
    const changedKeys = [];
    for (const row of rows) {
      const before = cloneJson(row);
      const beforeSemantic = canonicalJsonKey(booleanConstraintSemantic(row));
      refreshBooleanConstraint(row);
      if (beforeSemantic === canonicalJsonKey(booleanConstraintSemantic(row))) continue;
      if (row.solutionStatus === "inconsistent" && before.solutionStatus !== "inconsistent") {
        contradiction("boolean-cardinality-inconsistent-after-hand-refinement", {
          key: row.key,
          subjectSeat: seatIndex,
          handGeneration: generation,
          inputConflicts: row.inputConflicts,
          reason,
          source: normalizedSource
        });
      }
      row.updatedAt = now();
      appendBooleanConstraintHistory("hand-knowledge-refine", row, before, normalizedSource, { reason });
      changedKeys.push(row.key);
    }
    if (changedKeys.length) {
      recordEvent("boolean.constraints.hand-knowledge-refined", {
        subjectSeat: seatIndex,
        handGeneration: generation,
        keys: changedKeys,
        reason,
        source: normalizedSource
      });
    }
    return changedKeys.length;
  }

  function queryCurrentDiscard(input = {}) {
    const entryContext = input.entryContext || {};
    const entryTurn = finiteNumber(entryContext.turn);
    const entryRound = finiteNumber(entryContext.round);
    const entryPhase = finiteNumber(entryContext.phase);
    const predicate = normalizePredicate(input.predicate || {});
    const movementReasons = new Set(uniqueStrings(asList(input.movementReasons || input.movementReason)));
    const hasPredicate = Object.keys(predicate).length > 0;
    if (hasPredicate && !predicateIsExecutable(predicate)) {
      return { status: "unsupported", reason: "predicate-not-executable", cardIds: [], count: 0 };
    }
    const eventAny = Array.isArray(input.eventAny)
      ? input.eventAny
      : input.eventFilter
        ? [input.eventFilter]
        : [];
    const entries = state.discard.entries.filter((entry) => {
      if (!state.discard.exactIds.includes(entry.cardId)) return false;
      if (entryTurn != null && entry.turn !== entryTurn) return false;
      if (entryRound != null && entry.round !== entryRound) return false;
      if (entryPhase != null && entry.phase !== entryPhase) return false;
      if (movementReasons.size && !movementReasons.has(entry.movementReason)) return false;
      if (hasPredicate) {
        const card = input.attributeView === "effective"
          ? effectiveCard(entry.cardId, {
              scope: input.scope,
              causalEventId: input.causalEventId || input.eventId,
              targetSeat: input.targetSeat,
              channelKey: input.channelKey || input.channel
            }).effective
          : normalizedCardForId(entry.cardId);
        if (!matchesPredicate(card, predicate, entry.cardId)) return false;
      }
      if (eventAny.length && !eventAny.some((filter) => cardEvents({ ...filter, cardId: entry.cardId }).length > 0)) return false;
      return true;
    });
    return {
      status: "ok",
      epoch: state.epoch,
      entryContext: { turn: entryTurn, round: entryRound, phase: entryPhase },
      eventAny: cloneJson(eventAny),
      movementReasons: Array.from(movementReasons),
      predicate,
      cardIds: entries.map((entry) => entry.cardId),
      cards: entries.map((entry) => normalizedCardForId(entry.cardId)),
      entries: entries.map(cloneJson),
      count: entries.length,
      currentDiscardComplete: state.discard.complete,
      exactCurrentDiscardCount: state.discard.exactIds.length,
      physicalCurrentDiscardCount: state.discard.count
    };
  }

  function queryCardSources(input = {}) {
    const rawZones = Array.isArray(input.zones || input.sources)
      ? input.zones || input.sources
      : input.zones || input.sources
        ? [input.zones || input.sources]
        : [];
    const zones = uniqueStrings(rawZones.map(normalizeZoneKey).filter(Boolean));
    const predicate = normalizePredicate(input.predicate || {});
    if (!zones.length) return { status: "unsupported", reason: "source-zones-required", sources: [] };
    if (!predicateIsExecutable(predicate)) return { status: "unsupported", reason: "predicate-not-executable", predicate, sources: [] };
    const sources = zones.map((zoneKey) => {
      if (zoneKey === ZONE.DECK) {
        const population = candidatePopulation();
        const exactMatchingIds = population.exactDeckIds.filter((id) => matchesPredicate(state.catalog[id], predicate, id));
        const unresolvedMatchingIds = population.unresolvedIds.filter((id) => matchesPredicate(state.catalog[id], predicate, id));
        return {
          zoneKey,
          physicalCount: state.deck.count,
          exactMatchingIds,
          unresolvedMatchingIds,
          unresolvedSlots: population.remainingSlots,
          complete: state.deck.count != null && population.remainingSlots === 0 && population.capacityConsistent,
          membershipAssumption: population.remainingSlots > 0 ? "exchangeable-unlocated-card-identities" : "exact"
        };
      }
      const zone = ensureZone(zoneKey);
      const exactMatchingIds = zone.exactIds.filter((id) => matchesPredicate(state.catalog[id], predicate, id));
      return {
        zoneKey,
        physicalCount: zone.count,
        exactMatchingIds,
        unresolvedMatchingIds: [],
        unknownCount: Math.max(0, Number(zone.count || 0) - zone.exactIds.length),
        complete: zone.complete === true,
        visibility: zone.visibility,
        source: zone.source
      };
    });
    return {
      status: "ok",
      predicate,
      sources,
      exactMatchingIds: uniquePositiveIds(sources.flatMap((row) => row.exactMatchingIds)),
      possibleMatchingIds: uniquePositiveIds(sources.flatMap((row) => [...row.exactMatchingIds, ...row.unresolvedMatchingIds])),
      allSourcesComplete: sources.every((row) => row.complete === true),
      negativeEvidenceApplied: false
    };
  }

  function resolveCardSourceResult(input = {}) {
    const rawZones = asList(input.zones || input.sources);
    const zones = uniqueStrings(rawZones.map(normalizeZoneKey).filter(Boolean));
    const predicate = normalizePredicate(input.predicate || input.selector || {});
    const to = normalizeZoneKey(input.to || input.destination);
    const explicitFrom = normalizeZoneKey(input.from || input.sourceZone);
    const source = normalizeSource(input.sourceEvidence || input.evidence || sourceOf("union-card-source-result", "server-protocol"), now);
    const foundIds = uniquePositiveIds(input.foundCardIds || input.cardIds);
    const rawResults = Array.isArray(input.results) ? input.results : [];
    const resultItems = rawResults.map((row) => ({
      cardId: finiteInteger(row?.cardId ?? row?.id, 0) || null,
      from: normalizeZoneKey(row?.from || row?.sourceZone)
    }));
    for (const cardId of foundIds) {
      if (!resultItems.some((row) => row.cardId === cardId)) resultItems.push({ cardId, from: "" });
    }
    const observedResult = input.foundCount != null || foundIds.length > 0 || rawResults.length > 0;
    const identifiedCount = resultItems.filter((row) => row.cardId != null).length;
    const foundCount = Math.max(nonNegativeIntegerOrNull(input.foundCount) ?? resultItems.length, resultItems.length, identifiedCount);
    const query = queryCardSources({ zones, predicate });
    if (query.status !== "ok") return { ...query, operation: "union-source-result" };
    if (!observedResult) return { status: "unsupported", reason: "observed-result-required", query, negativeEvidenceApplied: false };
    if (foundCount > 0 && !to) return { status: "unsupported", reason: "destination-required", query, negativeEvidenceApplied: false };
    if (explicitFrom && !zones.includes(explicitFrom)) {
      return { status: "unsupported", reason: "explicit-source-not-in-union", explicitFrom, zones, query, negativeEvidenceApplied: false };
    }
    if (foundCount === 0) {
      recordEvent("card.union-source.result", {
        zones,
        predicate,
        foundCount,
        exhaustive: input.exhaustive === true,
        negativeEvidenceApplied: false,
        source
      });
      return { status: "applied", zones, predicate, foundCount, movements: [], query, negativeEvidenceApplied: false };
    }

    const resolved = [];
    for (const item of resultItems) {
      const knownLocation = item.cardId ? normalizeZoneKey(state.locations[item.cardId]?.zoneKey) : "";
      const statedSource = item.from || explicitFrom;
      if (statedSource && !zones.includes(statedSource)) {
        return { status: "unsupported", reason: "result-source-not-in-union", item, zones, query, negativeEvidenceApplied: false };
      }
      if (knownLocation && statedSource && knownLocation !== statedSource) {
        contradiction("union-source-location-conflict", { cardId: item.cardId, knownLocation, statedSource, zones, source });
        return { status: "contradiction", reason: "result-source-conflicts-known-location", item, knownLocation, query, negativeEvidenceApplied: false };
      }
      const from = statedSource || (zones.includes(knownLocation) ? knownLocation : "");
      if (!from) {
        return { status: "unsupported", reason: "result-source-unresolved", item, zones, query, negativeEvidenceApplied: false };
      }
      resolved.push({ cardId: item.cardId, from });
    }
    const unidentifiedCount = Math.max(0, foundCount - resultItems.length);
    if (unidentifiedCount > 0 && !explicitFrom) {
      return { status: "unsupported", reason: "hidden-result-source-unresolved", unidentifiedCount, zones, query, negativeEvidenceApplied: false };
    }

    const groups = new Map();
    for (const item of resolved) {
      if (!groups.has(item.from)) groups.set(item.from, { from: item.from, cardIds: [], count: 0 });
      const group = groups.get(item.from);
      if (item.cardId) group.cardIds.push(item.cardId);
      group.count++;
    }
    if (unidentifiedCount > 0) {
      if (!groups.has(explicitFrom)) groups.set(explicitFrom, { from: explicitFrom, cardIds: [], count: 0 });
      groups.get(explicitFrom).count += unidentifiedCount;
    }
    const movements = [];
    for (const group of groups.values()) {
      const from = group.from === ZONE.DECK
        ? { zone: ZONE.DECK, position: DECK_POSITION.RANDOM }
        : group.from;
      movements.push(observeMove({
        from,
        to,
        count: group.count,
        cardIds: group.cardIds,
        predicate,
        context: input.context,
        causalEventId: input.causalEventId,
        movementReason: input.movementReason,
        reasonTags: input.reasonTags,
        source,
        reason: input.reason || "union-card-source-result"
      }));
    }
    recordEvent("card.union-source.result", {
      zones,
      predicate,
      foundCount,
      foundCardIds: resolved.map((row) => row.cardId).filter(Boolean),
      resolvedSources: resolved,
      unidentifiedCount,
      to,
      negativeEvidenceApplied: false,
      source
    });
    return {
      status: "applied",
      zones,
      predicate,
      foundCount,
      foundCardIds: resolved.map((row) => row.cardId).filter(Boolean),
      resolvedSources: resolved,
      unidentifiedCount,
      to,
      movements,
      query,
      negativeEvidenceApplied: false
    };
  }

  function observeGeneralCardEntity(input = {}) {
    const hostSeat = finiteInteger(input.hostSeat ?? input.seatIndex ?? input.seat, -1);
    const generalSlot = String(input.generalSlot || input.slot || input.position || "").trim();
    const observedGeneralId = finiteInteger(input.generalId ?? input.entityId ?? input.id, 0);
    const entityKey = String(input.entityKey || input.instanceKey || (
      hostSeat >= 0 && generalSlot
        ? `general-slot:${hostSeat}:${generalSlot}`
        : observedGeneralId > 0
          ? `general-card:${observedGeneralId}`
          : ""
    )).trim();
    if (!entityKey) return null;
    const existing = state.generalCardEntities[entityKey] || null;
    if (!existing && observedGeneralId <= 0) return null;
    const source = normalizeSource(input.source || sourceOf("general-card-entity-observation", "runtime-public"), now);
    const before = existing ? cloneJson(existing) : null;
    const printedSkillsObserved = Object.prototype.hasOwnProperty.call(input, "printedSkillIds") ||
      Object.prototype.hasOwnProperty.call(input, "skillIds") ||
      Object.prototype.hasOwnProperty.call(input, "printedSkills");
    const effectiveSkillsObserved = Object.prototype.hasOwnProperty.call(input, "effectiveSkillIds") ||
      Object.prototype.hasOwnProperty.call(input, "activeSkillIds");
    const row = existing || {
      entityKey,
      entityType: "general-card",
      generalId: observedGeneralId,
      hostSeat: hostSeat >= 0 ? hostSeat : null,
      generalSlot: generalSlot || null,
      faceState: "unknown",
      printedSkillIds: [],
      printedSkillIdsKnown: false,
      effectiveSkillIds: [],
      effectiveSkillIdsKnown: false,
      active: true,
      visibilityAudience: "unknown",
      observerSeats: [],
      metadata: {},
      source,
      updatedAt: now()
    };
    if (observedGeneralId > 0) row.generalId = observedGeneralId;
    if (hostSeat >= 0) row.hostSeat = hostSeat;
    if (generalSlot) row.generalSlot = generalSlot;
    if (input.faceState != null || input.face != null) {
      row.faceState = normalizeGeneralFaceState(input.faceState ?? input.face);
    }
    if (printedSkillsObserved) {
      row.printedSkillIds = uniquePositiveIds(input.printedSkillIds || input.skillIds || input.printedSkills);
      row.printedSkillIdsKnown = input.printedSkillIdsKnown !== false;
    } else if (input.printedSkillIdsKnown != null) {
      row.printedSkillIdsKnown = input.printedSkillIdsKnown === true;
    }
    if (effectiveSkillsObserved) {
      row.effectiveSkillIds = uniquePositiveIds(input.effectiveSkillIds || input.activeSkillIds);
      row.effectiveSkillIdsKnown = input.effectiveSkillIdsKnown !== false;
    } else if (input.effectiveSkillIdsKnown != null) {
      row.effectiveSkillIdsKnown = input.effectiveSkillIdsKnown === true;
    }
    if (input.active != null) row.active = input.active === true;
    if (input.visibilityAudience != null || input.visibility != null) {
      row.visibilityAudience = String(input.visibilityAudience || input.visibility || "unknown");
    }
    if (input.observerSeats != null || input.viewerSeats != null) {
      row.observerSeats = uniqueFiniteNumbers(asList(input.observerSeats ?? input.viewerSeats)).sort((left, right) => left - right);
    }
    if (input.metadata != null) row.metadata = cloneJson(input.metadata || {});
    row.source = source;
    row.updatedAt = now();
    state.generalCardEntities[entityKey] = row;
    const history = {
      index: state.nextGeneralCardEntityHistoryIndex++,
      entityKey,
      type: existing ? "update" : "observe",
      before,
      after: cloneJson(row),
      context: mergeTurnContext(state.context, input.context),
      reason: String(input.reason || (existing ? "general-card-entity-updated" : "general-card-entity-observed")),
      source,
      eventIndex: state.nextEventIndex,
      time: now()
    };
    state.generalCardEntityHistory.push(history);
    recordEvent("general-card-entity.observed", {
      entityKey,
      generalId: row.generalId,
      hostSeat: row.hostSeat,
      generalSlot: row.generalSlot,
      faceState: row.faceState,
      active: row.active,
      source
    });
    return compactGeneralCardEntity(row);
  }

  function generalCardEntity(keyValue, options = {}) {
    const entityKey = typeof keyValue === "object"
      ? String(keyValue.entityKey || keyValue.instanceKey || "").trim()
      : String(keyValue || "").trim();
    if (!entityKey || !state.generalCardEntities[entityKey]) return null;
    return visibleGeneralCardEntity(state.generalCardEntities[entityKey], typeof keyValue === "object" ? keyValue : options);
  }

  function generalCardEntities(input = {}) {
    const hostSeat = finiteInteger(input.hostSeat ?? input.seatIndex ?? input.seat, -1);
    const generalSlot = String(input.generalSlot || input.slot || "").trim();
    const generalId = finiteInteger(input.generalId ?? input.entityId, 0);
    const active = input.active == null ? null : input.active === true;
    return Object.values(state.generalCardEntities).filter((row) => {
      if (hostSeat >= 0 && row.hostSeat !== hostSeat) return false;
      if (generalSlot && row.generalSlot !== generalSlot) return false;
      if (generalId > 0 && row.generalId !== generalId) return false;
      if (active != null && row.active !== active) return false;
      return true;
    }).sort((left, right) => left.entityKey.localeCompare(right.entityKey)).map((row) =>
      visibleGeneralCardEntity(row, input)
    );
  }

  function replaceGeneralCardEntity(input = {}) {
    const entityKey = String(input.entityKey || input.instanceKey || "").trim();
    const existing = state.generalCardEntities[entityKey] || null;
    const generalId = finiteInteger(input.generalId ?? input.replacementGeneralId ?? input.entityId, 0);
    if (!existing || generalId <= 0) return { applied: false, reason: "existing-slot-and-replacement-general-required" };
    const printedProvided = Object.prototype.hasOwnProperty.call(input, "printedSkillIds") || Object.prototype.hasOwnProperty.call(input, "skillIds");
    const effectiveProvided = Object.prototype.hasOwnProperty.call(input, "effectiveSkillIds") || Object.prototype.hasOwnProperty.call(input, "activeSkillIds");
    const before = compactGeneralCardEntity(existing);
    const after = observeGeneralCardEntity({
      entityKey,
      generalId,
      hostSeat: input.hostSeat ?? existing.hostSeat,
      generalSlot: input.generalSlot || input.slot || existing.generalSlot,
      faceState: input.faceState || input.face || "face-up",
      printedSkillIds: printedProvided ? input.printedSkillIds || input.skillIds : [],
      printedSkillIdsKnown: printedProvided ? input.printedSkillIdsKnown !== false : false,
      effectiveSkillIds: effectiveProvided ? input.effectiveSkillIds || input.activeSkillIds : [],
      effectiveSkillIdsKnown: effectiveProvided ? input.effectiveSkillIdsKnown !== false : false,
      active: true,
      visibilityAudience: input.visibilityAudience || input.visibility || existing.visibilityAudience,
      observerSeats: input.observerSeats || input.viewerSeats || existing.observerSeats,
      metadata: {
        ...(input.metadata || {}),
        replacement: {
          previousGeneralId: before.generalId,
          replacementGeneralId: generalId,
          relation: String(input.relation || input.replacementKind || "replacement"),
          sourceSkillId: finiteInteger(input.skillId, 0) || null
        }
      },
      context: input.context,
      reason: input.reason || "general-card-entity-replaced",
      source: input.source
    });
    return { applied: true, entityKey, before, after };
  }

  function visibleGeneralCardEntity(row, options = {}) {
    const result = compactGeneralCardEntity(row);
    const observerSeat = finiteInteger(options.observerSeat ?? options.viewerSeat, -1);
    const audience = String(row.visibilityAudience || "unknown").trim().toLowerCase();
    const publicIdentity = ["public", "all", "everyone", "face-up-public"].includes(audience);
    const authorized = options.includeHiddenIdentity === true || publicIdentity ||
      observerSeat >= 0 && row.observerSeats.includes(observerSeat);
    result.observerSeat = observerSeat >= 0 ? observerSeat : null;
    result.identityVisible = authorized;
    if (!authorized) {
      result.generalId = null;
      result.printedSkillIds = [];
      result.effectiveSkillIds = [];
      result.identityRedacted = true;
    } else {
      result.identityRedacted = false;
    }
    return result;
  }

  function compactGeneralCardEntity(row) {
    return {
      entityKey: row.entityKey,
      entityType: "general-card",
      generalId: row.generalId,
      hostSeat: row.hostSeat,
      generalSlot: row.generalSlot,
      faceState: row.faceState,
      printedSkillIds: row.printedSkillIds.slice(),
      printedSkillIdsKnown: row.printedSkillIdsKnown === true,
      effectiveSkillIds: row.effectiveSkillIds.slice(),
      effectiveSkillIdsKnown: row.effectiveSkillIdsKnown === true,
      active: row.active === true,
      visibilityAudience: row.visibilityAudience,
      observerSeats: row.observerSeats.slice(),
      metadata: cloneJson(row.metadata || {}),
      source: row.source,
      updatedAt: row.updatedAt
    };
  }

  function observeZoneCapability(input = {}) {
    const seat = finiteInteger(input.seat ?? input.seatIndex ?? input.hostSeat, -1);
    const area = String(input.area || input.zoneArea || input.zoneKind || "").trim().toLowerCase();
    const slot = String(input.slot || input.equipmentSlot || input.subtype || "").trim().toLowerCase();
    const capability = String(input.capability || input.name || "exists").trim().toLowerCase();
    const key = String(input.key || ["zone-capability", seat >= 0 ? seat : "global", area || "unknown", slot || "*", capability].join(":"));
    if (!key || !area) return null;
    const source = normalizeSource(input.source || sourceOf("zone-capability-observation", "rule-feedback"), now);
    const existing = state.zoneCapabilities[key] || null;
    const status = normalizeZoneCapabilityStatus(input.status, input.abolished, input.available);
    if (existing?.permanent && existing.status === "abolished" && status === "available" && source.authority < existing.source.authority) {
      contradiction("permanent-zone-capability-restored-by-weaker-source", { key, existing, observedStatus: status, source });
      return cloneJson(existing);
    }
    const before = existing ? cloneJson(existing) : null;
    const row = existing || {
      key,
      seat: seat >= 0 ? seat : null,
      area,
      slot: slot || null,
      capability,
      status: "unknown",
      abolished: false,
      available: null,
      permanent: false,
      metadata: {},
      context: mergeTurnContext(state.context, input.context),
      source,
      updatedAt: now()
    };
    if (seat >= 0) row.seat = seat;
    if (area) row.area = area;
    row.slot = slot || row.slot || null;
    row.capability = capability || row.capability;
    if (status) {
      row.status = status;
      row.abolished = status === "abolished";
      row.available = status === "available" ? true : status === "abolished" || status === "disabled" ? false : null;
    }
    if (input.permanent != null) row.permanent = input.permanent === true;
    if (input.metadata != null) row.metadata = cloneJson(input.metadata || {});
    row.context = mergeTurnContext(state.context, input.context || row.context);
    row.source = source;
    row.updatedAt = now();
    state.zoneCapabilities[key] = row;
    const history = {
      index: state.nextZoneCapabilityHistoryIndex++,
      key,
      type: existing ? "update" : "observe",
      before,
      after: cloneJson(row),
      reason: String(input.reason || "zone-capability-observed"),
      source,
      eventIndex: state.nextEventIndex,
      time: now()
    };
    state.zoneCapabilityHistory.push(history);
    recordEvent("zone.capability.observed", {
      key,
      seat: row.seat,
      area: row.area,
      slot: row.slot,
      capability: row.capability,
      status: row.status,
      permanent: row.permanent,
      source
    });
    return cloneJson(row);
  }

  function zoneCapability(keyValue) {
    const key = String(keyValue?.key || keyValue || "").trim();
    return key && state.zoneCapabilities[key] ? cloneJson(state.zoneCapabilities[key]) : null;
  }

  function zoneCapabilities(input = {}) {
    const seat = finiteInteger(input.seat ?? input.seatIndex ?? input.hostSeat, -1);
    const area = String(input.area || input.zoneArea || input.zoneKind || "").trim().toLowerCase();
    const slot = String(input.slot || input.equipmentSlot || input.subtype || "").trim().toLowerCase();
    const capability = String(input.capability || input.name || "").trim().toLowerCase();
    const status = String(input.status || "").trim().toLowerCase();
    return Object.values(state.zoneCapabilities).filter((row) => {
      if (seat >= 0 && row.seat !== seat) return false;
      if (area && row.area !== area) return false;
      if (slot && row.slot !== slot) return false;
      if (capability && row.capability !== capability) return false;
      if (status && row.status !== status) return false;
      if (input.abolished != null && row.abolished !== (input.abolished === true)) return false;
      return true;
    }).sort((left, right) => left.key.localeCompare(right.key)).map(cloneJson);
  }

  function observeEquipmentProjection(input = {}) {
    const key = String(input.key || input.projectionKey || "").trim();
    const projectionKind = String(input.projectionKind || input.kind || "").trim().toLowerCase();
    const hostSeat = finiteInteger(input.hostSeat ?? input.seatIndex ?? input.seat, -1);
    const slot = String(input.slot || input.equipmentSlot || input.subtype || "").trim().toLowerCase();
    const sourceCardId = finiteInteger(input.sourceCardId ?? input.cardId, 0);
    if (!key || !["physical-effective-identity", "virtual-equipment"].includes(projectionKind) || hostSeat < 0 || !slot) {
      return { applied: false, reason: "equipment-projection-identity-required" };
    }
    if (projectionKind === "physical-effective-identity" && sourceCardId <= 0) {
      return { applied: false, reason: "physical-equipment-projection-source-card-required", key };
    }
    if (projectionKind === "virtual-equipment" && sourceCardId > 0) {
      return { applied: false, reason: "virtual-equipment-projection-cannot-own-card-id", key };
    }
    const identity = cloneJson(input.effectiveIdentity || input.equipmentIdentity || input.identity || {});
    if (!identity || typeof identity !== "object" || Array.isArray(identity) || !Object.keys(identity).length) {
      return { applied: false, reason: "equipment-projection-effective-identity-required", key };
    }
    const active = input.active !== false;
    const currentSourceZone = sourceCardId > 0 ? state.locations[sourceCardId]?.zoneKey || "" : "";
    const whileSourceCardInZone = normalizeZoneKey(input.whileSourceCardInZone || input.whileZone)
      || (projectionKind === "physical-effective-identity" ? currentSourceZone : "");
    if (projectionKind === "physical-effective-identity" && active && (
      !currentSourceZone || whileSourceCardInZone && currentSourceZone !== whileSourceCardInZone
    )) {
      return {
        applied: false,
        reason: "physical-equipment-projection-source-location-not-proven",
        key,
        sourceCardId,
        currentSourceZone: currentSourceZone || null,
        whileSourceCardInZone: whileSourceCardInZone || null
      };
    }
    const source = normalizeSource(input.source || sourceOf("equipment-projection", "rule-feedback"), now);
    const existing = state.equipmentProjections[key] || null;
    if (existing) {
      for (const [field, incoming] of [
        ["projectionKind", projectionKind],
        ["hostSeat", hostSeat],
        ["slot", slot],
        ["sourceCardId", sourceCardId > 0 ? sourceCardId : null]
      ]) {
        if (existing[field] !== incoming) {
          contradiction("equipment-projection-key-collision", { key, field, previous: existing[field], observed: incoming, source });
          return { applied: false, reason: "equipment-projection-key-collision", key, field };
        }
      }
    }
    const priorSource = normalizeSource(existing?.source || sourceOf("unobserved-equipment-projection", "unknown"), now);
    if (existing && canonicalJsonKey(existing.effectiveIdentity) !== canonicalJsonKey(identity) && source.authority < priorSource.authority) {
      contradiction("equipment-projection-lower-authority-conflict", {
        key,
        previous: existing.effectiveIdentity,
        observed: identity,
        priorSource,
        source
      });
      return { applied: false, reason: "equipment-projection-lower-authority-conflict", key };
    }
    const before = existing ? cloneJson(existing) : null;
    const row = existing ? cloneJson(existing) : {
      key,
      projectionKind,
      hostSeat,
      slot,
      sourceCardId: sourceCardId > 0 ? sourceCardId : null,
      effectiveIdentity: {},
      occupiesPhysicalSlot: projectionKind === "physical-effective-identity",
      createsPhysicalCard: false,
      whileSourceCardInZone: whileSourceCardInZone || null,
      whileSkillBindingKey: null,
      active: true,
      visibilityAudience: "public-state",
      observerSeats: [],
      metadata: {},
      context: mergeTurnContext(state.context, input.context),
      source,
      createdAt: now(),
      updatedAt: now()
    };
    const beforeSemantic = existing ? canonicalJsonKey(equipmentProjectionSemantic(row)) : null;
    row.effectiveIdentity = identity;
    row.occupiesPhysicalSlot = input.occupiesPhysicalSlot == null
      ? projectionKind === "physical-effective-identity"
      : input.occupiesPhysicalSlot === true;
    row.createsPhysicalCard = false;
    row.whileSourceCardInZone = whileSourceCardInZone || null;
    row.whileSkillBindingKey = stringOrNull(input.whileSkillBindingKey || input.skillBindingKey || row.whileSkillBindingKey);
    row.active = active;
    row.visibilityAudience = String(input.visibilityAudience || input.visibility || row.visibilityAudience || "public-state");
    if (input.observerSeats != null || input.viewerSeats != null) {
      row.observerSeats = uniqueFiniteNumbers(asList(input.observerSeats ?? input.viewerSeats)).sort((left, right) => left - right);
    }
    if (input.metadata != null) row.metadata = cloneJson(input.metadata || {});
    row.context = mergeTurnContext(state.context, input.context || row.context);
    row.source = source;
    row.updatedAt = now();
    const afterSemantic = canonicalJsonKey(equipmentProjectionSemantic(row));
    if (existing && beforeSemantic === afterSemantic) {
      return { applied: true, duplicate: true, projection: cloneJson(existing) };
    }
    state.equipmentProjections[key] = row;
    appendEquipmentProjectionHistory(existing ? "update" : "observe", row, before, source, input.reason);
    recordEvent("equipment.projection.observed", {
      key,
      projectionKind,
      hostSeat,
      slot,
      sourceCardId: row.sourceCardId,
      active: row.active,
      createsPhysicalCard: false,
      source
    });
    return { applied: true, duplicate: false, projection: cloneJson(row) };
  }

  function equipmentProjection(keyValue) {
    const key = String(keyValue?.key || keyValue?.projectionKey || keyValue || "").trim();
    return key && state.equipmentProjections[key] ? cloneJson(state.equipmentProjections[key]) : null;
  }

  function equipmentProjections(input = {}) {
    const projectionKind = String(input.projectionKind || input.kind || "").trim().toLowerCase();
    const hostSeat = finiteInteger(input.hostSeat ?? input.seatIndex ?? input.seat, -1);
    const slot = String(input.slot || input.equipmentSlot || "").trim().toLowerCase();
    const sourceCardId = finiteInteger(input.sourceCardId ?? input.cardId, 0);
    return Object.values(state.equipmentProjections).filter((row) => {
      if (projectionKind && row.projectionKind !== projectionKind) return false;
      if (hostSeat >= 0 && row.hostSeat !== hostSeat) return false;
      if (slot && row.slot !== slot) return false;
      if (sourceCardId > 0 && row.sourceCardId !== sourceCardId) return false;
      if (input.active != null && row.active !== (input.active === true)) return false;
      return true;
    }).sort((left, right) => left.key.localeCompare(right.key)).map(cloneJson);
  }

  function removeEquipmentProjection(input = {}) {
    const key = String(typeof input === "string" ? input : input.key || input.projectionKey || "").trim();
    const sourceCardId = finiteInteger(typeof input === "string" ? null : input.sourceCardId ?? input.cardId, 0);
    const whileSkillBindingKey = String(typeof input === "string" ? "" : input.whileSkillBindingKey || input.skillBindingKey || "").trim();
    const keys = key
      ? [key]
      : Object.entries(state.equipmentProjections).filter(([, row]) => {
        if (sourceCardId > 0 && row.sourceCardId !== sourceCardId) return false;
        if (whileSkillBindingKey && row.whileSkillBindingKey !== whileSkillBindingKey) return false;
        return sourceCardId > 0 || !!whileSkillBindingKey;
      }).map(([value]) => value);
    const reason = String(typeof input === "string" ? "explicit-remove" : input.reason || "explicit-remove");
    const source = normalizeSource(typeof input === "string"
      ? sourceOf("equipment-projection-remove", "rule-feedback")
      : input.source || sourceOf("equipment-projection-remove", "rule-feedback"), now);
    let removed = 0;
    for (const targetKey of keys) {
      const row = state.equipmentProjections[targetKey];
      if (!row) continue;
      appendEquipmentProjectionHistory("remove", row, cloneJson(row), source, reason, null);
      delete state.equipmentProjections[targetKey];
      recordEvent("equipment.projection.removed", {
        key: targetKey,
        projectionKind: row.projectionKind,
        sourceCardId: row.sourceCardId,
        reason,
        source
      });
      removed++;
    }
    return removed;
  }

  function appendEquipmentProjectionHistory(type, row, before, source, reason = "", after = cloneJson(row)) {
    state.equipmentProjectionHistory.push({
      index: state.nextEquipmentProjectionHistoryIndex++,
      key: row.key,
      type,
      before,
      after,
      reason: String(reason || ""),
      source,
      eventIndex: state.nextEventIndex,
      time: now()
    });
    if (state.equipmentProjectionHistory.length > maxEvents) {
      state.equipmentProjectionHistory.splice(0, state.equipmentProjectionHistory.length - maxEvents);
    }
  }

  function equipmentProjectionSemantic(row) {
    const result = cloneJson(row);
    delete result.createdAt;
    delete result.updatedAt;
    delete result.source;
    return result;
  }

  function expireEquipmentProjectionsForCardMove(cardId, fromZone, source = null) {
    const keys = Object.values(state.equipmentProjections).filter((row) =>
      row.sourceCardId === cardId && (!row.whileSourceCardInZone || row.whileSourceCardInZone === fromZone)
    ).map((row) => row.key);
    let removed = 0;
    for (const key of keys) {
      removed += removeEquipmentProjection({
        key,
        reason: `source-card-left:${fromZone}`,
        source: source || sourceOf("equipment-projection-source-move", "rule-feedback")
      });
    }
    return removed;
  }

  function observeEntityPile(input = {}) {
    const key = String(input.key || input.pileKey || "").trim();
    const entityType = String(input.entityType || "entity").trim();
    if (!key || !entityType) return null;
    const ids = uniquePositiveIds(input.entityIds || input.ids);
    const count = Math.max(nonNegativeIntegerOrNull(input.count) ?? ids.length, ids.length);
    const source = normalizeSource(input.source || sourceOf("entity-pile-observation", "runtime-public"), now);
    const pile = ensureEntityPile(key, entityType);
    if (pile.entityType !== entityType) {
      contradiction("entity-pile-type-conflict", { key, expected: pile.entityType, observed: entityType, source });
      return null;
    }
    if (input.replace !== false) {
      for (const id of pile.exactIds) clearEntityLocation(entityType, id, key);
      pile.exactIds = [];
    }
    for (const id of ids) placeEntity(entityType, id, key, source);
    pile.count = count;
    pile.complete = input.complete === true || (count === ids.length && input.complete !== false);
    pile.visibility = String(input.visibility || pile.visibility || "unknown");
    pile.source = source;
    pile.updatedAt = now();
    const history = {
      index: state.nextEntityPileHistoryIndex++,
      type: "observe",
      key,
      entityType,
      count,
      exactIds: ids,
      complete: pile.complete,
      source,
      time: now()
    };
    state.entityPileHistory.push(history);
    recordEvent("entity.pile.observed", history);
    return compactEntityPile(pile);
  }

  function moveEntityPile(input = {}) {
    const fromKey = String(input.from || input.fromPile || "").trim();
    const toKey = String(input.to || input.toPile || "").trim();
    const entityType = String(input.entityType || state.entityPiles[fromKey]?.entityType || "entity").trim();
    const ids = uniquePositiveIds(input.entityIds || input.ids);
    const count = Math.max(nonNegativeIntegerOrNull(input.count) ?? ids.length, ids.length);
    if (!fromKey || !toKey || fromKey === toKey || !entityType) return null;
    const source = normalizeSource(input.source || sourceOf("entity-pile-move", "server-protocol"), now);
    const from = ensureEntityPile(fromKey, entityType);
    const to = ensureEntityPile(toKey, entityType);
    if (from.entityType !== entityType || to.entityType !== entityType) {
      contradiction("entity-pile-type-conflict", { fromKey, toKey, entityType, source });
      return null;
    }
    for (const id of ids) {
      from.exactIds = from.exactIds.filter((value) => value !== id);
      clearEntityLocation(entityType, id, fromKey);
      placeEntity(entityType, id, toKey, source);
    }
    if (count > ids.length) {
      for (const id of from.exactIds) clearEntityLocation(entityType, id, fromKey);
      from.exactIds = [];
      from.complete = false;
      to.complete = false;
    }
    from.count = from.count == null ? null : Math.max(0, from.count - count);
    to.count = to.count == null ? count : to.count + count;
    from.source = source;
    to.source = source;
    from.updatedAt = now();
    to.updatedAt = now();
    const history = {
      index: state.nextEntityPileHistoryIndex++,
      type: "move",
      entityType,
      from: fromKey,
      to: toKey,
      count,
      exactIds: ids,
      unknownCount: Math.max(0, count - ids.length),
      source,
      time: now()
    };
    state.entityPileHistory.push(history);
    recordEvent("entity.pile.move", history);
    return { ...history, fromPile: compactEntityPile(from), toPile: compactEntityPile(to) };
  }

  function entityPile(keyValue) {
    const key = String(keyValue || "").trim();
    return state.entityPiles[key] ? compactEntityPile(state.entityPiles[key]) : null;
  }

  function ensureEntityPile(key, entityType) {
    if (!state.entityPiles[key]) {
      state.entityPiles[key] = {
        key,
        entityType,
        count: 0,
        exactIds: [],
        complete: true,
        visibility: "unknown",
        source: null,
        updatedAt: now()
      };
    }
    return state.entityPiles[key];
  }

  function placeEntity(entityType, id, pileKey, source) {
    state.entityLocations[entityType] ||= {};
    const previousKey = state.entityLocations[entityType][id]?.pileKey || null;
    if (previousKey && previousKey !== pileKey && state.entityPiles[previousKey]) {
      const previous = state.entityPiles[previousKey];
      previous.exactIds = previous.exactIds.filter((value) => value !== id);
      if (previous.count != null) previous.count = Math.max(0, previous.count - 1);
    }
    const pile = ensureEntityPile(pileKey, entityType);
    if (!pile.exactIds.includes(id)) pile.exactIds.push(id);
    state.entityLocations[entityType][id] = {
      entityType,
      entityId: id,
      pileKey,
      previousPileKey: previousKey,
      source: normalizeSource(source, now),
      observedAt: now()
    };
  }

  function clearEntityLocation(entityType, id, expectedPileKey) {
    if (state.entityLocations[entityType]?.[id]?.pileKey === expectedPileKey) {
      delete state.entityLocations[entityType][id];
    }
  }

  function compactEntityPile(pile) {
    return {
      key: pile.key,
      entityType: pile.entityType,
      count: pile.count,
      exactIds: pile.exactIds.slice(),
      unknownCount: Math.max(0, Number(pile.count || 0) - pile.exactIds.length),
      complete: pile.complete,
      visibility: pile.visibility,
      source: pile.source,
      updatedAt: pile.updatedAt
    };
  }

  function observePhysicalPile(input = {}) {
    const key = String(input.key || input.pileKey || "").trim();
    if (!key) return null;
    const zoneKey = physicalPileZoneKey(key);
    const listedIds = uniquePositiveIds(input.cardIds || input.ids);
    const top = uniquePositiveIds(input.topCardIds || input.top);
    const bottom = uniquePositiveIds(input.bottomCardIds || input.bottom);
    const ids = uniquePositiveIds([...listedIds, ...top, ...bottom]);
    const count = Math.max(nonNegativeIntegerOrNull(input.count) ?? ids.length, ids.length);
    const complete = input.complete === true || (count === ids.length && input.complete !== false);
    if (input.complete === true && count !== ids.length) {
      contradiction("physical-pile-complete-count-conflict", { key, count, exactIds: ids });
      return null;
    }
    const endpointConflict = physicalPileEndpointConflict(count, top, bottom);
    if (endpointConflict) {
      contradiction("physical-pile-endpoint-conflict", { key, count, top, bottom, conflict: endpointConflict });
      return null;
    }
    const source = normalizeSource(input.source || sourceOf("physical-pile-observation", "server-protocol"), now);
    registerDynamicIds(ids);
    const zone = observeZone({
      zoneKey,
      count,
      cardIds: ids,
      complete,
      visibility: input.visibility,
      replace: input.replace !== false,
      context: input.context,
      reason: input.reason || "physical-pile-observation",
      source
    });
    const pile = ensurePhysicalPile(key);
    pile.count = zone.count;
    pile.exactIds = zone.exactIds.slice();
    pile.complete = zone.complete;
    pile.top = top;
    pile.bottom = bottom;
    pile.topSource = top.length ? source : null;
    pile.bottomSource = bottom.length ? source : null;
    pile.visibility = String(input.visibility || pile.visibility || "unknown");
    pile.pileKind = String(input.pileKind || pile.pileKind || "independent-physical-card-pile");
    pile.recyclePolicy = String(input.recyclePolicy || pile.recyclePolicy || "server-authoritative-no-main-discard-recycle");
    pile.metadata = cloneJson(input.metadata ?? pile.metadata ?? {});
    pile.source = source;
    pile.updatedAt = now();
    appendPhysicalPileHistory("observe", pile, { source, reason: input.reason });
    recordEvent("physical.pile.observed", {
      key,
      zoneKey,
      count: pile.count,
      exactIds: pile.exactIds,
      complete: pile.complete,
      top,
      bottom,
      recyclePolicy: pile.recyclePolicy,
      source
    });
    return compactPhysicalPile(pile);
  }

  function takeFromPhysicalPile(input = {}) {
    const key = String(input.key || input.pileKey || "").trim();
    const pile = state.physicalPiles[key];
    const to = normalizeZoneKey(input.to || input.destination);
    if (!pile || !to || to === pile.zoneKey) return null;
    const endpoint = ["top", "bottom"].includes(input.endpoint) ? input.endpoint : "random";
    const listedIds = uniquePositiveIds(input.cardIds || input.ids);
    const count = Math.max(nonNegativeIntegerOrNull(input.count) ?? listedIds.length, listedIds.length);
    if (count <= 0 || pile.count != null && count > pile.count) return null;
    const previousCount = pile.count;
    const known = endpoint === "random" ? [] : pile[endpoint].slice(0, count);
    const ids = listedIds.length ? listedIds : known.length === count ? known : [];
    if (pile.complete && ids.some((id) => !pile.exactIds.includes(id))) {
      contradiction("physical-pile-take-identity-not-member", { key, endpoint, cardIds: ids, exactIds: pile.exactIds });
      return null;
    }
    const source = normalizeSource(input.source || sourceOf("physical-pile-take", "server-protocol"), now);
    if (endpoint !== "random" && ids.length && pile[endpoint].length) {
      const compared = Math.min(ids.length, count, pile[endpoint].length);
      if (pile[endpoint].slice(0, compared).some((id, index) => id !== ids[index])) {
        contradiction("physical-pile-endpoint-mismatch", {
          key,
          endpoint,
          expected: pile[endpoint].slice(0, compared),
          observed: ids.slice(0, compared),
          source
        });
        pile.top = [];
        pile.bottom = [];
        pile.topSource = null;
        pile.bottomSource = null;
      }
    }
    const move = observeMove({
      from: pile.zoneKey,
      to,
      count,
      cardIds: ids,
      context: input.context,
      causalEventId: input.causalEventId || input.eventId,
      movementReason: input.movementReason || "physical-pile-take",
      reasonTags: ["independent-physical-pile", ...asList(input.reasonTags)],
      skillId: input.skillId,
      source,
      reason: input.reason || "physical-pile-take"
    });
    if (!move || move.status === "unsupported") return move;
    consumePhysicalPileOrder(pile, endpoint, ids, count, previousCount);
    syncPhysicalPileFromZone(pile, source);
    appendPhysicalPileHistory("take", pile, { source, reason: input.reason, count, cardIds: ids, endpoint, to });
    recordEvent("physical.pile.take", {
      key,
      from: pile.zoneKey,
      to,
      count,
      cardIds: ids,
      unknownCount: Math.max(0, count - ids.length),
      endpoint,
      pileEpoch: pile.epoch,
      mainDeckEpoch: state.epoch,
      source
    });
    return { status: "applied", key, endpoint, count, cardIds: ids, to, move, pile: compactPhysicalPile(pile) };
  }

  function putIntoPhysicalPile(input = {}) {
    const key = String(input.key || input.pileKey || "").trim();
    const from = normalizeZoneKey(input.from || input.sourceZone);
    if (!key || !from) return null;
    const pile = ensurePhysicalPile(key);
    if (from === pile.zoneKey) return null;
    const endpoint = ["top", "bottom"].includes(input.endpoint) ? input.endpoint : "random";
    const ids = uniquePositiveIds(input.cardIds || input.ids);
    const count = Math.max(nonNegativeIntegerOrNull(input.count) ?? ids.length, ids.length);
    if (count <= 0) return null;
    const source = normalizeSource(input.source || sourceOf("physical-pile-put", "server-protocol"), now);
    registerDynamicIds(ids);
    const move = observeMove({
      from,
      to: pile.zoneKey,
      count,
      cardIds: ids,
      context: input.context,
      causalEventId: input.causalEventId || input.eventId,
      movementReason: input.movementReason || "physical-pile-put",
      reasonTags: ["independent-physical-pile", ...asList(input.reasonTags)],
      skillId: input.skillId,
      source,
      reason: input.reason || "physical-pile-put"
    });
    if (!move || move.status === "unsupported") return move;
    addPhysicalPileOrder(pile, endpoint, ids, count);
    syncPhysicalPileFromZone(pile, source);
    appendPhysicalPileHistory("put", pile, { source, reason: input.reason, count, cardIds: ids, endpoint, from });
    recordEvent("physical.pile.put", {
      key,
      from,
      to: pile.zoneKey,
      count,
      cardIds: ids,
      unknownCount: Math.max(0, count - ids.length),
      endpoint,
      pileEpoch: pile.epoch,
      mainDeckEpoch: state.epoch,
      source
    });
    return { status: "applied", key, endpoint, count, cardIds: ids, from, move, pile: compactPhysicalPile(pile) };
  }

  function shufflePhysicalPile(input = {}) {
    const key = String(typeof input === "string" ? input : input.key || input.pileKey || "").trim();
    const pile = state.physicalPiles[key];
    if (!pile) return null;
    const source = normalizeSource(typeof input === "string"
      ? sourceOf("physical-pile-shuffle", "server-protocol")
      : input.source || sourceOf("physical-pile-shuffle", "server-protocol"), now);
    pile.epoch++;
    pile.shuffleCount++;
    pile.top = [];
    pile.bottom = [];
    pile.topSource = null;
    pile.bottomSource = null;
    pile.source = source;
    pile.updatedAt = now();
    appendPhysicalPileHistory("shuffle", pile, { source, reason: typeof input === "string" ? "explicit-shuffle" : input.reason });
    recordEvent("physical.pile.shuffle", {
      key,
      pileEpoch: pile.epoch,
      shuffleCount: pile.shuffleCount,
      mainDeckEpoch: state.epoch,
      includeMainDiscard: false,
      source
    });
    return compactPhysicalPile(pile);
  }

  function physicalPile(keyValue) {
    const key = String(keyValue || "").trim();
    return state.physicalPiles[key] ? compactPhysicalPile(state.physicalPiles[key]) : null;
  }

  function physicalPileHistory(input = {}) {
    const key = String(input.key || input.pileKey || "").trim();
    const operation = String(input.operation || input.type || "").trim();
    return state.physicalPileHistory.filter((row) => {
      if (key && row.key !== key) return false;
      if (operation && row.operation !== operation) return false;
      return true;
    }).map(cloneJson);
  }

  function physicalPileNextProbability(input = {}) {
    const key = String(input.key || input.pileKey || "").trim();
    const pile = state.physicalPiles[key];
    const endpoint = input.endpoint === "bottom" ? "bottom" : "top";
    if (!pile) return unavailablePhysicalPileProbability(key, endpoint, "physical-pile-unknown");
    if (pile.count === 0) return unavailablePhysicalPileProbability(key, endpoint, "physical-pile-empty", 0);
    const known = pile[endpoint][0];
    if (known) {
      return {
        ...probabilityResult({
          endpoint,
          exact: true,
          physicalDeckCount: pile.count,
          weights: new Map([[known, 1]]),
          cards: [normalizedCardForId(known)],
          assumption: "known-independent-pile-endpoint"
        }),
        physicalPileKey: key,
        physicalPileEpoch: pile.epoch,
        mainDeck: false
      };
    }
    if (!pile.complete || pile.count == null || pile.exactIds.length !== pile.count) {
      return unavailablePhysicalPileProbability(key, endpoint, "independent-pile-membership-incomplete", pile.count);
    }
    const probability = pile.exactIds.length ? 1 / pile.exactIds.length : 0;
    return {
      ...probabilityResult({
        endpoint,
        exact: false,
        physicalDeckCount: pile.count,
        weights: new Map(pile.exactIds.map((id) => [id, probability])),
        cards: pile.exactIds.map(normalizedCardForId),
        assumption: "uniform-shuffled-complete-independent-pile"
      }),
      physicalPileKey: key,
      physicalPileEpoch: pile.epoch,
      mainDeck: false
    };
  }

  function unavailablePhysicalPileProbability(key, endpoint, reason, count = null) {
    return {
      available: false,
      exact: false,
      endpoint,
      reason,
      physicalPileKey: key || null,
      physicalPileEpoch: state.physicalPiles[key]?.epoch ?? null,
      physicalDeckCount: count,
      candidateCount: 0,
      assumption: "none",
      mainDeck: false,
      cards: [],
      distributions: emptyDistributions()
    };
  }

  function ensurePhysicalPile(key) {
    if (!state.physicalPiles[key]) {
      state.physicalPiles[key] = {
        key,
        zoneKey: physicalPileZoneKey(key),
        pileKind: "independent-physical-card-pile",
        count: 0,
        exactIds: [],
        complete: true,
        top: [],
        bottom: [],
        topSource: null,
        bottomSource: null,
        epoch: 0,
        shuffleCount: 0,
        recyclePolicy: "server-authoritative-no-main-discard-recycle",
        visibility: "unknown",
        metadata: {},
        source: null,
        updatedAt: now()
      };
    }
    ensureZone(state.physicalPiles[key].zoneKey);
    return state.physicalPiles[key];
  }

  function compactPhysicalPile(pile) {
    return {
      key: pile.key,
      zoneKey: pile.zoneKey,
      pileKind: pile.pileKind,
      count: pile.count,
      exactIds: pile.exactIds.slice(),
      unknownCount: Math.max(0, Number(pile.count || 0) - pile.exactIds.length),
      complete: pile.complete,
      top: pile.top.slice(),
      bottom: pile.bottom.slice(),
      topSource: cloneJson(pile.topSource),
      bottomSource: cloneJson(pile.bottomSource),
      epoch: pile.epoch,
      shuffleCount: pile.shuffleCount,
      recyclePolicy: pile.recyclePolicy,
      visibility: pile.visibility,
      metadata: cloneJson(pile.metadata),
      source: cloneJson(pile.source),
      updatedAt: pile.updatedAt
    };
  }

  function syncPhysicalPileFromZone(pile, source) {
    const zone = ensureZone(pile.zoneKey);
    pile.count = zone.count;
    pile.exactIds = zone.exactIds.slice();
    pile.complete = zone.complete;
    pile.source = normalizeSource(source || pile.source || sourceOf("physical-pile-sync", "rule-feedback"), now);
    pile.updatedAt = now();
    if (pile.count === 0) {
      pile.top = [];
      pile.bottom = [];
      pile.topSource = null;
      pile.bottomSource = null;
    } else {
      pile.top = pile.top.filter((id) => pile.exactIds.includes(id)).slice(0, pile.count);
      pile.bottom = pile.bottom.filter((id) => pile.exactIds.includes(id)).slice(0, pile.count);
    }
  }

  function consumePhysicalPileOrder(pile, endpoint, ids, count, previousCount) {
    if (endpoint === "random") {
      if (count > ids.length) {
        pile.top = [];
        pile.bottom = [];
        pile.topSource = null;
        pile.bottomSource = null;
      } else {
        pile.top = pile.top.filter((id) => !ids.includes(id));
        pile.bottom = pile.bottom.filter((id) => !ids.includes(id));
      }
      return;
    }
    pile[endpoint] = pile[endpoint].slice(Math.min(count, pile[endpoint].length));
    pile.top = pile.top.filter((id) => !ids.includes(id));
    pile.bottom = pile.bottom.filter((id) => !ids.includes(id));
    const remainingCount = previousCount == null ? null : Math.max(0, previousCount - count);
    if (remainingCount != null) {
      pile.top = pile.top.slice(0, remainingCount);
      pile.bottom = pile.bottom.slice(0, remainingCount);
    }
  }

  function addPhysicalPileOrder(pile, endpoint, ids, count) {
    pile.top = pile.top.filter((id) => !ids.includes(id));
    pile.bottom = pile.bottom.filter((id) => !ids.includes(id));
    if (endpoint === "random" || count > ids.length) {
      pile.top = [];
      pile.bottom = [];
      pile.topSource = null;
      pile.bottomSource = null;
      return;
    }
    pile[endpoint] = [...ids, ...pile[endpoint]];
  }

  function appendPhysicalPileHistory(operation, pile, extra = {}) {
    const row = {
      index: state.nextPhysicalPileHistoryIndex++,
      operation,
      key: pile.key,
      zoneKey: pile.zoneKey,
      count: pile.count,
      exactIds: pile.exactIds.slice(),
      top: pile.top.slice(),
      bottom: pile.bottom.slice(),
      pileEpoch: pile.epoch,
      mainDeckEpoch: state.epoch,
      movementCount: nonNegativeIntegerOrNull(extra.count),
      movementCardIds: uniquePositiveIds(extra.cardIds),
      endpoint: extra.endpoint || null,
      from: extra.from || null,
      to: extra.to || null,
      reason: String(extra.reason || ""),
      source: normalizeSource(extra.source || pile.source || sourceOf("physical-pile-history", "rule-feedback"), now),
      context: { ...state.context },
      eventIndex: state.nextEventIndex,
      time: now()
    };
    state.physicalPileHistory.push(row);
    if (state.physicalPileHistory.length > maxEvents) {
      state.physicalPileHistory.splice(0, state.physicalPileHistory.length - maxEvents);
    }
    return row;
  }

  function observeLocationGroup(input = {}) {
    const cardIds = uniquePositiveIds(input.cardIds || input.ids);
    let zoneKeys = uniqueStrings(asList(input.zoneKeys || input.zones)
      .map((value) => normalizeZoneKey(value))
      .filter(Boolean));
    if (!cardIds.length || !zoneKeys.length) return null;
    const source = normalizeSource(input.source || sourceOf("location-group-observation", "rule-feedback"), now);
    const key = String(input.key || input.groupKey || `location-group:${state.nextLocationGroupId++}`).trim();
    if (!key) return null;
    const exactLocatedIds = cardIds.filter((cardId) => state.locations[cardId]?.zoneKey);
    if (exactLocatedIds.length) {
      contradiction("location-group-includes-exact-location", { cardIds, zoneKeys, exactLocatedIds, source });
      return null;
    }
    const overlappingGroups = Object.values(state.locationGroups).filter((row) => row.key !== key && row.cardIds.some((cardId) => cardIds.includes(cardId)));
    if (overlappingGroups.length) {
      contradiction("location-group-overlap-not-supported", {
        cardIds,
        zoneKeys,
        overlappingGroupKeys: overlappingGroups.map((row) => row.key),
        source
      });
      return null;
    }
    const hasZoneCounts = input.zoneCounts != null;
    const zoneCounts = normalizeLocationGroupCounts(input.zoneCounts, zoneKeys);
    if (hasZoneCounts && !zoneCounts) {
      contradiction("location-group-counts-invalid", { cardIds, zoneKeys, zoneCounts: input.zoneCounts, source });
      return null;
    }
    if (zoneCounts && Object.values(zoneCounts).reduce((sum, value) => sum + value, 0) !== cardIds.length) {
      contradiction("location-group-count-mismatch", { cardIds, zoneKeys, zoneCounts, source });
      return null;
    }
    if (zoneCounts) {
      for (const zoneKey of Object.keys(zoneCounts)) {
        if (zoneCounts[zoneKey] === 0) delete zoneCounts[zoneKey];
      }
      zoneKeys = zoneKeys.filter((zoneKey) => zoneCounts[zoneKey] > 0);
      if (!zoneKeys.length) return null;
    }
    registerDynamicIds(cardIds);
    if (state.locationGroups[key]) invalidateLocationGroup({ key, reason: "replaced-observation", source });
    const row = {
      id: state.nextLocationGroupRowId++,
      key,
      cardIds,
      zoneKeys,
      zoneCounts,
      selectionModel: normalizeSelectionModel(input.selectionModel || (input.uniformSelection === true ? "uniform" : "unknown")),
      complete: input.complete !== false,
      context: mergeTurnContext(state.context, input.context),
      metadata: cloneJson(input.metadata || {}),
      source,
      active: true,
      createdAt: now(),
      createdEventIndex: state.nextEventIndex,
      updatedAt: now()
    };
    state.locationGroups[key] = row;
    appendLocationGroupHistory("observe", row, { source, reason: input.reason });
    recordEvent("location.group.observed", {
      key,
      cardIds,
      zoneKeys,
      zoneCounts,
      source
    });
    return cloneJson(row);
  }

  function locationGroup(keyValue) {
    const key = String(keyValue || "").trim();
    return key && state.locationGroups[key] ? cloneJson(state.locationGroups[key]) : null;
  }

  function activeLocationGroups(input = {}) {
    const cardId = finiteInteger(input.cardId ?? input.id, 0);
    const zoneKey = normalizeZoneKey(input.zoneKey || input.zone);
    return Object.values(state.locationGroups).filter((row) => {
      if (!row.active) return false;
      if (cardId > 0 && !row.cardIds.includes(cardId)) return false;
      if (zoneKey && !row.zoneKeys.includes(zoneKey)) return false;
      return true;
    }).sort((left, right) => left.id - right.id).map(cloneJson);
  }

  function invalidateLocationGroup(input = {}) {
    const key = String(typeof input === "string" ? input : input.key || input.groupKey || "").trim();
    const row = state.locationGroups[key];
    if (!row) return false;
    const reason = String(typeof input === "string" ? "explicit-invalidate" : input.reason || "explicit-invalidate");
    const source = normalizeSource(typeof input === "string"
      ? sourceOf("location-group-invalidate", "rule-feedback")
      : input.source || sourceOf("location-group-invalidate", "rule-feedback"), now);
    appendLocationGroupHistory("invalidate", row, { before: cloneJson(row), source, reason });
    delete state.locationGroups[key];
    recordEvent("location.group.invalidated", { key, reason, source });
    return true;
  }

  function appendLocationGroupHistory(operation, row, extra = {}) {
    state.locationGroupHistory.push({
      index: state.nextLocationGroupHistoryIndex++,
      operation,
      key: row.key,
      cardIds: row.cardIds.slice(),
      zoneKeys: row.zoneKeys.slice(),
      zoneCounts: cloneJson(row.zoneCounts),
      before: extra.before || null,
      after: operation === "invalidate" ? null : cloneJson(row),
      reason: String(extra.reason || ""),
      source: normalizeSource(extra.source || row.source || sourceOf("location-group-history", "rule-feedback"), now),
      context: { ...state.context },
      eventIndex: state.nextEventIndex,
      time: now()
    });
  }

  function resolveLocationGroupCard(cardIdValue, resolvedZoneKey, source, reason = "exact-location-resolved") {
    const cardId = finiteInteger(cardIdValue, 0);
    if (cardId <= 0) return 0;
    let resolved = 0;
    for (const [key, row] of Object.entries(state.locationGroups)) {
      if (!row.cardIds.includes(cardId)) continue;
      const before = cloneJson(row);
      row.cardIds = row.cardIds.filter((value) => value !== cardId);
      if (row.zoneCounts) {
        const zoneKey = normalizeZoneKey(resolvedZoneKey);
        if (zoneKey && row.zoneCounts[zoneKey] > 0) row.zoneCounts[zoneKey]--;
        else row.zoneCounts = null;
      }
      row.updatedAt = now();
      row.source = normalizeSource(source || row.source, now);
      if (!row.cardIds.length) {
        appendLocationGroupHistory("resolve", row, { before, source: row.source, reason });
        delete state.locationGroups[key];
      } else {
        appendLocationGroupHistory("resolve", row, { before, source: row.source, reason });
      }
      resolved++;
    }
    return resolved;
  }

  function updateLocationGroupsForMove(from, to, resolvedIds, count, source) {
    const ids = uniquePositiveIds(resolvedIds);
    const unknownCount = Math.max(0, count - ids.length);
    const sourceCountBefore = nonNegativeIntegerOrNull(state.zones[from]?.count);
    for (const [key, initialRow] of Object.entries(state.locationGroups)) {
      const knownGroupIds = ids.filter((cardId) => initialRow.cardIds.includes(cardId));
      const knownNonGroupCount = ids.length - knownGroupIds.length;
      const groupCountBefore = initialRow.zoneCounts ? nonNegativeIntegerOrNull(initialRow.zoneCounts[from]) : null;
      for (const cardId of knownGroupIds) {
        resolveLocationGroupCard(cardId, from, source, `known-move:${from}->${to}`);
      }
      const row = state.locationGroups[key];
      if (!row || unknownCount <= 0 || !from || !row.zoneKeys.includes(from)) continue;
      const before = cloneJson(row);
      const normalizedSource = normalizeSource(source || row.source, now);
      const remainingGroupInSource = row.zoneCounts ? nonNegativeIntegerOrNull(row.zoneCounts[from]) : null;
      const nonGroupBefore = sourceCountBefore != null && groupCountBefore != null
        ? Math.max(0, sourceCountBefore - groupCountBefore)
        : null;
      const remainingNonGroup = nonGroupBefore == null ? null : Math.max(0, nonGroupBefore - knownNonGroupCount);
      const exactGroupTransfer =
        !!to &&
        row.zoneCounts != null &&
        remainingGroupInSource != null &&
        nonGroupBefore != null &&
        knownNonGroupCount <= nonGroupBefore &&
        remainingNonGroup === 0 &&
        unknownCount <= remainingGroupInSource;
      row.zoneKeys = uniqueStrings([...row.zoneKeys, to].filter(Boolean));
      row.selectionModel = "unknown";
      if (exactGroupTransfer) {
        row.zoneCounts[from] = remainingGroupInSource - unknownCount;
        row.zoneCounts[to] = (row.zoneCounts[to] || 0) + unknownCount;
        if (row.zoneCounts[from] === 0) {
          delete row.zoneCounts[from];
          row.zoneKeys = row.zoneKeys.filter((zoneKey) => zoneKey !== from);
        }
      } else {
        row.zoneCounts = null;
      }
      row.updatedAt = now();
      row.source = normalizedSource;
      appendLocationGroupHistory(exactGroupTransfer ? "transfer" : "widen", row, {
        before,
        source: row.source,
        reason: `unknown-move:${from}->${to}`
      });
      materializeSingletonLocationGroup(row, row.source);
    }
  }

  function reconcileLocationGroupsAfterZoneObservation(zoneKey, complete, source) {
    if (!complete || !zoneKey) return;
    for (const [key, row] of Object.entries(state.locationGroups)) {
      if (!row.zoneKeys.includes(zoneKey)) continue;
      const before = cloneJson(row);
      row.zoneKeys = row.zoneKeys.filter((value) => value !== zoneKey);
      row.zoneCounts = null;
      row.updatedAt = now();
      row.source = normalizeSource(source || row.source, now);
      if (!row.zoneKeys.length) {
        contradiction("location-group-exhausted-by-complete-observation", {
          key,
          cardIds: row.cardIds,
          observedZone: zoneKey,
          source: row.source
        });
        appendLocationGroupHistory("invalidate", row, {
          before,
          source: row.source,
          reason: `complete-zone-observation:${zoneKey}`
        });
        delete state.locationGroups[key];
      } else {
        appendLocationGroupHistory("narrow", row, {
          before,
          source: row.source,
          reason: `complete-zone-observation:${zoneKey}`
        });
        materializeSingletonLocationGroup(row, row.source);
      }
    }
  }

  function materializeSingletonLocationGroup(row, source) {
    if (!row || row.zoneKeys.length !== 1 || !row.cardIds.length) return 0;
    const zoneKey = row.zoneKeys[0];
    const cardIds = row.cardIds.slice();
    for (const cardId of cardIds) placeExactCard(cardId, zoneKey, source, { silent: true });
    const zone = ensureZone(zoneKey);
    if (zone.count === zone.exactIds.length) zone.complete = true;
    syncSpecialZone(zoneKey, {
      reason: "location-group-materialized",
      knowledgeOnly: true,
      membershipChanged: false
    });
    recordEvent("location.group.materialized", { key: row.key, zoneKey, cardIds, source: normalizeSource(source, now) });
    return cardIds.length;
  }

  function remapLocationGroupsForZoneExchange(leftZoneKey, rightZoneKey, source, atomicOperationId) {
    const remappedKeys = [];
    const swapZone = (zoneKey) => zoneKey === leftZoneKey
      ? rightZoneKey
      : zoneKey === rightZoneKey
        ? leftZoneKey
        : zoneKey;
    for (const row of Object.values(state.locationGroups)) {
      if (!row.zoneKeys.includes(leftZoneKey) && !row.zoneKeys.includes(rightZoneKey)) continue;
      const before = cloneJson(row);
      row.zoneKeys = uniqueStrings(row.zoneKeys.map(swapZone));
      if (row.zoneCounts) {
        const nextCounts = {};
        for (const [zoneKey, count] of Object.entries(row.zoneCounts)) {
          const nextZoneKey = swapZone(zoneKey);
          nextCounts[nextZoneKey] = (nextCounts[nextZoneKey] || 0) + count;
        }
        row.zoneCounts = nextCounts;
      }
      row.updatedAt = now();
      row.source = normalizeSource(source || row.source, now);
      appendLocationGroupHistory("zone-exchange", row, {
        before,
        source: row.source,
        reason: atomicOperationId
      });
      remappedKeys.push(row.key);
    }
    return remappedKeys;
  }

  function ambiguousLocationGroupForMove(from, to, sourceZone, resolvedIds, count) {
    if (!from || !to || from === to || [ZONE.DECK, ZONE.SHUFFLE].includes(from)) return null;
    if (!sourceZone || sourceZone.complete !== true || sourceZone.count !== sourceZone.exactIds.length) return null;
    const ids = uniquePositiveIds(resolvedIds);
    if (count <= ids.length || count >= sourceZone.count || ids.some((id) => !sourceZone.exactIds.includes(id))) return null;
    const cardIds = sourceZone.exactIds.filter((id) => !ids.includes(id));
    const zoneCounts = {
      [from]: sourceZone.count - count,
      [to]: count - ids.length
    };
    if (!cardIds.length || Object.values(zoneCounts).reduce((sum, value) => sum + value, 0) !== cardIds.length) return null;
    return { cardIds, zoneKeys: [from, to], zoneCounts };
  }

  function normalizeLocationGroupCounts(value, zoneKeys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const normalizedInputKeys = Object.keys(value).map((key) => normalizeZoneKey(key)).filter(Boolean);
    if (normalizedInputKeys.some((key) => !zoneKeys.includes(key))) return null;
    const result = {};
    for (const zoneKey of zoneKeys) {
      const count = nonNegativeIntegerOrNull(value[zoneKey]);
      if (count == null) return null;
      result[zoneKey] = count;
    }
    return result;
  }

  function appendCardEvent(detail = {}) {
    const cardId = finiteInteger(detail.cardId, 0);
    if (cardId <= 0) return null;
    const row = {
      index: state.nextCardEventIndex++,
      ...cloneJson(detail),
      cardId,
      tags: uniqueStrings(detail.tags || []),
      createdAt: now()
    };
    state.cardEventHistory.push(row);
    return row;
  }

  function appendMovementCardEvents(detail = {}) {
    const cardIds = uniquePositiveIds(detail.cardIds);
    if (!cardIds.length) return [];
    const from = normalizeZoneKey(detail.from);
    const to = normalizeZoneKey(detail.to);
    const context = mergeTurnContext(state.context, detail.context);
    const causalEventId = stringOrNull(detail.causalEventId ?? context.causalEventId);
    const movementReason = normalizeMovementReason(detail.movementReason || detail.reasonKind || detail.reason);
    const reasonTags = uniqueStrings(asList(detail.reasonTags));
    const tags = uniqueStrings([
      "moved",
      from ? `from:${from}` : "",
      to ? `to:${to}` : "",
      from === ZONE.DECK && to?.startsWith("hand:") ? "gained-from-deck" : "",
      to === ZONE.DISCARD ? "entered-discard" : "",
      from === ZONE.DISCARD ? "left-discard" : "",
      movementReason ? `reason:${movementReason}` : "",
      ...reasonTags,
      ...asList(detail.tags)
    ]);
    const cardDetails = normalizeMovementCardDetails(detail.cardDetails || detail.perCard, cardIds);
    return cardIds.map((cardId, cardIndex) => {
      const cardDetail = cardDetails.find((item) => item.cardId === cardId) || {};
      return appendCardEvent({
      eventIndex: state.nextEventIndex,
      eventType: "card:move",
      protocol: detail.protocol || "",
      recordIndex: detail.recordIndex ?? null,
      cardId,
      physicalGeneration: physicalCardGeneration(cardId),
      skillId: finiteInteger(detail.skillId, 0) || null,
      causalEventId,
      movementId: stringOrNull(detail.movementId),
      movementGroupId: stringOrNull(detail.movementGroupId),
      movementAttemptId: stringOrNull(detail.movementAttemptId),
      sequenceIndex: nonNegativeIntegerOrNull(cardDetail.sequenceIndex ?? detail.sequenceIndex),
      cardSequenceIndex: nonNegativeIntegerOrNull(cardDetail.cardSequenceIndex ?? cardDetail.index ?? cardIndex),
      sourceSlot: stringOrNull(cardDetail.sourceSlot ?? cardDetail.fromSlot),
      destinationSlot: stringOrNull(cardDetail.destinationSlot ?? cardDetail.toSlot),
      movementReason,
      moveType: finiteNumber(detail.moveType),
      reasonTags,
      from,
      to,
      tags,
      context,
      printedCard: normalizedCardForId(cardId),
      effectiveCard: effectiveCard(cardId, { causalEventId }).effective,
      metadata: { ...cloneJson(detail.metadata || {}), ...cloneJson(cardDetail.metadata || {}) },
      source: normalizeSource(detail.source || sourceOf("card-movement", "rule-feedback"), now)
      });
    });
  }

  function cardResidence(cardIdValue) {
    const cardId = finiteInteger(cardIdValue, 0);
    if (cardId <= 0) return { cardId, current: null, history: [] };
    return {
      cardId,
      current: state.locations[cardId] ? cloneJson(state.locations[cardId]) : null,
      history: state.locationHistory.filter((row) => row.cardId === cardId).map(cloneJson)
    };
  }

  function cardLocationAt(input = {}) {
    const cardId = finiteInteger(input.cardId ?? input.id, 0);
    const eventIndex = nonNegativeIntegerOrNull(input.eventIndex);
    const time = finiteNumber(input.time);
    const moment = String(input.moment || input.side || "after").trim().toLowerCase() === "before" ? "before" : "after";
    if (cardId <= 0 || eventIndex == null && time == null) {
      return { cardId, eventIndex, time, moment, location: null, exact: false, reason: "card-and-event-index-or-time-required" };
    }
    const boundaryMovements = state.movementHistory.filter((row) =>
      row.cardIds.includes(cardId) && (
        eventIndex != null && row.eventIndex === eventIndex
        || eventIndex == null && time != null && row.time === time
      )).sort((left, right) => left.eventIndex - right.eventIndex || left.index - right.index);
    const boundaryMovement = moment === "before"
      ? boundaryMovements[0]
      : boundaryMovements[boundaryMovements.length - 1];
    if (boundaryMovement) {
      const zoneKey = moment === "before" ? boundaryMovement.from : boundaryMovement.to;
      return {
        cardId,
        eventIndex,
        time,
        moment,
        location: zoneKey ? {
          zoneKey,
          residenceId: null,
          enteredEventIndex: null,
          enteredAt: null,
          leftEventIndex: null,
          leftAt: null,
          previousZoneKey: moment === "after" ? boundaryMovement.from || null : null,
          nextZoneKey: moment === "before" ? boundaryMovement.to || null : null,
          movementId: boundaryMovement.movementId,
          movementBoundary: true,
          source: cloneJson(boundaryMovement.source)
        } : null,
        exact: !!zoneKey,
        reason: zoneKey ? "" : "movement-boundary-zone-unknown"
      };
    }
    const intervals = [
      ...state.locationHistory.filter((row) => row.cardId === cardId),
      ...(state.locations[cardId] ? [{ ...state.locations[cardId], leftEventIndex: null, leftAt: null, toZoneKey: null }] : [])
    ];
    const matches = intervals.filter((row) => {
      if (eventIndex != null) {
        const entered = nonNegativeIntegerOrNull(row.enteredEventIndex);
        const left = nonNegativeIntegerOrNull(row.leftEventIndex);
        if (entered == null) return false;
        return moment === "before"
          ? entered < eventIndex && (left == null || left >= eventIndex)
          : entered <= eventIndex && (left == null || left > eventIndex);
      }
      const enteredAt = finiteNumber(row.enteredAt);
      const leftAt = finiteNumber(row.leftAt);
      if (enteredAt == null) return false;
      return moment === "before"
        ? enteredAt < time && (leftAt == null || leftAt >= time)
        : enteredAt <= time && (leftAt == null || leftAt > time);
    }).sort((left, right) => Number(right.enteredEventIndex ?? -1) - Number(left.enteredEventIndex ?? -1));
    if (!matches.length) {
      return { cardId, eventIndex, time, moment, location: null, exact: false, reason: "no-proven-residence-at-requested-moment" };
    }
    const row = matches[0];
    return {
      cardId,
      eventIndex,
      time,
      moment,
      location: {
        zoneKey: row.zoneKey,
        residenceId: row.residenceId,
        enteredEventIndex: row.enteredEventIndex,
        enteredAt: row.enteredAt,
        leftEventIndex: row.leftEventIndex ?? null,
        leftAt: row.leftAt ?? null,
        previousZoneKey: row.previousZoneKey || null,
        nextZoneKey: row.toZoneKey || null,
        source: cloneJson(row.source)
      },
      exact: true,
      reason: ""
    };
  }

  function cardsContinuouslyInZone(input = {}) {
    const zoneKey = normalizeZoneKey(input.zoneKey || input.zone);
    if (!zoneKey) return { zoneKey: "", cardIds: [], count: 0, complete: false };
    const sinceEventIndex = nonNegativeIntegerOrNull(input.sinceEventIndex);
    const sinceTime = finiteNumber(input.sinceTime);
    const requestedIds = uniquePositiveIds(input.cardIds);
    const zone = ensureZone(zoneKey);
    const candidates = requestedIds.length ? requestedIds : zone.exactIds.slice();
    const cardIds = candidates.filter((cardId) => {
      const residence = state.locations[cardId];
      if (!residence || residence.zoneKey !== zoneKey) return false;
      if (sinceEventIndex != null && residence.enteredEventIndex > sinceEventIndex) return false;
      if (sinceTime != null && residence.enteredAt > sinceTime) return false;
      return true;
    });
    return {
      zoneKey,
      sinceEventIndex,
      sinceTime,
      cardIds,
      count: cardIds.length,
      complete: requestedIds.length > 0 ? cardIds.length === requestedIds.length : zone.complete === true,
      zoneCount: zone.count,
      source: zone.source
    };
  }

  function setDeckDefinition(cardIds, source = sourceOf("deck-definition", "runtime-public"), metadata = {}) {
    const ids = uniquePositiveIds(cardIds);
    state.deck.definition = {
      known: ids.length > 0,
      cardIds: ids,
      source: normalizeSource(source, now),
      mode: metadata.mode || null,
      ruleId: finiteNumber(metadata.ruleId),
      label: String(metadata.label || "")
    };
    state.deck.excludedIds = {};
    state.deck.constraints = [];
    state.deck.dynamicIds = [];
    state.updatedAt = now();
    if (state.deck.count == null && ids.length) state.deck.count = ids.length;
    syncDeckZone(source);
    recordEvent("deck.definition", {
      count: ids.length,
      mode: metadata.mode || null,
      ruleId: finiteNumber(metadata.ruleId),
      label: String(metadata.label || ""),
      source: state.deck.definition.source
    });
    return ids.length;
  }

  function observeDeckCount(value, source = sourceOf("deck-count", "runtime-public"), options = {}) {
    const count = nonNegativeIntegerOrNull(value);
    if (count == null) return state.deck.count;
    const previous = state.deck.count;
    const normalizedSource = normalizeSource(source, now);

    if (previous == null || options.initial === true) {
      state.deck.count = count;
      state.deck.countSource = normalizedSource;
      syncDeckZone(normalizedSource);
      state.updatedAt = now();
      recordEvent("deck.count", { previous, count, reason: options.reason || "initial", source: normalizedSource });
      if (count === 0) recycleDiscard({ reason: "observed-empty-deck", source: normalizedSource });
      return state.deck.count;
    }

    if (count > previous && options.recycle === true) {
      recycleDiscard({
        reason: options.reason || "explicit-runtime-recycle",
        source: normalizedSource,
        reportedCount: count,
        force: true
      });
      return state.deck.count;
    }

    if (count > previous) {
      clearDeckOrder(options.reason || "unexplained-deck-count-increase", normalizedSource);
      state.deck.excludedIds = {};
      state.deck.constraints = [];
      if (options.allowIncreaseWithoutRecycle !== true) {
        contradiction("deck-count-increase-without-move-evidence", { previous, count, source: normalizedSource });
      }
    }
    if (count < previous && options.preserveEndpoint !== true) {
      demoteUnknownDeckRemoval({ count: previous - count, source: normalizedSource });
      clearDeckOrder("unobserved-deck-count-decrease", normalizedSource);
    }
    state.deck.count = count;
    state.deck.countSource = normalizedSource;
    syncDeckZone(normalizedSource);
    state.updatedAt = now();
    recordEvent("deck.count", { previous, count, reason: options.reason || "observation", source: normalizedSource });
    if (count === 0) recycleDiscard({ reason: "observed-empty-deck", source: normalizedSource });
    validatePhysicalWorld();
    return state.deck.count;
  }

  function observeHand(observation = {}) {
    const seatIndex = finiteInteger(observation.seatIndex, -1);
    if (seatIndex < 0) return null;
    const zoneKey = handZone(seatIndex);
    const ids = uniquePositiveIds(observation.cardIds);
    const count = nonNegativeIntegerOrNull(observation.count);
    const effectiveCount = count == null ? ids.length : Math.max(count, ids.length);
    const complete = observation.complete === true || (effectiveCount === ids.length && observation.complete !== false);
    const source = normalizeSource(observation.source || sourceOf("runtime-seat-hand", "runtime-seat-hand"), now);
    const previousZone = ensureZone(zoneKey);
    const previousZoneSnapshot = compactZone(previousZone);
    const mergedIds = uniquePositiveIds([...previousZone.exactIds, ...ids]);
    const preserveExisting =
      !complete &&
      effectiveCount >= Number(previousZone.count || 0) &&
      mergedIds.length <= effectiveCount;
    const onlyRefinesKnownIdentities =
      effectiveCount === previousZoneSnapshot.count &&
      previousZoneSnapshot.exactIds.every((cardId) => ids.includes(cardId)) &&
      (
        ids.some((cardId) => !previousZoneSnapshot.exactIds.includes(cardId)) ||
        complete !== previousZoneSnapshot.complete ||
        String(observation.visibility || previousZoneSnapshot.visibility) !== previousZoneSnapshot.visibility
      );
    const knowledgeOnly = observation.knowledgeOnly === true || (
      observation.membershipChanged !== true &&
      onlyRefinesKnownIdentities
    );

    observeZone({
      zoneKey,
      count: effectiveCount,
      cardIds: ids,
      complete,
      visibility: observation.visibility,
      source,
      replace: !preserveExisting,
      context: observation.context,
      knowledgeOnly,
      membershipChanged: observation.membershipChanged
    });

    const hand = ensureHand(seatIndex);
    recordEvent("hand.observed", {
      seatIndex,
      count: effectiveCount,
      exactIds: ids,
      unknownCount: hand.unknownCount,
      complete,
      visibility: hand.visibility,
      knowledgeOnly,
      source
    });
    validatePhysicalWorld();
    return compactHand(hand);
  }

  function observeHandEvidence(observation = {}) {
    const seatIndex = finiteInteger(observation.seatIndex, -1);
    if (seatIndex < 0) return null;
    const zoneKey = handZone(seatIndex);
    const ids = uniquePositiveIds(observation.cardIds);
    const existing = ensureZone(zoneKey);
    const minimumCount = nonNegativeIntegerOrNull(observation.minimumCount) ?? ids.length;
    const count = Math.max(Number(existing.count || 0), minimumCount, ids.length);
    const source = normalizeSource(observation.source || sourceOf("protocol-visible-hand-evidence", "server-protocol"), now);
    observeZone({
      zoneKey,
      count,
      cardIds: ids,
      complete: false,
      visibility: observation.visibility || "protocol-visible",
      replace: false,
      source,
      context: observation.context,
      knowledgeOnly: true,
      membershipChanged: observation.membershipChanged
    });
    const hand = ensureHand(seatIndex);
    recordEvent("hand.evidence", { seatIndex, count, exactIds: ids, visibility: hand.visibility, source });
    validatePhysicalWorld();
    return compactHand(hand);
  }

  function observeHandConstraint(observation = {}) {
    const seatIndex = finiteInteger(observation.seatIndex, -1);
    if (seatIndex < 0) return null;
    const hand = ensureHand(seatIndex);
    const kind = String(observation.kind || "none-match");
    const predicate = normalizePredicate(observation.predicate || {});
    const source = normalizeSource(observation.source || sourceOf("hand-constraint", "rule-feedback"), now);
    const countKinds = new Set(["at-least", "at-most", "exact-count"]);
    const count = countKinds.has(kind) ? nonNegativeIntegerOrNull(observation.count) : kind === "none-match" ? 0 : null;
    if (!["none-match", "all-match", ...countKinds].includes(kind)) return null;
    if (!predicateIsExecutable(predicate) || (countKinds.has(kind) && count == null)) {
      contradiction("hand-constraint-not-executable", { seatIndex, kind, predicate, count, source });
      return null;
    }

    const evaluation = evaluateHandConstraint(hand, { kind, predicate, count });
    const exactMatches = evaluation.exactMatches;
    const unknownCount = evaluation.unknownCount;
    const knownViolations = evaluation.violation;
    if (knownViolations) {
      contradiction("hand-constraint-conflicts-known-identities", {
        seatIndex,
        kind,
        predicate,
        count,
        handCount: hand.count,
        exactIds: hand.exactIds,
        exactMatches,
        source
      });
    }

    const row = {
      id: state.nextHandConstraintIndex++,
      seatIndex,
      generation: hand.generation,
      kind,
      predicate,
      count,
      reason: String(observation.reason || ""),
      scope: String(observation.scope || "current-hand-generation"),
      source,
      createdAt: now(),
      lastConflictSignature: knownViolations ? handConstraintConflictSignature(hand, { kind, predicate, count }) : null,
      active: true
    };
    hand.constraints.push(row);
    state.handConstraintHistory.push(cloneJson(row));
    if (state.handConstraintHistory.length > maxEvents) {
      state.handConstraintHistory.splice(0, state.handConstraintHistory.length - maxEvents);
    }
    recordEvent("hand.constraint.added", row);
    refreshBooleanConstraintsForHandKnowledge(seatIndex, hand.generation, "hand-constraint-added", source);
    return cloneJson(row);
  }

  function evaluateHandConstraint(hand, constraint) {
    const exactMatches = hand.exactIds.filter((id) => matchesPredicate(state.catalog[id], constraint.predicate, id));
    const unknownCount = Math.max(0, hand.count - hand.exactIds.length);
    const count = constraint.count;
    const violation = constraint.kind === "none-match"
      ? exactMatches.length > 0
      : constraint.kind === "all-match"
        ? exactMatches.length !== hand.exactIds.length
        : constraint.kind === "at-least"
          ? exactMatches.length + unknownCount < count
          : constraint.kind === "at-most"
            ? exactMatches.length > count
            : exactMatches.length > count || exactMatches.length + unknownCount < count;
    return { exactMatches, unknownCount, violation };
  }

  function handConstraintConflictSignature(hand, constraint) {
    return [
      hand.generation,
      hand.count,
      hand.exactIds.slice().sort((left, right) => left - right).join(","),
      constraint.kind,
      constraint.count ?? ""
    ].join("|");
  }

  function validateActiveHandConstraints(hand, source, reason = "knowledge-refined") {
    for (const row of hand.constraints) {
      const evaluation = evaluateHandConstraint(hand, row);
      if (!evaluation.violation) continue;
      const signature = handConstraintConflictSignature(hand, row);
      if (row.lastConflictSignature === signature) continue;
      row.lastConflictSignature = signature;
      contradiction("hand-constraint-conflicts-refined-knowledge", {
        seatIndex: hand.seatIndex,
        constraintId: row.id,
        generation: hand.generation,
        kind: row.kind,
        predicate: row.predicate,
        count: row.count,
        handCount: hand.count,
        exactIds: hand.exactIds,
        exactMatches: evaluation.exactMatches,
        reason,
        source: normalizeSource(source || row.source || sourceOf("hand-knowledge-refinement", "rule-feedback"), now)
      });
    }
  }

  function handKnowledge(seatIndex) {
    const index = finiteInteger(seatIndex, -1);
    if (index < 0) return null;
    const hand = ensureHand(index);
    return compactHand(hand);
  }

  function handTransitions(input = {}) {
    const seatIndex = finiteInteger(input.seatIndex, -1);
    const turn = finiteNumber(input.turn);
    const round = finiteNumber(input.round);
    const causalEventId = String(input.causalEventId || input.eventId || "").trim();
    const sinceEventIndex = nonNegativeIntegerOrNull(input.sinceEventIndex);
    return state.handHistory.filter((row) => {
      if (seatIndex >= 0 && row.seatIndex !== seatIndex) return false;
      if (turn != null && row.context?.turn !== turn) return false;
      if (round != null && row.context?.round !== round) return false;
      if (causalEventId && row.causalEventId !== causalEventId) return false;
      if (sinceEventIndex != null && row.eventIndex < sinceEventIndex) return false;
      if (input.lostLastHand === true && row.lostLastHand !== true) return false;
      if (input.gainedFirstHand === true && row.gainedFirstHand !== true) return false;
      return true;
    }).map(cloneJson);
  }

  function observeZone(observation = {}) {
    const zoneKey = normalizeZoneKey(observation.zoneKey || observation.zone);
    if (!zoneKey) return null;
    const ids = uniquePositiveIds(observation.cardIds);
    const count = nonNegativeIntegerOrNull(observation.count);
    const effectiveCount = count == null ? ids.length : Math.max(count, ids.length);
    const complete = observation.complete === true || (effectiveCount === ids.length && observation.complete !== false);
    const source = normalizeSource(observation.source || sourceOf("zone-observation", "runtime-public"), now);
    const zone = ensureZone(zoneKey);
    applyZoneDescriptor(zone, observation);

    if (observation.replace !== false) {
      const previous = zone.exactIds.slice();
      for (const id of previous) {
        if (!ids.includes(id) && state.locations[id]?.zoneKey === zoneKey) {
          removeExactCardFromZone(id, zoneKey, {
            source,
            reason: "zone-observation-replaced-identity"
          });
        }
      }
      zone.exactIds = [];
      zone.cardStates = {};
    }
    for (const id of ids) placeExactCard(id, zoneKey, source, { silent: true });
    const observedCardStates = normalizeZoneCardStates(observation.cardStates || observation.cardVisibility, ids);
    if (Object.keys(observedCardStates).length) {
      zone.cardStates = { ...zone.cardStates, ...observedCardStates };
    }
    zone.count = effectiveCount;
    zone.complete = complete;
    if (observation.visibility != null) zone.visibility = String(observation.visibility);
    zone.source = source;
    zone.updatedAt = now();
    syncSpecialZone(zoneKey, {
      context: observation.context,
      reason: observation.reason || "zone-observation",
      knowledgeOnly: observation.knowledgeOnly === true,
      membershipChanged: observation.membershipChanged
    });
    reconcileLocationGroupsAfterZoneObservation(zoneKey, complete, source);
    recordEvent("zone.observed", {
      zoneKey,
      count: effectiveCount,
      exactIds: ids,
      complete,
      knowledgeOnly: observation.knowledgeOnly === true,
      membershipChanged: observation.membershipChanged ?? null,
      descriptor: compactZoneDescriptor(zone),
      source
    });
    validatePhysicalWorld();
    return compactZone(zone);
  }

  function observeNamedCardZone(observation = {}) {
    const pileKey = String(observation.pileKey || observation.name || observation.ruleIdentityKey || "").trim();
    const hostSeat = finiteInteger(observation.hostSeat ?? observation.seatIndex ?? observation.seat, -1);
    const zoneKind = String(observation.zoneKind || "general-card-pile").trim();
    const zoneKey = normalizeZoneKey(observation.zoneKey || namedCardZoneKey({
      zoneKind,
      hostSeat,
      hostPlayerKey: observation.hostPlayerKey || observation.playerKey,
      lifecycleScope: observation.lifecycleScope,
      pileKey,
      zoneParam: observation.zoneParam,
      skillId: observation.skillId
    }));
    if (!zoneKey || !pileKey) return null;
    return observeZone({
      ...observation,
      zoneKey,
      pileKey,
      hostSeat: hostSeat >= 0 ? hostSeat : observation.hostSeat,
      zoneKind
    });
  }

  function rehostNamedCardZone(input = {}) {
    const requestedZoneKey = normalizeZoneKey(input.zoneKey || input.zone);
    const hostCardId = finiteInteger(input.hostCardId, 0);
    const pileKey = String(input.pileKey || input.name || "").trim();
    const sourceZone = requestedZoneKey
      ? state.zones[requestedZoneKey]
      : Object.values(state.zones).find((zone) => zone.pileKey &&
          (!pileKey || zone.pileKey === pileKey) &&
          (hostCardId <= 0 || zone.hostCardId === hostCardId));
    if (!sourceZone?.pileKey) return { applied: false, reason: "named-zone-not-found" };
    const newHostSeat = finiteInteger(input.newHostSeat ?? input.hostSeat ?? input.seatIndex ?? input.seat, -1);
    const newHostArea = String(input.newHostArea || input.hostArea || sourceZone.hostArea || "").trim() || null;
    const newHostPlayerKey = stringOrNull(input.newHostPlayerKey || input.hostPlayerKey || input.playerKey || sourceZone.hostPlayerKey);
    const newHostAvatarKey = stringOrNull(input.newHostAvatarKey || input.hostAvatarKey || input.avatarKey || sourceZone.hostAvatarKey);
    if (newHostSeat < 0 && !newHostArea && !newHostPlayerKey) return { applied: false, reason: "new-host-required" };
    const source = normalizeSource(input.source || sourceOf("named-zone-rehost", "server-protocol"), now);
    const descriptor = {
      ...compactZoneDescriptor(sourceZone),
      hostSeat: newHostSeat >= 0 ? newHostSeat : sourceZone.hostSeat,
      hostArea: newHostArea,
      hostPlayerKey: newHostPlayerKey,
      hostAvatarKey: newHostAvatarKey,
      hostCardId: hostCardId > 0 ? hostCardId : sourceZone.hostCardId
    };
    const targetZoneKey = normalizeZoneKey(input.toZoneKey || input.targetZoneKey || namedCardZoneKey(descriptor));
    if (!targetZoneKey) return { applied: false, reason: "target-zone-identity-unresolved" };
    if (targetZoneKey !== sourceZone.zoneKey && state.zones[targetZoneKey]?.count > 0) {
      return { applied: false, reason: "target-named-zone-not-empty", targetZoneKey };
    }
    const before = compactZone(sourceZone);
    const count = Number(sourceZone.count || 0);
    const cardIds = sourceZone.exactIds.slice();
    const cardStates = cloneJson(sourceZone.cardStates || {});
    const complete = sourceZone.complete === true;
    const after = observeZone({
      ...descriptor,
      zoneKey: targetZoneKey,
      count,
      cardIds,
      cardStates,
      complete,
      replace: true,
      reason: input.reason || "named-zone-rehosted",
      source
    });
    if (targetZoneKey !== sourceZone.zoneKey) {
      observeZone({
        zoneKey: sourceZone.zoneKey,
        count: 0,
        cardIds: [],
        complete: true,
        replace: true,
        reason: "named-zone-rehost-source-cleared",
        source
      });
    }
    const history = {
      index: state.nextNamedZoneHostHistoryIndex++,
      type: "rehost",
      fromZoneKey: before.zoneKey,
      toZoneKey: targetZoneKey,
      hostCardId: descriptor.hostCardId ?? null,
      previousHostSeat: before.hostSeat,
      hostSeat: descriptor.hostSeat,
      count,
      cardIds,
      unknownCount: Math.max(0, count - cardIds.length),
      before,
      after: cloneJson(after),
      context: mergeTurnContext(state.context, input.context),
      source,
      eventIndex: state.nextEventIndex,
      time: now()
    };
    state.namedZoneHostHistory.push(history);
    recordEvent("named-zone.rehosted", history);
    return { applied: true, ...cloneJson(history) };
  }

  function visibleZone(zoneKeyValue, options = {}) {
    const zoneKey = normalizeZoneKey(zoneKeyValue?.zoneKey || zoneKeyValue?.zone || zoneKeyValue);
    const zone = state.zones[zoneKey];
    if (!zone) return null;
    const result = compactZone(zone);
    const observerSeat = finiteInteger(options.observerSeat ?? options.viewerSeat, -1);
    const audience = String(zone.visibilityAudience || zone.visibility || "unknown").trim().toLowerCase();
    const publicIdentity = ["public", "all", "everyone", "face-up-public"].includes(audience);
    const authorized = publicIdentity || observerSeat >= 0 && zone.observerSeats.includes(observerSeat);
    result.observerSeat = observerSeat >= 0 ? observerSeat : null;
    result.identityVisible = authorized;
    if (!authorized) {
      result.exactIds = [];
      result.cardStates = {};
      result.unknownCount = Number(result.count || 0);
      result.complete = false;
      result.identityRedacted = true;
    } else {
      result.identityRedacted = false;
    }
    return result;
  }

  function namedCardZones(input = {}) {
    const zoneKind = String(input.zoneKind || "").trim();
    const pileKey = String(input.pileKey || input.name || "").trim();
    const skillId = finiteInteger(input.skillId, 0);
    const hostSeat = finiteInteger(input.hostSeat ?? input.seatIndex ?? input.seat, -1);
    const hostCardId = finiteInteger(input.hostCardId, 0);
    const hostPlayerKey = String(input.hostPlayerKey || input.playerKey || "").trim();
    const lifecycleScope = String(input.lifecycleScope || "").trim().toLowerCase();
    return Object.values(state.zones).filter((zone) => {
      if (!zone.pileKey) return false;
      if (zoneKind && zone.zoneKind !== zoneKind) return false;
      if (pileKey && zone.pileKey !== pileKey) return false;
      if (skillId > 0 && zone.skillId !== skillId) return false;
      if (hostSeat >= 0 && zone.hostSeat !== hostSeat) return false;
      if (hostCardId > 0 && zone.hostCardId !== hostCardId) return false;
      if (hostPlayerKey && zone.hostPlayerKey !== hostPlayerKey) return false;
      if (lifecycleScope && zone.lifecycleScope !== lifecycleScope) return false;
      return true;
    }).sort((left, right) => left.zoneKey.localeCompare(right.zoneKey)).map((zone) =>
      visibleZone(zone.zoneKey, input)
    );
  }

  function observeMove(move = {}) {
    const from = normalizeZoneKey(move.from?.key || move.from?.zoneKey || move.from);
    const to = normalizeZoneKey(move.to?.key || move.to?.zoneKey || move.to);
    const observedIds = uniquePositiveIds(move.cardIds || move.cards);
    const count = Math.max(nonNegativeIntegerOrNull(move.count) ?? observedIds.length, observedIds.length);
    const categories = uniqueStrings(move.categories || move.skillRule?.categories);
    const source = normalizeSource(move.source || sourceOf("protocol-card-move", "server-protocol", {
      protocol: move.protocol || "",
      recordIndex: move.recordIndex ?? null,
      skillId: finiteInteger(move.skillId, 0)
    }), now);
    const context = mergeTurnContext(state.context, move.context);
    const causalEventId = stringOrNull(move.causalEventId ?? move.eventId ?? context.causalEventId);
    const movementAttemptId = stringOrNull(move.movementAttemptId ?? move.attemptId);
    if (causalEventId) context.causalEventId = causalEventId;
    const movementReason = normalizeMovementReason(move.movementReason || move.reasonKind || move.cardMoveReason);
    const reasonTags = uniqueStrings(asList(move.reasonTags));
    context.movementReason = movementReason;
    context.moveType = finiteNumber(move.moveType);
    context.reasonTags = reasonTags;
    context.skillId = finiteInteger(move.skillId, 0) || null;
    context.protocol = String(move.protocol || "");
    const fromSelector = deckSelectorFromPosition(move.from?.position ?? move.positions?.from);
    const toSelector = deckSelectorFromPosition(move.to?.position ?? move.positions?.to);
    const sourceIds = from === ZONE.DECK
      ? observedIds
      : resolveKnownSourceIds(from, observedIds, count);
    const inferredSourceIds = sourceIds.filter((id) => !observedIds.includes(id));
    const sourceZoneBefore = from && state.zones[from] ? cloneJson(state.zones[from]) : null;
    const discardCountBefore = state.discard.count;
    const deckCountBefore = state.deck.count;

    if (!from && !to) return null;
    const stateBeforeMove = cloneJson(state);
    const ambiguousLocationGroup = ambiguousLocationGroupForMove(from, to, sourceZoneBefore, sourceIds, count);
    updateLocationGroupsForMove(from, to, sourceIds, count, source);
    if (categories.includes("deck.shuffle") && from !== ZONE.SHUFFLE) {
      shuffleCurrentDeck({ reason: "skill-deck-shuffle", source });
    }
    if (inferredSourceIds.length) {
      recordEvent("source.zone.inferred", { from, to, count, cardIds: inferredSourceIds, source });
    }

    let result;
    if (from === ZONE.DECK && to === ZONE.DECK) {
      const targetEndpoint = ["top", "bottom", "random"].includes(toSelector)
        ? toSelector
        : categories.includes("deck.top.put")
          ? "top"
          : categories.includes("deck.bottom.put")
            ? "bottom"
            : "random";
      result = repositionInDeck({
        count,
        cardIds: observedIds,
        endpoint: targetEndpoint,
        source,
        reason: move.reason || categories[0] || "deck-reposition"
      });
    } else if (from === ZONE.DECK) {
      const endpoint = ["top", "bottom"].includes(fromSelector)
        ? fromSelector
        : categories.includes("draw.bottom") || categories.includes("deck.bottom.reveal")
          ? "bottom"
          : "top";
      const randomSelection = fromSelector != null
        ? fromSelector === "random"
        : categories.includes("deck.search") || categories.includes("random.card.gain");
      const isEndpointConsumption =
        !randomSelection && (
          ["top", "bottom"].includes(fromSelector) ||
          categories.includes("draw.count") ||
          categories.includes("draw.bottom") ||
          categories.includes("judgement.any") ||
          categories.includes("deck.top.reveal") ||
          categories.includes("deck.bottom.reveal") ||
          to?.startsWith("hand:") ||
          isProcessUseZone(to)
        );
      if (isEndpointConsumption) {
        result = draw({
          count,
          cardIds: observedIds,
          endpoint,
          to,
          source,
          context,
          recordCardEvents: false,
          suppressRecycle: move.suppressRecycle === true || to === ZONE.SHUFFLE,
          reason: move.reason || categories[0] || "deck-move"
        });
      } else {
        result = takeFromDeck({
          count,
          cardIds: observedIds,
          to,
          source,
          context,
          recordCardEvents: false,
          predicate: move.predicate,
          suppressRecycle: move.suppressRecycle === true || to === ZONE.SHUFFLE,
          reason: move.reason || categories[0] || "deck-search"
        });
      }
    } else if (to === ZONE.DECK) {
      removeFromZone(from, sourceIds, count, source, context);
      addToDeck({
        count,
        cardIds: sourceIds,
        endpoint: ["top", "bottom", "random"].includes(toSelector)
          ? toSelector
          : categories.includes("deck.top.put")
            ? "top"
            : categories.includes("deck.bottom.put")
              ? "bottom"
              : "random",
        source,
        reason: move.reason || categories[0] || "deck-insert"
      });
      if (from === ZONE.SHUFFLE && state.pendingRecycle) {
        completeStagedRecycle(source, { from, to, count, cardIds: sourceIds });
      } else if (from === ZONE.DISCARD && deckCountBefore === 0 && discardCountBefore > 0 && state.discard.count === 0) {
        completeStagedRecycle(source, { from, to, count, cardIds: sourceIds, discardCount: discardCountBefore, direct: true });
      }
      result = { count, cardIds: sourceIds, from, to };
    } else {
      removeFromZone(from, sourceIds, count, source, context);
      addToZone(to, sourceIds, count, source, context);
      if (from === ZONE.DISCARD && to === ZONE.SHUFFLE && discardCountBefore > 0 && state.discard.count === 0) {
        state.pendingRecycle = {
          discardCount: discardCountBefore,
          exactIds: sourceIds.slice(),
          source
        };
      }
      result = { count, cardIds: sourceIds, from, to };
    }

    if (result?.status === "unsupported") {
      replaceObject(state, stateBeforeMove);
      recordEvent("card.move.rejected", {
        from,
        to,
        count,
        observedCardIds: observedIds,
        reason: result.reason,
        source
      });
      return { ...result, from, to, count, observedCardIds: observedIds, rolledBack: true };
    }

    if (ambiguousLocationGroup) {
      observeLocationGroup({
        ...ambiguousLocationGroup,
        complete: true,
        context,
        metadata: { causalEventId, movementReason, moveType: finiteNumber(move.moveType) },
        selectionModel: move.selectionModel || (move.uniformSelection === true ? "uniform" : "unknown"),
        source,
        reason: "partially-hidden-known-source-move"
      });
    }

    const resolvedIds = result?.segments
      ? uniquePositiveIds(result.segments.flatMap((segment) => segment.cardIds || []))
      : uniquePositiveIds(result?.cardIds || sourceIds);
    const movementIndex = state.nextMovementIndex++;
    const movementId = String(move.movementId || `movement:${movementIndex}`).trim();
    const movementGroupId = stringOrNull(move.movementGroupId ?? move.groupId ?? move.batchId);
    const sequenceIndex = nonNegativeIntegerOrNull(move.sequenceIndex ?? move.order);
    const cardDetails = normalizeMovementCardDetails(move.cardDetails || move.perCard || move.cardMovements, resolvedIds);
    appendMovementCardEvents({
      cardIds: resolvedIds,
      from,
      to,
      context,
      causalEventId,
      movementId,
      movementGroupId,
      movementAttemptId,
      sequenceIndex,
      cardDetails,
      movementReason,
      reasonTags,
      moveType: move.moveType,
      skillId: move.skillId,
      protocol: move.protocol,
      recordIndex: move.recordIndex,
      source
    });

    const movementRow = {
      index: movementIndex,
      movementId,
      movementGroupId,
      movementAttemptId,
      sequenceIndex,
      from,
      to,
      count,
      cardIds: resolvedIds,
      cardGenerations: Object.fromEntries(resolvedIds.map((cardId) => [cardId, physicalCardGeneration(cardId)])),
      observedCardIds: observedIds,
      inferredCardIds: resolvedIds.filter((id) => !observedIds.includes(id)),
      unknownCount: Math.max(0, count - resolvedIds.length),
      cardDetails,
      categories,
      positions: { from: move.from?.position ?? move.positions?.from ?? null, to: move.to?.position ?? move.positions?.to ?? null },
      zoneParams: { from: move.from?.zoneParam ?? move.zoneParams?.from ?? null, to: move.to?.zoneParam ?? move.zoneParams?.to ?? null },
      moveType: move.moveType ?? null,
      movementReason,
      reasonTags,
      srcSeat: move.srcSeat ?? null,
      skillId: finiteInteger(move.skillId, 0) || null,
      causalEventId,
      context,
      source,
      eventIndex: state.nextEventIndex,
      time: now()
    };
    state.movementHistory.push(movementRow);
    if (movementAttemptId && state.movementAttempts[movementAttemptId]) {
      if (state.movementAttempts[movementAttemptId].prevented) {
        contradiction("prevented-movement-later-applied", {
          movementAttemptId,
          movementId,
          from,
          to,
          cardIds: resolvedIds,
          source
        });
      }
      resolveMovementAttempt({
        attemptId: movementAttemptId,
        status: "moved",
        movementApplied: true,
        movementId,
        source
      });
    }

    recordEvent("card.move", {
      movementId,
      movementGroupId,
      movementAttemptId,
      sequenceIndex,
      from,
      to,
      count,
      cardIds: resolvedIds,
      cardGenerations: movementRow.cardGenerations,
      observedCardIds: observedIds,
      inferredCardIds: resolvedIds.filter((id) => !observedIds.includes(id)),
      unknownCount: Math.max(0, count - resolvedIds.length),
      categories,
      context,
      positions: { from: move.from?.position ?? move.positions?.from ?? null, to: move.to?.position ?? move.positions?.to ?? null },
      zoneParams: { from: move.from?.zoneParam ?? move.zoneParams?.from ?? null, to: move.to?.zoneParam ?? move.zoneParams?.to ?? null },
      moveType: move.moveType ?? null,
      movementReason,
      reasonTags,
      srcSeat: move.srcSeat ?? null,
      causalEventId,
      source
    });
    if (move.visibility != null && to) ensureZone(to).visibility = String(move.visibility);
    validatePhysicalWorld();
    return result && typeof result === "object"
      ? { ...result, movementId, movementGroupId, sequenceIndex }
      : result;
  }

  function draw(input = {}) {
    const requested = nonNegativeIntegerOrNull(input.count) ?? uniquePositiveIds(input.cardIds).length;
    const endpoint = input.endpoint === "bottom" ? "bottom" : "top";
    const ids = uniquePositiveIds(input.cardIds);
    const to = normalizeZoneKey(input.to) || ZONE.OUTSIDE;
    const source = normalizeSource(input.source || sourceOf("draw", "server-protocol"), now);
    const context = mergeTurnContext(state.context, input.context);
    const segments = [];
    let remaining = requested;
    let observedOffset = 0;

    while (remaining > 0) {
      if (state.deck.count === 0) {
        if (input.suppressRecycle === true) {
          contradiction("staging-move-exceeds-current-deck", { requested, remaining, endpoint, to, source });
          break;
        }
        const recycled = recycleDiscard({ reason: "draw-needs-deck", source });
        if (!recycled || state.deck.count === 0) {
          contradiction("draw-with-empty-deck-and-discard", { requested, remaining, endpoint, to, source });
          break;
        }
      }

      const available = state.deck.count == null ? remaining : Math.min(remaining, state.deck.count);
      if (available <= 0) break;
      const observedIds = ids.slice(observedOffset, observedOffset + available);
      observedOffset += observedIds.length;
      const segmentIds = resolveKnownEndpointIds(endpoint, observedIds, available);
      const inferredIds = segmentIds.filter((id) => !observedIds.includes(id));
      const epoch = state.epoch;
      if (inferredIds.length) {
        recordEvent("deck.endpoint.inferred", {
          endpoint,
          cardIds: inferredIds,
          to,
          reason: input.reason || "draw",
          source
        });
      }
      consumeDeck({ count: available, cardIds: segmentIds, endpoint, source, reason: input.reason || "draw" });
      addToZone(to, segmentIds, available, source, context);
      if (input.recordCardEvents !== false) {
        appendMovementCardEvents({
          cardIds: segmentIds,
          from: ZONE.DECK,
          to,
          context,
          causalEventId: input.causalEventId || context.causalEventId,
          movementReason: input.movementReason || context.movementReason || "draw",
          reasonTags: input.reasonTags ?? context.reasonTags,
          moveType: input.moveType ?? context.moveType,
          skillId: input.skillId ?? context.skillId,
          protocol: input.protocol || context.protocol,
          recordIndex: input.recordIndex,
          metadata: { epoch, endpoint },
          source
        });
      }
      segments.push({
        epoch,
        count: available,
        cardIds: segmentIds,
        observedCardIds: observedIds,
        inferredCardIds: inferredIds,
        endpoint,
        to
      });
      remaining -= available;

      if (state.deck.count === 0 && input.suppressRecycle !== true) {
        recycleDiscard({ reason: "deck-exhausted-after-draw", source });
      }
    }

    const result = {
      requested,
      completed: requested - remaining,
      remaining,
      endpoint,
      to,
      segments
    };
    validatePhysicalWorld();
    return result;
  }

  function recast(input = {}) {
    const from = normalizeZoneKey(input.from || input.sourceZone);
    const actorSeat = finiteInteger(input.actorSeat ?? input.seatIndex ?? input.userSeat, -1);
    const to = normalizeZoneKey(input.to || input.destination) || (actorSeat >= 0 ? handZone(actorSeat) : "");
    const cardIds = uniquePositiveIds(input.cardIds || input.cards);
    const count = nonNegativeIntegerOrNull(input.count) ?? cardIds.length;
    const drawCount = nonNegativeIntegerOrNull(input.drawCount) ?? count;
    const drawnCardIds = uniquePositiveIds(input.drawnCardIds || input.resultCardIds);
    if (!from || !to || count <= 0 || drawCount < 0) {
      return { applied: false, reason: "source-destination-and-positive-recast-count-required" };
    }
    const sourceZone = state.zones[from];
    if (!sourceZone || nonNegativeIntegerOrNull(sourceZone.count) == null || sourceZone.count < count) {
      return { applied: false, reason: "recast-source-count-not-proven" };
    }
    const misplaced = cardIds.filter((cardId) => state.locations[cardId]?.zoneKey !== from);
    if (misplaced.length) {
      return { applied: false, reason: "recast-card-source-not-proven", cardIds: misplaced };
    }
    const source = normalizeSource(input.source || input.sourceEvidence || sourceOf("recast", "rule-feedback", {
      skillId: finiteInteger(input.skillId, 0) || null
    }), now);
    const context = mergeTurnContext(state.context, input.context);
    const eventId = String(input.eventId || input.recastId || input.causalEventId || `recast:${state.nextEventIndex}`).trim();
    const movementReason = normalizeMovementReason(input.movementReason || input.reasonKind || "recast");
    const discardMove = observeMove({
      from,
      to: ZONE.DISCARD,
      count,
      cardIds,
      context,
      causalEventId: eventId,
      movementReason,
      reasonTags: uniqueStrings(["recast-cost", ...asList(input.reasonTags)]),
      moveType: input.moveType,
      skillId: input.skillId,
      protocol: input.protocol,
      source,
      reason: input.reason || "recast-cost"
    });
    const drawResult = observeMove({
      from: deckZoneWithPosition(ZONE.DECK, "top"),
      to,
      count: drawCount,
      cardIds: drawnCardIds,
      context: { ...context, causalEventId: eventId },
      causalEventId: eventId,
      movementReason: "draw",
      reasonTags: ["recast-draw"],
      skillId: input.skillId,
      protocol: input.protocol,
      source,
      reason: input.reason || "recast-draw"
    });
    observeCausalEvent({
      eventId,
      eventType: "card:recast",
      roles: { userSeat: actorSeat >= 0 ? actorSeat : null },
      cardIds,
      status: "settled",
      context,
      metadata: {
        recast: {
          from,
          to,
          count,
          drawCount,
          drawnCardIds: uniquePositiveIds(drawResult.segments.flatMap((segment) => segment.cardIds || []))
        }
      },
      source
    });
    recordEvent("card.recast", {
      eventId,
      from,
      to,
      count,
      cardIds,
      drawCount,
      completedDrawCount: drawResult.completed,
      source
    });
    return { applied: true, eventId, from, to, count, cardIds, discardMove, draw: drawResult };
  }

  function takeFromDeck(input = {}) {
    const count = nonNegativeIntegerOrNull(input.count) ?? uniquePositiveIds(input.cardIds).length;
    const ids = uniquePositiveIds(input.cardIds);
    const to = normalizeZoneKey(input.to) || ZONE.OUTSIDE;
    if (state.deck.count != null && count > state.deck.count) {
      return {
        status: "unsupported",
        reason: "cross-epoch-deck-take-requires-explicit-segments",
        requestedCount: count,
        currentDeckCount: state.deck.count,
        cardIds: ids,
        to
      };
    }
    const source = normalizeSource(input.source || sourceOf("deck-take", "server-protocol"), now);
    const context = mergeTurnContext(state.context, input.context);
    consumeDeck({ count, cardIds: ids, endpoint: "random", predicate: input.predicate, source, reason: input.reason || "deck-take" });
    addToZone(to, ids, count, source, context);
    if (input.recordCardEvents !== false) {
      appendMovementCardEvents({
        cardIds: ids,
        from: ZONE.DECK,
        to,
        context,
        causalEventId: input.causalEventId || context.causalEventId,
        movementReason: input.movementReason || context.movementReason || "deck-search",
        reasonTags: input.reasonTags ?? context.reasonTags,
        moveType: input.moveType ?? context.moveType,
        skillId: input.skillId ?? context.skillId,
        protocol: input.protocol || context.protocol,
        recordIndex: input.recordIndex,
        metadata: { endpoint: "random", predicate: normalizePredicate(input.predicate || {}) },
        source
      });
    }
    if (state.deck.count === 0 && input.suppressRecycle !== true) {
      recycleDiscard({ reason: "deck-exhausted-after-take", source });
    }
    validatePhysicalWorld();
    return { count, cardIds: ids, to };
  }

  function takeFromDeckAtRank(input = {}) {
    const cardId = finiteInteger(input.cardId ?? uniquePositiveIds(input.cardIds)[0], 0);
    const rank = positiveInteger(input.rank, 0);
    const to = normalizeZoneKey(input.to) || ZONE.OUTSIDE;
    const source = normalizeSource(input.source || sourceOf("deck-rank-take", "server-protocol"), now);
    const context = mergeTurnContext(state.context, input.context);
    const previous = state.deck.count;
    const removedEpoch = state.epoch;
    if (cardId <= 0 || rank <= 0 || previous == null || rank > previous) {
      return { status: "unsupported", reason: "known-card-rank-and-deck-count-required", cardId, rank, to };
    }
    const knownAtRank = state.deck.knownRanks[rank]?.cardId || knownCardAtDeckRank(rank);
    if (knownAtRank && knownAtRank !== cardId) {
      contradiction("deck-rank-take-conflict", { rank, expectedCardId: knownAtRank, observedCardId: cardId, source });
      return { status: "contradiction", reason: "known-rank-card-conflict", cardId, rank, expectedCardId: knownAtRank, to };
    }
    const nextRanks = {};
    for (const fact of Object.values(state.deck.knownRanks)) {
      if (fact.cardId === cardId || fact.rank === rank) continue;
      const nextRank = fact.rank > rank ? fact.rank - 1 : fact.rank;
      nextRanks[nextRank] = { ...fact, rank: nextRank };
    }
    state.deck.knownRanks = nextRanks;
    removeIdsFromEndpoints([cardId]);
    removeExactCardFromZone(cardId, ZONE.DECK, { source });
    state.deck.count = previous - 1;
    state.deck.countSource = source;
    syncDeckZone(source);
    addToZone(to, [cardId], 1, source, context);
    if (input.recordCardEvents !== false) {
      appendMovementCardEvents({
        cardIds: [cardId],
        from: ZONE.DECK,
        to,
        context,
        causalEventId: input.causalEventId || context.causalEventId,
        movementReason: input.movementReason || context.movementReason || "deck-rank-take",
        reasonTags: input.reasonTags ?? context.reasonTags,
        moveType: input.moveType ?? context.moveType,
        skillId: input.skillId ?? context.skillId,
        protocol: input.protocol || context.protocol,
        recordIndex: input.recordIndex,
        metadata: { rank, removedEpoch },
        source
      });
    }
    recordEvent("deck.rank.take", {
      cardId,
      rank,
      previousDeckCount: previous,
      count: state.deck.count,
      to,
      predicate: normalizePredicate(input.predicate || {}),
      reason: input.reason || "deck-rank-take",
      source
    });
    if (state.deck.count === 0 && input.suppressRecycle !== true) {
      recycleDiscard({ reason: input.reason || "deck-exhausted-after-rank-take", source });
    }
    validateDeckEndpoints();
    validatePhysicalWorld();
    return { status: "applied", cardId, rank, to, previousDeckCount: previous, removedEpoch, resultingEpoch: state.epoch };
  }

  function addToDeck(input = {}) {
    const ids = uniquePositiveIds(input.cardIds);
    const count = Math.max(nonNegativeIntegerOrNull(input.count) ?? ids.length, ids.length);
    const endpoint = ["top", "bottom"].includes(input.endpoint) ? input.endpoint : "random";
    const source = normalizeSource(input.source || sourceOf("deck-insert", "server-protocol"), now);
    const previous = state.deck.count;
    state.deck.count = previous == null ? null : previous + count;
    registerDynamicIds(ids);
    for (const id of ids) placeExactCard(id, ZONE.DECK, source, { silent: true });
    state.deck.excludedIds = {};
    state.deck.constraints = [];
    if (count > ids.length) {
      clearDeckOrder(input.reason || `unknown-${endpoint}-deck-insert`, source);
    } else if (endpoint === "top") {
      state.deck.top = mergeEndpoint(ids, state.deck.top);
      state.deck.topSource = source;
    } else if (endpoint === "bottom") {
      state.deck.bottom = mergeEndpoint(ids, state.deck.bottom);
      state.deck.bottomSource = source;
    } else {
      clearDeckOrder(input.reason || "random-deck-insert", source);
    }
    updateRanksAfterDeckInsertion(endpoint, count, ids, previous, source);
    state.updatedAt = now();
    syncDeckZone(source);
    recordEvent("deck.add", { previous, count: state.deck.count, addedCount: count, cardIds: ids, endpoint, source });
    validatePhysicalWorld();
  }

  function insertAtRank(input = {}) {
    const cardId = finiteInteger(input.cardId ?? input.id, 0);
    const requestedRank = positiveIntegerOrNull(input.rank);
    const source = normalizeSource(input.source || sourceOf("deck-rank-insert", "server-protocol"), now);
    const previous = state.deck.count;
    if (cardId <= 0 || requestedRank == null) {
      return { status: "unsupported", reason: "card-id-and-positive-rank-required" };
    }
    if (previous == null) {
      return { status: "unsupported", reason: "deck-count-required", cardId, requestedRank };
    }
    if (state.locations[cardId]?.zoneKey === ZONE.DECK) {
      return { status: "unsupported", reason: "deck-reposition-at-rank-not-proven", cardId, requestedRank };
    }

    const maximumRank = previous + 1;
    const rank = requestedRank <= maximumRank
      ? requestedRank
      : input.fallback === "bottom"
        ? maximumRank
        : null;
    if (rank == null) {
      contradiction("deck-rank-insert-out-of-range", { cardId, requestedRank, maximumRank, source });
      return { status: "rejected", reason: "rank-out-of-range", cardId, requestedRank, maximumRank };
    }

    const shifted = {};
    for (const fact of Object.values(state.deck.knownRanks)) {
      if (fact.cardId === cardId) continue;
      const nextRank = fact.rank >= rank ? fact.rank + 1 : fact.rank;
      shifted[nextRank] = { ...fact, rank: nextRank };
    }
    state.deck.knownRanks = shifted;
    registerDynamicIds([cardId]);
    placeExactCard(cardId, ZONE.DECK, source, { silent: true });
    state.deck.count = previous + 1;
    state.deck.excludedIds = {};
    state.deck.constraints = [];
    setKnownRank(rank, cardId, source);
    rebuildEndpointsFromKnownRanks(source);
    syncDeckZone(source);
    recordEvent("deck.rank.insert", {
      cardId,
      requestedRank,
      rank,
      fallbackUsed: rank !== requestedRank,
      previous,
      count: state.deck.count,
      source
    });
    validatePhysicalWorld();
    return { status: "applied", cardId, requestedRank, rank, fallbackUsed: rank !== requestedRank };
  }

  function repositionInDeck(input = {}) {
    const ids = uniquePositiveIds(input.cardIds);
    const count = Math.max(nonNegativeIntegerOrNull(input.count) ?? ids.length, ids.length);
    const endpoint = ["top", "bottom"].includes(input.endpoint) ? input.endpoint : "random";
    const source = normalizeSource(input.source || sourceOf("deck-reposition", "server-protocol"), now);
    registerDynamicIds(ids);
    for (const id of ids) placeExactCard(id, ZONE.DECK, source, { silent: true });
    removeIdsFromEndpoints(ids);
    state.deck.knownRanks = {};
    if (count > ids.length || endpoint === "random") {
      clearDeckOrder(input.reason || "unknown-deck-reposition", source);
    } else if (endpoint === "top") {
      state.deck.top = mergeEndpoint(ids, state.deck.top);
      state.deck.topSource = source;
      ids.forEach((id, index) => setKnownRank(index + 1, id, source));
    } else {
      state.deck.bottom = mergeEndpoint(ids, state.deck.bottom);
      state.deck.bottomSource = source;
      if (state.deck.count != null) ids.forEach((id, index) => setKnownRank(state.deck.count - index, id, source));
    }
    syncDeckZone(source);
    recordEvent("deck.reposition", { count, cardIds: ids, endpoint, reason: input.reason || "deck-reposition", source });
    return { count, cardIds: ids, from: ZONE.DECK, to: ZONE.DECK, endpoint };
  }

  function revealDeckEndpoint(input = {}) {
    const endpoint = input.endpoint === "bottom" ? "bottom" : "top";
    const ids = uniquePositiveIds(input.cardIds);
    const source = normalizeSource(input.source || sourceOf(`deck-${endpoint}-reveal`, "server-protocol"), now);
    if (!ids.length) return [];
    registerDynamicIds(ids);
    for (const id of ids) placeExactCard(id, ZONE.DECK, source, { silent: true });
    state.deck[endpoint] = ids;
    state.deck[`${endpoint}Source`] = source;
    if (endpoint === "top") {
      ids.forEach((id, index) => setKnownRank(index + 1, id, source));
    } else if (state.deck.count != null) {
      ids.forEach((id, index) => setKnownRank(state.deck.count - index, id, source));
    }
    state.updatedAt = now();
    syncDeckZone(source);
    validateDeckEndpoints();
    recordEvent("deck.endpoint.reveal", { endpoint, cardIds: ids, source });
    return ids.slice();
  }

  function partitionDeckWindow(input = {}) {
    const windowIds = uniquePositiveIds(input.windowCardIds || input.cardIds);
    const topIds = uniquePositiveIds(input.topCardIds || input.top);
    const bottomIds = uniquePositiveIds(input.bottomCardIds || input.bottom);
    const source = normalizeSource(input.source || sourceOf("deck-window-partition", "server-protocol"), now);
    const assigned = [...topIds, ...bottomIds];
    const assignedSet = new Set(assigned);
    const windowSet = new Set(windowIds);
    if (!windowIds.length || assigned.length !== assignedSet.size || assignedSet.size !== windowSet.size || assigned.some((id) => !windowSet.has(id))) {
      return { status: "rejected", reason: "partition-must-cover-window-exactly", windowIds, topIds, bottomIds };
    }
    if (state.deck.count != null && assigned.length > state.deck.count) {
      contradiction("deck-window-exceeds-count", { windowIds, topIds, bottomIds, deckCount: state.deck.count, source });
      return { status: "rejected", reason: "window-exceeds-deck-count", windowIds, topIds, bottomIds };
    }
    const outside = windowIds.filter((id) => isKnownOutsideDeck(id));
    if (outside.length) {
      contradiction("deck-window-card-known-outside-deck", { windowIds, outside, source });
      return { status: "rejected", reason: "window-card-known-outside-deck", windowIds, outside };
    }

    registerDynamicIds(windowIds);
    for (const id of windowIds) placeExactCard(id, ZONE.DECK, source, { silent: true });
    clearDeckOrder(input.reason || "deck-window-partition", source);
    state.deck.top = topIds;
    state.deck.bottom = bottomIds;
    state.deck.topSource = topIds.length ? source : null;
    state.deck.bottomSource = bottomIds.length ? source : null;
    topIds.forEach((id, index) => setKnownRank(index + 1, id, source));
    if (state.deck.count != null) {
      bottomIds.forEach((id, index) => setKnownRank(state.deck.count - index, id, source));
    }
    syncDeckZone(source);
    validateDeckEndpoints();
    recordEvent("deck.window.partition", { windowIds, topIds, bottomIds, source });
    validatePhysicalWorld();
    return { status: "applied", windowIds, topIds, bottomIds };
  }

  function observeDeckRanks(input = {}) {
    const source = normalizeSource(input.source || sourceOf("deck-rank-observation", "server-protocol"), now);
    const rows = Array.isArray(input.ranks)
      ? input.ranks
      : input.rank != null
        ? [{ rank: input.rank, cardId: input.cardId ?? input.id }]
        : [];
    if (input.replace === true) state.deck.knownRanks = {};
    const accepted = [];
    for (const row of rows) {
      const rank = positiveIntegerOrNull(row?.rank);
      const cardId = finiteInteger(row?.cardId ?? row?.id, 0);
      if (rank == null || cardId <= 0) continue;
      if (state.deck.count != null && rank > state.deck.count) {
        contradiction("deck-rank-out-of-range", { rank, cardId, deckCount: state.deck.count, source });
        continue;
      }
      registerDynamicIds([cardId]);
      placeExactCard(cardId, ZONE.DECK, source, { silent: true });
      setKnownRank(rank, cardId, source);
      accepted.push({ rank, cardId });
    }
    syncDeckZone(source);
    recordEvent("deck.ranks.observed", { ranks: accepted, source });
    return accepted;
  }

  function tagCard(input = {}) {
    const cardId = finiteInteger(input.cardId ?? input.id, 0);
    const tag = String(input.tag || "").trim();
    if (cardId <= 0 || !tag) return null;
    const source = normalizeSource(input.source || sourceOf("physical-card-tag", "rule-feedback"), now);
    state.cardTags[cardId] ||= {};
    if (state.cardTags[cardId][tag]) {
      expireCardTag(cardId, tag, "tag-replaced", source);
      state.cardTags[cardId] ||= {};
    }
    state.cardTags[cardId][tag] = {
      id: state.nextCardTagIndex++,
      tag,
      physicalGeneration: physicalCardGeneration(cardId),
      lifecycle: input.lifecycle || "physical-card",
      createdContext: mergeTurnContext(state.context, input.context),
      whileZone: normalizeZoneKey(input.whileZone) || (input.lifecycle === "while-zone" ? state.locations[cardId]?.zoneKey || null : null),
      expiresOnMove: input.expiresOnMove === true || input.lifecycle === "while-zone",
      expireOnEventTypes: uniqueStrings(Array.isArray(input.expireOnEventTypes || input.expireOnEvents)
        ? input.expireOnEventTypes || input.expireOnEvents
        : input.expireOnEventTypes || input.expireOnEvents
          ? [input.expireOnEventTypes || input.expireOnEvents]
          : []),
      metadata: cloneJson(input.metadata || {}),
      source,
      createdAt: now()
    };
    recordEvent("card.tag.added", { cardId, tag, lifecycle: input.lifecycle || "physical-card", source });
    return cloneJson(state.cardTags[cardId][tag]);
  }

  function untagCard(input = {}) {
    const cardId = finiteInteger(input.cardId ?? input.id, 0);
    const tag = String(input.tag || "").trim();
    if (cardId <= 0 || !tag || !state.cardTags[cardId]?.[tag]) return false;
    return expireCardTag(cardId, tag, input.reason || "explicit-remove", input.source);
  }

  function cardsWithTag(tag, options = {}) {
    const target = String(tag || "");
    const zoneKey = options.zoneKey ? normalizeZoneKey(options.zoneKey) : "";
    return Object.entries(state.cardTags)
      .filter(([id, tags]) => tags[target]
        && (tags[target].physicalGeneration == null || tags[target].physicalGeneration === physicalCardGeneration(Number(id)))
        && (!zoneKey || state.locations[id]?.zoneKey === zoneKey))
      .map(([id]) => Number(id))
      .sort((a, b) => a - b);
  }

  function expireCardTag(cardIdValue, tagValue, reason, source) {
    const cardId = finiteInteger(cardIdValue, 0);
    const tag = String(tagValue || "").trim();
    const row = state.cardTags[cardId]?.[tag];
    if (!row) return false;
    const history = {
      ...cloneJson(row),
      cardId,
      active: false,
      expiredAt: now(),
      expiredEventIndex: state.nextEventIndex,
      expirationReason: String(reason || "expired"),
      expirationSource: normalizeSource(source || sourceOf("card-tag-expired", "rule-feedback"), now)
    };
    state.cardTagHistory.push(history);
    delete state.cardTags[cardId][tag];
    if (!Object.keys(state.cardTags[cardId]).length) delete state.cardTags[cardId];
    recordEvent("card.tag.removed", { cardId, tag, reason: history.expirationReason, source: history.expirationSource });
    return true;
  }

  function expireCardTagsForEvent(eventType, previousContext, currentContext) {
    const rows = Object.entries(state.cardTags).flatMap(([cardId, tags]) =>
      Object.entries(tags).map(([tag, row]) => ({ cardId: Number(cardId), tag, row }))
    );
    for (const item of rows) {
      const lifecycle = String(item.row.lifecycle || "physical-card");
      const created = item.row.createdContext || {};
      const explicitEvent = item.row.expireOnEventTypes?.includes(eventType);
      const turnExpired = lifecycle === "turn" && created.turn != null && currentContext.turn != null && created.turn !== currentContext.turn;
      const roundExpired = lifecycle === "round" && created.round != null && currentContext.round != null && created.round !== currentContext.round;
      const phaseExpired = lifecycle === "phase" && created.phase != null && currentContext.phase != null && (
        created.turn !== currentContext.turn || created.round !== currentContext.round || created.phase !== currentContext.phase
      );
      if (explicitEvent || turnExpired || roundExpired || phaseExpired || eventType === "game:over") {
        expireCardTag(item.cardId, item.tag, explicitEvent ? `event:${eventType}` : eventType === "game:over" ? "game-over" : `${lifecycle}-changed`);
      }
    }
  }

  function observeSkillBinding(input = {}) {
    const skillId = finiteInteger(input.skillId ?? input.id, 0);
    if (skillId <= 0) return null;
    const ownerSeat = finiteInteger(input.ownerSeat ?? input.seat, -1);
    const ownerGeneralId = finiteInteger(input.ownerGeneralId ?? input.generalId, 0);
    const mode = String(input.mode || "").trim();
    const key = String(input.key || input.bindingKey || defaultSkillBindingKey({
      skillId,
      ownerSeat,
      ownerGeneralId,
      mode,
      scope: input.scope
    })).trim();
    if (!key) return null;
    const operation = normalizeSkillBindingOperation(input.operation || input.op || (input.active === false ? "lose" : "observe"));
    if (operation === "lose") {
      const existing = state.skillBindings[key];
      if (existing && existing.skillId !== skillId) {
        contradiction("skill-binding-loss-identity-conflict", {
          key,
          expectedSkillId: existing.skillId,
          observedSkillId: skillId,
          source: normalizeSource(input.source || sourceOf("skill-binding-observed-loss", "rule-feedback", { skillId }), now)
        });
        return null;
      }
      const removed = removeSkillBinding({ key, reason: input.reason || "observed-loss", source: input.source });
      return removed ? { key, skillId, active: false, removed } : null;
    }

    const source = normalizeSource(input.source || sourceOf("skill-binding-observed", "rule-feedback", {
      skillId
    }), now);
    const current = state.skillBindings[key] || null;
    if (current && (
      current.skillId !== skillId ||
      (ownerSeat >= 0 && current.ownerSeat != null && current.ownerSeat !== ownerSeat) ||
      (ownerGeneralId > 0 && current.ownerGeneralId != null && current.ownerGeneralId !== ownerGeneralId)
    )) {
      contradiction("skill-binding-identity-conflict", {
        key,
        expected: {
          skillId: current.skillId,
          ownerSeat: current.ownerSeat,
          ownerGeneralId: current.ownerGeneralId
        },
        observed: { skillId, ownerSeat: ownerSeat >= 0 ? ownerSeat : null, ownerGeneralId: ownerGeneralId || null },
        source
      });
      return null;
    }

    const replaceIds = uniquePositiveIds(input.replacesSkillIds || input.replacedSkillIds || input.replacesSkillId);
    if (operation === "replace" && replaceIds.length) {
      removeSkillBinding({
        skillIds: replaceIds,
        ownerSeat: ownerSeat >= 0 ? ownerSeat : null,
        ownerGeneralId: ownerGeneralId > 0 ? ownerGeneralId : null,
        reason: input.reason || `replaced-by:${skillId}`,
        source
      });
    }

    const before = current ? cloneJson(current) : null;
    const row = current || {
      id: state.nextSkillBindingIndex++,
      key,
      skillId,
      createdAt: now(),
      createdEventIndex: state.nextEventIndex,
      createdContext: mergeTurnContext(state.context, input.context)
    };
    row.skillName = String(input.skillName || input.name || row.skillName || "");
    row.ruleIdentityKey = String(input.ruleIdentityKey || row.ruleIdentityKey || "");
    row.ownerSeat = ownerSeat >= 0 ? ownerSeat : row.ownerSeat ?? null;
    row.ownerGeneralId = ownerGeneralId > 0 ? ownerGeneralId : row.ownerGeneralId ?? null;
    row.sourceType = String(input.sourceType || row.sourceType || "");
    row.mode = mode || row.mode || null;
    row.derivedFromSkillIds = uniquePositiveIds([
      ...(row.derivedFromSkillIds || []),
      ...asList(input.derivedFromSkillIds || input.derivedFromSkillId || input.parentSkillId)
    ]);
    row.grantedByEventId = stringOrNull(input.grantedByEventId ?? input.eventId ?? input.causalEventId ?? row.grantedByEventId);
    row.lifecycle = String(input.lifecycle || row.lifecycle || "game");
    row.expireOnEventTypes = input.expireOnEventTypes == null && input.expireOnEvents == null
      ? Array.from(row.expireOnEventTypes || [])
      : uniqueStrings(asList(input.expireOnEventTypes ?? input.expireOnEvents));
    row.versionScope = cloneJson(input.versionScope ?? row.versionScope ?? null);
    row.metadata = cloneJson(input.metadata ?? row.metadata ?? {});
    row.source = source;
    row.active = true;
    row.updatedAt = now();
    row.updatedEventIndex = state.nextEventIndex;
    row.updatedContext = mergeTurnContext(state.context, input.context);
    state.skillBindings[key] = row;
    appendSkillBindingHistory(current ? "update" : operation, row, {
      before,
      reason: input.reason,
      source
    });
    recordEvent("skill.binding.observed", {
      key,
      skillId,
      ownerSeat: row.ownerSeat,
      ownerGeneralId: row.ownerGeneralId,
      operation: current ? "update" : operation,
      derivedFromSkillIds: row.derivedFromSkillIds,
      source
    });
    return cloneJson(row);
  }

  function activeSkillBindings(input = {}) {
    const skillId = finiteInteger(input.skillId ?? input.id, 0);
    const ownerSeat = finiteInteger(input.ownerSeat ?? input.seat, -1);
    const ownerGeneralId = finiteInteger(input.ownerGeneralId ?? input.generalId, 0);
    const ruleIdentityKey = String(input.ruleIdentityKey || "").trim();
    const mode = String(input.mode || "").trim();
    const sourceType = String(input.sourceType || "").trim();
    return Object.values(state.skillBindings).filter((row) => {
      if (!row.active) return false;
      if (skillId > 0 && row.skillId !== skillId) return false;
      if (ownerSeat >= 0 && row.ownerSeat !== ownerSeat) return false;
      if (ownerGeneralId > 0 && row.ownerGeneralId !== ownerGeneralId) return false;
      if (ruleIdentityKey && row.ruleIdentityKey !== ruleIdentityKey) return false;
      if (mode && row.mode !== mode) return false;
      if (sourceType && row.sourceType !== sourceType) return false;
      return true;
    }).sort((left, right) => left.id - right.id).map(cloneJson);
  }

  function removeSkillBinding(input = {}) {
    const key = String(typeof input === "string" ? input : input.key || input.bindingKey || "").trim();
    const skillIds = new Set(uniquePositiveIds(typeof input === "string" ? [] : input.skillIds || input.skillId));
    const ownerSeat = finiteInteger(typeof input === "string" ? null : input.ownerSeat ?? input.seat, -1);
    const ownerGeneralId = finiteInteger(typeof input === "string" ? null : input.ownerGeneralId ?? input.generalId, 0);
    const keys = key
      ? [key]
      : Object.entries(state.skillBindings).filter(([, row]) => {
        if (skillIds.size && !skillIds.has(row.skillId)) return false;
        if (ownerSeat >= 0 && row.ownerSeat !== ownerSeat) return false;
        if (ownerGeneralId > 0 && row.ownerGeneralId !== ownerGeneralId) return false;
        return skillIds.size > 0 || ownerSeat >= 0 || ownerGeneralId > 0;
      }).map(([value]) => value);
    if (!keys.length) return 0;
    const reason = String(typeof input === "string" ? "explicit-remove" : input.reason || "explicit-remove");
    const source = normalizeSource(typeof input === "string"
      ? sourceOf("skill-binding-remove", "rule-feedback")
      : input.source || sourceOf("skill-binding-remove", "rule-feedback"), now);
    let removed = 0;
    for (const targetKey of keys) {
      const row = state.skillBindings[targetKey];
      if (!row) continue;
      appendSkillBindingHistory("lose", row, { before: cloneJson(row), reason, source });
      delete state.skillBindings[targetKey];
      expireStateForSkillBinding(targetKey, reason, source);
      recordEvent("skill.binding.removed", {
        key: targetKey,
        skillId: row.skillId,
        ownerSeat: row.ownerSeat,
        ownerGeneralId: row.ownerGeneralId,
        reason,
        source
      });
      removed++;
    }
    return removed;
  }

  function expireStateForSkillBinding(bindingKey, reason, source) {
    removeEquipmentProjection({
      whileSkillBindingKey: bindingKey,
      reason: `skill-binding:${reason}`,
      source
    });
    for (const [key, row] of Object.entries(state.ruleModifiers)) {
      if (row.whileSkillBindingKey !== bindingKey) continue;
      removeRuleModifier({ key, reason: `skill-binding:${reason}`, source });
    }
    for (const [key, row] of Object.entries(state.ruleStates)) {
      if (row.whileSkillBindingKey !== bindingKey) continue;
      clearRuleState({ key, reason: `skill-binding:${reason}`, source });
    }
    for (const row of Object.values(state.scheduledEffects)) {
      if (row.whileSkillBindingKey !== bindingKey) continue;
      resolveScheduledEffect({
        key: row.key,
        status: "expired",
        reason: `skill-binding:${reason}`,
        source
      });
    }
    for (const row of Object.values(state.choiceSets)) {
      if (row.whileSkillBindingKey !== bindingKey) continue;
      resolveChoiceSet({
        key: row.key,
        status: "expired",
        reason: `skill-binding:${reason}`,
        source
      });
    }
    for (const [cardId, views] of Object.entries(state.cardViews)) {
      if (!Object.values(views).some((row) => row.whileSkillBindingKey === bindingKey)) continue;
      invalidateCardViews(Number(cardId), `skill-binding:${reason}`, source, (row) => row.whileSkillBindingKey === bindingKey);
    }
  }

  function appendSkillBindingHistory(operation, row, extra = {}) {
    state.skillBindingHistory.push({
      index: state.nextSkillBindingHistoryIndex++,
      operation,
      key: row.key,
      skillId: row.skillId,
      ownerSeat: row.ownerSeat,
      ownerGeneralId: row.ownerGeneralId,
      ruleIdentityKey: row.ruleIdentityKey,
      derivedFromSkillIds: Array.from(row.derivedFromSkillIds || []),
      before: extra.before || null,
      after: operation === "lose" ? null : cloneJson(row),
      reason: String(extra.reason || ""),
      source: normalizeSource(extra.source || row.source || sourceOf("skill-binding-history", "rule-feedback"), now),
      context: { ...state.context },
      eventIndex: state.nextEventIndex,
      time: now()
    });
  }

  function expireSkillBindingsForEvent(eventType, previousContext, currentContext) {
    for (const [key, row] of Object.entries(state.skillBindings)) {
      const created = row.createdContext || {};
      const lifecycle = String(row.lifecycle || "game");
      const explicitEvent = row.expireOnEventTypes?.includes(eventType);
      const turnExpired = lifecycle === "turn" && created.turn != null && currentContext.turn != null && created.turn !== currentContext.turn;
      const roundExpired = lifecycle === "round" && created.round != null && currentContext.round != null && created.round !== currentContext.round;
      const phaseExpired = lifecycle === "phase" && created.phase != null && currentContext.phase != null && (
        created.turn !== currentContext.turn || created.round !== currentContext.round || created.phase !== currentContext.phase
      );
      if (explicitEvent || turnExpired || roundExpired || phaseExpired || eventType === "game:over") {
        removeSkillBinding({
          key,
          reason: explicitEvent ? `event:${eventType}` : eventType === "game:over" ? "game-over" : `${lifecycle}-changed`
        });
      }
    }
  }

  function scheduleEffect(input = {}) {
    const trigger = normalizeScheduledTrigger(input.trigger || input.when || input.timing || {});
    const effectType = String(input.effectType || input.effect?.type || input.action?.type || "").trim();
    const effect = cloneJson(input.effect ?? input.action ?? input.operation ?? null);
    if (!scheduledTriggerHasConditions(trigger) || (!effectType && effect == null)) return null;
    const proposedId = state.nextScheduledEffectId;
    const key = String(input.key || input.scheduleKey || `schedule:${proposedId}`).trim();
    if (!key) return null;
    const source = normalizeSource(input.source || sourceOf("scheduled-effect", "rule-feedback", {
      skillId: finiteInteger(input.skillId, 0)
    }), now);
    const current = state.scheduledEffects[key] || null;
    const before = current ? cloneJson(current) : null;
    const row = current || {
      id: state.nextScheduledEffectId++,
      key,
      createdAt: now(),
      createdEventIndex: state.nextEventIndex,
      createdContext: mergeTurnContext(state.context, input.context)
    };
    row.effectType = effectType || row.effectType || "";
    row.effect = effect ?? cloneJson(row.effect ?? null);
    row.trigger = trigger;
    row.status = "pending";
    row.dueEvent = null;
    row.ruleIdentityKey = String(input.ruleIdentityKey || row.ruleIdentityKey || "");
    row.whileSkillBindingKey = String(input.whileSkillBindingKey || input.skillBindingKey || row.whileSkillBindingKey || "") || null;
    row.skillId = finiteInteger(input.skillId ?? row.skillId, 0) || null;
    row.ownerSeat = finiteNumber(input.ownerSeat ?? row.ownerSeat);
    row.lifecycle = String(input.lifecycle || row.lifecycle || "scheduled");
    row.expireOnEventTypes = input.expireOnEventTypes == null && input.expireOnEvents == null
      ? Array.from(row.expireOnEventTypes || [])
      : uniqueStrings(asList(input.expireOnEventTypes ?? input.expireOnEvents));
    row.whileCardId = finiteInteger(input.whileCardId ?? input.cardId ?? row.whileCardId, 0) || null;
    row.whileCardGeneration = row.whileCardId
      ? positiveIntegerOrNull(input.whileCardGeneration ?? input.cardGeneration ?? row.whileCardGeneration)
        || physicalCardGeneration(row.whileCardId)
      : null;
    row.whileZone = normalizeZoneKey(input.whileZone || row.whileZone) || null;
    row.causeEventIds = uniqueStrings(asList(input.causeEventIds || input.causedByEventIds || input.causedBy));
    row.metadata = cloneJson(input.metadata ?? row.metadata ?? {});
    row.source = source;
    row.active = true;
    row.updatedAt = now();
    row.updatedEventIndex = state.nextEventIndex;
    state.scheduledEffects[key] = row;
    appendScheduledEffectHistory(current ? "update" : "schedule", row, { before, source, reason: input.reason });
    recordEvent("scheduled.effect.registered", {
      key,
      effectType: row.effectType,
      trigger: row.trigger,
      skillId: row.skillId,
      ownerSeat: row.ownerSeat,
      source
    });
    return cloneJson(row);
  }

  function scheduledEffects(input = {}) {
    const status = String(input.status || "").trim();
    const effectType = String(input.effectType || "").trim();
    const ruleIdentityKey = String(input.ruleIdentityKey || "").trim();
    const whileSkillBindingKey = String(input.whileSkillBindingKey || input.skillBindingKey || "").trim();
    const skillId = finiteInteger(input.skillId, 0);
    const ownerSeat = finiteInteger(input.ownerSeat, -1);
    const dueEventType = String(input.dueEventType || input.eventType || "").trim();
    return Object.values(state.scheduledEffects).filter((row) => {
      if (!row.active) return false;
      if (row.whileCardId && row.whileCardGeneration != null
        && row.whileCardGeneration !== physicalCardGeneration(row.whileCardId)) return false;
      if (status && row.status !== status) return false;
      if (effectType && row.effectType !== effectType) return false;
      if (ruleIdentityKey && row.ruleIdentityKey !== ruleIdentityKey) return false;
      if (whileSkillBindingKey && row.whileSkillBindingKey !== whileSkillBindingKey) return false;
      if (skillId > 0 && row.skillId !== skillId) return false;
      if (ownerSeat >= 0 && row.ownerSeat !== ownerSeat) return false;
      if (dueEventType && row.dueEvent?.eventType !== dueEventType) return false;
      return true;
    }).sort((left, right) => left.id - right.id).map(cloneJson);
  }

  function dueScheduledEffects(input = {}) {
    return scheduledEffects({ ...input, status: "due" });
  }

  function resolveScheduledEffect(input = {}) {
    const key = String(typeof input === "string" ? input : input.key || input.scheduleKey || "").trim();
    const row = state.scheduledEffects[key];
    if (!row) return null;
    const requestedStatus = String(typeof input === "string" ? "resolved" : input.status || input.outcomeStatus || "resolved").trim();
    const status = ["resolved", "cancelled", "expired"].includes(requestedStatus) ? requestedStatus : "resolved";
    const reason = String(typeof input === "string" ? "observed-resolution" : input.reason || status);
    const source = normalizeSource(typeof input === "string"
      ? sourceOf("scheduled-effect-resolution", "rule-feedback")
      : input.source || sourceOf("scheduled-effect-resolution", "rule-feedback"), now);
    const before = cloneJson(row);
    row.status = status;
    row.active = false;
    row.outcome = cloneJson(typeof input === "string" ? null : input.outcome ?? input.result ?? null);
    row.resolvedAt = now();
    row.resolvedEventIndex = state.nextEventIndex;
    row.resolutionReason = reason;
    row.resolutionSource = source;
    delete state.scheduledEffects[key];
    appendScheduledEffectHistory(status, row, { before, source, reason });
    recordEvent("scheduled.effect.resolved", { key, effectType: row.effectType, status, reason, source });
    return cloneJson(row);
  }

  function activateScheduledEffectsForEvent(event = {}) {
    const matched = [];
    for (const row of Object.values(state.scheduledEffects)) {
      if (!row.active || row.status !== "pending") continue;
      if (!scheduledTriggerMatches(row, event)) continue;
      const before = cloneJson(row);
      row.status = "due";
      row.dueAt = now();
      row.dueEvent = compactScheduledEvent(event);
      row.updatedAt = row.dueAt;
      row.updatedEventIndex = state.nextEventIndex;
      appendScheduledEffectHistory("due", row, {
        before,
        source: event.source || row.source,
        reason: `trigger:${event.eventType || event.type || "event"}`
      });
      recordEvent("scheduled.effect.due", {
        key: row.key,
        effectType: row.effectType,
        dueEvent: row.dueEvent,
        source: event.source || row.source
      });
      matched.push(cloneJson(row));
    }
    return matched;
  }

  function expireScheduledEffectsForEvent(eventType, eventIndex) {
    const rows = Object.values(state.scheduledEffects);
    for (const row of rows) {
      if (eventType !== "game:over" && row.dueEvent?.eventIndex === eventIndex) continue;
      if (eventType !== "game:over" && !row.expireOnEventTypes?.includes(eventType)) continue;
      resolveScheduledEffect({
        key: row.key,
        status: "expired",
        reason: eventType === "game:over" ? "game-over" : `event:${eventType}`
      });
    }
  }

  function expireScheduledEffectsForCardMove(cardId, fromZone) {
    for (const row of Object.values(state.scheduledEffects)) {
      if (row.lifecycle !== "while-zone" || row.whileCardId !== cardId) continue;
      if (row.whileZone && row.whileZone !== fromZone) continue;
      resolveScheduledEffect({ key: row.key, status: "expired", reason: `card-left:${fromZone}` });
    }
  }

  function appendScheduledEffectHistory(operation, row, extra = {}) {
    state.scheduledEffectHistory.push({
      index: state.nextScheduledEffectHistoryIndex++,
      operation,
      key: row.key,
      effectType: row.effectType,
      status: row.status,
      before: extra.before || null,
      after: operation === "resolved" || operation === "cancelled" || operation === "expired" ? null : cloneJson(row),
      dueEvent: cloneJson(row.dueEvent || null),
      reason: String(extra.reason || ""),
      source: normalizeSource(extra.source || row.source || sourceOf("scheduled-effect-history", "rule-feedback"), now),
      context: { ...state.context },
      eventIndex: state.nextEventIndex,
      time: now()
    });
    if (state.scheduledEffectHistory.length > maxEvents) {
      state.scheduledEffectHistory.splice(0, state.scheduledEffectHistory.length - maxEvents);
    }
  }

  function scheduledTriggerMatches(row, event = {}) {
    const trigger = row.trigger || {};
    const eventType = String(event.eventType || event.type || "");
    const eventIndex = nonNegativeIntegerOrNull(event.eventIndex) ?? state.nextEventIndex;
    if (eventIndex <= row.createdEventIndex) return false;
    if (trigger.notBeforeEventIndex != null && eventIndex < trigger.notBeforeEventIndex) return false;
    if (trigger.eventTypes.length && !trigger.eventTypes.includes(eventType)) return false;
    const context = scheduledEventContext(state.context, event.context);
    for (const field of ["turn", "round", "phase", "activeSeat", "stage"]) {
      if (trigger[field] != null && String(context[field]) !== String(trigger[field])) return false;
    }
    for (const field of ["seat", "casterSeat", "skillId", "cardId", "causalEventId"]) {
      if (trigger[field] != null && String(event[field] ?? "") !== String(trigger[field])) return false;
    }
    if (trigger.targetSeat != null && !uniqueFiniteNumbers(asList(event.targetSeats || event.targets)).includes(trigger.targetSeat)) return false;
    if (trigger.tags.length) {
      const tags = new Set(uniqueStrings(asList(event.tags)));
      if (trigger.tags.some((tag) => !tags.has(tag))) return false;
    }
    return true;
  }

  function observeChoiceSet(input = {}) {
    const domain = String(input.domain || input.candidateDomain || input.valueDomain || "").trim().toLowerCase();
    const rawCandidates = input.candidates ?? input.options ?? input.choices;
    if (!domain || rawCandidates == null) return null;
    const proposedId = state.nextChoiceSetId;
    const key = String(input.key || input.promptKey || input.choiceSetKey || input.promptId || `choice:${proposedId}`).trim();
    if (!key) return null;
    const current = state.choiceSets[key] || null;
    const normalizedCandidates = normalizeChoiceCandidates(rawCandidates, domain);
    if (!normalizedCandidates.ok) {
      contradiction("choice-set-candidate-invalid", {
        key: String(input.key || input.promptKey || input.choiceSetKey || ""),
        domain,
        reason: normalizedCandidates.reason
      });
      return null;
    }
    const candidates = normalizedCandidates.candidates;
    const exactInput = input.exactSelections ?? input.selectionCount;
    const minInput = input.minSelections ?? input.minimum;
    const maxInput = input.maxSelections ?? input.maximum;
    const withReplacement = input.withReplacement == null ? current?.withReplacement === true : input.withReplacement === true;
    const exactSelections = exactInput == null ? current?.selectionLimits?.exact ?? null : nonNegativeIntegerOrNull(exactInput);
    const minSelections = exactInput != null
      ? exactSelections
      : minInput == null
        ? current?.selectionLimits?.min ?? 0
        : nonNegativeIntegerOrNull(minInput);
    const maxSelections = exactInput != null
      ? exactSelections
      : maxInput == null
        ? current?.selectionLimits?.max ?? candidates.length
        : nonNegativeIntegerOrNull(maxInput);
    const complete = input.complete == null ? current?.complete !== false : input.complete !== false;
    const selectionAgency = normalizeSelectionAgency(input.selectionAgency || input.agency || current?.selectionAgency);
    const samplingModel = normalizeSamplingModel(input.samplingModel || input.sampling || current?.samplingModel, selectionAgency, withReplacement);
    const candidateWeights = normalizeCandidateWeights(input.candidateWeights ?? input.weights, candidates, current?.candidateWeights);
    if (minSelections == null || maxSelections == null) return null;
    if (
      minSelections > maxSelections
      || complete && candidates.length === 0 && maxSelections > 0
      || complete && !withReplacement && maxSelections > candidates.length
      || samplingModel === "weighted" && (
        candidateWeights == null
        || candidateWeights.length !== candidates.length
        || candidateWeights.reduce((sum, weight) => sum + weight, 0) <= 0
      )
    ) {
      contradiction("choice-set-selection-limits-invalid", {
        key: String(input.key || input.promptKey || input.choiceSetKey || ""),
        domain,
        candidateCount: candidates.length,
        minSelections,
        maxSelections,
        withReplacement,
        complete,
        selectionAgency,
        samplingModel
      });
      return null;
    }

    const source = normalizeSource(input.source || sourceOf("choice-set-observation", "server-protocol", {
      skillId: finiteInteger(input.skillId, 0)
    }), now);
    if (current && current.domain !== domain) {
      contradiction("choice-set-domain-conflict", { key, expected: current.domain, observed: domain, source });
      return null;
    }
    const definition = {
      domain,
      candidates,
      ordered: input.ordered == null ? current?.ordered !== false : input.ordered !== false,
      complete,
      withReplacement,
      selectionAgency,
      samplingModel,
      candidateWeights: candidateWeights || [],
      candidateConstraint: cloneJson(input.candidateConstraint ?? input.predicate ?? current?.candidateConstraint ?? null),
      sourceZones: normalizeStochasticSourceZones(input.sourceZones ?? input.sourceZone ?? input.from ?? current?.sourceZones),
      sourceResolved: input.sourceResolved == null ? current?.sourceResolved === true : input.sourceResolved === true,
      selectionLimits: {
        min: minSelections,
        max: maxSelections,
        exact: exactSelections
      }
    };
    const scope = {
      actorSeat: finiteNumber(input.actorSeat ?? input.seat ?? current?.actorSeat),
      subjectSeat: finiteNumber(input.subjectSeat ?? input.targetSeat ?? current?.subjectSeat),
      observerSeats: input.observerSeats == null && input.viewerSeats == null
        ? Array.from(current?.observerSeats || []).sort((left, right) => left - right)
        : uniqueFiniteNumbers(asList(input.observerSeats ?? input.viewerSeats)).sort((left, right) => left - right),
      visibility: String(input.visibility || current?.visibility || "unknown"),
      ruleIdentityKey: String(input.ruleIdentityKey || current?.ruleIdentityKey || ""),
      whileSkillBindingKey: String(input.whileSkillBindingKey || input.skillBindingKey || current?.whileSkillBindingKey || "") || null,
      skillId: finiteInteger(input.skillId ?? current?.skillId, 0) || null,
      ownerSeat: finiteNumber(input.ownerSeat ?? current?.ownerSeat),
      causalEventId: stringOrNull(input.causalEventId ?? input.eventId ?? current?.causalEventId),
      lifecycle: String(input.lifecycle || current?.lifecycle || "prompt"),
      expireOnEventTypes: input.expireOnEventTypes == null && input.expireOnEvents == null
        ? Array.from(current?.expireOnEventTypes || []).sort()
        : uniqueStrings(asList(input.expireOnEventTypes ?? input.expireOnEvents)).sort(),
      metadata: cloneJson(input.metadata ?? current?.metadata ?? {})
    };
    const definitionChanged = current && !choiceSetDefinitionEquals(current, definition);
    const scopeChanged = current && !choiceSetScopeEquals(current, scope);
    const changed = current && (definitionChanged || scopeChanged);
    const currentSource = current ? normalizeSource(current.source || sourceOf("choice-set-existing", "unknown"), now) : null;
    if (changed && source.authority < currentSource.authority) {
      contradiction("choice-set-lower-authority-conflict", {
        key,
        before: compactChoiceSetDefinition(current),
        observed: definition,
        priorSource: currentSource,
        source
      });
      return null;
    }
    if (current && !changed) return cloneJson(current);
    if (definitionChanged) {
      contradiction("choice-set-authoritative-revision", {
        key,
        before: compactChoiceSetDefinition(current),
        observed: definition,
        priorSource: currentSource,
        source
      });
    }

    const before = current ? cloneJson(current) : null;
    const row = current || {
      id: state.nextChoiceSetId++,
      key,
      createdAt: now(),
      createdEventIndex: state.nextEventIndex,
      createdContext: mergeTurnContext(state.context, input.context)
    };
    row.domain = domain;
    row.candidates = candidates;
    row.candidateCount = candidates.length;
    row.ordered = definition.ordered;
    row.complete = definition.complete;
    row.withReplacement = withReplacement;
    row.selectionAgency = definition.selectionAgency;
    row.samplingModel = definition.samplingModel;
    row.candidateWeights = definition.candidateWeights;
    row.candidateConstraint = definition.candidateConstraint;
    row.sourceZones = definition.sourceZones;
    row.sourceResolved = definition.sourceResolved;
    row.selectionLimits = definition.selectionLimits;
    row.status = "pending";
    row.active = true;
    row.actorSeat = scope.actorSeat;
    row.subjectSeat = scope.subjectSeat;
    row.observerSeats = scope.observerSeats;
    row.visibility = scope.visibility;
    row.ruleIdentityKey = scope.ruleIdentityKey;
    row.whileSkillBindingKey = scope.whileSkillBindingKey;
    row.skillId = scope.skillId;
    row.ownerSeat = scope.ownerSeat;
    row.causalEventId = scope.causalEventId;
    row.lifecycle = scope.lifecycle;
    row.expireOnEventTypes = scope.expireOnEventTypes;
    row.metadata = scope.metadata;
    row.source = source;
    row.updatedAt = now();
    row.updatedEventIndex = state.nextEventIndex;
    row.updatedContext = mergeTurnContext(state.context, input.context);
    delete row.selectedIndexes;
    delete row.selectedCandidates;
    delete row.selectedPhysicalCardIds;
    delete row.resultFromIncompletePopulation;
    delete row.outcome;
    delete row.resolvedAt;
    delete row.resolvedEventIndex;
    delete row.resolutionReason;
    delete row.resolutionSource;
    state.choiceSets[key] = row;
    appendChoiceSetHistory(current ? "update" : "observe", row, { before, source, reason: input.reason });
    recordEvent("choice.set.observed", {
      key,
      domain,
      candidateCount: candidates.length,
      physicalReferences: candidates.filter((candidate) => candidate.physicalCardId != null).map((candidate) => candidate.physicalCardId),
      skillId: row.skillId,
      source
    });
    return cloneJson(row);
  }

  function choiceSets(input = {}) {
    const key = String(input.key || input.promptKey || input.choiceSetKey || "").trim();
    const domain = String(input.domain || input.candidateDomain || "").trim().toLowerCase();
    const status = String(input.status || "").trim();
    const skillId = finiteInteger(input.skillId, 0);
    const actorSeat = finiteInteger(input.actorSeat ?? input.seat, -1);
    const ownerSeat = finiteInteger(input.ownerSeat, -1);
    const causalEventId = String(input.causalEventId || input.eventId || "").trim();
    const selectionAgency = normalizeSelectionAgency(input.selectionAgency || input.agency, "");
    const samplingModel = String(input.samplingModel || input.sampling || "").trim().toLowerCase();
    return Object.values(state.choiceSets).filter((row) => {
      if (!row.active) return false;
      if (key && row.key !== key) return false;
      if (domain && row.domain !== domain) return false;
      if (status && row.status !== status) return false;
      if (skillId > 0 && row.skillId !== skillId) return false;
      if (actorSeat >= 0 && row.actorSeat !== actorSeat) return false;
      if (ownerSeat >= 0 && row.ownerSeat !== ownerSeat) return false;
      if (causalEventId && row.causalEventId !== causalEventId) return false;
      if (selectionAgency && row.selectionAgency !== selectionAgency) return false;
      if (samplingModel && row.samplingModel !== samplingModel) return false;
      return true;
    }).sort((left, right) => left.id - right.id).map(cloneJson);
  }

  function resolveChoiceSet(input = {}) {
    const key = String(typeof input === "string" ? input : input.key || input.promptKey || input.choiceSetKey || "").trim();
    const row = state.choiceSets[key];
    if (!row) return null;
    const rawStatus = String(typeof input === "string" ? "resolved" : input.status || input.outcomeStatus || "resolved").trim().toLowerCase();
    const status = rawStatus === "selected" ? "resolved" : ["resolved", "cancelled", "expired"].includes(rawStatus) ? rawStatus : "resolved";
    const externalRaw = status === "resolved"
      ? input.resultCardIds ?? input.resultCandidates ?? input.observedCandidates ?? (!row.complete ? input.selectedCandidates ?? input.selectedValues : null)
      : null;
    let externalCandidates = [];
    let selectedIndexes;
    if (status !== "resolved") {
      selectedIndexes = [];
    } else if (externalRaw != null && !row.complete) {
      const normalizedExternal = normalizeChoiceCandidates(externalRaw, row.domain);
      if (!normalizedExternal.ok) {
        contradiction("choice-set-external-result-invalid", {
          key,
          domain: row.domain,
          reason: normalizedExternal.reason,
          source: normalizeSource(input.source || sourceOf("choice-set-resolution", "server-protocol"), now)
        });
        return null;
      }
      externalCandidates = normalizedExternal.candidates;
      selectedIndexes = [];
    } else if (externalRaw != null) {
      selectedIndexes = resolveChoiceIndexes(row, { ...input, selectedCandidates: asList(externalRaw) });
    } else {
      selectedIndexes = resolveChoiceIndexes(row, input);
    }
    if (selectedIndexes == null) {
      contradiction("choice-set-selection-invalid", {
        key,
        domain: row.domain,
        selectedIndexes: cloneJson(input.selectedIndexes ?? input.indexes ?? input.selectedIndex ?? null),
        selectionLimits: row.selectionLimits,
        candidateCount: row.candidateCount,
        withReplacement: row.withReplacement,
        source: normalizeSource(input.source || sourceOf("choice-set-resolution", "server-protocol"), now)
      });
      return null;
    }
    const resolvedCandidateCount = selectedIndexes.length + externalCandidates.length;
    if (status === "resolved" && (
      resolvedCandidateCount < row.selectionLimits.min ||
      resolvedCandidateCount > row.selectionLimits.max
    )) {
      contradiction("choice-set-selection-count-conflict", {
        key,
        selectedCount: resolvedCandidateCount,
        selectionLimits: row.selectionLimits
      });
      return null;
    }

    const source = normalizeSource(typeof input === "string"
      ? sourceOf("choice-set-resolution", "server-protocol")
      : input.source || sourceOf("choice-set-resolution", "server-protocol"), now);
    const before = cloneJson(row);
    row.status = status;
    row.active = false;
    row.selectedIndexes = selectedIndexes;
    row.selectedCandidates = [
      ...selectedIndexes.map((index) => cloneJson(row.candidates[index])),
      ...externalCandidates.map(cloneJson)
    ];
    row.resultFromIncompletePopulation = externalCandidates.length > 0;
    row.selectedPhysicalCardIds = row.selectedCandidates.map((candidate) => candidate.physicalCardId).filter((cardId) => cardId != null);
    row.outcome = cloneJson(typeof input === "string" ? null : input.outcome ?? input.result ?? null);
    row.movementApplied = false;
    row.resolvedAt = now();
    row.resolvedEventIndex = state.nextEventIndex;
    row.resolutionReason = String(typeof input === "string" ? "observed-resolution" : input.reason || status);
    row.resolutionSource = source;
    delete state.choiceSets[key];
    expireCardViewsForChoiceSet(key, `choice-set:${row.resolutionReason}`, source);
    appendChoiceSetHistory(status, row, { before, source, reason: row.resolutionReason });
    recordEvent("choice.set.resolved", {
      key,
      domain: row.domain,
      status,
      selectedIndexes,
      selectedPhysicalCardIds: row.selectedPhysicalCardIds,
      movementApplied: false,
      source
    });
    return cloneJson(row);
  }

  function choiceSetHistory(input = {}) {
    const key = String(input.key || input.promptKey || input.choiceSetKey || "").trim();
    const domain = String(input.domain || input.candidateDomain || "").trim().toLowerCase();
    const operation = String(input.operation || input.status || "").trim().toLowerCase();
    const skillId = finiteInteger(input.skillId, 0);
    return state.choiceSetHistory.filter((row) => {
      if (key && row.key !== key) return false;
      if (domain && row.domain !== domain) return false;
      if (operation && row.operation !== operation) return false;
      if (skillId > 0 && row.skillId !== skillId) return false;
      return true;
    }).map(cloneJson);
  }

  function observeStochasticEvent(input = {}) {
    const candidates = input.candidates ?? input.population ?? input.options ?? [];
    return observeChoiceSet({
      ...input,
      key: input.key || input.eventKey || input.stochasticEventKey || input.eventId,
      candidates,
      complete: input.complete === true,
      selectionAgency: "server-random",
      samplingModel: input.samplingModel || input.sampling || "unknown",
      exactSelections: input.exactSelections ?? input.resultCount ?? input.count ?? 1,
      candidateConstraint: input.candidateConstraint ?? input.predicate,
      sourceZones: input.sourceZones ?? input.sourceZone ?? input.from,
      sourceResolved: input.sourceResolved === true,
      lifecycle: input.lifecycle || "event"
    });
  }

  function stochasticEvents(input = {}) {
    return choiceSets({ ...input, selectionAgency: "server-random" });
  }

  function resolveStochasticEvent(input = {}) {
    return resolveChoiceSet({
      ...input,
      key: input.key || input.eventKey || input.stochasticEventKey || input.eventId,
      resultCardIds: input.resultCardIds ?? input.cardIds,
      resultCandidates: input.resultCandidates ?? input.results,
      outcome: input.outcome ?? input.result ?? null,
      status: input.status || "resolved"
    });
  }

  function stochasticEventHistory(input = {}) {
    const key = String(input.key || input.eventKey || input.stochasticEventKey || "").trim();
    const operation = String(input.operation || input.status || "").trim().toLowerCase();
    const skillId = finiteInteger(input.skillId, 0);
    return state.choiceSetHistory.filter((row) => {
      if (row.selectionAgency !== "server-random") return false;
      if (key && row.key !== key) return false;
      if (operation && row.operation !== operation) return false;
      if (skillId > 0 && row.skillId !== skillId) return false;
      return true;
    }).map(cloneJson);
  }

  function stochasticProbability(input = {}) {
    const key = String(input.key || input.eventKey || input.stochasticEventKey || "").trim();
    const row = state.choiceSets[key];
    if (!row || row.selectionAgency !== "server-random") {
      return unavailableStochasticProbability(key, "stochastic-event-not-active");
    }
    if (!row.complete) return unavailableStochasticProbability(key, "candidate-population-incomplete", row);
    if (!row.candidates.length) return unavailableStochasticProbability(key, "candidate-population-empty", row);
    if (row.selectionLimits.max < 1) return unavailableStochasticProbability(key, "event-selects-no-candidate", row);
    let weights;
    if (["uniform-without-replacement", "uniform-with-replacement"].includes(row.samplingModel)) {
      weights = row.candidates.map(() => 1);
    } else if (row.samplingModel === "weighted") {
      weights = Array.from(row.candidateWeights || []);
    } else if (row.samplingModel === "deterministic" && row.candidates.length === 1) {
      weights = [1];
    } else {
      return unavailableStochasticProbability(key, `sampling-model-${row.samplingModel || "unknown"}`, row);
    }
    const total = weights.reduce((sum, weight) => sum + Number(weight || 0), 0);
    if (!(total > 0) || weights.length !== row.candidates.length) {
      return unavailableStochasticProbability(key, "candidate-weights-invalid", row);
    }
    return {
      available: true,
      key,
      samplingModel: row.samplingModel,
      selectionAgency: row.selectionAgency,
      probabilityKind: "next-selection",
      candidateCount: row.candidateCount,
      complete: true,
      sourceZones: Array.from(row.sourceZones || []),
      sourceResolved: row.sourceResolved === true,
      assumption: "explicit-sampling-model-and-complete-candidate-population",
      candidates: row.candidates.map((candidate, index) => ({
        index,
        domain: candidate.domain,
        value: cloneJson(candidate.value),
        physicalCardId: candidate.physicalCardId,
        probability: weights[index] / total
      }))
    };
  }

  function unavailableStochasticProbability(key, reason, row = null) {
    return {
      available: false,
      key: key || null,
      reason,
      samplingModel: row?.samplingModel || "unknown",
      selectionAgency: row?.selectionAgency || "server-random",
      probabilityKind: "next-selection",
      candidateCount: row?.candidateCount ?? 0,
      complete: row?.complete === true,
      sourceZones: Array.from(row?.sourceZones || []),
      sourceResolved: row?.sourceResolved === true,
      assumption: "none",
      candidates: []
    };
  }

  function expireChoiceSetsForEvent(eventType, previousContext, currentContext) {
    for (const row of Object.values(state.choiceSets)) {
      const created = row.createdContext || {};
      const lifecycle = String(row.lifecycle || "prompt");
      const explicitEvent = row.expireOnEventTypes?.includes(eventType);
      const turnExpired = lifecycle === "turn" && created.turn != null && currentContext.turn != null && created.turn !== currentContext.turn;
      const roundExpired = lifecycle === "round" && created.round != null && currentContext.round != null && created.round !== currentContext.round;
      const phaseExpired = lifecycle === "phase" && created.phase != null && currentContext.phase != null && (
        created.turn !== currentContext.turn || created.round !== currentContext.round || created.phase !== currentContext.phase
      );
      if (explicitEvent || turnExpired || roundExpired || phaseExpired || eventType === "game:over") {
        resolveChoiceSet({
          key: row.key,
          status: "expired",
          reason: explicitEvent ? `event:${eventType}` : eventType === "game:over" ? "game-over" : `${lifecycle}-changed`
        });
      }
    }
  }

  function expireChoiceSetsForCausalEvent(eventId) {
    if (!eventId) return;
    for (const row of Object.values(state.choiceSets)) {
      if (row.lifecycle !== "event" || row.causalEventId !== eventId) continue;
      resolveChoiceSet({ key: row.key, status: "expired", reason: `causal-event-settled:${eventId}` });
    }
  }

  function appendChoiceSetHistory(operation, row, extra = {}) {
    state.choiceSetHistory.push({
      index: state.nextChoiceSetHistoryIndex++,
      operation,
      key: row.key,
      domain: row.domain,
      selectionAgency: row.selectionAgency,
      samplingModel: row.samplingModel,
      skillId: row.skillId,
      actorSeat: row.actorSeat,
      candidateCount: row.candidateCount,
      selectedIndexes: Array.from(row.selectedIndexes || []),
      selectedPhysicalCardIds: Array.from(row.selectedPhysicalCardIds || []),
      sourceZones: Array.from(row.sourceZones || []),
      sourceResolved: row.sourceResolved === true,
      before: extra.before || null,
      after: ["resolved", "cancelled", "expired"].includes(operation) ? null : cloneJson(row),
      result: ["resolved", "cancelled", "expired"].includes(operation) ? cloneJson(row) : null,
      reason: String(extra.reason || ""),
      source: normalizeSource(extra.source || row.source || sourceOf("choice-set-history", "rule-feedback"), now),
      context: { ...state.context },
      eventIndex: state.nextEventIndex,
      time: now()
    });
    if (state.choiceSetHistory.length > maxEvents) {
      state.choiceSetHistory.splice(0, state.choiceSetHistory.length - maxEvents);
    }
  }

  function choiceSetDefinitionEquals(row, definition) {
    return canonicalJsonKey(compactChoiceSetDefinition(row)) === canonicalJsonKey(compactChoiceSetDefinition(definition));
  }

  function choiceSetScopeEquals(row, scope) {
    return canonicalJsonKey({
      actorSeat: row.actorSeat ?? null,
      subjectSeat: row.subjectSeat ?? null,
      observerSeats: Array.from(row.observerSeats || []).sort((left, right) => left - right),
      visibility: String(row.visibility || "unknown"),
      ruleIdentityKey: String(row.ruleIdentityKey || ""),
      whileSkillBindingKey: row.whileSkillBindingKey || null,
      skillId: row.skillId ?? null,
      ownerSeat: row.ownerSeat ?? null,
      causalEventId: row.causalEventId || null,
      lifecycle: String(row.lifecycle || "prompt"),
      expireOnEventTypes: Array.from(row.expireOnEventTypes || []).sort(),
      metadata: cloneJson(row.metadata || {})
    }) === canonicalJsonKey(scope);
  }

  function compactChoiceSetDefinition(row) {
    return {
      domain: row.domain,
      candidates: cloneJson(row.candidates || []),
      ordered: row.ordered !== false,
      complete: row.complete !== false,
      withReplacement: row.withReplacement === true,
      selectionAgency: row.selectionAgency || "player-choice",
      samplingModel: row.samplingModel || "not-applicable",
      candidateWeights: Array.from(row.candidateWeights || []),
      candidateConstraint: cloneJson(row.candidateConstraint ?? null),
      sourceZones: Array.from(row.sourceZones || []),
      sourceResolved: row.sourceResolved === true,
      selectionLimits: cloneJson(row.selectionLimits || { min: 0, max: 0, exact: null })
    };
  }

  function resolveChoiceIndexes(row, input = {}) {
    let raw = input.selectedIndexes ?? input.indexes;
    if (raw == null && input.selectedIndex != null) raw = [input.selectedIndex];
    if (raw == null && (input.selectedCandidates != null || input.selectedValues != null)) {
      const selectedValues = asList(input.selectedCandidates ?? input.selectedValues);
      const used = new Set();
      raw = [];
      for (const value of selectedValues) {
        const selectedPhysicalCardId = row.domain === "physical-card-id"
          ? finiteInteger(value && typeof value === "object" ? value.physicalCardId ?? value.cardId ?? value.CardID ?? value.id ?? value.value : value, 0)
          : 0;
        const index = row.candidates.findIndex((candidate, candidateIndex) =>
          (row.withReplacement || !used.has(candidateIndex)) && (
            selectedPhysicalCardId > 0
              ? candidate.physicalCardId === selectedPhysicalCardId
              : canonicalJsonKey(candidate.value) === canonicalJsonKey(value)
          )
        );
        if (index < 0) return null;
        raw.push(index);
        used.add(index);
      }
    }
    const values = raw == null ? [] : asList(raw).map((value) => Number(value));
    if (values.some((value) => !Number.isInteger(value) || value < 0 || value >= row.candidates.length)) return null;
    if (!row.withReplacement && new Set(values).size !== values.length) return null;
    return values;
  }

  function compactScheduledEvent(event = {}) {
    return {
      eventType: String(event.eventType || event.type || ""),
      eventIndex: nonNegativeIntegerOrNull(event.eventIndex),
      causalEventId: stringOrNull(event.causalEventId),
      seat: finiteNumber(event.seat),
      casterSeat: finiteNumber(event.casterSeat),
      targetSeats: uniqueFiniteNumbers(asList(event.targetSeats || event.targets)),
      skillId: finiteInteger(event.skillId, 0) || null,
      cardId: finiteInteger(event.cardId ?? event.card?.id, 0) || null,
      context: scheduledEventContext(state.context, event.context)
    };
  }

  function updateRuleState(input = {}) {
    const key = String(input.key || input.stateKey || "").trim();
    const kind = String(input.kind || "scalar").trim().toLowerCase();
    const operation = String(input.operation || input.op || "set").trim().toLowerCase();
    if (!key || !["scalar", "counter", "set", "ordered-list"].includes(kind)) return null;
    const current = state.ruleStates[key] || null;
    if (current && current.kind !== kind) {
      contradiction("rule-state-kind-conflict", { key, expected: current.kind, observed: kind });
      return null;
    }
    const before = current ? cloneJson(current.value) : initialRuleStateValue(kind);
    const next = applyRuleStateMutation(kind, before, operation, input.value ?? input.values, input.amount);
    if (next.status !== "applied") return null;
    const source = normalizeSource(input.source || sourceOf("rule-state-update", "rule-feedback", {
      skillId: finiteInteger(input.skillId, 0)
    }), now);
    const row = current || {
      id: state.nextRuleStateIndex++,
      key,
      kind,
      createdAt: now(),
      createdEventIndex: state.nextEventIndex,
      createdContext: mergeTurnContext(state.context, input.context)
    };
    row.value = next.value;
    row.lifecycle = String(input.lifecycle || row.lifecycle || "game");
    const explicitExpiry = input.expireOnEventTypes ?? input.expireOnEvents;
    row.expireOnEventTypes = explicitExpiry == null
      ? Array.from(row.expireOnEventTypes || [])
      : uniqueStrings(normalizeListInput(explicitExpiry));
    row.ruleIdentityKey = String(input.ruleIdentityKey || row.ruleIdentityKey || "");
    row.whileSkillBindingKey = String(input.whileSkillBindingKey || input.skillBindingKey || row.whileSkillBindingKey || "") || null;
    row.skillId = finiteInteger(input.skillId ?? row.skillId, 0) || null;
    row.ownerSeat = finiteNumber(input.ownerSeat ?? row.ownerSeat);
    row.metadata = cloneJson(input.metadata ?? row.metadata ?? {});
    row.source = source;
    row.updatedAt = now();
    row.updatedEventIndex = state.nextEventIndex;
    row.updatedContext = mergeTurnContext(state.context, input.context);
    row.active = true;
    state.ruleStates[key] = row;
    const history = {
      index: state.nextRuleStateHistoryIndex++,
      key,
      kind,
      operation,
      before,
      after: cloneJson(row.value),
      lifecycle: row.lifecycle,
      source,
      context: { ...state.context },
      eventIndex: state.nextEventIndex,
      time: now()
    };
    state.ruleStateHistory.push(history);
    recordEvent("rule.state.updated", history);
    return cloneJson(row);
  }

  function ruleState(keyValue) {
    const key = String(keyValue || "").trim();
    return state.ruleStates[key] ? cloneJson(state.ruleStates[key]) : null;
  }

  function clearRuleState(input = {}) {
    const key = String(typeof input === "string" ? input : input.key || input.stateKey || "").trim();
    const row = state.ruleStates[key];
    if (!row) return false;
    const reason = String(typeof input === "string" ? "explicit-clear" : input.reason || "explicit-clear");
    const source = normalizeSource(typeof input === "string" ? sourceOf("rule-state-clear", "rule-feedback") : input.source || sourceOf("rule-state-clear", "rule-feedback"), now);
    const history = {
      index: state.nextRuleStateHistoryIndex++,
      key,
      kind: row.kind,
      operation: "expire",
      before: cloneJson(row.value),
      after: null,
      lifecycle: row.lifecycle,
      reason,
      source,
      context: { ...state.context },
      eventIndex: state.nextEventIndex,
      time: now()
    };
    state.ruleStateHistory.push(history);
    delete state.ruleStates[key];
    recordEvent("rule.state.cleared", history);
    return true;
  }

  function expireRuleStatesForEvent(eventType, previousContext, currentContext) {
    for (const [key, row] of Object.entries(state.ruleStates)) {
      const created = row.createdContext || {};
      const lifecycle = String(row.lifecycle || "game");
      const explicitEvent = row.expireOnEventTypes?.includes(eventType);
      const turnExpired = lifecycle === "turn" && created.turn != null && currentContext.turn != null && created.turn !== currentContext.turn;
      const roundExpired = lifecycle === "round" && created.round != null && currentContext.round != null && created.round !== currentContext.round;
      const phaseExpired = lifecycle === "phase" && created.phase != null && currentContext.phase != null && (
        created.turn !== currentContext.turn || created.round !== currentContext.round || created.phase !== currentContext.phase
      );
      if (explicitEvent || turnExpired || roundExpired || phaseExpired || eventType === "game:over") {
        clearRuleState({
          key,
          reason: explicitEvent ? `event:${eventType}` : eventType === "game:over" ? "game-over" : `${lifecycle}-changed`
        });
      }
    }
  }

  function registerRuleModifier(input = {}) {
    const key = String(input.key || input.modifierKey || "").trim();
    const kind = String(input.kind || input.modifierKind || "").trim();
    const subject = String(input.subject || input.targetOperation || input.field || "").trim();
    if (!key || !kind || !subject) return null;
    const source = normalizeSource(input.source || sourceOf("rule-modifier-register", "rule-feedback", {
      skillId: finiteInteger(input.skillId, 0)
    }), now);
    const current = state.ruleModifiers[key] || null;
    const requestedEventId = stringOrNull(input.eventId ?? input.causalEventId);
    const requestedTargetEventId = stringOrNull(input.targetEventId ?? input.effectEventId);
    const requestedTargetSeat = finiteNumber(input.targetSeat);
    if (current && (current.kind !== kind || current.subject !== subject)) {
      contradiction("rule-modifier-identity-conflict", {
        key,
        expected: { kind: current.kind, subject: current.subject },
        observed: { kind, subject },
        source
      });
      return null;
    }
    if (current) {
      for (const [field, incoming, provided] of [
        ["eventId", requestedEventId, input.eventId != null || input.causalEventId != null],
        ["targetEventId", requestedTargetEventId, input.targetEventId != null || input.effectEventId != null],
        ["targetSeat", requestedTargetSeat, input.targetSeat != null]
      ]) {
        if (provided && (current[field] ?? null) !== (incoming ?? null)) {
          contradiction("rule-modifier-scope-identity-conflict", {
            key,
            field,
            previous: current[field],
            observed: incoming,
            source
          });
          return null;
        }
      }
    }
    const before = current ? cloneJson(current) : null;
    const row = current || {
      id: state.nextRuleModifierIndex++,
      key,
      kind,
      subject,
      createdAt: now(),
      createdEventIndex: state.nextEventIndex,
      createdContext: mergeTurnContext(state.context, input.context)
    };
    row.selector = cloneJson(input.selector || input.when || row.selector || {});
    row.effect = cloneJson(input.effect ?? input.value ?? row.effect ?? {});
    row.lifecycle = String(input.lifecycle || row.lifecycle || "game");
    row.expireOnEventTypes = input.expireOnEventTypes == null && input.expireOnEvents == null
      ? Array.from(row.expireOnEventTypes || [])
      : uniqueStrings(asList(input.expireOnEventTypes ?? input.expireOnEvents));
    row.ruleIdentityKey = String(input.ruleIdentityKey || row.ruleIdentityKey || "");
    row.whileSkillBindingKey = String(input.whileSkillBindingKey || input.skillBindingKey || row.whileSkillBindingKey || "") || null;
    row.skillId = finiteInteger(input.skillId ?? row.skillId, 0) || null;
    row.ownerSeat = finiteNumber(input.ownerSeat ?? row.ownerSeat);
    row.eventId = requestedEventId || row.eventId || null;
    row.targetEventId = requestedTargetEventId || row.targetEventId || null;
    row.targetSeat = requestedTargetSeat ?? row.targetSeat ?? null;
    row.channelKey = stringOrNull(input.channelKey ?? row.channelKey);
    row.whileCardId = finiteInteger(input.whileCardId ?? input.cardId ?? row.whileCardId, 0) || null;
    row.whileCardGeneration = row.whileCardId
      ? positiveIntegerOrNull(input.whileCardGeneration ?? input.cardGeneration ?? row.whileCardGeneration)
        || physicalCardGeneration(row.whileCardId)
      : null;
    row.whileZone = normalizeZoneKey(input.whileZone || row.whileZone) || null;
    row.priority = finiteNumber(input.priority ?? row.priority) ?? 0;
    row.metadata = cloneJson(input.metadata ?? row.metadata ?? {});
    row.source = source;
    row.updatedAt = now();
    row.updatedEventIndex = state.nextEventIndex;
    row.active = true;
    state.ruleModifiers[key] = row;
    appendRuleModifierHistory(current ? "update" : "register", row, {
      before,
      source,
      reason: String(input.reason || "")
    });
    recordEvent("rule.modifier.registered", {
      key,
      kind,
      subject,
      lifecycle: row.lifecycle,
      eventId: row.eventId,
      targetEventId: row.targetEventId,
      targetSeat: row.targetSeat,
      whileCardId: row.whileCardId,
      whileZone: row.whileZone,
      source
    });
    return cloneJson(row);
  }

  function activeRuleModifiers(input = {}) {
    const kind = String(input.kind || input.modifierKind || "").trim();
    const subject = String(input.subject || "").trim();
    const ruleIdentityKey = String(input.ruleIdentityKey || "").trim();
    const eventId = String(input.eventId || input.causalEventId || "").trim();
    const targetEventId = String(input.targetEventId || input.effectEventId || "").trim();
    const targetSeat = finiteInteger(input.targetSeat, -1);
    const channelKey = String(input.channelKey || "").trim();
    const skillId = finiteInteger(input.skillId, 0);
    const ownerSeat = finiteInteger(input.ownerSeat, -1);
    const whileCardId = finiteInteger(input.whileCardId ?? input.cardId, 0);
    const whileSkillBindingKey = String(input.whileSkillBindingKey || input.skillBindingKey || "").trim();
    return Object.values(state.ruleModifiers).filter((row) => {
      if (!row.active) return false;
      if (row.whileCardId && row.whileCardGeneration != null
        && row.whileCardGeneration !== physicalCardGeneration(row.whileCardId)) return false;
      if (kind && row.kind !== kind) return false;
      if (subject && row.subject !== subject) return false;
      if (ruleIdentityKey && row.ruleIdentityKey !== ruleIdentityKey) return false;
      if (eventId && row.eventId !== eventId) return false;
      if (targetEventId && row.targetEventId !== targetEventId) return false;
      if (targetSeat >= 0 && row.targetSeat !== targetSeat) return false;
      if (channelKey && row.channelKey !== channelKey) return false;
      if (skillId > 0 && row.skillId !== skillId) return false;
      if (ownerSeat >= 0 && row.ownerSeat !== ownerSeat) return false;
      if (whileCardId > 0 && row.whileCardId !== whileCardId) return false;
      if (whileSkillBindingKey && row.whileSkillBindingKey !== whileSkillBindingKey) return false;
      return true;
    }).sort((left, right) => left.priority - right.priority || left.id - right.id).map(cloneJson);
  }

  function removeRuleModifier(input = {}) {
    const key = String(typeof input === "string" ? input : input.key || input.modifierKey || "").trim();
    const row = state.ruleModifiers[key];
    if (!row) return false;
    const reason = String(typeof input === "string" ? "explicit-remove" : input.reason || "explicit-remove");
    const source = normalizeSource(typeof input === "string"
      ? sourceOf("rule-modifier-remove", "rule-feedback")
      : input.source || sourceOf("rule-modifier-remove", "rule-feedback"), now);
    appendRuleModifierHistory("expire", row, { before: cloneJson(row), reason, source });
    delete state.ruleModifiers[key];
    recordEvent("rule.modifier.removed", { key, reason, source });
    return true;
  }

  function appendRuleModifierHistory(operation, row, extra = {}) {
    state.ruleModifierHistory.push({
      index: state.nextRuleModifierHistoryIndex++,
      operation,
      key: row.key,
      kind: row.kind,
      subject: row.subject,
      before: extra.before || null,
      after: operation === "expire" ? null : cloneJson(row),
      reason: String(extra.reason || ""),
      source: normalizeSource(extra.source || row.source || sourceOf("rule-modifier-history", "rule-feedback"), now),
      context: { ...state.context },
      eventIndex: state.nextEventIndex,
      time: now()
    });
  }

  function expireRuleModifiersForEvent(eventType, previousContext, currentContext) {
    for (const [key, row] of Object.entries(state.ruleModifiers)) {
      const created = row.createdContext || {};
      const lifecycle = String(row.lifecycle || "game");
      const explicitEvent = row.expireOnEventTypes?.includes(eventType);
      const turnExpired = lifecycle === "turn" && created.turn != null && currentContext.turn != null && created.turn !== currentContext.turn;
      const roundExpired = lifecycle === "round" && created.round != null && currentContext.round != null && created.round !== currentContext.round;
      const phaseExpired = lifecycle === "phase" && created.phase != null && currentContext.phase != null && (
        created.turn !== currentContext.turn || created.round !== currentContext.round || created.phase !== currentContext.phase
      );
      if (explicitEvent || turnExpired || roundExpired || phaseExpired || eventType === "game:over") {
        removeRuleModifier({
          key,
          reason: explicitEvent ? `event:${eventType}` : eventType === "game:over" ? "game-over" : `${lifecycle}-changed`
        });
      }
    }
  }

  function expireRuleModifiersForCardMove(cardId, fromZone) {
    for (const [key, row] of Object.entries(state.ruleModifiers)) {
      if (row.lifecycle !== "while-zone") continue;
      if (row.whileCardId !== cardId) continue;
      if (row.whileZone && row.whileZone !== fromZone) continue;
      removeRuleModifier({ key, reason: `card-left:${fromZone}` });
    }
  }

  function expireRuleModifiersForCausalEvent(eventId) {
    if (!eventId) return;
    for (const [key, row] of Object.entries(state.ruleModifiers)) {
      if (row.lifecycle === "event" && (row.eventId === eventId || row.targetEventId === eventId)) {
        removeRuleModifier({ key, reason: `causal-event-settled:${eventId}` });
      }
    }
  }

  function expireCardViewsForCausalEvent(eventId) {
    if (!eventId) return;
    for (const [cardIdValue, views] of Object.entries(state.cardViews)) {
      const matching = Object.values(views).filter((row) =>
        row.whileCausalEventId === eventId
        || row.lifecycle === "causal-event" && row.causalEventId === eventId
      );
      if (!matching.length) continue;
      const ids = new Set(matching.map((row) => row.id));
      invalidateCardViews(
        Number(cardIdValue),
        `causal-event-settled:${eventId}`,
        null,
        (row) => ids.has(row.id)
      );
    }
  }

  function observeEffectiveCardAttributes(input = {}) {
    return observeCardAttributeView({ ...input, viewKind: "effective", affectsRules: true });
  }

  function observeApparentCardAttributes(input = {}) {
    return observeCardAttributeView({ ...input, viewKind: "apparent", affectsRules: false });
  }

  function observeCardAttributeView(input = {}) {
    const cardId = finiteInteger(input.cardId ?? input.id, 0);
    if (cardId <= 0) return null;
    const attributes = {};
    for (const field of ["name", "type", "subtype", "color", "suit", "number", "spellId", "nature", "isDamageCard", "isDelayedTrick", "isOrdinaryTrick", "equipSubtype", "spellClass"]) {
      if (input.attributes?.[field] == null) continue;
      attributes[field] = normalizePredicateValue(field, input.attributes[field]);
    }
    if (!Object.keys(attributes).length) return null;
    if (attributes.suit != null && attributes.color == null) {
      attributes.color = attributes.suit === 1 || attributes.suit === 2 ? "red" : attributes.suit === 3 || attributes.suit === 4 ? "black" : "";
    }
    const viewKind = String(input.viewKind || (input.affectsRules === false ? "apparent" : "effective")).trim().toLowerCase() || "effective";
    const affectsRules = input.affectsRules == null ? viewKind === "effective" : input.affectsRules === true;
    const source = normalizeSource(input.source || sourceOf(`${viewKind}-card-attributes`, "rule-feedback"), now);
    const causalEventId = stringOrNull(input.causalEventId ?? input.eventId);
    const targetSeat = finiteNumber(input.targetSeat);
    const channelKey = stringOrNull(input.channelKey ?? input.channel);
    const explicitScope = String(input.scope || "").trim();
    const row = {
      id: state.nextCardViewIndex++,
      cardId,
      physicalGeneration: physicalCardGeneration(cardId),
      viewKind,
      affectsRules,
      scope: explicitScope || (causalEventId || targetSeat != null || channelKey ? "event" : "global"),
      contextKey: String(input.contextKey || contextKey(state.context)),
      causalEventId,
      targetSeat,
      channelKey,
      whileCausalEventId: stringOrNull(input.whileCausalEventId ?? input.whileEventId ?? input.effectEventId),
      attributes,
      printedCard: normalizedCardForId(cardId),
      whileZone: normalizeZoneKey(input.whileZone) || state.locations[cardId]?.zoneKey || null,
      expiresOnMove: input.expiresOnMove !== false,
      lifecycle: String(input.lifecycle || "view"),
      expireOnEventTypes: uniqueStrings(asList(input.expireOnEventTypes ?? input.expireOnEvents)).sort(),
      whileChoiceSetKey: String(input.whileChoiceSetKey || input.choiceSetKey || input.promptKey || "") || null,
      whileSkillBindingKey: String(input.whileSkillBindingKey || input.skillBindingKey || "") || null,
      observerSeats: uniqueFiniteNumbers(asList(input.observerSeats ?? input.viewerSeats ?? input.observerSeat ?? input.viewerSeat)).sort((left, right) => left - right),
      visibility: String(input.visibility || (viewKind === "apparent" ? "scoped" : "rule-effective")),
      reason: String(input.reason || ""),
      source,
      createdContext: mergeTurnContext(state.context, input.context),
      createdAt: now(),
      active: true
    };
    state.cardViews[cardId] ||= {};
    state.cardViews[cardId][row.id] = row;
    state.cardViewHistory.push(cloneJson(row));
    if (state.cardViewHistory.length > maxEvents) state.cardViewHistory.splice(0, state.cardViewHistory.length - maxEvents);
    recordEvent(`card.${viewKind}-attributes.added`, row);
    return cloneJson(row);
  }

  function effectiveCard(cardIdValue, options = {}) {
    const cardId = finiteInteger(cardIdValue, 0);
    const printed = normalizedCardForId(cardId);
    const views = Object.values(state.cardViews[cardId] || {})
      .filter((row) => row.active
        && (row.physicalGeneration == null || row.physicalGeneration === physicalCardGeneration(cardId))
        && row.affectsRules !== false
        && cardViewMatchesContext(row, options))
      .sort((a, b) => a.id - b.id);
    const effective = { ...printed };
    for (const row of views) Object.assign(effective, row.attributes);
    if (views.some((row) => row.attributes.suit != null) && !views.some((row) => row.attributes.color != null)) {
      effective.color = effective.suit === 1 || effective.suit === 2 ? "red" : effective.suit === 3 || effective.suit === 4 ? "black" : "";
    }
    effective.rank = rankLabel(effective.number);
    return { cardId, printed, effective, views: views.map(cloneJson) };
  }

  function apparentCard(cardIdValue, options = {}) {
    const cardId = finiteInteger(cardIdValue, 0);
    const printed = normalizedCardForId(cardId);
    const effectiveResult = effectiveCard(cardId, options);
    const observerSeat = finiteInteger(options.observerSeat ?? options.viewerSeat, -1);
    const views = Object.values(state.cardViews[cardId] || {})
      .filter((row) => {
        if (!row.active || row.affectsRules !== false) return false;
        if (row.physicalGeneration != null && row.physicalGeneration !== physicalCardGeneration(cardId)) return false;
        if (!cardViewMatchesContext(row, options)) return false;
        if (!row.observerSeats?.length) return true;
        return observerSeat >= 0 && row.observerSeats.includes(observerSeat);
      })
      .sort((left, right) => left.id - right.id);
    const apparent = { ...(options.includeEffective === true ? effectiveResult.effective : printed) };
    for (const row of views) Object.assign(apparent, row.attributes);
    if (views.some((row) => row.attributes.suit != null) && !views.some((row) => row.attributes.color != null)) {
      apparent.color = apparent.suit === 1 || apparent.suit === 2 ? "red" : apparent.suit === 3 || apparent.suit === 4 ? "black" : "";
    }
    apparent.rank = rankLabel(apparent.number);
    return {
      cardId,
      observerSeat: observerSeat >= 0 ? observerSeat : null,
      printed,
      effective: effectiveResult.effective,
      apparent,
      views: views.map(cloneJson)
    };
  }

  function cardAttributeViews(cardIdValue, options = {}) {
    const cardId = finiteInteger(cardIdValue, 0);
    const viewKind = String(options.viewKind || options.kind || "").trim().toLowerCase();
    const observerSeat = finiteInteger(options.observerSeat ?? options.viewerSeat, -1);
    const hasContextFilter = options.scope != null
      || options.causalEventId != null
      || options.eventId != null
      || options.targetSeat != null
      || options.channelKey != null
      || options.channel != null;
    return Object.values(state.cardViews[cardId] || {}).filter((row) => {
      if (!row.active) return false;
      if (row.physicalGeneration != null && row.physicalGeneration !== physicalCardGeneration(cardId)) return false;
      if (viewKind && row.viewKind !== viewKind) return false;
      if (hasContextFilter && !cardViewMatchesContext(row, options)) return false;
      if (observerSeat >= 0 && row.observerSeats?.length && !row.observerSeats.includes(observerSeat)) return false;
      return true;
    }).sort((left, right) => left.id - right.id).map(cloneJson);
  }

  function clearEffectiveCardAttributes(input = {}) {
    const cardId = finiteInteger(input.cardId ?? input.id, 0);
    if (cardId <= 0 || !state.cardViews[cardId]) return 0;
    return invalidateCardViews(cardId, input.reason || "explicit-clear", input.source, (row) =>
      row.affectsRules !== false && cardViewMatchesClear(row, input)
    );
  }

  function clearApparentCardAttributes(input = {}) {
    const cardId = finiteInteger(input.cardId ?? input.id, 0);
    if (cardId <= 0 || !state.cardViews[cardId]) return 0;
    return invalidateCardViews(cardId, input.reason || "explicit-clear", input.source, (row) =>
      row.affectsRules === false && cardViewMatchesClear(row, input)
    );
  }

  function cardViewMatchesContext(row, options = {}) {
    const requestedScope = options.scope == null ? "" : String(options.scope).trim();
    const causalEventId = String(options.causalEventId || options.eventId || "").trim();
    const targetSeat = finiteInteger(options.targetSeat, -1);
    const channelKey = String(options.channelKey || options.channel || "").trim();
    const typedBindings = [row.causalEventId, row.targetSeat != null ? String(row.targetSeat) : "", row.channelKey].filter(Boolean);
    if (row.scope !== "global") {
      if (requestedScope) {
        if (row.scope !== requestedScope) return false;
      } else {
        if (!typedBindings.length) return false;
        const hasMatchingTypedContext = row.causalEventId && causalEventId === row.causalEventId
          || row.targetSeat != null && targetSeat === row.targetSeat
          || row.channelKey && channelKey === row.channelKey;
        if (!hasMatchingTypedContext) return false;
      }
    }
    if (row.causalEventId && row.causalEventId !== causalEventId) return false;
    if (row.targetSeat != null && row.targetSeat !== targetSeat) return false;
    if (row.channelKey && row.channelKey !== channelKey) return false;
    return true;
  }

  function cardViewMatchesClear(row, input = {}) {
    const scope = input.scope == null ? "" : String(input.scope).trim();
    const causalEventId = String(input.causalEventId || input.eventId || "").trim();
    const targetSeat = finiteInteger(input.targetSeat, -1);
    const channelKey = String(input.channelKey || input.channel || "").trim();
    const whileCausalEventId = String(input.whileCausalEventId || input.whileEventId || input.effectEventId || "").trim();
    if (scope && row.scope !== scope) return false;
    if (causalEventId && row.causalEventId !== causalEventId) return false;
    if (targetSeat >= 0 && row.targetSeat !== targetSeat) return false;
    if (channelKey && row.channelKey !== channelKey) return false;
    if (whileCausalEventId && row.whileCausalEventId !== whileCausalEventId) return false;
    return true;
  }

  function exchangeZones(input = {}) {
    const leftZoneKey = normalizeZoneKey(input.leftZone || input.fromZone || input.zoneA);
    const rightZoneKey = normalizeZoneKey(input.rightZone || input.toZone || input.zoneB);
    if (!leftZoneKey || !rightZoneKey || leftZoneKey === rightZoneKey) {
      return { applied: false, reason: "two-distinct-zones-required" };
    }
    const specializedZones = new Set([ZONE.DECK, ZONE.DISCARD, ZONE.SHUFFLE]);
    if (specializedZones.has(leftZoneKey) || specializedZones.has(rightZoneKey)) {
      return { applied: false, reason: "deck-discard-and-shuffle-require-specialized-exchange" };
    }

    const leftZone = ensureZone(leftZoneKey);
    const rightZone = ensureZone(rightZoneKey);
    const leftCount = nonNegativeIntegerOrNull(leftZone.count);
    const rightCount = nonNegativeIntegerOrNull(rightZone.count);
    if (leftCount == null || rightCount == null) {
      return { applied: false, reason: "both-zone-counts-must-be-known" };
    }
    const leftIds = leftZone.exactIds.slice();
    const rightIds = rightZone.exactIds.slice();
    const overlap = leftIds.filter((cardId) => rightIds.includes(cardId));
    if (overlap.length) {
      contradiction("zone-exchange-overlapping-exact-identities", {
        leftZone: leftZoneKey,
        rightZone: rightZoneKey,
        cardIds: overlap
      });
      return { applied: false, reason: "zone-identities-must-be-disjoint" };
    }
    const mismatchedLocations = [
      ...leftIds.filter((cardId) => state.locations[cardId]?.zoneKey !== leftZoneKey),
      ...rightIds.filter((cardId) => state.locations[cardId]?.zoneKey !== rightZoneKey)
    ];
    if (mismatchedLocations.length) {
      contradiction("zone-exchange-exact-location-mismatch", {
        leftZone: leftZoneKey,
        rightZone: rightZoneKey,
        cardIds: uniquePositiveIds(mismatchedLocations)
      });
      return { applied: false, reason: "exact-card-locations-must-match-zones" };
    }

    const source = normalizeSource(input.source || sourceOf("atomic-zone-exchange", "rule-feedback", {
      skillId: finiteInteger(input.skillId, 0) || null
    }), now);
    const context = mergeTurnContext(state.context, input.context);
    const causalEventId = stringOrNull(input.causalEventId ?? input.eventId ?? context.causalEventId);
    const movementReason = normalizeMovementReason(input.movementReason || input.reasonKind || "exchange");
    const reasonTags = uniqueStrings(["atomic-exchange", ...asList(input.reasonTags)]);
    const exchangeIndex = state.nextZoneExchangeIndex++;
    const atomicOperationId = String(input.atomicOperationId || input.exchangeId || `zone-exchange:${exchangeIndex}`).trim();
    const leftBefore = compactZone(leftZone);
    const rightBefore = compactZone(rightZone);
    const transitionContext = {
      ...context,
      causalEventId,
      movementReason,
      reasonTags,
      skillId: finiteInteger(input.skillId, 0) || null,
      protocol: String(input.protocol || ""),
      atomicOperationId,
      zoneExchangeIndex: exchangeIndex,
      simultaneous: true,
      contentChanged: leftCount > 0 || rightCount > 0
    };

    for (const cardId of leftIds) {
      removeExactCardFromZone(cardId, leftZoneKey, {
        source,
        toZoneKey: rightZoneKey,
        reason: input.reason || "atomic-zone-exchange"
      });
    }
    for (const cardId of rightIds) {
      removeExactCardFromZone(cardId, rightZoneKey, {
        source,
        toZoneKey: leftZoneKey,
        reason: input.reason || "atomic-zone-exchange"
      });
    }

    const updatedAt = now();
    leftZone.count = rightCount;
    leftZone.complete = rightZone.complete;
    leftZone.exactIds = [];
    leftZone.source = source;
    leftZone.updatedAt = updatedAt;
    rightZone.count = leftCount;
    rightZone.complete = leftBefore.complete;
    rightZone.exactIds = [];
    rightZone.source = source;
    rightZone.updatedAt = updatedAt;
    for (const cardId of rightIds) placeExactCard(cardId, leftZoneKey, source, { silent: true });
    for (const cardId of leftIds) placeExactCard(cardId, rightZoneKey, source, { silent: true });

    const remappedLocationGroups = remapLocationGroupsForZoneExchange(
      leftZoneKey,
      rightZoneKey,
      source,
      atomicOperationId
    );
    const forceHandGeneration = transitionContext.contentChanged === true;
    syncHandFromZone(leftZoneKey, transitionContext, "atomic-zone-exchange", { forceGeneration: forceHandGeneration });
    syncHandFromZone(rightZoneKey, transitionContext, "atomic-zone-exchange", { forceGeneration: forceHandGeneration });

    const exactMovements = [
      ...leftIds.map((cardId) => ({ cardId, from: leftZoneKey, to: rightZoneKey })),
      ...rightIds.map((cardId) => ({ cardId, from: rightZoneKey, to: leftZoneKey }))
    ];
    for (const movement of exactMovements) {
      appendCardEvent({
        eventIndex: state.nextEventIndex,
        eventType: "card:move",
        protocol: input.protocol || "",
        recordIndex: input.recordIndex ?? null,
        cardId: movement.cardId,
        skillId: finiteInteger(input.skillId, 0) || null,
        causalEventId,
        movementReason,
        moveType: finiteNumber(input.moveType),
        reasonTags,
        from: movement.from,
        to: movement.to,
        tags: ["moved", "atomic-exchange", `from:${movement.from}`, `to:${movement.to}`, `reason:${movementReason}`],
        context: transitionContext,
        source
      });
    }

    const row = {
      index: exchangeIndex,
      atomicOperationId,
      leftZone: leftZoneKey,
      rightZone: rightZoneKey,
      before: { left: leftBefore, right: rightBefore },
      after: { left: compactZone(leftZone), right: compactZone(rightZone) },
      exactMovements,
      hiddenCounts: {
        leftToRight: Math.max(0, leftCount - leftIds.length),
        rightToLeft: Math.max(0, rightCount - rightIds.length)
      },
      remappedLocationGroups,
      causalEventId,
      movementReason,
      reasonTags,
      context: transitionContext,
      source,
      eventIndex: state.nextEventIndex,
      time: now()
    };
    state.zoneExchangeHistory.push(row);
    if (state.zoneExchangeHistory.length > maxEvents) {
      state.zoneExchangeHistory.splice(0, state.zoneExchangeHistory.length - maxEvents);
    }
    recordEvent("zone.exchange", {
      index: exchangeIndex,
      atomicOperationId,
      leftZone: leftZoneKey,
      rightZone: rightZoneKey,
      exactCardIds: exactMovements.map((movement) => movement.cardId),
      causalEventId,
      movementReason,
      source
    });
    validatePhysicalWorld();
    return { applied: true, ...cloneJson(row) };
  }

  function zoneExchanges(input = {}) {
    const zoneKey = normalizeZoneKey(input.zoneKey || input.zone);
    const causalEventId = String(input.causalEventId || input.eventId || "").trim();
    const atomicOperationId = String(input.atomicOperationId || input.exchangeId || "").trim();
    const sinceEventIndex = nonNegativeIntegerOrNull(input.sinceEventIndex);
    return state.zoneExchangeHistory.filter((row) => {
      if (zoneKey && row.leftZone !== zoneKey && row.rightZone !== zoneKey) return false;
      if (causalEventId && row.causalEventId !== causalEventId) return false;
      if (atomicOperationId && row.atomicOperationId !== atomicOperationId) return false;
      if (sinceEventIndex != null && row.eventIndex < sinceEventIndex) return false;
      return true;
    }).map(cloneJson);
  }

  function applyOperation(operation = {}, context = {}) {
    const before = cloneJson(state);
    const result = applyConcreteOperation(operation, context);
    if (result.status !== "applied" && context.allowPartial !== true) {
      replaceObject(state, before);
      return { ...result, rolledBack: true };
    }
    return result;
  }

  function applyConcreteOperation(operation = {}, context = {}) {
    const type = normalizeOperationType(operation.type || operation.operate);
    const source = operation.sourceEvidence || context.source || sourceOf(
      `rule-operation:${type || "unknown"}`,
      "rule-feedback",
      { skillId: finiteInteger(operation.skillId ?? context.skillId, 0) }
    );
    const cardIds = uniquePositiveIds(operation.cardIds || operation.cards || (operation.cardId != null ? [operation.cardId] : []));
    const count = nonNegativeIntegerOrNull(operation.count) ?? (cardIds.length ? cardIds.length : null);

    if (type === "sequence") {
      const operations = Array.isArray(operation.operations) ? operation.operations : [];
      if (!operations.length) return unsupportedOperation(type, "non-empty-operations-required", operation);
      const results = [];
      for (const child of operations) {
        const childResult = applyConcreteOperation(child, context);
        results.push(childResult);
        if (childResult.status !== "applied") {
          return { status: childResult.status, type, reason: "sequence-child-not-applied", results };
        }
      }
      return { status: "applied", type, results };
    }

    if (["observe-zone", "observe-named-card-zone", "observe-general-card-pile"].includes(type)) {
      const named = type !== "observe-zone";
      const zoneInput = {
        zoneKey: concreteZone(operation.zoneKey || operation.zone),
        zoneKind: operation.zoneKind,
        pileKey: operation.pileKey || operation.pileName,
        hostSeat: operation.hostSeat ?? operation.seatIndex ?? operation.seat,
        hostArea: operation.hostArea,
        hostPlayerKey: operation.hostPlayerKey || operation.playerKey,
        hostAvatarKey: operation.hostAvatarKey || operation.avatarKey,
        lifecycleScope: operation.lifecycleScope,
        hostGeneralId: operation.hostGeneralId || operation.generalId,
        hostCardId: operation.hostCardId,
        attachmentPolicy: operation.attachmentPolicy,
        capacity: operation.capacity,
        controllerSeat: operation.controllerSeat,
        placedBySeat: operation.placedBySeat ?? operation.actorSeat,
        ownerSeat: Object.prototype.hasOwnProperty.call(operation, "ownerSeat") ? operation.ownerSeat : undefined,
        ownershipKnown: operation.ownershipKnown,
        skillId: operation.skillId ?? context.skillId,
        zoneParam: operation.zoneParam,
        ruleIdentityKey: operation.ruleIdentityKey || context.ruleIdentityKey,
        ordered: operation.ordered,
        orderKnown: operation.orderKnown,
        faceUp: operation.faceUp,
        visibility: operation.visibility,
        visibilityAudience: operation.visibilityAudience,
        observerSeats: operation.observerSeats || operation.viewerSeats,
        cardStates: operation.cardStates || operation.cardVisibility,
        count,
        cardIds,
        complete: operation.complete,
        replace: operation.replace,
        context: operation.context || context.turnContext,
        metadata: operation.metadata,
        reason: operation.reason,
        source
      };
      const result = named ? observeNamedCardZone(zoneInput) : observeZone(zoneInput);
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "zone-key-or-pile-identity-required", operation);
    }

    if (["rehost-named-card-zone", "transfer-named-card-zone-host"].includes(type)) {
      const result = rehostNamedCardZone({
        zoneKey: operation.zoneKey || operation.zone,
        pileKey: operation.pileKey || operation.name,
        hostCardId: operation.hostCardId,
        newHostSeat: operation.newHostSeat ?? operation.hostSeat ?? operation.seatIndex,
        newHostArea: operation.newHostArea || operation.hostArea,
        newHostPlayerKey: operation.newHostPlayerKey || operation.hostPlayerKey || operation.playerKey,
        newHostAvatarKey: operation.newHostAvatarKey || operation.hostAvatarKey || operation.avatarKey,
        toZoneKey: operation.toZoneKey || operation.targetZoneKey,
        context: operation.context || context.turnContext,
        reason: operation.reason || type,
        source
      });
      return result.applied ? appliedOperation(type, result) : unsupportedOperation(type, result.reason, operation);
    }

    if (["observe-movement-attempt", "register-movement-attempt"].includes(type)) {
      const result = observeMovementAttempt({
        attemptId: operation.attemptId || operation.movementAttemptId || operation.id,
        from: operation.from || operation.sourceZone,
        to: operation.to || operation.destination,
        count: operation.count,
        cardIds: operation.cardIds || operation.cards,
        actorSeat: operation.actorSeat ?? operation.srcSeat,
        targetSeat: operation.targetSeat ?? operation.dstSeat,
        actionType: operation.actionType || operation.kind,
        status: operation.status,
        prevented: operation.prevented,
        preventionSkillId: operation.preventionSkillId,
        preventionReason: operation.preventionReason,
        causalEventId: operation.causalEventId || context.causalEventId,
        metadata: operation.metadata,
        context: operation.context || context.turnContext,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "movement-attempt-identity-required", operation);
    }

    if (["resolve-movement-attempt", "prevent-movement-attempt", "cancel-movement-attempt"].includes(type)) {
      const result = resolveMovementAttempt({
        attemptId: operation.attemptId || operation.movementAttemptId || operation.id,
        status: type === "prevent-movement-attempt"
          ? "prevented"
          : type === "cancel-movement-attempt"
            ? "cancelled"
            : operation.status || operation.result,
        prevented: type === "prevent-movement-attempt" ? true : operation.prevented,
        preventionSkillId: operation.preventionSkillId ?? operation.skillId ?? context.skillId,
        preventionReason: operation.preventionReason || operation.reason,
        movementApplied: operation.movementApplied,
        movementId: operation.movementId,
        metadata: operation.metadata,
        context: operation.context || context.turnContext,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "known-movement-attempt-required", operation);
    }

    if (["observe-judgement-outcome", "set-judgement-outcome"].includes(type)) {
      const result = observeJudgementOutcome({
        judgementId: operation.judgementId || operation.eventId || operation.id,
        judgementCardId: operation.judgementCardId ?? operation.cardId,
        delayedTrickCardId: operation.delayedTrickCardId ?? operation.parentCardId,
        subjectSeat: operation.subjectSeat ?? operation.targetSeat ?? operation.seatIndex,
        effectiveName: operation.effectiveName || operation.delayedTrickName,
        ...(Object.prototype.hasOwnProperty.call(operation, "baseSuccess") || Object.prototype.hasOwnProperty.call(operation, "success")
          ? { baseSuccess: operation.baseSuccess ?? operation.success }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(operation, "reportedFinalSuccess") || Object.prototype.hasOwnProperty.call(operation, "finalSuccess")
          ? { reportedFinalSuccess: operation.reportedFinalSuccess ?? operation.finalSuccess }
          : {}),
        status: operation.status,
        causalEventId: operation.causalEventId || context.causalEventId,
        metadata: operation.metadata,
        context: operation.context || context.turnContext,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "judgement-identity-required", operation);
    }

    if (["invert-judgement-outcome", "invert-delayed-trick-outcome"].includes(type)) {
      const result = invertJudgementOutcome({
        judgementId: operation.judgementId || operation.eventId || operation.id,
        layerId: operation.layerId || operation.modifierId,
        skillId: operation.skillId ?? context.skillId,
        ruleIdentityKey: operation.ruleIdentityKey || context.ruleIdentityKey,
        causalEventId: operation.causalEventId || context.causalEventId,
        reason: operation.reason || type,
        source
      });
      return result.applied ? appliedOperation(type, result) : unsupportedOperation(type, result.reason, operation);
    }

    if (["observe-boolean-constraint", "update-boolean-constraint", "observe-cardinality-constraint"].includes(type)) {
      const result = observeBooleanConstraint({
        key: operation.key || operation.constraintKey || operation.id,
        propositions: operation.propositions,
        assignments: operation.assignments,
        constraints: operation.constraints || operation.cardinalities,
        terms: operation.terms || operation.claims,
        correctCount: operation.correctCount ?? operation.matchCount,
        cardinalityId: operation.cardinalityId || operation.resultId,
        subjectSeat: operation.subjectSeat ?? operation.targetSeat ?? operation.seatIndex,
        handGeneration: operation.handGeneration,
        bindToCurrentHand: operation.bindToCurrentHand,
        scope: operation.scope,
        skillId: operation.skillId ?? context.skillId,
        ruleIdentityKey: operation.ruleIdentityKey || context.ruleIdentityKey,
        causalEventId: operation.causalEventId || operation.eventId || context.causalEventId,
        status: operation.status,
        active: operation.active,
        metadata: operation.metadata,
        context: operation.context || context.turnContext,
        source
      });
      return result.applied ? appliedOperation(type, result) : unsupportedOperation(type, result.reason, operation);
    }

    if (type === "draw") {
      const to = concreteZone(operation.to ?? operation.destination);
      if (count == null || !to) return unsupportedOperation(type, "concrete-count-and-destination-required", operation);
      const endpoint = concreteEndpoint(operation.endpoint ?? operation.source) || "top";
      return appliedOperation(type, observeMove({
        from: deckZoneWithPosition(ZONE.DECK, endpoint),
        to,
        count,
        cardIds,
        context: operation.context || context.turnContext,
        causalEventId: operation.causalEventId || context.causalEventId,
        movementId: operation.movementId,
        movementAttemptId: operation.movementAttemptId || operation.attemptId,
        movementGroupId: operation.movementGroupId || operation.groupId || operation.batchId,
        sequenceIndex: operation.sequenceIndex ?? operation.order,
        cardDetails: operation.cardDetails || operation.perCard || operation.cardMovements,
        movementReason: operation.movementReason || operation.reasonKind || "draw",
        reasonTags: operation.reasonTags,
        moveType: operation.moveType,
        skillId: operation.skillId ?? context.skillId,
        protocol: operation.protocol,
        suppressRecycle: operation.suppressRecycle === true,
        source,
        reason: operation.reason || "resolved-rule-draw"
      }));
    }

    if (type === "recast") {
      const actorSeat = finiteInteger(operation.actorSeat ?? operation.seatIndex ?? context.actorSeat, -1);
      const from = concreteZone(operation.from ?? operation.sourceZone);
      const to = concreteZone(operation.to ?? operation.destination) || (actorSeat >= 0 ? handZone(actorSeat) : "");
      const result = recast({
        from,
        to,
        actorSeat,
        count,
        cardIds,
        drawCount: operation.drawCount,
        drawnCardIds: operation.drawnCardIds || operation.resultCardIds,
        eventId: operation.eventId || operation.recastId,
        causalEventId: operation.causalEventId || context.causalEventId,
        context: operation.context || context.turnContext,
        movementReason: operation.movementReason || operation.reasonKind || "recast",
        reasonTags: operation.reasonTags,
        moveType: operation.moveType,
        skillId: operation.skillId ?? context.skillId,
        protocol: operation.protocol,
        source,
        reason: operation.reason || "resolved-rule-recast"
      });
      if (!result.applied) return unsupportedOperation(type, result.reason, operation);
      return appliedOperation(type, result);
    }

    if (type === "move" || type === "put" || type === "put-ordered" || type === "move-known") {
      const fromRef = operation.from ?? operation.source;
      const toRef = operation.to ?? operation.destination;
      const from = concreteZone(fromRef);
      const to = concreteZone(toRef);
      if (count == null || !from || !to) return unsupportedOperation(type, "concrete-count-source-and-destination-required", operation);
      const fromEndpoint = concreteEndpoint(operation.fromEndpoint ?? fromRef);
      const toEndpoint = concreteEndpoint(operation.toEndpoint ?? operation.endpoint ?? toRef);
      return appliedOperation(type, observeMove({
        from: deckZoneWithPosition(from, fromEndpoint),
        to: deckZoneWithPosition(to, toEndpoint),
        count,
        cardIds,
        predicate: operation.predicate || operation.selector,
        context: operation.context || context.turnContext,
        causalEventId: operation.causalEventId || context.causalEventId,
        movementId: operation.movementId,
        movementAttemptId: operation.movementAttemptId || operation.attemptId,
        movementGroupId: operation.movementGroupId || operation.groupId || operation.batchId,
        sequenceIndex: operation.sequenceIndex ?? operation.order,
        cardDetails: operation.cardDetails || operation.perCard || operation.cardMovements,
        movementReason: operation.movementReason || operation.reasonKind,
        reasonTags: operation.reasonTags,
        moveType: operation.moveType,
        skillId: operation.skillId ?? context.skillId,
        protocol: operation.protocol,
        source,
        visibility: operation.visibility,
        reason: operation.reason || `resolved-rule-${type}`
      }));
    }

    if (["exchange-zones", "atomic-zone-exchange", "exchange-whole-zones", "exchange-hands", "atomic-hand-exchange"].includes(type)) {
      const leftSeat = finiteInteger(operation.leftSeat ?? operation.seatA ?? operation.fromSeat, -1);
      const rightSeat = finiteInteger(operation.rightSeat ?? operation.seatB ?? operation.toSeat, -1);
      const leftZone = concreteZone(operation.leftZone || operation.zoneA) || (leftSeat >= 0 ? handZone(leftSeat) : "");
      const rightZone = concreteZone(operation.rightZone || operation.zoneB) || (rightSeat >= 0 ? handZone(rightSeat) : "");
      const result = exchangeZones({
        leftZone,
        rightZone,
        context: operation.context || context.turnContext,
        causalEventId: operation.causalEventId || context.causalEventId,
        atomicOperationId: operation.atomicOperationId || operation.exchangeId,
        movementReason: operation.movementReason || operation.reasonKind || "exchange",
        reasonTags: operation.reasonTags,
        moveType: operation.moveType,
        skillId: operation.skillId ?? context.skillId,
        protocol: operation.protocol,
        recordIndex: operation.recordIndex,
        source,
        reason: operation.reason || type
      });
      if (!result.applied) return unsupportedOperation(type, result.reason, operation);
      return appliedOperation(type, result);
    }

    if (["move-card-action-materials", "gain-card-action-materials", "move-parent-card-entities"].includes(type)) {
      const to = concreteZone(operation.to ?? operation.destination);
      const from = concreteZone(operation.from ?? operation.sourceZone);
      const eventId = String(operation.eventId || operation.actionId || operation.useId || "").trim();
      if (!eventId || !to) return unsupportedOperation(type, "event-id-and-destination-required", operation);
      const result = moveCardActionMaterials({
        eventId,
        from,
        to,
        includeMain: operation.includeMain,
        includeSubcards: operation.includeSubcards,
        includeCostCards: operation.includeCostCards,
        context: operation.context || context.turnContext,
        causalEventId: operation.causalEventId || context.causalEventId,
        movementReason: operation.movementReason || operation.reasonKind || (type === "gain-card-action-materials" ? "gain" : "move"),
        reasonTags: operation.reasonTags,
        moveType: operation.moveType,
        skillId: operation.skillId ?? context.skillId,
        protocol: operation.protocol,
        sourceEvidence: source,
        visibility: operation.visibility,
        reason: operation.reason || type
      });
      if (!result.applied) return unsupportedOperation(type, result.reason, operation);
      return appliedOperation(type, result);
    }

    if (type === "swap-known-cards" || type === "atomic-swap") {
      const leftCardId = finiteInteger(operation.leftCardId ?? cardIds[0], 0);
      const rightCardId = finiteInteger(operation.rightCardId ?? cardIds[1], 0);
      const leftZone = concreteZone(operation.leftZone) || state.locations[leftCardId]?.zoneKey || "";
      const rightZone = concreteZone(operation.rightZone) || state.locations[rightCardId]?.zoneKey || "";
      const leftEndpoint = concreteEndpoint(operation.leftEndpoint);
      const rightEndpoint = concreteEndpoint(operation.rightEndpoint);
      if (leftCardId <= 0 || rightCardId <= 0 || leftCardId === rightCardId || !leftZone || !rightZone || leftZone === rightZone) {
        return unsupportedOperation(type, "two-distinct-known-cards-and-zones-required", operation);
      }
      if (state.locations[leftCardId]?.zoneKey !== leftZone || state.locations[rightCardId]?.zoneKey !== rightZone) {
        return unsupportedOperation(type, "both-card-locations-must-be-proven", operation);
      }
      if (leftZone === ZONE.DECK && !leftEndpoint || rightZone === ZONE.DECK && !rightEndpoint) {
        return unsupportedOperation(type, "deck-side-endpoint-required", operation);
      }

      const moveOne = (cardId, fromZone, fromEndpoint, toZone, toEndpoint, label) => observeMove({
        from: deckZoneWithPosition(fromZone, fromEndpoint),
        to: deckZoneWithPosition(toZone, toEndpoint),
        count: 1,
        cardIds: [cardId],
        context: operation.context || context.turnContext,
        source,
        suppressRecycle: true,
        reason: `${operation.reason || type}:${label}`
      });
      let firstMove;
      let secondMove;
      if (rightZone === ZONE.DECK) {
        firstMove = moveOne(rightCardId, rightZone, rightEndpoint, leftZone, leftEndpoint, "right-to-left");
        secondMove = moveOne(leftCardId, leftZone, leftEndpoint, rightZone, rightEndpoint, "left-to-right");
      } else {
        firstMove = moveOne(leftCardId, leftZone, leftEndpoint, rightZone, rightEndpoint, "left-to-right");
        secondMove = moveOne(rightCardId, rightZone, rightEndpoint, leftZone, leftEndpoint, "right-to-left");
      }
      if (state.deck.count === 0) recycleDiscard({ reason: `${type}:settled-empty-deck`, source });
      recordEvent("card.swap", { leftCardId, rightCardId, leftZone, rightZone, source: normalizeSource(source, now) });
      return appliedOperation(type, { leftCardId, rightCardId, leftZone, rightZone, firstMove, secondMove });
    }

    if (type === "segmented-search" || type === "cross-epoch-search" || type === "segmented-deck-search") {
      const result = segmentedSearch({
        predicate: operation.predicate || operation.selector,
        segments: operation.segments,
        foundCardIds: operation.foundCardIds || operation.cardIds,
        to: concreteZone(operation.to ?? operation.destination),
        context: operation.context || context.turnContext,
        source,
        reason: operation.reason || type
      });
      return result.status === "applied" ? appliedOperation(type, result) : { ...result, type };
    }

    if (type === "search" || type === "random-match" || type === "search-current-deck") {
      const to = concreteZone(operation.to ?? operation.destination);
      const requestedCount = nonNegativeIntegerOrNull(operation.requestedCount ?? operation.count);
      const foundCount = nonNegativeIntegerOrNull(operation.foundCount);
      if (requestedCount == null || !to || !operation.predicate && !operation.selector) {
        return unsupportedOperation(type, "predicate-requested-count-and-destination-required", operation);
      }
      if (foundCount == null && !Array.isArray(operation.foundCardIds) && !Array.isArray(operation.cardIds)) {
        return unsupportedOperation(type, "observed-found-count-or-card-ids-required", operation);
      }
      return appliedOperation(type, search({
        predicate: operation.predicate || operation.selector,
        requestedCount,
        foundCount,
        foundCardIds: operation.foundCardIds || operation.cardIds || [],
        exhaustive: operation.exhaustive === true,
        to,
        context: operation.context || context.turnContext,
        source,
        reason: operation.reason || "resolved-rule-search"
      }));
    }

    if (type === "observe-search-result" || type === "search-feedback") {
      const requestedCount = nonNegativeIntegerOrNull(operation.requestedCount ?? operation.count);
      const foundCount = nonNegativeIntegerOrNull(operation.foundCount);
      if (requestedCount == null || !operation.predicate && !operation.selector) {
        return unsupportedOperation(type, "predicate-and-requested-count-required", operation);
      }
      if (foundCount == null && !Array.isArray(operation.foundCardIds) && !Array.isArray(operation.cardIds)) {
        return unsupportedOperation(type, "observed-found-count-or-card-ids-required", operation);
      }
      return appliedOperation(type, observeSearchResult({
        predicate: operation.predicate || operation.selector,
        requestedCount,
        foundCount,
        foundCardIds: operation.foundCardIds || operation.cardIds || [],
        exhaustive: operation.exhaustive === true,
        source
      }));
    }

    if (["ordered-match-search", "search-first-match", "endpoint-first-match-search", "multi-predicate-endpoint-search"].includes(type)) {
      const result = orderedMatchSearch({
        predicate: operation.predicate || operation.selector,
        endpoint: concreteEndpoint(operation.endpoint ?? operation.source),
        requestedCount: operation.requestedCount ?? operation.count,
        foundCount: operation.foundCount,
        foundCardIds: operation.foundCardIds || operation.cardIds,
        foundRank: operation.foundRank ?? operation.rank,
        rankFromEndpoint: operation.rankFromEndpoint ?? operation.foundOffset,
        exhaustive: operation.exhaustive,
        to: concreteZone(operation.to ?? operation.destination),
        context: operation.context || context.turnContext,
        source,
        reason: operation.reason || type
      });
      return result.status === "applied" ? appliedOperation(type, result) : { ...result, type };
    }

    if (["server-union-search", "union-source-result", "move-one-union-candidate", "resolve-card-source-result"].includes(type)) {
      const result = resolveCardSourceResult({
        zones: operation.zones || operation.sources,
        predicate: operation.predicate || operation.selector,
        foundCount: operation.foundCount,
        foundCardIds: operation.foundCardIds || operation.cardIds,
        results: operation.results,
        from: operation.from || operation.sourceZone,
        to: concreteZone(operation.to ?? operation.destination),
        exhaustive: operation.exhaustive,
        context: operation.context || context.turnContext,
        causalEventId: operation.causalEventId || context.causalEventId,
        movementReason: operation.movementReason,
        reasonTags: operation.reasonTags,
        sourceEvidence: source,
        reason: operation.reason || type
      });
      return result.status === "applied" ? appliedOperation(type, result) : { ...result, type };
    }

    if (type === "reveal-until" || type === "reveal-until-result") {
      const matchTo = operation.matchCardId ? concreteZone(operation.matchTo ?? operation.destination) : "";
      const processZone = concreteZone(operation.processZone || ZONE.PROCESS);
      const missesTo = concreteZone(operation.missesTo || ZONE.DISCARD);
      if (!Array.isArray(operation.revealedCardIds) && !Array.isArray(operation.cardIds)) {
        return unsupportedOperation(type, "observed-revealed-card-ids-required", operation);
      }
      if (!processZone || !missesTo || operation.matchCardId && !matchTo) {
        return unsupportedOperation(type, "concrete-reveal-destinations-required", operation);
      }
      const result = revealUntilResult({
        revealedCardIds: operation.revealedCardIds || operation.cardIds,
        matchCardId: operation.matchCardId,
        predicate: operation.predicate || operation.selector,
        endpoint: concreteEndpoint(operation.endpoint ?? operation.source) || "top",
        processZone,
        missesTo,
        matchTo,
        exhaustive: operation.exhaustive === true,
        context: operation.context || context.turnContext,
        source,
        reason: operation.reason
      });
      return result.status === "applied" ? appliedOperation(type, result) : { ...result, type };
    }

    if (["inspect-window", "reveal-window", "reveal-deck-endpoint"].includes(type)) {
      const endpoint = concreteEndpoint(operation.endpoint ?? operation.source);
      if (!endpoint || !cardIds.length) return unsupportedOperation(type, "observed-endpoint-card-ids-required", operation);
      return appliedOperation(type, revealDeckEndpoint({ endpoint, cardIds, source }));
    }

    if (type === "partition-order" || type === "partition-deck-window") {
      const result = partitionDeckWindow({
        windowCardIds: operation.windowCardIds || operation.cardIds,
        topCardIds: operation.topCardIds || operation.top,
        bottomCardIds: operation.bottomCardIds || operation.bottom,
        source,
        reason: operation.reason
      });
      return result.status === "applied" ? appliedOperation(type, result) : { ...result, type };
    }

    if (type === "observe-deck-ranks") {
      const ranks = Array.isArray(operation.ranks)
        ? operation.ranks
        : operation.rank != null
          ? [{ rank: operation.rank, cardId: operation.cardId }]
          : [];
      if (!ranks.length) return unsupportedOperation(type, "rank-facts-required", operation);
      return appliedOperation(type, observeDeckRanks({ ranks, replace: operation.replace === true, source }));
    }

    if (type === "insert-at-rank") {
      const result = insertAtRank({
        cardId: operation.cardId ?? cardIds[0],
        rank: operation.rank,
        fallback: operation.fallback,
        source
      });
      return result.status === "applied" ? appliedOperation(type, result) : { ...result, type };
    }

    if (["observe-hand-evidence", "show-hand", "show-hand-entity", "public-reveal-hand", "authorized-view-hand"].includes(type)) {
      const seatIndex = finiteInteger(operation.seatIndex ?? operation.subjectSeat ?? operation.targetSeat, -1);
      const observerSeat = finiteInteger(operation.observerSeat ?? operation.viewerSeat, -1);
      const observedCount = nonNegativeIntegerOrNull(operation.handCount ?? operation.count);
      const complete = operation.complete === true;
      if (seatIndex < 0 || observedCount == null && !cardIds.length) {
        return unsupportedOperation(type, "seat-and-observed-count-or-card-ids-required", operation);
      }
      const visibility = String(operation.visibility || (
        type === "authorized-view-hand" ? "authorized-view" : "public-reveal"
      ));
      const hand = complete
        ? observeHand({
            seatIndex,
            count: observedCount,
            cardIds,
            complete: true,
            visibility,
            knowledgeOnly: true,
            context: operation.context || context.turnContext,
            source
          })
        : observeHandEvidence({
            seatIndex,
            minimumCount: observedCount,
            cardIds,
            visibility,
            context: operation.context || context.turnContext,
            source
          });
      const eventId = String(operation.eventId || operation.viewId || operation.revealId || "").trim();
      const event = eventId ? observeCausalEvent({
        eventId,
        eventType: type === "authorized-view-hand" ? "hand:view" : "hand:reveal",
        roles: {
          observerSeat: observerSeat >= 0 ? observerSeat : null,
          subjectSeat: seatIndex
        },
        cardIds,
        status: "observed",
        context: operation.context || context.turnContext,
        metadata: { visibility, complete, movement: false },
        source
      }) : null;
      if (!hand || eventId && !event) return unsupportedOperation(type, "hand-knowledge-observation-rejected", operation);
      return appliedOperation(type, { hand, event });
    }

    if (type === "observe-hand-constraint") {
      const seatIndex = finiteInteger(operation.seatIndex, -1);
      if (seatIndex < 0 || !operation.kind || !operation.predicate) {
        return unsupportedOperation(type, "seat-kind-and-predicate-required", operation);
      }
      const result = observeHandConstraint({
        seatIndex,
        kind: operation.kind,
        predicate: operation.predicate,
        count: operation.count,
        reason: operation.reason,
        scope: operation.scope,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "hand-constraint-not-executable", operation);
    }

    if (["observe-physical-card-definition", "register-generated-card", "upsert-card-definition"].includes(type)) {
      const definition = operation.definition || operation.card || operation.attributes || {
        id: operation.cardId || operation.id,
        name: operation.name || operation.cardName,
        suit: operation.suit,
        number: operation.number,
        typeOriginal: operation.cardTypeOriginal ?? operation.typeOriginal,
        type: operation.cardType,
        subtype: operation.subtype,
        spellId: operation.spellId,
        isDamageCard: operation.isDamageCard,
        isDelayedTrick: operation.isDelayedTrick,
        isOrdinaryTrick: operation.isOrdinaryTrick,
        equipSubtype: operation.equipSubtype,
        spellClass: operation.spellClass,
        nature: operation.nature
      };
      const result = observePhysicalCardDefinition({
        cardId: operation.cardId || operation.id,
        definition,
        skillId: operation.skillId ?? context.skillId,
        context: operation.context || context.turnContext,
        reason: operation.reason,
        source
      });
      return result?.applied
        ? appliedOperation(type, result)
        : unsupportedOperation(type, result ? "physical-card-definition-conflict" : "physical-card-id-and-attributes-required", operation);
    }

    if (["observe-physical-card-lifecycle", "destroy-physical-card", "retire-physical-card", "reactivate-physical-card"].includes(type)) {
      const result = observePhysicalCardLifecycle({
        cardId: operation.cardId ?? operation.id,
        status: type === "destroy-physical-card"
          ? "destroyed"
          : type === "retire-physical-card"
            ? "retired"
            : type === "reactivate-physical-card"
              ? operation.status || "active"
              : operation.status,
        terminal: type === "destroy-physical-card" || type === "retire-physical-card"
          ? true
          : type === "reactivate-physical-card"
            ? false
            : operation.terminal,
        allowReactivation: type === "reactivate-physical-card" ? true : operation.allowReactivation,
        recyclable: operation.recyclable,
        from: operation.from || operation.sourceZone,
        to: operation.to || operation.destination || operation.zoneKey,
        terminalZoneKey: operation.terminalZoneKey,
        movementId: operation.movementId,
        movementGroupId: operation.movementGroupId || operation.groupId,
        movementAttemptId: operation.movementAttemptId || operation.attemptId,
        sequenceIndex: operation.sequenceIndex ?? operation.order,
        movementReason: operation.movementReason,
        reasonTags: operation.reasonTags,
        skillId: operation.skillId ?? context.skillId,
        ruleIdentityKey: operation.ruleIdentityKey || context.ruleIdentityKey,
        causalEventId: operation.causalEventId || operation.eventId || context.causalEventId,
        visibilityAudience: operation.visibilityAudience || operation.visibility,
        metadata: operation.metadata,
        context: operation.context || context.turnContext,
        reason: operation.reason || type,
        source
      });
      return result.applied ? appliedOperation(type, result) : unsupportedOperation(type, result.reason, operation);
    }

    if (type === "observe-effective-card-attributes") {
      const result = observeEffectiveCardAttributes({
        cardId: operation.cardId,
        attributes: operation.attributes,
        scope: operation.scope,
        contextKey: operation.contextKey,
        causalEventId: operation.causalEventId || operation.eventId || context.causalEventId,
        targetSeat: operation.targetSeat,
        channelKey: operation.channelKey || operation.channel,
        whileCausalEventId: operation.whileCausalEventId || operation.whileEventId || operation.effectEventId,
        whileZone: operation.whileZone,
        expiresOnMove: operation.expiresOnMove,
        lifecycle: operation.lifecycle,
        expireOnEventTypes: operation.expireOnEventTypes || operation.expireOnEvents,
        whileChoiceSetKey: operation.whileChoiceSetKey || operation.choiceSetKey || operation.promptKey,
        whileSkillBindingKey: operation.whileSkillBindingKey || operation.skillBindingKey,
        context: operation.context || context.turnContext,
        reason: operation.reason,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "card-id-and-effective-attributes-required", operation);
    }

    if (["observe-apparent-card-attributes", "observe-card-presentation", "disguise-card-identity"].includes(type)) {
      const attributes = operation.attributes || (operation.name != null ? { name: operation.name } : null);
      const result = observeApparentCardAttributes({
        cardId: operation.cardId,
        attributes,
        scope: operation.scope,
        contextKey: operation.contextKey,
        causalEventId: operation.causalEventId || operation.eventId || context.causalEventId,
        targetSeat: operation.targetSeat,
        channelKey: operation.channelKey || operation.channel,
        whileCausalEventId: operation.whileCausalEventId || operation.whileEventId || operation.effectEventId,
        whileZone: operation.whileZone,
        expiresOnMove: operation.expiresOnMove,
        lifecycle: operation.lifecycle,
        expireOnEventTypes: operation.expireOnEventTypes || operation.expireOnEvents,
        whileChoiceSetKey: operation.whileChoiceSetKey || operation.choiceSetKey || operation.promptKey,
        whileSkillBindingKey: operation.whileSkillBindingKey || operation.skillBindingKey,
        observerSeats: operation.observerSeats || operation.viewerSeats,
        observerSeat: operation.observerSeat ?? operation.viewerSeat,
        visibility: operation.visibility,
        context: operation.context || context.turnContext,
        reason: operation.reason,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "card-id-and-apparent-attributes-required", operation);
    }

    if (["clear-effective-card-attributes", "clear-apparent-card-attributes"].includes(type)) {
      const cardId = finiteInteger(operation.cardId, 0);
      if (cardId <= 0) return unsupportedOperation(type, "card-id-required", operation);
      const cleared = type === "clear-effective-card-attributes"
        ? clearEffectiveCardAttributes({
            cardId,
            scope: operation.scope,
            causalEventId: operation.causalEventId || operation.eventId,
            targetSeat: operation.targetSeat,
            channelKey: operation.channelKey || operation.channel,
            whileCausalEventId: operation.whileCausalEventId || operation.whileEventId || operation.effectEventId,
            reason: operation.reason,
            source
          })
        : clearApparentCardAttributes({
            cardId,
            scope: operation.scope,
            causalEventId: operation.causalEventId || operation.eventId,
            targetSeat: operation.targetSeat,
            channelKey: operation.channelKey || operation.channel,
            whileCausalEventId: operation.whileCausalEventId || operation.whileEventId || operation.effectEventId,
            reason: operation.reason,
            source
          });
      return cleared > 0 ? appliedOperation(type, { cardId, cleared }) : unsupportedOperation(type, "matching-card-view-not-active", operation);
    }

    if (type === "judgement-substitute" || type === "judgement-exchange") {
      const oldCardId = finiteInteger(operation.oldCardId, 0);
      const newCardId = finiteInteger(operation.newCardId, 0);
      const judgementZone = concreteZone(operation.judgementZone || ZONE.PROCESS);
      const newFromRef = operation.newFrom ?? operation.sourceZone;
      const newFrom = concreteZone(newFromRef);
      const oldTo = concreteZone(operation.oldTo ?? operation.oldDestination ?? (type === "judgement-substitute" ? ZONE.DISCARD : ""));
      const newEndpoint = concreteEndpoint(operation.endpoint ?? newFromRef);
      if (oldCardId <= 0 || newCardId <= 0 || !judgementZone || !newFrom || !oldTo) {
        return unsupportedOperation(type, "old-new-source-and-destinations-required", operation);
      }
      if (state.locations[oldCardId]?.zoneKey !== judgementZone) {
        return unsupportedOperation(type, "old-judgement-card-location-not-proven", operation);
      }
      if (newFrom !== ZONE.DECK && state.locations[newCardId]?.zoneKey !== newFrom) {
        return unsupportedOperation(type, "replacement-card-source-not-proven", operation);
      }

      const newMove = observeMove({
        from: deckZoneWithPosition(newFrom, newEndpoint),
        to: judgementZone,
        count: 1,
        cardIds: [newCardId],
        source,
        visibility: "public",
        reason: `${type}:new-card-enters-judgement`
      });
      const oldMove = observeMove({
        from: judgementZone,
        to: oldTo,
        count: 1,
        cardIds: [oldCardId],
        source,
        visibility: "public",
        reason: `${type}:old-card-leaves-judgement`
      });
      recordEvent("judgement.replaced", { type, oldCardId, newCardId, newFrom, oldTo, judgementZone, source: normalizeSource(source, now) });
      return appliedOperation(type, { oldCardId, newCardId, newMove, oldMove, judgementZone, oldTo });
    }

    if (type === "tag-physical-card") {
      const cardId = finiteInteger(operation.cardId ?? cardIds[0], 0);
      const tag = String(operation.tag || "").trim();
      if (cardId <= 0 || !tag) return unsupportedOperation(type, "card-id-and-tag-required", operation);
      return appliedOperation(type, tagCard({
        cardId,
        tag,
        lifecycle: operation.lifecycle,
        context: operation.context || context.turnContext,
        whileZone: operation.whileZone,
        expiresOnMove: operation.expiresOnMove,
        expireOnEventTypes: operation.expireOnEventTypes || operation.expireOnEvents,
        metadata: operation.metadata,
        source
      }));
    }

    if (type === "untag-physical-card") {
      const cardId = finiteInteger(operation.cardId ?? cardIds[0], 0);
      const tag = String(operation.tag || "").trim();
      if (cardId <= 0 || !tag) return unsupportedOperation(type, "card-id-and-tag-required", operation);
      return appliedOperation(type, untagCard({ cardId, tag, reason: operation.reason }));
    }

    if (type === "observe-causal-event" || type === "causal-event" || type === "game-event") {
      const eventType = String(operation.eventType || operation.gameEventType || operation.name || "").trim();
      if (!eventType) return unsupportedOperation(type, "concrete-event-type-required", operation);
      const result = observeCausalEvent({
        eventId: operation.eventId,
        eventType,
        parentEventId: operation.parentEventId,
        rootEventId: operation.rootEventId,
        causeEventIds: operation.causeEventIds || operation.causedByEventIds,
        linkedEventIds: operation.linkedEventIds,
        channelKey: operation.channelKey,
        sequenceIndex: operation.sequenceIndex,
        roles: operation.roles,
        targetSeats: operation.targetSeats || operation.targets,
        cardId: operation.cardId,
        cardIds: operation.cardIds,
        subcardIds: operation.subcardIds,
        skillId: operation.skillId ?? context.skillId,
        effectiveName: operation.effectiveName,
        status: operation.status,
        outcome: operation.outcome,
        tags: operation.tags,
        context: operation.context || context.turnContext,
        metadata: operation.metadata,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "causal-event-rejected", operation);
    }

    if (type === "observe-card-action" || type === "bind-card-action") {
      const action = String(operation.action || operation.actionType || "").trim();
      if (!action) return unsupportedOperation(type, "card-action-required", operation);
      const result = observeCardAction({
        eventId: operation.eventId || operation.actionId || operation.useId,
        eventType: operation.eventType,
        action,
        identityKind: operation.identityKind,
        identityStatus: operation.identityStatus,
        virtual: operation.virtual,
        mainCardId: operation.mainCardId,
        cardId: operation.cardId,
        subcards: operation.subcards || operation.materialCards || operation.subcardIds,
        costCards: operation.costCards || operation.costCardIds,
        referenceCards: operation.referenceCards || operation.referenceCardIds || operation.conditionCards,
        logicalCardToken: operation.logicalCardToken ?? operation.virtualCardId,
        declaredIdentity: operation.declaredIdentity || operation.declaredCard,
        revealedIdentity: operation.revealedIdentity || operation.revealedCard,
        effectiveIdentity: operation.effectiveIdentity || operation.effectiveCard,
        roles: operation.roles,
        providerSeat: operation.providerSeat,
        effectiveUserSeat: operation.effectiveUserSeat,
        targetSeats: operation.targetSeats || operation.targets,
        parentEventId: operation.parentEventId,
        rootEventId: operation.rootEventId,
        channelKey: operation.channelKey,
        status: operation.status,
        outcome: operation.outcome,
        physicalFlow: operation.physicalFlow,
        visibility: operation.visibility,
        skillId: operation.skillId ?? context.skillId,
        context: operation.context || context.turnContext,
        metadata: operation.metadata,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "card-action-rejected", operation);
    }

    if (type === "observe-comparison" || type === "comparison" || type === "pindian") {
      const result = observeComparison({
        comparisonId: operation.comparisonId || operation.eventId,
        kind: type === "pindian" ? "pindian" : operation.kind || operation.comparisonKind,
        parentEventId: operation.parentEventId,
        channelKey: operation.channelKey,
        sequenceIndex: operation.sequenceIndex,
        skillId: operation.skillId ?? context.skillId,
        initiator: operation.initiator,
        initiatorSeat: operation.initiatorSeat ?? operation.userSeat,
        initiatorCardId: operation.initiatorCardId ?? operation.userCardId,
        initiatorPrintedNumber: operation.initiatorPrintedNumber,
        initiatorEffectiveNumber: operation.initiatorEffectiveNumber,
        opponents: operation.opponents || operation.participants || operation.targets,
        status: operation.status || operation.stage,
        outcome: operation.outcome || operation.result,
        sharedInitiatorCard: operation.sharedInitiatorCard,
        context: operation.context || context.turnContext,
        metadata: operation.metadata,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "comparison-observation-rejected", operation);
    }

    if (["swap-comparison-assignments", "swap-pindian-participant-assignment"].includes(type)) {
      const result = swapComparisonAssignments({
        comparisonId: operation.comparisonId || operation.eventId,
        opponentSeat: operation.opponentSeat ?? operation.targetSeat,
        opponentIndex: operation.opponentIndex,
        skillId: operation.skillId ?? context.skillId,
        source
      });
      if (!result.applied) return unsupportedOperation(type, result.reason, operation);
      return appliedOperation(type, result);
    }

    if (type === "observe-physical-pile") {
      const key = String(operation.key || operation.pileKey || "").trim();
      if (!key) return unsupportedOperation(type, "physical-pile-key-required", operation);
      const result = observePhysicalPile({
        key,
        pileKind: operation.pileKind,
        count: operation.count,
        cardIds: operation.cardIds || operation.ids,
        topCardIds: operation.topCardIds || operation.top,
        bottomCardIds: operation.bottomCardIds || operation.bottom,
        complete: operation.complete,
        visibility: operation.visibility,
        recyclePolicy: operation.recyclePolicy,
        replace: operation.replace,
        context: operation.context || context.turnContext,
        metadata: operation.metadata,
        reason: operation.reason,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "physical-pile-observation-rejected", operation);
    }

    if (type === "take-from-physical-pile" || type === "physical-pile-take") {
      const key = String(operation.key || operation.pileKey || "").trim();
      const to = concreteZone(operation.to || operation.destination);
      if (!key || !to) return unsupportedOperation(type, "physical-pile-key-and-destination-required", operation);
      const result = takeFromPhysicalPile({
        key,
        to,
        count: operation.count,
        cardIds: operation.cardIds || operation.ids,
        endpoint: operation.endpoint,
        skillId: operation.skillId ?? context.skillId,
        causalEventId: operation.causalEventId || operation.eventId || context.causalEventId,
        context: operation.context || context.turnContext,
        movementReason: operation.movementReason,
        reasonTags: operation.reasonTags,
        reason: operation.reason,
        source
      });
      return result?.status === "applied" ? appliedOperation(type, result) : unsupportedOperation(type, result?.reason || "physical-pile-take-rejected", operation);
    }

    if (type === "put-into-physical-pile" || type === "physical-pile-put") {
      const key = String(operation.key || operation.pileKey || "").trim();
      const from = concreteZone(operation.from || operation.sourceZone);
      if (!key || !from) return unsupportedOperation(type, "physical-pile-key-and-source-required", operation);
      const result = putIntoPhysicalPile({
        key,
        from,
        count: operation.count,
        cardIds: operation.cardIds || operation.ids,
        endpoint: operation.endpoint,
        skillId: operation.skillId ?? context.skillId,
        causalEventId: operation.causalEventId || operation.eventId || context.causalEventId,
        context: operation.context || context.turnContext,
        movementReason: operation.movementReason,
        reasonTags: operation.reasonTags,
        reason: operation.reason,
        source
      });
      return result?.status === "applied" ? appliedOperation(type, result) : unsupportedOperation(type, result?.reason || "physical-pile-put-rejected", operation);
    }

    if (type === "shuffle-physical-pile") {
      const key = String(operation.key || operation.pileKey || "").trim();
      if (!key) return unsupportedOperation(type, "physical-pile-key-required", operation);
      const result = shufflePhysicalPile({ key, reason: operation.reason, source });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "physical-pile-not-active", operation);
    }

    if (["observe-zone-capability", "set-zone-capability", "abolish-zone-capability", "restore-zone-capability"].includes(type)) {
      const result = observeZoneCapability({
        key: operation.key,
        seat: operation.seat ?? operation.seatIndex ?? operation.hostSeat,
        area: operation.area || operation.zoneArea || operation.zoneKind,
        slot: operation.slot || operation.equipmentSlot || operation.subtype,
        capability: operation.capability || operation.name,
        status: type === "abolish-zone-capability"
          ? "abolished"
          : type === "restore-zone-capability"
            ? "available"
            : operation.status,
        abolished: type === "abolish-zone-capability" ? true : operation.abolished,
        available: type === "restore-zone-capability" ? true : operation.available,
        permanent: operation.permanent,
        metadata: operation.metadata,
        context: operation.context || context.turnContext,
        reason: operation.reason || type,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "zone-capability-area-required", operation);
    }

    if (["observe-equipment-projection", "set-equipment-projection"].includes(type)) {
      const result = observeEquipmentProjection({
        key: operation.key || operation.projectionKey,
        projectionKind: operation.projectionKind || operation.kind,
        hostSeat: operation.hostSeat ?? operation.seatIndex ?? operation.seat,
        slot: operation.slot || operation.equipmentSlot || operation.subtype,
        sourceCardId: operation.sourceCardId ?? operation.cardId,
        effectiveIdentity: operation.effectiveIdentity || operation.equipmentIdentity || operation.identity,
        occupiesPhysicalSlot: operation.occupiesPhysicalSlot,
        whileSourceCardInZone: operation.whileSourceCardInZone || operation.whileZone,
        whileSkillBindingKey: operation.whileSkillBindingKey || operation.skillBindingKey,
        active: operation.active,
        visibilityAudience: operation.visibilityAudience || operation.visibility,
        observerSeats: operation.observerSeats || operation.viewerSeats,
        metadata: operation.metadata,
        context: operation.context || context.turnContext,
        reason: operation.reason || type,
        source
      });
      return result.applied ? appliedOperation(type, result) : unsupportedOperation(type, result.reason, operation);
    }

    if (["remove-equipment-projection", "expire-equipment-projection"].includes(type)) {
      const removed = removeEquipmentProjection({
        key: operation.key || operation.projectionKey,
        sourceCardId: operation.sourceCardId ?? operation.cardId,
        whileSkillBindingKey: operation.whileSkillBindingKey || operation.skillBindingKey,
        reason: operation.reason || type,
        source
      });
      return removed > 0
        ? appliedOperation(type, { removed })
        : unsupportedOperation(type, "active-equipment-projection-required", operation);
    }

    if (type === "replace-general-card-entity" || type === "replace-general-slot") {
      const result = replaceGeneralCardEntity({
        entityKey: operation.entityKey || operation.instanceKey,
        generalId: operation.generalId ?? operation.replacementGeneralId ?? operation.entityId,
        hostSeat: operation.hostSeat ?? operation.seatIndex ?? operation.seat,
        generalSlot: operation.generalSlot || operation.slot || operation.position,
        faceState: operation.faceState ?? operation.face,
        ...(Object.prototype.hasOwnProperty.call(operation, "printedSkillIds") || Object.prototype.hasOwnProperty.call(operation, "skillIds")
          ? { printedSkillIds: operation.printedSkillIds || operation.skillIds }
          : {}),
        printedSkillIdsKnown: operation.printedSkillIdsKnown,
        ...(Object.prototype.hasOwnProperty.call(operation, "effectiveSkillIds") || Object.prototype.hasOwnProperty.call(operation, "activeSkillIds")
          ? { effectiveSkillIds: operation.effectiveSkillIds || operation.activeSkillIds }
          : {}),
        effectiveSkillIdsKnown: operation.effectiveSkillIdsKnown,
        visibilityAudience: operation.visibilityAudience || operation.visibility,
        observerSeats: operation.observerSeats || operation.viewerSeats,
        relation: operation.relation || operation.replacementKind,
        skillId: operation.skillId ?? context.skillId,
        metadata: operation.metadata,
        context: operation.context || context.turnContext,
        reason: operation.reason || type,
        source
      });
      return result.applied ? appliedOperation(type, result) : unsupportedOperation(type, result.reason, operation);
    }

    if (["observe-general-card-entity", "update-general-card-entity", "set-general-card-entity", "remove-general-card-entity"].includes(type)) {
      const result = observeGeneralCardEntity({
        entityKey: operation.entityKey || operation.instanceKey,
        generalId: operation.generalId ?? operation.entityId ?? operation.id,
        hostSeat: operation.hostSeat ?? operation.seatIndex ?? operation.seat,
        generalSlot: operation.generalSlot || operation.slot || operation.position,
        faceState: type === "remove-general-card-entity" ? operation.faceState || "removed" : operation.faceState ?? operation.face,
        ...(Object.prototype.hasOwnProperty.call(operation, "printedSkillIds") ||
          Object.prototype.hasOwnProperty.call(operation, "skillIds") ||
          Object.prototype.hasOwnProperty.call(operation, "printedSkills")
          ? { printedSkillIds: operation.printedSkillIds || operation.skillIds || operation.printedSkills }
          : {}),
        printedSkillIdsKnown: operation.printedSkillIdsKnown,
        ...(Object.prototype.hasOwnProperty.call(operation, "effectiveSkillIds") ||
          Object.prototype.hasOwnProperty.call(operation, "activeSkillIds")
          ? { effectiveSkillIds: operation.effectiveSkillIds || operation.activeSkillIds }
          : {}),
        effectiveSkillIdsKnown: operation.effectiveSkillIdsKnown,
        active: type === "remove-general-card-entity" ? false : operation.active,
        visibilityAudience: operation.visibilityAudience || operation.visibility,
        observerSeats: operation.observerSeats || operation.viewerSeats,
        metadata: operation.metadata,
        context: operation.context || context.turnContext,
        reason: operation.reason || type,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "general-card-entity-identity-required", operation);
    }

    if (type === "observe-entity-pile") {
      const key = String(operation.key || operation.pileKey || "").trim();
      const entityType = String(operation.entityType || "").trim();
      if (!key || !entityType) return unsupportedOperation(type, "pile-key-and-entity-type-required", operation);
      const result = observeEntityPile({
        key,
        entityType,
        count: operation.count,
        entityIds: operation.entityIds || operation.ids,
        complete: operation.complete,
        visibility: operation.visibility,
        replace: operation.replace,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "entity-pile-observation-rejected", operation);
    }

    if (type === "move-entity-pile" || type === "entity-pile-move") {
      const from = String(operation.from || operation.fromPile || "").trim();
      const to = String(operation.to || operation.toPile || "").trim();
      if (!from || !to) return unsupportedOperation(type, "concrete-entity-pile-endpoints-required", operation);
      const result = moveEntityPile({
        from,
        to,
        entityType: operation.entityType,
        count: operation.count,
        entityIds: operation.entityIds || operation.ids,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "entity-pile-move-rejected", operation);
    }

    if (type === "observe-location-group" || type === "location-group") {
      const result = observeLocationGroup({
        key: operation.key || operation.groupKey,
        cardIds: operation.cardIds || operation.ids,
        zoneKeys: operation.zoneKeys || operation.zones,
        zoneCounts: operation.zoneCounts,
        selectionModel: operation.selectionModel,
        uniformSelection: operation.uniformSelection,
        complete: operation.complete,
        context: operation.context || context.turnContext,
        metadata: operation.metadata,
        reason: operation.reason,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "location-group-rejected", operation);
    }

    if (type === "invalidate-location-group" || type === "clear-location-group") {
      const key = String(operation.key || operation.groupKey || "").trim();
      if (!key) return unsupportedOperation(type, "location-group-key-required", operation);
      return invalidateLocationGroup({ key, reason: operation.reason, source })
        ? appliedOperation(type, { key })
        : unsupportedOperation(type, "location-group-not-active", operation);
    }

    if (["observe-skill-binding", "grant-skill", "acquire-skill", "replace-skill"].includes(type)) {
      const skillId = finiteInteger(operation.skillId ?? operation.id, 0);
      if (skillId <= 0) return unsupportedOperation(type, "concrete-skill-id-required", operation);
      const result = observeSkillBinding({
        key: operation.key || operation.bindingKey,
        skillId,
        skillName: operation.skillName || operation.name,
        operation: type === "replace-skill" ? "replace" : type === "observe-skill-binding" ? operation.operation : "grant",
        ownerSeat: operation.ownerSeat ?? context.ownerSeat,
        ownerGeneralId: operation.ownerGeneralId || operation.generalId,
        sourceType: operation.sourceType,
        mode: operation.mode,
        scope: operation.scope,
        ruleIdentityKey: operation.ruleIdentityKey || context.ruleIdentityKey,
        derivedFromSkillIds: operation.derivedFromSkillIds || operation.derivedFromSkillId || operation.parentSkillId,
        replacesSkillIds: operation.replacesSkillIds || operation.replacedSkillIds || operation.replacesSkillId,
        grantedByEventId: operation.grantedByEventId || operation.eventId || operation.causalEventId || context.causalEventId,
        lifecycle: operation.lifecycle,
        expireOnEventTypes: operation.expireOnEventTypes || operation.expireOnEvents,
        versionScope: operation.versionScope,
        context: operation.context || context.turnContext,
        metadata: operation.metadata,
        reason: operation.reason,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "skill-binding-rejected", operation);
    }

    if (type === "lose-skill" || type === "remove-skill-binding") {
      const key = String(operation.key || operation.bindingKey || "").trim();
      const skillId = finiteInteger(operation.skillId ?? operation.id, 0);
      if (!key && skillId <= 0) return unsupportedOperation(type, "binding-key-or-concrete-skill-id-required", operation);
      const removed = removeSkillBinding({
        key,
        skillId,
        ownerSeat: operation.ownerSeat ?? context.ownerSeat,
        ownerGeneralId: operation.ownerGeneralId || operation.generalId,
        reason: operation.reason,
        source
      });
      return removed > 0
        ? appliedOperation(type, { key: key || null, skillId: skillId || null, removed })
        : unsupportedOperation(type, "skill-binding-not-active", operation);
    }

    if (["observe-choice-set", "observe-candidate-set", "register-decision-prompt", "observe-stochastic-event", "register-random-outcome"].includes(type)) {
      const stochastic = ["observe-stochastic-event", "register-random-outcome"].includes(type);
      const domain = String(operation.domain || operation.candidateDomain || operation.valueDomain || "").trim();
      const candidates = operation.candidates ?? operation.population ?? operation.options ?? operation.choices ?? (stochastic ? [] : null);
      if (!domain || candidates == null) return unsupportedOperation(type, "candidate-domain-and-candidates-required", operation);
      const choiceInput = {
        key: operation.key || operation.eventKey || operation.stochasticEventKey || operation.promptKey || operation.choiceSetKey || operation.promptId,
        domain,
        candidates,
        ordered: operation.ordered,
        complete: stochastic ? operation.complete === true : operation.complete,
        withReplacement: operation.withReplacement,
        exactSelections: operation.exactSelections ?? operation.selectionCount ?? (stochastic ? operation.resultCount ?? operation.count ?? 1 : undefined),
        minSelections: operation.minSelections ?? operation.minimum,
        maxSelections: operation.maxSelections ?? operation.maximum,
        selectionAgency: stochastic ? "server-random" : operation.selectionAgency || operation.agency,
        samplingModel: stochastic ? operation.samplingModel || operation.sampling || "unknown" : operation.samplingModel || operation.sampling,
        candidateWeights: operation.candidateWeights || operation.weights,
        candidateConstraint: operation.candidateConstraint || operation.predicate,
        sourceZones: operation.sourceZones ?? operation.sourceZone ?? operation.from,
        sourceResolved: operation.sourceResolved,
        actorSeat: operation.actorSeat ?? operation.seat,
        subjectSeat: operation.subjectSeat ?? operation.targetSeat,
        observerSeats: operation.observerSeats ?? operation.viewerSeats,
        visibility: operation.visibility,
        ruleIdentityKey: operation.ruleIdentityKey || context.ruleIdentityKey,
        whileSkillBindingKey: operation.whileSkillBindingKey || operation.skillBindingKey,
        skillId: operation.skillId ?? context.skillId,
        ownerSeat: operation.ownerSeat ?? context.ownerSeat,
        causalEventId: operation.causalEventId || operation.eventId || context.causalEventId,
        lifecycle: operation.lifecycle,
        expireOnEventTypes: operation.expireOnEventTypes || operation.expireOnEvents,
        context: operation.context || context.turnContext,
        metadata: operation.metadata,
        reason: operation.reason,
        source
      };
      const result = stochastic ? observeStochasticEvent(choiceInput) : observeChoiceSet(choiceInput);
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "choice-set-rejected", operation);
    }

    if (["resolve-choice-set", "resolve-decision-prompt", "cancel-choice-set", "expire-choice-set", "resolve-stochastic-event"].includes(type)) {
      const stochastic = type === "resolve-stochastic-event";
      const key = String(operation.key || operation.eventKey || operation.stochasticEventKey || operation.promptKey || operation.choiceSetKey || operation.promptId || "").trim();
      if (!key) return unsupportedOperation(type, "choice-set-key-required", operation);
      const status = type === "cancel-choice-set"
        ? "cancelled"
        : type === "expire-choice-set"
          ? "expired"
          : operation.status || "resolved";
      const resolutionInput = {
        key,
        status,
        selectedIndexes: operation.selectedIndexes ?? operation.indexes,
        selectedIndex: operation.selectedIndex,
        selectedCandidates: operation.selectedCandidates,
        selectedValues: operation.selectedValues,
        resultCardIds: operation.resultCardIds || operation.cardIds,
        resultCandidates: operation.resultCandidates || operation.results,
        outcome: operation.outcome ?? operation.result,
        reason: operation.reason,
        source
      };
      const result = stochastic ? resolveStochasticEvent(resolutionInput) : resolveChoiceSet(resolutionInput);
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "choice-set-not-active-or-selection-invalid", operation);
    }

    if (type === "state-update" || type === "set-rule-state" || type === "update-rule-state") {
      const key = String(operation.key || operation.stateKey || "").trim();
      if (!key) return unsupportedOperation(type, "concrete-state-key-required", operation);
      const result = updateRuleState({
        key,
        kind: operation.kind,
        operation: operation.operation || operation.op,
        value: operation.value,
        values: operation.values,
        amount: operation.amount,
        lifecycle: operation.lifecycle,
        expireOnEventTypes: operation.expireOnEventTypes || operation.expireOnEvents,
        ruleIdentityKey: operation.ruleIdentityKey || context.ruleIdentityKey,
        whileSkillBindingKey: operation.whileSkillBindingKey || operation.skillBindingKey,
        skillId: operation.skillId ?? context.skillId,
        ownerSeat: operation.ownerSeat ?? context.ownerSeat,
        context: operation.context || context.turnContext,
        metadata: operation.metadata,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "state-mutation-not-resolved", operation);
    }

    if (type === "clear-rule-state") {
      const key = String(operation.key || operation.stateKey || "").trim();
      if (!key) return unsupportedOperation(type, "concrete-state-key-required", operation);
      return clearRuleState({ key, reason: operation.reason, source })
        ? appliedOperation(type, { key })
        : unsupportedOperation(type, "state-key-not-active", operation);
    }

    if (type === "register-rule-modifier" || type === "add-rule-modifier" || type === "rule-modifier") {
      const key = String(operation.key || operation.modifierKey || "").trim();
      const kind = String(operation.kind || operation.modifierKind || "").trim();
      const subject = String(operation.subject || operation.targetOperation || operation.field || "").trim();
      if (!key || !kind || !subject) return unsupportedOperation(type, "modifier-key-kind-and-subject-required", operation);
      const result = registerRuleModifier({
        key,
        kind,
        subject,
        selector: operation.selector || operation.when,
        effect: operation.effect ?? operation.value,
        lifecycle: operation.lifecycle,
        expireOnEventTypes: operation.expireOnEventTypes || operation.expireOnEvents,
        ruleIdentityKey: operation.ruleIdentityKey || context.ruleIdentityKey,
        whileSkillBindingKey: operation.whileSkillBindingKey || operation.skillBindingKey,
        skillId: operation.skillId ?? context.skillId,
        ownerSeat: operation.ownerSeat ?? context.ownerSeat,
        eventId: operation.eventId || operation.causalEventId || context.causalEventId,
        channelKey: operation.channelKey || context.channelKey,
        whileCardId: operation.whileCardId || operation.cardId,
        whileZone: operation.whileZone,
        priority: operation.priority,
        context: operation.context || context.turnContext,
        metadata: operation.metadata,
        reason: operation.reason,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "rule-modifier-rejected", operation);
    }

    if (type === "remove-rule-modifier" || type === "clear-rule-modifier") {
      const key = String(operation.key || operation.modifierKey || "").trim();
      if (!key) return unsupportedOperation(type, "modifier-key-required", operation);
      return removeRuleModifier({ key, reason: operation.reason, source })
        ? appliedOperation(type, { key })
        : unsupportedOperation(type, "modifier-key-not-active", operation);
    }

    if (type === "schedule" || type === "schedule-effect" || type === "scheduled-rule-effect") {
      const result = scheduleEffect({
        key: operation.key || operation.scheduleKey,
        trigger: operation.trigger || operation.when || operation.timing,
        effectType: operation.effectType,
        effect: operation.effect ?? operation.action ?? operation.scheduledOperation,
        ruleIdentityKey: operation.ruleIdentityKey || context.ruleIdentityKey,
        whileSkillBindingKey: operation.whileSkillBindingKey || operation.skillBindingKey,
        skillId: operation.skillId ?? context.skillId,
        ownerSeat: operation.ownerSeat ?? context.ownerSeat,
        lifecycle: operation.lifecycle,
        expireOnEventTypes: operation.expireOnEventTypes || operation.expireOnEvents,
        whileCardId: operation.whileCardId || operation.cardId,
        whileZone: operation.whileZone,
        causeEventIds: operation.causeEventIds || operation.causedByEventIds || context.causalEventId,
        context: operation.context || context.turnContext,
        metadata: operation.metadata,
        reason: operation.reason,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "concrete-trigger-and-effect-required", operation);
    }

    if (type === "resolve-scheduled-effect" || type === "cancel-scheduled-effect" || type === "expire-scheduled-effect") {
      const key = String(operation.key || operation.scheduleKey || "").trim();
      if (!key) return unsupportedOperation(type, "schedule-key-required", operation);
      const status = type === "cancel-scheduled-effect"
        ? "cancelled"
        : type === "expire-scheduled-effect"
          ? "expired"
          : operation.status || "resolved";
      const result = resolveScheduledEffect({
        key,
        status,
        outcome: operation.outcome ?? operation.result,
        reason: operation.reason,
        source
      });
      return result ? appliedOperation(type, result) : unsupportedOperation(type, "scheduled-effect-not-active", operation);
    }

    if (type === "shuffle-current-deck" || type === "explicit-shuffle") {
      const scope = String(operation.scope || "current-deck");
      if (scope !== "current-deck") return unsupportedOperation(type, "explicit-shuffle-scope-not-resolved", operation);
      return appliedOperation(type, shuffleCurrentDeck({ reason: operation.reason || type, source }));
    }

    if (type === "recycle-discard") {
      return appliedOperation(type, recycleDiscard({ reason: operation.reason || type, source }));
    }

    return unsupportedOperation(type, type ? "operation-type-not-concretely-supported" : "operation-type-required", operation);
  }

  function shuffleCurrentDeck(input = {}) {
    const source = normalizeSource(input.source || sourceOf("deck-shuffle", "server-protocol"), now);
    state.deck.shuffleCount++;
    clearDeckOrder(input.reason || "shuffle-current-deck", source);
    recordEvent("deck.shuffle", {
      epoch: state.epoch,
      count: state.deck.count,
      reason: input.reason || "shuffle-current-deck",
      includeDiscard: false,
      source
    });
    return state.deck.count;
  }

  function recycleDiscard(input = {}) {
    const source = normalizeSource(input.source || sourceOf("deck-exhaustion-recycle", "rule-feedback"), now);
    const previousDeckCount = state.deck.count;
    const discardCount = state.discard.count;
    const reportedCount = nonNegativeIntegerOrNull(input.reportedCount);

    if (previousDeckCount != null && previousDeckCount > 0 && reportedCount == null && input.force !== true) {
      return false;
    }
    if (discardCount === 0 && (reportedCount == null || reportedCount === 0)) {
      state.deck.count = 0;
      clearDeckOrder(input.reason || "empty-recycle", source);
      syncDeckZone(source);
      return false;
    }

    const movedIds = state.discard.exactIds.slice();
    updateLocationGroupsForMove(ZONE.DISCARD, ZONE.DECK, movedIds, discardCount, source);
    registerDynamicIds(movedIds);
    for (const id of movedIds) placeExactCard(id, ZONE.DECK, source, { silent: true });
    state.epoch++;
    state.deck.recycleCount++;
    state.deck.count = reportedCount ?? discardCount;
    state.deck.countSource = source;
    state.deck.excludedIds = {};
    state.deck.constraints = [];
    state.pendingRecycle = null;
    clearDeckOrder(input.reason || "deck-exhaustion-recycle", source);
    state.discard = makeDiscardState(now);
    const discardZone = ensureZone(ZONE.DISCARD);
    discardZone.count = 0;
    discardZone.exactIds = [];
    discardZone.complete = true;
    discardZone.source = source;
    discardZone.updatedAt = now();
    reconcileLocationGroupsAfterZoneObservation(ZONE.DISCARD, true, source);
    syncDeckZone(source);
    state.updatedAt = now();
    recordEvent("deck.recycle", {
      epoch: state.epoch,
      previousDeckCount,
      discardCount,
      exactMovedIds: movedIds,
      count: state.deck.count,
      reason: input.reason || "deck-exhaustion-recycle",
      source
    });
    validatePhysicalWorld();
    return true;
  }

  function observeSearchResult(input = {}) {
    const predicate = normalizePredicate(input.predicate);
    const predicateExecutable = predicateIsExecutable(predicate);
    const foundIds = uniquePositiveIds(input.foundCardIds || input.cardIds);
    const foundCount = Math.max(nonNegativeIntegerOrNull(input.foundCount) ?? foundIds.length, foundIds.length);
    const unidentifiedFoundCount = Math.max(0, foundCount - foundIds.length);
    const requestedCount = nonNegativeIntegerOrNull(input.requestedCount) ?? foundCount;
    const exhaustive = input.exhaustive === true;
    const source = normalizeSource(input.source || sourceOf("search-result", "rule-feedback"), now);
    const matchingIds = predicateExecutable
      ? activeCandidateIds().filter((id) => matchesPredicate(state.catalog[id], predicate, id))
      : [];
    const foundPredicateMismatches = predicateExecutable
      ? foundIds.filter((id) => !matchesPredicate(state.catalog[id], predicate, id))
      : [];
    if (foundPredicateMismatches.length) {
      contradiction("search-result-predicate-mismatch", {
        predicate,
        foundIds,
        foundPredicateMismatches,
        source
      });
    }
    const isPartial = foundCount < requestedCount;
    let constraintRejected = false;
    let constraintDeferred = false;

    if (exhaustive && isPartial && unidentifiedFoundCount > 0) {
      constraintDeferred = true;
    } else if (exhaustive && isPartial && !predicateExecutable) {
      constraintRejected = true;
      contradiction("search-predicate-not-executable", {
        predicate,
        requestedCount,
        foundIds,
        source
      });
    } else if (exhaustive && isPartial) {
      const conflicts = matchingIds.filter((id) => !foundIds.includes(id) && isExactKnownInDeck(id));
      if (conflicts.length) {
        contradiction("search-result-conflicts-known-deck-membership", {
          predicate,
          requestedCount,
          foundIds,
          exactKnownIds: conflicts,
          source
        });
      }
      const proposedExcluded = matchingIds.filter((id) =>
        !foundIds.includes(id) &&
        !state.deck.excludedIds[id] &&
        !isKnownOutsideDeck(id) &&
        !isExactKnownInDeck(id)
      );
      const population = candidatePopulation();
      const availableOutsideCapacity = Math.max(0, population.unresolvedIds.length - population.remainingSlots);
      if (proposedExcluded.length > availableOutsideCapacity) {
        constraintRejected = true;
        contradiction("search-exclusion-exceeds-outside-capacity", {
          predicate,
          requestedCount,
          foundIds,
          proposedExcludedIds: proposedExcluded,
          availableOutsideCapacity,
          physicalDeckCount: state.deck.count,
          source
        });
      } else if (proposedExcluded.length) {
        for (const id of proposedExcluded) {
          state.deck.excludedIds[id] = {
            epoch: state.epoch,
            predicate,
            source,
            reason: input.reason || "exhaustive-search-shortfall"
          };
        }
        state.deck.constraints.push({
          kind: "deck-exclusion",
          epoch: state.epoch,
          predicate,
          requestedCount,
          foundCount,
          excludedIds: proposedExcluded,
          source,
          reason: input.reason || "exhaustive-search-shortfall"
        });
      }
    }

    recordEvent("deck.search.result", {
      predicate,
      requestedCount,
      foundIds,
      foundCount,
      unidentifiedFoundCount,
      exhaustive,
      predicateExecutable,
      foundPredicateMismatches,
      inferredNoFurtherMatch: exhaustive && isPartial && predicateExecutable && !constraintDeferred,
      constraintRejected,
      constraintDeferred,
      source
    });
    return {
      predicate,
      requestedCount,
      foundIds,
      foundCount,
      unidentifiedFoundCount,
      exhaustive,
      predicateExecutable,
      foundPredicateMismatches,
      inferredNoFurtherMatch: exhaustive && isPartial && predicateExecutable && !constraintDeferred,
      constraintRejected,
      constraintDeferred,
      excludedIds: Object.keys(state.deck.excludedIds).map(Number)
    };
  }

  function search(input = {}) {
    const previewFoundIds = uniquePositiveIds(input.foundCardIds || input.cardIds);
    const previewFoundCount = Math.max(nonNegativeIntegerOrNull(input.foundCount) ?? previewFoundIds.length, previewFoundIds.length);
    if (state.deck.count != null && previewFoundCount > state.deck.count) {
      return {
        status: "unsupported",
        reason: "cross-epoch-search-requires-explicit-segments",
        requestedCount: nonNegativeIntegerOrNull(input.requestedCount) ?? previewFoundCount,
        foundCount: previewFoundCount,
        foundIds: previewFoundIds,
        currentDeckCount: state.deck.count
      };
    }
    const result = observeSearchResult(input);
    if (result.foundCount > 0) {
      const epochBeforeMove = state.epoch;
      const movement = takeFromDeck({
        count: result.foundCount,
        cardIds: result.foundIds,
        predicate: result.predicate,
        to: input.to,
        source: input.source,
        context: input.context,
        reason: input.reason || "deck-search"
      });
      let postMoveConstraint = null;
      if (result.constraintDeferred && result.exhaustive && state.epoch === epochBeforeMove) {
        postMoveConstraint = observeSearchResult({
          predicate: result.predicate,
          requestedCount: 1,
          foundCount: 0,
          foundCardIds: [],
          exhaustive: true,
          source: input.source,
          reason: input.reason || "deck-search-post-move-shortfall"
        });
      }
      return {
        ...result,
        movement,
        postMoveConstraint,
        excludedIds: Object.keys(state.deck.excludedIds).map(Number)
      };
    }
    return result;
  }

  function segmentedSearch(input = {}) {
    const to = normalizeZoneKey(input.to || input.destination);
    const rawSegments = Array.isArray(input.segments) ? input.segments : [];
    const globalPredicate = input.predicate || input.selector;
    if (!to || !rawSegments.length) {
      return { status: "unsupported", reason: "destination-and-search-segments-required", segments: [] };
    }
    const segments = rawSegments.map((segment) => {
      const foundIds = uniquePositiveIds(segment.foundCardIds || segment.cardIds);
      const foundCount = Math.max(nonNegativeIntegerOrNull(segment.foundCount) ?? foundIds.length, foundIds.length);
      return {
        epoch: nonNegativeIntegerOrNull(segment.epoch),
        predicate: segment.predicate || segment.selector || globalPredicate,
        requestedCount: nonNegativeIntegerOrNull(segment.requestedCount ?? segment.count) ?? foundCount,
        foundCount,
        foundIds,
        exhaustive: segment.exhaustive === true,
        reason: String(segment.reason || input.reason || "segmented-deck-search")
      };
    });
    if (segments.some((segment) => !segment.predicate || segment.foundCount > segment.requestedCount)) {
      return { status: "unsupported", reason: "each-segment-needs-predicate-and-valid-counts", segments };
    }
    const allIds = segments.flatMap((segment) => segment.foundIds);
    if (new Set(allIds).size !== allIds.length) {
      return { status: "unsupported", reason: "physical-card-id-repeated-across-search-segments", cardIds: allIds, segments };
    }
    const declaredIds = uniquePositiveIds(input.foundCardIds || input.cardIds);
    if (declaredIds.length && (
      declaredIds.length !== allIds.length ||
      declaredIds.some((cardId) => !allIds.includes(cardId))
    )) {
      return { status: "unsupported", reason: "declared-results-disagree-with-search-segments", cardIds: declaredIds, segmentCardIds: allIds };
    }

    const before = cloneJson(state);
    const results = [];
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      const epochBefore = state.epoch;
      if (segment.epoch != null && segment.epoch !== epochBefore) {
        replaceObject(state, before);
        return {
          status: "unsupported",
          reason: "search-segment-epoch-mismatch",
          segmentIndex: index,
          expectedEpoch: segment.epoch,
          actualEpoch: epochBefore,
          rolledBack: true
        };
      }
      if (state.deck.count != null && segment.foundCount > state.deck.count) {
        replaceObject(state, before);
        return {
          status: "unsupported",
          reason: "search-segment-crosses-epoch-boundary",
          segmentIndex: index,
          foundCount: segment.foundCount,
          currentDeckCount: state.deck.count,
          rolledBack: true
        };
      }
      const result = search({
        predicate: segment.predicate,
        requestedCount: segment.requestedCount,
        foundCount: segment.foundCount,
        foundCardIds: segment.foundIds,
        exhaustive: segment.exhaustive,
        to,
        context: input.context,
        source: input.source,
        reason: segment.reason
      });
      if (result.status === "unsupported") {
        replaceObject(state, before);
        return { ...result, segmentIndex: index, rolledBack: true };
      }
      results.push({
        segmentIndex: index,
        epochBefore,
        epochAfter: state.epoch,
        requestedCount: segment.requestedCount,
        foundCount: segment.foundCount,
        foundIds: segment.foundIds,
        exhaustive: segment.exhaustive,
        result
      });
    }
    const summary = {
      status: "applied",
      to,
      requestedCount: segments.reduce((sum, segment) => sum + segment.requestedCount, 0),
      foundCount: segments.reduce((sum, segment) => sum + segment.foundCount, 0),
      foundIds: allIds,
      segments: results,
      resultingEpoch: state.epoch
    };
    recordEvent("deck.search.segmented", summary);
    return summary;
  }

  function orderedMatchSearch(input = {}) {
    const predicate = normalizePredicate(input.predicate || input.selector || {});
    const endpoint = input.endpoint === "bottom" ? "bottom" : input.endpoint === "top" ? "top" : "";
    const hasObservedResult = input.foundCount != null || Array.isArray(input.foundCardIds) || Array.isArray(input.cardIds);
    const foundIds = uniquePositiveIds(input.foundCardIds || input.cardIds);
    const foundCount = Math.max(nonNegativeIntegerOrNull(input.foundCount) ?? foundIds.length, foundIds.length);
    const requestedCount = nonNegativeIntegerOrNull(input.requestedCount ?? input.count) ?? 1;
    const to = normalizeZoneKey(input.to || input.destination);
    const source = normalizeSource(input.source || sourceOf("ordered-match-search", "rule-feedback"), now);
    const searchEpoch = state.epoch;
    if (!endpoint || !predicateIsExecutable(predicate)) {
      return { status: "unsupported", reason: "endpoint-and-executable-predicate-required", endpoint, predicate };
    }
    if (requestedCount !== 1 || foundCount > 1 || foundIds.length > 1) {
      return { status: "unsupported", reason: "one-ordered-search-result-per-operation-required", requestedCount, foundCount, foundIds };
    }
    if (!hasObservedResult || foundCount > 0 && !to) {
      return { status: "unsupported", reason: "observed-result-count-and-destination-required", foundCount, to };
    }
    const result = observeSearchResult({
      predicate,
      requestedCount: 1,
      foundCount,
      foundCardIds: foundIds,
      exhaustive: input.exhaustive !== false,
      reason: input.reason || "ordered-match-search",
      source
    });
    let rank = orderedSearchRank(input, foundIds[0], endpoint);
    let rankProven = rank != null;
    let skippedKnownMatchIds = [];
    let movement = null;
    if (foundCount > 0) {
      if (rankProven) {
        skippedKnownMatchIds = knownMatchingCardsBeforeRank(rank, endpoint, predicate);
        if (skippedKnownMatchIds.length) {
          contradiction("ordered-search-skipped-known-match", {
            endpoint,
            predicate,
            foundCardId: foundIds[0] || null,
            foundRank: rank,
            skippedKnownMatchIds,
            source
          });
        }
      }
      if (foundIds.length && rankProven) {
        movement = takeFromDeckAtRank({
          cardId: foundIds[0],
          rank,
          to,
          predicate,
          context: input.context,
          source,
          reason: input.reason || "ordered-match-search"
        });
        if (movement.status !== "applied") {
          clearDeckOrder("ordered-search-rank-conflict", source);
          movement = takeFromDeck({
            count: 1,
            cardIds: foundIds,
            predicate,
            to,
            context: input.context,
            source,
            reason: input.reason || "ordered-match-search-rank-fallback"
          });
          rank = null;
          rankProven = false;
        }
      } else {
        movement = takeFromDeck({
          count: 1,
          cardIds: foundIds,
          predicate,
          to,
          context: input.context,
          source,
          reason: input.reason || "ordered-match-search-unresolved-rank"
        });
      }
    }
    recordEvent("deck.ordered-search", {
      endpoint,
      searchEpoch,
      resultingEpoch: state.epoch,
      predicate,
      foundCount,
      foundCardIds: foundIds,
      foundRank: rank,
      rankProven,
      skippedKnownMatchIds,
      nonMatchingCardsStayedInDeck: true,
      exhaustive: input.exhaustive !== false,
      source
    });
    return {
      status: "applied",
      ...result,
      endpoint,
      searchEpoch,
      resultingEpoch: state.epoch,
      foundRank: rank,
      rankProven,
      skippedKnownMatchIds,
      movement,
      nonMatchingCardsStayedInDeck: true
    };
  }

  function orderedSearchRank(input, cardIdValue, endpoint) {
    const fromTop = positiveInteger(input.foundRank ?? input.rank, 0);
    if (fromTop > 0) return fromTop;
    const fromEndpoint = positiveInteger(input.rankFromEndpoint ?? input.foundOffset ?? input.offset, 0);
    if (fromEndpoint > 0 && state.deck.count != null) {
      return endpoint === "top" ? fromEndpoint : state.deck.count - fromEndpoint + 1;
    }
    return knownDeckRankOf(cardIdValue);
  }

  function knownMatchingCardsBeforeRank(rank, endpoint, predicate) {
    const facts = new Map();
    for (let index = 0; index < state.deck.top.length; index++) facts.set(index + 1, state.deck.top[index]);
    if (state.deck.count != null) {
      for (let index = 0; index < state.deck.bottom.length; index++) facts.set(state.deck.count - index, state.deck.bottom[index]);
    }
    for (const fact of Object.values(state.deck.knownRanks)) facts.set(fact.rank, fact.cardId);
    return uniquePositiveIds(Array.from(facts.entries())
      .filter(([knownRank, cardId]) => {
        const before = endpoint === "top" ? knownRank < rank : knownRank > rank;
        return before && matchesPredicate(state.catalog[cardId], predicate, cardId);
      })
      .map(([, cardId]) => cardId));
  }

  function revealUntilResult(input = {}) {
    const revealedIds = uniquePositiveIds(input.revealedCardIds || input.cardIds);
    const matchCardId = finiteInteger(input.matchCardId, 0);
    const predicate = normalizePredicate(input.predicate || {});
    const endpoint = input.endpoint === "bottom" ? "bottom" : "top";
    const processZone = normalizeZoneKey(input.processZone) || ZONE.PROCESS;
    const matchTo = matchCardId > 0 ? normalizeZoneKey(input.matchTo || input.destination) : "";
    const missesTo = normalizeZoneKey(input.missesTo) || ZONE.DISCARD;
    const source = normalizeSource(input.source || sourceOf("reveal-until-result", "server-protocol"), now);
    if (!revealedIds.length || !predicateIsExecutable(predicate)) {
      return { status: "unsupported", reason: "revealed-card-ids-and-executable-predicate-required" };
    }
    if (matchCardId > 0 && (!matchTo || !revealedIds.includes(matchCardId) || revealedIds.at(-1) !== matchCardId)) {
      return { status: "rejected", reason: "match-must-be-the-last-revealed-card", revealedIds, matchCardId, matchTo };
    }
    if (state.deck.count != null && state.discard.count != null && revealedIds.length > state.deck.count + state.discard.count) {
      contradiction("reveal-until-exceeds-available-cards", {
        revealedIds,
        deckCount: state.deck.count,
        discardCount: state.discard.count,
        source
      });
      return { status: "rejected", reason: "revealed-count-exceeds-deck-and-discard", revealedIds };
    }

    const misses = matchCardId > 0 ? revealedIds.slice(0, -1) : revealedIds.slice();
    const unexpectedMatches = misses.filter((id) => matchesPredicate(state.catalog[id], predicate, id));
    const matchFailsPredicate = matchCardId > 0 && !matchesPredicate(state.catalog[matchCardId], predicate, matchCardId);
    if (unexpectedMatches.length || matchFailsPredicate) {
      contradiction("reveal-until-predicate-mismatch", {
        predicate,
        revealedIds,
        matchCardId,
        unexpectedMatches,
        matchFailsPredicate,
        source
      });
    }

    const beforeReveal = cloneJson(state);
    const reveal = draw({
      count: revealedIds.length,
      cardIds: revealedIds,
      endpoint,
      to: processZone,
      source,
      reason: input.reason || "reveal-until-scan"
    });
    if (reveal.completed !== revealedIds.length) {
      replaceObject(state, beforeReveal);
      return { status: "rejected", reason: "reveal-incomplete", revealedIds, reveal, rolledBack: true };
    }
    const missMove = misses.length
      ? observeMove({
          from: processZone,
          to: missesTo,
          count: misses.length,
          cardIds: misses,
          context: input.context,
          source,
          visibility: "public",
          reason: "reveal-until-misses"
        })
      : null;
    const matchMove = matchCardId > 0
      ? observeMove({
          from: processZone,
          to: matchTo,
          count: 1,
          cardIds: [matchCardId],
          context: input.context,
          source,
          reason: "reveal-until-match"
        })
      : null;
    const searchFeedback = observeSearchResult({
      predicate,
      requestedCount: 1,
      foundCardIds: matchCardId > 0 ? [matchCardId] : [],
      exhaustive: input.exhaustive === true,
      source,
      reason: input.reason || "reveal-until-feedback"
    });
    recordEvent("deck.reveal-until", {
      endpoint,
      predicate,
      revealedIds,
      misses,
      matchCardId: matchCardId || null,
      processZone,
      missesTo,
      matchTo: matchTo || null,
      exhaustive: input.exhaustive === true,
      source
    });
    return {
      status: "applied",
      endpoint,
      predicate,
      revealedIds,
      misses,
      matchCardId: matchCardId || null,
      reveal,
      missMove,
      matchMove,
      searchFeedback
    };
  }

  function nextCardProbability(input = {}) {
    const endpoint = input.endpoint === "bottom" ? "bottom" : "top";
    const world = physicalWorldSummary();
    if (state.deck.definition.known && !world.consistent) {
      return {
        available: false,
        exact: false,
        endpoint,
        reason: "inconsistent-physical-world",
        physicalDeckCount: state.deck.count,
        candidateCount: 0,
        assumption: "none",
        cards: [],
        distributions: emptyDistributions(),
        overAllocatedCount: world.overAllocatedCount
      };
    }
    const population = state.deck.definition.known ? candidatePopulation() : null;
    if (population && !population.capacityConsistent) {
      return {
        available: false,
        exact: false,
        endpoint,
        reason: "inconsistent-deck-capacity",
        physicalDeckCount: state.deck.count,
        candidateCount: 0,
        assumption: "none",
        cards: [],
        distributions: emptyDistributions(),
        capacityDeficit: population.capacityDeficit
      };
    }
    const endpointRank = endpoint === "top" ? 1 : state.deck.count;
    const known = state.deck[endpoint][0] || (endpointRank != null ? state.deck.knownRanks[endpointRank]?.cardId : null);
    if (known) {
      const card = normalizedCardForId(known);
      return probabilityResult({
        endpoint,
        exact: true,
        physicalDeckCount: state.deck.count,
        weights: new Map([[known, 1]]),
        cards: [card],
        assumption: "known-deck-endpoint"
      });
    }
    if (!state.deck.definition.known) {
      return {
        available: false,
        exact: false,
        endpoint,
        reason: "deck-definition-unknown",
        physicalDeckCount: state.deck.count,
        candidateCount: 0,
        assumption: "none",
        cards: [],
        distributions: emptyDistributions()
      };
    }
    if (state.deck.count === 0) {
      return {
        available: false,
        exact: false,
        endpoint,
        reason: "deck-empty",
        physicalDeckCount: 0,
        candidateCount: 0,
        assumption: "none",
        cards: [],
        distributions: emptyDistributions()
      };
    }

    const partition = locationGroupDeckPartition(population);
    if (!partition.available) {
      return {
        available: false,
        exact: false,
        endpoint,
        reason: partition.reason,
        physicalDeckCount: state.deck.count,
        candidateCount: 0,
        assumption: "none",
        cards: [],
        distributions: emptyDistributions(),
        locationGroupConstraint: partition.group || null,
        locationGroups: partition.groups || []
      };
    }
    const weights = candidateWeights(population, partition);
    const cards = Array.from(weights.keys()).map(normalizedCardForId);
    return probabilityResult({
      endpoint,
      exact: false,
      physicalDeckCount: state.deck.count,
      weights,
      cards,
      assumption: partition.groups.length
        ? "uniform-within-proven-disjoint-location-groups"
        : state.deck.count == null
          ? "uniform-over-unlocated-candidates"
          : "exchangeable-unlocated-card-identities",
      locationGroups: partition.groups
    });
  }

  function searchProbability(input = {}) {
    const predicate = normalizePredicate(input.predicate);
    const requestedCount = positiveInteger(input.requestedCount, 1);
    if (!predicateIsExecutable(predicate)) {
      return {
        available: false,
        reason: "predicate-not-executable",
        predicate,
        requestedCount
      };
    }
    if (!state.deck.definition.known || state.deck.count == null) {
      return {
        available: false,
        reason: !state.deck.definition.known ? "deck-definition-unknown" : "deck-count-unknown",
        predicate,
        requestedCount
      };
    }

    const world = physicalWorldSummary();
    if (!world.consistent) {
      return {
        available: false,
        reason: "inconsistent-physical-world",
        predicate,
        requestedCount,
        physicalDeckCount: state.deck.count,
        overAllocatedCount: world.overAllocatedCount
      };
    }

    const population = candidatePopulation();
    const { exactDeckIds, unresolvedIds, remainingSlots } = population;
    if (remainingSlots > unresolvedIds.length) {
      return {
        available: false,
        reason: "inconsistent-deck-capacity",
        predicate,
        requestedCount,
        physicalDeckCount: state.deck.count,
        remainingSlots,
        unresolvedCandidateCount: unresolvedIds.length,
        capacityDeficit: remainingSlots - unresolvedIds.length
      };
    }
    const partition = locationGroupDeckPartition(population);
    if (!partition.available) {
      return {
        available: false,
        reason: partition.reason,
        predicate,
        requestedCount,
        physicalDeckCount: state.deck.count,
        locationGroupConstraint: partition.group || null,
        locationGroups: partition.groups || []
      };
    }
    const exactMatches = exactDeckIds.filter((id) => matchesPredicate(state.catalog[id], predicate, id)).length;
    const unresolvedMatches = unresolvedIds.filter((id) => matchesPredicate(state.catalog[id], predicate, id)).length;
    let unresolvedDistribution = { 0: 1 };
    const components = [
      ...partition.groups.map((group) => ({
        kind: "location-group",
        key: group.key,
        cardIds: group.cardIds,
        deckSlots: group.deckSlots
      })),
      {
        kind: "free-unresolved",
        key: null,
        cardIds: partition.freeIds,
        deckSlots: partition.freeSlots
      }
    ];
    const componentSummaries = [];
    for (const component of components) {
      const matchingCount = component.cardIds.filter((id) => matchesPredicate(state.catalog[id], predicate, id)).length;
      const distribution = componentHitDistribution(component.cardIds.length, matchingCount, component.deckSlots);
      unresolvedDistribution = convolveHitDistributions(unresolvedDistribution, distribution);
      componentSummaries.push({
        kind: component.kind,
        key: component.key,
        candidateCount: component.cardIds.length,
        matchingCount,
        deckSlots: component.deckSlots,
        hitCountProbabilities: distribution
      });
    }
    const probabilities = Object.fromEntries(Object.entries(unresolvedDistribution).map(([hits, probability]) => [Number(hits) + exactMatches, probability]));
    const probabilityAtLeastRequested = Object.entries(probabilities)
      .filter(([hits]) => Number(hits) >= requestedCount)
      .reduce((sum, [, value]) => sum + value, 0);
    const probabilityNoMatch = probabilities[0] || 0;
    return {
      available: true,
      predicate,
      requestedCount,
      physicalDeckCount: state.deck.count,
      exactKnownInDeck: exactDeckIds.length,
      exactKnownMatches: exactMatches,
      unresolvedCandidateCount: unresolvedIds.length,
      unresolvedMatchCount: unresolvedMatches,
      probabilityNoMatch,
      probabilityAtLeastOne: 1 - probabilityNoMatch,
      probabilityAtLeastRequested,
      hitCountProbabilities: probabilities,
      components: componentSummaries,
      locationGroups: partition.groups,
      assumption: partition.groups.length
        ? "uniform-placement-within-proven-disjoint-location-groups"
        : "uniform-placement-of-unresolved-identities"
    };

    function componentHitDistribution(candidateCount, matchingCount, selectedCount) {
      if (selectedCount === 0) return { 0: 1 };
      const result = {};
      const minimumHits = Math.max(0, selectedCount - (candidateCount - matchingCount));
      const maximumHits = Math.min(matchingCount, selectedCount);
      for (let hits = minimumHits; hits <= maximumHits; hits++) {
        result[hits] = hypergeometricProbability(candidateCount, matchingCount, selectedCount, hits);
      }
      return result;
    }

    function convolveHitDistributions(left, right) {
      const result = {};
      for (const [leftHits, leftProbability] of Object.entries(left)) {
        for (const [rightHits, rightProbability] of Object.entries(right)) {
          const hits = Number(leftHits) + Number(rightHits);
          result[hits] = (result[hits] || 0) + leftProbability * rightProbability;
        }
      }
      return result;
    }
  }

  function aggregateSubsetFeasibility(input = {}) {
    const field = String(input.field || "number");
    const target = finiteNumber(input.sum ?? input.target);
    const minCount = positiveInteger(input.minCount, 1);
    const requestedMax = positiveIntegerOrNull(input.maxCount);
    const predicate = normalizePredicate(input.predicate || {});
    if (field !== "number" || target == null || target < 0 || !Number.isInteger(target)) {
      return { available: false, reason: "integer-number-sum-required", field, target };
    }
    if (!predicateIsExecutable(predicate)) {
      return { available: false, reason: "predicate-not-executable", field, target, predicate };
    }
    if (!state.deck.definition.known || state.deck.count == null) {
      return {
        available: false,
        reason: !state.deck.definition.known ? "deck-definition-unknown" : "deck-count-unknown",
        field,
        target,
        predicate
      };
    }
    const world = physicalWorldSummary();
    if (!world.consistent) {
      return { available: false, reason: "inconsistent-physical-world", field, target, predicate };
    }
    const population = candidatePopulation();
    if (!population.capacityConsistent) {
      return { available: false, reason: "inconsistent-deck-capacity", field, target, predicate };
    }

    const maxCount = Math.min(requestedMax ?? state.deck.count, state.deck.count, target > 0 ? target : state.deck.count);
    const exactCards = population.exactDeckIds
      .filter((id) => matchesPredicate(state.catalog[id], predicate, id))
      .map((id) => aggregateCandidate(id, false));
    const unresolvedCards = population.unresolvedIds
      .filter((id) => matchesPredicate(state.catalog[id], predicate, id))
      .map((id) => aggregateCandidate(id, true));
    const ignoredIds = [...exactCards, ...unresolvedCards].filter((row) => row.value == null).map((row) => row.id);
    const usableExact = exactCards.filter((row) => row.value != null);
    const usableUnresolved = unresolvedCards.filter((row) => row.value != null);
    const guaranteedWitness = findAggregateWitness(usableExact, target, minCount, maxCount, 0);
    const possibleWitness = guaranteedWitness || findAggregateWitness(
      [...usableExact, ...usableUnresolved],
      target,
      minCount,
      maxCount,
      population.remainingSlots
    );
    const status = guaranteedWitness ? "guaranteed" : possibleWitness ? "possible" : "impossible";
    return {
      available: true,
      field,
      target,
      predicate,
      minCount,
      maxCount,
      status,
      guaranteed: status === "guaranteed",
      possible: status !== "impossible",
      guaranteedWitness: guaranteedWitness?.ids || [],
      possibleWitness: possibleWitness?.ids || [],
      possibleWitnessUsesUnresolved: possibleWitness?.unresolvedCount || 0,
      exactCandidateCount: usableExact.length,
      unresolvedCandidateCount: usableUnresolved.length,
      unresolvedDeckSlots: population.remainingSlots,
      ignoredIds,
      probabilityAvailable: false,
      probabilityReason: "server-subset-sampling-distribution-unknown"
    };

    function aggregateCandidate(id, unresolved) {
      const value = finiteNumber(cardAttribute(normalizedCardForId(id), field));
      return { id, value: Number.isInteger(value) && value > 0 ? value : null, unresolved };
    }
  }

  function discardForTurn(turn, round = null) {
    const normalizedTurn = finiteNumber(turn);
    const normalizedRound = finiteNumber(round);
    const entries = state.discard.entries.filter((entry) => {
      if (normalizedTurn != null && entry.turn !== normalizedTurn) return false;
      if (normalizedRound != null && entry.round !== normalizedRound) return false;
      return state.discard.exactIds.includes(entry.cardId);
    });
    return {
      epoch: state.epoch,
      turn: normalizedTurn,
      round: normalizedRound,
      complete: state.discard.complete,
      count: entries.length,
      cardIds: entries.map((entry) => entry.cardId),
      cards: entries.map((entry) => normalizedCardForId(entry.cardId)),
      entries: entries.map((entry) => ({ ...entry }))
    };
  }

  function remainingDeck() {
    const population = candidatePopulation();
    const partition = locationGroupDeckPartition(population);
    return {
      definitionKnown: state.deck.definition.known,
      definitionCount: state.deck.definition.cardIds.length,
      physicalDeckCount: state.deck.count,
      epoch: state.epoch,
      knownTop: state.deck.top.slice(),
      knownBottom: state.deck.bottom.slice(),
      knownRanks: Object.fromEntries(
        Object.entries(state.deck.knownRanks).map(([rank, fact]) => [rank, { ...fact }])
      ),
      exactKnownInDeck: population.exactDeckIds,
      unresolvedCandidateIds: population.unresolvedIds,
      remainingSlotsForUnresolved: population.remainingSlots,
      excludedIds: Object.keys(state.deck.excludedIds).map(Number),
      locationGroups: activeLocationGroups(),
      locationGroupProbability: {
        available: partition.available,
        reason: partition.reason,
        groups: cloneJson(partition.groups || []),
        constraint: cloneJson(partition.group || null),
        freeSlots: partition.freeSlots ?? null,
        reservedDeckSlots: partition.reservedDeckSlots ?? null
      },
      compositionExact:
        state.deck.count != null &&
        population.exactDeckIds.length === state.deck.count &&
        population.remainingSlots === 0,
      capacityConsistent: population.capacityConsistent,
      capacityDeficit: population.capacityDeficit
    };
  }

  function explainCard(cardId) {
    const id = finiteInteger(cardId, 0);
    const location = state.locations[id] || null;
    const locationGroups = activeLocationGroups({ cardId: id });
    const exclusion = state.deck.excludedIds[id] || null;
    return {
      id,
      physicalGeneration: physicalCardGeneration(id),
      physicalLifecycle: physicalCardLifecycle(id),
      card: normalizedCardForId(id),
      effective: effectiveCard(id),
      activeDeckCard: state.deck.definition.cardIds.includes(id),
      location,
      locationStatus: location ? "exact" : locationGroups.length ? "conserved-ambiguous" : "unlocated",
      possibleZoneKeys: location
        ? [location.zoneKey]
        : uniqueStrings(locationGroups.flatMap((group) => group.zoneKeys)),
      locationGroups,
      tags: cloneJson(state.cardTags[id] || {}),
      tagHistory: state.cardTagHistory.filter((row) => row.cardId === id).map(cloneJson),
      excludedFromCurrentDeck: !!exclusion,
      exclusion,
      currentEpoch: state.epoch
    };
  }

  function snapshot() {
    const remaining = remainingDeck();
    return {
      schemaVersion: SCHEMA_VERSION,
      version: state.version,
      initialized: state.initialized,
      sessionKey: state.sessionKey,
      resetReason: state.resetReason,
      epoch: state.epoch,
      context: { ...state.context },
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      catalog: {
        count: Object.keys(state.catalog).length,
        source: state.catalogSource,
        observedDefinitionSources: cloneJson(state.cardDefinitionSources),
        definitionHistory: state.cardDefinitionHistory.map(cloneJson)
      },
      physicalCardLifecycles: cloneJson(state.physicalCardLifecycles),
      physicalCardLifecycleHistory: state.physicalCardLifecycleHistory.map(cloneJson),
      deck: {
        definition: {
          ...state.deck.definition,
          cardIds: state.deck.definition.cardIds.slice()
        },
        count: state.deck.count,
        countSource: state.deck.countSource,
        top: state.deck.top.slice(),
        bottom: state.deck.bottom.slice(),
        topSource: state.deck.topSource,
        bottomSource: state.deck.bottomSource,
        knownRanks: Object.fromEntries(Object.entries(state.deck.knownRanks).map(([rank, fact]) => [rank, { ...fact }])),
        recycleCount: state.deck.recycleCount,
        shuffleCount: state.deck.shuffleCount,
        dynamicIds: state.deck.dynamicIds.slice(),
        excludedIds: Object.keys(state.deck.excludedIds).map(Number),
        constraints: state.deck.constraints.map(cloneJson),
        remaining
      },
      discard: {
        count: state.discard.count,
        exactIds: state.discard.exactIds.slice(),
        unknownCount: state.discard.unknownCount,
        complete: state.discard.complete,
        entries: state.discard.entries.map((entry) => ({ ...entry })),
        historyCount: state.discardHistory.length,
        history: state.discardHistory.map((entry) => ({ ...entry }))
      },
      hands: Object.fromEntries(Object.entries(state.hands).map(([key, hand]) => [key, compactHand(hand)])),
      handHistory: state.handHistory.map(cloneJson),
      handKnowledgeHistory: state.handKnowledgeHistory.map(cloneJson),
      handConstraintHistory: state.handConstraintHistory.map(cloneJson),
      zoneExchangeHistory: state.zoneExchangeHistory.map(cloneJson),
      zones: Object.fromEntries(Object.entries(state.zones).map(([key, zone]) => [key, compactZone(zone)])),
      locations: cloneJson(state.locations),
      locationHistory: state.locationHistory.map(cloneJson),
      locationGroups: cloneJson(state.locationGroups),
      locationGroupHistory: state.locationGroupHistory.map(cloneJson),
      cardTags: cloneJson(state.cardTags),
      cardTagHistory: state.cardTagHistory.map(cloneJson),
      cardEventHistory: state.cardEventHistory.map(cloneJson),
      movementHistory: state.movementHistory.map(cloneJson),
      movementAttempts: cloneJson(state.movementAttempts),
      movementAttemptHistory: state.movementAttemptHistory.map(cloneJson),
      judgementOutcomes: cloneJson(state.judgementOutcomes),
      judgementOutcomeHistory: state.judgementOutcomeHistory.map(cloneJson),
      booleanConstraints: cloneJson(state.booleanConstraints),
      booleanConstraintHistory: state.booleanConstraintHistory.map(cloneJson),
      causalEvents: cloneJson(state.causalEvents),
      causalEventHistory: state.causalEventHistory.map(cloneJson),
      comparisons: cloneJson(state.comparisons),
      comparisonHistory: state.comparisonHistory.map(cloneJson),
      cardViews: cloneJson(state.cardViews),
      cardViewHistory: state.cardViewHistory.map(cloneJson),
      ruleStates: cloneJson(state.ruleStates),
      ruleStateHistory: state.ruleStateHistory.map(cloneJson),
      ruleModifiers: cloneJson(state.ruleModifiers),
      ruleModifierHistory: state.ruleModifierHistory.map(cloneJson),
      scheduledEffects: cloneJson(state.scheduledEffects),
      scheduledEffectHistory: state.scheduledEffectHistory.map(cloneJson),
      choiceSets: cloneJson(state.choiceSets),
      choiceSetHistory: state.choiceSetHistory.map(cloneJson),
      skillBindings: cloneJson(state.skillBindings),
      skillBindingHistory: state.skillBindingHistory.map(cloneJson),
      generalCardEntities: Object.fromEntries(Object.entries(state.generalCardEntities).map(([key, row]) => [key, compactGeneralCardEntity(row)])),
      generalCardEntityHistory: state.generalCardEntityHistory.map(cloneJson),
      zoneCapabilities: cloneJson(state.zoneCapabilities),
      zoneCapabilityHistory: state.zoneCapabilityHistory.map(cloneJson),
      equipmentProjections: cloneJson(state.equipmentProjections),
      equipmentProjectionHistory: state.equipmentProjectionHistory.map(cloneJson),
      namedZoneHostHistory: state.namedZoneHostHistory.map(cloneJson),
      physicalPiles: Object.fromEntries(Object.entries(state.physicalPiles).map(([key, pile]) => [key, compactPhysicalPile(pile)])),
      physicalPileHistory: state.physicalPileHistory.map(cloneJson),
      entityPiles: Object.fromEntries(Object.entries(state.entityPiles).map(([key, pile]) => [key, compactEntityPile(pile)])),
      entityLocations: cloneJson(state.entityLocations),
      entityPileHistory: state.entityPileHistory.map(cloneJson),
      world: physicalWorldSummary(),
      contradictions: state.contradictions.map(cloneJson),
      recentEvents: state.events.slice(-80).map(cloneJson)
    };
  }

  function consumeDeck(input = {}) {
    const count = nonNegativeIntegerOrNull(input.count) ?? uniquePositiveIds(input.cardIds).length;
    const ids = uniquePositiveIds(input.cardIds);
    const endpoint = ["top", "bottom"].includes(input.endpoint) ? input.endpoint : "random";
    const source = normalizeSource(input.source || sourceOf("deck-consume", "server-protocol"), now);
    const previous = state.deck.count;
    const unknownCount = Math.max(0, count - ids.length);
    const opposite = endpoint === "top" ? "bottom" : endpoint === "bottom" ? "top" : null;
    const protectedIds = opposite && previous != null && count <= previous - state.deck[opposite].length
      ? state.deck[opposite].slice()
      : [];
    if (previous != null && endpoint !== "random") {
      for (const fact of Object.values(state.deck.knownRanks)) {
        const survives = endpoint === "top"
          ? fact.rank > count
          : fact.rank <= previous - count;
        if (survives && !protectedIds.includes(fact.cardId)) protectedIds.push(fact.cardId);
      }
    }

    if (endpoint !== "random") {
      consumeKnownEndpoint(endpoint, ids, count, source);
    } else {
      removeIdsFromEndpoints(ids);
      if (count > ids.length) clearDeckOrder("unknown-random-deck-consumption", source);
    }

    for (const id of ids) removeExactCardFromZone(id, ZONE.DECK, { source });
    if (unknownCount > 0) {
      demoteUnknownDeckRemoval({
        count: unknownCount,
        predicate: input.predicate,
        protectedIds,
        source
      });
    }
    updateRanksAfterDeckRemoval(endpoint, count, previous);
    if (previous != null) {
      if (count > previous) {
        contradiction("deck-consume-exceeds-count", { previous, count, cardIds: ids, endpoint, source });
        state.deck.count = 0;
      } else {
        state.deck.count = previous - count;
      }
    }
    state.updatedAt = now();
    syncDeckZone(source);
    recordEvent("deck.consume", {
      previous,
      count: state.deck.count,
      consumedCount: count,
      cardIds: ids,
      unknownCount,
      endpoint,
      reason: input.reason || "deck-consume",
      source
    });
  }

  function consumeKnownEndpoint(endpoint, ids, count, source) {
    const known = state.deck[endpoint];
    if (!known.length) return;
    const compareCount = Math.min(known.length, ids.length, count);
    for (let index = 0; index < compareCount; index++) {
      if (known[index] !== ids[index]) {
        contradiction("known-deck-endpoint-mismatch", {
          endpoint,
          expected: known.slice(0, compareCount),
          observed: ids.slice(0, compareCount),
          source
        });
        state.deck[endpoint] = [];
        state.deck[`${endpoint}Source`] = null;
        return;
      }
    }
    state.deck[endpoint] = known.slice(Math.min(count, known.length));
    if (!state.deck[endpoint].length) state.deck[`${endpoint}Source`] = null;
    removeIdsFromEndpoints(ids);
  }

  function resolveKnownEndpointIds(endpoint, observedIds, count) {
    const observed = uniquePositiveIds(observedIds);
    const known = state.deck[endpoint] || [];
    if (!known.length || observed.length >= count) return observed;
    const comparable = Math.min(observed.length, known.length, count);
    for (let index = 0; index < comparable; index++) {
      if (observed[index] !== known[index]) return observed;
    }
    const resolved = observed.slice();
    for (let index = observed.length; index < Math.min(count, known.length); index++) {
      if (!resolved.includes(known[index])) resolved.push(known[index]);
    }
    return resolved;
  }

  function resolveKnownSourceIds(zoneKey, observedIds, count) {
    const observed = uniquePositiveIds(observedIds);
    if (!zoneKey || observed.length >= count) return observed;
    const zone = state.zones[zoneKey];
    if (!zone) return observed;
    const candidates = zone.exactIds.filter((id) => !observed.includes(id));
    const entireZoneMoves =
      zone.complete === true &&
      Number(zone.count) === count &&
      zone.exactIds.length === count;
    const uniqueSourceCard = Number(zone.count) === 1 && count === 1 && zone.exactIds.length === 1;
    if (!entireZoneMoves && !uniqueSourceCard) return observed;
    return uniquePositiveIds([...observed, ...candidates]).slice(0, count);
  }

  function removeFromZone(zoneKey, ids, count, source, context = {}) {
    if (!zoneKey) return;
    if (zoneKey === ZONE.DISCARD) {
      removeFromDiscard(ids, count, source);
      return;
    }
    const zone = ensureZone(zoneKey);
    if (ids.length) {
      for (const id of ids) removeExactCardFromZone(id, zoneKey, { source });
    }
    if (count > ids.length) {
      zone.complete = false;
      for (const id of zone.exactIds.slice()) {
        if (state.locations[id]?.zoneKey === zoneKey) {
          removeExactCardFromZone(id, zoneKey, {
            source,
            reason: "partially-identified-zone-removal"
          });
        }
      }
      zone.exactIds = [];
    }
    if (zone.count != null) zone.count = Math.max(0, zone.count - count);
    zone.source = source;
    zone.updatedAt = now();
    syncHandFromZone(zoneKey, context, "move-source");
  }

  function addToZone(zoneKey, ids, count, source, context = {}) {
    if (!zoneKey) return;
    if (zoneKey === ZONE.DISCARD) {
      addToDiscard(ids, count, source, context);
      return;
    }
    const zone = ensureZone(zoneKey);
    for (const id of ids) placeExactCard(id, zoneKey, source, { silent: true });
    zone.count = (zone.count == null ? 0 : zone.count) + count;
    if (count > ids.length) zone.complete = false;
    zone.source = source;
    zone.updatedAt = now();
    syncHandFromZone(zoneKey, context, "move-destination");
  }

  function addToDiscard(ids, count, source, context) {
    const zone = ensureZone(ZONE.DISCARD);
    for (const id of ids) {
      placeExactCard(id, ZONE.DISCARD, source, { silent: true });
      if (!state.discard.exactIds.includes(id)) state.discard.exactIds.push(id);
      const entry = {
        index: state.nextDiscardEntryIndex++,
        cardId: id,
        epoch: state.epoch,
        turn: context.turn,
        round: context.round,
        phase: context.phase,
        causalEventId: stringOrNull(context.causalEventId),
        movementReason: normalizeMovementReason(context.movementReason),
        moveType: finiteNumber(context.moveType),
        reasonTags: uniqueStrings(asList(context.reasonTags)),
        skillId: finiteInteger(context.skillId, 0) || null,
        protocol: String(context.protocol || ""),
        enteredAt: now(),
        source
      };
      state.discard.entries.push(entry);
      state.discardHistory.push({ ...entry });
    }
    state.discard.count += count;
    state.discard.unknownCount += Math.max(0, count - ids.length);
    if (count > ids.length) state.discard.complete = false;
    state.discard.updatedAt = now();
    zone.count = state.discard.count;
    zone.exactIds = state.discard.exactIds.slice();
    zone.complete = state.discard.complete;
    zone.source = source;
    zone.updatedAt = now();
  }

  function removeFromDiscard(ids, count, source) {
    const zone = ensureZone(ZONE.DISCARD);
    if (ids.length) {
      const remove = new Set(ids);
      for (const id of ids) removeExactCardFromZone(id, ZONE.DISCARD, { source });
      state.discard.exactIds = state.discard.exactIds.filter((id) => !remove.has(id));
      state.discard.entries = state.discard.entries.filter((entry) => !remove.has(entry.cardId));
    }
    if (count > ids.length) {
      for (const id of state.discard.exactIds.slice()) {
        if (state.locations[id]?.zoneKey === ZONE.DISCARD) {
          removeExactCardFromZone(id, ZONE.DISCARD, {
            source,
            reason: "partially-identified-discard-removal"
          });
        }
      }
      state.discard.exactIds = [];
      state.discard.entries = [];
      state.discard.complete = false;
    }
    state.discard.count = Math.max(0, state.discard.count - count);
    state.discard.unknownCount = Math.max(0, state.discard.count - state.discard.exactIds.length);
    state.discard.updatedAt = now();
    zone.count = state.discard.count;
    zone.exactIds = state.discard.exactIds.slice();
    zone.complete = state.discard.complete;
    zone.source = source;
    zone.updatedAt = now();
  }

  function placeExactCard(id, zoneKey, source, options = {}) {
    const cardId = finiteInteger(id, 0);
    if (cardId <= 0 || !zoneKey) return;
    resolveLocationGroupCard(cardId, zoneKey, source, "exact-location-observed");
    registerDynamicIds([cardId]);
    const previous = state.locations[cardId] || null;
    if (previous?.zoneKey && previous.zoneKey !== zoneKey) {
      removeExactCardFromZone(cardId, previous.zoneKey, {
        decrementCount: true,
        source,
        toZoneKey: zoneKey,
        reason: "card-entered-another-zone"
      });
    }
    const zone = ensureZone(zoneKey);
    if (!zone.exactIds.includes(cardId)) zone.exactIds.push(cardId);
    const normalizedSource = normalizeSource(source, now);
    const sameResidence = previous?.zoneKey === zoneKey;
    state.locations[cardId] = sameResidence
      ? {
          ...previous,
          source: normalizedSource,
          observedAt: now()
        }
      : {
          residenceId: state.nextResidenceIndex++,
          cardId,
          physicalGeneration: physicalCardGeneration(cardId),
          zoneKey,
          previousZoneKey: previous?.zoneKey || null,
          enteredAt: now(),
          enteredEventIndex: state.nextEventIndex,
          source: normalizedSource,
          observedAt: now()
        };
    if (!options.silent) recordEvent("card.location", { cardId, zoneKey, previousZoneKey: previous?.zoneKey || null, source: normalizedSource });
  }

  function removeExactCardFromZone(id, zoneKey, options = {}) {
    const cardId = finiteInteger(id, 0);
    const zone = state.zones[zoneKey];
    const existed = zone?.exactIds?.includes(cardId) === true;
    const currentResidence = state.locations[cardId]?.zoneKey === zoneKey
      ? state.locations[cardId]
      : null;
    if (existed) {
      expireEquipmentProjectionsForCardMove(cardId, zoneKey, options.source || zone?.source);
      expireRuleModifiersForCardMove(cardId, zoneKey);
      expireScheduledEffectsForCardMove(cardId, zoneKey);
      invalidateCardViews(cardId, "card-moved", options.source || zone?.source, (row) =>
        row.expiresOnMove !== false && (!row.whileZone || row.whileZone === zoneKey)
      );
      for (const [tag, row] of Object.entries(state.cardTags[cardId] || {})) {
        if (row.expiresOnMove === true && (!row.whileZone || row.whileZone === zoneKey)) {
          expireCardTag(cardId, tag, options.reason || "card-moved", options.source || zone?.source);
        }
      }
    }
    if (zone) {
      zone.exactIds = zone.exactIds.filter((value) => value !== cardId);
      if (zone.cardStates) delete zone.cardStates[cardId];
      if (existed && options.decrementCount === true && zone.count != null) {
        zone.count = Math.max(0, zone.count - 1);
      }
    }
    if (currentResidence) {
      state.locationHistory.push({
        ...cloneJson(currentResidence),
        leftAt: now(),
        leftEventIndex: state.nextEventIndex,
        toZoneKey: normalizeZoneKey(options.toZoneKey) || null,
        leaveReason: String(options.reason || "card-left-zone"),
        leaveSource: normalizeSource(options.source || zone?.source || sourceOf("card-left-zone", "rule-feedback"), now)
      });
      delete state.locations[cardId];
    }
    if (!existed || options.decrementCount !== true) return;
    if (zoneKey === ZONE.DECK && state.deck.count != null) {
      state.deck.count = Math.max(0, state.deck.count - 1);
      removeIdsFromEndpoints([cardId]);
      syncDeckZone(zone?.source || null);
    } else if (zoneKey === ZONE.DISCARD) {
      state.discard.exactIds = state.discard.exactIds.filter((value) => value !== cardId);
      state.discard.entries = state.discard.entries.filter((entry) => entry.cardId !== cardId);
      state.discard.count = Math.max(0, state.discard.count - 1);
      state.discard.unknownCount = Math.min(state.discard.unknownCount, state.discard.count);
      state.discard.updatedAt = now();
      if (zone) {
        zone.count = state.discard.count;
        zone.complete = state.discard.complete;
        zone.updatedAt = state.discard.updatedAt;
      }
    } else {
      syncHandFromZone(zoneKey);
    }
  }

  function candidateWeights(population = candidatePopulation(), partition = locationGroupDeckPartition(population)) {
    const weights = new Map();
    const deckCount = state.deck.count;
    if (!partition.available) return weights;
    if (deckCount == null) {
      const candidates = [...population.exactDeckIds, ...population.unresolvedIds];
      const weight = candidates.length ? 1 / candidates.length : 0;
      for (const id of candidates) weights.set(id, weight);
      return weights;
    }
    if (deckCount <= 0) return weights;
    for (const id of population.exactDeckIds) weights.set(id, 1 / deckCount);
    for (const group of partition.groups) {
      const weight = group.cardIds.length ? group.deckSlots / group.cardIds.length / deckCount : 0;
      for (const id of group.cardIds) weights.set(id, weight);
    }
    const freeWeight = partition.freeIds.length
      ? partition.freeSlots / partition.freeIds.length / deckCount
      : 0;
    for (const id of partition.freeIds) weights.set(id, freeWeight);
    return new Map(Array.from(weights.entries()).filter(([, weight]) => weight > 0));
  }

  function locationGroupDeckPartition(population = candidatePopulation()) {
    const unresolved = new Set(population.unresolvedIds);
    const grouped = new Set();
    const groups = [];
    let reservedDeckSlots = 0;
    for (const row of Object.values(state.locationGroups)) {
      const touchesDeck = row.zoneKeys.includes(ZONE.DECK) || (row.zoneCounts?.[ZONE.DECK] || 0) > 0;
      const touchesShuffle = row.zoneKeys.includes(ZONE.SHUFFLE) || (row.zoneCounts?.[ZONE.SHUFFLE] || 0) > 0;
      if (!touchesDeck && !touchesShuffle) continue;
      if (state.deck.count == null) {
        return locationGroupPartitionFailure("deck-count-unknown-with-location-group", row, groups);
      }
      if (touchesShuffle) {
        return locationGroupPartitionFailure("shuffle-membership-location-group-unsettled", row, groups);
      }
      if (!row.zoneCounts || row.zoneCounts[ZONE.DECK] == null) {
        return locationGroupPartitionFailure("location-group-deck-count-unknown", row, groups);
      }
      if (row.selectionModel !== "uniform") {
        return locationGroupPartitionFailure("location-group-membership-distribution-unknown", row, groups);
      }
      const cardIds = row.cardIds.filter((cardId) => unresolved.has(cardId));
      if (cardIds.length !== row.cardIds.length) {
        return locationGroupPartitionFailure("location-group-member-not-unresolved", row, groups);
      }
      if (cardIds.some((cardId) => grouped.has(cardId))) {
        return locationGroupPartitionFailure("overlapping-location-groups-not-supported", row, groups);
      }
      const deckSlots = nonNegativeIntegerOrNull(row.zoneCounts[ZONE.DECK]);
      if (deckSlots == null || deckSlots > cardIds.length) {
        return locationGroupPartitionFailure("location-group-deck-count-invalid", row, groups);
      }
      for (const cardId of cardIds) grouped.add(cardId);
      reservedDeckSlots += deckSlots;
      groups.push({
        key: row.key,
        cardIds,
        deckSlots,
        zoneKeys: row.zoneKeys.slice(),
        zoneCounts: cloneJson(row.zoneCounts),
        selectionModel: row.selectionModel
      });
    }
    const freeIds = population.unresolvedIds.filter((cardId) => !grouped.has(cardId));
    const freeSlots = population.remainingSlots - reservedDeckSlots;
    if (freeSlots < 0 || freeSlots > freeIds.length) {
      return {
        available: false,
        reason: "location-group-deck-capacity-inconsistent",
        groups,
        freeIds,
        freeSlots,
        reservedDeckSlots,
        remainingSlots: population.remainingSlots
      };
    }
    return { available: true, reason: "", groups, freeIds, freeSlots, reservedDeckSlots };
  }

  function locationGroupPartitionFailure(reason, row, groups) {
    return {
      available: false,
      reason,
      group: {
        key: row.key,
        cardIds: row.cardIds.slice(),
        zoneKeys: row.zoneKeys.slice(),
        zoneCounts: cloneJson(row.zoneCounts),
        selectionModel: row.selectionModel
      },
      groups
    };
  }

  function candidatePopulation() {
    const activeIds = activeCandidateIds();
    const exactDeck = new Set([...state.deck.top, ...state.deck.bottom]);
    for (const id of activeIds) {
      if (state.locations[id]?.zoneKey === ZONE.DECK) exactDeck.add(id);
    }
    const exactDeckIds = Array.from(exactDeck).filter((id) => activeIds.includes(id) && !state.deck.excludedIds[id]);
    const unresolvedIds = activeIds.filter((id) => {
      if (exactDeck.has(id)) return false;
      if (state.deck.excludedIds[id]) return false;
      return !isKnownOutsideDeck(id);
    });
    const remainingSlots = state.deck.count == null
      ? unresolvedIds.length
      : Math.max(0, state.deck.count - exactDeckIds.length);
    if (state.deck.count != null && exactDeckIds.length > state.deck.count) {
      contradiction("known-deck-membership-exceeds-count", {
        deckCount: state.deck.count,
        exactDeckIds
      });
    }
    const capacityDeficit = Math.max(0, remainingSlots - unresolvedIds.length);
    return {
      exactDeckIds,
      unresolvedIds,
      remainingSlots,
      capacityConsistent: capacityDeficit === 0,
      capacityDeficit
    };
  }

  function activeCandidateIds() {
    const ids = state.deck.definition.known
      ? uniquePositiveIds([...state.deck.definition.cardIds, ...state.deck.dynamicIds])
      : state.deck.dynamicIds.slice();
    return ids.filter((id) => state.physicalCardLifecycles[id]?.terminal !== true);
  }

  function isExactKnownInDeck(id) {
    return state.locations[id]?.zoneKey === ZONE.DECK || state.deck.top.includes(id) || state.deck.bottom.includes(id);
  }

  function isKnownOutsideDeck(id) {
    const zoneKey = state.locations[id]?.zoneKey;
    if (zoneKey) return zoneKey !== ZONE.DECK && zoneKey !== ZONE.SHUFFLE;
    return Object.values(state.locationGroups).some((row) =>
      row.active &&
      row.cardIds.includes(id) &&
      row.zoneKeys.length > 0 &&
      row.zoneKeys.every((value) => value !== ZONE.DECK && value !== ZONE.SHUFFLE)
    );
  }

  function probabilityResult(input) {
    const weights = input.weights;
    const cards = input.cards;
    const distributions = {
      number: distribution(weights, "number"),
      suit: distribution(weights, "suit"),
      type: distribution(weights, "type"),
      color: distribution(weights, "color"),
      name: distribution(weights, "name")
    };
    const weightedCards = Array.from(weights.entries())
      .map(([id, probability]) => ({ id, probability, card: normalizedCardForId(id) }))
      .sort((a, b) => b.probability - a.probability || a.id - b.id);
    return {
      available: weightedCards.length > 0,
      exact: input.exact === true,
      endpoint: input.endpoint,
      reason: weightedCards.length ? "" : "no-candidates",
      physicalDeckCount: input.physicalDeckCount,
      candidateCount: weightedCards.length,
      assumption: input.assumption,
      locationGroups: cloneJson(input.locationGroups || []),
      cards: weightedCards,
      distributions
    };

    function distribution(weightMap, field) {
      const map = new Map();
      for (const [id, probability] of weightMap.entries()) {
        const value = cardAttribute(normalizedCardForId(id), field);
        if (value == null || value === "") continue;
        const key = String(value);
        const current = map.get(key) || { value, probability: 0, cardCount: 0 };
        current.probability += probability;
        current.cardCount++;
        map.set(key, current);
      }
      return Array.from(map.values()).sort((a, b) => b.probability - a.probability || String(a.value).localeCompare(String(b.value)));
    }
  }

  function normalizedCardForId(id) {
    return normalizeCard({ ...(state.catalog[id] || {}), id });
  }

  function clearDeckOrder(reason, source) {
    const hadKnown = state.deck.top.length > 0 || state.deck.bottom.length > 0 || Object.keys(state.deck.knownRanks).length > 0;
    state.deck.top = [];
    state.deck.bottom = [];
    state.deck.topSource = null;
    state.deck.bottomSource = null;
    state.deck.knownRanks = {};
    if (hadKnown) recordEvent("deck.order.clear", { reason, source: normalizeSource(source, now) });
  }

  function setKnownRank(rankValue, cardIdValue, source) {
    const rank = positiveIntegerOrNull(rankValue);
    const cardId = finiteInteger(cardIdValue, 0);
    if (rank == null || cardId <= 0) return false;
    const normalizedSource = normalizeSource(source || sourceOf("deck-rank", "rule-feedback"), now);
    const existing = state.deck.knownRanks[rank];
    if (existing && existing.cardId !== cardId) {
      contradiction("deck-rank-conflict", { rank, expected: existing.cardId, observed: cardId, sources: [existing.source, normalizedSource] });
      return false;
    }
    for (const [otherRank, fact] of Object.entries(state.deck.knownRanks)) {
      if (Number(otherRank) !== rank && fact.cardId === cardId) {
        contradiction("deck-card-claimed-at-multiple-ranks", { cardId, ranks: [Number(otherRank), rank], source: normalizedSource });
        return false;
      }
    }
    state.deck.knownRanks[rank] = { rank, cardId, source: normalizedSource };
    return true;
  }

  function rebuildEndpointsFromKnownRanks(source = null) {
    const top = [];
    for (let rank = 1; state.deck.knownRanks[rank]; rank++) {
      top.push(state.deck.knownRanks[rank].cardId);
    }
    const bottom = [];
    if (state.deck.count != null) {
      for (let rank = state.deck.count; rank >= 1 && state.deck.knownRanks[rank]; rank--) {
        bottom.push(state.deck.knownRanks[rank].cardId);
      }
    }
    state.deck.top = top;
    state.deck.bottom = bottom;
    state.deck.topSource = top.length ? normalizeSource(source || sourceOf("deck-ranks", "rule-feedback"), now) : null;
    state.deck.bottomSource = bottom.length ? normalizeSource(source || sourceOf("deck-ranks", "rule-feedback"), now) : null;
    validateDeckEndpoints();
  }

  function updateRanksAfterDeckRemoval(endpoint, count, previousCount) {
    if (!Object.keys(state.deck.knownRanks).length) return;
    if (endpoint === "random" || previousCount == null) {
      state.deck.knownRanks = {};
      return;
    }
    const next = {};
    if (endpoint === "top") {
      for (const fact of Object.values(state.deck.knownRanks)) {
        if (fact.rank <= count) continue;
        next[fact.rank - count] = { ...fact, rank: fact.rank - count };
      }
    } else {
      const remainingCount = Math.max(0, previousCount - count);
      for (const fact of Object.values(state.deck.knownRanks)) {
        if (fact.rank <= remainingCount) next[fact.rank] = fact;
      }
    }
    state.deck.knownRanks = next;
  }

  function knownCardAtDeckRank(rankValue) {
    const rank = positiveInteger(rankValue, 0);
    if (rank <= 0) return null;
    const sparse = state.deck.knownRanks[rank]?.cardId;
    if (sparse) return sparse;
    if (rank <= state.deck.top.length) return state.deck.top[rank - 1] || null;
    if (state.deck.count != null) {
      const bottomIndex = state.deck.count - rank;
      if (bottomIndex >= 0 && bottomIndex < state.deck.bottom.length) return state.deck.bottom[bottomIndex] || null;
    }
    return null;
  }

  function knownDeckRankOf(cardIdValue) {
    const cardId = finiteInteger(cardIdValue, 0);
    if (cardId <= 0 || state.deck.count == null) return null;
    const sparse = Object.values(state.deck.knownRanks).find((fact) => fact.cardId === cardId);
    if (sparse) return sparse.rank;
    const topIndex = state.deck.top.indexOf(cardId);
    if (topIndex >= 0) return topIndex + 1;
    const bottomIndex = state.deck.bottom.indexOf(cardId);
    if (bottomIndex >= 0) return state.deck.count - bottomIndex;
    return null;
  }

  function updateRanksAfterDeckInsertion(endpoint, count, ids, previousCount, source) {
    if (count <= 0) return;
    if (endpoint === "random" || count > ids.length || previousCount == null) {
      state.deck.knownRanks = {};
      return;
    }
    if (endpoint === "top") {
      const shifted = {};
      for (const fact of Object.values(state.deck.knownRanks)) {
        shifted[fact.rank + count] = { ...fact, rank: fact.rank + count };
      }
      state.deck.knownRanks = shifted;
      ids.forEach((id, index) => setKnownRank(index + 1, id, source));
    } else if (state.deck.count != null) {
      ids.forEach((id, index) => setKnownRank(state.deck.count - index, id, source));
    }
  }

  function demoteUnknownDeckRemoval(input = {}) {
    if (!(Number(input.count) > 0)) return [];
    const predicate = normalizePredicate(input.predicate);
    const protectedIds = new Set(uniquePositiveIds(input.protectedIds));
    const deckZone = ensureZone(ZONE.DECK);
    const executable = predicateIsExecutable(predicate);
    const demoted = deckZone.exactIds.filter((id) =>
      !protectedIds.has(id) && (!executable || matchesPredicate(state.catalog[id], predicate, id))
    );
    for (const id of demoted) removeExactCardFromZone(id, ZONE.DECK, { source: input.source });
    removeIdsFromEndpoints(demoted);
    if (demoted.length) {
      recordEvent("deck.membership.demoted", {
        count: Number(input.count),
        predicate,
        predicateExecutable: executable,
        cardIds: demoted,
        protectedIds: Array.from(protectedIds),
        source: normalizeSource(input.source || sourceOf("unknown-deck-removal", "rule-feedback"), now)
      });
    }
    return demoted;
  }

  function registerDynamicIds(ids) {
    const defined = new Set(state.deck.definition.cardIds);
    state.deck.dynamicIds = uniquePositiveIds([
      ...state.deck.dynamicIds,
      ...uniquePositiveIds(ids).filter((id) => !defined.has(id))
    ]);
  }

  function syncDeckZone(source = null) {
    const zone = ensureZone(ZONE.DECK);
    zone.count = state.deck.count;
    zone.complete = state.deck.count != null && zone.exactIds.length === state.deck.count;
    zone.source = source ? normalizeSource(source, now) : state.deck.countSource;
    zone.updatedAt = now();
  }

  function physicalWorldSummary() {
    const activeIds = activeCandidateIds();
    const allPhysicalIds = state.deck.definition.known
      ? uniquePositiveIds([...state.deck.definition.cardIds, ...state.deck.dynamicIds])
      : state.deck.dynamicIds.slice();
    const terminalIds = allPhysicalIds.filter((id) => state.physicalCardLifecycles[id]?.terminal === true);
    const zoneCounts = {};
    let allocatedCount = state.deck.count == null ? 0 : state.deck.count;
    for (const [zoneKey, zone] of Object.entries(state.zones)) {
      if (zoneKey === ZONE.DECK) continue;
      if (zone.zoneKind === "terminal-card-zone") continue;
      const count = nonNegativeIntegerOrNull(zone.count);
      if (count == null) continue;
      zoneCounts[zoneKey] = count;
      allocatedCount += count;
    }
    const activePhysicalCount = activeIds.length;
    return {
      activePhysicalCount,
      totalPhysicalIdentityCount: allPhysicalIds.length,
      terminalPhysicalCount: terminalIds.length,
      terminalCardIds: terminalIds,
      baselineDefinitionCount: state.deck.definition.cardIds.length,
      dynamicCount: state.deck.dynamicIds.length,
      deckCount: state.deck.count,
      zoneCounts,
      allocatedCount,
      unassignedCount: Math.max(0, activePhysicalCount - allocatedCount),
      overAllocatedCount: Math.max(0, allocatedCount - activePhysicalCount),
      consistent: allocatedCount <= activePhysicalCount
    };
  }

  function validatePhysicalWorld() {
    if (!state.deck.definition.known) return;
    const summary = physicalWorldSummary();
    if (summary.consistent) {
      state.lastPhysicalInvariantSignature = "";
      return;
    }
    const signature = JSON.stringify([summary.activePhysicalCount, summary.allocatedCount, summary.zoneCounts]);
    if (signature === state.lastPhysicalInvariantSignature) return;
    state.lastPhysicalInvariantSignature = signature;
    contradiction("physical-card-count-over-allocated", summary);
  }

  function completeStagedRecycle(source, detail = {}) {
    const pending = state.pendingRecycle;
    if (!pending && detail.direct !== true) return false;
    state.epoch++;
    state.deck.recycleCount++;
    state.deck.countSource = normalizeSource(source, now);
    state.deck.excludedIds = {};
    state.deck.constraints = [];
    state.pendingRecycle = null;
    reconcileLocationGroupsAfterZoneObservation(ZONE.DISCARD, true, source);
    reconcileLocationGroupsAfterZoneObservation(ZONE.SHUFFLE, true, source);
    syncDeckZone(source);
    recordEvent("deck.recycle", {
      epoch: state.epoch,
      previousDeckCount: 0,
      discardCount: pending?.discardCount ?? detail.discardCount ?? detail.count ?? 0,
      exactMovedIds: pending?.exactIds || detail.cardIds || [],
      count: state.deck.count,
      reason: detail.direct ? "protocol-direct-discard-recycle" : "protocol-zone9-recycle",
      source: normalizeSource(source, now)
    });
    return true;
  }

  function removeIdsFromEndpoints(ids) {
    const remove = new Set(uniquePositiveIds(ids));
    if (!remove.size) return;
    state.deck.top = state.deck.top.filter((id) => !remove.has(id));
    state.deck.bottom = state.deck.bottom.filter((id) => !remove.has(id));
    for (const [rank, fact] of Object.entries(state.deck.knownRanks)) {
      if (remove.has(fact.cardId)) delete state.deck.knownRanks[rank];
    }
    if (!state.deck.top.length) state.deck.topSource = null;
    if (!state.deck.bottom.length) state.deck.bottomSource = null;
  }

  function validateDeckEndpoints() {
    const count = nonNegativeIntegerOrNull(state.deck.count);
    if (count == null) return;
    const positions = new Map();
    const idPositions = new Map();
    const claims = [
      ...state.deck.top.map((id, index) => ({ id, position: index, endpoint: "top" })),
      ...state.deck.bottom.map((id, index) => ({ id, position: count - 1 - index, endpoint: "bottom" }))
    ];
    for (const claim of claims) {
      if (claim.position < 0 || claim.position >= count) {
        contradiction("deck-endpoint-position-out-of-range", { claim, deckCount: count });
        continue;
      }
      const atPosition = positions.get(claim.position);
      if (atPosition && atPosition.id !== claim.id) {
        contradiction("deck-endpoints-disagree-at-position", { position: claim.position, claims: [atPosition, claim], deckCount: count });
      } else {
        positions.set(claim.position, claim);
      }
      const priorPosition = idPositions.get(claim.id);
      if (priorPosition != null && priorPosition !== claim.position) {
        contradiction("deck-card-claimed-at-multiple-positions", { cardId: claim.id, positions: [priorPosition, claim.position], deckCount: count });
      } else {
        idPositions.set(claim.id, claim.position);
      }
    }
  }

  function syncSpecialZone(zoneKey, options = {}) {
    const zone = state.zones[zoneKey];
    if (zoneKey === ZONE.DISCARD && zone) {
      state.discard.count = zone.count ?? zone.exactIds.length;
      state.discard.exactIds = zone.exactIds.slice();
      state.discard.unknownCount = Math.max(0, state.discard.count - state.discard.exactIds.length);
      state.discard.complete = zone.complete;
      state.discard.updatedAt = zone.updatedAt;
    }
    syncHandFromZone(
      zoneKey,
      options.context || {},
      options.reason || "zone-observation",
      options
    );
  }

  function syncHandFromZone(zoneKey, context = {}, reason = "hand-zone-sync", options = {}) {
    const match = /^hand:(\d+)$/.exec(zoneKey || "");
    if (!match) return;
    const seatIndex = Number(match[1]);
    const zone = ensureZone(zoneKey);
    const hand = ensureHand(seatIndex);
    const before = compactHand(hand);
    const nextCount = zone.count ?? zone.exactIds.length;
    const nextExactIds = zone.exactIds.slice();
    const nextVisibility = String(zone.visibility || hand.visibility || "unknown");
    const countChanged = hand.count !== nextCount;
    const exactIdsChanged =
      hand.exactIds.length !== nextExactIds.length ||
      hand.exactIds.some((cardId) => !nextExactIds.includes(cardId));
    const completeChanged = hand.complete !== zone.complete;
    const visibilityChanged = hand.visibility !== nextVisibility;
    const knowledgeChanged = countChanged || exactIdsChanged || completeChanged || visibilityChanged;
    const membershipChanged =
      options.forceGeneration === true ||
      options.membershipChanged === true ||
      countChanged ||
      (exactIdsChanged && options.knowledgeOnly !== true && options.membershipChanged !== false);
    if (membershipChanged) invalidateHandConstraints(hand, "hand-membership-changed", zone.source);
    hand.count = nextCount;
    hand.exactIds = nextExactIds;
    hand.unknownCount = Math.max(0, hand.count - hand.exactIds.length);
    hand.complete = zone.complete;
    hand.visibility = nextVisibility;
    hand.source = zone.source;
    hand.updatedAt = zone.updatedAt;
    const after = compactHand(hand);
    if (membershipChanged) appendHandTransition(before, after, {
      ...context,
      knowledgeEquivalent: !knowledgeChanged
    }, reason, zone.source);
    if (knowledgeChanged) {
      appendHandKnowledgeRevision(before, after, context, reason, zone.source, {
        membershipChanged,
        knowledgeOnly: options.knowledgeOnly === true,
        countChanged,
        exactIdsChanged,
        completeChanged,
        visibilityChanged
      });
      if (!membershipChanged) {
        validateActiveHandConstraints(hand, zone.source, "knowledge-refined");
        refreshBooleanConstraintsForHandKnowledge(hand.seatIndex, hand.generation, "hand-knowledge-refined", zone.source);
      }
    }
  }

  function appendHandKnowledgeRevision(before, after, context = {}, reason = "hand-knowledge-sync", source = null, detail = {}) {
    const row = {
      index: state.nextHandKnowledgeHistoryIndex++,
      seatIndex: after.seatIndex,
      before,
      after,
      addedExactIds: after.exactIds.filter((cardId) => !before.exactIds.includes(cardId)),
      removedExactIds: before.exactIds.filter((cardId) => !after.exactIds.includes(cardId)),
      membershipChanged: detail.membershipChanged === true,
      knowledgeOnly: detail.knowledgeOnly === true,
      countChanged: detail.countChanged === true,
      exactIdsChanged: detail.exactIdsChanged === true,
      completeChanged: detail.completeChanged === true,
      visibilityChanged: detail.visibilityChanged === true,
      reason: String(reason || "hand-knowledge-sync"),
      causalEventId: stringOrNull(context?.causalEventId),
      atomicOperationId: stringOrNull(context?.atomicOperationId),
      context: mergeTurnContext(state.context, context),
      source: normalizeSource(source || sourceOf("hand-knowledge-revision", "rule-feedback"), now),
      eventIndex: state.nextEventIndex,
      time: now()
    };
    state.handKnowledgeHistory.push(row);
    if (state.handKnowledgeHistory.length > maxEvents) {
      state.handKnowledgeHistory.splice(0, state.handKnowledgeHistory.length - maxEvents);
    }
    recordEvent("hand.knowledge", {
      index: row.index,
      seatIndex: row.seatIndex,
      addedExactIds: row.addedExactIds,
      removedExactIds: row.removedExactIds,
      membershipChanged: row.membershipChanged,
      knowledgeOnly: row.knowledgeOnly,
      reason: row.reason,
      source: row.source
    });
    return row;
  }

  function handKnowledgeChanges(input = {}) {
    const seatIndex = finiteInteger(input.seatIndex, -1);
    const causalEventId = String(input.causalEventId || input.eventId || "").trim();
    const sinceEventIndex = nonNegativeIntegerOrNull(input.sinceEventIndex);
    return state.handKnowledgeHistory.filter((row) => {
      if (seatIndex >= 0 && row.seatIndex !== seatIndex) return false;
      if (causalEventId && row.causalEventId !== causalEventId) return false;
      if (sinceEventIndex != null && row.eventIndex < sinceEventIndex) return false;
      if (input.knowledgeOnly === true && row.knowledgeOnly !== true) return false;
      if (input.membershipChanged === true && row.membershipChanged !== true) return false;
      return true;
    }).map(cloneJson);
  }

  function appendHandTransition(before, after, context = {}, reason = "hand-zone-sync", source = null) {
    const row = {
      index: state.nextHandHistoryIndex++,
      seatIndex: after.seatIndex,
      before,
      after,
      delta: Number(after.count || 0) - Number(before.count || 0),
      lostLastHand: Number(before.count || 0) > 0 && Number(after.count || 0) === 0,
      gainedFirstHand: Number(before.count || 0) === 0 && Number(after.count || 0) > 0,
      generationBefore: before.generation,
      generationAfter: after.generation,
      reason: String(reason || "hand-zone-sync"),
      causalEventId: stringOrNull(context?.causalEventId),
      atomicOperationId: stringOrNull(context?.atomicOperationId),
      zoneExchangeIndex: nonNegativeIntegerOrNull(context?.zoneExchangeIndex),
      simultaneous: context?.simultaneous === true,
      contentChanged: context?.contentChanged !== false,
      knowledgeEquivalent: context?.knowledgeEquivalent === true,
      context: mergeTurnContext(state.context, context),
      source: normalizeSource(source || sourceOf("hand-transition", "rule-feedback"), now),
      eventIndex: state.nextEventIndex,
      time: now()
    };
    state.handHistory.push(row);
    recordEvent("hand.transition", {
      index: row.index,
      seatIndex: row.seatIndex,
      delta: row.delta,
      lostLastHand: row.lostLastHand,
      gainedFirstHand: row.gainedFirstHand,
      causalEventId: row.causalEventId,
      atomicOperationId: row.atomicOperationId,
      simultaneous: row.simultaneous,
      reason: row.reason,
      source: row.source
    });
    return row;
  }

  function invalidateHandConstraints(hand, reason, source = null) {
    if (hand) expireBooleanConstraintsForHandGeneration(hand.seatIndex, hand.generation, reason, source);
    if (!hand || !hand.constraints.length) {
      if (hand) hand.generation++;
      return;
    }
    const invalidatedAt = now();
    const ids = hand.constraints.map((row) => row.id);
    for (const row of hand.constraints) {
      const history = state.handConstraintHistory.find((item) => item.id === row.id);
      if (history) {
        history.active = false;
        history.invalidatedAt = invalidatedAt;
        history.invalidationReason = reason;
        history.invalidationSource = normalizeSource(source || sourceOf("hand-change", "rule-feedback"), now);
      }
    }
    hand.constraints = [];
    hand.generation++;
    recordEvent("hand.constraints.invalidated", { seatIndex: hand.seatIndex, generation: hand.generation, constraintIds: ids, reason });
  }

  function invalidateCardViews(cardId, reason, source = null, predicate = () => true) {
    const views = state.cardViews[cardId] || {};
    const rows = Object.values(views).filter(predicate);
    if (!rows.length) return 0;
    const invalidatedAt = now();
    const normalizedSource = normalizeSource(source || sourceOf("card-view-invalidation", "rule-feedback"), now);
    for (const row of rows) {
      delete views[row.id];
      const history = state.cardViewHistory.find((item) => item.id === row.id);
      if (history) {
        history.active = false;
        history.invalidatedAt = invalidatedAt;
        history.invalidationReason = reason;
        history.invalidationSource = normalizedSource;
      }
    }
    if (!Object.keys(views).length) delete state.cardViews[cardId];
    recordEvent("card.attribute-views.invalidated", {
      cardId,
      viewIds: rows.map((row) => row.id),
      reason,
      source: normalizedSource
    });
    return rows.length;
  }

  function expireCardViewsForEvent(eventType, previousContext, currentContext) {
    for (const [cardIdValue, views] of Object.entries(state.cardViews)) {
      const cardId = Number(cardIdValue);
      const expiringIds = Object.values(views).filter((row) => {
        const created = row.createdContext || {};
        const lifecycle = String(row.lifecycle || "view");
        const explicitEvent = row.expireOnEventTypes?.includes(eventType);
        const turnExpired = lifecycle === "turn" && created.turn != null && currentContext.turn != null && created.turn !== currentContext.turn;
        const roundExpired = lifecycle === "round" && created.round != null && currentContext.round != null && created.round !== currentContext.round;
        const phaseExpired = lifecycle === "phase" && created.phase != null && currentContext.phase != null && (
          created.turn !== currentContext.turn || created.round !== currentContext.round || created.phase !== currentContext.phase
        );
        return explicitEvent || turnExpired || roundExpired || phaseExpired || eventType === "game:over";
      }).map((row) => row.id);
      if (!expiringIds.length) continue;
      const idSet = new Set(expiringIds);
      invalidateCardViews(
        cardId,
        eventType === "game:over" ? "game-over" : `${eventType}-or-context-expired`,
        null,
        (row) => idSet.has(row.id)
      );
    }
  }

  function expireCardViewsForChoiceSet(choiceSetKey, reason, source) {
    for (const [cardIdValue, views] of Object.entries(state.cardViews)) {
      if (!Object.values(views).some((row) => row.whileChoiceSetKey === choiceSetKey)) continue;
      invalidateCardViews(Number(cardIdValue), reason, source, (row) => row.whileChoiceSetKey === choiceSetKey);
    }
  }

  function ensureZone(zoneKey) {
    if (!state.zones[zoneKey]) {
      state.zones[zoneKey] = {
        zoneKey,
        zoneKind: "generic-card-zone",
        pileKey: null,
        hostSeat: null,
        hostArea: null,
        hostPlayerKey: null,
        hostAvatarKey: null,
        lifecycleScope: null,
        hostGeneralId: null,
        hostCardId: null,
        attachmentPolicy: null,
        capacity: null,
        controllerSeat: null,
        placedBySeat: null,
        ownerSeat: null,
        ownershipKnown: false,
        skillId: null,
        zoneParam: null,
        ruleIdentityKey: null,
        ordered: false,
        orderKnown: false,
        faceUp: null,
        visibilityAudience: "unknown",
        observerSeats: [],
        cardStates: {},
        metadata: {},
        count: 0,
        exactIds: [],
        complete: true,
        visibility: "unknown",
        source: null,
        updatedAt: now()
      };
    }
    return state.zones[zoneKey];
  }

  function ensureHand(seatIndex) {
    const key = String(seatIndex);
    if (!state.hands[key]) {
      state.hands[key] = {
        seatIndex,
        count: 0,
        exactIds: [],
        unknownCount: 0,
        complete: true,
        generation: 0,
        constraints: [],
        visibility: "unknown",
        source: null,
        updatedAt: now()
      };
    }
    return state.hands[key];
  }

  function recordEvent(type, detail = {}) {
    state.version++;
    state.updatedAt = now();
    state.events.push({ index: state.nextEventIndex++, type, time: state.updatedAt, ...cloneJson(detail) });
    if (state.events.length > maxEvents) state.events.splice(0, state.events.length - maxEvents);
  }

  function contradiction(code, detail = {}) {
    const row = { index: state.nextContradictionIndex++, code, time: now(), ...cloneJson(detail) };
    state.contradictions.push(row);
    if (state.contradictions.length > maxContradictions) {
      state.contradictions.splice(0, state.contradictions.length - maxContradictions);
    }
    return row;
  }

  return {
    state,
    reset,
    setCatalog,
    observePhysicalCardDefinition,
    physicalCardDefinition,
    physicalCardGeneration,
    observePhysicalCardLifecycle,
    destroyPhysicalCard,
    physicalCardLifecycle,
    physicalCardLifecycles,
    configureGame,
    observeGameEvent,
    observeCausalEvent,
    causalEvent,
    queryCausalEvents,
    causalLineage,
    observeCardAction,
    cardAction,
    queryCardActions,
    cardActionMaterials,
    moveCardActionMaterials,
    observeComparison,
    comparison,
    queryComparisons,
    swapComparisonAssignments,
    cardEvents,
    movements,
    observeMovementAttempt,
    resolveMovementAttempt,
    movementAttempts,
    observeJudgementOutcome,
    invertJudgementOutcome,
    judgementOutcome,
    judgementOutcomes,
    observeBooleanConstraint,
    booleanConstraint,
    booleanConstraints,
    queryCurrentDiscard,
    queryCardSources,
    resolveCardSourceResult,
    observePhysicalPile,
    takeFromPhysicalPile,
    putIntoPhysicalPile,
    shufflePhysicalPile,
    physicalPile,
    physicalPileHistory,
    physicalPileNextProbability,
    observeGeneralCardEntity,
    replaceGeneralCardEntity,
    generalCardEntity,
    generalCardEntities,
    observeZoneCapability,
    zoneCapability,
    zoneCapabilities,
    observeEquipmentProjection,
    equipmentProjection,
    equipmentProjections,
    removeEquipmentProjection,
    observeEntityPile,
    moveEntityPile,
    entityPile,
    observeLocationGroup,
    locationGroup,
    activeLocationGroups,
    invalidateLocationGroup,
    cardResidence,
    cardLocationAt,
    cardsContinuouslyInZone,
    updateRuleState,
    ruleState,
    clearRuleState,
    registerRuleModifier,
    activeRuleModifiers,
    removeRuleModifier,
    scheduleEffect,
    scheduledEffects,
    dueScheduledEffects,
    resolveScheduledEffect,
    observeChoiceSet,
    choiceSets,
    resolveChoiceSet,
    choiceSetHistory,
    observeStochasticEvent,
    stochasticEvents,
    resolveStochasticEvent,
    stochasticEventHistory,
    stochasticProbability,
    observeSkillBinding,
    activeSkillBindings,
    removeSkillBinding,
    setDeckDefinition,
    observeDeckCount,
    observeHand,
    observeHandEvidence,
    observeHandConstraint,
    handKnowledge,
    handTransitions,
    handKnowledgeChanges,
    exchangeZones,
    zoneExchanges,
    observeZone,
    observeNamedCardZone,
    rehostNamedCardZone,
    visibleZone,
    namedCardZones,
    observeMove,
    draw,
    recast,
    takeFromDeck,
    takeFromDeckAtRank,
    addToDeck,
    insertAtRank,
    revealDeckEndpoint,
    partitionDeckWindow,
    observeDeckRanks,
    tagCard,
    untagCard,
    cardsWithTag,
    observeEffectiveCardAttributes,
    effectiveCard,
    clearEffectiveCardAttributes,
    observeApparentCardAttributes,
    apparentCard,
    cardAttributeViews,
    clearApparentCardAttributes,
    applyOperation,
    shuffleCurrentDeck,
    recycleDiscard,
    observeSearchResult,
    search,
    segmentedSearch,
    orderedMatchSearch,
    revealUntilResult,
    nextCardProbability,
    searchProbability,
    aggregateSubsetFeasibility,
    discardForTurn,
    remainingDeck,
    explainCard,
    snapshot
  };
}

function makeInitialState(now) {
  const timestamp = now();
  return {
    schemaVersion: SCHEMA_VERSION,
    version: 0,
    initialized: false,
    sessionKey: "",
    resetReason: "",
    epoch: 0,
    context: { turn: null, round: null, phase: null, activeSeat: null, stage: null, gameOver: false },
    createdAt: timestamp,
    updatedAt: timestamp,
    catalog: {},
    catalogSource: null,
    cardDefinitionSources: {},
    cardDefinitionHistory: [],
    physicalCardLifecycles: {},
    physicalCardLifecycleHistory: [],
    deck: {
      definition: { known: false, cardIds: [], source: null, mode: null, ruleId: null, label: "" },
      count: null,
      countSource: null,
      top: [],
      bottom: [],
      topSource: null,
      bottomSource: null,
      knownRanks: {},
      recycleCount: 0,
      shuffleCount: 0,
      dynamicIds: [],
      excludedIds: {},
      constraints: []
    },
    pendingRecycle: null,
    discard: makeDiscardState(now),
    discardHistory: [],
    hands: {},
    handHistory: [],
    handKnowledgeHistory: [],
    handConstraintHistory: [],
    zoneExchangeHistory: [],
    zones: {},
    locations: {},
    locationHistory: [],
    locationGroups: {},
    locationGroupHistory: [],
    cardTags: {},
    cardTagHistory: [],
    cardEventHistory: [],
    movementHistory: [],
    movementAttempts: {},
    movementAttemptHistory: [],
    judgementOutcomes: {},
    judgementOutcomeHistory: [],
    booleanConstraints: {},
    booleanConstraintHistory: [],
    causalEvents: {},
    causalEventHistory: [],
    comparisons: {},
    comparisonHistory: [],
    cardViews: {},
    cardViewHistory: [],
    ruleStates: {},
    ruleStateHistory: [],
    ruleModifiers: {},
    ruleModifierHistory: [],
    scheduledEffects: {},
    scheduledEffectHistory: [],
    choiceSets: {},
    choiceSetHistory: [],
    skillBindings: {},
    skillBindingHistory: [],
    generalCardEntities: {},
    generalCardEntityHistory: [],
    zoneCapabilities: {},
    zoneCapabilityHistory: [],
    equipmentProjections: {},
    equipmentProjectionHistory: [],
    namedZoneHostHistory: [],
    physicalPiles: {},
    physicalPileHistory: [],
    entityPiles: {},
    entityLocations: {},
    entityPileHistory: [],
    contradictions: [],
    events: [],
    nextEventIndex: 0,
    nextCardDefinitionHistoryIndex: 0,
    nextPhysicalCardLifecycleHistoryIndex: 0,
    nextContradictionIndex: 0,
    nextDiscardEntryIndex: 0,
    nextHandConstraintIndex: 0,
    nextHandHistoryIndex: 0,
    nextHandKnowledgeHistoryIndex: 0,
    nextZoneExchangeIndex: 0,
    nextCardViewIndex: 0,
    nextCardTagIndex: 0,
    nextResidenceIndex: 0,
    nextLocationGroupId: 0,
    nextLocationGroupRowId: 0,
    nextLocationGroupHistoryIndex: 0,
    nextCardEventIndex: 0,
    nextMovementIndex: 0,
    nextMovementAttemptId: 0,
    nextMovementAttemptHistoryIndex: 0,
    nextJudgementOutcomeId: 0,
    nextJudgementOutcomeHistoryIndex: 0,
    nextBooleanConstraintId: 0,
    nextBooleanConstraintHistoryIndex: 0,
    nextCausalEventId: 0,
    nextCausalEventHistoryIndex: 0,
    nextComparisonId: 0,
    nextComparisonHistoryIndex: 0,
    nextRuleStateIndex: 0,
    nextRuleStateHistoryIndex: 0,
    nextRuleModifierIndex: 0,
    nextRuleModifierHistoryIndex: 0,
    nextScheduledEffectId: 0,
    nextScheduledEffectHistoryIndex: 0,
    nextChoiceSetId: 0,
    nextChoiceSetHistoryIndex: 0,
    nextSkillBindingIndex: 0,
    nextSkillBindingHistoryIndex: 0,
    nextGeneralCardEntityHistoryIndex: 0,
    nextZoneCapabilityHistoryIndex: 0,
    nextEquipmentProjectionHistoryIndex: 0,
    nextNamedZoneHostHistoryIndex: 0,
    nextPhysicalPileHistoryIndex: 0,
    nextEntityPileHistoryIndex: 0,
    lastPhysicalInvariantSignature: ""
  };
}

function makeDiscardState(now) {
  return {
    count: 0,
    exactIds: [],
    unknownCount: 0,
    complete: true,
    entries: [],
    updatedAt: now()
  };
}

function normalizeCatalog(value) {
  const cards = Array.isArray(value) ? value : value instanceof Map ? Array.from(value.values()) : Object.values(value || {});
  const result = {};
  for (const card of cards) {
    const id = finiteInteger(card?.id ?? card?.cardId ?? card?.CardID, 0);
    if (id <= 0) continue;
    result[id] = normalizeCard({ ...card, id });
  }
  return result;
}

function physicalCardDefinitionPayload(input = {}) {
  const payload = {
    ...(input.definition && typeof input.definition === "object" ? input.definition : {}),
    ...(input.card && typeof input.card === "object" ? input.card : {}),
    ...(input.attributes && typeof input.attributes === "object" ? input.attributes : {})
  };
  for (const field of [
    "id", "cardId", "CardID", "name", "CardName", "suit", "colorSym", "CardFlower", "color", "Color",
    "number", "CardNumber", "rank", "type", "cardType", "Type", "typeOriginal", "originalType", "subtype",
    "subType", "cardSubtype", "spellId", "isDamageCard", "damageCard", "isDelayedTrick", "isOrdinaryTrick",
    "equipSubtype", "spellClass", "nature", "damageNature"
  ]) {
    if (input[field] != null) payload[field] = input[field];
  }
  const normalizedType = normalizeTypeValue(payload.type);
  if (payload.typeOriginal == null && payload.originalType == null && ["basic", "trick", "equip"].includes(normalizedType)) {
    payload.typeOriginal = normalizedType === "basic" ? 1 : normalizedType === "trick" ? 2 : 3;
    delete payload.type;
  }
  for (const key of Object.keys(payload)) {
    if (payload[key] == null) delete payload[key];
  }
  return payload;
}

function physicalCardDefinitionConflicts(existing, next, payload) {
  if (!existing) return [];
  const aliases = {
    name: ["name", "CardName"],
    suit: ["suit", "colorSym", "CardFlower", "color", "Color"],
    number: ["number", "CardNumber", "rank"],
    type: ["type", "cardType", "Type", "typeOriginal", "originalType"],
    subtype: ["subtype", "subType", "cardSubtype"],
    spellId: ["spellId"],
    isDamageCard: ["isDamageCard", "damageCard"],
    isDelayedTrick: ["isDelayedTrick"],
    isOrdinaryTrick: ["isOrdinaryTrick"],
    equipSubtype: ["equipSubtype"],
    spellClass: ["spellClass"],
    nature: ["nature", "damageNature"]
  };
  const conflicts = [];
  for (const [field, names] of Object.entries(aliases)) {
    if (!names.some((name) => Object.prototype.hasOwnProperty.call(payload, name))) continue;
    const before = existing[field];
    const after = next[field];
    if (before == null || before === "" || before === "unknown") continue;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    conflicts.push({ field, before: cloneJson(before), after: cloneJson(after) });
  }
  return conflicts;
}

function normalizeCard(card = {}) {
  const id = finiteInteger(card.id ?? card.cardId ?? card.CardID, 0);
  const suit = normalizeSuit(card.suit ?? card.colorSym ?? card.CardFlower ?? card.color ?? card.Color);
  const number = finiteNumber(card.number ?? card.CardNumber ?? card.rank);
  const typeOriginal = finiteNumber(card.typeOriginal ?? card.originalType);
  const numericType = finiteNumber(card.type ?? card.cardType ?? card.Type);
  const type = typeClass(typeOriginal, numericType);
  const subtype = finiteNumber(card.subtype ?? card.subType ?? card.cardSubtype);
  const isDelayedTrick = normalizeBoolean(card.isDelayedTrick) ?? (type === "trick" && subtype === 5);
  const isOrdinaryTrick = normalizeBoolean(card.isOrdinaryTrick) ?? (type === "trick" && !isDelayedTrick);
  const isDamageCard = normalizeBoolean(card.isDamageCard ?? card.damageCard ?? card.spell?.isDamageCard) ?? false;
  return {
    ...card,
    id,
    name: String(card.name ?? card.CardName ?? ""),
    suit,
    number,
    rank: rankLabel(number),
    color: suit === 1 || suit === 2 ? "red" : suit === 3 || suit === 4 ? "black" : "",
    type,
    subtype,
    typeOriginal,
    numericType,
    isDamageCard,
    isDelayedTrick,
    isOrdinaryTrick,
    equipSubtype: finiteNumber(card.equipSubtype) ?? (type === "equip" ? subtype : null),
    spellClass: String(card.spellClass ?? card.spell?.className ?? ""),
    nature: String(card.nature ?? card.damageNature ?? "")
  };
}

function normalizePredicate(value = {}) {
  if (Array.isArray(value)) return { all: value.map(normalizePredicate) };
  const source = value && typeof value === "object" ? value : {};
  const result = {};
  for (const field of ["id", "name", "type", "subtype", "color", "suit", "number", "spellId", "nature", "isDamageCard", "isDelayedTrick", "isOrdinaryTrick", "equipSubtype", "spellClass"]) {
    const raw = source[field] ?? source[`${field}s`];
    if (raw == null || raw === "") continue;
    const values = Array.isArray(raw) ? raw : [raw];
    result[field] = values.map((item) => normalizePredicateValue(field, item)).filter((item) => item != null && item !== "");
  }
  const all = source.all ?? source.and;
  const any = source.any ?? source.or;
  if (Array.isArray(all)) result.all = all.map(normalizePredicate);
  if (Array.isArray(any)) result.any = any.map(normalizePredicate);
  if (source.not != null) result.not = normalizePredicate(source.not);

  const comparisons = Array.isArray(source.comparisons)
    ? source.comparisons
    : Array.isArray(source.where)
      ? source.where
      : source.field && source.op
        ? [source]
        : [];
  if (comparisons.length) {
    result.comparisons = comparisons.map(normalizeComparison).filter(Boolean);
    if (result.comparisons.length !== comparisons.length) {
      result._unsupported = uniqueStrings([...(result._unsupported || []), "comparison"]);
    }
  }

  const recognized = new Set([
    "id", "ids", "name", "names", "type", "types", "subtype", "subtypes", "color", "colors",
    "suit", "suits", "number", "numbers", "spellId", "spellIds", "isDamageCard", "isDamageCards",
    "isDelayedTrick", "isDelayedTricks", "isOrdinaryTrick", "isOrdinaryTricks", "equipSubtype", "equipSubtypes",
    "spellClass", "spellClasses", "nature", "natures", "all", "and", "any", "or", "not",
    "comparisons", "where", "field", "op", "value", "values", "_unsupported"
  ]);
  const unsupported = Object.keys(source).filter((key) => !recognized.has(key));
  if (Array.isArray(source._unsupported)) unsupported.push(...source._unsupported);
  if (unsupported.length) result._unsupported = uniqueStrings([...(result._unsupported || []), ...unsupported]);
  return result;
}

function normalizePredicateValue(field, value) {
  if (field === "id" || field === "number" || field === "spellId" || field === "equipSubtype" || field === "subtype") return finiteNumber(value);
  if (["isDamageCard", "isDelayedTrick", "isOrdinaryTrick"].includes(field)) return normalizeBoolean(value);
  if (field === "suit") return normalizeSuit(value);
  if (field === "type") return normalizeTypeValue(value);
  if (field === "color") {
    const text = String(value).toLowerCase();
    if (["red", "红", "红色"].includes(text)) return "red";
    if (["black", "黑", "黑色"].includes(text)) return "black";
  }
  return String(value);
}

function normalizeComparison(value = {}) {
  const field = String(value.field || "");
  const op = String(value.op || "eq").toLowerCase().replace(/_/g, "-");
  if (!["id", "name", "type", "subtype", "color", "suit", "number", "spellId", "nature", "isDamageCard", "isDelayedTrick", "isOrdinaryTrick", "equipSubtype", "spellClass"].includes(field)) return null;
  if (!["eq", "neq", "in", "not-in", "gt", "gte", "lt", "lte"].includes(op)) return null;
  if (value.valueRef != null || value.ref != null) return null;
  const rawValues = value.values ?? value.value;
  if (rawValues == null) return null;
  const values = (Array.isArray(rawValues) ? rawValues : [rawValues])
    .map((item) => normalizePredicateValue(field, item))
    .filter((item) => item != null && item !== "");
  return values.length ? { field, op, values } : null;
}

function matchesPredicate(card, predicate, cardId = null) {
  const normalized = normalizeCard({ ...(card || {}), id: cardId ?? card?.id });
  const canonical = normalizePredicate(predicate);
  if (!predicateIsExecutable(canonical)) return false;
  for (const [field, values] of Object.entries(canonical)) {
    if (["all", "any", "not", "comparisons", "_unsupported"].includes(field)) continue;
    if (!values.length) continue;
    const actual = field === "id" ? normalized.id : cardAttribute(normalized, field);
    if (!values.some((value) => String(value) === String(actual))) return false;
  }
  if (canonical.all && !canonical.all.every((child) => matchesPredicate(normalized, child, normalized.id))) return false;
  if (canonical.any && !canonical.any.some((child) => matchesPredicate(normalized, child, normalized.id))) return false;
  if (canonical.not && matchesPredicate(normalized, canonical.not, normalized.id)) return false;
  for (const comparison of canonical.comparisons || []) {
    if (!matchesComparison(normalized, comparison)) return false;
  }
  return true;
}

function predicateIsExecutable(predicate) {
  const canonical = normalizePredicate(predicate);
  if (canonical._unsupported?.length) return false;
  if (canonical.all?.some((child) => !predicateIsExecutable(child))) return false;
  if (canonical.any?.some((child) => !predicateIsExecutable(child))) return false;
  if (canonical.not && !predicateIsExecutable(canonical.not)) return false;
  return true;
}

function matchesComparison(card, comparison) {
  const actual = comparison.field === "id" ? card.id : cardAttribute(card, comparison.field);
  const values = comparison.values || [];
  if (comparison.op === "eq" || comparison.op === "in") return values.some((value) => String(value) === String(actual));
  if (comparison.op === "neq" || comparison.op === "not-in") return values.every((value) => String(value) !== String(actual));
  const expected = Number(values[0]);
  const number = Number(actual);
  if (!Number.isFinite(expected) || !Number.isFinite(number)) return false;
  if (comparison.op === "gt") return number > expected;
  if (comparison.op === "gte") return number >= expected;
  if (comparison.op === "lt") return number < expected;
  if (comparison.op === "lte") return number <= expected;
  return false;
}

function cardAttribute(card, field) {
  if (field === "name") return card.name;
  if (field === "number") return card.number;
  if (field === "suit") return card.suit;
  if (field === "type") return card.type;
  if (field === "subtype") return card.subtype ?? card.subType ?? card.cardSubtype ?? null;
  if (field === "color") return card.color;
  if (field === "spellId") return card.spellId ?? card.SpellID ?? card.cardSpellId ?? null;
  if (field === "isDamageCard") return card.isDamageCard;
  if (field === "isDelayedTrick") return card.isDelayedTrick;
  if (field === "isOrdinaryTrick") return card.isOrdinaryTrick;
  if (field === "equipSubtype") return card.equipSubtype;
  if (field === "spellClass") return card.spellClass;
  if (field === "nature") return card.nature;
  return null;
}

function typeClass(typeOriginal, numericType) {
  if (typeOriginal === 1) return "basic";
  if (typeOriginal === 2) return "trick";
  if (typeOriginal === 3) return "equip";
  if (numericType === 1) return "basic";
  if (numericType === 2 || numericType === 3) return "trick";
  if (numericType === 4) return "equip";
  return "unknown";
}

function normalizeTypeValue(value) {
  const text = String(value).toLowerCase();
  if (["1", "basic", "基本", "基本牌"].includes(text)) return "basic";
  if (["2", "3", "trick", "锦囊", "锦囊牌"].includes(text)) return "trick";
  if (["4", "equip", "装备", "装备牌"].includes(text)) return "equip";
  return text;
}

function normalizeSuit(value) {
  const map = {
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "♥": 1,
    "♦": 2,
    "♠": 3,
    "♣": 4,
    heart: 1,
    hearts: 1,
    diamond: 2,
    diamonds: 2,
    spade: 3,
    spades: 3,
    club: 4,
    clubs: 4,
    红桃: 1,
    方片: 2,
    方块: 2,
    黑桃: 3,
    梅花: 4,
    草花: 4
  };
  const text = String(value).trim();
  return map[text] || map[text.toLowerCase()] || null;
}

function rankLabel(value) {
  const number = finiteNumber(value);
  if (number === 1) return "A";
  if (number === 11) return "J";
  if (number === 12) return "Q";
  if (number === 13) return "K";
  return number == null ? "" : String(number);
}

function normalizeZoneKey(value) {
  if (!value) return "";
  if (typeof value === "object") {
    const code = finiteNumber(value.code);
    const seat = finiteInteger(value.seat, 255);
    const zoneParam = finiteNumber(value.zoneParam ?? value.param);
    if (code != null) return protocolZoneKey(code, seat, zoneParam);
    return normalizeZoneKey(value.key || value.zoneKey || value.zone);
  }
  const text = String(value);
  if (/^\d+-\d+$/.test(text)) {
    const [code, seat] = text.split("-").map(Number);
    return protocolZoneKey(code, seat);
  }
  return text;
}

function physicalPileZoneKey(keyValue) {
  const key = String(keyValue || "").trim();
  return key ? `physical-pile:${key}` : "";
}

function physicalPileEndpointConflict(count, top, bottom) {
  if (top.length > count || bottom.length > count) return { reason: "endpoint-longer-than-pile-count" };
  const positions = new Map();
  const cardPositions = new Map();
  for (const [index, cardId] of top.entries()) {
    const position = index + 1;
    positions.set(position, cardId);
    cardPositions.set(cardId, position);
  }
  for (const [index, cardId] of bottom.entries()) {
    const position = count - index;
    if (positions.has(position) && positions.get(position) !== cardId) {
      return { reason: "different-cards-at-same-position", position, topCardId: positions.get(position), bottomCardId: cardId };
    }
    if (cardPositions.has(cardId) && cardPositions.get(cardId) !== position) {
      return { reason: "same-card-at-different-positions", cardId, positions: [cardPositions.get(cardId), position] };
    }
    positions.set(position, cardId);
    cardPositions.set(cardId, position);
  }
  return null;
}

function protocolZoneKey(code, seat = 255, zoneParam = null) {
  const param = finiteNumber(zoneParam);
  if (code === 1) return ZONE.DECK;
  if (code === 2) return ZONE.DISCARD;
  if (code === 9) return ZONE.SHUFFLE;
  if (code === 3) return param == null ? ZONE.PROCESS : `${ZONE.PROCESS}:use:${param}`;
  if (code === 4) return `mark:${seat}:${param ?? 0}`;
  if (code === 8) return `special:${seat}:${param ?? 0}`;
  if (code === 10) return `process:exchange:${seat}:${param ?? 0}`;
  if (code === 11) return `process:discard:${seat}:${param ?? 0}`;
  if (code === 5) return handZone(seat);
  if (code === 6) return `equip:${seat}`;
  if (code === 7) return `judge:${seat}`;
  if (code === 12) return (param == null || param === 0) && [0, 255].includes(Number(seat))
    ? ZONE.REMOVED
    : `${ZONE.REMOVED}:${seat}:${param ?? 0}`;
  if (code === 0) return ZONE.OUTSIDE;
  return `protocol:${code}:${seat}:${param ?? 0}`;
}

function normalizeOperationType(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[._\s]+/g, "-")
    .toLowerCase();
}

function normalizeMovementReason(value) {
  return String(value || "")
    .trim()
    .replace(/[._\s]+/g, "-")
    .toLowerCase();
}

function normalizeSelectionModel(value) {
  const model = String(value || "unknown").trim().toLowerCase().replace(/[._\s]+/g, "-");
  return ["uniform", "exchangeable-uniform"].includes(model) ? "uniform" : "unknown";
}

function normalizeSkillBindingOperation(value) {
  const operation = String(value || "observe").trim().toLowerCase().replace(/[._\s]+/g, "-");
  if (["gain", "grant", "acquire", "add", "activate"].includes(operation)) return "grant";
  if (["lose", "loss", "remove", "revoke", "deactivate", "expire"].includes(operation)) return "lose";
  if (["replace", "transform"].includes(operation)) return "replace";
  return "observe";
}

function defaultSkillBindingKey(input = {}) {
  const skillId = finiteInteger(input.skillId, 0);
  if (skillId <= 0) return "";
  const ownerSeat = finiteInteger(input.ownerSeat, -1);
  const ownerGeneralId = finiteInteger(input.ownerGeneralId, 0);
  const mode = String(input.mode || "").trim();
  const scope = String(input.scope || "").trim();
  if (ownerSeat >= 0) return `skill:${skillId}:seat:${ownerSeat}`;
  if (ownerGeneralId > 0) return `skill:${skillId}:general:${ownerGeneralId}`;
  if (mode) return `skill:${skillId}:mode:${mode}`;
  return `skill:${skillId}:scope:${scope || "global"}`;
}

function concreteZone(value) {
  if (value && typeof value === "object") {
    const normalized = normalizeZoneKey(value);
    return normalized && !normalized.startsWith("protocol:") ? normalized : "";
  }
  const text = String(value || "").trim().toLowerCase();
  if (["deck", "current-deck", "deck-top", "deck-bottom"].includes(text)) return ZONE.DECK;
  if ([ZONE.DISCARD, ZONE.PROCESS, ZONE.REMOVED, ZONE.OUTSIDE, ZONE.SHUFFLE].includes(text)) return text;
  if (/^(?:hand|equip|judge|general):\d+$/.test(text)) return text;
  if (/^(?:special|mark|removed):\d+:\d+$/.test(text)) return text;
  if (/^process:(?:use|exchange|discard):\d+(?::\d+)?$/.test(text)) return text;
  return "";
}

function concreteEndpoint(value) {
  const raw = value && typeof value === "object" ? value.endpoint ?? value.position ?? value.key ?? value.zoneKey : value;
  if (raw === DECK_POSITION.TOP) return "top";
  if (raw === DECK_POSITION.BOTTOM) return "bottom";
  if (raw === DECK_POSITION.RANDOM) return "random";
  const text = String(raw || "").trim().toLowerCase();
  if (["top", "deck-top", "牌堆顶"].includes(text)) return "top";
  if (["bottom", "deck-bottom", "牌堆底"].includes(text)) return "bottom";
  if (["random", "deck-random", "current-deck"].includes(text)) return "random";
  return null;
}

function deckZoneWithPosition(zoneKey, endpoint) {
  if (zoneKey !== ZONE.DECK || !endpoint) return zoneKey;
  const position = endpoint === "top"
    ? DECK_POSITION.TOP
    : endpoint === "bottom"
      ? DECK_POSITION.BOTTOM
      : DECK_POSITION.RANDOM;
  return { key: ZONE.DECK, position };
}

function appliedOperation(type, result) {
  return { status: "applied", type, result };
}

function unsupportedOperation(type, reason, operation) {
  return { status: "unsupported", type, reason, operation: cloneJson(operation) };
}

function handZone(seatIndex) {
  return `hand:${finiteInteger(seatIndex, -1)}`;
}

function isDeckZone(zoneKey) {
  return zoneKey === ZONE.DECK;
}

function isProcessUseZone(zoneKey) {
  return zoneKey === ZONE.PROCESS || String(zoneKey || "").startsWith(`${ZONE.PROCESS}:use:`);
}

function deckSelectorFromPosition(value) {
  const position = finiteNumber(value);
  if (position === DECK_POSITION.TOP) return "top";
  if (position === DECK_POSITION.BOTTOM) return "bottom";
  if (position === DECK_POSITION.RANDOM) return "random";
  return null;
}

function normalizeTurnContext(value = {}) {
  return {
    turn: finiteNumber(value?.turn),
    round: finiteNumber(value?.round),
    phase: normalizePhaseValue(value?.phase)
  };
}

function mergeTurnContext(current = {}, incoming = {}) {
  const next = normalizeTurnContext(incoming);
  return {
    turn: next.turn ?? finiteNumber(current.turn),
    round: next.round ?? finiteNumber(current.round),
    phase: next.phase ?? normalizePhaseValue(current.phase),
    causalEventId: stringOrNull(incoming?.causalEventId ?? current?.causalEventId),
    rootEventId: stringOrNull(incoming?.rootEventId ?? current?.rootEventId),
    channelKey: stringOrNull(incoming?.channelKey ?? current?.channelKey),
    targetEventId: stringOrNull(incoming?.targetEventId ?? current?.targetEventId),
    movementReason: normalizeMovementReason(incoming?.movementReason ?? current?.movementReason),
    moveType: finiteNumber(incoming?.moveType ?? current?.moveType),
    reasonTags: uniqueStrings(asList(incoming?.reasonTags ?? current?.reasonTags)),
    skillId: finiteInteger(incoming?.skillId ?? current?.skillId, 0) || null,
    protocol: String(incoming?.protocol ?? current?.protocol ?? "")
  };
}

function normalizePhaseValue(value) {
  const number = finiteNumber(value);
  if (number != null) return number;
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeScheduledTrigger(value = {}) {
  const input = typeof value === "string" ? { eventTypes: [value] } : value || {};
  const context = input.context || {};
  return {
    eventTypes: uniqueStrings(asList(input.eventTypes ?? input.eventType ?? input.onEventTypes ?? input.onEvent)),
    turn: finiteNumber(input.turn ?? context.turn),
    round: finiteNumber(input.round ?? context.round),
    phase: input.phase ?? context.phase ?? null,
    activeSeat: finiteNumber(input.activeSeat ?? context.activeSeat),
    stage: input.stage ?? context.stage ?? null,
    seat: finiteNumber(input.seat),
    casterSeat: finiteNumber(input.casterSeat),
    targetSeat: finiteNumber(input.targetSeat),
    skillId: finiteInteger(input.skillId, 0) || null,
    cardId: finiteInteger(input.cardId, 0) || null,
    causalEventId: stringOrNull(input.causalEventId ?? input.eventId),
    tags: uniqueStrings(asList(input.tags)),
    notBeforeEventIndex: nonNegativeIntegerOrNull(input.notBeforeEventIndex)
  };
}

function scheduledTriggerHasConditions(trigger = {}) {
  return trigger.eventTypes?.length > 0 || trigger.tags?.length > 0 || [
    "turn",
    "round",
    "phase",
    "activeSeat",
    "stage",
    "seat",
    "casterSeat",
    "targetSeat",
    "skillId",
    "cardId",
    "causalEventId"
  ].some((field) => trigger[field] != null);
}

function scheduledEventContext(current = {}, incoming = {}) {
  return {
    turn: incoming?.turn ?? current?.turn ?? null,
    round: incoming?.round ?? current?.round ?? null,
    phase: incoming?.phase ?? current?.phase ?? null,
    activeSeat: incoming?.activeSeat ?? current?.activeSeat ?? null,
    stage: incoming?.stage ?? current?.stage ?? null
  };
}

function normalizeCausalRoles(value = {}, targetSeats = []) {
  const source = value && typeof value === "object" ? value : {};
  const result = {};
  const explicit = source.roles && typeof source.roles === "object" ? source.roles : source;
  for (const [key, raw] of Object.entries(explicit)) {
    if (!key.endsWith("Seat") && !["actor", "user", "caster", "responder", "damageSource", "target"].includes(key)) continue;
    const seat = finiteNumber(raw);
    if (seat == null) continue;
    const role = key.endsWith("Seat") ? key : `${key}Seat`;
    result[role] = seat;
  }
  const aliases = {
    actorSeat: source.actorSeat ?? source.seat,
    userSeat: source.userSeat,
    casterSeat: source.casterSeat,
    responderSeat: source.responderSeat,
    damageSourceSeat: source.damageSourceSeat,
    targetSeat: source.targetSeat ?? (targetSeats.length === 1 ? targetSeats[0] : null)
  };
  for (const [role, raw] of Object.entries(aliases)) {
    const seat = finiteNumber(raw);
    if (seat != null) result[role] = seat;
  }
  return result;
}

function explicitTargetSeats(value = {}) {
  const explicit = [
    ...asList(value.targetSeats),
    ...asList(value.targetSeat)
  ];
  if (value.targetsAreSeats === true) explicit.push(...asList(value.targets));
  for (const target of asList(value.targets)) {
    if (target && typeof target === "object" && (target.seat != null || target.seatIndex != null)) explicit.push(target);
  }
  return uniqueFiniteNumbers(explicit);
}

function causalEventSeats(row = {}) {
  return uniqueFiniteNumbers([
    ...Object.values(row.roles || {}),
    ...(row.targetSeats || [])
  ]);
}

function compareCausalEvents(left, right) {
  const leftSequence = nonNegativeIntegerOrNull(left?.sequenceIndex);
  const rightSequence = nonNegativeIntegerOrNull(right?.sequenceIndex);
  if (leftSequence != null || rightSequence != null) {
    if (leftSequence == null) return 1;
    if (rightSequence == null) return -1;
    if (leftSequence !== rightSequence) return leftSequence - rightSequence;
  }
  const leftTime = finiteNumber(left?.firstObservedAt) ?? 0;
  const rightTime = finiteNumber(right?.firstObservedAt) ?? 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left?.eventId || "").localeCompare(String(right?.eventId || ""));
}

function normalizeMovementCardDetails(value, cardIds = []) {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([cardId, detail]) => ({
          cardId,
          ...(detail && typeof detail === "object" ? detail : {})
        }))
      : [];
  const byCardId = new Map();
  for (const row of rows) {
    const cardId = finiteInteger(row.cardId ?? row.id ?? row.CardID, 0);
    if (cardId <= 0) continue;
    byCardId.set(cardId, row);
  }
  return uniquePositiveIds(cardIds).map((cardId, cardIndex) => {
    const row = byCardId.get(cardId) || {};
    return {
      cardId,
      cardSequenceIndex: nonNegativeIntegerOrNull(row.cardSequenceIndex ?? row.index ?? cardIndex),
      sequenceIndex: nonNegativeIntegerOrNull(row.sequenceIndex ?? row.order),
      sourceSlot: stringOrNull(row.sourceSlot ?? row.fromSlot),
      destinationSlot: stringOrNull(row.destinationSlot ?? row.toSlot),
      sourceZoneParam: cloneJson(row.sourceZoneParam ?? row.fromZoneParam ?? null),
      destinationZoneParam: cloneJson(row.destinationZoneParam ?? row.toZoneParam ?? null),
      metadata: cloneJson(row.metadata || {})
    };
  });
}

function normalizeGeneralFaceState(value) {
  if (value === true) return "face-up";
  if (value === false) return "face-down";
  const text = String(value || "unknown").trim().toLowerCase().replace(/[\s_]+/g, "-");
  const aliases = {
    up: "face-up",
    shown: "face-up",
    revealed: "face-up",
    open: "face-up",
    down: "face-down",
    hidden: "face-down",
    covered: "face-down",
    removed: "removed",
    inactive: "inactive"
  };
  return aliases[text] || text || "unknown";
}

function normalizeZoneCapabilityStatus(value, abolished, available) {
  if (abolished === true) return "abolished";
  if (available === true) return "available";
  if (available === false) return "disabled";
  const text = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  const aliases = {
    active: "available",
    enabled: "available",
    usable: "available",
    abolished: "abolished",
    removed: "abolished",
    disabled: "disabled",
    unavailable: "disabled",
    locked: "disabled"
  };
  return aliases[text] || text || null;
}

function normalizeMovementAttemptStatus(value, prevented) {
  if (prevented === true) return "prevented";
  const text = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  const aliases = {
    block: "prevented",
    blocked: "prevented",
    prevent: "prevented",
    denied: "prevented",
    accepted: "accepted",
    success: "accepted",
    succeeded: "accepted",
    moved: "moved",
    resolved: "resolved",
    failed: "failed",
    cancelled: "cancelled",
    canceled: "cancelled",
    pending: "pending"
  };
  return aliases[text] || text || null;
}

function compareMovements(left, right) {
  if (left.movementGroupId && left.movementGroupId === right.movementGroupId) {
    const leftSequence = nonNegativeIntegerOrNull(left.sequenceIndex);
    const rightSequence = nonNegativeIntegerOrNull(right.sequenceIndex);
    if (leftSequence != null || rightSequence != null) {
      if (leftSequence == null) return 1;
      if (rightSequence == null) return -1;
      if (leftSequence !== rightSequence) return leftSequence - rightSequence;
    }
  }
  return Number(left.index || 0) - Number(right.index || 0);
}

function causalEventIsSettled(value) {
  return ["resolved", "settled", "finished", "complete", "completed", "cancelled", "canceled"].includes(String(value || "").trim().toLowerCase());
}

function comparisonStatusRank(value) {
  const status = String(value || "").trim().toLowerCase().replace(/[._\s]+/g, "-");
  const ranks = {
    observed: 0,
    declared: 0,
    choosing: 1,
    chosen: 1,
    revealed: 2,
    reveal: 2,
    result: 3,
    resolved: 3,
    settled: 4,
    finished: 4,
    complete: 4,
    completed: 4,
    cancelled: 4,
    canceled: 4
  };
  return Object.prototype.hasOwnProperty.call(ranks, status) ? ranks[status] : -1;
}

function normalizeCardIdentityKind(value, virtual, mainCardId, subcardIds = []) {
  const requested = String(value || "").trim().toLowerCase();
  if (requested) return requested;
  if (virtual === true) return subcardIds.length ? "virtual-with-subcards" : "virtual-zero-subcard";
  if (mainCardId) return "physical";
  if (subcardIds.length) return "virtual-with-subcards";
  return "unknown";
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function asList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string" || typeof value === "number") return [value];
  if (typeof value[Symbol.iterator] === "function") return Array.from(value);
  return [value];
}

function normalizeChoiceCandidates(value, domain) {
  const candidates = [];
  for (const [index, candidate] of asList(value).entries()) {
    if (candidate === undefined) return { ok: false, reason: `candidate-${index}-is-undefined`, candidates: [] };
    let physicalCardId = null;
    if (domain === "physical-card-id") {
      const rawId = candidate && typeof candidate === "object"
        ? candidate.physicalCardId ?? candidate.cardId ?? candidate.CardID ?? candidate.id ?? candidate.value
        : candidate;
      physicalCardId = finiteInteger(rawId, 0);
      if (physicalCardId <= 0) return { ok: false, reason: `candidate-${index}-requires-positive-physical-card-id`, candidates: [] };
    }
    candidates.push({
      index,
      domain,
      value: cloneJson(candidate),
      physicalCardId: physicalCardId || null,
      isPhysicalCardReference: physicalCardId != null
    });
  }
  return { ok: true, candidates };
}

function normalizeSelectionAgency(value, fallback = "player-choice") {
  const text = String(value || "").trim().toLowerCase().replace(/[._\s]+/g, "-");
  if (!text) return fallback;
  if (["random", "stochastic", "server-random", "server-rng", "rng"].includes(text)) return "server-random";
  if (["deterministic", "forced", "automatic"].includes(text)) return "deterministic";
  if (["server-defined", "server-choice"].includes(text)) return "server-defined";
  if (["player", "player-choice", "choice", "prompt"].includes(text)) return "player-choice";
  return text;
}

function normalizeSamplingModel(value, selectionAgency, withReplacement) {
  const text = String(value || "").trim().toLowerCase().replace(/[._\s]+/g, "-");
  if (!text) {
    if (selectionAgency === "server-random") return "unknown";
    if (selectionAgency === "deterministic") return "deterministic";
    return "not-applicable";
  }
  if (["uniform", "uniform-random"].includes(text)) {
    return withReplacement ? "uniform-with-replacement" : "uniform-without-replacement";
  }
  if (["uniform-with-replacement", "uniform-without-replacement", "weighted", "deterministic", "unknown", "not-applicable", "server-defined"].includes(text)) {
    return text;
  }
  return text;
}

function normalizeCandidateWeights(value, candidates, previous = []) {
  const supplied = value == null ? Array.from(previous || []) : asList(value);
  if (!supplied.length) {
    const embedded = candidates.map((candidate) => finiteNumber(candidate.value?.weight));
    return embedded.some((weight) => weight != null)
      ? embedded.every((weight) => weight != null && weight >= 0) ? embedded : null
      : [];
  }
  if (supplied.length !== candidates.length) return null;
  const weights = supplied.map((weight) => finiteNumber(weight));
  return weights.every((weight) => weight != null && weight >= 0) ? weights : null;
}

function normalizeStochasticSourceZones(value) {
  return uniqueStrings(asList(value).map((zone) => {
    const text = String(zone || "").trim();
    if (!text) return "";
    if (["unresolved", "unknown", "server-defined"].includes(text.toLowerCase())) return text.toLowerCase();
    return normalizeZoneKey(zone);
  }).filter(Boolean));
}

function contextKey(value = {}) {
  return `round:${value.round ?? "?"}:turn:${value.turn ?? "?"}:phase:${value.phase ?? "?"}`;
}

function normalizeSource(value, now = () => Date.now()) {
  const source = typeof value === "string" ? { id: value } : { ...(value || {}) };
  const kind = String(source.kind || source.authority || "unknown");
  return {
    ...source,
    id: String(source.id || source.rule || kind),
    kind,
    authority: AUTHORITY[kind] ?? finiteNumber(source.authorityScore) ?? AUTHORITY.unknown,
    observedAt: finiteNumber(source.observedAt) ?? now()
  };
}

function sourceOf(id, kind, detail = {}) {
  return { id, kind, ...detail };
}

function compactHand(hand) {
  return {
    seatIndex: hand.seatIndex,
    count: hand.count,
    exactIds: hand.exactIds.slice(),
    unknownCount: hand.unknownCount,
    complete: hand.complete,
    generation: hand.generation,
    constraints: hand.constraints.map(cloneJson),
    visibility: hand.visibility,
    source: hand.source,
    updatedAt: hand.updatedAt
  };
}

function applyZoneDescriptor(zone, observation = {}) {
  if (observation.zoneKind != null) zone.zoneKind = String(observation.zoneKind || "generic-card-zone");
  if (observation.pileKey != null || observation.pileName != null) {
    zone.pileKey = stringOrNull(observation.pileKey ?? observation.pileName);
  }
  for (const field of ["hostSeat", "controllerSeat", "placedBySeat", "ownerSeat", "hostGeneralId", "hostCardId", "skillId"]) {
    if (!Object.prototype.hasOwnProperty.call(observation, field)) continue;
    zone[field] = observation[field] == null ? null : finiteNumber(observation[field]);
  }
  if (observation.ownershipKnown != null) {
    zone.ownershipKnown = observation.ownershipKnown === true;
  } else if (Object.prototype.hasOwnProperty.call(observation, "ownerSeat") && observation.ownerSeat !== undefined) {
    zone.ownershipKnown = true;
  }
  if (observation.hostArea != null) zone.hostArea = stringOrNull(observation.hostArea);
  if (observation.hostPlayerKey != null || observation.playerKey != null) {
    zone.hostPlayerKey = stringOrNull(observation.hostPlayerKey || observation.playerKey);
  }
  if (observation.hostAvatarKey != null || observation.avatarKey != null) {
    zone.hostAvatarKey = stringOrNull(observation.hostAvatarKey || observation.avatarKey);
  }
  if (observation.lifecycleScope != null) zone.lifecycleScope = stringOrNull(observation.lifecycleScope)?.toLowerCase() || null;
  if (observation.attachmentPolicy != null) zone.attachmentPolicy = stringOrNull(observation.attachmentPolicy);
  if (Object.prototype.hasOwnProperty.call(observation, "capacity")) {
    zone.capacity = nonNegativeIntegerOrNull(observation.capacity);
  }
  if (Object.prototype.hasOwnProperty.call(observation, "zoneParam")) {
    zone.zoneParam = observation.zoneParam == null ? null : cloneJson(observation.zoneParam);
  }
  if (observation.ruleIdentityKey != null) zone.ruleIdentityKey = stringOrNull(observation.ruleIdentityKey);
  if (observation.ordered != null) zone.ordered = observation.ordered === true;
  if (observation.orderKnown != null) {
    zone.orderKnown = observation.orderKnown === true;
  } else if (observation.ordered === true) {
    zone.orderKnown = true;
  }
  if (Object.prototype.hasOwnProperty.call(observation, "faceUp")) {
    zone.faceUp = observation.faceUp == null ? null : observation.faceUp === true;
  }
  if (observation.visibilityAudience != null) {
    zone.visibilityAudience = String(observation.visibilityAudience || "unknown");
  } else if (observation.visibility != null) {
    zone.visibilityAudience = String(observation.visibility || "unknown");
  }
  if (observation.observerSeats != null || observation.viewerSeats != null) {
    zone.observerSeats = uniqueFiniteNumbers(asList(observation.observerSeats ?? observation.viewerSeats)).sort((left, right) => left - right);
  }
  if (observation.metadata != null) zone.metadata = cloneJson(observation.metadata);
  return zone;
}

function compactZoneDescriptor(zone) {
  return {
    zoneKind: String(zone.zoneKind || "generic-card-zone"),
    pileKey: zone.pileKey || null,
    hostSeat: zone.hostSeat ?? null,
    hostArea: zone.hostArea || null,
    hostPlayerKey: zone.hostPlayerKey || null,
    hostAvatarKey: zone.hostAvatarKey || null,
    lifecycleScope: zone.lifecycleScope || null,
    hostGeneralId: zone.hostGeneralId ?? null,
    hostCardId: zone.hostCardId ?? null,
    attachmentPolicy: zone.attachmentPolicy || null,
    capacity: zone.capacity ?? null,
    controllerSeat: zone.controllerSeat ?? null,
    placedBySeat: zone.placedBySeat ?? null,
    ownerSeat: zone.ownerSeat ?? null,
    ownershipKnown: zone.ownershipKnown === true,
    skillId: zone.skillId ?? null,
    zoneParam: cloneJson(zone.zoneParam ?? null),
    ruleIdentityKey: zone.ruleIdentityKey || null,
    ordered: zone.ordered === true,
    orderKnown: zone.orderKnown === true,
    faceUp: zone.faceUp ?? null,
    visibilityAudience: String(zone.visibilityAudience || zone.visibility || "unknown"),
    observerSeats: Array.from(zone.observerSeats || []),
    metadata: cloneJson(zone.metadata || {})
  };
}

function normalizeZoneCardStates(value, knownIds = []) {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([cardId, state]) => ({ cardId, ...(state && typeof state === "object" ? state : {}) }))
      : [];
  const allowed = new Set(uniquePositiveIds(knownIds));
  const result = {};
  for (const row of rows) {
    const cardId = finiteInteger(row.cardId ?? row.id ?? row.CardID, 0);
    if (cardId <= 0 || allowed.size && !allowed.has(cardId)) continue;
    result[cardId] = {
      faceUp: row.faceUp == null ? null : row.faceUp === true,
      visibilityAudience: String(row.visibilityAudience || row.visibility || "unknown"),
      observerSeats: uniqueFiniteNumbers(asList(row.observerSeats ?? row.viewerSeats)).sort((left, right) => left - right),
      metadata: cloneJson(row.metadata || {})
    };
  }
  return result;
}

function namedCardZoneKey(input = {}) {
  const normalizedKind = String(input.zoneKind || "general-card-pile").trim().toLowerCase();
  const kind = encodeURIComponent(normalizedKind);
  const hostSeat = finiteInteger(input.hostSeat, -1);
  const hostPlayerKey = String(input.hostPlayerKey || input.playerKey || "").trim();
  const lifecycleScope = String(input.lifecycleScope || "").trim().toLowerCase();
  const identity = String(input.pileKey || (finiteInteger(input.skillId, 0) > 0 ? `skill-${finiteInteger(input.skillId, 0)}` : "")).trim();
  if (!identity) return "";
  const numericParam = finiteNumber(input.zoneParam);
  if (normalizedKind === ZONE.REMOVED && hostSeat >= 0 && numericParam != null) {
    return `${ZONE.REMOVED}:${hostSeat}:${numericParam}`;
  }
  const param = input.zoneParam == null || input.zoneParam === ""
    ? ""
    : `:${encodeURIComponent(canonicalJsonKey(input.zoneParam))}`;
  const hostIdentity = lifecycleScope === "player" && hostPlayerKey
    ? `player-${encodeURIComponent(hostPlayerKey)}`
    : hostSeat >= 0
      ? String(hostSeat)
      : "global";
  return `named-card-zone:${kind}:${hostIdentity}:${encodeURIComponent(identity)}${param}`;
}

function compactZone(zone) {
  return {
    zoneKey: zone.zoneKey,
    ...compactZoneDescriptor(zone),
    count: zone.count,
    exactIds: zone.exactIds.slice(),
    unknownCount: Math.max(0, Number(zone.count || 0) - zone.exactIds.length),
    complete: zone.complete,
    visibility: zone.visibility,
    cardStates: cloneJson(zone.cardStates || {}),
    source: zone.source,
    updatedAt: zone.updatedAt
  };
}

function emptyDistributions() {
  return { number: [], suit: [], type: [], color: [], name: [] };
}

function mergeEndpoint(inserted, existing) {
  const result = [];
  for (const id of [...inserted, ...existing]) {
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

function findAggregateWitness(cards, target, minCount, maxCount, maxUnresolved) {
  const states = new Map([["0|0|0", { sum: 0, count: 0, unresolvedCount: 0, ids: [] }]]);
  for (const card of cards) {
    const prior = Array.from(states.values());
    for (const state of prior) {
      const sum = state.sum + card.value;
      const count = state.count + 1;
      const unresolvedCount = state.unresolvedCount + (card.unresolved ? 1 : 0);
      if (sum > target || count > maxCount || unresolvedCount > maxUnresolved) continue;
      const key = `${sum}|${count}|${unresolvedCount}`;
      if (!states.has(key)) {
        states.set(key, { sum, count, unresolvedCount, ids: [...state.ids, card.id] });
      }
    }
  }
  return Array.from(states.values())
    .filter((state) => state.sum === target && state.count >= minCount && state.count <= maxCount)
    .sort((a, b) => a.unresolvedCount - b.unresolvedCount || a.count - b.count || a.ids.join(",").localeCompare(b.ids.join(",")))[0] || null;
}

function hypergeometricProbability(populationSize, successStates, draws, observedSuccesses) {
  const N = nonNegativeIntegerOrNull(populationSize) ?? 0;
  const K = nonNegativeIntegerOrNull(successStates) ?? 0;
  const n = nonNegativeIntegerOrNull(draws) ?? 0;
  const k = nonNegativeIntegerOrNull(observedSuccesses) ?? 0;
  if (k > K || k > n || n - k > N - K || n > N) return 0;
  const logProbability = logChoose(K, k) + logChoose(N - K, n - k) - logChoose(N, n);
  return Math.exp(logProbability);
}

function logChoose(n, k) {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  const target = Math.min(k, n - k);
  let result = 0;
  for (let index = 1; index <= target; index++) {
    result += Math.log(n - target + index) - Math.log(index);
  }
  return result;
}

function uniquePositiveIds(value) {
  const result = [];
  const seen = new Set();
  for (const item of asList(value)) {
    const id = finiteInteger(typeof item === "object" ? item?.id ?? item?.cardId ?? item?.CardID : item, 0);
    if (id <= 0 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function uniqueStrings(value) {
  return Array.from(new Set(asList(value).map((item) => typeof item === "string" ? item : item?.id).filter(Boolean)));
}

function uniqueFiniteNumbers(value) {
  return Array.from(new Set(asList(value).map((item) => finiteNumber(typeof item === "object" ? item?.seat ?? item?.seatIndex ?? item?.id : item)).filter((item) => item != null)));
}

function nonNegativeIntegerOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function positiveIntegerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function finiteInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeBoolean(value) {
  if (value == null || value === "") return null;
  if (value === true || value === false) return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "是"].includes(text)) return true;
  if (["0", "false", "no", "n", "否"].includes(text)) return false;
  return null;
}

function normalizeListInput(value) {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function initialRuleStateValue(kind) {
  if (kind === "counter") return 0;
  if (kind === "set" || kind === "ordered-list") return [];
  return null;
}

function applyRuleStateMutation(kind, currentValue, operation, rawValue, amountValue) {
  const values = normalizeListInput(rawValue).map(cloneJson);
  if (operation === "clear") return { status: "applied", value: initialRuleStateValue(kind) };
  if (kind === "scalar") {
    if (operation !== "set") return { status: "unsupported" };
    return { status: "applied", value: cloneJson(rawValue) };
  }
  if (kind === "counter") {
    const current = Number(currentValue || 0);
    if (operation === "set") {
      const value = Number(rawValue);
      return Number.isFinite(value) ? { status: "applied", value } : { status: "unsupported" };
    }
    if (!["increment", "decrement", "add", "subtract"].includes(operation)) return { status: "unsupported" };
    const amount = Number(amountValue ?? rawValue ?? 1);
    if (!Number.isFinite(amount)) return { status: "unsupported" };
    return { status: "applied", value: current + (["decrement", "subtract"].includes(operation) ? -amount : amount) };
  }
  const current = Array.isArray(currentValue) ? currentValue.map(cloneJson) : [];
  if (operation === "set") {
    return { status: "applied", value: kind === "set" ? uniqueJsonValues(values) : values };
  }
  if (["append", "add"].includes(operation)) {
    return { status: "applied", value: kind === "set" ? uniqueJsonValues([...current, ...values]) : [...current, ...values] };
  }
  if (operation === "remove") {
    const remove = new Set(values.map(stableJsonKey));
    return { status: "applied", value: current.filter((value) => !remove.has(stableJsonKey(value))) };
  }
  return { status: "unsupported" };
}

function uniqueJsonValues(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = stableJsonKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cloneJson(value));
  }
  return result;
}

function stableJsonKey(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])));
  }
  return JSON.stringify(value);
}

function canonicalJsonKey(value) {
  return JSON.stringify(canonicalJsonValue(value));
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJsonValue(value[key])]));
}

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function replaceObject(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

module.exports = {
  SCHEMA_VERSION,
  ZONE,
  AUTHORITY,
  DECK_POSITION,
  makeGameModel,
  normalizeCard,
  normalizeCatalog,
  normalizePredicate,
  matchesPredicate,
  predicateIsExecutable,
  normalizeZoneKey,
  protocolZoneKey,
  deckSelectorFromPosition,
  handZone,
  sourceOf,
  hypergeometricProbability
};
