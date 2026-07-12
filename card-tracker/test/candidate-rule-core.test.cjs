const assert = require("node:assert/strict");
const {
  candidateProbabilityRules,
  candidateProbabilityRulesFromCards,
  candidateRulesForText,
  candidateRulesForSkillRule
} = require("../src/runtime/tracker/candidate-rule-core.cjs");

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

function fields(rule) {
  return Object.fromEntries(rule.constraints.map((item) => [item.field, item]));
}

function poolCard(id, name, type, color, number = id) {
  return { id, name, type, color, number };
}

console.log("\nCandidate rule core");

test("extracts direct gain candidate constraints from skill text", () => {
  const rules = candidateRulesForText("出牌阶段，你可以随机获得一张红色锦囊牌。", { skillId: 100 });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].probability, 1);
  assert.equal(rules[0].appliesTo, "to-caster");
  const byField = fields(rules[0]);
  assert.deepEqual(byField.color.values, ["red"]);
  assert.deepEqual(byField.type.values, [3]);
  assert.equal(rules[0].sourceRule, "skill-text-candidate-filter");
});

test("extracts card names and suits from direct selection text", () => {
  const rules = candidateRulesForText("你从牌堆中选择一张红桃【杀】或【桃】获得。", { skillId: 101 });
  assert.equal(rules.length, 1);
  const byField = fields(rules[0]);
  assert.deepEqual(byField.suit.values, [1]);
  assert.deepEqual(byField.name.values, ["杀", "桃"]);
});

test("extracts exact rank but ignores point sum conditions", () => {
  const exact = candidateRulesForText("你可以获得一张点数为六的牌。", { skillId: 102 });
  assert.deepEqual(fields(exact[0]).number.values, [6]);

  const lowRange = candidateRulesForText("你可获得其中点数小于等于8的牌。", { skillId: 1021 });
  assert.deepEqual(fields(lowRange[0]).number.values, [1, 2, 3, 4, 5, 6, 7, 8]);

  const highRange = candidateRulesForText("你可以获得点数不小于J的牌。", { skillId: 1022 });
  assert.deepEqual(fields(highRange[0]).number.values, [11, 12, 13]);

  const sum = candidateRulesForText("随机获得点数之和为36的牌。", { skillId: 103 });
  assert.equal(sum.length, 0);
});

test("does not treat a discard condition as a gained-card candidate", () => {
  const rules = candidateRulesForText("你可以弃置一张红色牌，然后摸一张牌。", { skillId: 104 });
  assert.equal(rules.length, 0);
});

test("does not treat choosing a non-card option as a card candidate", () => {
  const rules = candidateRulesForText("你可以选择一种势力，当此势力角色使用黑色牌指定你为目标后，你摸两张牌。", { skillId: 105 });
  assert.equal(rules.length, 0);
});

test("does not treat conditional gained-card text as a candidate object", () => {
  const equipment = candidateRulesForText("你随机获得一名角色区域里的一张牌，若你获得的是装备牌，你使用之。", { skillId: 106 });
  assert.equal(equipment.length, 0);

  const virtual = candidateRulesForText("你获得判定牌且本回合可以将一张手牌当【决斗】使用。", { skillId: 107 });
  assert.equal(virtual.length, 0);
});

test("does not treat trigger or accumulated gain conditions as new candidates", () => {
  const otherGain = candidateRulesForText("当其他角色获得你的黑色牌时，其不能使用这些牌。", { skillId: 114 });
  assert.equal(otherGain.length, 0);

  const eachGain = candidateRulesForText("其以此法每获得一张红色牌，其下个摸牌阶段摸牌数-1。", { skillId: 115 });
  assert.equal(eachGain.length, 0);

  const accumulated = candidateRulesForText("若你累计获得了至少六张【杀】、伤害锦囊牌和武器牌，你回复1点体力。", { skillId: 116 });
  assert.equal(accumulated.length, 0);
});

