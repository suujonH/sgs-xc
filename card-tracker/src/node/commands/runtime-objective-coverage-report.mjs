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

async function latestActiveOperationDumpStop() {
  const sample = await latestJson("-active-operation-dump-stop", "active-operation-dump-stop.json");
  if (!sample) return null;
  const records = sample.dump?.records || [];
  const labels = records.map((record) => record.label || "");
  const hasLabel = (pattern) => labels.some((label) => pattern.test(label));
  const sendOrConfirmLikeRecords = records.filter((record) =>
    /proxy\.L|Send|send|Req|Rep|Ntf|RoleOpt|Select|Card|Skill|Spell|Use|Move|Deal|Discard|Confirm|Play|Trigger|Opt/.test(record.label || "")
  );
  const promptSet = new Set();
  const selectedCards = new Set();
  const selectedSeats = new Set();
  for (const record of records) {
    for (const source of [record.sceneBefore, record.sceneAfter]) {
      for (const text of source?.promptTexts || []) if (text) promptSet.add(text);
    }
    for (const source of [record.beforeSelection, record.afterSelection]) {
      for (const id of source?.cardContainer?.selectedCardIds || []) selectedCards.add(id);
      for (const id of source?.seatContext?.selectedTargetSeatIDs || []) selectedSeats.add(id);
    }
  }
  const status = sample.dump?.status || {};
  return {
    path: sample.__path,
    dir: sample.__dir,
    mdPath: path.join(sample.__dir, "FOCUSED_CHAIN.md"),
    readmePath: path.join(sample.__dir, "README.md"),
    tsvPath: path.join(sample.__dir, "active-operation-records.tsv"),
    scene: status.scene?.scene || "",
    isGameOver: status.scene?.isGameOver,
    records: records.length,
    calls: records.filter((record) => record.kind === "call").length,
    sendOrConfirmLikeRecords: sendOrConfirmLikeRecords.length,
    sampleCount: status.sampleCount || 0,
    wrappersBeforeStop: status.wrapperCount || 0,
    wrappersAfterStop: sample.stop?.status?.wrapperCount ?? null,
    blockedCalls: status.blockedCalls || 0,
    errors: status.errors?.length || 0,
    hasShowButtonBar: hasLabel(/ShowButtonBar/),
    hasSkillConfirm: hasLabel(/SpellTouch_ConfirmResult/),
    hasStartSelectCard: hasLabel(/StartSelectCard/),
    hasCardSelectedChanged: hasLabel(/CardUI_SelectedChanged/),
    hasStartTargetSeat: hasLabel(/StartSelectTargetSeatOverload/),
    hasSelectCardResult: hasLabel(/SelectCardResult$/),
    hasPlayCardResult: hasLabel(/PlayCard_Result/),
    hasSelectCardCompleted: hasLabel(/SelectCardResultCompleted/),
    hasDiscardRequest: hasLabel(/DiscardRequest/),
    hasProxyL: hasLabel(/^proxy\.L$/),
    promptSamples: Array.from(promptSet).slice(0, 12),
    selectedCardIds: Array.from(selectedCards).slice(0, 20),
    selectedTargetSeatIds: Array.from(selectedSeats).slice(0, 20)
  };
}

function eventRecordCount(sample) {
  return Number(
    sample?.dump?.status?.recordCount ??
    sample?.dump?.value?.status?.recordCount ??
    sample?.dump?.records?.length ??
    sample?.dump?.status?.records?.length ??
    sample?.recordCount ??
    0
  );
}

async function latestEventMonitorJson() {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("-event-monitor"))
    .map((entry) => path.join(explorationRoot, entry.name))
    .sort()
    .reverse();
  let fallback = null;
  for (const dir of dirs) {
    const filePath = path.join(dir, "event-monitor.json");
    const value = await readJsonIfExists(filePath);
    if (!value) continue;
    value.__path = filePath;
    value.__dir = dir;
    fallback ||= value;
    if (eventRecordCount(value) > 1) return value;
  }
  return fallback;
}

async function latestAllNamesReport() {
  const dir = await latestDir("-all-names-report");
  if (!dir) return null;
  const classes = await readJson(path.join(dir, "all-registered-classes.json"));
  const classRoleIndex = await readJson(path.join(dir, "class-role-index.json"));
  const methodRoleIndex = await readJson(path.join(dir, "method-role-index.json"));
  const eventRows = await readJson(path.join(dir, "event-handler-index.json"));
  const fieldGlossary = await readJson(path.join(dir, "field-meaning-glossary.json"));
  return {
    dir,
    paths: {
      classes: path.join(dir, "all-registered-classes.json"),
      classesTsv: path.join(dir, "all-registered-classes.tsv"),
      classRoleIndex: path.join(dir, "class-role-index.json"),
      methodRoleIndex: path.join(dir, "method-role-index.json"),
      eventIndex: path.join(dir, "event-handler-index.json"),
      fieldGlossary: path.join(dir, "field-meaning-glossary.json")
    },
    classCount: classes.length,
    classRoleIndex,
    methodRoleIndex,
    eventRows,
    fieldGlossary,
    categories: countClassCategories(classes),
    roles: countMethodRoles(methodRoleIndex)
  };
}

async function latestOldScriptMap() {
  const dir = await latestDir("-old-script-map");
  if (!dir) return null;
  const jsonPath = path.join(dir, "old-script-behavior-map.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "old-script-behavior-map.md"),
    scripts: value.files?.length || 0,
    behaviors: value.behaviors?.length || 0,
    methods: value.methodIndex?.length || 0,
    groupSummary: value.groupSummary || {}
  };
}

async function latestYanJiaoReport() {
  const dir = await latestDir("-yanjiao-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "yanjiao-implementation-report.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "yanjiao-implementation-report.md"),
    skillMethods: value.yanJiao?.methods?.filter((method) => !method.missing).length || 0,
    windowMethods: value.windowClass?.methods?.filter((method) => !method.missing).length || 0,
    skillAuditRows: value.skillAudit?.rows?.length || 0
  };
}

async function latestYanJiaoListWatch() {
  const sample = await latestJson("-yanjiao-list-watch", "yanjiao-list-watch.json");
  if (!sample) return null;
  const status = sample.dump?.value?.status || {};
  return {
    path: sample.__path,
    dir: sample.__dir,
    scene: status.current?.scene?.sceneName || status.current?.scene?.className || "",
    classExists: status.classExists === true,
    functionName: status.functionName || "",
    wrappers: status.wrapperCount || 0,
    windows: status.current?.windows?.length || 0,
    renderRecords: status.renderRecords || 0,
    candidateClicks: status.candidateClicks || 0,
    sendRecords: status.sendRecords || 0,
    previewOnly: status.previewOnly !== false,
    errors: status.errors?.length || sample.dump?.value?.errors?.length || 0,
    restoredWrappers: sample.stop?.value?.status?.wrapperCount ?? null
  };
}

async function latestYanJiaoCandidateListImplementationReport() {
  const sample = await latestJson("-yanjiao-candidate-list-implementation-report", "yanjiao-candidate-list-implementation-report.json");
  if (!sample) return null;
  const status = sample.status || {};
  const outputs = sample.outputs || {};
  return {
    path: sample.__path,
    dir: sample.__dir,
    mdPath: path.join(sample.__dir, "README.md"),
    flowTsvPath: outputs.flowTsv || path.join(sample.__dir, "yanjiao-candidate-flow.tsv"),
    methodEvidenceTsvPath: outputs.methodEvidenceTsv || path.join(sample.__dir, "yanjiao-method-evidence.tsv"),
    fieldActionMapTsvPath: outputs.fieldActionMapTsv || path.join(sample.__dir, "yanjiao-field-action-map.tsv"),
    level: status.level || "",
    sourceProven: status.sourceProven === true,
    watcherLiveInstallable: status.watcherLiveInstallable === true,
    realWindowSample: status.realWindowSample === true,
    candidateRenderProven: status.candidateRenderProven === true,
    methodRows: sample.methodEvidence?.length || 0,
    fieldRows: sample.fieldActionMap?.length || 0,
    flowSteps: sample.flowSteps?.length || 0,
    implementationContract: sample.implementationContract || {},
    caveat: status.caveat || ""
  };
}

async function latestHoverPopupSample() {
  const sample = await latestJson("-hover-popup-sample", "hover-popup-sample.json");
  if (!sample) return null;
  const status = sample.dump?.value?.status || {};
  const liveRecordCount = (status.methodRecords || 0) + (status.mouseRecords || 0) + (status.eventRecords || 0);
  return {
    path: sample.__path,
    dir: sample.__dir,
    scene: status.scene?.sceneName || "",
    wrappers: status.wrapperCount || 0,
    listeners: status.listenerCount || 0,
    records: status.recordCount || 0,
    methodRecords: status.methodRecords || 0,
    mouseRecords: status.mouseRecords || 0,
    eventRecords: status.eventRecords || 0,
    liveRecordCount,
    installedClasses: (status.hookSummary || []).filter((item) => item.installed?.length).map((item) => item.className)
  };
}

async function latestHoverPopupProbe() {
  const sample = await latestJson("-hover-popup-probe", "hover-popup-probe.json");
  if (!sample) return null;
  const status = sample.dump?.value?.status || {};
  const popupMethodRecordCount = status.methodRecords || 0;
  const hoverEventRecordCount = status.eventRecords || 0;
  return {
    path: sample.__path,
    dir: sample.__dir,
    scene: status.scene?.sceneName || "",
    candidates: sample.candidates?.candidates?.length || 0,
    moves: sample.moves?.length || 0,
    wrappers: status.wrapperCount || 0,
    listeners: status.listenerCount || 0,
    records: status.recordCount || 0,
    methodRecords: status.methodRecords || 0,
    mouseRecords: status.mouseRecords || 0,
    eventRecords: status.eventRecords || 0,
    popupMethodRecordCount,
    hoverEventRecordCount
  };
}

async function latestHoverFieldTooltipSample() {
  const sample = await latestJson("-hover-field-tooltip-sample", "hover-field-tooltip-sample.json");
  if (!sample) return null;
  const status = sample.dump?.value?.status || {};
  const samples = sample.samples || [];
  const count = (snapshot, key) => snapshot?.[key]?.length || 0;
  const deltas = samples.map((item) => ({
    cdpDelta: count(item.afterCdpHover, "tips") - count(item.beforeCdpHover, "tips"),
    directDelta: count(item.direct?.afterMouseOver, "tips") - count(item.direct?.before, "tips"),
    finalDelta: count(item.afterCleanup, "tips") - count(item.beforeCdpHover, "tips"),
    cdpWindowDelta: count(item.afterCdpHover, "windows") - count(item.beforeCdpHover, "windows"),
    directWindowDelta: count(item.direct?.afterMouseOver, "windows") - count(item.direct?.before, "windows"),
    cdpTooltipNodeDelta: count(item.afterCdpHover, "tooltipNodes") - count(item.beforeCdpHover, "tooltipNodes"),
    directTooltipNodeDelta: count(item.direct?.afterMouseOver, "tooltipNodes") - count(item.direct?.before, "tooltipNodes"),
    cdpStageChildDelta: count(item.afterCdpHover, "stageChildren") - count(item.beforeCdpHover, "stageChildren"),
    directStageChildDelta: count(item.direct?.afterMouseOver, "stageChildren") - count(item.direct?.before, "stageChildren")
  }));
  const visibleTipDeltaObserved = deltas.some((item) =>
    item.cdpDelta > 0 ||
    item.directDelta > 0 ||
    item.cdpWindowDelta > 0 ||
    item.directWindowDelta > 0 ||
    item.cdpTooltipNodeDelta > 0 ||
    item.directTooltipNodeDelta > 0 ||
    item.cdpStageChildDelta > 0 ||
    item.directStageChildDelta > 0
  );
  const maxOf = (key) => deltas.reduce((max, item) => Math.max(max, item[key] || 0), 0);
  const compactTooltip = (value) => {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object") return [value.kind, value.name, value.ctor, value.className, value.sceneName].filter(Boolean).join(":") || JSON.stringify(value).slice(0, 80);
    return String(value);
  };
  return {
    path: sample.__path,
    dir: sample.__dir,
    scene: sample.candidates?.scene?.sceneName || sample.candidates?.scene?.className || "",
    candidates: sample.candidates?.candidates?.length || 0,
    sampledTargets: samples.length,
    visibleTipDeltaObserved,
    maxCdpDelta: maxOf("cdpDelta"),
    maxDirectDelta: maxOf("directDelta"),
    maxFinalDelta: maxOf("finalDelta"),
    maxCdpWindowDelta: maxOf("cdpWindowDelta"),
    maxDirectWindowDelta: maxOf("directWindowDelta"),
    maxCdpTooltipNodeDelta: maxOf("cdpTooltipNodeDelta"),
    maxDirectTooltipNodeDelta: maxOf("directTooltipNodeDelta"),
    maxCdpStageChildDelta: maxOf("cdpStageChildDelta"),
    maxDirectStageChildDelta: maxOf("directStageChildDelta"),
    methodRecords: status.methodRecords || 0,
    mouseRecords: status.mouseRecords || 0,
    eventRecords: status.eventRecords || 0,
    sampledTooltips: samples
      .map((item) => compactTooltip(item.target?.tooltipFields?.toolTip || item.target?.tooltipFields?.ToolTip || ""))
      .filter(Boolean)
      .slice(0, 8)
  };
}

async function latestLiveGapWatch() {
  const sample = await latestJson("-live-gap-watch", "live-gap-watch.json");
  if (!sample) return null;
  const status = sample.dump?.value?.status || {};
  const snapshots = sample.dump?.value?.snapshots || [];
  const tagMax = {};
  for (const snapshot of snapshots) {
    for (const [tag, count] of Object.entries(snapshot.countsByTag || {})) {
      tagMax[tag] = Math.max(tagMax[tag] || 0, count);
    }
  }
  const hooks = status.hookSummary || [];
  const installed = hooks.filter((item) => item.installed?.length);
  const blocked = installed.flatMap((item) =>
    (item.installed || []).filter((method) => method.block).map((method) => `${item.className}.${method.method}`)
  );
  return {
    path: sample.__path,
    dir: sample.__dir,
    scene: status.sceneState?.scene?.sceneName || status.sceneState?.scene?.className || "",
    wrappers: status.wrapperCount || 0,
    records: status.recordCount || 0,
    snapshots: snapshots.length,
    blockedCalls: status.blockedCalls || 0,
    tagMax,
    installedClasses: installed.map((item) => item.className),
    blocked
  };
}

async function latestEventFieldTransitionWatch() {
  const sample = await latestJson("-event-field-transition-watch", "event-field-transition-watch.json");
  if (!sample) return null;
  const status = sample.dump?.value?.status || {};
  const records = sample.dump?.value?.records || [];
  const snapshots = sample.dump?.value?.snapshots || [];
  const changedRecords = records.filter((record) => (record.fieldDiffCount || 0) > 0 || (record.contextDiffCount || 0) > 0);
  const labels = {};
  for (const record of records) labels[record.label || "(none)"] = (labels[record.label || "(none)"] || 0) + 1;
  return {
    path: sample.__path,
    dir: sample.__dir,
    mdPath: path.join(sample.__dir, "README.md"),
    recordsTsvPath: path.join(sample.__dir, "event-field-transition-records.tsv"),
    scene: status.current?.scene || "",
    wrappers: status.wrapperCount || 0,
    records: records.length,
    changedRecords: changedRecords.length,
    snapshots: snapshots.length,
    blockedCalls: status.blockedCalls || 0,
    errors: status.errors?.length || 0,
    topLabels: Object.entries(labels)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([label, count]) => `${label}:${count}`)
  };
}

async function latestCurrentWindowActionReport() {
  const sample = await latestJson("-current-window-action-report", "current-window-action-report.json");
  if (!sample) return null;
  const counts = sample.counts || {};
  return {
    path: sample.__path,
    dir: sample.__dir,
    scene: sample.currentScene?.sceneName || sample.currentScene?.className || "",
    managerCtor: sample.manager?.ctor || "",
    seatCount: sample.manager?.seatCount ?? "",
    selfSeatIndex: sample.manager?.selfSeatIndex ?? "",
    isGameOver: sample.manager?.isGameOver === true,
    windows: counts.windows || 0,
    visibleWindows: counts.visibleWindows || 0,
    buttonCandidates: counts.buttonCandidates || 0,
    purchaseRiskButtons: counts.purchaseRiskButtons || 0,
    closeBackButtons: counts.closeBackButtons || 0,
    confirmActionButtons: counts.confirmActionButtons || 0,
    tooltipHoverButtons: counts.tooltipHoverButtons || 0,
    tagCounts: counts.tagCounts || {},
    windowLabels: (sample.windows || []).filter((node) => node.effectiveVisible).map((node) => node.label).slice(0, 12),
    purchaseRiskPaths: (sample.buttonCandidates || [])
      .filter((node) => node.tags?.includes("purchase-risk"))
      .map((node) => node.path)
      .slice(0, 12)
  };
}

async function latestUiStateTransitionSample(options = {}) {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("-ui-state-transition-sample"))
    .map((entry) => path.join(explorationRoot, entry.name))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const sample = await readJsonIfExists(path.join(dir, "ui-state-transition-sample.json"));
    if (!sample) continue;
    const value = sample.value || {};
    const attempts = value.attempts || [];
    const directEventLike = value.safety?.directEventAllowed === true || attempts.some((item) => item.ok === true && item.skipped !== true);
    if (options.directEventAllowed && !directEventLike) continue;
    return {
      path: path.join(dir, "ui-state-transition-sample.json"),
      dir,
      mdPath: path.join(dir, "README.md"),
      attempts: attempts.length,
      clicked: attempts.filter((item) => item.ok).length,
      skipped: attempts.filter((item) => item.skipped).length,
      directEventAllowed: directEventLike,
      selectTabAllowed: value.safety?.selectTabAllowed === true,
      proxyLBlockedCalls: value.safety?.proxyLBlockedCalls || 0,
      sceneSwitchBlockedCalls: value.safety?.sceneSwitchBlockedCalls || 0,
      finalSelected: (value.finalSnapshot?.rightTabs || [])
        .filter((item) => item.fields?._selected === true || item.fields?.selected === true)
        .map((item) => item.text),
      selectedChanged: attempts.some((item) => (item.beforeSelected || []).join(",") !== (item.afterSelected || []).join(",")),
      targets: attempts.map((item) => item.targetText).filter(Boolean),
      methodGated: attempts.filter((item) => /SelectTab.*gated/.test(item.methodError || item.reason || "")).length,
      eventErrors: attempts.filter((item) => item.eventError).length
    };
  }
  return null;
}

async function latestRogueEndedExitReport() {
  const sample = await latestJson("-rogue-ended-exit-report", "rogue-ended-exit-report.json");
  if (!sample) return null;
  const summary = sample.summary || {};
  return {
    path: sample.__path,
    dir: sample.__dir,
    scene: summary.scene || sample.currentScene?.sceneName || sample.currentScene?.className || "",
    managerCtor: summary.manager || sample.manager?.ctor || "",
    isGameOver: summary.isGameOver === true,
    visibleWindows: summary.visibleWindows || 0,
    buttonCandidates: summary.buttonCandidates || 0,
    methodCount: summary.methodCount || 0,
    purchaseRiskMethods: summary.purchaseRiskMethods || [],
    confirmGatedMethods: summary.confirmGatedMethods || [],
    sceneSwitchMethods: summary.sceneSwitchMethods || [],
    sendOrLeaveMethods: summary.sendOrLeaveMethods || []
  };
}

async function latestHoverStageDeltaSample() {
  const sample = await latestJson("-hover-stage-delta-sample", "hover-stage-delta-sample.json");
  if (!sample) return null;
  const samples = sample.samples || [];
  const positive = (d) =>
    (d?.stageChildDelta || 0) > 0 ||
    (d?.windowLayerChildDelta || 0) > 0 ||
    (d?.windowChildrenDelta || 0) > 0 ||
    (d?.tipLikeDelta || 0) > 0 ||
    (d?.newWindowChildren?.length || 0) > 0 ||
    (d?.newTipLike?.length || 0) > 0;
  return {
    path: sample.__path,
    dir: sample.__dir,
    mdPath: path.join(sample.__dir, "README.md"),
    scene: sample.candidates?.scene?.sceneName || sample.candidates?.scene?.className || "",
    candidates: sample.candidates?.candidates?.length || 0,
    sampledTargets: samples.length,
    cdpDeltaObserved: samples.some((item) => positive(item.cdpDelta)),
    directDeltaObserved: samples.some((item) => positive(item.directDelta)),
    cdpHoverOk: samples.filter((item) => item.dispatch?.hover?.ok === true).length,
    cdpHoverTimeouts: samples.filter((item) => item.dispatch?.hover?.ok === false).length,
    directOk: samples.filter((item) => item.direct?.ok === true && item.direct?.mouseOver?.ok === true).length,
    maxTipLikeDelta: samples.reduce((max, item) => Math.max(max, item.cdpDelta?.tipLikeDelta || 0), 0),
    maxWindowLayerChildDelta: samples.reduce((max, item) => Math.max(max, item.cdpDelta?.windowLayerChildDelta || 0), 0),
    cleanupOk: sample.cleanup?.ok === true,
    sampledTexts: samples.map((item) => item.target?.text || item.target?.label || "").filter(Boolean).slice(0, 12)
  };
}

async function latestHoverHandlerFieldTransitionSample() {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("-hover-handler-field-transition-sample"))
    .map((entry) => path.join(explorationRoot, entry.name))
    .sort()
    .reverse();
  const reports = [];
  for (const dir of dirs.slice(0, 12)) {
    const filePath = path.join(dir, "hover-handler-field-transition-sample.json");
    const value = await readJsonIfExists(filePath);
    if (!value) continue;
    value.__path = filePath;
    value.__dir = dir;
    reports.push(value);
  }
  if (!reports.length) return null;
  const samples = reports.flatMap((report) => (report.value?.samples || []).map((sample) => ({ report, sample })));
  const hasFieldDelta = ({ sample }) => (sample.overFieldChanges?.length || 0) > 0 || (sample.outFieldChanges?.length || 0) > 0;
  const hasVisibleDelta = ({ sample }) =>
    (sample.overDelta?.tipDelta || 0) > 0 ||
    (sample.overDelta?.windowLayerChildDelta || 0) > 0 ||
    (sample.overDelta?.stageChildDelta || 0) > 0 ||
    (sample.overDelta?.newTips?.length || 0) > 0 ||
    (sample.overDelta?.newWindows?.length || 0) > 0;
  return {
    path: reports[0].__path,
    dir: reports[0].__dir,
    mdPath: path.join(reports[0].__dir, "README.md"),
    paths: reports.map((report) => report.__path).slice(0, 8),
    runCount: reports.length,
    scene: reports[0].value?.runtime?.scene?.label || "",
    candidates: reports[0].value?.candidates?.length || 0,
    sampledTargets: samples.length,
    fieldDeltaTargets: samples.filter(hasFieldDelta).length,
    visibleDeltaTargets: samples.filter(hasVisibleDelta).length,
    proxyLBlockedCalls: reports.reduce((sum, report) => sum + (report.value?.safety?.proxyLBlockedCalls?.length || 0), 0),
    sampleOffsets: reports.map((report) => report.value?.selection?.sampleOffset ?? 0),
    changedKeys: Array.from(new Set(samples.flatMap(({ sample }) => [
      ...(sample.overFieldChanges || []).map((change) => change.key),
      ...(sample.outFieldChanges || []).map((change) => change.key)
    ]))).slice(0, 20),
    targetTexts: samples.map(({ sample }) => sample.target?.text || sample.target?.label || "").filter(Boolean).slice(0, 20)
  };
}

async function latestTooltipLifecycleSample() {
  const sample = await latestJson("-tooltip-lifecycle-sample", "tooltip-lifecycle-sample.json");
  if (!sample) return null;
  const value = sample.lifecycle?.value || {};
  const status = sample.dump?.value?.status || {};
  return {
    path: sample.__path,
    dir: sample.__dir,
    scene: value.before?.scene?.sceneName || value.before?.scene?.className || "",
    targetPath: value.target?.path || "",
    targetLabel: value.target?.label || "",
    mouseOverOk: value.mouseOver?.ok === true,
    mouseOutOk: value.mouseOut?.ok === true,
    callOk: value.call?.ok === true,
    returnedLabel: value.returned?.label || value.returned?.ctor || "",
    cleanupOk: (value.cleanup || []).some((item) => item.ok),
    tipsBefore: value.before?.tips?.length || 0,
    tipsAfterMouseOver: value.afterMouseOver?.tips?.length || 0,
    tipsAfterMouseOut: value.afterMouseOut?.tips?.length || 0,
    tipsAfterDirectCreate: value.afterDirectCreate?.tips?.length || 0,
    tipsAfterCleanup: value.afterCleanup?.tips?.length || 0,
    methodRecords: status.methodRecords || 0,
    eventRecords: status.eventRecords || 0
  };
}

async function latestRogueTooltipInspect() {
  const sample = await latestJson("-rogue-tooltip-inspect", "rogue-tooltip-inspect.json");
  if (!sample) return null;
  const value = sample.value || {};
  const nodes = value.nodes || [];
  const tooltipNodes = nodes.filter((node) => {
    const fields = node.fields || {};
    return fields.toolTip || fields.ToolTip || fields.GeneralToolTip || fields.generalToolTip;
  });
  const activeTooltipNodes = tooltipNodes.filter((node) => node.effectiveVisible);
  const classSources = value.classSources || {};
  return {
    path: sample.__path,
    dir: sample.__dir,
    scene: value.scene?.sceneName || value.scene?.className || "",
    inspectedNodes: nodes.length,
    tooltipNodes: tooltipNodes.length,
    activeTooltipNodes: activeTooltipNodes.length,
    rogueFightMethods: Object.values(classSources.RogueFightWindow?.methods || {}).filter(Boolean).length,
    changeSkillMethods: Object.values(classSources.ChangeSKillWindow?.methods || {}).filter(Boolean).length,
    rogue1v1ChangeSkillMethods: Object.values(classSources.Rogue1v1ChangeSkillWindow?.methods || {}).filter(Boolean).length
  };
}

