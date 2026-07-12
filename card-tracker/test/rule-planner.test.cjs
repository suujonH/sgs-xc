const assert = require("node:assert/strict");
const { buildRulePlan, makeRulePlanner } = require("../src/runtime/tracker/rule-planner-core.cjs");

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

function skillRule(id, name, categories, confidence = "generic-log-rule") {
  return {
    id,
    name,
    sourceType: "general-skill",
    priority: categories.length ? "tracker-relevant" : "none",
    confidence,
    categories,
    actions: []
  };
}

function record(parsed) {
  return {
    index: 7,
    time: 1234,
    name: parsed.protocol || "PubGsCUseSpell",
    parsed
  };
}

console.log("\nRule planner");

test("skill categories become tracker action plans", () => {
  const plan = buildRulePlan(record({
    type: "skill:use",
    protocol: "PubGsCUseSpell",
    skillId: 304,
    skillRule: skillRule(304, "攻心", ["hand.watch", "hand.show", "deck.top.put"])
  }));
  assert.equal(plan.skillName, "攻心");
  assert.deepEqual(plan.categories, ["hand.watch", "hand.show", "deck.top.put"]);
  assert.ok(plan.actions.includes("record-authorized-hand-snapshot"));
  assert.ok(plan.actions.includes("record-public-reveal"));
  assert.ok(plan.actions.includes("put-known-source-on-deck-top"));
});

test("legacy alias 988 uses current 987 Guanqu rule", () => {
  const plan = buildRulePlan(record({
    type: "skill:use",
    protocol: "PubGsCUseSpell",
    skillId: 988,
    skillRule: skillRule(988, "雅士", [])
  }), {
    skillRuleInfo: (id) => id === 987 ? skillRule(987, "观虚", ["hand.watch", "hand.transfer"]) : null
  });
  assert.equal(plan.skillId, 988);
  assert.equal(plan.effectiveSkillId, 987);
  assert.equal(plan.aliasOf, 987);
  assert.equal(plan.legacyHint, "watch-hand-top-five-exchange");
  assert.ok(plan.actions.includes("record-authorized-hand-snapshot"));
  assert.ok(plan.actions.includes("move-known-hand-card-or-invalidate-count"));
});

test("unknown hand loss is planned as hand-ledger invalidation", () => {
  const plan = buildRulePlan(record({
    type: "card:move",
    protocol: "PubGsCMoveCard",
    cards: [],
    from: { seat: 2, code: 5 },
    to: { seat: 255, code: 2 },
    count: 1
  }));
  assert.ok(plan.actions.includes("invalidate-hand-ledger-seat"));
  assert.ok(plan.actions.includes("maintain-public-discard-subset"));
  assert.equal(plan.zoneActions[0].seat, 2);
});

test("random gain is exact only when protocol lists ids", () => {
  const plan = buildRulePlan(record({
    type: "card:move",
    protocol: "PubGsCMoveCard",
    skillId: 13241,
    skillRule: skillRule(13241, "锦囊流套装", ["random.card.gain"]),
    cards: [{ id: 88 }, { id: 89 }],
    from: { seat: 255, code: 1 },
    to: { seat: 0, code: 5 },
    count: 2
  }));
  assert.ok(plan.actions.includes("record-random-gain-only-if-protocol-lists-id"));
  assert.ok(plan.actions.includes("add-known-to-hand-ledger"));
  assert.deepEqual(plan.knownCardIds, [88, 89]);
});

test("order/source sensitive plans keep compatibility manualReview field", () => {
  const plan = buildRulePlan(record({
    type: "skill:use",
    protocol: "PubGsCUseSpell",
    skillId: 35,
    skillRule: skillRule(35, "观星", ["deck.top.reveal", "deck.top.put", "deck.bottom.put"], "manual-order-or-source-required")
  }));
  assert.equal(plan.orderSourceSensitive, true);
  assert.equal(plan.manualReview, true);
  assert.equal(plan.ruleQueue, "manual-order-or-source");
});

test("planner summary counts categories and actions", () => {
  const planner = makeRulePlanner();
  planner.handleProtocolRecord(record({
    type: "skill:use",
    protocol: "PubGsCUseSpell",
    skillId: 51,
    skillRule: skillRule(51, "天妒", ["judgement.gain", "resolved.card.gain"])
  }));
  const summary = planner.summary();
  assert.equal(summary.handledCount, 1);
  assert.equal(summary.plannedCount, 1);
  assert.equal(summary.categoryCounts["judgement.gain"], 1);
  assert.equal(summary.actionCounts["gain-resolved-judgement-card"], 1);
  assert.equal(summary.recentPlans[0].skillName, "天妒");
});

console.log(`\n========================================`);
console.log(`  Rule planner 测试: ${passed} 通过, ${failed} 失败`);
console.log(`========================================`);

if (failed) process.exit(1);
