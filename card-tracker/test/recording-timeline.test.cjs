const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

async function writeJsonl(filePath, rows) {
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function fakeMoveRecord() {
  return {
    index: 7,
    time: 1000,
    name: "PubGsCMoveCard",
    parsed: {
      type: "card:move",
      protocol: "PubGsCMoveCard",
      skillId: 77,
      skillRule: {
        id: 77,
        name: "sample gain",
        confidence: "sample",
        categories: ["random.card.gain", "hand.transfer"]
      },
      count: 2,
      cards: [{ id: 11, name: "sha", suit: "spade", rank: "A" }],
      from: { code: 1, zone: "pile", seat: 255 },
      to: { code: 5, zone: "hand", seat: 1 }
    }
  };
}

function fakeSkillRecord(index = 8) {
  return {
    index,
    time: 1100,
    name: "PubGsCUseSpell",
    parsed: {
      type: "skill:use",
      protocol: "PubGsCUseSpell",
      skillId: 88,
      skillRule: {
        id: 88,
        name: "sample watch",
        confidence: "sample",
        categories: [{ id: "hand.watch" }]
      }
    }
  };
}

function fakeProtocolZoneLedger() {
  return {
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
      topSource: {
        endpoint: "top",
        reason: "deck.top.reveal",
        recordIndex: 7,
        skillId: 77
      },
      bottomSource: null,
      knownTopCount: 2,
      knownBottomCount: 0,
      invalidationCount: 0,
      lastInvalidationReason: "",
      lastReason: "deck.top.reveal",
      recentEvents: [{
        type: "set",
        endpoint: "top",
        reason: "deck.top.reveal",
        ids: [31, 32],
        recordIndex: 7,
        skillId: 77,
        unknownCount: 0
      }]
    },
    recentEvents: [{
      type: "card-move",
      recordIndex: 7,
      knownCardIds: [11],
      unknownCount: 1
    }]
  };
}

async function createRecordingDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgs-recording-timeline-"));
  const runDir = path.join(root, "recording-sample");
  await fs.mkdir(runDir, { recursive: true });
  const summary = {
    ok: true,
    runDir,
    startedAt: "2026-07-04T10:00:00.000Z",
    finishedAt: "2026-07-04T10:00:01.000Z",
    elapsedMs: 1000,
    durationMs: 1000,
    intervalMs: 100,
    snapshotEveryMs: 500,
    installFirst: true,
    ticks: 3,
    protocolRecords: 2,
    consoleProtocolRecords: 1,
    snapshots: 2,
    reports: 1,
    firstVisibleAt: "2026-07-04T10:00:00.500Z",
    lastVisible: true
  };
  const plan = {
    recordIndex: 7,
    time: 1000,
    protocol: "PubGsCMoveCard",
    eventType: "card:move",
    skillId: 77,
    skillName: "sample gain",
    categories: ["random.card.gain"],
    actions: ["remove-deck-card-only-if-protocol-lists-id"],
    knownCardIds: [11],
    cardCount: 2,
    manualReview: true,
    legacyHint: "sample"
  };

  await fs.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeJsonl(path.join(runDir, "meta.session.jsonl"), [
    { type: "start", ts: summary.startedAt, durationMs: 1000, intervalMs: 100, snapshotEveryMs: 500, installFirst: true },
    { type: "stop", ts: summary.finishedAt, elapsedMs: 1000, protocolRecords: 2, consoleProtocolRecords: 1, snapshots: 2, reports: 1 }
  ]);
  await writeJsonl(path.join(runDir, "protocol.records.jsonl"), [
    { type: "protocol.record", tick: 1, ts: "2026-07-04T10:00:00.100Z", record: fakeMoveRecord() },
    { type: "protocol.record", tick: 2, ts: "2026-07-04T10:00:00.200Z", record: fakeSkillRecord() }
  ]);
  await writeJsonl(path.join(runDir, "protocol.console.records.jsonl"), [
    { type: "protocol.console.record", tick: 2, ts: "2026-07-04T10:00:00.250Z", record: fakeSkillRecord(1) }
  ]);
  await writeJsonl(path.join(runDir, "snapshots.jsonl"), [
    {
      type: "snapshot",
      tick: 1,
      ts: "2026-07-04T10:00:00.000Z",
      value: { ok: true, snapshot: { visible: false, reason: "no TableGameScene" } }
    },
    {
      type: "snapshot",
      tick: 2,
      ts: "2026-07-04T10:00:00.500Z",
      value: {
        ok: true,
        snapshot: {
          visible: true,
          reason: "",
          knownHandLedger: {
            version: 1,
            rowCount: 1,
            knownCount: 1,
            dirtyRows: [1],
            completeRows: [],
            lastUpdateAt: 1200,
            recentEvents: [
              {
                type: "remove-known",
                seatIndex: 1,
                ids: [11],
                removed: 1,
                reason: "protocol-hand-from-known",
                protocol: "PubGsCMoveCard",
                recordIndex: 7,
                skillId: 77,
                skillName: "sample gain",
                categories: ["random.card.gain", "hand.transfer"]
              },
              {
                type: "invalidate-seat",
                seatIndex: 1,
                reason: "protocol-hand-from-unknown",
                clearKnown: true,
                protocol: "PubGsCMoveCard",
                recordIndex: 7,
                skillId: 77,
                skillName: "sample gain",
                categories: ["random.card.gain", "hand.transfer"]
              }
            ]
          },
          protocolZoneLedger: fakeProtocolZoneLedger(),
          rulePlanner: { recentPlans: [plan] }
        }
      }
    }
  ]);
  await writeJsonl(path.join(runDir, "reports.jsonl"), [
    {
      type: "reports",
      tick: 2,
      ts: "2026-07-04T10:00:00.500Z",
      validation: {
        ok: false,
        status: "failed",
        checks: [
          { id: "protocol.installed", status: "pass", message: "ok" },
          { id: "planner.events", status: "fail", message: "missing planner" }
        ]
      },
      reports: {
        handSourceReport: {
          visible: true,
          mask: {
            rawCount: 1,
            rawProblems: [],
            ledgerCount: 1,
            ledgerProblems: []
          },
          protocolAuthorized: {
            ledgerCount: 1,
            ledgerProblems: [{ seatIndex: 2, id: 12, missing: ["msgId"] }]
          }
        },
        protocolFlowReport: {
          planner: { recentPlans: [plan] },
          protocolZoneLedger: fakeProtocolZoneLedger(),
          problems: [{
            severity: "warn",
            id: "sample-flow-problem",
            message: "sample problem",
            actual: { cardMoves: 1 }
          }]
        }
      }
    }
  ]);
  return { root, runDir };
}

