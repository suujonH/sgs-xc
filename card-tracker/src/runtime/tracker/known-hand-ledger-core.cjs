const {
  candidateProbabilityRules,
  candidateRulesForSkillRule
} = require("./candidate-rule-core.cjs");

function makeKnownHandLedger(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const cardText = typeof options.cardText === "function" ? options.cardText : defaultCardText;
  const seatIsDead = typeof options.seatIsDead === "function" ? options.seatIsDead : () => false;
  const knownCardsFromProtocolZone = typeof options.knownCardsFromProtocolZone === "function"
    ? options.knownCardsFromProtocolZone
    : () => [];
  const cardPool = typeof options.cardPool === "function"
    ? options.cardPool
    : () => options.cardPool || [];
  const minCandidateProbability = probabilityValue(options.minCandidateProbability, 0.75);

  const state = {
    version: 0,
    resetAt: now(),
    resetReason: "",
    lastUpdateAt: 0,
    rows: {},
    events: []
  };

  function reset(reason = "reset") {
    if (state.resetReason === reason && !Object.keys(state.rows).length) return;
    state.version++;
    state.resetAt = now();
    state.resetReason = reason;
    state.lastUpdateAt = state.resetAt;
    state.rows = {};
    pushEvent({ type: "reset", reason });
  }

  function pushEvent(event) {
    state.events.push({ time: now(), ...event });
    if (state.events.length > 200) state.events.splice(0, state.events.length - 200);
  }

  function factKey(card) {
    if (card?.id != null) return `id:${Number(card.id)}`;
    return `text:${card?.text || cardText(card) || ""}`;
  }

  function ensureRow(seatIndex) {
    const key = String(seatIndex);
    if (!state.rows[key]) {
      state.rows[key] = {
        seatIndex,
        names: [],
        handCardCount: 0,
        known: {},
        candidates: {},
        complete: false,
        dirty: false,
        invalidationReason: "",
        sources: [],
        updatedAt: now()
      };
    }
    return state.rows[key];
  }

  function compactSource(source) {
    if (!source) return null;
    const node = compactNode(source.node);
    const groupNode = compactNode(source.groupNode);
    const mask = source.mask ? {
      bmpMaskAlpha: source.mask.bmpMaskAlpha ?? null,
      maskAlpha: source.mask.maskAlpha ?? null,
      alpha: source.mask.alpha ?? null,
      cardAlpha: source.mask.cardAlpha ?? null,
      gray: source.mask.gray === true,
      selected: source.mask.selected === true,
      activated: source.mask.activated === true,
      hasMaskSignal: source.mask.hasMaskSignal === true
    } : undefined;
    const rect = source.rect ? {
      x: Number(source.rect.x || 0),
      y: Number(source.rect.y || 0),
      width: Number(source.rect.width || 0),
      height: Number(source.rect.height || 0)
    } : undefined;
    return {
      rule: source.rule || "",
      sourceKind: source.sourceKind || "",
      origin: source.origin || "",
      seatIndex: source.seatIndex,
      uiIndex: source.uiIndex,
      cardIndex: source.cardIndex,
      groupIndex: source.groupIndex,
      groupName: source.groupName,
      protocol: source.protocol,
      msgId: source.msgId,
      ...(node ? { node } : {}),
      ...(groupNode ? { groupNode } : {}),
      ...(mask ? { mask } : {}),
      ...(rect ? { rect } : {})
    };
  }

  function compactNode(node) {
    if (!node) return null;
    return {
      label: node.label || "",
      name: node.name || "",
      sceneName: node.sceneName || "",
      className: node.className || "",
      path: node.path || "",
      childIndex: Number.isFinite(Number(node.childIndex)) ? Number(node.childIndex) : null,
      x: Number(node.x || 0),
      y: Number(node.y || 0),
      width: Number(node.width || 0),
      height: Number(node.height || 0),
      visible: node.visible !== false,
      alpha: Number(node.alpha == null ? 1 : node.alpha)
    };
  }

  function normalizeCard(card, fallbackSource) {
    const text = card?.text || cardText(card);
    return {
      id: card?.id ?? null,
      name: card?.name || "",
      suit: card?.suit || "",
      rank: card?.rank || "",
      color: card?.color || "",
      number: card?.number ?? null,
      text,
      source: compactSource(card?.source || fallbackSource)
    };
  }

  function upsertFact(row, card, fallbackSource) {
    const normalized = normalizeCard(card, fallbackSource);
    if (!normalized.text && normalized.id == null) return false;
    const key = factKey(normalized);
    const timestamp = now();
    const existing = row.known[key];
    const source = normalized.source || null;
    if (existing) {
      existing.lastSeenAt = timestamp;
      existing.lastSource = source;
      existing.card = { ...existing.card, ...normalized };
      existing.sources = appendSource(existing.sources, source);
    } else {
      row.known[key] = {
        key,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        firstSource: source,
        lastSource: source,
        card: normalized,
        sources: source ? [source] : []
      };
    }
    row.updatedAt = timestamp;
    row.dirty = false;
    row.invalidationReason = "";
    return true;
  }

  function appendSource(sources, source) {
    if (!source) return sources || [];
    const list = Array.isArray(sources) ? sources.slice() : [];
    const signature = JSON.stringify(source);
    if (!list.some((item) => JSON.stringify(item) === signature)) list.push(source);
    return list.slice(-6);
  }

  function eventContext(record) {
    const parsed = record?.parsed || {};
    const rule = parsed.skillRule || {};
    return {
      recordIndex: record?.index ?? null,
      protocol: record?.name || parsed.protocol || "",
      msgId: parsed.msgId ?? null,
      skillId: Number(parsed.skillId || rule.id || 0),
      skillName: rule.name || "",
      categories: categoryIds(rule)
    };
  }

  function invalidateSeat(seatIndex, reason, clearKnown = true, record) {
    const row = ensureRow(seatIndex);
    if (clearKnown) {
      row.known = {};
      row.candidates = {};
    }
    row.complete = false;
    row.dirty = true;
    row.invalidationReason = reason;
    row.updatedAt = now();
    pushEvent({ type: "invalidate-seat", seatIndex, reason, clearKnown, ...eventContext(record) });
  }

  function removeKnownIds(seatIndex, ids, reason, record) {
    const row = ensureRow(seatIndex);
    let removed = 0;
    for (const id of ids) {
      const key = `id:${Number(id)}`;
      if (row.known[key]) {
        delete row.known[key];
        removed++;
      }
    }
    row.complete = false;
    row.updatedAt = now();
    pushEvent({ type: "remove-known", seatIndex, ids, removed, reason, ...eventContext(record) });
  }

  function addProtocolCards(seatIndex, cards, record, sourceRule = "protocol-hand-move") {
    const row = ensureRow(seatIndex);
    let added = 0;
    for (const card of cards || []) {
      if (upsertFact(row, card, {
        rule: sourceRule,
        seatIndex,
        protocol: record?.name,
        msgId: record?.parsed?.msgId
      })) {
        added++;
      }
    }
    row.complete = false;
    row.updatedAt = now();
    if (added) pushEvent({ type: "add-protocol-known", seatIndex, added, sourceRule, ...eventContext(record) });
  }

  function addCandidateFacts(seatIndex, candidates, record) {
    const row = ensureRow(seatIndex);
    let added = 0;
    for (const candidate of candidates || []) {
      const normalized = normalizeCandidate(candidate, seatIndex, record);
      if (!normalized || normalized.probability < minCandidateProbability) continue;
      const timestamp = now();
      const existing = row.candidates[normalized.key];
      if (existing) {
        existing.lastSeenAt = timestamp;
        existing.count += normalized.count;
        existing.candidate = normalized;
      } else {
        row.candidates[normalized.key] = {
          key: normalized.key,
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
          count: normalized.count,
          candidate: normalized
        };
      }
      added++;
    }
    if (!added) return 0;
    row.complete = false;
    row.updatedAt = now();
    row.dirty = false;
    row.invalidationReason = "";
    pushEvent({ type: "add-candidate", seatIndex, added, ...eventContext(record) });
    return added;
  }

  function normalizeCandidate(candidate, seatIndex, record) {
    const probability = probabilityValue(candidate?.probability, 0);
    const constraints = Array.isArray(candidate?.constraints) ? candidate.constraints.map(normalizeConstraint).filter(Boolean) : [];
    const alternatives = normalizeCandidateAlternatives(candidate?.alternatives);
    if (!constraints.length && !alternatives.length) return null;
    const text = candidate.text || candidate.display || candidateDisplay(constraints, alternatives);
    const sourceRule = candidate.sourceRule || "skill-text-candidate-filter";
    return {
      key: `candidate:${sourceRule}:${candidateKey(constraints, alternatives)}`,
      kind: "candidate",
      text,
      display: candidate.display || text,
      probability,
      count: Math.max(1, Number(candidate.count || 1)),
      constraints,
      alternatives: alternatives.map((set) => ({ constraints: set })),
      source: {
        rule: sourceRule,
        sourceKind: candidate.sourceKind || "skill-text",
        origin: record ? "protocol" : (candidate.origin || "runtime"),
        seatIndex,
        protocol: record?.name,
        msgId: record?.parsed?.msgId,
        recordIndex: record?.index ?? null,
        skillId: Number(record?.parsed?.skillId || 0),
        oldHex: candidate.oldHex || "",
        currentRule: candidate.currentRule || "",
        operate: candidate.operate || "",
        order: candidate.order || "",
        appliesTo: candidate.appliesTo || "any",
        skillName: candidate.skillName || "",
        baseDisplay: candidate.baseDisplay || "",
        poolSize: Number(candidate.poolSize || 0),
        hitCount: Number(candidate.hitCount || 0),
        zoneKey: candidate.zoneKey || "",
        possibleIds: Array.isArray(candidate.possibleIds) ? candidate.possibleIds.slice(0, 64) : []
      }
    };
  }

  function normalizeCandidateAlternatives(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((alternative) => {
        const constraints = Array.isArray(alternative) ? alternative : alternative?.constraints;
        return (Array.isArray(constraints) ? constraints : []).map(normalizeConstraint).filter(Boolean);
      })
      .filter((constraints) => constraints.length);
  }

  function candidateKey(constraints, alternatives) {
    return [
      constraints.map((item) => `${item.field}:${item.op || "in"}:${item.values.join("|")}`).join(";"),
      alternatives.map((set) => `(${set.map((item) => `${item.field}:${item.op || "in"}:${item.values.join("|")}`).join("&")})`).join("|")
    ].filter(Boolean).join("||");
  }

  function candidateDisplay(constraints, alternatives) {
    if (alternatives.length) {
      return alternatives.map((set) => set.map((item) => item.label).join(" / ")).join(" / ");
    }
    return constraints.map((item) => item.label).join("/");
  }

  function removeCandidateRules(row, sourceRules) {
    let removed = 0;
    for (const [key, entry] of Object.entries(row.candidates || {})) {
      const rule = entry?.candidate?.source?.rule || "";
      if (!sourceRules.has(rule)) continue;
      delete row.candidates[key];
      removed++;
    }
    if (removed) row.updatedAt = now();
    return removed;
  }

  function normalizeConstraint(value) {
    if (!value?.field) return null;
    const values = Array.isArray(value.values) ? value.values : [value.value];
    return {
      field: value.field,
      op: value.op || value.operator || "in",
      values: values.filter((item) => item !== "" && item != null),
      label: value.label || `${value.field}:${values.filter((item) => item !== "" && item != null).join("/")}`
    };
  }

  function replaceWithProtocolHandSnapshot(seatIndex, cards, record) {
    const row = ensureRow(seatIndex);
    const sourceRule = record?.parsed?.sourceRule || "protocol-authorized-friend-hand";
    const snapshot = {
      seatIndex,
      cards: (cards || []).map((card) => ({
        ...card,
        source: {
          rule: sourceRule,
          sourceKind: "protocol",
          origin: "protocol",
          seatIndex,
          protocol: record?.name,
          msgId: record?.parsed?.msgId
        }
      }))
    };
    replaceWithCompleteVisibleRow(row, snapshot);
    row.handCardCount = snapshot.cards.length;
    row.complete = true;
    row.updatedAt = now();
    pushEvent({ type: "replace-protocol-hand-snapshot", seatIndex, known: snapshot.cards.length, sourceRule, ...eventContext(record) });
  }

  function handleProtocolRecord(record) {
    const event = record?.parsed;
    if (!event) return;
    if (event.type === "hand:friendHandCards") {
      const seatIndex = Number(event.seat);
      if (Number.isInteger(seatIndex)) replaceWithProtocolHandSnapshot(seatIndex, event.cards, record);
      return;
    }
    if (event.type !== "card:move") return;
    const count = Number(event.count || 0);
    const ids = Array.from(event.cards || []).map((card) => Number(card.id)).filter((id) => id > 0);
    const inferredCards = ids.length ? [] : inferredKnownCards(record, event, count);
    const candidates = ids.length || inferredCards.length ? [] : candidateFactsFromMove(record, event, count);
    const unknownPart = Math.max(0, count - ids.length - inferredCards.length);
    const fromSeat = Number(event.from?.seat);
    const toSeat = Number(event.to?.seat);

    if (Number(event.from?.code) === 5 && Number.isInteger(fromSeat)) {
      if (ids.length) removeKnownIds(fromSeat, ids, "protocol-hand-from-known", record);
      if (unknownPart > 0 || (!ids.length && count > 0)) {
        invalidateSeat(fromSeat, "protocol-hand-from-unknown", true, record);
      }
    }

    if (Number(event.to?.code) === 5 && Number.isInteger(toSeat)) {
      if (ids.length) addProtocolCards(toSeat, event.cards, record);
      else if (inferredCards.length) addProtocolCards(toSeat, inferredCards, record, "protocol-inferred-deck-endpoint");
      else if (candidates.length) addCandidateFacts(toSeat, candidates, record);
      if (unknownPart > 0) {
        const row = ensureRow(toSeat);
        row.complete = false;
        row.updatedAt = now();
        pushEvent({ type: "add-unknown-hand-count", seatIndex: toSeat, count: unknownPart || count, ...eventContext(record) });
      }
    }
  }

  function candidateFactsFromMove(record, event, count) {
    if (count <= 0) return [];
    const fromCode = Number(event.from?.code);
    const toCode = Number(event.to?.code);
    if (toCode !== 5) return [];
    if (![1, 2, 5, 6, 7, 8, 10, 11].includes(fromCode)) return [];
    const directRules = candidateRulesForSkillRule({
      ...(event.skillRule || {}),
      id: event.skillRule?.id || event.skillId
    })
      .filter((rule) => candidateAppliesToMove(rule, event))
      .map((rule) => ({
        ...rule,
        count: Math.max(1, Number(rule.count || count)),
        text: rule.display,
        probability: probabilityValue(rule.probability, 0)
      }));
    const probabilityRules = directRules.flatMap((rule) =>
      candidateProbabilityRules(rule, cardPool, { minProbability: minCandidateProbability })
        .map((candidate) => ({
          ...candidate,
          count,
          text: candidate.display,
          probability: probabilityValue(candidate.probability, 0)
        }))
    );
    return [...directRules, ...probabilityRules];
  }

  function candidateAppliesToMove(rule, event) {
    const sourceZones = Array.isArray(rule?.sourceZones) ? rule.sourceZones.map(Number).filter(Number.isFinite) : [];
    if (sourceZones.length && !sourceZones.includes(Number(event.from?.code))) return false;
    const appliesTo = rule?.appliesTo || "any";
    if (appliesTo === "any") return true;
    const casterSeat = Number(event.srcSeat ?? event.casterSeat ?? event.skillRule?.casterSeat);
    if (!Number.isInteger(casterSeat)) return true;
    const fromSeat = Number(event.from?.seat);
    const toSeat = Number(event.to?.seat);
    if (appliesTo === "to-caster") return toSeat === casterSeat;
    if (appliesTo === "from-caster") return fromSeat === casterSeat;
    return true;
  }

  function inferredKnownCards(record, event, count) {
    if (count <= 0 || Number(event.from?.code) !== 1 || Number(event.to?.code) !== 5) return [];
    const seen = new Set();
    const result = [];
    for (const card of knownCardsFromProtocolZone(record, event) || []) {
      const id = Number(card?.id || 0);
      if (id <= 0 || seen.has(id)) continue;
      seen.add(id);
      result.push(card);
      if (result.length >= count) break;
    }
    return result;
  }

  function replaceWithCompleteVisibleRow(target, row) {
    const replacement = {};
    for (const card of row.cards || []) {
      const normalized = normalizeCard(card);
      const key = factKey(normalized);
      const timestamp = now();
      replacement[key] = {
        key,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        firstSource: normalized.source,
        lastSource: normalized.source,
        card: normalized,
        sources: normalized.source ? [normalized.source] : []
      };
    }
    target.known = replacement;
    target.candidates = {};
    target.complete = true;
    target.dirty = false;
    target.invalidationReason = "";
  }

  function ingestVisibleRows(context, visibleRows) {
    const seats = context?.seats || [];
    const seen = new Set();
    for (const row of visibleRows || []) {
      seen.add(row.seatIndex);
      const seat = seats[row.seatIndex];
      if (seatIsDead(seat)) {
        delete state.rows[String(row.seatIndex)];
        continue;
      }
      const target = ensureRow(row.seatIndex);
      target.names = row.names || [];
      target.handCardCount = Number(row.handCardCount || 0);
      target.sources = row.sources || [];
      if (target.handCardCount < Object.keys(target.known).length) {
        invalidateSeat(row.seatIndex, "public-hand-count-smaller-than-known", true);
      }
      for (const card of row.cards || []) upsertFact(target, card);
      const knownCount = Object.keys(target.known).length;
      if (target.handCardCount > 0 && row.knownCount >= target.handCardCount) {
        replaceWithCompleteVisibleRow(target, row);
      } else {
        target.complete = target.handCardCount > 0 && knownCount >= target.handCardCount;
      }
      target.updatedAt = now();
    }

    for (const [key, row] of Object.entries(state.rows)) {
      const seatIndex = Number(key);
      if (!seen.has(seatIndex) && seatIsDead(seats[seatIndex])) {
        delete state.rows[key];
      }
    }
    state.lastUpdateAt = now();
    return snapshotRows(context);
  }

  function ledgerCard(entry, row) {
    const card = entry.card || {};
    const seenRules = Array.from(new Set((entry.sources || []).map((source) => source?.rule).filter(Boolean)));
    const sourceHistory = (entry.sources || []).slice(-6);
    return {
      ...card,
      source: {
        rule: "known-hand-ledger",
        seatIndex: row.seatIndex,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        firstRule: entry.firstSource?.rule || "",
        lastRule: entry.lastSource?.rule || "",
        seenRules,
        lastSource: entry.lastSource || null,
        sourceHistory
      }
    };
  }

  function snapshotRows(context) {
    const seats = context?.seats || [];
    return Object.values(state.rows)
      .filter((row) => !seatIsDead(seats[row.seatIndex]))
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map((row) => {
        const cards = Object.values(row.known).map((entry) => ledgerCard(entry, row));
        const candidates = Object.values(row.candidates || {})
          .map((entry) => ledgerCandidate(entry, row))
          .filter((candidate) => candidate.probability >= minCandidateProbability);
        const handCardCount = Number(row.handCardCount || 0);
        return {
          seatIndex: row.seatIndex,
          names: row.names || [],
          handCardCount,
          knownCount: cards.length,
          candidateCount: candidates.length,
          unknownCount: Math.max(0, handCardCount - cards.length),
          complete: row.complete === true,
          dirty: row.dirty === true,
          invalidationReason: row.invalidationReason || "",
          cards,
          candidates,
          sources: row.sources || []
        };
      });
  }

  function ledgerCandidate(entry, row) {
    const candidate = entry.candidate || {};
    return {
      ...candidate,
      count: entry.count || candidate.count || 1,
      source: {
        rule: "known-hand-candidate-ledger",
        seatIndex: row.seatIndex,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        firstRule: candidate.source?.rule || "",
        lastRule: candidate.source?.rule || "",
        seenRules: [candidate.source?.rule].filter(Boolean),
        lastSource: candidate.source || null
      }
    };
  }

  function summary() {
    const rows = Object.values(state.rows);
    return {
      version: state.version,
      rowCount: rows.length,
      knownCount: rows.reduce((sum, row) => sum + Object.keys(row.known || {}).length, 0),
      candidateCount: rows.reduce((sum, row) => sum + Object.keys(row.candidates || {}).length, 0),
      dirtyRows: rows.filter((row) => row.dirty).map((row) => row.seatIndex),
      completeRows: rows.filter((row) => row.complete).map((row) => row.seatIndex),
      lastUpdateAt: state.lastUpdateAt,
      recentEvents: state.events.slice(-20)
    };
  }

  return {
    state,
    reset,
    handleProtocolRecord,
    ingestVisibleRows,
    snapshotRows,
    summary
  };
}

function categoryIds(rule) {
  return Array.from(rule?.categories || []).map((item) => typeof item === "string" ? item : item?.id).filter(Boolean);
}

function defaultCardText(card) {
  if (!card) return "";
  const name = card.name || "";
  const suit = card.suit || card.colorSym || "";
  const rank = card.rank || card.numStr || "";
  return `${name}${suit}${rank}`;
}

function probabilityValue(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 1) return Math.max(0, Math.min(1, number / 100));
  return Math.max(0, Math.min(1, number));
}

module.exports = { makeKnownHandLedger };
