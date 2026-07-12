import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

const surfaceDefinitions = [
  {
    id: "scene-window-switch",
    label: "对象/画面切换与窗口开闭",
    patterns: [/scene-switch|window-open-close|SwitchScene|SceneManager|ShowWindow|CloseWindow|enterWindow|Close$|BackBtnClickHandler/],
    monitor: "Hook registered class methods plus GED scene/window events; after each call scan effective `Laya.stage` scene layer and window layer."
  },
  {
    id: "battle-lifecycle",
    label: "战斗进入/结束与记牌器边界",
    patterns: [/battle-lifecycle/, /TableGameScene|gameStart|gameOver|GameResult|leaveGame|manager\.seats|Dot\.GAME_OVER_EVENT/],
    monitor: "Hook `TableGameScene` lifecycle/proxy methods; draw tracker only while visible `TableGameScene` and `manager.seats` exist, then remove on game result or scene leave."
  },
  {
    id: "skill-trigger",
    label: "技能触发/响应",
    patterns: [/skill-trigger/, /GetResponser|OnMsg|Response|MoveCard.*Response|SelectCardCountWhenResponse|AutoUseSkillID|WindowName|OPT_SKILL/],
    monitor: "Hook skill class `GetResponser`/`OnMsg*`/`*Response`; record protocol fields, responder window name, and scene before/after."
  },
  {
    id: "hover-popup",
    label: "悬浮窗/牌与技能 popup",
    patterns: [/hover-popup/, /RollOver|RollOut|MouseOver|MouseOut|showOverCard|PopUp|layoutTxt|MOUSE_OVER|MOUSE_OUT/],
    monitor: "Hook hover methods and Laya mouse events; dispatch only mouse-move samples and verify popup nodes under WindowLayer/PopUp layer."
  },
  {
    id: "button-ui-click",
    label: "按钮点击与游戏 UI 点击",
    patterns: [/auto-operation/, /Laya\.Event\.CLICK|CLICK|Click|click|Touch|touch|confirm|Confirm|cancel|Cancel|ensure|Ensure/],
    monitor: "Hook click/touch/confirm/cancel methods; record target class/method/arguments and scan stage/window changes after the call."
  },
  {
    id: "card-selection-movement",
    label: "UI 中牌移动/选牌/弃牌",
    patterns: [/card-operation/, /Card|card|MoveCard|SelectCard|Discard|Deck|Pile|Zone|CardIDs|MData/],
    monitor: "Hook card window methods and move-card protocol sends; track visible card UI lists and public/protocol card ids only."
  },
  {
    id: "auto-play-select-discard",
    label: "自动出牌/自动选牌丢弃/自动技能",
    patterns: [/auto|Auto|send|Send|confirm|Confirm|ensure|Ensure/, /UseCard|SelectCard|Discard|Skill|MoveCard/],
    monitor: "Treat as candidate automation only; first run hook-only, then allow explicit non-purchase calls after send payload and prompt lifecycle are proven."
  },
  {
    id: "effect-animation",
    label: "弹出特效/动画/屏蔽特效",
    patterns: [/effect-animation/, /Effect|effect|Animation|Tween|Spine|Movie|Motion|Laya\.Event\.LABEL|Laya\.Event\.STOPPED/],
    monitor: "Hook effect add/play/stop methods; for blocking, no-op/fast-forward effect methods only after state update path is separately recorded."
  },
  {
    id: "resource-drawing",
    label: "资源描画/替换",
    patterns: [/resource-drawing/, /loadImage|drawTexture|Texture|graphics|skin|Resource|Image|Sprite/],
    monitor: "Hook Laya URL/resource formatting and draw/load calls; use logical resource paths and refresh loaded nodes/cache after replacement."
  },
  {
    id: "rogue",
    label: "山河图/自动辅助 UI/技能确认",
    patterns: [/rogue/, /Rogue|AYt\.|TriggerCurEvent|TriggerEvent|RogueLikeDataReq|shopBtnClick|sendGotoFightMsg|sendGotoGambleMsg/],
    monitor: "Use visible `RogueSmallMapScene -> PveMgr`; overlay is display-only; block shop/buy methods unless explicitly allowed."
  },
  {
    id: "bless-qifu",
    label: "祈福窗口/自动显示/屏蔽特效",
    patterns: [/bless-qifu/, /Bless|QiFu|Qifu|blessBtnClick|UpdateUpperCanvas|updateSkipAnim|confirmBuy|shopBtnClick/],
    monitor: "Hook Bless window/view open/close/effect methods; block draw/buy/shop methods during exploration unless explicitly allowed."
  },
  {
    id: "kanshu",
    label: "发财树/KanShu",
    patterns: [/kanshu/, /KanShu|Jbp|Tree|Peach|TaoZi|trueReqJbpAwd|autoClickAllPeach|onKanShuClick/],
    monitor: "Find live `KanShuWindow/wXi`; read state and hook reward methods, gating final claim by free branch or explicit permission."
  },
  {
    id: "yanjiao",
    label: "严教候选列表/自动分配",
    patterns: [/yanjiao/, /YanJiao|splitCard|showSplitCard|sendAutoChooseMoveOpt|MsgID_YanJiao|MSG_CLIENT_OPERATE_IN_GAME_NTF/],
    monitor: "Hook `YanJiao.GetResponser`, `YanJiaoWindow.UpdateWindow/showSplitCard/layoutCardUIs/send*`; add Laya child list under the live window."
  },
  {
    id: "qixing-shen-zhuge",
    label: "神诸葛/七星/观星弹窗",
    patterns: [/qixing-guanxing/, /GuanXing|Qixing|QiXing|WoLongZhuGeLiang|OutsideCard|public.general/],
    monitor: "Hook `GuanXing*` and `QiXing` related classes; prove public-general/top-deck facts only from visible/protocol/log fields."
  },
  {
    id: "purchase-risk",
    label: "购买/付费风险阻断",
    patterns: [/purchase-risk/, /Buy|buy|Pay|pay|Recharge|YuanBao|Money|confirmBuy|gotoPay|buyPorpItem|shopBtnClick/],
    monitor: "Default action is block/skip and record only; active purchase-like methods require explicit user permission."
  }
];

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function latestDir(suffix) {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => path.join(explorationRoot, entry.name));
  dirs.sort();
  return dirs.at(-1) || null;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function splitList(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift()?.split("\t") || [];
  return lines.map((line) => {
    const cells = line.split("\t");
    const row = {};
    header.forEach((key, index) => { row[key] = cells[index] ?? ""; });
    return row;
  });
}

