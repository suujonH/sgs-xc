import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

const MECHANISMS = [
  {
    id: "object-scene-window-switch",
    title: "对象与画面切换 / 窗口打开关闭",
    requirementIds: ["object-scene-window-switch"],
    triggerSurfaces: ["scene-window-switch"],
    oldGroups: ["sceneLifecycle", "networkMonitor"],
    oldBehaviorIds: ["ui-source-search", "network-capture"],
    implementation: "Hook GED/WindowManager/registered class methods, then rescan effective Laya.stage scene layer and WindowLayer."
  },
  {
    id: "battle-entry-exit-tracker-ui",
    title: "战斗切换 / 记牌器自动显示清理",
    requirementIds: ["battle-entry-exit-tracker-ui"],
    triggerSurfaces: ["battle-lifecycle"],
    oldGroups: ["knownCards", "overlayUi", "sceneLifecycle"],
    oldBehaviorIds: ["known-card-overlay"],
    implementation: "Visible TableGameScene plus manager.seats is the battle boundary; overlay renders only while effective visible battle scene exists."
  },
  {
    id: "skill-trigger-auto-skill",
    title: "技能触发 / 自动技能",
    requirementIds: ["skill-trigger-protocol"],
    triggerSurfaces: ["skill-trigger", "auto-play-select-discard"],
    oldGroups: ["selectDiscardSkill", "autoActions", "networkMonitor"],
    oldBehaviorIds: ["skill-rule-audit", "network-capture"],
    implementation: "Hook skill responders, prompt windows, GED/proxy sends, and selected card/target callbacks; active send paths stay case-gated."
  },
  {
    id: "card-ui-movement-selection",
    title: "UI 中牌移动 / 选牌 / 弃牌 / 自动出牌",
    requirementIds: ["card-ui-movement-selection"],
    triggerSurfaces: ["card-selection-movement", "auto-play-select-discard"],
    oldGroups: ["knownCards", "selectDiscardSkill", "autoActions"],
    oldBehaviorIds: ["known-card-overlay", "skill-rule-audit"],
    implementation: "Hook card UI selection/move methods and move-card protocol paths; visible/self/public card ids only."
  },
  {
    id: "hover-popup",
    title: "悬浮窗 / 技能牌弹窗",
    requirementIds: ["hover-popup"],
    triggerSurfaces: ["hover-popup"],
    oldGroups: ["overlayUi", "effects"],
    oldBehaviorIds: ["ui-source-search"],
    implementation: "Hook hover/mouse/event handlers and compare before/after stage/window popup nodes."
  },
  {
    id: "buttons-clicks-ui",
    title: "按钮点击 / 游戏内 UI 点击",
    requirementIds: ["buttons-clicks-ui"],
    triggerSurfaces: ["button-ui-click"],
    oldGroups: ["autoActions", "sceneLifecycle"],
    oldBehaviorIds: ["ui-source-search"],
    implementation: "Hook click/touch/confirm/cancel methods, record arguments, and rescan stage/window/UI state after the call."
  },
  {
    id: "effect-animation",
    title: "弹出特效 / 动画 / 屏蔽特效",
    requirementIds: ["effects-qifu-blocking"],
    triggerSurfaces: ["effect-animation", "bless-qifu"],
    oldGroups: ["effects", "purchaseRisk"],
    oldBehaviorIds: ["resource-probe", "ui-source-search"],
    implementation: "Hook effect InitEffect/addEffect/show/open methods; block purchase-like branches while recording effect lifecycle."
  },
  {
    id: "rogue-overlays-shop-auto-skill",
    title: "山河图辅助 UI / 商店读取 / 自动确认技能",
    requirementIds: ["rogue-overlays-shop-auto-skill"],
    triggerSurfaces: ["rogue"],
    oldGroups: ["rogue", "overlayUi", "autoActions"],
    oldBehaviorIds: ["rogue-reward-overlay", "rogue-shop-probe"],
    implementation: "Use visible Rogue scenes, PveMgr data, cityView item bounds, and Rogue window/action handlers; purchase/refresh methods are blocked."
  },
  {
    id: "kanshu",
    title: "发财树 / KanShu 自动流程",
    requirementIds: ["kanshu"],
    triggerSurfaces: ["kanshu"],
    oldGroups: ["kanshu", "autoActions", "purchaseRisk"],
    oldBehaviorIds: ["kanshu-claim"],
    implementation: "Find KanShuWindow/wXi, read jbpUserData/jbpawardVo, and use onKanShuClick -> autoClickAllPeach -> trueReqJbpAwd for free branch only."
  },
  {
    id: "yanjiao-list-allocation",
    title: "严教右侧候选列表 / 自动分配预览",
    requirementIds: ["yanjiao-list-allocation"],
    triggerSurfaces: ["yanjiao"],
    oldGroups: ["selectDiscardSkill", "autoActions"],
    oldBehaviorIds: ["skill-rule-audit"],
    implementation: "Hook YanJiaoWindow show/update/layout methods; list-row preview calls showSplitCard(index) then layoutCardUIs(true); send stays explicit."
  },
  {
    id: "shen-zhuge-qixing",
    title: "神诸葛 / 七星 / 观星公开牌",
    requirementIds: ["shen-zhuge-qixing"],
    triggerSurfaces: ["qixing-shen-zhuge"],
    oldGroups: ["shenZhugeGeneral", "knownCards", "selectDiscardSkill"],
    oldBehaviorIds: ["known-card-overlay", "skill-rule-audit"],
    implementation: "Hook QiXing/GuanXing windows and public general/deck-top movement paths; never infer hidden hand cards."
  },
  {
    id: "resource-drawing-replacement",
    title: "资源描画 / 资源替换",
    requirementIds: ["resource-drawing-replacement"],
    triggerSurfaces: ["resource-drawing"],
    oldGroups: ["networkMonitor", "effects"],
    oldBehaviorIds: ["resource-probe"],
    implementation: "Draw through Laya Image/Sprite/loader surfaces; replace by logical path via ResourceVersion.addVersionPrefix or URL.customFormat."
  },
  {
    id: "old-script-behavior-map",
    title: "旧脚本自动 UI / 行为迁移",
    requirementIds: ["old-script-behavior-map"],
    triggerSurfaces: ["scene-window-switch", "battle-lifecycle", "rogue", "kanshu", "qixing-shen-zhuge", "effect-animation"],
    oldGroups: ["sceneLifecycle", "overlayUi", "rogue", "knownCards", "kanshu", "autoActions", "selectDiscardSkill", "shenZhugeGeneral", "effects", "networkMonitor"],
    oldBehaviorIds: ["rogue-reward-overlay", "known-card-overlay", "rogue-shop-probe", "kanshu-claim", "skill-rule-audit", "ui-source-search", "resource-probe", "network-capture"],
    implementation: "Use old scripts as reference evidence for CDP Runtime.evaluate + Laya.stage traversal and reversible method hooks; console output is diagnostic only."
  },
  {
    id: "purchase-risk-boundary",
    title: "购买/刷新/支付风险边界",
    requirementIds: [],
    triggerSurfaces: ["purchase-risk"],
    oldGroups: ["purchaseRisk"],
    oldBehaviorIds: [],
    implementation: "Classify and block purchase-like methods by default; keep them as evidence but exclude them from free exploration actions."
  }
];

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

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
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
    process.env.SGS_MECHANISM_IMPLEMENTATION_ATLAS_DIR ||
      path.join(explorationRoot, `${timestampName()}-mechanism-implementation-atlas-report`)
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
  return Array.from(new Set((values || []).filter((value) => value != null && value !== "").map(String)));
}

