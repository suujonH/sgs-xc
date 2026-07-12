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

async function latestDir(suffix, marker) {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => path.join(explorationRoot, entry.name))
    .sort()
    .reverse();
  for (const dir of dirs) {
    if (!marker || await readJsonIfExists(path.join(dir, marker))) return dir;
  }
  return null;
}

function outputDir() {
  return path.resolve(
    process.env.SGS_ROGUE_HANDLER_FIELD_JOIN_DIR ||
      path.join(explorationRoot, `${timestampName()}-rogue-handler-field-join-report`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function unique(values) {
  return Array.from(new Set((values || []).filter((value) => value !== "" && value != null)));
}

function tsvEscape(value) {
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value).replace(/\t|\r?\n/g, " ").slice(0, 900);
  return String(value).replace(/\t|\r?\n/g, " ");
}

function compact(value, max = 220) {
  return String(value ?? "").replace(/\s+/g, " ").slice(0, max);
}

function countBy(rows, keyFn) {
  const out = {};
  for (const row of rows) {
    const key = keyFn(row) || "(none)";
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function sceneBase(actionReport) {
  const sceneName = actionReport.currentScene?.className || actionReport.summary?.scene || "RogueLikeGameScene";
  return `Laya.stage/LBi#2/${sceneName}#0`;
}

function actionPathToOwnerPath(actionReport, actionPath) {
  if (actionPath === "CurrentScene") return sceneBase(actionReport);
  if (actionPath.startsWith("CurrentScene/")) return `${sceneBase(actionReport)}/${actionPath.slice("CurrentScene/".length)}`;
  if (actionPath === "WindowLayer") return "Laya.stage/mWt#3";
  if (actionPath.startsWith("WindowLayer/")) return `Laya.stage/mWt#3/${actionPath.slice("WindowLayer/".length)}`;
  return actionPath;
}

function ownerSignature(ownerPath) {
  const value = String(ownerPath || "");
  const sceneMatch = /RogueLikeGameScene#\d+\/?(.*)$/.exec(value);
  if (sceneMatch) return sceneMatch[1] || "";
  const windowMatch = /mWt#\d+\/?(.*)$/.exec(value);
  if (windowMatch) return `WindowLayer/${windowMatch[1] || ""}`;
  if (value === "currentScene") return "";
  return value;
}

function fieldKind(value) {
  if (value == null) return "null";
  if (Array.isArray(value)) return `array:${value.length}`;
  if (typeof value !== "object") return typeof value;
  if (value.kind === "function") return `function:${value.name || ""}`;
  if (value.kind === "array") return `array:${value.length ?? ""}`;
  if (value.kind === "object") return value.ctor || "object";
  if (value.kind) return value.kind;
  return value.ctor || "object";
}

function fieldValuePreview(value) {
  if (value == null || typeof value !== "object") return compact(value, 260);
  if (value.kind === "function") return compact(`${value.name || ""}(${value.arity ?? ""}) ${value.sourcePreview || ""}`, 260);
  if (value.kind === "array") return `[array ${value.length ?? ""}]`;
  if (value.kind === "object") return compact(`[${value.ctor || "object"}] keys=${(value.keys || []).slice(0, 12).join(",")} ${JSON.stringify(value.values || {}).slice(0, 220)}`, 360);
  return compact(JSON.stringify(value), 360);
}

function sourceFieldRefs(source) {
  const refs = new Set();
  for (const match of String(source || "").matchAll(/\b(?:this|t|i|s|e)\.([A-Za-z_$][\w$]*)/g)) {
    refs.add(match[1]);
  }
  return Array.from(refs).slice(0, 80);
}

function flattenHandlers(nodes, actionReport) {
  const rows = [];
  for (const node of nodes) {
    const ownerPath = actionPathToOwnerPath(actionReport, node.path);
    for (const [eventName, handlers] of Object.entries(node.events || {})) {
      if (!Array.isArray(handlers)) continue;
      for (const handler of handlers) {
        const source = handler.source || handler.sourcePreview || "";
        rows.push({
          nodePath: node.path,
          ownerPath,
          signature: ownerSignature(ownerPath),
          nodeLabel: node.label || "",
          nodeType: node.nodeType || "",
          nodeText: node.text || "",
          eventName,
          callerLabel: handler.callerLabel || "",
          callerCtor: handler.callerCtor || "",
          methodName: handler.methodName || "",
          methodArity: handler.methodArity ?? "",
          tags: handler.tags || [],
          sourceHash: handler.sourceHash || "",
          sourceLength: handler.sourceLength || String(source).length,
          sourcePreview: handler.sourcePreview || compact(source, 420),
          referencedFields: sourceFieldRefs(source)
        });
      }
    }
  }
  return rows;
}

function semanticIndexes(report) {
  const byOwnerField = new Map();
  const bySignatureField = new Map();
  for (const row of report.rows || []) {
    const key = `${row.ownerPath || ""}\t${row.field || ""}`;
    if (!byOwnerField.has(key)) byOwnerField.set(key, row);
    const sigKey = `${ownerSignature(row.ownerPath)}\t${row.field || ""}`;
    if (!bySignatureField.has(sigKey)) bySignatureField.set(sigKey, row);
  }
  return { byOwnerField, bySignatureField };
}

function triageIndexes(report) {
  const byOwnerField = new Map();
  const bySignatureField = new Map();
  for (const row of report.rows || []) {
    const key = `${row.ownerPath || ""}\t${row.field || ""}`;
    if (!byOwnerField.has(key)) byOwnerField.set(key, []);
    byOwnerField.get(key).push(row);
    const sigKey = `${ownerSignature(row.ownerPath)}\t${row.field || ""}`;
    if (!bySignatureField.has(sigKey)) bySignatureField.set(sigKey, []);
    bySignatureField.get(sigKey).push(row);
  }
  return { byOwnerField, bySignatureField };
}

function findSemantic(indexes, ownerPath, field) {
  return indexes.byOwnerField.get(`${ownerPath}\t${field}`) ||
    indexes.bySignatureField.get(`${ownerSignature(ownerPath)}\t${field}`) ||
    null;
}

function findTriage(indexes, ownerPath, field) {
  return indexes.byOwnerField.get(`${ownerPath}\t${field}`) ||
    indexes.bySignatureField.get(`${ownerSignature(ownerPath)}\t${field}`) ||
    [];
}

function inferFieldMeaning({ field, fieldKindText, semanticRow, handlerRows, node }) {
  const hints = [];
  if (semanticRow?.joinedMeaning) hints.push(semanticRow.joinedMeaning);
  if (semanticRow?.inferredMeaning) hints.push(semanticRow.inferredMeaning);
  const text = [
    field,
    fieldKindText,
    node.nodeType,
    node.text,
    ...(node.nodeTags || []),
    ...handlerRows.map((row) => `${row.eventName} ${row.methodName} ${row.sourcePreview}`)
  ].join(" ");
  if (/SELECT|Select|selected|autoSelect|AutoSelect|Target|choose|Choose/.test(text)) hints.push("selection or target-selection state");
  if (/card|Card|Hand|Discard|Equip|Pile|Zone|Move|TweenPos|NORMAL_Y|SELECTED_Y/.test(text)) hints.push("card UI, card movement, or card-zone layout");
  if (/skill|Skill|spell|Spell|responser|Response|zhanfa|ZhanFa/.test(text)) hints.push("skill/spell response or skill-button state");
  if (/mouse|Mouse|over|Over|out|Out|tip|Tip|tooltip|ToolTip|roll/i.test(text)) hints.push("hover or tooltip lifecycle");
  if (/click|Click|touch|Touch|button|Button|confirm|Confirm|cancel|Cancel/.test(text)) hints.push("button/click command surface");
  if (/effect|Effect|anim|Anim|tween|Tween|shake|Shake|hurt|Hurt/.test(text)) hints.push("effect, animation, or movement lifecycle");
  if (/round|Round|turn|Turn|phase|Phase|state|State|game|Game/.test(text)) hints.push("battle state-machine field");
  if (/Handler|EventHandler|method|caller|_events/.test(fieldKindText)) hints.push("event handler binding field");
  return unique(hints).slice(0, 5).join("; ") || "current live field on an action node; keep for owner-specific follow-up";
}

function evidenceLevel({ field, value, semanticRow, triageRows, handlerRows, node }) {
  const kind = fieldKind(value);
  const hasHandler = handlerRows.length > 0;
  if (/Handler|EventHandler/.test(kind) || /handler|Handler/.test(field)) return "handler-field-live-source";
  if (hasHandler && semanticRow && /high|medium/.test(semanticRow.confidence || "")) return "event-bound-live-source";
  if (hasHandler && triageRows.some((row) => row.requiresLiveSample)) return "event-bound-current-sample";
  if (semanticRow && /high|medium/.test(semanticRow.confidence || "")) return "live-source";
  if (node.nodeType && hasHandler) return "event-bound-current-node";
  return "current-live-field";
}

function buildFieldRows(actionReport, semanticsReport, triageReport) {
  const semantics = semanticIndexes(semanticsReport);
  const triage = triageIndexes(triageReport);
  const handlerRows = flattenHandlers(actionReport.nodes || [], actionReport);
  const handlersByOwner = new Map();
  for (const row of handlerRows) {
    const key = ownerSignature(row.ownerPath);
    if (!handlersByOwner.has(key)) handlersByOwner.set(key, []);
    handlersByOwner.get(key).push(row);
  }

  const fieldRows = [];
  for (const node of actionReport.nodes || []) {
    const ownerPath = actionPathToOwnerPath(actionReport, node.path);
    const ownerHandlers = handlersByOwner.get(ownerSignature(ownerPath)) || [];
    const eventNames = unique(ownerHandlers.map((row) => row.eventName));
    const handlerMethods = unique(ownerHandlers.map((row) => row.methodName).filter(Boolean));
    for (const [field, value] of Object.entries(node.fields || {})) {
      if (/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(field)) continue;
      const semanticRow = findSemantic(semantics, ownerPath, field);
      const triageRows = findTriage(triage, ownerPath, field);
      const kind = fieldKind(value);
      const level = evidenceLevel({ field, value, semanticRow, triageRows, handlerRows: ownerHandlers, node });
      fieldRows.push({
        nodePath: node.path,
        ownerPath,
        ownerSignature: ownerSignature(ownerPath),
        nodeLabel: node.label || "",
        nodeType: node.nodeType || "",
        nodeTags: node.nodeTags || [],
        nodeText: node.text || "",
        field,
        fieldKind: kind,
        fieldValue: fieldValuePreview(value),
        eventNames,
        handlerMethods: handlerMethods.slice(0, 16),
        handlerTags: unique(ownerHandlers.flatMap((row) => row.tags || [])),
        semanticConfidence: semanticRow?.confidence || "",
        semanticMeaning: semanticRow?.joinedMeaning || semanticRow?.inferredMeaning || "",
        semanticSurfaces: semanticRow?.surfaces || [],
        triageBuckets: unique(triageRows.map((row) => row.bucket)),
        triageActions: unique(triageRows.map((row) => row.action)),
        triageRequiresLive: triageRows.some((row) => row.requiresLiveSample),
        permissionGated: triageRows.some((row) => row.permissionGated),
        evidenceLevel: level,
        suggestedMeaning: inferFieldMeaning({ field, fieldKindText: kind, semanticRow, handlerRows: ownerHandlers, node })
      });
    }
  }
  return { fieldRows, handlerRows };
}

function topEntries(counts, limit = 12) {
  return Object.entries(counts).slice(0, limit).map(([key, count]) => ({ key, count }));
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Rogue Handler Field Join Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Action handler source: ${report.inputs.actionHandlerReport}`);
  lines.push(`- Field semantics source: ${report.inputs.fieldSemanticsReport}`);
  lines.push(`- Field gap triage source: ${report.inputs.fieldGapTriageReport}`);
  lines.push(`- Scene: ${report.runtime.scene}; manager=${report.runtime.managerCtor}; isGameOver=${report.runtime.isGameOver}`);
  lines.push(`- Action nodes=${report.summary.actionNodes}; event nodes=${report.summary.eventNodes}; handler rows=${report.summary.handlerRows}; field rows=${report.summary.fieldRows}`);
  lines.push(`- Semantic matched fields=${report.summary.semanticMatchedFields}; triage matched fields=${report.summary.triageMatchedFields}; needs-live rows sampled by current handlers=${report.summary.needsLiveRowsSampledByCurrentHandlers}`);
  lines.push("");
  lines.push("This report is read-only. It joins visible current Rogue action nodes to event handlers, field semantics, and live-field triage without clicking, confirming, buying, refreshing, or reading hidden opponent hand fields.");
  lines.push("");
  lines.push("## Evidence Levels");
  lines.push("");
  for (const item of topEntries(report.summary.evidenceLevels, 20)) {
    lines.push(`- ${item.key}: ${item.count}`);
  }
  lines.push("");
  lines.push("## Top Owners With Current Handler Evidence");
  lines.push("");
  for (const item of report.summary.topOwnersWithNeedsLiveHandlerEvidence) {
    lines.push(`- ${item.key}: ${item.count}`);
  }
  lines.push("");
  lines.push("## Key Handler Surfaces");
  lines.push("");
  for (const row of report.highValueHandlers.slice(0, 30)) {
    lines.push(`- ${row.ownerPath} :: ${row.eventName} -> ${row.callerLabel}.${row.methodName} [${row.tags.join(",") || "ui-event"}] ${row.sourcePreview}`);
  }
  lines.push("");
  lines.push("## Needs-Live Rows Strengthened By This Sample");
  lines.push("");
  for (const row of report.needsLiveStrengthened.slice(0, 40)) {
    lines.push(`- ${row.ownerPath} :: ${row.field} (${row.triageBuckets.join(",") || "needs-live"}) -> ${row.suggestedMeaning}; events=${row.eventNames.join(",") || "(none)"}; handlers=${row.handlerMethods.join(",") || "(none)"}`);
  }
  lines.push("");
  lines.push("## Outputs");
  lines.push("");
  lines.push(`- Field join TSV: ${report.outputs.fieldJoinTsv}`);
  lines.push(`- Handler surface TSV: ${report.outputs.handlerSurfaceTsv}`);
  lines.push(`- Needs-live strengthened TSV: ${report.outputs.needsLiveStrengthenedTsv}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const actionDir = await latestDir("-rogue-current-action-handler-report", "rogue-current-action-handler-report.json");
  const semanticsDir = await latestDir("-live-field-semantics-report", "live-field-semantics-report.json");
  const triageDir = await latestDir("-live-field-gap-triage-report", "live-field-gap-triage-report.json");
  if (!actionDir || !semanticsDir || !triageDir) {
    throw new Error("Missing source reports for rogue handler field join.");
  }
  const actionPath = path.join(actionDir, "rogue-current-action-handler-report.json");
  const semanticsPath = path.join(semanticsDir, "live-field-semantics-report.json");
  const triagePath = path.join(triageDir, "live-field-gap-triage-report.json");
  const actionReport = await readJson(actionPath);
  const semanticsReport = await readJson(semanticsPath);
  const triageReport = await readJson(triagePath);

  const { fieldRows, handlerRows } = buildFieldRows(actionReport, semanticsReport, triageReport);
  const needsLiveStrengthened = fieldRows
    .filter((row) => row.triageRequiresLive && /handler|event-bound/.test(row.evidenceLevel))
    .sort((a, b) => b.handlerMethods.length - a.handlerMethods.length || a.ownerPath.localeCompare(b.ownerPath) || a.field.localeCompare(b.field));
  const highValueHandlers = handlerRows
    .filter((row) => /(SELECT|skill|Skill|card|Card|click|mouse|touch|confirm|STATE|REFRESH|endSkill|touchSkill)/i.test(`${row.eventName} ${row.methodName} ${row.tags.join(" ")}`))
    .slice(0, 120);

  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });
  const fieldJoinTsv = path.join(outDir, "event-field-join.tsv");
  const handlerSurfaceTsv = path.join(outDir, "handler-surface.tsv");
  const needsLiveStrengthenedTsv = path.join(outDir, "needs-live-strengthened.tsv");

  await writeFile(fieldJoinTsv, [
    [
      "ownerPath",
      "nodePath",
      "nodeLabel",
      "nodeType",
      "field",
      "fieldKind",
      "fieldValue",
      "eventNames",
      "handlerMethods",
      "semanticConfidence",
      "triageBuckets",
      "evidenceLevel",
      "suggestedMeaning"
    ].join("\t"),
    ...fieldRows.map((row) => [
      row.ownerPath,
      row.nodePath,
      row.nodeLabel,
      row.nodeType,
      row.field,
      row.fieldKind,
      row.fieldValue,
      row.eventNames,
      row.handlerMethods,
      row.semanticConfidence,
      row.triageBuckets,
      row.evidenceLevel,
      row.suggestedMeaning
    ].map(tsvEscape).join("\t"))
  ].join("\n"), "utf8");

  await writeFile(handlerSurfaceTsv, [
    ["ownerPath", "nodePath", "nodeLabel", "eventName", "callerLabel", "methodName", "tags", "sourceHash", "referencedFields", "sourcePreview"].join("\t"),
    ...handlerRows.map((row) => [
      row.ownerPath,
      row.nodePath,
      row.nodeLabel,
      row.eventName,
      row.callerLabel,
      row.methodName,
      row.tags,
      row.sourceHash,
      row.referencedFields,
      row.sourcePreview
    ].map(tsvEscape).join("\t"))
  ].join("\n"), "utf8");

  await writeFile(needsLiveStrengthenedTsv, [
    ["ownerPath", "field", "fieldKind", "fieldValue", "triageBuckets", "eventNames", "handlerMethods", "evidenceLevel", "suggestedMeaning"].join("\t"),
    ...needsLiveStrengthened.map((row) => [
      row.ownerPath,
      row.field,
      row.fieldKind,
      row.fieldValue,
      row.triageBuckets,
      row.eventNames,
      row.handlerMethods,
      row.evidenceLevel,
      row.suggestedMeaning
    ].map(tsvEscape).join("\t"))
  ].join("\n"), "utf8");

  const summary = {
    actionNodes: actionReport.nodes?.length || 0,
    eventNodes: (actionReport.nodes || []).filter((node) => Object.keys(node.events || {}).length).length,
    handlerRows: handlerRows.length,
    fieldRows: fieldRows.length,
    semanticMatchedFields: fieldRows.filter((row) => row.semanticConfidence).length,
    triageMatchedFields: fieldRows.filter((row) => row.triageBuckets.length).length,
    needsLiveRowsSampledByCurrentHandlers: needsLiveStrengthened.length,
    evidenceLevels: countBy(fieldRows, (row) => row.evidenceLevel),
    handlerTags: countBy(handlerRows.flatMap((row) => row.tags || []), (value) => value),
    topOwnersWithNeedsLiveHandlerEvidence: topEntries(countBy(needsLiveStrengthened, (row) => row.ownerPath), 15)
  };

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      actionHandlerReport: actionPath,
      fieldSemanticsReport: semanticsPath,
      fieldGapTriageReport: triagePath
    },
    runtime: {
      scene: actionReport.summary?.scene || actionReport.currentScene?.sceneName || actionReport.currentScene?.className || "",
      managerCtor: actionReport.summary?.managerCtor || actionReport.manager?.ctor || "",
      isGameOver: actionReport.summary?.isGameOver === true,
      resourceVersion: actionReport.resourceVersion || "",
      layaVersion: actionReport.layaVersion || ""
    },
    summary,
    highValueHandlers,
    needsLiveStrengthened,
    outputs: {
      fieldJoinTsv,
      handlerSurfaceTsv,
      needsLiveStrengthenedTsv
    }
  };

  await writeJson(path.join(outDir, "rogue-handler-field-join-report.json"), report);
  await writeFile(path.join(outDir, "README.md"), buildMarkdown(report), "utf8");

  console.log(JSON.stringify({
    outDir,
    scene: report.runtime.scene,
    isGameOver: report.runtime.isGameOver,
    actionNodes: summary.actionNodes,
    handlerRows: summary.handlerRows,
    fieldRows: summary.fieldRows,
    semanticMatchedFields: summary.semanticMatchedFields,
    triageMatchedFields: summary.triageMatchedFields,
    needsLiveRowsSampledByCurrentHandlers: summary.needsLiveRowsSampledByCurrentHandlers,
    fieldJoinTsv,
    handlerSurfaceTsv,
    needsLiveStrengthenedTsv
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
