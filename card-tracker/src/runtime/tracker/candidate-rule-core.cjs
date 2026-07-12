const TYPE_CONSTRAINTS = [
  { re: /非基本牌/g, field: "type", op: "not", values: [1], label: "非基本牌" },
  { re: /非锦囊牌/g, field: "type", op: "not", values: [3], label: "非锦囊牌" },
  { re: /非装备牌/g, field: "type", op: "not", values: [4], label: "非装备牌" },
  { re: /非伤害锦囊牌|伤害锦囊牌|普通锦囊牌/g, field: "type", values: [3], label: "锦囊牌" },
  { re: /基本牌/g, field: "type", values: [1], label: "基本牌" },
  { re: /锦囊牌/g, field: "type", values: [3], label: "锦囊牌" },
  { re: /(?:武器|防具|坐骑|宝物)(?:牌)?(?:[、\/和与]|或)(?:武器|防具|坐骑|宝物)(?:牌)?(?:(?:[、\/和与]|或)(?:武器|防具|坐骑|宝物)(?:牌)?)*牌/g, field: "type", values: [4], label: "装备牌" },
  { re: /武器牌|防具牌|坐骑牌|宝物牌/g, field: "type", values: [4], label: "装备牌" },
  { re: /装备牌/g, field: "type", values: [4], label: "装备牌" }
];

const COLOR_CONSTRAINTS = [
  { re: /非红色牌|非红色|非红牌/g, field: "color", op: "not", values: ["red"], label: "非红色" },
  { re: /非黑色牌|非黑色|非黑牌/g, field: "color", op: "not", values: ["black"], label: "非黑色" },
  { re: /红色牌|红色|红牌(?!数)/g, field: "color", values: ["red"], label: "红色" },
  { re: /黑色牌|黑色|黑牌(?!数)/g, field: "color", values: ["black"], label: "黑色" }
];

const SUIT_CONSTRAINTS = [
  { re: /非红桃牌?|非♥/g, field: "suit", op: "not", values: [1], label: "非红桃" },
  { re: /非方片牌?|非方块牌?|非♦/g, field: "suit", op: "not", values: [2], label: "非方片" },
  { re: /非黑桃牌?|非♠/g, field: "suit", op: "not", values: [3], label: "非黑桃" },
  { re: /非梅花牌?|非草花牌?|非♣/g, field: "suit", op: "not", values: [4], label: "非梅花" },
  { re: /红桃|♥/g, field: "suit", values: [1], label: "红桃" },
  { re: /方片|方块|♦/g, field: "suit", values: [2], label: "方片" },
  { re: /黑桃|♠/g, field: "suit", values: [3], label: "黑桃" },
  { re: /梅花|草花|♣/g, field: "suit", values: [4], label: "梅花" }
];

const EACH_SET_CONSTRAINTS = [
  { re: /(?:颜色不同|不同颜色|两种颜色|每种颜色)[^。；;，,：:]{0,16}各一张/g, field: "color", values: ["red", "black"], label: "不同颜色" },
  { re: /获得不同花色的?牌各一张/g, field: "suit", values: [1, 2, 3, 4], label: "不同花色" },
  { re: /(?:每种|四种)花色[^。；;，,：:]{0,16}各一张/g, field: "suit", values: [1, 2, 3, 4], label: "每种花色" },
  { re: /(?:每个|每种|三种)类型[^。；;，,：:]{0,16}各一张/g, field: "type", values: [1, 3, 4], label: "每种类型" }
];

const PLAIN_CARD_NAMES = [
  "雷杀",
  "火杀",
  "冰杀",
  "杀",
  "闪",
  "桃",
  "酒"
];

const RANK_VALUES = {
  A: 1,
  a: 1,
  J: 11,
  j: 11,
  Q: 12,
  q: 12,
  K: 13,
  k: 13,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12,
  十三: 13
};

const PROBABILITY_FIELDS = ["name", "type", "color", "suit", "number"];

const TYPE_LABELS = {
  1: "基本牌",
  2: "锦囊牌",
  3: "锦囊牌",
  4: "装备牌"
};

const COLOR_LABELS = {
  red: "红色",
  black: "黑色"
};

const SUIT_LABELS = {
  1: "红桃",
  2: "方片",
  3: "黑桃",
  4: "梅花"
};

const SUIT_VALUES = {
  "♥": 1,
  "♦": 2,
  "♠": 3,
  "♣": 4,
  红桃: 1,
  方片: 2,
  方块: 2,
  黑桃: 3,
  梅花: 4,
  草花: 4
};

