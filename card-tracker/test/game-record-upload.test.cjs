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

async function appendJsonl(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function visibleSnapshot() {
  return {
    ok: true,
    snapshot: {
      visible: true,
      selfSeatIndex: 0,
      table: {
        schemaVersion: 1,
        mode: { known: true, candidates: { "manager.model": 27 } },
        seatCount: 2,
        selfSeatIndex: 0,
        allGenerals: [
          { seatIndex: 0, names: ["self"], general: { id: 100, name: "General A" }, relation: { isSelf: true, isFriend: true } },
          { seatIndex: 1, names: ["friend"], general: { id: 101, name: "General B" }, relation: { isFriend: true } }
        ],
        selfGenerals: [
          { seatIndex: 0, names: ["self"], general: { id: 100, name: "General A" } }
        ],
        teammateGenerals: [
          { seatIndex: 1, names: ["friend"], general: { id: 101, name: "General B" } }
        ],
        seats: [
          { seatIndex: 0, isSelf: true, names: ["self"], general: { id: 100, name: "General A" } },
          { seatIndex: 1, isSelf: false, names: ["friend"], general: { id: 101, name: "General B" } }
        ]
      },
      rows: [{
        seatIndex: 1,
        names: ["friend"],
        handCardCount: 3,
        knownCount: 1,
        unknownCount: 2,
        cards: [{ id: 22, name: "Slash", source: { rule: "protocol-authorized-friend-hand" } }],
        candidates: [],
        sources: ["protocol-authorized-friend-hand"]
      }],
      visibleRows: []
    }
  };
}

async function main() {
  const gameRecord = await import("../src/node/commands/game-record-upload.mjs");

  console.log("\nGame record upload");

  await test("builds a replay package with battle metadata and streams", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgs-game-record-"));
    const runDir = path.join(root, "recording-test");
    const paths = {
      metaPath: path.join(runDir, "meta.session.jsonl"),
      protocolRecordsPath: path.join(runDir, "protocol.records.jsonl"),
      protocolConsoleRecordsPath: path.join(runDir, "protocol.console.records.jsonl"),
      snapshotsPath: path.join(runDir, "snapshots.jsonl"),
      reportsPath: path.join(runDir, "reports.jsonl"),
      gameRecordPath: path.join(runDir, "game-record.json"),
      summaryPath: path.join(runDir, "summary.json")
    };
    await appendJsonl(paths.metaPath, [
      { type: "start", ts: "2026-07-09T00:00:00.000Z" },
      { type: "stop", ts: "2026-07-09T00:05:00.000Z", stopReason: "game-over" }
    ]);
    await appendJsonl(paths.protocolRecordsPath, [
      { type: "protocol.record", ts: "2026-07-09T00:04:59.000Z", record: { index: 1, name: "MsgGameOver", parsed: { type: "game:over" } } }
    ]);
    await appendJsonl(paths.protocolConsoleRecordsPath, []);
    await appendJsonl(paths.snapshotsPath, [
      { type: "snapshot", ts: "2026-07-09T00:00:10.000Z", value: visibleSnapshot() }
    ]);
    await appendJsonl(paths.reportsPath, [
      { type: "reports", validation: { ok: true }, reports: {} }
    ]);

    const record = await gameRecord.buildGameRecordPackage({
      runDir,
      paths,
      userId: "tester",
      summary: {
        startedAt: "2026-07-09T00:00:00.000Z",
        finishedAt: "2026-07-09T00:05:00.000Z",
        firstVisibleAt: "2026-07-09T00:00:10.000Z",
        gameOverAt: "2026-07-09T00:04:59.000Z",
        stopReason: "game-over"
      }
    });

    assert.equal(record.schemaVersion, 1);
    assert.equal(record.userId, "tester");
    assert.equal(record.session.uploadAllowed, true);
    assert.equal(record.session.reconnected, false);
    assert.equal(record.battle.gameMode.candidates["manager.model"], 27);
    assert.equal(record.battle.selfGenerals[0].general.id, 100);
    assert.equal(record.battle.teammateGenerals[0].general.id, 101);
    assert.equal(record.battle.knownHands[0].cards[0].source.rule, "protocol-authorized-friend-hand");
    assert.equal(record.streams.protocolRecords.length, 1);
    assert.equal(record.battle.protocolBoundaries.gameOver.name, "MsgGameOver");
  });

  await test("uploads replay package using the API request shape", async () => {
    let posted = null;
    const result = await gameRecord.uploadGameRecordPackage({
      userId: "tester",
      clientSessionId: "recording-test",
      session: { startedAt: "2026-07-09T00:00:00.000Z", finishedAt: "2026-07-09T00:05:00.000Z" },
      battle: { gameMode: { known: false, candidates: {} } }
    }, {
      url: "http://example.test/game-record/save",
      userId: "tester",
      password: "password-uuid",
      apiKey: "secret",
      fetchImpl: async (_url, options) => {
        posted = options;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ recordId: "abc" })
        };
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.response.recordId, "abc");
    assert.equal(posted.method, "POST");
    assert.equal(posted.headers["x-sgs-api-key"], "secret");
    const body = JSON.parse(posted.body);
    assert.equal(body.userId, "tester");
    assert.equal(body.password, "password-uuid");
    assert.equal(body.clientSessionId, "recording-test");
    assert.equal(body.uploadAllowed, true);
    assert.equal(body.reconnected, false);
    assert.equal(body.record.userId, "tester");
  });

  console.log(`\n========================================`);
  console.log(`  Game record upload 测试: ${passed} 通过, ${failed} 失败`);
  console.log(`========================================`);

  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
