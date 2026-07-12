const assert = require("node:assert/strict");
const { makeKnownHandLedger } = require("../src/runtime/tracker/known-hand-ledger-core.cjs");

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

function makeLedger(options = {}) {
  let time = 1000;
  return makeKnownHandLedger({
    now: () => ++time,
    cardText: (card) => card?.text || `${card?.name || ""}${card?.suit || ""}${card?.rank || ""}`,
    seatIsDead: (seat) => seat?.dead === true,
    ...options
  });
}

function card(id, name = `牌${id}`, rule = "mask-visible-card-ui") {
  return {
    id,
    name,
    suit: "♠",
    rank: String(id),
    text: `${name}♠${id}`,
    source: {
      rule,
      seatIndex: 1,
      uiIndex: 0,
      legacySource: rule === "mask-visible-card-ui" ? "mask" : rule,
      origin: "laya-card-ui",
      groupIndex: 2,
      groupName: "WatchHandWindow",
      groupNode: { label: "WatchHandWindow", path: "Stage/TableGameScene/WatchHandWindow#3", width: 400 },
      node: { label: "CardUI", path: "Stage/TableGameScene/WatchHandWindow#3/CardUI#0", childIndex: 0 },
      mask: { bmpMaskAlpha: 0.5, hasMaskSignal: true },
      rect: { x: 1, y: 2, width: 3, height: 4 }
    }
  };
}

function visibleRow(cards, handCardCount = 2, knownCount = cards.length) {
  return {
    seatIndex: 1,
    names: ["刘备"],
    handCardCount,
    knownCount,
    unknownCount: Math.max(0, handCardCount - knownCount),
    cards,
    sources: [{ sourceName: "mask-visible-card-ui", count: cards.length }]
  };
}

function moveRecord({ fromSeat, toSeat, ids = [], count = ids.length }) {
  return {
    index: 7,
    time: 1000,
    name: "PubGsCMoveCard",
    parsed: {
      type: "card:move",
      protocol: "PubGsCMoveCard",
      msgId: 9,
      skillId: 987,
      skillRule: {
        id: 987,
        name: "观虚",
        categories: ["hand.watch", "hand.transfer"]
      },
      cards: ids.map((id) => ({ id, name: `牌${id}`, text: `牌${id}` })),
      from: fromSeat == null ? null : { seat: fromSeat, code: 5 },
      to: toSeat == null ? null : { seat: toSeat, code: 5 },
      count
    }
  };
}

function deckDrawRecord({ toSeat = 1, count = 1 }) {
  return {
    index: 8,
    time: 1001,
    name: "PubGsCMoveCard",
    parsed: {
      type: "card:move",
      protocol: "PubGsCMoveCard",
      msgId: 10,
      skillId: 1,
      skillRule: {
        id: 1,
        name: "摸牌",
        categories: ["draw.count"]
      },
      cards: [],
      from: { seat: 255, code: 1 },
      to: { seat: toSeat, code: 5 },
      count
    }
  };
}

function candidateFilterRecord({ skillId = 862, fromSeat = 255, fromCode = 1, toSeat = 1, count = 1, desc = "" }) {
  return {
    index: 9,
    time: 1002,
    name: "PubGsCMoveCard",
    parsed: {
      type: "card:move",
      protocol: "PubGsCMoveCard",
      msgId: 11,
      skillId,
      skillRule: {
        id: skillId,
        name: "候选过滤",
        categories: ["deck.search", "constraint.property"],
        ...(desc ? { desc } : {})
      },
      cards: [],
      from: { seat: fromSeat, code: fromCode },
      to: { seat: toSeat, code: 5 },
      count
    }
  };
}

