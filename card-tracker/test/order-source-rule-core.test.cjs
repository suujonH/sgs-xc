const assert = require("node:assert/strict");
const {
  ORDER_SOURCE_CATEGORY_RULES,
  orderSourceCategoryRule,
  buildOrderSourceSkillRule,
  buildOrderSourceRuleSet
} = require("../src/runtime/tracker/order-source-rule-core.cjs");

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

function skill(id, name, categories, extra = {}) {
  return {
    id,
    name,
    sourceType: extra.sourceType || "general-skill",
    owners: extra.owners || [{ name: "sample general" }],
    ownerCount: Number(extra.ownerCount ?? 1),
    categories: categories.map((item) => ({ id: item })),
    actions: categories.map((item) => `action:${item}`),
    strategy: extra.strategy || { id: "order-or-source-sensitive" },
    confidence: extra.confidence || "manual-order-or-source-required",
    priority: "tracker-relevant",
    reviewReasons: ["manual-order-or-source-required"],
    desc: `${name} desc`
  };
}

console.log("\nOrder/source rule core");

test("defines category-level operate/order objects", () => {
  assert.ok(ORDER_SOURCE_CATEGORY_RULES.length >= 10);
  const bottomPut = orderSourceCategoryRule("deck.bottom.put");
  assert.equal(bottomPut.operate, "deck-endpoint");
  assert.equal(bottomPut.order, "bottom-put-source-order");
  assert.equal(bottomPut.evidenceCheck, "deckEndpoint");
  assert.ok(bottomPut.requiredSources.includes("known source card"));

  const bottomDraw = orderSourceCategoryRule("draw.bottom");
  assert.equal(bottomDraw.operate, "deck-endpoint");
  assert.equal(bottomDraw.order, "consume-bottom-for-draw");
  assert.equal(bottomDraw.plannerAction, "consume-deck-bottom-for-draw");
  assert.ok(bottomDraw.runtimeState.includes("protocolZoneLedger.deckEndpoint.bottom"));
});

test("builds per-skill objects with spellId, operate, order, and operations", () => {
  const rule = buildOrderSourceSkillRule(skill(35, "Guanxing", [
    "deck.top.reveal",
    "deck.top.put",
    "deck.bottom.put"
  ]));

  assert.equal(rule.spellId, 35);
  assert.equal(rule.id, 35);
  assert.equal(rule.name, "Guanxing");
  assert.equal(rule.operate, "deck-endpoint");
  assert.equal(rule.order, "compound");
  assert.equal(rule.primaryOperate, "deck-endpoint");
  assert.equal(rule.primaryOrder, "bottom-put-source-order");
  assert.equal(rule.operations.length, 3);
  assert.equal(rule.mappingComplete, true);
  assert.deepEqual(rule.unmappedCategories, []);
  assert.deepEqual(rule.evidenceChecks, ["deckEndpoint"]);
  assert.ok(rule.requiredSources.includes("protocol-listed-deck-endpoint"));
});

test("includes bottom-draw skills as explicit order/source objects", () => {
  const rule = buildOrderSourceSkillRule(skill(816, "Cunmu", ["draw.bottom"], {
    strategy: { id: "deck-endpoint-tracking" },
    confidence: "log-and-skill-specific"
  }));

  assert.equal(rule.spellId, 816);
  assert.equal(rule.operate, "deck-endpoint");
  assert.equal(rule.order, "consume-bottom-for-draw");
  assert.equal(rule.primaryOrder, "consume-bottom-for-draw");
  assert.equal(rule.operations[0].categoryId, "draw.bottom");
  assert.equal(rule.mappingComplete, true);
});

test("surfaces sensitive categories without operation mapping", () => {
  const rule = buildOrderSourceSkillRule(skill(999, "Needs mapping", ["future.category"]));

  assert.equal(rule.spellId, 999);
  assert.equal(rule.mappingComplete, false);
  assert.deepEqual(rule.unmappedCategories, ["future.category"]);
  assert.deepEqual(rule.operations, []);
});

test("summarizes a generated rule set", () => {
  const report = buildOrderSourceRuleSet([
    skill(35, "Guanxing", ["deck.top.reveal", "deck.top.put", "deck.bottom.put"]),
    skill(816, "Cunmu", ["draw.bottom"], {
      strategy: { id: "deck-endpoint-tracking" },
      confidence: "log-and-skill-specific"
    }),
    skill(781, "Shuffle", ["deck.shuffle"]),
    skill(1, "Sha", [], { strategy: { id: "no-card-fact" }, confidence: "not-relevant" })
  ]);

  assert.equal(report.version, 1);
  assert.equal(report.count, 3);
  assert.equal(report.operateCounts["deck-endpoint"], 5);
  assert.equal(report.orderCounts["consume-bottom-for-draw"], 1);
  assert.equal(report.orderCounts["clear-known-order"], 1);
  assert.equal(report.evidenceCheckCounts.deckEndpoint, 2);
  assert.equal(report.evidenceCheckCounts.deckOrderInvalidation, 1);
  assert.equal(report.mappingIncompleteCount, 0);
  assert.equal(report.rules[0].spellId, 35);
  assert.equal(report.rules[1].spellId, 781);
  assert.equal(report.rules[2].spellId, 816);
});

if (failed) {
  console.error(`\nOrder/source rule core 测试: ${passed} 通过, ${failed} 失败`);
  process.exit(1);
}

console.log(`\nOrder/source rule core 测试: ${passed} 通过, ${failed} 失败`);
