const assert = require("node:assert/strict");
const {
  categoriesForText,
  priorityOf,
  confidenceOf,
  strategyOf,
  reviewReasonsOf,
  legacySpecialById
} = require("../src/runtime/tracker/skill-rule-core.cjs");
const {
  legacySpecialForSkill,
  legacySpecialsForOperate,
  shouldReversePileExtraction,
  shouldApplyCandidateFilter,
  candidateRuleForSkill
} = require("../src/runtime/tracker/legacy-special-skill-core.cjs");

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

console.log("\nSkill rule core");

test("classifies Gongxin as watch, show, discard, and deck-top put", () => {
  const text = "攻心 出牌阶段限一次，你可以观看一名其他角色的手牌，然后你可以展示其中一张红桃牌并选择一项：1.弃置此牌；2.将此牌置于牌堆顶。";
  const categories = categoriesForText(text);
  const ids = categories.map((item) => item.id);
  assert.deepEqual(ids, ["hand.watch", "hand.show", "hand.discard", "deck.top.put"]);
  const priority = priorityOf(ids);
  const confidence = confidenceOf(categories);
  assert.equal(priority, "tracker-relevant");
  assert.equal(confidence, "generic-log-rule");
  assert.equal(strategyOf(ids, priority, confidence).id, "deck-endpoint-tracking");
  assert.deepEqual(reviewReasonsOf(ids, "general-skill", confidence), [
    "category:hand.watch",
    "category:hand.show",
    "category:deck.top.put"
  ]);
});

test("keeps old spell branch objects mapped to current rule names", () => {
  assert.equal(legacySpecialById.get(0x3db).currentRule, "watch-hand-top-five-exchange");
  assert.equal(legacySpecialById.get(0x3dc).currentRule, "alias-watch-hand-top-five-exchange");
  assert.equal(legacySpecialById.get(0x3db).zoneRemove.order, "reverse-pile-extraction");
  assert.equal(legacySpecialById.get(0x3dc).zoneRemove.order, "reverse-pile-extraction");
  assert.equal(legacySpecialById.get(0xda0).currentRule, "random-hand-reveal-slash-exchange");
  assert.equal(legacySpecialById.get(0xda0).operate, "candidate-filter");
  assert.deepEqual(legacySpecialById.get(0xda0).sourceZones, [1, 2]);
  assert.equal(legacySpecialById.get(0xda0).candidate.constraints[0].field, "name");
  assert.equal(legacySpecialById.get(0x35e).currentRule, "number-six-filter");
  assert.deepEqual(legacySpecialById.get(0x35e).sourceZones, [1, 2]);
  assert.equal(legacySpecialById.get(0x35e).candidate.constraints[0].field, "number");
  assert.equal(legacySpecialById.get(0x2b60).currentRule, "not-present-in-current-skill-catalog");
  assert.deepEqual(legacySpecialById.get(0x2b60).sourceZones, [1, 2]);
});

test("legacy special definitions are queried by operation and current skill id", () => {
  assert.equal(legacySpecialForSkill(3488).spellId, 0xda0);
  assert.equal(legacySpecialForSkill(862).spellId, 0x35e);
  assert.equal(shouldReversePileExtraction(3208), true);
  assert.equal(shouldReversePileExtraction(0xc88), true);
  assert.equal(shouldReversePileExtraction(987), true);
  assert.equal(shouldReversePileExtraction(988), true);
  assert.equal(shouldApplyCandidateFilter(3488), true);
  assert.equal(shouldApplyCandidateFilter(0xda0), true);
  assert.equal(candidateRuleForSkill(3488).constraints[0].field, "name");
  assert.deepEqual(candidateRuleForSkill(3488).sourceZones, [1, 2]);
  assert.equal(candidateRuleForSkill(862).constraints[0].field, "number");
  assert.deepEqual(candidateRuleForSkill(862).sourceZones, [1, 2]);
  assert.deepEqual(
    legacySpecialsForOperate("candidate-filter").map((item) => item.spellId).sort((a, b) => a - b),
    [0x35e, 0xda0, 0x2b60].sort((a, b) => a - b)
  );
});

if (failed) {
  console.error(`\nSkill rule core 测试: ${passed} 通过, ${failed} 失败`);
  process.exit(1);
}

console.log(`\nSkill rule core 测试: ${passed} 通过, ${failed} 失败`);
