import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const require = createRequire(import.meta.url);
const {
  stripHtml,
  tableRows,
  first,
  rowId,
  skillIdFromRow,
  skillName,
  skillDesc,
  cardSpellId,
  generalName,
  rowSearchText,
  buildSkillOwners,
  buildSkillExtends,
  sourceTypeFor
} = require("../../runtime/sources/config-table-core.cjs");
const {
  categoryRules,
  liveValidationCategoryIds,
  endpointOrderCategoryIds,
  visibleIdentityCategoryIds,
  legacySpecialSkills,
  legacySpecialById,
  unique,
  countBy,
  priorityOf,
  confidenceOf,
  strategyOf,
  reviewReasonsOf
} = require("../../runtime/tracker/skill-rule-core.cjs");
const candidateRuleCore = require("../../runtime/tracker/candidate-rule-core.cjs");
const { buildOrderSourceRuleSet } = require("../../runtime/tracker/order-source-rule-core.cjs");
const { buildMissingGeneralSkillRefReport } = require("../analysis/skill-audit-report.cjs");

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const outDir = process.env.SGS_SKILL_AUDIT_DIR || path.join(rootDir, "reports", "skill-audit");
const configUrl =
  process.env.SGS_CONFIG_URL ||
  "https://web.sanguosha.com/220/h5_2/res/config/Config_w.sgs";

const configFiles = ["cha_spell", "cha_spellextend", "character", "sys_playcard"];

function buildGeneralCatalog(realGenerals, skillsById) {
  return realGenerals
    .map((row) => {
      const skills = Object.entries(row)
        .filter(([key, value]) => /^spellId\d+$/i.test(key) && Number(value || 0))
        .sort((a, b) => Number(a[0].match(/\d+/)?.[0] || 0) - Number(b[0].match(/\d+/)?.[0] || 0))
        .map(([slot, value]) => {
          const id = Number(value || 0);
          const skill = skillsById.get(id);
          return {
            slot,
            id,
            name: skill?.name || "",
            sourceType: skill?.sourceType || "",
            priority: skill?.priority || "missing",
            confidence: skill?.confidence || "missing",
            strategy: skill?.strategy?.id || "missing",
            missing: !skill,
            legacySpecialRule: skill?.legacySpecialRule || "",
            categories: skill?.categories?.map((item) => item.id) || [],
            reviewReasons: skill?.reviewReasons || [],
            desc: skill?.desc || ""
          };
        });
      return {
        generalId: rowId(row),
        name: generalName(row),
        className: stripHtml(first(row, "Class", "class", "className") || ""),
        skillCount: skills.length,
        trackerRelevantSkillCount: skills.filter((skill) => skill.priority === "tracker-relevant").length,
        noCardFactSkillCount: skills.filter((skill) => skill.strategy === "no-card-fact").length,
        reviewSkillCount: skills.filter((skill) => skill.reviewReasons.length).length,
        skills
      };
    })
    .sort((a, b) => a.generalId - b.generalId || a.name.localeCompare(b.name));
}

function missingGeneralSkillReferences(generalCatalog, { skillExtends, cardSpellIds } = {}) {
  return generalCatalog.flatMap((general) =>
    general.skills
      .filter((skill) => skill.missing)
      .map((skill) => ({
        generalId: general.generalId,
        generalName: general.name,
        className: general.className,
        slot: skill.slot,
        skillId: skill.id,
        hasSpellExtendRows: (skillExtends?.get(skill.id) || []).length > 0,
        isPlayCardSpell: cardSpellIds?.has(skill.id) === true
      }))
  );
}