test("keeps negated type constraints without adding the positive substring", () => {
  const rules = candidateRulesForText("你可以将一张非装备牌交给一名角色。", { skillId: 108 });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].appliesTo, "from-caster");
  assert.equal(rules[0].order, "skill-text-direct-constraint");
  assert.deepEqual(rules[0].constraints, [{
    field: "type",
    op: "not",
    values: [4],
    label: "非装备牌"
  }]);
});

test("extracts explicit hand-insertion candidates without confusing deck top text", () => {
  const named = candidateRulesForText("每轮开始时，将【赤兔】置入你的手牌最左侧。", { skillId: 126 });
  assert.equal(named.length, 1);
  assert.equal(named[0].order, "skill-text-hand-insertion-constraint");
  assert.equal(named[0].appliesTo, "to-caster");
  assert.deepEqual(fields(named[0]).name.values, ["赤兔"]);

  const bare = candidateRulesForText("锁定技，游戏开始时，你将一张【赤血青锋】置入手牌。", { skillId: 127 });
  assert.equal(bare.length, 1);
  assert.equal(bare[0].order, "skill-text-hand-insertion-constraint");
  assert.equal(bare[0].appliesTo, "any");
  assert.deepEqual(fields(bare[0]).name.values, ["赤血青锋"]);

  const deckTop = candidateRulesForText("你可以将一张黑色锦囊牌置于牌堆顶并令一名有手牌的其他角色选择一项。", { skillId: 128 });
  assert.equal(deckTop.length, 0);
});

test("maps equipment subtype text to conservative equip-type candidates", () => {
  for (const name of ["武器牌", "防具牌", "坐骑牌", "宝物牌"]) {
    const rules = candidateRulesForText(`你可以获得一张${name}。`, { skillId: 109 });
    assert.equal(rules.length, 1, name);
    assert.equal(rules[0].display, "装备牌");
    assert.deepEqual(fields(rules[0]).type.values, [4]);
  }
});

test("extracts draw-card property candidates without treating count basis as drawn-card property", () => {
  const draw = candidateRulesForText("每失去一张红色牌时，你摸一张黑色牌。", { skillId: 110 });
  assert.equal(draw.length, 1);
  assert.deepEqual(fields(draw[0]).color.values, ["black"]);
  assert.equal(draw[0].appliesTo, "to-caster");

  const countBasis = candidateRulesForText("你展示牌堆底三张牌并摸与其中红桃牌数量等量张牌。", { skillId: 111 });
  assert.equal(countBasis.length, 0);
});

test("extracts judgement-result candidates only when the gained card is the judgement card", () => {
  const rules = candidateRulesForText("准备阶段，你可以判定，若结果为黑色，你获得此牌，然后你可以重复此流程。", { skillId: 120 });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].order, "skill-text-judgement-result-pronoun");
  assert.equal(rules[0].appliesTo, "to-caster");
  assert.deepEqual(fields(rules[0]).color.values, ["black"]);

  const topCards = candidateRulesForText("准备阶段，若你已受伤，你可以判定，若结果为黑色，你观看牌堆顶X张牌并令一名角色获得之。", { skillId: 121 });
  assert.equal(topCards.length, 0);
});

test("extracts resolved pronoun gain candidates from discard-pile card text", () => {
  const suit = candidateRulesForText("当其他角色的梅花牌因弃置或判定而置入弃牌堆后，你可以获得其中任意张牌。", { skillId: 122 });
  assert.equal(suit.length, 1);
  assert.equal(suit[0].order, "skill-text-resolved-pronoun-constraint");
  assert.deepEqual(fields(suit[0]).suit.values, [4]);

  const type = candidateRulesForText("出牌阶段限一次，当你使用的锦囊牌置入弃牌堆时，你可以获得之。", { skillId: 123 });
  assert.equal(type.length, 1);
  assert.deepEqual(fields(type[0]).type.values, [3]);

  const name = candidateRulesForText("其他角色出牌阶段限一次，当一张【杀】因弃置置入弃牌堆后，你可以获得之。", { skillId: 124 });
  assert.equal(name.length, 1);
  assert.deepEqual(fields(name[0]).name.values, ["杀"]);
});

