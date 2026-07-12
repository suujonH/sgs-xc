const assert = require("node:assert/strict");
const {
  collectPublicZoneFacts,
  PUBLIC_ZONE_RULES
} = require("../src/runtime/sources/public-zone-core.cjs");

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

const cardDict = {
  11: { id: 11, name: "杀", suit: "♠", rank: "7", ncn: "杀♠7" },
  12: { id: 12, name: "闪", suit: "♥", rank: "2", ncn: "闪♥2" },
  13: { id: 13, name: "桃", suit: "♦", rank: "A", ncn: "桃♦A" }
};

console.log("\nPublic zone core");

test("collects public equip, judge, and general zone cards with source rules", () => {
  const context = {
    seats: [{
      equipCards: [{ cardId: 11, cardName: "杀", cardFlower: 3, cardNumber: 7 }],
      equipList: [{ cardId: 11, cardName: "杀", cardFlower: 3, cardNumber: 7 }],
      judgeCardList: new Set([{ Card: { CardId: 12, CardName: "闪", CardFlower: 1, CardNumber: 2 } }]),
      generalCards: new Map([["a", 13]]),
      handCards: [{ cardId: 99, cardName: "不应读取" }]
    }],
    seatNames: [["刘备"]]
  };

  const result = collectPublicZoneFacts(context, { cardDict });
  assert.equal(result.counts.seats, 1);
  assert.equal(result.counts.cards, 3);
  assert.equal(result.counts.byZone.equip, 1);
  assert.equal(result.counts.byZone.judge, 1);
  assert.equal(result.counts.byZone.general, 1);
  assert.equal(result.sources[PUBLIC_ZONE_RULES.equip], 1);
  assert.equal(result.sources[PUBLIC_ZONE_RULES.judge], 1);
  assert.equal(result.sources[PUBLIC_ZONE_RULES.general], 1);
  assert.equal(result.seats[0].zones.equip.cards[0].text, "杀♠7");
  assert.equal(result.seats[0].zones.judge.cards[0].source.origin, "runtime-public-field");
  assert.equal(result.seats[0].zones.general.cards[0].source.fieldName, "generalCards");
});

test("keeps empty public zones without reading hidden handCards", () => {
  const result = collectPublicZoneFacts({
    seats: [{
      handCards: [{ cardId: 11, cardName: "杀", cardFlower: 3, cardNumber: 7 }]
    }],
    seatNames: [["曹操"]]
  }, { cardDict });
  assert.equal(result.counts.seats, 1);
  assert.equal(result.counts.cards, 0);
  assert.equal(result.seats[0].zones.equip.count, 0);
  assert.equal(result.seats[0].zones.judge.count, 0);
  assert.equal(result.seats[0].zones.general.count, 0);
});