const CARD_PROPERTY_PATTERN = "(?:非伤害锦囊牌|伤害锦囊牌|普通锦囊牌|非基本牌|非锦囊牌|非装备牌|非红色牌|非黑色牌|非红牌|非黑牌|非红桃牌?|非♥|非方片牌?|非方块牌?|非♦|非黑桃牌?|非♠|非梅花牌?|非草花牌?|非♣|红色牌|黑色牌|红色|黑色|红牌|黑牌|红桃牌?|♥|方片牌?|方块牌?|♦|黑桃牌?|♠|梅花牌?|草花牌?|♣|基本牌|锦囊牌|装备牌|武器牌|防具牌|坐骑牌|宝物牌|【[^】]+】)";
const JUDGEMENT_RESULT_PATTERN = "(?:红色|黑色|红桃|♥|方片|方块|♦|黑桃|♠|梅花|草花|♣)";
const HAND_INSERT_TARGET_PATTERN = "(?:你(?:的)?|其(?:的)?|该角色的|目标角色的|一名角色的|一名其他角色的)?手牌";

function candidateRulesForSkill(skillId, skillRule) {
  return candidateRulesForSkillRule({
    ...(skillRule || {}),
    id: skillRule?.id || skillId
  });
}

function candidateRulesForSkillRule(skillRule = {}) {
  const rules = [];
  for (const rule of normalizedRuleList(skillRule.candidateRules || skillRule.candidates || skillRule.candidate)) {
    rules.push(rule);
  }
  if (skillRule.desc || skillRule.text) {
    rules.push(...candidateRulesForText(`${skillRule.name || ""} ${skillRule.desc || skillRule.text || ""}`, {
      skillId: skillRule.id || skillRule.skillId,
      skillName: skillRule.name || ""
    }));
  }
  return dedupeRules(rules);
}

function candidateRulesForText(text, options = {}) {
  const fragments = candidateFragments(text);
  const rules = [];
  for (const fragment of fragments) {
    const alternatives = normalizeAlternativeSets(fragment.alternatives);
    if (alternatives.length) {
      rules.push({
        probability: 0,
        display: displayForAlternativeSets(alternatives),
        constraints: [],
        alternatives: alternatives.map((constraints) => ({ constraints })),
        sourceRule: "skill-text-candidate-filter",
        sourceKind: "skill-text",
        operate: "candidate-filter",
        order: fragment.order || "skill-text-alternative-constraint",
        appliesTo: fragment.appliesTo || "any",
        skillId: Number(options.skillId || 0),
        skillName: options.skillName || ""
      });
      continue;
    }
    const constraints = constraintsForFragment(fragment);
    if (!constraints.length) continue;
    for (const candidate of splitEachCandidateRules(fragment, constraints)) {
      rules.push({
        probability: 1,
        display: displayForConstraints(candidate.constraints),
        constraints: candidate.constraints,
        sourceRule: "skill-text-candidate-filter",
        sourceKind: "skill-text",
        operate: "candidate-filter",
        order: candidate.order || fragment.order || "skill-text-direct-constraint",
        appliesTo: fragment.appliesTo || "any",
        skillId: Number(options.skillId || 0),
        skillName: options.skillName || "",
        ...(candidate.count ? { count: candidate.count } : {})
      });
    }
  }
  return dedupeRules(rules);
}

function candidateProbabilityRules(rule, cardPool, options = {}) {
  const base = normalizeCandidateRule(rule);
  if (!base) return [];
  const minProbability = probabilityValue(options.minProbability ?? options.minCandidateProbability, 0.75);
  const pool = normalizeCardPool(cardPool).filter((card) => matchesCandidateRule(card, base));
  if (!pool.length) return [];

  const rules = [];
  for (const field of PROBABILITY_FIELDS) {
    const distribution = valueDistribution(pool, field);
    const top = topDistributionEntry(distribution);
    if (!top) continue;
    const probability = top.count / pool.length;
    if (probability < minProbability) continue;
    if (hasExactSingleConstraint(base.constraints, field, top.value)) continue;
    const constraint = {
      field,
      op: "in",
      values: [top.value],
      label: labelForFieldValue(field, top.value)
    };
    rules.push({
      probability,
      display: constraint.label,
      constraints: [constraint],
      sourceRule: "candidate-pool-probability",
      sourceKind: "card-catalog-probability",
      operate: "candidate-probability",
      order: "candidate-pool-field-majority",
      appliesTo: base.appliesTo || "any",
      skillId: Number(base.skillId || options.skillId || 0),
      skillName: base.skillName || options.skillName || "",
      baseDisplay: base.display || displayForCandidateRule(base),
      poolSize: pool.length,
      hitCount: top.count
    });
  }
  return dedupeRules(rules);
}

