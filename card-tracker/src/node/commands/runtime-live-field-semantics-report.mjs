import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

const hiddenFieldPattern = /handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i;

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function exists(filePath) {
  try {
    await readFile(filePath);
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
    process.env.SGS_LIVE_FIELD_SEMANTICS_DIR ||
      path.join(explorationRoot, `${timestampName()}-live-field-semantics-report`)
  );
}

function unique(values) {
  return Array.from(new Set((values || []).filter((value) => value !== "" && value != null)));
}

function tsvEscape(value) {
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value).replace(/\t|\r?\n/g, " ");
  return String(value).replace(/\t|\r?\n/g, " ");
}

function countBy(values) {
  const out = {};
  for (const value of values || []) out[value || "(none)"] = (out[value || "(none)"] || 0) + 1;
  return out;
}

function ownerKey(ownerPath, field) {
  return `${ownerPath || ""}\t${field || ""}`;
}

function registeredNames(target) {
  return unique([
    ...(target.registeredNames?.byIdentity || []),
    ...(target.registeredNames?.byConstructorName || []),
    ...(target.spec?.registeredNames || [])
  ]);
}

function isSelfSeatOwner(ownerPath, selfSeatIndex) {
  if (ownerPath === "selfSeat") return true;
  const match = /^seats\[(\d+)\]$/.exec(ownerPath || "");
  return match ? Number(match[1]) === selfSeatIndex : false;
}

function isForbiddenField(ownerPath, field, selfSeatIndex) {
  if (!hiddenFieldPattern.test(String(field || ""))) return false;
  return !isSelfSeatOwner(ownerPath, selfSeatIndex);
}

function categoryMeaning(category) {
  const meanings = {
    "card-zone": "牌/牌 UI/区域或移动状态",
    "skill-spell": "技能、战法、响应器或技能提示状态",
    "selection-automation": "选择、自动选择、确认/取消或提示完成状态",
    "effect-animation": "动画、缓动、特效生命周期或特效资源",
    "button-command": "按钮、点击命令、可用/禁用状态",
    "scene-window-ui": "场景、窗口、层级或可见性状态",
    "resource-drawing": "资源、贴图、skin、graphics 或绘制 URL",
    "laya-display-input": "Laya 显示对象、输入、鼠标/触摸或布局字段",
    "state-machine": "回合、阶段、游戏状态或内部状态机",
    "identity-config": "身份、配置、索引、ID 或静态标识",
    "event-handler": "事件绑定、handler、监听器或调度字段",
    "currency-reward-risk": "货币、奖励、购买/刷新相关风险字段"
  };
  return meanings[category] || "";
}

function roleMeaning(roles) {
  const set = new Set(roles || []);
  const parts = [];
  if (set.has("button-click")) parts.push("按钮/点击入口");
  if (set.has("card-ui-move")) parts.push("牌 UI 或牌移动");
  if (set.has("skill-trigger")) parts.push("技能触发/响应");
  if (set.has("selection-auto")) parts.push("选择/自动选择");
  if (set.has("window-scene")) parts.push("窗口/场景生命周期");
  if (set.has("effect")) parts.push("特效/动画");
  if (set.has("protocol-send")) parts.push("协议发送/回包");
  if (set.has("purchase-risk")) parts.push("购买风险");
  return parts.join("；");
}

function inferMeaning({ field, liveCategory, joinedMeaning, roles, surfaces, methods, liveKind }) {
  const hints = [];
  if (joinedMeaning) hints.push(joinedMeaning);
  const categoryText = categoryMeaning(liveCategory);
  if (categoryText) hints.push(categoryText);
  const roleText = roleMeaning(roles);
  if (roleText) hints.push(roleText);

  const methodNames = (methods || []).map((method) => method.name).join(" ");
  const text = `${field || ""} ${methodNames}`;
  if (/auto|Auto|Quick|AllSelect|Select|selected|Choose|Operate|Opt/.test(text)) hints.push("选择/自动操作链路字段");
  if (/card|Card|Hand|Discard|Judge|Equip|Pile|Zone|Move/.test(text)) hints.push("牌或牌区/牌移动字段");
  if (/skill|Skill|spell|Spell|ZhanFa|responser|Response/.test(text)) hints.push("技能/战法响应字段");
  if (/button|Button|btn|Btn|click|Click|touch|Touch|confirm|Confirm|cancel|Cancel/.test(text)) hints.push("按钮或触摸命令字段");
  if (/effect|Effect|tween|Tween|anim|Anim|motion|Motion/.test(text)) hints.push("动画/特效字段");
  if (/skin|Skin|res|Res|url|URL|texture|Texture|graphics|Graphics|image|Image/.test(text)) hints.push("资源绘制字段");
  if (/round|Round|turn|Turn|phase|Phase|game|Game|state|State/.test(text)) hints.push("游戏状态/阶段字段");
  if (!hints.length && liveKind) hints.push(`当前 live 类型：${liveKind}`);
  return unique(hints).slice(0, 4).join("；") || "仍需更多 live/source 证据";
}

