import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const auditPath = process.env.SGS_SKILL_AUDIT_FILE || path.join(rootDir, "reports", "skill-audit", "skill-rule-audit-current.json");
const overridesPath = process.env.SGS_SKILL_KNOWLEDGE_OVERRIDES || path.join(rootDir, "data", "skill-knowledge-overrides.json");
const reviewsDir = process.env.SGS_SKILL_KNOWLEDGE_REVIEWS_DIR || path.join(rootDir, "data", "skill-reviews");
const outDir = process.env.SGS_SKILL_KNOWLEDGE_OUT_DIR || path.join(rootDir, "reports", "skill-research");
const outPath = path.join(outDir, "skill-knowledge-current.json");
const summaryPath = path.join(outDir, "summary.md");

const audit = JSON.parse(await readFile(auditPath, "utf8"));
const overrides = JSON.parse(await readFile(overridesPath, "utf8"));
overrides.skills ||= {};
const reviewFilesById = new Map();
for (const file of (await readdir(reviewsDir).catch(() => [])).filter((item) => item.endsWith(".json")).sort()) {
  const reviewPath = path.join(reviewsDir, file);
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  for (const [id, row] of Object.entries(review.skills || {})) {
    if (!/^\d+$/.test(id)) continue;
    if (reviewFilesById.has(id)) {
      throw new Error(`Duplicate skill review ${id}: ${reviewFilesById.get(id)} and ${reviewPath}`);
    }
    reviewFilesById.set(id, reviewPath);
    overrides.skills[id] = { ...(overrides.skills[id] || {}), ...row };
  }
}
const skills = Array.from(audit.skills || []);
const uniqueIds = new Set(skills.map((skill) => Number(skill.id)));
const catalogFingerprint = createHash("sha256")
  .update(JSON.stringify(skills.map((skill) => [skill.id, skill.name, skill.desc, skill.sourceType, skill.owners])))
  .digest("hex");
const referenceBaselineCount = Number(process.env.SGS_SKILL_REFERENCE_BASELINE || 3027);
if (!skills.length || uniqueIds.size !== skills.length) {
  throw new Error(`Invalid skill catalog: rows=${skills.length}, unique=${uniqueIds.size}`);
}

const rows = skills.map(buildRow);
const signatureCount = new Set(rows.map((row) => row.taxonomy.categories.slice().sort().join("+"))).size;
const counts = countBy(rows, (row) => row.reviewStatus);
const executableCounts = countBy(rows, (row) => row.executableRuleStatus);
const priorityCounts = countBy(rows, (row) => row.researchPriority);
const researchedCount = rows.filter((row) => row.reviewStatus === "researched" || row.reviewStatus === "runtime-verified").length;
const conflictCount = rows.filter((row) => row.reviewStatus === "conflicted").length;
const runtimeVerifiedCount = rows.filter((row) => row.reviewStatus === "runtime-verified").length;
const executableCount = rows.filter((row) => ["implemented-in-core", "query-implemented-in-core", "complete"].includes(row.executableRuleStatus)).length;
const verifiedRawChaSpellGapIds = rows
  .filter((row) => row.researchDetails?.runtimeBinding?.rawChaSpellAbsenceVerified === true)
  .map((row) => row.id)
  .sort((left, right) => left - right);
const pendingRows = rows
  .filter((row) => !["researched", "runtime-verified"].includes(row.reviewStatus) || row.openQuestions.length > 0)
  .sort((a, b) => priorityRank(a.researchPriority) - priorityRank(b.researchPriority) || a.id - b.id);

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sources: { auditPath, overridesPath, reviewsDir },
  catalogVersion: {
    referenceBaselineCount,
    currentCount: rows.length,
    delta: rows.length - referenceBaselineCount,
    changed: rows.length !== referenceBaselineCount,
    fingerprint: catalogFingerprint,
    verifiedRawChaSpellGapCount: verifiedRawChaSpellGapIds.length,
    verifiedRawChaSpellGapIds
  },
  coverage: {
    catalog: { reviewed: rows.length, total: rows.length, complete: true },
    semantic: { reviewed: researchedCount, total: rows.length, complete: researchedCount === rows.length },
    executable: { reviewed: executableCount, total: rows.length, complete: executableCount === rows.length },
    runtimeEvidence: { reviewed: runtimeVerifiedCount, total: rows.length, complete: runtimeVerifiedCount === rows.length },
    conflicts: conflictCount,
    pending: pendingRows.length
  },
  counts: {
    reviewStatus: counts,
    executableRuleStatus: executableCounts,
    researchPriority: priorityCounts
  },
  knownTaxonomyLimitations: {
    taxonomyCoverageIsSemanticCoverage: false,
    signatureCount,
    noCardFactConflictIds: rows.filter((row) => row.conflictReasons.includes("no-card-fact-with-card-candidate")).map((row) => row.id)
  },
  pendingQueue: pendingRows.map((row) => ({
    id: row.id,
    name: row.name,
    reviewStatus: row.reviewStatus,
    researchPriority: row.researchPriority,
    conflictReasons: row.conflictReasons,
    reviewFlags: row.reviewFlags,
    openQuestions: row.openQuestions
  })),
  skills: rows
};

