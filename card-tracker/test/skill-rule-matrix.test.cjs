const assert = require("node:assert/strict");
const { buildSkillRuleMatrix } = require("../src/node/analysis/skill-rule-matrix.cjs");

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

function skill(id, name, strategy, categories, extra = {}) {
  return {
    id,
    name,
    sourceType: extra.sourceType || "general-skill",
    owners: extra.owners || [{ name: "sample general" }],
    categories: categories.map((item) => ({ id: item })),
    confidence: extra.confidence || "generic-log-rule",
    strategy: { id: strategy },
    legacySpecialRule: extra.legacySpecialRule || ""
  };
}

console.log("\nSkill rule matrix");

test("builds a full category matrix with bottom-draw semantics", () => {
  const report = buildSkillRuleMatrix({
    source: "sample",
    generatedAt: "2026-07-04T00:00:00.000Z",
    legacySpecial: [{ spellId: 862, oldHex: "0x35e", currentRule: "number-six-filter", sourceZones: [1, 2], categories: ["deck.search"] }],
    skills: [
      skill(816, "寸目", "deck-endpoint-tracking", ["draw.bottom"], { confidence: "log-and-skill-specific" }),
      skill(35, "观星", "order-or-source-sensitive", ["deck.top.reveal", "deck.top.put", "deck.bottom.put"], { confidence: "manual-order-or-source-required" }),
      skill(1, "杀", "no-card-fact", [])
    ]
  });

  assert.equal(report.counts.totalSkills, 3);
  assert.equal(report.counts.orderSourceSensitive, 2);
  assert.equal(report.counts.orderSourceRuleOperations, 4);
  assert.equal(report.counts.bottomOrShuffle, 2);
  assert.deepEqual(report.boundary.forbiddenSources, ["hidden opponent handCards"]);

  const drawBottom = report.categoryMatrix.find((row) => row.id === "draw.bottom");
  assert.equal(drawBottom.count, 1);
  assert.ok(drawBottom.execution.includes("deck bottom"));
  assert.ok(drawBottom.plannerActions.includes("consume-deck-bottom-for-draw"));
  assert.ok(drawBottom.runtimeState.includes("protocolZoneLedger.deckEndpoint.bottom"));

  const orderSensitive = report.orderSourceSensitiveSkills.find((row) => row.id === 35);
  assert.equal(orderSensitive.id, 35);
  assert.equal(orderSensitive.spellId, 35);
  assert.equal(orderSensitive.operate, "deck-endpoint");
  assert.equal(orderSensitive.order, "compound");
  assert.ok(orderSensitive.categories.includes("deck.bottom.put"));
  assert.equal(report.orderSourceRules.rules.find((row) => row.id === 35).primaryOrder, "bottom-put-source-order");
  assert.equal(report.orderSourceRules.rules.find((row) => row.id === 816).primaryOrder, "consume-bottom-for-draw");

  assert.equal(report.legacyZoneContract.some((row) => row.id === "hidden-hand-boundary"), true);
  assert.equal(report.legacySpecial[0].execution.includes("number-6"), true);
  assert.deepEqual(report.legacySpecial[0].sourceZones, [1, 2]);
});

if (failed) {
  console.error(`\nSkill rule matrix 测试: ${passed} 通过, ${failed} 失败`);
  process.exit(1);
}

console.log(`\nSkill rule matrix 测试: ${passed} 通过, ${failed} 失败`);