function boolish(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function includesAny(listValue, expected) {
  const values = new Set(splitList(listValue));
  return expected.some((item) => values.has(item));
}

function bump(counts, key, amount = 1) {
  const cleanKey = String(key || "").trim() || "(none)";
  counts[cleanKey] = (counts[cleanKey] || 0) + amount;
}

function bumpList(counts, values) {
  for (const value of splitList(values)) bump(counts, value);
}

function shortLabel(value, limit = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function sortedCounts(counts, limit = 12) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function countText(counts, limit = 12) {
  return sortedCounts(counts, limit).map((row) => `${row.key}:${row.count}`).join("|");
}

function oldBehaviorSummary(oldScriptMap, mechanism) {
  const behaviors = oldScriptMap?.behaviors || [];
  const wanted = new Set(mechanism.oldBehaviorIds || []);
  const byGroup = new Set(mechanism.oldGroups || []);
  return behaviors
    .filter((behavior) =>
      wanted.has(behavior.id) ||
      (behavior.groups || []).some((group) => byGroup.has(group))
    )
    .map((behavior) => ({
      id: behavior.id,
      title: behavior.title,
      groups: behavior.groups || [],
      monitoring: behavior.monitoring || "",
      trigger: behavior.trigger || "",
      action: behavior.action || "",
      risk: behavior.risk || "",
      evidenceFiles: unique((behavior.evidence || []).map((item) => item.file)).slice(0, 12)
    }));
}

function summarizeRows(rows, keyFn, limit = 16) {
  const counts = {};
  for (const row of rows) bump(counts, keyFn(row));
  return countText(counts, limit);
}

function sourcePath(...parts) {
  return parts.some((part) => !part) ? "" : path.join(...parts);
}

function buildSurfaceRows(mechanism, context) {
  const triggerRows = context.triggerEvidenceRows.filter((row) => includesAny(row.surfaces, mechanism.triggerSurfaces));
  const fieldRows = context.fieldEvidenceRows.filter((row) => includesAny(row.surfaces, mechanism.triggerSurfaces));
  const residualRows = context.residualEvidenceRows.filter((row) => includesAny(row.surfaces, mechanism.triggerSurfaces));
  const requirementRows = context.objective?.requirements?.filter((row) => (mechanism.requirementIds || []).includes(row.id)) || [];
  const oldBehaviors = oldBehaviorSummary(context.oldScriptMap, mechanism);

  const entryCounts = {};
  const methodCounts = {};
  const monitoringCounts = {};
  const roleCounts = {};
  const fieldCounts = {};
  const hookTargets = [];
  for (const row of triggerRows) {
    bump(entryCounts, row.entryName || row.className);
    bump(methodCounts, shortLabel(row.method, 80));
    bump(monitoringCounts, shortLabel(row.monitoringMethod, 120));
    bumpList(roleCounts, row.roles);
    if (row.hookTarget && hookTargets.length < 12) hookTargets.push(row.hookTarget);
  }
  for (const row of fieldRows) {
    bump(entryCounts, row.entryName || row.className);
    bumpList(roleCounts, row.roles);
    bump(fieldCounts, row.field);
  }
  for (const row of residualRows) {
    bump(entryCounts, row.entryName || row.className);
    bumpList(roleCounts, row.roles);
    bump(fieldCounts, row.field);
  }

  const purchaseRiskRows =
    triggerRows.filter((row) => boolish(row.purchaseRisk)).length +
    fieldRows.filter((row) => boolish(row.purchaseRisk)).length +
    residualRows.filter((row) => boolish(row.purchaseRisk)).length;
  const needsLiveRows =
    fieldRows.filter((row) => boolish(row.needsLive)).length +
    residualRows.filter((row) => boolish(row.needsLive)).length;
  const permissionGatedRows =
    fieldRows.filter((row) => boolish(row.permissionGated)).length +
    residualRows.filter((row) => boolish(row.permissionGated)).length;
  const unresolvedRows =
    fieldRows.filter((row) => row.remaining).length +
    residualRows.filter((row) => row.remaining).length;

  return {
    mechanismId: mechanism.id,
    title: mechanism.title,
    requirementIds: (mechanism.requirementIds || []).join("|"),
    requirementStatus: requirementRows.map((row) => `${row.id}:${row.status}`).join("|") || "(not-direct)",
    triggerSurfaces: mechanism.triggerSurfaces.join("|"),
    triggerRows: triggerRows.length,
    fieldRows: fieldRows.length,
    residualRows: residualRows.length,
    oldBehaviorRows: oldBehaviors.length,
    needsLiveRows,
    permissionGatedRows,
    unresolvedRows,
    purchaseRiskRows,
    topEntries: countText(entryCounts, 14),
    topMethods: countText(methodCounts, 14),
    topFields: countText(fieldCounts, 14),
    topRoles: countText(roleCounts, 14),
    monitoringMethods: countText(monitoringCounts, 8),
    hookTargetSamples: hookTargets.join("|"),
    oldBehaviorIds: oldBehaviors.map((row) => row.id).join("|"),
    implementation: mechanism.implementation,
    requirementEvidence: unique(requirementRows.flatMap((row) => row.evidence || [])).slice(0, 20).join("|")
  };
}

function mappedTriggerRows(mechanisms, triggerRows) {
  const out = [];
  for (const row of triggerRows) {
    for (const mechanism of mechanisms) {
      if (!includesAny(row.surfaces, mechanism.triggerSurfaces)) continue;
      out.push({
        mechanismId: mechanism.id,
        mechanismTitle: mechanism.title,
        entryName: row.entryName,
        entryFunctionName: row.entryFunctionName,
        className: row.className,
        functionName: row.functionName,
        method: row.method,
        sourceKind: row.sourceKind,
        roles: row.roles,
        surfaces: row.surfaces,
        purchaseRisk: row.purchaseRisk,
        hookTarget: row.hookTarget,
        monitoringMethod: row.monitoringMethod,
        evidence: row.evidence,
        protocolFields: row.protocolFields,
        eventBindings: row.eventBindings
      });
    }
  }
  return out;
}

function mappedFieldRows(mechanisms, fieldRows, residualRows) {
  const out = [];
  for (const source of [
    ["field-semantic", fieldRows],
    ["residual-field", residualRows]
  ]) {
    const [sourceKind, rows] = source;
    for (const row of rows) {
      for (const mechanism of mechanisms) {
        if (!includesAny(row.surfaces, mechanism.triggerSurfaces)) continue;
        out.push({
          mechanismId: mechanism.id,
          mechanismTitle: mechanism.title,
          sourceKind,
          entryName: row.entryName,
          entryFunctionName: row.entryFunctionName,
          className: row.className,
          functionName: row.functionName,
          field: row.field,
          fieldEvidence: row.fieldEvidence || row.evidenceGrade || "",
          meaning: row.finalMeaning || row.suggestedMeaning || row.sourceMeaning || "",
          surfaces: row.surfaces,
          roles: row.roles,
          methods: row.methods || row.triggerMethods || "",
          eventNames: row.eventNames || "",
          needsLive: row.needsLive,
          permissionGated: row.permissionGated,
          purchaseRisk: row.purchaseRisk,
          remaining: row.remaining || "",
          nextProof: row.nextProof || "",
          sampleLiveValue: row.sampleLiveValue || "",
          exactValueType: row.exactValueType || "",
          exactValueText: row.exactValueText || ""
        });
      }
    }
  }
  return out;
}

function oldScriptRows(mechanisms, oldScriptMap) {
  const rows = [];
  for (const mechanism of mechanisms) {
    for (const behavior of oldBehaviorSummary(oldScriptMap, mechanism)) {
      rows.push({
        mechanismId: mechanism.id,
        mechanismTitle: mechanism.title,
        behaviorId: behavior.id,
        behaviorTitle: behavior.title,
        groups: behavior.groups.join("|"),
        monitoring: behavior.monitoring,
        trigger: behavior.trigger,
        action: behavior.action,
        risk: behavior.risk,
        evidenceFiles: behavior.evidenceFiles.join("|")
      });
    }
  }
  return rows;
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Runtime Mechanism Implementation Atlas");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Mechanisms: ${report.summary.mechanisms}`);
  lines.push(`- Trigger rows mapped: ${report.summary.mappedTriggerRows}`);
  lines.push(`- Field rows mapped: ${report.summary.mappedFieldRows}`);
  lines.push(`- Old-script behavior links: ${report.summary.oldScriptRows}`);
  lines.push(`- Purchase-risk mapped rows: ${report.summary.purchaseRiskRows}`);
  lines.push(`- Needs-live mapped rows: ${report.summary.needsLiveRows}`);
  lines.push("");
  lines.push("## Outputs");
  lines.push("");
  lines.push(`- Summary TSV: ${report.outputs.summaryTsv}`);
  lines.push(`- Trigger methods TSV: ${report.outputs.triggerMethodsTsv}`);
  lines.push(`- Field meanings TSV: ${report.outputs.fieldMeaningsTsv}`);
  lines.push(`- Old script links TSV: ${report.outputs.oldScriptLinksTsv}`);
  lines.push(`- JSON: ${report.outputs.json}`);
  lines.push("");
  lines.push("## Mechanism Summary");
  lines.push("");
  for (const row of report.surfaceSummary) {
    lines.push(`- ${row.mechanismId}: triggers=${row.triggerRows}, fields=${row.fieldRows}, residual=${row.residualRows}, needsLive=${row.needsLiveRows}, purchaseRisk=${row.purchaseRiskRows}, status=${row.requirementStatus}`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This atlas is a read-only join over saved evidence. It does not click, send, buy, refresh, or change game state.");
  lines.push("- For full per-entry details, use the latest entry evidence catalog linked in the inputs.");
  lines.push("- Purchase-risk rows remain evidence only and are excluded from free exploration actions unless explicitly allowed.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const entryDir = await latestDir("-entry-evidence-catalog-report", "entry-summary.tsv");
  const triggerDir = await latestDir("-trigger-monitoring-report", "trigger-monitoring-index.tsv");
  const objectiveDir = await latestDir("-objective-coverage", "objective-coverage-report.json");
  const oldScriptDir = await latestDir("-old-script-map", "old-script-behavior-map.json");
  const residualDir = await latestDir("-residual-field-source-report", "residual-field-source.tsv");
  const liveProofDir = await latestDir("-live-proof-playbook", "live-proof-playbook.tsv");
  const goalAuditDir = await latestDir("-goal-remaining-audit", "goal-remaining-audit.tsv");

  if (!entryDir) throw new Error("No entry evidence catalog report found.");

  const inputs = {
    entryCatalogReadme: sourcePath(entryDir, "README.md"),
    entrySummaryTsv: sourcePath(entryDir, "entry-summary.tsv"),
    entryTriggerEvidenceTsv: sourcePath(entryDir, "entry-trigger-evidence.tsv"),
    entryFieldEvidenceTsv: sourcePath(entryDir, "entry-field-evidence.tsv"),
    entryResidualEvidenceTsv: sourcePath(entryDir, "entry-residual-evidence.tsv"),
    triggerMonitoringTsv: triggerDir ? sourcePath(triggerDir, "trigger-monitoring-index.tsv") : "",
    objectiveCoverageJson: objectiveDir ? sourcePath(objectiveDir, "objective-coverage-report.json") : "",
    objectiveCoverageMd: objectiveDir ? sourcePath(objectiveDir, "objective-coverage-report.md") : "",
    oldScriptMapJson: oldScriptDir ? sourcePath(oldScriptDir, "old-script-behavior-map.json") : "",
    oldScriptMapMd: oldScriptDir ? sourcePath(oldScriptDir, "old-script-behavior-map.md") : "",
    residualFieldSourceTsv: residualDir ? sourcePath(residualDir, "residual-field-source.tsv") : "",
    liveProofPlaybookTsv: liveProofDir ? sourcePath(liveProofDir, "live-proof-playbook.tsv") : "",
    goalRemainingAuditTsv: goalAuditDir ? sourcePath(goalAuditDir, "goal-remaining-audit.tsv") : ""
  };

  const context = {
    entrySummaryRows: await readTsvIfExists(inputs.entrySummaryTsv),
    triggerEvidenceRows: await readTsvIfExists(inputs.entryTriggerEvidenceTsv),
    fieldEvidenceRows: await readTsvIfExists(inputs.entryFieldEvidenceTsv),
    residualEvidenceRows: await readTsvIfExists(inputs.entryResidualEvidenceTsv),
    objective: await readJsonIfExists(inputs.objectiveCoverageJson),
    oldScriptMap: await readJsonIfExists(inputs.oldScriptMapJson)
  };

  const surfaceSummary = MECHANISMS.map((mechanism) => buildSurfaceRows(mechanism, context));
  const triggerMethodRows = mappedTriggerRows(MECHANISMS, context.triggerEvidenceRows);
  const fieldMeaningRows = mappedFieldRows(MECHANISMS, context.fieldEvidenceRows, context.residualEvidenceRows);
  const oldLinks = oldScriptRows(MECHANISMS, context.oldScriptMap);

  const summary = {
    mechanisms: MECHANISMS.length,
    entryRows: context.entrySummaryRows.length,
    triggerEvidenceRows: context.triggerEvidenceRows.length,
    fieldEvidenceRows: context.fieldEvidenceRows.length,
    residualEvidenceRows: context.residualEvidenceRows.length,
    mappedTriggerRows: triggerMethodRows.length,
    mappedFieldRows: fieldMeaningRows.length,
    oldScriptRows: oldLinks.length,
    purchaseRiskRows: surfaceSummary.reduce((sum, row) => sum + row.purchaseRiskRows, 0),
    needsLiveRows: surfaceSummary.reduce((sum, row) => sum + row.needsLiveRows, 0),
    permissionGatedRows: surfaceSummary.reduce((sum, row) => sum + row.permissionGatedRows, 0),
    unresolvedRows: surfaceSummary.reduce((sum, row) => sum + row.unresolvedRows, 0),
    requirementStatuses: summarizeRows(surfaceSummary, (row) => row.requirementStatus)
  };

  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });
  const outputs = {
    json: path.join(outDir, "mechanism-implementation-atlas.json"),
    summaryTsv: path.join(outDir, "mechanism-surface-summary.tsv"),
    triggerMethodsTsv: path.join(outDir, "mechanism-trigger-methods.tsv"),
    fieldMeaningsTsv: path.join(outDir, "mechanism-field-meanings.tsv"),
    oldScriptLinksTsv: path.join(outDir, "mechanism-old-script-links.tsv"),
    readme: path.join(outDir, "README.md")
  };

  const report = {
    generatedAt: new Date().toISOString(),
    inputs,
    outputs,
    summary,
    mechanisms: MECHANISMS,
    surfaceSummary
  };

  await writeFile(outputs.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(outputs.summaryTsv, writeTsv(surfaceSummary, [
    "mechanismId",
    "title",
    "requirementIds",
    "requirementStatus",
    "triggerSurfaces",
    "triggerRows",
    "fieldRows",
    "residualRows",
    "oldBehaviorRows",
    "needsLiveRows",
    "permissionGatedRows",
    "unresolvedRows",
    "purchaseRiskRows",
    "topEntries",
    "topMethods",
    "topFields",
    "topRoles",
    "monitoringMethods",
    "hookTargetSamples",
    "oldBehaviorIds",
    "implementation",
    "requirementEvidence"
  ]), "utf8");
  await writeFile(outputs.triggerMethodsTsv, writeTsv(triggerMethodRows, [
    "mechanismId",
    "mechanismTitle",
    "entryName",
    "entryFunctionName",
    "className",
    "functionName",
    "method",
    "sourceKind",
    "roles",
    "surfaces",
    "purchaseRisk",
    "hookTarget",
    "monitoringMethod",
    "evidence",
    "protocolFields",
    "eventBindings"
  ]), "utf8");
  await writeFile(outputs.fieldMeaningsTsv, writeTsv(fieldMeaningRows, [
    "mechanismId",
    "mechanismTitle",
    "sourceKind",
    "entryName",
    "entryFunctionName",
    "className",
    "functionName",
    "field",
    "fieldEvidence",
    "meaning",
    "surfaces",
    "roles",
    "methods",
    "eventNames",
    "needsLive",
    "permissionGated",
    "purchaseRisk",
    "remaining",
    "nextProof",
    "sampleLiveValue",
    "exactValueType",
    "exactValueText"
  ]), "utf8");
  await writeFile(outputs.oldScriptLinksTsv, writeTsv(oldLinks, [
    "mechanismId",
    "mechanismTitle",
    "behaviorId",
    "behaviorTitle",
    "groups",
    "monitoring",
    "trigger",
    "action",
    "risk",
    "evidenceFiles"
  ]), "utf8");
  await writeFile(outputs.readme, buildMarkdown({ ...report, surfaceSummary }), "utf8");

  console.log(JSON.stringify({
    outDir,
    summary,
    outputs
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
