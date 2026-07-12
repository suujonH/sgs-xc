import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const runtimeDir = path.join(rootDir, "src", "runtime");
const skillKnowledgePath = path.join(rootDir, "reports", "skill-research", "skill-knowledge-current.json");

const runtimeFiles = [
  "00-namespace.js",
  "lib/laya-utils.js",
  "sources/config-source.js",
  "sources/table-scene-source.js",
  "sources/recording-storage.js",
  "sources/protocol-source.js",
  "sources/mask-hand-source.js",
  "sources/public-zone-source.js",
  "model/game-model.js",
  "tracker/known-hand-ledger.js",
  "tracker/protocol-zone-ledger.js",
  "tracker/rule-planner.js",
  "tracker/fact-store.js",
  "entry.js"
];

const commonJsModules = [
  {
    file: "sources/config-table-core.cjs",
    name: "configTableCore"
  },
  {
    file: "sources/protocol-normalizer-core.cjs",
    name: "protocolNormalizerCore"
  },
  {
    file: "sources/public-zone-core.cjs",
    name: "publicZoneCore"
  },
  {
    file: "sources/mask-hand-core.cjs",
    name: "maskHandCore"
  },
  {
    file: "model/game-model-core.cjs",
    name: "gameModelCore"
  },
  {
    file: "tracker/candidate-rule-core.cjs",
    name: "candidateRuleCore"
  },
  {
    file: "tracker/known-hand-ledger-core.cjs",
    name: "knownHandLedgerCore"
  },
  {
    file: "tracker/protocol-zone-ledger-core.cjs",
    name: "protocolZoneLedgerCore"
  },
  {
    file: "tracker/rule-planner-core.cjs",
    name: "rulePlannerCore"
  },
  {
    file: "tracker/skill-rule-core.cjs",
    name: "skillRuleCore"
  }
];

function wrapCommonJs(source, name) {
  return `
;(() => {
  const module = { exports: {} };
  const exports = module.exports;
  const require = (id) => {
    const modules = window.__SgsScripts.modules;
    const map = {
      "./candidate-rule-core.cjs": "candidateRuleCore"
    };
    const moduleName = map[id];
    if (moduleName && modules[moduleName]) return modules[moduleName];
    throw new Error("Unsupported bundled require: " + id);
  };
${source}
  window.__SgsScripts.modules[${JSON.stringify(name)}] = module.exports;
})();
`;
}

function compactSkillKnowledge(value) {
  const reviewedRows = Array.from(value.skills || []).filter((row) => ["researched", "runtime-verified"].includes(row.reviewStatus));
  return {
    schemaVersion: value.schemaVersion || 1,
    generatedAt: value.generatedAt || "",
    catalogVersion: value.catalogVersion || null,
    coverage: value.coverage || null,
    counts: value.counts || null,
    skills: Object.fromEntries(reviewedRows.map((row) => [row.id, {
      id: row.id,
      name: row.name,
      desc: row.desc,
      sourceType: row.sourceType,
      owners: row.owners,
      catalogEvidence: row.catalogEvidence,
      ruleIdentity: row.ruleIdentity,
      reviewStatus: row.reviewStatus,
      confidence: row.confidence,
      mechanicSummary: row.mechanicSummary,
      executableRuleStatus: row.executableRuleStatus,
      rule: row.rule,
      sources: row.sources,
      openQuestions: row.openQuestions,
      conflictReasons: row.conflictReasons,
      reviewFlags: row.reviewFlags,
      taxonomy: row.taxonomy,
      researchDetails: row.researchDetails,
      reviewBatch: row.reviewFile ? path.basename(row.reviewFile) : null
    }]))
  };
}

const parts = [];
parts.push("/* Built by scripts/build-runtime.mjs. Do not edit dist output directly. */\n");
for (const file of runtimeFiles.slice(0, 1)) {
  parts.push(await readFile(path.join(runtimeDir, file), "utf8"));
}
const skillKnowledge = compactSkillKnowledge(JSON.parse(await readFile(skillKnowledgePath, "utf8")));
parts.push(`;(() => {
  const root = window.__SgsScripts;
  root.tracker.skillKnowledge = ${JSON.stringify(skillKnowledge)};
})();`);
for (const mod of commonJsModules) {
  const source = await readFile(path.join(runtimeDir, mod.file), "utf8");
  parts.push(wrapCommonJs(source, mod.name));
}
for (const file of runtimeFiles.slice(1)) {
  parts.push(await readFile(path.join(runtimeDir, file), "utf8"));
}

await mkdir(distDir, { recursive: true });
const outPath = path.join(distDir, "sgs-runtime.js");
await writeFile(outPath, `${parts.join("\n")}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  outPath,
  files: runtimeFiles.length,
  commonJsModules: commonJsModules.length,
  reviewedSkillsEmbedded: Object.keys(skillKnowledge.skills).length,
  skillKnowledgeGeneratedAt: skillKnowledge.generatedAt
}, null, 2));
