import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function latestDir(suffix) {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => path.join(explorationRoot, entry.name))
    .sort();
  return dirs.at(-1) || null;
}

function parseTsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i] ?? "";
    return row;
  });
}

async function readTsv(filePath) {
  return parseTsv(await readFile(filePath, "utf8"));
}

function tsvEscape(value) {
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (value == null) return "";
  return String(value).replace(/\t|\r?\n/g, " ");
}

function splitList(value) {
  if (!value) return [];
  return String(value)
    .split(/[;|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function addToMap(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function takeUnique(values, limit = 8) {
  return unique(values).slice(0, limit);
}

function normalizedKey(value) {
  return String(value || "").trim();
}

function ownerTokens(row) {
  const tokens = new Set();
  for (const name of splitList(row.registeredNames)) tokens.add(name);
  for (const part of String(row.ownerLabel || "").split(":")) {
    const token = part.trim();
    if (token) tokens.add(token);
  }
  const pathTail = String(row.ownerPath || "").split("/").at(-1) || "";
  for (const part of pathTail.split(":")) {
    const token = part.replace(/#\d+$/, "").trim();
    if (token) tokens.add(token);
  }
  return Array.from(tokens).filter(Boolean);
}

function sourcePriority(row, ownerSet, category) {
  let score = 0;
  if (ownerSet.has(row.className)) score += 80;
  if (ownerSet.has(row.functionName)) score += 70;
  const categories = splitList(row.categories);
  if (categories.some((item) => category && category.includes(item))) score += 8;
  if (row.confidence === "source-context") score += 8;
  if (row.confidence === "unknown-private") score -= 4;
  if (row.risk === "true") score -= 5;
  score += Math.min(8, splitList(row.methods).length);
  return score;
}

function semanticPriority(row, ownerSet, category) {
  let score = 0;
  if (ownerSet.has(row.className)) score += 80;
  if (ownerSet.has(row.functionName)) score += 70;
  for (const registered of splitList(row.ownerRegisteredNames)) {
    if (ownerSet.has(registered)) score += 40;
  }
  const categories = splitList(row.categories);
  if (categories.some((item) => category && category.includes(item))) score += 8;
  if (row.enhancedConfidence === "source-context") score += 8;
  if (row.enhancedConfidence === "unknown-private") score -= 4;
  return score;
}

function methodTriggerSummary(methods, triggerByClassMethod, candidateClasses) {
  const rows = [];
  for (const cls of candidateClasses) {
    for (const method of methods) {
      for (const row of triggerByClassMethod.get(`${cls}\t${method}`) || []) rows.push(row);
    }
  }
  return rows;
}

function surfaceFromCategory(category) {
  const map = {
    "button-command": ["button-ui-click"],
    "card-zone": ["card-selection-movement", "auto-play-select-discard"],
    "currency-reward-risk": ["purchase-risk"],
    "effect-animation": ["effect-animation"],
    "event-handler": ["scene-window-switch", "skill-trigger"],
    "laya-display-input": ["button-ui-click", "resource-drawing"],
    "resource-drawing": ["resource-drawing"],
    "scene-window-ui": ["scene-window-switch"],
    "selection-automation": ["auto-play-select-discard", "card-selection-movement"],
    "skill-spell": ["skill-trigger"],
    "state-machine": ["battle-lifecycle"],
    "identity-config": [],
    other: []
  };
  return map[category] || [];
}

function compactSourceRows(rows, limit = 4) {
  return rows.slice(0, limit).map((row) => ({
    className: row.className,
    functionName: row.functionName,
    field: row.field,
    confidence: row.confidence,
    meaning: row.meaning,
    risk: row.risk,
    operations: row.operations,
    methods: takeUnique(splitList(row.methods), 10),
    roles: takeUnique(splitList(row.roles), 10),
    protocolFields: takeUnique(splitList(row.protocolFields), 8),
    eventBindings: takeUnique(splitList(row.eventBindings), 8),
    snippet: String(row.snippets || "").slice(0, 500)
  }));
}

function compactSemanticRows(rows, limit = 4) {
  return rows.slice(0, limit).map((row) => ({
    className: row.className,
    functionName: row.functionName,
    fieldName: row.fieldName,
    ownerStatus: row.ownerStatus,
    ownerRegisteredNames: takeUnique(splitList(row.ownerRegisteredNames), 10),
    enhancedConfidence: row.enhancedConfidence,
    meaning: row.meaning,
    risk: row.risk,
    operations: row.operations,
    methods: takeUnique(splitList(row.methods), 10),
    roles: takeUnique(splitList(row.roles), 10)
  }));
}

function joinedMeaning(liveRow, sourceRows, semanticRows) {
  const semanticMeaning = semanticRows.find((row) => row.meaning)?.meaning;
  const sourceMeaning = sourceRows.find((row) => row.meaning)?.meaning;
  if (semanticMeaning && semanticMeaning !== "private/minified runtime field; needs source branch or live sample for exact meaning") return semanticMeaning;
  if (sourceMeaning && sourceMeaning !== "private/minified runtime field; needs source branch or live sample for exact meaning") return sourceMeaning;
  return liveRow.meaning || semanticMeaning || sourceMeaning || "";
}

function confidence(liveRow, sourceRows, semanticRows, exactMatched) {
  if (exactMatched && semanticRows.some((row) => row.enhancedConfidence === "source-context")) return "live+semantic-exact";
  if (exactMatched && sourceRows.some((row) => row.confidence === "source-context")) return "live+source-exact";
  if (sourceRows.length || semanticRows.length) return "live+field-name-context";
  if (liveRow.category && liveRow.category !== "other") return "live-category-only";
  return "live-only";
}

function highSignalPriority(row) {
  let score = 0;
  if (row.matchLevel === "owner+field") score += 100;
  if (row.joinConfidence === "live+semantic-exact") score += 40;
  if (row.joinConfidence === "live+source-exact") score += 35;
  if (row.joinConfidence === "live+field-name-context") score += 10;
  if (row.purchaseRisk) score -= 25;
  score += Math.min(12, row.sourceMatchCount || 0);
  score += Math.min(12, row.semanticMatchCount || 0);
  return score;
}

function highSignalRows(rows, limit = 120) {
  const seen = new Set();
  const selected = [];
  for (const row of [...rows]
    .filter((item) => item.matchLevel === "owner+field" || item.joinConfidence.includes("source") || item.joinConfidence.includes("semantic"))
    .sort((a, b) => highSignalPriority(b) - highSignalPriority(a))) {
    const key = [
      row.ownerPath,
      row.field,
      row.joinConfidence,
      row.joinedMeaning,
      row.sourceClasses.join("|"),
      row.sourceMethods.join("|")
    ].join("\t");
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(row);
    if (selected.length >= limit) break;
  }
  return selected;
}

function outputDir() {
  return path.resolve(
    process.env.SGS_LIVE_FIELD_SOURCE_JOIN_DIR ||
      path.join(explorationRoot, `${timestampName()}-live-field-source-join`)
  );
}

async function main() {
  const liveDir = process.env.SGS_LIVE_OBJECT_STATE_AUDIT_DIR || await latestDir("-live-object-state-audit");
  if (!liveDir) throw new Error("No live-object-state-audit directory found.");
  const sourceDir = process.env.SGS_ALL_SOURCE_CONTEXT_DIR || await latestDir("-all-source-context");
  if (!sourceDir) throw new Error("No all-source-context directory found.");
  const semanticDir = process.env.SGS_SEMANTIC_INHERITANCE_DIR || await latestDir("-semantic-inheritance-report");
  if (!semanticDir) throw new Error("No semantic-inheritance-report directory found.");
  const triggerDir = process.env.SGS_TRIGGER_MONITORING_DIR || await latestDir("-trigger-monitoring-report");
  if (!triggerDir) throw new Error("No trigger-monitoring-report directory found.");

  const liveJsonPath = path.join(liveDir, "live-object-state-audit.json");
  const liveTsvPath = path.join(liveDir, "live-object-field-samples.tsv");
  const liveState = await readJson(liveJsonPath);
  const liveRows = await readTsv(liveTsvPath);
  const sourceRows = await readTsv(path.join(sourceDir, "all-source-field-context.tsv"));
  const semanticRows = await readTsv(path.join(semanticDir, "field-owner-context.tsv"));
  const triggerRows = await readTsv(path.join(triggerDir, "trigger-monitoring-index.tsv"));

  const sourceByField = new Map();
  const sourceByClassField = new Map();
  const sourceByFunctionField = new Map();
  for (const row of sourceRows) {
    addToMap(sourceByField, normalizedKey(row.field), row);
    addToMap(sourceByClassField, `${row.className}\t${row.field}`, row);
    addToMap(sourceByFunctionField, `${row.functionName}\t${row.field}`, row);
  }

  const semanticByField = new Map();
  const semanticByClassField = new Map();
  const semanticByFunctionField = new Map();
  for (const row of semanticRows) {
    addToMap(semanticByField, normalizedKey(row.fieldName), row);
    addToMap(semanticByClassField, `${row.className}\t${row.fieldName}`, row);
    addToMap(semanticByFunctionField, `${row.functionName}\t${row.fieldName}`, row);
  }

  const triggerByClassMethod = new Map();
  for (const row of triggerRows) {
    addToMap(triggerByClassMethod, `${row.className}\t${row.method}`, row);
  }

  const joinedRows = [];
  for (const liveRow of liveRows) {
    const field = normalizedKey(liveRow.field);
    const tokens = ownerTokens(liveRow);
    const ownerSet = new Set(tokens);
    const exactSource = [];
    const exactSemantic = [];
    for (const token of tokens) {
      exactSource.push(...(sourceByClassField.get(`${token}\t${field}`) || []));
      exactSource.push(...(sourceByFunctionField.get(`${token}\t${field}`) || []));
      exactSemantic.push(...(semanticByClassField.get(`${token}\t${field}`) || []));
      exactSemantic.push(...(semanticByFunctionField.get(`${token}\t${field}`) || []));
    }
    const globalSource = sourceByField.get(field) || [];
    const globalSemantic = semanticByField.get(field) || [];
    const sourceCandidates = unique([...exactSource, ...globalSource])
      .sort((a, b) => sourcePriority(b, ownerSet, liveRow.category) - sourcePriority(a, ownerSet, liveRow.category))
      .slice(0, 8);
    const semanticCandidates = unique([...exactSemantic, ...globalSemantic])
      .sort((a, b) => semanticPriority(b, ownerSet, liveRow.category) - semanticPriority(a, ownerSet, liveRow.category))
      .slice(0, 8);
    const exactMatched = exactSource.length > 0 || exactSemantic.length > 0;
    const exactSourceCandidates = unique(exactSource);
    const exactSemanticCandidates = unique(exactSemantic);
    const sourceMethods = unique(sourceCandidates.flatMap((row) => splitList(row.methods)));
    const exactSourceMethods = unique(exactSourceCandidates.flatMap((row) => splitList(row.methods)));
    const candidateClasses = unique([
      ...tokens,
      ...sourceCandidates.map((row) => row.className),
      ...semanticCandidates.map((row) => row.className)
    ]);
    const exactCandidateClasses = unique([
      ...tokens,
      ...exactSourceCandidates.map((row) => row.className),
      ...exactSemanticCandidates.map((row) => row.className)
    ]);
    const triggerMatches = methodTriggerSummary(sourceMethods, triggerByClassMethod, candidateClasses);
    const exactTriggerMatches = methodTriggerSummary(exactSourceMethods, triggerByClassMethod, exactCandidateClasses);
    const roles = unique([
      ...sourceCandidates.flatMap((row) => splitList(row.roles)),
      ...semanticCandidates.flatMap((row) => splitList(row.roles)),
      ...triggerMatches.flatMap((row) => splitList(row.roles))
    ]);
    const surfaces = unique([
      ...surfaceFromCategory(liveRow.category),
      ...triggerMatches.flatMap((row) => splitList(row.surfaces))
    ]);
    const purchaseRisk = liveRow.category === "currency-reward-risk" ||
      exactTriggerMatches.some((row) => row.purchaseRisk === "true") ||
      exactSourceCandidates.some((row) => row.risk === "true") ||
      exactSemanticCandidates.some((row) => row.risk === "true");
    joinedRows.push({
      group: liveRow.group,
      ownerPath: liveRow.ownerPath,
      ownerLabel: liveRow.ownerLabel,
      ownerTokens: tokens,
      registeredNames: splitList(liveRow.registeredNames),
      field,
      liveCategory: liveRow.category,
      liveKind: liveRow.kind,
      liveValue: liveRow.value,
      liveMeaning: liveRow.meaning,
      joinConfidence: confidence(liveRow, sourceCandidates, semanticCandidates, exactMatched),
      matchLevel: exactMatched ? "owner+field" : (sourceCandidates.length || semanticCandidates.length) ? "field-global" : "live-only",
      joinedMeaning: joinedMeaning(liveRow, sourceCandidates, semanticCandidates),
      sourceMatchCount: sourceCandidates.length,
      semanticMatchCount: semanticCandidates.length,
      triggerMatchCount: triggerMatches.length,
      sourceClasses: takeUnique(sourceCandidates.map((row) => row.className), 10),
      sourceFunctions: takeUnique(sourceCandidates.map((row) => row.functionName), 10),
      sourceMethods: takeUnique(sourceMethods, 14),
      operations: takeUnique(sourceCandidates.flatMap((row) => splitList(row.operations)), 10),
      roles: takeUnique(roles, 12),
      surfaces: takeUnique(surfaces, 12),
      purchaseRisk,
      sourceRows: compactSourceRows(sourceCandidates),
      semanticRows: compactSemanticRows(semanticCandidates)
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    liveDir,
    sourceDir,
    semanticDir,
    triggerDir,
    scene: liveState.runtime?.currentScene?.label || "",
    classMapSize: liveState.runtime?.classMapSize || 0,
    liveRows: liveRows.length,
    sourceRows: sourceRows.length,
    semanticRows: semanticRows.length,
    triggerRows: triggerRows.length,
    joinedRows: joinedRows.length,
    matchLevels: {},
    confidences: {},
    liveCategories: {},
    surfaces: {},
    purchaseRiskRows: 0,
    exactMatches: 0,
    sourceMatchedRows: 0,
    semanticMatchedRows: 0
  };
  for (const row of joinedRows) {
    summary.matchLevels[row.matchLevel] = (summary.matchLevels[row.matchLevel] || 0) + 1;
    summary.confidences[row.joinConfidence] = (summary.confidences[row.joinConfidence] || 0) + 1;
    summary.liveCategories[row.liveCategory] = (summary.liveCategories[row.liveCategory] || 0) + 1;
    for (const surface of row.surfaces) summary.surfaces[surface] = (summary.surfaces[surface] || 0) + 1;
    if (row.purchaseRisk) summary.purchaseRiskRows++;
    if (row.matchLevel === "owner+field") summary.exactMatches++;
    if (row.sourceMatchCount > 0) summary.sourceMatchedRows++;
    if (row.semanticMatchCount > 0) summary.semanticMatchedRows++;
  }

  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const jsonPath = path.join(dir, "live-field-source-join.json");
  const tsvPath = path.join(dir, "live-field-source-join.tsv");
  const mdPath = path.join(dir, "live-field-source-summary.md");
  await writeFile(jsonPath, `${JSON.stringify({ summary, joinedRows }, null, 2)}\n`, "utf8");
  await writeFile(tsvPath, joinedRowsToTsv(joinedRows), "utf8");
  await writeFile(mdPath, markdown(summary, joinedRows), "utf8");
  await writeFile(path.join(dir, "README.md"), markdown(summary, joinedRows), "utf8");

  console.log(JSON.stringify({
    dir,
    scene: summary.scene,
    liveRows: summary.liveRows,
    exactMatches: summary.exactMatches,
    sourceMatchedRows: summary.sourceMatchedRows,
    semanticMatchedRows: summary.semanticMatchedRows,
    matchLevels: summary.matchLevels,
    confidences: summary.confidences,
    purchaseRiskRows: summary.purchaseRiskRows
  }, null, 2));
}

function joinedRowsToTsv(rows) {
  const header = [
    "group",
    "ownerPath",
    "ownerLabel",
    "ownerTokens",
    "field",
    "liveCategory",
    "liveKind",
    "liveValue",
    "joinConfidence",
    "matchLevel",
    "joinedMeaning",
    "sourceClasses",
    "sourceFunctions",
    "sourceMethods",
    "operations",
    "roles",
    "surfaces",
    "purchaseRisk",
    "sourceMatchCount",
    "semanticMatchCount",
    "triggerMatchCount"
  ];
  const lines = [header.join("\t")];
  for (const row of rows) {
    lines.push(header.map((key) => tsvEscape(row[key])).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function markdown(summary, rows) {
  const lines = [];
  lines.push("# Live Field Source Join Report");
  lines.push("");
  lines.push(`- Generated: ${summary.generatedAt}`);
  lines.push(`- Scene: ${summary.scene}`);
  lines.push(`- ClassUtils names: ${summary.classMapSize}`);
  lines.push(`- Live field rows: ${summary.liveRows}`);
  lines.push(`- Source field rows: ${summary.sourceRows}`);
  lines.push(`- Semantic field rows: ${summary.semanticRows}`);
  lines.push(`- Trigger rows: ${summary.triggerRows}`);
  lines.push(`- Owner+field exact matches: ${summary.exactMatches}`);
  lines.push(`- Source-matched rows: ${summary.sourceMatchedRows}`);
  lines.push(`- Semantic-matched rows: ${summary.semanticMatchedRows}`);
  lines.push(`- Purchase-risk rows: ${summary.purchaseRiskRows}`);
  lines.push("");
  lines.push("## Match Levels");
  lines.push("");
  for (const [key, count] of Object.entries(summary.matchLevels).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${key}: ${count}`);
  }
  lines.push("");
  lines.push("## Confidences");
  lines.push("");
  for (const [key, count] of Object.entries(summary.confidences).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${key}: ${count}`);
  }
  lines.push("");
  lines.push("## Surfaces");
  lines.push("");
  for (const [key, count] of Object.entries(summary.surfaces).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${key}: ${count}`);
  }
  lines.push("");
  lines.push("## High Signal Rows");
  lines.push("");
  for (const row of highSignalRows(rows)) {
    lines.push(`- ${row.ownerPath}.${row.field}: ${row.liveValue} | ${row.joinConfidence} | ${row.joinedMeaning} | classes=${row.sourceClasses.join(",") || "(none)"} | methods=${row.sourceMethods.slice(0, 6).join(",") || "(none)"} | surfaces=${row.surfaces.join(",") || "(none)"}`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- `owner+field` means a live owner token matched a registered class or minified constructor field row.");
  lines.push("- `field-global` means the field name exists in source/semantic rows, but current owner did not have a registered or constructor match.");
  lines.push("- Hidden opponent hand arrays remain excluded by the upstream live audit.");
  lines.push("- Purchase-risk rows are evidence only; active calls still require explicit permission.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
