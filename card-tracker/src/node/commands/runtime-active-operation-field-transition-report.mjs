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

async function latestJson(suffix, fileName) {
  const dir = await latestDir(suffix, fileName);
  if (!dir) return null;
  const filePath = path.join(dir, fileName);
  const value = JSON.parse(await readFile(filePath, "utf8"));
  value.__dir = dir;
  value.__path = filePath;
  return value;
}

async function readTsv(filePath) {
  const text = await readFile(filePath, "utf8");
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

function outputDir() {
  return path.resolve(
    process.env.SGS_ACTIVE_OPERATION_FIELD_TRANSITION_DIR ||
      path.join(explorationRoot, `${timestampName()}-active-operation-field-transition-report`)
  );
}

function tsvCell(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (typeof value === "object") return JSON.stringify(value).replace(/\t|\r?\n/g, " ");
  return String(value).replace(/\t|\r?\n/g, " ");
}

function writeTsv(rows, headers) {
  return `${headers.join("\t")}\n${rows.map((row) => headers.map((header) => tsvCell(row[header])).join("\t")).join("\n")}\n`;
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

function shortJson(value, max = 360) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text == null) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function flatten(value, prefix = "", out = {}, depth = 0) {
  if (value == null || depth > 5) {
    if (prefix) out[prefix] = value;
    return out;
  }
  if (Array.isArray(value)) {
    if (prefix) out[prefix] = value;
    for (const [index, item] of value.slice(0, 8).entries()) {
      const next = prefix ? `${prefix}[${index}]` : `[${index}]`;
      flatten(item, next, out, depth + 1);
    }
    return out;
  }
  if (typeof value !== "object") {
    if (prefix) out[prefix] = value;
    return out;
  }
  const keys = Object.keys(value);
  if (!keys.length && prefix) out[prefix] = value;
  for (const key of keys) {
    if (/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)) continue;
    const next = prefix ? `${prefix}.${key}` : key;
    flatten(value[key], next, out, depth + 1);
  }
  return out;
}