async function latestAllSourceContext() {
  const dir = await latestDir("-all-source-context");
  if (!dir) throw new Error("No all-source-context report found.");
  return {
    dir,
    summaryPath: path.join(dir, "all-source-summary.md"),
    classPath: path.join(dir, "all-source-class-index.tsv"),
    methodPath: path.join(dir, "all-source-method-context.tsv"),
    fieldPath: path.join(dir, "all-source-field-context.tsv"),
    eventPath: path.join(dir, "all-source-event-bindings.tsv")
  };
}

async function latestOldScriptMap() {
  const dir = await latestDir("-old-script-map");
  if (!dir) return null;
  return {
    dir,
    mdPath: path.join(dir, "old-script-behavior-map.md"),
    jsonPath: path.join(dir, "old-script-behavior-map.json")
  };
}

function matchSurface(def, row) {
  const haystack = [
    row.className,
    row.functionName,
    row.method,
    row.sourceKind,
    row.categories,
    row.roles,
    row.constants,
    row.strings,
    row.protocolFields,
    row.eventBindings
  ].join(" ");
  return def.patterns.every((pattern) => pattern.test(haystack));
}

function surfacesFor(row) {
  const surfaces = surfaceDefinitions.filter((def) => matchSurface(def, row)).map((def) => def.id);
  if (!surfaces.length && row.roles && row.roles !== "unclassified") {
    for (const role of splitList(row.roles)) {
      if (surfaceDefinitions.some((def) => def.id === role)) surfaces.push(role);
    }
  }
  return Array.from(new Set(surfaces));
}

