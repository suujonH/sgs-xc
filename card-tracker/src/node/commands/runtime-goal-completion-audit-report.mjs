import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

const OBJECTIVE_REQUIREMENTS = [
  {
    id: "all-registration-names",
    clause: "列出所有入口名/注册字符串/类，以及其中的一切；了解触发后各字段含义",
    strictExpectation: "All ClassUtils entries, runtime-only owners, methods, trigger rows, fields, and residual fields are indexed; field meanings are source/live backed or explicitly listed as remaining live-transition gaps.",
    atlasMechanismId: "",
    completionRule: "catalog-plus-transition"
  },
  {
    id: "trigger-monitoring-matrix",
    clause: "所有上述触发的监控方式都已经明确实现方法",
    strictExpectation: "Each target surface has a hook/monitor method, evidence path, purchase-risk boundary, and next-proof command when live samples are missing.",
    atlasMechanismId: "old-script-behavior-map",
    completionRule: "source-ok"
  },
  {
    id: "object-scene-window-switch",
    clause: "对象与画面切换、窗口打开/关闭",
    strictExpectation: "Scene/window transitions are monitored through GED/WindowManager/ClassUtils hooks plus effective Laya.stage scans.",
    atlasMechanismId: "object-scene-window-switch",
    completionRule: "live-plus-atlas"
  },
  {
    id: "battle-entry-exit-tracker-ui",
    clause: "进入战斗/离开战斗，记牌器自动显示与结束描绘",
    strictExpectation: "Battle boundary uses visible TableGameScene plus manager.seats; overlay renders only in battle and clears outside battle.",
    atlasMechanismId: "battle-entry-exit-tracker-ui",
    completionRule: "live-plus-atlas"
  },
  {
    id: "skill-trigger-protocol",
    clause: "技能触发、自动技能、协议/事件触发条件",
    strictExpectation: "Skill responders, prompt windows, selected card/target callbacks, and safe send/proxy hooks are mapped; automation remains gated where exact value transitions are missing.",
    atlasMechanismId: "skill-trigger-auto-skill",
    completionRule: "live-plus-remaining-cases"
  },
  {
    id: "card-ui-movement-selection",
    clause: "UI 中牌移动、自动出牌、自动选牌丢弃",
    strictExpectation: "Card UI selection/movement, visible/self/public cards, and move-card protocol paths are mapped without hidden-hand reads.",
    atlasMechanismId: "card-ui-movement-selection",
    completionRule: "live-plus-remaining-cases"
  },
  {
    id: "hover-popup",
    clause: "悬浮窗、技能/牌弹窗、鼠标 hover",
    strictExpectation: "Hover handlers and stage/window popup deltas are live-sampled; pure mouse-hover popup attachment must be proven.",
    atlasMechanismId: "hover-popup",
    completionRule: "partial-needs-live"
  },
  {
    id: "buttons-clicks-ui",
    clause: "按钮点击、游戏内 UI 点击",
    strictExpectation: "Click/touch/confirm/cancel methods are mapped, with purchase-risk calls blocked by default.",
    atlasMechanismId: "buttons-clicks-ui",
    completionRule: "live-plus-atlas"
  },
  {
    id: "effects-qifu-blocking",
    clause: "弹出特效、祈福界面自动显示、旧脚本屏蔽特效",
    strictExpectation: "Effect lifecycle and Bless/QiFu effect/blocking hooks are mapped; buy/shop branches are blocked.",
    atlasMechanismId: "effect-animation",
    completionRule: "live-plus-atlas"
  },
  {
    id: "rogue-overlays-shop-auto-skill",
    clause: "山河图辅助 UI、自动确认技能使用、山河图自动使用技能、商店/地图对象读取",
    strictExpectation: "Rogue scene/UI/shop/action handlers are mapped; non-purchase automation is gated by prompt/action proof.",
    atlasMechanismId: "rogue-overlays-shop-auto-skill",
    completionRule: "live-plus-remaining-cases"
  },
  {
    id: "kanshu",
    clause: "发财树/KanShu 窗口、状态、自动动作路径",
    strictExpectation: "KanShuWindow state and free-branch method chain are mapped; paid path remains blocked.",
    atlasMechanismId: "kanshu",
    completionRule: "live-plus-atlas"
  },
  {
    id: "shen-zhuge-qixing",
    clause: "旧脚本关于神诸葛/七星弹窗中的牌、公开武将牌/牌堆顶逻辑",
    strictExpectation: "QiXing/GuanXing windows and public-general/top-deck card facts are proven from visible/protocol/log fields, not hidden hands.",
    atlasMechanismId: "shen-zhuge-qixing",
    completionRule: "needs-real-popup"
  },
  {
    id: "yanjiao-list-allocation",
    clause: "严教窗口右侧候选列表、点击列表自动分配牌到对应状态",
    strictExpectation: "Real YanJiaoWindow sample proves right-side list placement, row click preview, and card distribution state before optional send.",
    atlasMechanismId: "yanjiao-list-allocation",
    completionRule: "partial-needs-real-window"
  },
  {
    id: "resource-drawing-replacement",
    clause: "资源文件描画与本地/网络资源替换方案",
    strictExpectation: "Laya drawing surfaces and ResourceVersion/URL rewrite paths are live-proven with load scheme evidence.",
    atlasMechanismId: "resource-drawing-replacement",
    completionRule: "live-plus-atlas"
  },
  {
    id: "old-script-behavior-map",
    clause: "旧脚本行为：记牌器、山河图、祈福、按钮、特效屏蔽、自动显示 UI",
    strictExpectation: "Old scripts are mapped to behavior groups and current implementation anchors; console logging is not treated as the event bus.",
    atlasMechanismId: "old-script-behavior-map",
    completionRule: "source-ok"
  },
  {
    id: "purchase-risk-boundary",
    clause: "除购买之外的自由探索",
    strictExpectation: "Purchase, refresh, recharge, pay, and confirm-buy methods are classified and blocked/skipped by default.",
    atlasMechanismId: "purchase-risk-boundary",
    completionRule: "boundary-ok"
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
  if (!filePath || !await exists(filePath)) return null;
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
    process.env.SGS_GOAL_COMPLETION_AUDIT_DIR ||
      path.join(explorationRoot, `${timestampName()}-goal-completion-audit`)
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

function boolish(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function countBy(rows, keyFn, limit = 12) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || "(none)";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => `${key}:${count}`)
    .join("|");
}

function findReq(objective, id) {
  return (objective?.requirements || []).find((row) => row.id === id) || null;
}

function findMechanism(atlas, id) {
  return (atlas?.surfaceSummary || []).find((row) => row.mechanismId === id) || null;
}

function findGoalCase(goalAudit, requirementId) {
  return (goalAudit?.cases || []).filter((row) => row.requirementId === requirementId);
}

function findPlaybookCaseRows(playbookRows, caseIds) {
  const ids = new Set(caseIds);
  return playbookRows.filter((row) => ids.has(row.caseId));
}

function evidenceList(items) {
  return items.filter(Boolean);
}

function statusFromRule(rule, coverageStatus, mechanism, goalCases, playRows, catalogSummary, atlasSummary) {
  const caseMissing = goalCases.filter((row) => row.missingProof).map((row) => row.missingProof);
  const caseObserved = goalCases.filter((row) => row.observedState).map((row) => row.observedState);
  const needsLiveRows = playRows.filter((row) => boolish(row.needsLive)).length;
  const permissionRows = playRows.filter((row) => boolish(row.permissionGated)).length;
  const purchaseRows = playRows.filter((row) => boolish(row.purchaseRisk)).length;
  const mechanismNeedsLive = Number(mechanism?.needsLiveRows || 0);
  const mechanismUnresolved = Number(mechanism?.unresolvedRows || 0);

  if (rule === "catalog-plus-transition") {
    const allMatched = catalogSummary?.matchedFieldRows === catalogSummary?.fieldSemanticRows &&
      catalogSummary?.matchedTriggerRows === catalogSummary?.triggerMonitoringRows &&
      catalogSummary?.matchedResidualRows === catalogSummary?.residualFieldRows;
    if (allMatched && (atlasSummary?.needsLiveRows || 0) > 0) {
      return {
        verdict: "incomplete",
        proofLevel: "indexed-all-evidence-needs-live-transition",
        remaining: `All entry/field/trigger/residual rows are indexed, but ${atlasSummary.needsLiveRows} mapped needs-live rows and ${atlasSummary.unresolvedRows} mapped unresolved rows remain before final field-transition completion.`,
        nextProof: "Run the live proof playbook cases against the corresponding real prompts/windows/scenes and regenerate field-semantic/active/residual joins."
      };
    }
    return {
      verdict: allMatched ? "proved" : "incomplete",
      proofLevel: allMatched ? "catalog-complete" : "catalog-mismatch",
      remaining: allMatched ? "" : "Some catalog rows are not matched.",
      nextProof: allMatched ? "" : "Regenerate entry catalog and inspect unmatched-evidence.tsv."
    };
  }

  if (rule === "needs-real-popup") {
    return {
      verdict: "incomplete",
      proofLevel: "missing-real-live-sample",
      remaining: caseMissing.join(" | ") || "No real QiXing/GuanXing/Shen Zhuge popup with visible public cards has been sampled.",
      nextProof: "Trigger a real QiXing/GuanXing/Shen Zhuge popup, capture qixing watcher output and visible public-general/top-deck card evidence, then regenerate coverage."
    };
  }

  if (rule === "partial-needs-real-window") {
    return {
      verdict: "incomplete",
      proofLevel: "partial-live-needs-real-window",
      remaining: caseMissing.join(" | ") || "Watcher is installable, but real YanJiaoWindow placement and row-click preview are not sampled.",
      nextProof: "Open a real YanJiaoWindow, capture candidate list render/click records, prove showSplitCard(index)+layoutCardUIs(true) changes card UI state."
    };
  }

  if (rule === "partial-needs-live") {
    return {
      verdict: "incomplete",
      proofLevel: "partial-live-needs-popup-delta",
      remaining: caseMissing.join(" | ") || "Hover handlers are sampled, but pure mouse-hover stage/window popup delta remains unobserved.",
      nextProof: "Run hover stage delta sampling while hovering a live skill/card node that should create a visible popup."
    };
  }

  if (rule === "live-plus-remaining-cases" && (needsLiveRows || permissionRows || purchaseRows || mechanismNeedsLive || mechanismUnresolved)) {
    return {
      verdict: coverageStatus === "live-proven" ? "monitoring-proven-incomplete-field-transitions" : "incomplete",
      proofLevel: "live-monitoring-proven-needs-targeted-transitions",
      remaining: `Coverage is ${coverageStatus}; mechanism needsLive=${mechanismNeedsLive}, unresolved=${mechanismUnresolved}; playbook needsLive=${needsLiveRows}, permissionGated=${permissionRows}, purchaseRisk=${purchaseRows}.`,
      nextProof: "Use remaining live-proof playbook rows for this requirement and regenerate active/residual field joins."
    };
  }

  if (rule === "source-ok" && ["source-proven", "live-proven"].includes(coverageStatus)) {
    return {
      verdict: "proved-for-source-scope",
      proofLevel: coverageStatus,
      remaining: mechanismNeedsLive ? `Mechanism atlas still lists ${mechanismNeedsLive} needs-live rows for related surfaces, but this source-scope requirement is proven.` : "",
      nextProof: ""
    };
  }

  if (rule === "boundary-ok") {
    return {
      verdict: "proved-boundary",
      proofLevel: "purchase-risk-classified",
      remaining: "",
      nextProof: ""
    };
  }

  if (coverageStatus === "live-proven") {
    return {
      verdict: mechanismNeedsLive ? "monitoring-proven-incomplete-field-transitions" : "proved",
      proofLevel: mechanismNeedsLive ? "live-proven-with-needs-live-fields" : "live-proven",
      remaining: mechanismNeedsLive ? `Mechanism atlas still lists ${mechanismNeedsLive} needs-live mapped rows.` : "",
      nextProof: mechanismNeedsLive ? "Run targeted value-transition samples if automation depends on these fields." : ""
    };
  }

  return {
    verdict: "incomplete",
    proofLevel: coverageStatus || "missing",
    remaining: caseMissing.join(" | ") || caseObserved.join(" | ") || "Coverage status is not live-proven.",
    nextProof: "Collect stronger evidence for this requirement and regenerate reports."
  };
}

function buildAuditRows({ objective, atlas, catalog, goalAudit, playbookRows }) {
  const catalogSummary = catalog?.summary || {};
  const atlasSummary = atlas?.summary || {};
  return OBJECTIVE_REQUIREMENTS.map((requirement) => {
    const objectiveRow = findReq(objective, requirement.id);
    const mechanism = requirement.atlasMechanismId ? findMechanism(atlas, requirement.atlasMechanismId) : null;
    const goalCases = findGoalCase(goalAudit, requirement.id);
    const caseIds = goalCases.map((row) => row.id);
    const playRows = findPlaybookCaseRows(playbookRows, caseIds);
    const result = statusFromRule(
      requirement.completionRule,
      objectiveRow?.status || "",
      mechanism,
      goalCases,
      playRows,
      catalogSummary,
      atlasSummary
    );
    const evidence = evidenceList([
      ...(objectiveRow?.evidence || []),
      mechanism ? atlas?.outputs?.summaryTsv : "",
      mechanism ? atlas?.outputs?.triggerMethodsTsv : "",
      mechanism ? atlas?.outputs?.fieldMeaningsTsv : "",
      catalog?.outputs?.entrySummaryTsv,
      ...goalCases.flatMap((row) => row.currentEvidence || [])
    ]);
    return {
      requirementId: requirement.id,
      objectiveClause: requirement.clause,
      strictExpectation: requirement.strictExpectation,
      coverageStatus: objectiveRow?.status || "(not-direct)",
      coverageRequirement: objectiveRow?.requirement || "",
      atlasMechanismId: requirement.atlasMechanismId,
      atlasTriggerRows: mechanism?.triggerRows ?? "",
      atlasFieldRows: mechanism?.fieldRows ?? "",
      atlasResidualRows: mechanism?.residualRows ?? "",
      atlasNeedsLiveRows: mechanism?.needsLiveRows ?? "",
      atlasUnresolvedRows: mechanism?.unresolvedRows ?? "",
      atlasPurchaseRiskRows: mechanism?.purchaseRiskRows ?? "",
      goalCaseIds: caseIds.join("|"),
      playbookRows: playRows.length,
      playbookNeedsLiveRows: playRows.filter((row) => boolish(row.needsLive)).length,
      playbookPermissionGatedRows: playRows.filter((row) => boolish(row.permissionGated)).length,
      playbookPurchaseRiskRows: playRows.filter((row) => boolish(row.purchaseRisk)).length,
      verdict: result.verdict,
      proofLevel: result.proofLevel,
      remainingToComplete: result.remaining,
      nextProof: result.nextProof,
      evidencePaths: evidence.slice(0, 40).join("|")
    };
  });
}

function buildRemainingRows({ auditRows, goalAudit, playbookRows }) {
  const byCase = new Map((goalAudit?.cases || []).map((row) => [row.id, row]));
  const rows = [];
  for (const audit of auditRows) {
    if (!/^incomplete|monitoring-proven-incomplete/.test(audit.verdict)) continue;
    const caseIds = splitList(audit.goalCaseIds);
    if (!caseIds.length) {
      rows.push({
        requirementId: audit.requirementId,
        caseId: "",
        target: audit.objectiveClause,
        coverageStatus: audit.coverageStatus,
        missingProof: audit.remainingToComplete,
        activationSignal: "",
        successEvidence: "",
        safeBoundary: "",
        commands: "",
        playbookRows: audit.playbookRows,
        nextProof: audit.nextProof
      });
      continue;
    }
    for (const caseId of caseIds) {
      const caseInfo = byCase.get(caseId) || {};
      const playRows = playbookRows.filter((row) => row.caseId === caseId);
      rows.push({
        requirementId: audit.requirementId,
        caseId,
        target: caseInfo.target || audit.objectiveClause,
        coverageStatus: audit.coverageStatus,
        missingProof: caseInfo.missingProof || audit.remainingToComplete,
        activationSignal: caseInfo.activationSignal || "",
        successEvidence: caseInfo.successEvidence || "",
        safeBoundary: caseInfo.safeBoundary || "",
        commands: (caseInfo.scripts || []).map((script) => script.command).filter(Boolean).join(" | "),
        playbookRows: playRows.length,
        needsLiveRows: playRows.filter((row) => boolish(row.needsLive)).length,
        permissionGatedRows: playRows.filter((row) => boolish(row.permissionGated)).length,
        purchaseRiskRows: playRows.filter((row) => boolish(row.purchaseRisk)).length,
        nextProof: audit.nextProof
      });
    }
  }
  return rows;
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Goal Completion Audit");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Goal complete: ${report.summary.goalComplete ? "yes" : "no"}`);
  lines.push(`- Audit requirements: ${report.summary.requirements}`);
  lines.push(`- Completed/proved rows: ${report.summary.provedRows}`);
  lines.push(`- Incomplete rows: ${report.summary.incompleteRows}`);
  lines.push(`- Source-scope proved rows: ${report.summary.sourceScopeRows}`);
  lines.push(`- Blocker rows: ${report.summary.blockerRows}`);
  lines.push(`- Latest coverage status counts: ${report.summary.coverageStatusCounts}`);
  lines.push("");
  lines.push("## Outputs");
  lines.push("");
  lines.push(`- Audit TSV: ${report.outputs.auditTsv}`);
  lines.push(`- Blockers TSV: ${report.outputs.blockersTsv}`);
  lines.push(`- Remaining live proof TSV: ${report.outputs.remainingLiveProofTsv}`);
  lines.push(`- JSON: ${report.outputs.json}`);
  lines.push("");
  lines.push("## Blockers");
  lines.push("");
  for (const row of report.blockerRows) {
    lines.push(`- ${row.requirementId}: ${row.proofLevel}; ${row.remainingToComplete || row.nextProof}`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This audit is strict: source or monitor implementation evidence is not treated as final completion when the objective requires live field meaning or a real popup/window sample.");
  lines.push("- Purchase-risk rows are evidence for the boundary, not actions to execute.");
  lines.push("- Do not mark the long-running goal complete until this audit has zero incomplete/blocker rows or the user explicitly narrows the objective.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const objectiveDir = await latestDir("-objective-coverage", "objective-coverage-report.json");
  const atlasDir = await latestDir("-mechanism-implementation-atlas-report", "mechanism-implementation-atlas.json");
  const catalogDir = await latestDir("-entry-evidence-catalog-report", "entry-evidence-catalog.json");
  const goalAuditDir = await latestDir("-goal-remaining-audit", "goal-remaining-audit.json");
  const playbookDir = await latestDir("-live-proof-playbook", "live-proof-playbook.json");

  const inputs = {
    objectiveCoverageJson: objectiveDir ? path.join(objectiveDir, "objective-coverage-report.json") : "",
    objectiveCoverageMd: objectiveDir ? path.join(objectiveDir, "objective-coverage-report.md") : "",
    mechanismAtlasJson: atlasDir ? path.join(atlasDir, "mechanism-implementation-atlas.json") : "",
    mechanismAtlasReadme: atlasDir ? path.join(atlasDir, "README.md") : "",
    entryCatalogJson: catalogDir ? path.join(catalogDir, "entry-evidence-catalog.json") : "",
    entryCatalogReadme: catalogDir ? path.join(catalogDir, "README.md") : "",
    goalRemainingAuditJson: goalAuditDir ? path.join(goalAuditDir, "goal-remaining-audit.json") : "",
    goalRemainingAuditMd: goalAuditDir ? path.join(goalAuditDir, "goal-remaining-audit.md") : "",
    liveProofPlaybookJson: playbookDir ? path.join(playbookDir, "live-proof-playbook.json") : "",
    liveProofPlaybookTsv: playbookDir ? path.join(playbookDir, "live-proof-playbook.tsv") : ""
  };

  const objective = await readJsonIfExists(inputs.objectiveCoverageJson);
  const atlas = await readJsonIfExists(inputs.mechanismAtlasJson);
  const catalog = await readJsonIfExists(inputs.entryCatalogJson);
  const goalAudit = await readJsonIfExists(inputs.goalRemainingAuditJson);
  const liveProofPlaybook = await readJsonIfExists(inputs.liveProofPlaybookJson);
  const playbookRows = await readTsvIfExists(inputs.liveProofPlaybookTsv);

  if (!objective) throw new Error("No objective coverage report found.");
  if (!atlas) throw new Error("No mechanism implementation atlas found.");
  if (!catalog) throw new Error("No entry evidence catalog found.");

  const auditRows = buildAuditRows({
    objective,
    atlas,
    catalog,
    goalAudit,
    playbookRows
  });
  const blockerRows = auditRows.filter((row) => /incomplete|missing|partial|needs/.test(`${row.verdict} ${row.proofLevel}`));
  const remainingLiveRows = buildRemainingRows({ auditRows, goalAudit, playbookRows });
  const summary = {
    goalComplete: blockerRows.length === 0,
    requirements: auditRows.length,
    provedRows: auditRows.filter((row) => row.verdict === "proved" || row.verdict === "proved-boundary").length,
    sourceScopeRows: auditRows.filter((row) => row.verdict === "proved-for-source-scope").length,
    incompleteRows: auditRows.filter((row) => row.verdict.includes("incomplete")).length,
    blockerRows: blockerRows.length,
    coverageStatusCounts: Object.entries(objective.statusCounts || {}).map(([key, count]) => `${key}:${count}`).join("|"),
    catalogEntries: catalog.summary?.catalogEntries || 0,
    registeredEntries: catalog.summary?.registeredEntries || 0,
    mappedTriggerRows: atlas.summary?.mappedTriggerRows || 0,
    mappedFieldRows: atlas.summary?.mappedFieldRows || 0,
    remainingLiveProofRows: remainingLiveRows.length,
    blockerVerdicts: countBy(blockerRows, (row) => row.verdict),
    blockerProofLevels: countBy(blockerRows, (row) => row.proofLevel)
  };

  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });
  const outputs = {
    json: path.join(outDir, "goal-completion-audit.json"),
    auditTsv: path.join(outDir, "goal-completion-audit.tsv"),
    blockersTsv: path.join(outDir, "completion-blockers.tsv"),
    remainingLiveProofTsv: path.join(outDir, "remaining-live-proof.tsv"),
    readme: path.join(outDir, "README.md")
  };
  const report = {
    generatedAt: new Date().toISOString(),
    inputs,
    outputs,
    summary,
    auditRows,
    blockerRows,
    remainingLiveRows
  };

  await writeFile(outputs.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const auditHeader = [
    "requirementId",
    "objectiveClause",
    "strictExpectation",
    "coverageStatus",
    "coverageRequirement",
    "atlasMechanismId",
    "atlasTriggerRows",
    "atlasFieldRows",
    "atlasResidualRows",
    "atlasNeedsLiveRows",
    "atlasUnresolvedRows",
    "atlasPurchaseRiskRows",
    "goalCaseIds",
    "playbookRows",
    "playbookNeedsLiveRows",
    "playbookPermissionGatedRows",
    "playbookPurchaseRiskRows",
    "verdict",
    "proofLevel",
    "remainingToComplete",
    "nextProof",
    "evidencePaths"
  ];
  await writeFile(outputs.auditTsv, writeTsv(auditRows, auditHeader), "utf8");
  await writeFile(outputs.blockersTsv, writeTsv(blockerRows, auditHeader), "utf8");
  await writeFile(outputs.remainingLiveProofTsv, writeTsv(remainingLiveRows, [
    "requirementId",
    "caseId",
    "target",
    "coverageStatus",
    "missingProof",
    "activationSignal",
    "successEvidence",
    "safeBoundary",
    "commands",
    "playbookRows",
    "needsLiveRows",
    "permissionGatedRows",
    "purchaseRiskRows",
    "nextProof"
  ]), "utf8");
  await writeFile(outputs.readme, buildMarkdown(report), "utf8");

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
