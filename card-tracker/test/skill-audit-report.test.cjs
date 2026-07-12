const assert = require("node:assert/strict");
const { buildMissingGeneralSkillRefReport } = require("../src/node/analysis/skill-audit-report.cjs");

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
    console.error(error.stack || error);
  }
}

console.log("\nSkill audit report");

test("summarizes missing general skill refs by review status", () => {
  const report = buildMissingGeneralSkillRefReport([
    {
      generalId: 6689,
      generalName: "Le Cao Pi",
      className: "LeCaoPi",
      slot: "spellId1",
      skillId: 7110
    },
    {
      generalId: 9999,
      generalName: "Mystery General",
      className: "ShenMiWuJiang",
      slot: "spellId1",
      skillId: 99999,
      hasSpellExtendRows: true
    }
  ]);

  assert.equal(report.ok, true);
  assert.equal(report.counts.total, 2);
  assert.equal(report.counts.unresolved, 1);
  assert.equal(report.counts.placeholderCandidates, 1);
  assert.equal(report.counts.withSpellExtendRows, 1);
  assert.equal(report.bySkillId["7110"], 1);
  assert.equal(report.rows[0].reviewStatus, "needs-config-confirmation");
  assert.equal(report.rows[0].trackerDecision, "no-card-fact-without-cha-spell");
  assert.equal(report.rows[1].reviewStatus, "placeholder-candidate");
  assert.equal(report.rows[1].presentInChaSpell, false);
});

test("handles empty input", () => {
  const report = buildMissingGeneralSkillRefReport([]);
  assert.equal(report.ok, true);
  assert.equal(report.counts.total, 0);
  assert.deepEqual(report.rows, []);
});

if (failed) {
  console.error(`\nSkill audit report 测试: ${passed} 通过, ${failed} 失败`);
  process.exit(1);
}

console.log(`\nSkill audit report 测试: ${passed} 通过, ${failed} 失败`);