function skillTextCandidateRecord({ skillId = 91001, fromSeat = 2, fromCode = 5, toSeat = 1, srcSeat = null, appliesTo = "any", count = 1 }) {
  return {
    index: 10,
    time: 1003,
    name: "PubGsCMoveCard",
    parsed: {
      type: "card:move",
      protocol: "PubGsCMoveCard",
      msgId: 12,
      skillId,
      skillRule: {
        id: skillId,
        name: "红色收益",
        categories: ["hand.transfer", "constraint.property"],
        candidateRules: [{
          probability: 1,
          display: "红色",
          sourceRule: "skill-text-candidate-filter",
          legacySource: "skill-text",
          appliesTo,
          constraints: [
            { field: "color", values: ["red"], label: "红色" }
          ]
        }]
      },
      cards: [],
      from: { seat: fromSeat, code: fromCode },
      to: { seat: toSeat, code: 5 },
      srcSeat,
      count
    }
  };
}

function handInsertionCandidateRecord({ toSeat = 1, srcSeat = 1 } = {}) {
  return {
    index: 13,
    time: 1006,
    name: "PubGsCMoveCard",
    parsed: {
      type: "card:move",
      protocol: "PubGsCMoveCard",
      msgId: 15,
      skillId: 91004,
      skillRule: {
        id: 91004,
        name: "放马",
        categories: ["hand.transfer", "constraint.property"],
        candidateRules: [{
          probability: 1,
          display: "赤兔",
          sourceRule: "skill-text-candidate-filter",
          legacySource: "skill-text",
          appliesTo: "to-caster",
          order: "skill-text-hand-insertion-constraint",
          constraints: [
            { field: "name", values: ["赤兔"], label: "赤兔" }
          ]
        }]
      },
      cards: [],
      from: { seat: 255, code: 1 },
      to: { seat: toSeat, code: 5 },
      srcSeat,
      count: 1
    }
  };
}

function eachColorCandidateRecord({ toSeat = 1, count = 2 } = {}) {
  return {
    index: 12,
    time: 1005,
    name: "PubGsCMoveCard",
    parsed: {
      type: "card:move",
      protocol: "PubGsCMoveCard",
      msgId: 14,
      skillId: 91003,
      skillRule: {
        id: 91003,
        name: "偏宠",
        categories: ["draw.count", "constraint.property"],
        candidateRules: [
          {
            probability: 1,
            display: "红色",
            count: 1,
            sourceRule: "skill-text-candidate-filter",
            legacySource: "skill-text",
            appliesTo: "any",
            constraints: [{ field: "color", values: ["red"], label: "红色" }]
          },
          {
            probability: 1,
            display: "黑色",
            count: 1,
            sourceRule: "skill-text-candidate-filter",
            legacySource: "skill-text",
            appliesTo: "any",
            constraints: [{ field: "color", values: ["black"], label: "黑色" }]
          }
        ]
      },
      cards: [],
      from: { seat: 255, code: 1 },
      to: { seat: toSeat, code: 5 },
      count
    }
  };
}

function probabilityCandidateRecord({ skillId = 91002, toSeat = 1, count = 1 }) {
  return {
    index: 11,
    time: 1004,
    name: "PubGsCMoveCard",
    parsed: {
      type: "card:move",
      protocol: "PubGsCMoveCard",
      msgId: 13,
      skillId,
      skillRule: {
        id: skillId,
        name: "杀闪收益",
        categories: ["deck.search", "constraint.property"],
        candidateRules: [{
          probability: 1,
          display: "杀/闪",
          sourceRule: "skill-text-candidate-filter",
          legacySource: "skill-text",
          appliesTo: "any",
          constraints: [
            { field: "name", values: ["杀", "闪"], label: "杀/闪" }
          ]
        }]
      },
      cards: [],
      from: { seat: 255, code: 1 },
      to: { seat: toSeat, code: 5 },
      count
    }
  };
}

function legacyZoneCandidate({
  text = "杀",
  field = "name",
  values = ["杀"],
  probability = 0.75,
  legacyKey = -1
} = {}) {
  return {
    probability,
    display: text,
    text,
    sourceRule: "legacy-zone-candidate-group",
    legacySource: "legacy-card-zone",
    operate: "candidate-probability",
    order: "legacy-packed-key-group",
    constraints: [
      { field, values, label: text }
    ],
    legacyKey,
    zoneKey: "5-1",
    possibleIds: [1, 2, 3, 4],
    poolSize: 4,
    hitCount: 3
  };
}