function confidenceFor({ target, fieldRow, gapRows, refMethods, eventRefs }) {
  const exact = target.match === "exact-path" || target.match?.startsWith("special-");
  const hasLive = !!fieldRow;
  const hasRefs = refMethods.length > 0 || eventRefs.length > 0;
  const hasJoinedMeaning = gapRows.some((row) => row.joinedMeaning || row.liveMeaning);
  if (exact && hasLive && hasRefs && hasJoinedMeaning) return "high-live-source";
  if (exact && hasLive && hasRefs) return "medium-live-source";
  if (exact && hasLive && hasJoinedMeaning) return "medium-live-joined";
  if (hasLive) return "live-only";
  if (hasRefs) return "source-ref-only";
  return "weak";
}

function mergeFieldSemantics(ownerReport, gapReport) {
  const selfSeatIndex = ownerReport.runtime?.manager?.selfSeatIndex ?? null;
  const gapByOwnerField = new Map();
  for (const row of gapReport.worklist || []) {
    if (isForbiddenField(row.ownerPath, row.field, selfSeatIndex)) continue;
    const key = ownerKey(row.ownerPath, row.field);
    if (!gapByOwnerField.has(key)) gapByOwnerField.set(key, []);
    gapByOwnerField.get(key).push(row);
  }

  const rows = [];
  for (const target of ownerReport.targets || []) {
    const ownerPath = target.spec?.ownerPath || target.resolvedPath || "";
    const ownerLabel = target.base?.label || target.spec?.ownerLabel || "";
    const fieldRows = new Map((target.fields || []).map((field) => [field.field, field]));
    const methodRefsByField = new Map();
    for (const method of target.methods || []) {
      for (const field of method.referencedFields || []) {
        if (isForbiddenField(ownerPath, field, selfSeatIndex)) continue;
        if (!methodRefsByField.has(field)) methodRefsByField.set(field, []);
        methodRefsByField.get(field).push(method);
      }
    }
    const eventRefsByField = new Map();
    for (const event of target.events || []) {
      for (const field of event.referencedFields || []) {
        if (isForbiddenField(ownerPath, field, selfSeatIndex)) continue;
        if (!eventRefsByField.has(field)) eventRefsByField.set(field, []);
        eventRefsByField.get(field).push(event);
      }
    }

    const fieldNames = unique([
      ...(target.sampledFields || []),
      ...fieldRows.keys(),
      ...methodRefsByField.keys(),
      ...eventRefsByField.keys(),
      ...(gapReport.worklist || [])
        .filter((row) => row.ownerPath === ownerPath)
        .map((row) => row.field)
    ]).filter((field) => !isForbiddenField(ownerPath, field, selfSeatIndex));

    for (const field of fieldNames) {
      const fieldRow = fieldRows.get(field) || null;
      const gapRows = gapByOwnerField.get(ownerKey(ownerPath, field)) || [];
      const refMethods = methodRefsByField.get(field) || [];
      const eventRefs = eventRefsByField.get(field) || [];
      const methodRoles = unique(refMethods.flatMap((method) => method.roles || []));
      const gapSurfaces = unique(gapRows.flatMap((row) => row.surfaces || []));
      const gapSourceMethods = unique(gapRows.flatMap((row) => row.sourceMethods || []));
      const liveCategory = gapRows.find((row) => row.liveCategory)?.liveCategory || "";
      const joinedMeaning = gapRows.find((row) => row.joinedMeaning)?.joinedMeaning ||
        gapRows.find((row) => row.liveMeaning)?.liveMeaning || "";
      const purchaseRisk = gapRows.some((row) => row.purchaseRisk === true || row.risk === "purchase-risk") ||
        methodRoles.includes("purchase-risk");
      const meaning = inferMeaning({
        field,
        liveCategory,
        joinedMeaning,
        roles: methodRoles,
        surfaces: gapSurfaces,
        methods: refMethods,
        liveKind: fieldRow?.kind || gapRows.find((row) => row.liveKind)?.liveKind || ""
      });
      const confidence = confidenceFor({ target, fieldRow, gapRows, refMethods, eventRefs });
      const unresolvedReason = [
        refMethods.length ? "" : "no-owner-method-ref",
        eventRefs.length ? "" : "no-owner-event-ref",
        joinedMeaning ? "" : "no-joined-meaning",
        fieldRow ? "" : "no-live-field-value"
      ].filter(Boolean);

      rows.push({
        ownerPath,
        ownerLabel,
        resolvedPath: target.resolvedPath || "",
        match: target.match || "",
        ownerCtor: target.base?.ctor || "",
        registeredNames: registeredNames(target),
        field,
        liveKind: fieldRow?.kind || gapRows.find((row) => row.liveKind)?.liveKind || "",
        liveValue: fieldRow?.value ?? gapRows.find((row) => row.liveValue)?.liveValue ?? "",
        arrayLength: fieldRow?.arrayLength ?? null,
        objectCtor: fieldRow?.objectCtor || "",
        liveCategory,
        joinedMeaning,
        inferredMeaning: meaning,
        confidence,
        surfaces: gapSurfaces,
        methodRoles,
        methodNames: unique(refMethods.map((method) => method.name)).slice(0, 32),
        eventNames: unique(eventRefs.map((event) => event.event)).slice(0, 16),
        sourceMethods: gapSourceMethods.slice(0, 32),
        sourceClasses: unique(gapRows.flatMap((row) => row.sourceClasses || [])).slice(0, 32),
        operations: unique(gapRows.flatMap((row) => row.operations || [])).slice(0, 20),
        sourceRefCount: refMethods.length,
        eventRefCount: eventRefs.length,
        gapRows: gapRows.length,
        purchaseRisk,
        unresolvedReason
      });
    }
  }

  rows.sort((a, b) =>
    Number(b.confidence === "high-live-source") - Number(a.confidence === "high-live-source") ||
    b.sourceRefCount - a.sourceRefCount ||
    b.gapRows - a.gapRows ||
    a.ownerPath.localeCompare(b.ownerPath) ||
    a.field.localeCompare(b.field)
  );
  return rows;
}

