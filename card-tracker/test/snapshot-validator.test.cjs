const assert = require("node:assert/strict");
const { validateSnapshotValue } = require("../src/node/validation/snapshot-validator.cjs");

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

function baseSnapshot(overrides = {}) {
  return {
    ok: true,
    snapshot: {
      visible: false,
      config: {
        loaded: true,
        cardCount: 2786,
        standardDeckCount: 160,
        gameRuleDeckCount: 1,
        spellCount: 3027,
        skillRuleSummary: { trackerRelevant: 1992 }
      },
      protocol: {
        installed: true,
        hookTarget: "prototype",
        counts: {},
        records: []
      },
      gameModel: visibleGameModel(),
      rows: [],
      publicZones: {
        seats: [],
        counts: { seats: 0, zones: 0, cards: 0, known: 0, byZone: {} },
        sources: {}
      },
      visibility: [],
      ...overrides
    }
  };
}

function visibleGameModel(overrides = {}) {
  const deck = {
    definition: { known: true, cardIds: [1, 2, 3], label: "test-deck" },
    count: 3,
    top: [],
    bottom: [],
    knownRanks: {},
    remaining: {},
    ...(overrides.deck || {})
  };
  return {
    schemaVersion: 1,
    version: 1,
    initialized: true,
    sessionKey: "runtime-table-1",
    context: { turn: 1, round: 1, phase: 1, activeSeat: 0, stage: 1, gameOver: false },
    createdAt: 1000,
    catalog: { count: 2786, observedDefinitionSources: {}, definitionHistory: [] },
    deck,
    discard: { count: 0, exactIds: [], unknownCount: 0, complete: true, entries: [] },
    hands: {},
    handHistory: [],
    handKnowledgeHistory: [],
    handConstraintHistory: [],
    zoneExchangeHistory: [],
    zones: {},
    locations: {},
    locationHistory: [],
    locationGroups: {},
    locationGroupHistory: [],
    cardTags: {},
    cardTagHistory: [],
    cardEventHistory: [],
    causalEvents: {},
    causalEventHistory: [],
    comparisons: {},
    comparisonHistory: [],
    cardViews: {},
    cardViewHistory: [],
    ruleStates: {},
    ruleStateHistory: [],
    ruleModifiers: {},
    ruleModifierHistory: [],
    scheduledEffects: {},
    scheduledEffectHistory: [],
    choiceSets: {},
    choiceSetHistory: [],
    skillBindings: {},
    skillBindingHistory: [],
    physicalPiles: {},
    physicalPileHistory: [],
    entityPiles: {},
    entityLocations: {},
    entityPileHistory: [],
    contradictions: [],
    recentEvents: [],
    ...overrides,
    deck
  };
}

function maskSource(overrides = {}) {
  return {
    rule: "mask-visible-card-ui",
    legacySource: "mask",
    origin: "laya-card-ui",
    groupName: "WatchHandWindow",
    groupIndex: 0,
    groupNode: { path: "Stage/TableGameScene/WatchHandWindow#3" },
    node: { path: "Stage/TableGameScene/WatchHandWindow#3/CardUI#0" },
    mask: { bmpMaskAlpha: 0.5, hasMaskSignal: true },
    rect: { left: 1, top: 2, width: 3, height: 4 },
    ...overrides
  };
}

function protocolSource(overrides = {}) {
  return {
    rule: "protocol-authorized-friend-hand",
    legacySource: "protocol",
    origin: "protocol",
    protocol: "PubGsCUpdatePrivateCards",
    msgId: 1001,
    ...overrides
  };
}

console.log("\nSnapshot validator");

test("non-table snapshot is ready but battle validation remains pending", () => {
  const validation = validateSnapshotValue(baseSnapshot());
  assert.equal(validation.ok, true);
  assert.equal(validation.status, "pending");
  assert.equal(validation.checks.find((item) => item.id === "table.visible").status, "pending");
});

test("requireVisible turns non-table snapshot into failure", () => {
  const validation = validateSnapshotValue(baseSnapshot(), { requireVisible: true });
  assert.equal(validation.ok, false);
  assert.equal(validation.status, "fail");
  assert.equal(validation.checks.find((item) => item.id === "table.visible").status, "fail");
});

