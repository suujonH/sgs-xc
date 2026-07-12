const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  makeGameModel,
  sourceOf,
  matchesPredicate,
  normalizeZoneKey,
  DECK_POSITION
} = require("../src/runtime/model/game-model-core.cjs");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

function catalog() {
  return {
    1: { id: 1, name: "杀", color: 1, number: 7, typeOriginal: 1 },
    2: { id: 2, name: "无懈可击", color: 3, number: 1, typeOriginal: 2 },
    3: { id: 3, name: "无懈可击", color: 3, number: 12, typeOriginal: 2 },
    4: { id: 4, name: "八卦阵", color: 2, number: 2, typeOriginal: 3 },
    5: { id: 5, name: "闪", color: 2, number: 8, typeOriginal: 1 },
    6: { id: 6, name: "桃", color: 1, number: 9, typeOriginal: 1 }
  };
}

function model(deckCardIds = [1, 2, 3, 4, 5, 6], deckCount = deckCardIds.length) {
  const value = makeGameModel({ now: (() => {
    let time = 1000;
    return () => ++time;
  })() });
  value.configureGame({
    catalog: catalog(),
    deckCardIds,
    deckCount,
    sessionKey: "test-game"
  });
  return value;
}

console.log("\nGame model core");

test("recycles discard immediately when a draw exactly empties the deck", () => {
  const value = model([1, 2, 3, 4], 2);
  value.observeZone({ zoneKey: "discard", cardIds: [3, 4], count: 2, complete: true });
  const result = value.draw({ count: 2, cardIds: [1, 2], to: "hand:0" });
  const snapshot = value.snapshot();

  assert.equal(result.completed, 2);
  assert.equal(snapshot.epoch, 1);
  assert.equal(snapshot.deck.count, 2);
  assert.deepEqual(snapshot.discard.exactIds, []);
  assert.deepEqual(snapshot.hands[0].exactIds, [1, 2]);
  assert.equal(snapshot.locations[3].zoneKey, "deck");
  assert.equal(snapshot.locations[4].zoneKey, "deck");
  assert.equal(value.cardEvents({ cardId: 1, movementReason: "draw" }).length, 1);
});

test("splits one draw operation across the old and recycled decks", () => {
  const value = model([1, 2, 3], 1);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1] });
  value.observeZone({ zoneKey: "discard", cardIds: [2, 3], count: 2, complete: true });
  const result = value.draw({ count: 2, cardIds: [1, 2], to: "hand:0" });

  assert.deepEqual(result.segments.map((segment) => [segment.epoch, segment.count]), [[0, 1], [1, 1]]);
  assert.equal(value.state.epoch, 1);
  assert.equal(value.state.deck.count, 1);
  assert.deepEqual(value.snapshot().hands[0].exactIds, [1, 2]);
  assert.equal(value.explainCard(3).location.zoneKey, "deck");
});

test("recasts by discarding first so the cost joins an immediate exhaustion recycle", () => {
  const value = model([1, 2, 3], 1);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1] });
  value.observeHand({ seatIndex: 0, count: 1, cardIds: [2], complete: true, visibility: "self" });

  const result = value.applyOperation({
    type: "recast",
    eventId: "recast:test:1",
    actorSeat: 0,
    from: "hand:0",
    cardIds: [2],
    count: 1,
    drawCount: 1,
    drawnCardIds: [1]
  });
  const snapshot = value.snapshot();

  assert.equal(result.status, "applied");
  assert.deepEqual(snapshot.hands[0].exactIds, [1]);
  assert.equal(snapshot.epoch, 1);
  assert.equal(snapshot.deck.count, 1);
  assert.equal(snapshot.locations[2].zoneKey, "deck");
  assert.equal(snapshot.discard.count, 0);
  assert.deepEqual(value.causalEvent("recast:test:1").cardIds, [2]);
  assert.deepEqual(value.causalEvent("recast:test:1").metadata.recast.drawnCardIds, [1]);
  assert.equal(value.cardEvents({ cardId: 1, causalEventId: "recast:test:1", movementReason: "draw" }).length, 1);
  const transitions = value.handTransitions({ causalEventId: "recast:test:1" });
  assert.deepEqual(transitions.map((row) => [row.before.count, row.after.count]), [[1, 0], [0, 1]]);
});

test("keeps draw-bottom separate from judgement and default top consumption", () => {
  const value = model([1, 2, 3], 3);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1, 2] });
  value.revealDeckEndpoint({ endpoint: "bottom", cardIds: [3] });

  value.draw({ count: 1, cardIds: [3], endpoint: "bottom", to: "hand:0", reason: "寸目" });
  assert.deepEqual(value.state.deck.top, [1, 2]);
  assert.deepEqual(value.state.deck.bottom, []);

  value.draw({ count: 1, cardIds: [1], endpoint: "top", to: "process", reason: "judgement" });
  assert.deepEqual(value.state.deck.top, [2]);
});

test("infers an unlisted hidden draw from a known deck endpoint", () => {
  const value = model([1, 2, 3], 3);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1, 2] });

  const result = value.observeMove({
    from: { code: 1, seat: 255 },
    to: { code: 5, seat: 1 },
    cardIds: [],
    count: 1,
    context: { turn: 1, round: 1, phase: 2 }
  });

  assert.deepEqual(result.segments[0].observedCardIds, []);
  assert.deepEqual(result.segments[0].inferredCardIds, [1]);
  assert.deepEqual(value.snapshot().hands[1].exactIds, [1]);
  assert.deepEqual(value.snapshot().deck.top, [2]);
});

test("treats an uncategorized deck-to-process move as top consumption", () => {
  const value = model([1, 2, 3], 3);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1, 2] });

  value.observeMove({ from: { code: 1 }, to: { code: 3 }, count: 1, cardIds: [] });

  assert.deepEqual(value.snapshot().zones.process.exactIds, [1]);
  assert.deepEqual(value.snapshot().deck.top, [2]);
});

test("uses stable protocol positions and preserves special-zone parameters", () => {
  const value = model([1, 2, 3], 2);
  value.observeHand({ seatIndex: 0, count: 1, cardIds: [3], complete: true, visibility: "self" });

  value.observeMove({
    from: { code: 5, seat: 0 },
    to: { code: 1, position: DECK_POSITION.TOP },
    count: 1,
    cardIds: [3]
  });

  assert.deepEqual(value.snapshot().deck.top, [3]);
  assert.equal(normalizeZoneKey({ code: 8, seat: 1, zoneParam: 3697 }), "special:1:3697");
  assert.equal(normalizeZoneKey({ code: 10, seat: 1, zoneParam: 35 }), "process:exchange:1:35");
  assert.equal(normalizeZoneKey({ code: 12, seat: 1, zoneParam: 3697 }), "removed:1:3697");
});

test("treats parameterized use-process zones as default top consumption", () => {
  const value = model([1, 2], 2);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1] });

  value.observeMove({ from: { code: 1 }, to: { code: 3, zoneParam: 0 }, count: 1, cardIds: [] });

  assert.deepEqual(value.snapshot().zones["process:use:0"].exactIds, [1]);
  assert.equal(value.explainCard(1).location.zoneKey, "process:use:0");
});

test("lets explicit protocol position override broad skill taxonomy hints", () => {
  const value = model([1, 2, 3], 3);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1, 2] });

  value.observeMove({
    from: { code: 1, position: DECK_POSITION.TOP },
    to: { code: 8, seat: 0, zoneParam: 7021 },
    count: 1,
    cardIds: [],
    categories: ["deck.top.reveal", "deck.search", "draw.count"]
  });

  assert.deepEqual(value.snapshot().zones["special:0:7021"].exactIds, [1]);
  assert.deepEqual(value.snapshot().deck.top, [2]);
});

test("keeps deck-to-deck reposition count-neutral while updating the endpoint", () => {
  const value = model([1, 2, 3], 3);

  value.observeMove({
    from: { code: 1, position: DECK_POSITION.RANDOM },
    to: { code: 1, position: DECK_POSITION.TOP },
    count: 1,
    cardIds: [1],
    categories: ["deck.search", "deck.top.put"]
  });

  const snapshot = value.snapshot();
  assert.equal(snapshot.deck.count, 3);
  assert.equal(snapshot.zones.deck.count, 3);
  assert.deepEqual(snapshot.deck.top, [1]);
});

test("stores concrete hand identities for every seat with visibility provenance", () => {
  const value = model([1, 2, 3, 4], 1);
  value.observeHand({ seatIndex: 0, count: 2, cardIds: [1, 2], complete: true, visibility: "self" });
  value.observeHand({
    seatIndex: 1,
    count: 1,
    cardIds: [3],
    complete: true,
    visibility: "runtime-server-exposed",
    source: sourceOf("runtime-seat-hand", "runtime-seat-hand")
  });

  const snapshot = value.snapshot();
  assert.deepEqual(snapshot.hands[0].exactIds, [1, 2]);
  assert.deepEqual(snapshot.hands[1].exactIds, [3]);
  assert.equal(snapshot.hands[1].visibility, "runtime-server-exposed");
  assert.equal(snapshot.hands[1].source.kind, "runtime-seat-hand");
});

test("does not erase a protocol-known hand card with a same-count opaque observation", () => {
  const value = model([1, 2, 3], 2);
  value.observeMove({ from: "deck", to: "hand:1", count: 1, cardIds: [1] });
  value.observeHand({ seatIndex: 1, count: 1, cardIds: [], complete: false, visibility: "opaque" });

  assert.deepEqual(value.snapshot().hands[1].exactIds, [1]);
  assert.equal(value.snapshot().hands[1].unknownCount, 0);
});

test("removes stale discard membership when a stronger cross-zone observation arrives", () => {
  const value = model([1, 2, 3], 2);
  value.observeMove({ from: "hand:0", to: "discard", count: 1, cardIds: [2] });
  value.observeHand({ seatIndex: 1, count: 1, cardIds: [2], complete: true, visibility: "authorized" });

  const snapshot = value.snapshot();
  assert.deepEqual(snapshot.discard.exactIds, []);
  assert.equal(snapshot.discard.count, 0);
  assert.deepEqual(snapshot.hands[1].exactIds, [2]);
  assert.equal(snapshot.locations[2].zoneKey, "hand:1");
});

test("invalidates residual exact identities after a partially listed multi-card loss", () => {
  const value = model([1, 2, 3, 4, 5, 6], 3);
  value.observeHand({ seatIndex: 0, count: 3, cardIds: [1, 2, 3], complete: true, visibility: "self" });

  value.observeMove({ from: "hand:0", to: "hand:1", count: 2, cardIds: [1] });

  const snapshot = value.snapshot();
  assert.equal(snapshot.hands[0].count, 1);
  assert.deepEqual(snapshot.hands[0].exactIds, []);
  assert.equal(snapshot.hands[0].unknownCount, 1);
  assert.equal(snapshot.hands[1].count, 2);
  assert.deepEqual(snapshot.hands[1].exactIds, [1]);
  assert.equal(snapshot.hands[1].unknownCount, 1);
});

test("infers a full move from a complete single-card non-deck source", () => {
  const value = model([1, 2, 3], 2);
  value.observeZone({ zoneKey: "process", count: 1, cardIds: [1], complete: true });

  value.observeMove({
    from: "process",
    to: "discard",
    count: 1,
    cardIds: [],
    context: { turn: 2, round: 1, phase: 4 }
  });

  assert.deepEqual(value.snapshot().discard.exactIds, [1]);
  assert.deepEqual(value.discardForTurn(2, 1).cardIds, [1]);
});

test("uses unresolved enemy hand identities in the exchangeable next-card population", () => {
  const value = model([1, 2, 3, 4], 1);
  value.observeHand({ seatIndex: 0, count: 1, cardIds: [1], complete: true, visibility: "self" });
  value.observeHand({ seatIndex: 1, count: 1, cardIds: [], complete: false, visibility: "opaque" });
  value.observeZone({ zoneKey: "discard", count: 1, cardIds: [2], complete: true });

  const probability = value.nextCardProbability();
  assert.equal(probability.available, true);
  assert.equal(probability.candidateCount, 2);
  assert.deepEqual(probability.cards.map((row) => [row.id, row.probability]), [[3, 0.5], [4, 0.5]]);
  assert.equal(probability.assumption, "exchangeable-unlocated-card-identities");
});

test("preserves known outside-deck membership across hidden transfers with location groups", () => {
  const value = model([1, 2, 3, 4, 5, 6], 2);
  value.observeHand({ seatIndex: 0, count: 3, cardIds: [3, 4, 5], complete: true, visibility: "self" });
  value.observeHand({ seatIndex: 1, count: 0, cardIds: [], complete: true, visibility: "public-count" });

  value.observeMove({ from: "hand:0", to: "hand:1", count: 1, cardIds: [] });
  let groups = value.activeLocationGroups();
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].cardIds, [3, 4, 5]);
  assert.deepEqual(groups[0].zoneKeys, ["hand:0", "hand:1"]);
  assert.deepEqual(groups[0].zoneCounts, { "hand:0": 2, "hand:1": 1 });
  assert.equal(value.explainCard(3).locationStatus, "conserved-ambiguous");
  assert.deepEqual(value.explainCard(3).possibleZoneKeys, ["hand:0", "hand:1"]);
  assert.deepEqual(value.remainingDeck().unresolvedCandidateIds, [1, 2, 6]);

  value.observeMove({ from: "hand:1", to: "discard", count: 1, cardIds: [] });
  groups = value.activeLocationGroups();
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].zoneKeys, ["hand:0", "discard"]);
  assert.deepEqual(groups[0].zoneCounts, { "hand:0": 2, "discard": 1 });
  assert.deepEqual(value.remainingDeck().unresolvedCandidateIds, [1, 2, 6]);

  value.observeZone({ zoneKey: "discard", count: 1, cardIds: [3], complete: true, visibility: "public" });
  groups = value.activeLocationGroups();
  assert.equal(groups.length, 0);
  assert.deepEqual(value.handKnowledge(0).exactIds, [4, 5]);
  assert.deepEqual(value.remainingDeck().unresolvedCandidateIds, [1, 2, 6]);

  value.observeMove({ from: "hand:0", to: "deck", count: 1, cardIds: [] });
  groups = value.activeLocationGroups();
  assert.deepEqual(groups[0].cardIds, [4, 5]);
  assert.deepEqual(groups[0].zoneKeys, ["hand:0", "deck"]);
  assert.deepEqual(groups[0].zoneCounts, { "hand:0": 1, "deck": 1 });
  assert.ok(value.remainingDeck().unresolvedCandidateIds.includes(4));
  assert.ok(value.remainingDeck().unresolvedCandidateIds.includes(5));
  assert.equal(value.remainingDeck().locationGroupProbability.available, false);
  assert.equal(value.nextCardProbability().reason, "location-group-membership-distribution-unknown");
  assert.ok(value.snapshot().locationGroupHistory.some((row) => row.operation === "transfer"));
  assert.ok(value.snapshot().locationGroupHistory.some((row) => row.operation === "narrow"));
});

test("solves next-card and search probabilities for proven uniform disjoint location groups", () => {
  const value = model([1, 2, 3, 4, 5, 6], 2);
  value.observeHand({ seatIndex: 0, count: 1, cardIds: [], complete: false, visibility: "opaque" });
  value.observeLocationGroup({
    key: "uniform-hand-deck-split",
    cardIds: [3, 4],
    zoneKeys: ["hand:0", "deck"],
    zoneCounts: { "hand:0": 1, "deck": 1 },
    selectionModel: "uniform"
  });

  const next = value.nextCardProbability();
  assert.equal(next.available, true);
  assert.equal(next.assumption, "uniform-within-proven-disjoint-location-groups");
  assert.deepEqual(next.cards.map((row) => [row.id, row.probability]), [
    [3, 0.25],
    [4, 0.25],
    [1, 0.125],
    [2, 0.125],
    [5, 0.125],
    [6, 0.125]
  ]);

  const search = value.searchProbability({ predicate: { type: "trick" }, requestedCount: 1 });
  assert.equal(search.available, true);
  assert.equal(search.assumption, "uniform-placement-within-proven-disjoint-location-groups");
  assert.equal(search.probabilityNoMatch, 0.375);
  assert.equal(search.probabilityAtLeastOne, 0.625);
  assert.deepEqual(search.hitCountProbabilities, { 0: 0.375, 1: 0.5, 2: 0.125 });
});

test("turns an exhaustive failed predicate search into epoch-scoped negative evidence", () => {
  const value = model([1, 2, 3, 4], 2);
  const result = value.observeSearchResult({
    predicate: { type: "trick", number: [1, 12] },
    requestedCount: 2,
    foundCardIds: [],
    exhaustive: true,
    reason: "浑天仪无事发生"
  });

  assert.equal(result.inferredNoFurtherMatch, true);
  assert.deepEqual(result.excludedIds, [2, 3]);
  const next = value.nextCardProbability();
  assert.deepEqual(next.cards.map((row) => row.id), [1, 4]);
  const search = value.searchProbability({ predicate: { type: "trick", number: [1, 12] }, requestedCount: 1 });
  assert.equal(search.probabilityNoMatch, 1);

  value.shuffleCurrentDeck({ reason: "pure reorder preserves current-deck membership" });
  assert.deepEqual(value.snapshot().deck.excludedIds, [2, 3]);
  value.addToDeck({ count: 1, cardIds: [2], endpoint: "random", reason: "membership changed" });
  assert.deepEqual(value.snapshot().deck.excludedIds, []);
});

test("moves a hidden successful search result before inferring that no further match remains", () => {
  const value = model([1, 2, 3, 4], 2);

  const result = value.search({
    predicate: { type: "trick" },
    requestedCount: 2,
    foundCount: 1,
    foundCardIds: [],
    exhaustive: true,
    to: "hand:0"
  });

  const snapshot = value.snapshot();
  assert.equal(result.constraintDeferred, true);
  assert.equal(result.movement.count, 1);
  assert.equal(result.postMoveConstraint.inferredNoFurtherMatch, true);
  assert.deepEqual(result.excludedIds, [2, 3]);
  assert.equal(snapshot.deck.count, 1);
  assert.equal(snapshot.hands[0].count, 1);
  assert.equal(snapshot.hands[0].unknownCount, 1);
  assert.deepEqual(value.nextCardProbability().cards.map((row) => row.id), [1, 4]);
});

test("does not carry a hidden search shortfall across the recycle caused by that search", () => {
  const value = model([1, 2, 3], 1);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [2] });
  value.observeZone({ zoneKey: "discard", count: 2, cardIds: [1, 3], complete: true });

  const result = value.search({
    predicate: { type: "trick" },
    requestedCount: 2,
    foundCount: 1,
    foundCardIds: [],
    exhaustive: true,
    to: "hand:0"
  });

  const snapshot = value.snapshot();
  assert.equal(result.constraintDeferred, true);
  assert.equal(result.postMoveConstraint, null);
  assert.equal(snapshot.epoch, 1);
  assert.equal(snapshot.deck.count, 2);
  assert.deepEqual(snapshot.deck.excludedIds, []);
  assert.deepEqual(value.nextCardProbability().cards.map((row) => row.id).sort((a, b) => a - b), [1, 3]);
});

test("refuses an unsegmented search result that crosses a recycle boundary", () => {
  const value = model([2, 3], 1);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [2] });
  value.observeZone({ zoneKey: "discard", count: 1, cardIds: [3], complete: true });
  const before = value.snapshot();

  const result = value.search({
    predicate: { type: "trick" },
    requestedCount: 2,
    foundCount: 2,
    foundCardIds: [2, 3],
    to: "hand:0"
  });

  const after = value.snapshot();
  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "cross-epoch-search-requires-explicit-segments");
  assert.equal(after.epoch, before.epoch);
  assert.equal(after.deck.count, before.deck.count);
  assert.deepEqual(after.discard.exactIds, before.discard.exactIds);
  assert.equal(after.hands[0], undefined);

  const rawMove = value.observeMove({
    from: { zoneKey: "deck", position: DECK_POSITION.RANDOM },
    to: "hand:0",
    count: 2,
    cardIds: [2, 3],
    categories: ["deck.search"]
  });
  const afterRawMove = value.snapshot();
  assert.equal(rawMove.status, "unsupported");
  assert.equal(rawMove.rolledBack, true);
  assert.equal(afterRawMove.deck.count, before.deck.count);
  assert.deepEqual(afterRawMove.discard.exactIds, before.discard.exactIds);
  assert.equal(afterRawMove.hands[0], undefined);
});

