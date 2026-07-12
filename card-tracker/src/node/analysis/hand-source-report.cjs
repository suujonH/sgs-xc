function buildHandSourceReport(value, validation = null) {
  const snapshot = value?.snapshot || (value?.config || value?.protocol ? value : null);
  if (!snapshot || typeof snapshot !== "object") {
    return {
      ok: false,
      error: "snapshot object is missing"
    };
  }

  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const visibleRows = Array.isArray(snapshot.visibleRows) ? snapshot.visibleRows : [];
  const ledgerCards = flattenCards(rows);
  const rawCards = flattenCards(visibleRows);
  const rawMaskCards = rawCards.filter((item) => item.source?.rule === "mask-visible-card-ui");
  const ledgerMaskCards = ledgerCards.filter((item) => isLedgerMaskCard(item.source));
  const rawMaskProblems = rawMaskCards.filter((item) => !isRawMaskSource(item.source)).map(problemForCard);
  const ledgerMaskProblems = ledgerMaskCards.filter((item) => !hasLedgerMaskHistory(item.source)).map(problemForCard);
  const ledgerProtocolAuthorizedCards = ledgerCards.filter((item) => isLedgerProtocolAuthorizedCard(item.source));
  const ledgerProtocolAuthorizedProblems = ledgerProtocolAuthorizedCards
    .filter((item) => !hasLedgerProtocolAuthorizedHistory(item.source))
    .map(problemForProtocolCard);

  return {
    ok: true,
    visible: snapshot.visible === true,
    reason: snapshot.reason || "",
    table: {
      visibilityRows: Array.isArray(snapshot.visibility) ? snapshot.visibility.length : 0,
      logRows: Array.isArray(snapshot.logs) ? snapshot.logs.length : 0
    },
    counts: {
      ledgerRows: rows.length,
      visibleRows: visibleRows.length,
      ledgerKnownCards: ledgerCards.length,
      rawVisibleCards: rawCards.length
    },
    sources: {
      ledgerRules: countBy(ledgerCards, (item) => item.source?.rule || "missing"),
      ledgerUnderlyingRules: countBy(ledgerCards, (item) => sourceDisplayRule(item.source)),
      rawRules: countBy(rawCards, (item) => item.source?.rule || "missing"),
      legacySources: countBy([...ledgerCards, ...rawCards], (item) => legacySourceOf(item.source))
    },
    mask: {
      rawCount: rawMaskCards.length,
      rawWithProvenance: rawMaskCards.length - rawMaskProblems.length,
      rawProblems: rawMaskProblems,
      ledgerCount: ledgerMaskCards.length,
      ledgerWithHistory: ledgerMaskCards.length - ledgerMaskProblems.length,
      ledgerProblems: ledgerMaskProblems,
      rawCheck: checkStatus(validation, "hand.maskSource.raw"),
      ledgerCheck: checkStatus(validation, "hand.maskSource.ledger"),
      examples: [...rawMaskCards.slice(0, 3), ...ledgerMaskCards.slice(0, 3)].map(exampleForCard)
    },
    protocolAuthorized: {
      ledgerCount: ledgerProtocolAuthorizedCards.length,
      ledgerWithHistory: ledgerProtocolAuthorizedCards.length - ledgerProtocolAuthorizedProblems.length,
      ledgerProblems: ledgerProtocolAuthorizedProblems,
      ledgerCheck: checkStatus(validation, "hand.protocolAuthorized.ledger"),
      examples: ledgerProtocolAuthorizedCards.slice(0, 6).map(exampleForCard)
    },
    seats: rows.map(reportRow)
  };
}

function flattenCards(rows) {
  const result = [];
  for (const row of rows || []) {
    for (const card of row.cards || []) {
      result.push({
        seatIndex: row.seatIndex,
        names: row.names || [],
        handCardCount: row.handCardCount,
        knownCount: row.knownCount,
        card,
        source: card?.source || null
      });
    }
  }
  return result;
}

function reportRow(row) {
  return {
    seatIndex: row.seatIndex,
    names: row.names || [],
    handCardCount: Number(row.handCardCount || 0),
    knownCount: Number(row.knownCount || 0),
    unknownCount: Number(row.unknownCount || 0),
    complete: row.complete === true,
    dirty: row.dirty === true,
    invalidationReason: row.invalidationReason || "",
    sources: row.sources || [],
    cards: (row.cards || []).map((card) => ({
      id: card?.id ?? null,
      text: card?.text || "",
      rule: card?.source?.rule || "",
      firstRule: card?.source?.firstRule || "",
      lastRule: card?.source?.lastRule || "",
      seenRules: Array.from(card?.source?.seenRules || []),
      legacySource: legacySourceOf(card?.source),
      origin: protocolSourceOf(card?.source)?.origin || lastSource(card?.source)?.origin || "",
      protocol: protocolSourceOf(card?.source)?.protocol || "",
      msgId: protocolSourceOf(card?.source)?.msgId ?? null,
      groupName: lastSource(card?.source)?.groupName || "",
      nodePath: lastSource(card?.source)?.node?.path || "",
      hasSourceHistory: Array.isArray(card?.source?.sourceHistory) && card.source.sourceHistory.length > 0
    }))
  };
}