async function latestRogueActionSurfaceInspect() {
  const sample = await latestJson("-rogue-action-surface-inspect", "rogue-action-surface-inspect.json");
  if (!sample) return null;
  const value = sample.value || {};
  const fight = value.fightWindows?.[0]?.specific || {};
  const classSources = value.classSources || {};
  return {
    path: sample.__path,
    dir: sample.__dir,
    scene: value.sceneData?.scene?.sceneName || value.sceneData?.scene?.className || "",
    windows: value.windowNodes?.length || 0,
    fightWindows: value.fightWindows?.length || 0,
    fightId: fight.fightId ?? null,
    bottomSkillButtons: value.bottomSkillButtons?.length || 0,
    zhanfaButtons: value.zhanfaButtons?.length || 0,
    startBtnEvents: Object.keys(fight.startBtn?.events || {}),
    pveMgrHasEventSelectReq: !!value.sceneData?.pveMgr?.methodSources?.RogueLikeEventSelectReq,
    rogueFightHasStartSource: !!classSources.RogueFightWindow?.methods?.startbtnClick,
    changeSkillHasSendSource: !!classSources.ChangeSKillWindow?.methods?.onChange
  };
}

async function latestRogueActiveSample() {
  const sample = await latestJson("-rogue-active-sample", "rogue-active-sample.json");
  if (!sample) return null;
  const action = sample.action?.action || {};
  const records = sample.dump?.value?.records || [];
  const pveReq = records.find((record) => record.name === "PveMgr.RogueLikeEventSelectReq");
  const proxySend = records.find((record) => record.name === "proxy.L");
  const fullMask = records.find((record) => record.name === "SHOW_FULL_MASK_LOADING");
  return {
    path: sample.__path,
    dir: sample.__dir,
    actionOk: action.ok === true,
    called: action.called || "",
    beforeScene: sample.action?.before?.scene?.sceneName || sample.action?.before?.scene?.className || "",
    afterScene: sample.after?.value?.scene?.sceneName || sample.after?.value?.scene?.className || "",
    fightId: sample.action?.before?.fightWindow?.fightId ?? action.target?.fightId ?? null,
    eventId: pveReq?.args?.[0]?.values?.eventId ?? null,
    eventType: pveReq?.args?.[0]?.values?.eventType ?? null,
    protocolId: typeof proxySend?.args?.[0] === "number" ? proxySend.args[0] : null,
    fullMaskMs: fullMask?.args?.[0] ?? null,
    recordCount: records.length,
    purchaseBlockedCalls: sample.guardStop?.blockedCalls?.length || 0,
    tableGame: !!sample.after?.value?.tableGame
  };
}

async function latestRogueFlowSample(suffix) {
  const sample = await latestJson(suffix, "rogue-sample.json");
  if (!sample) return null;
  const action = sample.action?.action || {};
  const target = action.target || {};
  const records = sample.dump?.value?.records || [];
  const switchRecord = records.find((record) => record.name === "SceneManager.SwitchScene");
  const closeRecord = records.find((record) => record.name === "WindowManager.CloseWindow" || record.name === "GED.CloseWindow");
  const proxyProtocols = records
    .filter((record) => record.name === "proxy.L")
    .map((record) => record.args?.[0])
    .filter((value) => value !== undefined);
  return {
    path: sample.__path,
    dir: sample.__dir,
    actionName: action.actionName || sample.actionName || "",
    actionOk: action.ok === true,
    called: action.called || "",
    content: target.content || "",
    buttonLabels: (target.buttons || []).map((button) => `${button.label}${button.isCancel ? "(cancel)" : ""}`),
    okCallbackSource: (target.buttons || []).find((button) => !button.isCancel)?.callBackSource || "",
    seasonId: target.seasonId ?? null,
    diffId: target.diffId ?? null,
    selectedGeneralId: target.selectedCard?.generalId ?? null,
    selectedCardId: target.selectedCard?.cardId ?? null,
    switchScene: switchRecord?.args?.[0] || "",
    closeWindow: closeRecord?.args?.[0] || "",
    proxyProtocols,
    recordCount: records.length
  };
}

async function latestRogueGameSceneInspect() {
  const sample = await latestJson("-rogue-game-scene-inspect", "rogue-game-scene-inspection.json");
  if (!sample) return null;
  const value = sample.value || {};
  const scene = value.runtime?.scene || {};
  const managers = value.managers || [];
  const manager = managers.find((item) => item.name === "manager") || managers[0] || {};
  const selfSeatIndex = Number(manager.selfSeatIndex);
  const selfSeat = (manager.seats || []).find((seat) => seat.index === selfSeatIndex) || (manager.seats || []).find((seat) => seat.isSelf) || {};
  const classSources = value.classSources || {};
  const methodCount = (className) => Object.values(classSources[className]?.methods || {}).filter(Boolean).length;
  return {
    path: sample.__path,
    dir: sample.__dir,
    scene: scene.sceneName || scene.className || "",
    effectiveVisible: scene.effectiveVisible === true,
    isRogueLikeGameScene: scene.isRogueLikeGameScene === true,
    managerCtor: manager.ctor || "",
    seatCount: manager.seatCount ?? null,
    selfSeatIndex: Number.isFinite(selfSeatIndex) ? selfSeatIndex : null,
    gameRoundStarted: manager.fields?.gameRoundStarted === true,
    gameStartPlay: manager.fields?.gameStartPlay === true,
    gameTurn: manager.fields?.gameTurn ?? null,
    isGameOver: manager.fields?.isGameOver === true,
    roleSpellInterfaces: manager.fields?.roleSpellRespManager?.values?.interfaces?.length ?? null,
    moveFromFuncs: manager.fields?.movecardManager?.values?.fromFuncs?.length ?? null,
    moveToFuncs: manager.fields?.movecardManager?.values?.toFuncs?.length ?? null,
    selfGeneralName: selfSeat.fields?.general?.cardName || "",
    selfGeneralId: selfSeat.fields?.general?.cardId ?? null,
    selfHandCount: selfSeat.fields?.handCardCount ?? null,
    selfCanViewHandCard: selfSeat.fields?.canViewHandCard === true,
    interestingNodes: value.interestingNodes?.length || 0,
    buttonNodes: value.buttonNodes?.length || 0,
    cardNodes: value.cardNodes?.length || 0,
    selectNodes: value.selectNodes?.length || 0,
    windowNodes: value.windowNodes?.length || 0,
    proxyEvents: value.proxyEvents?.length || 0,
    rogueLikeGameSceneMethods: methodCount("RogueLikeGameScene"),
    tableGameSceneMethods: methodCount("TableGameScene"),
    selectCardWindowMethods: methodCount("SelectCardWindow"),
    skillSelectorWindowMethods: methodCount("SkillSelectorWindow"),
    skillBiFaRogueWindowMethods: methodCount("SkillBiFaRogueWindow")
  };
}

async function latestRogueSkillZhanfaProbe() {
  const sample = await latestJson("-rogue-skill-zhanfa-probe", "rogue-skill-zhanfa-probe.json");
  if (!sample) return null;
  const value = sample.value || {};
  const buttons = value.buttons || {};
  const buttonCount = Array.isArray(buttons)
    ? buttons.length
    : Object.values(buttons).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  const classSources = value.classSources || {};
  const methodCount = (className) => Object.values(classSources[className]?.methods || {}).filter(Boolean).length;
  return {
    path: sample.__path,
    dir: sample.__dir,
    scene: value.scene?.sceneName || value.scene?.className || "",
    buttonCount,
    rogueSmallMapMethods: methodCount("RogueSmallMapScene"),
    rogueFightMethods: methodCount("RogueFightWindow"),
    changeSkillMethods: methodCount("ChangeSKillWindow"),
    rogue1v1ChangeSkillMethods: methodCount("Rogue1v1ChangeSkillWindow"),
    changeZhanFaMethods: methodCount("ChangeZhanFalWindow"),
    deleteZhanFaMethods: methodCount("DeleteZhanFaWindow"),
    skillBiFaRogueMethods: methodCount("SkillBiFaRogueWindow")
  };
}

async function latestRogueBattleActionSurface() {
  const sample = await latestJson("-rogue-battle-action-surface", "rogue-battle-action-surface.json");
  if (!sample) return null;
  const value = sample.value || {};
  const surfaces = value.surfaces || {};
  const classSources = value.classSources || {};
  const methodCount = (className) => Object.values(classSources[className]?.methods || {}).filter(Boolean).length;
  const visibleWindows = surfaces.visibleWindows || [];
  return {
    path: sample.__path,
    dir: sample.__dir,
    scene: value.runtime?.scene?.sceneName || value.runtime?.scene?.className || "",
    managerCtor: value.runtime?.manager?.ctor || "",
    seatCount: value.runtime?.manager?.seatCount ?? null,
    selfSeatIndex: value.runtime?.manager?.selfSeatIndex ?? null,
    isGameOver: value.runtime?.manager?.fields?.isGameOver === true,
    gameRoundStarted: value.runtime?.manager?.fields?.gameRoundStarted === true,
    gameStartPlay: value.runtime?.manager?.fields?.gameStartPlay === true,
    selfHandCards: value.runtime?.selfSeat?.handCardsCount ?? null,
    currentPlayerAreas: surfaces.currentPlayerAreas?.length || 0,
    skillPanels: surfaces.skillPanels?.length || 0,
    handAreas: surfaces.handAreas?.length || 0,
    stackAreas: surfaces.stackAreas?.length || 0,
    visibleWindows: visibleWindows.length,
    hasGameResultWindow: visibleWindows.some((node) => /GameResultWindow/.test(`${node.label || ""} ${node.path || ""}`)),
    cardUiNodes: surfaces.cardUiNodes?.length || 0,
    buttonNodes: surfaces.buttonNodes?.length || 0,
    promptNodes: surfaces.promptNodes?.length || 0,
    actionNodes: surfaces.actionNodes?.length || 0,
    managerMethodSources: Object.values(value.runtime?.manager?.methodSources || {}).filter(Boolean).length,
    proxyEvents: value.proxyEvents?.length || 0,
    registeredActionNames: value.registeredNamesFromActionNodes || [],
    selectCardWindowMethods: methodCount("SelectCardWindow"),
    skillSelectorWindowMethods: methodCount("SkillSelectorWindow"),
    skillBiFaWindowMethods: methodCount("SkillBiFaWindow"),
    skillBiFaRogueWindowMethods: methodCount("SkillBiFaRogueWindow"),
    spellMultiSelectorWindowMethods: methodCount("SpellMultiSelectorWindow")
  };
}

async function latestRogueBattlePromptInspect() {
  const sample = await latestJson("-rogue-battle-prompt-inspect", "rogue-battle-prompt-inspect.json");
  if (!sample) return null;
  const value = sample.value || {};
  const selected = value.selected || {};
  const runtime = value.runtime || {};
  const classSources = value.classSources || {};
  const methodCount = (className) => Object.values(classSources[className]?.methods || {}).filter(Boolean).length;
  const selfHand = runtime.selfSeat?.handCards || [];
  return {
    path: sample.__path,
    dir: sample.__dir,
    scene: runtime.scene?.sceneName || runtime.scene?.className || "",
    managerCtor: runtime.manager?.ctor || "",
    seatCount: runtime.manager?.seatCount ?? null,
    selfSeatIndex: runtime.manager?.selfSeatIndex ?? null,
    currentRoundSeatID: runtime.manager?.fields?.currentRoundSeatID ?? null,
    gameRound: runtime.manager?.fields?.gameRound ?? null,
    gameTurn: runtime.manager?.fields?.gameTurn ?? null,
    isGameOver: runtime.manager?.fields?.isGameOver === true,
    gameRoundStarted: runtime.manager?.fields?.gameRoundStarted === true,
    gameStartPlay: runtime.manager?.fields?.gameStartPlay === true,
    selfRoundState: runtime.selfSeat?.fields?.roundState ?? null,
    selfShaCount: runtime.selfSeat?.fields?.shaCount ?? null,
    selfShaMaxCount: runtime.selfSeat?.fields?.shaMaxCount ?? null,
    selfHandCards: runtime.selfSeat?.handCardsCount ?? null,
    selfHandNames: selfHand.map((card) => card.fields?.cardName || card.fields?._className_ || "").filter(Boolean).slice(0, 16),
    currentPlayerAreas: selected.currentPlayerAreas?.length || 0,
    handAreas: selected.handAreas?.length || 0,
    selectAreas: selected.selectAreas?.length || 0,
    stackAreas: selected.stackAreas?.length || 0,
    visibleWindows: selected.visibleWindows?.length || 0,
    visibleButtons: selected.visibleButtons?.length || 0,
    skillNodes: selected.skillNodes?.length || 0,
    selfHandCardUis: selected.selfHandCardUis?.length || 0,
    promptCandidates: selected.promptCandidates?.length || 0,
    selectCardWindowMethods: methodCount("SelectCardWindow"),
    skillSelectorWindowMethods: methodCount("SkillSelectorWindow"),
    skillBiFaWindowMethods: methodCount("SkillBiFaWindow"),
    skillBiFaRogueWindowMethods: methodCount("SkillBiFaRogueWindow"),
    spellMultiSelectorWindowMethods: methodCount("SpellMultiSelectorWindow"),
    militaryOrdersSelectWindowMethods: methodCount("MilitaryOrdersSelectWindow"),
    militaryOrdersExecutionWindowMethods: methodCount("MilitaryOrdersExecutionWindow")
  };
}

async function latestRogueCurrentActionHandlerReport() {
  const sample = await latestJson("-rogue-current-action-handler-report", "rogue-current-action-handler-report.json");
  if (!sample) return null;
  const summary = sample.summary || {};
  return {
    path: sample.__path,
    dir: sample.__dir,
    mdPath: path.join(sample.__dir, "README.md"),
    nodesTsvPath: path.join(sample.__dir, "action-nodes.tsv"),
    handlersTsvPath: path.join(sample.__dir, "event-handlers.tsv"),
    scene: summary.scene || sample.currentScene?.sceneName || sample.currentScene?.className || "",
    managerCtor: summary.managerCtor || sample.manager?.ctor || "",
    isGameOver: summary.isGameOver === true,
    nodeCount: summary.nodeCount || sample.nodes?.length || 0,
    eventNodeCount: summary.eventNodeCount || 0,
    eventHandlerCount: summary.eventHandlerCount || 0,
    purchaseRiskHandlers: summary.purchaseRiskHandlers || 0,
    sendOrConfirmHandlers: summary.sendOrConfirmHandlers || 0,
    actionNodeTypeCounts: summary.actionNodeTypeCounts || {},
    tagCounts: summary.tagCounts || {},
    topTexts: (summary.topTexts || []).slice(0, 12)
  };
}

async function latestRogueCurrentSkillButtonDetailReport() {
  const sample = await latestJson("-rogue-current-skill-button-detail-report", "rogue-current-skill-button-detail-report.json");
  if (!sample) return null;
  const summary = sample.summary || {};
  return {
    path: sample.__path,
    dir: sample.__dir,
    mdPath: path.join(sample.__dir, "README.md"),
    focusNodesTsvPath: path.join(sample.__dir, "focus-nodes.tsv"),
    methodEvidenceTsvPath: path.join(sample.__dir, "method-evidence.tsv"),
    eventHandlerEvidenceTsvPath: path.join(sample.__dir, "event-handler-evidence.tsv"),
    scene: summary.scene || sample.currentScene?.sceneName || sample.currentScene?.className || "",
    managerCtor: summary.managerCtor || sample.manager?.ctor || "",
    isGameOver: summary.isGameOver === true,
    nodeCount: summary.nodeCount || sample.nodes?.length || 0,
    skillButtonCount: summary.skillButtonCount || 0,
    skillButtonTexts: summary.skillButtonTexts || [],
    currentPlayerAnchors: summary.currentPlayerAnchors || 0,
    cardContainers: summary.cardContainers || 0,
    selectPanels: summary.selectPanels || 0,
    methodRows: summary.methodRows || 0,
    eventRows: summary.eventRows || 0,
    autoEvidenceRows: summary.autoEvidenceRows || 0,
    sendOrConfirmRows: summary.sendOrConfirmRows || 0,
    debugLogRows: summary.debugLogRows || 0,
    purchaseRiskRows: summary.purchaseRiskRows || 0,
    tagCount: summary.tagCount || {}
  };
}

async function latestRogueHandlerFieldJoinReport() {
  const sample = await latestJson("-rogue-handler-field-join-report", "rogue-handler-field-join-report.json");
  if (!sample) return null;
  const summary = sample.summary || {};
  return {
    path: sample.__path,
    dir: sample.__dir,
    mdPath: path.join(sample.__dir, "README.md"),
    fieldJoinTsvPath: sample.outputs?.fieldJoinTsv || path.join(sample.__dir, "event-field-join.tsv"),
    handlerSurfaceTsvPath: sample.outputs?.handlerSurfaceTsv || path.join(sample.__dir, "handler-surface.tsv"),
    needsLiveStrengthenedTsvPath: sample.outputs?.needsLiveStrengthenedTsv || path.join(sample.__dir, "needs-live-strengthened.tsv"),
    scene: sample.runtime?.scene || "",
    managerCtor: sample.runtime?.managerCtor || "",
    isGameOver: sample.runtime?.isGameOver === true,
    actionNodes: summary.actionNodes || 0,
    eventNodes: summary.eventNodes || 0,
    handlerRows: summary.handlerRows || 0,
    fieldRows: summary.fieldRows || 0,
    semanticMatchedFields: summary.semanticMatchedFields || 0,
    triageMatchedFields: summary.triageMatchedFields || 0,
    needsLiveRowsSampledByCurrentHandlers: summary.needsLiveRowsSampledByCurrentHandlers || 0,
    evidenceLevels: summary.evidenceLevels || {},
    handlerTags: summary.handlerTags || {},
    topOwnersWithNeedsLiveHandlerEvidence: (summary.topOwnersWithNeedsLiveHandlerEvidence || []).slice(0, 8).map((item) => `${item.key}:${item.count}`)
  };
}

async function latestResourceReplacementProbe() {
  const sample = await latestJson("-resource-replacement-probe", "resource-replacement-probe.json");
  if (!sample) return null;
  const value = sample.value || {};
  return {
    path: sample.__path,
    dir: sample.__dir,
    resourceVersion: value.api?.runtime?.resourceVersion || "",
    layaVersion: value.api?.runtime?.layaVersion || "",
    sampleTextures: value.sampleTextures?.length || 0,
    drawOk: value.drawProbe?.ok === true,
    drawTextureUrl: value.drawProbe?.usedTextureUrl || "",
    customFormatType: value.api?.urlApi?.customFormatType || "",
    addVersionPrefix: !!value.api?.resourceVersionApi?.addVersionPrefixSource,
    manifestSize: value.api?.resourceVersionApi?.manifestSize ?? null,
    formatURLResult: value.hookProbe?.formatURLResult || "",
    customFormatCalls: value.hookProbe?.customFormatCalls?.length || 0,
    addVersionPrefixCalls: value.hookProbe?.addVersionPrefixCalls?.length || 0
  };
}

async function latestResourceLoadSchemeProof() {
  const sample = await latestJson("-resource-load-scheme-proof", "resource-load-scheme-proof.json");
  if (!sample) return null;
  const value = sample.value || {};
  const results = value.results || [];
  const byLabel = Object.fromEntries(results.map((item) => [item.label, item.status || ""]));
  const ok = (label) => results.some((item) => item.label === label && item.ok === true);
  return {
    path: sample.__path,
    dir: sample.__dir,
    resourceVersion: value.runtime?.resourceVersion || "",
    layaVersion: value.runtime?.layaVersion || "",
    fixturePath: sample.fixture?.path || "",
    results: byLabel,
    allLoaded: results.length > 0 && results.every((item) => item.ok === true),
    fileUrlOk: ok("file-url"),
    localHttpOk: ok("local-http"),
    sameOriginHttpsOk: ok("same-origin-https"),
    dataUrlOk: ok("data-url")
  };
}

async function latestBlessOpenSample() {
  const sample = await latestJson("-bless-open-sample", "bless-open-sample.json");
  if (!sample) return null;
  const status = sample.dump?.value?.status || {};
  const scene = sample.dump?.value?.status?.scene || sample.scene || {};
  return {
    path: sample.__path,
    dir: sample.__dir,
    windowName: sample.windowName || sample.open?.value?.windowName || "",
    scene: scene.sceneName || scene.className || "",
    openOk: sample.open?.value?.ok === true,
    openCalled: sample.open?.value?.called || "",
    closeOk: sample.close?.value?.ok === true,
    closeCalled: sample.close?.value?.called || "",
    openedBySample: sample.open?.value?.openedBySample === true,
    wrappers: status.wrapperCount || 0,
    records: status.recordCount || 0,
    blockedCalls: status.blockedCalls || 0,
    blockedEffects: status.blockedEffects || 0,
    visibleBlessWindows: status.visibleBlessWindows?.length || 0,
    errors: status.errors?.length || 0
  };
}

async function latestBlessEffectBlockProbe() {
  const sample = await latestJson("-bless-effect-block-probe", "bless-effect-block-probe.json");
  if (!sample) return null;
  const status = sample.dump?.value?.status || {};
  return {
    path: sample.__path,
    dir: sample.__dir,
    windowName: sample.windowName || "",
    openedByProbe: sample.open?.value?.openedBySample === true,
    directEffectOk: sample.directEffect?.value?.ok === true,
    directEffectTarget: sample.directEffect?.value?.target?.label || "",
    blockedDelta: sample.directEffect?.value?.blockedDelta || 0,
    blockedEffects: status.blockedEffects || 0,
    blockedCalls: status.blockedCalls || 0,
    visibleBlessWindows: status.visibleBlessWindows?.length || 0,
    wrapperCount: status.wrapperCount || 0,
    records: sample.dump?.value?.records?.length || 0,
    errors: sample.dump?.value?.errors?.length || 0
  };
}

async function latestQixingWatch() {
  const sample = await latestJson("-qixing-shen-zhuge-watch", "qixing-shen-zhuge-watch.json");
  if (!sample) return null;
  const status = sample.dump?.value?.status || {};
  const snapshots = sample.dump?.value?.snapshots || [];
  const maxCounts = {};
  for (const snapshot of snapshots) {
    for (const [key, value] of Object.entries(snapshot.counts || {})) {
      maxCounts[key] = Math.max(maxCounts[key] || 0, Number(value || 0));
    }
  }
  const availability = status.classAvailability || {};
  const installedClasses = (status.hookSummary || []).filter((item) => item.installed?.length).length;
  return {
    path: sample.__path,
    dir: sample.__dir,
    scene: status.scene?.sceneName || status.scene?.className || "",
    wrappers: status.wrapperCount || 0,
    records: status.recordCount || 0,
    snapshots: status.snapshotCount || snapshots.length,
    blockedSends: status.blockedSends || 0,
    installedClasses,
    qixingExists: availability.QiXing?.exists === true,
    qixingWindowExists: availability.QiXingWindow?.exists === true,
    qixingWindowMethods: availability.QiXingWindow?.methods?.length || 0,
    guanXingWindowExists: availability.GuanXingWindow?.exists === true,
    guanXingWindowMethods: availability.GuanXingWindow?.methods?.length || 0,
    targetWindows: maxCounts.targetWindows || 0,
    visibleTargetWindows: maxCounts.visibleTargetWindows || 0,
    visibleWindowCards: maxCounts.visibleWindowCards || 0,
    battleScenes: maxCounts.battleScenes || 0,
    publicGeneralCards: maxCounts.publicGeneralCards || 0,
    errors: status.errors?.length || 0
  };
}

async function latestClassFieldAudit() {
  const dir = await latestDir("-class-field-audit");
  if (!dir) return null;
  const jsonPath = path.join(dir, "class-field-audit.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "class-field-audit.md"),
    tsvPath: path.join(dir, "class-field-audit.tsv"),
    unknownWorklistPath: path.join(dir, "unknown-field-worklist.tsv"),
    classCount: value.summary?.classCount || 0,
    fieldSlots: value.summary?.fieldSlots || 0,
    statusCounts: value.summary?.statusCounts || {},
    metrics: value.summary?.metrics || {}
  };
}

async function latestFieldContextReport() {
  const dir = await latestDir("-field-context-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "field-context-report.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "field-context-report.md"),
    fieldsTsvPath: path.join(dir, "field-context-fields.tsv"),
    methodsTsvPath: path.join(dir, "field-context-methods.tsv"),
    summary: value.summary || {}
  };
}

async function latestAllSourceContextReport() {
  const dir = await latestDir("-all-source-context");
  if (!dir) return null;
  const mdPath = path.join(dir, "all-source-summary.md");
  let markdown = "";
  try {
    markdown = await readFile(mdPath, "utf8");
  } catch {
    return null;
  }
  const numberAfter = (label) => {
    const match = markdown.match(new RegExp(`- ${label}: (\\d+)`));
    return match ? Number(match[1]) : 0;
  };
  const chunksDir = path.join(dir, "source-chunks");
  let chunkCount = 0;
  try {
    chunkCount = (await readdir(chunksDir)).filter((name) => name.endsWith(".json")).length;
  } catch {
    chunkCount = 0;
  }
  return {
    dir,
    mdPath,
    indexPath: path.join(dir, "all-source-index.json"),
    classTsvPath: path.join(dir, "all-source-class-index.tsv"),
    methodTsvPath: path.join(dir, "all-source-method-context.tsv"),
    fieldTsvPath: path.join(dir, "all-source-field-context.tsv"),
    eventTsvPath: path.join(dir, "all-source-event-bindings.tsv"),
    chunksDir,
    chunkCount,
    capturedClasses: numberAfter("Captured classes"),
    missingClasses: numberAfter("Missing live classes"),
    methodContexts: numberAfter("Method contexts"),
    sourceChars: numberAfter("Source chars"),
    fieldRows: numberAfter("Field rows"),
    sourceFieldRows: numberAfter("Source field rows"),
    eventBindings: numberAfter("Event bindings")
  };
}