function summaryFor(rows, ownerReport, gapReport) {
  const owners = new Set(rows.map((row) => row.ownerPath));
  const fieldNames = new Set(rows.map((row) => row.field));
  const surfaceCounts = {};
  for (const row of rows) {
    for (const surface of row.surfaces || []) surfaceCounts[surface] = (surfaceCounts[surface] || 0) + 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    scene: ownerReport.runtime?.scene?.label || "",
    resourceVersion: ownerReport.runtime?.resourceVersion || "",
    layaVersion: ownerReport.runtime?.layaVersion || "",
    sourceOwnerReport: ownerReport.sourcePath || "",
    sourceGapReport: gapReport.sourcePath || "",
    ownerTargets: ownerReport.targets?.length || 0,
    owners: owners.size,
    fieldRows: rows.length,
    uniqueFields: fieldNames.size,
    highConfidenceRows: rows.filter((row) => row.confidence === "high-live-source").length,
    fieldsWithMethodRefs: rows.filter((row) => row.sourceRefCount > 0).length,
    fieldsWithJoinedMeaning: rows.filter((row) => row.joinedMeaning).length,
    purchaseRiskRows: rows.filter((row) => row.purchaseRisk).length,
    confidenceCounts: countBy(rows.map((row) => row.confidence)),
    topSurfaces: Object.entries(surfaceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([surface, count]) => ({ surface, count }))
  };
}

