import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

const methodRoles = [
  ["YanJiao", "GetResponser", "skill gate", "Returns a responder only for OPT_SKILL_FLAG1.", "No UI mutation; source proves WindowName=YanJiaoWindow and ResponseAlways=true."],
  ["YanJiao", "OnMsgMoveCard", "server notification bridge", "Calls WindowManager.UpdateWindow(\"YanJiaoWindow\", msg).", "Stable event path into the visible window."],
  ["YanJiao", "MoveCardToZoneResponse", "tracker discard record", "Records discard-pile movement for this skill.", "Tracker-relevant but not the candidate-list UI path."],
  ["YanJiaoWindow", "enterWindow", "window entry", "Clears state, stores msg, derives seats, and calls showWindow.", "Best lifecycle point to snapshot msg/isSelf/srcSeat/selfSeat."],
  ["YanJiaoWindow", "showWindow", "initial render", "Creates card UIs from msg.Params and lays out the three queues.", "Install/rebuild the side list after this method."],
  ["YanJiaoWindow", "genSplitCard", "candidate generation", "Converts msg.Params into paramsCards and builds splitCardArr.", "Use this output as authoritative; do not recompute from an external rule copy."],
  ["YanJiaoWindow", "findEqualSubsequences", "equal-sum solver", "Returns number-group pairs with equal sums.", "Rows in the right list map to splitCardArr[index]."],
  ["YanJiaoWindow", "showSplitCard", "preview allocation", "Fills splitCardIdsA/B and remainCards for one split index.", "Preview click should call this method, then layoutCardUIs(true)."],
  ["YanJiaoWindow", "layoutCardUIs", "visual layout", "Repositions all card queues and recalculates point labels.", "Run after showSplitCard to make the preview visible."],
  ["YanJiaoWindow", "updateAutoChooseSatate", "remote/auto update", "Applies an MData payload split by zero separator.", "Rebuild the list after this so the overlay matches server state."],
  ["YanJiaoWindow", "sendMoveOpt", "per-drag send", "Sends MsgID_YanJiao with [cardId, queueIndex?].", "Record only in monitors; do not call from preview list."],
  ["YanJiaoWindow", "sendAutoChooseMoveOpt", "auto-submit send", "Sends MsgID_YanJiao_AutoChoose with splitCardIdsA + [0] + splitCardIdsB.", "Only call after an explicit auto-submit mode is enabled."],
  ["YanJiaoWindow", "confirmBtmClick", "manual confirm send", "Sends target queue ids + [0] + self queue ids through the original move-card path.", "Direction differs from showSplitCard preview naming."],
  ["YanJiaoWindow", "autoChooseClick", "built-in auto action", "Cycles chooseIndex, previews, lays out, then sends auto choose.", "Useful source proof, but too active for a passive monitor."],
  ["YanJiaoWindow", "onCardDown", "manual drag start", "Starts dragging a selectable card UI when self can operate.", "Monitor for user-triggered movement only."],
  ["YanJiaoWindow", "onStageUp", "manual drag drop", "Detects target queue and calls sendMoveOpt.", "Maps physical drop to cardQueues index."],
  ["YanJiaoWindow", "clearWindow", "state cleanup", "Clears drag state and key seat/message refs.", "Overlay should not keep stale state past this point."],
  ["YanJiaoWindow", "Close", "window cleanup", "Removes stage mouse listener and message listener, then closes.", "Destroy __codex_yanjiao_candidate_list__ here."]
];

