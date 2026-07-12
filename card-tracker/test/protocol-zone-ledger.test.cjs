const assert = require("node:assert/strict");
const { makeProtocolZoneLedger, normalizeEndpoint } = require("../src/runtime/tracker/protocol-zone-ledger-core.cjs");

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

function makeLedger() {
  let time = 1000;
  return makeProtocolZoneLedger({
    now: () => ++time,
    cardText: (card) => card?.text || `${card?.name || ""}${card?.suit || ""}${card?.rank || ""}`,
    cardInfo: (id) => ({ id, name: `Card${id}`, suit: "S", rank: String(id), text: `Card${id}` })
  });
}

function skillRule(categories = []) {
  return {
    id: 1,
    name: "sample",
    categories
  };
}

function moveRecord({ ids = [], count = ids.length, from = { code: 1, seat: 255, zone: "pile" }, to = { code: 5, seat: 0, zone: "hand" }, skillId = 0, categories = [] }) {
  return {
    index: 7,
    time: 1234,
    name: "PubGsCMoveCard",
    parsed: {
      type: "card:move",
      protocol: "PubGsCMoveCard",
      msgId: 99,
      skillId,
      cards: ids.map((id) => ({ id, name: `Card${id}`, suit: "S", rank: String(id), text: `Card${id}` })),
      from,
      to,
      count,
      skillRule: skillRule(categories)
    }
  };
}

console.log("\nProtocol zone ledger");

test("normalizes protocol endpoints with stable zone keys", () => {
  assert.deepEqual(normalizeEndpoint({ code: 5, seat: 2, zone: "hand" }), {
    key: "5-2",
    code: 5,
    seat: 2,
    zone: "hand"
  });
  assert.equal(normalizeEndpoint({ code: 1 }).key, "1-255");
});

test("records only protocol-listed card ids as known locations", () => {
  const ledger = makeLedger();
  ledger.handleProtocolRecord(moveRecord({ ids: [11, 12], count: 2, skillId: 310 }));
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.moveCount, 1);
  assert.equal(snapshot.knownMoveCount, 1);
  assert.equal(snapshot.unknownMoveCount, 0);
  assert.equal(snapshot.knownLocationCount, 2);
  assert.deepEqual(snapshot.byZone, { hand: 2 });
  assert.deepEqual(snapshot.zones[0].cardIds, [11, 12]);
  assert.equal(snapshot.recentCards[0].source.rule, "protocol-listed-card-id");
  assert.equal(snapshot.recentCards[0].source.legacySource, "protocol");
  assert.equal(snapshot.recentCards[0].source.skillId, 310);
});

test("unknown movement records count without inventing card identity", () => {
  const ledger = makeLedger();
  ledger.handleProtocolRecord(moveRecord({ ids: [], count: 2 }));
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.moveCount, 1);
  assert.equal(snapshot.knownMoveCount, 0);
  assert.equal(snapshot.unknownMoveCount, 1);
  assert.equal(snapshot.cardCount, 0);
  assert.equal(snapshot.knownLocationCount, 0);
  assert.equal(snapshot.recentEvents[0].unknownCount, 2);
});

test("unknown source movement clears exact locations from that source zone", () => {
  const ledger = makeLedger();
  ledger.handleProtocolRecord(moveRecord({
    ids: [11, 12],
    from: { code: 1, seat: 255, zone: "pile" },
    to: { code: 5, seat: 0, zone: "hand" }
  }));
  ledger.handleProtocolRecord(moveRecord({
    ids: [],
    count: 1,
    from: { code: 5, seat: 0, zone: "hand" },
    to: { code: 2, seat: 255, zone: "discard" }
  }));

  const snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.byZone, {});
  assert.equal(snapshot.knownLocationCount, 0);
  assert.equal(snapshot.recentCards.filter((card) => card.zone).length, 0);
  assert.equal(snapshot.recentEvents.some((event) => event.type === "invalidate-zone" && event.zone.key === "5-0"), true);
});