function friendHandRecord({ seat = 1, ids = [] }) {
  return {
    name: "ClientHappyGetFriendHandcardRep",
    parsed: {
      type: "hand:friendHandCards",
      msgId: 12,
      seat,
      sourceRule: "protocol-authorized-friend-hand",
      cards: ids.map((id) => ({ id, name: `牌${id}`, suit: "♥", rank: String(id), text: `牌${id}♥${id}` }))
    }
  };
}

console.log("\nKnown hand ledger");

test("visible mask facts persist when the temporary UI no longer exposes cards", () => {
  const ledger = makeLedger();
  const context = { seats: [{}, {}] };
  ledger.ingestVisibleRows(context, [visibleRow([card(11)], 2, 1)]);
  ledger.ingestVisibleRows(context, [visibleRow([], 2, 0)]);
  const rows = ledger.snapshotRows(context);
  assert.equal(rows[0].knownCount, 1);
  assert.equal(rows[0].cards[0].id, 11);
  assert.equal(rows[0].cards[0].source.rule, "known-hand-ledger");
  assert.equal(rows[0].cards[0].source.firstRule, "mask-visible-card-ui");
  assert.deepEqual(rows[0].cards[0].source.seenRules, ["mask-visible-card-ui"]);
  assert.equal(rows[0].cards[0].source.lastSource.legacySource, "mask");
  assert.equal(rows[0].cards[0].source.lastSource.groupName, "WatchHandWindow");
  assert.equal(rows[0].cards[0].source.lastSource.node.path, "Stage/TableGameScene/WatchHandWindow#3/CardUI#0");
  assert.equal(rows[0].cards[0].source.sourceHistory.length, 1);
  assert.equal(rows[0].cards[0].source.sourceHistory[0].mask.bmpMaskAlpha, 0.5);
});

test("complete visible hand snapshot replaces stale known cards", () => {
  const ledger = makeLedger();
  const context = { seats: [{}, {}] };
  ledger.ingestVisibleRows(context, [visibleRow([card(11), card(12)], 2, 2)]);
  ledger.ingestVisibleRows(context, [visibleRow([card(11), card(13)], 2, 2)]);
  const rows = ledger.snapshotRows(context);
  assert.equal(rows[0].complete, true);
  assert.deepEqual(rows[0].cards.map((item) => item.id).sort((a, b) => a - b), [11, 13]);
});

test("known hand move removes only the listed known id", () => {
  const ledger = makeLedger();
  const context = { seats: [{}, {}] };
  ledger.ingestVisibleRows(context, [visibleRow([card(11), card(12)], 2, 2)]);
  ledger.handleProtocolRecord(moveRecord({ fromSeat: 1, toSeat: null, ids: [11], count: 1 }));
  const rows = ledger.snapshotRows(context);
  const event = ledger.summary().recentEvents.at(-1);
  assert.equal(rows[0].dirty, false);
  assert.equal(rows[0].complete, false);
  assert.deepEqual(rows[0].cards.map((item) => item.id), [12]);
  assert.equal(event.type, "remove-known");
  assert.equal(event.recordIndex, 7);
  assert.equal(event.protocol, "PubGsCMoveCard");
  assert.equal(event.skillId, 987);
  assert.equal(event.skillName, "观虚");
  assert.deepEqual(event.categories, ["hand.watch", "hand.transfer"]);
});

test("unknown hand loss clears stale facts and marks the seat dirty", () => {
  const ledger = makeLedger();
  const context = { seats: [{}, {}] };
  ledger.ingestVisibleRows(context, [visibleRow([card(11), card(12)], 2, 2)]);
  ledger.handleProtocolRecord(moveRecord({ fromSeat: 1, toSeat: null, ids: [], count: 1 }));
  const rows = ledger.snapshotRows(context);
  const event = ledger.summary().recentEvents.at(-1);
  assert.equal(rows[0].knownCount, 0);
  assert.equal(rows[0].dirty, true);
  assert.equal(rows[0].invalidationReason, "protocol-hand-from-unknown");
  assert.equal(event.type, "invalidate-seat");
  assert.equal(event.skillId, 987);
  assert.deepEqual(event.categories, ["hand.watch", "hand.transfer"]);
});