test("applies explicitly segmented search feedback in the epoch where each result occurred", () => {
  const value = model([2, 3], 1);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [2] });
  value.observeZone({ zoneKey: "discard", count: 1, cardIds: [3], complete: true });

  const result = value.segmentedSearch({
    predicate: { type: "trick" },
    to: "hand:0",
    context: { causalEventId: "search:segmented:1", skillId: 3697, protocol: "GetCGsMoveCardNtf" },
    segments: [
      { epoch: 0, requestedCount: 1, foundCount: 1, foundCardIds: [2] },
      { epoch: 1, requestedCount: 1, foundCount: 1, foundCardIds: [3] }
    ]
  });

  const snapshot = value.snapshot();
  assert.equal(result.status, "applied");
  assert.deepEqual(result.segments.map((segment) => [segment.epochBefore, segment.epochAfter]), [[0, 1], [1, 1]]);
  assert.deepEqual(snapshot.hands[0].exactIds, [2, 3]);
  assert.equal(snapshot.epoch, 1);
  assert.equal(snapshot.deck.count, 0);
  assert.deepEqual(snapshot.discard.exactIds, []);
  assert.equal(value.cardEvents({ movementReason: "deck-search" }).length, 2);
  assert.equal(value.cardEvents({ causalEventId: "search:segmented:1", skillId: 3697 }).length, 2);
});

test("rolls back every prior search segment when a later epoch claim is inconsistent", () => {
  const value = model([2, 3], 1);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [2] });
  value.observeZone({ zoneKey: "discard", count: 1, cardIds: [3], complete: true });
  const before = value.snapshot();

  const result = value.segmentedSearch({
    predicate: { type: "trick" },
    to: "hand:0",
    segments: [
      { epoch: 0, requestedCount: 1, foundCardIds: [2] },
      { epoch: 9, requestedCount: 1, foundCardIds: [3] }
    ]
  });

  const after = value.snapshot();
  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "search-segment-epoch-mismatch");
  assert.equal(result.rolledBack, true);
  assert.equal(after.epoch, before.epoch);
  assert.equal(after.deck.count, before.deck.count);
  assert.deepEqual(after.deck.top, before.deck.top);
  assert.deepEqual(after.discard.exactIds, before.discard.exactIds);
  assert.equal(after.hands[0], undefined);
});

test("invalidates endpoint and search constraints when unknown cards enter the deck", () => {
  const value = model([1, 2, 3, 4], 2);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1] });
  value.observeSearchResult({ predicate: { type: "trick" }, requestedCount: 1, foundCardIds: [] });

  value.addToDeck({ endpoint: "top", count: 2, cardIds: [2], reason: "one listed plus one unknown" });

  assert.deepEqual(value.snapshot().deck.top, []);
  assert.deepEqual(value.snapshot().deck.excludedIds, []);
  assert.equal(value.nextCardProbability().exact, false);
});

test("keeps a dynamically inserted physical CardID in the probability population", () => {
  const value = model([1, 2], 2);
  value.addToDeck({ count: 1, cardIds: [3], endpoint: "random" });

  const snapshot = value.snapshot();
  const probability = value.nextCardProbability();
  assert.deepEqual(snapshot.deck.dynamicIds, [3]);
  assert.deepEqual(probability.cards.map((row) => [row.id, row.probability]), [[1, 1 / 3], [2, 1 / 3], [3, 1 / 3]]);
});

test("registers server-generated physical card attributes without confusing them with virtual cards", () => {
  const value = model([1, 2], 2);
  const definition = value.applyOperation({
    type: "register-generated-card",
    cardId: 90001,
    name: "闪",
    suit: "club",
    number: 8,
    cardType: "basic",
    source: sourceOf("generated-shan-packet", "server-protocol")
  });
  assert.equal(definition.status, "applied");
  assert.equal(value.physicalCardDefinition(90001).card.name, "闪");
  assert.equal(value.physicalCardDefinition(90001).card.suit, 4);
  assert.equal(value.physicalCardDefinition(90001).card.type, "basic");

  value.observeHand({ seatIndex: 0, count: 1, cardIds: [90001], complete: true, visibility: "self" });
  value.observeMove({ from: "hand:0", to: "discard", count: 1, cardIds: [90001] });
  value.draw({ count: 2, cardIds: [1, 2], to: "hand:1" });

  const probability = value.nextCardProbability();
  assert.equal(value.snapshot().epoch, 1);
  assert.equal(value.snapshot().deck.count, 1);
  assert.deepEqual(probability.cards.map((row) => [row.id, row.card.name, row.card.type]), [[90001, "闪", "basic"]]);

  const rejected = value.observePhysicalCardDefinition({
    cardId: 90001,
    name: "桃",
    suit: "heart",
    number: 9,
    type: "basic",
    source: sourceOf("outdated-skill-text", "skill-text")
  });
  assert.equal(rejected.applied, false);
  assert.equal(value.physicalCardDefinition(90001).card.name, "闪");
  assert.ok(value.snapshot().contradictions.some((row) => row.code === "physical-card-definition-lower-authority-conflict"));

  value.setCatalog(catalog());
  assert.equal(value.physicalCardDefinition(90001).card.name, "闪");
});

test("keeps terminally destroyed physical cards out of discard recycling until explicit reactivation", () => {
  const value = model([1, 2, 3], 1);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1] });
  value.observeZone({ zoneKey: "discard", count: 2, cardIds: [2, 3], complete: true });
  value.tagCard({ cardId: 2, tag: "old-special-instance" });
  value.observeEffectiveCardAttributes({
    cardId: 2,
    attributes: { name: "old-instance-view" },
    expiresOnMove: false
  });
  value.observeCardAction({
    eventId: "old-special-use",
    action: "use",
    identityKind: "physical",
    mainCardId: 2
  });
  assert.equal(value.physicalCardGeneration(2), 1);

  const destroyed = value.applyOperation({
    type: "destroy-physical-card",
    cardId: 2,
    from: "discard",
    terminalZoneKey: "terminal:special-equipment",
    skillId: 21044,
    ruleIdentityKey: "cha_spell.spell:21044/PiLiCheRace",
    reason: "special-equipment-left-slot",
    source: sourceOf("server-destroy-move", "server-protocol")
  });
  assert.equal(destroyed.status, "applied");
  assert.equal(value.physicalCardLifecycle(2).terminal, true);
  assert.equal(value.physicalCardLifecycle(2).generation, 1);
  assert.equal(value.physicalCardLifecycle(2).recyclable, false);
  assert.deepEqual(value.cardsWithTag("old-special-instance"), []);
  assert.equal(value.cardAttributeViews(2).length, 0);
  assert.equal(value.explainCard(2).location.zoneKey, "terminal:special-equipment");
  assert.deepEqual(value.snapshot().discard.exactIds, [3]);
  assert.equal(value.snapshot().discard.count, 1);
  assert.equal(value.snapshot().zones["terminal:special-equipment"].zoneKind, "terminal-card-zone");

  value.draw({ count: 1, cardIds: [1], to: "hand:0" });
  assert.equal(value.snapshot().epoch, 1);
  assert.equal(value.snapshot().deck.count, 1);
  assert.deepEqual(value.nextCardProbability().cards.map((row) => row.id), [3]);
  assert.equal(value.snapshot().world.terminalPhysicalCount, 1);
  assert.deepEqual(value.snapshot().world.terminalCardIds, [2]);
  assert.equal(value.snapshot().world.consistent, true);

  const denied = value.observePhysicalCardLifecycle({
    cardId: 2,
    status: "active",
    terminal: false,
    to: "equip:1",
    source: sourceOf("server-reactivate-without-authorization", "server-protocol")
  });
  assert.equal(denied.applied, false);
  assert.equal(denied.reason, "terminal-card-reactivation-not-authorized");
  assert.equal(value.explainCard(2).location.zoneKey, "terminal:special-equipment");

  const restored = value.applyOperation({
    type: "reactivate-physical-card",
    cardId: 2,
    to: "equip:1",
    status: "active",
    source: sourceOf("server-explicit-special-card-reissue", "server-protocol")
  });
  assert.equal(restored.status, "applied");
  assert.equal(value.physicalCardLifecycle(2).terminal, false);
  assert.equal(value.physicalCardLifecycle(2).generation, 2);
  assert.equal(value.physicalCardGeneration(2), 2);
  assert.equal(value.explainCard(2).location.zoneKey, "equip:1");
  assert.equal(value.snapshot().world.terminalPhysicalCount, 0);
  assert.deepEqual(value.snapshot().physicalCardLifecycleHistory.map((row) => row.type), ["terminal", "reactivate"]);
  const staleMaterials = value.cardActionMaterials("old-special-use");
  assert.deepEqual(staleMaterials.staleGenerationCardIds, [2]);
  assert.equal(staleMaterials.materials[0].physicalGeneration, 1);
  assert.equal(staleMaterials.materials[0].currentPhysicalGeneration, 2);
  assert.equal(value.moveCardActionMaterials({
    eventId: "old-special-use",
    from: "equip:1",
    to: "discard"
  }).reason, "card-action-material-generation-changed");
});

test("demotes exact deck membership after an anonymous random removal", () => {
  const value = model([1, 2], 2);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1] });

  value.takeFromDeck({ count: 1, cardIds: [], to: "hand:0" });

  const remaining = value.remainingDeck();
  const probability = value.nextCardProbability();
  assert.equal(value.explainCard(1).location, null);
  assert.equal(remaining.compositionExact, false);
  assert.deepEqual(probability.cards.map((row) => [row.id, row.probability]), [[1, 0.5], [2, 0.5]]);
});

test("demotes exact deck membership after an unobserved count decrease", () => {
  const value = model([1, 2, 3], 3);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1] });

  value.observeDeckCount(2, sourceOf("runtime-count", "runtime-public"));

  assert.equal(value.explainCard(1).location, null);
  assert.equal(value.nextCardProbability().exact, false);
});

test("keeps zone-9 staging round trips count-neutral and records one shuffle", () => {
  const value = model([1, 2, 3], 3);
  value.observeMove({
    from: { code: 1, position: DECK_POSITION.TOP },
    to: { code: 9 },
    count: 1,
    cardIds: [1],
    categories: ["deck.shuffle"]
  });
  value.observeMove({
    from: { code: 9 },
    to: { code: 1, position: DECK_POSITION.RANDOM },
    count: 1,
    cardIds: [1],
    categories: ["deck.shuffle"]
  });

  const snapshot = value.snapshot();
  assert.equal(snapshot.deck.count, 3);
  assert.equal(snapshot.deck.shuffleCount, 1);
  assert.equal(snapshot.epoch, 0);
  assert.equal(snapshot.zones.shuffle.count, 0);
});

test("does not recycle discard while the whole current deck is only in shuffle staging", () => {
  const value = model([1, 2, 3, 4], 2);
  value.observeZone({ zoneKey: "discard", count: 2, cardIds: [3, 4], complete: true });

  value.observeMove({
    from: { code: 1, position: DECK_POSITION.TOP },
    to: { code: 9 },
    count: 2,
    cardIds: [1, 2],
    categories: ["deck.shuffle"]
  });

  let snapshot = value.snapshot();
  assert.equal(snapshot.epoch, 0);
  assert.equal(snapshot.deck.recycleCount, 0);
  assert.equal(snapshot.deck.count, 0);
  assert.deepEqual(snapshot.discard.exactIds, [3, 4]);
  assert.equal(snapshot.zones.shuffle.count, 2);

  value.observeMove({ from: { code: 9 }, to: { code: 1, position: DECK_POSITION.RANDOM }, count: 2, cardIds: [1, 2], categories: ["deck.shuffle"] });
  snapshot = value.snapshot();
  assert.equal(snapshot.deck.count, 2);
  assert.deepEqual(snapshot.discard.exactIds, [3, 4]);
});

test("recognizes a discard-to-zone9-to-deck recycle epoch", () => {
  const value = model([1, 2, 3], 0);
  value.observeZone({ zoneKey: "discard", count: 2, cardIds: [2, 3], complete: true });

  value.observeMove({ from: { code: 2 }, to: { code: 9 }, count: 2, cardIds: [2, 3] });
  value.observeMove({ from: { code: 9 }, to: { code: 1, position: DECK_POSITION.RANDOM }, count: 2, cardIds: [2, 3] });

  const snapshot = value.snapshot();
  assert.equal(snapshot.epoch, 1);
  assert.equal(snapshot.deck.count, 2);
  assert.equal(snapshot.deck.recycleCount, 1);
  assert.deepEqual(snapshot.discard.exactIds, []);
});

test("does not invent a recycle from an unexplained observed deck-count increase", () => {
  const value = model([1, 2, 3, 4], 1);
  value.observeZone({ zoneKey: "discard", count: 2, cardIds: [2, 3], complete: true });

  value.observeDeckCount(3, sourceOf("runtime-count", "runtime-public"));

  const snapshot = value.snapshot();
  assert.equal(snapshot.epoch, 0);
  assert.deepEqual(snapshot.discard.exactIds, [2, 3]);
  assert.equal(snapshot.deck.count, 3);
  assert.ok(snapshot.contradictions.some((row) => row.code === "deck-count-increase-without-move-evidence"));
});

test("reports physical count over-allocation across deck and known or opaque zones", () => {
  const value = model([1, 2, 3, 4], 2);
  value.observeHand({ seatIndex: 0, count: 1, cardIds: [1], complete: true, visibility: "self" });
  value.observeHand({ seatIndex: 1, count: 1, cardIds: [], complete: false, visibility: "opaque" });
  value.observeZone({ zoneKey: "discard", count: 1, cardIds: [2], complete: true });

  const snapshot = value.snapshot();
  assert.equal(snapshot.world.activePhysicalCount, 4);
  assert.equal(snapshot.world.allocatedCount, 5);
  assert.equal(snapshot.world.consistent, false);
  assert.ok(snapshot.contradictions.some((row) => row.code === "physical-card-count-over-allocated"));
  assert.equal(value.nextCardProbability().available, false);
  assert.equal(value.nextCardProbability().reason, "inconsistent-physical-world");
  assert.equal(value.searchProbability({ predicate: { type: "trick" } }).available, false);
});

test("preserves exact known deck membership when exhaustive search feedback conflicts", () => {
  const value = model([1, 2, 3, 4], 2);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [2] });

  value.observeSearchResult({
    predicate: { type: "trick" },
    requestedCount: 1,
    foundCardIds: [],
    exhaustive: true
  });

  const snapshot = value.snapshot();
  assert.deepEqual(snapshot.deck.excludedIds, [3]);
  assert.equal(value.nextCardProbability().exact, true);
  assert.deepEqual(value.nextCardProbability().cards.map((row) => row.id), [2]);
  assert.ok(snapshot.contradictions.some((row) => row.code === "search-result-conflicts-known-deck-membership"));
});

test("rejects exhaustive search exclusions that exceed outside-deck capacity", () => {
  const value = model([1, 2, 3], 3);

  const result = value.observeSearchResult({
    predicate: { type: "trick" },
    requestedCount: 1,
    foundCardIds: [],
    exhaustive: true
  });

  assert.equal(result.constraintRejected, true);
  assert.deepEqual(value.snapshot().deck.excludedIds, []);
  assert.equal(value.nextCardProbability().available, true);
  assert.ok(value.snapshot().contradictions.some((row) => row.code === "search-exclusion-exceeds-outside-capacity"));
});

test("treats repeated identical exhaustive-search evidence as idempotent", () => {
  const value = model([1, 2, 3, 4], 2);
  const input = { predicate: { type: "trick" }, requestedCount: 1, foundCardIds: [], exhaustive: true };

  const first = value.observeSearchResult(input);
  const second = value.observeSearchResult(input);

  assert.equal(first.constraintRejected, false);
  assert.equal(second.constraintRejected, false);
  assert.deepEqual(value.snapshot().deck.excludedIds, [2, 3]);
  assert.equal(value.snapshot().contradictions.some((row) => row.code === "search-exclusion-exceeds-outside-capacity"), false);
});

test("accepts top and bottom facts that overlap at the same physical position", () => {
  const value = model([1, 2, 3], 3);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1, 2] });
  value.revealDeckEndpoint({ endpoint: "bottom", cardIds: [3, 2] });

  const codes = value.snapshot().contradictions.map((row) => row.code);
  assert.equal(codes.includes("deck-endpoints-disagree-at-position"), false);
  assert.equal(codes.includes("deck-card-claimed-at-multiple-positions"), false);
});

test("keeps deck-zone count synchronized after an exact recycle", () => {
  const value = model([1, 2, 3], 1);
  value.observeZone({ zoneKey: "discard", count: 2, cardIds: [2, 3], complete: true });
  value.draw({ count: 1, cardIds: [1], to: "hand:0" });

  const snapshot = value.snapshot();
  assert.equal(snapshot.deck.count, 2);
  assert.equal(snapshot.zones.deck.count, 2);
  assert.deepEqual(snapshot.zones.deck.exactIds.sort((a, b) => a - b), [2, 3]);
});

test("keeps current discard membership separate from immutable movement history", () => {
  const value = model([1, 2, 3], 1);
  value.observeMove({
    from: "hand:0",
    to: "discard",
    cardIds: [2],
    count: 1,
    context: { turn: 4, round: 2, phase: 5 }
  });
  assert.deepEqual(value.discardForTurn(4, 2).cardIds, [2]);

  value.draw({ count: 1, cardIds: [1], to: "hand:0" });
  assert.deepEqual(value.discardForTurn(4, 2).cardIds, []);
  assert.equal(value.snapshot().epoch, 1);
  assert.deepEqual(value.snapshot().discard.history.map((entry) => [entry.cardId, entry.epoch]), [[2, 0]]);
});

test("keeps the full hypergeometric tail for search availability", () => {
  const value = model([1, 2, 3, 4, 5, 6], 4);
  const one = value.searchProbability({ predicate: { type: "trick" }, requestedCount: 1 });
  const two = value.searchProbability({ predicate: { type: "trick" }, requestedCount: 2 });

  assert.ok(Math.abs(one.hitCountProbabilities[0] - 1 / 15) < 1e-12);
  assert.ok(Math.abs(one.hitCountProbabilities[1] - 8 / 15) < 1e-12);
  assert.ok(Math.abs(one.hitCountProbabilities[2] - 6 / 15) < 1e-12);
  assert.ok(Math.abs(one.probabilityAtLeastRequested - 14 / 15) < 1e-12);
  assert.ok(Math.abs(two.probabilityAtLeastRequested - 6 / 15) < 1e-12);
});

test("returns exact attribute distributions when the deck top is known", () => {
  const value = model([2, 3], 2);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [2] });
  const probability = value.nextCardProbability();

  assert.equal(probability.exact, true);
  assert.deepEqual(probability.cards.map((row) => row.id), [2]);
  assert.deepEqual(probability.distributions.number, [{ value: 1, probability: 1, cardCount: 1 }]);
  assert.deepEqual(probability.distributions.suit, [{ value: 3, probability: 1, cardCount: 1 }]);
  assert.deepEqual(probability.distributions.type, [{ value: "trick", probability: 1, cardCount: 1 }]);
  assert.deepEqual(probability.distributions.color, [{ value: "black", probability: 1, cardCount: 1 }]);
});

