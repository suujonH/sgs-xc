function stripHtml(value) {
  return String(value == null ? "" : value)
    .replace(/<[^<>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function abbreviationRows(data) {
  if (Array.isArray(data?.abbreviation)) return data.abbreviation;
  if (Array.isArray(data?.abbreviation?.field)) return data.abbreviation.field;
  if (Array.isArray(data?.root?.abbreviation?.field)) return data.root.abbreviation.field;
  return [];
}

function tableRows(data, rootKey, rowKey) {
  const root = data?.[rootKey] || data;
  const rows = root?.[rowKey] || data?.[rowKey] || [];
  const abbreviations = new Map(abbreviationRows(data).map((item) => [item.Short, item.Long]));
  return Array.from(rows || []).map((row) => {
    const expanded = {};
    for (const [key, value] of Object.entries(row || {})) {
      expanded[abbreviations.get(key) || key] = value;
    }
    return expanded;
  });
}

function first(row, ...keys) {
  for (const key of keys) {
    if (row?.[key] != null && row[key] !== "") return row[key];
  }
  return undefined;
}

function rowId(row) {
  return Number(first(row, "id", "ID", "a", "spellid", "SpellId", "skillId") || 0);
}

function skillIdFromRow(row) {
  return Number(first(row, "spellid", "SpellId", "spellId", "skillid", "SkillId", "skillId", "id", "ID", "a") || 0);
}

function skillName(row) {
  return stripHtml(first(row, "H5_name", "name", "Name", "skillName", "SkillName", "c") || "");
}

function skillDesc(row) {
  return stripHtml(first(row, "desc", "describe", "Description", "Describe", "o") || "");
}

function cardSpellId(row) {
  return Number(first(row, "spellId", "SpellID", "spellid", "SpellId") || 0);
}

const suitMap = { 1: "♥", 2: "♦", 3: "♠", 4: "♣" };
const rankMap = { 1: "A", 11: "J", 12: "Q", 13: "K" };

function normalizedTypeCode(type) {
  const number = Number(type) || 0;
  if (number === 2) return 3;
  if (number === 3) return 4;
  return number;
}

function buildCardDict(rows, spellDict) {
  const cardDict = {};
  const cardIDsOrder = [];
  for (const row of rows) {
    const id = Number(row.id ?? row.cardId ?? row.CardID ?? row.ID ?? 0);
    if (!id) continue;
    const color = Number(row.color ?? 0);
    const number = Number(row.number ?? 0);
    const suit = suitMap[color] || "";
    const rank = rankMap[number] || (number ? String(number) : "");
    const name = stripHtml(row.name ?? row.Name ?? spellDict[row.spellId]?.name ?? "");
    const typeOriginal = Number(row.type ?? 0);
    const subType = Number(row.subType ?? row.SubType ?? 0);
    const spellId = Number(row.spellId ?? row.SpellID ?? 0);
    const spell = spellDict[spellId] || null;
    const isDelayedTrick = typeOriginal === 2 && subType === 5;
    const isOrdinaryTrick = typeOriginal === 2 && !isDelayedTrick;
    const isDamageCard = spell?.isDamageCard === true;
    const semanticTraits = [
      isDamageCard ? "damage-card" : "",
      isDelayedTrick ? "delayed-trick" : "",
      isOrdinaryTrick ? "ordinary-trick" : "",
      typeOriginal === 3 ? `equip-subtype:${subType}` : ""
    ].filter(Boolean);
    const item = {
      ...row,
      id,
      name,
      color,
      number,
      suit,
      rank,
      typeOriginal,
      type: normalizedTypeCode(typeOriginal),
      subType,
      spellId,
      spellClass: spell?.className || "",
      spellProperties: Array.from(spell?.properties || []),
      isDamageCard,
      isDelayedTrick,
      isOrdinaryTrick,
      equipSubtype: typeOriginal === 3 ? subType : null,
      semanticTraits,
      ncn: name + suit + rank,
      cn: name ? name.slice(0, 1) : "",
      colorSym: suit,
      numStr: rank
    };
    cardDict[id] = item;
    cardIDsOrder.push(id);
  }
  return { cardDict, cardIDsOrder };
}

function buildGameRuleDecks(data, defaultCardIds = []) {
  const rules = Array.from(data?.Root?.LogicRuleConfig?.GameRule || []);
  const standardDeckIds = uniquePositiveIds(defaultCardIds).filter((id) => id >= 1 && id <= 160);
  const gameRuleDecks = {};
  for (const rule of rules) {
    const attrs = rule?._attributes || {};
    const ruleId = Number(attrs.RuleId ?? attrs.RuleID ?? attrs.id ?? 0);
    if (!ruleId) continue;
    const explicit = parseIdList(rule?.PlayCardPile?._attributes?.List ?? rule?.PlayCardPile?.List);
    if (explicit.length) {
      gameRuleDecks[ruleId] = {
        ruleId,
        label: stripHtml(attrs.Desc || ""),
        source: "game-rule-play-card-pile",
        cardIds: explicit
      };
    }
  }
  if (!gameRuleDecks[22] && standardDeckIds.length) {
    gameRuleDecks[22] = {
      ruleId: 22,
      label: "rank-standard-160",
      source: "rank-default-standard-deck",
      cardIds: standardDeckIds.slice()
    };
  }
  return { standardDeckIds, gameRuleDecks };
}

function parseIdList(value) {
  if (Array.isArray(value)) return uniquePositiveIds(value);
  return uniquePositiveIds(String(value || "").split(/[;,\s]+/));
}

function uniquePositiveIds(value) {
  return Array.from(new Set(Array.from(value || []).map(Number).filter((id) => Number.isInteger(id) && id > 0)));
}

function buildSpellDict(rows) {
  const spellDict = {};
  const markSpell = {};
  for (const row of rows) {
    const id = Number(row.spellid ?? row.id ?? row.ID ?? row.SpellId ?? row.SkillId ?? 0);
    if (!id) continue;
    const name = stripHtml(row.H5_name || row.name || row.Name || row.skillName || "");
    const desc = stripHtml(row.desc ?? row.describe ?? row.Description ?? row.o ?? row.Describe ?? "");
    const properties = String(first(row, "Properties", "properties", "an") || "")
      .split(/[;,|\s]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    spellDict[id] = {
      id,
      name,
      desc,
      className: String(first(row, "Class", "className", "d") || ""),
      isDamageCard: Number(first(row, "dmgSpell", "DamageSpell", "am") || 0) !== 0,
      properties
    };
    if (/暗置|扣置|移出|武将牌上|判定区/.test(desc)) markSpell[id] = name;
  }
  return { spellDict, markSpell };
}

function isRealGeneral(row) {
  const id = rowId(row);
  if (!id) return false;
  if (!first(row, "name", "Name", "b")) return false;
  const className = String(first(row, "Class", "class", "className") || "");
  if (className.endsWith("Poker") || Number(first(row, "exType", "ExType") || 0) === 55) return false;
  const hasHp = first(row, "hp", "Hp", "HP", "maxhp") != null;
  const hasIdentity = first(row, "country", "Country") != null && first(row, "gender", "Gender") != null;
  const hasPlayableMarker =
    first(row, "GeneralEnable") != null ||
    first(row, "GeneralShopID") != null ||
    first(row, "RoleDesc") != null ||
    first(row, "RolePoint") != null;
  return hasHp && hasIdentity && hasPlayableMarker;
}

function generalName(row) {
  const base = stripHtml(first(row, "name", "Name", "b") || "").replaceAll("&", "");
  const prefix = stripHtml(first(row, "ai", "SpecifyName", "prefix") || "").replaceAll("&", "");
  if (!prefix || base.includes(prefix)) return base;
  return `${prefix}${base}`;
}

function rowSearchText(row) {
  return Object.values(row || {})
    .filter((value) => typeof value === "string" || typeof value === "number")
    .map(stripHtml)
    .filter(Boolean)
    .join(" ");
}

function buildSkillOwners(characterRows) {
  const skillOwners = new Map();
  const realGenerals = characterRows.filter(isRealGeneral);
  for (const row of realGenerals) {
    const owner = {
      generalId: rowId(row),
      name: generalName(row),
      className: stripHtml(first(row, "Class", "class", "className") || ""),
      slots: []
    };
    for (const [key, value] of Object.entries(row)) {
      if (!/^spellId\d+$/i.test(key)) continue;
      const skillId = Number(value || 0);
      if (!skillId) continue;
      const list = skillOwners.get(skillId) || [];
      const existing = list.find((item) => item.generalId === owner.generalId);
      if (existing) existing.slots.push(key);
      else list.push({ ...owner, slots: [key] });
      skillOwners.set(skillId, list);
    }
  }
  return { realGenerals, realGeneralRows: realGenerals, skillOwners };
}

function buildSkillExtends(spellExtendRows) {
  const skillExtends = new Map();
  for (const row of spellExtendRows) {
    const skillId = skillIdFromRow(row);
    if (!skillId) continue;
    const list = skillExtends.get(skillId) || [];
    list.push(row);
    skillExtends.set(skillId, list);
  }
  return skillExtends;
}

function sourceTypeFor(skillId, owners, cardSpellIds) {
  if (owners.length) return "general-skill";
  if (cardSpellIds.has(skillId)) return "play-card";
  return "mode-or-system";
}

module.exports = {
  stripHtml,
  abbreviationRows,
  tableRows,
  first,
  rowId,
  skillIdFromRow,
  skillName,
  skillDesc,
  cardSpellId,
  normalizedTypeCode,
  buildCardDict,
  buildGameRuleDecks,
  parseIdList,
  buildSpellDict,
  isRealGeneral,
  generalName,
  rowSearchText,
  buildSkillOwners,
  buildSkillExtends,
  sourceTypeFor
};
