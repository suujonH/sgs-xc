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

async function main() {
  const artifacts = await import("../src/node/commands/capture-artifacts.mjs");

  console.log("\nCapture artifacts");

  await test("derives validation and report sidecar paths", () => {
    const snapshotPath = "E:\\ds-sgs\\Scripts\\captures\\sample-snapshot.json";
    assert.equal(artifacts.validationPathForSnapshot(snapshotPath), "E:\\ds-sgs\\Scripts\\captures\\sample-validation.json");
    assert.deepEqual(artifacts.reportPathsForSnapshot(snapshotPath), {
      handSourceReportPath: "E:\\ds-sgs\\Scripts\\captures\\sample-source-report.json",
      publicZoneReportPath: "E:\\ds-sgs\\Scripts\\captures\\sample-public-zone-report.json",
      legacyComparisonReportPath: "E:\\ds-sgs\\Scripts\\captures\\sample-legacy-comparison-report.json",
      protocolFlowReportPath: "E:\\ds-sgs\\Scripts\\captures\\sample-protocol-flow-report.json"
    });
  });

  await test("writes snapshot, validation, reports, and latest files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sgs-artifacts-"));
    const snapshotPath = path.join(dir, "sample-snapshot.json");
    const value = {
      ok: true,
      snapshot: {
        visible: false,
        rows: [],
        visibleRows: [],
        publicZones: { seats: [] },
        legacyCardTracker: { zoneProjection: null }
      }
    };
    const validation = { ok: true, checks: [] };
    const artifact = await artifacts.writeCaptureArtifactSet(snapshotPath, value, validation, { latestDir: dir });

    const names = (await fs.readdir(dir)).sort();
    assert.deepEqual(names, [
      "latest-legacy-comparison-report.json",
      "latest-protocol-flow-report.json",
      "latest-public-zone-report.json",
      "latest-snapshot.json",
      "latest-source-report.json",
      "latest-validation.json",
      "sample-legacy-comparison-report.json",
      "sample-protocol-flow-report.json",
      "sample-public-zone-report.json",
      "sample-snapshot.json",
      "sample-source-report.json",
      "sample-validation.json"
    ]);
    assert.equal(artifact.validationPath.endsWith("sample-validation.json"), true);
    assert.equal(artifact.handSourceReportPath.endsWith("sample-source-report.json"), true);
    assert.equal(artifact.publicZoneReportPath.endsWith("sample-public-zone-report.json"), true);
    assert.equal(artifact.legacyComparisonReportPath.endsWith("sample-legacy-comparison-report.json"), true);
    assert.equal(artifact.protocolFlowReportPath.endsWith("sample-protocol-flow-report.json"), true);
    assert.equal(artifact.reports.handSourceReport.ok, true);
    assert.equal(artifact.reports.publicZoneReport.ok, true);
    assert.equal(artifact.reports.legacyComparisonReport.ok, true);
    assert.equal(artifact.reports.protocolFlowReport.ok, true);
  });

  await test("compacts report counts for monitor summaries", () => {
    const compact = artifacts.compactReports({
      handSourceReport: {
        ok: true,
        counts: { ledgerKnownCards: 2, rawVisibleCards: 1 },
        mask: { ledgerProblems: [{}] },
        protocolAuthorized: { ledgerProblems: [] }
      },
      publicZoneReport: {
        ok: true,
        counts: { cards: 3 },
        provenance: { problems: [{}] },
        comparisons: [{ status: "match" }, { status: "mismatch" }]
      },
      legacyComparisonReport: {
        ok: true,
        counts: { handComparisons: 2, handMismatches: 1, zoneComparisons: 3, zoneMismatches: 1 }
      },
      protocolFlowReport: {
        ok: true,
        counts: { records: 4, cardMoves: 2, skillEvents: 1, plans: 3, legacyMoves: 2, problems: 1 }
      }
    });
    assert.deepEqual(compact, {
      handSource: {
        ok: true,
        ledgerKnownCards: 2,
        rawVisibleCards: 1,
        maskLedgerProblems: 1,
        protocolAuthorizedProblems: 0
      },
      publicZone: {
        ok: true,
        cards: 3,
        problems: 1,
        comparisons: 2,
        mismatches: 1
      },
      legacyComparison: {
        ok: true,
        handComparisons: 2,
        handMismatches: 1,
        zoneComparisons: 3,
        zoneMismatches: 1
      },
      protocolFlow: {
        ok: true,
        records: 4,
        cardMoves: 2,
        skillEvents: 1,
        plans: 3,
        legacyMoves: 2,
        problems: 1
      }
    });
  });

  console.log(`\n========================================`);
  console.log(`  Capture artifacts 测试: ${passed} 通过, ${failed} 失败`);
  console.log(`========================================`);

  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
