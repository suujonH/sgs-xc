const CATEGORY_RULE_DEFINITIONS = [
  {
    id: "hand.watch",
    label: "watch hand cards",
    pattern: "(观看|查看|检视).{0,16}手牌|手牌.{0,16}(观看|查看|检视)|手牌.{0,24}(可见|展示给你)|对.+可见.{0,24}手牌",
    action: "recordAuthorizedHandSnapshot",
    tier: "generic-log-rule"
  },
  {
    id: "hand.show",
    label: "show hand cards",
    pattern: "(展示|亮出|明置).{0,20}(手牌|此牌|牌)|手牌.{0,20}(展示|亮出|明置)",
    action: "recordExactPublicReveal",
    tier: "generic-log-rule"
  },
  {
    id: "resolved.card.gain",
    label: "gain the resolved or referenced card",
    pattern: "获得(?:之|此牌|该牌|这些牌|其中(?:任意张|一张|所有)?牌|剩余牌|所有“[^”]+”牌)",
    action: "followResolvedKnownCardFromPublicZone",
    tier: "generic-log-rule"
  },
  {
    id: "random.card.gain",
    label: "randomly gain card-like objects",
    pattern: "随机获得.{0,20}(?:张(?:牌|锦囊|基本牌|装备牌)|【[^】]+】|杀|闪|桃|酒|红色牌|黑色牌|锦囊牌|装备牌)",
    action: "recordProtocolListedRandomGainOnly",
    tier: "specific-log-rule"
  },
  {
    id: "hand.transfer",
    label: "transfer hand or role cards",
    pattern: "(交给|给出|获得|拿取|分配|交换).{0,28}(手牌|牌)|手牌.{0,28}(交给|给出|获得|拿取|分配|交换)|获得.{0,18}(区域|所有牌|全部牌)",
    action: "moveExactOrInvalidateHidden",
    tier: "generic-log-rule"
  },
  {
    id: "hand.discard",
    label: "discard hand or role cards",
    pattern: "(弃置|弃掉).{0,28}(手牌|牌)|手牌.{0,28}(弃置|弃掉)",
    action: "discardExactOnly",
    tier: "generic-log-rule"
  },
  {
    id: "deck.top.reveal",
    label: "reveal deck top",
    pattern: "牌堆顶.{0,12}(观看|查看|亮出|展示)|(?:观看|查看|亮出|展示).{0,12}牌堆顶",
    action: "recordOrderedDeckTopWhenOrderKnown",
    tier: "generic-log-rule"
  },
  {
    id: "deck.bottom.reveal",
    label: "reveal deck bottom",
    pattern: "牌堆底.{0,12}(观看|查看|亮出|展示)|(?:观看|查看|亮出|展示).{0,12}牌堆底",
    action: "recordOrderedDeckBottomWhenOrderKnown",
    tier: "manual-order-or-source-required"
  },
  {
    id: "deck.top.put",
    label: "put deck top",
    pattern: "置(?:于|入).{0,10}牌堆顶|牌堆顶.{0,10}置",
    action: "putKnownSourceOnDeckTop",
    tier: "generic-log-rule"
  },
  {
    id: "deck.bottom.put",
    label: "put deck bottom",
    pattern: "置(?:于|入).{0,10}牌堆底|牌堆底.{0,10}置",
    action: "putKnownSourceOnDeckBottom",
    tier: "manual-order-or-source-required"
  },
  {
    id: "deck.random.put",
    label: "put into deck without endpoint",
    pattern: "置(?:于|入)牌堆(?!顶|底)|随机.{0,12}置(?:于|入)牌堆",
    action: "invalidateExactDeckOrderForInsertedCards",
    tier: "manual-order-or-source-required"
  },
  {
    id: "deck.search",
    label: "search cards from deck",
    pattern: "(?:从牌堆|牌堆中|牌堆里|牌堆或弃牌堆).{0,32}(获得|使用|打出|置于|展示|选择|随机)|(?:获得|随机获得|交给).{0,20}牌堆中|牌堆顶第一张符合",
    action: "removeExactFromDeckWhenProtocolListsIds",
    tier: "specific-log-rule"
  },
  {
    id: "deck.shuffle",
    label: "shuffle deck",
    pattern: "洗切|洗牌|重新洗|将.{0,16}牌堆.{0,16}洗",
    action: "clearKnownDeckOrder",
    tier: "manual-order-or-source-required"
  },
  {
    id: "draw.bottom",
    label: "draw from deck bottom",
    pattern: "摸牌.{0,28}改为从牌堆底摸牌|从牌堆底.{0,10}摸",
    action: "consumeDeckBottomForDraw",
    tier: "specific-seat-rule"
  },
  {
    id: "draw.count",
    label: "draw count",
    pattern: "摸(?:一|两|三|四|五|六|七|八|九|十|\\d|X|x|等量|至).{0,10}(?:牌|张)|摸(?!牌数|牌数量).{0,18}张牌|(?:将|令)?.{0,8}手牌摸至.{0,8}张|摸到.{0,8}张|补至.{0,8}张|手牌调整至|摸牌阶段.{0,28}摸",
    action: "consumeKnownDeckEndOrUnknownCount",
    tier: "generic-log-rule"
  },
  {
    id: "judgement.replace",
    label: "replace judgement card",
    pattern: "判定牌.{0,18}(代替|替换)|(?:代替|替换).{0,18}判定牌|判定牌生效前.{0,44}用.{0,14}牌|牌堆顶.{0,14}代替",
    action: "replaceJudgementFromKnownSource",
    tier: "specific-log-rule"
  },
  {
    id: "judgement.gain",
    label: "gain judgement card",
    pattern: "获得.{0,14}判定牌|判定牌.{0,14}获得",
    action: "gainJudgementResultIfUnique",
    tier: "specific-log-rule"
  },
  {
    id: "judgement.any",
    label: "judgement consumes deck top",
    pattern: "判定",
    action: "consumeDeckTopForJudgement",
    tier: "generic-log-rule"
  },
  {
    id: "public.equip",
    label: "equipment zone",
    pattern: "装备区|装备牌",
    action: "syncPublicEquipZone",
    tier: "runtime-public-field"
  },
  {
    id: "public.judge",
    label: "judge zone",
    pattern: "判定区|延时",
    action: "syncPublicJudgeZone",
    tier: "runtime-public-field"
  },
  {
    id: "public.general",
    label: "general-card public zone",
    pattern: "武将牌(上|旁)|置于.{0,12}武将牌|扣置.{0,12}武将牌|称为“[^”]+”牌",
    action: "syncPublicGeneralZone",
    tier: "runtime-public-field"
  },
  {
    id: "discard.zone",
    label: "discard pile",
    pattern: "弃牌堆|弃牌区|进入弃牌|置入弃牌|置于弃牌",
    action: "maintainExactDiscardSubset",
    tier: "generic-log-rule"
  },
  {
    id: "outside.remove",
    label: "removed from game",
    pattern: "移出游戏|移出牌局|游戏外",
    action: "moveExactToRemovedZone",
    tier: "specific-log-rule"
  },
  {
    id: "virtual.transform",
    label: "virtual or transformed card",
    pattern: "当作|转化|声明.{0,12}牌名|视为.{0,28}(使用|打出|重铸)|将.{0,28}当.{0,28}(使用|打出|重铸)|牌当.{0,28}(使用|打出|重铸)|扣置.{0,28}(当|使用|打出)",
    action: "splitVirtualCardFromPhysicalSources",
    tier: "specific-log-rule"
  },
  {
    id: "pindian",
    label: "pindian",
    pattern: "拼点",
    action: "trackPindianRevealedCards",
    tier: "specific-log-rule"
  },
  {
    id: "recast",
    label: "recast",
    pattern: "重铸",
    action: "discardThenDraw",
    tier: "generic-log-rule"
  },
  {
    id: "constraint.property",
    label: "card property constraint",
    pattern: "红色|黑色|颜色|花色|点数|基本牌|锦囊牌|装备牌|非基本牌|非锦囊牌|非装备牌",
    action: "useCardCatalogForFilteringOnly",
    tier: "supporting-rule"
  }
];