function buildAudit(decoded) {
  const spellRows = tableRows(decoded.cha_spell, "GameSpells", "spell");
  const characterRows = tableRows(decoded.character, "GameCharacters", "character");
  const cardRows = tableRows(decoded.sys_playcard, "GamePlayCards", "card");
  const spellExtendRows = [
    ...tableRows(decoded.cha_spellextend, "GameSpells", "spellextend"),
    ...tableRows(decoded.cha_spellextend, "ExtendParam", "spell")
  ];
  const { realGenerals, skillOwners } = buildSkillOwners(characterRows);
  const skillExtends = buildSkillExtends(spellExtendRows);
  const cardSpellIds = new Set(cardRows.map(cardSpellId).filter(Boolean));

  const skills = spellRows
    .map((row) => {
      const id = skillIdFromRow(row);
      const name = skillName(row);
      const desc = skillDesc(row);
      const extensions = skillExtends.get(id) || [];
      const text = `${name} ${desc} ${extensions.map(rowSearchText).join(" ")}`;
      const categories = categoryRules
        .filter((rule) => rule.re.test(text))
        .map((rule) => ({
          id: rule.id,
          label: rule.label,
          action: rule.action,
          tier: rule.tier
        }));
      const categoryIds = categories.map((item) => item.id);
      const owners = skillOwners.get(id) || [];
      const sourceType = sourceTypeFor(id, owners, cardSpellIds);
      const priority = priorityOf(categoryIds);
      const confidence = confidenceOf(categories);
      const strategy = strategyOf(categoryIds, priority, confidence);
      const legacySpecialRule = legacySpecialById.get(id)?.currentRule || "";
      const reviewReasons = reviewReasonsOf(categoryIds, sourceType, confidence);
      const candidateRules = candidateRuleCore.candidateRulesForText(text, { skillId: id, skillName: name });
      if (legacySpecialRule) reviewReasons.push(`legacy:${legacySpecialRule}`);
      return {
        id,
        name,
        desc,
        sourceType,
        owners,
        ownerCount: owners.length,
        isPlayCardSpell: cardSpellIds.has(id),
        extensionCount: extensions.length,
        extensions,
        categories,
        actions: unique(categories.map((item) => item.action)),
        priority,
        confidence,
        strategy,
        legacySpecialRule,
        candidateRules,
        reviewReasons
      };
    })
    .filter((skill) => skill.id || skill.name || skill.desc)
    .sort((a, b) => a.id - b.id || a.name.localeCompare(b.name));

  const categoryCounts = countBy(skills, (row) => row.categories.map((item) => item.id));
  const sourceTypeCounts = countBy(skills, (row) => row.sourceType);
  const priorityCounts = countBy(skills, (row) => row.priority);
  const confidenceCounts = countBy(skills, (row) => row.confidence);
  const relevantWithoutRuntimeOwner = skills.filter(
    (skill) => skill.priority === "tracker-relevant" && skill.sourceType === "mode-or-system"
  );
  const orderSourceSensitive = skills.filter((skill) => skill.confidence === "manual-order-or-source-required");
  const orderSourceRules = buildOrderSourceRuleSet(skills, { sampleLimit: 20 });
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const generalCatalog = buildGeneralCatalog(realGenerals, skillsById);
  const strategyCounts = countBy(skills, (row) => row.strategy.id);
  const reviewReasonCounts = countBy(skills, (row) => row.reviewReasons);
  const candidateRules = skills.flatMap((skill) => skill.candidateRules || []);
  const legacySpecialCandidateRules = legacySpecialSkills.filter((item) => item.operate === "candidate-filter");
  const legacySpecial = legacySpecialSkills.map((item) => {
    const skill = skillsById.get(item.spellId);
    return {
      ...item,
      name: skill?.name || "",
      sourceType: skill?.sourceType || "",
      owners: skill?.owners?.slice(0, 12).map((owner) => owner.name) || [],
      categories: skill?.categories?.map((category) => category.id) || [],
      strategy: skill?.strategy?.id || "not-present",
      desc: skill?.desc || ""
    };
  });
  const missingGeneralSkillRefs = missingGeneralSkillReferences(generalCatalog, { skillExtends, cardSpellIds });
  const missingGeneralSkillRefReport = buildMissingGeneralSkillRefReport(missingGeneralSkillRefs);

  return {
    ok: true,
    source: decoded.__sourceUrl || configUrl,
    generatedAt: new Date().toISOString(),
    counts: {
      totalSkills: skills.length,
      realGeneralRows: realGenerals.length,
      cardRows: cardRows.length,
      playCardSpellIds: cardSpellIds.size,
      spellExtendRows: spellExtendRows.length,
      trackerRelevant: skills.filter((skill) => skill.priority === "tracker-relevant").length,
      supporting: skills.filter((skill) => skill.priority === "supporting").length,
      none: skills.filter((skill) => skill.priority === "none").length,
      relevantModeOrSystem: relevantWithoutRuntimeOwner.length,
      orderSourceSensitive: orderSourceSensitive.length,
      orderSourceRules: orderSourceRules.count,
      manualReview: orderSourceSensitive.length,
      skillTextCandidateRuleSkills: skills.filter((skill) => skill.candidateRules?.length).length,
      skillTextCandidateRules: candidateRules.length,
      legacySpecialCandidateRules: legacySpecialCandidateRules.length,
      missingGeneralSkillRefs: missingGeneralSkillRefs.length,
      missingGeneralSkillRefUnresolved: missingGeneralSkillRefReport.counts.unresolved,
      missingGeneralSkillRefPlaceholderCandidates: missingGeneralSkillRefReport.counts.placeholderCandidates
    },
    sourceTypeCounts,
    priorityCounts,
    confidenceCounts,
    strategyCounts,
    reviewReasonCounts,
    candidateRuleCounts: {
      sourceRules: countBy(candidateRules, (rule) => rule.sourceRule || "unknown"),
      fields: countBy(candidateRules.flatMap(candidateRuleConstraints), (constraint) => constraint.field || "unknown"),
      appliesTo: countBy(candidateRules, (rule) => rule.appliesTo || "any")
    },
    categoryCounts,
    categoryRules: categoryRules.map(({ re, ...rule }) => rule),
    strategyRules: {
      liveValidationCategoryIds: Array.from(liveValidationCategoryIds),
      endpointOrderCategoryIds: Array.from(endpointOrderCategoryIds),
      visibleIdentityCategoryIds: Array.from(visibleIdentityCategoryIds)
    },
    legacySpecial,
    orderSourceRules,
    missingGeneralSkillRefs,
    missingGeneralSkillRefReport,
    orderSourceSensitive: orderSourceSensitive.map(compactSkill),
    manualReview: orderSourceSensitive.map(compactSkill),
    relevantModeOrSystem: relevantWithoutRuntimeOwner.map(compactSkill),
    generalCatalog,
    skills
  };
}