async function main() {
  const command = await import("../src/node/commands/recording-timeline.mjs");
  const analysis = require("../src/node/analysis/recording-timeline.cjs");

  console.log("\nRecording timeline");

  await test("builds old logger style rows from a saved recording", async () => {
    const { runDir } = await createRecordingDir();
    const timeline = await command.buildRecordingTimelineForDir(runDir);
    const text = timeline.text.join("\n");

    assert.equal(timeline.ok, true);
    assert.equal(timeline.recordingDir, path.resolve(runDir));
    assert.equal(timeline.counts.proxyProtocols, 2);
    assert.equal(timeline.counts.consoleProtocols, 1);
    assert.equal(timeline.counts.cardMoves, 1);
    assert.equal(timeline.counts.skillEvents, 3);
    assert.equal(timeline.counts.validationFailures, 1);
    assert.equal(timeline.counts.maskEvents, 1);
    assert.equal(timeline.counts.protocolAuthorizedEvents, 1);
    assert.equal(timeline.counts.knownHandLedgerEvents, 2);
    assert.equal(timeline.counts.protocolZoneEvents, 2);
    assert.equal(timeline.counts.deckEndpointEvents, 2);
    assert.match(text, /proxy card:move PubGsCMoveCard #7/);
    assert.match(text, /1:pile:seat255 -> 5:hand:seat1/);
    assert.match(text, /known=11 unknown=1/);
    assert.match(text, /console skill:use PubGsCUseSpell #1/);
    assert.match(text, /report validation fail planner.events: missing planner/);
    assert.match(text, /report hand-source mask raw=1 ledger=1 problems=0/);
    assert.match(text, /report hand-source protocol-authorized ledger=1 problems=1/);
    assert.match(text, /snapshot visible visible=false reason=no TableGameScene/);
    assert.match(text, /snapshot visible visible=true/);
    assert.match(text, /snapshot known-hand-ledger remove-known seat=1 ids=11 removed=1 reason=protocol-hand-from-known protocol=PubGsCMoveCard record=#7 skill=sample gain\(77\) \[random\.card\.gain,hand\.transfer\]/);
    assert.match(text, /snapshot known-hand-ledger invalidate-seat seat=1 reason=protocol-hand-from-unknown protocol=PubGsCMoveCard record=#7 skill=sample gain\(77\) \[random\.card\.gain,hand\.transfer\] clearKnown=true/);
    assert.match(text, /snapshot protocol-zone moves=1 knownLocations=1 zones=1 deckTop=31,32 deckBottom=- invalidations=0/);
    assert.match(text, /snapshot deck-endpoint set endpoint=top reason=deck\.top\.reveal ids=31,32 unknown=0 record=#7 skill=skill#77\(77\)/);
    assert.match(text, /report protocol-zone moves=1 knownLocations=1 zones=1 deckTop=31,32/);
    assert.equal(timeline.problems.some((problem) => problem.id === "sample-flow-problem"), true);
  });

  await test("reports missing recording directory as not ok", async () => {
    const timeline = await command.buildRecordingTimelineForDir(path.join(os.tmpdir(), "sgs-recording-timeline-missing-dir"));
    assert.equal(timeline.ok, false);
    assert.equal(timeline.problems[0].id, "recording-directory-read-failed");
  });

  await test("analysis accepts in-memory rows", () => {
    const timeline = analysis.buildRecordingTimeline({
      recordingDir: "memory",
      protocolRows: [{ ts: "2026-07-04T10:00:00.100Z", record: fakeMoveRecord() }]
    });
    assert.equal(timeline.ok, true);
    assert.equal(timeline.counts.cardMoves, 1);
    assert.match(timeline.text[0], /proxy card:move/);
  });

  console.log(`\n========================================`);
  console.log(`  Recording timeline 测试: ${passed} 通过, ${failed} 失败`);
  console.log(`========================================`);

  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