function candidateProbabilityRulesFromCards(cardPool, options = {}) {
  const minProbability = probabilityValue(options.minProbability ?? options.minCandidateProbability, 0.75);
  const pool = normalizeCardPool(cardPool);
  if (!pool.length) return [];

  const rules = [];
  for (const field of PROBABILITY_FIELDS) {
    const distribution = valueDistribution(pool, field);
    const top = topDistributionEntry(distribution);
    if (!top) continue;
    const probability = top.count / pool.length;
    if (probability < minProbability) continue;
    const constraint = {
      field,
      op: "in",
      values: [top.value],
      label: labelForFieldValue(field, top.value)
    };
    rules.push({
      probability,
      display: constraint.label,
      constraints: [constraint],
      sourceRule: options.sourceRule || "candidate-pool-probability",
      sourceKind: options.sourceKind || "card-catalog-probability",
      operate: options.operate || "candidate-probability",
      order: options.order || "candidate-pool-field-majority",
      appliesTo: options.appliesTo || "any",
      skillId: Number(options.skillId || 0),
      skillName: options.skillName || "",
      baseDisplay: options.baseDisplay || "",
      poolSize: pool.length,
      hitCount: top.count,
      count: Math.max(1, Number(options.count || 1)),
      zoneKey: options.zoneKey || "",
      possibleIds: Array.isArray(options.possibleIds) ? options.possibleIds.slice() : []
    });
  }
  return dedupeRules(rules);
}

function candidateFragments(value) {
  const text = String(value || "");
  const fragments = [];
  const verbs = "(?:随机获得|获得|得到|拿取|交给|分配|置入手牌|加入手牌|收入手牌)";
  const afterVerb = new RegExp(`${verbs}[^。；;，,：:]{0,56}`, "g");
  for (const match of text.matchAll(afterVerb)) {
    pushCandidateFragment(fragments, match[0], text.slice(Math.max(0, match.index - 12), match.index));
  }

  const chooseCard = /(?:选择|检索|找出)[^。；;，,：:]{0,28}(?:牌|【[^】]+】)[^。；;，,：:]{0,28}/g;
  for (const match of text.matchAll(chooseCard)) {
    const fragment = match[0];
    if (/选择一项|弃置/.test(fragment) && !/(获得|交给|置入手牌|加入手牌|收入手牌)/.test(fragment)) continue;
    if (!/(获得|交给|置入手牌|加入手牌|收入手牌)/.test(fragment)) continue;
    pushCandidateFragment(fragments, fragment, text.slice(Math.max(0, match.index - 12), match.index));
  }

  const beforeVerb = new RegExp(`(?:将|把)([^。；;，,：:]{0,56})(交给|分配给|置入${HAND_INSERT_TARGET_PATTERN}|置于${HAND_INSERT_TARGET_PATTERN}|加入${HAND_INSERT_TARGET_PATTERN}|收入${HAND_INSERT_TARGET_PATTERN})`, "g");
  for (const match of text.matchAll(beforeVerb)) {
    fragments.push({
      text: match[1],
      appliesTo: appliesToForBeforeVerb(match[2] || ""),
      order: /交给|分配给/.test(match[2] || "") ? "skill-text-direct-constraint" : "skill-text-hand-insertion-constraint"
    });
  }

  const drawCard = /(?:摸|摸取)(?!牌阶段|到)[^。；;，,：:、]{0,12}(?:红色牌|黑色牌|红牌(?!数)|黑牌(?!数)|红桃牌?|♥|方片牌?|方块牌?|♦|黑桃牌?|♠|梅花牌?|草花牌?|♣|基本牌|锦囊牌|装备牌|武器牌|防具牌|坐骑牌|宝物牌|非伤害锦囊牌|伤害锦囊牌|普通锦囊牌|非基本牌|非锦囊牌|非装备牌|点数(?:为|是|不小于|不大于|大于|小于)?\s*(?:A|J|Q|K|13|12|11|10|[1-9]|十三|十二|十一|十|一|二|两|三|四|五|六|七|八|九)(?:的牌)?|【[^】]+】)/g;
  for (const match of text.matchAll(drawCard)) {
    if (/^(?:摸|摸取).{0,12}(?:其中|场上|弃置|手牌中)/.test(match[0])) continue;
    pushCandidateFragment(fragments, match[0], text.slice(Math.max(0, match.index - 12), match.index));
  }

  pushPronounGainFragments(fragments, text);

  return fragments.filter((item) => normalizeAlternativeSets(item.alternatives).length || /牌|【[^】]+】/.test(item.text));
}

function pushCandidateFragment(fragments, fragment, prefix = "") {
  const text = trimCandidateFragment(fragment);
  if (!text || shouldSkipFragment(text, prefix)) return;
  fragments.push({
    text,
    appliesTo: appliesToForFragment(text, prefix)
  });
}