test("known protocol hand gain records protocol-hand-move source", () => {
  const ledger = makeLedger();
  const context = { seats: [{}, {}] };
  ledger.handleProtocolRecord(moveRecord({ fromSeat: null, toSeat: 1, ids: [21], count: 1 }));
  const rows = ledger.snapshotRows(context);
  const event = ledger.summary().recentEvents.at(-1);
  assert.equal(rows[0].cards[0].id, 21);
  assert.equal(rows[0].cards[0].source.firstRule, "protocol-hand-move");
  assert.equal(rows[0].cards[0].source.lastSource.protocol, "PubGsCMoveCard");
  assert.equal(event.type, "add-protocol-known");
  assert.equal(event.recordIndex, 7);
  assert.equal(event.skillId, 987);
});

test("unknown hand gain preserves known facts but leaves the row incomplete", () => {
  const ledger = makeLedger();
  const context = { seats: [{}, {}] };
  ledger.ingestVisibleRows(context, [visibleRow([card(11)], 2, 1)]);
  ledger.handleProtocolRecord(moveRecord({ fromSeat: null, toSeat: 1, ids: [], count: 1 }));
  const rows = ledger.snapshotRows(context);
  assert.equal(rows[0].knownCount, 1);
  assert.equal(rows[0].complete, false);
  assert.equal(ledger.summary().recentEvents.at(-1).type, "add-unknown-hand-count");
});

test("deck endpoint inference records a known protocol hand gain", () => {
  const ledger = makeLedger({
    knownCardsFromProtocolZone: () => [card(31, "杀", "protocol-inferred-deck-endpoint")]
  });
  const context = { seats: [{}, {}] };
  ledger.handleProtocolRecord(deckDrawRecord({ toSeat: 1, count: 1 }));

  const rows = ledger.snapshotRows(context);
  const event = ledger.summary().recentEvents.at(-1);
  assert.equal(rows[0].knownCount, 1);
  assert.equal(rows[0].unknownCount, 0);
  assert.equal(rows[0].cards[0].id, 31);
  assert.equal(rows[0].cards[0].source.firstRule, "protocol-inferred-deck-endpoint");
  assert.equal(event.type, "add-protocol-known");
  assert.equal(event.sourceRule, "protocol-inferred-deck-endpoint");
});

test("legacy special candidate filter records guesses separately from exact cards", () => {
  const ledger = makeLedger();
  const context = { seats: [{}, {}] };
  ledger.handleProtocolRecord(candidateFilterRecord({ skillId: 862, toSeat: 1, count: 1 }));

  const rows = ledger.snapshotRows(context);
  const events = ledger.summary().recentEvents;
  assert.equal(rows[0].knownCount, 0);
  assert.equal(rows[0].candidateCount, 1);
  assert.equal(rows[0].candidates[0].text, "点数6");
  assert.equal(rows[0].candidates[0].probability, 1);
  assert.equal(rows[0].candidates[0].constraints[0].field, "number");
  assert.deepEqual(rows[0].candidates[0].constraints[0].values, [6]);
  assert.equal(events.some((event) => event.type === "add-candidate"), true);
  assert.equal(ledger.summary().candidateCount, 1);
});

test("legacy special and skill text candidate filters stack on the same hidden hand gain", () => {
  const ledger = makeLedger();
  const context = { seats: [{}, {}] };
  ledger.handleProtocolRecord(candidateFilterRecord({
    skillId: 862,
    toSeat: 1,
    count: 1,
    desc: "你可以获得一张红色牌。"
  }));

  const rows = ledger.snapshotRows(context);
  const byRule = Object.fromEntries(rows[0].candidates.map((candidate) => [candidate.source.lastSource.rule, candidate]));
  assert.equal(rows[0].knownCount, 0);
  assert.equal(rows[0].candidateCount, 2);
  assert.deepEqual(byRule["legacy-special-candidate-filter"].constraints[0].values, [6]);
  assert.deepEqual(byRule["skill-text-candidate-filter"].constraints[0].values, ["red"]);
});