async function latestTriggerMonitoringReport() {
  const dir = await latestDir("-trigger-monitoring-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "trigger-monitoring-report.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "trigger-monitoring-report.md"),
    indexPath: path.join(dir, "trigger-monitoring-index.tsv"),
    classSummaryPath: path.join(dir, "trigger-class-summary.tsv"),
    playbookPath: path.join(dir, "trigger-monitoring-playbook.tsv"),
    summary: value.summary || {},
    surfaces: value.summary?.surfaces || {}
  };
}

async function latestSemanticInheritanceReport() {
  const dir = await latestDir("-semantic-inheritance-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "semantic-inheritance-report.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "semantic-inheritance-report.md"),
    classInheritanceTsv: path.join(dir, "class-inheritance.tsv"),
    enumValuesTsv: path.join(dir, "enum-values.tsv"),
    fieldOwnerTsv: path.join(dir, "field-owner-context.tsv"),
    summary: value.summary || {}
  };
}

async function latestLiveObjectStateAudit() {
  const dir = await latestDir("-live-object-state-audit");
  if (!dir) return null;
  const jsonPath = path.join(dir, "live-object-state-audit.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "live-object-state-audit.md"),
    fieldSamplesTsv: path.join(dir, "live-object-field-samples.tsv"),
    scene: value.runtime?.currentScene?.label || "",
    classMapSize: value.runtime?.classMapSize || 0,
    visitedNodeCount: value.runtime?.visitedNodeCount || 0,
    sampleCount: value.sampleStats?.samples || 0,
    fieldRows: value.sampleStats?.fieldRows || 0,
    fieldCategoryCounts: value.sampleStats?.fieldCategoryCounts || {},
    groups: value.sampleStats?.groups || {},
    managerCtor: value.runtime?.manager?.ctor || "",
    managerFieldCount: value.runtime?.manager?.fieldCount || 0,
    isGameOver: value.runtime?.manager?.fields?.some?.((field) => field.field === "isGameOver" && field.value === true) === true,
    selfSeatIndex: value.runtime?.seats?.selfSeatIndex ?? "",
    selfHandCards: value.runtime?.seats?.selfSeat?.handCardsCount ?? ""
  };
}

async function latestLiveFieldSourceJoinReport() {
  const dir = await latestDir("-live-field-source-join");
  if (!dir) return null;
  const jsonPath = path.join(dir, "live-field-source-join.json");
  const value = await readJsonIfExists(jsonPath);
  const summary = value?.summary;
  if (!summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "live-field-source-summary.md"),
    tsvPath: path.join(dir, "live-field-source-join.tsv"),
    scene: summary.scene || "",
    liveRows: summary.liveRows || 0,
    sourceRows: summary.sourceRows || 0,
    semanticRows: summary.semanticRows || 0,
    triggerRows: summary.triggerRows || 0,
    joinedRows: summary.joinedRows || 0,
    exactMatches: summary.exactMatches || 0,
    sourceMatchedRows: summary.sourceMatchedRows || 0,
    semanticMatchedRows: summary.semanticMatchedRows || 0,
    purchaseRiskRows: summary.purchaseRiskRows || 0,
    matchLevels: summary.matchLevels || {},
    confidences: summary.confidences || {},
    surfaces: summary.surfaces || {}
  };
}

async function latestClassUtilsInspect() {
  const dir = await latestDir("-classutils-inspect");
  if (!dir) return null;
  const jsonPath = path.join(dir, "classutils-inspect.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    entriesTsvPath: path.join(dir, "classutils-entries.tsv"),
    aliasGroupsTsvPath: path.join(dir, "classutils-alias-groups.tsv"),
    classUtilsKeys: value.classUtilsKeys?.length || 0,
    classMapCount: value.summary.classMapCount || 0,
    functionEntryCount: value.summary.functionEntryCount || 0,
    aliasGroupCount: value.summary.aliasGroupCount || 0,
    aliasEntryCount: value.summary.aliasEntryCount || 0,
    entriesWithPrototypeMethods: value.summary.entriesWithPrototypeMethods || 0,
    entriesWithStaticFields: value.summary.entriesWithStaticFields || 0,
    categoryCounts: value.summary.categoryCounts || {},
    layaVersion: value.layaVersion || ""
  };
}

async function latestLiveFieldGapReport() {
  const dir = await latestDir("-live-field-gap-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "live-field-gap-report.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    worklistTsvPath: path.join(dir, "unresolved-field-worklist.tsv"),
    ownerSummaryTsvPath: path.join(dir, "owner-gap-summary.tsv"),
    surfaceSummaryTsvPath: path.join(dir, "surface-gap-summary.tsv"),
    sourceJoinPath: value.sourceJoinPath || "",
    scene: value.summary.scene || "",
    totalRows: value.summary.totalRows || 0,
    rawWeakRows: value.summary.rawWeakRows || 0,
    weakRows: value.summary.weakRows || 0,
    purchaseRiskRows: value.summary.purchaseRiskRows || 0,
    riskCounts: value.summary.riskCounts || {},
    topSurfaces: (value.surfaceSummary || []).slice(0, 8).map((item) => `${item.surface}:${item.weakRows}`),
    topOwners: (value.ownerSummary || []).slice(0, 8).map((item) => `${item.ownerPath}:${item.totalWeakRows}`)
  };
}

async function latestLiveFieldGapTriageReport() {
  const dir = await latestDir("-live-field-gap-triage-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "live-field-gap-triage-report.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    triageTsvPath: path.join(dir, "field-gap-triage.tsv"),
    bucketSummaryTsvPath: path.join(dir, "bucket-summary.tsv"),
    scene: value.summary.scene || "",
    inputWeakRows: value.summary.inputWeakRows || 0,
    explainedRows: value.summary.explainedRows || 0,
    needsLiveRows: value.summary.needsLiveRows || 0,
    permissionGatedRows: value.summary.permissionGatedRows || 0,
    bucketCounts: value.summary.bucketCounts || {},
    topNeedsLiveBuckets: Object.entries(value.summary.topNeedsLiveBuckets || {})
      .slice(0, 8)
      .map(([bucket, count]) => `${bucket}:${count}`),
    topNeedsLiveOwners: (value.summary.topNeedsLiveOwners || [])
      .slice(0, 8)
      .map((item) => `${item.owner}:${item.count}`)
  };
}

async function latestLiveOwnerSourceReport() {
  const dir = await latestDir("-live-owner-source-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "live-owner-source-report.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.targets) return null;
  const matchCounts = {};
  let targetsWithFieldRefs = 0;
  let fieldRefMethods = 0;
  for (const target of value.targets || []) {
    const match = target.match || "(none)";
    matchCounts[match] = (matchCounts[match] || 0) + 1;
    const methods = (target.methods || []).filter((method) => method.referencedFields?.length);
    if (methods.length) targetsWithFieldRefs += 1;
    fieldRefMethods += methods.length;
  }
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    targetsTsvPath: path.join(dir, "live-owner-targets.tsv"),
    fieldMethodRefsTsvPath: path.join(dir, "live-owner-field-method-refs.tsv"),
    sourceGapPath: value.sourceGapPath || "",
    scene: value.runtime?.scene?.label || value.runtime?.scene?.sceneName || "",
    resourceVersion: value.runtime?.resourceVersion || "",
    targetCount: value.targetCount || value.targets.length,
    matchCounts,
    exactPath: matchCounts["exact-path"] || 0,
    targetsWithFieldRefs,
    fieldRefMethods
  };
}

async function latestLiveFieldSemanticsReport() {
  const dir = await latestDir("-live-field-semantics-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "live-field-semantics-report.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    tsvPath: path.join(dir, "live-field-semantics.tsv"),
    methodEvidenceTsvPath: path.join(dir, "field-method-evidence.tsv"),
    scene: value.summary.scene || "",
    fieldRows: value.summary.fieldRows || 0,
    owners: value.summary.owners || 0,
    uniqueFields: value.summary.uniqueFields || 0,
    highConfidenceRows: value.summary.highConfidenceRows || 0,
    fieldsWithMethodRefs: value.summary.fieldsWithMethodRefs || 0,
    fieldsWithJoinedMeaning: value.summary.fieldsWithJoinedMeaning || 0,
    purchaseRiskRows: value.summary.purchaseRiskRows || 0,
    topSurfaces: (value.summary.topSurfaces || []).slice(0, 8).map((item) => `${item.surface}:${item.count}`),
    confidenceCounts: value.summary.confidenceCounts || {}
  };
}

async function latestFieldSemanticIndexReport() {
  const dir = await latestDir("-field-semantic-index-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "field-semantic-index-report.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  const evidenceCounts = Object.entries(value.summary.fieldEvidenceCounts || {})
    .slice(0, 8)
    .map(([key, count]) => `${key}:${count}`);
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    fieldIndexTsvPath: path.join(dir, "field-semantic-index.tsv"),
    classCoverageTsvPath: path.join(dir, "class-field-coverage.tsv"),
    unresolvedTsvPath: path.join(dir, "unresolved-field-priority.tsv"),
    fieldIndexRows: value.summary.fieldIndexRows || 0,
    classSummaryRows: value.summary.classSummaryRows || 0,
    semanticOwnerRows: value.summary.semanticOwnerRows || 0,
    triggerFieldRefs: value.summary.triggerFieldRefs || 0,
    liveMappedRows: value.summary.liveMappedRows || 0,
    handlerMappedRows: value.summary.handlerMappedRows || 0,
    triageMappedRows: value.summary.triageMappedRows || 0,
    unresolvedRows: value.summary.unresolvedRows || 0,
    needsLiveRows: value.summary.needsLiveRows || 0,
    permissionGatedRows: value.summary.permissionGatedRows || 0,
    purchaseRiskRows: value.summary.purchaseRiskRows || 0,
    evidenceCounts,
    topSurfaces: (value.summary.topSurfaces || []).slice(0, 8).map((item) => `${item.key}:${item.count}`)
  };
}

async function latestActiveOperationFieldTransitionReport() {
  const dir = await latestDir("-active-operation-field-transition-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "active-operation-field-transition-report.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    evidenceTsvPath: path.join(dir, "active-operation-field-evidence.tsv"),
    coveredTsvPath: path.join(dir, "covered-unresolved-fields.tsv"),
    uncoveredTsvPath: path.join(dir, "uncovered-unresolved-fields.tsv"),
    recordsScanned: value.summary.recordsScanned || 0,
    unresolvedRows: value.summary.unresolvedRows || 0,
    evidenceRows: value.summary.evidenceRows || 0,
    coveredUnresolvedRows: value.summary.coveredUnresolvedRows || 0,
    uncoveredUnresolvedRows: value.summary.uncoveredUnresolvedRows || 0,
    coveredByStrength: value.summary.coveredByStrength || {},
    evidenceTypes: value.summary.evidenceTypes || {},
    topCoveredOwners: Object.entries(value.summary.coveredOwners || {}).slice(0, 8).map(([owner, count]) => `${owner}:${count}`)
  };
}

async function latestResidualFieldSourceReport() {
  const dir = await latestDir("-residual-field-source-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "residual-field-source-report.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    tsvPath: path.join(dir, "residual-field-source.tsv"),
    bucketTsvPath: path.join(dir, "remaining-buckets.tsv"),
    uncoveredRows: value.summary.uncoveredRows || 0,
    rowsWithEvidence: value.summary.rowsWithEvidence || 0,
    rowsMissingEvidence: value.summary.rowsMissingEvidence || 0,
    evidenceGrades: Object.entries(value.summary.evidenceGrades || {})
      .slice(0, 8)
      .map(([grade, count]) => `${grade}:${count}`),
    topOwners: Object.entries(value.summary.ownerCounts || {})
      .slice(0, 8)
      .map(([owner, count]) => `${owner}:${count}`)
  };
}

async function latestEntryEvidenceCatalogReport() {
  const dir = await latestDir("-entry-evidence-catalog-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "entry-evidence-catalog.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    entrySummaryTsvPath: path.join(dir, "entry-summary.tsv"),
    fieldEvidenceTsvPath: path.join(dir, "entry-field-evidence.tsv"),
    triggerEvidenceTsvPath: path.join(dir, "entry-trigger-evidence.tsv"),
    residualEvidenceTsvPath: path.join(dir, "entry-residual-evidence.tsv"),
    unmatchedEvidenceTsvPath: path.join(dir, "unmatched-evidence.tsv"),
    catalogEntries: value.summary.catalogEntries || 0,
    registeredEntries: value.summary.registeredEntries || 0,
    syntheticRuntimeOwnerEntries: value.summary.syntheticRuntimeOwnerEntries || 0,
    aliasGroups: value.summary.aliasGroups || 0,
    fieldSemanticRows: value.summary.fieldSemanticRows || 0,
    matchedFieldRows: value.summary.matchedFieldRows || 0,
    unmatchedFieldRows: value.summary.unmatchedFieldRows || 0,
    triggerMonitoringRows: value.summary.triggerMonitoringRows || 0,
    matchedTriggerRows: value.summary.matchedTriggerRows || 0,
    unmatchedTriggerRows: value.summary.unmatchedTriggerRows || 0,
    residualFieldRows: value.summary.residualFieldRows || 0,
    matchedResidualRows: value.summary.matchedResidualRows || 0,
    unmatchedResidualRows: value.summary.unmatchedResidualRows || 0,
    entriesWithFieldSemantics: value.summary.entriesWithFieldSemantics || 0,
    entriesWithTriggerMonitoring: value.summary.entriesWithTriggerMonitoring || 0,
    entriesWithResidualFields: value.summary.entriesWithResidualFields || 0,
    needsLiveFieldRows: value.summary.needsLiveFieldRows || 0,
    permissionGatedFieldRows: value.summary.permissionGatedFieldRows || 0,
    purchaseRiskTriggerRows: value.summary.purchaseRiskTriggerRows || 0,
    purchaseRiskFieldRows: value.summary.purchaseRiskFieldRows || 0,
    topSurfaces: (value.summary.topSurfaces || []).slice(0, 8).map((item) => `${item.key}:${item.count}`)
  };
}

async function latestMechanismImplementationAtlasReport() {
  const dir = await latestDir("-mechanism-implementation-atlas-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "mechanism-implementation-atlas.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    summaryTsvPath: path.join(dir, "mechanism-surface-summary.tsv"),
    triggerMethodsTsvPath: path.join(dir, "mechanism-trigger-methods.tsv"),
    fieldMeaningsTsvPath: path.join(dir, "mechanism-field-meanings.tsv"),
    oldScriptLinksTsvPath: path.join(dir, "mechanism-old-script-links.tsv"),
    mechanisms: value.summary.mechanisms || 0,
    entryRows: value.summary.entryRows || 0,
    triggerEvidenceRows: value.summary.triggerEvidenceRows || 0,
    fieldEvidenceRows: value.summary.fieldEvidenceRows || 0,
    residualEvidenceRows: value.summary.residualEvidenceRows || 0,
    mappedTriggerRows: value.summary.mappedTriggerRows || 0,
    mappedFieldRows: value.summary.mappedFieldRows || 0,
    oldScriptRows: value.summary.oldScriptRows || 0,
    purchaseRiskRows: value.summary.purchaseRiskRows || 0,
    needsLiveRows: value.summary.needsLiveRows || 0,
    permissionGatedRows: value.summary.permissionGatedRows || 0,
    unresolvedRows: value.summary.unresolvedRows || 0,
    requirementStatuses: value.summary.requirementStatuses || ""
  };
}

async function latestGoalCompletionAuditReport() {
  const dir = await latestDir("-goal-completion-audit");
  if (!dir) return null;
  const jsonPath = path.join(dir, "goal-completion-audit.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    auditTsvPath: path.join(dir, "goal-completion-audit.tsv"),
    blockersTsvPath: path.join(dir, "completion-blockers.tsv"),
    remainingLiveProofTsvPath: path.join(dir, "remaining-live-proof.tsv"),
    goalComplete: value.summary.goalComplete === true,
    requirements: value.summary.requirements || 0,
    provedRows: value.summary.provedRows || 0,
    sourceScopeRows: value.summary.sourceScopeRows || 0,
    incompleteRows: value.summary.incompleteRows || 0,
    blockerRows: value.summary.blockerRows || 0,
    coverageStatusCounts: value.summary.coverageStatusCounts || "",
    remainingLiveProofRows: value.summary.remainingLiveProofRows || 0,
    blockerVerdicts: value.summary.blockerVerdicts || "",
    blockerProofLevels: value.summary.blockerProofLevels || ""
  };
}

async function latestBlockerCapturePlanReport() {
  const dir = await latestDir("-blocker-capture-plan-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "blocker-capture-plan.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    sessionsTsvPath: path.join(dir, "blocker-capture-sessions.tsv"),
    commandsTsvPath: path.join(dir, "blocker-capture-commands.tsv"),
    blockerSessions: value.summary.blockerSessions || 0,
    commandRows: value.summary.commandRows || 0,
    missingScripts: value.summary.missingScripts || 0,
    manualTriggerSessions: value.summary.manualTriggerSessions || 0,
    purchaseSensitiveCommands: value.summary.purchaseSensitiveCommands || 0,
    inputGoalComplete: value.summary.inputGoalComplete === true,
    inputBlockerRows: value.summary.inputBlockerRows || 0
  };
}

async function latestBlockerCaptureRunnerReport() {
  const dir = await latestDir("-blocker-capture-session-run");
  if (!dir) return null;
  const jsonPath = path.join(dir, "blocker-capture-session-run.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    commandsTsvPath: path.join(dir, "blocker-capture-session-run-commands.tsv"),
    phase: value.options?.phase || "",
    dryRun: value.options?.dryRun === true,
    detach: value.options?.detach === true,
    armFast: value.options?.armFast === true,
    commands: value.summary.commands || 0,
    executed: value.summary.executed || 0,
    ok: value.summary.ok || 0,
    failed: value.summary.failed || 0,
    timedOut: value.summary.timedOut || 0,
    detached: value.summary.detached || 0,
    missingScripts: value.summary.missingScripts || 0,
    purchaseSensitive: value.summary.purchaseSensitive || 0,
    parallel: value.summary.parallel === true,
    statusCounts: value.summary.statusCounts || {}
  };
}

async function latestBlockerCaptureReadinessReport() {
  const dir = await latestDir("-blocker-capture-readiness-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "blocker-capture-readiness-report.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    watchersTsvPath: path.join(dir, "blocker-capture-readiness-watchers.tsv"),
    scenesTsvPath: path.join(dir, "blocker-capture-readiness-scenes.tsv"),
    attempts: value.summary.attempts || 0,
    cdpAvailable: value.summary.cdpAvailable === true,
    battlePreArmReady: value.summary.battlePreArmReady === true,
    watchers: value.summary.watchers || 0,
    readyWatchers: value.summary.readyWatchers || 0,
    requiredWatchers: value.summary.requiredWatchers || 0,
    missingRequired: value.summary.missingRequired || [],
    scenes: value.summary.scenes || 0,
    stagePresent: value.summary.stagePresent === true
  };
}

async function latestBlockerCaptureArmVerifyReport() {
  const dir = await latestDir("-blocker-capture-arm-verify-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "blocker-capture-arm-verify-report.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    stepsTsvPath: path.join(dir, "blocker-capture-arm-verify-steps.tsv"),
    ready: value.summary.ready === true,
    runnerStatus: value.summary.runnerStatus || "",
    readinessStatus: value.summary.readinessStatus || "",
    cdpAvailable: value.summary.cdpAvailable === true,
    battlePreArmReady: value.summary.battlePreArmReady === true,
    readyWatchers: value.summary.readyWatchers || 0,
    watchers: value.summary.watchers || 0,
    missingRequired: value.summary.missingRequired || [],
    stagePresent: value.summary.stagePresent === true,
    scenes: value.summary.scenes || 0,
    runnerOutDir: value.summary.runnerOutDir || "",
    readinessOutDir: value.summary.readinessOutDir || "",
    runnerCommands: value.summary.runnerCommands || 0,
    runnerExecuted: value.summary.runnerExecuted || 0,
    runnerDetached: value.summary.runnerDetached || 0,
    runnerMissingScripts: value.summary.runnerMissingScripts || 0,
    runnerFailed: value.summary.runnerFailed || 0,
    runnerTimedOut: value.summary.runnerTimedOut || 0,
    dryRun: value.options?.dryRun === true,
    detach: value.options?.detach === true,
    armFast: value.options?.armFast === true,
    readinessWaitMs: value.options?.readinessWaitMs || 0
  };
}

async function latestGoalRemainingAuditReport() {
  const dir = await latestDir("-goal-remaining-audit");
  if (!dir) return null;
  const jsonPath = path.join(dir, "goal-remaining-audit.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "goal-remaining-audit.md"),
    tsvPath: path.join(dir, "goal-remaining-audit.tsv"),
    cases: value.summary.cases || 0,
    scriptsOkCases: value.summary.scriptsOkCases || 0,
    fieldIndexRows: value.summary.fieldIndexRows || 0,
    unresolvedRows: value.summary.unresolvedRows || 0,
    needsLiveRows: value.summary.needsLiveRows || 0,
    permissionGatedRows: value.summary.permissionGatedRows || 0,
    unresolvedBuckets: (value.unresolvedBuckets || []).slice(0, 6).map((item) => `${item.name}:${item.count}`),
    unresolvedSurfaces: (value.unresolvedSurfaces || []).slice(0, 8).map((item) => `${item.name}:${item.count}`)
  };
}

async function latestLiveProofPlaybookReport() {
  const dir = await latestDir("-live-proof-playbook");
  if (!dir) return null;
  const jsonPath = path.join(dir, "live-proof-playbook.json");
  const value = await readJsonIfExists(jsonPath);
  if (!value?.summary) return null;
  return {
    dir,
    jsonPath,
    mdPath: path.join(dir, "README.md"),
    playbookTsvPath: path.join(dir, "live-proof-playbook.tsv"),
    caseSummaryTsvPath: path.join(dir, "live-proof-case-summary.tsv"),
    playbookRows: value.summary.playbookRows || 0,
    unresolvedRows: value.summary.unresolvedRows || 0,
    caseCount: value.summary.caseCount || 0,
    needsLiveRows: value.summary.needsLiveRows || 0,
    permissionGatedRows: value.summary.permissionGatedRows || 0,
    purchaseRiskRows: value.summary.purchaseRiskRows || 0,
    topCases: (value.caseSummary || []).slice(0, 8).map((item) => `${item.caseId}:${item.rowCount}`)
  };
}

async function latestMechanismReport() {
  const dir = await latestDir("-mechanism-findings");
  if (!dir) return null;
  return {
    dir,
    mdPath: path.join(dir, "mechanism-findings.md"),
    auditPath: path.join(dir, "goal-coverage-audit.md"),
    selectedMethodEvidence: path.join(dir, "selected-method-evidence.json")
  };
}

function countClassCategories(classes) {
  const out = {};
  for (const item of classes) {
    for (const category of item.categories || []) out[category] = (out[category] || 0) + 1;
  }
  return out;
}

function countMethodRoles(methodRoleIndex) {
  const out = {};
  for (const [role, rows] of Object.entries(methodRoleIndex || {})) {
    const classes = new Set((rows || []).map((row) => row.className));
    out[role] = { classes: classes.size, methods: rows?.length || 0 };
  }
  return out;
}

function eventCounts(eventRows) {
  return {
    ged: new Set((eventRows || []).filter((row) => row.kind === "GED").map((row) => row.eventName)).size,
    proxy: new Set((eventRows || []).filter((row) => row.kind === "proxy").map((row) => row.eventName)).size
  };
}

function surfaceHookSummary(surfaceMonitor) {
  const status = surfaceMonitor?.dump?.value?.status || {};
  const hooks = status.hookSummary || [];
  const installed = hooks.filter((item) => item.installed?.length);
  const blocked = installed.flatMap((item) =>
    (item.installed || []).filter((method) => method.block).map((method) => `${item.className}.${method.method}`)
  );
  return {
    path: surfaceMonitor?.__path || "",
    scene: status.scene?.sceneName || "",
    hookClasses: status.hookClasses || 0,
    wrappers: status.wrapperCount || 0,
    records: status.recordCount || 0,
    installedClasses: installed.map((item) => item.className),
    blocked
  };
}

function samplePath(sample) {
  return sample?.__path || "";
}

function evidenceList(items) {
  return items.filter(Boolean);
}

