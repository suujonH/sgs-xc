const assert = require("node:assert/strict");
const { buildHandSourceReport } = require("../src/node/analysis/hand-source-report.cjs");

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

function maskSource(overrides = {}) {
  return {
    rule: "mask-visible-card-ui",
    legacySource: "mask",
    origin: "laya-card-ui",
    groupIndex: 3,
    groupName: "WatchHandWindow",
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
    seatIndex: 2,
    protocol: "PubGsCUpdatePrivateCards",
    msgId: 1001,
    ...overrides
  };
}

function snapshotWithMask(source = maskSource()) {
  return {
    ok: true,
    snapshot: {
      visible: true,
      rows: [{
        seatIndex: 1,
        names: ["刘备"],
        handCardCount: 2,
        knownCount: 1,
        unknownCount: 1,
        complete: false,
        dirty: false,
        cards: [{
          id: 11,
          text: "杀♠7",
          source: {
            rule: "known-hand-ledger",
            firstRule: "mask-visible-card-ui",
            lastRule: "mask-visible-card-ui",
            seenRules: ["mask-visible-card-ui"],
            lastSource: source,
            sourceHistory: [source]
          }
        }],
        sources: [{ sourceName: "mask-visible-card-ui", count: 1 }]
      }],
      visibleRows: [{
        seatIndex: 1,
        names: ["刘备"],
        handCardCount: 2,
        knownCount: 1,
        unknownCount: 1,
        cards: [{ id: 11, text: "杀♠7", source }],
        sources: [{ sourceName: "mask-visible-card-ui", count: 1 }]
      }],
      visibility: [{ seatIndex: 1 }],
      logs: []
    }
  };
}

function snapshotWithProtocolAuthorized(source = protocolSource()) {
  return {
    ok: true,
    snapshot: {
      visible: true,
      rows: [{
        seatIndex: 2,
        names: ["孙权"],
        handCardCount: 2,
        knownCount: 2,
        unknownCount: 0,
        complete: true,
        dirty: false,
        cards: [{
          id: 21,
          text: "闪♥2",
          source: {
            rule: "known-hand-ledger",
            firstRule: "protocol-authorized-friend-hand",
            lastRule: "protocol-authorized-friend-hand",
            seenRules: ["protocol-authorized-friend-hand"],
            lastSource: source,
            sourceHistory: [source]
          }
        }],
        sources: [{ sourceName: "protocol-authorized-friend-hand", count: 1 }]
      }],
      visibleRows: [],
      visibility: [{ seatIndex: 2 }],
      logs: []
    }
  };
}

console.log("\nHand source report");

test("summarizes mask provenance from raw rows and ledger history", () => {
  const report = buildHandSourceReport(snapshotWithMask(), {
    checks: [
      { id: "hand.maskSource.raw", status: "pass", message: "raw ok", actual: 1 },
      { id: "hand.maskSource.ledger", status: "pass", message: "ledger ok", actual: 1 }
    ]
  });
  assert.equal(report.ok, true);
  assert.equal(report.visible, true);
  assert.equal(report.counts.ledgerKnownCards, 1);
  assert.equal(report.counts.rawVisibleCards, 1);
  assert.equal(report.sources.ledgerUnderlyingRules["mask-visible-card-ui"], 1);
  assert.equal(report.sources.rawRules["mask-visible-card-ui"], 1);
  assert.equal(report.sources.legacySources.mask, 2);
  assert.equal(report.mask.rawCount, 1);
  assert.equal(report.mask.rawWithProvenance, 1);
  assert.equal(report.mask.ledgerCount, 1);
  assert.equal(report.mask.ledgerWithHistory, 1);
  assert.equal(report.mask.rawCheck.status, "pass");
  assert.equal(report.seats[0].cards[0].nodePath, "Stage/TableGameScene/WatchHandWindow#3/CardUI#0");
});

test("reports missing mask provenance fields", () => {
  const report = buildHandSourceReport(snapshotWithMask(maskSource({ node: null })));
  assert.equal(report.mask.rawCount, 1);
  assert.equal(report.mask.rawWithProvenance, 0);
  assert.equal(report.mask.ledgerWithHistory, 0);
  assert.deepEqual(report.mask.rawProblems[0].missing, ["node.path"]);
  assert.deepEqual(report.mask.ledgerProblems[0].missing, ["node.path"]);
});

test("summarizes protocol-authorized friend hand provenance", () => {
  const report = buildHandSourceReport(snapshotWithProtocolAuthorized(), {
    checks: [
      { id: "hand.protocolAuthorized.ledger", status: "pass", message: "protocol ok", actual: 1 }
    ]
  });
  assert.equal(report.protocolAuthorized.ledgerCount, 1);
  assert.equal(report.protocolAuthorized.ledgerWithHistory, 1);
  assert.equal(report.protocolAuthorized.ledgerCheck.status, "pass");
  assert.equal(report.sources.ledgerUnderlyingRules["protocol-authorized-friend-hand"], 1);
  assert.equal(report.sources.legacySources.protocol, 1);
  assert.equal(report.seats[0].cards[0].legacySource, "protocol");
  assert.equal(report.seats[0].cards[0].origin, "protocol");
  assert.equal(report.seats[0].cards[0].protocol, "PubGsCUpdatePrivateCards");
  assert.equal(report.seats[0].cards[0].msgId, 1001);
});

test("reports missing protocol-authorized provenance fields", () => {
  const report = buildHandSourceReport(snapshotWithProtocolAuthorized(protocolSource({ msgId: undefined })));
  assert.equal(report.protocolAuthorized.ledgerCount, 1);
  assert.equal(report.protocolAuthorized.ledgerWithHistory, 0);
  assert.deepEqual(report.protocolAuthorized.ledgerProblems[0].missing, ["msgId"]);
});

console.log(`\n========================================`);
console.log(`  Hand source report 测试: ${passed} 通过, ${failed} 失败`);
console.log(`========================================`);

if (failed) process.exit(1);
