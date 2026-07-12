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

async function latestDir(suffix, marker) {
  let entries = [];
  try {
    entries = await readdir(explorationRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(suffix)) continue;
    const dir = path.join(explorationRoot, entry.name);
    if (!marker || await exists(path.join(dir, marker))) matches.push(dir);
  }
  matches.sort();
  return matches.at(-1) || null;
}

async function readTextIfExists(filePath) {
  if (!filePath || !(await exists(filePath))) return "";
  return readFile(filePath, "utf8");
}

async function readJsonIfExists(filePath) {
  const text = await readTextIfExists(filePath);
  if (!text) return null;
  return JSON.parse(text);
}

function outputDir() {
  return path.resolve(
    process.env.SGS_RESIDUAL_FIELD_SOURCE_DIR ||
      path.join(explorationRoot, `${timestampName()}-residual-field-source-report`)
  );
}

function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split("\t").map((item) => item.replace(/^\uFEFF/, ""));
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row = {};
    for (let i = 0; i < headers.length; i += 1) row[headers[i]] = cells[i] ?? "";
    return row;
  });
}

function writeTsv(rows, headers) {
  return `${headers.join("\t")}\n${rows.map((row) => headers.map((header) => tsvCell(row[header])).join("\t")).join("\n")}\n`;
}

function tsvCell(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (typeof value === "object") return JSON.stringify(value).replace(/\t|\r?\n/g, " ");
  return String(value).replace(/\t|\r?\n/g, " ");
}

function mdCell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replaceAll("|", "\\|");
}