test("visible table snapshot passes core table checks", () => {
  const validation = validateSnapshotValue(baseSnapshot({
    visible: true,
    visibility: [{ seatIndex: 0 }],
    protocol: {
      installed: true,
      hookTarget: "prototype",
      counts: { PubGsCMoveCard: 2 },
      records: [{ index: 7, time: 1100, name: "PubGsCMoveCard", parsed: { type: "card:move" } }]
    },
    gameModel: visibleGameModel({
      hands: { 0: { count: 1, exactIds: [11], unknownCount: 0 } },
      recentEvents: [{ type: "card.move", source: { recordIndex: 7 } }]
    }),
    rows: [{
      seatIndex: 0,
      knownCount: 1,
      cards: [{ id: 11, source: { rule: "known-hand-ledger" } }]
    }]
  }));
  assert.equal(validation.ok, true);
  assert.equal(validation.checks.find((item) => item.id === "gameModel.initialized").status, "pass");
  assert.equal(validation.checks.find((item) => item.id === "protocol.moveCards").status, "pass");
  assert.equal(validation.checks.find((item) => item.id === "gameModel.protocolMoves").status, "pass");
  assert.equal(validation.checks.find((item) => item.id === "hand.sources").status, "pass");
});

test("visible table snapshot fails when a protocol move did not reach the game model", () => {
  const validation = validateSnapshotValue(baseSnapshot({
    visible: true,
    visibility: [{ seatIndex: 0 }],
    protocol: {
      installed: true,
      hookTarget: "prototype",
      counts: { PubGsCMoveCard: 1 },
      records: [{ index: 8, time: 1100, name: "PubGsCMoveCard", parsed: { type: "card:move" } }]
    },
    gameModel: visibleGameModel(),
    rows: []
  }));
  assert.equal(validation.ok, false);
  assert.equal(validation.checks.find((item) => item.id === "gameModel.protocolMoves").status, "fail");
});

test("mask visible sources pass when raw source and ledger history keep provenance", () => {
  const source = maskSource();
  const validation = validateSnapshotValue(baseSnapshot({
    visible: true,
    visibility: [{ seatIndex: 0 }],
    protocol: {
      installed: true,
      hookTarget: "prototype",
      counts: {}
    },
    rows: [{
      seatIndex: 0,
      knownCount: 1,
      cards: [{
        id: 11,
        source: {
          rule: "known-hand-ledger",
          firstRule: "mask-visible-card-ui",
          lastRule: "mask-visible-card-ui",
          seenRules: ["mask-visible-card-ui"],
          lastSource: source,
          sourceHistory: [source]
        }
      }]
    }],
    visibleRows: [{
      seatIndex: 0,
      knownCount: 1,
      cards: [{ id: 11, source }]
    }]
  }));
  assert.equal(validation.ok, true);
  assert.equal(validation.checks.find((item) => item.id === "hand.maskSource.raw").status, "pass");
  assert.equal(validation.checks.find((item) => item.id === "hand.maskSource.ledger").status, "pass");
});

test("mask visible sources fail when provenance is missing", () => {
  const incomplete = maskSource({ node: null });
  const validation = validateSnapshotValue(baseSnapshot({
    visible: true,
    visibility: [{ seatIndex: 0 }],
    protocol: {
      installed: true,
      hookTarget: "prototype",
      counts: {}
    },
    rows: [{
      seatIndex: 0,
      knownCount: 1,
      cards: [{
        id: 11,
        source: {
          rule: "known-hand-ledger",
          firstRule: "mask-visible-card-ui",
          seenRules: ["mask-visible-card-ui"],
          lastSource: incomplete,
          sourceHistory: [incomplete]
        }
      }]
    }],
    visibleRows: [{
      seatIndex: 0,
      knownCount: 1,
      cards: [{ id: 11, source: incomplete }]
    }]
  }));
  assert.equal(validation.ok, false);
  assert.equal(validation.checks.find((item) => item.id === "hand.maskSource.raw").status, "fail");
  assert.equal(validation.checks.find((item) => item.id === "hand.maskSource.ledger").status, "fail");
});

