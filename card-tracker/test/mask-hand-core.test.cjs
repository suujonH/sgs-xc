const assert = require("node:assert/strict");
const {
  collectMaskHandFacts,
  canUseCardUi,
  inspectMask
} = require("../src/runtime/sources/mask-hand-core.cjs");

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

function card(id, name = `card-${id}`) {
  return { id, name, text: `${name}#${id}` };
}

function cardUi(cardValue, overrides = {}) {
  return {
    label: `CardUI-${cardValue.id}`,
    path: `Stage/CardUI-${cardValue.id}`,
    Card: cardValue,
    visible: true,
    alpha: 1,
    bmpMaskAlpha: 0.5,
    width: 20,
    height: 30,
    ...overrides
  };
}

function group(seat, cardUis, overrides = {}) {
  return {
    label: "WatchHandWindow",
    path: "Stage/TableGameScene/WatchHandWindow#1",
    ownerSeat: seat,
    cardUis,
    visible: true,
    alpha: 1,
    children: [],
    ...overrides
  };
}

console.log("\nMask hand core");

test("collects self hand from visible CardUI before using self handCards fallback", () => {
  const self = { handCards: [card(11), card(12)] };
  const other = { handCardCount: 2, handCards: [card(21), card(22)] };
  const scene = {
    SelfSeatUi: {
      seat: self,
      cardContainer: {
        label: "SelfSeatUi.cardContainer",
        cardUis: [cardUi(card(11))]
      }
    },
    children: []
  };

  const rows = collectMaskHandFacts({
    scene,
    seats: [self, other],
    selfSeat: self,
    seatNames: [["self"], ["other"]]
  });

  assert.equal(rows[0].handCardCount, 2);
  assert.equal(rows[0].knownCount, 1);
  assert.equal(rows[0].cards[0].id, 11);
  assert.equal(rows[0].cards[0].source.rule, "self-card-ui");
  assert.equal(rows[0].cards[0].source.legacySource, "self-card-ui");
  assert.equal(rows[0].sources.some((source) => source.sourceName === "self-handCards"), false);
  assert.equal(rows[1].knownCount, 0);
});

test("uses self handCards only as the self fallback", () => {
  const self = { handCards: [card(11), card(12)] };
  const scene = {
    SelfSeatUi: {
      seat: self,
      cardContainer: { label: "SelfSeatUi.cardContainer", cardUis: [] }
    },
    children: []
  };

  const rows = collectMaskHandFacts({ scene, seats: [self], selfSeat: self, seatNames: [["self"]] });

  assert.equal(rows[0].knownCount, 2);
  assert.deepEqual(rows[0].cards.map((item) => item.id), [11, 12]);
  assert.equal(rows[0].cards[0].source.rule, "self-handCards");
});

test("does not read opponent handCards without authorized visibility", () => {
  const self = { handCards: [card(11)] };
  const other = { handCardCount: 2, handCards: [card(21), card(22)], canViewHandCard: false };
  const scene = {
    SelfSeatUi: {
      seat: self,
      cardContainer: { cardUis: [] }
    },
    children: []
  };

  const rows = collectMaskHandFacts({ scene, seats: [self, other], selfSeat: self });

  assert.equal(rows[1].handCardCount, 2);
  assert.equal(rows[1].knownCount, 0);
  assert.equal(rows[1].unknownCount, 2);
});

test("collects authorized opponent handCards only when count matches", () => {
  const self = { handCards: [card(11)] };
  const authorized = { handCardCount: 2, handCards: [card(21), card(22)], canViewHandCard: true };
  const mismatched = { handCardCount: 3, handCards: [card(31), card(32)], canViewHandCard: true };
  const scene = {
    SelfSeatUi: {
      seat: self,
      cardContainer: { cardUis: [] }
    },
    children: []
  };

  const rows = collectMaskHandFacts({ scene, seats: [self, authorized, mismatched], selfSeat: self });

  assert.equal(rows[1].knownCount, 2);
  assert.equal(rows[1].cards[0].source.rule, "authorized-handCards");
  assert.equal(rows[2].knownCount, 0);
});

test("collects visible mask CardUI groups with provenance and ignores hidden backs", () => {
  const self = { handCards: [card(11)] };
  const other = { handCardCount: 2, handCards: [], canViewHandCard: false };
  const visibleGroup = group(other, [
    cardUi(card(21), { path: "Stage/Watch/CardUI#0" }),
    cardUi(card(22), { skin: "card_back.png" })
  ]);
  const scene = {
    SelfSeatUi: {
      seat: self,
      cardContainer: { cardUis: [] }
    },
    children: [visibleGroup]
  };

  const rows = collectMaskHandFacts({ scene, seats: [self, other], selfSeat: self });

  assert.equal(rows[1].knownCount, 1);
  assert.equal(rows[1].cards[0].id, 21);
  assert.equal(rows[1].cards[0].source.rule, "mask-visible-card-ui");
  assert.equal(rows[1].cards[0].source.legacySource, "mask");
  assert.equal(rows[1].cards[0].source.groupName, "WatchHandWindow");
  assert.equal(rows[1].cards[0].source.node.path, "Stage/Watch/CardUI#0");
  assert.equal(rows[1].cards[0].source.mask.bmpMaskAlpha, 0.5);
  assert.equal(rows[1].unknownCount, 1);
});

test("mask inspection and CardUI usability reject invisible cards", () => {
  const ui = cardUi(card(11), { visible: false });
  const mask = inspectMask(ui);
  assert.equal(mask.visible, false);
  assert.equal(canUseCardUi(ui), false);
});

console.log(`\n========================================`);
console.log(`  Mask hand core 测试: ${passed} 通过, ${failed} 失败`);
console.log(`========================================`);

if (failed) process.exit(1);
