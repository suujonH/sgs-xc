import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");
const skillAuditDir = path.join(projectRoot, "Scripts", "reports", "skill-audit");

const yanJiaoMethods = ["constructor", "GetResponser", "OnMsgMoveCard", "MoveCardToZoneResponse"];
const windowMethods = [
  "constructor",
  "Init",
  "enterWindow",
  "showWindow",
  "genSplitCard",
  "findEqualSubsequences",
  "isSame",
  "calculatePoint",
  "layoutCardUIs",
  "reSetCardUI",
  "showSplitCard",
  "autoChooseClick",
  "updateAutoChooseSatate",
  "sendMoveOpt",
  "sendAutoChooseMoveOpt",
  "confirmBtmClick",
  "cancelBtnClick",
  "onCardDown",
  "onStageUp",
  "UpdateWindow",
  "clearWindow",
  "Close"
];

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function latestDir(suffix) {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => path.join(explorationRoot, entry.name));
  dirs.sort();
  return dirs.at(-1) || null;
}

function findClass(dump, registeredName) {
  return dump.value.classes.find((item) => item.registeredName === registeredName);
}

function ownMethodMap(item) {
  const map = new Map();
  for (const descriptor of item?.prototypeChain?.[0]?.descriptors || []) {
    if (descriptor.fn) map.set(descriptor.name, descriptor.fn);
  }
  return map;
}

function collectClass(item, methods) {
  const methodMap = ownMethodMap(item);
  return {
    registeredName: item?.registeredName || "",
    functionName: item?.functionName || "",
    reverseNames: item?.reverseNames || [],
    methods: methods.map((name) => {
      const fn = methodMap.get(name);
      return fn
        ? {
            name,
            arity: fn.arity,
            sourceLength: fn.sourceLength,
            sourceHash: fn.sourceHash,
            source: fn.source
          }
        : { name, missing: true };
    })
  };
}

function methodSource(record, name) {
  return record.methods.find((method) => method.name === name)?.source || "";
}