test("shifts sparse deck-rank facts after an anonymous top draw", () => {
  const value = model([1, 2, 3, 4, 5, 6], 6);
  value.observeDeckRanks({ ranks: [{ rank: 3, cardId: 3 }] });

  value.draw({ count: 1, cardIds: [], endpoint: "top", to: "hand:0" });

  const remaining = value.remainingDeck();
  assert.equal(remaining.knownRanks[2].cardId, 3);
  assert.equal(value.explainCard(3).location.zoneKey, "deck");
});

test("shifts existing sparse ranks when a known card is inserted on top", () => {
  const value = model([1, 2, 3, 4, 5, 6], 5);
  value.observeZone({ zoneKey: "hand:0", count: 1, cardIds: [6], complete: true });
  value.observeDeckRanks({ rank: 2, cardId: 2 });

  value.addToDeck({ endpoint: "top", cardIds: [6], count: 1 });

  const ranks = value.remainingDeck().knownRanks;
  assert.equal(ranks[1].cardId, 6);
  assert.equal(ranks[3].cardId, 2);
});

test("inserts an outside physical card at a sparse rank and falls back to bottom", () => {
  const value = model([1, 2, 3, 4, 5, 6], 4);
  value.observeZone({ zoneKey: "general:0", count: 2, cardIds: [5, 6], complete: true });
  value.observeDeckRanks({ ranks: [{ rank: 1, cardId: 1 }, { rank: 3, cardId: 3 }] });

  const middle = value.insertAtRank({ cardId: 5, rank: 2 });
  const bottom = value.insertAtRank({ cardId: 6, rank: 9, fallback: "bottom" });

  const snapshot = value.snapshot();
  assert.deepEqual(middle, { status: "applied", cardId: 5, requestedRank: 2, rank: 2, fallbackUsed: false });
  assert.deepEqual(bottom, { status: "applied", cardId: 6, requestedRank: 9, rank: 6, fallbackUsed: true });
  assert.equal(snapshot.deck.knownRanks[1].cardId, 1);
  assert.equal(snapshot.deck.knownRanks[2].cardId, 5);
  assert.equal(snapshot.deck.knownRanks[4].cardId, 3);
  assert.equal(snapshot.deck.knownRanks[6].cardId, 6);
  assert.deepEqual(snapshot.deck.bottom, [6]);
  assert.equal(snapshot.zones["general:0"].count, 0);
});

test("uses an independently observed rank-one fact as an exact next card", () => {
  const value = model([1, 2, 3], 3);
  value.observeDeckRanks({ rank: 1, cardId: 2 });

  const probability = value.nextCardProbability();
  assert.equal(probability.exact, true);
  assert.deepEqual(probability.cards.map((row) => row.id), [2]);
});

test("removes a proven first matching card by rank without moving skipped prefix cards", () => {
  const value = model([1, 2, 3, 4], 4);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1, 2, 3] });

  const result = value.orderedMatchSearch({
    endpoint: "top",
    predicate: { type: "trick" },
    requestedCount: 1,
    foundCount: 1,
    foundCardIds: [2],
    to: "hand:0"
  });

  const snapshot = value.snapshot();
  assert.equal(result.status, "applied");
  assert.equal(result.foundRank, 2);
  assert.equal(result.rankProven, true);
  assert.equal(result.nonMatchingCardsStayedInDeck, true);
  assert.deepEqual(snapshot.deck.top, [1, 3]);
  assert.equal(snapshot.deck.count, 3);
  assert.deepEqual(snapshot.hands[0].exactIds, [2]);
  assert.deepEqual(value.nextCardProbability().cards.map((row) => row.id), [1]);
});

test("supports bottom-first match removal and preserves the known bottom card below it", () => {
  const value = model([1, 2, 3, 4], 4);
  value.revealDeckEndpoint({ endpoint: "bottom", cardIds: [4, 3] });

  const result = value.applyOperation({
    type: "ordered-match-search",
    endpoint: "bottom",
    predicate: { type: "trick" },
    foundCount: 1,
    foundCardIds: [3],
    destination: "hand:0"
  });

  const snapshot = value.snapshot();
  assert.equal(result.status, "applied");
  assert.equal(result.result.foundRank, 3);
  assert.deepEqual(snapshot.deck.bottom, [4]);
  assert.equal(snapshot.deck.count, 3);
  assert.deepEqual(snapshot.hands[0].exactIds, [3]);
  assert.deepEqual(value.nextCardProbability({ endpoint: "bottom" }).cards.map((row) => row.id), [4]);
});

test("recycles immediately when an ordered match removes the last deck card", () => {
  const value = model([1, 2, 3], 1);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [2] });
  value.observeZone({ zoneKey: "discard", count: 1, cardIds: [3], complete: true });

  const result = value.orderedMatchSearch({
    endpoint: "top",
    predicate: { type: "trick" },
    foundCount: 1,
    foundCardIds: [2],
    to: "hand:0"
  });

  const snapshot = value.snapshot();
  assert.equal(result.searchEpoch, 0);
  assert.equal(result.resultingEpoch, 1);
  assert.equal(snapshot.epoch, 1);
  assert.deepEqual(snapshot.deck.top, []);
  assert.deepEqual(snapshot.deck.bottom, []);
  assert.equal(snapshot.locations[2].zoneKey, "hand:0");
  assert.equal(snapshot.locations[3].zoneKey, "deck");
});

test("keeps physical-card tags across zone movements and filters by current zone", () => {
  const value = model([1, 2, 3], 3);
  value.tagCard({ cardId: 2, tag: "temporary-rule-mark", metadata: { skillId: 9999 } });

  value.observeMove({ from: "deck", to: "hand:0", count: 1, cardIds: [2] });
  assert.deepEqual(value.cardsWithTag("temporary-rule-mark", { zoneKey: "hand:0" }), [2]);

  value.observeMove({ from: "hand:0", to: "discard", count: 1, cardIds: [2] });
  assert.deepEqual(value.cardsWithTag("temporary-rule-mark", { zoneKey: "hand:0" }), []);
  assert.deepEqual(value.cardsWithTag("temporary-rule-mark", { zoneKey: "discard" }), [2]);
  assert.equal(value.explainCard(2).tags["temporary-rule-mark"].metadata.skillId, 9999);
});

test("expires physical-card tags by turn or zone while preserving lifecycle history", () => {
  const value = model([1, 2, 3], 2);
  value.observeGameEvent({ type: "game:turn", turn: 1, round: 1, seat: 0 });
  value.observeHand({ seatIndex: 0, count: 1, cardIds: [2], complete: true, visibility: "self" });
  value.tagCard({ cardId: 2, tag: "cannot-use-this-turn", lifecycle: "turn" });

  value.observeMove({ from: "hand:0", to: "discard", count: 1, cardIds: [2] });
  assert.deepEqual(value.cardsWithTag("cannot-use-this-turn"), [2]);
  value.observeGameEvent({ type: "game:turn", turn: 2, round: 1, seat: 1 });
  assert.deepEqual(value.cardsWithTag("cannot-use-this-turn"), []);
  assert.equal(value.explainCard(2).tagHistory.at(-1).expirationReason, "turn-changed");

  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1] });
  value.tagCard({ cardId: 1, tag: "valid-only-on-deck", lifecycle: "while-zone", whileZone: "deck" });
  value.draw({ count: 1, cardIds: [1], to: "hand:0" });
  assert.deepEqual(value.cardsWithTag("valid-only-on-deck"), []);
  assert.equal(value.snapshot().cardTagHistory.at(-1).expirationReason, "card-moved");
});

test("applies a fully resolved rule-operation sequence without skill-name branches", () => {
  const value = model([1, 2, 3], 3);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1] });

  const result = value.applyOperation({
    type: "sequence",
    operations: [
      { type: "draw", source: "deck-top", destination: "hand:0", count: 1, cardIds: [1] },
      { type: "tag-physical-card", cardId: 1, tag: "resolved-draw-result" }
    ]
  }, { skillId: 815 });

  assert.equal(result.status, "applied");
  assert.deepEqual(value.snapshot().hands[0].exactIds, [1]);
  assert.deepEqual(value.cardsWithTag("resolved-draw-result"), [1]);
});

test("swaps a one-card deck endpoint atomically without triggering an intermediate recycle", () => {
  const value = model([1, 2, 3], 1);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1] });
  value.observeHand({ seatIndex: 0, count: 1, cardIds: [2], complete: true, visibility: "self" });

  const result = value.applyOperation({
    type: "atomic-swap",
    leftCardId: 1,
    leftZone: "deck",
    leftEndpoint: "top",
    rightCardId: 2,
    rightZone: "hand:0"
  });

  const snapshot = value.snapshot();
  assert.equal(result.status, "applied");
  assert.equal(snapshot.epoch, 0);
  assert.equal(snapshot.deck.count, 1);
  assert.deepEqual(snapshot.deck.top, [2]);
  assert.deepEqual(snapshot.hands[0].exactIds, [1]);
  assert.equal(snapshot.locations[1].zoneKey, "hand:0");
  assert.equal(snapshot.locations[2].zoneKey, "deck");
});

test("rolls back an operation sequence when any child still contains an unresolved expression", () => {
  const value = model([1, 2, 3], 3);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1] });
  const before = value.snapshot();

  const result = value.applyOperation({
    type: "sequence",
    operations: [
      { type: "draw", source: "deck-top", destination: "hand:0", count: 1, cardIds: [1] },
      { type: "draw", source: "deck-top", destination: "hand:0", count: "min(alivePlayers,5)" }
    ]
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.rolledBack, true);
  assert.deepEqual(value.snapshot().deck.top, before.deck.top);
  assert.deepEqual(value.snapshot().hands, before.hands);
  assert.equal(value.snapshot().version, before.version);
});

test("accepts explicit zero-result search feedback through the operation executor", () => {
  const value = model([1, 2, 3, 4], 2);

  const result = value.applyOperation({
    type: "search-feedback",
    predicate: { type: "trick" },
    requestedCount: 1,
    foundCardIds: [],
    exhaustive: true
  });

  assert.equal(result.status, "applied");
  assert.deepEqual(value.snapshot().deck.excludedIds, [2, 3]);
});

test("supports nested AND and NOT predicates without flattening their meaning", () => {
  const value = model([1, 2, 3, 4], 2);

  const result = value.observeSearchResult({
    predicate: { all: [{ type: "trick" }, { not: { number: 12 } }] },
    requestedCount: 1,
    foundCardIds: [],
    exhaustive: true
  });

  assert.equal(result.predicateExecutable, true);
  assert.deepEqual(value.snapshot().deck.excludedIds, [2]);
});

test("matches config-derived damage, delayed-trick, and equipment-subtype predicates", () => {
  assert.equal(matchesPredicate({
    id: 72,
    name: "南蛮入侵",
    typeOriginal: 2,
    subType: 0,
    isDamageCard: true,
    spellClass: "NanManRuQin"
  }, {
    isDamageCard: true,
    isOrdinaryTrick: true,
    spellClass: "NanManRuQin"
  }, 72), true);
  assert.equal(matchesPredicate({ id: 32, typeOriginal: 2, subType: 5 }, { isDelayedTrick: true }, 32), true);
  assert.equal(matchesPredicate({ id: 67, typeOriginal: 3, subType: 2 }, { equipSubtype: 2 }, 67), true);
});

test("refuses negative inference for aggregate selectors that the single-card predicate engine cannot execute", () => {
  const value = model([1, 2, 3, 4], 2);

  const result = value.observeSearchResult({
    predicate: { aggregate: { field: "number", sum: 36 } },
    requestedCount: 1,
    foundCardIds: [],
    exhaustive: true
  });

  assert.equal(result.predicateExecutable, false);
  assert.equal(result.inferredNoFurtherMatch, false);
  assert.equal(result.constraintRejected, true);
  assert.deepEqual(value.snapshot().deck.excludedIds, []);
  assert.equal(value.searchProbability({ predicate: { aggregate: { field: "number", sum: 36 } } }).reason, "predicate-not-executable");
  assert.ok(value.snapshot().contradictions.some((row) => row.code === "search-predicate-not-executable"));
});

test("reports aggregate subset feasibility without inventing a server sampling probability", () => {
  const uncertain = model([1, 2, 3, 4, 5, 6], 2);
  const possible = uncertain.aggregateSubsetFeasibility({
    field: "number",
    sum: 13,
    minCount: 2,
    maxCount: 2,
    predicate: { type: "trick" }
  });

  assert.equal(possible.status, "possible");
  assert.equal(possible.guaranteed, false);
  assert.deepEqual(possible.possibleWitness, [2, 3]);
  assert.equal(possible.probabilityAvailable, false);

  const certain = model([1, 2, 3, 4, 5, 6], 2);
  certain.observeDeckRanks({ ranks: [{ rank: 1, cardId: 2 }, { rank: 2, cardId: 3 }] });
  const guaranteed = certain.aggregateSubsetFeasibility({ field: "number", sum: 13, minCount: 2, maxCount: 2 });
  const impossible = uncertain.aggregateSubsetFeasibility({ field: "number", sum: 30, minCount: 1, maxCount: 2 });

  assert.equal(guaranteed.status, "guaranteed");
  assert.deepEqual(guaranteed.guaranteedWitness, [2, 3]);
  assert.equal(impossible.status, "impossible");
});

test("keeps hand-property evidence only for the hand generation that was inspected", () => {
  const value = model([1, 2, 3, 4], 2);
  value.observeHand({ seatIndex: 1, count: 2, cardIds: [2], complete: false, visibility: "authorized" });
  const fact = value.observeHandConstraint({
    seatIndex: 1,
    kind: "none-match",
    predicate: { suit: "红桃" },
    reason: "攻心完整观看后未见红桃"
  });

  assert.equal(fact.active, true);
  assert.equal(value.handKnowledge(1).constraints.length, 1);

  value.observeMove({ from: "deck", to: "hand:1", count: 1, cardIds: [1] });

  const snapshot = value.snapshot();
  assert.equal(snapshot.hands[1].constraints.length, 0);
  assert.equal(snapshot.handConstraintHistory.length, 1);
  assert.equal(snapshot.handConstraintHistory[0].active, false);
  assert.equal(snapshot.handConstraintHistory[0].invalidationReason, "hand-membership-changed");
});

test("records a contradiction when a hand constraint conflicts with an exact visible card", () => {
  const value = model([1, 2, 3], 2);
  value.observeHand({ seatIndex: 1, count: 1, cardIds: [1], complete: true, visibility: "authorized" });

  value.observeHandConstraint({ seatIndex: 1, kind: "none-match", predicate: { suit: "红桃" } });

  assert.ok(value.snapshot().contradictions.some((row) => row.code === "hand-constraint-conflicts-known-identities"));
});

test("keeps hand generation and constraints across an in-place identity reveal", () => {
  const value = model([1, 2, 3, 4], 2);
  value.observeHand({ seatIndex: 1, count: 2, cardIds: [], complete: false, visibility: "count-only" });
  value.observeHandConstraint({ seatIndex: 1, kind: "none-match", predicate: { name: "杀" } });
  const before = value.snapshot();

  const view = value.applyOperation({
    type: "authorized-view-hand",
    eventId: "hand:view:seat1:1",
    observerSeat: 0,
    seatIndex: 1,
    count: 2,
    cardIds: [2],
    visibility: "authorized-view",
    context: { turn: 3, round: 1 }
  });
  const refined = value.snapshot();

  assert.equal(view.status, "applied");
  assert.equal(refined.hands[1].generation, before.hands[1].generation);
  assert.equal(refined.hands[1].constraints.length, 1);
  assert.equal(refined.handHistory.length, before.handHistory.length);
  assert.deepEqual(refined.hands[1].exactIds, [2]);
  assert.equal(refined.handKnowledgeHistory.at(-1).knowledgeOnly, true);
  assert.deepEqual(refined.handKnowledgeHistory.at(-1).addedExactIds, [2]);
  assert.equal(value.handKnowledgeChanges({ seatIndex: 1, knowledgeOnly: true }).length, 1);
  assert.deepEqual(value.causalEvent("hand:view:seat1:1").cardIds, [2]);
  assert.equal(value.causalEvent("hand:view:seat1:1").metadata.movement, false);

  value.observeHandEvidence({ seatIndex: 1, minimumCount: 2, cardIds: [1], visibility: "authorized-view" });
  const conflicted = value.snapshot();
  assert.equal(conflicted.hands[1].generation, before.hands[1].generation);
  assert.equal(conflicted.hands[1].constraints.length, 1);
  assert.ok(conflicted.contradictions.some((row) => row.code === "hand-constraint-conflicts-refined-knowledge"));
  const conflictCount = conflicted.contradictions.filter((row) => row.code === "hand-constraint-conflicts-refined-knowledge").length;
  value.observeHandEvidence({ seatIndex: 1, minimumCount: 2, cardIds: [1], visibility: "authorized-view" });
  assert.equal(value.snapshot().contradictions.filter((row) => row.code === "hand-constraint-conflicts-refined-knowledge").length, conflictCount);
});

test("advances hand generation when an equal-count snapshot proves membership replacement", () => {
  const value = model([1, 2, 3, 4], 2);
  value.observeHand({ seatIndex: 1, count: 2, cardIds: [1, 2], complete: true, visibility: "authorized-view" });
  value.observeHandConstraint({ seatIndex: 1, kind: "at-least", predicate: { type: "basic" }, count: 1 });
  const before = value.snapshot();

  value.observeHand({ seatIndex: 1, count: 2, cardIds: [2, 3], complete: true, visibility: "authorized-view" });
  const after = value.snapshot();
  const transition = after.handHistory.at(-1);

  assert.equal(after.hands[1].generation, before.hands[1].generation + 1);
  assert.deepEqual(after.hands[1].constraints, []);
  assert.equal(transition.delta, 0);
  assert.equal(transition.contentChanged, true);
  assert.equal(after.handKnowledgeHistory.at(-1).membershipChanged, true);
  assert.deepEqual(after.handKnowledgeHistory.at(-1).addedExactIds, [3]);
  assert.deepEqual(after.handKnowledgeHistory.at(-1).removedExactIds, [1]);
});

test("keeps special-zone visibility separate from its physical CardIDs", () => {
  const value = model([1, 2, 3], 1);
  value.observeZone({
    zoneKey: "special:0:307",
    count: 2,
    cardIds: [2, 3],
    complete: true,
    visibility: "hidden-owner-visible"
  });

  const zone = value.snapshot().zones["special:0:307"];
  assert.deepEqual(zone.exactIds, [2, 3]);
  assert.equal(zone.visibility, "hidden-owner-visible");
});