test("preserves current H5 skill outside-card dictionary keys and unknown placeholders", () => {
  const currentDictionary = (entries) => ({
    _maps: Object.fromEntries(entries),
    get Maps() { return this._maps; },
    get elements() { return Object.entries(this._maps).map(([key, data]) => ({ key, data })); },
    get keys() { return Object.keys(this._maps); },
    get datum() { return Object.values(this._maps); }
  });
  const result = collectPublicZoneFacts({
    selfSeatIndex: 0,
    seats: [{
      // This aggregate mirror must not move CardID 11 back into general:0.
      generalCards: [11],
      skillOutSideCardDict: currentDictionary([
        [123, [{ CardId: 11, CardName: "杀", CardFlower: 3, CardNumber: 7 }]],
        [212, [{ CardId: 0 }]]
      ]),
      skillOutSideCardParamDict: currentDictionary([
        [123, ["runtime-param"]]
      ]),
      handCards: [{ CardId: 99, CardName: "不应读取" }]
    }],
    seatNames: [["邓艾"]]
  }, { cardDict });

  const zones = result.seats[0].namedZones;
  assert.equal(zones.length, 2);
  assert.deepEqual(zones.map((zone) => zone.skillId), [123, 212]);
  assert.deepEqual(zones.map((zone) => zone.zoneParam), [123, 212]);
  assert.deepEqual(zones.map((zone) => zone.pileKey), ["123", "212"]);
  assert.equal(zones[0].zoneKind, "removed");
  assert.equal(zones[0].ownerSeat, null);
  assert.equal(zones[0].ownershipKnown, true);
  assert.equal(zones[0].orderKnown, false);
  assert.deepEqual(zones[0].metadata.outsideCardParams, ["runtime-param"]);
  assert.deepEqual(zones[0].cardIds, [11]);
  assert.equal(zones[0].complete, true);
  assert.equal(zones[1].count, 1);
  assert.deepEqual(zones[1].cardIds, []);
  assert.equal(zones[1].complete, false);
  assert.equal(zones[1].visibilityAudience, "runtime-observed");
  assert.deepEqual(zones[1].observerSeats, [0]);
  assert.equal(result.seats[0].zones.general.count, 0);
  assert.equal(result.counts.cards, 2);
  assert.equal(result.counts.known, 1);
  assert.equal(result.counts.byZone.general, 2);
});

test("keeps same-seat named piles distinct and does not infer enumeration order", () => {
  const result = collectPublicZoneFacts({
    selfSeatIndex: 2,
    seats: [{
      outsideCards: new Map([
        ["笔", {
          pileKey: "skill:212:笔",
          skillId: 212,
          zoneParam: 212,
          faceUp: false,
          cards: [{ CardId: 12, CardName: "闪", CardFlower: 1, CardNumber: 2 }]
        }],
        ["田", {
          pileKey: "skill:123:田",
          skillId: 123,
          zoneParam: 123,
          faceUp: true,
          cards: [{ CardId: 13, CardName: "桃", CardFlower: 2, CardNumber: 1 }]
        }]
      ])
    }]
  }, { cardDict });

  const [fieldPile, tian] = result.seats[0].namedZones;
  assert.notEqual(fieldPile.pileKey, tian.pileKey);
  assert.equal(fieldPile.orderKnown, false);
  assert.equal(fieldPile.ordered, false);
  assert.equal(fieldPile.faceUp, true);
  assert.equal(fieldPile.visibilityAudience, "public");
  assert.equal(tian.faceUp, false);
  assert.equal(tian.visibilityAudience, "restricted");
  assert.deepEqual(tian.observerSeats, [2]);
});

test("triages reviewed physical piles, reviewed marks, and unreviewed zero-ID entries separately", () => {
  const result = collectPublicZoneFacts({
    selfSeatIndex: 0,
    seats: [{
      skillOutSideCardDict: {
        elements: [
          { key: 3042, data: [{ CardId: 0 }] },
          { key: 3096, data: [{ CardId: 0 }] },
          { key: 11003, data: [{ CardId: 0 }] },
          { key: 7028, data: [{ CardId: 0 }] },
          { key: 21110, data: [{ CardId: 0 }] },
          { key: 999, data: [{ CardId: 0 }] }
        ]
      }
    }]
  }, { cardDict });

  assert.deepEqual(Object.fromEntries(result.seats[0].namedZones.map((zone) => [zone.skillId, zone.representationKind])), {
    999: "unresolved-outside-entry",
    3042: "nonphysical-state",
    3096: "physical-card-zone",
    7028: "physical-card-zone",
    11003: "nonphysical-state",
    21110: "physical-card-zone"
  });
  assert.equal(result.counts.cards, 3);
  assert.equal(result.counts.nonphysicalOutsideEntries, 2);
  assert.equal(result.counts.unresolvedOutsideEntries, 1);
  assert.equal(result.counts.byZone.general, 3);
});

console.log(`\n========================================`);
console.log(`  Public zone core 测试: ${passed} 通过, ${failed} 失败`);
console.log(`========================================`);

if (failed) process.exit(1);
