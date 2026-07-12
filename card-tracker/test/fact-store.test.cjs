const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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

function loadFactStore(root) {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "runtime", "tracker", "fact-store.js"), "utf8");
  vm.runInNewContext(source, {
    window: { __SgsScripts: root }
  }, {
    filename: "fact-store.js"
  });
}

function loadKnownHandLedger(root) {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "runtime", "tracker", "known-hand-ledger.js"), "utf8");
  vm.runInNewContext(source, {
    window: { __SgsScripts: root }
  }, {
    filename: "known-hand-ledger.js"
  });
}

console.log("\nFact store");

test("known hand ledger runtime uses config card dictionary as candidate card pool", () => {
  let receivedOptions = null;
  const ledger = { marker: "ledger" };
  const root = {
    modules: {
      knownHandLedgerCore: {
        makeKnownHandLedger: (options) => {
          receivedOptions = options;
          return ledger;
        }
      }
    },
    sources: {
      configState: {
        cardDict: {
          11: { id: 11, name: "杀", suit: 1 },
          12: { id: 12, name: "闪", suit: 3 }
        }
      },
      seatIsDead: () => false,
      cardInfo: (id) => ({ id, name: `card-${id}` })
    },
    tracker: {
      protocolZoneLedger: {
        snapshot: () => ({
          recentCards: [
            {
              id: 11,
              zone: { code: 5 },
              source: { rule: "protocol-inferred-deck-endpoint", recordIndex: 7 }
            },
            {
              id: 12,
              zone: { code: 2 },
              source: { rule: "protocol-inferred-deck-endpoint", recordIndex: 7 }
            },
            {
              id: 13,
              zone: { code: 5 },
              source: { rule: "protocol-inferred-deck-endpoint", recordIndex: 8 }
            }
          ]
        })
      }
    },
    utils: { cardText: () => "" }
  };

  loadKnownHandLedger(root);

  assert.equal(root.tracker.knownHandLedger, ledger);
  assert.deepEqual(Array.from(receivedOptions.cardPool()).map((card) => card.id), [11, 12]);
  assert.equal(receivedOptions.seatIsDead(1), false);
  assert.deepEqual(JSON.parse(JSON.stringify(receivedOptions.knownCardsFromProtocolZone({ index: 7 }))), [{
    id: 11,
    name: "card-11",
    source: { rule: "protocol-inferred-deck-endpoint", recordIndex: 7 }
  }]);
});

test("snapshot keeps candidate rows and includes the headless game model", () => {
  let receivedPublicZones = null;
  const candidate = {
    kind: "candidate",
    text: "杀",
    display: "杀",
    probability: 0.75,
    count: 1,
    constraints: [{ field: "name", values: ["杀"], label: "杀" }],
    source: {
      rule: "known-hand-candidate-ledger",
      lastSource: {
        rule: "legacy-zone-candidate-group",
        origin: "runtime",
        zoneKey: "5-1"
      }
    }
  };
  const root = {
    modules: {},
    sources: {
      readTableScene: () => ({
        ok: true,
        seats: [{}, {}],
        managerSeats: [{}, {}],
        scene: { manager: { seats: [{}, {}] } },
        logs: [],
        visibility: [],
        selfSeatIndex: 0,
        seatRecords: []
      }),
      collectMaskHandFacts: () => [],
      collectPublicZoneFacts: () => ({
        seats: [],
        counts: { seats: 0, zones: 0, cards: 0, known: 0, byZone: {} },
        sources: {}
      }),
      installProtocolHook: () => {},
      configState: {
        cardDict: {},
        loaded: true,
        standardDeckIds: [1, 2, 3],
        gameRuleDecks: { 22: { cardIds: [1, 2, 3] } }
      },
      protocolState: {}
    },
    tracker: {
      syncGameModel: (_context, publicZones) => {
        receivedPublicZones = publicZones;
        return { schemaVersion: 1, deck: { count: 12 } };
      },
      knownHandLedger: {
        ingestVisibleRows: () => [{
            seatIndex: 1,
            names: ["刘备"],
            handCardCount: 2,
            knownCount: 0,
            candidateCount: 1,
            unknownCount: 2,
            cards: [],
            candidates: [candidate],
            sources: []
          }],
        summary: () => ({ candidateCount: 1 })
      },
      protocolZoneLedger: { snapshot: () => null },
      rulePlanner: { summary: () => null }
    },
    utils: {
      cardText: (card) => card?.text || ""
    }
  };

  loadFactStore(root);
  const snapshot = root.tracker.buildSnapshot();

  assert.equal(receivedPublicZones.counts.cards, 0);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.gameModel.deck.count, 12);
  assert.equal(snapshot.config.standardDeckCount, 3);
  assert.equal(snapshot.config.gameRuleDeckCount, 1);
  assert.equal(snapshot.rows[0].candidateCount, 1);
  assert.equal(snapshot.rows[0].candidates[0].text, "杀");
  assert.equal(snapshot.rows[0].candidates[0].source.lastSource.rule, "legacy-zone-candidate-group");
});

console.log(`\n========================================`);
console.log(`  Fact store 测试: ${passed} 通过, ${failed} 失败`);
console.log(`========================================`);

if (failed) process.exit(1);