function pushPronounGainFragments(fragments, text) {
  const judgement = new RegExp(`判定[^。；;]{0,36}若(?:结果|判定结果)?(?:为|是)?(${JUDGEMENT_RESULT_PATTERN})[^。；;]{0,36}(?:获得(?:此|该)?判定牌|获得此牌|获得该牌)`, "g");
  for (const match of text.matchAll(judgement)) {
    pushContextualCandidateFragment(fragments, normalizePropertyFragment(match[1]), match[0], "skill-text-judgement-result-pronoun");
  }

  const discardPileGain = new RegExp(`(${CARD_PROPERTY_PATTERN})[^。；;]{0,44}(?:(?:因|被)[^。；;]{0,16})?(?:置入|进入|放入)弃牌堆[^。；;]{0,56}(?:获得之|获得此牌|获得该牌|获得这些牌|获得其中[^。；;]{0,16}牌)`, "g");
  for (const match of text.matchAll(discardPileGain)) {
    if (hasAlternativeBeforeMove(match[0])) {
      if (!pushAlternativeContextualCandidateFragment(fragments, match[0], "skill-text-resolved-pronoun-alternative")) {
        pushContextualCandidateFragment(fragments, alternativePropertyText(match[0]), match[0], "skill-text-resolved-pronoun-constraint");
      }
      continue;
    }
    pushContextualCandidateFragment(fragments, match[1], match[0], "skill-text-resolved-pronoun-constraint");
  }

  const discardedStillInPileGain = new RegExp(`(${CARD_PROPERTY_PATTERN})被弃置[^。；;]{0,56}弃牌堆[^。；;]{0,56}获得之`, "g");
  for (const match of text.matchAll(discardedStillInPileGain)) {
    if (hasAlternativeBeforeMove(match[0])) continue;
    pushContextualCandidateFragment(fragments, match[1], match[0], "skill-text-resolved-pronoun-constraint");
  }

  const usedCardGain = new RegExp(`(?:使用|打出)(?:的)?(${CARD_PROPERTY_PATTERN})[^。；;]{0,64}(?:获得之|获得此牌|获得该牌)`, "g");
  for (const match of text.matchAll(usedCardGain)) {
    if (hasAlternativeBeforeMove(match[0])) {
      if (!pushAlternativeContextualCandidateFragment(fragments, match[0], "skill-text-resolved-pronoun-alternative")) {
        pushContextualCandidateFragment(fragments, alternativePropertyText(match[0]), match[0], "skill-text-resolved-pronoun-constraint");
      }
      continue;
    }
    pushContextualCandidateFragment(fragments, match[1], match[0], "skill-text-resolved-pronoun-constraint");
  }

  const branchPronounGain = new RegExp(`(?:(?:若|如)(?:此牌|该牌)?为|[•·])\\s*[：:，,、]?\\s*(?:[•·]\\s*)?(${CARD_PROPERTY_PATTERN})[^。；;]{0,32}(?:获得之|获得此牌|获得该牌)`, "g");
  for (const match of text.matchAll(branchPronounGain)) {
    if (hasAlternativeBeforeMove(match[0])) {
      if (!pushAlternativeContextualCandidateFragment(fragments, match[0], "skill-text-resolved-pronoun-alternative")) {
        pushContextualCandidateFragment(fragments, alternativePropertyText(match[0]), match[0], "skill-text-resolved-pronoun-constraint");
      }
      continue;
    }
    pushContextualCandidateFragment(fragments, match[1], match[0], "skill-text-resolved-pronoun-constraint");
  }

  const alternativePropertyPattern = "(?:非伤害锦囊牌|伤害锦囊牌|普通锦囊牌|非基本牌|非锦囊牌|非装备牌|红色牌|黑色牌|红色|黑色|红牌|黑牌|基本牌|锦囊牌|装备牌|武器牌|防具牌|坐骑牌|宝物牌|【[^】]+】)";
  const effectiveAlternativeGain = new RegExp(`(${alternativePropertyPattern}(?:或${alternativePropertyPattern})+)[^。；;]{0,64}(?:。[^。；;]{0,32})?(?:获得此牌|获得该牌)`, "g");
  for (const match of text.matchAll(effectiveAlternativeGain)) {
    pushAlternativeContextualCandidateFragment(fragments, match[0], "skill-text-resolved-pronoun-alternative");
  }

  const letterRankPronounGain = /点数为字母[^。；;]{0,32}(?:获得之|获得此牌|获得该牌)/g;
  for (const match of text.matchAll(letterRankPronounGain)) {
    pushContextualCandidateFragment(fragments, "点数为字母的牌", match[0], "skill-text-resolved-pronoun-constraint");
  }

  pushRemainderGainFragments(fragments, text);
}

function pushRemainderGainFragments(fragments, text) {
  const removedThenRemainder = new RegExp(`(?:弃置|使用|移出|移去|置入弃牌堆)[^。；;]{0,16}(${CARD_PROPERTY_PATTERN})[^。；;]{0,36}(?:获得剩余牌|获得剩余[^。；;]{0,12}牌)`, "g");
  for (const match of text.matchAll(removedThenRemainder)) {
    pushComplementCandidateFragment(fragments, match[1], match[0], "skill-text-remainder-complement");
  }

  const countThenRemainder = new RegExp(`与其中(${CARD_PROPERTY_PATTERN})数等量[^。；;]{0,36}(?:获得剩余牌|获得剩余[^。；;]{0,12}牌)`, "g");
  for (const match of text.matchAll(countThenRemainder)) {
    pushComplementCandidateFragment(fragments, match[1], match[0], "skill-text-remainder-complement");
  }
}