test("extracts resolved pronoun candidates from used-card and branch text", () => {
  const used = candidateRulesForText("锁定技，【南蛮入侵】对你无效。当其他角色使用的【南蛮入侵】结算结束后，你获得之。", { skillId: 133 });
  assert.equal(used.length, 1);
  assert.equal(used[0].order, "skill-text-resolved-pronoun-constraint");
  assert.deepEqual(fields(used[0]).name.values, ["南蛮入侵"]);

  const branch = candidateRulesForText("若此牌为：•黑色，其不能使用手牌；•红色，你获得之，然后其回复1点体力。", { skillId: 134 });
  assert.equal(branch.length, 1);
  assert.deepEqual(fields(branch[0]).color.values, ["red"]);

  const equip = candidateRulesForText("若此牌为坐骑牌，你获得之。若为装备牌，改为你获得之。", { skillId: 135 });
  assert.equal(equip.length, 1);
  assert.deepEqual(fields(equip[0]).type.values, [4]);
});

test("extracts non-damage trick pronoun gains as trick-type candidates", () => {
  const rules = candidateRulesForText("当你每回合首次使用非伤害锦囊牌后，你令一名同族角色获得此牌。", { skillId: 136 });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].appliesTo, "any");
  assert.deepEqual(fields(rules[0]).type.values, [3]);
});

test("extracts letter-rank pronoun gains as rank candidates", () => {
  const rules = candidateRulesForText("当你失去装备区里的此牌时，你销毁之并弃置一名角色区域里一张牌，若此牌点数为字母，你获得之。", { skillId: 138 });
  assert.equal(rules.length, 1);
  assert.deepEqual(fields(rules[0]).number.values, [1, 11, 12, 13]);
});

test("extracts remainder candidates as complements of removed revealed cards", () => {
  const suit = candidateRulesForText("摸牌阶段，你亮出牌堆顶三张牌，回复与其中红桃牌数等量的体力，弃置这些红桃牌并获得剩余牌。", { skillId: 129 });
  assert.equal(suit.length, 1);
  assert.equal(suit[0].order, "skill-text-remainder-complement");
  assert.deepEqual(suit[0].constraints, [{
    field: "suit",
    op: "not",
    values: [1],
    label: "非红桃"
  }]);

  const name = candidateRulesForText("你展示两张牌，然后弃置其中的【闪】，你获得剩余牌。", { skillId: 130 });
  assert.equal(name.length, 1);
  assert.equal(name[0].order, "skill-text-remainder-complement");
  assert.deepEqual(name[0].constraints, [{
    field: "name",
    op: "not",
    values: ["闪"],
    label: "非闪"
  }]);
});

test("keeps negated suit and color constraints without adding positive substrings", () => {
  const suit = candidateRulesForText("你可以获得其中的非红桃牌。", { skillId: 131 });
  assert.equal(suit.length, 1);
  assert.deepEqual(suit[0].constraints, [{
    field: "suit",
    op: "not",
    values: [1],
    label: "非红桃"
  }]);

  const color = candidateRulesForText("你可以摸一张非黑色牌。", { skillId: 132 });
  assert.equal(color.length, 1);
  assert.deepEqual(color[0].constraints, [{
    field: "color",
    op: "not",
    values: ["black"],
    label: "非黑色"
  }]);
});

