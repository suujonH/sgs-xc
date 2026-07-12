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

async function readJsonl(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function snapshot(recordIndexes, consoleRecordIndexes = []) {
  return {
    ok: true,
    snapshot: {
      visible: false,
      reason: "TableGameScene not visible",
      protocol: {
        counts: { PubGsCMoveCard: recordIndexes.length },
        records: recordIndexes.map((index) => ({
          index,
          time: 1000 + index,
          name: "PubGsCMoveCard",
          parsed: {
            type: "card:move",
            protocol: "PubGsCMoveCard",
            cards: [{ id: 10 + index }],
            from: { code: 1, seat: 255 },
            to: { code: 5, seat: 0 },
            count: 1
          }
        })),
        consoleCounts: { PubGsCUseSpell: consoleRecordIndexes.length },
        consoleRecords: consoleRecordIndexes.map((index) => ({
          index,
          time: 2000 + index,
          name: "PubGsCUseSpell",
          source: "console",
          parsed: {
            type: "skill:use",
            protocol: "PubGsCUseSpell",
            skillId: 300 + index
          }
        })),
        recentSkillEvents: []
      },
      rows: [],
      publicZones: { seats: [] },
      legacyCardTracker: { moveCount: recordIndexes.length },
      rulePlanner: { recentPlans: [] }
    }
  };
}

async function main() {
  const recording = await import("../src/node/commands/recording-session.mjs");

  console.log("\nRecording session");

  await test("deduplicates retained protocol records by monotonic index", () => {
    const seen = new Set();
    assert.deepEqual(recording.newProtocolRecords(snapshot([1, 2]).snapshot, seen).map((row) => row.index), [1, 2]);
    assert.deepEqual(recording.newProtocolRecords(snapshot([2, 3]).snapshot, seen).map((row) => row.index), [3]);
    const seenConsole = new Set();
    assert.deepEqual(recording.newProtocolConsoleRecords(snapshot([], [1, 2]).snapshot, seenConsole).map((row) => row.index), [1, 2]);
    assert.deepEqual(recording.newProtocolConsoleRecords(snapshot([], [2, 3]).snapshot, seenConsole).map((row) => row.index), [3]);
    assert.equal(recording.protocolRecordKey({ index: 8 }), "index:8");
  });

  await test("writes JSONL protocol records, snapshots, reports, and summary", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sgs-recording-"));
    const runDir = path.join(dir, "recording-test");
    const values = [snapshot([1], [1]), snapshot([1, 2], [1, 2]), snapshot([2, 3], [2, 3])];
    let readCount = 0;
    const summary = await recording.recordRuntimeSession({
      runDir,
      durationMs: 120,
      intervalMs: 1,
      snapshotEveryMs: 10,
      installFirst: true,
      installRuntimeImpl: async () => ({ target: { id: "target-1", title: "SGS", url: "https://web.sanguosha.com" } }),
      readRuntimeSnapshotImpl: async () => values[Math.min(readCount++, values.length - 1)],
      validateSnapshotValue: () => ({ ok: true, checks: [] }),
      validationOptions: () => ({}),
      buildCaptureReports: () => ({
        handSourceReport: { ok: true },
        publicZoneReport: { ok: true },
        legacyComparisonReport: { ok: true },
        protocolFlowReport: { ok: true }
      })
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.installTarget.id, "target-1");
    assert.equal(summary.protocolRecords, 3);
    assert.equal(summary.consoleProtocolRecords, 3);
    assert.equal(summary.snapshots > 0, true);
    assert.equal(summary.reports, summary.snapshots);

    const paths = recording.recordingPaths(runDir);
    const meta = await readJsonl(paths.metaPath);
    const protocol = await readJsonl(paths.protocolRecordsPath);
    const protocolConsole = await readJsonl(paths.protocolConsoleRecordsPath);
    const snapshots = await readJsonl(paths.snapshotsPath);
    const reports = await readJsonl(paths.reportsPath);
    const savedSummary = JSON.parse(await fs.readFile(paths.summaryPath, "utf8"));

    assert.equal(meta[0].type, "start");
    assert.equal(meta.at(-1).type, "stop");
    assert.deepEqual(protocol.map((row) => row.record.index), [1, 2, 3]);
    assert.deepEqual(protocolConsole.map((row) => row.record.index), [1, 2, 3]);
    assert.equal(snapshots.every((row) => row.type === "snapshot"), true);
    assert.equal(reports.every((row) => row.type === "reports"), true);
    assert.equal(savedSummary.protocolRecords, 3);
    assert.equal(savedSummary.consoleProtocolRecords, 3);
    assert.equal(typeof savedSummary.gameRecordPath, "string");
  });

  await test("stops on game over and uploads the replay package", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sgs-recording-"));
    const runDir = path.join(dir, "recording-game-over");
    const first = snapshot([]);
    const over = snapshot([1]);
    over.snapshot.protocol.records[0].name = "MsgGameOver";
    over.snapshot.protocol.records[0].parsed = {
      type: "game:over",
      protocol: "MsgGameOver"
    };
    const values = [first, over, snapshot([2])];
    let readCount = 0;
    let uploadedRecord = null;
    const summary = await recording.recordRuntimeSession({
      runDir,
      durationMs: 1000,
      intervalMs: 1,
      snapshotEveryMs: 10,
      installFirst: false,
      stopOnGameOver: true,
      uploadUrl: "http://example.test/game-record/save",
      userId: "tester",
      uploadGameRecordPackageImpl: async (record, options) => {
        uploadedRecord = { record, options };
        return { ok: true, status: 200, response: { recordId: "saved" } };
      },
      readRuntimeSnapshotImpl: async () => values[Math.min(readCount++, values.length - 1)],
      validateSnapshotValue: () => ({ ok: true, checks: [] }),
      validationOptions: () => ({}),
      buildCaptureReports: () => ({
        handSourceReport: { ok: true },
        publicZoneReport: { ok: true },
        legacyComparisonReport: { ok: true },
        protocolFlowReport: { ok: true }
      })
    });

    assert.equal(summary.stopReason, "game-over");
    assert.equal(summary.gameOverAt.length > 0, true);
    assert.equal(summary.protocolRecords, 1);
    assert.equal(summary.upload.ok, true);
    assert.equal(uploadedRecord.options.url, "http://example.test/game-record/save");
    assert.equal(uploadedRecord.record.userId, "tester");
    assert.equal(uploadedRecord.record.battle.protocolBoundaries.gameOver.name, "MsgGameOver");
    await fs.access(recording.recordingPaths(runDir).gameRecordPath);
  });

  await test("marks visible-at-install sessions as reconnected and skips upload", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sgs-recording-"));
    const runDir = path.join(dir, "recording-reconnected");
    let uploadCalls = 0;
    let configured = null;
    const summary = await recording.recordRuntimeSession({
      runDir,
      durationMs: 20,
      intervalMs: 1,
      snapshotEveryMs: 10,
      installFirst: true,
      uploadUrl: "http://example.test/game-record/save",
      userId: "tester",
      password: "password-uuid",
      installRuntimeImpl: async () => ({
        target: { id: "target-1", title: "SGS", url: "https://web.sanguosha.com" },
        value: { visible: true }
      }),
      configureRuntimeRecordingImpl: async (config) => {
        configured = config;
        return { ok: true, state: config };
      },
      uploadGameRecordPackageImpl: async () => {
        uploadCalls++;
        return { ok: true };
      },
      readRuntimeSnapshotImpl: async () => snapshot([]),
      validateSnapshotValue: () => ({ ok: true, checks: [] }),
      validationOptions: () => ({}),
      buildCaptureReports: () => ({
        handSourceReport: { ok: true },
        publicZoneReport: { ok: true },
        legacyComparisonReport: { ok: true },
        protocolFlowReport: { ok: true }
      })
    });

    assert.equal(summary.uploadAllowed, false);
    assert.equal(summary.reconnected, true);
    assert.equal(summary.uploadBlockedReason, "visible-at-install");
    assert.equal(summary.upload.skipped, true);
    assert.equal(summary.upload.reason, "visible-at-install");
    assert.equal(uploadCalls, 0);
    assert.equal(configured.uploadAllowed, false);
    assert.equal(configured.reconnected, true);
    await fs.access(recording.recordingPaths(runDir).gameRecordPath);
  });

  console.log(`\n========================================`);
  console.log(`  Recording session 测试: ${passed} 通过, ${failed} 失败`);
  console.log(`========================================`);

  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