const liveValidationCategoryIds = new Set([
  "hand.watch",
  "hand.show",
  "resolved.card.gain",
  "random.card.gain",
  "deck.search",
  "deck.top.reveal",
  "deck.bottom.reveal",
  "deck.top.put",
  "deck.bottom.put",
  "deck.random.put",
  "deck.shuffle",
  "draw.bottom",
  "judgement.replace",
  "judgement.gain",
  "public.general",
  "virtual.transform",
  "pindian"
]);

const endpointOrderCategoryIds = new Set([
  "deck.top.reveal",
  "deck.bottom.reveal",
  "deck.top.put",
  "deck.bottom.put",
  "deck.random.put",
  "deck.shuffle",
  "draw.bottom"
]);

const visibleIdentityCategoryIds = new Set([
  "hand.watch",
  "hand.show",
  "deck.top.reveal",
  "deck.bottom.reveal",
  "judgement.replace",
  "judgement.gain",
  "pindian"
]);

function compileCategoryRules() {
  return CATEGORY_RULE_DEFINITIONS.map((rule) => ({ ...rule, re: new RegExp(rule.pattern) }));
}

const categoryRules = compileCategoryRules();

function categoriesForText(text, options = {}) {
  const includeLabel = options.includeLabel !== false;
  return categoryRules
    .filter((rule) => rule.re.test(text))
    .map((rule) => {
      const item = {
        id: rule.id,
        action: rule.action,
        tier: rule.tier
      };
      if (includeLabel) item.label = rule.label;
      return item;
    });
}

