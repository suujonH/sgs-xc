import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function latestDir(suffix, marker) {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(suffix)) continue;
    const fullPath = path.join(explorationRoot, entry.name);
    if (!marker || await exists(path.join(fullPath, marker))) dirs.push(fullPath);
  }
  dirs.sort();
  return dirs.at(-1) || null;
}

function outputDir() {
  return path.resolve(
    process.env.SGS_ENTRY_EVIDENCE_CATALOG_DIR ||
      path.join(explorationRoot, `${timestampName()}-entry-evidence-catalog-report`)
  );
}

function cleanCell(value) {
  return String(value ?? "").replace(/^\uFEFF/, "");
}

async function readTsvIfExists(filePath) {
  if (!filePath || !await exists(filePath)) return [];
  const text = await readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length) return [];
  const header = lines[0].split("\t").map(cleanCell);
  return lines.slice(1).map((line, index) => {
    const values = line.split("\t");
    const row = { __rowIndex: index + 1 };
    for (let fieldIndex = 0; fieldIndex < header.length; fieldIndex += 1) {
      row[header[fieldIndex]] = cleanCell(values[fieldIndex]);
    }
    return row;
  });
}

function tsvCell(value) {
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value).replace(/\t|\r?\n/g, " ");
  return String(value).replace(/\t|\r?\n/g, " ");
}

function writeTsv(rows, header) {
  return `${[
    header.join("\t"),
    ...rows.map((row) => header.map((key) => tsvCell(row[key])).join("\t"))
  ].join("\n")}\n`;
}