function compactSkill(skill) {
  return {
    id: skill.id,
    name: skill.name,
    sourceType: skill.sourceType,
    owners: skill.owners.slice(0, 8).map((owner) => owner.name),
    categories: skill.categories.map((item) => item.id),
    actions: skill.actions,
    strategy: skill.strategy.id,
    legacySpecialRule: skill.legacySpecialRule,
    reviewReasons: skill.reviewReasons,
    desc: skill.desc
  };
}

function escapeTsv(value) {
  return String(value == null ? "" : value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function makeTsv(audit) {
  const header = [
    "id",
    "name",
    "sourceType",
    "priority",
    "confidence",
    "ownerCount",
    "owners",
    "isPlayCardSpell",
    "extensionCount",
    "categories",
    "actions",
    "strategy",
    "legacySpecialRule",
    "candidateRuleCount",
    "candidateRules",
    "reviewReasons",
    "desc"
  ];
  return [
    header.join("\t"),
    ...audit.skills.map((skill) =>
      [
        skill.id,
        skill.name,
        skill.sourceType,
        skill.priority,
        skill.confidence,
        skill.ownerCount,
        skill.owners.map((owner) => `${owner.generalId}:${owner.name}`).join(","),
        skill.isPlayCardSpell ? "1" : "0",
        skill.extensionCount,
        skill.categories.map((item) => item.id).join(","),
        skill.actions.join(","),
        skill.strategy.id,
        skill.legacySpecialRule,
        skill.candidateRules?.length || 0,
        (skill.candidateRules || []).map(candidateRuleText).join(";"),
        skill.reviewReasons.join(","),
        skill.desc
      ].map(escapeTsv).join("\t")
    )
  ].join("\n");
}

function sampleLine(audit, categoryId, limit = 10) {
  const rows = audit.skills.filter((skill) => skill.categories.some((item) => item.id === categoryId)).slice(0, limit);
  if (!rows.length) return `- ${categoryId}: 0`;
  const sample = rows
    .map((skill) => {
      const owner = skill.owners.length ? ` (${skill.owners.slice(0, 4).map((item) => item.name).join("/")})` : "";
      return `${skill.id} ${skill.name}${owner}`;
    })
    .join("; ");
  return `- ${categoryId}: ${audit.categoryCounts[categoryId] || 0}. ${sample}`;
}

function missingGeneralSkillRefLines(audit) {
  if (!audit.missingGeneralSkillRefs?.length) return "- none";
  return audit.missingGeneralSkillRefs
    .map((item) => {
      const reportRow = audit.missingGeneralSkillRefReport?.rows?.find((row) =>
        Number(row.generalId) === Number(item.generalId) &&
        String(row.slot) === String(item.slot) &&
        Number(row.skillId) === Number(item.skillId)
      );
      const status = reportRow?.reviewStatus ? `; ${reportRow.reviewStatus}` : "";
      return `- ${item.generalId} ${item.generalName} (${item.className}) ${item.slot}: ${item.skillId}${status}`;
    })
    .join("\n");
}

function orderSourceRuleLines(orderSourceRules, limit = 40) {
  const rules = orderSourceRules?.rules || [];
  if (!rules.length) return "- none";
  return rules.slice(0, limit).map((rule) => {
    const owners = rule.owners?.length ? ` (${rule.owners.slice(0, 6).join("/")})` : "";
    const operations = (rule.operations || [])
      .map((item) => `${item.categoryId}:${item.operate}/${item.order}`)
      .join(" | ");
    const evidence = rule.evidenceChecks?.length ? rule.evidenceChecks.join(", ") : "none";
    return `- ${rule.spellId} ${rule.name}${owners}: operate=${rule.operate}; order=${rule.order}; primary=${rule.primaryOperate}/${rule.primaryOrder}; evidence=${evidence}; operations=${operations || "none"}`;
  }).join("\n");
}

function orderSourceRuleReviewSections(orderSourceRules) {
  const rules = orderSourceRules?.rules || [];
  if (!rules.length) return "- none\n";
  return rules.map((rule) => {
    const operations = (rule.operations || [])
      .map((item) => `  - ${item.categoryId}: operate=${item.operate}; order=${item.order}; action=${item.plannerAction}; evidence=${item.evidenceCheck}`)
      .join("\n");
    return `### ${rule.spellId} ${rule.name}

- owners: ${rule.owners?.join("/") || "none"}
- sourceType: ${rule.sourceType || "none"}
- strategy: ${rule.strategy || "none"}
- confidence: ${rule.confidence || "none"}
- operate: ${rule.operate || "none"}
- order: ${rule.order || "none"}
- primary: ${rule.primaryOperate || "none"} / ${rule.primaryOrder || "none"}
- requiredSources: ${rule.requiredSources?.join(", ") || "none"}
- evidenceChecks: ${rule.evidenceChecks?.join(", ") || "none"}
- categories: ${rule.categories?.join(", ") || "none"}
- desc: ${rule.desc || "none"}
- operations:
${operations || "  - none"}
`;
  }).join("\n");
}

function makeSummary(audit) {
  const categoryLines = Object.entries(audit.categoryCounts)
    .slice(0, 40)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
  const highRisk = [
    "hand.watch",
    "deck.bottom.reveal",
    "deck.bottom.put",
    "deck.random.put",
    "deck.shuffle",
    "judgement.replace",
    "judgement.gain",
    "resolved.card.gain",
    "random.card.gain",
    "virtual.transform",
    "public.general"
  ].map((categoryId) => sampleLine(audit, categoryId)).join("\n");

  return `# SGS Skill Rule Audit

Generated: ${audit.generatedAt}

Source: ${audit.source}

## Counts

- totalSkills: ${audit.counts.totalSkills}
- realGeneralRows: ${audit.counts.realGeneralRows}
- cardRows: ${audit.counts.cardRows}
- playCardSpellIds: ${audit.counts.playCardSpellIds}
- spellExtendRows: ${audit.counts.spellExtendRows}
- trackerRelevant: ${audit.counts.trackerRelevant}
- supporting: ${audit.counts.supporting}
- none: ${audit.counts.none}
- relevantModeOrSystem: ${audit.counts.relevantModeOrSystem}
- orderSourceSensitive: ${audit.counts.orderSourceSensitive}
- orderSourceRules: ${audit.counts.orderSourceRules}
- manualReview: ${audit.counts.manualReview} (legacy alias)
- skillTextCandidateRuleSkills: ${audit.counts.skillTextCandidateRuleSkills}
- skillTextCandidateRules: ${audit.counts.skillTextCandidateRules}
- legacySpecialCandidateRules: ${audit.counts.legacySpecialCandidateRules}
- missingGeneralSkillRefs: ${audit.counts.missingGeneralSkillRefs}
- missingGeneralSkillRefUnresolved: ${audit.counts.missingGeneralSkillRefUnresolved}
- missingGeneralSkillRefPlaceholderCandidates: ${audit.counts.missingGeneralSkillRefPlaceholderCandidates}

## Source Types

${Object.entries(audit.sourceTypeCounts).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Confidence

${Object.entries(audit.confidenceCounts).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Strategy

${Object.entries(audit.strategyCounts).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Candidate Rules

Skill text candidate rules are generated with the same parser used by the runtime config loader. They can narrow candidates by card name, type, color, suit, or number, but they do not create exact card identity.

### Source Rules

${Object.entries(audit.candidateRuleCounts.sourceRules).map(([key, value]) => `- ${key}: ${value}`).join("\n") || "- none"}

### Fields

${Object.entries(audit.candidateRuleCounts.fields).map(([key, value]) => `- ${key}: ${value}`).join("\n") || "- none"}

## Category Counts

${categoryLines}

## Order/Source Sensitive Queues

${highRisk}

## Order/Source Rule Objects

${orderSourceRuleLines(audit.orderSourceRules, 20)}

## Missing General Skill References

${missingGeneralSkillRefLines(audit)}

Missing skill slots do not create card facts because their ids are absent from \`cha_spell.sgs\`. The machine-readable split is written to \`missing-general-skill-refs-current.json\`.

## Rule Direction

- Use real rows from \`character.sgs -> GameCharacters.character\` for general ownership. Rows without a playable general shape, such as card display rows, are not ownership evidence.
- Use \`sys_playcard.sgs -> spellId\` to identify play-card and equipment skills.
- Use \`cha_spell.sgs\` as the skill text source and merge \`cha_spellextend.sgs\` rows by skill id.
- Use generic protocol/log rules for exact card movement, hand reveal/watch, judgement, pindian, recast, and public zones.
- Use per-skill rules only for effects that change generic source/destination semantics, such as deck-bottom draw or deck order changes.
- Keep unknown hidden cards as counts. Do not invent card identity from skill text alone.
`;
}

function makePlaybook(audit) {
  const strategyLines = Object.entries(audit.strategyCounts)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
  const legacyLines = audit.legacySpecial
    .map((item) => {
      const name = item.name || "not-present";
      const owners = item.owners.length ? ` (${item.owners.join("/")})` : "";
      const zoneRemove = item.zoneRemove?.order ? `; zoneRemove=${item.zoneRemove.operate}/${item.zoneRemove.order}` : "";
      const sourceZones = item.sourceZones?.length ? `; sourceZones=${item.sourceZones.join(",")}` : "";
      return `- ${item.oldHex} / ${item.spellId}: ${name}${owners} -> ${item.currentRule}; operate=${item.operate}; order=${item.order}${sourceZones}${zoneRemove}`;
    })
    .join("\n");
  const manualLines = orderSourceRuleLines(audit.orderSourceRules);
  const ruleLines = categoryRules
    .map((rule) => `- ${rule.id}: ${rule.action}; tier=${rule.tier}`)
    .join("\n");

  return `# SGS Skill Rule Playbook

Generated: ${audit.generatedAt}

Source: ${audit.source}

## Confirmation Scope

- Skills: ${audit.counts.totalSkills}
- Playable general rows: ${audit.counts.realGeneralRows}
- Card rows: ${audit.counts.cardRows}
- Spell extension rows: ${audit.counts.spellExtendRows}
- General skill refs missing from \`cha_spell.sgs\`: ${audit.counts.missingGeneralSkillRefs}
- Missing ref unresolved rows: ${audit.counts.missingGeneralSkillRefUnresolved}
- Missing ref placeholder candidates: ${audit.counts.missingGeneralSkillRefPlaceholderCandidates}
- Skill text candidate rule skills: ${audit.counts.skillTextCandidateRuleSkills}
- Skill text candidate rules: ${audit.counts.skillTextCandidateRules}
- Legacy special candidate rules: ${audit.counts.legacySpecialCandidateRules}

Every skill is assigned one strategy. The strategy decides how the tracker may use the skill text; exact card identity still requires visible UI, authorized visibility, public runtime fields, or protocol card ids.

## Strategy Counts

${strategyLines}

## Strategy Meaning

- no-card-fact: the skill may affect rules, damage, distance, limits, HP, marks, or skill ownership, but it does not create a card identity fact.
- constraint-only: the text contains card properties such as color, suit, number, or type; these narrow candidates only.
- generic-protocol-movement: normal card movement is enough; hidden unknowns invalidate known hand facts when needed.
- public-zone-sync: public equipment, judge, discard, or general-card zones must be synced from protocol and runtime public fields.
- visible-identity-tracking: record identity only when the card is visible, authorized, or listed by protocol.
- deck-endpoint-tracking: preserve known top or bottom order only while the endpoint order is observable and stable.
- protocol-listed-identity: random/search effects use skill text as context only; exact identity needs protocol ids.
- order-or-source-sensitive: live behavior must be verified because source, order, or endpoint matters.

## Category To Action

${ruleLines}

## Legacy Special Mapping

${legacyLines}

## Candidate Rule Fields

${Object.entries(audit.candidateRuleCounts.fields).map(([key, value]) => `- ${key}: ${value}`).join("\n") || "- none"}

## Order/Source Sensitive Queue

${manualLines || "- none"}

## Generated Files

- skill-catalog-current.json: all skill text and owners.
- skill-rule-audit-current.json: all skill categories, strategies, and review reasons.
- skill-rule-audit-current.tsv: table-friendly all-skill review.
- general-skill-current.json: playable general rows with their skill strategies.
- skill-rule-playbook-current.md: this rule playbook.
`;
}

function ownersText(skill, limit = 8) {
  if (!skill.owners?.length) return "none";
  const names = skill.owners.slice(0, limit).map((owner) => typeof owner === "string" ? owner : owner.name).join("/");
  return skill.owners.length > limit ? `${names}/...` : names;
}

function categoryText(skill) {
  return (skill.categories || []).map((item, index) => {
    if (typeof item === "string") {
      const action = skill.actions?.[index] || "";
      return action ? `${item} -> ${action}` : item;
    }
    return `${item.id} -> ${item.action}`;
  }).join("; ") || "none";
}

function categoryQueue(audit, categoryId) {
  return audit.skills
    .filter((skill) => skill.categories.some((item) => item.id === categoryId))
    .map((skill) => {
      const owners = ownersText(skill, 6);
      return `- ${skill.id} ${skill.name} (${owners}): ${categoryText(skill)}; strategy=${skill.strategy.id}; desc=${skill.desc || "none"}`;
    })
    .join("\n") || "- none";
}

function makeRuleReview(audit) {
  const strategyLines = Object.entries(audit.strategyCounts)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
  const categoryLines = Object.entries(audit.categoryCounts)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
  const manualLines = orderSourceRuleReviewSections(audit.orderSourceRules);
  const legacyLines = audit.legacySpecial
    .map((item) => `### ${item.oldHex} / ${item.spellId} ${item.name || "not-present"}

- currentRule: ${item.currentRule}
- operate: ${item.operate}
- order: ${item.order}
- sourceZones: ${item.sourceZones?.length ? item.sourceZones.join(", ") : "none"}
- zoneRemove: ${item.zoneRemove?.order ? `${item.zoneRemove.operate}/${item.zoneRemove.order}` : "none"}
- owners: ${item.owners.length ? item.owners.join("/") : "none"}
- sourceType: ${item.sourceType || "none"}
- strategy: ${item.strategy}
- categories: ${item.categories.join(", ") || "none"}
- desc: ${item.desc || "none"}
`)
    .join("\n");
  const actionLines = categoryRules
    .map((rule) => `- ${rule.id}: ${rule.action}; tier=${rule.tier}; label=${rule.label}`)
    .join("\n");
  const identityQueueIds = [
    "hand.watch",
    "hand.show",
    "resolved.card.gain",
    "random.card.gain",
    "deck.search"
  ];
  const identityQueueSections = identityQueueIds
    .map((categoryId) => `### ${categoryId} (${audit.categoryCounts[categoryId] || 0})

${categoryQueue(audit, categoryId)}
`)
    .join("\n");

  return `# SGS Card Tracker Rule Review

Generated: ${audit.generatedAt}

Source: ${audit.source}

## Full Scope Confirmation

- Skills from \`cha_spell.sgs\`: ${audit.counts.totalSkills}
- Spell extension rows from \`cha_spellextend.sgs\`: ${audit.counts.spellExtendRows}
- Playable general rows from \`character.sgs\`: ${audit.counts.realGeneralRows}
- Card rows from \`sys_playcard.sgs\`: ${audit.counts.cardRows}
- Play-card spell ids from card settings: ${audit.counts.playCardSpellIds}
- Every skill row is assigned exactly one tracker strategy in \`skill-rule-audit-current.json\`.
- General skill references missing from \`cha_spell.sgs\`: ${audit.counts.missingGeneralSkillRefs}.
- Missing reference unresolved rows: ${audit.counts.missingGeneralSkillRefUnresolved}.
- Missing reference placeholder candidates: ${audit.counts.missingGeneralSkillRefPlaceholderCandidates}.
- Skill text candidate rule skills: ${audit.counts.skillTextCandidateRuleSkills}.
- Skill text candidate rules: ${audit.counts.skillTextCandidateRules}.
- Legacy special candidate rules: ${audit.counts.legacySpecialCandidateRules}.

## Rule Boundary

- Skill text is used to classify what kind of event occurred.
- Exact card identity must come from protocol card ids, visible UI, authorized visibility, or public runtime fields.
- Hidden opponent \`handCards\` are not valid known-card evidence.
- Unknown hidden cards stay as counts or constraints until a later exact source identifies them.
- Candidate rules may display guesses for card name, type, color, suit, or number only when the runtime candidate threshold is reached.

## Strategy Counts

${strategyLines}

## Category Counts

${categoryLines}

## Category Actions

${actionLines}

## Candidate Rule Counts

### Fields

${Object.entries(audit.candidateRuleCounts.fields).map(([key, value]) => `- ${key}: ${value}`).join("\n") || "- none"}

### Applies To

${Object.entries(audit.candidateRuleCounts.appliesTo).map(([key, value]) => `- ${key}: ${value}`).join("\n") || "- none"}

## Direct Identity Source Queues

These queues are the main places where a skill can produce a card identity fact. The rule still requires protocol ids, visible UI, authorized visibility, or public runtime fields before rendering a card as known.

${identityQueueSections}

## Missing General Skill References

These character skill slots point to ids that are not present in \`cha_spell.sgs\`; they have no skill text and do not create card facts.

${missingGeneralSkillRefLines(audit)}

Use \`missing-general-skill-refs-current.json\` for the machine-readable split. Rows with \`reviewStatus=needs-config-confirmation\` need config/source confirmation before they can be treated as covered skills. Rows with \`reviewStatus=placeholder-candidate\` remain excluded from card facts unless a future \`cha_spell.sgs\` row appears.

## Order/Source Sensitive Skills

These skills need live \`TableGameScene\` validation before stronger automatic rules are added, because source, order, or deck endpoint semantics can differ from plain movement logs.

${manualLines || "- none\n"}

## Legacy Special Branches

These are the old hard-coded \`spellId\` branches mapped against the current config. Keep the behavior idea, but do not hardcode stale names without this mapping.

${legacyLines || "- none\n"}

## Generated Evidence Files

- \`skill-rule-audit-current.json\`: complete per-skill strategy, categories, owners, descriptions, and review reasons.
- \`skill-rule-audit-current.tsv\`: table-friendly full review of every skill.
- \`general-skill-current.json\`: playable general rows and their owned skill strategies.
- \`missing-general-skill-refs-current.json\`: missing playable-general skill slots split by review status.
- \`skill-rule-playbook-current.md\`: compact action playbook.
- \`summary.md\`: current counts and queue samples.
`;
}

async function readDecodedConfigFiles() {
  const expression = `((async () => {
    const names = ${JSON.stringify(configFiles)};
    const fflateApi = typeof fflate !== "undefined" ? fflate : window.fflate;
    const ctrApi = typeof CtrUtil !== "undefined" ? CtrUtil : window.CtrUtil;
    if (!fflateApi) throw new Error("fflate is not available in page runtime");
    if (!ctrApi?.Ctr?.Ofb_Dec) throw new Error("CtrUtil.Ctr.Ofb_Dec is not available in page runtime");
    const configItem = window.RES?.GetGroupByName?.("config")?.[0];
    const url = configItem?.url ? new URL(configItem.url, location.href).href : ${JSON.stringify(configUrl)};
    const response = await fetch(url);
    if (!response.ok) throw new Error("fetch config failed: " + response.status);
    const zip = fflateApi.unzipSync(new Uint8Array(await response.arrayBuffer()));
    const result = {};
    for (const name of names) {
      const raw = zip[name + ".sgs"];
      if (!raw) throw new Error("Missing config file: " + name + ".sgs");
      const decrypted = ctrApi.Ctr.Ofb_Dec(raw.buffer);
      const decompressed = fflateApi.gunzipSync(new Uint8Array(decrypted));
      result[name] = new TextDecoder().decode(decompressed);
    }
    result.__sourceUrl = url;
    return result;
  })())`;
  const { value } = await evaluateOnSgs(expression, { timeoutMs: 60000, cdpTimeoutMs: 90000 });
  const parsed = { __sourceUrl: value.__sourceUrl };
  for (const file of configFiles) parsed[file] = JSON.parse(value[file]);
  return parsed;
}

await mkdir(outDir, { recursive: true });
const decoded = await readDecodedConfigFiles();
const audit = buildAudit(decoded);

const catalog = {
  ok: true,
  source: audit.source,
  generatedAt: audit.generatedAt,
  counts: {
    skills: audit.counts.totalSkills,
    realGeneralRows: audit.counts.realGeneralRows,
    cardRows: audit.counts.cardRows,
    spellExtendRows: audit.counts.spellExtendRows
  },
  skills: audit.skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    desc: skill.desc,
    sourceType: skill.sourceType,
    owners: skill.owners,
    isPlayCardSpell: skill.isPlayCardSpell,
    extensionCount: skill.extensionCount,
    strategy: skill.strategy,
    legacySpecialRule: skill.legacySpecialRule,
    candidateRules: skill.candidateRules,
    reviewReasons: skill.reviewReasons
  }))
};