function evidenceFor(row) {
  return {
    constants: splitList(row.constants).slice(0, 12),
    strings: splitList(row.strings).slice(0, 12),
    protocolFields: splitList(row.protocolFields).slice(0, 12),
    eventBindings: splitList(row.eventBindings).slice(0, 12)
  };
}

function compactEvidence(row) {
  const evidence = evidenceFor(row);
  return [
    ...evidence.eventBindings.map((item) => `event:${item}`),
    ...evidence.constants.map((item) => `const:${item}`),
    ...evidence.protocolFields.map((item) => `field:${item}`),
    ...evidence.strings.map((item) => `str:${item}`)
  ].slice(0, 14);
}

function hookTarget(row) {
  if (row.sourceKind === "constructor") return `Laya.ClassUtils._classMap["${row.className}"]`;
  if (row.sourceKind?.startsWith("static")) return `Laya.ClassUtils._classMap["${row.className}"]["${row.method}"]`;
  return `Laya.ClassUtils._classMap["${row.className}"].prototype["${row.method}"]`;
}

function buildTriggerRows(methodRows, classMap) {
  const rows = [];
  for (const method of methodRows) {
    const classInfo = classMap.get(method.className) || {};
    const row = {
      ...method,
      categories: classInfo.categories || "",
      classSourceChars: classInfo.sourceChars || "",
      surfaces: [],
      purchaseRisk: false,
      hookTarget: ""
    };
    row.surfaces = surfacesFor(row);
    row.purchaseRisk = row.surfaces.includes("purchase-risk") || /purchase-risk/.test(row.roles || "");
    if (!row.surfaces.length && !row.eventBindings && !row.constants) continue;
    row.hookTarget = hookTarget(row);
    rows.push(row);
  }
  rows.sort((a, b) => {
    const risk = Number(b.purchaseRisk) - Number(a.purchaseRisk);
    if (risk) return risk;
    return `${a.surfaces.join(",")}:${a.className}.${a.method}`.localeCompare(`${b.surfaces.join(",")}:${b.className}.${b.method}`);
  });
  return rows;
}

function buildSurfaceSummary(triggerRows) {
  const out = {};
  for (const def of surfaceDefinitions) {
    const rows = triggerRows.filter((row) => row.surfaces.includes(def.id));
    out[def.id] = {
      id: def.id,
      label: def.label,
      monitor: def.monitor,
      methodCount: rows.length,
      classCount: new Set(rows.map((row) => row.className)).size,
      purchaseRiskCount: rows.filter((row) => row.purchaseRisk).length,
      eventBindingCount: rows.reduce((sum, row) => sum + splitList(row.eventBindings).length, 0),
      samples: rows.slice(0, 40).map((row) => ({
        className: row.className,
        method: row.method,
        sourceKind: row.sourceKind,
        roles: splitList(row.roles),
        hookTarget: row.hookTarget,
        evidence: compactEvidence(row)
      }))
    };
  }
  return out;
}

function buildClassSummary(triggerRows) {
  const map = new Map();
  for (const row of triggerRows) {
    if (!map.has(row.className)) {
      map.set(row.className, {
        className: row.className,
        functionName: row.functionName,
        categories: row.categories,
        surfaces: new Set(),
        methods: new Set(),
        purchaseRiskMethods: new Set()
      });
    }
    const item = map.get(row.className);
    for (const surface of row.surfaces) item.surfaces.add(surface);
    item.methods.add(row.method);
    if (row.purchaseRisk) item.purchaseRiskMethods.add(row.method);
  }
  return Array.from(map.values())
    .map((item) => ({
      className: item.className,
      functionName: item.functionName,
      categories: item.categories,
      surfaceCount: item.surfaces.size,
      methodCount: item.methods.size,
      purchaseRiskMethodCount: item.purchaseRiskMethods.size,
      surfaces: Array.from(item.surfaces).sort(),
      methods: Array.from(item.methods).sort().slice(0, 80),
      purchaseRiskMethods: Array.from(item.purchaseRiskMethods).sort()
    }))
    .sort((a, b) => b.surfaceCount - a.surfaceCount || b.methodCount - a.methodCount || a.className.localeCompare(b.className));
}