test("legacy special candidate filters keep old deck-or-discard source scope", () => {
  const ledger = makeLedger();
  const context = { seats: [{}, {}, {}] };
  ledger.handleProtocolRecord(candidateFilterRecord({
    skillId: 862,
    fromSeat: 2,
    fromCode: 5,
    toSeat: 1,
    count: 1,
    desc: "\u4f60\u53ef\u4ee5\u83b7\u5f97\u4e00\u5f20\u7ea2\u8272\u724c\u3002"
  }));

  const rows = ledger.snapshotRows(context);
  assert.equal(rows[0].knownCount, 0);
  assert.equal(rows[0].candidateCount, 1);
  assert.equal(rows[0].candidates[0].source.lastSource.rule, "skill-text-candidate-filter");
  assert.deepEqual(rows[0].candidates[0].constraints[0].values, ["red"]);
});

test("skill text candidate filter records hidden transfer guesses without exact cards", () => {
  const ledger = makeLedger();
  const context = { seats: [{}, {}, {}] };
  ledger.handleProtocolRecord(skillTextCandidateRecord({ fromCode: 5, toSeat: 1, count: 1 }));

  const rows = ledger.snapshotRows(context);
  assert.equal(rows[0].knownCount, 0);
  assert.equal(rows[0].candidateCount, 1);
  assert.equal(rows[0].candidates[0].text, "红色");
  assert.equal(rows[0].candidates[0].source.lastSource.rule, "skill-text-candidate-filter");
  assert.equal(rows[0].candidates[0].constraints[0].field, "color");
  assert.deepEqual(rows[0].candidates[0].constraints[0].values, ["red"]);
});

test("skill text each-one candidates preserve their declared candidate counts", () => {
  const ledger = makeLedger();
  const context = { seats: [{}, {}] };
  ledger.handleProtocolRecord(eachColorCandidateRecord({ toSeat: 1, count: 2 }));

  const rows = ledger.snapshotRows(context);
  assert.equal(rows[0].knownCount, 0);
  assert.equal(rows[0].candidateCount, 2);
  const byText = Object.fromEntries(rows[0].candidates.map((candidate) => [candidate.text, candidate]));
  assert.equal(byText["红色"].count, 1);
  assert.equal(byText["黑色"].count, 1);
});

test("card pool probability adds 75 percent guesses without exact cards", () => {
  const ledger = makeLedger({
    cardPool: () => [
      { id: 1, name: "杀", type: 1, color: 1, number: 1 },
      { id: 2, name: "杀", type: 1, color: 2, number: 2 },
      { id: 3, name: "杀", type: 1, color: 3, number: 3 },
      { id: 4, name: "闪", type: 1, color: 4, number: 4 }
    ]
  });
  const context = { seats: [{}, {}] };
  ledger.handleProtocolRecord(probabilityCandidateRecord({ toSeat: 1, count: 1 }));

  const rows = ledger.snapshotRows(context);
  const derived = rows[0].candidates.find((candidate) => candidate.source.lastSource.rule === "candidate-pool-probability");
  assert.equal(rows[0].knownCount, 0);
  assert.equal(rows[0].candidateCount >= 2, true);
  assert.equal(derived.text, "杀");
  assert.equal(derived.probability, 0.75);
  assert.equal(derived.source.lastSource.baseDisplay, "杀/闪");
  assert.equal(derived.source.lastSource.poolSize, 4);
  assert.equal(derived.source.lastSource.hitCount, 3);
  assert.deepEqual(derived.constraints[0].values, ["杀"]);
});