const catalogPath = path.join(outDir, "skill-catalog-current.json");
const auditPath = path.join(outDir, "skill-rule-audit-current.json");
const tsvPath = path.join(outDir, "skill-rule-audit-current.tsv");
const summaryPath = path.join(outDir, "summary.md");
const generalCatalogPath = path.join(outDir, "general-skill-current.json");
const missingGeneralSkillRefsPath = path.join(outDir, "missing-general-skill-refs-current.json");
const playbookPath = path.join(outDir, "skill-rule-playbook-current.md");
const ruleReviewPath = path.join(outDir, "rule-review-current.md");

await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
await writeFile(tsvPath, `${makeTsv(audit)}\n`, "utf8");
await writeFile(summaryPath, makeSummary(audit), "utf8");
await writeFile(generalCatalogPath, `${JSON.stringify({
  ok: true,
  source: audit.source,
  generatedAt: audit.generatedAt,
  counts: {
    realGeneralRows: audit.counts.realGeneralRows,
    generalRowsWithSkills: audit.generalCatalog.filter((general) => general.skillCount > 0).length,
    generalRowsWithRelevantSkills: audit.generalCatalog.filter((general) => general.trackerRelevantSkillCount > 0).length,
    missingGeneralSkillRefs: audit.counts.missingGeneralSkillRefs
  },
  generals: audit.generalCatalog
}, null, 2)}\n`, "utf8");
await writeFile(missingGeneralSkillRefsPath, `${JSON.stringify({
  ok: true,
  source: audit.source,
  generatedAt: audit.generatedAt,
  ...audit.missingGeneralSkillRefReport
}, null, 2)}\n`, "utf8");
await writeFile(playbookPath, makePlaybook(audit), "utf8");
await writeFile(ruleReviewPath, makeRuleReview(audit), "utf8");

console.log(JSON.stringify({
  ok: true,
  outDir,
  catalogPath,
  auditPath,
  tsvPath,
  summaryPath,
  generalCatalogPath,
  missingGeneralSkillRefsPath,
  playbookPath,
  ruleReviewPath,
  counts: audit.counts,
  sourceTypeCounts: audit.sourceTypeCounts,
  confidenceCounts: audit.confidenceCounts,
  strategyCounts: audit.strategyCounts,
  candidateRuleCounts: audit.candidateRuleCounts
}, null, 2));

function candidateRuleText(rule) {
  const display = rule.display || "";
  const fields = candidateRuleConstraints(rule)
    .map((constraint) => `${constraint.field}:${(constraint.values || []).join("/")}`)
    .join("+");
  return [display, fields].filter(Boolean).join("=");
}

function candidateRuleConstraints(rule) {
  return [
    ...(rule.constraints || []),
    ...(rule.alternatives || []).flatMap((alternative) => alternative?.constraints || [])
  ];
}
