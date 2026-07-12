const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { buildOrderSourceCoverage } = require("../src/node/analysis/order-source-coverage.cjs");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then(() => {
        passed++;
        console.log(`  ✓ ${name}`);
      }).catch((error) => {
        failed++;
        console.error(`  ✗ ${name}`);
        console.error(error.stack || error);
      });
    }
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(error.stack || error);
  }
}

function skill(id, name, categories) {
  return {
    id,
    name,
    sourceType: "general-skill",
    owners: [{ name: `${name} owner` }],
    ownerCount: 1,
    categories: categories.map((item) => ({ id: item })),
    actions: [],
    priority: "tracker-relevant",
    confidence: "manual-order-or-source-required",
    strategy: { id: "order-or-source-sensitive" },
    reviewReasons: ["manual-order-or-source-required"],
    desc: `${name} desc`
  };
}

function observedSkill(id, status, extra = {}) {
  return {
    id,
    spellId: id,
    name: extra.name || `skill ${id}`,
    categories: extra.categories || ["deck.bottom.put"],
    status,
    observed: true,
    observationCount: Number(extra.observationCount || 1),
    evidenceRows: Number(extra.evidenceRows || 0),
    evidenceChecks: extra.evidenceChecks || [{
      key: "deckEndpoint",
      categories: ["deck.bottom.put"],
      requiredSources: ["known source card", "deck bottom endpoint"],
      hasEvidence: status === "ready-for-manual-review",
      evidenceRows: status === "ready-for-manual-review" ? 1 : 0
    }],
    observations: [{ source: "rule-plan", skillId: id, protocol: "PubGsCUseSpell" }]
  };
}

console.log("\nOrder/source coverage");

const asyncTests = [];

asyncTests.push(test("aggregates order/source coverage across recording reports", () => {
  const report = buildOrderSourceCoverage({
    skillAudit: {
      source: "sample",
      generatedAt: "2026-07-04T00:00:00.000Z",
      counts: { totalSkills: 2 },
      skills: [
        skill(35, "Guanxing", ["deck.top.reveal", "deck.bottom.put"]),
        skill(781, "Fuzhu", ["deck.shuffle"])
      ]
    },
    reports: [
      {
        ok: true,
        recordingDir: "recording-a",
        manualOrderSourceReview: {
          observedCount: 1,
          readyForReviewCount: 1,
          missingEvidenceCount: 0,
          notObservedCount: 1,
          observedSkills: [observedSkill(35, "ready-for-manual-review", { name: "Guanxing", evidenceRows: 1 })]
        },
        problems: []
      },
      {
        ok: true,
        recordingDir: "recording-b",
        manualOrderSourceReview: {
          observedCount: 1,
          readyForReviewCount: 0,
          missingEvidenceCount: 1,
          notObservedCount: 1,
          observedSkills: [observedSkill(781, "observed-missing-evidence", { name: "Fuzhu", categories: ["deck.shuffle"] })]
        },
        problems: []
      }
    ]
  });

  assert.equal(report.ok, true);
  assert.equal(report.coverageComplete, false);
  assert.equal(report.counts.queue, 2);
  assert.equal(report.counts.readyForReview, 1);
  assert.equal(report.counts.observedMissingEvidence, 1);
  assert.equal(report.counts.notObserved, 0);
  assert.equal(report.byStatus["ready-for-manual-review"], 1);
  assert.equal(report.byStatus["observed-missing-evidence"], 1);
  assert.equal(report.readyForReview[0].spellId, 35);
  assert.equal(report.observedMissingEvidence[0].spellId, 781);
  assert.equal(report.observedMissingEvidence[0].missingEvidenceRecordings[0].recordingDir, "recording-b");
  assert.equal(report.nextActions[0].id, "record-required-source-evidence");
}));

asyncTests.push(test("reports an empty recording set without losing the queue", () => {
  const report = buildOrderSourceCoverage({
    skillAudit: {
      source: "sample",
      generatedAt: "2026-07-04T00:00:00.000Z",
      counts: { totalSkills: 1 },
      skills: [skill(35, "Guanxing", ["deck.bottom.put"])]
    },
    reports: []
  });

  assert.equal(report.ok, true);
  assert.equal(report.coverageComplete, false);
  assert.equal(report.counts.queue, 1);
  assert.equal(report.counts.notObserved, 1);
  assert.equal(report.problems[0].id, "recordings-empty");
}));

asyncTests.push(test("reports incomplete order/source category mapping as a coverage error", () => {
  const report = buildOrderSourceCoverage({
    skillAudit: {
      source: "sample",
      generatedAt: "2026-07-04T00:00:00.000Z",
      counts: { totalSkills: 1 },
      skills: [skill(999, "Future", ["future.category"])]
    },
    reports: []
  });

  assert.equal(report.ok, false);
  assert.equal(report.counts.mappingIncomplete, 1);
  assert.equal(report.rows[0].mappingComplete, false);
  assert.deepEqual(report.rows[0].unmappedCategories, ["future.category"]);
  assert.equal(report.problems.some((problem) => problem.id === "order-source-rule-mapping-incomplete"), true);
}));

asyncTests.push(test("command helper resolves recording directories", async () => {
  const command = await import("../src/node/commands/order-source-coverage.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgs-order-source-coverage-"));
  const first = path.join(root, "recording-2026-07-04T10-00-00");
  const second = path.join(root, "recording-2026-07-04T10-01-00");
  await fs.mkdir(first);
  await fs.mkdir(second);
  await fs.mkdir(path.join(root, "not-a-recording"));

  const fromRoot = await command.recordingDirs(root);
  assert.deepEqual(fromRoot.dirs, [first, second]);

  const fromRun = await command.recordingDirs(first);
  assert.deepEqual(fromRun.dirs, [first]);
}));

Promise.all(asyncTests).then(() => {
  if (failed) {
    console.error(`\nOrder/source coverage 测试: ${passed} 通过, ${failed} 失败`);
    process.exit(1);
  }
  console.log(`\nOrder/source coverage 测试: ${passed} 通过, ${failed} 失败`);
});