function splitList(value) {
  return String(value || "")
    .split(/[|;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniq(values) {
  return Array.from(new Set((values || []).filter(Boolean).map(String)));
}

function normalizeClass(value) {
  return String(value || "")
    .replace(/^runtime:/, "")
    .replace(/:[^:]+:[^:]+:.+$/, "")
    .trim();
}

function rowOwner(row) {
  return normalizeClass(row.className || row.ownerLabel || row.ownerClass || "");
}

function ownerRegex(owner) {
  return new RegExp(`(?:^|[/:])${owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:#|:|/|$)`);
}

function ownerMatches(row, owner) {
  if (!owner) return false;
  const normalized = normalizeClass(owner);
  const candidates = [
    row.ownerLabel,
    row.nodeLabel,
    row.className,
    row.functionName,
    row.ownerClass,
    row.sourceClasses
  ].map(normalizeClass);
  if (candidates.some((candidate) => candidate === normalized)) return true;
  return ownerRegex(normalized).test(String(row.ownerPath || row.nodePath || ""));
}

function keyOf(owner, field) {
  return `${normalizeClass(owner)}\t${field || ""}`;
}

function indexByOwnerField(rows, ownerAccessor, fieldAccessor) {
  const map = new Map();
  for (const row of rows) {
    const owner = ownerAccessor(row);
    const field = fieldAccessor(row);
    if (!owner || !field) continue;
    const key = keyOf(owner, field);
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

function takeText(values, max = 8) {
  return uniq(values.flatMap((value) => splitList(value))).slice(0, max).join("|");
}

function summarizeMethodNames(rows, field) {
  return takeText(rows.flatMap((row) => [
    row.method,
    row.methodNames,
    row.sourceMethods,
    row.handlerMethods,
    row.eventNames
  ]), field ? 12 : 8);
}

function evidenceGrade({ liveRows, methodRows, eventRows, triggerRows, semanticRows }) {
  if (eventRows.length) return "event-bound-current-sample";
  if (liveRows.some((row) => /high-live-source/.test(row.confidence || ""))) return "high-live-source";
  if (methodRows.length) return "source-method-ref";
  if (triggerRows.length) return "trigger-hook-ref";
  if (liveRows.length) return "live-surface-only";
  if (semanticRows.length) return "semantic-index-row";
  return "missing-owner-field-evidence";
}

function nextProof(row, grade) {
  if (row.permissionGated === "true" || row.purchaseRisk === "true") {
    return "Record only unless user explicitly permits the gated action; keep purchase-like calls blocked.";
  }
  if (grade === "event-bound-current-sample") {
    return "Replay the same event watcher around this owner and capture before/after value transition.";
  }
  if (grade === "high-live-source" || grade === "source-method-ref") {
    return "Run the case-specific live proof playbook and capture the listed method/event transition.";
  }
  if (grade === "semantic-index-row") {
    return "Semantic index gives owner+field meaning; capture live transition only if automation depends on the exact value change.";
  }
  return "Needs targeted CDP sample with this owner visible or active.";
}

function buildResidualRows(inputs) {
  const liveIndex = indexByOwnerField(inputs.liveSemantics, rowOwner, (row) => row.field);
  const methodIndex = indexByOwnerField(inputs.methodEvidence, (row) => {
    const match = String(row.ownerPath || "").match(/(?:^|\/)([A-Za-z_$][\w$]*)#\d+(?:\/|$)/);
    return match?.[1] || row.ownerLabel || row.ownerClass || "";
  }, (row) => row.field);
  const eventIndex = indexByOwnerField(inputs.eventJoin, (row) => {
    const label = String(row.nodeLabel || "").split(":").at(-1);
    return label || row.nodeLabel || "";
  }, (row) => row.field);
  const semanticIndex = indexByOwnerField(inputs.fieldSemanticIndex, (row) => row.className, (row) => row.field);

  return inputs.uncovered.map((row) => {
    const owner = normalizeClass(row.className);
    const field = row.field || "";
    const exactLive = liveIndex.get(keyOf(owner, field)) || [];
    const looseLive = exactLive.length ? [] : inputs.liveSemantics.filter((item) => item.field === field && ownerMatches(item, owner)).slice(0, 20);
    const liveRows = exactLive.length ? exactLive : looseLive;
    const exactMethods = methodIndex.get(keyOf(owner, field)) || [];
    const looseMethods = exactMethods.length ? [] : inputs.methodEvidence.filter((item) => item.field === field && ownerMatches(item, owner)).slice(0, 20);
    const methodRows = exactMethods.length ? exactMethods : looseMethods;
    const exactEvents = eventIndex.get(keyOf(owner, field)) || [];
    const looseEvents = exactEvents.length ? [] : inputs.eventJoin.filter((item) => item.field === field && ownerMatches(item, owner)).slice(0, 20);
    const eventRows = exactEvents.length ? exactEvents : looseEvents;
    const exactSemantic = semanticIndex.get(keyOf(owner, field)) || [];
    const looseSemantic = exactSemantic.length ? [] : inputs.fieldSemanticIndex.filter((item) => item.field === field && ownerMatches(item, owner)).slice(0, 20);
    const semanticRows = exactSemantic.length ? exactSemantic : looseSemantic;
    const triggerRows = inputs.triggerIndex.filter((item) =>
      normalizeClass(item.className) === owner ||
      item.method === field ||
      item.functionName === field ||
      splitList(row.roles).some((role) => splitList(item.roles).includes(role)) ||
      splitList(row.surfaces).some((surface) => splitList(item.surfaces).includes(surface))
    ).slice(0, 20);
    const grade = evidenceGrade({ liveRows, methodRows, eventRows, triggerRows, semanticRows });
    const suggestedMeaning = liveRows[0]?.inferredMeaning ||
      eventRows[0]?.suggestedMeaning ||
      methodRows[0]?.meaning ||
      semanticRows[0]?.finalMeaning ||
      row.finalMeaning ||
      "";
    const triggerMethods = takeText([
      summarizeMethodNames(liveRows, field),
      summarizeMethodNames(methodRows, field),
      summarizeMethodNames(eventRows, field),
      ...semanticRows.map((item) => item.methods),
      ...semanticRows.map((item) => item.triggerMethods),
      ...semanticRows.map((item) => item.handlerMethods),
      ...triggerRows.map((item) => item.method)
    ], 16);
    const eventNames = takeText([
      ...liveRows.map((item) => item.eventNames),
      ...eventRows.map((item) => item.eventNames),
      ...semanticRows.map((item) => item.eventNames),
      ...triggerRows.map((item) => item.eventBindings)
    ], 12);
    const sourceClasses = takeText([
      ...liveRows.map((item) => item.sourceClasses),
      ...semanticRows.map((item) => item.registeredAliases),
      ...triggerRows.map((item) => item.className)
    ], 12);
    return {
      className: row.className || "",
      functionName: row.functionName || "",
      field,
      remaining: row.remaining || "",
      evidenceGrade: grade,
      evidenceLevel: eventRows[0]?.evidenceLevel || "",
      liveRows: liveRows.length,
      methodRows: methodRows.length,
      eventRows: eventRows.length,
      triggerRows: triggerRows.length,
      semanticRows: semanticRows.length,
      suggestedMeaning,
      triggerMethods,
      eventNames,
      sourceClasses,
      surfaces: row.surfaces || "",
      roles: row.roles || "",
      needsLive: row.needsLive || "",
      permissionGated: row.permissionGated || "",
      purchaseRisk: row.purchaseRisk || "",
      nextProof: nextProof(row, grade),
      sampleLiveValue: liveRows[0]?.liveValue || eventRows[0]?.fieldValue || "",
      evidencePaths: uniq([
        liveRows.length ? inputs.paths.liveSemantics : "",
        methodRows.length ? inputs.paths.methodEvidence : "",
        eventRows.length ? inputs.paths.eventJoin : "",
        triggerRows.length ? inputs.paths.triggerIndex : "",
        semanticRows.length ? inputs.paths.fieldSemanticIndex : ""
      ]).join("|")
    };
  }).sort((a, b) =>
    a.evidenceGrade.localeCompare(b.evidenceGrade) ||
    String(a.className).localeCompare(String(b.className)) ||
    String(a.field).localeCompare(String(b.field))
  );
}

function countBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "(none)";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Object.fromEntries(Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function buildCaseRows(rows) {
  const byCase = new Map();
  for (const row of rows) {
    const key = row.remaining || "(unknown)";
    const bucket = byCase.get(key) || [];
    bucket.push(row);
    byCase.set(key, bucket);
  }
  return Array.from(byCase.entries()).map(([remaining, items]) => ({
    remaining,
    rows: items.length,
    grades: countBy(items, (item) => item.evidenceGrade),
    owners: takeText(items.map((item) => item.className), 20),
    surfaces: takeText(items.map((item) => item.surfaces), 20),
    sampleFields: takeText(items.slice(0, 20).map((item) => `${item.className}.${item.field}`), 20),
    nextProof: takeText(items.map((item) => item.nextProof), 8)
  })).sort((a, b) => b.rows - a.rows || a.remaining.localeCompare(b.remaining));
}

function buildReadme(report) {
  const lines = [];
  lines.push("# Residual Field Source Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Uncovered rows scanned: ${report.summary.uncoveredRows}`);
  lines.push(`- Rows with some source/trigger/event evidence: ${report.summary.rowsWithEvidence}`);
  lines.push(`- Rows still missing owner+field evidence: ${report.summary.rowsMissingEvidence}`);
  lines.push("");
  lines.push("## Inputs");
  for (const [name, value] of Object.entries(report.inputs)) lines.push(`- ${name}: ${value || "(missing)"}`);
  lines.push("");
  lines.push("## Evidence Grades");
  for (const [name, count] of Object.entries(report.summary.evidenceGrades)) lines.push(`- ${name}: ${count}`);
  lines.push("");
  lines.push("## Remaining Buckets");
  lines.push("| Remaining | Rows | Grades | Owners | Sample Fields | Next Proof |");
  lines.push("| --- | ---: | --- | --- | --- | --- |");
  for (const row of report.caseRows.slice(0, 20)) {
    lines.push(`| ${mdCell(row.remaining)} | ${row.rows} | ${mdCell(Object.entries(row.grades).map(([key, value]) => `${key}:${value}`).join(", "))} | ${mdCell(row.owners)} | ${mdCell(row.sampleFields)} | ${mdCell(row.nextProof)} |`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("- This report does not call game methods. It joins residual active-operation gaps to existing live/source/handler/trigger evidence.");
  lines.push("- `event-bound-current-sample` means an event-bound current-node sample exists, but a targeted before/after value transition may still be needed.");
  lines.push("- `high-live-source` and `source-method-ref` are stronger than a generic trigger hook, but still weaker than a prompt/window-specific transition sample.");
  lines.push("- Purchase-risk and permission-gated rows remain record-only unless the user explicitly permits that action.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const activeDir = await latestDir("-active-operation-field-transition-report", "uncovered-unresolved-fields.tsv");
  const semanticDir = await latestDir("-field-semantic-index-report", "field-semantic-index.tsv");
  const liveDir = await latestDir("-live-field-semantics-report", "live-field-semantics.tsv");
  const rogueJoinDir = await latestDir("-rogue-handler-field-join-report", "event-field-join.tsv");
  const triggerDir = await latestDir("-trigger-monitoring-report", "trigger-monitoring-index.tsv");
  if (!activeDir) throw new Error("Missing active-operation field transition report");
  const paths = {
    uncovered: path.join(activeDir, "uncovered-unresolved-fields.tsv"),
    fieldSemanticIndex: semanticDir ? path.join(semanticDir, "field-semantic-index.tsv") : "",
    liveSemantics: liveDir ? path.join(liveDir, "live-field-semantics.tsv") : "",
    methodEvidence: liveDir ? path.join(liveDir, "field-method-evidence.tsv") : "",
    eventJoin: rogueJoinDir ? path.join(rogueJoinDir, "event-field-join.tsv") : "",
    triggerIndex: triggerDir ? path.join(triggerDir, "trigger-monitoring-index.tsv") : ""
  };
  const inputs = {
    paths,
    uncovered: parseTsv(await readTextIfExists(paths.uncovered)),
    fieldSemanticIndex: parseTsv(await readTextIfExists(paths.fieldSemanticIndex)),
    liveSemantics: parseTsv(await readTextIfExists(paths.liveSemantics)),
    methodEvidence: parseTsv(await readTextIfExists(paths.methodEvidence)),
    eventJoin: parseTsv(await readTextIfExists(paths.eventJoin)),
    triggerIndex: parseTsv(await readTextIfExists(paths.triggerIndex))
  };
  const rows = buildResidualRows(inputs);
  const caseRows = buildCaseRows(rows);
  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    inputs: paths,
    summary: {
      uncoveredRows: rows.length,
      rowsWithEvidence: rows.filter((row) => row.evidenceGrade !== "missing-owner-field-evidence").length,
      rowsMissingEvidence: rows.filter((row) => row.evidenceGrade === "missing-owner-field-evidence").length,
      evidenceGrades: countBy(rows, (row) => row.evidenceGrade),
      remainingBuckets: countBy(rows, (row) => row.remaining),
      ownerCounts: countBy(rows, (row) => row.className)
    },
    caseRows,
    rows
  };
  await writeFile(path.join(outDir, "residual-field-source-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "residual-field-source.tsv"), writeTsv(rows, [
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
  await writeFile(path.join(outDir, "remaining-buckets.tsv"), writeTsv(caseRows, [
    "remaining",
    "rows",
    "grades",
    "owners",
    "surfaces",
    "sampleFields",
    "nextProof"
  ]), "utf8");
  await writeFile(path.join(outDir, "README.md"), buildReadme(report), "utf8");
  console.log(JSON.stringify({
    ok: true,
    outDir,
    uncoveredRows: report.summary.uncoveredRows,
    rowsWithEvidence: report.summary.rowsWithEvidence,
    rowsMissingEvidence: report.summary.rowsMissingEvidence,
    evidenceGrades: report.summary.evidenceGrades
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