test("moves a listed card from an old zone to the newest destination", () => {
  const ledger = makeLedger();
  ledger.handleProtocolRecord(moveRecord({ ids: [11], to: { code: 5, seat: 0, zone: "hand" } }));
  ledger.handleProtocolRecord(moveRecord({
    ids: [11],
    from: { code: 5, seat: 0, zone: "hand" },
    to: { code: 2, seat: 255, zone: "discard" }
  }));
  const snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.byZone, { discard: 1 });
  assert.equal(snapshot.zones[0].key, "2-255");
  assert.equal(snapshot.recentCards[0].zone.zone, "discard");
  assert.equal(snapshot.recentCards[0].previousZone.zone, "hand");
});

test("reset clears protocol-derived locations", () => {
  const ledger = makeLedger();
  ledger.handleProtocolRecord(moveRecord({ ids: [11] }));
  ledger.reset("table-scene-not-visible");
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.cardCount, 0);
  assert.equal(snapshot.zoneCount, 0);
  assert.equal(snapshot.resetReason, "table-scene-not-visible");
});

test("records deck top reveal only from endpoint categories with listed ids", () => {
  const ledger = makeLedger();
  ledger.handleProtocolRecord(moveRecord({
    ids: [31, 32, 33],
    count: 3,
    from: { code: 1, seat: 255, zone: "pile" },
    to: { code: 3, seat: 255, zone: "process" },
    skillId: 3208,
    categories: ["deck.top.reveal"]
  }));
  const endpoint = ledger.snapshot().deckEndpoint;
  assert.deepEqual(endpoint.top, [31, 32, 33]);
  assert.deepEqual(endpoint.bottom, []);
  assert.equal(endpoint.topSource.rule, "protocol-listed-deck-endpoint");
  assert.equal(endpoint.topSource.reason, "deck.top.reveal");
});

test("records deck bottom put when known cards are returned to the bottom", () => {
  const ledger = makeLedger();
  ledger.handleProtocolRecord(moveRecord({
    ids: [41, 42],
    from: { code: 3, seat: 255, zone: "process" },
    to: { code: 1, seat: 255, zone: "pile" },
    categories: ["deck.bottom.put"]
  }));
  const endpoint = ledger.snapshot().deckEndpoint;
  assert.deepEqual(endpoint.bottom, [41, 42]);
  assert.equal(endpoint.bottomSource.reason, "deck.bottom.put");
});

test("unknown deck movement clears known endpoint order without inventing ids", () => {
  const ledger = makeLedger();
  ledger.handleProtocolRecord(moveRecord({
    ids: [31, 32],
    from: { code: 1, seat: 255, zone: "pile" },
    to: { code: 3, seat: 255, zone: "process" },
    categories: ["deck.top.reveal"]
  }));
  ledger.handleProtocolRecord(moveRecord({
    ids: [],
    count: 1,
    from: { code: 1, seat: 255, zone: "pile" },
    to: { code: 5, seat: 0, zone: "hand" }
  }));
  const endpoint = ledger.snapshot().deckEndpoint;
  assert.deepEqual(endpoint.top, []);
  assert.equal(endpoint.invalidationCount, 1);
  assert.equal(endpoint.lastInvalidationReason, "unknown-deck-move");
});

test("shuffle clears known endpoint order", () => {
  const ledger = makeLedger();
  ledger.handleProtocolRecord(moveRecord({
    ids: [31, 32],
    from: { code: 1, seat: 255, zone: "pile" },
    to: { code: 3, seat: 255, zone: "process" },
    categories: ["deck.top.reveal"]
  }));
  ledger.handleProtocolRecord(moveRecord({
    ids: [],
    count: 0,
    from: { code: 1, seat: 255, zone: "pile" },
    to: { code: 9, seat: 255, zone: "shuffle" },
    categories: ["deck.shuffle"]
  }));
  const endpoint = ledger.snapshot().deckEndpoint;
  assert.deepEqual(endpoint.top, []);
  assert.equal(endpoint.lastInvalidationReason, "deck.shuffle");
});