test("protocol-authorized friend hand sources pass when ledger history keeps protocol provenance", () => {
  const source = protocolSource();
  const validation = validateSnapshotValue(baseSnapshot({
    visible: true,
    visibility: [{ seatIndex: 2 }],
    protocol: {
      installed: true,
      hookTarget: "prototype",
      counts: {}
    },
    rows: [{
      seatIndex: 2,
      knownCount: 1,
      cards: [{
        id: 21,
        source: {
          rule: "known-hand-ledger",
          firstRule: "protocol-authorized-friend-hand",
          lastRule: "protocol-authorized-friend-hand",
          seenRules: ["protocol-authorized-friend-hand"],
          lastSource: source,
          sourceHistory: [source]
        }
      }]
    }]
  }));
  assert.equal(validation.ok, true);
  assert.equal(validation.checks.find((item) => item.id === "hand.protocolAuthorized.ledger").status, "pass");
});

test("protocol-authorized friend hand sources fail when protocol provenance is missing", () => {
  const incomplete = protocolSource({ msgId: undefined });
  const validation = validateSnapshotValue(baseSnapshot({
    visible: true,
    visibility: [{ seatIndex: 2 }],
    protocol: {
      installed: true,
      hookTarget: "prototype",
      counts: {}
    },
    rows: [{
      seatIndex: 2,
      knownCount: 1,
      cards: [{
        id: 21,
        source: {
          rule: "known-hand-ledger",
          firstRule: "protocol-authorized-friend-hand",
          seenRules: ["protocol-authorized-friend-hand"],
          lastSource: incomplete,
          sourceHistory: [incomplete]
        }
      }]
    }]
  }));
  assert.equal(validation.ok, false);
  assert.equal(validation.checks.find((item) => item.id === "hand.protocolAuthorized.ledger").status, "fail");
});

test("public zone sources pass when runtime provenance is present", () => {
  const validation = validateSnapshotValue(baseSnapshot({
    visible: true,
    visibility: [{ seatIndex: 0 }],
    protocol: {
      installed: true,
      hookTarget: "prototype",
      counts: {}
    },
    publicZones: {
      seats: [{
        seatIndex: 0,
        zones: {
          equip: {
            cards: [{
              id: 11,
              source: {
                rule: "public-equip-runtime",
                legacySource: "public-zone",
                origin: "runtime-public-field",
                seatIndex: 0,
                zoneName: "equip",
                fieldName: "equipCards"
              }
            }]
          }
        }
      }]
    }
  }));
  assert.equal(validation.ok, true);
  assert.equal(validation.checks.find((item) => item.id === "publicZones.present").status, "pass");
  assert.equal(validation.checks.find((item) => item.id === "publicZones.sources").status, "pass");
});

test("public zone sources fail when runtime provenance is missing", () => {
  const validation = validateSnapshotValue(baseSnapshot({
    visible: true,
    visibility: [{ seatIndex: 0 }],
    protocol: {
      installed: true,
      hookTarget: "prototype",
      counts: {}
    },
    publicZones: {
      seats: [{
        seatIndex: 0,
        zones: {
          equip: {
            cards: [{
              id: 11,
              source: {
                rule: "public-equip-runtime",
                legacySource: "public-zone",
                origin: "runtime-public-field",
                seatIndex: 0,
                zoneName: "equip"
              }
            }]
          }
        }
      }]
    }
  }));
  assert.equal(validation.ok, false);
  assert.equal(validation.checks.find((item) => item.id === "publicZones.sources").status, "fail");
});

test("named physical public-zone sources are validated while nonphysical entries are ignored", () => {
  const validation = validateSnapshotValue(baseSnapshot({
    visible: true,
    visibility: [{ seatIndex: 0 }],
    protocol: { installed: true, hookTarget: "prototype", counts: {} },
    publicZones: {
      seats: [{
        seatIndex: 0,
        zones: {},
        namedZones: [{
          representationKind: "physical-card-zone",
          cards: [{
            id: 11,
            source: {
              rule: "public-named-general-runtime",
              legacySource: "public-zone",
              origin: "runtime-public-named-field",
              seatIndex: 0,
              zoneName: "general",
              fieldName: "skillOutSideCardDict"
            }
          }]
        }, {
          representationKind: "nonphysical-state",
          cards: [{ id: null, source: null }]
        }]
      }]
    }
  }));
  assert.equal(validation.ok, true);
  assert.equal(validation.checks.find((item) => item.id === "publicZones.sources").status, "pass");
});

console.log(`\n========================================`);
console.log(`  Snapshot validator 测试: ${passed} 通过, ${failed} 失败`);
console.log(`========================================`);

if (failed) process.exit(1);