test("does not collapse mixed alternative resolved cards into a false single candidate", () => {
  const rules = candidateRulesForText("每回合首次【决斗】或红色【杀】因弃置进入弃牌堆后，你可以获得之。", { skillId: 125 });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].constraints.length, 0);
  assert.equal(rules[0].probability, 0);
  assert.equal(rules[0].alternatives.length, 2);
  assert.deepEqual(rules[0].alternatives[0].constraints.map((item) => item.field), ["name"]);
  assert.deepEqual(rules[0].alternatives[1].constraints.map((item) => item.field).sort(), ["color", "name"]);

  const branch = candidateRulesForText("当你的判定牌生效后，若此牌为【杀】或伤害锦囊牌，你可以获得之。", { skillId: 137 });
  assert.equal(branch.length, 1);
  assert.equal(branch[0].constraints.length, 0);
  assert.equal(branch[0].probability, 0);
  assert.equal(branch[0].alternatives.length, 2);

  const effective = candidateRulesForText("以你为目标的【杀】或锦囊牌生效前，对此牌使用。抵消并获得此牌。", { skillId: 140 });
  assert.equal(effective.length, 1);
  assert.equal(effective[0].alternatives.length, 2);
});

test("derives 75 percent guesses from mixed-field alternative candidates", () => {
  const [base] = candidateRulesForText("当你的判定牌生效后，若此牌为【杀】或伤害锦囊牌，你可以获得之。", { skillId: 139 });
  const rules = candidateProbabilityRules(base, [
    poolCard(1, "杀", 1, 1),
    poolCard(2, "南蛮入侵", 3, 2),
    poolCard(3, "决斗", 3, 3),
    poolCard(4, "顺手牵羊", 3, 4),
    poolCard(5, "闪", 1, 1)
  ], { minProbability: 0.75 });

  const typeRule = rules.find((rule) => fields(rule).type);
  assert.equal(typeRule.probability, 0.75);
  assert.equal(typeRule.poolSize, 4);
  assert.equal(typeRule.hitCount, 3);
  assert.equal(typeRule.baseDisplay, "杀 / 锦囊牌");
  assert.deepEqual(fields(typeRule).type.values, [3]);
});

test("splits each-one same-field candidates into separate one-count rules", () => {
  const rules = candidateRulesForText("摸牌阶段，你可以改为从牌堆获得红牌和黑牌各一张。", { skillId: 112 });
  assert.equal(rules.length, 2);
  assert.deepEqual(rules.map((rule) => fields(rule).color.values[0]).sort(), ["black", "red"]);
  assert.deepEqual(rules.map((rule) => rule.count), [1, 1]);
  assert.equal(rules.every((rule) => rule.order === "skill-text-each-direct-constraint"), true);

  const differentColors = candidateRulesForText("结束阶段，你可以获得其中颜色不同的牌各一张。", { skillId: 113 });
  assert.equal(differentColors.length, 2);
  assert.deepEqual(differentColors.map((rule) => fields(rule).color.values[0]).sort(), ["black", "red"]);
  assert.deepEqual(differentColors.map((rule) => rule.count), [1, 1]);
  assert.equal(differentColors.every((rule) => rule.order === "skill-text-each-direct-constraint"), true);
});

test("splits every-suit and every-type gain text into one-count candidates", () => {
  const suits = candidateRulesForText("你可以获得每种花色的牌各一张。", { skillId: 117 });
  assert.equal(suits.length, 4);
  assert.deepEqual(suits.map((rule) => fields(rule).suit.values[0]).sort(), [1, 2, 3, 4]);
  assert.deepEqual(suits.map((rule) => rule.count), [1, 1, 1, 1]);
  assert.equal(suits.every((rule) => rule.order === "skill-text-each-direct-constraint"), true);

  const types = candidateRulesForText("你获得牌堆中三种类型的牌各一张。", { skillId: 118 });
  assert.equal(types.length, 3);
  assert.deepEqual(types.map((rule) => fields(rule).type.values[0]).sort(), [1, 3, 4]);
  assert.deepEqual(types.map((rule) => rule.count), [1, 1, 1]);
});

test("splits direct different-suit gain while leaving dynamic suit comparisons unexpanded", () => {
  const rules = candidateRulesForText("你可以从牌堆获得不同花色的牌各一张。", { skillId: 119 });
  assert.equal(rules.length, 4);
  assert.deepEqual(rules.map((rule) => fields(rule).suit.values[0]).sort(), [1, 2, 3, 4]);
  assert.deepEqual(rules.map((rule) => rule.count), [1, 1, 1, 1]);

  const dynamic = candidateRulesForText("你可以获得其中不同花色的牌各一张。", { skillId: 120 });
  assert.equal(dynamic.length, 0);

  const compared = candidateRulesForText("你可以从牌堆中获得与弃置牌花色不同的牌各一张。", { skillId: 121 });
  assert.equal(compared.length, 0);
});