function pushComplementCandidateFragment(fragments, fragment, context, order) {
  const text = complementPropertyFragment(fragment);
  if (!text || shouldSkipFragment(text)) return;
  fragments.push({
    text,
    appliesTo: appliesToForContext(context),
    order
  });
}

function pushContextualCandidateFragment(fragments, fragment, context, order) {
  const text = trimCandidateFragment(normalizePropertyFragment(fragment));
  if (!text || shouldSkipFragment(text)) return;
  fragments.push({
    text,
    appliesTo: appliesToForContext(context),
    order
  });
}

function pushAlternativeContextualCandidateFragment(fragments, context, order) {
  const alternatives = alternativeConstraintSetsForContext(context);
  if (!alternatives.length) return false;
  fragments.push({
    text: displayForAlternativeSets(alternatives),
    alternatives: alternatives.map((constraints) => ({ constraints })),
    appliesTo: appliesToForContext(context),
    order
  });
  return true;
}

function complementPropertyFragment(fragment) {
  const text = normalizePropertyFragment(fragment);
  if (!text || /^非/.test(text)) return "";
  if (/^【[^】]+】$/.test(text)) return `非${text}`;
  return `非${text}`;
}

function normalizePropertyFragment(fragment) {
  const text = String(fragment || "").trim();
  if (!text) return "";
  if (/牌|【[^】]+】/.test(text)) return text;
  return `${text}牌`;
}

function hasAlternativeBeforeMove(fragment) {
  const head = String(fragment || "").split(/因|被|置入|进入|放入|使用|打出|后|时/)[0] || "";
  return /[、\/和与]|或/.test(head);
}

function alternativePropertyText(context) {
  let text = String(context || "");
  const branchText = text.replace(/^.*?(?:若|如)(?:此牌|该牌)?为[：:，,、]?\s*/, "");
  if (branchText !== text) {
    text = branchText;
  } else {
    const usedMatch = text.match(new RegExp(`(?:使用|打出)(?:的)?\\s*(${CARD_PROPERTY_PATTERN}[^。；;]*)`));
    if (usedMatch) text = usedMatch[1];
  }
  return text
    .replace(/^.*?当一张\s*/, "")
    .split(/因|被|置入|进入|放入|结算|生效|后|时|，你|,你|；|;|。/)[0]
    .trim();
}

function alternativeConstraintSetsForContext(context) {
  const text = alternativePropertyText(context);
  if (!/或/.test(text)) return [];
  const sets = text.split(/或/)
    .map((part) => constraintsForFragment(normalizePropertyFragment(part)))
    .filter((constraints) => constraints.length);
  if (sets.length < 2 || sets.length !== text.split(/或/).length) return [];
  return shouldUseAlternativeSets(sets) ? sets : [];
}

function shouldUseAlternativeSets(sets) {
  const signatures = sets.map((constraints) =>
    constraints.map((constraint) => constraint.field).sort().join("+")
  );
  return new Set(signatures).size > 1 || sets.some((constraints) => constraints.length > 1);
}

function appliesToForContext(context = "") {
  if (/(?:你[^。；;]{0,24}获得|令你获得|你选择[^。；;]{0,12}获得)/.test(context) && !/(?:其|一名角色|其他角色|目标角色|同族角色)(?:可以)?获得/.test(context)) {
    return "to-caster";
  }
  return "any";
}

function trimCandidateFragment(fragment) {
  return String(fragment || "")
    .split(/若|则|然后|否则|直到|并|且|视为|当作/)[0]
    .trim();
}

function shouldSkipFragment(fragment, prefix = "") {
  if (/获得(?:的|的是)|交给你的牌(?:不|没)|不是|不为|不包含/.test(fragment)) return true;
  if (/^(?:获得|得到)(?:了|你的|其的|该角色的)/.test(fragment)) return true;
  if (/(?:每|每次|累计)\s*$/.test(prefix)) return true;
  if (/获得.{0,8}(技能|效果|标记|护甲|体力)/.test(fragment) && !/牌/.test(fragment)) return true;
  if (/^(?:摸|摸取)/.test(fragment) && /(?:其中|场上|弃置|手牌中).{0,16}(?:牌数|数量|数).{0,16}等量/.test(fragment)) return true;
  return false;
}

function appliesToForFragment(fragment, prefix = "") {
  if (/交给你|分配给你|给你/.test(fragment)) return "to-caster";
  if (/交给|分配/.test(fragment)) return "from-caster";
  if (/^(?:随机获得|获得|得到|拿取|置入手牌|加入手牌|收入手牌|摸取|摸)/.test(fragment)) {
    return /令|其|将领|角色|目标|一名/.test(prefix) ? "any" : "to-caster";
  }
  return "any";
}

function appliesToForBeforeVerb(verb = "") {
  if (/交给|分配给/.test(verb)) return "from-caster";
  if (/你(?:的)?手牌|^手牌/.test(verb)) return "to-caster";
  return "any";
}