function buildTsv(rows) {
  const header = [
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
  ];
  const lines = [header.join("\t")];
  for (const row of rows) {
    const monitor = row.surfaces.map((surface) => surfaceDefinitions.find((def) => def.id === surface)?.monitor || "").filter(Boolean).join(" | ");
    lines.push([
      row.className,
      row.functionName,
      row.categories,
      row.method,
      row.sourceKind,
      row.roles,
      row.surfaces.join(";"),
      String(row.purchaseRisk),
      row.hookTarget,
      monitor,
      compactEvidence(row).join(";"),
      row.constants,
      row.strings,
      row.protocolFields,
      row.eventBindings
    ].map(tsvCell).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function buildClassTsv(rows) {
  const header = ["className", "functionName", "categories", "surfaceCount", "methodCount", "purchaseRiskMethodCount", "surfaces", "methods", "purchaseRiskMethods"];
  const lines = [header.join("\t")];
  for (const row of rows) {
    lines.push([
      row.className,
      row.functionName,
      row.categories,
      row.surfaceCount,
      row.methodCount,
      row.purchaseRiskMethodCount,
      row.surfaces.join(";"),
      row.methods.join(";"),
      row.purchaseRiskMethods.join(";")
    ].map(tsvCell).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function buildPlaybookTsv(surfaceSummary) {
  const header = ["surface", "label", "classCount", "methodCount", "purchaseRiskCount", "monitoringMethod", "topSamples"];
  const lines = [header.join("\t")];
  for (const item of Object.values(surfaceSummary)) {
    lines.push([
      item.id,
      item.label,
      item.classCount,
      item.methodCount,
      item.purchaseRiskCount,
      item.monitor,
      item.samples.slice(0, 12).map((sample) => `${sample.className}.${sample.method}`).join(";")
    ].map(tsvCell).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function tsvCell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\t/g, " ");
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Runtime Trigger Monitoring Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- All-source context: ${report.inputs.allSourceContext}`);
  lines.push(`- Method rows scanned: ${report.summary.methodRowsScanned}`);
  lines.push(`- Trigger rows: ${report.summary.triggerRows}`);
  lines.push(`- Trigger classes: ${report.summary.triggerClasses}`);
  lines.push(`- Purchase-risk rows: ${report.summary.purchaseRiskRows}`);
  lines.push("");
  lines.push("## Monitoring Rule");
  lines.push("");
  lines.push("- Stable hook target is `Laya.ClassUtils._classMap[registeredName]`, not minified constructor names.");
  lines.push("- Runtime proof still requires CDP `Runtime.evaluate -> Laya.stage`, effective visible scene/window-layer scan, and method/event records.");
  lines.push("- Purchase-risk surfaces are record-only and blocked by default.");
  lines.push("");
  lines.push("## Surface Summary");
  lines.push("");
  lines.push("| Surface | Label | Classes | Methods | Purchase Risk | Monitoring Method |");
  lines.push("| --- | --- | ---: | ---: | ---: | --- |");
  for (const item of Object.values(report.surfaceSummary)) {
    lines.push(`| \`${item.id}\` | ${escapeCell(item.label)} | ${item.classCount} | ${item.methodCount} | ${item.purchaseRiskCount} | ${escapeCell(item.monitor)} |`);
  }
  lines.push("");
  lines.push("## Surface Samples");
  lines.push("");
  for (const item of Object.values(report.surfaceSummary)) {
    lines.push(`### ${item.label}`);
    lines.push("");
    if (!item.samples.length) {
      lines.push("- none");
      lines.push("");
      continue;
    }
    for (const sample of item.samples.slice(0, 12)) {
      lines.push(`- \`${sample.className}.${sample.method}\` (${sample.sourceKind}) -> ${sample.evidence.slice(0, 5).map((x) => `\`${escapeCell(x)}\``).join(", ") || "(source-role only)"}`);
    }
    lines.push("");
  }
  if (report.oldScriptMap?.mdPath) {
    lines.push("## Old Script Bridge");
    lines.push("");
    lines.push(`- Old-script behavior map: ${report.oldScriptMap.mdPath}`);
    lines.push("- Old scripts should be mapped onto this same matrix: use CDP hooks and Laya stage/window-layer scans; `console.log` remains diagnostics only.");
    lines.push("");
  }
  lines.push("## Files");
  lines.push("");
  lines.push("- `trigger-monitoring-index.tsv`: method-level hook targets and surface classification.");
  lines.push("- `trigger-class-summary.tsv`: class-level surface coverage.");
  lines.push("- `trigger-monitoring-playbook.tsv`: per-surface monitoring method and samples.");
  lines.push("- `trigger-monitoring-report.json`: machine-readable summary.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapeCell(value) {
  return String(value ?? "").replaceAll("|", "\\|");
}

async function main() {
  const allSource = await latestAllSourceContext();
  const oldScriptMap = await latestOldScriptMap();
  const methodRows = parseTsv(await readFile(allSource.methodPath, "utf8"));
  const classRows = parseTsv(await readFile(allSource.classPath, "utf8"));
  const classMap = new Map(classRows.map((row) => [row.className, row]));
  const triggerRows = buildTriggerRows(methodRows, classMap);
  const surfaceSummary = buildSurfaceSummary(triggerRows);
  const classSummary = buildClassSummary(triggerRows);
  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      allSourceContext: allSource.summaryPath,
      methodTsv: allSource.methodPath,
      classTsv: allSource.classPath
    },
    oldScriptMap,
    summary: {
      methodRowsScanned: methodRows.length,
      triggerRows: triggerRows.length,
      triggerClasses: classSummary.length,
      purchaseRiskRows: triggerRows.filter((row) => row.purchaseRisk).length,
      surfaces: Object.fromEntries(Object.entries(surfaceSummary).map(([key, value]) => [key, { classCount: value.classCount, methodCount: value.methodCount, purchaseRiskCount: value.purchaseRiskCount }]))
    },
    surfaceSummary,
    topClasses: classSummary.slice(0, 200)
  };
  const outDir = path.resolve(
    process.env.SGS_RUNTIME_TRIGGER_MONITORING_DIR ||
      path.join(explorationRoot, `${timestampName()}-trigger-monitoring-report`)
  );
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "trigger-monitoring-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "trigger-monitoring-index.tsv"), buildTsv(triggerRows), "utf8");
  await writeFile(path.join(outDir, "trigger-class-summary.tsv"), buildClassTsv(classSummary), "utf8");
  await writeFile(path.join(outDir, "trigger-monitoring-playbook.tsv"), buildPlaybookTsv(surfaceSummary), "utf8");
  await writeFile(path.join(outDir, "trigger-monitoring-report.md"), buildMarkdown(report), "utf8");
  await writeFile(path.join(outDir, "README.md"), [
    "# Runtime Trigger Monitoring Report",
    "",
    `- Markdown: ${path.join(outDir, "trigger-monitoring-report.md")}`,
    `- JSON: ${path.join(outDir, "trigger-monitoring-report.json")}`,
    `- Trigger index: ${path.join(outDir, "trigger-monitoring-index.tsv")}`,
    `- Class summary: ${path.join(outDir, "trigger-class-summary.tsv")}`,
    `- Playbook: ${path.join(outDir, "trigger-monitoring-playbook.tsv")}`,
    ""
  ].join("\n"), "utf8");
  console.log(JSON.stringify({
    outDir,
    summary: report.summary
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
