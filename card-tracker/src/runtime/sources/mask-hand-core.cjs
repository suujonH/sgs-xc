function inspectMask(cardUi) {
  const values = {
    bmpMaskAlpha: numberOrNull(cardUi?.bmpMaskAlpha),
    maskAlpha: numberOrNull(cardUi?.mask?.alpha),
    alpha: numberOrNull(cardUi?.alpha),
    cardAlpha: numberOrNull(cardUi?.Card?.alpha),
    visible: cardUi?.visible !== false,
    cardVisible: cardUi?.Card?.visible !== false,
    gray: cardUi?.gray === true || cardUi?.isGray === true,
    selected: cardUi?.selected === true,
    activated: cardUi?.activated === true || cardUi?.activatedFlag === true
  };
  values.hasMaskSignal = Object.values(values).some((value) => value != null && value !== false);
  return values;
}

function collectMaskHandFacts(context = {}, options = {}) {
  const ops = normalizeOptions(options);
  const scene = context.scene;
  const seats = Array.isArray(context.seats) ? context.seats : [];
  const selfSeat = context.selfSeat;
  const rows = seats.map((seat, seatIndex) => ({
    seatIndex,
    names: context.seatNames?.[seatIndex] || [],
    handCardCount: ops.effectiveHandCount(scene, seat, selfSeat),
    known: new Map(),
    sources: []
  }));

  const addFacts = (seatIndex, facts, sourceName, sourceDetail = {}) => {
    const row = rows[seatIndex];
    if (!row || ops.seatIsDead(seats[seatIndex])) return;
    row.sources.push({ sourceName, count: facts.length, ...sourceDetail });
    for (const fact of facts) {
      const key = fact.id != null ? `id:${fact.id}` : `text:${fact.text}`;
      if (!row.known.has(key)) row.known.set(key, fact);
    }
  };

  const selfSeatIndex = seats.indexOf(selfSeat);
  if (selfSeatIndex >= 0 && !ops.seatIsDead(selfSeat)) {
    const cardUis = scene?.SelfSeatUi?.cardContainer?.cardUis || [];
    const selfGroup = {
      groupIndex: -1,
      groupName: "SelfSeatUi.cardContainer",
      sourceKind: "self-card-ui",
      groupNode: ops.nodeDebugInfo(scene?.SelfSeatUi?.cardContainer)
    };
    addFacts(
      selfSeatIndex,
      factsFromCardUis(cardUis, selfSeatIndex, "self-card-ui", selfGroup, ops),
      "self-card-ui",
      selfGroup
    );
    if (!rows[selfSeatIndex].known.size) {
      addFacts(selfSeatIndex, factsFromHandCards(selfSeat?.handCards, selfSeatIndex, "self-handCards", ops), "self-handCards");
    }
  }

  for (const [seatIndex, seat] of seats.entries()) {
    if (seat === selfSeat || ops.seatIsDead(seat)) continue;
    const handCount = ops.effectiveHandCount(scene, seat, selfSeat);
    const cards = Array.from(seat?.handCards || []);
    if (seat?.canViewHandCard === true && handCount > 0 && cards.length === handCount) {
      addFacts(seatIndex, factsFromHandCards(cards, seatIndex, "authorized-handCards", ops), "authorized-handCards");
    }
  }

  for (const group of findVisibleCardUiGroups(scene, seats, ops)) {
    const groupDetail = {
      groupIndex: group.groupIndex,
      groupName: ops.nodeDebugInfo(group.node)?.label || "",
      sourceKind: "mask",
      groupNode: ops.nodeDebugInfo(group.node)
    };
    addFacts(
      group.seatIndex,
      factsFromCardUis(group.cardUis, group.seatIndex, "mask-visible-card-ui", groupDetail, ops),
      "mask-visible-card-ui",
      groupDetail
    );
  }

  return rows.map((row) => {
    const knownCards = Array.from(row.known.values());
    return {
      seatIndex: row.seatIndex,
      names: row.names,
      handCardCount: row.handCardCount,
      knownCount: knownCards.length,
      unknownCount: Math.max(0, row.handCardCount - knownCards.length),
      cards: knownCards,
      sources: row.sources
    };
  });
}

function factsFromCardUis(cardUis, seatIndex, rule, groupDetail = {}, ops = normalizeOptions()) {
  const facts = [];
  for (const [uiIndex, cardUi] of Array.from(cardUis || []).entries()) {
    if (!canUseCardUi(cardUi, ops)) continue;
    const card = ops.runtimeCard(cardUi.Card || cardUi.card || cardUi._card);
    const fact = cardFact(card, seatIndex, rule, {
      sourceKind: groupDetail.sourceKind || "mask",
      origin: "laya-card-ui",
      ...groupDetail,
      uiIndex,
      node: ops.nodeDebugInfo(cardUi),
      mask: inspectMask(cardUi),
      rect: safeRect(cardUi, ops)
    }, ops);
    if (fact) facts.push(fact);
  }
  return facts;
}

function factsFromHandCards(cards, seatIndex, rule, ops = normalizeOptions()) {
  return Array.from(cards || [])
    .map((card, cardIndex) => cardFact(ops.runtimeCard(card), seatIndex, rule, { cardIndex }, ops))
    .filter(Boolean);
}