test("keeps named general-card piles distinct with observer-scoped face-down identities", () => {
  const value = model([1, 2, 3], 1);
  const bifa = value.observeNamedCardZone({
    zoneKind: "general-card-pile",
    pileKey: "skill:212:笔伐",
    skillId: 212,
    hostSeat: 1,
    hostArea: "general",
    controllerSeat: 0,
    placedBySeat: 0,
    ownerSeat: null,
    ownershipKnown: true,
    count: 1,
    cardIds: [2],
    complete: true,
    ordered: true,
    orderKnown: true,
    faceUp: false,
    visibilityAudience: "restricted",
    observerSeats: [0],
    cardStates: [{ cardId: 2, faceUp: false, visibilityAudience: "restricted", observerSeats: [0] }]
  });
  value.observeNamedCardZone({
    zoneKind: "general-card-pile",
    pileKey: "skill:123:田",
    skillId: 123,
    hostSeat: 1,
    hostArea: "general",
    ownerSeat: null,
    count: 1,
    cardIds: [3],
    complete: true,
    ordered: false,
    faceUp: true,
    visibilityAudience: "public"
  });

  assert.equal(value.visibleZone(bifa.zoneKey, { observerSeat: 0 }).identityVisible, true);
  assert.equal(bifa.ownershipKnown, true);
  assert.equal(bifa.orderKnown, true);
  assert.deepEqual(value.visibleZone(bifa.zoneKey, { observerSeat: 0 }).exactIds, [2]);
  assert.equal(value.visibleZone(bifa.zoneKey, { observerSeat: 1 }).identityVisible, false);
  assert.deepEqual(value.visibleZone(bifa.zoneKey, { observerSeat: 1 }).exactIds, []);
  assert.equal(value.visibleZone(bifa.zoneKey, { observerSeat: 1 }).unknownCount, 1);
  assert.equal(value.namedCardZones({ hostSeat: 1 }).length, 2);
  assert.notEqual(value.namedCardZones({ hostSeat: 1 })[0].zoneKey, value.namedCardZones({ hostSeat: 1 })[1].zoneKey);

  value.observeNamedCardZone({
    zoneKey: bifa.zoneKey,
    zoneKind: "general-card-pile",
    pileKey: "skill:212:笔伐",
    skillId: 212,
    hostSeat: 1,
    count: 1,
    cardIds: [2],
    complete: true,
    faceUp: false,
    visibilityAudience: "restricted",
    observerSeats: [0, 1],
    knowledgeOnly: true,
    membershipChanged: false
  });
  assert.deepEqual(value.visibleZone(bifa.zoneKey, { observerSeat: 1 }).exactIds, [2]);

  value.observeMove({ from: bifa.zoneKey, to: "process:judgement", count: 1, cardIds: [2] });
  assert.equal(value.explainCard(2).location.zoneKey, "process:judgement");
  assert.deepEqual(value.snapshot().zones[bifa.zoneKey].cardStates, {});
  assert.equal(value.snapshot().zones[bifa.zoneKey].count, 0);
  assert.equal(value.snapshot().world.consistent, true);
});

test("reconciles a named removed pile with the protocol zone parameter identity", () => {
  const value = model([1, 2, 3], 2);
  value.observeZone({
    zoneKey: "removed:1:212",
    count: 1,
    cardIds: [3],
    complete: true,
    source: { rule: "protocol-card-move", authority: "server-protocol" }
  });

  const named = value.observeNamedCardZone({
    zoneKind: "removed",
    pileKey: "212",
    skillId: 212,
    zoneParam: 212,
    hostSeat: 1,
    ownerSeat: null,
    ownershipKnown: true,
    count: 1,
    cardIds: [3],
    complete: true,
    visibilityAudience: "runtime-observed",
    observerSeats: [0]
  });

  assert.equal(named.zoneKey, "removed:1:212");
  assert.equal(value.explainCard(3).location.zoneKey, "removed:1:212");
  assert.equal(value.namedCardZones({ hostSeat: 1, skillId: 212 }).length, 1);
  assert.equal(value.snapshot().world.consistent, true);
});

test("runtime snapshot adapter syncs and clears named outside-card piles without flattening them", () => {
  const root = {
    modules: { gameModelCore: require("../src/runtime/model/game-model-core.cjs") },
    sources: {
      configState: { loaded: true, cardDict: catalog(), gameRuleDecks: {} }
    },
    tracker: { skillKnowledge: { skills: {} } }
  };
  const runtimeSource = fs.readFileSync(path.join(__dirname, "..", "src", "runtime", "model", "game-model.js"), "utf8");
  vm.runInNewContext(runtimeSource, { window: { __SgsScripts: root } }, { filename: "game-model.js" });

  const managerSeats = [{ handCardCount: 0 }, { handCardCount: 0 }];
  const manager = { seats: managerSeats, GameCardIds: [1, 2, 3], CardPileCardCount: 2 };
  const scene = { manager };
  const context = {
    ok: true,
    scene,
    managerSeats,
    seats: managerSeats,
    selfSeatIndex: 0,
    mode: { candidates: {} }
  };
  const emptyZones = {
    equip: { count: 0, cards: [], complete: true },
    judge: { count: 0, cards: [], complete: true },
    general: { count: 0, cards: [], complete: true }
  };
  const named = {
    zoneKind: "removed",
    pileKey: "212",
    zoneParam: 212,
    skillId: 212,
    hostSeat: 1,
    ownerSeat: null,
    ownershipKnown: true,
    ordered: false,
    orderKnown: false,
    faceUp: false,
    visibilityAudience: "restricted",
    observerSeats: [0],
    count: 1,
    cardIds: [3],
    cards: [{ id: 3 }],
    complete: true,
    cardStates: { 3: { faceUp: false, visibilityAudience: "restricted", observerSeats: [0] } }
  };

  let snapshot = root.tracker.syncGameModel(context, {
    seats: [{ seatIndex: 1, zones: emptyZones, namedZones: [named] }]
  });
  assert.equal(snapshot.zones["removed:1:212"].count, 1);
  assert.deepEqual(snapshot.zones["removed:1:212"].exactIds, [3]);
  assert.equal(snapshot.zones["general:1"].count, 0);
  assert.equal(snapshot.zones["removed:1:212"].ownershipKnown, true);
  assert.equal(snapshot.zones["removed:1:212"].orderKnown, false);

  snapshot = root.tracker.syncGameModel(context, {
    seats: [{ seatIndex: 1, zones: emptyZones, namedZones: [] }]
  });
  assert.equal(snapshot.zones["removed:1:212"].count, 0);
  assert.deepEqual(snapshot.zones["removed:1:212"].exactIds, []);

  snapshot = root.tracker.syncGameModel(context, {
    seats: [{
      seatIndex: 1,
      zones: emptyZones,
      namedZones: [{
        zoneKind: "removed",
        pileKey: "922",
        zoneParam: 922,
        skillId: 922,
        hostSeat: 1,
        count: 1,
        cardIds: [],
        cards: [],
        complete: false,
        representationKind: "nonphysical-state"
      }]
    }]
  });
  const outsideState = Object.values(snapshot.ruleStates).find((row) => row.metadata?.representationKind === "nonphysical-state");
  assert.equal(outsideState.value, 1);
  assert.equal(snapshot.zones["removed:1:922"], undefined);

  snapshot = root.tracker.syncGameModel(context, {
    seats: [{ seatIndex: 1, zones: emptyZones, namedZones: [] }]
  });
  assert.equal(snapshot.ruleStates[outsideState.key].value, 0);
  assert.equal(snapshot.world.consistent, true);
});

test("rehosts an equipment-attached named pile only after an explicit host transition", () => {
  const value = model([1, 2, 3, 4], 1);
  value.observeZone({ zoneKey: "equip:0", count: 1, cardIds: [4], complete: true });
  const pile = value.observeNamedCardZone({
    zoneKind: "removed",
    pileKey: "wooden-ox:700",
    zoneParam: 700,
    skillId: 700,
    hostSeat: 0,
    hostArea: "equipment",
    hostCardId: 4,
    attachmentPolicy: "follow-host-on-authoritative-transfer",
    capacity: 5,
    count: 2,
    cardIds: [2, 3],
    complete: true,
    visibilityAudience: "restricted",
    observerSeats: [0]
  });

  value.observeMove({ from: "equip:0", to: "equip:1", count: 1, cardIds: [4] });
  assert.equal(value.namedCardZones({ hostCardId: 4, includeHiddenIdentity: true })[0].hostSeat, 0);
  const moved = value.rehostNamedCardZone({
    zoneKey: pile.zoneKey,
    hostCardId: 4,
    newHostSeat: 1,
    newHostArea: "equipment"
  });

  assert.equal(moved.applied, true);
  assert.equal(moved.toZoneKey, "removed:1:700");
  assert.equal(value.snapshot().zones[pile.zoneKey].count, 0);
  assert.deepEqual(value.snapshot().zones["removed:1:700"].exactIds, [2, 3]);
  assert.equal(value.snapshot().zones["removed:1:700"].hostCardId, 4);
  assert.equal(value.snapshot().zones["removed:1:700"].capacity, 5);
  assert.equal(value.snapshot().namedZoneHostHistory.length, 1);
  assert.equal(value.snapshot().world.consistent, true);
});

test("keeps a player-scoped named pile stable across avatar replacement", () => {
  const value = model([1, 2, 3, 4], 3);
  const first = value.observeNamedCardZone({
    zoneKind: "player-retained-equipment",
    pileKey: "藏机",
    hostSeat: 0,
    hostPlayerKey: "player:account-1",
    hostAvatarKey: "avatar:first-general",
    lifecycleScope: "player",
    count: 1,
    cardIds: [4],
    complete: true,
    faceUp: true,
    visibilityAudience: "public"
  });
  const second = value.observeNamedCardZone({
    zoneKind: "player-retained-equipment",
    pileKey: "藏机",
    hostSeat: 0,
    hostPlayerKey: "player:account-1",
    hostAvatarKey: "avatar:successor-general",
    lifecycleScope: "player",
    count: 1,
    cardIds: [4],
    complete: true,
    faceUp: true,
    visibilityAudience: "public"
  });

  assert.equal(first.zoneKey, second.zoneKey);
  assert.match(first.zoneKey, /player-player%3Aaccount-1/);
  assert.equal(second.hostPlayerKey, "player:account-1");
  assert.equal(second.hostAvatarKey, "avatar:successor-general");
  assert.equal(second.lifecycleScope, "player");
  assert.deepEqual(second.exactIds, [4]);
  assert.equal(value.namedCardZones({ hostPlayerKey: "player:account-1", lifecycleScope: "player" }).length, 1);
  assert.equal(value.explainCard(4).location.zoneKey, first.zoneKey);
  assert.equal(value.snapshot().deck.count, 3);
});

test("does not recycle the old judgement card when a top-deck substitute empties the deck first", () => {
  const value = model([1, 2, 3], 1);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1] });
  value.observeZone({ zoneKey: "process", count: 1, cardIds: [2], complete: true });
  value.observeZone({ zoneKey: "discard", count: 1, cardIds: [3], complete: true });

  const result = value.applyOperation({
    type: "judgement-substitute",
    oldCardId: 2,
    newCardId: 1,
    newFrom: "deck-top"
  });

  const snapshot = value.snapshot();
  assert.equal(result.status, "applied");
  assert.equal(snapshot.epoch, 1);
  assert.deepEqual(snapshot.zones.process.exactIds, [1]);
  assert.deepEqual(snapshot.discard.exactIds, [2]);
  assert.equal(snapshot.locations[3].zoneKey, "deck");
});

test("distinguishes judgement exchange by moving the old card to the caster hand", () => {
  const value = model([1, 2, 3], 1);
  value.observeZone({ zoneKey: "process", count: 1, cardIds: [2], complete: true });
  value.observeHand({ seatIndex: 0, count: 1, cardIds: [1], complete: true, visibility: "self" });

  const result = value.applyOperation({
    type: "judgement-exchange",
    oldCardId: 2,
    newCardId: 1,
    newFrom: "hand:0",
    oldTo: "hand:0"
  });

  const snapshot = value.snapshot();
  assert.equal(result.status, "applied");
  assert.deepEqual(snapshot.zones.process.exactIds, [1]);
  assert.deepEqual(snapshot.hands[0].exactIds, [2]);
  assert.deepEqual(snapshot.discard.exactIds, []);
});

test("keeps delayed-trick outcome inversion separate from judgement card facts", () => {
  const value = model([1, 2, 3], 2);
  value.observeZone({ zoneKey: "process:judgement", count: 1, cardIds: [2], complete: true });
  value.observeJudgementOutcome({
    judgementId: "judge:1",
    judgementCardId: 2,
    delayedTrickCardId: 3,
    subjectSeat: 0,
    effectiveName: "乐不思蜀",
    baseSuccess: true,
    status: "resolved"
  });
  const inverted = value.applyOperation({
    type: "invert-judgement-outcome",
    judgementId: "judge:1",
    layerId: "shenyi:1110:judge:1",
    skillId: 1110
  });
  const duplicate = value.invertJudgementOutcome({
    judgementId: "judge:1",
    layerId: "shenyi:1110:judge:1",
    skillId: 1110
  });

  assert.equal(inverted.status, "applied");
  assert.equal(duplicate.duplicate, true);
  assert.equal(value.judgementOutcome("judge:1").baseSuccess, true);
  assert.equal(value.judgementOutcome("judge:1").derivedSuccess, false);
  assert.equal(value.judgementOutcome("judge:1").finalSuccess, false);
  assert.equal(value.judgementOutcome("judge:1").inversionCount, 1);
  assert.equal(value.explainCard(2).location.zoneKey, "process:judgement");
  assert.equal(value.effectiveCard(2).printed.name, "无懈可击");
  assert.equal(value.judgementOutcomes({ subjectSeat: 0 }).length, 1);

  value.observeJudgementOutcome({ judgementId: "judge:1", reportedFinalSuccess: true });
  assert.equal(value.judgementOutcome("judge:1").reportedFinalSuccess, true);
  assert.equal(value.judgementOutcome("judge:1").finalSuccess, true);
  assert.equal(value.snapshot().judgementOutcomeHistory.length, 3);
  assert.deepEqual(value.snapshot().zones["process:judgement"].exactIds, [2]);
});

test("keeps a correct-count boolean result ambiguous until constraints force individual truths", () => {
  const value = model([1, 2, 3, 4, 5, 6], 6);
  value.observeHand({ seatIndex: 1, count: 3, complete: false, visibility: "hidden" });
  const observed = value.applyOperation({
    type: "observe-boolean-constraint",
    key: "lingren:use:1:target:1",
    skillId: 850,
    subjectSeat: 1,
    bindToCurrentHand: true,
    propositions: [
      { key: "has-basic", statement: { typeOriginal: 1 } },
      { key: "has-trick", statement: { typeOriginal: 2 } },
      { key: "has-equipment", statement: { typeOriginal: 3 } }
    ],
    terms: [
      { key: "has-basic", equals: true },
      { key: "has-trick", equals: true },
      { key: "has-equipment", equals: true }
    ],
    correctCount: 2,
    cardinalityId: "server-correct-count"
  });

  assert.equal(observed.status, "applied");
  let constraint = value.booleanConstraint("lingren:use:1:target:1");
  assert.equal(constraint.solutionCount, 3);
  assert.equal(constraint.propositions["has-basic"].value, null);
  assert.deepEqual(constraint.propositions["has-basic"].possibleValues, [false, true]);
  assert.equal(constraint.propositions["has-trick"].value, null);
  assert.equal(constraint.propositions["has-equipment"].value, null);

  value.observeBooleanConstraint({
    key: "lingren:use:1:target:1",
    assignments: { "has-basic": true }
  });
  constraint = value.booleanConstraint("lingren:use:1:target:1");
  assert.equal(constraint.solutionCount, 2);
  assert.equal(constraint.propositions["has-basic"].observedValue, true);
  assert.equal(constraint.propositions["has-trick"].value, null);
  assert.equal(constraint.propositions["has-equipment"].value, null);

  value.observeBooleanConstraint({
    key: "lingren:use:1:target:1",
    assignments: { "has-trick": true }
  });
  constraint = value.booleanConstraint("lingren:use:1:target:1");
  assert.equal(constraint.solutionCount, 1);
  assert.equal(constraint.propositions["has-equipment"].observedValue, null);
  assert.equal(constraint.propositions["has-equipment"].derivedValue, false);
  assert.equal(constraint.propositions["has-equipment"].value, false);

  value.observeMove({ from: "deck", to: "hand:1", count: 1, cardIds: [1] });
  constraint = value.booleanConstraint("lingren:use:1:target:1");
  assert.equal(constraint.active, false);
  assert.equal(constraint.status, "expired");
  assert.equal(value.booleanConstraints({ active: true, subjectSeat: 1 }).length, 0);
  assert.ok(value.snapshot().booleanConstraintHistory.some((row) => row.type === "expire"));
});

test("rejects malformed boolean evidence and lets stronger sources revise a fixed proposition", () => {
  const value = model([1, 2, 3], 3);
  const malformedValue = value.observeBooleanConstraint({
    key: "boolean:strict",
    propositions: [{ key: "p", value: "false" }]
  });
  const malformedCount = value.observeBooleanConstraint({
    key: "boolean:bad-count",
    propositions: ["p"],
    terms: [{ key: "p", equals: true }],
    correctCount: "unknown"
  });
  assert.equal(malformedValue.applied, false);
  assert.equal(malformedValue.reason, "boolean-proposition-value-must-be-boolean");
  assert.equal(malformedCount.applied, false);
  assert.equal(malformedCount.reason, "boolean-cardinality-count-must-be-nonnegative-integer");
  assert.equal(value.booleanConstraint("boolean:strict"), null);
  assert.equal(value.booleanConstraint("boolean:bad-count"), null);

  value.observeBooleanConstraint({
    key: "boolean:authority",
    propositions: [{ key: "p", value: false }],
    source: sourceOf("skill-text-guess", "skill-text")
  });
  const revised = value.observeBooleanConstraint({
    key: "boolean:authority",
    assignments: { p: true },
    source: sourceOf("server-result", "server-protocol")
  });
  assert.equal(revised.applied, true);
  assert.equal(value.booleanConstraint("boolean:authority").propositions.p.observedValue, true);
  assert.equal(value.booleanConstraint("boolean:authority").propositions.p.observedSource.kind, "server-protocol");
  assert.ok(value.snapshot().contradictions.some((row) => row.code === "boolean-proposition-authoritative-revision"));

  value.observeHand({ seatIndex: 2, count: 1, complete: false, visibility: "hidden" });
  const oldGeneration = value.snapshot().hands[2].generation;
  value.observeMove({ from: "deck", to: "hand:2", count: 1, cardIds: [1] });
  const stale = value.observeBooleanConstraint({
    key: "boolean:stale-hand",
    subjectSeat: 2,
    handGeneration: oldGeneration,
    bindToCurrentHand: true,
    propositions: [{ key: "p", value: true }]
  });
  assert.equal(stale.applied, true);
  assert.equal(value.booleanConstraint("boolean:stale-hand").active, false);
  assert.equal(value.booleanConstraint("boolean:stale-hand").status, "expired");
  assert.equal(value.booleanConstraint("boolean:stale-hand").invalidationReason, "stale-hand-generation-at-observation");
});

test("links hand-any propositions only to same-generation positive or complete absence evidence", () => {
  const value = model([1, 2, 3, 4], 4);
  value.observeHand({ seatIndex: 1, count: 2, cardIds: [], complete: false, visibility: "count-only" });
  const generation = value.snapshot().hands[1].generation;
  value.observeBooleanConstraint({
    key: "lingren:hand-bridge",
    subjectSeat: 1,
    handGeneration: generation,
    bindToCurrentHand: true,
    skillId: 850,
    ruleIdentityKey: "cha_spell.spell:850/LingRen",
    propositions: [
      { key: "basic", statement: { kind: "hand-any", predicate: { type: "basic" } } },
      { key: "trick", statement: { kind: "hand-any", predicate: { type: "trick" } } },
      { key: "equip", statement: { kind: "hand-any", predicate: { type: "equip" } } }
    ],
    terms: [
      { key: "basic", equals: true },
      { key: "trick", equals: true },
      { key: "equip", equals: true }
    ],
    correctCount: 2
  });
  let constraint = value.booleanConstraint("lingren:hand-bridge");
  assert.equal(constraint.solutionCount, 3);
  assert.equal(constraint.propositions.basic.linkedValue, null);
  assert.equal(constraint.propositions.trick.linkedValue, null);
  assert.equal(constraint.propositions.equip.linkedValue, null);

  value.applyOperation({
    type: "authorized-view-hand",
    eventId: "hand:view:bridge:partial",
    seatIndex: 1,
    observerSeat: 0,
    count: 2,
    cardIds: [1],
    complete: false
  });
  constraint = value.booleanConstraint("lingren:hand-bridge");
  assert.equal(value.snapshot().hands[1].generation, generation);
  assert.equal(constraint.propositions.basic.linkedValue, true);
  assert.equal(constraint.propositions.equip.linkedValue, null);
  assert.equal(constraint.solutionCount, 2);

  value.observeHandConstraint({ seatIndex: 1, kind: "none-match", predicate: { type: "equip" } });
  constraint = value.booleanConstraint("lingren:hand-bridge");
  assert.equal(constraint.propositions.equip.linkedValue, false);
  assert.equal(constraint.propositions.trick.derivedValue, true);
  assert.deepEqual(constraint.entailedFacts, [{ propositionKey: "trick", value: true }]);
  assert.equal(constraint.solutionCount, 1);

  value.applyOperation({
    type: "authorized-view-hand",
    eventId: "hand:view:bridge:complete",
    seatIndex: 1,
    observerSeat: 0,
    count: 2,
    cardIds: [1, 2],
    complete: true
  });
  constraint = value.booleanConstraint("lingren:hand-bridge");
  assert.equal(value.snapshot().hands[1].generation, generation);
  assert.equal(constraint.propositions.trick.linkedValue, true);
  assert.equal(constraint.propositions.trick.derivedValue, null);
  assert.equal(constraint.propositions.equip.linkedValue, false);
  assert.equal(constraint.solutionCount, 1);
  assert.ok(value.snapshot().booleanConstraintHistory.some((row) => row.type === "hand-knowledge-refine"));
});