function countBy(items, keyFn) {
  const result = {};
  for (const item of items || []) {
    const key = keyFn(item) || "missing";
    result[key] = (result[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function sourceDisplayRule(source) {
  if (!source) return "missing";
  if (source.rule === "known-hand-ledger") {
    return source.lastRule || source.lastSource?.rule || source.firstRule || "known-hand-ledger";
  }
  return source.rule || "missing";
}

function legacySourceOf(source) {
  const direct = source?.legacySource || "";
  if (direct) return direct;
  const last = lastSource(source);
  return last?.legacySource || "missing";
}

function lastSource(source) {
  if (!source) return null;
  if (source.lastSource) return source.lastSource;
  const history = Array.isArray(source.sourceHistory) ? source.sourceHistory : [];
  return history.length ? history[history.length - 1] : source;
}

function isLedgerMaskCard(source) {
  if (!source || source.rule !== "known-hand-ledger") return false;
  return sourceHasUnderlyingRule(source, "mask-visible-card-ui");
}

function hasLedgerMaskHistory(source) {
  if (!isLedgerMaskCard(source)) return false;
  const history = Array.isArray(source.sourceHistory) ? source.sourceHistory : [];
  return history.some(isRawMaskSource);
}

function isLedgerProtocolAuthorizedCard(source) {
  if (!source || source.rule !== "known-hand-ledger") return false;
  return sourceHasUnderlyingRule(source, "protocol-authorized-friend-hand");
}

function hasLedgerProtocolAuthorizedHistory(source) {
  if (!isLedgerProtocolAuthorizedCard(source)) return false;
  const history = Array.isArray(source.sourceHistory) ? source.sourceHistory : [];
  return history.some(isProtocolAuthorizedSource);
}

function sourceHasUnderlyingRule(source, rule) {
  return (
    source?.firstRule === rule ||
    source?.lastRule === rule ||
    Array.from(source?.seenRules || []).includes(rule)
  );
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

function problemForCard(item) {
  const source = item.source || {};
  const last = lastSource(source) || {};
  return {
    seatIndex: item.seatIndex,
    id: item.card?.id ?? null,
    text: item.card?.text || "",
    rule: source.rule || "",
    firstRule: source.firstRule || "",
    lastRule: source.lastRule || "",
    legacySource: legacySourceOf(source),
    missing: missingMaskFields(source.rule === "known-hand-ledger" ? last : source)
  };
}

function problemForProtocolCard(item) {
  const source = item.source || {};
  const protocolSource = protocolSourceOf(source) || lastSource(source) || {};
  return {
    seatIndex: item.seatIndex,
    id: item.card?.id ?? null,
    text: item.card?.text || "",
    rule: source.rule || "",
    firstRule: source.firstRule || "",
    lastRule: source.lastRule || "",
    legacySource: legacySourceOf(source),
    missing: missingProtocolAuthorizedFields(protocolSource)
  };
}

function missingMaskFields(source) {
  const missing = [];
  if (source?.legacySource !== "mask") missing.push("legacySource");
  if (source?.origin !== "laya-card-ui") missing.push("origin");
  if (!source?.mask) missing.push("mask");
  if (!source?.rect) missing.push("rect");
  if (!source?.node?.path) missing.push("node.path");
  if (!source?.groupNode?.path) missing.push("groupNode.path");
  return missing;
}

function missingProtocolAuthorizedFields(source) {
  const missing = [];
  if (source?.rule !== "protocol-authorized-friend-hand") missing.push("rule");
  if (source?.legacySource !== "protocol") missing.push("legacySource");
  if (source?.origin !== "protocol") missing.push("origin");
  if (!source?.protocol) missing.push("protocol");
  if (source?.msgId === undefined || source?.msgId === null) missing.push("msgId");
  return missing;
}

function exampleForCard(item) {
  const source = item.source || {};
  const last = lastSource(source) || {};
  const protocolSource = protocolSourceOf(source) || {};
  return {
    seatIndex: item.seatIndex,
    id: item.card?.id ?? null,
    text: item.card?.text || "",
    rule: source.rule || "",
    displayRule: sourceDisplayRule(source),
    legacySource: legacySourceOf(source),
    origin: protocolSource.origin || last.origin || "",
    protocol: protocolSource.protocol || "",
    msgId: protocolSource.msgId ?? null,
    groupName: last.groupName || "",
    nodePath: last.node?.path || "",
    bmpMaskAlpha: last.mask?.bmpMaskAlpha ?? null
  };
}

function protocolSourceOf(source) {
  const history = Array.isArray(source?.sourceHistory) ? source.sourceHistory : [];
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index]?.rule === "protocol-authorized-friend-hand") return history[index];
  }
  if (source?.lastSource?.rule === "protocol-authorized-friend-hand") return source.lastSource;
  if (source?.rule === "protocol-authorized-friend-hand") return source;
  return null;
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
  buildHandSourceReport,
  isRawMaskSource,
  isProtocolAuthorizedSource
};