function constraintsForFragment(value) {
  const fragment = typeof value === "string" ? value : value?.text || "";
  const constraints = [];
  const negated = new Map();
  for (const definition of EACH_SET_CONSTRAINTS) {
    if (definition.re.test(fragment)) {
      constraints.push({
        field: definition.field,
        op: "in",
        values: definition.values,
        label: definition.label
      });
    }
    definition.re.lastIndex = 0;
  }
  for (const definition of [
    ...TYPE_CONSTRAINTS,
    ...COLOR_CONSTRAINTS,
    ...SUIT_CONSTRAINTS
  ].filter((item) => item.op === "not")) {
    if (definition.re.test(fragment)) {
      const fieldValues = negated.get(definition.field) || new Set();
      for (const value of definition.values || []) fieldValues.add(String(value));
      negated.set(definition.field, fieldValues);
      constraints.push({
        field: definition.field,
        op: definition.op,
        values: definition.values,
        label: definition.label
      });
    }
    definition.re.lastIndex = 0;
  }
  for (const definition of [
    ...TYPE_CONSTRAINTS.filter((item) => item.op !== "not"),
    ...COLOR_CONSTRAINTS,
    ...SUIT_CONSTRAINTS
  ].filter((item) => item.op !== "not")) {
    const fieldValues = negated.get(definition.field);
    if (fieldValues && (definition.values || []).some((value) => fieldValues.has(String(value)))) continue;
    if (definition.re.test(fragment)) {
      constraints.push({
        field: definition.field,
        op: definition.op || "in",
        values: definition.values,
        label: definition.label
      });
    }
    definition.re.lastIndex = 0;
  }
  constraints.push(...nameConstraints(fragment));
  constraints.push(...numberConstraints(fragment));
  return dedupeConstraints(constraints);
}

function splitEachCandidateRules(fragment, constraints) {
  const text = typeof fragment === "string" ? fragment : fragment?.text || "";
  if (!/各一张/.test(text)) return [{ constraints }];
  const positive = constraints.filter((constraint) => (constraint.op || "in") === "in");
  const negative = constraints.filter((constraint) => (constraint.op || "in") === "not");
  const fields = Array.from(new Set(positive.map((constraint) => constraint.field)));
  if (negative.length || positive.length < 1 || fields.length !== 1) return [{ constraints }];
  const field = fields[0];
  const values = [];
  for (const constraint of positive) {
    for (const value of constraint.values || []) values.push(value);
  }
  const uniqueValues = Array.from(new Set(values.map((value) => String(value))))
    .map((value) => normalizeFieldValue(field, value))
    .filter((value) => value != null && value !== "");
  if (uniqueValues.length < 2) return [{ constraints }];
  return uniqueValues.map((value) => ({
    count: 1,
    order: "skill-text-each-direct-constraint",
    constraints: [{
      field,
      op: "in",
      values: [value],
      label: labelForFieldValue(field, value)
    }]
  }));
}

function nameConstraints(fragment) {
  const negatedNames = [];
  const negatedBracket = /非【([^】]+)】/g;
  for (const match of fragment.matchAll(negatedBracket)) {
    for (const item of splitNames(match[1])) negatedNames.push(item);
  }
  const uniqueNegatedNames = Array.from(new Set(negatedNames.filter(Boolean)));
  if (uniqueNegatedNames.length) {
    return [{
      field: "name",
      op: "not",
      values: uniqueNegatedNames,
      label: `非${uniqueNegatedNames.join("/")}`
    }];
  }

  const names = [];
  const bracket = /【([^】]+)】/g;
  for (const match of fragment.matchAll(bracket)) {
    for (const item of splitNames(match[1])) names.push(item);
  }
  for (const name of PLAIN_CARD_NAMES) {
    if (new RegExp(`(^|[^\\u4e00-\\u9fff])${escapeRegExp(name)}([^\\u4e00-\\u9fff]|$)`).test(fragment)) {
      names.push(name);
    }
  }
  const values = Array.from(new Set(names.filter(Boolean)));
  if (!values.length) return [];
  return [{
    field: "name",
    op: "in",
    values,
    label: values.join("/")
  }];
}

function numberConstraints(fragment) {
  if (/点数之和|点数和/.test(fragment)) return [];
  if (/点数为字母|点数是字母/.test(fragment)) {
    return [{
      field: "number",
      op: "in",
      values: [1, 11, 12, 13],
      label: "点数字母"
    }];
  }
  const rangeValues = numberRangeValues(fragment);
  if (rangeValues.length) {
    return [{
      field: "number",
      op: "in",
      values: rangeValues,
      label: `点数${rangeValues.join("/")}`
    }];
  }
  const values = [];
  const numberPattern = /点数(?:为|是|不小于|不大于|大于|小于)?\s*(A|J|Q|K|13|12|11|10|[1-9]|十三|十二|十一|十|一|二|两|三|四|五|六|七|八|九)/g;
  for (const match of fragment.matchAll(numberPattern)) {
    const value = RANK_VALUES[match[1]] || Number(match[1]);
    if (Number.isFinite(value) && value >= 1 && value <= 13) values.push(value);
  }
  const uniqueValues = Array.from(new Set(values));
  if (!uniqueValues.length) return [];
  return [{
    field: "number",
    op: "in",
    values: uniqueValues,
    label: `点数${uniqueValues.join("/")}`
  }];
}

