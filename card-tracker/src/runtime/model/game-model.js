(() => {
  const root = window.__SgsScripts;
  const core = root.modules.gameModelCore;
  const model = core.makeGameModel();

  const runtimeState = {
    activeScene: null,
    activeManager: null,
    sessionSequence: 0,
    lastDeckCount: null,
    handSignatures: {},
    publicZoneSignatures: {},
    publicNamedZoneDescriptors: {},
    publicNamedStateDescriptors: {},
    lastResolution: null,
    lastError: "",
    skillKnowledgeGeneratedAt: root.tracker.skillKnowledge?.generatedAt || ""
  };

  function syncContext(context, publicZones = null) {
    try {
      if (!context?.ok || !context.scene) {
        leaveBattle("table-scene-not-visible");
        return model.snapshot();
      }

      if (runtimeState.activeScene !== context.scene || runtimeState.activeManager !== context.scene?.manager) {
        beginSession(context, runtimeState.activeScene !== context.scene ? "new-table-scene" : "new-table-manager");
      } else if (Object.keys(model.state.catalog || {}).length === 0 && root.sources.configState?.loaded) {
        model.setCatalog(root.sources.configState.cardDict, source("config-card-catalog", "runtime-public"));
      }

      resolveDeckDefinition(context);
      syncDeckCount(context, { initial: runtimeState.lastDeckCount == null });
      syncHands(context);
      syncPublicZones(publicZones);
      runtimeState.lastError = "";
      return model.snapshot();
    } catch (error) {
      runtimeState.lastError = String(error?.stack || error);
      return model.snapshot();
    }
  }

  function leaveBattle(reason = "table-scene-not-visible") {
    if (!runtimeState.activeScene && !model.state.initialized) return;
    runtimeState.activeScene = null;
    runtimeState.activeManager = null;
    runtimeState.lastDeckCount = null;
    runtimeState.handSignatures = {};
    runtimeState.publicZoneSignatures = {};
    runtimeState.publicNamedZoneDescriptors = {};
    runtimeState.publicNamedStateDescriptors = {};
    runtimeState.lastResolution = null;
    model.reset(reason);
  }

  function handleProtocolRecord(record) {
    try {
      const parsed = record?.parsed;
      if (!parsed?.type) return null;
      if (record.name === "GsCStartGameRep" && runtimeState.activeScene) {
        beginSession({ scene: runtimeState.activeScene }, "protocol-game-start");
      }
      if (runtimeState.activeScene && model.state.initialized) {
        observeProtocolPhysicalCardDefinitions(parsed, record);
      }
      if (parsed.type !== "card:move") {
        if (!runtimeState.activeScene || !model.state.initialized) return null;
        return model.observeGameEvent({
          ...parsed,
          protocol: record.name || parsed.protocol || "",
          recordIndex: record.index ?? null,
          source: source("protocol-game-event", "server-protocol", {
            protocol: record.name || parsed.protocol || "",
            recordIndex: record.index ?? null
          })
        });
      }
      const categories = Array.from(parsed.skillRule?.categories || []).map((item) => typeof item === "string" ? item : item?.id).filter(Boolean);
      const result = model.observeMove({
        from: parsed.from,
        to: parsed.to,
        cardIds: Array.from(parsed.cards || []).map((card) => Number(card?.id || 0)).filter((id) => id > 0),
        count: Number(parsed.count || 0),
        categories,
        skillRule: parsed.skillRule,
        skillId: Number(parsed.skillId || 0),
        protocol: record.name || parsed.protocol || "",
        recordIndex: record.index ?? null,
        moveType: parsed.moveType ?? null,
        srcSeat: parsed.srcSeat ?? null,
        context: parsed.context,
        movementId: parsed.movementId || parsed.moveId || null,
        movementAttemptId: parsed.movementAttemptId || parsed.attemptId || null,
        movementGroupId: parsed.movementGroupId || parsed.moveGroupId || parsed.batchId || null,
        sequenceIndex: parsed.sequenceIndex ?? parsed.order ?? null,
        cardDetails: parsed.cardDetails || parsed.perCard || parsed.cardMovements || null,
        positions: parsed.positions || null,
        zoneParams: parsed.zoneParams || null,
        source: source("protocol-card-move", "server-protocol", {
          protocol: record.name || parsed.protocol || "",
          recordIndex: record.index ?? null,
          skillId: Number(parsed.skillId || 0),
          identitySource: parsed.identitySource || "unlisted"
        })
      });
      runtimeState.lastResolution = result;
      if (runtimeState.activeScene) syncDeckCount({ scene: runtimeState.activeScene }, { reason: "post-protocol-runtime-count" });
      runtimeState.lastError = "";
      return result;
    } catch (error) {
      runtimeState.lastError = String(error?.stack || error);
      return null;
    }
  }

  function observeProtocolPhysicalCardDefinitions(parsed, record) {
    const candidates = [
      ...(Array.isArray(parsed.cards) ? parsed.cards : []),
      ...(parsed.card ? [parsed.card] : [])
    ];
    const seen = new Set();
    for (const card of candidates) {
      const cardId = Number(card?.id || card?.protocolDefinition?.id || 0);
      const definition = card?.protocolDefinition;
      if (!card?.definitionObservedFromProtocol || cardId <= 0 || !definition || seen.has(cardId)) continue;
      seen.add(cardId);
      const existing = model.physicalCardDefinition(cardId)?.card || null;
      if (protocolDefinitionMatches(existing, definition)) continue;
      model.observePhysicalCardDefinition({
        cardId,
        definition,
        context: parsed.context,
        reason: "server-packet-carried-physical-card-attributes",
        source: source("protocol-physical-card-definition", "server-protocol", {
          protocol: record.name || parsed.protocol || "",
          recordIndex: record.index ?? null
        })
      });
    }
  }

  function protocolDefinitionMatches(existing, definition) {
    if (!existing || !definition) return false;
    for (const [field, value] of Object.entries(definition)) {
      if (field === "id") continue;
      if (field === "suit") {
        if (protocolSuitCode(value) !== Number(existing.suit || 0)) return false;
        continue;
      }
      if (["number", "typeOriginal", "subtype", "spellId"].includes(field)) {
        if (Number(value) !== Number(existing[field])) return false;
        continue;
      }
      if (String(value) !== String(existing[field] ?? "")) return false;
    }
    return true;
  }

  function protocolSuitCode(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return {
      "1": 1,
      "♥": 1,
      heart: 1,
      hearts: 1,
      "2": 2,
      "♦": 2,
      diamond: 2,
      diamonds: 2,
      "3": 3,
      "♠": 3,
      spade: 3,
      spades: 3,
      "4": 4,
      "♣": 4,
      club: 4,
      clubs: 4
    }[normalized] || 0;
  }

  function beginSession(context = {}, reason = "new-table-session") {
    const scene = context.scene || runtimeState.activeScene;
    runtimeState.activeScene = scene;
    runtimeState.activeManager = scene?.manager || null;
    runtimeState.sessionSequence++;
    runtimeState.handSignatures = {};
    runtimeState.publicZoneSignatures = {};
    runtimeState.publicNamedZoneDescriptors = {};
    runtimeState.publicNamedStateDescriptors = {};
    runtimeState.lastDeckCount = null;
    runtimeState.lastResolution = null;
    model.configureGame({
      catalog: root.sources.configState?.cardDict || {},
      sessionKey: `runtime-table-${runtimeState.sessionSequence}`,
      reason
    });
  }

  function resolveDeckDefinition(context) {
    if (model.state.deck.definition.known) return model.state.deck.definition;
    const manager = context?.scene?.manager;
    const explicit = firstPositiveIdArray(manager, [
      "GameCardIds",
      "gameCardIds",
      "PlayCardPile",
      "playCardPile",
      "InitialCardPileIds",
      "initialCardPileIds"
    ]);
    if (explicit.length) {
      model.setDeckDefinition(explicit, source("runtime-explicit-deck-definition", "runtime-public"), {
        label: "runtime-explicit"
      });
      runtimeState.lastResolution = { status: "resolved", kind: "runtime-explicit", count: explicit.length };
      return model.state.deck.definition;
    }

    const ruleId = ruleIdFromMode(context?.mode);
    const gameRuleDeck = root.sources.configState?.gameRuleDecks?.[ruleId] || null;
    if (gameRuleDeck?.cardIds?.length) {
      model.setDeckDefinition(gameRuleDeck.cardIds, source(`config-game-rule-${ruleId}-deck`, "runtime-public", {
        configSource: gameRuleDeck.source || ""
      }), {
        ruleId,
        label: gameRuleDeck.label || `game-rule-${ruleId}`
      });
      runtimeState.lastResolution = { status: "resolved", kind: `rule-${ruleId}`, count: gameRuleDeck.cardIds.length };
      return model.state.deck.definition;
    }

    runtimeState.lastResolution = {
      status: "unresolved",
      reason: "mode-deck-definition-not-proven",
      ruleId,
      mode: context?.mode || null
    };
    return model.state.deck.definition;
  }

  function configureDeck(config = {}) {
    const ids = Array.from(config.cardIds || config.deckCardIds || []);
    const count = model.setDeckDefinition(ids, config.source || source("manual-deck-definition", "runtime-public"), {
      mode: config.mode || null,
      ruleId: config.ruleId ?? null,
      label: config.label || "manual"
    });
    if (config.deckCount != null) {
      model.observeDeckCount(config.deckCount, source("manual-deck-count", "runtime-public"), {
        initial: model.state.deck.count == null
      });
    }
    runtimeState.lastResolution = { status: count ? "resolved" : "unresolved", kind: "manual", count };
    return model.snapshot();
  }

  function syncDeckCount(context, options = {}) {
    const count = readDeckCount(context?.scene?.manager);
    if (count == null) return;
    const observationChanged = count !== runtimeState.lastDeckCount;
    const modelMismatch = count !== model.state.deck.count;
    if (!observationChanged && !modelMismatch) return;
    model.observeDeckCount(count, source("table-manager-deck-count", "runtime-public"), {
      initial: options.initial === true || model.state.deck.count == null,
      reason: options.reason || (modelMismatch ? "table-manager-reconcile" : "table-manager-sync")
    });
    runtimeState.lastDeckCount = count;
  }

  function syncHands(context) {
    const managerSeats = Array.from(context?.managerSeats || context?.scene?.manager?.seats || []);
    for (let managerSeatIndex = 0; managerSeatIndex < managerSeats.length; managerSeatIndex++) {
      const seat = managerSeats[managerSeatIndex];
      if (!seat) continue;
      const rawCards = Array.from(seat.handCards || []);
      const cardIds = rawCards.map(runtimeCardId).filter((id) => id > 0);
      const publicCount = nonNegativeInteger(seat.handCardCount ?? seat.HandCardCount);
      const self = managerSeatIndex === Number(context.selfSeatIndex);
      const count = self
        ? Math.max(publicCount ?? 0, rawCards.length, cardIds.length)
        : Math.max(publicCount ?? 0, cardIds.length);
      const visibility = self
        ? "self"
        : seat.canViewHandCard === true
          ? "authorized"
          : cardIds.length
            ? "runtime-server-exposed"
            : "opaque";
      const signature = JSON.stringify([count, cardIds, visibility, seat.isDead === true || seat.IsDead === true]);
      if (runtimeState.handSignatures[managerSeatIndex] === signature) continue;
      runtimeState.handSignatures[managerSeatIndex] = signature;
      model.observeHand({
        seatIndex: managerSeatIndex,
        count: seat.isDead === true || seat.IsDead === true ? 0 : count,
        cardIds: seat.isDead === true || seat.IsDead === true ? [] : cardIds,
        complete: count === cardIds.length,
        visibility,
        source: source("runtime-seat-hand", "runtime-seat-hand", {
          seatIndex: managerSeatIndex,
          visibility,
          canViewHandCard: seat.canViewHandCard === true
        })
      });
    }
  }

  function syncPublicZones(publicZones) {
    if (!Array.isArray(publicZones?.seats)) return;
    const observedNamedKeys = new Set();
    const observedNamedStateKeys = new Set();
    const observedSeats = new Set();
    for (const seat of publicZones?.seats || []) {
      observedSeats.add(Number(seat.seatIndex));
      for (const [zoneName, zone] of Object.entries(seat.zones || {})) {
        const zoneKey = zoneName === "equip"
          ? `equip:${seat.seatIndex}`
          : zoneName === "judge"
            ? `judge:${seat.seatIndex}`
            : `general:${seat.seatIndex}`;
        const cardIds = Array.from(zone.cards || []).map((card) => Number(card?.id || 0)).filter((id) => id > 0);
        const signature = JSON.stringify([zone.count, cardIds, zone.complete]);
        if (runtimeState.publicZoneSignatures[zoneKey] === signature) continue;
        runtimeState.publicZoneSignatures[zoneKey] = signature;
        model.observeZone({
          zoneKey,
          count: Number(zone.count || cardIds.length),
          cardIds,
          complete: zone.complete === true || Number(zone.count || 0) === cardIds.length,
          visibility: "public",
          source: source(zone.rule || "runtime-public-zone", "runtime-public", {
            seatIndex: seat.seatIndex,
            zoneName,
            fields: zone.fields || []
          })
        });
      }

      for (const zone of seat.namedZones || []) {
        if (zone.representationKind && zone.representationKind !== "physical-card-zone") {
          const stateObservation = namedStateObservation(seat, zone);
          if (!stateObservation) continue;
          const stateSyncKey = `named-state:${stateObservation.key}`;
          observedNamedStateKeys.add(stateSyncKey);
          const stateSignature = JSON.stringify([
            stateObservation.value,
            stateObservation.skillId,
            stateObservation.metadata
          ]);
          runtimeState.publicNamedStateDescriptors[stateSyncKey] = stateObservation;
          if (runtimeState.publicZoneSignatures[stateSyncKey] === stateSignature) continue;
          runtimeState.publicZoneSignatures[stateSyncKey] = stateSignature;
          model.updateRuleState(stateObservation);
          continue;
        }
        const observation = namedZoneObservation(seat, zone);
        if (!observation) continue;
        const syncKey = namedZoneSyncKey(observation);
        observedNamedKeys.add(syncKey);
        const signature = JSON.stringify([
          observation.count,
          observation.cardIds,
          observation.complete,
          observation.zoneKind,
          observation.pileKey,
          observation.zoneParam,
          observation.skillId,
          observation.hostCardId,
          observation.attachmentPolicy,
          observation.capacity,
          observation.ownerSeat,
          observation.ownershipKnown,
          observation.ordered,
          observation.orderKnown,
          observation.faceUp,
          observation.visibilityAudience,
          observation.observerSeats,
          observation.cardStates
        ]);
        runtimeState.publicNamedZoneDescriptors[syncKey] = observation;
        if (runtimeState.publicZoneSignatures[syncKey] === signature) continue;
        runtimeState.publicZoneSignatures[syncKey] = signature;
        model.observeNamedCardZone(observation);
      }
    }

    for (const [syncKey, previous] of Object.entries(runtimeState.publicNamedZoneDescriptors)) {
      if (!observedSeats.has(Number(previous.hostSeat)) || observedNamedKeys.has(syncKey)) continue;
      model.observeNamedCardZone({
        ...previous,
        count: 0,
        cardIds: [],
        cardStates: {},
        complete: true,
        replace: true,
        source: source("runtime-public-named-zone-cleared", "runtime-public", {
          seatIndex: previous.hostSeat,
          pileKey: previous.pileKey,
          zoneParam: previous.zoneParam ?? null,
          skillId: previous.skillId ?? null
        })
      });
      delete runtimeState.publicNamedZoneDescriptors[syncKey];
      delete runtimeState.publicZoneSignatures[syncKey];
    }

    for (const [syncKey, previous] of Object.entries(runtimeState.publicNamedStateDescriptors)) {
      if (!observedSeats.has(Number(previous.ownerSeat)) || observedNamedStateKeys.has(syncKey)) continue;
      model.updateRuleState({
        ...previous,
        value: 0,
        metadata: { ...(previous.metadata || {}), cleared: true },
        source: source("runtime-public-outside-state-cleared", "runtime-public", {
          seatIndex: previous.ownerSeat,
          skillId: previous.skillId ?? null
        })
      });
      delete runtimeState.publicNamedStateDescriptors[syncKey];
      delete runtimeState.publicZoneSignatures[syncKey];
    }
  }

  function namedStateObservation(seat, zone) {
    const pileKey = String(zone?.pileKey || zone?.ruleIdentityKey || "").trim();
    if (!pileKey) return null;
    const hostSeat = Number(zone.hostSeat ?? seat.seatIndex);
    const identity = canonicalRuntimeKey({
      hostSeat,
      pileKey,
      zoneParam: zone.zoneParam ?? null,
      skillId: Number(zone.skillId || 0) || null
    });
    return {
      key: `runtime-outside-entry:${identity}`,
      kind: "counter",
      operation: "set",
      value: Math.max(0, Number(zone.count || 0)),
      lifecycle: "game",
      skillId: Number(zone.skillId || 0) || null,
      ownerSeat: hostSeat,
      ruleIdentityKey: zone.ruleIdentityKey || null,
      metadata: {
        representationKind: zone.representationKind || "unresolved-outside-entry",
        pileKey,
        zoneParam: zone.zoneParam ?? null,
        fieldName: zone.fieldName || null,
        path: zone.path || null,
        physicalMembershipApplied: false
      },
      source: source(zone.rule || "runtime-public-outside-state", "runtime-public", {
        seatIndex: hostSeat,
        pileKey,
        zoneParam: zone.zoneParam ?? null,
        skillId: Number(zone.skillId || 0) || null,
        representationKind: zone.representationKind || "unresolved-outside-entry"
      })
    };
  }

  function namedZoneObservation(seat, zone) {
    const pileKey = String(zone?.pileKey || zone?.ruleIdentityKey || "").trim();
    if (!pileKey) return null;
    const cardIds = Array.from(zone.cardIds || zone.cards || [])
      .map((card) => Number(typeof card === "object" ? card?.id : card || 0))
      .filter((id) => id > 0);
    const observation = {
      zoneKey: zone.zoneKey || undefined,
      zoneKind: zone.zoneKind || "removed",
      pileKey,
      zoneParam: zone.zoneParam ?? null,
      skillId: Number(zone.skillId || 0) || null,
      ruleIdentityKey: zone.ruleIdentityKey || null,
      hostSeat: Number(zone.hostSeat ?? seat.seatIndex),
      hostArea: zone.hostArea || "general-card",
      hostGeneralId: zone.hostGeneralId ?? null,
      hostCardId: zone.hostCardId ?? null,
      attachmentPolicy: zone.attachmentPolicy || null,
      capacity: zone.capacity ?? null,
      controllerSeat: zone.controllerSeat ?? null,
      placedBySeat: zone.placedBySeat ?? null,
      ownerSeat: Object.prototype.hasOwnProperty.call(zone, "ownerSeat") ? zone.ownerSeat : null,
      ownershipKnown: zone.ownershipKnown === true,
      ordered: zone.ordered === true,
      orderKnown: zone.orderKnown === true,
      faceUp: zone.faceUp ?? null,
      visibility: zone.visibilityAudience || "runtime-observed",
      visibilityAudience: zone.visibilityAudience || "runtime-observed",
      observerSeats: Array.from(zone.observerSeats || []),
      cardStates: zone.cardStates || {},
      count: Math.max(Number(zone.count || 0), cardIds.length),
      cardIds,
      complete: zone.complete === true,
      replace: true,
      metadata: {
        ...(zone.metadata || {}),
        representationKind: zone.representationKind || "physical-card-zone",
        runtimeFieldName: zone.fieldName || null,
        runtimePath: zone.path || null
      },
      source: source(zone.rule || "runtime-public-named-zone", "runtime-public", {
        seatIndex: Number(zone.hostSeat ?? seat.seatIndex),
        pileKey,
        zoneParam: zone.zoneParam ?? null,
        skillId: Number(zone.skillId || 0) || null,
        fields: zone.fields || []
      })
    };
    return observation;
  }

  function namedZoneSyncKey(observation) {
    return `named:${canonicalRuntimeKey({
      zoneKind: observation.zoneKind,
      hostSeat: observation.hostSeat,
      pileKey: observation.pileKey,
      zoneParam: observation.zoneParam,
      skillId: observation.skillId,
      ruleIdentityKey: observation.ruleIdentityKey
    })}`;
  }

  function canonicalRuntimeKey(value) {
    return JSON.stringify(canonicalRuntimeValue(value));
  }

  function canonicalRuntimeValue(value) {
    if (Array.isArray(value)) return value.map(canonicalRuntimeValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalRuntimeValue(value[key])]));
  }

  function readDeckCount(manager) {
    if (!manager) return null;
    for (const value of [
      manager.CardPileCardCount,
      manager.cardPileCardCount,
      manager.CardPileCount,
      manager.cardPileCount,
      manager.cardPile?.length,
      manager.CardPile?.length
    ]) {
      const count = nonNegativeInteger(value);
      if (count != null) return count;
    }
    return null;
  }

  function ruleIdFromMode(mode) {
    for (const [key, value] of Object.entries(mode?.candidates || {})) {
      if (!/rule(?:type)?id/i.test(key)) continue;
      const number = Number(value);
      if (Number.isInteger(number) && number > 0) return number;
    }
    return null;
  }

  function firstPositiveIdArray(target, fields) {
    for (const field of fields) {
      const value = target?.[field];
      if (!Array.isArray(value) && !(value instanceof Set)) continue;
      const ids = Array.from(value).map(runtimeCardId).filter((id) => id > 0);
      if (ids.length) return Array.from(new Set(ids));
    }
    return [];
  }

  function runtimeCardId(value) {
    if (value == null) return 0;
    if (Number.isFinite(Number(value))) return Number(value);
    const raw = value.Card || value.card || value;
    return Number(
      raw.cardId ??
      raw.CardId ??
      raw.cardID ??
      raw.CardID ??
      raw.id ??
      raw.Id ??
      0
    );
  }

  function source(id, kind, detail = {}) {
    return { id, kind, ...detail };
  }

  function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
  }

  function skillKnowledgeFor(skillId) {
    const row = root.tracker.skillKnowledge?.skills?.[Number(skillId)] || null;
    return row ? JSON.parse(JSON.stringify(row)) : null;
  }

  function listResearchedSkillRules() {
    return Object.values(root.tracker.skillKnowledge?.skills || {}).map((row) => JSON.parse(JSON.stringify(row)));
  }

  function skillResearchCoverage() {
    return JSON.parse(JSON.stringify({
      generatedAt: root.tracker.skillKnowledge?.generatedAt || "",
      catalogVersion: root.tracker.skillKnowledge?.catalogVersion || null,
      coverage: root.tracker.skillKnowledge?.coverage || null,
      counts: root.tracker.skillKnowledge?.counts || null,
      embeddedReviewedSkills: Object.keys(root.tracker.skillKnowledge?.skills || {}).length
    }));
  }

  function applyResolvedSkillOperation(skillId, operation, context = {}) {
    const id = Number(skillId);
    const research = root.tracker.skillKnowledge?.skills?.[id] || null;
    if (!research) return { status: "unsupported", reason: "skill-not-semantically-reviewed", skillId: id };
    return model.applyOperation(
      { ...(operation || {}), skillId: id },
      {
        ...context,
        skillId: id,
        source: context.source || source("resolved-skill-operation", "rule-feedback", {
          skillId: id,
          reviewBatch: research.reviewBatch || ""
        })
      }
    );
  }

  Object.assign(root.tracker, {
    gameModel: model,
    gameModelRuntime: runtimeState,
    syncGameModel: syncContext,
    handleGameModelProtocolRecord: handleProtocolRecord,
    configureGameDeck: configureDeck,
    leaveGameModelBattle: leaveBattle,
    skillKnowledgeFor,
    listResearchedSkillRules,
    skillResearchCoverage,
    applyResolvedSkillOperation
  });
})();