test("draw bottom consumes known bottom cards when protocol lists ids", () => {
  const ledger = makeLedger();
  ledger.handleProtocolRecord(moveRecord({
    ids: [41, 42],
    from: { code: 3, seat: 255, zone: "process" },
    to: { code: 1, seat: 255, zone: "pile" },
    categories: ["deck.bottom.put"]
  }));
  ledger.handleProtocolRecord(moveRecord({
    ids: [41],
    from: { code: 1, seat: 255, zone: "pile" },
    to: { code: 5, seat: 0, zone: "hand" },
    categories: ["draw.bottom"]
  }));
  const endpoint = ledger.snapshot().deckEndpoint;
  assert.deepEqual(endpoint.bottom, [42]);
  assert.equal(endpoint.lastReason, "draw.bottom");
});

test("draw count consumes known deck top cards in order", () => {
  const ledger = makeLedger();
  ledger.handleProtocolRecord(moveRecord({
    ids: [31, 32],
    from: { code: 1, seat: 255, zone: "pile" },
    to: { code: 3, seat: 255, zone: "process" },
    categories: ["deck.top.reveal"]
  }));
  ledger.handleProtocolRecord(moveRecord({
    ids: [31],
    from: { code: 1, seat: 255, zone: "pile" },
    to: { code: 5, seat: 0, zone: "hand" },
    categories: ["draw.count"]
  }));
  const endpoint = ledger.snapshot().deckEndpoint;
  assert.deepEqual(endpoint.top, [32]);
  assert.equal(endpoint.lastReason, "draw.count");
  assert.equal(endpoint.recentEvents.at(-1).type, "consume");
  assert.equal(endpoint.recentEvents.at(-1).endpoint, "top");
});

test("unknown draw from a known deck top records an inferred hand location", () => {
  const ledger = makeLedger();
  ledger.handleProtocolRecord(moveRecord({
    ids: [31],
    from: { code: 3, seat: 255, zone: "process" },
    to: { code: 1, seat: 255, zone: "pile" },
    categories: ["deck.top.put"]
  }));
  ledger.handleProtocolRecord(moveRecord({
    ids: [],
    count: 1,
    from: { code: 1, seat: 255, zone: "pile" },
    to: { code: 5, seat: 0, zone: "hand" },
    categories: ["draw.count"]
  }));

  const snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.byZone, { hand: 1 });
  assert.deepEqual(snapshot.deckEndpoint.top, []);
  assert.equal(snapshot.recentCards[0].id, 31);
  assert.equal(snapshot.recentCards[0].source.rule, "protocol-inferred-deck-endpoint");
  assert.equal(snapshot.deckEndpoint.recentEvents.at(-1).reason, "draw.count");
});

test("draw count clears known deck top when protocol ids contradict the known order", () => {
  const ledger = makeLedger();
  ledger.handleProtocolRecord(moveRecord({
    ids: [31, 32],
    from: { code: 1, seat: 255, zone: "pile" },
    to: { code: 3, seat: 255, zone: "process" },
    categories: ["deck.top.reveal"]
  }));
  ledger.handleProtocolRecord(moveRecord({
    ids: [32],
    from: { code: 1, seat: 255, zone: "pile" },
    to: { code: 5, seat: 0, zone: "hand" },
    categories: ["draw.count"]
  }));
  const endpoint = ledger.snapshot().deckEndpoint;
  assert.deepEqual(endpoint.top, []);
  assert.equal(endpoint.invalidationCount, 1);
  assert.equal(endpoint.lastInvalidationReason, "draw.count:top-mismatch");
});

console.log(`\n========================================`);
console.log(`  Protocol zone ledger 测试: ${passed} 通过, ${failed} 失败`);
console.log(`========================================`);

if (failed) process.exit(1);