function numberRangeValues(fragment) {
  const values = [];
  const rangePattern = /点数(不小于|大于等于|至少|不大于|小于等于|至多|大于|小于)\s*(A|J|Q|K|13|12|11|10|[1-9]|十三|十二|十一|十|一|二|两|三|四|五|六|七|八|九)/g;
  for (const match of fragment.matchAll(rangePattern)) {
    const op = match[1];
    const value = RANK_VALUES[match[2]] || Number(match[2]);
    if (!Number.isFinite(value) || value < 1 || value > 13) continue;
    if (op === "不小于" || op === "大于等于" || op === "至少") {
      for (let number = value; number <= 13; number++) values.push(number);
    } else if (op === "不大于" || op === "小于等于" || op === "至多") {
      for (let number = 1; number <= value; number++) values.push(number);
    } else if (op === "大于") {
      for (let number = value + 1; number <= 13; number++) values.push(number);
    } else if (op === "小于") {
      for (let number = 1; number < value; number++) values.push(number);
    }
  }
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function splitNames(value) {
  return String(value || "")
    .split(/[、,，\/或和与]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizedRuleList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value];
}

function normalizeAlternativeSets(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((alternative) => {
      const constraints = Array.isArray(alternative) ? alternative : alternative?.constraints;
      return dedupeConstraints(Array.isArray(constraints) ? constraints : []);
    })
    .filter((constraints) => constraints.length);
}

function dedupeRules(rules) {
  const seen = new Set();
  const result = [];
  for (const rule of rules || []) {
    const constraints = (rule.constraints || []).map(normalizeConstraint).filter(Boolean);
    const alternatives = normalizeAlternativeSets(rule.alternatives);
    if (!constraints.length && !alternatives.length) continue;
    const key = [
      constraints.map((item) => `${item.field}:${item.op || "in"}:${item.values.join("|")}`).join(";"),
      alternatives.map((set) => `(${set.map((item) => `${item.field}:${item.op || "in"}:${item.values.join("|")}`).join("&")})`).join("|")
    ].filter(Boolean).join("||");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      ...rule,
      constraints,
      alternatives: alternatives.map((set) => ({ constraints: set })),
      display: rule.display || displayForCandidateRule({ constraints, alternatives }),
      probability: probabilityValue(rule.probability, 1)
    });
  }
  return result;
}

function normalizeCandidateRule(rule) {
  const normalized = dedupeRules([rule])[0];
  return normalized || null;
}