function rowsToTsv(rows) {
  const header = [
    "ownerPath",
    "ownerLabel",
    "match",
    "field",
    "liveKind",
    "liveValue",
    "liveCategory",
    "inferredMeaning",
    "confidence",
    "surfaces",
    "methodRoles",
    "methodNames",
    "eventNames",
    "sourceMethods",
    "sourceClasses",
    "sourceRefCount",
    "eventRefCount",
    "gapRows",
    "purchaseRisk",
    "unresolvedReason"
  ];
  const lines = [header.join("\t")];
  for (const row of rows) {
    lines.push([
      row.ownerPath,
      row.ownerLabel,
      row.match,
      row.field,
      row.liveKind,
      row.liveValue,
      row.liveCategory,
      row.inferredMeaning,
      row.confidence,
      row.surfaces,
      row.methodRoles,
      row.methodNames,
      row.eventNames,
      row.sourceMethods,
      row.sourceClasses,
      row.sourceRefCount,
      row.eventRefCount,
      row.gapRows,
      row.purchaseRisk ? "true" : "false",
      row.unresolvedReason
    ].map(tsvEscape).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function methodEvidenceToTsv(rows) {
  const header = ["ownerPath", "field", "method", "roles", "confidence", "meaning"];
  const lines = [header.join("\t")];
  for (const row of rows) {
    for (const method of row.methodNames || []) {
      lines.push([
        row.ownerPath,
        row.field,
        method,
        row.methodRoles,
        row.confidence,
        row.inferredMeaning
      ].map(tsvEscape).join("\t"));
    }
  }
  return `${lines.join("\n")}\n`;
}

function escapeCell(text) {
  return String(text || "").replace(/\r?\n/g, " ").replaceAll("|", "\\|");
}

function markdown(summary, rows, outDir) {
  const lines = [];
  lines.push("# Live Field Semantics Report");
  lines.push("");
  lines.push(`- Generated: ${summary.generatedAt}`);
  lines.push(`- Scene: ${summary.scene}`);
  lines.push(`- ResourceVersion: ${summary.resourceVersion}`);
  lines.push(`- Laya: ${summary.layaVersion}`);
  lines.push(`- Owner targets: ${summary.ownerTargets}`);
  lines.push(`- Field rows: ${summary.fieldRows}`);
  lines.push(`- High confidence: ${summary.highConfidenceRows}`);
  lines.push(`- Fields with owner method refs: ${summary.fieldsWithMethodRefs}`);
  lines.push(`- Fields with joined meaning: ${summary.fieldsWithJoinedMeaning}`);
  lines.push(`- Purchase-risk rows: ${summary.purchaseRiskRows}`);
  lines.push("");
  lines.push("## Confidence Counts");
  lines.push("");
  for (const [name, count] of Object.entries(summary.confidenceCounts || {})) lines.push(`- ${name}: ${count}`);
  lines.push("");
  lines.push("## Top Surfaces");
  lines.push("");
  for (const item of summary.topSurfaces || []) lines.push(`- ${item.surface}: ${item.count}`);
  lines.push("");
  lines.push("## Highest Signal Fields");
  lines.push("");
  lines.push("| Owner | Field | Type | Meaning | Confidence | Method refs | Surfaces |");
  lines.push("| --- | --- | --- | --- | --- | ---: | --- |");
  for (const row of rows.slice(0, 80)) {
    lines.push(`| ${escapeCell(row.ownerLabel || row.ownerPath)} | \`${escapeCell(row.field)}\` | ${escapeCell(row.liveKind)} | ${escapeCell(row.inferredMeaning)} | \`${row.confidence}\` | ${row.sourceRefCount} | ${escapeCell((row.surfaces || []).join(", "))} |`);
  }
  lines.push("");
  lines.push("## Remaining Weak Fields");
  lines.push("");
  lines.push("| Owner | Field | Type | Reason | Current hint |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of rows.filter((item) => item.confidence !== "high-live-source").slice(0, 80)) {
    lines.push(`| ${escapeCell(row.ownerLabel || row.ownerPath)} | \`${escapeCell(row.field)}\` | ${escapeCell(row.liveKind)} | ${escapeCell((row.unresolvedReason || []).join(", "))} | ${escapeCell(row.inferredMeaning)} |`);
  }
  lines.push("");
  lines.push("## Files");
  lines.push("");
  lines.push(`- ${path.join(outDir, "live-field-semantics-report.json")}`);
  lines.push(`- ${path.join(outDir, "live-field-semantics.tsv")}`);
  lines.push(`- ${path.join(outDir, "field-method-evidence.tsv")}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Non-self seat hidden hand/watch fields are filtered. The current player's hand boundary follows manager.selfSeatIndex.");
  lines.push("- Purchase-risk rows are marked and not used as active automation proof.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const ownerDir = process.env.SGS_LIVE_OWNER_SOURCE_REPORT_DIR ||
    await latestDir("-live-owner-source-report", "live-owner-source-report.json");
  const gapDir = process.env.SGS_LIVE_FIELD_GAP_REPORT_DIR ||
    await latestDir("-live-field-gap-report", "live-field-gap-report.json");
  if (!ownerDir) throw new Error("No live-owner-source-report directory found.");
  if (!gapDir) throw new Error("No live-field-gap-report directory found.");

  const ownerPath = path.join(ownerDir, "live-owner-source-report.json");
  const gapPath = path.join(gapDir, "live-field-gap-report.json");
  const ownerReport = await readJson(ownerPath);
  const gapReport = await readJson(gapPath);
  ownerReport.sourcePath = ownerPath;
  gapReport.sourcePath = gapPath;

  const rows = mergeFieldSemantics(ownerReport, gapReport);
  const summary = summaryFor(rows, ownerReport, gapReport);
  const outDir = outputDir();
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "live-field-semantics-report.json"), `${JSON.stringify({ summary, rows }, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "live-field-semantics.tsv"), rowsToTsv(rows), "utf8");
  await writeFile(path.join(outDir, "field-method-evidence.tsv"), methodEvidenceToTsv(rows), "utf8");
  await writeFile(path.join(outDir, "README.md"), markdown(summary, rows, outDir), "utf8");

  console.log(JSON.stringify({
    outDir,
    ownerDir,
    gapDir,
    fieldRows: summary.fieldRows,
    highConfidenceRows: summary.highConfidenceRows,
    fieldsWithMethodRefs: summary.fieldsWithMethodRefs,
    fieldsWithJoinedMeaning: summary.fieldsWithJoinedMeaning,
    purchaseRiskRows: summary.purchaseRiskRows,
    topSurfaces: summary.topSurfaces.slice(0, 6)
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