function buildRequirements(context) {
  const allNamesEvents = context.allNames ? eventCounts(context.allNames.eventRows) : { ged: 0, proxy: 0 };
  const hooks = context.surfaceHooks;
  const oldGroups = context.oldScriptMap?.groupSummary || {};
  const triggerSummary = context.triggerMonitoring?.summary || {};
  const triggerOverview = context.triggerMonitoring
    ? `Trigger matrix: ${triggerSummary.triggerRows || 0} trigger rows across ${triggerSummary.triggerClasses || 0} classes; scanned ${triggerSummary.methodRowsScanned || 0} method rows; purchase-risk rows=${triggerSummary.purchaseRiskRows || 0}.`
    : "Trigger matrix: no trigger-monitoring report found.";
  const semanticSummary = context.semanticInheritance?.summary || {};
  const semanticOverview = context.semanticInheritance
    ? `Semantic inheritance: ${semanticSummary.exactEnumValues || 0} exact enum/static values, ${semanticSummary.inheritedMethodRefs || 0} inherited method refs, ${semanticSummary.fieldOwnerRows || 0} field-owner rows, ${semanticSummary.unknownPrivateFieldRows || 0} unknown-private field rows.`
    : "Semantic inheritance: no report found.";
  const liveStateOverview = context.liveObjectState
    ? `Live object state: scene=${context.liveObjectState.scene || ""}; samples=${context.liveObjectState.sampleCount || 0}; fieldRows=${context.liveObjectState.fieldRows || 0}; groups=${Object.entries(context.liveObjectState.groups || {}).map(([group, count]) => `${group}:${count}`).join(",") || "(none)"}; manager=${context.liveObjectState.managerCtor || ""}; isGameOver=${context.liveObjectState.isGameOver ? "true" : "false"}; selfHandCards=${context.liveObjectState.selfHandCards}.`
    : "Live object state audit not captured.";
  const liveJoinOverview = context.liveFieldSourceJoin
    ? `Live field/source join: scene=${context.liveFieldSourceJoin.scene || ""}; liveRows=${context.liveFieldSourceJoin.liveRows}; sourceMatched=${context.liveFieldSourceJoin.sourceMatchedRows}; semanticMatched=${context.liveFieldSourceJoin.semanticMatchedRows}; owner+field=${context.liveFieldSourceJoin.exactMatches}; purchaseRiskRows=${context.liveFieldSourceJoin.purchaseRiskRows}.`
    : "Live field/source join not captured.";
  const classUtilsOverview = context.classUtilsInspect
    ? `ClassUtils live inspect: Laya=${context.classUtilsInspect.layaVersion || ""}; keys=${context.classUtilsInspect.classUtilsKeys}; classMap=${context.classUtilsInspect.classMapCount}; functionEntries=${context.classUtilsInspect.functionEntryCount}; aliasGroups=${context.classUtilsInspect.aliasGroupCount}; aliasEntries=${context.classUtilsInspect.aliasEntryCount}; prototypeMethodEntries=${context.classUtilsInspect.entriesWithPrototypeMethods}; staticFieldEntries=${context.classUtilsInspect.entriesWithStaticFields}.`
    : "ClassUtils live inspect not captured.";
  const liveFieldGapOverview = context.liveFieldGapReport
    ? `Live field gap worklist: scene=${context.liveFieldGapReport.scene || ""}; rawWeak=${context.liveFieldGapReport.rawWeakRows}; dedupedWeak=${context.liveFieldGapReport.weakRows}; purchaseRiskWeak=${context.liveFieldGapReport.purchaseRiskRows}; topSurfaces=${context.liveFieldGapReport.topSurfaces.join(",") || "(none)"}.`
    : "Live field gap worklist not captured.";
  const liveFieldGapTriageOverview = context.liveFieldGapTriageReport
    ? `Live field gap triage: inputWeak=${context.liveFieldGapTriageReport.inputWeakRows}; explainedOrGeneric=${context.liveFieldGapTriageReport.explainedRows}; needsLive=${context.liveFieldGapTriageReport.needsLiveRows}; permissionGated=${context.liveFieldGapTriageReport.permissionGatedRows}; needsLiveBuckets=${context.liveFieldGapTriageReport.topNeedsLiveBuckets.join(",") || "(none)"}.`
    : "Live field gap triage not captured.";
  const liveOwnerSourceOverview = context.liveOwnerSourceReport
    ? `Live owner source refs: scene=${context.liveOwnerSourceReport.scene || ""}; targets=${context.liveOwnerSourceReport.targetCount}; exactPath=${context.liveOwnerSourceReport.exactPath}; fieldRefTargets=${context.liveOwnerSourceReport.targetsWithFieldRefs}; fieldRefMethods=${context.liveOwnerSourceReport.fieldRefMethods}; matches=${Object.entries(context.liveOwnerSourceReport.matchCounts || {}).map(([match, count]) => `${match}:${count}`).join(",") || "(none)"}.`
    : "Live owner source refs not captured.";
  const liveFieldSemanticsOverview = context.liveFieldSemanticsReport
    ? `Live field semantics: scene=${context.liveFieldSemanticsReport.scene || ""}; owners=${context.liveFieldSemanticsReport.owners}; fieldRows=${context.liveFieldSemanticsReport.fieldRows}; uniqueFields=${context.liveFieldSemanticsReport.uniqueFields}; high=${context.liveFieldSemanticsReport.highConfidenceRows}; methodRefs=${context.liveFieldSemanticsReport.fieldsWithMethodRefs}; joined=${context.liveFieldSemanticsReport.fieldsWithJoinedMeaning}; topSurfaces=${context.liveFieldSemanticsReport.topSurfaces.join(",") || "(none)"}.`
    : "Live field semantics not captured.";
  const fieldSemanticIndexOverview = context.fieldSemanticIndexReport
    ? `Field semantic index: rows=${context.fieldSemanticIndexReport.fieldIndexRows}; classes=${context.fieldSemanticIndexReport.classSummaryRows}; sourceOwners=${context.fieldSemanticIndexReport.semanticOwnerRows}; triggerRefs=${context.fieldSemanticIndexReport.triggerFieldRefs}; liveMapped=${context.fieldSemanticIndexReport.liveMappedRows}; handlerMapped=${context.fieldSemanticIndexReport.handlerMappedRows}; triageMapped=${context.fieldSemanticIndexReport.triageMappedRows}; unresolved=${context.fieldSemanticIndexReport.unresolvedRows}; needsLive=${context.fieldSemanticIndexReport.needsLiveRows}; permissionGated=${context.fieldSemanticIndexReport.permissionGatedRows}; evidence=${context.fieldSemanticIndexReport.evidenceCounts.join(",") || "(none)"}.`
    : "Field semantic index not captured.";
  const activeOperationFieldTransitionOverview = context.activeOperationFieldTransitionReport
    ? `Active-operation field join: records=${context.activeOperationFieldTransitionReport.recordsScanned}; evidenceRows=${context.activeOperationFieldTransitionReport.evidenceRows}; coveredUnresolved=${context.activeOperationFieldTransitionReport.coveredUnresolvedRows}; exact=${context.activeOperationFieldTransitionReport.coveredByStrength.exact || 0}; uncovered=${context.activeOperationFieldTransitionReport.uncoveredUnresolvedRows}; topOwners=${context.activeOperationFieldTransitionReport.topCoveredOwners.join(",") || "(none)"}.`
    : "Active-operation field join not generated.";
  const residualFieldSourceOverview = context.residualFieldSourceReport
    ? `Residual field source join: uncovered=${context.residualFieldSourceReport.uncoveredRows}; rowsWithEvidence=${context.residualFieldSourceReport.rowsWithEvidence}; missingOwnerFieldEvidence=${context.residualFieldSourceReport.rowsMissingEvidence}; grades=${context.residualFieldSourceReport.evidenceGrades.join(",") || "(none)"}; topOwners=${context.residualFieldSourceReport.topOwners.join(",") || "(none)"}.`
    : "Residual field source join not generated.";
  const entryEvidenceCatalogOverview = context.entryEvidenceCatalogReport
    ? `Entry evidence catalog: catalogEntries=${context.entryEvidenceCatalogReport.catalogEntries}; registered=${context.entryEvidenceCatalogReport.registeredEntries}; syntheticRuntimeOwners=${context.entryEvidenceCatalogReport.syntheticRuntimeOwnerEntries}; aliasGroups=${context.entryEvidenceCatalogReport.aliasGroups}; fields=${context.entryEvidenceCatalogReport.matchedFieldRows}/${context.entryEvidenceCatalogReport.fieldSemanticRows}; triggers=${context.entryEvidenceCatalogReport.matchedTriggerRows}/${context.entryEvidenceCatalogReport.triggerMonitoringRows}; residual=${context.entryEvidenceCatalogReport.matchedResidualRows}/${context.entryEvidenceCatalogReport.residualFieldRows}; unmatched=${context.entryEvidenceCatalogReport.unmatchedFieldRows + context.entryEvidenceCatalogReport.unmatchedTriggerRows + context.entryEvidenceCatalogReport.unmatchedResidualRows}; topSurfaces=${context.entryEvidenceCatalogReport.topSurfaces.join(",") || "(none)"}.`
    : "Entry evidence catalog not generated.";
  const mechanismAtlasOverview = context.mechanismImplementationAtlasReport
    ? `Mechanism implementation atlas: mechanisms=${context.mechanismImplementationAtlasReport.mechanisms}; mappedTriggers=${context.mechanismImplementationAtlasReport.mappedTriggerRows}/${context.mechanismImplementationAtlasReport.triggerEvidenceRows}; mappedFields=${context.mechanismImplementationAtlasReport.mappedFieldRows}; oldScriptLinks=${context.mechanismImplementationAtlasReport.oldScriptRows}; needsLive=${context.mechanismImplementationAtlasReport.needsLiveRows}; permissionGated=${context.mechanismImplementationAtlasReport.permissionGatedRows}; purchaseRisk=${context.mechanismImplementationAtlasReport.purchaseRiskRows}.`
    : "Mechanism implementation atlas not generated.";
  const goalCompletionAuditOverview = context.goalCompletionAuditReport
    ? `Goal completion audit: complete=${context.goalCompletionAuditReport.goalComplete ? "yes" : "no"}; requirements=${context.goalCompletionAuditReport.requirements}; proved=${context.goalCompletionAuditReport.provedRows}; sourceScope=${context.goalCompletionAuditReport.sourceScopeRows}; incomplete=${context.goalCompletionAuditReport.incompleteRows}; blockers=${context.goalCompletionAuditReport.blockerRows}; remainingLiveProofRows=${context.goalCompletionAuditReport.remainingLiveProofRows}; blockerLevels=${context.goalCompletionAuditReport.blockerProofLevels || "(none)"}.`
    : "Goal completion audit not generated.";
  const blockerCapturePlanOverview = context.blockerCapturePlanReport
    ? `Blocker capture plan: sessions=${context.blockerCapturePlanReport.blockerSessions}; commands=${context.blockerCapturePlanReport.commandRows}; preflightMissingScripts=${context.blockerCapturePlanReport.missingScripts}; manualTriggerSessions=${context.blockerCapturePlanReport.manualTriggerSessions}; purchaseSensitiveCommands=${context.blockerCapturePlanReport.purchaseSensitiveCommands}.`
    : "Blocker capture plan not generated.";
  const blockerCaptureRunnerOverview = context.blockerCaptureRunnerReport
    ? `Blocker capture runner: phase=${context.blockerCaptureRunnerReport.phase}; dryRun=${context.blockerCaptureRunnerReport.dryRun ? "yes" : "no"}; detach=${context.blockerCaptureRunnerReport.detach ? "yes" : "no"}; armFast=${context.blockerCaptureRunnerReport.armFast ? "yes" : "no"}; commands=${context.blockerCaptureRunnerReport.commands}; executed=${context.blockerCaptureRunnerReport.executed}; detached=${context.blockerCaptureRunnerReport.detached}; ok=${context.blockerCaptureRunnerReport.ok}; failed=${context.blockerCaptureRunnerReport.failed}; timedOut=${context.blockerCaptureRunnerReport.timedOut}; missingScripts=${context.blockerCaptureRunnerReport.missingScripts}.`
    : "Blocker capture runner not run.";
  const blockerCaptureReadinessOverview = context.blockerCaptureReadinessReport
    ? `Blocker capture readiness: cdpAvailable=${context.blockerCaptureReadinessReport.cdpAvailable ? "yes" : "no"}; battlePreArmReady=${context.blockerCaptureReadinessReport.battlePreArmReady ? "yes" : "no"}; readyWatchers=${context.blockerCaptureReadinessReport.readyWatchers}/${context.blockerCaptureReadinessReport.watchers}; stagePresent=${context.blockerCaptureReadinessReport.stagePresent ? "yes" : "no"}; scenes=${context.blockerCaptureReadinessReport.scenes}; missingRequired=${context.blockerCaptureReadinessReport.missingRequired.join("/") || "(none)"}.`
    : "Blocker capture readiness not checked.";
  const blockerCaptureArmVerifyOverview = context.blockerCaptureArmVerifyReport
    ? `Blocker capture arm-verify: ready=${context.blockerCaptureArmVerifyReport.ready ? "yes" : "no"}; dryRun=${context.blockerCaptureArmVerifyReport.dryRun ? "yes" : "no"}; runner=${context.blockerCaptureArmVerifyReport.runnerStatus || "(none)"}; readiness=${context.blockerCaptureArmVerifyReport.readinessStatus || "(none)"}; cdpAvailable=${context.blockerCaptureArmVerifyReport.cdpAvailable ? "yes" : "no"}; battlePreArmReady=${context.blockerCaptureArmVerifyReport.battlePreArmReady ? "yes" : "no"}; readyWatchers=${context.blockerCaptureArmVerifyReport.readyWatchers}/${context.blockerCaptureArmVerifyReport.watchers}; missingRequired=${context.blockerCaptureArmVerifyReport.missingRequired.join("/") || "(none)"}.`
    : "Blocker capture arm-verify not run.";
  const goalRemainingAuditOverview = context.goalRemainingAuditReport
    ? `Remaining goal audit: cases=${context.goalRemainingAuditReport.cases}; scriptsOk=${context.goalRemainingAuditReport.scriptsOkCases}/${context.goalRemainingAuditReport.cases}; unresolved=${context.goalRemainingAuditReport.unresolvedRows}; needsLive=${context.goalRemainingAuditReport.needsLiveRows}; permissionGated=${context.goalRemainingAuditReport.permissionGatedRows}; buckets=${context.goalRemainingAuditReport.unresolvedBuckets.join(",") || "(none)"}.`
    : "Remaining goal audit not captured.";
  const liveProofPlaybookOverview = context.liveProofPlaybookReport
    ? `Live proof playbook: rows=${context.liveProofPlaybookReport.playbookRows}; cases=${context.liveProofPlaybookReport.caseCount}; needsLive=${context.liveProofPlaybookReport.needsLiveRows}; permissionGated=${context.liveProofPlaybookReport.permissionGatedRows}; topCases=${context.liveProofPlaybookReport.topCases.join(",") || "(none)"}.`
    : "Live proof playbook not generated.";
  const rogueHandlerFieldJoinOverview = context.rogueHandlerFieldJoinReport
    ? `Rogue handler-field join: scene=${context.rogueHandlerFieldJoinReport.scene || ""}; actionNodes=${context.rogueHandlerFieldJoinReport.actionNodes}; handlers=${context.rogueHandlerFieldJoinReport.handlerRows}; fieldRows=${context.rogueHandlerFieldJoinReport.fieldRows}; semanticMatched=${context.rogueHandlerFieldJoinReport.semanticMatchedFields}; triageMatched=${context.rogueHandlerFieldJoinReport.triageMatchedFields}; needsLiveWithHandlerEvidence=${context.rogueHandlerFieldJoinReport.needsLiveRowsSampledByCurrentHandlers}.`
    : "Rogue handler-field join not captured.";
  const oldGroupText = Object.entries(oldGroups)
    .filter(([, item]) => item.files?.length)
    .map(([key, item]) => `${key}:${item.files.length}/${item.matchCount}`);
  const liveGapText = context.liveGapWatch
    ? `Live-gap watcher scene=${context.liveGapWatch.scene || ""}, wrappers=${context.liveGapWatch.wrappers || 0}, snapshots=${context.liveGapWatch.snapshots || 0}, blockedCalls=${context.liveGapWatch.blockedCalls || 0}, tags=${Object.entries(context.liveGapWatch.tagMax || {}).map(([tag, count]) => `${tag}:${count}`).join(",") || "(none)"}.`
    : "Live-gap watcher not captured.";
  const eventFieldTransitionText = context.eventFieldTransitionWatch
    ? `Event-field transition watcher: scene=${context.eventFieldTransitionWatch.scene || ""}, wrappers=${context.eventFieldTransitionWatch.wrappers || 0}, records=${context.eventFieldTransitionWatch.records || 0}, changed=${context.eventFieldTransitionWatch.changedRecords || 0}, snapshots=${context.eventFieldTransitionWatch.snapshots || 0}, blockedCalls=${context.eventFieldTransitionWatch.blockedCalls || 0}, labels=${context.eventFieldTransitionWatch.topLabels.join(",") || "(none)"}.`
    : "Event-field transition watcher not captured.";
  const currentWindowText = context.currentWindowAction
    ? `Current visible window action report: scene=${context.currentWindowAction.scene || ""}, windows=${context.currentWindowAction.visibleWindows || 0}/${context.currentWindowAction.windows || 0}, buttons=${context.currentWindowAction.buttonCandidates || 0}, purchaseRisk=${context.currentWindowAction.purchaseRiskButtons || 0}, closeBack=${context.currentWindowAction.closeBackButtons || 0}, confirmAction=${context.currentWindowAction.confirmActionButtons || 0}, tooltipHover=${context.currentWindowAction.tooltipHoverButtons || 0}, visibleWindowLabels=${(context.currentWindowAction.windowLabels || []).join("/") || "(none)"}.`
    : "Current visible window action report not captured.";
  const tablegameFocusText = context.tablegameFocusReport
    ? `TableGame focus: gameOver=${context.tablegameFocusReport.value?.table?.manager?.isGameOver === true ? "yes" : "no"}, NBi=${context.tablegameFocusReport.value?.focus?.nbi?.length || 0}, uBt=${context.tablegameFocusReport.value?.focus?.ubt?.length || 0}, skillButtons=${context.tablegameFocusReport.value?.focus?.skillButtons?.length || 0}, Bxt=${context.tablegameFocusReport.value?.focus?.bxt?.length || 0}, stackCards=${context.tablegameFocusReport.value?.focus?.stackCards?.length || 0}, windows=${context.tablegameFocusReport.value?.focus?.windows?.length || 0}.`
    : "TableGame focus report not captured.";
  const promptAutomationText = context.promptAutomationMonitor
    ? `Prompt automation monitor: scene=${context.promptAutomationMonitor.summary?.scene || ""}, gameOver=${context.promptAutomationMonitor.summary?.isGameOver === true ? "yes" : "no"}, wrappers=${context.promptAutomationMonitor.summary?.wrapperCount || 0}, classHooks=${context.promptAutomationMonitor.summary?.classHookCount || 0}, instanceHooks=${context.promptAutomationMonitor.summary?.instanceHookCount || 0}, sendHooks=${context.promptAutomationMonitor.summary?.sendHookCount || 0}, records=${context.promptAutomationMonitor.summary?.records || 0}, promptNodes=${context.promptAutomationMonitor.summary?.promptNodes || 0}, visiblePromptWindows=${context.promptAutomationMonitor.summary?.visiblePromptWindows || 0}.`
    : "Prompt automation monitor not captured.";
  const activeOperationText = context.activeOperation
    ? `Active operation recorder: scene=${context.activeOperation.scene || ""}, gameOver=${context.activeOperation.isGameOver === true ? "yes" : "no"}, records=${context.activeOperation.records || 0}, calls=${context.activeOperation.calls || 0}, sendOrConfirm=${context.activeOperation.sendOrConfirmLikeRecords || 0}, samples=${context.activeOperation.sampleCount || 0}, wrappers=${context.activeOperation.wrappersBeforeStop || 0}->${context.activeOperation.wrappersAfterStop ?? ""}, blocked=${context.activeOperation.blockedCalls || 0}, errors=${context.activeOperation.errors || 0}, skillConfirm=${context.activeOperation.hasSkillConfirm ? "yes" : "no"}, cardSelect=${context.activeOperation.hasStartSelectCard && context.activeOperation.hasCardSelectedChanged ? "yes" : "no"}, targetSelect=${context.activeOperation.hasStartTargetSeat ? "yes" : "no"}, playResult=${context.activeOperation.hasPlayCardResult ? "yes" : "no"}, completed=${context.activeOperation.hasSelectCardCompleted ? "yes" : "no"}, discardRequest=${context.activeOperation.hasDiscardRequest ? "yes" : "no"}, selectedCards=${context.activeOperation.selectedCardIds.join("/") || "(none)"}, selectedSeats=${context.activeOperation.selectedTargetSeatIds.join("/") || "(none)"}.`
    : "Active operation recorder not captured.";
  const rogueEndedExitText = context.rogueEndedExitReport
    ? `Rogue ended-state exit report: scene=${context.rogueEndedExitReport.scene || ""}, isGameOver=${context.rogueEndedExitReport.isGameOver ? "yes" : "no"}, visibleWindows=${context.rogueEndedExitReport.visibleWindows || 0}, methods=${context.rogueEndedExitReport.methodCount || 0}, confirmGated=${(context.rogueEndedExitReport.confirmGatedMethods || []).join("/") || "(none)"}, sendOrLeave=${(context.rogueEndedExitReport.sendOrLeaveMethods || []).join("/") || "(none)"}, sceneSwitch=${(context.rogueEndedExitReport.sceneSwitchMethods || []).join("/") || "(none)"}, purchaseRisk=${(context.rogueEndedExitReport.purchaseRiskMethods || []).join("/") || "(none)"}.`
    : "Rogue ended-state exit report not captured.";

  return [
    {
      id: "all-registration-names",
      requirement: "列出所有入口名/注册字符串/类",
      status: context.allNames ? "enumerated-inferred" : "missing",
      monitorMethod: "Read `Laya.ClassUtils._classMap` from the current page, then classify registered names, prototype methods, static fields, events, and role tags.",
      triggerAndFields: context.allNames
        ? `${context.allNames.classCount} registered classes; ${allNamesEvents.ged} GED events; ${allNamesEvents.proxy} proxy events; ${context.allNames.fieldGlossary.length} inferred field glossary rows. ${classUtilsOverview} Class-field audit: ${context.classFieldAudit?.fieldSlots || 0} field/accessor/static slots, ${context.classFieldAudit?.metrics?.unknownFields || 0} unknown fields, ${context.classFieldAudit?.metrics?.liveNeededClasses || 0} live/source-needed classes. Focused source field context: ${context.fieldContextReport?.summary?.sourceClassCount || 0} classes, ${context.fieldContextReport?.summary?.ownSourceDiscoveredFields || 0} own-source instance fields, ${context.fieldContextReport?.summary?.eventBindings || 0} source event bindings. All-source context: ${context.allSourceContext?.capturedClasses || 0} classes, ${context.allSourceContext?.methodContexts || 0} method contexts, ${context.allSourceContext?.sourceFieldRows || 0} source field rows, ${context.allSourceContext?.eventBindings || 0} source event bindings. ${triggerOverview} ${semanticOverview} ${liveStateOverview} ${liveJoinOverview} ${liveFieldGapOverview} ${liveFieldGapTriageOverview} ${liveOwnerSourceOverview} ${liveFieldSemanticsOverview} ${fieldSemanticIndexOverview} ${activeOperationFieldTransitionOverview} ${residualFieldSourceOverview} ${entryEvidenceCatalogOverview} ${mechanismAtlasOverview} ${goalCompletionAuditOverview} ${blockerCapturePlanOverview} ${blockerCaptureRunnerOverview} ${blockerCaptureReadinessOverview} ${blockerCaptureArmVerifyOverview} ${goalRemainingAuditOverview} ${liveProofPlaybookOverview} ${eventFieldTransitionText} ${rogueHandlerFieldJoinOverview}`
        : "No all-names report found.",
      evidence: evidenceList([
        context.allNames?.paths.classesTsv,
        context.allNames?.paths.methodRoleIndex,
        context.allNames?.paths.eventIndex,
        context.allNames?.paths.fieldGlossary,
        context.classUtilsInspect?.mdPath,
        context.classUtilsInspect?.entriesTsvPath,
        context.classUtilsInspect?.aliasGroupsTsvPath,
        context.classFieldAudit?.mdPath,
        context.classFieldAudit?.unknownWorklistPath,
        context.fieldContextReport?.mdPath,
        context.fieldContextReport?.fieldsTsvPath,
        context.allSourceContext?.mdPath,
        context.allSourceContext?.methodTsvPath,
        context.allSourceContext?.fieldTsvPath,
        context.allSourceContext?.eventTsvPath,
        context.triggerMonitoring?.mdPath,
        context.triggerMonitoring?.indexPath,
        context.triggerMonitoring?.playbookPath,
        context.semanticInheritance?.mdPath,
        context.semanticInheritance?.classInheritanceTsv,
        context.semanticInheritance?.enumValuesTsv,
        context.semanticInheritance?.fieldOwnerTsv,
        context.liveObjectState?.mdPath,
        context.liveObjectState?.fieldSamplesTsv,
        context.liveFieldSourceJoin?.mdPath,
        context.liveFieldSourceJoin?.tsvPath,
        context.liveFieldGapReport?.mdPath,
        context.liveFieldGapReport?.worklistTsvPath,
        context.liveFieldGapReport?.ownerSummaryTsvPath,
        context.liveFieldGapReport?.surfaceSummaryTsvPath,
        context.liveFieldGapTriageReport?.mdPath,
        context.liveFieldGapTriageReport?.triageTsvPath,
        context.liveFieldGapTriageReport?.bucketSummaryTsvPath,
        context.liveOwnerSourceReport?.mdPath,
        context.liveOwnerSourceReport?.targetsTsvPath,
        context.liveOwnerSourceReport?.fieldMethodRefsTsvPath,
        context.liveFieldSemanticsReport?.mdPath,
        context.liveFieldSemanticsReport?.tsvPath,
        context.liveFieldSemanticsReport?.methodEvidenceTsvPath,
        context.fieldSemanticIndexReport?.mdPath,
        context.fieldSemanticIndexReport?.fieldIndexTsvPath,
        context.fieldSemanticIndexReport?.classCoverageTsvPath,
        context.fieldSemanticIndexReport?.unresolvedTsvPath,
        context.activeOperationFieldTransitionReport?.mdPath,
        context.activeOperationFieldTransitionReport?.coveredTsvPath,
        context.activeOperationFieldTransitionReport?.evidenceTsvPath,
        context.residualFieldSourceReport?.mdPath,
        context.residualFieldSourceReport?.tsvPath,
        context.residualFieldSourceReport?.bucketTsvPath,
        context.entryEvidenceCatalogReport?.mdPath,
        context.entryEvidenceCatalogReport?.entrySummaryTsvPath,
        context.entryEvidenceCatalogReport?.fieldEvidenceTsvPath,
        context.entryEvidenceCatalogReport?.triggerEvidenceTsvPath,
        context.entryEvidenceCatalogReport?.residualEvidenceTsvPath,
        context.entryEvidenceCatalogReport?.unmatchedEvidenceTsvPath,
        context.mechanismImplementationAtlasReport?.mdPath,
        context.mechanismImplementationAtlasReport?.summaryTsvPath,
        context.mechanismImplementationAtlasReport?.triggerMethodsTsvPath,
        context.mechanismImplementationAtlasReport?.fieldMeaningsTsvPath,
        context.mechanismImplementationAtlasReport?.oldScriptLinksTsvPath,
        context.goalCompletionAuditReport?.mdPath,
        context.goalCompletionAuditReport?.auditTsvPath,
        context.goalCompletionAuditReport?.blockersTsvPath,
        context.goalCompletionAuditReport?.remainingLiveProofTsvPath,
        context.blockerCapturePlanReport?.mdPath,
        context.blockerCapturePlanReport?.sessionsTsvPath,
        context.blockerCapturePlanReport?.commandsTsvPath,
        context.blockerCaptureRunnerReport?.mdPath,
        context.blockerCaptureRunnerReport?.commandsTsvPath,
        context.blockerCaptureReadinessReport?.mdPath,
        context.blockerCaptureReadinessReport?.watchersTsvPath,
        context.blockerCaptureReadinessReport?.scenesTsvPath,
        context.blockerCaptureArmVerifyReport?.mdPath,
        context.blockerCaptureArmVerifyReport?.stepsTsvPath,
        context.goalRemainingAuditReport?.mdPath,
        context.goalRemainingAuditReport?.tsvPath,
        context.liveProofPlaybookReport?.mdPath,
        context.liveProofPlaybookReport?.playbookTsvPath,
        context.liveProofPlaybookReport?.caseSummaryTsvPath,
        context.eventFieldTransitionWatch?.mdPath,
        context.eventFieldTransitionWatch?.recordsTsvPath,
        context.rogueHandlerFieldJoinReport?.mdPath,
        context.rogueHandlerFieldJoinReport?.fieldJoinTsvPath,
        context.rogueHandlerFieldJoinReport?.handlerSurfaceTsvPath,
        context.rogueHandlerFieldJoinReport?.needsLiveStrengthenedTsvPath
      ]),
      remaining: context.allSourceContext?.capturedClasses === context.allNames?.classCount && context.allSourceContext?.missingClasses === 0
        ? (context.liveObjectState
            ? (context.liveFieldSourceJoin
                ? (context.liveFieldGapReport
                    ? `Registration/name enumeration, ClassUtils live keys, own-source context, exact enum/static values, inherited method owners, current live object-state samples, live-field/source joins, ${context.liveOwnerSourceReport?.targetsWithFieldRefs || 0} live owner field-ref targets, ${context.liveFieldSemanticsReport?.fieldRows || 0} live field semantics rows, and ${context.fieldSemanticIndexReport?.fieldIndexRows || 0} merged class+field semantic index rows are captured. Event-field transition watcher adds ${context.eventFieldTransitionWatch?.wrappers || 0} before/after hook wrappers and ${context.eventFieldTransitionWatch?.records || 0} event records in the current sample. Active-operation field join maps ${context.activeOperationFieldTransitionReport?.coveredUnresolvedRows ?? 0} unresolved row(s), including ${context.activeOperationFieldTransitionReport?.coveredByStrength?.exact || 0} exact class+field match(es), from the captured active battle chain. Residual source join maps ${context.residualFieldSourceReport?.rowsWithEvidence ?? "unknown"}/${context.residualFieldSourceReport?.uncoveredRows ?? "unknown"} still-uncovered rows to owner+field evidence, with ${context.residualFieldSourceReport?.rowsMissingEvidence ?? "unknown"} missing owner-field evidence. Entry evidence catalog maps ${context.entryEvidenceCatalogReport?.matchedFieldRows ?? "unknown"}/${context.entryEvidenceCatalogReport?.fieldSemanticRows ?? "unknown"} field rows, ${context.entryEvidenceCatalogReport?.matchedTriggerRows ?? "unknown"}/${context.entryEvidenceCatalogReport?.triggerMonitoringRows ?? "unknown"} trigger rows, and ${context.entryEvidenceCatalogReport?.matchedResidualRows ?? "unknown"}/${context.entryEvidenceCatalogReport?.residualFieldRows ?? "unknown"} residual rows to registered or synthetic runtime entries. Current Rogue handler-field join adds ${context.rogueHandlerFieldJoinReport?.fieldRows || 0} action-node field rows and ${context.rogueHandlerFieldJoinReport?.needsLiveRowsSampledByCurrentHandlers || 0} needs-live rows with current handler evidence. ${context.liveFieldGapReport.weakRows} deduped weak live fields are triaged into ${context.liveFieldGapTriageReport?.explainedRows ?? "unknown"} explained/generic, ${context.liveFieldGapTriageReport?.needsLiveRows ?? "unknown"} needs-live, and ${context.liveFieldGapTriageReport?.permissionGatedRows ?? "unknown"} permission-gated rows; remaining audit maps ${context.goalRemainingAuditReport?.cases ?? "unknown"} residual cases to ${context.goalRemainingAuditReport?.scriptsOkCases ?? "unknown"} script-complete monitor paths; live proof playbook maps ${context.liveProofPlaybookReport?.playbookRows ?? "unknown"} unresolved rows to ${context.liveProofPlaybookReport?.caseCount ?? "unknown"} case-level activation/success criteria; the merged index still has ${context.fieldSemanticIndexReport?.unresolvedRows ?? "unknown"} unresolved/transition rows, so additional scene/window/event-specific value transitions still need targeted CDP samples.`
                    : "Registration/name enumeration, own-source context, exact enum/static values, inherited method owners, one current live object-state sample, and a live-field/source join are captured. Additional scene/window/event-specific live states still need targeted CDP samples.")
                : "Registration/name enumeration, own-source context, exact enum/static values, inherited method owners, and one current live object-state field sample are captured. Additional scene/window/event-specific live states still need targeted CDP samples.")
            : "Registration/name enumeration, own-source context, exact enum/static values, and inherited method owners are captured for all live registered classes. Live-only state meanings still need targeted CDP samples.")
        : "Registration/name enumeration is present, but exact field semantics for every class are still inferred unless backed by source branch or live sample."
    },
    {
      id: "semantic-inheritance-enum-fields",
      requirement: "精确枚举值、继承来源、字段 owner/含义增强",
      status: context.semanticInheritance ? "source-proven" : "missing",
      monitorMethod: "Read saved full-source chunks plus all-names inherited method inventory; extract static descriptor primitive values, inherited owner prefixes, and source field owner rows.",
      triggerAndFields: `${semanticOverview} ${liveJoinOverview} ${liveFieldGapOverview} ${liveFieldGapTriageOverview} ${liveOwnerSourceOverview} ${liveFieldSemanticsOverview} ${fieldSemanticIndexOverview} ${goalRemainingAuditOverview} ${rogueHandlerFieldJoinOverview}`,
      evidence: evidenceList([
        context.semanticInheritance?.mdPath,
        context.semanticInheritance?.classInheritanceTsv,
        context.semanticInheritance?.enumValuesTsv,
        context.semanticInheritance?.fieldOwnerTsv,
        context.liveFieldSourceJoin?.mdPath,
        context.liveFieldSourceJoin?.tsvPath,
        context.liveFieldGapReport?.mdPath,
        context.liveFieldGapReport?.worklistTsvPath,
        context.liveFieldGapReport?.ownerSummaryTsvPath,
        context.liveFieldGapTriageReport?.mdPath,
        context.liveFieldGapTriageReport?.triageTsvPath,
        context.liveFieldGapTriageReport?.bucketSummaryTsvPath,
        context.liveOwnerSourceReport?.mdPath,
        context.liveOwnerSourceReport?.targetsTsvPath,
        context.liveOwnerSourceReport?.fieldMethodRefsTsvPath,
        context.liveFieldSemanticsReport?.mdPath,
        context.liveFieldSemanticsReport?.tsvPath,
        context.liveFieldSemanticsReport?.methodEvidenceTsvPath,
        context.fieldSemanticIndexReport?.mdPath,
        context.fieldSemanticIndexReport?.fieldIndexTsvPath,
        context.fieldSemanticIndexReport?.classCoverageTsvPath,
        context.fieldSemanticIndexReport?.unresolvedTsvPath,
        context.goalRemainingAuditReport?.mdPath,
        context.goalRemainingAuditReport?.tsvPath,
        context.liveProofPlaybookReport?.mdPath,
        context.liveProofPlaybookReport?.playbookTsvPath,
        context.liveProofPlaybookReport?.caseSummaryTsvPath,
        context.rogueHandlerFieldJoinReport?.mdPath,
        context.rogueHandlerFieldJoinReport?.fieldJoinTsvPath,
        context.rogueHandlerFieldJoinReport?.handlerSurfaceTsvPath,
        context.rogueHandlerFieldJoinReport?.needsLiveStrengthenedTsvPath
      ]),
      remaining: context.liveFieldSourceJoin
        ? (context.liveFieldGapReport
            ? `Exact constants and inherited owner prefixes are source-proven for the saved capture, latest live fields are joined to source/semantic rows where possible, ${context.liveOwnerSourceReport?.fieldRefMethods || 0} live owner field-reference methods, ${context.liveFieldSemanticsReport?.highConfidenceRows || 0} high-confidence field semantics rows, and ${context.fieldSemanticIndexReport?.fieldIndexRows || 0} merged class+field rows are indexed; current Rogue handler-field join adds ${context.rogueHandlerFieldJoinReport?.needsLiveRowsSampledByCurrentHandlers || 0} needs-live rows with handler evidence; ${context.liveFieldGapReport.weakRows} deduped weak fields are triaged (${context.liveFieldGapTriageReport?.explainedRows ?? "unknown"} explained/generic, ${context.liveFieldGapTriageReport?.needsLiveRows ?? "unknown"} needs live), and the live proof playbook assigns ${context.liveProofPlaybookReport?.playbookRows ?? "unknown"} unresolved rows to case-specific activation/success checks. Runtime-only value transitions still need scene/window-specific samples.`
            : "Exact constants and inherited owner prefixes are source-proven for the saved capture, and latest live fields are joined to source/semantic rows where possible; runtime-only meanings still need scene/window-specific samples.")
        : "Exact constants and inherited owner prefixes are source-proven for the saved capture; runtime-only object state still needs live CDP sampling in each target scene/window."
    },
    {
      id: "trigger-monitoring-matrix",
      requirement: "所有非购买触发表面的统一监控矩阵",
      status: context.triggerMonitoring ? "source-proven" : "missing",
      monitorMethod: "Generate hook targets from all-source method context; hook via stable `Laya.ClassUtils._classMap[registeredName]` paths; purchase-risk rows are identified and blocked by default.",
      triggerAndFields: `${triggerOverview} ${[
        "scene-window-switch",
        "battle-lifecycle",
        "skill-trigger",
        "button-ui-click",
        "card-selection-movement",
        "auto-play-select-discard",
        "hover-popup",
        "effect-animation",
        "resource-drawing",
        "rogue",
        "bless-qifu",
        "kanshu",
        "yanjiao",
        "qixing-shen-zhuge",
        "purchase-risk"
      ].map((surface) => triggerSurfaceText(context, surface)).join(" ")} ${goalRemainingAuditOverview}`,
      evidence: evidenceList([
        context.triggerMonitoring?.mdPath,
        context.triggerMonitoring?.indexPath,
        context.triggerMonitoring?.classSummaryPath,
        context.triggerMonitoring?.playbookPath,
        context.goalRemainingAuditReport?.mdPath,
        context.goalRemainingAuditReport?.tsvPath,
        context.liveProofPlaybookReport?.mdPath,
        context.liveProofPlaybookReport?.caseSummaryTsvPath
      ]),
      remaining: context.goalRemainingAuditReport
        ? `The matrix proves stable hook targets and trigger candidates from source. Remaining audit maps ${context.goalRemainingAuditReport.cases} case-specific live gaps to ${context.goalRemainingAuditReport.scriptsOkCases}/${context.goalRemainingAuditReport.cases} existing monitor command sets; live proof playbook adds field-level activation signals and success evidence for ${context.liveProofPlaybookReport?.playbookRows ?? "unknown"} unresolved rows. Live-only state meaning and active automation still require those CDP samples.`
        : "The matrix proves stable hook targets and trigger candidates from source. Live-only state meaning and active automation still require case-specific CDP samples."
    },
    {
      id: "object-scene-window-switch",
      requirement: "对象与画面切换、窗口打开/关闭、SceneManager/WindowManager 路径",
      status: "live-proven",
      monitorMethod: "Use CDP `Runtime.evaluate` to inspect `Laya.stage`; hook GED/window-manager methods and validate effective visible nodes under scene layer/window layer.",
      triggerAndFields: `Surface monitor installed ${hooks.hookClasses} hook class specs / ${hooks.wrappers} wrappers; scene transition samples and current-scene scans are saved. ${triggerSurfaceText(context, "scene-window-switch")}`,
      evidence: evidenceList([
        samplePath(context.currentScene),
        samplePath(context.tableTransition),
        context.surfaceHooks.path,
        context.allNames?.paths.eventIndex,
        context.triggerMonitoring?.playbookPath
      ]),
      remaining: "For a newly targeted scene/window, inspect effective visibility rather than trusting stale registries."
    },
    {
      id: "battle-entry-exit-tracker-ui",
      requirement: "进入战斗/离开战斗，以及记牌器脚本 UI 自动显示与清理",
      status: "live-proven",
      monitorMethod: "Enter through 武将试炼 route or Rogue fight-confirm route, prove a visible battle scene (`TableGameScene` or `RogueLikeGameScene`) with `manager.seats`, install tracker/overlay only there, and stop drawing when game result or scene leave is detected.",
      triggerAndFields: `Battle entry samples prove \`TableGameScene\`; Rogue fight-confirm plus delayed scene inspection prove \`${context.rogueGameSceneInspect?.scene || "RogueLikeGameScene"}\` with manager=${context.rogueGameSceneInspect?.managerCtor || ""}, seats=${context.rogueGameSceneInspect?.seatCount ?? ""}, selfSeatIndex=${context.rogueGameSceneInspect?.selfSeatIndex ?? ""}. Current Rogue end-state action surface: isGameOver=${context.rogueBattleActionSurface?.isGameOver ? "yes" : "no"}, GameResultWindow=${context.rogueBattleActionSurface?.hasGameResultWindow ? "yes" : "no"}, selfHandCards=${context.rogueBattleActionSurface?.selfHandCards ?? ""}. ${rogueEndedExitText} ${tablegameFocusText} Tracker boundary uses visible battle scene plus \`manager.seats\` and never reads hidden opponent \`handCards\`. ${triggerSurfaceText(context, "battle-lifecycle")}`,
      evidence: evidenceList([
        samplePath(context.battleActivity),
        samplePath(context.battleEnterTrial),
        samplePath(context.battleStartChallenge),
        samplePath(context.tablegameInspection),
        context.tablegameFocusReport?.__path,
        context.rogueActiveSample?.path,
        context.rogueGameSceneInspect?.path,
        context.rogueBattleActionSurface?.path,
        context.rogueEndedExitReport?.path,
        samplePath(context.battleEndScan),
        context.triggerMonitoring?.indexPath
      ]),
      remaining: "More skill-specific battle samples are still needed for special card windows such as live Qixing."
    },
    {
      id: "skill-trigger-protocol",
      requirement: "技能触发、自动技能、协议/事件触发条件",
      status: context.activeOperation?.hasSkillConfirm ? "live-proven" : (context.promptAutomationMonitor ? "partial-live-proven" : "source-proven"),
      monitorMethod: "Hook registered skill classes by stable class string, especially `GetResponser`, `OnMsg*`, `MoveCard*Response`, `SendMsg*`, prompt-window methods, current NBi/uBt skill methods, and proxy/window send paths.",
      triggerAndFields: `${roleText(context.allNames, "skill-trigger")} ${promptAutomationText} ${activeOperationText} Current skill-button detail: scene=${context.rogueCurrentSkillButtonDetailReport?.scene || ""}, gameOver=${context.rogueCurrentSkillButtonDetailReport?.isGameOver ? "yes" : "no"}, skillButtons=${(context.rogueCurrentSkillButtonDetailReport?.skillButtonTexts || []).join("/") || "(none)"}, autoEvidence=${context.rogueCurrentSkillButtonDetailReport?.autoEvidenceRows || 0}, sendOrConfirm=${context.rogueCurrentSkillButtonDetailReport?.sendOrConfirmRows || 0}, debugLog=${context.rogueCurrentSkillButtonDetailReport?.debugLogRows || 0}. ${tablegameFocusText} ${triggerSurfaceText(context, "skill-trigger")}`,
      evidence: evidenceList([
        context.allNames?.paths.methodRoleIndex,
        samplePath(context.surfaceMonitor),
        samplePath(context.tableTransition),
        context.promptAutomationMonitor?.__path,
        context.activeOperation?.mdPath,
        context.activeOperation?.path,
        context.activeOperation?.tsvPath,
        context.tablegameFocusReport?.__path,
        context.rogueCurrentSkillButtonDetailReport?.mdPath,
        context.rogueCurrentSkillButtonDetailReport?.methodEvidenceTsvPath,
        context.rogueCurrentSkillButtonDetailReport?.eventHandlerEvidenceTsvPath,
        context.triggerMonitoring?.indexPath
      ]),
      remaining: context.activeOperation?.hasSkillConfirm
        ? "Skill prompt confirmation is live-proven through `ShowButtonBar -> SpellTouch_ConfirmResult` in a non-ended TableGameScene; unattended auto-confirm should still be gated per prompt and never enabled for purchase-like paths."
        : context.promptAutomationMonitor
        ? "Prompt automation hooks are live-installable and restored cleanly; a real non-ended prompt is still needed before enabling active auto-confirm/use."
        : "Per-skill outgoing send semantics require live samples before enabling automation beyond read-only monitoring."
    },
    {
      id: "card-ui-movement-selection",
      requirement: "UI 中牌的移动、选牌、弃牌、自动选牌/自动出牌",
      status: context.activeOperation?.hasStartSelectCard && context.activeOperation?.hasCardSelectedChanged && context.activeOperation?.hasSelectCardResult && context.activeOperation?.hasPlayCardResult
        ? "live-proven"
        : (context.rogueBattlePromptInspect ? "partial-live-proven" : (context.rogueBattleActionSurface ? "partial-live-proven" : "source-proven")),
      monitorMethod: "Hook `SelectCardWindow`, `SpellMultiSelectorWindow`, card-selection windows, `onTouchCard`, `confirmClick`, `cancelClick`, `autoSelect`, drag/drop and send methods.",
      triggerAndFields: `${roleText(context.allNames, "card-operation")} ${activeOperationText} Rogue battle action surface: handAreas=${context.rogueBattleActionSurface?.handAreas || 0}, cardUiNodes=${context.rogueBattleActionSurface?.cardUiNodes || 0}, promptNodes=${context.rogueBattleActionSurface?.promptNodes || 0}, managerSendSources=${context.rogueBattleActionSurface?.managerMethodSources || 0}, SelectCardWindowMethods=${context.rogueBattleActionSurface?.selectCardWindowMethods || 0}, SkillBiFaMethods=${context.rogueBattleActionSurface?.skillBiFaWindowMethods || 0}. Prompt detail: selfHandCards=${context.rogueBattlePromptInspect?.selfHandCards ?? ""}, selfHand=${(context.rogueBattlePromptInspect?.selfHandNames || []).join("/") || ""}, handAreas=${context.rogueBattlePromptInspect?.handAreas || 0}, selectAreas=${context.rogueBattlePromptInspect?.selectAreas || 0}, visibleButtons=${context.rogueBattlePromptInspect?.visibleButtons || 0}, promptCandidates=${context.rogueBattlePromptInspect?.promptCandidates || 0}, SelectCard=${context.rogueBattlePromptInspect?.selectCardWindowMethods || 0}, SpellMulti=${context.rogueBattlePromptInspect?.spellMultiSelectorWindowMethods || 0}, SkillBiFa=${context.rogueBattlePromptInspect?.skillBiFaWindowMethods || 0}. ${promptAutomationText} Current action handlers: nodes=${context.rogueCurrentActionHandlerReport?.nodeCount || 0}, cardSelection=${context.rogueCurrentActionHandlerReport?.actionNodeTypeCounts?.["card-selection"] || 0}, handlers=${context.rogueCurrentActionHandlerReport?.eventHandlerCount || 0}, sendOrConfirm=${context.rogueCurrentActionHandlerReport?.sendOrConfirmHandlers || 0}. Skill-button detail: currentPlayerAnchors=${context.rogueCurrentSkillButtonDetailReport?.currentPlayerAnchors || 0}, cardContainers=${context.rogueCurrentSkillButtonDetailReport?.cardContainers || 0}, selectPanels=${context.rogueCurrentSkillButtonDetailReport?.selectPanels || 0}, methods=${context.rogueCurrentSkillButtonDetailReport?.methodRows || 0}, events=${context.rogueCurrentSkillButtonDetailReport?.eventRows || 0}, autoEvidence=${context.rogueCurrentSkillButtonDetailReport?.autoEvidenceRows || 0}. ${tablegameFocusText} Handler-field join: fieldRows=${context.rogueHandlerFieldJoinReport?.fieldRows || 0}, semanticMatched=${context.rogueHandlerFieldJoinReport?.semanticMatchedFields || 0}, needsLiveWithHandlerEvidence=${context.rogueHandlerFieldJoinReport?.needsLiveRowsSampledByCurrentHandlers || 0}. ${currentWindowText} ${triggerSurfaceText(context, "card-selection-movement")} ${triggerSurfaceText(context, "auto-play-select-discard")}`,
      evidence: evidenceList([
        context.allNames?.paths.methodRoleIndex,
        samplePath(context.surfaceMonitor),
        context.currentWindowAction?.path,
        context.tablegameFocusReport?.__path,
        context.mechanismReport?.selectedMethodEvidence,
        context.activeOperation?.mdPath,
        context.activeOperation?.path,
        context.activeOperation?.tsvPath,
        context.rogueBattleActionSurface?.path,
        context.rogueBattlePromptInspect?.path,
        context.rogueCurrentActionHandlerReport?.mdPath,
        context.rogueCurrentActionHandlerReport?.nodesTsvPath,
        context.rogueCurrentActionHandlerReport?.handlersTsvPath,
        context.rogueCurrentSkillButtonDetailReport?.mdPath,
        context.rogueCurrentSkillButtonDetailReport?.focusNodesTsvPath,
        context.rogueCurrentSkillButtonDetailReport?.methodEvidenceTsvPath,
        context.rogueCurrentSkillButtonDetailReport?.eventHandlerEvidenceTsvPath,
        context.promptAutomationMonitor?.__path,
        context.rogueHandlerFieldJoinReport?.mdPath,
        context.rogueHandlerFieldJoinReport?.fieldJoinTsvPath,
        context.rogueHandlerFieldJoinReport?.handlerSurfaceTsvPath,
        context.rogueHandlerFieldJoinReport?.needsLiveStrengthenedTsvPath,
        context.triggerMonitoring?.indexPath
      ]),
      remaining: context.activeOperation?.hasStartSelectCard && context.activeOperation?.hasCardSelectedChanged && context.activeOperation?.hasSelectCardResult && context.activeOperation?.hasPlayCardResult
        ? "Normal play/response selection is live-proven through `StartSelectCard -> CardUI_SelectedChanged -> SelectCardResult/PlayCard_Result -> SelectCardResultCompleted`, including selected card/seat context changes. Dedicated discard-only and unattended auto-discard variants should still be sampled per prompt before automation is enabled."
        : context.rogueBattlePromptInspect
        ? "Current self hand, hand UI, select UI, visible buttons, prompt candidates, prompt class send methods, and prompt automation hooks are live-inspected; specific discard/auto-play prompts still need safe active samples before any click/confirm automation is trusted."
        : context.rogueBattleActionSurface
          ? "Rogue battle hand/card/prompt surfaces are live-inspected, but specific discard/auto-play prompts still need safe active samples before any click/confirm automation is trusted."
        : "Specific discard/auto-play prompts still need safe live samples before any active click/confirm automation is trusted."
    },
    {
      id: "hover-popup",
      requirement: "悬浮窗、技能/牌弹窗、鼠标 hover 监控",
      status: (context.hoverPopupSample?.methodRecords > 0 || context.hoverPopupProbe?.popupMethodRecordCount > 0)
        ? "live-proven"
        : (context.hoverPopupSample?.liveRecordCount > 0 || context.hoverPopupProbe?.mouseRecords > 0 || context.hoverPopupProbe?.hoverEventRecordCount > 0 || context.tooltipLifecycle?.callOk || context.hoverFieldTooltip?.mouseRecords > 0 || context.hoverHandlerFieldTransition?.fieldDeltaTargets > 0)
          ? "partial-live-proven"
          : "needs-live-sample",
      monitorMethod: "Hook `SkillSelectorWindow.cardRollOver/cardRollOut/showOverCard`, `SkillPopUpWindow.initBg/layoutTxt`, rogue tooltip handlers, and inspect visible WindowLayer/PopUp nodes.",
      triggerAndFields: context.hoverPopupSample || context.hoverPopupProbe
        ? `${roleText(context.allNames, "hover-popup")} ${triggerSurfaceText(context, "hover-popup")} Passive sample wrappers=${context.hoverPopupSample?.wrappers || 0}, live hover records=${context.hoverPopupSample?.liveRecordCount || 0}. Probe moves=${context.hoverPopupProbe?.moves || 0}, mouse records=${context.hoverPopupProbe?.mouseRecords || 0}, Laya hover event records=${context.hoverPopupProbe?.hoverEventRecordCount || 0}, popup method records=${context.hoverPopupProbe?.popupMethodRecordCount || 0}. Tooltip lifecycle call=${context.tooltipLifecycle?.callOk ? "ok" : "missing"}, returned=${context.tooltipLifecycle?.returnedLabel || ""}, cleanup=${context.tooltipLifecycle?.cleanupOk ? "ok" : "missing"}, stageTips=${context.tooltipLifecycle?.tipsAfterDirectCreate || 0}. Field-tooltip sample candidates=${context.hoverFieldTooltip?.candidates || 0}, sampled=${context.hoverFieldTooltip?.sampledTargets || 0}, mouseRecords=${context.hoverFieldTooltip?.mouseRecords || 0}, visibleTipDelta=${context.hoverFieldTooltip?.visibleTipDeltaObserved ? "yes" : "no"}, maxTipDelta=${context.hoverFieldTooltip?.maxCdpDelta || 0}/${context.hoverFieldTooltip?.maxDirectDelta || 0}, maxWindowDelta=${context.hoverFieldTooltip?.maxCdpWindowDelta || 0}/${context.hoverFieldTooltip?.maxDirectWindowDelta || 0}, maxStageChildDelta=${context.hoverFieldTooltip?.maxCdpStageChildDelta || 0}/${context.hoverFieldTooltip?.maxDirectStageChildDelta || 0}. Hover-handler field transition runs=${context.hoverHandlerFieldTransition?.runCount || 0}, sampled=${context.hoverHandlerFieldTransition?.sampledTargets || 0}, fieldDeltaTargets=${context.hoverHandlerFieldTransition?.fieldDeltaTargets || 0}, visibleDeltaTargets=${context.hoverHandlerFieldTransition?.visibleDeltaTargets || 0}, changedKeys=${(context.hoverHandlerFieldTransition?.changedKeys || []).join("/") || ""}, proxyBlocked=${context.hoverHandlerFieldTransition?.proxyLBlockedCalls || 0}. Stage-delta sample scene=${context.hoverStageDelta?.scene || ""}, candidates=${context.hoverStageDelta?.candidates || 0}, sampled=${context.hoverStageDelta?.sampledTargets || 0}, cdpHoverOk=${context.hoverStageDelta?.cdpHoverOk || 0}, cdpHoverTimeouts=${context.hoverStageDelta?.cdpHoverTimeouts || 0}, cdpDelta=${context.hoverStageDelta?.cdpDeltaObserved ? "yes" : "no"}, directDelta=${context.hoverStageDelta?.directDeltaObserved ? "yes" : "no"}, cleanup=${context.hoverStageDelta?.cleanupOk ? "ok" : "missing"}. Rogue tooltip inspect nodes=${context.rogueTooltipInspect?.tooltipNodes || 0}, active=${context.rogueTooltipInspect?.activeTooltipNodes || 0}. Current action hover nodes=${context.rogueCurrentActionHandlerReport?.actionNodeTypeCounts?.["hover-tooltip"] || 0}, handlers=${context.rogueCurrentActionHandlerReport?.eventHandlerCount || 0}. ${currentWindowText} ${liveGapText}`
        : roleText(context.allNames, "hover-popup"),
      evidence: evidenceList([
        context.allNames?.paths.methodRoleIndex,
        samplePath(context.surfaceMonitor),
        context.hoverPopupSample?.path,
        context.hoverPopupProbe?.path,
        context.hoverFieldTooltip?.path,
        ...(context.hoverHandlerFieldTransition?.paths || []),
        context.hoverStageDelta?.path,
        context.liveGapWatch?.path,
        context.currentWindowAction?.path,
        context.tooltipLifecycle?.path,
        context.rogueTooltipInspect?.path,
        context.rogueCurrentActionHandlerReport?.mdPath,
        context.triggerMonitoring?.indexPath
      ]),
      remaining: (context.hoverPopupSample?.methodRecords > 0 || context.hoverPopupProbe?.popupMethodRecordCount > 0)
        ? "Popup method record exists; additional cases can broaden popup creation/cleanup coverage."
        : (context.tooltipLifecycle?.callOk)
          ? `Tooltip function lifecycle returns and cleans ${context.tooltipLifecycle?.returnedLabel || "a tooltip object"}, and field-bound/stage-delta hover nodes were sampled; hover-handler field transitions changed ${(context.hoverHandlerFieldTransition?.changedKeys || []).join("/") || "no tracked"} on ${context.hoverHandlerFieldTransition?.fieldDeltaTargets || 0} target(s). Pure mouse-hover stage attachment still showed no visible tip delta in ${context.hoverStageDelta?.sampledTargets || 0} latest targets.`
          : (context.hoverPopupProbe?.hoverEventRecordCount > 0 || context.hoverPopupProbe?.mouseRecords > 0)
            ? "Laya mouse/hover event delivery and current rogue tooltip bindings are live-proven, but no popup method record was observed. A targeted card/skill popup hover is still needed for creation/cleanup proof."
            : "Laya mouse-move hover is not yet tied to a popup method record. A targeted card/skill popup hover is still needed for creation/cleanup proof."
    },
    {
      id: "buttons-clicks-ui",
      requirement: "按钮点击、游戏内 UI 点击、非购买自由探索",
      status: context.rogueActiveSample?.actionOk ? "live-proven" : "source-proven",
      monitorMethod: "Hook click/touch/confirm methods and block purchase-risk methods by default; for live clicks, record call chain and scene before/after.",
      triggerAndFields: `Purchase-risk blockers installed: ${hooks.blocked.join(", ") || "(none)"}. Rogue action inspect: fightWindows=${context.rogueActionSurface?.fightWindows || 0}, startBtnEvents=${(context.rogueActionSurface?.startBtnEvents || []).join(",") || "(none)"}. Active non-purchase sample: ok=${context.rogueActiveSample?.actionOk ? "yes" : "no"}, called=${context.rogueActiveSample?.called || ""}, protocol=${context.rogueActiveSample?.protocolId ?? ""}, eventId=${context.rogueActiveSample?.eventId ?? ""}, eventType=${context.rogueActiveSample?.eventType ?? ""}, fullMaskMs=${context.rogueActiveSample?.fullMaskMs ?? ""}, blockedPurchases=${context.rogueActiveSample?.purchaseBlockedCalls ?? ""}. Right-panel toggle sample: firstChanged=${context.rightPanelToggle?.judgement?.firstChanged ? "yes" : "no"}, secondChanged=${context.rightPanelToggle?.judgement?.secondChanged ? "yes" : "no"}, finalRestored=${context.rightPanelToggle?.judgement?.finalRestored ? "yes" : "no"}, eventMethod=${context.rightPanelToggle?.snapshots?.initial?.rightPanel?.toggleButtonEvents?.click?.[0]?.method || ""}. UI tab state report: attempts=${context.uiStateTransitionSample?.attempts ?? ""}, skipped=${context.uiStateTransitionSample?.skipped ?? ""}, directAllowed=${context.uiStateTransitionSample?.directEventAllowed ? "yes" : "no"}, selectTabAllowed=${context.uiStateTransitionSample?.selectTabAllowed ? "yes" : "no"}, finalSelected=${(context.uiStateTransitionSample?.finalSelected || []).join("/") || ""}; direct-event sample clicked=${context.uiStateDirectEventSample?.clicked ?? ""}, selectedChanged=${context.uiStateDirectEventSample?.selectedChanged ? "yes" : "no"}, proxyBlocked=${context.uiStateDirectEventSample?.proxyLBlockedCalls ?? ""}, sceneSwitchBlocked=${context.uiStateDirectEventSample?.sceneSwitchBlockedCalls ?? ""}. Current Rogue battle UI inspect: scene=${context.rogueGameSceneInspect?.scene || ""}, buttons=${context.rogueGameSceneInspect?.buttonNodes || 0}, cards=${context.rogueGameSceneInspect?.cardNodes || 0}, selectNodes=${context.rogueGameSceneInspect?.selectNodes || 0}, windows=${context.rogueGameSceneInspect?.windowNodes || 0}. Rogue action nodes=${context.rogueBattleActionSurface?.actionNodes || 0}, buttonNodes=${context.rogueBattleActionSurface?.buttonNodes || 0}, skillPanels=${context.rogueBattleActionSurface?.skillPanels || 0}, visibleWindows=${context.rogueBattleActionSurface?.visibleWindows || 0}. Prompt detail buttons=${context.rogueBattlePromptInspect?.visibleButtons || 0}, skills=${context.rogueBattlePromptInspect?.skillNodes || 0}, promptCandidates=${context.rogueBattlePromptInspect?.promptCandidates || 0}, currentRoundSeatID=${context.rogueBattlePromptInspect?.currentRoundSeatID ?? ""}. Current action handler report: nodes=${context.rogueCurrentActionHandlerReport?.nodeCount || 0}, eventNodes=${context.rogueCurrentActionHandlerReport?.eventNodeCount || 0}, handlers=${context.rogueCurrentActionHandlerReport?.eventHandlerCount || 0}, sendOrConfirm=${context.rogueCurrentActionHandlerReport?.sendOrConfirmHandlers || 0}, purchaseRisk=${context.rogueCurrentActionHandlerReport?.purchaseRiskHandlers || 0}. Skill-button detail: buttons=${(context.rogueCurrentSkillButtonDetailReport?.skillButtonTexts || []).join("/") || "(none)"}, currentPlayerAnchors=${context.rogueCurrentSkillButtonDetailReport?.currentPlayerAnchors || 0}, autoEvidence=${context.rogueCurrentSkillButtonDetailReport?.autoEvidenceRows || 0}, sendOrConfirm=${context.rogueCurrentSkillButtonDetailReport?.sendOrConfirmRows || 0}. Handler-field join: handlerRows=${context.rogueHandlerFieldJoinReport?.handlerRows || 0}, fieldRows=${context.rogueHandlerFieldJoinReport?.fieldRows || 0}, needsLiveWithHandlerEvidence=${context.rogueHandlerFieldJoinReport?.needsLiveRowsSampledByCurrentHandlers || 0}. ${currentWindowText} ${rogueEndedExitText} Auto-operation role surface: ${roleText(context.allNames, "auto-operation")} ${triggerSurfaceText(context, "button-ui-click")} ${triggerSurfaceText(context, "purchase-risk")}`,
      evidence: evidenceList([
        samplePath(context.surfaceMonitor),
        context.currentWindowAction?.path,
        context.uiStateTransitionSample?.path,
        context.uiStateDirectEventSample?.path,
        samplePath(context.rightPanelToggle),
        samplePath(context.currentBack),
        context.rogueBigmapConfirm?.path,
        context.rogueSelectGeneral?.path,
        samplePath(context.rogueCityClick),
        context.rogueActionSurface?.path,
        context.rogueActiveSample?.path,
        context.rogueGameSceneInspect?.path,
        context.rogueSkillZhanfaProbe?.path,
        context.rogueBattleActionSurface?.path,
        context.rogueBattlePromptInspect?.path,
        context.rogueCurrentActionHandlerReport?.mdPath,
        context.rogueCurrentActionHandlerReport?.nodesTsvPath,
        context.rogueCurrentActionHandlerReport?.handlersTsvPath,
        context.rogueCurrentSkillButtonDetailReport?.mdPath,
        context.rogueCurrentSkillButtonDetailReport?.focusNodesTsvPath,
        context.rogueCurrentSkillButtonDetailReport?.methodEvidenceTsvPath,
        context.rogueCurrentSkillButtonDetailReport?.eventHandlerEvidenceTsvPath,
        context.promptAutomationMonitor?.__path,
        context.rogueHandlerFieldJoinReport?.mdPath,
        context.rogueHandlerFieldJoinReport?.fieldJoinTsvPath,
        context.rogueHandlerFieldJoinReport?.handlerSurfaceTsvPath,
        context.rogueHandlerFieldJoinReport?.needsLiveStrengthenedTsvPath,
        context.rogueEndedExitReport?.path,
        context.triggerMonitoring?.playbookPath
      ]),
      remaining: context.rightPanelToggle?.judgement?.finalRestored
        ? "Right-panel toggle is the current safe default UI action sample; `current-back` is retained as transition evidence but is not a default safe-click path because it can emit a leave-table request. Purchase-like methods remain blocked unless explicitly allowed."
        : "Non-purchase clicks can be explored case by case; purchase-like methods remain blocked unless explicitly allowed."
    },
    {
      id: "effects-qifu-blocking",
      requirement: "弹出特效、祈福界面自动显示/屏蔽特效",
      status: (context.blessOpenSample?.blockedEffects > 0 || context.blessEffectBlockProbe?.directEffectOk)
        ? "live-proven"
        : (context.blessOpenSample?.openOk && context.blessOpenSample?.closeOk ? "partial-live-proven" : "needs-live-sample"),
      monitorMethod: "Hook `BlessNewWindow`/`BlessNewWindowView` `addEffect`, `effectStop`, `UpdateUpperCanvas`, `updateSkipAnim`, and close/destroy events; block draw/buy/shop methods.",
      triggerAndFields: `${roleText(context.allNames, "bless-qifu")} Bless open sample: open=${context.blessOpenSample?.openOk ? "yes" : "no"}, close=${context.blessOpenSample?.closeOk ? "yes" : "no"}, called=${context.blessOpenSample?.openCalled || ""}/${context.blessOpenSample?.closeCalled || ""}, window=${context.blessOpenSample?.windowName || ""}, records=${context.blessOpenSample?.records ?? ""}, blockedCalls=${context.blessOpenSample?.blockedCalls ?? ""}, blockedEffects=${context.blessOpenSample?.blockedEffects ?? ""}, finalVisible=${context.blessOpenSample?.visibleBlessWindows ?? ""}. Effect-block probe: openedByProbe=${context.blessEffectBlockProbe?.openedByProbe ? "yes" : "no"}, directAddEffect=${context.blessEffectBlockProbe?.directEffectOk ? "blocked" : "missing"}, blockedDelta=${context.blessEffectBlockProbe?.blockedDelta ?? ""}, blockedEffects=${context.blessEffectBlockProbe?.blockedEffects ?? ""}, blockedCalls=${context.blessEffectBlockProbe?.blockedCalls ?? ""}, finalVisible=${context.blessEffectBlockProbe?.visibleBlessWindows ?? ""}. ${currentWindowText} ${triggerSurfaceText(context, "bless-qifu")} ${triggerSurfaceText(context, "effect-animation")} ${liveGapText}`,
      evidence: evidenceList([
        context.blessOpenSample?.path,
        context.blessEffectBlockProbe?.path,
        context.currentWindowAction?.path,
        samplePath(context.blessClose),
        samplePath(context.surfaceMonitor),
        context.liveGapWatch?.path,
        context.allNames?.paths.methodRoleIndex,
        context.triggerMonitoring?.indexPath
      ]),
      remaining: (context.blessOpenSample?.blockedEffects > 0 || context.blessEffectBlockProbe?.directEffectOk)
        ? "Open, close, and addEffect blocking are live-sampled without draw/buy/shop calls; natural draw-response animation variants remain gated by free-branch proof or explicit permission."
        : (context.blessOpenSample?.openOk && context.blessOpenSample?.closeOk
            ? "Open/close lifecycle is live-proven without purchase/draw side effects; actual `addEffect` blocking still needs a sample where Bless animation is triggered."
            : "Close and method sources are proved; live QiFu open/effect-block behavior still needs a non-purchase sample.")
    },
    {
      id: "rogue-overlays-shop-auto-skill",
      requirement: "山河图辅助 UI、自动确认技能使用、自动使用技能、商店/地图对象读取",
      status: "live-proven",
      monitorMethod: "Use visible `RogueSmallMapScene -> PveMgr -> cityView/ShopData`; overlay labels are noninteractive; request shop data through `RogueLikeDataReq(16)`; monitor Rogue fight/skill methods and `RogueLikeGameScene` battle UI without purchase.",
      triggerAndFields: `Old-script behavior groups: ${oldGroupText.join("; ") || "(none)"}; latest shop data and city click samples are saved. BigMap warning confirm: ok=${context.rogueBigmapConfirm?.actionOk ? "yes" : "no"}, called=${context.rogueBigmapConfirm?.called || ""}, buttons=${(context.rogueBigmapConfirm?.buttonLabels || []).join("/") || "(none)"}, callback=${context.rogueBigmapConfirm?.okCallbackSource || ""}. Select-general confirm: ok=${context.rogueSelectGeneral?.actionOk ? "yes" : "no"}, general=${context.rogueSelectGeneral?.selectedGeneralId ?? ""}, protocol=${(context.rogueSelectGeneral?.proxyProtocols || []).join(",") || ""}, switch=${context.rogueSelectGeneral?.switchScene || ""}. Rogue action inspect: scene=${context.rogueActionSurface?.scene || ""}, fightId=${context.rogueActionSurface?.fightId ?? ""}, bottomSkillButtons=${context.rogueActionSurface?.bottomSkillButtons || 0}, zhanfaButtons=${context.rogueActionSurface?.zhanfaButtons || 0}, PveMgr.RogueLikeEventSelectReq=${context.rogueActionSurface?.pveMgrHasEventSelectReq ? "present" : "missing"}. Active fight confirm: ok=${context.rogueActiveSample?.actionOk ? "yes" : "no"}, called=${context.rogueActiveSample?.called || ""}, protocol=${context.rogueActiveSample?.protocolId ?? ""}, eventId=${context.rogueActiveSample?.eventId ?? ""}, eventType=${context.rogueActiveSample?.eventType ?? ""}, afterScene=${context.rogueActiveSample?.afterScene || ""}. Delayed battle scene proof: scene=${context.rogueGameSceneInspect?.scene || ""}, manager=${context.rogueGameSceneInspect?.managerCtor || ""}, seats=${context.rogueGameSceneInspect?.seatCount ?? ""}, self=${context.rogueGameSceneInspect?.selfSeatIndex ?? ""}, roleSpellInterfaces=${context.rogueGameSceneInspect?.roleSpellInterfaces ?? ""}, moveFuncs=${context.rogueGameSceneInspect?.moveFromFuncs ?? ""}/${context.rogueGameSceneInspect?.moveToFuncs ?? ""}. Rogue battle action surface: skillPanels=${context.rogueBattleActionSurface?.skillPanels || 0}, handAreas=${context.rogueBattleActionSurface?.handAreas || 0}, cardUiNodes=${context.rogueBattleActionSurface?.cardUiNodes || 0}, GameResultWindow=${context.rogueBattleActionSurface?.hasGameResultWindow ? "yes" : "no"}. ${rogueEndedExitText} Prompt detail: selfHand=${context.rogueBattlePromptInspect?.selfHandCards ?? ""}, selectAreas=${context.rogueBattlePromptInspect?.selectAreas || 0}, buttons=${context.rogueBattlePromptInspect?.visibleButtons || 0}, promptCandidates=${context.rogueBattlePromptInspect?.promptCandidates || 0}, classSendMethods SelectCard=${context.rogueBattlePromptInspect?.selectCardWindowMethods || 0}/SpellMulti=${context.rogueBattlePromptInspect?.spellMultiSelectorWindowMethods || 0}. ${promptAutomationText} Current action handlers: scene=${context.rogueCurrentActionHandlerReport?.scene || ""}, gameOver=${context.rogueCurrentActionHandlerReport?.isGameOver ? "yes" : "no"}, nodes=${context.rogueCurrentActionHandlerReport?.nodeCount || 0}, skill=${context.rogueCurrentActionHandlerReport?.actionNodeTypeCounts?.skill || 0}, hover=${context.rogueCurrentActionHandlerReport?.actionNodeTypeCounts?.["hover-tooltip"] || 0}, cardSelection=${context.rogueCurrentActionHandlerReport?.actionNodeTypeCounts?.["card-selection"] || 0}, handlers=${context.rogueCurrentActionHandlerReport?.eventHandlerCount || 0}, sendOrConfirm=${context.rogueCurrentActionHandlerReport?.sendOrConfirmHandlers || 0}, purchaseRisk=${context.rogueCurrentActionHandlerReport?.purchaseRiskHandlers || 0}. Handler-field join: fieldRows=${context.rogueHandlerFieldJoinReport?.fieldRows || 0}, triageMatched=${context.rogueHandlerFieldJoinReport?.triageMatchedFields || 0}, needsLiveWithHandlerEvidence=${context.rogueHandlerFieldJoinReport?.needsLiveRowsSampledByCurrentHandlers || 0}. Rogue skill/zhanfa classes: ChangeSkill=${context.rogueSkillZhanfaProbe?.changeSkillMethods || 0}, ChangeZhanFa=${context.rogueSkillZhanfaProbe?.changeZhanFaMethods || 0}, SkillBiFaRogue=${context.rogueSkillZhanfaProbe?.skillBiFaRogueMethods || 0}. Rogue tooltip inspect: nodes=${context.rogueTooltipInspect?.inspectedNodes || 0}, tooltipNodes=${context.rogueTooltipInspect?.tooltipNodes || 0}, RogueFightWindow methods=${context.rogueTooltipInspect?.rogueFightMethods || 0}. ${triggerSurfaceText(context, "rogue")}`,
      evidence: evidenceList([
        context.rogueBigmapConfirm?.path,
        context.rogueSelectGeneral?.path,
        samplePath(context.rogueScan),
        samplePath(context.rogueShopRequest),
        samplePath(context.rogueCityClick),
        context.rogueActionSurface?.path,
        context.rogueActiveSample?.path,
        context.rogueGameSceneInspect?.path,
        context.rogueSkillZhanfaProbe?.path,
        context.rogueBattleActionSurface?.path,
        context.rogueBattlePromptInspect?.path,
        context.rogueCurrentActionHandlerReport?.mdPath,
        context.rogueCurrentActionHandlerReport?.nodesTsvPath,
        context.rogueCurrentActionHandlerReport?.handlersTsvPath,
        context.rogueHandlerFieldJoinReport?.mdPath,
        context.rogueHandlerFieldJoinReport?.fieldJoinTsvPath,
        context.rogueHandlerFieldJoinReport?.handlerSurfaceTsvPath,
        context.rogueHandlerFieldJoinReport?.needsLiveStrengthenedTsvPath,
        context.rogueTooltipInspect?.path,
        context.rogueEndedExitReport?.path,
        context.oldScriptMap?.mdPath,
        samplePath(context.surfaceMonitor),
        context.triggerMonitoring?.indexPath
      ]),
      remaining: context.rogueActiveSample?.actionOk
        ? "Fight confirm is now active-sampled through `checkStart -> startbtnClick -> PveMgr.RogueLikeEventSelectReq -> proxy.L`; delayed `RogueLikeGameScene` entry and prompt automation hooks are inspected. Individual rogue skill auto-use/selection prompts still need per-skill active samples before unattended use."
        : "Fight confirm and current button surfaces are live-inspected without clicking; individual rogue skill auto-confirm/active-use samples should still be recorded before enabling unattended use."
    },
    {
      id: "kanshu",
      requirement: "发财树/KanShu 窗口、状态、自动动作路径",
      status: "live-proven",
      monitorMethod: "Find `KanShuWindow/wXi`, read `jbpUserData` and `jbpawardVo`, then only call reward path when free branch is proven or explicitly allowed.",
      triggerAndFields: `Current sample reads hidden-window state; pay methods are blocked by monitor. ${triggerSurfaceText(context, "kanshu")}`,
      evidence: evidenceList([
        samplePath(context.kanshuState),
        samplePath(context.surfaceMonitor),
        context.triggerMonitoring?.indexPath
      ]),
      remaining: "Reward claim action remains gated by free-branch proof or explicit allow-buy/payment permission."
    },
    {
      id: "shen-zhuge-qixing",
      requirement: "旧脚本中关于神诸葛/七星弹窗中的牌，公开武将牌/牌堆顶逻辑",
      status: (context.qixingWatch?.visibleTargetWindows > 0 && (context.qixingWatch?.visibleWindowCards > 0 || context.qixingWatch?.publicGeneralCards > 0))
        ? "partial-live-proven"
        : "needs-live-sample",
      monitorMethod: "Hook `GuanXing*` and `QiXing/QiXingWindow`, combine public-general/runtime field inspection with tracker public-zone rules; never infer hidden hand content.",
      triggerAndFields: `Source classes and skill audit are mapped; public-general cards must be proved through visible runtime/protocol/log fields. Qixing watcher: scene=${context.qixingWatch?.scene || ""}, wrappers=${context.qixingWatch?.wrappers ?? ""}, records=${context.qixingWatch?.records ?? ""}, QiXing=${context.qixingWatch?.qixingExists ? "present" : "missing"}, QiXingWindow=${context.qixingWatch?.qixingWindowExists ? `${context.qixingWatch.qixingWindowMethods} methods` : "missing"}, GuanXingWindow=${context.qixingWatch?.guanXingWindowExists ? `${context.qixingWatch.guanXingWindowMethods} methods` : "missing"}, visibleWindows=${context.qixingWatch?.visibleTargetWindows ?? ""}, visibleWindowCards=${context.qixingWatch?.visibleWindowCards ?? ""}, publicGeneralCards=${context.qixingWatch?.publicGeneralCards ?? ""}, blockedSends=${context.qixingWatch?.blockedSends ?? ""}. ${triggerSurfaceText(context, "qixing-shen-zhuge")} ${liveGapText}`,
      evidence: evidenceList([
        context.qixingWatch?.path,
        context.allNames?.paths.methodRoleIndex,
        samplePath(context.surfaceMonitor),
        context.liveGapWatch?.path,
        context.oldScriptMap?.mdPath,
        context.triggerMonitoring?.indexPath
      ]),
      remaining: (context.qixingWatch?.visibleTargetWindows > 0 && (context.qixingWatch?.visibleWindowCards > 0 || context.qixingWatch?.publicGeneralCards > 0))
        ? "Watcher has live window/card evidence; cleanup lifecycle and protocol/public-general reconciliation still need follow-up before marking complete."
        : "Watcher is implemented and class hooks are live-installed; still needs a real Qixing/Shen Zhuge popup sample proving exact public-general fields and cleanup lifecycle."
    },
    {
      id: "yanjiao-list-allocation",
      requirement: "严教窗口右侧候选列表、点击列表自动分配牌到对应状态",
      status: context.yanJiaoCandidateReport?.watcherLiveInstallable || context.yanJiaoListWatch?.wrappers > 0 ? "partial-live-proven" : (context.yanJiaoReport ? "source-proven" : "missing"),
      monitorMethod: "Hook `YanJiaoWindow.showWindow/genSplitCard/showSplitCard/layoutCardUIs/updateAutoChooseSatate/send*`; add a Laya child list under the window for clickable rows.",
      triggerAndFields: context.yanJiaoReport
        ? `YanJiao methods=${context.yanJiaoReport.skillMethods}; YanJiaoWindow methods=${context.yanJiaoReport.windowMethods}; skill audit rows=${context.yanJiaoReport.skillAuditRows}. Candidate-list implementation=${context.yanJiaoCandidateReport?.level || ""}, method rows=${context.yanJiaoCandidateReport?.methodRows ?? ""}, field rows=${context.yanJiaoCandidateReport?.fieldRows ?? ""}, flow steps=${context.yanJiaoCandidateReport?.flowSteps ?? ""}, preview click=${(context.yanJiaoCandidateReport?.implementationContract?.previewClick || []).join(" -> ") || "showSplitCard(index) -> layoutCardUIs(true)"}. Watcher class=${context.yanJiaoListWatch?.classExists ? "present" : "missing"}, function=${context.yanJiaoListWatch?.functionName || ""}, wrappers=${context.yanJiaoListWatch?.wrappers || 0}, windows=${context.yanJiaoListWatch?.windows || 0}, renderRecords=${context.yanJiaoListWatch?.renderRecords || 0}, previewOnly=${context.yanJiaoListWatch?.previewOnly !== false ? "yes" : "no"}, restoredWrappers=${context.yanJiaoListWatch?.restoredWrappers ?? ""}. ${triggerSurfaceText(context, "yanjiao")} ${liveGapText}`
        : "No YanJiao report found.",
      evidence: evidenceList([
        context.yanJiaoCandidateReport?.mdPath,
        context.yanJiaoCandidateReport?.flowTsvPath,
        context.yanJiaoCandidateReport?.methodEvidenceTsvPath,
        context.yanJiaoCandidateReport?.fieldActionMapTsvPath,
        context.yanJiaoReport?.mdPath,
        context.yanJiaoListWatch?.path,
        samplePath(context.surfaceMonitor),
        context.liveGapWatch?.path,
        context.triggerMonitoring?.indexPath
      ]),
      remaining: context.yanJiaoCandidateReport?.watcherLiveInstallable || context.yanJiaoListWatch?.wrappers > 0
        ? "Right-side candidate-list watcher is live-installable and restored cleanly; a real YanJiao window sample is still needed to prove in-window coordinates, row clicks, and split preview behavior."
        : "Implementation design is source-proven; a live YanJiao window sample would prove rendering coordinates and click behavior."
    },
    {
      id: "resource-drawing-replacement",
      requirement: "资源文件描画与本地/网络资源替换方案",
      status: context.resourceReplacementProbe?.drawOk && context.resourceReplacementProbe?.formatURLResult && context.resourceLoadSchemeProof?.allLoaded ? "live-proven" : "source-proven",
      monitorMethod: "Draw through Laya Image/Graphics/Loader; replace by wrapping `Laya.ResourceVersion.addVersionPrefix` or `Laya.URL.customFormat` before URL formatting.",
      triggerAndFields: `Current manifest is path -> version, not id -> file; an id111-style value must first be resolved from config/runtime/default.res.json to the logical path such as res/.../a.png. live resourceVersion=${context.resourceReplacementProbe?.resourceVersion || ""}, Laya=${context.resourceReplacementProbe?.layaVersion || ""}, manifestSize=${context.resourceReplacementProbe?.manifestSize ?? ""}, drawOk=${context.resourceReplacementProbe?.drawOk ? "yes" : "no"}, customFormat=${context.resourceReplacementProbe?.customFormatType || ""}, addVersionPrefix=${context.resourceReplacementProbe?.addVersionPrefix ? "present" : "missing"}, formatURL=${context.resourceReplacementProbe?.formatURLResult || ""}. Load schemes: file=${context.resourceLoadSchemeProof?.results?.["file-url"] || ""}, localHttp=${context.resourceLoadSchemeProof?.results?.["local-http"] || ""}, sameOriginHttps=${context.resourceLoadSchemeProof?.results?.["same-origin-https"] || ""}, data=${context.resourceLoadSchemeProof?.results?.["data-url"] || ""}. For reproducible local replacement prefer local HTTP/CORS, data/blob, or request fulfill; network HTTPS must satisfy browser/Laya image loading. ${triggerSurfaceText(context, "resource-drawing")}`,
      evidence: evidenceList([
        path.join(explorationRoot, "resource-drawing-and-replacement.md"),
        context.resourceReplacementProbe?.path,
        context.resourceLoadSchemeProof?.path,
        context.triggerMonitoring?.indexPath
      ]),
      remaining: "Recheck current `window.resourceVersion`, manifest shape, and hook relation before using this against a drifted live page; already-loaded nodes may need cache clear/recreate."
    },
    {
      id: "old-script-behavior-map",
      requirement: "旧脚本行为：记牌器、山河图、祈福、按钮、特效屏蔽、自动显示 UI",
      status: context.oldScriptMap ? "source-proven" : "missing",
      monitorMethod: "Use backed-up scripts as reference only; map each behavior to CDP/Laya runtime nodes and method hooks, not console output.",
      triggerAndFields: context.oldScriptMap
        ? `${context.oldScriptMap.scripts} scripts, ${context.oldScriptMap.behaviors} behavior groups, ${context.oldScriptMap.methods} methods indexed.`
        : "No old-script map found.",
      evidence: evidenceList([
        context.oldScriptMap?.mdPath
      ]),
      remaining: "Old scripts are not authoritative for hidden card facts; live/runtime verification is required before porting behavior."
    }
  ];
}