function dedupeConstraints(constraints) {
  const seen = new Set();
  const result = [];
  for (const constraint of constraints || []) {
    const item = normalizeConstraint(constraint);
    if (!item) continue;
    const key = `${item.field}:${item.op || "in"}:${item.values.join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function normalizeCardPool(cardPool) {
  const value = typeof cardPool === "function" ? cardPool() : cardPool;
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value instanceof Map) return Array.from(value.values()).filter(Boolean);
  if (typeof value === "object") return Object.values(value).filter(Boolean);
  return [];
}

function matchesAllConstraints(card, constraints) {
  const byField = new Map();
  for (const constraint of constraints || []) {
    if (!constraint?.field) continue;
    const list = byField.get(constraint.field) || [];
    list.push(constraint);
    byField.set(constraint.field, list);
  }
  for (const list of byField.values()) {
    const positive = list.filter((constraint) => (constraint.op || "in") !== "not");
    const negative = list.filter((constraint) => (constraint.op || "in") === "not");
    if (positive.length && !positive.some((constraint) => matchesConstraintValues(card, constraint))) return false;
    if (negative.some((constraint) => matchesConstraintValues(card, constraint))) return false;
  }
  return true;
}

function matchesCandidateRule(card, rule) {
  const baseConstraints = Array.isArray(rule?.constraints) ? rule.constraints : [];
  const alternatives = normalizeAlternativeSets(rule?.alternatives);
  if (!alternatives.length) return matchesAllConstraints(card, baseConstraints);
  return alternatives.some((constraints) => matchesAllConstraints(card, [...baseConstraints, ...constraints]));
}

function matchesConstraint(card, constraint) {
  const matched = matchesConstraintValues(card, constraint);
  return (constraint.op || "in") === "not" ? !matched : matched;
}

function matchesConstraintValues(card, constraint) {
  const cardValue = cardFieldValue(card, constraint.field);
  if (cardValue == null || cardValue === "") return false;
  const values = (constraint.values || [])
    .map((value) => normalizeFieldValue(constraint.field, value))
    .filter((value) => value != null && value !== "");
  if (!values.length) return false;
  return values.some((value) => String(value) === String(cardValue));
}

function valueDistribution(cards, field) {
  const result = new Map();
  for (const card of cards || []) {
    const value = cardFieldValue(card, field);
    if (value == null || value === "") continue;
    const key = String(value);
    const existing = result.get(key) || { value, count: 0 };
    existing.count++;
    result.set(key, existing);
  }
  return result;
}

function topDistributionEntry(distribution) {
  let top = null;
  for (const entry of distribution.values()) {
    if (!top || entry.count > top.count || (entry.count === top.count && String(entry.value).localeCompare(String(top.value)) < 0)) {
      top = entry;
    }
  }
  return top;
}

function hasExactSingleConstraint(constraints, field, value) {
  const normalizedValue = normalizeFieldValue(field, value);
  const values = [];
  for (const constraint of constraints || []) {
    if (constraint.field !== field || (constraint.op || "in") !== "in") continue;
    for (const item of constraint.values || []) {
      const normalized = normalizeFieldValue(field, item);
      if (normalized != null && normalized !== "") values.push(normalized);
    }
  }
  const uniqueValues = Array.from(new Set(values.map((item) => String(item))));
  return uniqueValues.length === 1 && uniqueValues[0] === String(normalizedValue);
}

function cardFieldValue(card, field) {
  if (!card) return null;
  if (field === "name") return String(card.name || card.CardName || "").trim();
  if (field === "type") return finiteNumber(card.type ?? card.cardType ?? card.Type);
  if (field === "number") return finiteNumber(card.number ?? card.CardNumber ?? card.rank);
  if (field === "suit") return suitValue(card);
  if (field === "color") {
    const direct = String(card.colorName || card.cardColor || "").toLowerCase();
    if (direct === "red" || direct === "black") return direct;
    if (card.color === "red" || card.color === "black") return card.color;
    const suit = suitValue(card);
    if (suit === 1 || suit === 2) return "red";
    if (suit === 3 || suit === 4) return "black";
  }
  return null;
}

function suitValue(card) {
  const directSuit = normalizeFieldValue("suit", card?.suit ?? card?.colorSym ?? card?.CardFlower);
  if (directSuit) return directSuit;
  const color = normalizeFieldValue("suit", card?.color ?? card?.Color);
  return color || null;
}

function normalizeFieldValue(field, value) {
  if (value == null || value === "") return null;
  if (field === "name") return String(value).trim();
  if (field === "color") {
    const text = String(value).toLowerCase();
    if (text === "red" || text === "红色" || text === "红") return "red";
    if (text === "black" || text === "黑色" || text === "黑") return "black";
    const suit = normalizeFieldValue("suit", value);
    if (suit === 1 || suit === 2) return "red";
    if (suit === 3 || suit === 4) return "black";
    return null;
  }
  if (field === "suit") {
    if (SUIT_VALUES[value]) return SUIT_VALUES[value];
    const number = finiteNumber(value);
    return number >= 1 && number <= 4 ? number : null;
  }
  if (field === "type" || field === "number") return finiteNumber(value);
  return value;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function labelForFieldValue(field, value) {
  if (field === "type") return TYPE_LABELS[value] || `类型${value}`;
  if (field === "color") return COLOR_LABELS[value] || String(value);
  if (field === "suit") return SUIT_LABELS[value] || `花色${value}`;
  if (field === "number") return `点数${value}`;
  return String(value);
}

function normalizeConstraint(value) {
  if (!value?.field) return null;
  const rawValues = Array.isArray(value.values) ? value.values : [value.value];
  const values = rawValues.filter((item) => item !== "" && item != null);
  if (!values.length) return null;
  return {
    field: value.field,
    op: value.op || value.operator || "in",
    values,
    label: value.label || `${value.field}:${values.join("/")}`
  };
}

function displayForConstraints(constraints) {
  return (constraints || []).map((item) => item.label || `${item.field}:${item.values.join("/")}`).join(" / ");
}

function displayForAlternativeSets(alternatives) {
  return normalizeAlternativeSets(alternatives)
    .map((constraints) => displayForConstraints(constraints))
    .filter(Boolean)
    .join(" / ");
}

function displayForCandidateRule(rule) {
  const alternatives = normalizeAlternativeSets(rule?.alternatives);
  if (alternatives.length) return displayForAlternativeSets(alternatives);
  return displayForConstraints(rule?.constraints || []);
}

function probabilityValue(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 1) return Math.max(0, Math.min(1, number / 100));
  return Math.max(0, Math.min(1, number));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  TYPE_CONSTRAINTS,
  COLOR_CONSTRAINTS,
  SUIT_CONSTRAINTS,
  candidateRulesForSkill,
  candidateRulesForSkillRule,
  candidateRulesForText,
  candidateProbabilityRules,
  candidateProbabilityRulesFromCards,
  candidateFragments,
  constraintsForFragment,
  matchesAllConstraints,
  displayForConstraints,
  probabilityValue
};
