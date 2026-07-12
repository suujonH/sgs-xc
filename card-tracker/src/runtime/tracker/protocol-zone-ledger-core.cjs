const ZONE_NAMES = [
  "outside",
  "pile",
  "discard",
  "process",
  "mark",
  "hand",
  "equip",
  "judge",
  "popup",
  "shuffle",
  "swap",
  "discard-temp",
  "removed"
];

const DECK_ENDPOINT_CATEGORIES = new Set([
  "deck.top.reveal",
  "deck.bottom.reveal",
  "deck.top.put",
  "deck.bottom.put",
  "deck.random.put",
  "deck.shuffle",
  "draw.bottom"
]);

function makeProtocolZoneLedger(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const cardText = typeof options.cardText === "function" ? options.cardText : defaultCardText;
  const cardInfo = typeof options.cardInfo === "function" ? options.cardInfo : () => null;
  const maxEvents = positiveNumber(options.maxEvents, 120);
  const maxRecentCards = positiveNumber(options.maxRecentCards, 80);

  const state = {
    version: 0,
    resetAt: now(),
    resetReason: "",
    handledCount: 0,
    moveCount: 0,
    knownMoveCount: 0,
    unknownMoveCount: 0,
    cardCount: 0,
    knownLocationCount: 0,
    zoneCount: 0,
    lastUpdateAt: 0,
    lastError: "",
    cards: {},
    zones: {},
    deckEndpoint: makeEmptyDeckEndpoint(now()),
    events: []
  };

  function reset(reason = "reset") {
    if (!Object.keys(state.cards).length && !Object.keys(state.zones).length && state.resetReason === reason) return;
    state.version++;
    state.resetAt = now();
    state.resetReason = reason;
    state.lastUpdateAt = state.resetAt;
    state.cards = {};
    state.zones = {};
    state.deckEndpoint = makeEmptyDeckEndpoint(now(), reason);
    state.cardCount = 0;
    state.knownLocationCount = 0;
    state.zoneCount = 0;
    pushEvent({ type: "reset", reason });
  }

  function handleProtocolRecord(record) {
    state.handledCount++;
    try {
      const parsed = record?.parsed;
      if (parsed?.type !== "card:move") return null;
      return handleMove(record, parsed);
    } catch (error) {
      state.lastError = String(error?.stack || error);
      return null;
    }
  }

  function handleMove(record, parsed) {
    let cards = uniqueCards(parsed.cards || []);
    const count = Number(parsed.count || cards.length || 0);
    const from = normalizeEndpoint(parsed.from);
    const to = normalizeEndpoint(parsed.to);
    const endpointInference = inferDeckEndpointCards({ cards, count, from, to, record, parsed });
    if (!cards.length && endpointInference.cards.length) cards = endpointInference.cards;
    const unknownCount = Math.max(0, count - cards.length);
    const event = {
      type: "card-move",
      recordIndex: record?.index ?? null,
      protocol: record?.name || parsed.protocol || "",
      msgId: parsed.msgId ?? null,
      skillId: Number(parsed.skillId || 0),
      from,
      to,
      count,
      knownCardIds: cards.map((card) => card.id),
      unknownCount,
      time: now()
    };

    state.moveCount++;
    if (cards.length) state.knownMoveCount++;
    if (unknownCount > 0 || (!cards.length && count > 0)) state.unknownMoveCount++;

    for (const card of cards) {
      moveKnownCard(card, {
        record,
        parsed,
        from,
        to,
        sourceRule: endpointInference.sourceRule || "protocol-listed-card-id"
      });
    }
    if ((unknownCount > 0 || (!cards.length && count > 0)) && from) {
      invalidateZoneKnownLocations(from, "unknown-source-move", record, parsed, { from, to, count, unknownCount });
    }
    updateDeckEndpoint(record, parsed, cards, {
      from,
      to,
      count,
      unknownCount,
      inferredEndpoint: endpointInference.endpoint,
      inferredReason: endpointInference.reason
    });
    pushEvent(event);
    refreshCounts();
    state.lastUpdateAt = now();
    return event;
  }

  function moveKnownCard(card, context) {
    const timestamp = now();
    const id = Number(card.id);
    const existing = state.cards[id] || null;
    const previousZone = existing?.zone || null;
    removeFromAllZones(id);

    const source = protocolSource(context.record, context.parsed, context.to, context.sourceRule);
    const next = {
      id,
      card: normalizeCard(card),
      zone: context.to || null,
      previousZone,
      firstSeenAt: existing?.firstSeenAt || timestamp,
      lastSeenAt: timestamp,
      source,
      sourceHistory: appendSource(existing?.sourceHistory || [], source)
    };
    state.cards[id] = next;

    if (context.to) {
      const zone = ensureZone(context.to);
      zone.cards[id] = true;
      zone.updatedAt = timestamp;
    }
  }

  function removeFromAllZones(cardId) {
    const key = String(Number(cardId));
    for (const zone of Object.values(state.zones)) {
      if (zone.cards[key]) {
        delete zone.cards[key];
        zone.updatedAt = now();
      }
    }
  }

  function invalidateZoneKnownLocations(endpoint, reason, record, parsed, move) {
    const zone = endpoint ? state.zones[endpoint.key] : null;
    if (!zone) return 0;
    const ids = Object.keys(zone.cards || {}).map(Number).filter((id) => id > 0);
    if (!ids.length) return 0;
    const timestamp = now();
    for (const id of ids) {
      delete zone.cards[String(id)];
      const card = state.cards[id];
      if (card?.zone?.key === endpoint.key) {
        card.previousZone = card.zone;
        card.zone = null;
        card.lastSeenAt = timestamp;
      }
    }
    zone.updatedAt = timestamp;
    pushEvent({
      type: "invalidate-zone",
      reason,
      recordIndex: record?.index ?? null,
      protocol: record?.name || parsed?.protocol || "",
      msgId: parsed?.msgId ?? null,
      skillId: Number(parsed?.skillId || 0),
      zone: endpoint,
      count: Number(move?.count || 0),
      unknownCount: Number(move?.unknownCount || 0),
      invalidatedIds: ids
    });
    return ids.length;
  }

  function inferDeckEndpointCards({ cards, count, from, to, record, parsed }) {
    const empty = { cards: [], endpoint: "", reason: "", sourceRule: "" };
    if (cards.length || count <= 0 || !isDeckEndpoint(from) || !to) return empty;

    const categories = categoryIds(parsed?.skillRule);
    if (categories.includes("deck.shuffle") || categories.includes("deck.random.put") || categories.includes("deck.search") || categories.includes("random.card.gain")) {
      return empty;
    }
    if (!categories.includes("draw.count") && !categories.includes("draw.bottom") && !categories.includes("judgement.any")) {
      return empty;
    }

    const endpoint = categories.includes("draw.bottom") ? "bottom" : "top";
    const available = state.deckEndpoint[endpoint] || [];
    const ids = available.slice(0, count).map(Number).filter((id) => id > 0);
    if (!ids.length) return empty;

    const reason = categories.includes("draw.bottom")
      ? "draw.bottom"
      : categories.includes("draw.count")
        ? "draw.count"
        : categories.includes("judgement.any")
          ? "judgement.any"
          : "known-deck-endpoint";
    return {
      cards: ids.map((id) => inferredDeckCard(id, endpoint, reason, record, parsed, to)),
      endpoint,
      reason,
      sourceRule: "protocol-inferred-deck-endpoint"
    };
  }

  function inferredDeckCard(id, endpoint, reason, record, parsed, to) {
    const existing = state.cards[id]?.card || {};
    const info = cardInfo(id) || {};
    return {
      ...existing,
      ...info,
      id,
      source: {
        rule: "protocol-inferred-deck-endpoint",
        sourceKind: "protocol-zone-ledger",
        origin: "protocol-zone-ledger",
        endpoint,
        reason,
        seatIndex: Number(to?.seat ?? -1),
        protocol: record?.name || parsed?.protocol || "",
        msgId: parsed?.msgId ?? null,
        recordIndex: record?.index ?? null,
        skillId: Number(parsed?.skillId || 0)
      }
    };
  }

  function ensureZone(endpoint) {
    if (!state.zones[endpoint.key]) {
      state.zones[endpoint.key] = {
        key: endpoint.key,
        code: endpoint.code,
        zone: endpoint.zone,
        seat: endpoint.seat,
        cards: {},
        updatedAt: now()
      };
    }
    return state.zones[endpoint.key];
  }

  function snapshot() {
    return {
      ...summary(),
      zones: zoneRows(),
      recentCards: recentCards()
    };
  }

  function summary() {
    refreshCounts();
    return {
      version: state.version,
      resetAt: state.resetAt,
      resetReason: state.resetReason,
      handledCount: state.handledCount,
      moveCount: state.moveCount,
      knownMoveCount: state.knownMoveCount,
      unknownMoveCount: state.unknownMoveCount,
      cardCount: state.cardCount,
      knownLocationCount: state.knownLocationCount,
      zoneCount: state.zoneCount,
      lastUpdateAt: state.lastUpdateAt,
      lastError: state.lastError,
      byZone: countBy(zoneRows(), (zone) => zone.zone, (zone) => zone.count),
      sources: countBy(Object.values(state.cards), (card) => card.source?.rule || "missing"),
      deckEndpoint: deckEndpointSnapshot(),
      recentEvents: state.events.slice(-20)
    };
  }

  function zoneRows() {
    return Object.values(state.zones)
      .map((zone) => {
        const cardIds = Object.keys(zone.cards).map(Number).filter((id) => id > 0).sort((a, b) => a - b);
        return {
          key: zone.key,
          code: zone.code,
          zone: zone.zone,
          seat: zone.seat,
          count: cardIds.length,
          cardIds
        };
      })
      .filter((zone) => zone.count > 0)
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  function recentCards() {
    return Object.values(state.cards)
      .sort((a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0) || a.id - b.id)
      .slice(0, maxRecentCards)
      .map((entry) => ({
        id: entry.id,
        card: entry.card,
        zone: entry.zone,
        previousZone: entry.previousZone,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        source: entry.source,
        sourceHistory: entry.sourceHistory
      }));
  }

  function pushEvent(event) {
    state.events.push(event);
    if (state.events.length > maxEvents) state.events.splice(0, state.events.length - maxEvents);
  }

  function refreshCounts() {
    const zones = zoneRows();
    state.cardCount = Object.keys(state.cards).length;
    state.knownLocationCount = Object.values(state.cards).filter((card) => card.zone).length;
    state.zoneCount = zones.length;
  }

  function updateDeckEndpoint(record, parsed, cards, move) {
    const categories = categoryIds(parsed?.skillRule);
    const touchesDeck = isDeckEndpoint(move.from) || isDeckEndpoint(move.to);
    if (!touchesDeck) return;

    const topBefore = state.deckEndpoint.top.slice();
    removeCardsFromEndpoints(cards.map((card) => card.id));

    if (categories.includes("deck.shuffle")) {
      invalidateDeckEndpoint("deck.shuffle", record, parsed, move);
      return;
    }
    if (categories.includes("deck.random.put")) {
      invalidateDeckEndpoint("deck.random.put", record, parsed, move);
      return;
    }
    if (move.unknownCount > 0 || (!cards.length && move.count > 0)) {
      invalidateDeckEndpoint("unknown-deck-move", record, parsed, move);
      return;
    }

    if (!cards.length) return;
    if (categories.includes("deck.top.reveal")) {
      setDeckEndpoint("top", cards, "deck.top.reveal", record, parsed, move);
      return;
    }
    if (categories.includes("deck.bottom.reveal")) {
      setDeckEndpoint("bottom", cards, "deck.bottom.reveal", record, parsed, move);
      return;
    }
    if (categories.includes("deck.top.put") && isDeckEndpoint(move.to)) {
      setDeckEndpoint("top", cards, "deck.top.put", record, parsed, move);
      return;
    }
    if (categories.includes("deck.bottom.put") && isDeckEndpoint(move.to)) {
      setDeckEndpoint("bottom", cards, "deck.bottom.put", record, parsed, move);
      return;
    }
    if (categories.includes("draw.bottom") && isDeckEndpoint(move.from)) {
      consumeDeckEndpoint("bottom", cards, "draw.bottom", record, parsed, move);
      return;
    }
    if (categories.includes("draw.count") && isDeckEndpoint(move.from)) {
      consumeDeckTopForDrawCount(cards, topBefore, record, parsed, move);
      return;
    }
    if (move.inferredEndpoint) {
      consumeDeckEndpoint(move.inferredEndpoint, cards, move.inferredReason || "known-deck-endpoint", record, parsed, move);
      return;
    }
    if (isDeckEndpoint(move.to) && categoryIds(parsed?.skillRule).some((id) => DECK_ENDPOINT_CATEGORIES.has(id)) === false) {
      invalidateDeckEndpoint("non-endpoint-deck-insert", record, parsed, move);
    }
  }

  function setDeckEndpoint(endpoint, cards, reason, record, parsed, move) {
    const ids = cards.map((card) => Number(card.id)).filter((id) => id > 0);
    if (!ids.length) return;
    const timestamp = now();
    state.deckEndpoint.version++;
    state.deckEndpoint[endpoint] = ids;
    state.deckEndpoint[`${endpoint}Source`] = deckEndpointSource(endpoint, reason, record, parsed, move);
    state.deckEndpoint.lastUpdateAt = timestamp;
    state.deckEndpoint.lastReason = reason;
    pushDeckEndpointEvent({ type: "set", endpoint, reason, ids, record, parsed, move, time: timestamp });
  }

  function consumeDeckEndpoint(endpoint, cards, reason, record, parsed, move) {
    const ids = cards.map((card) => Number(card.id)).filter((id) => id > 0);
    if (!ids.length) {
      invalidateDeckEndpoint(`${reason}:unknown`, record, parsed, move);
      return;
    }
    removeCardsFromEndpoints(ids);
    const timestamp = now();
    state.deckEndpoint.version++;
    state.deckEndpoint.lastUpdateAt = timestamp;
    state.deckEndpoint.lastReason = reason;
    pushDeckEndpointEvent({ type: "consume", endpoint, reason, ids, record, parsed, move, time: timestamp });
  }

  function consumeDeckTopForDrawCount(cards, topBefore, record, parsed, move) {
    const ids = cards.map((card) => Number(card.id)).filter((id) => id > 0);
    if (!ids.length || !topBefore.length) return;
    if (!matchesKnownTopDraw(topBefore, ids)) {
      invalidateDeckEndpoint("draw.count:top-mismatch", record, parsed, move);
      return;
    }
    const timestamp = now();
    state.deckEndpoint.version++;
    state.deckEndpoint.lastUpdateAt = timestamp;
    state.deckEndpoint.lastReason = "draw.count";
    pushDeckEndpointEvent({ type: "consume", endpoint: "top", reason: "draw.count", ids, record, parsed, move, time: timestamp });
  }

  function matchesKnownTopDraw(topBefore, ids) {
    const compareLength = Math.min(topBefore.length, ids.length);
    for (let index = 0; index < compareLength; index++) {
      if (Number(topBefore[index]) !== Number(ids[index])) return false;
    }
    return true;
  }

  function invalidateDeckEndpoint(reason, record, parsed, move) {
    const hadKnown = state.deckEndpoint.top.length > 0 || state.deckEndpoint.bottom.length > 0;
    state.deckEndpoint.version++;
    state.deckEndpoint.top = [];
    state.deckEndpoint.bottom = [];
    state.deckEndpoint.topSource = null;
    state.deckEndpoint.bottomSource = null;
    state.deckEndpoint.invalidationCount++;
    state.deckEndpoint.lastInvalidationReason = reason;
    state.deckEndpoint.lastUpdateAt = now();
    state.deckEndpoint.lastReason = reason;
    pushDeckEndpointEvent({
      type: "invalidate",
      endpoint: "all",
      reason,
      ids: [],
      hadKnown,
      record,
      parsed,
      move,
      time: state.deckEndpoint.lastUpdateAt
    });
  }

  function removeCardsFromEndpoints(ids) {
    const remove = new Set((ids || []).map(Number).filter((id) => id > 0));
    if (!remove.size) return;
    state.deckEndpoint.top = state.deckEndpoint.top.filter((id) => !remove.has(id));
    state.deckEndpoint.bottom = state.deckEndpoint.bottom.filter((id) => !remove.has(id));
  }

  function deckEndpointSource(endpoint, reason, record, parsed, move) {
    return {
      rule: "protocol-listed-deck-endpoint",
      sourceKind: "protocol",
      origin: "protocol",
      endpoint,
      reason,
      protocol: record?.name || parsed?.protocol || "",
      msgId: parsed?.msgId ?? null,
      recordIndex: record?.index ?? null,
      skillId: Number(parsed?.skillId || 0),
      from: move.from,
      to: move.to
    };
  }

  function pushDeckEndpointEvent(event) {
    const row = {
      type: event.type,
      endpoint: event.endpoint,
      reason: event.reason,
      recordIndex: event.record?.index ?? null,
      protocol: event.record?.name || event.parsed?.protocol || "",
      msgId: event.parsed?.msgId ?? null,
      skillId: Number(event.parsed?.skillId || 0),
      from: event.move?.from || null,
      to: event.move?.to || null,
      count: Number(event.move?.count || 0),
      unknownCount: Number(event.move?.unknownCount || 0),
      ids: event.ids || [],
      hadKnown: event.hadKnown === true,
      time: event.time || now()
    };
    state.deckEndpoint.recentEvents.push(row);
    if (state.deckEndpoint.recentEvents.length > 40) {
      state.deckEndpoint.recentEvents.splice(0, state.deckEndpoint.recentEvents.length - 40);
    }
  }

  function deckEndpointSnapshot() {
    return {
      version: state.deckEndpoint.version,
      top: state.deckEndpoint.top.slice(),
      bottom: state.deckEndpoint.bottom.slice(),
      topSource: state.deckEndpoint.topSource,
      bottomSource: state.deckEndpoint.bottomSource,
      knownTopCount: state.deckEndpoint.top.length,
      knownBottomCount: state.deckEndpoint.bottom.length,
      invalidationCount: state.deckEndpoint.invalidationCount,
      lastInvalidationReason: state.deckEndpoint.lastInvalidationReason,
      lastUpdateAt: state.deckEndpoint.lastUpdateAt,
      lastReason: state.deckEndpoint.lastReason,
      recentEvents: state.deckEndpoint.recentEvents.slice(-20)
    };
  }

  return {
    state,
    reset,
    handleProtocolRecord,
    snapshot,
    summary
  };

  function normalizeCard(card) {
    const info = card || {};
    return {
      id: Number(info.id || 0),
      name: info.name || "",
      suit: info.suit || "",
      rank: info.rank || "",
      color: info.color || "",
      number: info.number ?? null,
      spellId: Number(info.spellId || 0),
      text: info.text || info.ncn || cardText(info)
    };
  }
}

function makeEmptyDeckEndpoint(now, reason = "") {
  const timestamp = typeof now === "function" ? now() : Date.now();
  return {
    version: 0,
    top: [],
    bottom: [],
    topSource: null,
    bottomSource: null,
    invalidationCount: 0,
    lastInvalidationReason: "",
    lastUpdateAt: timestamp,
    lastReason: reason,
    recentEvents: []
  };
}

function normalizeEndpoint(endpoint) {
  const code = Number(endpoint?.code);
  if (!Number.isFinite(code)) return null;
  const seat = normalizeSeat(endpoint?.seat);
  return {
    key: `${code}-${seat}`,
    code,
    seat,
    zone: endpoint?.zone || ZONE_NAMES[code] || `?${code}`
  };
}

function normalizeSeat(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 255;
}

function protocolSource(record, parsed, to, sourceRule = "protocol-listed-card-id") {
  return {
    rule: sourceRule,
    sourceKind: sourceRule === "protocol-inferred-deck-endpoint" ? "protocol-zone-ledger" : "protocol",
    origin: sourceRule === "protocol-inferred-deck-endpoint" ? "protocol-zone-ledger" : "protocol",
    protocol: record?.name || parsed?.protocol || "",
    msgId: parsed?.msgId ?? null,
    recordIndex: record?.index ?? null,
    skillId: Number(parsed?.skillId || 0),
    zone: to?.zone || "",
    zoneKey: to?.key || ""
  };
}

function isDeckEndpoint(endpoint) {
  return Number(endpoint?.code) === 1 || Number(endpoint?.code) === 9;
}

function categoryIds(rule) {
  return Array.from(rule?.categories || []).map((item) => typeof item === "string" ? item : item?.id).filter(Boolean);
}

function appendSource(sources, source) {
  const list = Array.isArray(sources) ? sources.slice() : [];
  const signature = JSON.stringify(source);
  if (!list.some((item) => JSON.stringify(item) === signature)) list.push(source);
  return list.slice(-6);
}

function uniqueCards(cards) {
  const seen = new Set();
  const result = [];
  for (const card of cards || []) {
    const id = Number(card?.id || 0);
    if (id <= 0 || seen.has(id)) continue;
    seen.add(id);
    result.push({ ...card, id });
  }
  return result;
}

function defaultCardText(card) {
  if (!card) return "";
  return card.text || card.ncn || `${card.name || ""}${card.suit || ""}${card.rank || ""}`;
}

function countBy(items, keyFn, valueFn = () => 1) {
  const result = {};
  for (const item of items || []) {
    const key = keyFn(item) || "missing";
    result[key] = (result[key] || 0) + Number(valueFn(item) || 0);
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

module.exports = {
  makeProtocolZoneLedger,
  normalizeEndpoint,
  categoryIds,
  ZONE_NAMES
};