test("partitions an observed deck window into ordered top and bottom groups without changing membership", () => {
  const value = model([1, 2, 3, 4, 5, 6], 5);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1, 2, 3] });
  value.observeSearchResult({
    predicate: { name: "八卦阵" },
    requestedCount: 1,
    foundCardIds: [],
    exhaustive: true
  });

  const result = value.partitionDeckWindow({
    windowCardIds: [1, 2, 3],
    topCardIds: [3],
    bottomCardIds: [1, 2]
  });

  const snapshot = value.snapshot();
  assert.equal(result.status, "applied");
  assert.equal(snapshot.deck.count, 5);
  assert.deepEqual(snapshot.deck.top, [3]);
  assert.deepEqual(snapshot.deck.bottom, [1, 2]);
  assert.equal(snapshot.deck.knownRanks[1].cardId, 3);
  assert.equal(snapshot.deck.knownRanks[5].cardId, 1);
  assert.equal(snapshot.deck.knownRanks[4].cardId, 2);
  assert.deepEqual(snapshot.deck.excludedIds, [4]);
});

test("keeps prior reveal-until misses in process while a scan crosses an exhaustion recycle", () => {
  const value = model([1, 2, 3, 4], 1);
  value.revealDeckEndpoint({ endpoint: "top", cardIds: [1] });
  value.observeZone({ zoneKey: "discard", count: 2, cardIds: [2, 3], complete: true });

  const result = value.applyOperation({
    type: "reveal-until-result",
    endpoint: "top",
    predicate: { type: "trick" },
    revealedCardIds: [1, 2],
    matchCardId: 2,
    destination: "hand:0"
  });

  const snapshot = value.snapshot();
  assert.equal(result.status, "applied");
  assert.equal(snapshot.epoch, 1);
  assert.equal(snapshot.locations[3].zoneKey, "deck");
  assert.equal(snapshot.locations[1].zoneKey, "discard");
  assert.equal(snapshot.locations[2].zoneKey, "hand:0");
  assert.deepEqual(snapshot.discard.exactIds, [1]);
  assert.deepEqual(snapshot.discard.history.map((row) => [row.cardId, row.epoch]), [[1, 1]]);
});

test("uses non-movement game events as the default turn context for later card facts", () => {
  const value = model([1, 2, 3], 2);
  value.observeHand({ seatIndex: 0, count: 1, cardIds: [1], complete: true, visibility: "self" });
  value.observeGameEvent({ type: "game:turn", turn: 4, round: 2, seat: 0, protocol: "MsgGameTurnNtf" });
  value.observeGameEvent({ type: "game:phase", context: { turn: 4, round: 2, phase: 5 }, seat: 0 });

  value.observeMove({ from: "hand:0", to: "discard", count: 1, cardIds: [1] });
  value.observeGameEvent({ type: "game:over" });

  const snapshot = value.snapshot();
  assert.deepEqual(snapshot.context, { turn: 4, round: 2, phase: 5, activeSeat: 0, stage: null, gameOver: true });
  assert.deepEqual(value.discardForTurn(4, 2).entries.map((row) => row.phase), [5]);
  assert.ok(snapshot.recentEvents.some((row) => row.type === "game.event" && row.eventType === "game:over"));
});

test("does not reinterpret generic skill payload values as target seats", () => {
  const value = model([1, 2, 3], 3);
  const generic = value.observeGameEvent({ type: "skill:use", targets: [9001, 9002], skillId: 100 });
  const explicit = value.observeGameEvent({ type: "skill:option", targetSeat: 2, skillId: 100 });

  assert.deepEqual(generic.targetSeats, []);
  assert.deepEqual(explicit.targetSeats, [2]);
  assert.deepEqual(value.causalEvent(generic.causalEventId).targetSeats, []);
  assert.deepEqual(value.causalEvent(explicit.causalEventId).targetSeats, [2]);
});

test("keeps durable all-seat hand-count transitions when card identities are hidden", () => {
  const value = model([1, 2, 3], 3);
  value.observeGameEvent({ type: "game:turn", turn: 6, round: 2, seat: 0 });
  value.observeHand({ seatIndex: 1, count: 2, cardIds: [], complete: false, visibility: "count-only" });
  value.observeMove({
    from: "hand:1",
    to: "discard",
    count: 2,
    cardIds: [],
    causalEventId: "discard:event:1"
  });

  const lost = value.handTransitions({
    seatIndex: 1,
    turn: 6,
    lostLastHand: true,
    causalEventId: "discard:event:1"
  });
  const snapshot = value.snapshot();
  assert.equal(lost.length, 1);
  assert.equal(lost[0].before.count, 2);
  assert.equal(lost[0].after.count, 0);
  assert.equal(lost[0].delta, -2);
  assert.equal(lost[0].lostLastHand, true);
  assert.deepEqual(snapshot.hands[1].exactIds, []);
  assert.equal(snapshot.hands[1].count, 0);
  assert.ok(snapshot.handHistory.some((row) => row.gainedFirstHand && row.after.count === 2));
});

test("exchanges two whole hands atomically without intermediate empty-hand transitions", () => {
  const value = model([1, 2, 3, 4, 5, 6], 2);
  value.observeHand({ seatIndex: 0, count: 2, cardIds: [1, 2], complete: true, visibility: "self" });
  value.observeHand({ seatIndex: 1, count: 1, cardIds: [3], complete: true, visibility: "authorized" });
  value.observeHandConstraint({ seatIndex: 0, kind: "at-least", predicate: { color: "black" }, count: 1 });
  value.observeHandConstraint({ seatIndex: 1, kind: "exact-count", predicate: { name: "无懈可击" }, count: 1 });

  const result = value.applyOperation({
    type: "exchange-hands",
    leftSeat: 0,
    rightSeat: 1,
    causalEventId: "skill:746:exchange:1",
    atomicOperationId: "whole-hand:1",
    skillId: 746
  });
  const snapshot = value.snapshot();
  const transitions = value.handTransitions({ causalEventId: "skill:746:exchange:1" });

  assert.equal(result.status, "applied");
  assert.deepEqual(snapshot.hands[0].exactIds, [3]);
  assert.deepEqual(snapshot.hands[1].exactIds, [1, 2]);
  assert.equal(snapshot.locations[1].zoneKey, "hand:1");
  assert.equal(snapshot.locations[3].zoneKey, "hand:0");
  assert.equal(transitions.length, 2);
  assert.deepEqual(transitions.map((row) => [row.seatIndex, row.before.count, row.after.count]), [[0, 2, 1], [1, 1, 2]]);
  assert.ok(transitions.every((row) => row.simultaneous && row.atomicOperationId === "whole-hand:1"));
  assert.ok(transitions.every((row) => !row.lostLastHand && !row.gainedFirstHand));
  assert.ok(transitions.every((row) => row.after.constraints.length === 0));
  assert.equal(value.zoneExchanges({ atomicOperationId: "whole-hand:1" }).length, 1);
  assert.equal(snapshot.zoneExchangeHistory[0].exactMovements.length, 3);
  assert.equal(value.cardEvents({ cardId: 1, movementReason: "exchange" }).length, 1);
});

test("advances opaque hand generations and remaps conserved identity groups on atomic exchange", () => {
  const value = model([1, 2, 3, 4, 5, 6], 3);
  value.observeHand({ seatIndex: 0, count: 2, cardIds: [], complete: false, visibility: "count-only" });
  value.observeHand({ seatIndex: 1, count: 1, cardIds: [], complete: false, visibility: "count-only" });
  value.observeHandConstraint({ seatIndex: 0, kind: "none-match", predicate: { suit: "heart" } });
  value.observeHandConstraint({ seatIndex: 1, kind: "none-match", predicate: { type: "trick" } });
  value.observeLocationGroup({
    key: "opaque-hands",
    cardIds: [4, 5, 6],
    zoneKeys: ["hand:0", "hand:1"],
    zoneCounts: { "hand:0": 2, "hand:1": 1 }
  });
  const before = value.snapshot();

  const result = value.exchangeZones({
    leftZone: "hand:0",
    rightZone: "hand:1",
    causalEventId: "opaque-exchange:1",
    atomicOperationId: "opaque-hands:1"
  });
  const after = value.snapshot();
  const transitions = value.handTransitions({ causalEventId: "opaque-exchange:1" });

  assert.equal(result.applied, true);
  assert.equal(after.hands[0].count, 1);
  assert.equal(after.hands[1].count, 2);
  assert.equal(after.hands[0].generation, before.hands[0].generation + 1);
  assert.equal(after.hands[1].generation, before.hands[1].generation + 1);
  assert.deepEqual(after.hands[0].constraints, []);
  assert.deepEqual(after.hands[1].constraints, []);
  assert.deepEqual(value.locationGroup("opaque-hands").zoneCounts, { "hand:1": 2, "hand:0": 1 });
  assert.ok(transitions.every((row) => row.simultaneous && row.contentChanged));
  assert.ok(after.locationGroupHistory.some((row) => row.operation === "zone-exchange"));
});

test("invalidates equal-looking opaque hands when their contents are exchanged", () => {
  const value = model([1, 2, 3, 4, 5, 6], 0);
  value.observeHand({ seatIndex: 0, count: 3, cardIds: [], complete: false });
  value.observeHand({ seatIndex: 1, count: 3, cardIds: [], complete: false });
  value.observeHandConstraint({ seatIndex: 0, kind: "none-match", predicate: { color: "red" } });
  value.observeHandConstraint({ seatIndex: 1, kind: "none-match", predicate: { color: "black" } });
  const before = value.snapshot();

  value.exchangeZones({ leftZone: "hand:0", rightZone: "hand:1", atomicOperationId: "equal-opaque:1" });
  const after = value.snapshot();
  const transitions = after.handHistory.filter((row) => row.atomicOperationId === "equal-opaque:1");

  assert.equal(after.hands[0].generation, before.hands[0].generation + 1);
  assert.equal(after.hands[1].generation, before.hands[1].generation + 1);
  assert.ok(transitions.every((row) => row.knowledgeEquivalent === true));
  assert.ok(transitions.every((row) => row.delta === 0 && !row.lostLastHand && !row.gainedFirstHand));
  assert.deepEqual(after.hands[0].constraints, []);
  assert.deepEqual(after.hands[1].constraints, []);
});

test("proves continuous zone residence across a checkpoint and invalidates it after leave-and-return", () => {
  const value = model([1, 2, 3], 2);
  value.observeHand({ seatIndex: 0, count: 1, cardIds: [1], complete: true, visibility: "self" });
  const checkpoint = value.observeGameEvent({ type: "game:turn", turn: 1, round: 1, seat: 0 });

  assert.deepEqual(value.cardsContinuouslyInZone({
    zoneKey: "hand:0",
    sinceEventIndex: checkpoint.eventIndex
  }).cardIds, [1]);

  value.observeMove({ from: "hand:0", to: "discard", count: 1, cardIds: [1] });
  value.observeMove({ from: "discard", to: "hand:0", count: 1, cardIds: [1] });

  assert.deepEqual(value.cardsContinuouslyInZone({
    zoneKey: "hand:0",
    sinceEventIndex: checkpoint.eventIndex
  }).cardIds, []);
  assert.equal(value.cardResidence(1).history.length, 2);
  assert.equal(value.cardResidence(1).current.zoneKey, "hand:0");
});

test("queries the exact card zone immediately before and after a historical movement boundary", () => {
  const value = model([1, 2, 3], 2);
  value.observeHand({ seatIndex: 0, count: 1, cardIds: [1], complete: true, visibility: "self" });
  value.observeMove({
    from: "hand:0",
    to: "process:use",
    count: 1,
    cardIds: [1],
    causalEventId: "use:1"
  });
  const boundary = value.movements({ cardId: 1 })[0].eventIndex;

  const before = value.cardLocationAt({ cardId: 1, eventIndex: boundary, moment: "before" });
  const after = value.cardLocationAt({ cardId: 1, eventIndex: boundary, moment: "after" });
  assert.equal(before.exact, true);
  assert.equal(before.location.zoneKey, "hand:0");
  assert.equal(before.location.nextZoneKey, "process:use");
  assert.equal(after.exact, true);
  assert.equal(after.location.zoneKey, "process:use");
  assert.equal(after.location.previousZoneKey, "hand:0");

  value.observeMove({ from: "process:use", to: "discard", count: 1, cardIds: [1], causalEventId: "use:1" });
  assert.equal(value.cardLocationAt({ cardId: 1, eventIndex: boundary, moment: "before" }).location.zoneKey, "hand:0");
  assert.equal(value.cardLocationAt({ cardId: 1, eventIndex: boundary, moment: "after" }).location.zoneKey, "process:use");
});

test("treats same-timestamp movements as one before/after location boundary", () => {
  const value = makeGameModel({ now: () => 1000 });
  value.configureGame({
    catalog: catalog(),
    deckCardIds: [1, 2, 3],
    deckCount: 2,
    sessionKey: "same-time-location-test"
  });
  value.observeHand({ seatIndex: 0, count: 1, cardIds: [1], complete: true, visibility: "self" });
  value.observeMove({ from: "hand:0", to: "process:use", count: 1, cardIds: [1] });
  value.observeMove({ from: "process:use", to: "discard", count: 1, cardIds: [1] });

  assert.equal(value.cardLocationAt({ cardId: 1, time: 1000, moment: "before" }).location.zoneKey, "hand:0");
  assert.equal(value.cardLocationAt({ cardId: 1, time: 1000, moment: "after" }).location.zoneKey, "discard");
});

test("keeps a queryable per-physical-card use and offset event ledger", () => {
  const value = model([1, 2, 3], 2);
  value.observeGameEvent({ type: "game:turn", turn: 3, round: 2, seat: 0 });
  value.observeGameEvent({ type: "card:use", cardId: 2, seat: 0 });
  value.observeGameEvent({ type: "card:offset", cardId: 2, seat: 1, tags: "countered" });

  assert.equal(value.cardEvents({ cardId: 2, turn: 3 }).length, 2);
  assert.equal(value.cardEvents({ cardId: 2, tag: "used" }).length, 1);
  assert.equal(value.cardEvents({ cardId: 2, tags: ["offset", "countered"] }).length, 1);
  assert.deepEqual(value.snapshot().cardEventHistory.map((row) => row.eventType), ["card:use", "card:offset"]);
});

test("keeps ordered movement batches and per-card equipment slot provenance", () => {
  const value = model([1, 2, 3, 4, 5], 3);
  value.observeZone({ zoneKey: "equip:0", count: 2, cardIds: [4, 5], complete: true });
  value.observeMove({
    from: "equip:0",
    to: "process:discard:0",
    count: 1,
    cardIds: [4],
    movementGroupId: "whole-equip-leave:7",
    sequenceIndex: 1,
    cardDetails: [{ cardId: 4, sourceSlot: "weapon", cardSequenceIndex: 1 }],
    movementReason: "discard"
  });
  value.observeMove({
    from: "equip:0",
    to: "process:discard:0",
    count: 1,
    cardIds: [5],
    movementGroupId: "whole-equip-leave:7",
    sequenceIndex: 0,
    cardDetails: [{ cardId: 5, sourceSlot: "armor", cardSequenceIndex: 0 }],
    movementReason: "discard"
  });

  const batch = value.movements({ movementGroupId: "whole-equip-leave:7" });
  assert.deepEqual(batch.map((row) => row.sequenceIndex), [0, 1]);
  assert.deepEqual(batch.map((row) => row.cardIds[0]), [5, 4]);
  assert.equal(batch[0].cardDetails[0].sourceSlot, "armor");
  assert.equal(batch[1].cardDetails[0].sourceSlot, "weapon");
  assert.equal(value.cardEvents({ cardId: 4, eventType: "card:move" })[0].movementGroupId, "whole-equip-leave:7");
  assert.equal(value.cardEvents({ cardId: 4, eventType: "card:move" })[0].sourceSlot, "weapon");
  assert.equal(value.snapshot().movementHistory.length, 2);
});

test("keeps prevented movement attempts separate from successful physical moves", () => {
  const value = model([1, 2, 3, 4], 3);
  value.observeZone({ zoneKey: "equip:0", count: 1, cardIds: [4], complete: true });
  value.observeMovementAttempt({
    attemptId: "discard-attempt:1",
    from: "equip:0",
    to: "discard",
    count: 1,
    cardIds: [4],
    actorSeat: 1,
    targetSeat: 0,
    actionType: "discard-equipment"
  });
  value.applyOperation({
    type: "prevent-movement-attempt",
    attemptId: "discard-attempt:1",
    preventionSkillId: 871,
    preventionReason: "protected-armor-or-treasure"
  });

  assert.equal(value.movementAttempts({ prevented: true }).length, 1);
  assert.deepEqual(value.snapshot().zones["equip:0"].exactIds, [4]);
  assert.equal(value.snapshot().movementHistory.length, 0);

  value.observeMovementAttempt({
    attemptId: "discard-attempt:2",
    from: "equip:0",
    to: "discard",
    count: 1,
    cardIds: [4],
    actorSeat: 0,
    targetSeat: 0,
    actionType: "discard-equipment",
    status: "accepted"
  });
  value.observeMove({
    from: "equip:0",
    to: "discard",
    count: 1,
    cardIds: [4],
    movementAttemptId: "discard-attempt:2",
    movementReason: "discard"
  });

  assert.equal(value.movementAttempts({ status: "moved" })[0].movementApplied, true);
  assert.equal(value.cardEvents({ cardId: 4, eventType: "card:move" })[0].movementAttemptId, "discard-attempt:2");
  assert.deepEqual(value.snapshot().zones["equip:0"].exactIds, []);
  assert.deepEqual(value.snapshot().discard.exactIds, [4]);
  assert.equal(value.snapshot().movementAttemptHistory.length, 4);
});