test("maps slash-separated equipment subtype lists to conservative equip-type candidates", () => {
  const rules = candidateRulesForText("你可以获得一张武器/防具/宝物牌。", { skillId: 113 });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].display, "装备牌");
  assert.deepEqual(fields(rules[0]).type.values, [4]);
});

test("keeps legacy special candidate rules available through the unified entry", () => {
  const rules = candidateRulesForSkillRule({ id: 862, name: "候选过滤" });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].sourceRule, "legacy-special-candidate-filter");
  assert.deepEqual(rules[0].constraints[0].values, [6]);
  assert.deepEqual(rules[0].sourceZones, [1, 2]);
});

test("stacks legacy, explicit, and skill-text candidate rules through the unified entry", () => {
  const rules = candidateRulesForSkillRule({
    id: 862,
    name: "候选过滤",
    desc: "你可以获得一张红色牌。",
    candidateRules: [{
      probability: 1,
      display: "锦囊牌",
      sourceRule: "manual-candidate-filter",
      constraints: [{ field: "type", values: [3], label: "锦囊牌" }]
    }]
  });

  const numberRule = rules.find((rule) => rule.sourceRule === "legacy-special-candidate-filter");
  const typeRule = rules.find((rule) => rule.sourceRule === "manual-candidate-filter");
  const colorRule = rules.find((rule) => rule.sourceRule === "skill-text-candidate-filter");
  assert.equal(rules.length, 3);
  assert.deepEqual(fields(numberRule).number.values, [6]);
  assert.deepEqual(fields(typeRule).type.values, [3]);
  assert.deepEqual(fields(colorRule).color.values, ["red"]);
});

test("derives 75 percent name guesses from a constrained card pool", () => {
  const [base] = candidateRulesForText("你可以获得一张【杀】或【闪】。", { skillId: 201 });
  const rules = candidateProbabilityRules(base, [
    poolCard(1, "杀", 1, 1),
    poolCard(2, "杀", 1, 2),
    poolCard(3, "杀", 1, 3),
    poolCard(4, "闪", 1, 4)
  ], { minProbability: 0.75 });

  const nameRule = rules.find((rule) => fields(rule).name);
  assert.equal(nameRule.sourceRule, "candidate-pool-probability");
  assert.equal(nameRule.probability, 0.75);
  assert.equal(nameRule.poolSize, 4);
  assert.equal(nameRule.hitCount, 3);
  assert.deepEqual(fields(nameRule).name.values, ["杀"]);
});

test("derives 75 percent guesses directly from a possible-card set", () => {
  const rules = candidateProbabilityRulesFromCards([
    poolCard(1, "杀", 1, 1),
    poolCard(2, "杀", 1, 2),
    poolCard(3, "杀", 1, 3),
    poolCard(4, "闪", 1, 4)
  ], {
    minProbability: 0.75,
    sourceRule: "legacy-zone-candidate-group",
    legacySource: "legacy-card-zone",
    legacyKey: -1,
    zoneKey: "5-1",
    possibleIds: [1, 2, 3, 4]
  });

  const nameRule = rules.find((rule) => fields(rule).name);
  assert.equal(nameRule.sourceRule, "legacy-zone-candidate-group");
  assert.equal(nameRule.probability, 0.75);
  assert.equal(nameRule.poolSize, 4);
  assert.equal(nameRule.hitCount, 3);
  assert.equal(nameRule.legacyKey, -1);
  assert.equal(nameRule.zoneKey, "5-1");
  assert.deepEqual(nameRule.possibleIds, [1, 2, 3, 4]);
  assert.deepEqual(fields(nameRule).name.values, ["杀"]);
});