const fieldActionMap = [
  ["msg", "protocol input", "enterWindow, UpdateWindow", "Original protocol object; Params contain the revealed cards used by the window.", "Read-only snapshot."],
  ["isSelf", "operation gate", "enterWindow, showWindow", "True only when msg.SeatID is SelfSeatIndex and viewer mode is false.", "Buttons/list auto-submit must respect it."],
  ["srcSeat", "target/source seat", "enterWindow, showWindow", "Seat for msg.SrcSeatID, used by the upper recipient/title area.", "Display context only."],
  ["selfSeat", "own seat", "enterWindow, sendMoveOpt, sendAutoChooseMoveOpt", "Seat for msg.SeatID and outgoing protocol SeatID.", "Do not synthesize sends without explicit permission."],
  ["paramsCards", "revealed card catalog", "genSplitCard", "Array of visible card id and number values derived from msg.Params.", "Safe to display because the window already reveals these cards."],
  ["splitCardArr", "candidate rows", "genSplitCard, findEqualSubsequences, showSplitCard", "Equal-sum candidate pairs; right-side rows map by original index.", "Authoritative list source."],
  ["chooseMax / chooseIndex", "built-in auto cursor", "genSplitCard, autoChooseClick", "Candidate count and current built-in quick-select cursor.", "Overlay should not rely on chooseIndex for row identity."],
  ["gridCardUIs", "unassigned cards", "showWindow, reSetCardUI, showSplitCard", "Cards remaining in the original/top area.", "Visual state."],
  ["targetCardUIs", "target side cards", "showSplitCard, confirmBtmClick", "Cards currently shown in the source/target seat area.", "Manual confirm sends these before the zero separator."],
  ["selfCardUIs", "self side cards", "showSplitCard, confirmBtmClick", "Cards currently shown in the self seat area.", "Manual confirm sends these after the zero separator."],
  ["cardQueues", "drop queues", "constructor, reSetCardUI, onStageUp", "[gridCardUIs, targetCardUIs, selfCardUIs]; drag/drop uses this index.", "Useful for monitoring manual movement."],
  ["splitCardIdsA / splitCardIdsB", "preview selected ids", "showSplitCard, sendAutoChooseMoveOpt", "showSplitCard renders A into selfCardUIs and B into targetCardUIs.", "Auto-submit sends A + [0] + B."],
  ["remainCards", "unselected ids", "showSplitCard, updateAutoChooseSatate", "Revealed cards not assigned to either equal-sum group.", "Display/debug only."],
  ["pointTxt1 / pointTxt2", "sum labels", "calculatePoint", "Current sum labels for the two visible areas.", "Recomputed by layoutCardUIs."]
];

const flowSteps = [
  ["1", "Skill trigger", "YanJiao.GetResponser(t)", "Only OPT_SKILL_FLAG1 creates the YanJiaoWindow responder.", "source-proven"],
  ["2", "Window update", "YanJiao.OnMsgMoveCard(t)", "Routes server move-card notification into WindowManager.UpdateWindow(\"YanJiaoWindow\", t).", "source-proven"],
  ["3", "Window entry", "YanJiaoWindow.enterWindow(t)", "Stores msg/isSelf/seats and calls showWindow.", "source-proven"],
  ["4", "Candidate build", "YanJiaoWindow.genSplitCard()", "Builds paramsCards and splitCardArr from visible msg.Params.", "source-proven"],
  ["5", "Overlay render", "__codex_yanjiao_candidate_list__", "Create a Laya child under the window and render splitCardArr rows with original indexes.", "implemented-design"],
  ["6", "Preview click", "showSplitCard(index) -> layoutCardUIs(true)", "Moves visible card UIs into the two groups without sending protocol.", "implemented-design"],
  ["7", "Optional submit", "sendAutoChooseMoveOpt()", "Only in explicit auto-submit mode; payload is splitCardIdsA + [0] + splitCardIdsB.", "source-proven"],
  ["8", "Cleanup", "Close() / scene change", "Destroy the named overlay node and restore wrappers.", "implemented-design"]
];

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
    .map((entry) => path.join(explorationRoot, entry.name));
  dirs.sort();
  return dirs.at(-1) || null;
}

async function latestJson(suffix, filename) {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => path.join(explorationRoot, entry.name))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const filePath = path.join(dir, filename);
    const value = await readJsonIfExists(filePath);
    if (!value) continue;
    value.__path = filePath;
    value.__dir = dir;
    return value;
  }
  return null;
}

function methodByName(report, className, methodName) {
  const record = className === "YanJiao" ? report.yanJiao : report.windowClass;
  return record?.methods?.find((method) => method.name === methodName) || null;
}

function summarizeSource(source, max = 220) {
  if (!source) return "";
  const normalized = source.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function summarizeWatcher(watcher) {
  const status = watcher?.dump?.value?.status || {};
  return {
    path: watcher?.__path || "",
    installed: status.installed === true,
    classExists: status.classExists === true,
    functionName: status.functionName || "",
    wrappers: status.wrapperCount || 0,
    hookSummary: status.hookSummary || [],
    scene: status.current?.scene?.sceneName || status.current?.scene?.className || "",
    visibleWindows: status.current?.windows?.length || 0,
    renderRecords: status.renderRecords || 0,
    candidateClicks: status.candidateClicks || 0,
    sendRecords: status.sendRecords || 0,
    previewOnly: status.previewOnly !== false,
    errors: status.errors?.length || watcher?.dump?.value?.errors?.length || 0,
    restoredWrappers: watcher?.stop?.value?.status?.wrapperCount ?? null
  };
}

function buildMethodEvidence(yanJiaoReport) {
  return methodRoles.map(([className, method, role, proof, notes]) => {
    const source = methodByName(yanJiaoReport, className, method);
    return {
      className,
      method,
      role,
      proof,
      notes,
      present: !!source && !source.missing,
      sourceHash: source?.sourceHash || "",
      sourceLength: source?.sourceLength || 0,
      sourceExcerpt: summarizeSource(source?.source || "")
    };
  });
}

function escapeTsv(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\t/g, " ");
}