function findVisibleCardUiGroups(scene, seats, ops = normalizeOptions()) {
  const groups = [];
  let groupIndex = 0;
  ops.traverse(scene, (node) => {
    if (!node || !Array.isArray(node.cardUis) || !node.cardUis.length) return;
    if (!ops.effectiveVisible(node)) return;
    const seat = node.seat || node.ownerSeat || node._seat;
    let seatIndex = seats.indexOf(seat);
    if (seatIndex < 0 && scene?.SelfSeatUi?.cardContainer === node) {
      seatIndex = seats.indexOf(scene.SelfSeatUi.seat);
    }
    if (seatIndex < 0) return;
    groups.push({ groupIndex: groupIndex++, seatIndex, node, cardUis: node.cardUis });
  });
  return groups;
}

function cardFact(card, seatIndex, sourceRule, sourceDetail = {}, ops = normalizeOptions()) {
  if (!card) return null;
  const text = card.text || ops.cardText(card);
  if (!text && card.id == null) return null;
  return {
    ...card,
    text,
    source: {
      rule: sourceRule,
      seatIndex,
      ...sourceDetail
    }
  };
}

function canUseCardUi(cardUi, ops = normalizeOptions()) {
  if (!cardUi || !ops.effectiveVisible(cardUi)) return false;
  if (hasObviousHiddenBack(cardUi)) return false;
  const mask = inspectMask(cardUi);
  if (mask.visible === false || mask.cardVisible === false) return false;
  return true;
}

function hasObviousHiddenBack(cardUi) {
  const text = [
    cardUi?.skin,
    cardUi?._skin,
    cardUi?.texture?.url,
    cardUi?._texture?.url,
    cardUi?.back?.skin,
    cardUi?.back?._skin
  ].filter(Boolean).join(" ");
  return /back|unknown|card_back|beimian|pai_back/i.test(text);
}

function safeRect(cardUi, ops) {
  try {
    return ops.visualRect(cardUi);
  } catch {
    return null;
  }
}

function normalizeOptions(options = {}) {
  return {
    effectiveVisible: typeof options.effectiveVisible === "function" ? options.effectiveVisible : defaultEffectiveVisible,
    traverse: typeof options.traverse === "function" ? options.traverse : defaultTraverse,
    runtimeCard: typeof options.runtimeCard === "function" ? options.runtimeCard : defaultRuntimeCard,
    cardText: typeof options.cardText === "function" ? options.cardText : defaultCardText,
    visualRect: typeof options.visualRect === "function" ? options.visualRect : defaultVisualRect,
    nodeDebugInfo: typeof options.nodeDebugInfo === "function" ? options.nodeDebugInfo : defaultNodeDebugInfo,
    seatIsDead: typeof options.seatIsDead === "function" ? options.seatIsDead : defaultSeatIsDead,
    effectiveHandCount: typeof options.effectiveHandCount === "function" ? options.effectiveHandCount : defaultEffectiveHandCount
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function defaultEffectiveVisible(node) {
  return !!node && node.visible !== false && node.alpha !== 0;
}

function defaultTraverse(node, visit, seen = new Set()) {
  if (!node || seen.has(node)) return;
  seen.add(node);
  visit(node);
  for (const child of Array.from(node.children || node._children || [])) {
    defaultTraverse(child, visit, seen);
  }
}

function defaultRuntimeCard(card) {
  if (!card || typeof card !== "object") return null;
  const id = card.cardId ?? card.CardId ?? card.cardID ?? card.CardID ?? card.id ?? card.Id;
  const name = card.cardName || card.CardName || card.name || card.Name || "";
  const suit = card.suit || card.Suit || "";
  const rank = card.rank || card.Rank || card.number || card.Number || "";
  const text = card.text || card.ncn || defaultCardText({ name, suit, rank });
  if (id == null && !text) return null;
  return { id, name, suit, rank, text, color: card.color || card.Color || "" };
}

function defaultCardText(card) {
  return `${card?.name || ""}${card?.suit || ""}${card?.rank || ""}`;
}

function defaultVisualRect(node) {
  return {
    x: Number(node?.x || 0),
    y: Number(node?.y || 0),
    width: Number(node?.width || 0),
    height: Number(node?.height || 0)
  };
}

function defaultNodeDebugInfo(node) {
  if (!node) return null;
  return {
    label: node.label || node.name || node.constructor?.name || "",
    name: node.name || "",
    className: node.constructor?.name || "",
    path: node.path || node.name || "",
    childIndex: Number.isFinite(Number(node.childIndex)) ? Number(node.childIndex) : null,
    x: Number(node.x || 0),
    y: Number(node.y || 0),
    width: Number(node.width || 0),
    height: Number(node.height || 0),
    visible: node.visible !== false,
    alpha: Number(node.alpha == null ? 1 : node.alpha)
  };
}

function defaultSeatIsDead(seat) {
  return seat?.isDead === true || seat?.IsDead === true || seat?.dead === true;
}

function defaultEffectiveHandCount(_scene, seat, selfSeat) {
  if (!seat || defaultSeatIsDead(seat)) return 0;
  const isSelf = seat === selfSeat;
  const publicCount = Number(seat.handCardCount || 0);
  const handCardsLength = Array.from(seat.handCards || []).length;
  if (isSelf && handCardsLength > 0) return handCardsLength;
  return publicCount;
}

module.exports = {
  collectMaskHandFacts,
  inspectMask,
  canUseCardUi,
  factsFromCardUis,
  factsFromHandCards,
  findVisibleCardUiGroups
};