await mkdir(outDir, { recursive: true });
await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
await writeFile(summaryPath, buildSummary(result), "utf8");
console.log(JSON.stringify({ ok: true, outPath, summaryPath, coverage: result.coverage, counts: result.counts }, null, 2));

function buildRow(skill) {
  const id = Number(skill.id);
  const override = overrides.skills?.[id] || {};
  const categories = Array.from(skill.categories || []).map((item) => item.id || item).filter(Boolean);
  const candidateRules = Array.from(skill.candidateRules || []);
  const strategyId = skill.strategy?.id || "missing";
  const conflictReasons = [];
  const reviewFlags = [];
  if (strategyId === "no-card-fact" && candidateRules.length > 0) {
    conflictReasons.push("no-card-fact-with-card-candidate");
  }
  if (strategyId === "no-card-fact" && /(?:交给|获得|弃置|摸|展示|观看|置于|牌堆|弃牌堆|判定|拼点|重铸|手牌|【[^】]+】)/.test(skill.desc || "")) {
    reviewFlags.push("no-card-fact-text-needs-human-review");
  }
  const reviewStatus = override.reviewStatus || (conflictReasons.length ? "conflicted" : "unreviewed");
  const openQuestions = Array.from(override.openQuestions || []);
  const owners = resolvedOwners(skill, override);
  const sourceType = String(override.sourceType || skill.sourceType || "");
  return {
    id,
    name: skill.name || "",
    desc: skill.desc || "",
    sourceType,
    owners,
    ruleIdentity: buildRuleIdentity(skill, override, owners, sourceType),
    catalogReview: {
      status: "config-text-loaded",
      source: "Config_w.sgs/cha_spell+cha_spellextend",
      taxonomyOnly: true
    },
    catalogEvidence: {
      owners: Array.from(skill.owners || []),
      ownerCount: Number(skill.ownerCount || 0),
      extensions: Array.from(skill.extensions || []),
      extensionCount: Number(skill.extensionCount || 0),
      isPlayCardSpell: skill.isPlayCardSpell === true
    },
    reviewStatus,
    confidence: override.confidence || "unreviewed",
    researchPriority: researchPriority(skill, conflictReasons, reviewFlags, openQuestions),
    mechanicSummary: override.mechanicSummary || "",
    executableRuleStatus: override.executableRuleStatus || "not-modeled",
    rule: override.rule || null,
    sources: override.sources || [
      { kind: "current-config", path: "Config_w.sgs/cha_spell", note: `skill ${id} current text` }
    ],
    openQuestions,
    reviewFile: reviewFilesById.get(String(id)) || null,
    researchDetails: researchDetails(override),
    conflictReasons,
    reviewFlags,
    taxonomy: {
      categories,
      strategy: skill.strategy || null,
      priority: skill.priority || "",
      confidence: skill.confidence || "",
      candidateRules,
      warning: "taxonomy is a search index, not executable semantics"
    }
  };
}

function resolvedOwners(skill, override) {
  const reviewed = Array.isArray(override.owner)
    ? override.owner
    : Array.isArray(override.owners)
      ? override.owners
      : [];
  const source = reviewed.length ? reviewed : Array.from(skill.owners || []);
  const byId = new Map();
  for (const owner of source) {
    const id = Number(owner?.generalId || owner?.id || 0);
    if (id > 0) byId.set(id, owner);
  }
  return Array.from(byId.entries()).sort(([left], [right]) => left - right).map(([, owner]) => owner);
}