function unique(array) {
  return [...new Set((array || []).filter(Boolean))];
}

function countBy(rows, getKey) {
  const result = {};
  for (const row of rows) {
    const key = getKey(row);
    const keys = Array.isArray(key) ? key : [key];
    for (const item of keys) result[item] = (result[item] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function priorityOf(categoryIds) {
  const direct = categoryIds.filter((id) => id !== "constraint.property");
  if (direct.length) return "tracker-relevant";
  if (categoryIds.includes("constraint.property")) return "supporting";
  return "none";
}

function confidenceOf(categories) {
  const tiers = categories.map((item) => item.tier);
  if (tiers.includes("manual-order-or-source-required")) return "manual-order-or-source-required";
  if (tiers.includes("specific-seat-rule") || tiers.includes("specific-log-rule")) return "log-and-skill-specific";
  if (tiers.includes("runtime-public-field")) return "runtime-public-field";
  if (tiers.includes("generic-log-rule")) return "generic-log-rule";
  if (tiers.includes("supporting-rule")) return "supporting-only";
  return "not-relevant";
}

function strategyOf(categoryIds, priority, confidence) {
  if (priority === "none") {
    return {
      id: "no-card-fact",
      exactIdentity: "none",
      runtimeRule: "ignore-skill-text"
    };
  }
  if (priority === "supporting") {
    return {
      id: "constraint-only",
      exactIdentity: "none",
      runtimeRule: "use-card-catalog-as-filter-only"
    };
  }
  if (confidence === "manual-order-or-source-required") {
    return {
      id: "order-or-source-sensitive",
      exactIdentity: "visible-or-protocol-card-id-only",
      runtimeRule: "plan-action-then-validate-live-behavior"
    };
  }
  if (categoryIds.some((id) => endpointOrderCategoryIds.has(id))) {
    return {
      id: "deck-endpoint-tracking",
      exactIdentity: "visible-or-protocol-card-id-only",
      runtimeRule: "track-known-endpoint-order-and-clear-when-unstable"
    };
  }
  if (categoryIds.some((id) => visibleIdentityCategoryIds.has(id))) {
    return {
      id: "visible-identity-tracking",
      exactIdentity: "visible-or-authorized-or-protocol-card-id-only",
      runtimeRule: "record-visible-fact-and-expire-on-hidden-move"
    };
  }
  if (categoryIds.includes("random.card.gain") || categoryIds.includes("deck.search")) {
    return {
      id: "protocol-listed-identity",
      exactIdentity: "protocol-card-id-only",
      runtimeRule: "use-skill-text-as-selection-context-only"
    };
  }
  if (categoryIds.some((id) => id.startsWith("public."))) {
    return {
      id: "public-zone-sync",
      exactIdentity: "public-runtime-field-or-protocol-card-id",
      runtimeRule: "sync-public-zone"
    };
  }
  return {
    id: "generic-protocol-movement",
    exactIdentity: "protocol-card-id-or-existing-known-source",
    runtimeRule: "follow-card-move-and-invalidate-hidden-unknowns"
  };
}

function reviewReasonsOf(categoryIds, sourceType, confidence) {
  const reasons = [];
  if (confidence === "manual-order-or-source-required") reasons.push("manual-order-or-source-required");
  for (const id of categoryIds) {
    if (liveValidationCategoryIds.has(id)) reasons.push(`category:${id}`);
  }
  if (sourceType === "mode-or-system" && categoryIds.length) reasons.push("mode-or-system-owner");
  return unique(reasons);
}

module.exports = {
  CATEGORY_RULE_DEFINITIONS,
  categoryRules,
  compileCategoryRules,
  categoriesForText,
  liveValidationCategoryIds,
  endpointOrderCategoryIds,
  visibleIdentityCategoryIds,
  unique,
  countBy,
  priorityOf,
  confidenceOf,
  strategyOf,
  reviewReasonsOf
};
