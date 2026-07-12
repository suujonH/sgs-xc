import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workspaceDir = path.resolve(scriptsDir, "..");
const args = parseArgs(process.argv.slice(2));
const ids = String(args.ids || "")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);

if (!ids.length) {
  throw new Error("Usage: node skill-review-evidence.mjs --ids 13,40,119");
}

const resourceBase = path.join(workspaceDir, "work", "sgs-resource", "data", "1", "220", "h5_2");
const configBase = path.join(resourceBase, "res", "config", "Config_w.sgs");
const fingerprintPath = path.join(
  workspaceDir,
  "work",
  "runtime-exploration",
  "2026-07-09T17-27-18-252Z-function-fingerprint-report",
  "function-fingerprint-index.tsv"
);
const auditPath = path.join(scriptsDir, "reports", "skill-audit", "skill-rule-audit-current.json");

const [audit, spellConfig, fingerprintText, versionConf] = await Promise.all([
  readJson(auditPath),
  readJson(path.join(configBase, "cha_spell.json")),
  readFile(fingerprintPath, "utf8"),
  readFile(path.join(resourceBase, "versionConf.js"), "utf8")
]);

const auditById = new Map((audit.skills || []).map((row) => [Number(row.id), row]));
const configById = new Map((spellConfig?.GameSpells?.spell || []).map((row) => [Number(row.a), row]));
const fingerprints = parseTsv(fingerprintText);
const rows = ids.map((id) => buildEvidence(id, auditById.get(id), configById.get(id), fingerprints));
const missingIds = rows.filter((row) => !row.catalog).map((row) => row.id);
if (missingIds.length) {
  throw new Error(`SkillID absent from current audit: ${missingIds.join(",")}`);
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  resourceSnapshot: {
    resourceVersion: /resourceVersion\s*=\s*["']([^"']+)/.exec(versionConf)?.[1] || "",
    versionConfSha256: await sha256(path.join(resourceBase, "versionConf.js")),
    chaSpellSha256: await sha256(path.join(configBase, "cha_spell.json")),
    characterSha256: await sha256(path.join(configBase, "character.json")),
    sysPlaycardSha256: await sha256(path.join(configBase, "sys_playcard.json")),
    chaSpellExtendSha256: await sha256(path.join(configBase, "cha_spellextend.json")),
    sgsGameSha256: await sha256(path.join(resourceBase, "sgsGame.sgs", "sgsGame.js")),
    fingerprintIndexSha256: await sha256(fingerprintPath)
  },
  fingerprintBaseline: "2026-07-09T17-27-18-252Z",
  skillCount: rows.length,
  skills: rows
}, null, 2));

function buildEvidence(id, catalog, config, index) {
  const configClass = String(config?.d || "");
  const constructorCandidates = index.filter((row) =>
    row.className === configClass && row.method === "constructor" && row.sourceKind === "constructor"
  );
  const classRows = index.filter((row) => row.className === configClass);
  return {
    id,
    catalog: catalog ? {
      name: catalog.name,
      description: catalog.desc,
      sourceType: catalog.sourceType,
      owners: catalog.owners || [],
      extensions: catalog.extensions || [],
      isPlayCardSpell: catalog.isPlayCardSpell === true,
      categories: (catalog.categories || []).map((row) => typeof row === "string" ? row : row.id),
      strategy: catalog.strategy || null,
      priority: catalog.priority,
      reviewReasons: catalog.reviewReasons || []
    } : null,
    config: config ? {
      raw: config,
      configClass
    } : null,
    runtimeBindingEvidence: {
      configClass,
      exactConstructorPresent: constructorCandidates.length > 0,
      constructors: constructorCandidates.map(compactFingerprint),
      methods: Array.from(new Set(classRows
        .filter((row) => row.method !== "constructor")
        .map((row) => row.method)))
        .sort((left, right) => left.localeCompare(right)),
      methodFingerprints: classRows
        .filter((row) => row.method !== "constructor")
        .map(compactFingerprint)
    }
  };
}

function compactFingerprint(row) {
  return {
    className: row.className,
    registrySymbol: row.functionName,
    method: row.method,
    sourceKind: row.sourceKind,
    sourceHash: row.sourceHash,
    lineNumber: row.lineNumber,
    stableTarget: row.stableTarget,
    roles: splitSemicolon(row.roles),
    triggerSurfaces: splitSemicolon(row.triggerSurfaces),
    categoryHints: splitSemicolon(row.categoryHints),
    tokenPreview: String(row.tokenPreview || "")
  };
}

function splitSemicolon(value) {
  return String(value || "").split(";").map((row) => row.trim()).filter(Boolean);
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=", 2);
    result[key] = inline ?? values[++index] ?? "";
  }
  return result;
}

function parseTsv(value) {
  const [headerLine, ...lines] = String(value).split(/\r?\n/).filter(Boolean);
  const headers = headerLine.split("\t");
  return lines.map((line, index) => {
    const cells = line.split("\t");
    return {
      ...Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || ""])),
      lineNumber: index + 2
    };
  });
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex").toUpperCase();
}