function buildRuleIdentity(skill, override, owners, sourceType) {
  const ownerIds = owners.map((owner) => Number(owner.generalId || owner.id || 0)).filter((id) => id > 0);
  const versionScope = override.versionScope || {};
  const product = String(versionScope.product || "sgs-web-h5");
  const clientPath = String(versionScope.clientPath || versionScope.configPath || "1/220/h5_2");
  const mode = versionScope.mode == null ? null : String(versionScope.mode);
  const ownerOrMode = ownerIds.length
    ? `owners:${ownerIds.join(",")}`
    : mode
      ? `mode:${mode}`
      : `scope:${sourceType || "unknown"}`;
  return {
    skillId: Number(skill.id),
    product,
    clientPath,
    catalogFingerprint,
    ownerIds,
    sourceType,
    mode,
    key: `${product}:${clientPath}:${catalogFingerprint}:${Number(skill.id)}:${ownerOrMode}`
  };
}

function researchDetails(override) {
  const standardFields = new Set([
    "reviewStatus", "confidence", "mechanicSummary", "executableRuleStatus", "rule", "sources", "openQuestions"
  ]);
  return Object.fromEntries(
    Object.entries(override || {})
      .filter(([key]) => !standardFields.has(key))
      .map(([key, value]) => [key, value])
  );
}

function researchPriority(skill, conflicts, reviewFlags, openQuestions) {
  if (conflicts.length) return "p0-conflict";
  if (openQuestions.length) return "p0-open-question";
  if (reviewFlags.length) return "p1-no-card-suspect";
  if (skill.confidence === "manual-order-or-source-required" || skill.strategy?.id === "order-or-source-sensitive") return "p0-order-source";
  const categories = new Set(Array.from(skill.categories || []).map((item) => item.id || item));
  if (["deck.search", "deck.shuffle", "draw.bottom", "deck.top.put", "deck.bottom.put", "judgement.replace"].some((id) => categories.has(id))) {
    return "p1-deck-semantics";
  }
  if (["discard.zone", "hand.watch", "hand.show", "random.card.gain", "virtual.transform", "pindian"].some((id) => categories.has(id))) {
    return "p2-identity-semantics";
  }
  if (skill.strategy?.id === "no-card-fact") return "p4-no-card-audit";
  return "p3-generic-movement";
}

function priorityRank(value) {
  return {
    "p0-conflict": 0,
    "p0-open-question": 1,
    "p0-order-source": 2,
    "p1-deck-semantics": 3,
    "p1-no-card-suspect": 4,
    "p2-identity-semantics": 5,
    "p3-generic-movement": 6,
    "p4-no-card-audit": 7
  }[value] ?? 99;
}

function countBy(items, keyFn) {
  const result = {};
  for (const item of items) {
    const key = keyFn(item) || "missing";
    result[key] = (result[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function buildSummary(value) {
  const coverage = value.coverage;
  const reviewRows = Object.entries(value.counts.reviewStatus).map(([key, count]) => `| ${key} | ${count} |`).join("\n");
  const priorityRows = Object.entries(value.counts.researchPriority).map(([key, count]) => `| ${key} | ${count} |`).join("\n");
  return `# Skill Knowledge Coverage\n\nGenerated: ${value.generatedAt}\n\nReference baseline: ${value.catalogVersion.referenceBaselineCount}\n\nCurrent generated catalog: ${value.catalogVersion.currentCount} (delta ${value.catalogVersion.delta >= 0 ? "+" : ""}${value.catalogVersion.delta})\n\nVerified current catalog identities absent from the raw cha_spell snapshot: ${value.catalogVersion.verifiedRawChaSpellGapCount} (${value.catalogVersion.verifiedRawChaSpellGapIds.join(", ") || "none"})\n\n## Coverage\n\n| Layer | Reviewed | Total | Complete |\n|---|---:|---:|---|\n| Catalog identity/text loaded | ${coverage.catalog.reviewed} | ${coverage.catalog.total} | ${coverage.catalog.complete} |\n| Semantic research | ${coverage.semantic.reviewed} | ${coverage.semantic.total} | ${coverage.semantic.complete} |\n| Executable rule | ${coverage.executable.reviewed} | ${coverage.executable.total} | ${coverage.executable.complete} |\n| Runtime evidence | ${coverage.runtimeEvidence.reviewed} | ${coverage.runtimeEvidence.total} | ${coverage.runtimeEvidence.complete} |\n\nConflicts: ${coverage.conflicts}\n\nPending: ${coverage.pending}\n\nTaxonomy coverage is not semantic coverage. The ${value.knownTaxonomyLimitations.signatureCount} signatures contain only sorted category IDs and do not encode trigger, source, destination, count, order, failure, duration, or deck-cycle behavior.\n\n## Review status\n\n| Status | Count |\n|---|---:|\n${reviewRows}\n\n## Research priority\n\n| Priority | Count |\n|---|---:|\n${priorityRows}\n`;
}