async function writeTsv(filePath, rows) {
  const text = rows.map((row) => row.map(escapeTsv).join("\t")).join("\n") + "\n";
  await writeFile(filePath, text, "utf8");
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# YanJiao Candidate List Implementation Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Source report: ${report.inputs.yanJiaoReport}`);
  lines.push(`- Watcher sample: ${report.inputs.yanJiaoListWatch || "(none)"}`);
  lines.push(`- Status: ${report.status.level}`);
  lines.push(`- Caveat: ${report.status.caveat}`);
  lines.push("");
  lines.push("## Answer");
  lines.push("");
  lines.push("- The right-side candidate list can be implemented stably by anchoring on the registered class `YanJiaoWindow`, not the minified constructor name.");
  lines.push("- Render a named Laya child `__codex_yanjiao_candidate_list__` inside the window after `showWindow()`/`layoutCardUIs()` and use `splitCardArr[index]` as the row source.");
  lines.push("- A preview row click should call `showSplitCard(index)` followed by `layoutCardUIs(true)`. This moves the cards in the existing window state and does not send the protocol.");
  lines.push("- Auto-submit is technically source-proven, but it must remain explicit: `sendAutoChooseMoveOpt()` sends `splitCardIdsA + [0] + splitCardIdsB` with `MsgID_YanJiao_AutoChoose`.");
  lines.push("- Direction caveat: `showSplitCard()` renders A into `selfCardUIs` and B into `targetCardUIs`; manual confirm sends `targetCardUIs + [0] + selfCardUIs`.");
  lines.push("");
  lines.push("## Live Watcher Status");
  lines.push("");
  lines.push(`- classExists=${report.watcher.classExists}; function=${report.watcher.functionName}; wrappers=${report.watcher.wrappers}; visibleWindows=${report.watcher.visibleWindows}; renderRecords=${report.watcher.renderRecords}; candidateClicks=${report.watcher.candidateClicks}; previewOnly=${report.watcher.previewOnly}; restoredWrappers=${report.watcher.restoredWrappers}; errors=${report.watcher.errors}.`);
  lines.push("- Current watcher proof means the wrapper/cleanup path is live-installable. It does not yet prove real-window coordinates or row hit testing because no live YanJiaoWindow was open in that sample.");
  lines.push("");
  lines.push("## Flow");
  lines.push("");
  lines.push("| Step | Name | Hook | Action | Evidence |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of report.flowSteps) {
    lines.push(`| ${row.step} | ${row.name} | \`${row.hook}\` | ${row.action} | ${row.evidenceLevel} |`);
  }
  lines.push("");
  lines.push("## Method Evidence");
  lines.push("");
  lines.push("| Class | Method | Role | Present | Hash | Proof | Notes |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const item of report.methodEvidence) {
    lines.push(`| \`${item.className}\` | \`${item.method}\` | ${item.role} | ${item.present} | \`${item.sourceHash}\` | ${item.proof} | ${item.notes} |`);
  }
  lines.push("");
  lines.push("## Field To Action Map");
  lines.push("");
  lines.push("| Field | Role | Source methods | Meaning | Guardrail |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const item of report.fieldActionMap) {
    lines.push(`| \`${item.field}\` | ${item.role} | ${item.sourceMethods} | ${item.meaning} | ${item.guardrail} |`);
  }
  lines.push("");
  lines.push("## Files");
  lines.push("");
  lines.push(`- Flow TSV: ${report.outputs.flowTsv}`);
  lines.push(`- Method TSV: ${report.outputs.methodEvidenceTsv}`);
  lines.push(`- Field TSV: ${report.outputs.fieldActionMapTsv}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const yanJiaoDir = await latestDir("-yanjiao-report");
  if (!yanJiaoDir) throw new Error("No YanJiao implementation report found.");
  const yanJiaoReportPath = path.join(yanJiaoDir, "yanjiao-implementation-report.json");
  const yanJiaoReport = await readJson(yanJiaoReportPath);
  const watcher = await latestJson("-yanjiao-list-watch", "yanjiao-list-watch.json");
  const watcherSummary = summarizeWatcher(watcher);
  const methodEvidence = buildMethodEvidence(yanJiaoReport);
  const outDir = path.resolve(
    process.env.SGS_RUNTIME_YANJIAO_CANDIDATE_DIR ||
      path.join(explorationRoot, `${timestampName()}-yanjiao-candidate-list-implementation-report`)
  );
  await mkdir(outDir, { recursive: true });

  const outputs = {
    flowTsv: path.join(outDir, "yanjiao-candidate-flow.tsv"),
    methodEvidenceTsv: path.join(outDir, "yanjiao-method-evidence.tsv"),
    fieldActionMapTsv: path.join(outDir, "yanjiao-field-action-map.tsv")
  };

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      yanJiaoReport: yanJiaoReportPath,
      yanJiaoMarkdown: path.join(yanJiaoDir, "yanjiao-implementation-report.md"),
      yanJiaoListWatch: watcher?.__path || ""
    },
    status: {
      level: watcherSummary.wrappers > 0 ? "source-proven-and-watcher-live-installable" : "source-proven",
      sourceProven: methodEvidence.every((item) => item.present),
      watcherLiveInstallable: watcherSummary.wrappers > 0,
      realWindowSample: watcherSummary.visibleWindows > 0,
      candidateRenderProven: watcherSummary.renderRecords > 0,
      caveat: watcherSummary.visibleWindows > 0
        ? "A live YanJiaoWindow was visible; inspect render/click rows before enabling auto-submit."
        : "No real YanJiaoWindow sample was open; coordinates and row hit testing still need a natural window sample."
    },
    watcher: watcherSummary,
    methodEvidence,
    fieldActionMap: fieldActionMap.map(([field, role, sourceMethods, meaning, guardrail]) => ({
      field,
      role,
      sourceMethods,
      meaning,
      guardrail
    })),
    flowSteps: flowSteps.map(([step, name, hook, action, evidenceLevel]) => ({
      step,
      name,
      hook,
      action,
      evidenceLevel
    })),
    implementationContract: {
      classAnchor: "Laya.ClassUtils.getClass('YanJiaoWindow') || Laya.ClassUtils._classMap.YanJiaoWindow",
      listName: "__codex_yanjiao_candidate_list__",
      renderAfterMethods: ["showWindow", "layoutCardUIs", "showSplitCard", "updateAutoChooseSatate", "UpdateWindow"],
      previewClick: ["win.showSplitCard(index)", "win.layoutCardUIs(true)", "render(win)"],
      explicitAutoSubmit: ["win.sendAutoChooseMoveOpt()"],
      cleanup: ["win.getChildByName(listName)?.destroy(true)", "restore wrapped prototype methods"],
      passiveMonitorGuardrail: "Do not call sendMoveOpt/sendAutoChooseMoveOpt/confirmBtmClick unless explicit active mode is enabled."
    },
    outputs
  };

  await writeTsv(outputs.flowTsv, [
    ["step", "name", "hook", "action", "evidenceLevel"],
    ...report.flowSteps.map((item) => [item.step, item.name, item.hook, item.action, item.evidenceLevel])
  ]);
  await writeTsv(outputs.methodEvidenceTsv, [
    ["className", "method", "role", "present", "sourceHash", "sourceLength", "proof", "notes", "sourceExcerpt"],
    ...methodEvidence.map((item) => [item.className, item.method, item.role, item.present, item.sourceHash, item.sourceLength, item.proof, item.notes, item.sourceExcerpt])
  ]);
  await writeTsv(outputs.fieldActionMapTsv, [
    ["field", "role", "sourceMethods", "meaning", "guardrail"],
    ...report.fieldActionMap.map((item) => [item.field, item.role, item.sourceMethods, item.meaning, item.guardrail])
  ]);
  await writeFile(path.join(outDir, "yanjiao-candidate-list-implementation-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "README.md"), buildMarkdown(report), "utf8");

  console.log(JSON.stringify({
    outDir,
    status: report.status.level,
    methods: methodEvidence.length,
    presentMethods: methodEvidence.filter((item) => item.present).length,
    fields: report.fieldActionMap.length,
    flowSteps: report.flowSteps.length,
    watcher: watcherSummary
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
