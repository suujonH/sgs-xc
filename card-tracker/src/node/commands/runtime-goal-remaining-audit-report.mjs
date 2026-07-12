import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");
const scriptRoot = path.join(projectRoot, "Scripts", "src", "node", "commands");

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
  const matches = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => path.join(explorationRoot, entry.name))
    .sort()
    .reverse();
  return matches[0] || null;
}

async function readJsonIfExists(filePath) {
  if (!filePath || !(await exists(filePath))) return null;
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readTextIfExists(filePath) {
  if (!filePath || !(await exists(filePath))) return "";
  return readFile(filePath, "utf8");
}

function escapeTsv(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\t/g, " ");
}

function markdownCell(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replaceAll("|", "\\|");
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

function countBy(rows, key) {
  const out = {};
  for (const row of rows) {
    const raw = row[key] || "(none)";
    for (const part of String(raw).split("|").filter(Boolean)) out[part] = (out[part] || 0) + 1;
  }
  return Object.entries(out)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 16)
    .map(([name, count]) => ({ name, count }));
}

function scriptPath(name) {
  return path.join(scriptRoot, name);
}

function scriptCommand(name, args = "") {
  return `node Scripts/src/node/commands/${name}${args ? ` ${args}` : ""}`;
}

async function scriptInfo(name, args = "") {
  const filePath = scriptPath(name);
  return {
    name,
    path: filePath,
    command: scriptCommand(name, args),
    exists: await exists(filePath)
  };
}

async function latestJsonReport(suffix, fileName) {
  const dir = await latestDir(suffix);
  if (!dir) return null;
  const jsonPath = path.join(dir, fileName);
  const value = await readJsonIfExists(jsonPath);
  if (!value) return null;
  value.__dir = dir;
  value.__path = jsonPath;
  return value;
}

async function latestJsonReportWhere(suffix, fileName, predicate) {
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
  for (const dir of dirs) {
    const jsonPath = path.join(dir, fileName);
    const value = await readJsonIfExists(jsonPath);
    if (!value || !predicate(value)) continue;
    value.__dir = dir;
    value.__path = jsonPath;
    return value;
  }
  return null;
}