function shortSource(source, max = 260) {
  if (!source) return "";
  const normalized = source.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function mdEscape(text) {
  return String(text || "").replaceAll("|", "\\|");
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function loadSkillAuditRows() {
  const tsvPath = path.join(skillAuditDir, "skill-rule-audit-current.tsv");
  const reviewPath = path.join(skillAuditDir, "rule-review-current.md");
  const tsv = await readTextIfExists(tsvPath);
  const review = await readTextIfExists(reviewPath);
  const rows = tsv
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.split("\t"))
    .filter((cols) => cols[0] === "945" || cols[0] === "946");
  const reviewLines = review
    .split(/\r?\n/)
    .filter((line) => line.includes("- 945 ") || line.includes("- 946 "));
  return {
    tsvPath,
    reviewPath,
    rows,
    reviewLines
  };
}

function buildFacts(yanJiao, win, skillAudit) {
  return {
    trigger: {
      responder: shortSource(methodSource(yanJiao, "GetResponser"), 1000),
      condition: "GetResponser returns only when the operation type is OPT_SKILL_FLAG1.",
      windowName: "YanJiaoWindow",
      responseAlways: true
    },
    windowUpdate: {
      skillNotification: shortSource(methodSource(yanJiao, "OnMsgMoveCard"), 1000),
      windowNotification: shortSource(methodSource(win, "UpdateWindow"), 1200),
      acceptedProtocol: "Type_In_Spell with MsgID_YanJiao or MsgID_YanJiao_AutoChoose.",
      closeCondition: "UpdateWindow closes when MData length is 1."
    },
    candidateGeneration: {
      genSplitCard: shortSource(methodSource(win, "genSplitCard"), 1200),
      findEqualSubsequences: shortSource(methodSource(win, "findEqualSubsequences"), 1200),
      sourceCards: "msg.Params are converted through YVt.GetInstance() into paramsCards entries with id and number."
    },
    placement: {
      showSplitCard: shortSource(methodSource(win, "showSplitCard"), 1200),
      resetCardUi: shortSource(methodSource(win, "reSetCardUI"), 1200),
      layoutCardUis: shortSource(methodSource(win, "layoutCardUIs"), 1000),
      importantDirection: "splitCardIdsA are displayed in selfCardUIs; splitCardIdsB are displayed in targetCardUIs."
    },
    sendPaths: {
      autoChoose: shortSource(methodSource(win, "sendAutoChooseMoveOpt"), 1200),
      manualConfirm: shortSource(methodSource(win, "confirmBtmClick"), 1200),
      perDragMove: shortSource(methodSource(win, "sendMoveOpt"), 1000),
      dragDrop: shortSource(methodSource(win, "onStageUp"), 1200)
    },
    trackerAudit: {
      rows: skillAudit.rows,
      reviewLines: skillAudit.reviewLines
    }
  };
}

function writeMethodTable(lines, title, record) {
  lines.push(`## ${title}`);
  lines.push("");
  lines.push(`- registeredName: \`${record.registeredName}\``);
  lines.push(`- functionName: \`${record.functionName}\``);
  lines.push(`- reverseNames: \`${record.reverseNames.join(", ")}\``);
  lines.push("");
  lines.push("| Method | Hash | Length | Source excerpt |");
  lines.push("| --- | --- | ---: | --- |");
  for (const method of record.methods) {
    if (method.missing) {
      lines.push(`| \`${method.name}\` | missing |  |  |`);
    } else {
      lines.push(`| \`${method.name}\` | \`${method.sourceHash}\` | ${method.sourceLength} | \`${mdEscape(shortSource(method.source, 220))}\` |`);
    }
  }
  lines.push("");
}

function buildMarkdown(report) {
  const { sourcePath, page, runtime, yanJiao, windowClass, facts, skillAudit } = report;
  const lines = [];
  lines.push("# YanJiao Implementation Report");
  lines.push("");
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Focus source: ${sourcePath}`);
  lines.push(`- Page: ${page.title || ""} ${page.url || ""}`);
  lines.push(`- ResourceVersion: ${runtime.resourceVersion || ""}`);
  lines.push(`- Current scene at source dump: ${runtime.scene?.sceneName || ""}`);
  lines.push(`- Skill audit TSV: ${skillAudit.tsvPath}`);
  lines.push(`- Skill audit review: ${skillAudit.reviewPath}`);
  lines.push("");

  lines.push("## Skill Audit Rows");
  lines.push("");
  if (facts.trackerAudit.reviewLines.length) {
    for (const line of facts.trackerAudit.reviewLines) lines.push(`- ${line.replace(/^- /, "")}`);
  } else {
    lines.push("- No YanJiao skill-audit rows found.");
  }
  lines.push("");

  lines.push("## Trigger And Window Lifecycle");
  lines.push("");
  lines.push("- `YanJiao.GetResponser(t)` is the skill-operation gate. It returns a responder only for `OPT_SKILL_FLAG1`.");
  lines.push("- The responder sets `ResponseAlways = true` and `WindowName = \"YanJiaoWindow\"`, so the stable runtime hook is the registered window name, not the minified constructor.");
  lines.push("- `YanJiao.OnMsgMoveCard(t)` updates the visible window through `ms.I().UpdateWindow(\"YanJiaoWindow\", t)`.");
  lines.push("- `YanJiaoWindow.UpdateWindow(t)` accepts only spell protocol messages whose `MsgID` is `MsgID_YanJiao` or `MsgID_YanJiao_AutoChoose`.");
  lines.push("- A one-item `MData` closes the window. A `MsgID_YanJiao_AutoChoose` update with more than one item calls `updateAutoChooseSatate(MData)`. A two-item manual update means `[cardId, targetQueueIndex]`.");
  lines.push("");

  lines.push("## Field Map");
  lines.push("");
  lines.push("| Field | Meaning from source |");
  lines.push("| --- | --- |");
  lines.push("| `msg` | Original window protocol object. `Params` hold the revealed cards used by the window. |");
  lines.push("| `isSelf` | True only when `msg.SeatID == SelfSeatIndex` and not viewer; buttons are visible only in this state. |");
  lines.push("| `srcSeat` | Seat for `msg.SrcSeatID`; used for the upper recipient/title area. |");
  lines.push("| `selfSeat` | Seat for `msg.SeatID`; used for own lower area and outgoing protocol `SeatID`. |");
  lines.push("| `paramsCards` | Array built from `msg.Params`; each item stores the visible `id` and card `number`. |");
  lines.push("| `splitCardArr` | Candidate equal-sum splits generated from card numbers by `findEqualSubsequences()`. |");
  lines.push("| `chooseMax` / `chooseIndex` | Candidate count and the current quick-select cursor. |");
  lines.push("| `gridCardUIs` | Remaining cards in the original/top area. |");
  lines.push("| `targetCardUIs` | Cards currently shown in the source/target seat area. |");
  lines.push("| `selfCardUIs` | Cards currently shown in the self seat area. |");
  lines.push("| `cardQueues` | `[gridCardUIs, targetCardUIs, selfCardUIs]`; drag drop sends the selected queue index. |");
  lines.push("| `splitCardIdsA` / `splitCardIdsB` | IDs selected by `showSplitCard()`. Source proves A is rendered into `selfCardUIs`, B into `targetCardUIs`. |");
  lines.push("| `remainCards` | Revealed cards not selected into either group. |");
  lines.push("| `pointTxt1` / `pointTxt2` | Sum labels updated by `calculatePoint()`. |");
  lines.push("");

  lines.push("## Right-Side Candidate List Design");
  lines.push("");
  lines.push("- Use the existing window state. Do not recompute rules from scratch: call or read after `genSplitCard()` so `splitCardArr` and `paramsCards` are authoritative for the current protocol.");
  lines.push("- Install after `YanJiaoWindow.showWindow()` and rebuild after `layoutCardUIs(true)`, `showSplitCard(index)`, `updateAutoChooseSatate(MData)`, and `UpdateWindow(t)`.");
  lines.push("- Create a named Laya child under the window or its `contentSprite`, for example `__codex_yanjiao_candidate_list__`. This gives normal Laya hit testing for clickable rows.");
  lines.push("- A display-only DOM overlay can work with `pointer-events: none`, but a clickable right-side list should be Laya UI, not DOM, because DOM clicks can block the game canvas.");
  lines.push("- Each row should map to `splitCardArr[index]`, show the two card-number groups and their equal sum, and keep the original index for actions.");
  lines.push("- For preview/allocation only, row click should call `showSplitCard(index)` and then `layoutCardUIs(true)`. Do not send the protocol from a preview click unless that behavior is explicitly enabled.");
  lines.push("- For auto-submit mode, call `sendAutoChooseMoveOpt()` only after the user explicitly chooses that mode. The source-proven payload is `splitCardIdsA + [0] + splitCardIdsB` with `MsgID_YanJiao_AutoChoose`.");
  lines.push("- Be careful with direction: `showSplitCard()` renders A into `selfCardUIs` and B into `targetCardUIs`, while `confirmBtmClick()` sends the manual confirm payload as `targetCardUIs + [0] + selfCardUIs` through `VVt.SendMoveCard(...)`.");
  lines.push("");

  lines.push("## Auto Allocation Flow");
  lines.push("");
  lines.push("```text");
  lines.push("showWindow()");
  lines.push("-> genSplitCard()");
  lines.push("-> splitCardArr = findEqualSubsequences(cardNumbers)");
  lines.push("-> right-side list renders splitCardArr rows");
  lines.push("-> row preview: showSplitCard(rowIndex) -> layoutCardUIs(true)");
  lines.push("-> optional submit: sendAutoChooseMoveOpt()");
  lines.push("```");
  lines.push("");
  lines.push("Manual drag still uses the original game flow:");
  lines.push("");
  lines.push("```text");
  lines.push("onCardDown()");
  lines.push("-> card drag");
  lines.push("-> onStageUp()");
  lines.push("-> sendMoveOpt(cardId, queueIndex)");
  lines.push("-> confirmBtmClick()");
  lines.push("```");
  lines.push("");

  lines.push("## Monitoring Method");
  lines.push("");
  lines.push("- Wrap only methods on `Laya.ClassUtils._classMap.YanJiaoWindow.prototype`: `enterWindow`, `showWindow`, `genSplitCard`, `layoutCardUIs`, `showSplitCard`, `updateAutoChooseSatate`, `sendMoveOpt`, `sendAutoChooseMoveOpt`, `confirmBtmClick`, `UpdateWindow`, and `Close`.");
  lines.push("- Snapshot only public/visible window state: `msg.Params`, `paramsCards`, `splitCardArr`, queue lengths, `splitCardIdsA/B`, `remainCards`, button visibility/enabled state, and current scene.");
  lines.push("- Do not call `sendMoveOpt`, `sendAutoChooseMoveOpt`, or `confirmBtmClick` from a monitor. The monitor should record those calls when the user/game triggers them.");
  lines.push("- Clean up the candidate-list node in `Close()` and whenever the visible scene is no longer the owning battle/window context.");
  lines.push("");

  writeMethodTable(lines, "YanJiao Source", yanJiao);
  writeMethodTable(lines, "YanJiaoWindow Source", windowClass);

  lines.push("## Full Source Availability");
  lines.push("");
  lines.push("- Full method source is preserved in `yanjiao-implementation-report.json` under `yanJiao.methods` and `windowClass.methods`.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const followupDir = process.env.SGS_RUNTIME_FOLLOWUP_DIR || await latestDir("-followup-report");
  if (!followupDir) throw new Error("No followup report found.");
  const sourcePath = path.join(followupDir, "focused-source-dump.json");
  const dump = await readJson(sourcePath);
  const yanJiaoItem = findClass(dump, "YanJiao");
  const windowItem = findClass(dump, "YanJiaoWindow");
  if (!yanJiaoItem) throw new Error("YanJiao class not found in focused source dump.");
  if (!windowItem) throw new Error("YanJiaoWindow class not found in focused source dump.");

  const skillAudit = await loadSkillAuditRows();
  const yanJiao = collectClass(yanJiaoItem, yanJiaoMethods);
  const windowClass = collectClass(windowItem, windowMethods);
  const report = {
    generatedAt: new Date().toISOString(),
    sourcePath,
    page: dump.value.page || {},
    runtime: dump.value.runtime || {},
    skillAudit,
    yanJiao,
    windowClass,
    facts: buildFacts(yanJiao, windowClass, skillAudit)
  };

  const outDir = path.resolve(
    process.env.SGS_RUNTIME_YANJIAO_DIR ||
      path.join(explorationRoot, `${timestampName()}-yanjiao-report`)
  );
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "yanjiao-implementation-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "yanjiao-implementation-report.md"), buildMarkdown(report), "utf8");
  await writeFile(path.join(outDir, "README.md"), [
    "# YanJiao Implementation Report",
    "",
    `- Source dump: ${sourcePath}`,
    `- Markdown: ${path.join(outDir, "yanjiao-implementation-report.md")}`,
    `- JSON: ${path.join(outDir, "yanjiao-implementation-report.json")}`,
    ""
  ].join("\n"), "utf8");

  console.log(JSON.stringify({
    outDir,
    sourcePath,
    methods: {
      YanJiao: yanJiao.methods.filter((method) => !method.missing).length,
      YanJiaoWindow: windowClass.methods.filter((method) => !method.missing).length
    },
    skillAuditRows: skillAudit.rows.length,
    reviewLines: skillAudit.reviewLines.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
