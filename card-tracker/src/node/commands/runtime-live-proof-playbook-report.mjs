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

async function latestDir(suffix) {
  let entries = [];
  try {
    entries = await readdir(explorationRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => path.join(explorationRoot, entry.name))
    .sort()
    .reverse();
  return dirs[0] || null;
}

async function latestJson(suffix, fileName) {
  const dir = await latestDir(suffix);
  if (!dir) return null;
  const filePath = path.join(dir, fileName);
  if (!(await exists(filePath))) return null;
  const value = JSON.parse(await readFile(filePath, "utf8"));
  value.__dir = dir;
  value.__path = filePath;
  return value;
}

async function readTextIfExists(filePath) {
  if (!filePath || !(await exists(filePath))) return "";
  return readFile(filePath, "utf8");
}

function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]] = cells[i] ?? "";
    return row;
  });
}

function splitList(value) {
  return String(value || "")
    .split(/[|;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function boolish(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function tsvCell(value) {
  if (Array.isArray(value)) return value.join("|").replace(/\r?\n|\t/g, " ");
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value).replace(/\r?\n|\t/g, " ");
  return String(value).replace(/\r?\n|\t/g, " ");
}

function mdCell(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replaceAll("|", "\\|");
}

function uniq(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function countBy(rows, keyFn, limit = 12) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "(none)";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function textOf(row) {
  return [
    row.className,
    row.functionName,
    row.field,
    row.finalMeaning,
    row.surfaces,
    row.roles,
    row.triggerMethods,
    row.handlerMethods,
    row.liveOwners,
    row.triageBuckets,
    row.triageActions,
    row.remaining
  ].join(" ");
}

const caseMatchers = [
  {
    id: "qixing-shen-zhuge-real-popup",
    score: (row) => /QiXing|Qixing|GuanXing|Shen.?Zhuge|神诸葛|七星|观星|publicGeneral|public-general|generalCard/i.test(textOf(row)) ? 100 : 0
  },
  {
    id: "yanjiao-real-window-list-click",
    score: (row) => /YanJiao|严教|splitCard|showSplit|autoChoose|MoveCardToZoneResponse|sendAutoChooseMoveOpt/i.test(textOf(row)) ? 100 : 0
  },
  {
    id: "kanshu-free-claim-branch",
    score: (row) => /KanShu|发财树|jbp|peach|trueReqJbpAwd|onKanShuClick|buyPorpItem|gotoPay/i.test(textOf(row)) ? 95 : 0
  },
  {
    id: "resource-drawing-replacement",
    score: (row) => /resource|Resource|res\/|skin|Texture|drawTexture|loadImage|Laya\.URL|ResourceVersion|manifest|version|替换|资源/i.test(textOf(row)) || splitList(row.surfaces).includes("resource-drawing") ? 94 : 0
  },
  {
    id: "qifu-natural-animation-free-branch",
    score: (row) => /Bless|QiFu|祈福|bless|addEffect|effectStop|updateSkipAnim|confirmBuy|shopBtn/i.test(textOf(row)) || splitList(row.surfaces).includes("bless-qifu") ? 92 : 0
  },
  {
    id: "hover-stage-attached-popup",
    score: (row) => /hover|roll|Roll|toolTip|ToolTip|tooltip|SkillPopUp|SkillToolTip|mouseOver|mouseOut|cardRoll/i.test(textOf(row)) || splitList(row.surfaces).includes("hover-popup") ? 90 : 0
  },
  {
    id: "rogue-specific-skill-auto-use",
    score: (row) => /Rogue|PveMgr|zhanfa|战法|ChangeSkill|SkillBiFaRogue|RogueFight|RogueSmallMap/i.test(textOf(row)) || splitList(row.surfaces).includes("rogue") ? 82 : 0
  },
  {
    id: "non-ended-prompt-auto-action",
    score: (row) => /SelectCardWindow|SkillBiFa|SpellMulti|prompt|confirm|ensure|SendMsg|Response|GetResponser|SkillSelector/i.test(textOf(row)) || splitList(row.surfaces).includes("skill-trigger") ? 76 : 0
  },
  {
    id: "discard-select-card-auto",
    score: (row) => {
      const surfaces = splitList(row.surfaces);
      const roles = splitList(row.roles);
      return surfaces.includes("card-selection-movement") ||
        surfaces.includes("auto-play-select-discard") ||
        roles.includes("card-ui-move") ||
        roles.includes("selection-auto") ||
        /CardUI|cardUis|selected|discard|弃|出牌|handCard|stateCard|onTouchCard|onMouseDown|onMouseUp/i.test(textOf(row))
        ? 74
        : 0;
    }
  },
  {
    id: "field-transition-semantics",
    score: () => 1
  }
];

function classifyCase(row, casesById) {
  const scored = caseMatchers
    .map((matcher) => ({ id: matcher.id, score: matcher.score(row) }))
    .filter((item) => item.score > 0 && casesById.has(item.id))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const primary = scored[0]?.id || "field-transition-semantics";
  return {
    primary,
    matched: uniq(scored.map((item) => item.id))
  };
}

function priority(row) {
  let score = 0;
  if (boolish(row.needsLive)) score += 50;
  if (boolish(row.permissionGated)) score -= 20;
  if (boolish(row.purchaseRisk)) score -= 30;
  if (/needs-targeted-live-transition/.test(row.remaining || "")) score += 40;
  if (/live-value-without-source-owner/.test(row.remaining || "")) score += 28;
  if (/source-visible-but-private-or-generic/.test(row.remaining || "")) score += 8;
  if (splitList(row.surfaces).some((surface) => /skill-trigger|card-selection|auto-play|scene-window|hover|rogue|bless/i.test(surface))) score += 12;
  if (/prompt|select|card|skill|window|scene|effect|state|phase|handler/i.test(row.field || "")) score += 8;
  return score;
}

function buildRows(unresolvedRows, goalAudit) {
  const casesById = new Map((goalAudit.cases || []).map((item) => [item.id, item]));
  return unresolvedRows.map((row) => {
    const classification = classifyCase(row, casesById);
    const caseInfo = casesById.get(classification.primary) || {};
    const commands = (caseInfo.scripts || []).map((script) => script.command).filter(Boolean);
    return {
      caseId: classification.primary,
      matchedCaseIds: classification.matched.join("|"),
      requirementId: caseInfo.requirementId || "",
      requirementStatus: caseInfo.requirementStatus || "",
      className: row.className || "",
      functionName: row.functionName || "",
      field: row.field || "",
      remaining: row.remaining || "",
      needsLive: row.needsLive || "",
      permissionGated: row.permissionGated || "",
      purchaseRisk: row.purchaseRisk || "",
      surfaces: row.surfaces || "",
      roles: row.roles || "",
      triggerMethods: row.triggerMethods || "",
      handlerMethods: row.handlerMethods || "",
      liveOwners: row.liveOwners || "",
      fieldEvidence: row.fieldEvidence || "",
      finalMeaning: row.finalMeaning || "",
      triageBuckets: row.triageBuckets || "",
      triageActions: row.triageActions || "",
      activationSignal: caseInfo.activationSignal || "",
      successEvidence: caseInfo.successEvidence || "",
      safeBoundary: caseInfo.safeBoundary || "",
      commands: commands.join(" | "),
      currentEvidence: (caseInfo.currentEvidence || []).join(" | "),
      priority: priority(row)
    };
  }).sort((a, b) =>
    a.caseId.localeCompare(b.caseId) ||
    b.priority - a.priority ||
    String(a.className).localeCompare(String(b.className)) ||
    String(a.field).localeCompare(String(b.field))
  );
}

function summarizeCaseRows(playbookRows, goalAudit) {
  const casesById = new Map((goalAudit.cases || []).map((item) => [item.id, item]));
  const rowsByCase = new Map();
  for (const row of playbookRows) {
    if (!rowsByCase.has(row.caseId)) rowsByCase.set(row.caseId, []);
    rowsByCase.get(row.caseId).push(row);
  }
  const caseIds = uniq([...(goalAudit.cases || []).map((item) => item.id), ...rowsByCase.keys()]);
  return caseIds.map((caseId) => {
    const rows = rowsByCase.get(caseId) || [];
    const caseInfo = casesById.get(caseId) || {};
    return {
      caseId,
      requirementId: caseInfo.requirementId || "",
      requirementStatus: caseInfo.requirementStatus || "",
      rowCount: rows.length,
      needsLiveRows: rows.filter((row) => boolish(row.needsLive)).length,
      permissionGatedRows: rows.filter((row) => boolish(row.permissionGated)).length,
      purchaseRiskRows: rows.filter((row) => boolish(row.purchaseRisk)).length,
      topRemaining: countBy(rows, (row) => row.remaining, 6).map((item) => `${item.name}:${item.count}`).join("|"),
      topSurfaces: countBy(rows.flatMap((row) => splitList(row.surfaces).map((surface) => ({ surface }))), (row) => row.surface, 6).map((item) => `${item.name}:${item.count}`).join("|"),
      topFields: countBy(rows, (row) => row.field, 8).map((item) => `${item.name}:${item.count}`).join("|"),
      activationSignal: caseInfo.activationSignal || "",
      successEvidence: caseInfo.successEvidence || "",
      commands: (caseInfo.scripts || []).map((script) => script.command).join(" | "),
      safeBoundary: caseInfo.safeBoundary || ""
    };
  }).sort((a, b) => b.rowCount - a.rowCount || a.caseId.localeCompare(b.caseId));
}

function writeTsv(rows, headers) {
  return `${headers.join("\t")}\n${rows.map((row) => headers.map((header) => tsvCell(row[header])).join("\t")).join("\n")}\n`;
}

function buildMarkdown(payload) {
  const lines = [];
  lines.push("# Runtime Live Proof Playbook");
  lines.push("");
  lines.push(`- Generated: ${payload.generatedAt}`);
  lines.push(`- Goal remaining audit: ${payload.inputs.goalRemainingAudit || "(none)"}`);
  lines.push(`- Unresolved field source: ${payload.inputs.unresolvedFields || "(none)"}`);
  lines.push(`- Playbook rows: ${payload.summary.playbookRows}`);
  lines.push(`- Needs-live rows: ${payload.summary.needsLiveRows}`);
  lines.push(`- Permission-gated rows: ${payload.summary.permissionGatedRows}`);
  lines.push("");
  lines.push("## Case Summary");
  lines.push("");
  lines.push("| Case | Requirement | Rows | Needs Live | Permission Gated | Activation Signal | Success Evidence | Commands |");
  lines.push("| --- | --- | ---: | ---: | ---: | --- | --- | --- |");
  for (const row of payload.caseSummary) {
    lines.push(`| \`${mdCell(row.caseId)}\` | \`${mdCell(row.requirementId)}\` | ${row.rowCount} | ${row.needsLiveRows} | ${row.permissionGatedRows} | ${mdCell(row.activationSignal)} | ${mdCell(row.successEvidence)} | ${mdCell(row.commands)} |`);
  }
  lines.push("");
  lines.push("## Highest Priority Fields");
  lines.push("");
  lines.push("| Case | Owner | Field | Remaining | Surfaces | Trigger / Handler Methods | Success Evidence |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of payload.playbookRows.slice().sort((a, b) => b.priority - a.priority).slice(0, 40)) {
    const methods = uniq([...splitList(row.triggerMethods), ...splitList(row.handlerMethods)]).slice(0, 8).join("|");
    lines.push(`| \`${mdCell(row.caseId)}\` | ${mdCell([row.className, row.functionName].filter(Boolean).join(":"))} | \`${mdCell(row.field)}\` | ${mdCell(row.remaining)} | ${mdCell(row.surfaces)} | ${mdCell(methods)} | ${mdCell(row.successEvidence)} |`);
  }
  lines.push("");
  lines.push("## How To Use");
  lines.push("");
  lines.push("- Start the command listed for the case before opening the target window/prompt when possible.");
  lines.push("- Treat `activationSignal` as the moment to begin or keep sampling.");
  lines.push("- Treat `successEvidence` as the minimum proof before marking the row resolved.");
  lines.push("- Permission-gated rows stay evidence-only unless the user explicitly allows that action path.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const goalAudit = await latestJson("-goal-remaining-audit", "goal-remaining-audit.json");
  if (!goalAudit) throw new Error("No goal remaining audit JSON found.");
  const latestFieldDir = await latestDir("-field-semantic-index-report");
  const latestUnresolvedPath = latestFieldDir ? path.join(latestFieldDir, "unresolved-field-priority.tsv") : "";
  const unresolvedPath = latestUnresolvedPath || goalAudit.inputs?.unresolvedFields || "";
  const unresolvedRows = parseTsv(await readTextIfExists(unresolvedPath));
  if (!unresolvedRows.length) throw new Error(`No unresolved rows found at ${unresolvedPath}`);
  const playbookRows = buildRows(unresolvedRows, goalAudit);
  const caseSummary = summarizeCaseRows(playbookRows, goalAudit);
  const outDir = path.resolve(
    process.env.SGS_RUNTIME_LIVE_PROOF_PLAYBOOK_DIR ||
      path.join(explorationRoot, `${timestampName()}-live-proof-playbook`)
  );
  await mkdir(outDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    inputs: {
      goalRemainingAudit: goalAudit.__path || "",
      unresolvedFields: unresolvedPath
    },
    summary: {
      playbookRows: playbookRows.length,
      unresolvedRows: unresolvedRows.length,
      caseCount: caseSummary.length,
      needsLiveRows: playbookRows.filter((row) => boolish(row.needsLive)).length,
      permissionGatedRows: playbookRows.filter((row) => boolish(row.permissionGated)).length,
      purchaseRiskRows: playbookRows.filter((row) => boolish(row.purchaseRisk)).length
    },
    caseSummary,
    playbookRows
  };
  const playbookTsvPath = path.join(outDir, "live-proof-playbook.tsv");
  const summaryTsvPath = path.join(outDir, "live-proof-case-summary.tsv");
  await writeFile(path.join(outDir, "live-proof-playbook.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(playbookTsvPath, writeTsv(playbookRows, [
    "caseId",
    "matchedCaseIds",
    "requirementId",
    "requirementStatus",
    "className",
    "functionName",
    "field",
    "remaining",
    "needsLive",
    "permissionGated",
    "purchaseRisk",
    "surfaces",
    "roles",
    "triggerMethods",
    "handlerMethods",
    "liveOwners",
    "fieldEvidence",
    "finalMeaning",
    "activationSignal",
    "successEvidence",
    "safeBoundary",
    "commands",
    "priority"
  ]), "utf8");
  await writeFile(summaryTsvPath, writeTsv(caseSummary, [
    "caseId",
    "requirementId",
    "requirementStatus",
    "rowCount",
    "needsLiveRows",
    "permissionGatedRows",
    "purchaseRiskRows",
    "topRemaining",
    "topSurfaces",
    "topFields",
    "activationSignal",
    "successEvidence",
    "commands",
    "safeBoundary"
  ]), "utf8");
  await writeFile(path.join(outDir, "README.md"), buildMarkdown(payload), "utf8");
  console.log(JSON.stringify({
    ok: true,
    outDir,
    playbookRows: payload.summary.playbookRows,
    caseCount: payload.summary.caseCount,
    needsLiveRows: payload.summary.needsLiveRows,
    permissionGatedRows: payload.summary.permissionGatedRows,
    purchaseRiskRows: payload.summary.purchaseRiskRows
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