async function latestObjectiveCoverage() {
  const dir = await latestDir("-objective-coverage");
  if (!dir) return null;
  const jsonPath = path.join(dir, "objective-coverage-report.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value) return null;
  return { dir, jsonPath, mdPath: path.join(dir, "objective-coverage-report.md"), value };
}

async function latestFieldSemanticIndex() {
  const dir = await latestDir("-field-semantic-index-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "field-semantic-index-report.json");
  const value = await readJsonIfExists(jsonPath);
  const unresolvedPath = path.join(dir, "unresolved-field-priority.tsv");
  const unresolvedRows = parseTsv(await readTextIfExists(unresolvedPath));
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    unresolvedPath,
    summary: value?.summary || {},
    unresolvedRows
  };
}

function objectiveRequirementMap(objective) {
  const out = new Map();
  for (const row of objective?.value?.requirements || []) out.set(row.id, row);
  return out;
}

function evidencePath(report, fallback = "") {
  return report?.__path || report?.path || report?.mdPath || report?.jsonPath || fallback || "";
}

function positiveHoverDelta(d) {
  return (d?.stageChildDelta || 0) > 0 ||
    (d?.windowLayerChildDelta || 0) > 0 ||
    (d?.windowChildrenDelta || 0) > 0 ||
    (d?.tipLikeDelta || 0) > 0 ||
    (d?.newWindowChildren?.length || 0) > 0 ||
    (d?.newTipLike?.length || 0) > 0;
}

function summarizeHoverStageDelta(report) {
  const samples = report?.samples || [];
  return {
    scene: report?.summary?.scene || report?.candidates?.scene?.sceneName || report?.candidates?.scene?.className || "",
    candidates: report?.summary?.candidates ?? report?.candidates?.candidates?.length ?? 0,
    sampledTargets: report?.summary?.sampledTargets ?? samples.length,
    cdpHoverOk: report?.summary?.cdpHoverOk ?? samples.filter((sample) => sample.dispatch?.hover?.ok === true).length,
    cdpHoverTimeouts: report?.summary?.cdpHoverTimeouts ?? samples.filter((sample) => sample.dispatch?.hover?.ok === false).length,
    directOk: report?.summary?.directOk ?? samples.filter((sample) => sample.direct?.ok === true && sample.direct?.mouseOver?.ok === true).length,
    cdpDeltaObserved: report?.summary?.cdpDeltaObserved ?? samples.some((sample) => positiveHoverDelta(sample.cdpDelta)),
    directDeltaObserved: report?.summary?.directDeltaObserved ?? samples.some((sample) => positiveHoverDelta(sample.directDelta)),
    cleanupOk: report?.summary?.cleanupOk ?? report?.cleanup?.ok === true,
    sampledTexts: report?.summary?.sampledTexts || samples.map((sample) => sample.target?.text || sample.target?.label || "").filter(Boolean).slice(0, 12)
  };
}

async function buildResidualCases({ objective, fieldIndex, latest }) {
  const reqs = objectiveRequirementMap(objective);
  const liveGapWatch = latest.liveGapWatch;
  const promptMonitor = latest.promptMonitor;
  const battleEndScan = latest.battleEndScan;
  const battleEntryScan = latest.battleEntryScan;
  const rogueEndedExit = latest.rogueEndedExit;
  const qixingWatch = latest.qixingWatch;
  const yanjiaoWatch = latest.yanjiaoWatch;
  const hoverStage = latest.hoverStage;
  const hoverStageSummary = summarizeHoverStageDelta(hoverStage);
  const hoverHandler = latest.hoverHandler;
  const blessProbe = latest.blessProbe;
  const rogueSkillDetail = latest.rogueSkillDetail?.summary || {};
  const promptSummary = promptMonitor?.summary || {};
  const promptStatus = promptMonitor?.dump?.value?.status || promptMonitor?.install?.value || {};
  const promptSnapshot = promptMonitor?.dump?.value?.currentPromptSnapshot || {};
  const promptScene = promptSummary.scene || promptStatus.scene?.sceneName || promptSnapshot.scene?.sceneName || "";
  const promptIsGameOver = promptSummary.isGameOver ?? promptStatus.scene?.isGameOver ?? promptSnapshot.scene?.isGameOver ?? "";
  const activeOperation = latest.activeOperation;
  const activeOperationRecords = activeOperation?.dump?.records || [];
  const activeOperationLabels = activeOperationRecords.map((record) => record.label || "");
  const activeHas = (pattern) => activeOperationLabels.some((label) => pattern.test(label));
  const activeStatus = activeOperation?.dump?.status || {};
  const activeSendOrConfirm = activeOperationRecords.filter((record) =>
    /proxy\.L|Send|send|Req|Rep|Ntf|RoleOpt|Select|Card|Skill|Spell|Use|Move|Deal|Discard|Confirm|Play|Trigger|Opt/.test(record.label || "")
  ).length;
  const activeEvidence = activeOperation ? [
    activeOperation.__path,
    path.join(activeOperation.__dir, "FOCUSED_CHAIN.md"),
    path.join(activeOperation.__dir, "active-operation-records.tsv")
  ] : [];
  const activeObservedState = activeOperation
    ? `activeScene=${activeStatus.scene?.scene || ""}; activeGameOver=${activeStatus.scene?.isGameOver ?? ""}; activeRecords=${activeOperationRecords.length}; activeSendOrConfirm=${activeSendOrConfirm}; activeSkillConfirm=${activeHas(/SpellTouch_ConfirmResult/)}; activeStartSelect=${activeHas(/StartSelectCard/)}; activeCardSelected=${activeHas(/CardUI_SelectedChanged/)}; activeTargetSelect=${activeHas(/StartSelectTargetSeatOverload/)}; activeSelectResult=${activeHas(/SelectCardResult$/)}; activePlayResult=${activeHas(/PlayCard_Result/)}; activeCompleted=${activeHas(/SelectCardResultCompleted/)}; activeDiscardRequest=${activeHas(/DiscardRequest/)}; activeWrappersAfterStop=${activeOperation.stop?.status?.wrapperCount ?? ""}`
    : "activeOperation=missing";
  const battleEndManager = battleEndScan?.after?.manager || battleEndScan?.action?.before?.manager || {};
  const battleEndScene = battleEndScan?.after?.currentScene?.sceneName || battleEndScan?.action?.before?.currentScene?.sceneName || "";
  const battleEndResultWindows = battleEndScan?.after?.resultWindows?.length ?? battleEndScan?.action?.before?.resultWindows?.length ?? "";
  const battleEndConfirmWindows = battleEndScan?.after?.confirmWindows?.length ?? battleEndScan?.action?.before?.confirmWindows?.length ?? "";
  const battleEntryRouteCandidates = battleEntryScan?.after?.routeCandidateCount ?? battleEntryScan?.action?.before?.routeCandidateCount ?? "";
  const battleEntryTableProofs = battleEntryScan?.after?.tableProofs?.length ?? battleEntryScan?.action?.before?.tableProofs?.length ?? "";
  const rogueEndedSummary = rogueEndedExit?.summary || {};
  const resourceProbeValue = latest.resourceReplacementProbe?.value || {};
  const resourceLoadValue = latest.resourceLoadSchemeProof?.value || {};
  const resourceLoadStatuses = Object.fromEntries((resourceLoadValue.results || []).map((item) => [item.label, item.status || ""]));
  const resourceLoadAllOk = (resourceLoadValue.results || []).length > 0 && (resourceLoadValue.results || []).every((item) => item.ok === true);
  const eventFieldWatchStatus = latest.eventFieldTransitionWatch?.dump?.value?.status || {};
  const eventFieldWatchRecords = latest.eventFieldTransitionWatch?.dump?.value?.records || [];
  const eventFieldWatchChangedRecords = eventFieldWatchRecords.filter((record) => (record.fieldDiffCount || 0) > 0 || (record.contextDiffCount || 0) > 0).length;
  const activeFieldTransitions = latest.activeOperationFieldTransition || null;
  const activeFieldTransitionSummary = activeFieldTransitions?.summary || {};
  const activeFieldTransitionEvidence = activeFieldTransitions ? [
    activeFieldTransitions.__path,
    path.join(activeFieldTransitions.__dir, "README.md"),
    path.join(activeFieldTransitions.__dir, "covered-unresolved-fields.tsv"),
    path.join(activeFieldTransitions.__dir, "active-operation-field-evidence.tsv")
  ] : [];
  const liveProofPlaybook = latest.liveProofPlaybook || null;
  const liveProofSummary = liveProofPlaybook?.summary || {};
  const cases = [
    {
      id: "field-transition-semantics",
      requirementId: "all-registration-names",
      target: "所有名字/字段的 live transition 含义",
      triggerCondition: "进入新的 scene/window/prompt 后，或字段值随点击/hover/发牌/弃牌/技能响应变化时",
      activationSignal: "场景名、可见窗口列表、prompt 节点、按钮/牌节点或 GED/proxy 事件记录相比上一快照发生变化。",
      monitorMethod: "Run passive live gap watch plus targeted live object/field semantics reports; correlate with field semantic index.",
      successEvidence: "event-field transition records contain changed field/context diffs, and unresolved-field-priority rows for the touched owner/field move out of needs-targeted-live-transition.",
      scripts: [
        await scriptInfo("runtime-active-operation-recorder.mjs"),
        await scriptInfo("runtime-active-operation-dump.mjs"),
        await scriptInfo("runtime-active-operation-field-transition-report.mjs"),
        await scriptInfo("runtime-live-gap-watch.mjs", "20000"),
        await scriptInfo("runtime-live-object-state-audit.mjs"),
        await scriptInfo("runtime-live-field-semantics-report.mjs"),
        await scriptInfo("runtime-field-semantic-index-report.mjs"),
        await scriptInfo("runtime-event-field-transition-watch.mjs", "20000"),
        await scriptInfo("runtime-ui-state-transition-sample.mjs"),
        await scriptInfo("runtime-hover-handler-field-transition-sample.mjs"),
        await scriptInfo("runtime-live-proof-playbook-report.mjs")
      ],
      currentEvidence: [
        fieldIndex?.mdPath || "",
        liveGapWatch?.__path || "",
        latest.eventFieldTransitionWatch?.__path || "",
        liveProofPlaybook?.__path || "",
        liveProofPlaybook?.__dir ? path.join(liveProofPlaybook.__dir, "live-proof-playbook.tsv") : "",
        liveProofPlaybook?.__dir ? path.join(liveProofPlaybook.__dir, "live-proof-case-summary.tsv") : "",
        ...activeFieldTransitionEvidence,
        latest.uiStateTransition?.__path || "",
        latest.uiStateDirectEvent?.__path || "",
        hoverHandler?.__path || "",
        reqs.get("all-registration-names")?.evidence?.slice(-4).join("; ") || ""
      ],
      observedState: `fieldRows=${fieldIndex?.summary?.fieldIndexRows ?? 0}; unresolved=${fieldIndex?.summary?.unresolvedRows ?? 0}; needsLive=${fieldIndex?.summary?.needsLiveRows ?? 0}; permissionGated=${fieldIndex?.summary?.permissionGatedRows ?? 0}; activeFieldEvidenceRows=${activeFieldTransitionSummary.evidenceRows ?? ""}; activeFieldCovered=${activeFieldTransitionSummary.coveredUnresolvedRows ?? ""}; activeFieldUncovered=${activeFieldTransitionSummary.uncoveredUnresolvedRows ?? ""}; activeFieldExact=${activeFieldTransitionSummary.coveredByStrength?.exact ?? ""}; liveProofRows=${liveProofSummary.playbookRows ?? ""}; liveProofCases=${liveProofSummary.caseCount ?? ""}; liveProofNeedsLive=${liveProofSummary.needsLiveRows ?? ""}; eventFieldWrappers=${eventFieldWatchStatus.wrapperCount ?? ""}; eventFieldRecords=${eventFieldWatchRecords.length}; eventFieldChanged=${eventFieldWatchChangedRecords}; eventFieldBlocked=${eventFieldWatchStatus.blockedCalls ?? ""}; uiAttempts=${latest.uiStateTransition?.value?.attempts?.length ?? ""}; directEventAllowed=${latest.uiStateDirectEvent?.value?.safety?.directEventAllowed ?? ""}; hoverHandlerSamples=${hoverHandler?.value?.samples?.length ?? ""}; hoverFieldDeltas=${(hoverHandler?.value?.samples || []).filter((sample) => (sample.overFieldChanges?.length || 0) > 0 || (sample.outFieldChanges?.length || 0) > 0).length}`,
      missingProof: activeFieldTransitionSummary.coveredUnresolvedRows
        ? `Remaining rows need event-specific value transitions. Active-operation offline join now maps ${activeFieldTransitionSummary.coveredUnresolvedRows} unresolved row(s), including ${activeFieldTransitionSummary.coveredByStrength?.exact || 0} exact class+field match(es), but ${activeFieldTransitionSummary.uncoveredUnresolvedRows ?? "unknown"} row(s) still need targeted live samples. Current UI tab sample maps button fields and proves direct event does not change selection; current hover-handler sample maps phase/_stateChanged transitions; event-field transition watcher is implemented and captured current ended-state GED/proxy events.`
        : "Remaining rows need event-specific value transitions. Current UI tab sample maps button fields and proves direct event does not change selection; current hover-handler sample maps phase/_stateChanged transitions; event-field transition watcher is implemented and captured current ended-state GED/proxy events, but more scene/window/prompt interactions are still needed for changed-field rows.",
      safeBoundary: "Passive sampling only; do not read hidden opponent hand fields."
    },
    {
      id: "resource-drawing-replacement",
      requirementId: "resource-drawing-replacement",
      target: "资源文件描画、本地/网络资源替换、version manifest 路径映射",
      triggerCondition: "需要把某个逻辑资源路径绘制到 Laya 画面，或把已知逻辑路径 a.png 替换为本地/网络 b.png 时。",
      activationSignal: "Laya.Image.skin / Sprite.graphics.loadImage / Laya.loader.load / Laya.URL.formatURL 接收到目标逻辑资源路径，或 ResourceVersion.addVersionPrefix/customFormat 被调用。",
      monitorMethod: "Run resource replacement probe and load-scheme proof; inspect current resourceVersion, manifest shape, URL hook relation, draw result, and load statuses.",
      successEvidence: "resource replacement probe reports drawOk=true and a replacement formatURL result, and load-scheme proof loads replacement URLs as Laya textures; already-loaded UI is refreshed by clearRes plus skin reset/rebuild.",
      scripts: [
        await scriptInfo("runtime-resource-replacement-probe.mjs"),
        await scriptInfo("runtime-resource-load-scheme-proof.mjs"),
        await scriptInfo("runtime-trigger-monitoring-report.mjs")
      ],
      currentEvidence: [
        path.join(explorationRoot, "resource-drawing-and-replacement.md"),
        evidencePath(latest.resourceReplacementProbe),
        evidencePath(latest.resourceLoadSchemeProof),
        reqs.get("resource-drawing-replacement")?.evidence?.join("; ") || ""
      ],
      observedState: `resourceVersion=${resourceProbeValue.api?.runtime?.resourceVersion || resourceLoadValue.runtime?.resourceVersion || ""}; Laya=${resourceProbeValue.api?.runtime?.layaVersion || resourceLoadValue.runtime?.layaVersion || ""}; manifestSize=${resourceProbeValue.api?.resourceVersionApi?.manifestSize ?? ""}; drawOk=${resourceProbeValue.drawProbe?.ok === true}; formatURL=${resourceProbeValue.hookProbe?.formatURLResult || ""}; file=${resourceLoadStatuses["file-url"] || ""}; localHttp=${resourceLoadStatuses["local-http"] || ""}; sameOriginHttps=${resourceLoadStatuses["same-origin-https"] || ""}; data=${resourceLoadStatuses["data-url"] || ""}; allLoaded=${resourceLoadAllOk}`,
      missingProof: "Current proof is valid for the captured resourceVersion and current Laya hook relation; recheck after a page/resource version change, and refresh already-loaded atlas/image nodes explicitly.",
      safeBoundary: "Do not mutate remote game resources. Prefer local HTTP/CORS, data/blob, or controlled request fulfill; treat file:// as a debug-only shortcut and avoid broad URL rewrites."
    },
    {
      id: "qixing-shen-zhuge-real-popup",
      requirementId: "shen-zhuge-qixing",
      target: "神诸葛/七星/观星真实弹窗和武将牌上公开牌",
      triggerCondition: "真实牌局触发 QiXing/GuanXing/Shen Zhuge 相关窗口，或出现 public general/pile card movement.",
      activationSignal: "visible target window label contains QiXing/GuanXing, or public-general/pile-like card fields appear on visible seat/general nodes.",
      monitorMethod: "Install Qixing watcher, hook QiXing/GuanXing classes and visible windows, sample public-general card fields and cleanup lifecycle.",
      successEvidence: "qixing-shen-zhuge-watch reports targetWindows > 0 plus visibleWindowCards/publicGeneralCards > 0 or records proving the public card movement and cleanup.",
      scripts: [
        await scriptInfo("runtime-qixing-shen-zhuge-watch.mjs", "30000"),
        await scriptInfo("runtime-live-gap-watch.mjs", "30000")
      ],
      currentEvidence: [evidencePath(qixingWatch), evidencePath(liveGapWatch), reqs.get("shen-zhuge-qixing")?.evidence?.join("; ") || ""],
      observedState: `wrappers=${qixingWatch?.dump?.value?.status?.wrapperCount ?? qixingWatch?.summary?.wrapperCount ?? ""}; visibleWindows=${qixingWatch?.dump?.value?.status?.targetWindows?.length ?? ""}; records=${qixingWatch?.dump?.value?.records?.length ?? ""}`,
      missingProof: "No real visible QiXing/GuanXing target window with cards/public-general fields has been observed.",
      safeBoundary: "Block send paths while observing unless explicitly sampling a safe non-purchase action."
    },
    {
      id: "yanjiao-real-window-list-click",
      requirementId: "yanjiao-list-allocation",
      target: "严教窗口右侧候选列表、点击候选后预览分配",
      triggerCondition: "真实 YanJiaoWindow 打开并带 msg.Params / splitCardArr.",
      activationSignal: "visible YanJiaoWindow exists and its instance contains msg/isSelf/srcSeat/selfSeat/splitCardArr or candidate card fields.",
      monitorMethod: "Install YanJiao list watcher; render preview-only list under the window; record showSplitCard/layoutCardUIs state before/after row click.",
      successEvidence: "yanjiao-list-watch reports windows > 0, renderRecords > 0, and candidate click/preview records with before/after splitCardArr or showSplitCard/layoutCardUIs field deltas.",
      scripts: [
        await scriptInfo("runtime-yanjiao-list-watch.mjs", "30000"),
        await scriptInfo("runtime-yanjiao-candidate-list-implementation-report.mjs")
      ],
      currentEvidence: [evidencePath(yanjiaoWatch), latest.yanjiaoCandidate?.__path || "", reqs.get("yanjiao-list-allocation")?.evidence?.join("; ") || ""],
      observedState: `wrappers=${yanjiaoWatch?.dump?.value?.status?.wrapperCount ?? yanjiaoWatch?.summary?.wrapperCount ?? ""}; windows=${yanjiaoWatch?.dump?.value?.status?.current?.windows?.length ?? ""}; records=${yanjiaoWatch?.dump?.value?.records?.length ?? ""}`,
      missingProof: "Watcher is live-installable, but no real YanJiao window coordinates, row click, or split preview has been captured.",
      safeBoundary: "Preview-only by default; do not call sendAutoChooseMoveOpt unless explicitly requested."
    },
    {
      id: "non-ended-prompt-auto-action",
      requirementId: "skill-trigger-protocol",
      target: "非结束态技能/出牌/弃牌 prompt 的自动确认与自动选择边界",
      triggerCondition: "真实 TableGameScene/RogueLikeGameScene 中出现 SelectCardWindow/SkillBiFa/SpellMulti 等可操作 prompt，且 manager.isGameOver=false.",
      activationSignal: "manager.isGameOver=false and a visible prompt/window/action node appears with SelectCardWindow/SkillBiFa/SpellMulti/confirm/send-like methods.",
      monitorMethod: "Install prompt automation monitor; hook prompt class prototypes, instance methods, and send functions; record prompt node fields before active sampling.",
      successEvidence: "prompt monitor captures non-ended scene state, promptNodes/visiblePromptWindows > 0, and a prompt-specific before/after record that identifies the safe send/confirm method without hidden hand reads.",
      scripts: [
        await scriptInfo("runtime-active-operation-recorder.mjs"),
        await scriptInfo("runtime-active-operation-dump.mjs"),
        await scriptInfo("runtime-active-operation-dump-stop.mjs"),
        await scriptInfo("runtime-prompt-automation-monitor.mjs", "30000"),
        await scriptInfo("runtime-battle-end-sample.mjs", "scan"),
        await scriptInfo("runtime-battle-entry-sample.mjs", "scan"),
        await scriptInfo("runtime-rogue-ended-exit-report.mjs"),
        await scriptInfo("runtime-rogue-battle-prompt-inspect.mjs"),
        await scriptInfo("runtime-rogue-current-action-handler-report.mjs"),
        await scriptInfo("runtime-rogue-current-skill-button-detail-report.mjs")
      ],
      currentEvidence: [evidencePath(promptMonitor), ...activeEvidence, evidencePath(battleEndScan), evidencePath(battleEntryScan), evidencePath(rogueEndedExit), latest.roguePrompt?.__path || "", latest.rogueHandler?.__path || "", latest.rogueSkillDetail?.__path || "", reqs.get("skill-trigger-protocol")?.evidence?.join("; ") || ""],
      observedState: `scene=${promptScene}; gameOver=${promptIsGameOver}; wrappers=${promptSummary.wrapperCount ?? promptStatus.wrapperCount ?? ""}; promptNodes=${promptSummary.promptNodes ?? promptSnapshot.promptNodes?.length ?? ""}; visiblePromptWindows=${promptSummary.visiblePromptWindows ?? promptSnapshot.visiblePromptWindows?.length ?? ""}; records=${promptSummary.records ?? promptStatus.recordCount ?? ""}; ${activeObservedState}; battleEndScene=${battleEndScene}; battleEndGameOver=${battleEndManager.isGameOver ?? ""}; resultWindows=${battleEndResultWindows}; confirmWindows=${battleEndConfirmWindows}; battleEntryRouteCandidates=${battleEntryRouteCandidates}; tableProofs=${battleEntryTableProofs}; rogueExitMethods=${rogueEndedSummary.methodCount ?? ""}; confirmGated=${(rogueEndedSummary.confirmGatedMethods || []).join("/")}; skillButtons=${(rogueSkillDetail.skillButtonTexts || []).join("/")}; autoEvidence=${rogueSkillDetail.autoEvidenceRows ?? ""}; sendOrConfirm=${rogueSkillDetail.sendOrConfirmRows ?? ""}`,
      missingProof: activeHas(/SpellTouch_ConfirmResult/)
        ? "Non-ended TableGameScene prompt and skill-confirm chain are now live-proven. Remaining work is not discovery of the hook, but per-prompt gating before any unattended auto-confirm is enabled."
        : "A non-ended actionable prompt is still required before auto-send/confirm can be proven.",
      safeBoundary: "Do not auto-send blindly; use the captured prompt-specific before/after state and keep purchase-like paths blocked."
    },
    {
      id: "discard-select-card-auto",
      requirementId: "card-ui-movement-selection",
      target: "自动出牌、自动选牌、自动弃牌、UI 中牌移动",
      triggerCondition: "出现真实 discard/use/select prompt，且 self hand/selected cards are visible-authorized.",
      activationSignal: "self hand CardUI/select panel is visible-authorized and a discard/use/select prompt exposes selectable card nodes or selected-card arrays.",
      monitorMethod: "Use prompt monitor plus live action handler join to bind NBi/uBt/card UI event handlers to SelectCardWindow/SkillBiFa send paths.",
      successEvidence: "handler-field join or prompt monitor records the exact visible CardUI -> selected state -> send/confirm path, with card identity provenance limited to self/visible/protocol-authorized fields.",
      scripts: [
        await scriptInfo("runtime-active-operation-recorder.mjs"),
        await scriptInfo("runtime-active-operation-dump.mjs"),
        await scriptInfo("runtime-active-operation-dump-stop.mjs"),
        await scriptInfo("runtime-prompt-automation-monitor.mjs", "30000"),
        await scriptInfo("runtime-battle-entry-sample.mjs", "scan"),
        await scriptInfo("runtime-rogue-handler-field-join-report.mjs"),
        await scriptInfo("runtime-rogue-current-skill-button-detail-report.mjs"),
        await scriptInfo("runtime-live-field-semantics-report.mjs")
      ],
      currentEvidence: [evidencePath(promptMonitor), ...activeEvidence, evidencePath(battleEntryScan), latest.rogueHandlerJoin?.__path || "", latest.rogueSkillDetail?.__path || "", fieldIndex?.mdPath || "", reqs.get("card-ui-movement-selection")?.evidence?.join("; ") || ""],
      observedState: `promptScene=${promptScene}; promptGameOver=${promptIsGameOver}; visiblePromptWindows=${promptSummary.visiblePromptWindows ?? promptSnapshot.visiblePromptWindows?.length ?? ""}; ${activeObservedState}; battleEntryRouteCandidates=${battleEntryRouteCandidates}; tableProofs=${battleEntryTableProofs}; handlerFieldRows=${latest.rogueHandlerJoin?.summary?.fieldRows ?? ""}; needsLiveWithHandlerEvidence=${latest.rogueHandlerJoin?.summary?.needsLiveRowsSampledByCurrentHandlers ?? ""}; currentPlayerAnchors=${rogueSkillDetail.currentPlayerAnchors ?? ""}; cardContainers=${rogueSkillDetail.cardContainers ?? ""}; selectPanels=${rogueSkillDetail.selectPanels ?? ""}; methodRows=${rogueSkillDetail.methodRows ?? ""}; eventRows=${rogueSkillDetail.eventRows ?? ""}`,
      missingProof: activeHas(/StartSelectCard/) && activeHas(/CardUI_SelectedChanged/) && activeHas(/SelectCardResult$/) && activeHas(/PlayCard_Result/)
        ? "Normal play/response card selection chain is now safely active-sampled. Dedicated discard-only and unattended auto-discard variants still need per-prompt samples before automation is enabled."
        : "Specific discard/auto-play prompt has not been safely active-sampled.",
      safeBoundary: "Only own/visible cards; hidden opponent hand arrays remain excluded."
    },
    {
      id: "hover-stage-attached-popup",
      requirementId: "hover-popup",
      target: "纯鼠标 hover 后真正挂到 stage/window 的技能/牌弹窗",
      triggerCondition: "鼠标悬浮在可见技能、牌、武将、战法等节点上，触发 stage/window child delta 或 popup method record.",
      activationSignal: "target node has tooltip/rollover handlers or toolTip fields and is effective-visible under the current scene/window layer.",
      monitorMethod: "Run hover stage-delta sample and tooltip lifecycle sample; compare before/after stage/window/tip nodes and cleanup.",
      successEvidence: "hover sample records stage/window/tip-like child delta or SkillPopUp/SkillToolTip lifecycle record, then cleanup returns the stage/window/tip count to the baseline.",
      scripts: [
        await scriptInfo("runtime-hover-stage-delta-sample.mjs"),
        await scriptInfo("runtime-hover-field-tooltip-sample.mjs"),
        await scriptInfo("runtime-tooltip-lifecycle-sample.mjs"),
        await scriptInfo("runtime-hover-handler-field-transition-sample.mjs")
      ],
      currentEvidence: [evidencePath(hoverStage), latest.hoverField?.__path || "", hoverHandler?.__path || "", latest.tooltipLifecycle?.__path || "", reqs.get("hover-popup")?.evidence?.join("; ") || ""],
      observedState: `scene=${hoverStageSummary.scene}; candidates=${hoverStageSummary.candidates}; sampled=${hoverStageSummary.sampledTargets}; cdpHoverOk=${hoverStageSummary.cdpHoverOk}; cdpHoverTimeouts=${hoverStageSummary.cdpHoverTimeouts}; directOk=${hoverStageSummary.directOk}; cdpDelta=${hoverStageSummary.cdpDeltaObserved}; directDelta=${hoverStageSummary.directDeltaObserved}; cleanupOk=${hoverStageSummary.cleanupOk}; targets=${hoverStageSummary.sampledTexts.join("/")}; hoverHandlerSamples=${hoverHandler?.value?.samples?.length ?? ""}; hoverFieldDeltas=${(hoverHandler?.value?.samples || []).filter((sample) => (sample.overFieldChanges?.length || 0) > 0 || (sample.outFieldChanges?.length || 0) > 0).length}`,
      missingProof: hoverStageSummary.sampledTargets
        ? "Current hover-handler sample proves hover state field transitions, and the expanded latest stage-delta sample covered visible hover targets but still produced no visible stage/window delta; need a non-ended card/skill hover or window-specific target that creates an actual popup node."
        : "Current hover-handler sample proves hover state field transitions, but no expanded hover stage-delta sample is available yet.",
      safeBoundary: "Mouse move only; no click/send."
    },
    {
      id: "qifu-natural-animation-free-branch",
      requirementId: "effects-qifu-blocking",
      target: "祈福自然抽取响应动画和特效屏蔽",
      triggerCondition: "进入可免费/非购买分支的 BlessNewWindow/View and a natural animation/addEffect path fires.",
      activationSignal: "visible Bless/QiFu window is in a free/non-purchase branch, or addEffect/effectStop/updateSkipAnim fires without invoking draw/buy/shop paths.",
      monitorMethod: "Use Bless effect block probe/live gap watch; block purchase/draw-like calls unless explicit permission; record addEffect/effectStop lifecycle.",
      successEvidence: "bless effect probe records natural addEffect/effectStop/updateSkipAnim lifecycle with purchase/draw/shop calls blocked or absent and visible effect nodes cleaned up.",
      scripts: [
        await scriptInfo("runtime-bless-effect-block-probe.mjs"),
        await scriptInfo("runtime-bless-open-sample.mjs"),
        await scriptInfo("runtime-live-gap-watch.mjs", "30000")
      ],
      currentEvidence: [evidencePath(blessProbe), latest.blessOpen?.__path || "", reqs.get("effects-qifu-blocking")?.evidence?.join("; ") || ""],
      observedState: `directEffectOk=${blessProbe?.directEffect?.value?.ok ?? ""}; blockedEffects=${blessProbe?.dump?.value?.status?.blockedEffects ?? ""}; visibleBlessWindows=${blessProbe?.dump?.value?.status?.visibleBlessWindows?.length ?? ""}`,
      missingProof: "Open/close and direct addEffect blocking are proven; natural draw-response variants still need a free-branch or explicit permission sample.",
      safeBoundary: "Never call bless/buy/shop/payment paths without explicit permission."
    },
    {
      id: "kanshu-free-claim-branch",
      requirementId: "kanshu",
      target: "发财树免费领取路径",
      triggerCondition: "KanShuWindow state shows free branch/reward available without payment confirmation.",
      activationSignal: "KanShuWindow jbpUserData/jbpawardVo indicates a free reward branch, enough free item, and no pay/confirm-buy state.",
      monitorMethod: "Read KanShuWindow jbpUserData/jbpawardVo and only call reward methods when free branch is proven or explicitly allowed.",
      successEvidence: "KanShu state sample proves freeBlessItemEnough/free branch, and reward methods advance the current state without gotoPay/buyPorpItem/payment confirmation.",
      scripts: [
        await scriptInfo("runtime-kanshu-state-sample.mjs")
      ],
      currentEvidence: [latest.kanshu?.__path || "", reqs.get("kanshu")?.evidence?.join("; ") || ""],
      observedState: `freeBlessItemEnough=${latest.kanshu?.state?.value?.freeBlessItemEnough ?? latest.kanshu?.summary?.freeBlessItemEnough ?? ""}; status=${latest.kanshu?.state?.value?.status ?? ""}`,
      missingProof: "Latest state branches toward payment/insufficient free item; final claim remains gated.",
      safeBoundary: "No payment confirmation or buy method without explicit permission."
    },
    {
      id: "rogue-specific-skill-auto-use",
      requirementId: "rogue-overlays-shop-auto-skill",
      target: "山河图特定技能/战法自动确认和自动使用",
      triggerCondition: "Rogue fight or battle prompt presents a specific skill/zhanfa selection that is non-purchase and safe to confirm.",
      activationSignal: "Rogue skill/zhanfa button or prompt is visible, non-purchase, and maps to a known RogueFight/ChangeSkill/SkillBiFaRogue send method.",
      monitorMethod: "Use Rogue action surface, prompt monitor, and handler-field join; record exact method chain before any unattended use.",
      successEvidence: "Rogue prompt/action monitor captures the visible skill button, selected option fields, and exact non-purchase send/confirm chain for that skill before any unattended automation is enabled.",
      scripts: [
        await scriptInfo("runtime-rogue-action-surface-inspect.mjs"),
        await scriptInfo("runtime-rogue-active-sample.mjs"),
        await scriptInfo("runtime-prompt-automation-monitor.mjs", "30000"),
        await scriptInfo("runtime-rogue-handler-field-join-report.mjs"),
        await scriptInfo("runtime-rogue-current-skill-button-detail-report.mjs")
      ],
      currentEvidence: [latest.rogueAction?.__path || "", latest.rogueActive?.__path || "", latest.rogueHandlerJoin?.__path || "", latest.rogueSkillDetail?.__path || "", reqs.get("rogue-overlays-shop-auto-skill")?.evidence?.join("; ") || ""],
      observedState: `fightConfirmOk=${latest.rogueActive?.action?.value?.ok ?? latest.rogueActive?.summary?.actionOk ?? ""}; handlerRows=${latest.rogueHandlerJoin?.summary?.handlerRows ?? ""}; skillButtons=${(rogueSkillDetail.skillButtonTexts || []).join("/")}; autoEvidence=${rogueSkillDetail.autoEvidenceRows ?? ""}; sendOrConfirm=${rogueSkillDetail.sendOrConfirmRows ?? ""}`,
      missingProof: "Fight confirm path is sampled, but individual rogue skill prompts still need per-skill active sample.",
      safeBoundary: "Purchase/shop/refresh/buy handlers remain blocked by default."
    }
  ];
  return cases.map((item) => {
    const requirement = reqs.get(item.requirementId);
    const scriptsOk = item.scripts.every((script) => script.exists);
    return {
      ...item,
      requirementStatus: requirement?.status || "",
      requirementRemaining: requirement?.remaining || "",
      scriptsOk,
      evidenceAvailable: item.currentEvidence.filter(Boolean).length,
      currentEvidence: item.currentEvidence.filter(Boolean)
    };
  });
}

function buildTsv(cases) {
  const headers = [
    "id",
    "requirementId",
    "requirementStatus",
    "target",
    "triggerCondition",
    "activationSignal",
    "monitorMethod",
    "successEvidence",
    "scriptsOk",
    "commands",
    "observedState",
    "missingProof",
    "safeBoundary",
    "currentEvidence"
  ];
  const lines = [headers.join("\t")];
  for (const item of cases) {
    lines.push(headers.map((key) => {
      if (key === "commands") return escapeTsv(item.scripts.map((script) => script.command).join(" | "));
      if (key === "currentEvidence") return escapeTsv(item.currentEvidence.join(" | "));
      return escapeTsv(item[key]);
    }).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

function buildMarkdown(payload) {
  const lines = [];
  lines.push("# Runtime Goal Remaining Audit");
  lines.push("");
  lines.push(`- Generated: ${payload.generatedAt}`);
  lines.push(`- Objective coverage: ${payload.inputs.objectiveCoverage || "(none)"}`);
  lines.push(`- Field semantic index: ${payload.inputs.fieldSemanticIndex || "(none)"}`);
  lines.push(`- Remaining cases: ${payload.cases.length}`);
  lines.push(`- Script coverage: ${payload.summary.scriptsOkCases}/${payload.cases.length} cases have all referenced scripts present.`);
  lines.push(`- Field index: rows=${payload.summary.fieldIndexRows}; unresolved=${payload.summary.unresolvedRows}; needsLive=${payload.summary.needsLiveRows}; permissionGated=${payload.summary.permissionGatedRows}.`);
  lines.push("");
  lines.push("## Residual Cases");
  lines.push("");
  lines.push("| Case | Requirement | Status | Trigger | Activation Signal | Monitor | Success Evidence | Missing Proof | Safe Boundary | Commands | Evidence |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const item of payload.cases) {
    lines.push(`| \`${markdownCell(item.id)}\` | \`${markdownCell(item.requirementId)}\` | \`${markdownCell(item.requirementStatus)}\` | ${markdownCell(item.triggerCondition)} | ${markdownCell(item.activationSignal)} | ${markdownCell(item.monitorMethod)} | ${markdownCell(item.successEvidence)} | ${markdownCell(item.missingProof)} | ${markdownCell(item.safeBoundary)} | ${markdownCell(item.scripts.map((script) => script.command).join("<br>"))} | ${markdownCell(item.currentEvidence.join("<br>") || "(none)")} |`);
  }
  lines.push("");
  lines.push("## Unresolved Field Buckets");
  lines.push("");
  for (const bucket of payload.unresolvedBuckets) {
    lines.push(`- ${bucket.name}: ${bucket.count}`);
  }
  lines.push("");
  lines.push("## Unresolved Surfaces");
  lines.push("");
  for (const bucket of payload.unresolvedSurfaces) {
    lines.push(`- ${bucket.name}: ${bucket.count}`);
  }
  lines.push("");
  lines.push("## Judgement");
  lines.push("");
  lines.push("- Monitoring methods are implemented or source-mapped for the remaining non-purchase surfaces listed here.");
  lines.push("- Completion is still not proven because several rows require a real runtime trigger that is not present in the current ended scene.");
  lines.push("- The next proof step is to run the listed watcher while the relevant real window/prompt is opened, then regenerate objective coverage.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const objective = await latestObjectiveCoverage();
  const fieldIndex = await latestFieldSemanticIndex();
  const latest = {
    liveGapWatch: await latestJsonReport("-live-gap-watch", "live-gap-watch.json"),
    eventFieldTransitionWatch: await latestJsonReport("-event-field-transition-watch", "event-field-transition-watch.json"),
    activeOperationFieldTransition: await latestJsonReport("-active-operation-field-transition-report", "active-operation-field-transition-report.json"),
    liveProofPlaybook: await latestJsonReport("-live-proof-playbook", "live-proof-playbook.json"),
    resourceReplacementProbe: await latestJsonReport("-resource-replacement-probe", "resource-replacement-probe.json"),
    resourceLoadSchemeProof: await latestJsonReport("-resource-load-scheme-proof", "resource-load-scheme-proof.json"),
    qixingWatch: await latestJsonReport("-qixing-shen-zhuge-watch", "qixing-shen-zhuge-watch.json"),
    yanjiaoWatch: await latestJsonReport("-yanjiao-list-watch", "yanjiao-list-watch.json"),
    yanjiaoCandidate: await latestJsonReport("-yanjiao-candidate-list-implementation-report", "yanjiao-candidate-list-implementation-report.json"),
    promptMonitor: await latestJsonReport("-prompt-automation-monitor", "prompt-automation-monitor.json"),
    activeOperation: await latestJsonReport("-active-operation-dump-stop", "active-operation-dump-stop.json"),
    battleEndScan: await latestJsonReport("-scan-battle-end", "battle-end-sample.json"),
    battleEntryScan: await latestJsonReport("-scan-battle-entry", "battle-entry-sample.json"),
    rogueEndedExit: await latestJsonReport("-rogue-ended-exit-report", "rogue-ended-exit-report.json"),
    roguePrompt: await latestJsonReport("-rogue-battle-prompt-inspect", "rogue-battle-prompt-inspect.json"),
    rogueHandler: await latestJsonReport("-rogue-current-action-handler-report", "rogue-current-action-handler-report.json"),
    rogueSkillDetail: await latestJsonReport("-rogue-current-skill-button-detail-report", "rogue-current-skill-button-detail-report.json"),
    rogueHandlerJoin: await latestJsonReport("-rogue-handler-field-join-report", "rogue-handler-field-join-report.json"),
    hoverStage: await latestJsonReport("-hover-stage-delta-sample", "hover-stage-delta-sample.json"),
    hoverField: await latestJsonReport("-hover-field-tooltip-sample", "hover-field-tooltip-sample.json"),
    hoverHandler: await latestJsonReport("-hover-handler-field-transition-sample", "hover-handler-field-transition-sample.json"),
    tooltipLifecycle: await latestJsonReport("-tooltip-lifecycle-sample", "tooltip-lifecycle-sample.json"),
    blessProbe: await latestJsonReport("-bless-effect-block-probe", "bless-effect-block-probe.json"),
    blessOpen: await latestJsonReport("-bless-open-sample", "bless-open-sample.json"),
    kanshu: await latestJsonReport("-kanshu-state-sample", "kanshu-state-sample.json"),
    rogueAction: await latestJsonReport("-rogue-action-surface-inspect", "rogue-action-surface-inspect.json"),
    rogueActive: await latestJsonReport("-rogue-active-sample", "rogue-active-sample.json"),
    uiStateTransition: await latestJsonReport("-ui-state-transition-sample", "ui-state-transition-sample.json"),
    uiStateDirectEvent: await latestJsonReportWhere(
      "-ui-state-transition-sample",
      "ui-state-transition-sample.json",
      (value) => value.value?.safety?.directEventAllowed === true || (value.value?.attempts || []).some((item) => item.ok === true && item.skipped !== true)
    )
  };
  const cases = await buildResidualCases({ objective, fieldIndex, latest });
  const payload = {
    generatedAt: new Date().toISOString(),
    inputs: {
      objectiveCoverage: objective?.mdPath || "",
      objectiveCoverageJson: objective?.jsonPath || "",
      fieldSemanticIndex: fieldIndex?.mdPath || "",
      unresolvedFields: fieldIndex?.unresolvedPath || ""
    },
    summary: {
      cases: cases.length,
      scriptsOkCases: cases.filter((item) => item.scriptsOk).length,
      fieldIndexRows: fieldIndex?.summary?.fieldIndexRows || 0,
      unresolvedRows: fieldIndex?.summary?.unresolvedRows || 0,
      needsLiveRows: fieldIndex?.summary?.needsLiveRows || 0,
      permissionGatedRows: fieldIndex?.summary?.permissionGatedRows || 0
    },
    unresolvedBuckets: countBy(fieldIndex?.unresolvedRows || [], "remaining"),
    unresolvedSurfaces: countBy(fieldIndex?.unresolvedRows || [], "surfaces"),
    cases
  };
  const outDir = path.resolve(
    process.env.SGS_RUNTIME_GOAL_REMAINING_AUDIT_DIR ||
      path.join(explorationRoot, `${timestampName()}-goal-remaining-audit`)
  );
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "goal-remaining-audit.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "goal-remaining-audit.tsv"), buildTsv(cases), "utf8");
  await writeFile(path.join(outDir, "goal-remaining-audit.md"), buildMarkdown(payload), "utf8");
  await writeFile(path.join(outDir, "README.md"), [
    "# Runtime Goal Remaining Audit",
    "",
    `- Markdown: ${path.join(outDir, "goal-remaining-audit.md")}`,
    `- JSON: ${path.join(outDir, "goal-remaining-audit.json")}`,
    `- TSV: ${path.join(outDir, "goal-remaining-audit.tsv")}`,
    `- Cases: ${payload.summary.cases}`,
    `- Script coverage: ${payload.summary.scriptsOkCases}/${payload.summary.cases}`,
    `- Unresolved fields: ${payload.summary.unresolvedRows}`,
    ""
  ].join("\n"), "utf8");
  console.log(JSON.stringify({
    ok: true,
    outDir,
    cases: payload.summary.cases,
    scriptsOkCases: payload.summary.scriptsOkCases,
    unresolvedRows: payload.summary.unresolvedRows,
    needsLiveRows: payload.summary.needsLiveRows,
    permissionGatedRows: payload.summary.permissionGatedRows
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