function methodOwnerFromLabel(record) {
  const label = record.label || "";
  const pathMatch = label.match(/(?:^|\/)([A-Za-z_$][\w$]*)#\d+\.([A-Za-z_$][\w$]*)$/);
  if (pathMatch) return { ownerClass: `runtime:${pathMatch[1]}`, field: pathMatch[2], ownerLabel: record.thisLabel || pathMatch[1] };
  const classMethod = label.match(/^([A-Za-z_$][\w$]*Window|[A-Za-z_$][\w$]*Scene|[A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
  if (classMethod) return { ownerClass: classMethod[1], field: classMethod[2], ownerLabel: record.thisLabel || classMethod[1] };
  if (record.thisLabel && /^[A-Za-z_$][\w$]*$/.test(record.thisLabel) && /^[A-Za-z_$][\w$]*$/.test(label)) {
    return { ownerClass: `runtime:${record.thisLabel}`, field: label, ownerLabel: record.thisLabel };
  }
  if (label === "proxy.L") return { ownerClass: "runtime:proxy", field: "L", ownerLabel: "proxy" };
  if (label === "GED.event") return { ownerClass: "runtime:GED", field: "event", ownerLabel: "GED" };
  if (label === "Laya.EventDispatcher.event") return { ownerClass: `runtime:${record.thisLabel || "EventDispatcher"}`, field: "event", ownerLabel: record.thisLabel || "" };
  return null;
}

function sceneFields(scene) {
  if (!scene) return {};
  return {
    scene: scene.scene,
    isGameOver: scene.isGameOver,
    currentRoundSeatID: scene.currentRoundSeatID,
    gameRound: scene.gameRound,
    gameTurn: scene.gameTurn,
    selfSeatIndex: scene.selfSeatIndex,
    selfHandCardCount: scene.selfHandCardCount,
    visibleWindowCount: scene.visibleWindowCount,
    promptTexts: scene.promptTexts || []
  };
}

function pushEvidence(rows, record, details) {
  rows.push({
    seq: record.seq,
    time: record.time,
    label: record.label || "",
    targetType: record.targetType || "",
    sceneBefore: record.sceneBefore?.scene || "",
    sceneAfter: record.sceneAfter?.scene || "",
    promptBefore: (record.sceneBefore?.promptTexts || []).join("|"),
    promptAfter: (record.sceneAfter?.promptTexts || []).join("|"),
    ownerClass: details.ownerClass || "",
    ownerLabel: details.ownerLabel || "",
    ownerPath: record.thisPath || "",
    field: details.field || "",
    evidenceType: details.evidenceType || "",
    before: shortJson(details.before),
    after: shortJson(details.after),
    meaning: details.meaning || "",
    confidence: details.confidence || "active-observed"
  });
}

function collectCardLikeEvidence(record, rows) {
  const flatArgs = flatten(record.args || []);
  const cardKeyAliases = new Map(Object.entries({
    cardId: "cardId",
    CardId: "cardId",
    cardID: "cardId",
    CardID: "cardId",
    cardName: "cardName",
    CardName: "cardName",
    spellId: "spellId",
    SpellId: "spellId",
    SpellID: "spellId",
    resName: "resName",
    ResName: "resName",
    canSelected: "canSelected",
    CanSelected: "canSelected",
    selected: "selected",
    Selected: "selected",
    isInHand: "isInHand",
    IsInHand: "isInHand",
    isFromHandCard: "isFromHandCard",
    IsFromHandCard: "isFromHandCard",
    cardFlower: "cardFlower",
    CardFlower: "cardFlower",
    cardNumber: "cardNumber",
    CardNumber: "cardNumber",
    cardZoneType: "cardZoneType",
    CardZoneType: "cardZoneType",
    CardBaseType: "cardBaseType",
    CardOriginType: "cardOriginType"
  }));
  for (const [key, value] of Object.entries(flatArgs)) {
    const fieldName = key.split(".").at(-1);
    const field = cardKeyAliases.get(fieldName);
    if (!field) continue;
    if (["cardId", "cardName", "spellId"].includes(field) && (value == null || value === "")) continue;
    const ownerClass = /theCard/.test(key) ? "runtime:YVt" : "runtime:CardLike";
    pushEvidence(rows, record, {
      ownerClass,
      ownerLabel: ownerClass.replace(/^runtime:/, ""),
      field,
      evidenceType: "card-arg-value",
      after: value,
      meaning: "visible/current-operation card argument field captured from active method args; hidden opponent hand arrays were not expanded",
      confidence: "active-card-arg"
    });
  }
}

function buildEvidenceRows(records) {
  const rows = [];
  for (const record of records || []) {
    if (record.kind !== "call" && record.kind !== "blocked-call") continue;
    const owner = methodOwnerFromLabel(record);
    if (owner) {
      pushEvidence(rows, record, {
        ...owner,
        evidenceType: record.kind === "blocked-call" ? "blocked-call" : "method-call",
        before: record.beforeSelection || null,
        after: record.afterSelection || null,
        meaning: "method was invoked during the active TableGameScene operation chain",
        confidence: record.kind === "blocked-call" ? "active-blocked-call" : "active-method-call"
      });
    }

    const beforeSelection = flatten(record.beforeSelection || {});
    const afterSelection = flatten(record.afterSelection || {});
    for (const key of uniq([...Object.keys(beforeSelection), ...Object.keys(afterSelection)])) {
      if (sameValue(beforeSelection[key], afterSelection[key])) continue;
      const field = key.split(".").at(-1);
      const ownerClass = key.startsWith("seatContext.") ? "runtime:NBi" : key.startsWith("cardContainer.") ? "runtime:uBt" : "runtime:NBi";
      pushEvidence(rows, record, {
        ownerClass,
        ownerLabel: ownerClass.replace(/^runtime:/, ""),
        field,
        evidenceType: "selection-field-transition",
        before: beforeSelection[key],
        after: afterSelection[key],
        meaning: `${key} changed during active card/target selection`,
        confidence: "active-before-after"
      });
    }

    const beforeScene = sceneFields(record.sceneBefore);
    const afterScene = sceneFields(record.sceneAfter);
    for (const key of uniq([...Object.keys(beforeScene), ...Object.keys(afterScene)])) {
      if (sameValue(beforeScene[key], afterScene[key])) continue;
      pushEvidence(rows, record, {
        ownerClass: "TableGameScene",
        ownerLabel: "TableGameScene",
        field: key,
        evidenceType: "scene-field-transition",
        before: beforeScene[key],
        after: afterScene[key],
        meaning: `${key} changed on the TableGameScene scene snapshot around this call`,
        confidence: "active-scene-before-after"
      });
    }

    collectCardLikeEvidence(record, rows);
  }
  return rows;
}

function unresolvedKey(row) {
  return `${row.className || ""}\t${row.field || ""}`;
}

function evidenceKey(row) {
  return `${row.ownerClass || ""}\t${row.field || ""}`;
}

function looseClassMatch(unresolvedClass, evidenceClass) {
  if (!unresolvedClass || !evidenceClass) return false;
  if (unresolvedClass === evidenceClass) return true;
  const a = unresolvedClass.replace(/^runtime:/, "");
  const b = evidenceClass.replace(/^runtime:/, "");
  if (a === b) return true;
  if (/Card|JinNang|Delayed/i.test(a) && /YVt|CardLike|Card/i.test(b)) return true;
  if (/TableGameScene/.test(a) && /TableGameScene/.test(b)) return true;
  return false;
}

function matchEvidence(unresolvedRows, evidenceRows) {
  const exact = new Map();
  const byField = new Map();
  for (const evidence of evidenceRows) {
    const key = evidenceKey(evidence);
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key).push(evidence);
    if (!byField.has(evidence.field)) byField.set(evidence.field, []);
    byField.get(evidence.field).push(evidence);
  }

  const covered = [];
  const uncovered = [];
  for (const row of unresolvedRows) {
    const key = unresolvedKey(row);
    const exactMatches = exact.get(key) || [];
    const looseMatches = (byField.get(row.field) || []).filter((item) => looseClassMatch(row.className, item.ownerClass));
    const fieldOnlyMatches = (byField.get(row.field) || []).filter((item) => splitList(row.surfaces).some((surface) =>
      /card-selection|auto-play|skill-trigger|scene-window|battle-lifecycle/.test(surface)
    ));
    const matches = exactMatches.length ? exactMatches : looseMatches.length ? looseMatches : fieldOnlyMatches.slice(0, 8);
    if (!matches.length) {
      uncovered.push(row);
      continue;
    }
    const matchStrength = exactMatches.length ? "exact" : looseMatches.length ? "class-loose" : "field-surface";
    const seqs = matches.map((item) => Number(item.seq)).filter(Number.isFinite);
    covered.push({
      ...row,
      matchStrength,
      evidenceCount: matches.length,
      firstSeq: seqs.length ? Math.min(...seqs) : "",
      lastSeq: seqs.length ? Math.max(...seqs) : "",
      evidenceTypes: uniq(matches.map((item) => item.evidenceType)).join("|"),
      evidenceLabels: uniq(matches.map((item) => item.label)).slice(0, 12).join("|"),
      evidenceOwners: uniq(matches.map((item) => item.ownerClass)).slice(0, 12).join("|"),
      activeMeaning: uniq(matches.map((item) => item.meaning)).slice(0, 4).join("；"),
      sampleBefore: matches.find((item) => item.before)?.before || "",
      sampleAfter: matches.find((item) => item.after)?.after || ""
    });
  }
  return { covered, uncovered };
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || "(none)";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Active Operation Field Transition Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Active operation: ${report.inputs.activeOperation || "(none)"}`);
  lines.push(`- Unresolved fields: ${report.inputs.unresolvedFields || "(none)"}`);
  lines.push(`- Active records scanned: ${report.summary.recordsScanned}`);
  lines.push(`- Evidence rows: ${report.summary.evidenceRows}`);
  lines.push(`- Covered unresolved rows: ${report.summary.coveredUnresolvedRows}`);
  lines.push(`- Uncovered unresolved rows: ${report.summary.uncoveredUnresolvedRows}`);
  lines.push("");
  lines.push("## Covered By Strength");
  lines.push("");
  for (const [name, count] of Object.entries(report.summary.coveredByStrength)) lines.push(`- ${name}: ${count}`);
  lines.push("");
  lines.push("## Evidence Types");
  lines.push("");
  for (const [name, count] of Object.entries(report.summary.evidenceTypes)) lines.push(`- ${name}: ${count}`);
  lines.push("");
  lines.push("## Top Covered Owners");
  lines.push("");
  for (const [name, count] of Object.entries(report.summary.coveredOwners).slice(0, 16)) lines.push(`- ${name}: ${count}`);
  lines.push("");
  lines.push("## Interpretation");
  lines.push("");
  lines.push("- This is an offline report over already captured active-operation records; it does not connect to CDP or trigger game actions.");
  lines.push("- `exact` means the unresolved `className + field` exactly matched active evidence.");
  lines.push("- `class-loose` means the field matched and the runtime/minified owner maps to the same owner family.");
  lines.push("- `field-surface` is weaker: it proves the field name was active in the same non-purchase surface, but still needs owner-specific confirmation before being marked fully resolved.");
  lines.push("- Hidden opponent hand arrays remain excluded.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const active = await latestJson("-active-operation-dump", "active-operation-dump.json") ||
    await latestJson("-active-operation-dump-stop", "active-operation-dump-stop.json");
  if (!active) throw new Error("No active operation dump found.");
  const fieldIndexDir = await latestDir("-field-semantic-index-report", "unresolved-field-priority.tsv");
  if (!fieldIndexDir) throw new Error("No field semantic index unresolved TSV found.");
  const unresolvedPath = path.join(fieldIndexDir, "unresolved-field-priority.tsv");
  const unresolvedRows = await readTsv(unresolvedPath);
  const records = active.dump?.records || [];
  const evidenceRows = buildEvidenceRows(records);
  const { covered, uncovered } = matchEvidence(unresolvedRows, evidenceRows);
  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      activeOperation: active.__path,
      unresolvedFields: unresolvedPath
    },
    summary: {
      recordsScanned: records.length,
      unresolvedRows: unresolvedRows.length,
      evidenceRows: evidenceRows.length,
      coveredUnresolvedRows: covered.length,
      uncoveredUnresolvedRows: uncovered.length,
      coveredByStrength: countBy(covered, (row) => row.matchStrength),
      evidenceTypes: countBy(evidenceRows, (row) => row.evidenceType),
      coveredOwners: countBy(covered, (row) => row.className)
    },
    files: {
      evidenceTsv: path.join(outDir, "active-operation-field-evidence.tsv"),
      coveredTsv: path.join(outDir, "covered-unresolved-fields.tsv"),
      uncoveredTsv: path.join(outDir, "uncovered-unresolved-fields.tsv"),
      markdown: path.join(outDir, "README.md"),
      json: path.join(outDir, "active-operation-field-transition-report.json")
    }
  };

  await writeFile(report.files.evidenceTsv, writeTsv(evidenceRows, [
    "seq",
    "time",
    "label",
    "targetType",
    "sceneBefore",
    "sceneAfter",
    "promptBefore",
    "promptAfter",
    "ownerClass",
    "ownerLabel",
    "ownerPath",
    "field",
    "evidenceType",
    "before",
    "after",
    "meaning",
    "confidence"
  ]), "utf8");
  await writeFile(report.files.coveredTsv, writeTsv(covered, [
    "className",
    "functionName",
    "field",
    "fieldEvidence",
    "remaining",
    "finalMeaning",
    "surfaces",
    "roles",
    "needsLive",
    "permissionGated",
    "purchaseRisk",
    "matchStrength",
    "evidenceCount",
    "firstSeq",
    "lastSeq",
    "evidenceTypes",
    "evidenceLabels",
    "evidenceOwners",
    "activeMeaning",
    "sampleBefore",
    "sampleAfter"
  ]), "utf8");
  await writeFile(report.files.uncoveredTsv, writeTsv(uncovered, [
    "className",
    "functionName",
    "field",
    "fieldEvidence",
    "remaining",
    "finalMeaning",
    "surfaces",
    "roles",
    "needsLive",
    "permissionGated",
    "purchaseRisk"
  ]), "utf8");
  await writeFile(report.files.markdown, buildMarkdown(report), "utf8");
  await writeFile(report.files.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    outDir,
    recordsScanned: report.summary.recordsScanned,
    evidenceRows: report.summary.evidenceRows,
    coveredUnresolvedRows: report.summary.coveredUnresolvedRows,
    uncoveredUnresolvedRows: report.summary.uncoveredUnresolvedRows,
    coveredByStrength: report.summary.coveredByStrength
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