test("derives field guesses from direct type constraints", () => {
  const rules = candidateProbabilityRules({
    probability: 1,
    display: "基本牌",
    constraints: [{ field: "type", values: [1], label: "基本牌" }]
  }, [
    poolCard(1, "杀", 1, 1),
    poolCard(2, "杀", 1, 2),
    poolCard(3, "桃", 1, 1),
    poolCard(4, "闪", 1, 4),
    poolCard(5, "过河拆桥", 3, 3)
  ], { minProbability: 0.75 });

  assert.equal(rules.length, 1);
  assert.equal(rules[0].display, "红色");
  assert.equal(rules[0].probability, 0.75);
  assert.deepEqual(fields(rules[0]).color.values, ["red"]);
});

test("treats same-field candidate alternatives as an OR pool", () => {
  const rules = candidateProbabilityRules({
    probability: 1,
    display: "锦囊牌 / 装备牌",
    constraints: [
      { field: "type", values: [3], label: "锦囊牌" },
      { field: "type", values: [4], label: "装备牌" }
    ]
  }, [
    poolCard(1, "无中生有", 3, 1),
    poolCard(2, "过河拆桥", 3, 2),
    poolCard(3, "顺手牵羊", 3, 3),
    poolCard(4, "诸葛连弩", 4, 4),
    poolCard(5, "杀", 1, 1)
  ], { minProbability: 0.75 });

  const typeRule = rules.find((rule) => fields(rule).type);
  assert.equal(typeRule.probability, 0.75);
  assert.equal(typeRule.poolSize, 4);
  assert.equal(typeRule.hitCount, 3);
  assert.deepEqual(fields(typeRule).type.values, [3]);
});

test("does not derive guesses below the configured threshold", () => {
  const rules = candidateProbabilityRules({
    probability: 1,
    display: "基本牌/锦囊牌",
    constraints: [{ field: "type", values: [1, 3], label: "基本牌/锦囊牌" }]
  }, [
    poolCard(1, "杀", 1, 1),
    poolCard(2, "桃", 1, 2),
    poolCard(3, "无中生有", 3, 3),
    poolCard(4, "过河拆桥", 3, 4)
  ], { minProbability: 0.75 });

  assert.equal(rules.length, 0);
});

test("uses negated constraints before deriving probability guesses", () => {
  const rules = candidateProbabilityRules({
    probability: 1,
    display: "非装备牌",
    constraints: [{ field: "type", op: "not", values: [4], label: "非装备牌" }]
  }, [
    poolCard(1, "杀", 1, 1),
    poolCard(2, "闪", 1, 2),
    poolCard(3, "桃", 1, 1),
    poolCard(4, "无中生有", 3, 3),
    poolCard(5, "诸葛连弩", 4, 4)
  ], { minProbability: 0.75 });

  assert.equal(rules.some((rule) => fields(rule).type?.values?.[0] === 1), true);
});

test("derives guesses after negated suit constraints narrow the pool", () => {
  const [base] = candidateRulesForText("你可以获得其中的非红桃牌。", { skillId: 202 });
  const rules = candidateProbabilityRules(base, [
    { id: 1, name: "桃", type: 1, suit: 1 },
    { id: 2, name: "杀", type: 1, suit: 2 },
    { id: 3, name: "杀", type: 1, suit: 3 },
    { id: 4, name: "杀", type: 1, suit: 4 },
    { id: 5, name: "闪", type: 1, suit: 2 }
  ], { minProbability: 0.75 });

  const nameRule = rules.find((rule) => fields(rule).name);
  assert.equal(nameRule.probability, 0.75);
  assert.equal(nameRule.poolSize, 4);
  assert.equal(nameRule.hitCount, 3);
  assert.deepEqual(fields(nameRule).name.values, ["杀"]);
});

console.log(`\n========================================`);
console.log(`  Candidate rule core 测试: ${passed} 通过, ${failed} 失败`);
console.log(`========================================`);

if (failed) process.exit(1);