test("keeps target effects, responses, and damage in one durable causal event graph", () => {
  const value = model([1, 2, 3], 3);
  value.observeCausalEvent({
    eventId: "use:nanman:1",
    eventType: "card:use",
    roles: { userSeat: 0 },
    targetSeats: [1, 2],
    cardId: 3,
    effectiveName: "南蛮入侵",
    status: "resolving"
  });
  value.observeCausalEvent({
    eventId: "effect:nanman:seat1",
    eventType: "card:target-effect",
    parentEventId: "use:nanman:1",
    sequenceIndex: 0,
    roles: { targetSeat: 1 },
    status: "awaiting-response"
  });
  value.observeCausalEvent({
    eventId: "response:nanman:seat1",
    eventType: "card:respond",
    parentEventId: "effect:nanman:seat1",
    roles: { responderSeat: 1 },
    cardId: 1,
    effectiveName: "杀",
    outcome: "satisfied"
  });
  value.observeCausalEvent({
    eventId: "effect:nanman:seat2",
    eventType: "card:target-effect",
    parentEventId: "use:nanman:1",
    sequenceIndex: 1,
    roles: { targetSeat: 2 },
    status: "awaiting-response"
  });
  value.applyOperation({
    type: "causal-event",
    eventId: "damage:nanman:seat2",
    eventType: "damage",
    parentEventId: "effect:nanman:seat2",
    roles: { userSeat: 0, damageSourceSeat: 3, targetSeat: 2 },
    status: "resolved",
    outcome: "one-fire-damage"
  });
  value.observeCausalEvent({
    eventId: "damage:nanman:seat2",
    eventType: "damage",
    parentEventId: "effect:nanman:seat2",
    status: "settled"
  });

  value.observeMove({
    from: "deck",
    to: "hand:1",
    count: 1,
    cardIds: [1],
    causalEventId: "response:nanman:seat1"
  });

  const root = value.queryCausalEvents({ rootEventId: "use:nanman:1" });
  const lineage = value.causalLineage("response:nanman:seat1");
  const damage = value.causalEvent("damage:nanman:seat2");
  const snapshot = value.snapshot();
  assert.deepEqual(root.map((row) => row.eventId), [
    "effect:nanman:seat1",
    "effect:nanman:seat2",
    "use:nanman:1",
    "response:nanman:seat1",
    "damage:nanman:seat2"
  ]);
  assert.deepEqual(lineage.ancestors.map((row) => row.eventId), ["use:nanman:1", "effect:nanman:seat1"]);
  assert.equal(damage.roles.userSeat, 0);
  assert.equal(damage.roles.damageSourceSeat, 3);
  assert.equal(damage.status, "settled");
  assert.equal(damage.revision, 2);
  assert.equal(value.queryCausalEvents({ seat: 3 }).length, 1);
  assert.equal(value.cardEvents({ cardId: 1, causalEventId: "response:nanman:seat1" }).length, 1);
  assert.equal(snapshot.causalEventHistory.length, 6);
  assert.equal(value.observeCausalEvent({ eventId: "use:nanman:1", parentEventId: "response:nanman:seat1" }), null);
  assert.ok(value.snapshot().contradictions.some((row) => row.code === "causal-event-cycle"));
});

test("separates the current ordered target set from historical per-target effect outcomes", () => {
  const value = model([1, 2, 3], 3);
  const targetStateKey = "use:sha:targets";
  value.observeCausalEvent({
    eventId: "use:sha",
    eventType: "card:use",
    cardId: 1,
    roles: { userSeat: 0 },
    targetSeats: [1],
    status: "resolving"
  });
  value.updateRuleState({ key: targetStateKey, kind: "ordered-list", operation: "set", values: [1], lifecycle: "game" });

  value.updateRuleState({ key: targetStateKey, kind: "ordered-list", operation: "append", value: 2 });
  value.observeCausalEvent({ eventId: "use:sha", eventType: "card:use", targetSeats: [2] });
  value.observeCausalEvent({
    eventId: "effect:sha:seat1",
    eventType: "card:target-effect",
    parentEventId: "use:sha",
    sequenceIndex: 0,
    roles: { targetSeat: 1 },
    status: "effect-invalid",
    outcome: "target-retained-effect-cancelled"
  });
  value.observeCausalEvent({
    eventId: "effect:sha:seat2",
    eventType: "card:target-effect",
    parentEventId: "use:sha",
    sequenceIndex: 1,
    roles: { targetSeat: 2 },
    status: "resolved"
  });
  value.observeCausalEvent({
    eventId: "effect:sha:seat2:repeat",
    eventType: "card:target-effect",
    parentEventId: "use:sha",
    sequenceIndex: 2,
    roles: { targetSeat: 2 },
    status: "resolved",
    tags: ["extra-resolution"]
  });
  value.updateRuleState({ key: targetStateKey, kind: "ordered-list", operation: "remove", value: 1 });

  assert.deepEqual(value.ruleState(targetStateKey).value, [2]);
  assert.deepEqual(value.causalEvent("use:sha").targetSeats, [1, 2]);
  assert.equal(value.causalEvent("effect:sha:seat1").status, "effect-invalid");
  assert.equal(value.queryCausalEvents({ parentEventId: "use:sha", eventType: "card:target-effect" }).length, 3);
  assert.equal(value.queryCausalEvents({ parentEventId: "use:sha", tags: ["extra-resolution"] }).length, 1);
  assert.deepEqual(value.causalEvent("use:sha").cardIds, [1]);
});

test("binds physical, zero-subcard, and transformed card identities without synthetic CardIDs", () => {
  const value = model([1, 2, 3, 4, 5], 5);
  const transformed = value.observeCardAction({
    eventId: "use:zhangba:1",
    action: "use",
    identityKind: "virtual-with-subcards",
    virtual: true,
    cardId: 99999,
    subcards: [
      { cardId: 1, fromZone: "hand:1", role: "material", providerSeat: 1 },
      { cardId: 5, fromZone: "hand:1", role: "material", providerSeat: 1 }
    ],
    declaredIdentity: { name: "杀" },
    effectiveIdentity: { name: "杀", type: "basic", color: "red" },
    providerSeat: 1,
    effectiveUserSeat: 0,
    targetSeats: [2],
    status: "resolving"
  });
  const zeroSubcard = value.applyOperation({
    type: "observe-card-action",
    eventId: "response:bagua:1",
    action: "respond",
    identityKind: "virtual-zero-subcard",
    virtual: true,
    effectiveIdentity: { name: "闪", type: "basic" },
    effectiveUserSeat: 0,
    status: "resolved"
  });
  const physical = value.observeCardAction({
    eventId: "use:physical:2",
    action: "use",
    identityKind: "physical",
    mainCardId: 2,
    effectiveIdentity: { name: "无懈可击", type: "trick" },
    effectiveUserSeat: 0
  });

  const transformedBinding = value.cardAction("use:zhangba:1").binding;
  assert.deepEqual(transformed.cardIds, [1, 5]);
  assert.equal(transformed.cardIds.includes(99999), false);
  assert.equal(transformedBinding.logicalCardToken, "99999");
  assert.deepEqual(transformedBinding.physicalCardIds, [1, 5]);
  assert.equal(transformedBinding.providerSeat, 1);
  assert.equal(transformedBinding.effectiveUserSeat, 0);
  assert.equal(zeroSubcard.status, "applied");
  assert.deepEqual(value.cardAction("response:bagua:1").binding.physicalCardIds, []);
  assert.deepEqual(physical.cardIds, [2]);
  assert.equal(value.queryCardActions({ identityKind: "virtual-with-subcards", effectiveName: "杀" }).length, 1);
  assert.equal(value.queryCardActions({ effectiveUserSeat: 0 }).length, 3);
  assert.ok(value.snapshot().causalEventHistory.some((row) => row.metadata?.cardBinding?.identityKind === "virtual-zero-subcard"));
});

test("queries and moves a parent action's complete physical material group without duplicating missing entities", () => {
  const value = model([1, 2, 3, 4], 1);
  value.observeZone({ zoneKey: "process", count: 2, cardIds: [1, 2], complete: true, visibility: "public" });
  value.observeHand({ seatIndex: 1, count: 1, cardIds: [3], complete: true, visibility: "authorized" });
  value.observeCardAction({
    eventId: "use:virtual-parent:1",
    action: "use",
    identityKind: "virtual-with-subcards",
    virtual: true,
    subcards: [
      { cardId: 1, fromZone: "hand:1", role: "material" },
      { cardId: 2, fromZone: "hand:1", role: "material" }
    ],
    costCards: [{ cardId: 999, fromZone: "special:1:7", role: "cost" }],
    referenceCards: [{ cardId: 3, fromZone: "hand:1", role: "same-suit-reference" }],
    effectiveIdentity: { name: "万箭齐发", type: "trick" }
  });
  value.observeMove({ from: "process", to: "discard", count: 2, cardIds: [1, 2], causalEventId: "use:virtual-parent:1" });

  const inDiscard = value.cardActionMaterials("use:virtual-parent:1", { zone: "discard" });
  assert.deepEqual(inDiscard.cardIds, [1, 2]);
  assert.equal(inDiscard.allInRequestedZone, true);
  assert.equal(value.cardActionMaterials("use:virtual-parent:1", { includeCostCards: true }).materialCount, 3);
  assert.deepEqual(value.cardActionMaterials("use:virtual-parent:1", { includeReferenceCards: true }).cardIds, [1, 2, 3]);
  assert.ok(value.snapshot().deck.dynamicIds.includes(999));

  const gain = value.applyOperation({
    type: "gain-card-action-materials",
    eventId: "use:virtual-parent:1",
    from: "discard",
    to: "hand:0",
    causalEventId: "skill:3029:gain:1"
  });
  assert.equal(gain.status, "applied");
  assert.deepEqual(value.snapshot().hands[0].exactIds, [1, 2]);
  assert.deepEqual(value.snapshot().hands[1].exactIds, [3]);
  assert.equal(value.snapshot().discard.count, 0);

  value.observeMove({ from: "hand:0", to: "discard", count: 1, cardIds: [1] });
  const beforeRefusal = value.snapshot();
  const refused = value.applyOperation({
    type: "move-parent-card-entities",
    eventId: "use:virtual-parent:1",
    from: "hand:0",
    to: "hand:2"
  });
  const afterRefusal = value.snapshot();
  assert.equal(refused.status, "unsupported");
  assert.equal(refused.reason, "not-all-materials-in-source-zone");
  assert.equal(refused.rolledBack, true);
  assert.equal(afterRefusal.locations[1].zoneKey, "discard");
  assert.equal(afterRefusal.locations[2].zoneKey, "hand:0");
  assert.equal(afterRefusal.version, beforeRefusal.version);
});

test("swaps committed pindian assignments without moving either physical card between hands", () => {
  const value = model([1, 2, 3], 1);
  value.observeZone({ zoneKey: "process", count: 2, cardIds: [1, 2], complete: true, visibility: "public" });
  value.observeComparison({
    comparisonId: "pindian:3619:1",
    kind: "pindian",
    initiator: { seat: 0, cardId: 1 },
    opponents: [{ seat: 1, cardId: 2 }],
    status: "chosen"
  });
  const handHistoryCount = value.snapshot().handHistory.length;

  const swapped = value.applyOperation({
    type: "swap-pindian-participant-assignment",
    comparisonId: "pindian:3619:1",
    opponentSeat: 1,
    skillId: 3619
  });
  const afterSwap = value.comparison("pindian:3619:1");

  assert.equal(swapped.status, "applied");
  assert.equal(afterSwap.initiator.cardId, 2);
  assert.equal(afterSwap.initiator.printedNumber, 1);
  assert.equal(afterSwap.opponents[0].cardId, 1);
  assert.equal(afterSwap.opponents[0].printedNumber, 7);
  assert.equal(afterSwap.assignmentHistory.length, 1);
  assert.equal(afterSwap.assignmentHistory[0].physicalMovement, false);
  assert.equal(value.snapshot().locations[1].zoneKey, "process");
  assert.equal(value.snapshot().locations[2].zoneKey, "process");
  assert.equal(value.snapshot().handHistory.length, handHistoryCount);

  value.observeComparison({
    comparisonId: "pindian:3619:1",
    kind: "pindian",
    initiator: { seat: 0, cardId: 2, effectiveNumber: 1 },
    opponents: [{ seat: 1, cardId: 1, effectiveNumber: 7, winnerSeat: 1 }],
    status: "result"
  });
  assert.equal(value.comparison("pindian:3619:1").status, "result");
  assert.equal(value.snapshot().comparisonHistory.length, 3);

  const refused = value.applyOperation({
    type: "swap-comparison-assignments",
    comparisonId: "pindian:3619:1",
    opponentSeat: 1
  });
  assert.equal(refused.status, "unsupported");
  assert.equal(refused.reason, "comparison-assignment-already-revealed-or-resolved");
  assert.equal(refused.rolledBack, true);

  const hidden = model([1, 2, 3], 1);
  hidden.observeComparison({
    comparisonId: "pindian:hidden-assignment",
    kind: "pindian",
    initiator: { seat: 0 },
    opponents: [{ seat: 1 }],
    status: "chosen"
  });
  assert.equal(hidden.swapComparisonAssignments({ comparisonId: "pindian:hidden-assignment" }).applied, true);
  hidden.observeComparison({
    comparisonId: "pindian:hidden-assignment",
    kind: "pindian",
    initiator: { seat: 0, cardId: 2 },
    opponents: [{ seat: 1, cardId: 1 }],
    status: "revealed"
  });
  assert.equal(hidden.comparison("pindian:hidden-assignment").initiator.cardId, 2);
  assert.equal(hidden.comparison("pindian:hidden-assignment").opponents[0].cardId, 1);
});

test("keeps multi-party pindian as one shared initiator card and delayed process-zone result", () => {
  const value = model([1, 2, 3, 4], 1);
  value.observeZone({ zoneKey: "process", count: 3, cardIds: [1, 2, 3], complete: true, visibility: "public" });
  const result = value.applyOperation({
    type: "pindian",
    comparisonId: "pindian:280:turn:4",
    skillId: 280,
    initiator: { seat: 0, cardId: 1, effectiveNumber: 10 },
    opponents: [
      { seat: 1, cardId: 2, number: 4, winnerSeat: 0, outcome: "initiator-win" },
      { seat: 2, cardId: 3, effectiveNumber: 12, winnerSeat: 2, outcome: "opponent-win" }
    ],
    status: "result"
  });

  assert.equal(result.status, "applied");
  const comparison = value.comparison("pindian:280:turn:4");
  assert.equal(comparison.initiator.cardId, 1);
  assert.equal(comparison.sharedInitiatorCard, true);
  assert.deepEqual(comparison.opponents.map((row) => row.cardId), [2, 3]);
  assert.deepEqual(comparison.opponents.map((row) => row.winnerSeat), [0, 2]);
  assert.equal(comparison.opponents[0].reportedNumber, 4);
  assert.equal(comparison.opponents[0].effectiveNumber, null);
  assert.deepEqual(value.snapshot().zones.process.exactIds, [1, 2, 3]);
  assert.deepEqual(value.causalEvent("pindian:280:turn:4").cardIds, [1, 2, 3]);
  assert.equal(value.queryComparisons({ kind: "pindian", seat: 2, cardId: 3 }).length, 1);

  value.observeComparison({
    comparisonId: "pindian:280:turn:4",
    kind: "pindian",
    initiator: { seat: 0, cardId: 1 },
    opponents: [{ seat: 1 }, { seat: 2 }],
    status: "settled"
  });
  assert.equal(value.comparison("pindian:280:turn:4").status, "settled");
  assert.equal(value.snapshot().comparisonHistory.length, 2);

  value.observeComparison({
    comparisonId: "pindian:280:turn:4",
    kind: "pindian",
    initiator: { seat: 0, cardId: 4 },
    opponents: [{ seat: 1 }, { seat: 2 }],
    status: "result"
  });
  assert.equal(value.comparison("pindian:280:turn:4").initiator.cardId, 1);
  assert.equal(value.comparison("pindian:280:turn:4").status, "settled");
  assert.ok(value.snapshot().contradictions.some((row) => row.code === "comparison-side-conflict"));
  assert.ok(value.snapshot().contradictions.some((row) => row.code === "comparison-status-regression"));
});

test("intersects durable movement events with current discard membership", () => {
  const value = model([1, 2, 3], 2);
  value.observeGameEvent({ type: "game:turn", turn: 5, round: 2, seat: 0 });
  value.observeMove({ from: "deck", to: "hand:0", count: 1, cardIds: [2] });
  value.observeMove({ from: "hand:0", to: "discard", count: 1, cardIds: [2] });

  const candidate = value.queryCurrentDiscard({
    entryContext: { turn: 5, round: 2 },
    predicate: { type: "trick" },
    eventFilter: { turn: 5, tag: "gained-from-deck", from: "deck", to: "hand:0" }
  });
  assert.equal(candidate.status, "ok");
  assert.deepEqual(candidate.cardIds, [2]);
  assert.equal(value.cardEvents({ cardId: 2, tag: "entered-discard" }).length, 1);

  value.observeMove({ from: "discard", to: "hand:1", count: 1, cardIds: [2] });
  assert.deepEqual(value.queryCurrentDiscard({
    eventFilter: { tag: "gained-from-deck" }
  }).cardIds, []);
});

test("keeps explicit discard reasons separate without guessing raw moveType semantics", () => {
  const value = model([1, 2, 3], 1);
  value.observeGameEvent({ type: "game:turn", turn: 9, round: 3, seat: 0 });
  value.observeHand({ seatIndex: 0, count: 2, cardIds: [1, 2], complete: true, visibility: "self" });
  value.observeMove({
    from: "hand:0",
    to: "discard",
    count: 1,
    cardIds: [1],
    movementReason: "discard",
    moveType: 17,
    reasonTags: ["discard-phase"],
    causalEventId: "discard:phase:9"
  });
  value.observeMove({
    from: "hand:0",
    to: "discard",
    count: 1,
    cardIds: [2],
    movementReason: "card-use",
    moveType: 17,
    causalEventId: "use:card:2"
  });

  const discarded = value.queryCurrentDiscard({
    entryContext: { turn: 9 },
    movementReason: "discard"
  });
  const snapshot = value.snapshot();
  assert.deepEqual(discarded.cardIds, [1]);
  assert.deepEqual(discarded.movementReasons, ["discard"]);
  assert.equal(value.cardEvents({ cardId: 1, movementReason: "discard", moveType: 17 }).length, 1);
  assert.equal(value.cardEvents({ cardId: 2, movementReason: "discard" }).length, 0);
  assert.equal(snapshot.discard.entries.find((row) => row.cardId === 1).movementReason, "discard");
  assert.equal(snapshot.discard.entries.find((row) => row.cardId === 1).causalEventId, "discard:phase:9");
  assert.equal(snapshot.discard.entries.find((row) => row.cardId === 2).movementReason, "card-use");
});