function roleText(allNames, role) {
  const row = allNames?.roles?.[role];
  if (!row) return `${role}: no role index found.`;
  return `${role}: ${row.classes} classes / ${row.methods} methods.`;
}

function triggerSurfaceText(context, surface) {
  const row = context.triggerMonitoring?.surfaces?.[surface];
  if (!row) return `${surface}: no trigger-monitoring row found.`;
  return `${surface}: ${row.classCount || 0} classes / ${row.methodCount || 0} methods; purchase-risk=${row.purchaseRiskCount || 0}.`;
}

function statusCounts(requirements) {
  const out = {};
  for (const item of requirements) out[item.status] = (out[item.status] || 0) + 1;
  return out;
}

function buildMonitorRows(context) {
  const hooks = context.surfaceHooks.installedClasses || [];
  return [
    {
      surface: "Laya.ClassUtils registry / stable entry names",
      hooks: "`Laya.ClassUtils` own keys plus `_classMap[registeredName]` entries, alias groups, prototype method signatures, static fields, and source hashes.",
      proof: evidenceList([
        context.classUtilsInspect?.mdPath,
        context.classUtilsInspect?.entriesTsvPath,
        context.classUtilsInspect?.aliasGroupsTsvPath,
        context.allNames?.paths.classesTsv
      ]).join("; "),
      caveat: context.classUtilsInspect
        ? `Current live registry has ${context.classUtilsInspect.classMapCount} entries and ${context.classUtilsInspect.classUtilsKeys} ClassUtils keys; re-run after a page/resource version change and compare by registered string before constructor name.`
        : "ClassUtils live registry inspect is not captured."
    },
    {
      surface: "Semantic inheritance / enum constants",
      hooks: "Saved source chunks for static descriptor primitive values plus all-names inherited method owner prefixes; no live action required.",
      proof: evidenceList([
        context.semanticInheritance?.mdPath,
        context.semanticInheritance?.enumValuesTsv,
        context.semanticInheritance?.classInheritanceTsv,
        context.semanticInheritance?.fieldOwnerTsv,
        context.liveObjectState?.mdPath,
        context.liveObjectState?.fieldSamplesTsv,
        context.liveFieldSourceJoin?.mdPath,
        context.liveFieldSourceJoin?.tsvPath,
        context.liveFieldGapReport?.mdPath,
        context.liveFieldGapReport?.worklistTsvPath,
        context.liveFieldGapTriageReport?.mdPath,
        context.liveFieldGapTriageReport?.triageTsvPath,
        context.liveFieldGapTriageReport?.bucketSummaryTsvPath,
        context.liveOwnerSourceReport?.mdPath,
        context.liveOwnerSourceReport?.fieldMethodRefsTsvPath,
        context.liveFieldSemanticsReport?.mdPath,
        context.liveFieldSemanticsReport?.tsvPath,
        context.liveFieldSemanticsReport?.methodEvidenceTsvPath
      ]).join("; "),
      caveat: context.liveObjectState
        ? (context.liveFieldSourceJoin
            ? `Exact constants are capture-stable; latest live sample covers ${context.liveObjectState.sampleCount || 0} objects / ${context.liveObjectState.fieldRows || 0} fields and joins ${context.liveFieldSourceJoin.sourceMatchedRows || 0} source-matched rows / ${context.liveFieldSourceJoin.exactMatches || 0} owner+field rows in ${context.liveFieldSourceJoin.scene || context.liveObjectState.scene || "current scene"}; live owner source refs add ${context.liveOwnerSourceReport?.targetsWithFieldRefs || 0} target owners / ${context.liveOwnerSourceReport?.fieldRefMethods || 0} field-ref methods; field semantics add ${context.liveFieldSemanticsReport?.fieldRows || 0} rows / ${context.liveFieldSemanticsReport?.highConfidenceRows || 0} high-confidence; ${context.liveFieldGapReport?.weakRows ?? "unknown"} deduped weak fields are triaged into ${context.liveFieldGapTriageReport?.explainedRows ?? "unknown"} explained/generic and ${context.liveFieldGapTriageReport?.needsLiveRows ?? "unknown"} needs-live rows.`
            : `Exact constants are capture-stable; latest live state sample covers ${context.liveObjectState.sampleCount || 0} objects / ${context.liveObjectState.fieldRows || 0} fields in ${context.liveObjectState.scene || "current scene"}, but other scenes/events still need targeted samples.`)
        : "Exact constants are capture-stable; live-only object state still needs CDP samples."
    },
    {
      surface: "Event-field transition watcher",
      hooks: "Reversible before/after wrappers on GED/proxy/window handlers, key prompt/window classes, current visible battle UI instances, and filtered Laya EventDispatcher events; records safe field diffs plus scene/window/prompt context diffs.",
      proof: evidenceList([
        context.eventFieldTransitionWatch?.mdPath,
        context.eventFieldTransitionWatch?.recordsTsvPath,
        context.liveGapWatch?.path,
        context.fieldSemanticIndexReport?.unresolvedTsvPath
      ]).join("; "),
      caveat: context.eventFieldTransitionWatch
        ? `Latest run installed ${context.eventFieldTransitionWatch.wrappers} wrappers, captured ${context.eventFieldTransitionWatch.records} records / ${context.eventFieldTransitionWatch.changedRecords} changed records in ${context.eventFieldTransitionWatch.scene || "current scene"}, and blocked ${context.eventFieldTransitionWatch.blockedCalls} purchase-like calls. More scene/window/prompt activity is still needed to fill needs-live transition rows.`
        : "Run runtime-event-field-transition-watch.mjs during scene/window/prompt activity to capture field value transitions."
    },
    {
      surface: "Active operation field transition join",
      hooks: "Offline join from active-operation recorder records to unresolved-field-priority rows; extracts method calls, selected-card/target before-after state, scene prompt changes, and safe card argument fields.",
      proof: evidenceList([
        context.activeOperationFieldTransitionReport?.mdPath,
        context.activeOperationFieldTransitionReport?.coveredTsvPath,
        context.activeOperationFieldTransitionReport?.uncoveredTsvPath,
        context.activeOperationFieldTransitionReport?.evidenceTsvPath,
        context.activeOperation?.mdPath,
        context.activeOperation?.tsvPath,
        context.fieldSemanticIndexReport?.unresolvedTsvPath
      ]).join("; "),
      caveat: context.activeOperationFieldTransitionReport
        ? `Latest offline join scanned ${context.activeOperationFieldTransitionReport.recordsScanned} active records, produced ${context.activeOperationFieldTransitionReport.evidenceRows} evidence rows, covered ${context.activeOperationFieldTransitionReport.coveredUnresolvedRows} unresolved row(s), exact=${context.activeOperationFieldTransitionReport.coveredByStrength.exact || 0}, and left ${context.activeOperationFieldTransitionReport.uncoveredUnresolvedRows} uncovered row(s). Field-surface matches are weaker than exact owner matches.`
        : "Run runtime-active-operation-field-transition-report.mjs after capturing an active-operation dump."
    },
    {
      surface: "Residual field source join",
      hooks: "Offline join from active-operation uncovered rows to field-semantic-index, live-field semantics, source method evidence, current handler/event fields, and trigger-monitoring hooks.",
      proof: evidenceList([
        context.residualFieldSourceReport?.mdPath,
        context.residualFieldSourceReport?.tsvPath,
        context.residualFieldSourceReport?.bucketTsvPath,
        context.activeOperationFieldTransitionReport?.uncoveredTsvPath,
        context.fieldSemanticIndexReport?.fieldIndexTsvPath,
        context.liveFieldSemanticsReport?.tsvPath,
        context.triggerMonitoring?.indexPath
      ]).join("; "),
      caveat: context.residualFieldSourceReport
        ? `Latest residual join scanned ${context.residualFieldSourceReport.uncoveredRows} active-uncovered row(s), found owner+field evidence for ${context.residualFieldSourceReport.rowsWithEvidence}, left ${context.residualFieldSourceReport.rowsMissingEvidence} without owner+field evidence, and grouped grades as ${context.residualFieldSourceReport.evidenceGrades.join(",") || "(none)"}. Semantic-index rows still need live value-transition samples when automation depends on exact state changes.`
        : "Run runtime-residual-field-source-report.mjs after active-operation field transition reporting."
    },
    {
      surface: "Entry evidence catalog",
      hooks: "Offline catalog joining ClassUtils registered entries, alias groups, field semantic rows, trigger-monitoring rows, and residual field-source rows; runtime-only owners are recorded as synthetic runtime entries.",
      proof: evidenceList([
        context.entryEvidenceCatalogReport?.mdPath,
        context.entryEvidenceCatalogReport?.entrySummaryTsvPath,
        context.entryEvidenceCatalogReport?.fieldEvidenceTsvPath,
        context.entryEvidenceCatalogReport?.triggerEvidenceTsvPath,
        context.entryEvidenceCatalogReport?.residualEvidenceTsvPath,
        context.entryEvidenceCatalogReport?.unmatchedEvidenceTsvPath
      ]).join("; "),
      caveat: context.entryEvidenceCatalogReport
        ? `Latest catalog has ${context.entryEvidenceCatalogReport.catalogEntries} entries (${context.entryEvidenceCatalogReport.registeredEntries} registered + ${context.entryEvidenceCatalogReport.syntheticRuntimeOwnerEntries} synthetic runtime owners), matched fields=${context.entryEvidenceCatalogReport.matchedFieldRows}/${context.entryEvidenceCatalogReport.fieldSemanticRows}, triggers=${context.entryEvidenceCatalogReport.matchedTriggerRows}/${context.entryEvidenceCatalogReport.triggerMonitoringRows}, residual=${context.entryEvidenceCatalogReport.matchedResidualRows}/${context.entryEvidenceCatalogReport.residualFieldRows}, unmatched=${context.entryEvidenceCatalogReport.unmatchedFieldRows + context.entryEvidenceCatalogReport.unmatchedTriggerRows + context.entryEvidenceCatalogReport.unmatchedResidualRows}.`
        : "Run runtime-entry-evidence-catalog-report.mjs after field semantic, trigger monitoring, and residual source reports."
    },
    {
      surface: "Mechanism implementation atlas",
      hooks: "Offline target-surface atlas joining entry catalog, trigger-monitoring methods, field meanings, old-script behavior links, and objective coverage statuses.",
      proof: evidenceList([
        context.mechanismImplementationAtlasReport?.mdPath,
        context.mechanismImplementationAtlasReport?.summaryTsvPath,
        context.mechanismImplementationAtlasReport?.triggerMethodsTsvPath,
        context.mechanismImplementationAtlasReport?.fieldMeaningsTsvPath,
        context.mechanismImplementationAtlasReport?.oldScriptLinksTsvPath
      ]).join("; "),
      caveat: context.mechanismImplementationAtlasReport
        ? `Latest atlas maps ${context.mechanismImplementationAtlasReport.mechanisms} mechanism surfaces, ${context.mechanismImplementationAtlasReport.mappedTriggerRows}/${context.mechanismImplementationAtlasReport.triggerEvidenceRows} trigger rows, ${context.mechanismImplementationAtlasReport.mappedFieldRows} field rows, and ${context.mechanismImplementationAtlasReport.oldScriptRows} old-script behavior links; needsLive=${context.mechanismImplementationAtlasReport.needsLiveRows}, permissionGated=${context.mechanismImplementationAtlasReport.permissionGatedRows}, purchaseRisk=${context.mechanismImplementationAtlasReport.purchaseRiskRows}.`
        : "Run runtime-mechanism-implementation-atlas-report.mjs after the entry evidence catalog is current."
    },
    {
      surface: "Goal completion audit",
      hooks: "Strict completion audit over the original objective, objective coverage, mechanism atlas, entry catalog, remaining audit, and live-proof playbook.",
      proof: evidenceList([
        context.goalCompletionAuditReport?.mdPath,
        context.goalCompletionAuditReport?.auditTsvPath,
        context.goalCompletionAuditReport?.blockersTsvPath,
        context.goalCompletionAuditReport?.remainingLiveProofTsvPath
      ]).join("; "),
      caveat: context.goalCompletionAuditReport
        ? `Latest audit says complete=${context.goalCompletionAuditReport.goalComplete ? "yes" : "no"}, requirements=${context.goalCompletionAuditReport.requirements}, blockers=${context.goalCompletionAuditReport.blockerRows}, incomplete=${context.goalCompletionAuditReport.incompleteRows}, remainingLiveProofRows=${context.goalCompletionAuditReport.remainingLiveProofRows}, blockerLevels=${context.goalCompletionAuditReport.blockerProofLevels || "(none)"}.`
        : "Run runtime-goal-completion-audit-report.mjs after objective coverage, mechanism atlas, and entry catalog are current."
    },
    {
      surface: "Blocker capture plan",
      hooks: "Turns the latest completion blockers and remaining-live-proof rows into pre-arm, during-action, cleanup, and post-derive command batches for the next real sample.",
      proof: evidenceList([
        context.blockerCapturePlanReport?.mdPath,
        context.blockerCapturePlanReport?.sessionsTsvPath,
        context.blockerCapturePlanReport?.commandsTsvPath
      ]).join("; "),
      caveat: context.blockerCapturePlanReport
        ? `Latest plan has ${context.blockerCapturePlanReport.blockerSessions} capture session(s), ${context.blockerCapturePlanReport.commandRows} command row(s), missingScripts=${context.blockerCapturePlanReport.missingScripts}, manualTriggerSessions=${context.blockerCapturePlanReport.manualTriggerSessions}, purchaseSensitiveCommands=${context.blockerCapturePlanReport.purchaseSensitiveCommands}.`
        : "Run runtime-blocker-capture-plan-report.mjs after the strict completion audit."
    },
    {
      surface: "Blocker capture runner",
      hooks: "Executes selected blocker-capture command batches from the latest plan by preset, session, requirement, case, and phase; writes per-command stdout/stderr logs and exit-code TSV.",
      proof: evidenceList([
        context.blockerCaptureRunnerReport?.mdPath,
        context.blockerCaptureRunnerReport?.commandsTsvPath
      ]).join("; "),
      caveat: context.blockerCaptureRunnerReport
        ? `Latest runner report phase=${context.blockerCaptureRunnerReport.phase}, dryRun=${context.blockerCaptureRunnerReport.dryRun ? "yes" : "no"}, detach=${context.blockerCaptureRunnerReport.detach ? "yes" : "no"}, armFast=${context.blockerCaptureRunnerReport.armFast ? "yes" : "no"}, commands=${context.blockerCaptureRunnerReport.commands}, executed=${context.blockerCaptureRunnerReport.executed}, detached=${context.blockerCaptureRunnerReport.detached}, ok=${context.blockerCaptureRunnerReport.ok}, failed=${context.blockerCaptureRunnerReport.failed}, timedOut=${context.blockerCaptureRunnerReport.timedOut}, missingScripts=${context.blockerCaptureRunnerReport.missingScripts}.`
        : "Use runtime-blocker-capture-runner.mjs --list or --dry-run to verify the next command batch before a live sample."
    },
    {
      surface: "Blocker capture readiness",
      hooks: "Read-only CDP/Laya check of watcher globals and current Laya.stage scene state after pre-arm; calls status() only and writes watcher/scene TSV evidence.",
      proof: evidenceList([
        context.blockerCaptureReadinessReport?.mdPath,
        context.blockerCaptureReadinessReport?.watchersTsvPath,
        context.blockerCaptureReadinessReport?.scenesTsvPath
      ]).join("; "),
      caveat: context.blockerCaptureReadinessReport
        ? `Latest readiness says cdpAvailable=${context.blockerCaptureReadinessReport.cdpAvailable ? "yes" : "no"}, battlePreArmReady=${context.blockerCaptureReadinessReport.battlePreArmReady ? "yes" : "no"}, readyWatchers=${context.blockerCaptureReadinessReport.readyWatchers}/${context.blockerCaptureReadinessReport.watchers}, stagePresent=${context.blockerCaptureReadinessReport.stagePresent ? "yes" : "no"}, scenes=${context.blockerCaptureReadinessReport.scenes}, missingRequired=${context.blockerCaptureReadinessReport.missingRequired.join("/") || "(none)"}.`
        : "Run runtime-blocker-capture-readiness-report.mjs after fast pre-arm to confirm the page is actually armed."
    },
    {
      surface: "Blocker capture arm-verify",
      hooks: "One-command pre-arm plus immediate read-only readiness verification; use this before the next battle and only proceed when summary.ready is true.",
      proof: evidenceList([
        context.blockerCaptureArmVerifyReport?.mdPath,
        context.blockerCaptureArmVerifyReport?.stepsTsvPath
      ]).join("; "),
      caveat: context.blockerCaptureArmVerifyReport
        ? `Latest arm-verify says ready=${context.blockerCaptureArmVerifyReport.ready ? "yes" : "no"}, dryRun=${context.blockerCaptureArmVerifyReport.dryRun ? "yes" : "no"}, runner=${context.blockerCaptureArmVerifyReport.runnerStatus || "(none)"}, readiness=${context.blockerCaptureArmVerifyReport.readinessStatus || "(none)"}, cdpAvailable=${context.blockerCaptureArmVerifyReport.cdpAvailable ? "yes" : "no"}, battlePreArmReady=${context.blockerCaptureArmVerifyReport.battlePreArmReady ? "yes" : "no"}, readyWatchers=${context.blockerCaptureArmVerifyReport.readyWatchers}/${context.blockerCaptureArmVerifyReport.watchers}, missingRequired=${context.blockerCaptureArmVerifyReport.missingRequired.join("/") || "(none)"}.`
        : "Run runtime-blocker-capture-arm-verify.mjs --preset battle --readiness-wait-ms 3000 before asking the user to enter the next battle."
    },
    {
      surface: "Live proof playbook",
      hooks: "Field-level unresolved-row playbook joined from the goal remaining audit and unresolved-field priority TSV; maps each row to activation signal, success evidence, safe boundary, and commands.",
      proof: evidenceList([
        context.liveProofPlaybookReport?.mdPath,
        context.liveProofPlaybookReport?.playbookTsvPath,
        context.liveProofPlaybookReport?.caseSummaryTsvPath,
        context.goalRemainingAuditReport?.mdPath,
        context.fieldSemanticIndexReport?.unresolvedTsvPath
      ]).join("; "),
      caveat: context.liveProofPlaybookReport
        ? `Latest playbook maps ${context.liveProofPlaybookReport.playbookRows} unresolved rows across ${context.liveProofPlaybookReport.caseCount} residual cases; needsLive=${context.liveProofPlaybookReport.needsLiveRows}; permissionGated=${context.liveProofPlaybookReport.permissionGatedRows}; topCases=${context.liveProofPlaybookReport.topCases.join(",") || "(none)"}.`
        : "Run runtime-live-proof-playbook-report.mjs after regenerating the remaining audit."
    },
    {
      surface: "Unified trigger monitoring matrix",
      hooks: "Stable hook targets generated from all-source method context as `Laya.ClassUtils._classMap[registeredName].prototype[method]`; purchase-risk rows are blocked by default.",
      proof: evidenceList([
        context.triggerMonitoring?.mdPath,
        context.triggerMonitoring?.playbookPath,
        context.triggerMonitoring?.indexPath
      ]).join("; "),
      caveat: "Source-proven trigger targets still need case-specific live samples before active automation."
    },
    {
      surface: "Scene/window transitions",
      hooks: "GED.event, GED.ShowWindow, GED.CloseWindow, WindowManager show/hide/update handlers, effective Laya.stage scene/window layer scan",
      proof: evidenceList([samplePath(context.tableTransition), context.currentWindowAction?.path, samplePath(context.rightPanelToggle), context.triggerMonitoring?.playbookPath, context.surfaceHooks.path]).join("; "),
      caveat: "Window registries may be stale; inspect effective visible nodes."
    },
    {
      surface: "TableGameScene / RogueLikeGameScene / tracker overlay",
      hooks: "TableGameScene and RogueLikeGameScene gameStart/gameOver/addCards/play motion/proxy events; tracker overlay display-only DOM",
      proof: evidenceList([samplePath(context.tablegameInspection), context.rogueGameSceneInspect?.path, context.rogueBattleActionSurface?.path, context.rogueEndedExitReport?.path, context.promptAutomationMonitor?.__path, context.triggerMonitoring?.indexPath]).join("; "),
      caveat: "Do not read hidden opponent handCards."
    },
    {
      surface: "Card selection and card movement",
      hooks: "SelectCardWindow, SpellMultiSelectorWindow, SkillBiFaWindow, military orders, GongXin/GuZheng/swap/top/switch/PoXi/PinDian windows",
      proof: evidenceList([
        hooks.filter((name) => /Select|Card|GongXin|GuZheng|Swap|PoXi|PinDian|Military|SkillBiFa/.test(name)).join(", "),
        context.currentWindowAction?.path,
        context.rogueBattleActionSurface?.path,
        context.rogueBattlePromptInspect?.path,
        context.promptAutomationMonitor?.__path,
        context.triggerMonitoring?.indexPath
      ]).join("; "),
      caveat: context.rogueBattleActionSurface
        ? "Rogue battle NBi/uBt/prompt surfaces are live-inspected; active confirms still need prompt-specific proof."
        : "Monitor first; active confirms need prompt-specific proof."
    },
    {
      surface: "Hover/popup",
      hooks: "SkillSelectorWindow.cardRollOver/cardRollOut/showOverCard; SkillPopUpWindow.initBg/layoutTxt",
      proof: evidenceList([
        hooks.filter((name) => /SkillSelectorWindow|SkillPopUpWindow/.test(name)).join(", "),
        context.hoverPopupSample?.path,
        context.hoverPopupProbe?.path,
        context.hoverFieldTooltip?.path,
        ...(context.hoverHandlerFieldTransition?.paths || []),
        context.hoverStageDelta?.path,
        context.currentWindowAction?.path,
        context.liveGapWatch?.path,
        context.tooltipLifecycle?.path,
        context.rogueTooltipInspect?.path,
        context.triggerMonitoring?.indexPath
      ]).join("; "),
      caveat: (context.hoverPopupSample?.methodRecords > 0 || context.hoverPopupProbe?.popupMethodRecordCount > 0)
        ? "Observed popup method records; inspect sidecar records for the exact node chain."
        : (context.tooltipLifecycle?.callOk
            ? `Tooltip function returned and cleaned a SkillToolTip object, visible tooltip-field/stage-delta nodes were hover-sampled, and hover-handler field transitions changed ${(context.hoverHandlerFieldTransition?.changedKeys || []).join("/") || "no tracked"} on ${context.hoverHandlerFieldTransition?.fieldDeltaTargets || 0} target(s); pure mouse-hover stage-attached popup delta is still unobserved in latest ${context.hoverStageDelta?.sampledTargets || 0} stage-delta targets.`
            : (context.hoverPopupProbe?.hoverEventRecordCount > 0 || context.hoverPopupProbe?.mouseRecords > 0)
              ? "Probe observed Laya mouse/hover events and rogue tooltip fields are inspected, but popup method creation/cleanup is still unobserved."
              : "Probe observed no popup method creation/cleanup record.")
    },
    {
      surface: "Bless/QiFu effects",
      hooks: "BlessNewWindow/View Close/blessBtnClick/confirmBuy/shopBtnClick/addEffect/effectStop/updateSkipAnim; purchase methods blocked",
      proof: evidenceList([context.blessOpenSample?.path, context.blessEffectBlockProbe?.path, context.currentWindowAction?.path, samplePath(context.blessClose), context.surfaceHooks.path, context.liveGapWatch?.path, context.triggerMonitoring?.indexPath]).join("; "),
      caveat: (context.blessOpenSample?.blockedEffects > 0 || context.blessEffectBlockProbe?.directEffectOk)
        ? "Open/close and addEffect blocking are live-sampled without purchase/draw/shop calls; natural draw-response animation remains permission-gated."
        : (context.blessOpenSample?.openOk && context.blessOpenSample?.closeOk
            ? "Open/close lifecycle is live-sampled without purchase/draw calls; this sample did not trigger addEffect."
            : "Open/effect live sample is still missing; live-gap watcher is ready and blocks purchase/draw-like calls while active.")
    },
    {
      surface: "Rogue",
      hooks: "RogueSmallMapScene Trigger/Update/send, RogueFightWindow, RogueLikeGameScene battle methods, RogueJiShiWindow with buy/refresh blocked",
      proof: evidenceList([context.rogueBigmapConfirm?.path, context.rogueSelectGeneral?.path, samplePath(context.rogueScan), samplePath(context.rogueShopRequest), samplePath(context.rogueCityClick), context.rogueActionSurface?.path, context.rogueActiveSample?.path, context.rogueGameSceneInspect?.path, context.rogueSkillZhanfaProbe?.path, context.rogueBattleActionSurface?.path, context.rogueBattlePromptInspect?.path, context.rogueTooltipInspect?.path, context.rogueEndedExitReport?.path, context.triggerMonitoring?.indexPath]).join("; "),
      caveat: context.rogueActiveSample?.actionOk
        ? "Fight confirm/start/send, delayed RogueLikeGameScene entry, and current battle action surface are live-sampled; active skill auto-confirm still needs per-event active sample."
        : "Fight confirm/start/send and current skill/zhanfa button boundaries are inspected; active skill auto-confirm still needs per-event active sample."
    },
    {
      surface: "KanShu",
      hooks: "KanShuWindow updateReqInfo/onKanShuClick/autoClickAllPeach/trueReqJbpAwd; pay methods blocked",
      proof: evidenceList([samplePath(context.kanshuState), context.triggerMonitoring?.indexPath]).join("; "),
      caveat: "Final reward request gated by free branch or explicit permission."
    },
    {
      surface: "YanJiao",
      hooks: "YanJiaoWindow enter/show/genSplit/showSplit/layout/updateAutoChoose/send/drag/drop",
      proof: evidenceList([context.yanJiaoCandidateReport?.mdPath, context.yanJiaoCandidateReport?.flowTsvPath, context.yanJiaoCandidateReport?.methodEvidenceTsvPath, context.yanJiaoCandidateReport?.fieldActionMapTsvPath, context.yanJiaoReport?.mdPath, context.yanJiaoListWatch?.path, context.liveGapWatch?.path, context.triggerMonitoring?.indexPath]).join("; "),
      caveat: context.yanJiaoCandidateReport?.watcherLiveInstallable || context.yanJiaoListWatch?.wrappers > 0
        ? "Watcher implementation is live-installable and preview-only by default; live window sample still needed for coordinates/click behavior."
        : "Live window sample still needed for coordinates/click behavior."
    },
    {
      surface: "Resource drawing/replacement",
      hooks: "Laya.Image.skin, Sprite.graphics.drawTexture/loadImage, Laya.loader.load; Laya.URL.customFormat and ResourceVersion.addVersionPrefix",
      proof: evidenceList([context.resourceReplacementProbe?.path, context.resourceLoadSchemeProof?.path, path.join(explorationRoot, "resource-drawing-and-replacement.md"), context.triggerMonitoring?.indexPath]).join("; "),
      caveat: context.resourceReplacementProbe?.drawOk && context.resourceReplacementProbe?.formatURLResult && context.resourceLoadSchemeProof?.allLoaded
        ? "Drawing, URL rewrite hooks, and current file/local-http/same-origin-https/data load schemes are live-proven; local HTTP/data/request-fulfill remains the most reproducible replacement route."
        : "Resource hook relation should be rechecked live before use."
    },
    {
      surface: "Qixing/GuanXing/Shen Zhuge",
      hooks: "GuanXing, GuanXingPo, GuanXingPoker, GuanXingRace, GuanXingWindow, QiXing/QiXingWindow source classes",
      proof: evidenceList([context.qixingWatch?.path, context.allNames?.paths.methodRoleIndex, context.liveGapWatch?.path, context.triggerMonitoring?.indexPath]).join("; "),
      caveat: context.qixingWatch?.visibleTargetWindows > 0
        ? "Watcher observed a visible Qixing/GuanXing target; inspect sidecar for visible cards/public-general reconciliation."
        : "Watcher is implemented and classes are live-hooked; real popup/public-general sample still missing."
    }
  ];
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# Runtime Objective Coverage Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Status: active / not complete.`);
  lines.push(`- Summary: ${Object.entries(report.statusCounts).map(([status, count]) => `${status}=${count}`).join("; ")}`);
  lines.push("");

  lines.push("## Evidence Inputs");
  lines.push("");
  for (const [name, value] of Object.entries(report.inputs)) {
    if (value) lines.push(`- ${name}: ${value}`);
  }
  lines.push("");

  lines.push("## Requirement Matrix");
  lines.push("");
  lines.push("| ID | Requirement | Status | Monitoring Method | Evidence | Remaining |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const item of report.requirements) {
    lines.push(`| \`${item.id}\` | ${escapeCell(item.requirement)} | \`${item.status}\` | ${escapeCell(item.monitorMethod)} | ${escapeCell(item.evidence.join("<br>") || "(none)")} | ${escapeCell(item.remaining)} |`);
  }
  lines.push("");

  lines.push("## Monitoring Method Index");
  lines.push("");
  lines.push("| Surface | Hook / Inspection Method | Current Proof | Caveat |");
  lines.push("| --- | --- | --- | --- |");
  for (const item of report.monitoringMethods) {
    lines.push(`| ${escapeCell(item.surface)} | ${escapeCell(item.hooks)} | ${escapeCell(item.proof || "(none)")} | ${escapeCell(item.caveat)} |`);
  }
  lines.push("");

  lines.push("## Completion Audit Notes");
  lines.push("");
  lines.push("- The report keeps the original goal active because several items are source-proven or enumerated but not live-proven.");
  lines.push("- `enumerated-inferred` means the registered name and candidate semantics are indexed, not that every compact/minified field has a final exact meaning.");
  lines.push("- `source-proven` means minified source or old-script source identifies the implementation path. It still may need a live sample before active automation is safe.");
  lines.push("- `partial-live-proven` marks live input/event/action-surface delivery without final popup, prompt, or active automation lifecycle proof.");
  lines.push("- `needs-live-sample` currently marks the QiXing/Shen Zhuge popup/public-general sample. YanJiao remains partial-live until a real window proves coordinates, row clicks, and split preview behavior.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapeCell(text) {
  return String(text || "")
    .replace(/\r?\n/g, " ")
    .replaceAll("|", "\\|");
}

async function main() {
  const allNames = await latestAllNamesReport();
  const oldScriptMap = await latestOldScriptMap();
  const yanJiaoReport = await latestYanJiaoReport();
  const surfaceMonitor = await latestJson("-surface-monitor", "surface-monitor.json");
  const context = {
    allNames,
    oldScriptMap,
    yanJiaoReport,
    yanJiaoListWatch: await latestYanJiaoListWatch(),
    yanJiaoCandidateReport: await latestYanJiaoCandidateListImplementationReport(),
    classFieldAudit: await latestClassFieldAudit(),
    fieldContextReport: await latestFieldContextReport(),
    allSourceContext: await latestAllSourceContextReport(),
    semanticInheritance: await latestSemanticInheritanceReport(),
    liveObjectState: await latestLiveObjectStateAudit(),
    liveFieldSourceJoin: await latestLiveFieldSourceJoinReport(),
    classUtilsInspect: await latestClassUtilsInspect(),
    liveFieldGapReport: await latestLiveFieldGapReport(),
    liveFieldGapTriageReport: await latestLiveFieldGapTriageReport(),
    liveOwnerSourceReport: await latestLiveOwnerSourceReport(),
    liveFieldSemanticsReport: await latestLiveFieldSemanticsReport(),
    fieldSemanticIndexReport: await latestFieldSemanticIndexReport(),
    activeOperationFieldTransitionReport: await latestActiveOperationFieldTransitionReport(),
    residualFieldSourceReport: await latestResidualFieldSourceReport(),
    entryEvidenceCatalogReport: await latestEntryEvidenceCatalogReport(),
    mechanismImplementationAtlasReport: await latestMechanismImplementationAtlasReport(),
    goalCompletionAuditReport: await latestGoalCompletionAuditReport(),
    blockerCapturePlanReport: await latestBlockerCapturePlanReport(),
    blockerCaptureRunnerReport: await latestBlockerCaptureRunnerReport(),
    blockerCaptureReadinessReport: await latestBlockerCaptureReadinessReport(),
    blockerCaptureArmVerifyReport: await latestBlockerCaptureArmVerifyReport(),
    goalRemainingAuditReport: await latestGoalRemainingAuditReport(),
    liveProofPlaybookReport: await latestLiveProofPlaybookReport(),
    triggerMonitoring: await latestTriggerMonitoringReport(),
    hoverPopupSample: await latestHoverPopupSample(),
    hoverPopupProbe: await latestHoverPopupProbe(),
    liveGapWatch: await latestLiveGapWatch(),
    eventFieldTransitionWatch: await latestEventFieldTransitionWatch(),
    currentWindowAction: await latestCurrentWindowActionReport(),
    uiStateTransitionSample: await latestUiStateTransitionSample(),
    uiStateDirectEventSample: await latestUiStateTransitionSample({ directEventAllowed: true }),
    hoverFieldTooltip: await latestHoverFieldTooltipSample(),
    hoverHandlerFieldTransition: await latestHoverHandlerFieldTransitionSample(),
    hoverStageDelta: await latestHoverStageDeltaSample(),
    tooltipLifecycle: await latestTooltipLifecycleSample(),
    rogueTooltipInspect: await latestRogueTooltipInspect(),
    rogueActionSurface: await latestRogueActionSurfaceInspect(),
    rogueActiveSample: await latestRogueActiveSample(),
    rogueBigmapConfirm: await latestRogueFlowSample("-bigmap-confirm-warning-rogue-sample"),
    rogueSelectGeneral: await latestRogueFlowSample("-select-general-confirm-rogue-sample"),
    rogueGameSceneInspect: await latestRogueGameSceneInspect(),
    rogueSkillZhanfaProbe: await latestRogueSkillZhanfaProbe(),
    rogueBattleActionSurface: await latestRogueBattleActionSurface(),
    rogueBattlePromptInspect: await latestRogueBattlePromptInspect(),
    promptAutomationMonitor: await latestJson("-prompt-automation-monitor", "prompt-automation-monitor.json"),
    activeOperation: await latestActiveOperationDumpStop(),
    rogueCurrentActionHandlerReport: await latestRogueCurrentActionHandlerReport(),
    rogueCurrentSkillButtonDetailReport: await latestRogueCurrentSkillButtonDetailReport(),
    rogueHandlerFieldJoinReport: await latestRogueHandlerFieldJoinReport(),
    rogueEndedExitReport: await latestRogueEndedExitReport(),
    resourceReplacementProbe: await latestResourceReplacementProbe(),
    resourceLoadSchemeProof: await latestResourceLoadSchemeProof(),
    blessOpenSample: await latestBlessOpenSample(),
    blessEffectBlockProbe: await latestBlessEffectBlockProbe(),
    qixingWatch: await latestQixingWatch(),
    mechanismReport: await latestMechanismReport(),
    surfaceMonitor,
    surfaceHooks: surfaceHookSummary(surfaceMonitor),
    currentScene: await latestJson("-current-scene-inspect", "current-scene-inspect.json"),
    currentBack: await latestJson("-current-back-sample", "safe-action-sample.json"),
    rightPanelToggle: await latestJson("-right-panel-toggle-sample", "right-panel-toggle-sample.json"),
    tableTransition: await latestEventMonitorJson(),
    tablegameInspection: await latestJson("-tablegame-inspect", "tablegame-inspection.json"),
    tablegameFocusReport: await latestJson("-tablegame-focus-report", "tablegame-focus-report.json"),
    battleActivity: await latestJson("-activity-next-page-battle-entry", "battle-entry-sample.json"),
    battleEnterTrial: await latestJson("-enter-general-trial-battle-entry", "battle-entry-sample.json"),
    battleStartChallenge: await latestJson("-start-challenge-battle-entry", "battle-entry-sample.json"),
    battleEndScan: await latestJson("-scan-battle-end", "battle-end-sample.json"),
    blessClose: await latestJson("-close-bless-sample", "safe-action-sample.json"),
    rogueScan: await latestJson("-scan-rogue-sample", "rogue-sample.json"),
    rogueShopRequest: await latestJson("-request-shop-data-rogue-sample", "rogue-sample.json"),
    rogueCityClick: await latestJson("-smallmap-click-first-city-rogue-sample", "rogue-sample.json"),
    kanshuState: await latestJson("-kanshu-state-sample", "kanshu-state-sample.json")
  };

  const requirements = buildRequirements(context);
  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      allNames: allNames?.dir || "",
      oldScriptMap: oldScriptMap?.mdPath || "",
      yanJiaoReport: yanJiaoReport?.mdPath || "",
      yanJiaoListWatch: context.yanJiaoListWatch?.path || "",
      yanJiaoCandidateReport: context.yanJiaoCandidateReport?.mdPath || "",
      classFieldAudit: context.classFieldAudit?.mdPath || "",
      fieldContextReport: context.fieldContextReport?.mdPath || "",
      allSourceContext: context.allSourceContext?.mdPath || "",
      semanticInheritance: context.semanticInheritance?.mdPath || "",
      liveObjectState: context.liveObjectState?.mdPath || "",
      liveFieldSourceJoin: context.liveFieldSourceJoin?.mdPath || "",
      classUtilsInspect: context.classUtilsInspect?.mdPath || "",
      liveFieldGapReport: context.liveFieldGapReport?.mdPath || "",
      liveFieldGapTriageReport: context.liveFieldGapTriageReport?.mdPath || "",
      liveOwnerSourceReport: context.liveOwnerSourceReport?.mdPath || "",
      liveFieldSemanticsReport: context.liveFieldSemanticsReport?.mdPath || "",
      fieldSemanticIndexReport: context.fieldSemanticIndexReport?.mdPath || "",
      activeOperationFieldTransitionReport: context.activeOperationFieldTransitionReport?.mdPath || "",
      residualFieldSourceReport: context.residualFieldSourceReport?.mdPath || "",
      entryEvidenceCatalogReport: context.entryEvidenceCatalogReport?.mdPath || "",
      mechanismImplementationAtlasReport: context.mechanismImplementationAtlasReport?.mdPath || "",
      goalCompletionAuditReport: context.goalCompletionAuditReport?.mdPath || "",
      blockerCapturePlanReport: context.blockerCapturePlanReport?.mdPath || "",
      blockerCaptureRunnerReport: context.blockerCaptureRunnerReport?.mdPath || "",
      blockerCaptureReadinessReport: context.blockerCaptureReadinessReport?.mdPath || "",
      goalRemainingAuditReport: context.goalRemainingAuditReport?.mdPath || "",
      liveProofPlaybookReport: context.liveProofPlaybookReport?.mdPath || "",
      triggerMonitoring: context.triggerMonitoring?.mdPath || "",
      hoverPopupSample: context.hoverPopupSample?.path || "",
      hoverPopupProbe: context.hoverPopupProbe?.path || "",
      liveGapWatch: context.liveGapWatch?.path || "",
      eventFieldTransitionWatch: context.eventFieldTransitionWatch?.path || "",
      currentWindowAction: context.currentWindowAction?.path || "",
      tablegameFocusReport: context.tablegameFocusReport?.__path || "",
      uiStateTransitionSample: context.uiStateTransitionSample?.path || "",
      uiStateDirectEventSample: context.uiStateDirectEventSample?.path || "",
      hoverFieldTooltip: context.hoverFieldTooltip?.path || "",
      hoverHandlerFieldTransition: context.hoverHandlerFieldTransition?.path || "",
      hoverStageDelta: context.hoverStageDelta?.path || "",
      tooltipLifecycle: context.tooltipLifecycle?.path || "",
      rogueTooltipInspect: context.rogueTooltipInspect?.path || "",
      rogueActionSurface: context.rogueActionSurface?.path || "",
      rogueActiveSample: context.rogueActiveSample?.path || "",
      rogueBigmapConfirm: context.rogueBigmapConfirm?.path || "",
      rogueSelectGeneral: context.rogueSelectGeneral?.path || "",
      rogueGameSceneInspect: context.rogueGameSceneInspect?.path || "",
      rogueSkillZhanfaProbe: context.rogueSkillZhanfaProbe?.path || "",
      rogueBattleActionSurface: context.rogueBattleActionSurface?.path || "",
      rogueBattlePromptInspect: context.rogueBattlePromptInspect?.path || "",
      promptAutomationMonitor: context.promptAutomationMonitor?.__path || "",
      activeOperation: context.activeOperation?.path || "",
      rogueCurrentActionHandlerReport: context.rogueCurrentActionHandlerReport?.path || "",
      rogueCurrentSkillButtonDetailReport: context.rogueCurrentSkillButtonDetailReport?.path || "",
      rogueHandlerFieldJoinReport: context.rogueHandlerFieldJoinReport?.path || "",
      rogueEndedExitReport: context.rogueEndedExitReport?.path || "",
      blessOpenSample: context.blessOpenSample?.path || "",
      blessEffectBlockProbe: context.blessEffectBlockProbe?.path || "",
      qixingWatch: context.qixingWatch?.path || "",
      mechanismReport: context.mechanismReport?.mdPath || "",
      surfaceMonitor: context.surfaceHooks.path || "",
      resourceSupplement: path.join(explorationRoot, "resource-drawing-and-replacement.md"),
      resourceReplacementProbe: context.resourceReplacementProbe?.path || "",
      resourceLoadSchemeProof: context.resourceLoadSchemeProof?.path || ""
    },
    statusCounts: statusCounts(requirements),
    requirements,
    monitoringMethods: buildMonitorRows(context)
  };

  const outDir = path.resolve(
    process.env.SGS_RUNTIME_OBJECTIVE_COVERAGE_DIR ||
      path.join(explorationRoot, `${timestampName()}-objective-coverage`)
  );
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "objective-coverage-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "objective-coverage-report.md"), buildMarkdown(report), "utf8");
  await writeFile(path.join(outDir, "README.md"), [
    "# Runtime Objective Coverage Report",
    "",
    `- Markdown: ${path.join(outDir, "objective-coverage-report.md")}`,
    `- JSON: ${path.join(outDir, "objective-coverage-report.json")}`,
    `- Status: active / not complete`,
    ""
  ].join("\n"), "utf8");

  console.log(JSON.stringify({
    outDir,
    statusCounts: report.statusCounts,
    requirements: requirements.length,
    allNames: allNames?.classCount || 0,
    surfaceWrappers: context.surfaceHooks.wrappers,
    oldScriptMap: oldScriptMap?.mdPath || null,
    yanJiaoReport: yanJiaoReport?.mdPath || null,
    yanJiaoListWatch: context.yanJiaoListWatch?.path || null,
    yanJiaoCandidateReport: context.yanJiaoCandidateReport?.path || null,
    rogueActionSurface: context.rogueActionSurface?.path || null,
    rogueActiveSample: context.rogueActiveSample?.path || null,
    rogueBigmapConfirm: context.rogueBigmapConfirm?.path || null,
    rogueSelectGeneral: context.rogueSelectGeneral?.path || null,
    rogueGameSceneInspect: context.rogueGameSceneInspect?.path || null,
    rogueSkillZhanfaProbe: context.rogueSkillZhanfaProbe?.path || null,
    rogueBattleActionSurface: context.rogueBattleActionSurface?.path || null,
    rogueBattlePromptInspect: context.rogueBattlePromptInspect?.path || null,
    promptAutomationMonitor: context.promptAutomationMonitor?.__path || null,
    activeOperation: context.activeOperation?.path || null,
    rogueCurrentActionHandlerReport: context.rogueCurrentActionHandlerReport?.path || null,
    rogueCurrentSkillButtonDetailReport: context.rogueCurrentSkillButtonDetailReport?.path || null,
    rogueHandlerFieldJoinReport: context.rogueHandlerFieldJoinReport?.path || null,
    rogueEndedExitReport: context.rogueEndedExitReport?.path || null,
    blessOpenSample: context.blessOpenSample?.path || null,
    qixingWatch: context.qixingWatch?.path || null,
    hoverFieldTooltip: context.hoverFieldTooltip?.path || null,
    hoverHandlerFieldTransition: context.hoverHandlerFieldTransition?.path || null,
    hoverStageDelta: context.hoverStageDelta?.path || null,
    liveObjectState: context.liveObjectState?.mdPath || null,
    liveFieldSourceJoin: context.liveFieldSourceJoin?.mdPath || null,
    classUtilsInspect: context.classUtilsInspect?.mdPath || null,
    liveFieldGapReport: context.liveFieldGapReport?.mdPath || null,
    liveFieldGapTriageReport: context.liveFieldGapTriageReport?.mdPath || null,
    liveOwnerSourceReport: context.liveOwnerSourceReport?.mdPath || null,
    liveFieldSemanticsReport: context.liveFieldSemanticsReport?.mdPath || null,
    fieldSemanticIndexReport: context.fieldSemanticIndexReport?.mdPath || null,
    activeOperationFieldTransitionReport: context.activeOperationFieldTransitionReport?.mdPath || null,
    residualFieldSourceReport: context.residualFieldSourceReport?.mdPath || null,
    entryEvidenceCatalogReport: context.entryEvidenceCatalogReport?.mdPath || null,
    mechanismImplementationAtlasReport: context.mechanismImplementationAtlasReport?.mdPath || null,
    goalCompletionAuditReport: context.goalCompletionAuditReport?.mdPath || null,
    blockerCapturePlanReport: context.blockerCapturePlanReport?.mdPath || null,
    blockerCaptureRunnerReport: context.blockerCaptureRunnerReport?.mdPath || null,
    blockerCaptureReadinessReport: context.blockerCaptureReadinessReport?.mdPath || null,
    goalRemainingAuditReport: context.goalRemainingAuditReport?.mdPath || null,
    liveProofPlaybookReport: context.liveProofPlaybookReport?.mdPath || null,
    eventFieldTransitionWatch: context.eventFieldTransitionWatch?.path || null,
    currentWindowAction: context.currentWindowAction?.path || null,
    tablegameFocusReport: context.tablegameFocusReport?.__path || null,
    uiStateTransitionSample: context.uiStateTransitionSample?.path || null,
    uiStateDirectEventSample: context.uiStateDirectEventSample?.path || null,
    blessEffectBlockProbe: context.blessEffectBlockProbe?.path || null,
    rogueEndedExitReport: context.rogueEndedExitReport?.path || null,
    resourceReplacementProbe: context.resourceReplacementProbe?.path || null,
    resourceLoadSchemeProof: context.resourceLoadSchemeProof?.path || null
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