test("legacy zone candidates are refreshed without deleting other guesses", () => {
  const ledger = makeLedger();
  const context = { seats: [{}, {}] };
  ledger.handleProtocolRecord(skillTextCandidateRecord({ fromCode: 5, toSeat: 1, count: 1 }));
  ledger.ingestLegacyCandidateRows(context, [{
    seatIndex: 1,
    handCardCount: 2,
    candidates: [legacyZoneCandidate()]
  }]);

  let rows = ledger.snapshotRows(context);
  assert.equal(rows[0].knownCount, 0);
  assert.equal(rows[0].candidateCount, 2);
  const legacy = rows[0].candidates.find((candidate) => candidate.source.lastSource.rule === "legacy-zone-candidate-group");
  assert.equal(legacy.text, "杀");
  assert.equal(legacy.probability, 0.75);
  assert.equal(legacy.source.lastSource.origin, "runtime");
  assert.equal(legacy.source.lastSource.legacyKey, -1);
  assert.equal(legacy.source.lastSource.zoneKey, "5-1");
  assert.deepEqual(legacy.source.lastSource.possibleIds, [1, 2, 3, 4]);

  ledger.ingestLegacyCandidateRows(context, [{
    seatIndex: 1,
    handCardCount: 2,
    candidates: []
  }]);

  rows = ledger.snapshotRows(context);
  assert.equal(rows[0].candidateCount, 1);
  assert.equal(rows[0].candidates[0].source.lastSource.rule, "skill-text-candidate-filter");
});

test("skill text candidate filter skips moves that contradict caster direction", () => {
  const ledger = makeLedger();
  const context = { seats: [{}, {}, {}] };
  ledger.handleProtocolRecord(skillTextCandidateRecord({
    fromSeat: 2,
    toSeat: 1,
    srcSeat: 1,
    appliesTo: "from-caster"
  }));

  const rows = ledger.snapshotRows(context);
  assert.equal(rows[0].candidateCount, 0);
});

test("skill text hand insertion candidate follows the destination caster", () => {
  const ledger = makeLedger();
  const context = { seats: [{}, {}, {}] };
  ledger.handleProtocolRecord(handInsertionCandidateRecord({ toSeat: 1, srcSeat: 1 }));

  let rows = ledger.snapshotRows(context);
  assert.equal(rows[0].seatIndex, 1);
  assert.equal(rows[0].candidateCount, 1);
  assert.equal(rows[0].candidates[0].text, "赤兔");
  assert.equal(rows[0].candidates[0].source.lastSource.order, "skill-text-hand-insertion-constraint");
  assert.deepEqual(rows[0].candidates[0].constraints[0].values, ["赤兔"]);

  const otherLedger = makeLedger();
  otherLedger.handleProtocolRecord(handInsertionCandidateRecord({ toSeat: 2, srcSeat: 1 }));
  rows = otherLedger.snapshotRows(context);
  assert.equal(rows[0].candidateCount, 0);
});

test("authorized friend hand protocol snapshot replaces row with source history", () => {
  const ledger = makeLedger();
  const context = { seats: [{}, {}] };
  ledger.ingestVisibleRows(context, [visibleRow([card(11), card(12)], 2, 2)]);
  ledger.handleProtocolRecord(friendHandRecord({ seat: 1, ids: [21, 22] }));
  const rows = ledger.snapshotRows(context);
  assert.equal(rows[0].complete, true);
  assert.equal(rows[0].handCardCount, 2);
  assert.deepEqual(rows[0].cards.map((item) => item.id).sort((a, b) => a - b), [21, 22]);
  assert.equal(rows[0].cards[0].source.firstRule, "protocol-authorized-friend-hand");
  assert.equal(rows[0].cards[0].source.lastSource.legacySource, "protocol");
  assert.equal(rows[0].cards[0].source.lastSource.protocol, "ClientHappyGetFriendHandcardRep");
  assert.equal(ledger.summary().recentEvents.at(-1).type, "replace-protocol-hand-snapshot");
});

console.log(`\n========================================`);
console.log(`  Known hand ledger 测试: ${passed} 通过, ${failed} 失败`);
console.log(`========================================`);

if (failed) process.exit(1);