test("queries deck and discard candidates without inventing single-source negative evidence", () => {
  const value = model([1, 2, 3, 4], 2);
  value.observeZone({ zoneKey: "discard", count: 1, cardIds: [2], complete: true });

  const result = value.queryCardSources({
    zones: ["deck", "discard"],
    predicate: { type: "trick" }
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(result.exactMatchingIds, [2]);
  assert.deepEqual(result.possibleMatchingIds.sort((a, b) => a - b), [2, 3]);
  assert.equal(result.allSourcesComplete, false);
  assert.equal(result.negativeEvidenceApplied, false);
  assert.deepEqual(value.snapshot().deck.excludedIds, []);
});

test("moves a union-source result only when its concrete source is proven", () => {
  const value = model([1, 2, 3, 4], 3);
  value.observeZone({ zoneKey: "discard", count: 1, cardIds: [2], complete: true });

  const result = value.resolveCardSourceResult({
    zones: ["deck", "discard"],
    predicate: { type: "trick" },
    foundCount: 1,
    foundCardIds: [2],
    to: "hand:0"
  });

  const snapshot = value.snapshot();
  assert.equal(result.status, "applied");
  assert.deepEqual(result.resolvedSources, [{ cardId: 2, from: "discard" }]);
  assert.equal(result.negativeEvidenceApplied, false);
  assert.deepEqual(snapshot.hands[0].exactIds, [2]);
  assert.equal(snapshot.discard.count, 0);
  assert.deepEqual(snapshot.deck.excludedIds, []);
});

test("refuses an unidentified union-source movement until the server identifies a source", () => {
  const value = model([1, 2, 3, 4], 3);
  value.observeZone({ zoneKey: "discard", count: 1, cardIds: [2], complete: true });
  const before = value.snapshot();

  const unresolved = value.resolveCardSourceResult({
    zones: ["deck", "discard"],
    predicate: { type: "trick" },
    foundCount: 1,
    to: "hand:0"
  });

  const after = value.snapshot();
  assert.equal(unresolved.status, "unsupported");
  assert.equal(unresolved.reason, "hidden-result-source-unresolved");
  assert.equal(after.deck.count, before.deck.count);
  assert.equal(after.discard.count, before.discard.count);
  assert.equal(after.hands[0], undefined);

  const resolved = value.applyOperation({
    type: "server-union-search",
    sources: ["deck", "discard"],
    predicate: { type: "trick" },
    foundCount: 1,
    sourceZone: "deck",
    destination: "hand:0"
  });
  assert.equal(resolved.status, "applied");
  assert.equal(value.snapshot().deck.count, 2);
  assert.equal(value.snapshot().hands[0].unknownCount, 1);
  assert.deepEqual(value.snapshot().deck.excludedIds, []);
});

test("keeps character-deck entities isolated from the physical game-card deck", () => {
  const value = model([1, 2, 3], 3);
  value.observeEntityPile({
    key: "character-deck",
    entityType: "general-card",
    count: 3,
    entityIds: [700, 701, 702],
    complete: true
  });

  const move = value.applyOperation({
    type: "entity-pile-move",
    from: "character-deck",
    to: "soul:0",
    entityType: "general-card",
    count: 1,
    entityIds: [700]
  });

  const snapshot = value.snapshot();
  assert.equal(move.status, "applied");
  assert.equal(value.entityPile("character-deck").count, 2);
  assert.deepEqual(value.entityPile("character-deck").exactIds, [701, 702]);
  assert.deepEqual(value.entityPile("soul:0").exactIds, [700]);
  assert.equal(snapshot.entityLocations["general-card"][700].pileKey, "soul:0");
  assert.equal(snapshot.deck.count, 3);
  assert.deepEqual(snapshot.deck.dynamicIds, []);
  assert.deepEqual(value.nextCardProbability().cards.map((row) => row.id), [1, 2, 3]);
});

test("keeps main and deputy general-card entities outside the physical CardID domain", () => {
  const value = model([1, 2, 3], 3);
  const main = value.observeGeneralCardEntity({
    hostSeat: 0,
    generalSlot: "main",
    generalId: 1,
    faceState: "face-up",
    printedSkillIds: [123, 212],
    printedSkillIdsKnown: true,
    visibilityAudience: "public"
  });
  const deputy = value.applyOperation({
    type: "observe-general-card-entity",
    hostSeat: 0,
    generalSlot: "deputy",
    generalId: 2,
    faceState: "face-down",
    printedSkillIds: [219],
    visibilityAudience: "restricted",
    observerSeats: [0]
  });

  assert.equal(main.entityKey, "general-slot:0:main");
  assert.equal(deputy.status, "applied");
  assert.equal(value.generalCardEntities({ hostSeat: 0, includeHiddenIdentity: true }).length, 2);
  assert.equal(value.generalCardEntity("general-slot:0:deputy", { observerSeat: 1 }).generalId, null);
  assert.equal(value.generalCardEntity("general-slot:0:deputy", { observerSeat: 0 }).generalId, 2);
  assert.deepEqual(value.generalCardEntity("general-slot:0:main", { observerSeat: 1 }).printedSkillIds, [123, 212]);

  value.observeGeneralCardEntity({
    entityKey: "general-slot:0:main",
    generalId: 1,
    faceState: "down",
    visibilityAudience: "restricted",
    observerSeats: [0]
  });
  const snapshot = value.snapshot();
  assert.equal(snapshot.generalCardEntities["general-slot:0:main"].faceState, "face-down");
  assert.equal(snapshot.generalCardEntityHistory.length, 3);
  assert.equal(snapshot.deck.count, 3);
  assert.deepEqual(snapshot.deck.dynamicIds, []);
  assert.equal(snapshot.locations[1], undefined);
  assert.equal(value.activeSkillBindings({ ownerSeat: 0 }).length, 0);

  const replacement = value.applyOperation({
    type: "replace-general-card-entity",
    entityKey: "general-slot:0:deputy",
    replacementGeneralId: 7001,
    faceState: "face-up",
    replacementKind: "soldier-card",
    skillId: 2134
  });
  assert.equal(replacement.status, "applied");
  assert.equal(value.generalCardEntity("general-slot:0:deputy", { observerSeat: 0 }).generalId, 7001);
  assert.equal(value.snapshot().generalCardEntities["general-slot:0:deputy"].printedSkillIdsKnown, false);
  assert.equal(value.snapshot().generalCardEntities["general-slot:0:deputy"].metadata.replacement.previousGeneralId, 2);
  assert.equal(value.snapshot().generalCardEntityHistory.length, 4);
  assert.equal(value.snapshot().deck.count, 3);
});

test("keeps abolished areas and equipment slots separate from physical card movement", () => {
  const value = model([1, 2, 3, 4], 3);
  value.observeZone({ zoneKey: "equip:0", count: 1, cardIds: [4], complete: true });
  const weapon = value.applyOperation({
    type: "abolish-zone-capability",
    seat: 0,
    area: "equipment",
    slot: "weapon",
    capability: "equip-card",
    permanent: true
  });
  value.observeZoneCapability({
    seat: 0,
    area: "judgement",
    capability: "accept-delayed-trick",
    status: "disabled"
  });

  assert.equal(weapon.status, "applied");
  assert.equal(value.zoneCapabilities({ seat: 0, abolished: true }).length, 1);
  assert.equal(value.zoneCapabilities({ seat: 0, area: "judgement" })[0].status, "disabled");
  assert.equal(value.zoneCapability("zone-capability:0:equipment:weapon:equip-card").permanent, true);
  const snapshot = value.snapshot();
  assert.deepEqual(snapshot.zones["equip:0"].exactIds, [4]);
  assert.equal(snapshot.movementHistory.length, 0);
  assert.equal(snapshot.zoneCapabilityHistory.length, 2);
  assert.equal(snapshot.deck.count, 3);
});

test("separates physical effective equipment identity from virtual equipment projection", () => {
  const value = model([1, 2, 3, 4], 3);
  value.observeZone({ zoneKey: "equip:0", count: 1, cardIds: [4], complete: true });
  const physical = value.applyOperation({
    type: "observe-equipment-projection",
    key: "cadj:weapon:card4",
    projectionKind: "physical-effective-identity",
    hostSeat: 0,
    slot: "weapon",
    sourceCardId: 4,
    whileSourceCardInZone: "equip:0",
    effectiveIdentity: { name: "长安大舰·武器", skillId: 3145, attackRange: 6 }
  });
  const virtual = value.observeEquipmentProjection({
    key: "virtual:armor:seat1",
    projectionKind: "virtual-equipment",
    hostSeat: 1,
    slot: "armor",
    effectiveIdentity: { name: "八阵", skillId: 112 },
    occupiesPhysicalSlot: false
  });

  assert.equal(physical.status, "applied");
  assert.equal(virtual.applied, true);
  assert.equal(value.equipmentProjection("cadj:weapon:card4").sourceCardId, 4);
  assert.equal(value.equipmentProjection("cadj:weapon:card4").createsPhysicalCard, false);
  assert.equal(value.equipmentProjection("virtual:armor:seat1").sourceCardId, null);
  assert.equal(value.equipmentProjection("virtual:armor:seat1").occupiesPhysicalSlot, false);
  assert.equal(value.physicalCardDefinition(3145), null);
  assert.equal(value.snapshot().zones["equip:1"], undefined);
  assert.deepEqual(value.snapshot().deck.dynamicIds, []);

  value.observeMove({ from: "equip:0", to: "discard", count: 1, cardIds: [4] });
  assert.equal(value.equipmentProjection("cadj:weapon:card4"), null);
  assert.equal(value.equipmentProjection("virtual:armor:seat1").active, true);
  assert.equal(value.equipmentProjections({ hostSeat: 0 }).length, 0);
  assert.equal(value.equipmentProjections({ projectionKind: "virtual-equipment" }).length, 1);
  assert.equal(value.removeEquipmentProjection("virtual:armor:seat1"), 1);
  assert.deepEqual(value.snapshot().equipmentProjectionHistory.map((row) => row.type), ["observe", "observe", "remove", "remove"]);
  assert.equal(value.snapshot().deck.count, 3);
});

test("keeps an ordered independent physical card pile outside the main deck recycle epoch", () => {
  const value = model([1, 2, 3], 3);
  const observed = value.applyOperation({
    type: "observe-physical-pile",
    key: "rule:6102:wugu-exclusive",
    pileKind: "exclusive-skill-deck",
    count: 3,
    cardIds: [4, 5, 6],
    topCardIds: [4, 5],
    bottomCardIds: [6],
    complete: true,
    recyclePolicy: "server-reseed-only",
    visibility: "public"
  });
  assert.equal(observed.status, "applied");
  assert.equal(value.snapshot().world.consistent, true);
  assert.equal(value.physicalPile("rule:6102:wugu-exclusive").count, 3);
  assert.equal(value.physicalPileNextProbability({ key: "rule:6102:wugu-exclusive" }).exact, true);
  assert.deepEqual(value.physicalPileNextProbability({ key: "rule:6102:wugu-exclusive" }).cards.map((row) => row.id), [4]);
  assert.deepEqual(value.nextCardProbability().cards.map((row) => row.id), [1, 2, 3]);

  const taken = value.takeFromPhysicalPile({
    key: "rule:6102:wugu-exclusive",
    endpoint: "top",
    count: 1,
    cardIds: [4],
    to: "hand:0"
  });
  assert.equal(taken.status, "applied");
  assert.equal(value.explainCard(4).location.zoneKey, "hand:0");
  assert.equal(value.physicalPile("rule:6102:wugu-exclusive").count, 2);
  assert.deepEqual(value.physicalPile("rule:6102:wugu-exclusive").top, [5]);
  assert.equal(value.snapshot().deck.count, 3);
  assert.equal(value.snapshot().epoch, 0);

  const returned = value.putIntoPhysicalPile({
    key: "rule:6102:wugu-exclusive",
    endpoint: "bottom",
    count: 1,
    cardIds: [4],
    from: "hand:0"
  });
  assert.equal(returned.status, "applied");
  assert.deepEqual(value.physicalPile("rule:6102:wugu-exclusive").bottom, [4, 6]);
  assert.equal(value.explainCard(4).location.zoneKey, "physical-pile:rule:6102:wugu-exclusive");

  value.shufflePhysicalPile({ key: "rule:6102:wugu-exclusive", reason: "server-reseed" });
  const shuffled = value.physicalPileNextProbability({ key: "rule:6102:wugu-exclusive" });
  assert.equal(shuffled.exact, false);
  assert.equal(shuffled.assumption, "uniform-shuffled-complete-independent-pile");
  assert.deepEqual(shuffled.cards.map((row) => [row.id, row.probability]), [[4, 1 / 3], [5, 1 / 3], [6, 1 / 3]]);
  assert.equal(value.snapshot().deck.shuffleCount, 0);
  assert.equal(value.snapshot().epoch, 0);
  assert.deepEqual(value.physicalPileHistory({ key: "rule:6102:wugu-exclusive" }).map((row) => row.operation), ["observe", "take", "put", "shuffle"]);
});

test("does not recycle the main discard when an independent pile empties or guess an incomplete pile", () => {
  const value = model([1, 2, 3, 4, 5, 6], 1);
  value.observeZone({ zoneKey: "discard", count: 2, cardIds: [2, 3], complete: true });
  value.observePhysicalPile({ key: "single", count: 1, cardIds: [4], topCardIds: [4], complete: true });

  const taken = value.takeFromPhysicalPile({ key: "single", endpoint: "top", count: 1, to: "hand:0" });
  assert.equal(taken.status, "applied");
  assert.equal(value.physicalPile("single").count, 0);
  assert.equal(value.snapshot().epoch, 0);
  assert.equal(value.snapshot().deck.count, 1);
  assert.deepEqual(value.snapshot().discard.exactIds, [2, 3]);

  value.observePhysicalPile({ key: "opaque", count: 2, cardIds: [5], complete: false });
  value.shufflePhysicalPile({ key: "opaque" });
  const probability = value.physicalPileNextProbability({ key: "opaque" });
  assert.equal(probability.available, false);
  assert.equal(probability.reason, "independent-pile-membership-incomplete");
  assert.equal(value.snapshot().world.consistent, true);
});

test("keeps ordered and set-like generic rule state with automatic turn expiry", () => {
  const value = model([1, 2, 3], 2);
  value.observeGameEvent({ type: "game:turn", turn: 7, round: 3, seat: 0 });
  const orderedKey = "rule:3675:owner:0:used-names";
  value.updateRuleState({
    key: orderedKey,
    kind: "ordered-list",
    operation: "append",
    values: ["杀", "闪", "杀"],
    lifecycle: "turn",
    skillId: 3675,
    ownerSeat: 0
  });
  value.updateRuleState({ key: orderedKey, kind: "ordered-list", operation: "append", value: "桃" });
  assert.deepEqual(value.ruleState(orderedKey).value, ["杀", "闪", "杀", "桃"]);

  const suitKey = "rule:3537:owner:0:used-suits";
  value.updateRuleState({ key: suitKey, kind: "set", operation: "add", values: [1, 1, 3], lifecycle: "turn" });
  assert.deepEqual(value.ruleState(suitKey).value, [1, 3]);

  const counter = value.applyOperation({
    type: "state-update",
    key: "rule:example:counter",
    kind: "counter",
    operation: "increment",
    amount: 2,
    lifecycle: "turn"
  });
  assert.equal(counter.status, "applied");
  assert.equal(value.ruleState("rule:example:counter").value, 2);

  value.observeGameEvent({ type: "game:turn", turn: 8, round: 3, seat: 1 });
  assert.equal(value.ruleState(orderedKey), null);
  assert.equal(value.ruleState(suitKey), null);
  assert.equal(value.ruleState("rule:example:counter"), null);
  assert.ok(value.snapshot().ruleStateHistory.some((row) => row.operation === "expire" && row.reason === "turn-changed"));
});

test("keeps nonphysical card-identity candidates outside the physical card world", () => {
  const value = model([1, 2, 3], 3);
  const locationsBefore = value.snapshot().locations;
  const observed = value.applyOperation({
    type: "observe-candidate-set",
    key: "rule:14218:owner:0:trick-candidates",
    domain: "effective-card-identity",
    candidates: [101, 102, 103],
    exactSelections: 1,
    actorSeat: 0,
    visibility: "holder-only",
    skillId: 14218
  });

  assert.equal(observed.status, "applied");
  const historyCount = value.choiceSetHistory({ key: "rule:14218:owner:0:trick-candidates" }).length;
  value.observeChoiceSet({
    key: "rule:14218:owner:0:trick-candidates",
    domain: "effective-card-identity",
    candidates: [101, 102, 103],
    exactSelections: 1,
    actorSeat: 0,
    visibility: "holder-only",
    skillId: 14218
  });
  assert.equal(value.choiceSetHistory({ key: "rule:14218:owner:0:trick-candidates" }).length, historyCount);
  assert.equal(value.choiceSets({ domain: "effective-card-identity" }).length, 1);
  assert.deepEqual(value.choiceSets()[0].candidates.map((candidate) => candidate.physicalCardId), [null, null, null]);
  assert.deepEqual(value.snapshot().deck.dynamicIds, []);
  assert.deepEqual(value.snapshot().locations, locationsBefore);

  const resolved = value.applyOperation({
    type: "resolve-choice-set",
    key: "rule:14218:owner:0:trick-candidates",
    selectedIndex: 1,
    outcome: { acceptedEffectiveIdentity: 102 }
  });
  assert.equal(resolved.status, "applied");
  assert.deepEqual(resolved.result.selectedCandidates.map((candidate) => candidate.value), [102]);
  assert.deepEqual(resolved.result.selectedPhysicalCardIds, []);
  assert.equal(resolved.result.movementApplied, false);
  assert.equal(value.choiceSets().length, 0);
  assert.equal(value.snapshot().deck.count, 3);
  assert.ok(value.choiceSetHistory({ key: "rule:14218:owner:0:trick-candidates", operation: "resolved" }).length === 1);
});

test("treats physical choice candidates as references until a separate move is observed", () => {
  const value = model([1, 2, 3], 2);
  value.observeZone({ zoneKey: "hand:0", count: 1, cardIds: [3], complete: true, visibility: "self" });
  const before = value.snapshot().locations;
  value.observeChoiceSet({
    key: "rule:example:choose-one-card",
    domain: "physical-card-id",
    candidates: [2, { cardId: 3, label: "known hand card" }],
    exactSelections: 1,
    actorSeat: 0,
    visibility: "authorized"
  });
  const result = value.resolveChoiceSet({ key: "rule:example:choose-one-card", selectedIndex: 1 });

  assert.deepEqual(result.selectedPhysicalCardIds, [3]);
  assert.equal(result.movementApplied, false);
  assert.deepEqual(value.snapshot().locations, before);
  assert.equal(value.snapshot().hands[0].exactIds.includes(3), true);

  value.observeMove({ from: "hand:0", to: "discard", count: 1, cardIds: [3] });
  assert.equal(value.explainCard(3).location.zoneKey, "discard");
});

test("keeps an unresolved random gain pending until the server reports a result", () => {
  const value = model([1, 2, 3], 3);
  const before = value.snapshot();
  const observed = value.applyOperation({
    type: "observe-stochastic-event",
    key: "skill:13016:opening-reward",
    domain: "physical-card-id",
    candidates: [],
    complete: false,
    count: 1,
    candidateConstraint: { kind: "gain-one-physical-card" },
    sourceZones: ["unresolved"],
    sourceResolved: false,
    samplingModel: "unknown",
    observerSeats: [0],
    visibility: "recipient-private",
    skillId: 13016
  });

  assert.equal(observed.status, "applied");
  assert.equal(value.stochasticEvents({ skillId: 13016 }).length, 1);
  assert.equal(value.stochasticProbability({ key: "skill:13016:opening-reward" }).available, false);
  assert.equal(value.stochasticProbability({ key: "skill:13016:opening-reward" }).reason, "candidate-population-incomplete");
  assert.deepEqual(value.snapshot().locations, before.locations);
  assert.equal(value.snapshot().deck.count, 3);

  const resolved = value.applyOperation({
    type: "resolve-stochastic-event",
    key: "skill:13016:opening-reward",
    resultCardIds: [4],
    outcome: { protocolResultObserved: true }
  });
  assert.equal(resolved.status, "applied");
  assert.deepEqual(resolved.result.selectedPhysicalCardIds, [4]);
  assert.equal(resolved.result.resultFromIncompletePopulation, true);
  assert.equal(resolved.result.movementApplied, false);
  assert.equal(value.explainCard(4).location, null);
  assert.equal(value.snapshot().deck.count, 3);
  assert.deepEqual(value.stochasticEventHistory({ key: "skill:13016:opening-reward" }).map((row) => row.operation), ["observe", "resolved"]);
});

test("reports random probabilities only for an explicit complete sampling model", () => {
  const value = model([1, 2, 3], 3);
  value.observeStochasticEvent({
    key: "uniform-three",
    domain: "physical-card-id",
    candidates: [1, 2, 3],
    complete: true,
    exactSelections: 1,
    samplingModel: "uniform-without-replacement",
    sourceZones: ["deck"],
    sourceResolved: true
  });
  value.observeStochasticEvent({
    key: "weighted-two",
    domain: "branch",
    candidates: ["left", "right"],
    complete: true,
    exactSelections: 1,
    samplingModel: "weighted",
    candidateWeights: [1, 3],
    sourceZones: ["server-defined"],
    sourceResolved: true
  });

  const uniform = value.stochasticProbability({ key: "uniform-three" });
  const weighted = value.stochasticProbability({ key: "weighted-two" });
  assert.equal(uniform.available, true);
  assert.deepEqual(uniform.candidates.map((row) => [row.physicalCardId, row.probability]), [[1, 1 / 3], [2, 1 / 3], [3, 1 / 3]]);
  assert.equal(weighted.available, true);
  assert.deepEqual(weighted.candidates.map((row) => [row.value, row.probability]), [["left", 0.25], ["right", 0.75]]);
  assert.equal(value.choiceSets({ selectionAgency: "player-choice" }).length, 0);
  assert.equal(value.stochasticEvents().length, 2);
  assert.deepEqual(value.snapshot().locations, {});
});

test("expires candidate prompts by lifecycle and rejects lower-authority rewrites", () => {
  const value = model([1, 2, 3], 3);
  value.observeGameEvent({ type: "game:phase", turn: 4, round: 2, phase: "play", seat: 0 });
  value.observeChoiceSet({
    key: "rule:example:phase-options",
    domain: "branch",
    candidates: ["draw", "discard"],
    exactSelections: 1,
    lifecycle: "phase",
    source: sourceOf("server-options", "server-protocol")
  });
  const rejected = value.observeChoiceSet({
    key: "rule:example:phase-options",
    domain: "branch",
    candidates: ["recover"],
    exactSelections: 1,
    lifecycle: "phase",
    source: sourceOf("old-guide", "skill-text")
  });
  assert.equal(rejected, null);
  assert.deepEqual(value.choiceSets()[0].candidates.map((candidate) => candidate.value), ["draw", "discard"]);
  assert.ok(value.snapshot().contradictions.some((row) => row.code === "choice-set-lower-authority-conflict"));

  value.observeGameEvent({ type: "game:phase", turn: 4, round: 2, phase: "end", seat: 0 });
  assert.equal(value.choiceSets().length, 0);
  assert.ok(value.choiceSetHistory({ key: "rule:example:phase-options", operation: "expired" }).some((row) => row.reason === "phase-changed"));
});

test("keeps structured rule modifiers scoped to an equipped card, turn, or causal event", () => {
  const value = model([1, 2, 3, 4], 3);
  value.observeZone({ zoneKey: "equip:0", count: 1, cardIds: [4], complete: true });
  const equipment = value.applyOperation({
    type: "register-rule-modifier",
    key: "rule:580:owner:0:weapon:4:sha-limit",
    kind: "modify-limit",
    subject: "sha-use-count",
    selector: { actorSeat: 0, phase: "play" },
    effect: { delta: 3 },
    lifecycle: "while-zone",
    whileCardId: 4,
    whileZone: "equip:0",
    skillId: 580,
    ownerSeat: 0
  });
  assert.equal(equipment.status, "applied");
  assert.equal(value.activeRuleModifiers({ subject: "sha-use-count", ownerSeat: 0 }).length, 1);

  value.observeMove({ from: "equip:0", to: "discard", count: 1, cardIds: [4] });
  assert.equal(value.activeRuleModifiers({ subject: "sha-use-count" }).length, 0);
  assert.ok(value.snapshot().ruleModifierHistory.some((row) => row.operation === "expire" && row.reason === "card-left:equip:0"));

  value.observeGameEvent({ type: "game:turn", turn: 4, round: 2, seat: 0 });
  value.registerRuleModifier({
    key: "rule:777:owner:0:no-other-target",
    kind: "prohibit-target",
    subject: "card-target-legality",
    selector: { userSeat: 0, targetRelation: "other" },
    effect: { prohibited: true },
    lifecycle: "turn",
    skillId: 777,
    ownerSeat: 0
  });
  value.observeGameEvent({ type: "game:turn", turn: 5, round: 2, seat: 1 });
  assert.equal(value.activeRuleModifiers({ skillId: 777 }).length, 0);

  value.observeCausalEvent({ eventId: "sha:use:1", eventType: "card:use", status: "resolving" });
  value.registerRuleModifier({
    key: "rule:66:sha:use:1:double-shan",
    kind: "set-response-count",
    subject: "required-response-count",
    effect: { effectiveName: "闪", count: 2 },
    lifecycle: "event",
    eventId: "sha:use:1"
  });
  assert.equal(value.activeRuleModifiers({ eventId: "sha:use:1" }).length, 1);
  value.observeCausalEvent({ eventId: "sha:use:1", eventType: "card:use", status: "settled" });
  assert.equal(value.activeRuleModifiers({ eventId: "sha:use:1" }).length, 0);

  value.observeCausalEvent({ eventId: "duel:use:2", eventType: "card:use", status: "resolving" });
  value.observeCausalEvent({
    eventId: "duel:effect:seat:1",
    eventType: "card:target-effect",
    parentEventId: "duel:use:2",
    targetSeat: 1,
    status: "resolving"
  });
  value.observeCausalEvent({
    eventId: "duel:effect:seat:2",
    eventType: "card:target-effect",
    parentEventId: "duel:use:2",
    targetSeat: 2,
    status: "resolving"
  });
  value.registerRuleModifier({
    key: "rule:21076:duel:use:2:seat:1:no-response",
    kind: "prohibit-response",
    subject: "card-response-legality",
    effect: { prohibited: true },
    lifecycle: "event",
    eventId: "duel:use:2",
    targetEventId: "duel:effect:seat:1",
    targetSeat: 1
  });
  value.registerRuleModifier({
    key: "rule:21076:duel:use:2:seat:2:damage",
    kind: "modify-damage",
    subject: "damage-value",
    effect: { delta: 1 },
    lifecycle: "event",
    eventId: "duel:use:2",
    targetEventId: "duel:effect:seat:2",
    targetSeat: 2
  });
  assert.equal(value.activeRuleModifiers({ eventId: "duel:use:2", targetSeat: 1 }).length, 1);
  assert.equal(value.activeRuleModifiers({ targetEventId: "duel:effect:seat:2" }).length, 1);
  assert.equal(value.registerRuleModifier({
    key: "rule:21076:duel:use:2:seat:1:no-response",
    kind: "prohibit-response",
    subject: "card-response-legality",
    effect: { prohibited: true },
    lifecycle: "event",
    eventId: "duel:use:2",
    targetEventId: "duel:effect:seat:2",
    targetSeat: 2
  }), null);
  assert.ok(value.snapshot().contradictions.some((row) => row.code === "rule-modifier-scope-identity-conflict"));
  value.observeCausalEvent({
    eventId: "duel:effect:seat:1",
    eventType: "card:target-effect",
    parentEventId: "duel:use:2",
    targetSeat: 1,
    status: "settled"
  });
  assert.equal(value.activeRuleModifiers({ eventId: "duel:use:2", targetSeat: 1 }).length, 0);
  assert.equal(value.activeRuleModifiers({ eventId: "duel:use:2", targetSeat: 2 }).length, 1);
  value.observeCausalEvent({ eventId: "duel:use:2", eventType: "card:use", status: "settled" });
  assert.equal(value.activeRuleModifiers({ eventId: "duel:use:2" }).length, 0);
});

test("tracks exact skill bindings, dynamic derivation, replacement, and lifecycle without name merging", () => {
  const value = model([1, 2, 3], 2);
  value.observeGameEvent({ type: "game:turn", turn: 7, round: 3, seat: 0 });

  const derived = value.applyOperation({
    type: "grant-skill",
    skillId: 21134,
    skillName: "观星",
    ownerSeat: 0,
    derivedFromSkillId: 21132,
    ruleIdentityKey: "sgs-web-h5:21134:owner:0",
    versionScope: { resourceVersion: "2026070605" }
  });
  assert.equal(derived.status, "applied");
  assert.deepEqual(value.activeSkillBindings({ skillId: 21134, ownerSeat: 0 })[0].derivedFromSkillIds, [21132]);
  const derivedBindingKey = value.activeSkillBindings({ skillId: 21134, ownerSeat: 0 })[0].key;
  value.registerRuleModifier({
    key: "rule:21134:owner:0:continuous",
    kind: "modify-legality",
    subject: "card-use",
    effect: { enabled: true },
    lifecycle: "while-skill-binding",
    whileSkillBindingKey: derivedBindingKey
  });
  value.updateRuleState({
    key: "rule:21134:owner:0:activation-count",
    kind: "counter",
    operation: "set",
    value: 2,
    lifecycle: "while-skill-binding",
    whileSkillBindingKey: derivedBindingKey
  });

  value.observeSkillBinding({ skillId: 35, skillName: "观星", ownerSeat: 0, operation: "grant" });
  assert.equal(value.activeSkillBindings({ ownerSeat: 0 }).length, 2);
  assert.equal(value.activeSkillBindings({ skillId: 35 }).length, 1);

  const replacement = value.applyOperation({
    type: "replace-skill",
    skillId: 21141,
    skillName: "酒诗",
    ownerSeat: 0,
    derivedFromSkillId: 21139,
    replacesSkillIds: [21134]
  });
  assert.equal(replacement.status, "applied");
  assert.equal(value.activeSkillBindings({ skillId: 21134, ownerSeat: 0 }).length, 0);
  assert.equal(value.activeRuleModifiers({ whileSkillBindingKey: derivedBindingKey }).length, 0);
  assert.equal(value.ruleState("rule:21134:owner:0:activation-count"), null);
  assert.equal(value.activeSkillBindings({ skillId: 35, ownerSeat: 0 }).length, 1);
  assert.equal(value.activeSkillBindings({ skillId: 21141, ownerSeat: 0 }).length, 1);

  const nameOnly = value.applyOperation({ type: "grant-skill", skillName: "观星", ownerSeat: 0 });
  assert.equal(nameOnly.status, "unsupported");
  assert.equal(value.activeSkillBindings({ ownerSeat: 0 }).length, 2);

  value.observeSkillBinding({ skillId: 3245, skillName: "天候", ownerSeat: 1, operation: "grant", lifecycle: "turn" });
  value.observeGameEvent({ type: "game:turn", turn: 8, round: 3, seat: 1 });
  assert.equal(value.activeSkillBindings({ skillId: 3245, ownerSeat: 1 }).length, 0);
  assert.ok(value.snapshot().skillBindingHistory.some((row) => row.skillId === 21134 && row.operation === "lose"));
  assert.ok(value.snapshot().skillBindingHistory.some((row) => row.skillId === 21141 && row.operation === "replace"));
  assert.ok(value.snapshot().skillBindingHistory.some((row) => row.skillId === 3245 && row.reason === "turn-changed"));
});

test("keeps future rule effects pending until their exact server event becomes due", () => {
  const value = model([1, 2, 3, 4], 4);
  value.observeGameEvent({ type: "game:turn", turn: 4, round: 2, seat: 0 });
  const scheduled = value.applyOperation({
    type: "schedule",
    key: "rule:example:owner:0:next-end-draw",
    trigger: { eventType: "game:phase", phase: "end", activeSeat: 0 },
    effect: { type: "draw", count: 2, from: "deck-top", to: "hand:0" },
    skillId: 999,
    ownerSeat: 0
  });
  assert.equal(scheduled.status, "applied");
  assert.equal(value.scheduledEffects({ status: "pending" }).length, 1);

  value.observeGameEvent({ type: "game:phase", turn: 4, round: 2, phase: "play", seat: 0 });
  assert.equal(value.dueScheduledEffects().length, 0);
  value.observeGameEvent({ type: "game:phase", turn: 4, round: 2, phase: "end", seat: 0 });

  const due = value.dueScheduledEffects({ skillId: 999, ownerSeat: 0 });
  assert.equal(due.length, 1);
  assert.equal(due[0].dueEvent.eventType, "game:phase");
  assert.equal(due[0].dueEvent.context.phase, "end");
  assert.equal(value.snapshot().deck.count, 4);

  const resolved = value.applyOperation({
    type: "resolve-scheduled-effect",
    key: "rule:example:owner:0:next-end-draw",
    outcome: { serverAccepted: true }
  });
  assert.equal(resolved.status, "applied");
  assert.equal(value.scheduledEffects().length, 0);
  assert.deepEqual(resolved.result.outcome, { serverAccepted: true });
  assert.ok(value.snapshot().scheduledEffectHistory.some((row) => row.operation === "due"));
  assert.ok(value.snapshot().scheduledEffectHistory.some((row) => row.operation === "resolved"));
});

test("expires scheduled effects bound to a physical card or removed skill binding", () => {
  const value = model([1, 2, 3, 4], 3);
  value.observeZone({ zoneKey: "equip:0", count: 1, cardIds: [4], complete: true });
  value.scheduleEffect({
    key: "rule:equipment:4:delayed-reward",
    trigger: { eventType: "game:phase", phase: "end" },
    effect: { type: "gain", cardId: 4 },
    lifecycle: "while-zone",
    whileCardId: 4,
    whileZone: "equip:0"
  });
  value.observeMove({ from: "equip:0", to: "discard", count: 1, cardIds: [4] });
  assert.equal(value.scheduledEffects().length, 0);
  assert.ok(value.snapshot().scheduledEffectHistory.some((row) => row.key === "rule:equipment:4:delayed-reward" && row.reason === "card-left:equip:0"));

  const binding = value.observeSkillBinding({ skillId: 21134, ownerSeat: 0, operation: "grant" });
  value.scheduleEffect({
    key: "rule:21134:owner:0:future-use",
    trigger: { eventType: "game:phase", phase: "play", activeSeat: 0 },
    effect: { type: "use-zero-subcard-virtual-card", effectiveName: "杀" },
    whileSkillBindingKey: binding.key
  });
  value.removeSkillBinding({ key: binding.key, reason: "replaced" });
  assert.equal(value.scheduledEffects().length, 0);
  assert.ok(value.snapshot().scheduledEffectHistory.some((row) => row.key === "rule:21134:owner:0:future-use" && row.reason === "skill-binding:replaced"));
});

test("separates printed card attributes from event-scoped effective judgement attributes", () => {
  const value = model([1, 2, 3], 2);
  value.observeZone({ zoneKey: "process", count: 1, cardIds: [2], complete: true });
  value.observeEffectiveCardAttributes({
    cardId: 2,
    scope: "judgement",
    whileZone: "process",
    attributes: { suit: "红桃", number: 5, nature: "fire", isDamageCard: true, spellClass: "EffectiveJudgeCard" },
    reason: "真仪覆盖本次判定结果"
  });

  const during = value.effectiveCard(2, { scope: "judgement" });
  const withoutJudgementContext = value.effectiveCard(2);
  assert.equal(during.printed.suit, 3);
  assert.equal(during.printed.number, 1);
  assert.equal(during.effective.suit, 1);
  assert.equal(during.effective.number, 5);
  assert.equal(during.effective.color, "red");
  assert.equal(during.effective.isDamageCard, true);
  assert.equal(during.effective.spellClass, "EffectiveJudgeCard");
  assert.equal(during.effective.nature, "fire");
  assert.equal(withoutJudgementContext.effective.suit, 3);
  assert.equal(withoutJudgementContext.views.length, 0);

  value.observeMove({ from: "process", to: "discard", count: 1, cardIds: [2] });

  const after = value.effectiveCard(2, { scope: "judgement" });
  const snapshot = value.snapshot();
  assert.equal(after.effective.suit, 3);
  assert.deepEqual(after.views, []);
  assert.equal(snapshot.cardViewHistory[0].active, false);
  assert.equal(snapshot.cardViewHistory[0].invalidationReason, "card-moved");
});

test("keeps target-scoped effective identities isolated and expires them with the bound effect", () => {
  const value = model([1, 2, 3], 2);
  value.observeZone({ zoneKey: "process", count: 1, cardIds: [1], complete: true });
  value.observeCausalEvent({
    eventId: "use:sha:target-scoped",
    eventType: "card:use",
    cardId: 1,
    roles: { userSeat: 0 },
    targetSeats: [1, 2],
    status: "resolving"
  });
  value.observeCausalEvent({
    eventId: "effect:sha:target1",
    eventType: "card:target-effect",
    parentEventId: "use:sha:target-scoped",
    roles: { targetSeat: 1 },
    status: "resolving"
  });
  value.observeCausalEvent({
    eventId: "effect:sha:target2",
    eventType: "card:target-effect",
    parentEventId: "use:sha:target-scoped",
    roles: { targetSeat: 2 },
    status: "resolving"
  });
  value.observeEffectiveCardAttributes({
    cardId: 1,
    scope: "target-effect",
    causalEventId: "use:sha:target-scoped",
    targetSeat: 1,
    whileCausalEventId: "effect:sha:target1",
    expiresOnMove: false,
    attributes: { name: "决斗", type: "trick" }
  });
  value.observeEffectiveCardAttributes({
    cardId: 1,
    scope: "target-effect",
    causalEventId: "use:sha:target-scoped",
    targetSeat: 2,
    whileCausalEventId: "effect:sha:target2",
    expiresOnMove: false,
    attributes: { name: "雷杀", nature: "thunder" }
  });

  assert.equal(value.effectiveCard(1).effective.name, "杀");
  assert.equal(value.effectiveCard(1, { causalEventId: "use:sha:target-scoped" }).effective.name, "杀");
  assert.equal(value.effectiveCard(1, { scope: "target-effect", causalEventId: "use:sha:target-scoped", targetSeat: 1 }).effective.name, "决斗");
  assert.equal(value.effectiveCard(1, { scope: "target-effect", causalEventId: "use:sha:target-scoped", targetSeat: 2 }).effective.name, "雷杀");

  value.observeCausalEvent({ eventId: "effect:sha:target1", eventType: "card:target-effect", status: "resolved" });

  assert.equal(value.effectiveCard(1, { scope: "target-effect", causalEventId: "use:sha:target-scoped", targetSeat: 1 }).effective.name, "杀");
  assert.equal(value.effectiveCard(1, { scope: "target-effect", causalEventId: "use:sha:target-scoped", targetSeat: 2 }).effective.name, "雷杀");
  assert.equal(value.cardAttributeViews(1, { viewKind: "effective" }).length, 1);
  assert.ok(value.snapshot().cardViewHistory.some((row) => row.targetSeat === 1 && row.invalidationReason === "causal-event-settled:effect:sha:target1"));
});

test("keeps observer-scoped apparent identity separate from printed and rule-effective identity", () => {
  const value = model([1, 2, 3], 2);
  value.observeZone({ zoneKey: "hand:1", count: 1, cardIds: [2], complete: true, visibility: "authorized" });
  value.observeChoiceSet({
    key: "rule:21109:target:1:disguise-name",
    domain: "effective-card-identity",
    candidates: ["杀", "闪", "桃"],
    exactSelections: 1,
    actorSeat: 1,
    observerSeats: [0, 2]
  });
  const view = value.applyOperation({
    type: "disguise-card-identity",
    cardId: 2,
    name: "杀",
    scope: "guessing-disguise",
    observerSeats: [0, 2],
    visibility: "authorized-guessers",
    whileChoiceSetKey: "rule:21109:target:1:disguise-name",
    expiresOnMove: false
  });

  assert.equal(view.status, "applied");
  assert.equal(value.effectiveCard(2, { scope: "guessing-disguise" }).effective.name, "无懈可击");
  assert.equal(value.effectiveCard(2, { scope: "guessing-disguise" }).views.length, 0);
  assert.equal(value.apparentCard(2, { scope: "guessing-disguise", observerSeat: 0 }).apparent.name, "杀");
  assert.equal(value.apparentCard(2, { scope: "guessing-disguise", observerSeat: 2 }).apparent.name, "杀");
  assert.equal(value.apparentCard(2, { scope: "guessing-disguise", observerSeat: 1 }).apparent.name, "无懈可击");
  assert.equal(value.apparentCard(2, { scope: "guessing-disguise" }).apparent.name, "无懈可击");
  assert.equal(value.cardAttributeViews(2, { viewKind: "apparent", observerSeat: 0 }).length, 1);

  value.resolveChoiceSet({ key: "rule:21109:target:1:disguise-name", selectedIndex: 0 });
  assert.equal(value.cardAttributeViews(2, { viewKind: "apparent" }).length, 0);
  assert.equal(value.physicalCardDefinition(2).card.name, "无懈可击");
  const history = value.snapshot().cardViewHistory[0];
  assert.equal(history.viewKind, "apparent");
  assert.equal(history.active, false);
  assert.match(history.invalidationReason, /^choice-set:/);
});

console.log(`\n========================================`);
console.log(`  Game model 测试: ${passed} 通过, ${failed} 失败`);
console.log(`========================================`);

if (failed) process.exit(1);
