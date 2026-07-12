const assert = require("node:assert/strict");
const {
  tableRows,
  cardSpellId,
  legacyType,
  buildCardDict,
  buildGameRuleDecks,
  buildSpellDict,
  isRealGeneral,
  generalName,
  rowSearchText,
  buildSkillOwners,
  buildSkillExtends,
  sourceTypeFor
} = require("../src/runtime/sources/config-table-core.cjs");

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

console.log("\nConfig table core");

test("expands abbreviated table rows", () => {
  const data = {
    abbreviation: [
      { Short: "a", Long: "id" },
      { Short: "b", Long: "name" }
    ],
    GameCharacters: {
      character: [{ a: 10, b: "诸葛亮" }]
    }
  };
  assert.deepEqual(tableRows(data, "GameCharacters", "character"), [{ id: 10, name: "诸葛亮" }]);
});

test("uses sys_playcard spellId rather than the unrelated imageId for skill identity", () => {
  const data = {
    abbreviation: [
      { Short: "a", Long: "id" },
      { Short: "b", Long: "name" },
      { Short: "m", Long: "spellId" },
      { Short: "n", Long: "imageId" }
    ],
    GamePlayCards: {
      card: [
        { a: 31020, b: "浑天仪", m: 3697, n: 1135 },
        { a: 320, b: "赤血青锋", m: 1135 }
      ]
    }
  };
  const rows = tableRows(data, "GamePlayCards", "card");
  assert.equal(cardSpellId(rows[0]), 3697);
  assert.equal(rows[0].imageId, 1135);
  assert.deepEqual(new Set(rows.map(cardSpellId)), new Set([3697, 1135]));
  assert.equal(sourceTypeFor(1135, [], new Set(rows.map(cardSpellId))), "play-card");
});

test("filters real generals and excludes card display rows", () => {
  const general = {
    id: 1,
    name: "吕蒙",
    Class: "LvMeng",
    hp: 4,
    country: 2,
    gender: 1,
    GeneralEnable: 1
  };
  const cardDisplay = { ...general, id: 2, Class: "SlashPoker", exType: 55 };
  assert.equal(isRealGeneral(general), true);
  assert.equal(isRealGeneral(cardDisplay), false);
});

test("builds skill owners and spell extension groups", () => {
  const rows = [
    {
      id: 202,
      name: "吕蒙",
      ai: "神",
      Class: "LvMengShen",
      hp: 3,
      country: 2,
      gender: 1,
      GeneralEnable: 1,
      spellId1: 303,
      spellId2: 304
    },
    {
      id: 9001,
      name: "Card",
      Class: "CardPoker",
      exType: 55,
      hp: 1,
      country: 1,
      gender: 1,
      GeneralEnable: 1,
      spellId1: 304
    }
  ];
  const { realGenerals, skillOwners } = buildSkillOwners(rows);
  assert.equal(realGenerals.length, 1);
  assert.equal(generalName(realGenerals[0]), "神吕蒙");
  assert.deepEqual(skillOwners.get(304).map((owner) => owner.name), ["神吕蒙"]);
  assert.equal(sourceTypeFor(304, skillOwners.get(304), new Set()), "general-skill");
  assert.equal(sourceTypeFor(6003, [], new Set([6003])), "play-card");
  assert.equal(sourceTypeFor(21098, [], new Set()), "mode-or-system");

  const extendsBySkill = buildSkillExtends([{ spellId: 304, value: "a" }, { SpellId: 304, value: "b" }]);
  assert.equal(extendsBySkill.get(304).length, 2);
});

test("builds plain searchable text from config rows", () => {
  assert.equal(rowSearchText({ name: "<b>攻心</b>", desc: "观看&nbsp;手牌", ignored: null }), "攻心 观看 手牌");
});

test("keeps legacy card type mapping", () => {
  assert.equal(legacyType(1), 1);
  assert.equal(legacyType(2), 3);
  assert.equal(legacyType(3), 4);
  assert.equal(legacyType("4"), 4);
});

test("builds spell dictionary and mark spell index", () => {
  const { spellDict, markSpell } = buildSpellDict([
    { spellid: 304, H5_name: "<b>攻心</b>", Class: "GongXin", desc: "观看目标角色的手牌", dmgSpell: 1, Properties: "Huo,Lei" },
    { SpellId: 7001, name: "乐不思蜀", Description: "将此牌置于目标角色判定区" }
  ]);

  assert.deepEqual(spellDict[304], {
    id: 304,
    name: "攻心",
    desc: "观看目标角色的手牌",
    className: "GongXin",
    isDamageCard: true,
    properties: ["Huo", "Lei"]
  });
  assert.equal(markSpell[7001], "乐不思蜀");
});

test("builds card dictionary with display fields and semantic spell traits", () => {
  const spellDict = { 1001: { id: 1001, name: "杀", desc: "", className: "Sha", isDamageCard: true, properties: ["Huo"] } };
  const { cardDict, cardIDsOrder } = buildCardDict(
    [
      { id: 1, spellId: 1001, color: 3, number: 1, type: 1, subType: 0 },
      { CardID: 2, SpellID: 1002, Name: "<b>过河拆桥</b>", color: 2, number: 12, type: 2, subType: 5 }
    ],
    spellDict
  );

  assert.deepEqual(cardIDsOrder, [1, 2]);
  assert.equal(cardDict[1].name, "杀");
  assert.equal(cardDict[1].ncn, "杀♠A");
  assert.equal(cardDict[1].cn, "杀");
  assert.equal(cardDict[1].colorSym, "♠");
  assert.equal(cardDict[1].numStr, "A");
  assert.equal(cardDict[1].typeOriginal, 1);
  assert.equal(cardDict[1].type, 1);
  assert.equal(cardDict[1].isDamageCard, true);
  assert.equal(cardDict[1].spellClass, "Sha");
  assert.deepEqual(cardDict[1].spellProperties, ["Huo"]);
  assert.ok(cardDict[1].semanticTraits.includes("damage-card"));
  assert.equal(cardDict[2].name, "过河拆桥");
  assert.equal(cardDict[2].ncn, "过河拆桥♦Q");
  assert.equal(cardDict[2].typeOriginal, 2);
  assert.equal(cardDict[2].type, 3);
  assert.equal(cardDict[2].isDelayedTrick, true);
  assert.equal(cardDict[2].isOrdinaryTrick, false);
});

test("resolves explicit game-rule piles and the current rank standard deck", () => {
  const data = {
    Root: {
      LogicRuleConfig: {
        GameRule: [
          {
            _attributes: { RuleId: 22, Desc: "排位赛" }
          },
          {
            _attributes: { RuleId: 71, Desc: "斗地主" },
            PlayCardPile: { _attributes: { List: "12001,12002,12003" } }
          }
        ]
      }
    }
  };
  const { standardDeckIds, gameRuleDecks } = buildGameRuleDecks(data, [1, 2, 72, 91, 98, 160, 161]);

  assert.deepEqual(standardDeckIds, [1, 2, 72, 91, 98, 160]);
  assert.deepEqual(gameRuleDecks[22].cardIds, standardDeckIds);
  assert.equal(gameRuleDecks[22].source, "rank-default-standard-deck");
  assert.deepEqual(gameRuleDecks[71].cardIds, [12001, 12002, 12003]);
});

if (failed) {
  console.error(`\nConfig table core 测试: ${passed} 通过, ${failed} 失败`);
  process.exit(1);
}

console.log(`\nConfig table core 测试: ${passed} 通过, ${failed} 失败`);