function splitList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item) => item != null && item !== "").map(String);
  return String(value)
    .split(/[|;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  const list = Array.isArray(values)
    ? values
    : values instanceof Set
      ? Array.from(values)
      : splitList(values);
  return Array.from(new Set(list.filter((value) => value != null && value !== "").map(String)));
}

function boolish(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function bump(counts, key, amount = 1) {
  const cleanKey = String(key || "").trim() || "(none)";
  counts[cleanKey] = (counts[cleanKey] || 0) + amount;
}

function bumpList(counts, values) {
  for (const value of splitList(values)) bump(counts, value);
}

function sortedCounts(counts, limit = 20) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function countValues(rows, keyFn, limit = 20) {
  const counts = {};
  for (const row of rows) bump(counts, keyFn(row));
  return sortedCounts(counts, limit);
}

function compactCounts(counts, limit = 12) {
  return sortedCounts(counts, limit).map((row) => `${row.key}:${row.count}`).join("|");
}

function listText(values, limit = 24) {
  return unique(values).slice(0, limit).join("|");
}

function withoutRuntimePrefix(value) {
  return String(value || "").replace(/^runtime:/, "");
}

function registerMap(map, key, index) {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return;
  if (!map.has(cleanKey)) map.set(cleanKey, []);
  map.get(cleanKey).push(index);
}

function preferCanonical(indices, entries, preferredFunctionName) {
  if (!indices.length) return null;
  if (indices.length === 1) return indices[0];
  const functionName = String(preferredFunctionName || "");
  const exactFunctionName = indices.find((index) => entries[index].entry.name === functionName);
  if (exactFunctionName != null) return exactFunctionName;
  const layaQualified = indices.find((index) => entries[index].entry.name === `Laya.${functionName}`);
  if (layaQualified != null) return layaQualified;
  const dotted = indices.find((index) => entries[index].entry.name.includes("."));
  if (dotted != null) return dotted;
  const named = indices.find((index) => entries[index].entry.name.length > 1 && !/^[a-zA-Z]$/.test(entries[index].entry.name));
  return named ?? indices[0];
}

function makeMatcher(entries) {
  const byName = new Map();
  const byFunction = new Map();
  const registerIndex = (index) => {
    registerMap(byName, entries[index].entry.name, index);
    registerMap(byFunction, entries[index].entry.functionName, index);
  };
  for (let index = 0; index < entries.length; index += 1) {
    registerIndex(index);
  }

  const matchEntry = (row) => {
    const className = String(row.className || "");
    const runtimeStripped = withoutRuntimePrefix(className);
    const functionName = String(row.functionName || "");
    const attempts = [
      ["exact-name", byName.get(className) || [], className],
      ["runtime-name", byName.get(runtimeStripped) || [], runtimeStripped],
      ["explicit-function", byFunction.get(functionName) || [], functionName],
      ["runtime-function", byFunction.get(runtimeStripped) || [], runtimeStripped],
      ["function-as-name", byName.get(functionName) || [], functionName]
    ];
    for (const [reason, indices, preferred] of attempts) {
      const index = preferCanonical(indices, entries, preferred);
      if (index != null) return { index, reason, aliasCount: indices.length };
    }
    return null;
  };
  return { matchEntry, registerIndex };
}

function methodNames(methods) {
  return (methods || []).map((method) => method.name).filter(Boolean);
}

function summarizeMethod(method) {
  return {
    name: method.name || "",
    arity: method.arity ?? "",
    hash: method.hash || "",
    length: method.length ?? "",
    roles: method.roles || []
  };
}

function summarizeFieldRow(row) {
  return {
    rowIndex: row.__rowIndex,
    className: row.className || "",
    functionName: row.functionName || "",
    field: row.field || "",
    fieldEvidence: row.fieldEvidence || "",
    finalMeaning: row.finalMeaning || "",
    sourceMeaning: row.sourceMeaning || "",
    enhancedConfidence: row.enhancedConfidence || "",
    liveConfidence: row.liveConfidence || "",
    categories: row.categories || "",
    surfaces: row.surfaces || "",
    roles: row.roles || "",
    operations: row.operations || "",
    methods: row.methods || "",
    triggerMethods: row.triggerMethods || "",
    handlerMethods: row.handlerMethods || "",
    eventNames: row.eventNames || "",
    sourceRows: Number(row.sourceRows || 0),
    semanticOwnerRows: Number(row.semanticOwnerRows || 0),
    triggerRows: Number(row.triggerRows || 0),
    liveRows: Number(row.liveRows || 0),
    handlerRows: Number(row.handlerRows || 0),
    triageRows: Number(row.triageRows || 0),
    needsLive: boolish(row.needsLive),
    permissionGated: boolish(row.permissionGated),
    purchaseRisk: boolish(row.purchaseRisk),
    remaining: row.remaining || "",
    exactValueType: row.exactValueType || "",
    exactValueText: row.exactValueText || ""
  };
}

function summarizeTriggerRow(row) {
  return {
    rowIndex: row.__rowIndex,
    className: row.className || "",
    functionName: row.functionName || "",
    categories: row.categories || "",
    method: row.method || "",
    sourceKind: row.sourceKind || "",
    roles: row.roles || "",
    surfaces: row.surfaces || "",
    purchaseRisk: boolish(row.purchaseRisk),
    hookTarget: row.hookTarget || "",
    monitoringMethod: row.monitoringMethod || "",
    evidence: row.evidence || "",
    constants: row.constants || "",
    strings: row.strings || "",
    protocolFields: row.protocolFields || "",
    eventBindings: row.eventBindings || ""
  };
}

function summarizeResidualRow(row) {
  return {
    rowIndex: row.__rowIndex,
    className: row.className || "",
    functionName: row.functionName || "",
    field: row.field || "",
    remaining: row.remaining || "",
    evidenceGrade: row.evidenceGrade || "",
    evidenceLevel: row.evidenceLevel || "",
    liveRows: Number(row.liveRows || 0),
    methodRows: Number(row.methodRows || 0),
    eventRows: Number(row.eventRows || 0),
    triggerRows: Number(row.triggerRows || 0),
    semanticRows: Number(row.semanticRows || 0),
    suggestedMeaning: row.suggestedMeaning || "",
    triggerMethods: row.triggerMethods || "",
    eventNames: row.eventNames || "",
    sourceClasses: row.sourceClasses || "",
    surfaces: row.surfaces || "",
    roles: row.roles || "",
    needsLive: boolish(row.needsLive),
    permissionGated: boolish(row.permissionGated),
    purchaseRisk: boolish(row.purchaseRisk),
    nextProof: row.nextProof || "",
    sampleLiveValue: row.sampleLiveValue || "",
    evidencePaths: row.evidencePaths || ""
  };
}

function rowEvidenceCounts(row) {
  return [
    `source:${row.sourceRows || 0}`,
    `semantic:${row.semanticOwnerRows || 0}`,
    `trigger:${row.triggerRows || 0}`,
    `live:${row.liveRows || 0}`,
    `handler:${row.handlerRows || 0}`,
    `triage:${row.triageRows || 0}`
  ].join("|");
}

function collectEntryCounts(item) {
  const surfaces = {};
  const roles = {};
  const monitorMethods = {};
  const evidenceGrades = {};
  for (const row of item.fields) {
    bumpList(surfaces, row.surfaces);
    bumpList(roles, row.roles);
  }
  for (const row of item.triggers) {
    bumpList(surfaces, row.surfaces);
    bumpList(roles, row.roles);
    bump(monitorMethods, row.monitoringMethod);
  }
  for (const row of item.residualFields) {
    bumpList(surfaces, row.surfaces);
    bumpList(roles, row.roles);
    bump(evidenceGrades, row.evidenceGrade);
  }
  return { surfaces, roles, monitorMethods, evidenceGrades };
}

function makeSummaryRow(item) {
  const { entry } = item;
  const counts = collectEntryCounts(item);
  const triggerPurchaseRiskRows = item.triggers.filter((row) => row.purchaseRisk).length;
  const fieldPurchaseRiskRows = item.fields.filter((row) => row.purchaseRisk).length;
  const residualPurchaseRiskRows = item.residualFields.filter((row) => row.purchaseRisk).length;
  const needsLiveFields = item.fields.filter((row) => row.needsLive).length + item.residualFields.filter((row) => row.needsLive).length;
  const permissionGatedFields = item.fields.filter((row) => row.permissionGated).length + item.residualFields.filter((row) => row.permissionGated).length;
  const unresolvedFields = item.fields.filter((row) => row.remaining).length + item.residualFields.filter((row) => row.remaining).length;
  return {
    name: entry.name,
    functionName: entry.functionName,
    syntheticRuntimeOwner: item.synthetic === true,
    categories: listText(entry.categories),
    aliases: listText(item.aliases, 40),
    methodRoles: listText(entry.methodRoles, 30),
    ownMethodCount: entry.ownMethodCount,
    staticMethodCount: entry.staticMethodCount,
    inheritedMethodCount: entry.inheritedMethodCount,
    ownFieldCount: entry.ownFieldCount,
    staticFieldCount: entry.staticFieldCount,
    accessorCount: entry.accessorCount,
    declaredFieldSample: listText([...(entry.ownFields || []), ...(entry.staticFields || []), ...(entry.accessors || [])], 30),
    triggerMethodCount: (entry.triggerMethods || []).length,
    triggerMethodSample: listText(methodNames(entry.triggerMethods), 30),
    fieldSemanticRows: item.fields.length,
    triggerMonitoringRows: item.triggers.length,
    residualFieldRows: item.residualFields.length,
    needsLiveFields,
    permissionGatedFields,
    unresolvedFields,
    purchaseRiskRows: triggerPurchaseRiskRows + fieldPurchaseRiskRows + residualPurchaseRiskRows,
    surfaces: compactCounts(counts.surfaces),
    roles: compactCounts(counts.roles),
    evidenceGrades: compactCounts(counts.evidenceGrades),
    monitoringMethods: compactCounts(counts.monitorMethods, 6),
    fieldSample: listText(item.fields.map((row) => row.field), 30),
    triggerMethodRowsSample: listText(item.triggers.map((row) => row.method), 30),
    residualFieldSample: listText(item.residualFields.map((row) => row.field), 30)
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Entry Evidence Catalog");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Catalog entries: ${report.summary.catalogEntries}`);
  lines.push(`- ClassUtils registered entries: ${report.summary.registeredEntries}; synthetic runtime owners: ${report.summary.syntheticRuntimeOwnerEntries}`);
  lines.push(`- Alias groups: ${report.summary.aliasGroups}; entries with aliases: ${report.summary.entriesWithAliases}`);
  lines.push(`- Field semantic rows: ${report.summary.fieldSemanticRows}; matched=${report.summary.matchedFieldRows}; unmatched=${report.summary.unmatchedFieldRows}; entries=${report.summary.entriesWithFieldSemantics}`);
  lines.push(`- Trigger monitoring rows: ${report.summary.triggerMonitoringRows}; matched=${report.summary.matchedTriggerRows}; unmatched=${report.summary.unmatchedTriggerRows}; entries=${report.summary.entriesWithTriggerMonitoring}`);
  lines.push(`- Residual field rows: ${report.summary.residualFieldRows}; matched=${report.summary.matchedResidualRows}; unmatched=${report.summary.unmatchedResidualRows}; entries=${report.summary.entriesWithResidualFields}`);
  lines.push(`- Purchase-risk trigger rows: ${report.summary.purchaseRiskTriggerRows}; purchase-risk field rows: ${report.summary.purchaseRiskFieldRows}`);
  lines.push("");
  lines.push("## Outputs");
  lines.push("");
  lines.push(`- JSON catalog: ${report.outputs.catalogJson}`);
  lines.push(`- Entry summary TSV: ${report.outputs.entrySummaryTsv}`);
  lines.push(`- Field evidence TSV: ${report.outputs.entryFieldEvidenceTsv}`);
  lines.push(`- Trigger evidence TSV: ${report.outputs.entryTriggerEvidenceTsv}`);
  lines.push(`- Residual field evidence TSV: ${report.outputs.entryResidualEvidenceTsv}`);
  lines.push(`- Unmatched evidence TSV: ${report.outputs.unmatchedEvidenceTsv}`);
  lines.push("");
  lines.push("## Top Surfaces");
  lines.push("");
  for (const row of report.summary.topSurfaces) lines.push(`- ${row.key}: ${row.count}`);
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This is an offline owner/name/function join. It proves where fields, methods, and hook targets live, but live value transitions still need targeted CDP samples when automation depends on exact state changes.");
  lines.push("- Runtime owners such as runtime:NBi are matched by stripping runtime: and looking up ClassUtils function names when a registered class name is not exposed.");
  lines.push("- Purchase-like rows are kept as evidence but remain blocked for active exploration unless the user explicitly allows them.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const allNamesDir = await latestDir("-all-names-report", "all-registered-classes.json");
  if (!allNamesDir) throw new Error("No all-names report found.");

  const classUtilsDir = await latestDir("-classutils-inspect", "classutils-alias-groups.tsv");
  const fieldSemanticDir = await latestDir("-field-semantic-index-report", "field-semantic-index.tsv");
  const triggerMonitoringDir = await latestDir("-trigger-monitoring-report", "trigger-monitoring-index.tsv");
  const residualFieldSourceDir = await latestDir("-residual-field-source-report", "residual-field-source.tsv");

  const paths = {
    allNamesDir,
    allRegisteredClassesJson: path.join(allNamesDir, "all-registered-classes.json"),
    allRegisteredClassesTsv: path.join(allNamesDir, "all-registered-classes.tsv"),
    methodRoleIndexJson: path.join(allNamesDir, "method-role-index.json"),
    eventHandlerIndexJson: path.join(allNamesDir, "event-handler-index.json"),
    fieldMeaningGlossaryJson: path.join(allNamesDir, "field-meaning-glossary.json"),
    classUtilsAliasGroupsTsv: classUtilsDir ? path.join(classUtilsDir, "classutils-alias-groups.tsv") : "",
    fieldSemanticIndexTsv: fieldSemanticDir ? path.join(fieldSemanticDir, "field-semantic-index.tsv") : "",
    triggerMonitoringIndexTsv: triggerMonitoringDir ? path.join(triggerMonitoringDir, "trigger-monitoring-index.tsv") : "",
    residualFieldSourceTsv: residualFieldSourceDir ? path.join(residualFieldSourceDir, "residual-field-source.tsv") : ""
  };

  const registeredClasses = await readJson(paths.allRegisteredClassesJson);
  const aliasRows = await readTsvIfExists(paths.classUtilsAliasGroupsTsv);
  const fieldSemanticRows = await readTsvIfExists(paths.fieldSemanticIndexTsv);
  const triggerRows = await readTsvIfExists(paths.triggerMonitoringIndexTsv);
  const residualRows = await readTsvIfExists(paths.residualFieldSourceTsv);

  const entries = registeredClasses.map((entry, index) => ({
    index,
    entry,
    synthetic: false,
    aliases: new Set(unique([entry.name, entry.functionName])),
    aliasGroupHashes: new Set(),
    fields: [],
    triggers: [],
    residualFields: []
  }));

  const byName = new Map();
  const byFunction = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    registerMap(byName, entries[index].entry.name, index);
    registerMap(byFunction, entries[index].entry.functionName, index);
  }

  for (const row of aliasRows) {
    const names = splitList(row.registeredNames);
    const candidates = unique([
      ...names.flatMap((name) => byName.get(name) || []),
      ...(byFunction.get(row.functionName) || [])
    ]);
    for (const index of candidates) {
      for (const name of names) entries[index].aliases.add(name);
      if (row.functionName) entries[index].aliases.add(row.functionName);
      if (row.hash) entries[index].aliasGroupHashes.add(row.hash);
    }
  }

  const matcher = makeMatcher(entries);
  const syntheticByKey = new Map();
  const unmatchedRows = [];

  function createSyntheticRuntimeOwner(row, source) {
    const className = String(row.className || row.functionName || `${source}:${row.__rowIndex || entries.length}`);
    const functionName = String(row.functionName || withoutRuntimePrefix(className));
    const key = `${className}\t${functionName}`;
    if (syntheticByKey.has(key)) {
      return { index: syntheticByKey.get(key), reason: "synthetic-runtime-owner", aliasCount: 1 };
    }
    const index = entries.length;
    entries.push({
      index,
      synthetic: true,
      entry: {
        name: className,
        exists: false,
        functionName,
        ctor: "",
        categories: ["runtime-owner"],
        methodRoles: [],
        ownMethodCount: 0,
        staticMethodCount: 0,
        inheritedMethodCount: 0,
        ownFieldCount: 0,
        staticFieldCount: 0,
        accessorCount: 0,
        ownMethods: [],
        staticMethods: [],
        inheritedMethods: [],
        ownFields: [],
        staticFields: [],
        accessors: [],
        triggerMethods: []
      },
      aliases: new Set(unique([className, functionName, withoutRuntimePrefix(className)])),
      aliasGroupHashes: new Set(),
      fields: [],
      triggers: [],
      residualFields: []
    });
    syntheticByKey.set(key, index);
    matcher.registerIndex(index);
    return { index, reason: "synthetic-runtime-owner", aliasCount: 1 };
  }

  const fieldEvidenceRows = [];
  for (const sourceRow of fieldSemanticRows) {
    const row = summarizeFieldRow(sourceRow);
    const match = matcher.matchEntry(sourceRow) || createSyntheticRuntimeOwner(sourceRow, "field-semantic-index");
    if (match) {
      const entryItem = entries[match.index];
      entryItem.fields.push(row);
      fieldEvidenceRows.push({
        entryName: entryItem.entry.name,
        entryFunctionName: entryItem.entry.functionName,
        matchReason: match.reason,
        matchedAliasCount: match.aliasCount,
        ...row,
        evidenceCounts: rowEvidenceCounts(row)
      });
    }
  }

  const triggerEvidenceRows = [];
  for (const sourceRow of triggerRows) {
    const row = summarizeTriggerRow(sourceRow);
    const match = matcher.matchEntry(sourceRow);
    if (match) {
      const entryItem = entries[match.index];
      entryItem.triggers.push(row);
      triggerEvidenceRows.push({
        entryName: entryItem.entry.name,
        entryFunctionName: entryItem.entry.functionName,
        matchReason: match.reason,
        matchedAliasCount: match.aliasCount,
        ...row
      });
    } else {
      unmatchedRows.push({
        source: "trigger-monitoring-index",
        rowIndex: sourceRow.__rowIndex,
        className: sourceRow.className || "",
        functionName: sourceRow.functionName || "",
        field: "",
        method: sourceRow.method || "",
        surfaces: sourceRow.surfaces || "",
        roles: sourceRow.roles || "",
        reason: "no registered name/functionName match",
        sample: sourceRow.monitoringMethod || sourceRow.evidence || ""
      });
    }
  }

  const residualEvidenceRows = [];
  for (const sourceRow of residualRows) {
    const row = summarizeResidualRow(sourceRow);
    const match = matcher.matchEntry(sourceRow) || createSyntheticRuntimeOwner(sourceRow, "residual-field-source");
    if (match) {
      const entryItem = entries[match.index];
      entryItem.residualFields.push(row);
      residualEvidenceRows.push({
        entryName: entryItem.entry.name,
        entryFunctionName: entryItem.entry.functionName,
        matchReason: match.reason,
        matchedAliasCount: match.aliasCount,
        ...row
      });
    }
  }

  const summaryRows = entries.map(makeSummaryRow);
  const allSurfaceCounts = {};
  for (const row of summaryRows) {
    for (const item of splitList(row.surfaces)) {
      const [key, countText] = item.split(":");
      bump(allSurfaceCounts, key, Number(countText || 1));
    }
  }

  const reportSummary = {
    catalogEntries: entries.length,
    registeredEntries: registeredClasses.length,
    syntheticRuntimeOwnerEntries: entries.filter((entry) => entry.synthetic).length,
    aliasGroups: aliasRows.length,
    entriesWithAliases: entries.filter((entry) => entry.aliases.size > 2).length,
    fieldSemanticRows: fieldSemanticRows.length,
    matchedFieldRows: fieldEvidenceRows.length,
    unmatchedFieldRows: unmatchedRows.filter((row) => row.source === "field-semantic-index").length,
    entriesWithFieldSemantics: entries.filter((entry) => entry.fields.length).length,
    triggerMonitoringRows: triggerRows.length,
    matchedTriggerRows: triggerEvidenceRows.length,
    unmatchedTriggerRows: unmatchedRows.filter((row) => row.source === "trigger-monitoring-index").length,
    entriesWithTriggerMonitoring: entries.filter((entry) => entry.triggers.length).length,
    residualFieldRows: residualRows.length,
    matchedResidualRows: residualEvidenceRows.length,
    unmatchedResidualRows: unmatchedRows.filter((row) => row.source === "residual-field-source").length,
    entriesWithResidualFields: entries.filter((entry) => entry.residualFields.length).length,
    purchaseRiskTriggerRows: triggerEvidenceRows.filter((row) => row.purchaseRisk).length,
    purchaseRiskFieldRows: fieldEvidenceRows.filter((row) => row.purchaseRisk).length + residualEvidenceRows.filter((row) => row.purchaseRisk).length,
    needsLiveFieldRows: fieldEvidenceRows.filter((row) => row.needsLive).length + residualEvidenceRows.filter((row) => row.needsLive).length,
    permissionGatedFieldRows: fieldEvidenceRows.filter((row) => row.permissionGated).length + residualEvidenceRows.filter((row) => row.permissionGated).length,
    topSurfaces: sortedCounts(allSurfaceCounts, 18),
    topCategories: countValues(summaryRows, (row) => splitList(row.categories)[0] || "(none)", 18),
    topUnmatchedOwners: countValues(unmatchedRows, (row) => row.className || row.functionName || "(none)", 18)
  };

  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });

  const outputs = {
    catalogJson: path.join(outDir, "entry-evidence-catalog.json"),
    entrySummaryTsv: path.join(outDir, "entry-summary.tsv"),
    entryFieldEvidenceTsv: path.join(outDir, "entry-field-evidence.tsv"),
    entryTriggerEvidenceTsv: path.join(outDir, "entry-trigger-evidence.tsv"),
    entryResidualEvidenceTsv: path.join(outDir, "entry-residual-evidence.tsv"),
    unmatchedEvidenceTsv: path.join(outDir, "unmatched-evidence.tsv"),
    readme: path.join(outDir, "README.md")
  };

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: paths,
    outputs,
    summary: reportSummary,
    entries: entries.map((item) => ({
      name: item.entry.name,
      exists: item.entry.exists,
      functionName: item.entry.functionName,
      syntheticRuntimeOwner: item.synthetic === true,
      ctor: item.entry.ctor,
      categories: item.entry.categories || [],
      methodRoles: item.entry.methodRoles || [],
      aliases: Array.from(item.aliases).sort(),
      aliasGroupHashes: Array.from(item.aliasGroupHashes).sort(),
      counts: {
        ownMethodCount: item.entry.ownMethodCount,
        staticMethodCount: item.entry.staticMethodCount,
        inheritedMethodCount: item.entry.inheritedMethodCount,
        ownFieldCount: item.entry.ownFieldCount,
        staticFieldCount: item.entry.staticFieldCount,
        accessorCount: item.entry.accessorCount,
        triggerMethodCount: (item.entry.triggerMethods || []).length,
        fieldSemanticRows: item.fields.length,
        triggerMonitoringRows: item.triggers.length,
        residualFieldRows: item.residualFields.length
      },
      methods: {
        own: (item.entry.ownMethods || []).map(summarizeMethod),
        static: (item.entry.staticMethods || []).map(summarizeMethod),
        inherited: (item.entry.inheritedMethods || []).map(summarizeMethod),
        trigger: (item.entry.triggerMethods || []).map(summarizeMethod)
      },
      declaredFields: {
        own: item.entry.ownFields || [],
        static: item.entry.staticFields || [],
        accessors: item.entry.accessors || []
      },
      fieldEvidence: item.fields,
      triggerEvidence: item.triggers,
      residualFieldEvidence: item.residualFields
    }))
  };

  await writeFile(outputs.catalogJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(outputs.entrySummaryTsv, writeTsv(summaryRows, [
    "name",
    "functionName",
    "syntheticRuntimeOwner",
    "categories",
    "aliases",
    "methodRoles",
    "ownMethodCount",
    "staticMethodCount",
    "inheritedMethodCount",
    "ownFieldCount",
    "staticFieldCount",
    "accessorCount",
    "declaredFieldSample",
    "triggerMethodCount",
    "triggerMethodSample",
    "fieldSemanticRows",
    "triggerMonitoringRows",
    "residualFieldRows",
    "needsLiveFields",
    "permissionGatedFields",
    "unresolvedFields",
    "purchaseRiskRows",
    "surfaces",
    "roles",
    "evidenceGrades",
    "monitoringMethods",
    "fieldSample",
    "triggerMethodRowsSample",
    "residualFieldSample"
  ]), "utf8");
  await writeFile(outputs.entryFieldEvidenceTsv, writeTsv(fieldEvidenceRows, [
    "entryName",
    "entryFunctionName",
    "matchReason",
    "matchedAliasCount",
    "rowIndex",
    "className",
    "functionName",
    "field",
    "fieldEvidence",
    "finalMeaning",
    "sourceMeaning",
    "enhancedConfidence",
    "liveConfidence",
    "categories",
    "surfaces",
    "roles",
    "operations",
    "methods",
    "triggerMethods",
    "handlerMethods",
    "eventNames",
    "evidenceCounts",
    "needsLive",
    "permissionGated",
    "purchaseRisk",
    "remaining",
    "exactValueType",
    "exactValueText"
  ]), "utf8");
  await writeFile(outputs.entryTriggerEvidenceTsv, writeTsv(triggerEvidenceRows, [
    "entryName",
    "entryFunctionName",
    "matchReason",
    "matchedAliasCount",
    "rowIndex",
    "className",
    "functionName",
    "categories",
    "method",
    "sourceKind",
    "roles",
    "surfaces",
    "purchaseRisk",
    "hookTarget",
    "monitoringMethod",
    "evidence",
    "constants",
    "strings",
    "protocolFields",
    "eventBindings"
  ]), "utf8");
  await writeFile(outputs.entryResidualEvidenceTsv, writeTsv(residualEvidenceRows, [
    "entryName",
    "entryFunctionName",
    "matchReason",
    "matchedAliasCount",
    "rowIndex",
    "className",
    "functionName",
    "field",
    "remaining",
    "evidenceGrade",
    "evidenceLevel",
    "liveRows",
    "methodRows",
    "eventRows",
    "triggerRows",
    "semanticRows",
    "suggestedMeaning",
    "triggerMethods",
    "eventNames",
    "sourceClasses",
    "surfaces",
    "roles",
    "needsLive",
    "permissionGated",
    "purchaseRisk",
    "nextProof",
    "sampleLiveValue",
    "evidencePaths"
  ]), "utf8");
  await writeFile(outputs.unmatchedEvidenceTsv, writeTsv(unmatchedRows, [
    "source",
    "rowIndex",
    "className",
    "functionName",
    "field",
    "method",
    "surfaces",
    "roles",
    "reason",
    "sample"
  ]), "utf8");
  await writeFile(outputs.readme, buildMarkdown(report), "utf8");

  console.log(JSON.stringify({
    outDir,
    summary: reportSummary,
    outputs
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
