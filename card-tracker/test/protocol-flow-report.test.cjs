const assert = require("node:assert/strict");
const { buildProtocolFlowReport } = require("../src/node/analysis/protocol-flow-report.cjs");

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

function skillRule(id, name, categories) {
  return {
    id,
    name,
    priority: categories.length ? "tracker-relevant" : "none",
    confidence: "generic-log-rule",
    categories
  };
}

function snapshot(overrides = {}) {
  const moveRule = skillRule(13241, "sample random gain", ["random.card.gain"]);
  return {
    ok: true,
    snapshot: {
      visible: true,
      reason: "",
      protocol: {
        installed: true,
        installError: "",
        hookTarget: "prototype",
        counts: { PubGsCMoveCard: 1, PubGsCUseSpell: 1 },
        context: { turn: 2, round: 1, phase: 4 },
        maxRecords: 500,
        recentSkillEvents: [{
          time: 2000,
          protocol: "PubGsCUseSpell",
          type: "skill:use",
          skillId: 13241,
          skillRule: moveRule
        }],
        records: [{
          index: 3,
          time: 1000,
          name: "PubGsCMoveCard",
          parsed: {
            msgId: 44,
            protocol: "PubGsCMoveCard",
            type: "card:move",
            cards: [{ id: 88, name: "Sha", suit: "spade", rank: "7", spellId: 1 }],
            from: { seat: 255, zone: "pile", code: 1 },
            to: { seat: 0, zone: "hand", code: 5 },
            count: 2,
            moveType: 9,
            srcSeat: 0,
            skillId: 13241,
            skillRule: moveRule,
            context: { turn: 2, round: 1, phase: 4 }
          }
        }]
      },
      rulePlanner: {
        version: 1,
        handledCount: 2,
        plannedCount: 1,
        lastError: "",
        categoryCounts: { "random.card.gain": 1 },
        actionCounts: { "record-random-gain-only-if-protocol-lists-id": 1, "add-known-to-hand-ledger": 1 },
        aliasCounts: {},
        recentPlans: [{
          recordIndex: 3,
          time: 1000,
          protocol: "PubGsCMoveCard",
          eventType: "card:move",
          skillId: 13241,
          effectiveSkillId: 13241,
          aliasOf: 0,
          skillName: "sample random gain",
          confidence: "generic-log-rule",
          categories: ["random.card.gain"],
          actions: ["record-random-gain-only-if-protocol-lists-id", "add-known-to-hand-ledger"],
          knownCardIds: [88],
          cardCount: 2,
          manualReview: false,
          legacyHint: ""
        }]
      },
      protocolZoneLedger: {
        version: 1,
        moveCount: 1,
        knownMoveCount: 1,
        unknownMoveCount: 1,
        cardCount: 1,
        knownLocationCount: 1,
        zoneCount: 1,
        byZone: { hand: 1 },
        sources: { "protocol-listed-card-id": 1 },
        deckEndpoint: {
          version: 1,
          top: [31, 32],
          bottom: [],
          knownTopCount: 2,
          knownBottomCount: 0,
          invalidationCount: 0,
          lastReason: "deck.top.reveal",
          topSource: { rule: "protocol-listed-deck-endpoint", reason: "deck.top.reveal" },
          bottomSource: null,
          recentEvents: [{ type: "set", endpoint: "top", ids: [31, 32] }]
        },
        recentEvents: [{
          type: "card-move",
          recordIndex: 3,
          knownCardIds: [88],
          unknownCount: 1
        }]
      },
      legacyCardTracker: {
        started: true,
        startReason: "",
        moveCount: 1,
        lastError: "",
        zoneCounts: { "5-0": 2 },
        gameState: { turn: 2, round: 1, phase: 4 },
        apiSnapshot: { present: true, counts: { totalKnown: 1 } },
        zoneProjection: { totals: { cards: 2, knownCount: 1, unknownCount: 1 } }
      },
      ...overrides
    }
  };
}

console.log("\nProtocol flow report");

test("summarizes card movement, skill events, plans, and legacy counters", () => {
  const report = buildProtocolFlowReport(snapshot(), {
    checks: [
      { id: "protocol.installed", status: "pass", message: "protocol hook is installed" },
      { id: "planner.events", status: "pass", message: "rule planner is ready" },
      { id: "legacy.started", status: "pass", message: "legacy tracker started" }
    ]
  });
  assert.equal(report.ok, true);
  assert.equal(report.protocol.installed, true);
  assert.equal(report.counts.cardMoves, 1);
  assert.equal(report.counts.movesWithKnownIds, 1);
  assert.equal(report.counts.movesWithUnknownCount, 1);
  assert.equal(report.counts.skillEvents, 1);
  assert.equal(report.counts.plans, 1);
  assert.equal(report.counts.protocolZoneLedgerMoves, 1);
  assert.equal(report.counts.protocolZoneLedgerKnownLocations, 1);
  assert.equal(report.counts.protocolZoneDeckTopKnown, 2);
  assert.equal(report.counts.protocolZoneDeckBottomKnown, 0);
  assert.equal(report.counts.legacyMoves, 1);
  assert.equal(report.protocolZoneLedger.knownLocationCount, 1);
  assert.deepEqual(report.protocolZoneLedger.byZone, { hand: 1 });
  assert.deepEqual(report.protocolZoneLedger.deckEndpoint.top, [31, 32]);
  assert.equal(report.protocolZoneLedger.deckEndpoint.topSource.reason, "deck.top.reveal");
  assert.deepEqual(report.cardMoves[0].knownCardIds, [88]);
  assert.equal(report.cardMoves[0].unknownCount, 1);
  assert.deepEqual(report.cardMoves[0].plannedActions, ["record-random-gain-only-if-protocol-lists-id", "add-known-to-hand-ledger"]);
  assert.equal(report.skillEvents[0].skillName, "sample random gain");
  assert.equal(report.checks.plannerEvents.status, "pass");
  assert.deepEqual(report.problems, []);
});

test("records protocol movement without planner output as a diagnostic problem", () => {
  const value = snapshot({
    rulePlanner: {
      version: 1,
      handledCount: 1,
      plannedCount: 0,
      lastError: "",
      recentPlans: []
    }
  });
  const report = buildProtocolFlowReport(value);
  assert.equal(report.ok, true);
  assert.equal(report.counts.problems, 2);
  assert.equal(report.problems[0].id, "protocol-move-without-rule-plan");
});

test("reports missing snapshot object", () => {
  const report = buildProtocolFlowReport(null);
  assert.equal(report.ok, false);
  assert.equal(report.error, "snapshot object is missing");
});

console.log(`\n========================================`);
console.log(`  Protocol flow report 测试: ${passed} 通过, ${failed} 失败`);
console.log(`========================================`);

if (failed) process.exit(1);
