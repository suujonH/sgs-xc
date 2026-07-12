import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { first, generalName, rowId, stripHtml, tableRows } = require("../../runtime/sources/config-table-core.cjs");

const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workspaceDir = path.resolve(scriptsDir, "..");
const args = parseArgs(process.argv.slice(2));
const reviewPath = path.resolve(workspaceDir, args.file || "");
const requestedIds = String(args.ids || "")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);

if (!args.file) {
  throw new Error("Usage: node validate-skill-review-batch.mjs --file Scripts/data/skill-reviews/<batch>.json [--ids 1,2,3]");
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

const [reviewBuffer, audit, spellConfig, characterConfig, fingerprintText] = await Promise.all([
  readFile(reviewPath),
  readJson(auditPath),
  readJson(path.join(configBase, "cha_spell.json")),
  readJson(path.join(configBase, "character.json")),
  readFile(fingerprintPath, "utf8")
]);
const reviewText = reviewBuffer.toString("utf8");
const review = JSON.parse(reviewText);
const profile = String(args.profile || "current").trim().toLowerCase();
const strictCurrentEvidence = profile !== "legacy";
const expectedIds = requestedIds.length
  ? requestedIds
  : Object.keys(review.skills || {}).filter((id) => /^\d+$/.test(id)).map(Number);
const errors = [];
const expectedFields = [
  "owner",
  "sourceType",
  "ext",
  "versionScope",
  "runtimeBinding",
  "reviewStatus",
  "confidence",
  "mechanicSummary",
  "executableRuleStatus",
  "rule",
  "visibility",
  "failureSemantics",
  "taxonomyCorrections",
  "sources",
  "openQuestions"
];
const actualIds = Object.keys(review.skills || {}).filter((id) => /^\d+$/.test(id)).map(Number);
assertEqual(actualIds, expectedIds, "SkillID order", errors);

const auditById = new Map((audit.skills || []).map((row) => [Number(row.id), row]));
const configById = new Map((spellConfig?.GameSpells?.spell || []).map((row) => [Number(row.a), row]));
const allCharacterOwnersBySkill = buildAllCharacterOwners(characterConfig);
const fingerprints = parseTsv(fingerprintText);
let exactConstructorCount = 0;
let staticAbsenceCount = 0;
let verifiedMethodCount = 0;
let unverifiedMethodCount = 0;
let ownerNameDifferenceCount = 0;
const verifiedRawConfigGapIds = [];

for (const id of expectedIds) {
  const row = review.skills?.[id];
  const catalog = auditById.get(id);
  const config = configById.get(id);
  if (!row) {
    errors.push(`${id}: review row missing`);
    continue;
  }
  if (strictCurrentEvidence) assertEqual(Object.keys(row), expectedFields, `${id}: exact 15-field contract`, errors);
  if (!catalog) errors.push(`${id}: current audit row missing`);
  if (row.reviewStatus !== "researched" && row.reviewStatus !== "runtime-verified") {
    errors.push(`${id}: reviewStatus=${row.reviewStatus}`);
  }
  if (!row.mechanicSummary || !row.failureSemantics || !row.rule || !Array.isArray(row.sources) || !row.sources.length) {
    errors.push(`${id}: semantic evidence fields are incomplete`);
  }

  if (catalog && strictCurrentEvidence) {
    const reviewedOwners = normalizeOwners(row.owner);
    const catalogOwners = normalizeOwners(catalog.owners);
    const reviewedIdentities = ownerIdentities(reviewedOwners);
    const catalogIdentities = ownerIdentities(catalogOwners);
    const fullCharacterOwners = normalizeOwners(allCharacterOwnersBySkill.get(id) || []);
    const fullCharacterIdentities = ownerIdentities(fullCharacterOwners);
    const usesFullCharacterEvidence = JSON.stringify(reviewedIdentities) !== JSON.stringify(catalogIdentities);
    const referenceOwners = usesFullCharacterEvidence ? fullCharacterOwners : catalogOwners;
    assertEqual(
      reviewedIdentities,
      usesFullCharacterEvidence ? fullCharacterIdentities : catalogIdentities,
      `${id}: current owner IDs/classes`,
      errors
    );
    const referenceNames = new Map(referenceOwners.map((owner) => [`${owner.generalId}:${owner.className}`, owner.name]));
    ownerNameDifferenceCount += reviewedOwners.filter((owner) => referenceNames.get(`${owner.generalId}:${owner.className}`) !== owner.name).length;
    if (!containsRawExtensions(row.ext, catalog.extensions)) {
      errors.push(`${id}: one or more current raw extensions are absent from the reviewed ext evidence`);
    }
  }

  const binding = row.runtimeBinding || {};
  if (!config && strictCurrentEvidence) {
    const gapSourcePresent = Array.from(row.sources || []).some((source) => source?.kind === "current-config-gap");
    if (binding.rawChaSpellAbsenceVerified !== true) {
      errors.push(`${id}: cha_spell row missing without rawChaSpellAbsenceVerified=true`);
    } else if (!catalog || !Array.isArray(catalog.owners) || catalog.owners.length === 0 || !gapSourcePresent) {
      errors.push(`${id}: verified cha_spell gap requires current catalog owner evidence and a current-config-gap source`);
    } else {
      verifiedRawConfigGapIds.push(id);
    }
  }
  if (config && binding.rawChaSpellAbsenceVerified === true) {
    errors.push(`${id}: rawChaSpellAbsenceVerified conflicts with an existing cha_spell row`);
  }
  if (config && String(binding.configClass || "") !== String(config.d || "")) {
    errors.push(`${id}: configClass ${binding.configClass || "<missing>"} != cha_spell.d ${config.d || "<missing>"}`);
  }
  const bindingClass = String(binding.h5Class || binding.h5RegisteredName || binding.configClass || "");
  const registrySymbol = String(binding.h5RegistryClass || binding.registrySymbol || "");
  const constructorRows = fingerprints.filter((item) =>
    item.className === bindingClass &&
    item.method === "constructor" &&
    item.sourceKind === "constructor"
  );
  const claimsAbsence = binding.h5Class === null || binding.h5RegistryClass === null || binding.registrySymbol === null;
  if (claimsAbsence) {
    staticAbsenceCount++;
    if (binding.staticAbsenceVerified !== true) errors.push(`${id}: exact class absence lacks staticAbsenceVerified=true`);
    if (constructorRows.length) errors.push(`${id}: staticAbsenceVerified conflicts with an exact constructor fingerprint`);
    if (registrySymbol || binding.sourceHash != null) {
      errors.push(`${id}: absence row must not claim registry symbol/sourceHash`);
    }
  } else {
    const exact = constructorRows.find((item) =>
      item.className === bindingClass &&
      (!registrySymbol || item.functionName === registrySymbol) &&
      (!binding.sourceHash || item.sourceHash.toLowerCase() === String(binding.sourceHash).toLowerCase()) &&
      (binding.fingerprintFirstLine == null || Number(binding.fingerprintFirstLine) === item.lineNumber)
    );
    if (!exact) {
      errors.push(`${id}: exact constructor class/registry/sourceHash fingerprint missing`);
    } else {
      exactConstructorCount++;
      if (binding.fingerprintFirstLine != null && Number(binding.fingerprintFirstLine) !== exact.lineNumber) {
        errors.push(`${id}: fingerprintFirstLine ${binding.fingerprintFirstLine} != ${exact.lineNumber}`);
      }
    }
    for (const method of Array.from(binding.methods || [])) {
      if (!fingerprints.some((item) => item.className === bindingClass && item.method === method)) {
        unverifiedMethodCount++;
      } else {
        verifiedMethodCount++;
      }
    }
  }
}

function buildAllCharacterOwners(config) {
  const bySkill = new Map();
  for (const row of tableRows(config, "GameCharacters", "character")) {
    const generalId = rowId(row);
    if (!generalId) continue;
    const owner = {
      generalId,
      name: generalName(row),
      className: stripHtml(first(row, "Class", "class", "className") || "")
    };
    for (const [key, value] of Object.entries(row)) {
      if (!/^spellId\d+$/i.test(key)) continue;
      const skillId = Number(value || 0);
      if (!skillId) continue;
      const owners = bySkill.get(skillId) || [];
      if (!owners.some((item) => item.generalId === owner.generalId && item.className === owner.className)) {
        owners.push(owner);
      }
      bySkill.set(skillId, owners);
    }
  }
  return bySkill;
}

if (/(?:TODO|TBD|FIXME|PLACEHOLDER)/i.test(reviewText)) {
  errors.push("placeholder marker found");
}

const hashChecks = {
  versionConfSha256: path.join(resourceBase, "versionConf.js"),
  chaSpellSha256: path.join(configBase, "cha_spell.json"),
  characterSha256: path.join(configBase, "character.json"),
  sysPlaycardSha256: path.join(configBase, "sys_playcard.json"),
  chaSpellExtendSha256: path.join(configBase, "cha_spellextend.json"),
  sgsGameSha256: path.join(resourceBase, "sgsGame.sgs", "sgsGame.js"),
  fingerprintIndexSha256: fingerprintPath
};
for (const [field, file] of Object.entries(hashChecks)) {
  const actual = await sha256(file);
  const expected = String(review.resourceSnapshot?.[field] || "").toUpperCase();
  if (actual !== expected) errors.push(`resourceSnapshot.${field}: ${expected || "<missing>"} != ${actual}`);
}
const versionConf = await readFile(path.join(resourceBase, "versionConf.js"), "utf8");
const resourceVersion = /resourceVersion\s*=\s*["']([^"']+)/.exec(versionConf)?.[1] || "";
if (String(review.resourceSnapshot?.resourceVersion || "") !== resourceVersion) {
  errors.push(`resourceSnapshot.resourceVersion: ${review.resourceSnapshot?.resourceVersion || "<missing>"} != ${resourceVersion}`);
}

const result = {
  ok: errors.length === 0,
  profile,
  file: path.relative(workspaceDir, reviewPath).replaceAll("\\", "/"),
  batch: review.batch || "",
  skillCount: actualIds.length,
  exactConstructorCount,
  staticAbsenceCount,
  verifiedMethodCount,
  unverifiedMethodCount,
  ownerNameDifferenceCount,
  verifiedRawConfigGapCount: verifiedRawConfigGapIds.length,
  verifiedRawConfigGapIds,
  bytes: (await stat(reviewPath)).size,
  sha256: createHash("sha256").update(reviewBuffer).digest("hex").toUpperCase(),
  resourceVersion,
  errors
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const [rawKey, inline] = value.slice(2).split("=", 2);
    result[rawKey] = inline ?? values[++index] ?? "";
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

function normalizeOwners(value) {
  return Array.from(value || []).map((owner) => ({
    generalId: Number(owner?.generalId || owner?.id || 0),
    name: String(owner?.name || ""),
    className: String(owner?.className || "")
  })).sort((left, right) => left.generalId - right.generalId || left.className.localeCompare(right.className));
}

function ownerIdentities(value) {
  return Array.from(value || []).map((owner) => ({ generalId: owner.generalId, className: owner.className }));
}

function normalizeRows(value) {
  return Array.from(value || []).map(sortObjectDeep).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function normalizeExtensionRows(value) {
  return normalizeRows(Array.from(value || []).map((row) => row?.value && typeof row.value === "object" ? row.value : row));
}

function containsRawExtensions(reviewed, required) {
  const candidates = [];
  collectObjects(reviewed, candidates);
  const keys = new Set(candidates.map((value) => JSON.stringify(sortObjectDeep(value))));
  return Array.from(required || []).every((value) => keys.has(JSON.stringify(sortObjectDeep(value))));
}

function collectObjects(value, output) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  output.push(value);
  for (const item of Object.values(value)) collectObjects(item, output);
}

function sortObjectDeep(value) {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortObjectDeep(item)]));
}

function assertEqual(actual, expected, label, errors) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex").toUpperCase();
}
