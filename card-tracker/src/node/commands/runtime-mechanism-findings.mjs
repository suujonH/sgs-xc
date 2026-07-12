import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");
const explorationRoot = path.join(projectRoot, "work", "runtime-exploration");

const methodSelections = {
  YanJiao: ["GetResponser", "OnMsgMoveCard", "MoveCardToZoneResponse"],
  YanJiaoWindow: [
    "enterWindow",
    "UpdateWindow",
    "showWindow",
    "autoChooseClick",
    "showSplitCard",
    "sendAutoChooseMoveOpt",
    "sendMoveOpt",
    "confirmBtmClick",
    "onCardDown",
    "onStageUp"
  ],
  GuanXing: ["MoveCardToZoneResponse"],
  GuanXingPo: ["AutoUseSkillID", "GetDefensiveSelectCardContext"],
  GuanXingPoker: ["GetPokerSkillWindowDesc", "IsAllowCardInWindow", "SelectCardCountWhenResponse", "SendMsgInSelectCardWindow"],
  GuanXingRace: [
    "CardCountMax",
    "CardCountMin",
    "CardSelector",
    "CardUseType",
    "MoveCardFromeZoneResponse",
    "MoveCardToZoneResponse",
    "NeedShowVirtualCard",
    "OutsideCardName",
    "OutsideCards",
    "OutsideCnt",
    "OutsidePopWinTitleByKey",
    "isUseCard",
    "isVirtualCardId"
  ],
  GuanXingWindow: ["Init", "updateTitle"],
  SelectCardWindow: ["enterWindow", "autoSelect", "confirmClick", "cancelClick", "addSelectCardNormalUi", "onTouchEnsure"],
  SkillSelectorWindow: ["layoutCardUis", "cardRollOver", "cardRollOut", "showOverCard", "ShowAiHelpCards"],
  SkillPopUpWindow: ["constructor", "Skill", "initBg", "layoutTxt"],
  TableGameScene: [
    "addEventListener",
    "gameStart",
    "gameOverHandler",
    "addCardsHandler",
    "playNextCardMotion",
    "clearAction",
    "UpdateCardByUseSpell",
    "showWuzhongCardMove",
    "showHuaShenCardMove",
    "showGameResultWindow"
  ],
  RogueLikeGameScene: [
    "addEventListener",
    "gameStart",
    "gameOverHandler",
    "addCardsHandler",
    "playNextCardMotion",
    "UpdateCardByUseSpell",
    "ShowCardMotion",
    "PlayGameEffectBySys",
    "showSelectGeneral",
    "showGameResultWindow",
    "rogueOverGame",
    "rogueRestartGame"
  ],
  GeneralTrialScene: ["addEventListener", "gameStartRep", "tableInfoRep", "enterModePageSuccess"],
  GeneralTrialChallengeWin: ["enterWindow", "onClickChallenge", "startChallengeEventHandler"],
  RogueSmallMapScene: ["addEventListener", "TriggerCurEvent", "TriggerEvent", "UpdateRogueData", "sendGotoFightMsg", "sendGotoGambleMsg"],
  RogueFightWindow: ["enterWindow", "createSkillBtn", "showTipHandler", "showGeneralTipHandler", "startbtnClick", "gotoJishi", "enableEffect", "removeEffect"],
  BlessNewWindow: ["Close", "blessBtnClick", "confirmBuy", "shopBtnClick", "addEffect", "effectStop"],
  BlessNewWindowView: ["Close", "blessBtnClick", "confirmBuy", "shopBtnClick", "addEffect", "effectStop", "UpdateButtonUI", "UpdateUpperCanvas", "updateSkipAnim"],
  KanShuWindow: ["updateReqInfo", "onKanShuClick", "autoClickAllPeach", "trueReqJbpAwd", "onShowKanShuEffect", "onShowEvent", "onShowEvent2", "gotoPay", "buyPorpItem"],
  SpellMultiSelectorWindow: ["enterWindow", "onTouch"],
  SkillBiFaWindow: ["Init", "addHandCard", "onHandCardClicked", "SelectOptEvent"],
  MilitaryOrdersSelectWindow: ["enterWindow", "cardClickHandler", "initUI"],
  MilitaryOrdersExecutionWindow: ["enterWindow", "executeClickHandler", "initUI"]
};

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

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function latestDir(suffix) {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix)).map((entry) => path.join(explorationRoot, entry.name));
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

async function latestHoverHandlerFieldTransitionReports() {
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
  return reports;
}

async function latestUiStateDirectEventSample() {
  const entries = await readdir(explorationRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("-ui-state-transition-sample"))
    .map((entry) => path.join(explorationRoot, entry.name))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const filePath = path.join(dir, "ui-state-transition-sample.json");
    const value = await readJsonIfExists(filePath);
    const attempts = value?.value?.attempts || [];
    const directEventLike = value?.value?.safety?.directEventAllowed === true || attempts.some((item) => item.ok === true && item.skipped !== true);
    if (!value || !directEventLike) continue;
    value.__path = filePath;
    value.__dir = dir;
    return value;
  }
  return null;
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

function summarizeRogueTooltipInspect(sample) {
  const value = sample?.value || {};
  const nodes = value.nodes || [];
  const tooltipNodes = nodes.filter((node) => {
    const fields = node.fields || {};
    return fields.toolTip || fields.ToolTip || fields.GeneralToolTip || fields.generalToolTip;
  });
  const activeTooltipNodes = tooltipNodes.filter((node) => node.effectiveVisible);
  const classSources = value.classSources || {};
  return {
    path: sample?.__path || "",
    scene: value.scene?.sceneName || value.scene?.className || "",
    inspectedNodes: nodes.length,
    tooltipNodes: tooltipNodes.length,
    activeTooltipNodes: activeTooltipNodes.length,
    rogueFightMethods: Object.values(classSources.RogueFightWindow?.methods || {}).filter(Boolean).length,
    changeSkillMethods: Object.values(classSources.ChangeSKillWindow?.methods || {}).filter(Boolean).length,
    rogue1v1ChangeSkillMethods: Object.values(classSources.Rogue1v1ChangeSkillWindow?.methods || {}).filter(Boolean).length
  };
}

function summarizeRogueActionSurfaceInspect(sample) {
  const value = sample?.value || {};
  const fight = value.fightWindows?.[0]?.specific || {};
  return {
    path: sample?.__path || "",
    scene: value.sceneData?.scene?.sceneName || value.sceneData?.scene?.className || "",
    windows: value.windowNodes?.length || 0,
    fightWindows: value.fightWindows?.length || 0,
    fightId: fight.fightId ?? "",
    bottomSkillButtons: value.bottomSkillButtons?.length || 0,
    zhanfaButtons: value.zhanfaButtons?.length || 0,
    startBtnEvents: Object.keys(fight.startBtn?.events || {}),
    pveMgrHasEventSelectReq: !!value.sceneData?.pveMgr?.methodSources?.RogueLikeEventSelectReq,
    rogueFightHasStartSource: !!value.classSources?.RogueFightWindow?.methods?.startbtnClick,
    changeSkillHasSendSource: !!value.classSources?.ChangeSKillWindow?.methods?.onChange
  };
}

function summarizeRogueActiveSample(sample) {
  const action = sample?.action?.action || {};
  const records = sample?.dump?.value?.records || [];
  const pveReq = records.find((record) => record.name === "PveMgr.RogueLikeEventSelectReq");
  const proxySend = records.find((record) => record.name === "proxy.L");
  const fullMask = records.find((record) => record.name === "SHOW_FULL_MASK_LOADING");
  return {
    path: sample?.__path || "",
    actionOk: action.ok === true,
    called: action.called || "",
    beforeScene: sample?.action?.before?.scene?.sceneName || sample?.action?.before?.scene?.className || "",
    afterScene: sample?.after?.value?.scene?.sceneName || sample?.after?.value?.scene?.className || "",
    fightId: sample?.action?.before?.fightWindow?.fightId ?? action.target?.fightId ?? "",
    eventId: pveReq?.args?.[0]?.values?.eventId ?? "",
    eventType: pveReq?.args?.[0]?.values?.eventType ?? "",
    protocolId: typeof proxySend?.args?.[0] === "number" ? proxySend.args[0] : "",
    fullMaskMs: fullMask?.args?.[0] ?? "",
    recordCount: records.length,
    purchaseBlockedCalls: sample?.guardStop?.blockedCalls?.length || 0,
    tableGame: !!sample?.after?.value?.tableGame
  };
}

function summarizeRogueGameSceneInspect(sample) {
  const value = sample?.value || {};
  const scene = value.runtime?.scene || {};
  const managers = value.managers || [];
  const manager = managers.find((item) => item.name === "manager") || managers[0] || {};
  const selfSeatIndex = Number(manager.selfSeatIndex);
  const selfSeat = (manager.seats || []).find((seat) => seat.index === selfSeatIndex) || (manager.seats || []).find((seat) => seat.isSelf) || {};
  const classSources = value.classSources || {};
  const methodCount = (className) => Object.values(classSources[className]?.methods || {}).filter(Boolean).length;
  return {
    path: sample?.__path || "",
    scene: scene.sceneName || scene.className || "",
    effectiveVisible: scene.effectiveVisible === true,
    managerCtor: manager.ctor || "",
    seatCount: manager.seatCount ?? "",
    selfSeatIndex: Number.isFinite(selfSeatIndex) ? selfSeatIndex : "",
    gameTurn: manager.fields?.gameTurn ?? "",
    gameRoundStarted: manager.fields?.gameRoundStarted === true,
    gameStartPlay: manager.fields?.gameStartPlay === true,
    isGameOver: manager.fields?.isGameOver === true,
    roleSpellInterfaces: manager.fields?.roleSpellRespManager?.values?.interfaces?.length ?? "",
    moveFromFuncs: manager.fields?.movecardManager?.values?.fromFuncs?.length ?? "",
    moveToFuncs: manager.fields?.movecardManager?.values?.toFuncs?.length ?? "",
    selfGeneralName: selfSeat.fields?.general?.cardName || "",
    selfGeneralId: selfSeat.fields?.general?.cardId ?? "",
    selfHandCount: selfSeat.fields?.handCardCount ?? "",
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

function summarizeRogueSkillZhanfaProbe(sample) {
  const value = sample?.value || {};
  const buttons = value.buttons || {};
  const buttonCount = Array.isArray(buttons)
    ? buttons.length
    : Object.values(buttons).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  const classSources = value.classSources || {};
  const methodCount = (className) => Object.values(classSources[className]?.methods || {}).filter(Boolean).length;
  return {
    path: sample?.__path || "",
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

function summarizeRogueBattleActionSurface(sample) {
  const value = sample?.value || {};
  const surfaces = value.surfaces || {};
  const visibleWindows = surfaces.visibleWindows || [];
  const classSources = value.classSources || {};
  const methodCount = (className) => Object.values(classSources[className]?.methods || {}).filter(Boolean).length;
  const texts = (rows, pattern) => (rows || [])
    .map((node) => node.text)
    .filter((text) => text && (!pattern || pattern.test(text)))
    .slice(0, 12);
  return {
    path: sample?.__path || "",
    scene: value.runtime?.scene?.sceneName || value.runtime?.scene?.className || "",
    managerCtor: value.runtime?.manager?.ctor || "",
    seatCount: value.runtime?.manager?.seatCount ?? "",
    selfSeatIndex: value.runtime?.manager?.selfSeatIndex ?? "",
    isGameOver: value.runtime?.manager?.fields?.isGameOver === true,
    gameRoundStarted: value.runtime?.manager?.fields?.gameRoundStarted === true,
    gameStartPlay: value.runtime?.manager?.fields?.gameStartPlay === true,
    selfHandCards: value.runtime?.selfSeat?.handCardsCount ?? "",
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
    skillButtonTexts: texts(surfaces.skillPanels, /./),
    zhanfaTexts: texts(surfaces.buttonNodes, /摸牌|当头|Ⅰ|Ⅱ|Ⅲ|IV|V/),
    selectCardWindowMethods: methodCount("SelectCardWindow"),
    skillSelectorWindowMethods: methodCount("SkillSelectorWindow"),
    skillBiFaWindowMethods: methodCount("SkillBiFaWindow"),
    skillBiFaRogueWindowMethods: methodCount("SkillBiFaRogueWindow"),
    spellMultiSelectorWindowMethods: methodCount("SpellMultiSelectorWindow")
  };
}

function summarizeRogueBattlePromptInspect(sample) {
  const value = sample?.value || {};
  const selected = value.selected || {};
  const runtime = value.runtime || {};
  const selfHand = runtime.selfSeat?.handCards || [];
  const classSources = value.classSources || {};
  const methodCount = (className) => Object.values(classSources[className]?.methods || {}).filter(Boolean).length;
  const nodeTexts = (rows) => (rows || [])
    .map((node) => node.text)
    .filter(Boolean)
    .slice(0, 12);
  return {
    path: sample?.__path || "",
    scene: runtime.scene?.sceneName || runtime.scene?.className || "",
    managerCtor: runtime.manager?.ctor || "",
    seatCount: runtime.manager?.seatCount ?? "",
    selfSeatIndex: runtime.manager?.selfSeatIndex ?? "",
    currentRoundSeatID: runtime.manager?.fields?.currentRoundSeatID ?? "",
    gameRound: runtime.manager?.fields?.gameRound ?? "",
    gameTurn: runtime.manager?.fields?.gameTurn ?? "",
    gameRoundStarted: runtime.manager?.fields?.gameRoundStarted === true,
    gameStartPlay: runtime.manager?.fields?.gameStartPlay === true,
    isGameOver: runtime.manager?.fields?.isGameOver === true,
    selfRoundState: runtime.selfSeat?.fields?.roundState ?? "",
    selfShaCount: runtime.selfSeat?.fields?.shaCount ?? "",
    selfShaMaxCount: runtime.selfSeat?.fields?.shaMaxCount ?? "",
    selfHandCards: runtime.selfSeat?.handCardsCount ?? "",
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
    buttonTexts: nodeTexts(selected.visibleButtons),
    skillTexts: nodeTexts(selected.skillNodes),
    promptTexts: nodeTexts(selected.promptCandidates),
    selectCardWindowMethods: methodCount("SelectCardWindow"),
    skillSelectorWindowMethods: methodCount("SkillSelectorWindow"),
    skillBiFaWindowMethods: methodCount("SkillBiFaWindow"),
    skillBiFaRogueWindowMethods: methodCount("SkillBiFaRogueWindow"),
    spellMultiSelectorWindowMethods: methodCount("SpellMultiSelectorWindow"),
    militaryOrdersSelectWindowMethods: methodCount("MilitaryOrdersSelectWindow"),
    militaryOrdersExecutionWindowMethods: methodCount("MilitaryOrdersExecutionWindow")
  };
}

function summarizeResourceReplacementProbe(sample) {
  const value = sample?.value || {};
  return {
    path: sample?.__path || "",
    resourceVersion: value.api?.runtime?.resourceVersion || "",
    layaVersion: value.api?.runtime?.layaVersion || "",
    sampleTextures: value.sampleTextures?.length || 0,
    drawOk: value.drawProbe?.ok === true,
    drawTextureUrl: value.drawProbe?.usedTextureUrl || "",
    customFormatType: value.api?.urlApi?.customFormatType || "",
    addVersionPrefix: !!value.api?.resourceVersionApi?.addVersionPrefixSource,
    manifestSize: value.api?.resourceVersionApi?.manifestSize ?? "",
    formatURLResult: value.hookProbe?.formatURLResult || "",
    customFormatCalls: value.hookProbe?.customFormatCalls?.length || 0,
    addVersionPrefixCalls: value.hookProbe?.addVersionPrefixCalls?.length || 0
  };
}

function summarizeResourceLoadSchemeProof(sample) {
  const value = sample?.value || {};
  const results = value.results || [];
  const statuses = Object.fromEntries(results.map((item) => [item.label, item.status || ""]));
  const ok = (label) => results.some((item) => item.label === label && item.ok === true);
  return {
    path: sample?.__path || "",
    resourceVersion: value.runtime?.resourceVersion || "",
    layaVersion: value.runtime?.layaVersion || "",
    fixturePath: sample?.fixture?.path || "",
    statuses,
    allLoaded: results.length > 0 && results.every((item) => item.ok === true),
    fileUrlOk: ok("file-url"),
    localHttpOk: ok("local-http"),
    sameOriginHttpsOk: ok("same-origin-https"),
    dataUrlOk: ok("data-url")
  };
}

function summarizeModeSceneSurfaceReport(sample) {
  return {
    path: sample?.__path || "",
    scene: sample?.currentScene?.sceneName || sample?.currentScene?.className || sample?.currentScene?.label || "",
    layaVersion: sample?.runtime?.layaVersion || "",
    resourceVersion: sample?.runtime?.resourceVersion || "",
    nodes: sample?.counts?.nodes || 0,
    buttons: sample?.counts?.buttons || 0,
    entries: sample?.counts?.entries || 0,
    resourceNodes: sample?.counts?.resources || 0,
    windows: sample?.counts?.windows || 0,
    purchaseRiskButtons: sample?.counts?.purchaseRiskButtons || 0,
    registeredNodeMatches: sample?.counts?.registeredNodeMatches || 0,
    classMapSize: sample?.classUtils?.classMapSize || 0,
    actionTaken: sample?.safety?.actionTaken === true
  };
}

function summarizeTooltipLifecycleSample(sample) {
  const value = sample?.lifecycle?.value || {};
  const status = sample?.dump?.value?.status || {};
  return {
    path: sample?.__path || "",
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

function summarizeHoverFieldTooltipSample(sample) {
  const samples = sample?.samples || [];
  const status = sample?.dump?.value?.status || {};
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
  const maxOf = (key) => deltas.reduce((max, item) => Math.max(max, item[key] || 0), 0);
  const compactTooltip = (value) => {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object") return [value.kind, value.name, value.ctor, value.className, value.sceneName].filter(Boolean).join(":") || JSON.stringify(value).slice(0, 80);
    return String(value);
  };
  return {
    path: sample?.__path || "",
    scene: sample?.candidates?.scene?.sceneName || sample?.candidates?.scene?.className || "",
    candidates: sample?.candidates?.candidates?.length || 0,
    sampledTargets: samples.length,
    visibleTipDeltaObserved: deltas.some((item) =>
      item.cdpDelta > 0 ||
      item.directDelta > 0 ||
      item.cdpWindowDelta > 0 ||
      item.directWindowDelta > 0 ||
      item.cdpTooltipNodeDelta > 0 ||
      item.directTooltipNodeDelta > 0 ||
      item.cdpStageChildDelta > 0 ||
      item.directStageChildDelta > 0
    ),
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

function summarizeHoverHandlerFieldTransitionSample(reports) {
  const values = Array.isArray(reports) ? reports : [];
  const samples = values.flatMap((report) => (report.value?.samples || []).map((sample) => ({ report, sample })));
  const hasFieldDelta = ({ sample }) => (sample.overFieldChanges?.length || 0) > 0 || (sample.outFieldChanges?.length || 0) > 0;
  const hasVisibleDelta = ({ sample }) =>
    (sample.overDelta?.tipDelta || 0) > 0 ||
    (sample.overDelta?.windowLayerChildDelta || 0) > 0 ||
    (sample.overDelta?.stageChildDelta || 0) > 0 ||
    (sample.overDelta?.newTips?.length || 0) > 0 ||
    (sample.overDelta?.newWindows?.length || 0) > 0;
  return {
    path: values[0]?.__path || "",
    paths: values.map((report) => report.__path).slice(0, 8),
    runCount: values.length,
    scene: values[0]?.value?.runtime?.scene?.label || "",
    candidates: values[0]?.value?.candidates?.length || 0,
    sampledTargets: samples.length,
    fieldDeltaTargets: samples.filter(hasFieldDelta).length,
    visibleDeltaTargets: samples.filter(hasVisibleDelta).length,
    proxyLBlockedCalls: values.reduce((sum, report) => sum + (report.value?.safety?.proxyLBlockedCalls?.length || 0), 0),
    sampleOffsets: values.map((report) => report.value?.selection?.sampleOffset ?? 0),
    changedKeys: Array.from(new Set(samples.flatMap(({ sample }) => [
      ...(sample.overFieldChanges || []).map((change) => change.key),
      ...(sample.outFieldChanges || []).map((change) => change.key)
    ]))).slice(0, 20),
    targets: samples.map(({ sample }) => sample.target?.text || sample.target?.label || "").filter(Boolean).slice(0, 20)
  };
}

function summarizeHoverStageDeltaSample(sample) {
  const samples = sample?.samples || [];
  const positive = (d) =>
    (d?.stageChildDelta || 0) > 0 ||
    (d?.windowLayerChildDelta || 0) > 0 ||
    (d?.windowChildrenDelta || 0) > 0 ||
    (d?.tipLikeDelta || 0) > 0 ||
    (d?.newWindowChildren?.length || 0) > 0 ||
    (d?.newTipLike?.length || 0) > 0;
  return {
    path: sample?.__path || "",
    scene: sample?.candidates?.scene?.sceneName || sample?.candidates?.scene?.className || "",
    candidates: sample?.candidates?.candidates?.length || 0,
    sampledTargets: samples.length,
    cdpDeltaObserved: samples.some((item) => positive(item.cdpDelta)),
    directDeltaObserved: samples.some((item) => positive(item.directDelta)),
    cdpHoverOk: samples.filter((item) => item.dispatch?.hover?.ok === true).length,
    cdpHoverTimeouts: samples.filter((item) => item.dispatch?.hover?.ok === false).length,
    directOk: samples.filter((item) => item.direct?.ok === true && item.direct?.mouseOver?.ok === true).length,
    maxTipLikeDelta: samples.reduce((max, item) => Math.max(max, item.cdpDelta?.tipLikeDelta || 0), 0),
    maxWindowLayerChildDelta: samples.reduce((max, item) => Math.max(max, item.cdpDelta?.windowLayerChildDelta || 0), 0),
    cleanupOk: sample?.cleanup?.ok === true,
    sampledTexts: samples.map((item) => item.target?.text || item.target?.label || "").filter(Boolean).slice(0, 12)
  };
}

function summarizeLiveGapWatch(sample) {
  const status = sample?.dump?.value?.status || {};
  const snapshots = sample?.dump?.value?.snapshots || [];
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
    path: sample?.__path || "",
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

function summarizeEventFieldTransitionWatch(sample) {
  const status = sample?.dump?.value?.status || {};
  const records = sample?.dump?.value?.records || [];
  const snapshots = sample?.dump?.value?.snapshots || [];
  const changed = records.filter((record) => (record.fieldDiffCount || 0) > 0 || (record.contextDiffCount || 0) > 0);
  const labels = {};
  for (const record of records) labels[record.label || "(none)"] = (labels[record.label || "(none)"] || 0) + 1;
  return {
    path: sample?.__path || "",
    mdPath: sample?.__dir ? path.join(sample.__dir, "README.md") : "",
    recordsTsvPath: sample?.__dir ? path.join(sample.__dir, "event-field-transition-records.tsv") : "",
    scene: status.current?.scene || "",
    wrappers: status.wrapperCount || 0,
    records: records.length,
    changedRecords: changed.length,
    snapshots: snapshots.length,
    blockedCalls: status.blockedCalls || 0,
    errors: status.errors?.length || 0,
    topLabels: Object.entries(labels)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([label, count]) => `${label}:${count}`)
  };
}

function summarizeCurrentWindowAction(sample) {
  const counts = sample?.counts || {};
  return {
    path: sample?.__path || "",
    scene: sample?.currentScene?.sceneName || sample?.currentScene?.className || "",
    managerCtor: sample?.manager?.ctor || "",
    seatCount: sample?.manager?.seatCount ?? "",
    selfSeatIndex: sample?.manager?.selfSeatIndex ?? "",
    isGameOver: sample?.manager?.isGameOver === true,
    windows: counts.windows || 0,
    visibleWindows: counts.visibleWindows || 0,
    buttonCandidates: counts.buttonCandidates || 0,
    purchaseRiskButtons: counts.purchaseRiskButtons || 0,
    closeBackButtons: counts.closeBackButtons || 0,
    confirmActionButtons: counts.confirmActionButtons || 0,
    tooltipHoverButtons: counts.tooltipHoverButtons || 0,
    windowLabels: (sample?.windows || []).filter((node) => node.effectiveVisible).map((node) => node.label).slice(0, 12),
    purchaseRiskPaths: (sample?.buttonCandidates || [])
      .filter((node) => node.tags?.includes("purchase-risk"))
      .map((node) => node.path)
      .slice(0, 12)
  };
}

function summarizeUiStateTransitionSample(sample) {
  const value = sample?.value || {};
  const attempts = value.attempts || [];
  const directEventLike = value.safety?.directEventAllowed === true || attempts.some((item) => item.ok === true && item.skipped !== true);
  return {
    path: sample?.__path || "",
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
    reasons: attempts.map((item) => item.reason || item.methodError || item.eventError || "").filter(Boolean).slice(0, 8)
  };
}

function summarizeRogueEndedExitReport(sample) {
  const summary = sample?.summary || {};
  return {
    path: sample?.__path || "",
    scene: summary.scene || sample?.currentScene?.sceneName || sample?.currentScene?.className || "",
    managerCtor: summary.manager || sample?.manager?.ctor || "",
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

function summarizeRogueCurrentActionHandlerReport(sample) {
  const summary = sample?.summary || {};
  const dir = sample?.__dir || (sample?.__path ? path.dirname(sample.__path) : "");
  return {
    path: sample?.__path || "",
    mdPath: dir ? path.join(dir, "README.md") : "",
    nodesTsvPath: dir ? path.join(dir, "action-nodes.tsv") : "",
    handlersTsvPath: dir ? path.join(dir, "event-handlers.tsv") : "",
    scene: summary.scene || sample?.currentScene?.sceneName || sample?.currentScene?.className || "",
    managerCtor: summary.managerCtor || sample?.manager?.ctor || "",
    isGameOver: summary.isGameOver === true,
    nodeCount: summary.nodeCount || sample?.nodes?.length || 0,
    eventNodeCount: summary.eventNodeCount || 0,
    eventHandlerCount: summary.eventHandlerCount || 0,
    purchaseRiskHandlers: summary.purchaseRiskHandlers || 0,
    sendOrConfirmHandlers: summary.sendOrConfirmHandlers || 0,
    actionNodeTypeCounts: summary.actionNodeTypeCounts || {},
    tagCounts: summary.tagCounts || {},
    topTexts: (summary.topTexts || []).slice(0, 12)
  };
}

function summarizeRogueCurrentSkillButtonDetailReport(sample) {
  const summary = sample?.summary || {};
  const dir = sample?.__dir || (sample?.__path ? path.dirname(sample.__path) : "");
  return {
    path: sample?.__path || "",
    mdPath: dir ? path.join(dir, "README.md") : "",
    focusNodesTsvPath: dir ? path.join(dir, "focus-nodes.tsv") : "",
    methodEvidenceTsvPath: dir ? path.join(dir, "method-evidence.tsv") : "",
    eventHandlerEvidenceTsvPath: dir ? path.join(dir, "event-handler-evidence.tsv") : "",
    scene: summary.scene || sample?.currentScene?.sceneName || sample?.currentScene?.className || "",
    managerCtor: summary.managerCtor || sample?.manager?.ctor || "",
    isGameOver: summary.isGameOver === true,
    nodeCount: summary.nodeCount || sample?.nodes?.length || 0,
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

function summarizeRogueHandlerFieldJoinReport(sample) {
  const summary = sample?.summary || {};
  const outputs = sample?.outputs || {};
  const dir = sample?.__dir || (sample?.__path ? path.dirname(sample.__path) : "");
  return {
    path: sample?.__path || "",
    mdPath: dir ? path.join(dir, "README.md") : "",
    fieldJoinTsvPath: outputs.fieldJoinTsv || (dir ? path.join(dir, "event-field-join.tsv") : ""),
    handlerSurfaceTsvPath: outputs.handlerSurfaceTsv || (dir ? path.join(dir, "handler-surface.tsv") : ""),
    needsLiveStrengthenedTsvPath: outputs.needsLiveStrengthenedTsv || (dir ? path.join(dir, "needs-live-strengthened.tsv") : ""),
    scene: sample?.runtime?.scene || "",
    managerCtor: sample?.runtime?.managerCtor || "",
    isGameOver: sample?.runtime?.isGameOver === true,
    actionNodes: summary.actionNodes || 0,
    eventNodes: summary.eventNodes || 0,
    handlerRows: summary.handlerRows || 0,
    fieldRows: summary.fieldRows || 0,
    semanticMatchedFields: summary.semanticMatchedFields || 0,
    triageMatchedFields: summary.triageMatchedFields || 0,
    needsLiveRowsSampledByCurrentHandlers: summary.needsLiveRowsSampledByCurrentHandlers || 0,
    evidenceLevels: summary.evidenceLevels || {},
    handlerTags: summary.handlerTags || {}
  };
}

function summarizeBlessOpenSample(sample) {
  const status = sample?.dump?.value?.status || {};
  const scene = sample?.dump?.value?.status?.scene || sample?.scene || {};
  return {
    path: sample?.__path || "",
    windowName: sample?.windowName || sample?.open?.value?.windowName || "",
    scene: scene.sceneName || scene.className || "",
    openOk: sample?.open?.value?.ok === true,
    openCalled: sample?.open?.value?.called || "",
    closeOk: sample?.close?.value?.ok === true,
    closeCalled: sample?.close?.value?.called || "",
    openedBySample: sample?.open?.value?.openedBySample === true,
    closeBeforePath: sample?.close?.value?.before?.path || "",
    closeDestroyed: sample?.close?.value?.afterImmediate?.destroyed === true,
    wrappers: status.wrapperCount || 0,
    records: status.recordCount || 0,
    blockedCalls: status.blockedCalls || 0,
    blockedEffects: status.blockedEffects || 0,
    visibleBlessWindows: status.visibleBlessWindows?.length || 0,
    errors: status.errors?.length || 0
  };
}

function summarizeBlessEffectBlockProbe(sample) {
  const status = sample?.dump?.value?.status || {};
  return {
    path: sample?.__path || "",
    windowName: sample?.windowName || "",
    openedByProbe: sample?.open?.value?.openedBySample === true,
    directEffectOk: sample?.directEffect?.value?.ok === true,
    directEffectTarget: sample?.directEffect?.value?.target?.label || "",
    blockedDelta: sample?.directEffect?.value?.blockedDelta || 0,
    blockedEffects: status.blockedEffects || 0,
    blockedCalls: status.blockedCalls || 0,
    visibleBlessWindows: status.visibleBlessWindows?.length || 0,
    wrappers: status.wrapperCount || 0,
    records: sample?.dump?.value?.records?.length || 0,
    errors: sample?.dump?.value?.errors?.length || 0
  };
}

function summarizeQixingWatch(sample) {
  const status = sample?.dump?.value?.status || {};
  const snapshots = sample?.dump?.value?.snapshots || [];
  const maxCounts = {};
  for (const snapshot of snapshots) {
    for (const [key, value] of Object.entries(snapshot.counts || {})) {
      maxCounts[key] = Math.max(maxCounts[key] || 0, Number(value || 0));
    }
  }
  const availability = status.classAvailability || {};
  const installedClasses = (status.hookSummary || []).filter((item) => item.installed?.length).length;
  return {
    path: sample?.__path || "",
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

async function latestAllNamesReport() {
  const dir = await latestDir("-all-names-report");
  if (!dir) return null;
  const classesTsv = await readFile(path.join(dir, "all-registered-classes.tsv"), "utf8");
  const eventRows = await readJson(path.join(dir, "event-handler-index.json"));
  const fieldGlossary = await readJson(path.join(dir, "field-meaning-glossary.json"));
  return {
    dir,
    classes: Math.max(0, classesTsv.split(/\r?\n/).filter(Boolean).length - 1),
    gedEvents: new Set(eventRows.filter((row) => row.kind === "GED").map((row) => row.eventName)).size,
    proxyEvents: new Set(eventRows.filter((row) => row.kind === "proxy").map((row) => row.eventName)).size,
    fieldGlossary: fieldGlossary.length
  };
}

async function latestOldScriptMap() {
  const dir = await latestDir("-old-script-map");
  if (!dir) return null;
  const jsonPath = path.join(dir, "old-script-behavior-map.json");
  const mdPath = path.join(dir, "old-script-behavior-map.md");
  const value = await readJson(jsonPath);
  return {
    dir,
    jsonPath,
    mdPath,
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
  const mdPath = path.join(dir, "yanjiao-implementation-report.md");
  const value = await readJson(jsonPath);
  return {
    dir,
    jsonPath,
    mdPath,
    sourcePath: value.sourcePath || "",
    yanJiaoMethods: value.yanJiao?.methods?.filter((method) => !method.missing).length || 0,
    windowMethods: value.windowClass?.methods?.filter((method) => !method.missing).length || 0,
    skillAuditRows: value.skillAudit?.rows?.length || 0
  };
}

function summarizeYanJiaoListWatch(sample) {
  const status = sample?.dump?.value?.status || {};
  return {
    path: sample?.__path || "",
    scene: status.current?.scene?.sceneName || status.current?.scene?.className || "",
    classExists: status.classExists === true,
    functionName: status.functionName || "",
    wrappers: status.wrapperCount || 0,
    windows: status.current?.windows?.length || 0,
    renderRecords: status.renderRecords || 0,
    candidateClicks: status.candidateClicks || 0,
    sendRecords: status.sendRecords || 0,
    previewOnly: status.previewOnly !== false,
    restoredWrappers: sample?.stop?.value?.status?.wrapperCount ?? "",
    errors: status.errors?.length || sample?.dump?.value?.errors?.length || 0
  };
}

function summarizeYanJiaoCandidateReport(sample) {
  const status = sample?.status || {};
  const outputs = sample?.outputs || {};
  return {
    path: sample?.__path || "",
    dir: sample?.__dir || "",
    mdPath: sample?.__dir ? path.join(sample.__dir, "README.md") : "",
    flowTsvPath: outputs.flowTsv || (sample?.__dir ? path.join(sample.__dir, "yanjiao-candidate-flow.tsv") : ""),
    methodEvidenceTsvPath: outputs.methodEvidenceTsv || (sample?.__dir ? path.join(sample.__dir, "yanjiao-method-evidence.tsv") : ""),
    fieldActionMapTsvPath: outputs.fieldActionMapTsv || (sample?.__dir ? path.join(sample.__dir, "yanjiao-field-action-map.tsv") : ""),
    level: status.level || "",
    sourceProven: status.sourceProven === true,
    watcherLiveInstallable: status.watcherLiveInstallable === true,
    realWindowSample: status.realWindowSample === true,
    candidateRenderProven: status.candidateRenderProven === true,
    methodRows: sample?.methodEvidence?.length || 0,
    fieldRows: sample?.fieldActionMap?.length || 0,
    flowSteps: sample?.flowSteps?.length || 0,
    previewClick: (sample?.implementationContract?.previewClick || []).join(" -> "),
    explicitAutoSubmit: (sample?.implementationContract?.explicitAutoSubmit || []).join(" -> "),
    caveat: status.caveat || ""
  };
}

async function latestObjectiveCoverageReport() {
  const dir = await latestDir("-objective-coverage");
  if (!dir) return null;
  const jsonPath = path.join(dir, "objective-coverage-report.json");
  const mdPath = path.join(dir, "objective-coverage-report.md");
  const value = await readJson(jsonPath);
  return {
    dir,
    jsonPath,
    mdPath,
    statusCounts: value.statusCounts || {},
    requirements: value.requirements?.length || 0,
    monitoringMethods: value.monitoringMethods?.length || 0
  };
}

async function latestFieldContextReport() {
  const dir = await latestDir("-field-context-report");
  if (!dir) return null;
  const jsonPath = path.join(dir, "field-context-report.json");
  const mdPath = path.join(dir, "field-context-report.md");
  const value = await readJson(jsonPath);
  return {
    dir,
    jsonPath,
    mdPath,
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
  let chunkCount = 0;
  try {
    chunkCount = (await readdir(path.join(dir, "source-chunks"))).filter((name) => name.endsWith(".json")).length;
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
    chunksDir: path.join(dir, "source-chunks"),
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
  const mdPath = path.join(dir, "trigger-monitoring-report.md");
  const value = await readJson(jsonPath);
  return {
    dir,
    jsonPath,
    mdPath,
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
  const mdPath = path.join(dir, "semantic-inheritance-report.md");
  const value = await readJson(jsonPath);
  return {
    dir,
    jsonPath,
    mdPath,
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
    groups: value.sampleStats?.groups || {},
    fieldCategoryCounts: value.sampleStats?.fieldCategoryCounts || {},
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
    layaVersion: value.layaVersion || "",
    classUtilsKeys: value.classUtilsKeys?.length || 0,
    classMapCount: value.summary.classMapCount || 0,
    functionEntryCount: value.summary.functionEntryCount || 0,
    aliasGroupCount: value.summary.aliasGroupCount || 0,
    aliasEntryCount: value.summary.aliasEntryCount || 0,
    entriesWithPrototypeMethods: value.summary.entriesWithPrototypeMethods || 0,
    entriesWithStaticFields: value.summary.entriesWithStaticFields || 0,
    categoryCounts: value.summary.categoryCounts || {}
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

function triggerSurfaceText(report, surface) {
  const row = report?.surfaces?.[surface];
  if (!row) return `${surface}: no row`;
  return `${surface}: ${row.classCount || 0} classes/${row.methodCount || 0} methods/purchase-risk ${row.purchaseRiskCount || 0}`;
}

function compactRecords(records, names) {
  const displayName = (record) => {
    const firstArg = record.args?.[0];
    if ((record.name === "ged.event" || record.name === "proxy.event") && typeof firstArg === "string") return `${record.name}:${firstArg}`;
    return record.name;
  };
  const recordText = (record) => [
    record.name,
    ...(record.args || []).map((arg) => {
      if (typeof arg === "string") return arg;
      if (!arg || typeof arg !== "object") return "";
      return [
        arg.className,
        arg.name,
        arg.SceneName,
        arg.sceneName,
        arg.values?.msg?.className,
        arg.values?.WindowName
      ].filter(Boolean).join(" ");
    })
  ].filter(Boolean).join(" ");
  return (records || [])
    .filter((record) => !names || names.some((name) => recordText(record).includes(name)))
    .slice(0, 40)
    .map((record) => ({
      seq: record.seq,
      name: record.name,
      displayName: displayName(record),
      kind: record.kind,
      scene: record.scene?.sceneName || "",
      args: (record.args || []).slice(0, 2)
    }));
}

function findClass(dump, name) {
  return dump.value.classes.find((item) => item.registeredName === name);
}

function ownMethodMap(item) {
  const map = new Map();
  const descriptors = item?.prototypeChain?.[0]?.descriptors || [];
  for (const descriptor of descriptors) {
    if (descriptor.fn) map.set(descriptor.name, descriptor.fn);
  }
  return map;
}

function shortSource(source, max = 900) {
  if (!source) return "";
  const normalized = source.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function methodEvidence(dump) {
  const out = {};
  for (const [className, methods] of Object.entries(methodSelections)) {
    const cls = findClass(dump, className);
    if (!cls) {
      out[className] = { missing: true };
      continue;
    }
    const methodMap = ownMethodMap(cls);
    out[className] = {
      registeredName: cls.registeredName,
      functionName: cls.functionName,
      reverseNames: cls.reverseNames,
      selectedMethods: methods.map((name) => {
        const fn = methodMap.get(name);
        return fn ? {
          name,
          arity: fn.arity,
          sourceLength: fn.sourceLength,
          sourceHash: fn.sourceHash,
          source: fn.source
        } : { name, missing: true };
      })
    };
  }
  return out;
}

function writeMethodTable(lines, evidence, className) {
  const item = evidence[className];
  lines.push(`### ${className}`);
  lines.push("");
  if (!item || item.missing) {
    lines.push("- missing in focused source dump");
    lines.push("");
    return;
  }
  lines.push(`- functionName: \`${item.functionName}\``);
  lines.push(`- reverseNames: \`${item.reverseNames.join(", ")}\``);
  lines.push("");
  lines.push("| Method | Hash | Length | Notes |");
  lines.push("| --- | --- | ---: | --- |");
  for (const method of item.selectedMethods) {
    if (method.missing) {
      lines.push(`| \`${method.name}\` | missing |  |  |`);
    } else {
      lines.push(`| \`${method.name}\` | \`${method.sourceHash}\` | ${method.sourceLength} | \`${shortSource(method.source, 180).replaceAll("|", "\\|")}\` |`);
    }
  }
  lines.push("");
}

function buildMarkdown({
  dump,
  evidence,
  closeSample,
  currentBackSample,
  sceneEnterNextSample,
  battleSamples,
  tableTransitionSample,
  tablegameInspection,
  tablegameFocusReport,
  battleEndScan,
  battleEndClose,
  battleEndConfirmLeave,
  kanshuStateSample,
  allNamesReport,
  oldScriptMap,
  yanJiaoReport,
  yanJiaoListWatch,
  yanJiaoCandidateReport,
  objectiveCoverageReport,
  fieldContextReport,
  allSourceContextReport,
  semanticInheritanceReport,
  liveObjectState,
  liveFieldSourceJoin,
  classUtilsInspect,
  modeSceneSurfaceReport,
  liveFieldGapReport,
  liveFieldGapTriageReport,
  liveOwnerSourceReport,
  liveFieldSemanticsReport,
  fieldSemanticIndexReport,
  goalRemainingAuditReport,
  liveProofPlaybookReport,
  triggerMonitoringReport,
  surfaceMonitorSample,
  liveGapWatch,
  eventFieldTransitionWatch,
  currentWindowAction,
  uiStateTransitionSample,
  uiStateDirectEventSample,
  rightPanelToggleSample,
  promptAutomationMonitor,
  hoverFieldTooltip,
  hoverHandlerFieldTransition,
  hoverStageDelta,
  tooltipLifecycle,
  rogueTooltipInspect,
  rogueActionSurface,
  rogueActiveSample,
  rogueGameSceneInspect,
  rogueSkillZhanfaProbe,
  rogueBattleActionSurface,
  rogueBattlePromptInspect,
  rogueCurrentActionHandlerReport,
  rogueCurrentSkillButtonDetailReport,
  rogueHandlerFieldJoinReport,
  rogueEndedExitReport,
  blessOpenSample,
  blessEffectBlockProbe,
  qixingWatch,
  resourceReplacementProbe,
  resourceLoadSchemeProof,
  rogueSamples
}) {
  const lines = [];
  const sourcePath = dump.__path || "";
  lines.push("# Runtime Mechanism Findings");
  lines.push("");
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Focus source: ${sourcePath}`);
  lines.push(`- Page: ${dump.value.page?.title || ""} ${dump.value.page?.url || ""}`);
  lines.push(`- ResourceVersion: ${dump.value.runtime?.resourceVersion || ""}`);
  lines.push(`- Current scene at source dump: ${dump.value.runtime?.scene?.sceneName || ""}`);
  lines.push("");
  lines.push("## Stable Monitoring Anchors");
  lines.push("");
  lines.push("- Class identity: `Laya.ClassUtils._classMap[registeredName]`, not minified function names.");
  lines.push("- UI/window identity: effective visible nodes under `Laya.stage`, especially `LBi` scene layer and `mWt` window layer.");
  lines.push("- Window open/close: `GED` / `WindowManager` events, plus stage node creation/removal.");
  lines.push("- Scene/battle entry: `SceneManager` transition plus visible scene node; battle proof is a visible battle scene (`TableGameScene` or Rogue `RogueLikeGameScene`) with `manager.seats`.");
  lines.push("- Protocol/game events: `ServerProxy`/`zs.I()` events and `GED` events; do not treat console output as the event bus.");
  lines.push("");

  lines.push("## Objective Coverage Matrix");
  lines.push("");
  if (objectiveCoverageReport) {
    const statusText = Object.entries(objectiveCoverageReport.statusCounts)
      .map(([status, count]) => `${status}:${count}`)
      .join("; ");
    lines.push(`- Report: ${objectiveCoverageReport.mdPath}`);
    lines.push(`- Requirements: ${objectiveCoverageReport.requirements}; monitoring method rows: ${objectiveCoverageReport.monitoringMethods}; status summary: ${statusText || "(none)"}.`);
    lines.push("- This matrix maps the active objective to evidence files, monitoring methods, trigger/field notes, and remaining live-sample gaps.");
  } else {
    lines.push("- No objective coverage report found.");
  }
  lines.push("");

  lines.push("## All Names / Entrypoint Index");
  lines.push("");
  if (allNamesReport) {
    lines.push(`- Report dir: ${allNamesReport.dir}`);
    lines.push(`- Registered classes: ${allNamesReport.classes}; GED events: ${allNamesReport.gedEvents}; proxy events: ${allNamesReport.proxyEvents}; inferred field/name glossary rows: ${allNamesReport.fieldGlossary}.`);
    lines.push(`- Primary outputs: ${path.join(allNamesReport.dir, "all-registered-classes.tsv")}, ${path.join(allNamesReport.dir, "method-role-index.json")}, ${path.join(allNamesReport.dir, "event-handler-index.tsv")}, ${path.join(allNamesReport.dir, "field-meaning-glossary.md")}.`);
    if (classUtilsInspect) {
      lines.push(`- Live ClassUtils inspect: ${classUtilsInspect.mdPath}`);
      lines.push(`- ClassUtils keys=${classUtilsInspect.classUtilsKeys}; _classMap entries=${classUtilsInspect.classMapCount}; function entries=${classUtilsInspect.functionEntryCount}; aliasGroups=${classUtilsInspect.aliasGroupCount}; aliasEntries=${classUtilsInspect.aliasEntryCount}; Laya=${classUtilsInspect.layaVersion}.`);
      lines.push(`- Stable ClassUtils outputs: ${classUtilsInspect.entriesTsvPath}, ${classUtilsInspect.aliasGroupsTsvPath}.`);
    }
    if (modeSceneSurfaceReport) {
      const modeScene = summarizeModeSceneSurfaceReport(modeSceneSurfaceReport);
      lines.push(`- ModeScene surface report: ${modeScene.path}`);
      lines.push(`- ModeScene live surface: scene=${modeScene.scene}; nodes=${modeScene.nodes}; buttons=${modeScene.buttons}; entries=${modeScene.entries}; resourceNodes=${modeScene.resourceNodes}; windows=${modeScene.windows}; purchaseRiskButtons=${modeScene.purchaseRiskButtons}; registeredNodeMatches=${modeScene.registeredNodeMatches}; classMapSize=${modeScene.classMapSize}.`);
    }
    if (fieldContextReport) {
      const summary = fieldContextReport.summary || {};
      lines.push(`- Focused field context: ${fieldContextReport.mdPath}`);
      lines.push(`- Focused source classes: ${summary.sourceClassCount || 0}; own-source instance fields: ${summary.ownSourceDiscoveredFields || 0}; total source-visible fields: ${summary.sourceDiscoveredFields || 0}; source event bindings: ${summary.eventBindings || 0}.`);
    }
    if (allSourceContextReport) {
      lines.push(`- All-source context: ${allSourceContextReport.mdPath}`);
      lines.push(`- All-source classes: ${allSourceContextReport.capturedClasses}; missing=${allSourceContextReport.missingClasses}; source chunks=${allSourceContextReport.chunkCount}; method contexts=${allSourceContextReport.methodContexts}; source field rows=${allSourceContextReport.sourceFieldRows}; event bindings=${allSourceContextReport.eventBindings}.`);
    }
    if (semanticInheritanceReport) {
      const summary = semanticInheritanceReport.summary || {};
      lines.push(`- Semantic inheritance / enum report: ${semanticInheritanceReport.mdPath}`);
      lines.push(`- Exact enum/static constants: ${summary.exactEnumValues || 0}; enum-like classes: ${summary.enumClassCount || 0}; inherited method refs: ${summary.inheritedMethodRefs || 0}; field-owner rows: ${summary.fieldOwnerRows || 0}; unknown-private field rows: ${summary.unknownPrivateFieldRows || 0}.`);
    }
    if (liveObjectState) {
      const groups = Object.entries(liveObjectState.groups || {}).map(([group, count]) => `${group}:${count}`).join(",") || "(none)";
      lines.push(`- Live object state audit: ${liveObjectState.mdPath}`);
      lines.push(`- Live object state fields: scene=${liveObjectState.scene}; samples=${liveObjectState.sampleCount}; fieldRows=${liveObjectState.fieldRows}; groups=${groups}; manager=${liveObjectState.managerCtor}; isGameOver=${liveObjectState.isGameOver}; selfHandCards=${liveObjectState.selfHandCards}.`);
    }
    if (liveFieldSourceJoin) {
      lines.push(`- Live field/source join: ${liveFieldSourceJoin.mdPath}`);
      lines.push(`- Live field/source rows: scene=${liveFieldSourceJoin.scene}; liveRows=${liveFieldSourceJoin.liveRows}; sourceMatched=${liveFieldSourceJoin.sourceMatchedRows}; semanticMatched=${liveFieldSourceJoin.semanticMatchedRows}; owner+field=${liveFieldSourceJoin.exactMatches}; purchaseRiskRows=${liveFieldSourceJoin.purchaseRiskRows}.`);
    }
    if (liveFieldGapReport) {
      lines.push(`- Live field gap worklist: ${liveFieldGapReport.mdPath}`);
      lines.push(`- Weak fields: raw=${liveFieldGapReport.rawWeakRows}; deduped=${liveFieldGapReport.weakRows}; purchaseRisk=${liveFieldGapReport.purchaseRiskRows}; topSurfaces=${liveFieldGapReport.topSurfaces.join(",") || "(none)"}.`);
    }
    if (liveFieldGapTriageReport) {
      lines.push(`- Live field gap triage: ${liveFieldGapTriageReport.mdPath}`);
      lines.push(`- Gap triage rows: inputWeak=${liveFieldGapTriageReport.inputWeakRows}; explainedOrGeneric=${liveFieldGapTriageReport.explainedRows}; needsLive=${liveFieldGapTriageReport.needsLiveRows}; permissionGated=${liveFieldGapTriageReport.permissionGatedRows}; needsLiveBuckets=${liveFieldGapTriageReport.topNeedsLiveBuckets.join(",") || "(none)"}.`);
      lines.push(`- Gap triage outputs: ${liveFieldGapTriageReport.triageTsvPath}, ${liveFieldGapTriageReport.bucketSummaryTsvPath}.`);
    }
    if (liveOwnerSourceReport) {
      lines.push(`- Live owner source report: ${liveOwnerSourceReport.mdPath}`);
      lines.push(`- Live owner source refs: scene=${liveOwnerSourceReport.scene}; targets=${liveOwnerSourceReport.targetCount}; exactPath=${liveOwnerSourceReport.exactPath}; fieldRefTargets=${liveOwnerSourceReport.targetsWithFieldRefs}; fieldRefMethods=${liveOwnerSourceReport.fieldRefMethods}; matches=${Object.entries(liveOwnerSourceReport.matchCounts || {}).map(([match, count]) => `${match}:${count}`).join(",") || "(none)"}.`);
      lines.push(`- Live owner outputs: ${liveOwnerSourceReport.targetsTsvPath}, ${liveOwnerSourceReport.fieldMethodRefsTsvPath}.`);
    }
    if (liveFieldSemanticsReport) {
      lines.push(`- Live field semantics report: ${liveFieldSemanticsReport.mdPath}`);
      lines.push(`- Live field semantics rows: owners=${liveFieldSemanticsReport.owners}; fieldRows=${liveFieldSemanticsReport.fieldRows}; uniqueFields=${liveFieldSemanticsReport.uniqueFields}; high=${liveFieldSemanticsReport.highConfidenceRows}; methodRefs=${liveFieldSemanticsReport.fieldsWithMethodRefs}; joined=${liveFieldSemanticsReport.fieldsWithJoinedMeaning}; topSurfaces=${liveFieldSemanticsReport.topSurfaces.join(",") || "(none)"}.`);
      lines.push(`- Live field semantics outputs: ${liveFieldSemanticsReport.tsvPath}, ${liveFieldSemanticsReport.methodEvidenceTsvPath}.`);
    }
    if (fieldSemanticIndexReport) {
      lines.push(`- Field semantic index report: ${fieldSemanticIndexReport.mdPath}`);
      lines.push(`- Field semantic index rows: fields=${fieldSemanticIndexReport.fieldIndexRows}; classes=${fieldSemanticIndexReport.classSummaryRows}; sourceOwners=${fieldSemanticIndexReport.semanticOwnerRows}; triggerRefs=${fieldSemanticIndexReport.triggerFieldRefs}; liveMapped=${fieldSemanticIndexReport.liveMappedRows}; handlerMapped=${fieldSemanticIndexReport.handlerMappedRows}; triageMapped=${fieldSemanticIndexReport.triageMappedRows}; unresolved=${fieldSemanticIndexReport.unresolvedRows}; needsLive=${fieldSemanticIndexReport.needsLiveRows}; permissionGated=${fieldSemanticIndexReport.permissionGatedRows}; evidence=${fieldSemanticIndexReport.evidenceCounts.join(",") || "(none)"}.`);
      lines.push(`- Field semantic outputs: ${fieldSemanticIndexReport.fieldIndexTsvPath}, ${fieldSemanticIndexReport.classCoverageTsvPath}, ${fieldSemanticIndexReport.unresolvedTsvPath}.`);
    }
    if (goalRemainingAuditReport) {
      lines.push(`- Goal remaining audit: ${goalRemainingAuditReport.mdPath}`);
      lines.push(`- Remaining audit rows: cases=${goalRemainingAuditReport.cases}; scriptCoverage=${goalRemainingAuditReport.scriptsOkCases}/${goalRemainingAuditReport.cases}; unresolved=${goalRemainingAuditReport.unresolvedRows}; needsLive=${goalRemainingAuditReport.needsLiveRows}; permissionGated=${goalRemainingAuditReport.permissionGatedRows}; buckets=${goalRemainingAuditReport.unresolvedBuckets.join(",") || "(none)"}.`);
      lines.push(`- Remaining audit outputs: ${goalRemainingAuditReport.tsvPath}.`);
    }
    if (liveProofPlaybookReport) {
      lines.push(`- Live proof playbook: ${liveProofPlaybookReport.mdPath}`);
      lines.push(`- Live proof rows: cases=${liveProofPlaybookReport.caseCount}; unresolvedRows=${liveProofPlaybookReport.playbookRows}; needsLive=${liveProofPlaybookReport.needsLiveRows}; permissionGated=${liveProofPlaybookReport.permissionGatedRows}; purchaseRisk=${liveProofPlaybookReport.purchaseRiskRows}; topCases=${liveProofPlaybookReport.topCases.join(",") || "(none)"}.`);
      lines.push(`- Live proof outputs: ${liveProofPlaybookReport.playbookTsvPath}, ${liveProofPlaybookReport.caseSummaryTsvPath}.`);
    }
    if (eventFieldTransitionWatch) {
      const eventField = summarizeEventFieldTransitionWatch(eventFieldTransitionWatch);
      lines.push(`- Event-field transition watcher: ${eventField.mdPath}`);
      lines.push(`- Event-field transition rows: scene=${eventField.scene}; wrappers=${eventField.wrappers}; records=${eventField.records}; changed=${eventField.changedRecords}; snapshots=${eventField.snapshots}; blockedCalls=${eventField.blockedCalls}; labels=${eventField.topLabels.join(",") || "(none)"}.`);
      lines.push(`- Event-field transition outputs: ${eventField.recordsTsvPath}.`);
    }
    if (rogueHandlerFieldJoinReport) {
      const join = summarizeRogueHandlerFieldJoinReport(rogueHandlerFieldJoinReport);
      lines.push(`- Rogue handler-field join: ${join.mdPath}`);
      lines.push(`- Current action field rows: scene=${join.scene}; isGameOver=${join.isGameOver}; actionNodes=${join.actionNodes}; eventNodes=${join.eventNodes}; handlers=${join.handlerRows}; fieldRows=${join.fieldRows}; semanticMatched=${join.semanticMatchedFields}; triageMatched=${join.triageMatchedFields}; needsLiveWithHandlerEvidence=${join.needsLiveRowsSampledByCurrentHandlers}.`);
      lines.push(`- Handler-field outputs: ${join.fieldJoinTsvPath}, ${join.handlerSurfaceTsvPath}, ${join.needsLiveStrengthenedTsvPath}.`);
    }
    if (triggerMonitoringReport) {
      const summary = triggerMonitoringReport.summary || {};
      lines.push(`- Trigger monitoring matrix: ${triggerMonitoringReport.mdPath}`);
      lines.push(`- Trigger rows: ${summary.triggerRows || 0}; trigger classes: ${summary.triggerClasses || 0}; scanned method rows: ${summary.methodRowsScanned || 0}; purchase-risk rows: ${summary.purchaseRiskRows || 0}.`);
    }
    lines.push(liveObjectState
      ? (liveFieldGapReport
          ? `- This satisfies the current full registration-name enumeration surface, ClassUtils live registry capture, own-source context capture, exact enum/static constants, inherited method owner mapping, current live object-state field samples, live owner field-method refs, and ${fieldSemanticIndexReport?.fieldIndexRows || 0} merged class+field semantic rows. ${liveFieldGapReport.weakRows} deduped weak live fields are triaged into ${liveFieldGapTriageReport?.explainedRows ?? "unknown"} explained/generic, ${liveFieldGapTriageReport?.needsLiveRows ?? "unknown"} needs-live, and ${liveFieldGapTriageReport?.permissionGatedRows ?? "unknown"} permission-gated rows; event-field transition watcher adds ${eventFieldTransitionWatch ? summarizeEventFieldTransitionWatch(eventFieldTransitionWatch).wrappers : 0} before/after wrappers and ${eventFieldTransitionWatch ? summarizeEventFieldTransitionWatch(eventFieldTransitionWatch).records : 0} current records; current Rogue handler-field join strengthens ${rogueHandlerFieldJoinReport ? summarizeRogueHandlerFieldJoinReport(rogueHandlerFieldJoinReport).needsLiveRowsSampledByCurrentHandlers : 0} needs-live rows with event/handler evidence; remaining audit maps ${goalRemainingAuditReport?.cases ?? "unknown"} cases to ${goalRemainingAuditReport?.scriptsOkCases ?? "unknown"} script-complete monitor paths; live proof playbook assigns ${liveProofPlaybookReport?.playbookRows ?? "unknown"} unresolved rows to ${liveProofPlaybookReport?.caseCount ?? "unknown"} activation/success plans; merged unresolved/transition rows=${fieldSemanticIndexReport?.unresolvedRows ?? "unknown"}, so targeted transition samples still remain.`
          : "- This satisfies the current full registration-name enumeration surface, own-source context capture, exact enum/static constants, inherited method owner mapping, and one current live object-state field sample. Other scene/event-specific live-only meanings still require targeted proof.")
      : "- This satisfies the current full registration-name enumeration surface, own-source context capture, exact enum/static constants, and inherited method owner mapping for all live registered classes. Live-only state meanings still require targeted proof.");
  } else {
    lines.push("- No all-names report found.");
  }
  lines.push("");

  lines.push("## Old Script Behavior Map");
  lines.push("");
  if (oldScriptMap) {
    const groups = oldScriptMap.groupSummary || {};
    const groupText = Object.entries(groups)
      .filter(([, item]) => item.files?.length)
      .map(([name, item]) => `${name}:${item.files.length} files/${item.matchCount} hits`)
      .join("; ");
    lines.push(`- Report: ${oldScriptMap.mdPath}`);
    lines.push(`- Scanned scripts: ${oldScriptMap.scripts}; behavior groups: ${oldScriptMap.behaviors}; interesting methods/functions: ${oldScriptMap.methods}.`);
    lines.push(`- Pattern coverage: ${groupText || "(none)"}.`);
    lines.push("- Main conclusion: old scripts use CDP `Runtime.evaluate` plus `Laya.stage` traversal and method hooks; `console.log` is diagnostic output, not the game event bus.");
    lines.push("- Auto UI lifecycle from old scripts: known-card overlay binds to visible `TableGameScene`; rogue reward overlay binds to visible `RogueSmallMapScene`; KanShu binds to `KanShuWindow/wXi`; shop probes call `shopBtnClick()` and close `RogueJiShiWindow`.");
    lines.push("- `神诸葛/七星` in old scripts appears through public `general` zones / `publicPools` and `武将牌上` text handling, not a separate stable old-script entry named `神诸葛`.");
  } else {
    lines.push("- No old-script behavior map found.");
  }
  lines.push("");

  lines.push("## Live Surface Monitor");
  lines.push("");
  if (surfaceMonitorSample) {
    const status = surfaceMonitorSample.dump?.value?.status || {};
    const hooks = status.hookSummary || [];
    const blockedMethods = hooks.flatMap((item) => (item.installed || []).filter((method) => method.block).map((method) => `${item.className}.${method.method}`));
    lines.push(`- Sample: ${surfaceMonitorSample.__path}`);
    lines.push(`- Scene: ${status.scene?.sceneName || ""}; hookClasses=${status.hookClasses || 0}; wrappers=${status.wrapperCount || 0}; records=${status.recordCount || 0}; blockedCount=${status.blockedCount || 0}.`);
    lines.push(`- Covered classes include: ${hooks.filter((item) => item.installed?.length).map((item) => item.className).slice(0, 32).join(", ")}.`);
    lines.push(`- Purchase-risk methods blocked by default: ${blockedMethods.join(", ") || "(none)"}.`);
    lines.push("- This is the reusable monitoring implementation for hover, popup, selection, skill-trigger, Bless/QiFu effect, KanShu, YanJiao, GuanXing/Qixing, Rogue, and TableGame surfaces. It records calls but does not trigger actions by itself.");
  } else {
    lines.push("- No surface monitor sample found.");
  }
  lines.push("");

  lines.push("## Live Gap Watch");
  lines.push("");
  if (liveGapWatch) {
    const gap = summarizeLiveGapWatch(liveGapWatch);
    lines.push(`- Sample: ${gap.path}`);
    lines.push(`- Scene: ${gap.scene}; wrappers=${gap.wrappers}; records=${gap.records}; snapshots=${gap.snapshots}; blockedCalls=${gap.blockedCalls}.`);
    lines.push(`- Target max counts: ${Object.entries(gap.tagMax).map(([tag, count]) => `${tag}=${count}`).join(", ") || "(none)"}.`);
    lines.push(`- Blocked while active: ${gap.blocked.join(", ") || "(none)"}.`);
    lines.push("- This is a passive watcher for the remaining live gaps: Qixing/GuanXing, YanJiao, hover popup, select prompts, and battle state. It does not click or confirm by itself.");
    lines.push("- A target count is only a visible-node baseline unless paired with a method record; it does not upgrade a missing live popup/effect sample by itself.");
  } else {
    lines.push("- No live-gap watcher sample found.");
  }
  lines.push("");

  lines.push("## Current Window Action Surface");
  lines.push("");
  if (currentWindowAction) {
    const surface = summarizeCurrentWindowAction(currentWindowAction);
    lines.push(`- Sample: ${surface.path}`);
    lines.push(`- Scene: ${surface.scene}; manager=${surface.managerCtor}; seats=${surface.seatCount}; selfSeatIndex=${surface.selfSeatIndex}; isGameOver=${surface.isGameOver}.`);
    lines.push(`- Visible windows: ${surface.visibleWindows}/${surface.windows}; labels=${surface.windowLabels.join(", ") || "(none)"}.`);
    lines.push(`- Button candidates: ${surface.buttonCandidates}; purchaseRisk=${surface.purchaseRiskButtons}; closeBack=${surface.closeBackButtons}; confirmAction=${surface.confirmActionButtons}; tooltipHover=${surface.tooltipHoverButtons}.`);
    lines.push(`- Purchase-risk paths: ${surface.purchaseRiskPaths.join(", ") || "(none)"}.`);
    lines.push("- This is read-only current-state evidence for visible WindowLayer/current-scene button semantics. It does not click, confirm, buy, or read hidden opponent hand fields.");
  } else {
    lines.push("- No current-window action report found.");
  }
  lines.push("");

  lines.push("## UI State Transition Sample");
  lines.push("");
  if (uiStateTransitionSample) {
    const sample = summarizeUiStateTransitionSample(uiStateTransitionSample);
    lines.push(`- Safe default sample: ${sample.path}`);
    lines.push(`- Attempts=${sample.attempts}; clicked=${sample.clicked}; skipped=${sample.skipped}; directEventAllowed=${sample.directEventAllowed}; selectTabAllowed=${sample.selectTabAllowed}; finalSelected=${sample.finalSelected.join(",") || "(none)"}.`);
    lines.push(`- Guard calls: proxyLBlocked=${sample.proxyLBlockedCalls}; sceneSwitchBlocked=${sample.sceneSwitchBlockedCalls}; targets=${sample.targets.join(",") || "(none)"}.`);
    lines.push("- Default mode is read-only/gated for active tab calls; it records `SgsTabButton` fields such as `_selected`, `_value`, `_wholeData.value`, and parent `$xt.SelectTab(index)` source.");
  } else {
    lines.push("- No UI state transition sample found.");
  }
  if (uiStateDirectEventSample) {
    const direct = summarizeUiStateTransitionSample(uiStateDirectEventSample);
    lines.push(`- Direct-event active sample: ${direct.path}`);
    lines.push(`- clicked=${direct.clicked}/${direct.attempts}; selectedChanged=${direct.selectedChanged}; finalSelected=${direct.finalSelected.join(",") || "(none)"}; proxyLBlocked=${direct.proxyLBlockedCalls}; sceneSwitchBlocked=${direct.sceneSwitchBlockedCalls}.`);
    lines.push("- In the current ended Rogue scene, direct `SgsTabButton.event(click, eventObject)` reached the button event path but did not change selected tab state; parent `$xt.SelectTab(index)` is therefore the real state-change method and remains explicit-gated.");
  }
  lines.push("");

  lines.push("## Right Panel Toggle Sample");
  lines.push("");
  if (rightPanelToggleSample) {
    const initial = rightPanelToggleSample.snapshots?.initial?.rightPanel || {};
    const afterFirst = rightPanelToggleSample.snapshots?.afterFirstToggle?.rightPanel || {};
    const afterSecond = rightPanelToggleSample.snapshots?.afterSecondToggle?.rightPanel || {};
    const clickHandler = initial.toggleButtonEvents?.click?.[0] || {};
    lines.push(`- Sample: ${rightPanelToggleSample.__path}`);
    lines.push(`- Event binding: rightPanelToggleBtn.click -> ${clickHandler.caller || ""}.${clickHandler.method || ""}.`);
    lines.push(`- First toggle: rightView ${initial.rightViewVisible} -> ${afterFirst.rightViewVisible}; chatDragSprite ${initial.chatDragSpriteVisible} -> ${afterFirst.chatDragSpriteVisible}.`);
    lines.push(`- Second toggle: rightView ${afterFirst.rightViewVisible} -> ${afterSecond.rightViewVisible}; finalRestored=${rightPanelToggleSample.judgement?.finalRestored === true}.`);
    lines.push(`- Called methods: ${(rightPanelToggleSample.judgement?.calledMethods || []).join(", ") || "(none)"}.`);
    lines.push("- This is the current default safe UI action sample. It does not call `PauseBtnClickHander()` or `BackBtnClickHandler()`.");
  } else {
    lines.push("- No right-panel toggle sample found.");
  }
  lines.push("");

  lines.push("## Prompt Automation Monitor");
  lines.push("");
  if (promptAutomationMonitor) {
    const summary = promptAutomationMonitor.summary || {};
    lines.push(`- Sample: ${promptAutomationMonitor.__path}`);
    lines.push(`- Scene: ${summary.scene || ""}; isGameOver=${summary.isGameOver === true}; wrappers=${summary.wrapperCount || 0}; classHooks=${summary.classHookCount || 0}; instanceHooks=${summary.instanceHookCount || 0}; sendHooks=${summary.sendHookCount || 0}.`);
    lines.push(`- Records: ${summary.records || 0}; promptNodes=${summary.promptNodes || 0}; visiblePromptWindows=${summary.visiblePromptWindows || 0}; restoredWrappers=${summary.restoredWrappers || 0}.`);
    lines.push("- Scope: preview-only hooks for SelectCardWindow, SpellMultiSelectorWindow, SkillBiFa, MilitaryOrders, current NBi/uBt, GED/proxy/window send paths; no click, confirm, buy, discard, or send automation was executed.");
    lines.push("- Current sample is ended-state, so it proves hook stability and restore behavior; a non-ended per-skill prompt is still needed before active auto-confirm/use.");
  } else {
    lines.push("- No prompt automation monitor found.");
  }
  lines.push("");

  lines.push("## Rogue Ended-State Exit Paths");
  lines.push("");
  if (rogueEndedExitReport) {
    const endedExit = summarizeRogueEndedExitReport(rogueEndedExitReport);
    lines.push(`- Read-only report: ${endedExit.path}`);
    lines.push(`- Scene=${endedExit.scene}; manager=${endedExit.managerCtor}; isGameOver=${endedExit.isGameOver}; visibleWindows=${endedExit.visibleWindows}; buttonCandidates=${endedExit.buttonCandidates}; sourceMethods=${endedExit.methodCount}.`);
    lines.push(`- Confirm-gated methods: ${endedExit.confirmGatedMethods.join(", ") || "(none)"}.`);
    lines.push(`- Send/leave/restart methods: ${endedExit.sendOrLeaveMethods.join(", ") || "(none)"}.`);
    lines.push(`- Scene-switch-only methods: ${endedExit.sceneSwitchMethods.join(", ") || "(none)"}; purchase-risk methods: ${endedExit.purchaseRiskMethods.join(", ") || "(none)"}.`);
    lines.push("- Conclusion: current ended Rogue scene has no pure local scene-switch exit candidate in this report. `BackBtnClickHandler` already returned false in the live sample; leave/restart methods should stay gated until an explicit confirm-safe or leave-safe sample is desired.");
  } else {
    lines.push("- No Rogue ended-state exit report found.");
  }
  lines.push("");

  lines.push("## Semantic Inheritance / Enum Values");
  lines.push("");
  if (semanticInheritanceReport) {
    const summary = semanticInheritanceReport.summary || {};
    lines.push(`- Report: ${semanticInheritanceReport.mdPath}`);
    lines.push(`- Class inheritance TSV: ${semanticInheritanceReport.classInheritanceTsv}`);
    lines.push(`- Enum values TSV: ${semanticInheritanceReport.enumValuesTsv}`);
    lines.push(`- Field owner TSV: ${semanticInheritanceReport.fieldOwnerTsv}`);
    lines.push(`- Summary: exactEnumValues=${summary.exactEnumValues || 0}; enumClassCount=${summary.enumClassCount || 0}; classesWithInheritedOwners=${summary.classesWithInheritedOwners || 0}; inheritedMethodRefs=${summary.inheritedMethodRefs || 0}; fieldOwnerRows=${summary.fieldOwnerRows || 0}; sourceOnlyFieldRows=${summary.sourceOnlyFieldRows || 0}; riskFieldRows=${summary.riskFieldRows || 0}.`);
    lines.push("- Exact constants such as `ProtocolId.*`, `SkillId.*`, `GsCRoleOptTargetNtf.OPT_SKILL_FLAG1`, and `MsgClientOperateInGameNtf.MsgID_QiXing` are now extracted from saved runtime descriptors.");
  } else {
    lines.push("- No semantic inheritance report found.");
  }
  lines.push("");

  lines.push("## Trigger Monitoring Matrix");
  lines.push("");
  if (triggerMonitoringReport) {
    const summary = triggerMonitoringReport.summary || {};
    const surfaces = [
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
    ];
    lines.push(`- Report: ${triggerMonitoringReport.mdPath}`);
    lines.push(`- Index: ${triggerMonitoringReport.indexPath}`);
    lines.push(`- Playbook: ${triggerMonitoringReport.playbookPath}`);
    lines.push(`- Summary: triggerRows=${summary.triggerRows || 0}; triggerClasses=${summary.triggerClasses || 0}; methodRowsScanned=${summary.methodRowsScanned || 0}; purchaseRiskRows=${summary.purchaseRiskRows || 0}.`);
    lines.push(`- Surfaces: ${surfaces.map((surface) => triggerSurfaceText(triggerMonitoringReport, surface)).join("; ")}.`);
    lines.push("- Hook target format is stable registered class identity: `Laya.ClassUtils._classMap[registeredName].prototype[method]` or constructor/static paths. Purchase-risk candidates are classified for default blocking.");
  } else {
    lines.push("- No trigger-monitoring report found.");
  }
  lines.push("");

  lines.push("## Resource Drawing / Replacement");
  lines.push("");
  lines.push(`- Supplement report: ${path.join(explorationRoot, "resource-drawing-and-replacement.md")}`);
  if (triggerMonitoringReport) lines.push(`- Trigger surface: ${triggerSurfaceText(triggerMonitoringReport, "resource-drawing")}.`);
  if (modeSceneSurfaceReport) {
    const modeScene = summarizeModeSceneSurfaceReport(modeSceneSurfaceReport);
    lines.push(`- ModeScene resource surface: ${modeScene.path}`);
    lines.push(`- Current ModeScene nodes=${modeScene.nodes}; resource/drawing field nodes=${modeScene.resourceNodes}; buttons/entries=${modeScene.buttons}/${modeScene.entries}; windows=${modeScene.windows}; resourceVersion=${modeScene.resourceVersion}; actionTaken=${modeScene.actionTaken}.`);
    lines.push("- ModeScene texture rows show current resources on `_skin`, `graphics._one.texture`, and `graphics._cmds[].texture`; inspect `mode-scene-nodes.tsv`, `mode-scene-fields.tsv`, and `mode-scene-methods.tsv` beside the JSON for concrete paths.");
  }
  if (resourceReplacementProbe) {
    const resource = summarizeResourceReplacementProbe(resourceReplacementProbe);
    lines.push(`- Live probe: ${resource.path}`);
    lines.push(`- Current runtime: resourceVersion=${resource.resourceVersion}; Laya=${resource.layaVersion}; manifestSize=${resource.manifestSize}; sampleTextures=${resource.sampleTextures}.`);
    lines.push(`- Draw proof: drawTexture=${resource.drawOk}; temporary Sprite was added to ` + "`Laya.stage`" + " and removed by the probe.");
    lines.push(`- Rewrite proof: URL.customFormat=${resource.customFormatType}; ResourceVersion.addVersionPrefix=${resource.addVersionPrefix ? "present" : "missing"}; formatURL probe result=${resource.formatURLResult}; customFormatCalls=${resource.customFormatCalls}; addVersionPrefixCalls=${resource.addVersionPrefixCalls}.`);
  }
  if (resourceLoadSchemeProof) {
    const schemes = summarizeResourceLoadSchemeProof(resourceLoadSchemeProof);
    lines.push(`- Load scheme proof: ${schemes.path}`);
    lines.push(`- Scheme results: file=${schemes.statuses["file-url"] || ""}; local-http=${schemes.statuses["local-http"] || ""}; same-origin-https=${schemes.statuses["same-origin-https"] || ""}; data=${schemes.statuses["data-url"] || ""}; fixture=${schemes.fixturePath}.`);
  }
  lines.push("- Current live resource entry is `versionConf.js -> window.resourceVersion -> version.json?v=<resourceVersion>`; old `version.js id -> file` wording is not the current verified model.");
  lines.push("- Current manifest keys are logical resource paths, such as `res/runtime/pc/.../a.png`; the value is a version number, not a numeric resource id mapping.");
  lines.push("- Draw image resources through normal Laya surfaces: `new Laya.Image().skin = path`, `Sprite.graphics.loadImage(path, x, y, w, h)`, or `Laya.loader.load(path)` followed by `graphics.drawTexture(texture, ...)`.");
  lines.push("- For assistant overlays, create a named root such as `__codex_resource_overlay__`, set `mouseEnabled = false` / `mouseThrough = true`, and destroy that root when the visible scene changes.");
  lines.push("- Stable replacement hook is the logical path before final URL formatting: wrap `Laya.ResourceVersion.addVersionPrefix` or `Laya.URL.customFormat`, match `res/.../a.png`, and return the replacement URL.");
  lines.push("- The latest live scheme proof loaded `file://`, `http://127.0.0.1`, same-origin `https://`, and `data:` replacements as textures in this Chrome/Laya run. For reproducible tooling, prefer local HTTP with CORS/no-store, `data:`/`blob:` URLs for small temporary assets, or CDP/extension request fulfillment over relying on `file://` policy.");
  lines.push("- A network replacement like `https://aaa.png` can work only if the server allows image/CORS use; otherwise Laya/canvas/WebGL loading can fail or taint the texture.");
  lines.push("- Already loaded resources may remain cached by `Laya.Loader`, Image nodes, atlases, Prefabs, or graphics draw commands. After installing a rewrite hook, clear the old resource and refresh/recreate the node or window.");
  lines.push("- This remains stable across business-code re-minification because the anchor is public Laya resource formatting plus the logical resource path; only the current wrapper relation should be rechecked live.");
  lines.push("");

  lines.push("## YanJiao / 严教");
  lines.push("");
  if (yanJiaoReport) {
    lines.push(`- Detailed report: ${yanJiaoReport.mdPath}`);
    lines.push(`- Source coverage: YanJiao methods=${yanJiaoReport.yanJiaoMethods}; YanJiaoWindow methods=${yanJiaoReport.windowMethods}; skill-audit rows=${yanJiaoReport.skillAuditRows}.`);
  }
  if (yanJiaoCandidateReport) {
    const candidate = summarizeYanJiaoCandidateReport(yanJiaoCandidateReport);
    lines.push(`- Candidate-list implementation report: ${candidate.mdPath}`);
    lines.push(`  - Status=${candidate.level}; methodRows=${candidate.methodRows}; fieldRows=${candidate.fieldRows}; flowSteps=${candidate.flowSteps}; watcherLiveInstallable=${candidate.watcherLiveInstallable}; realWindowSample=${candidate.realWindowSample}; candidateRenderProven=${candidate.candidateRenderProven}.`);
    lines.push(`  - Preview click contract: ${candidate.previewClick || "win.showSplitCard(index) -> win.layoutCardUIs(true)"}. Explicit auto-submit: ${candidate.explicitAutoSubmit || "win.sendAutoChooseMoveOpt()"}.`);
    lines.push(`  - TSVs: ${candidate.flowTsvPath}; ${candidate.methodEvidenceTsvPath}; ${candidate.fieldActionMapTsvPath}.`);
  }
  if (yanJiaoListWatch) {
    const watch = summarizeYanJiaoListWatch(yanJiaoListWatch);
    lines.push(`- Live watcher: ${watch.path}`);
    lines.push(`  - Scene=${watch.scene}; class=${watch.classExists}; function=${watch.functionName}; wrappers=${watch.wrappers}; visibleWindows=${watch.windows}; renderRecords=${watch.renderRecords}; candidateClicks=${watch.candidateClicks}; sendRecords=${watch.sendRecords}; previewOnly=${watch.previewOnly}; restoredWrappers=${watch.restoredWrappers}; errors=${watch.errors}.`);
    lines.push("  - The watcher creates `__codex_yanjiao_candidate_list__` under `YanJiaoWindow`; row clicks preview with `showSplitCard(index)` + `layoutCardUIs(true)` and do not submit while preview-only is enabled.");
  }
  lines.push("- Skill trigger responder: `YanJiao.GetResponser(t)` returns a responder only when `t.Type == cVi.OPT_SKILL_FLAG1`.");
  lines.push("- The responder is configured with `ResponseAlways = true` and `WindowName = \"YanJiaoWindow\"`, so the window name is a stable hook.");
  lines.push("- Server move-card notification path: `YanJiao.OnMsgMoveCard(t)` calls `ms.I().UpdateWindow(\"YanJiaoWindow\", t)`.");
  lines.push("- Discard recording path: `MoveCardToZoneResponse(t)` records when `t.ToZone == ygt.ZONE_DISCARDPILE`; fields used include `CardIDs`, `SrcSeatID`, and skill `ID`.");
  lines.push("- `YanJiaoWindow.UpdateWindow(t)` reads `t.Protocol`, filters `Type_In_Spell`, and accepts `MsgID_YanJiao` / `MsgID_YanJiao_AutoChoose`.");
  lines.push("- Auto split path: `autoChooseClick()` -> `showSplitCard(index)` -> `layoutCardUIs(true)` -> `sendAutoChooseMoveOpt()`.");
  lines.push("- Sent payload: new `sy`, `Type = sy.Type_In_Spell`, `SeatID = selfSeat.Index`, `MsgID = sy.MsgID_YanJiao_AutoChoose`, `MData = groupA + [0] + groupB`.");
  lines.push("- UI extension point for the requested right-side list: after `showWindow()`/`layoutCardUIs()`, compute possible split sets from `findEqualSubsequences()` / `splitCardArr`; clicking a list row should call `showSplitCard(rowIndex)`, then `layoutCardUIs(true)`, and only auto-send if explicitly desired.");
  lines.push("- For implementation, use a Laya child under the window/content sprite for a clickable right-side list; display-only DOM overlays must keep `pointer-events: none`.");
  lines.push("- Direction caveat: source shows `showSplitCard()` renders A into `selfCardUIs` and B into `targetCardUIs`, while manual confirm sends `targetCardUIs + [0] + selfCardUIs` through `VVt.SendMoveCard(...)`.");
  lines.push("");

  lines.push("## Shen Zhuge / Qixing");
  lines.push("");
  lines.push("- Skill audit maps `七星` to skill id `307` under `神诸葛亮`; it is tracker-relevant through `deck.top.put` and `public.general` categories.");
  lines.push("- Current registered class hooks are `GuanXing`, `GuanXingPo`, `GuanXingPoker`, `GuanXingRace`, and `GuanXingWindow`.");
  lines.push("- `GuanXing.MoveCardToZoneResponse(t)` opens `GuanXingWindow` when `t.ToZone == ZONE_SPELL`, then delegates deck top/bottom movement handling.");
  lines.push("- `GuanXingWindow.updateTitle()` switches the title/description according to `Skill.Name` and source seat, so it is a stable popup/window identity point.");
  lines.push("- General-card public zones should be read through the tracker public-zone path, not hidden hand fields: `Scripts/src/runtime/sources/public-zone-core.cjs` recognizes fields such as `generalCards`, `generalPileCards`, `markCards`, `pileCards`, and `outsideCards` as `public-general-runtime`.");
  lines.push("- For `神诸葛亮` popup cards, treat visible cards on/beside the general as public-general cards after runtime/protocol evidence. Do not infer hidden hand content from the popup machinery.");
  if (qixingWatch) {
    const qixing = summarizeQixingWatch(qixingWatch);
    lines.push(`- Focused watcher: ${qixing.path}`);
    lines.push(`  - Scene=${qixing.scene}; wrappers=${qixing.wrappers}; records=${qixing.records}; snapshots=${qixing.snapshots}; blockedSends=${qixing.blockedSends}; errors=${qixing.errors}.`);
    lines.push(`  - Classes: QiXing=${qixing.qixingExists}; QiXingWindow=${qixing.qixingWindowExists} (${qixing.qixingWindowMethods} methods); GuanXingWindow=${qixing.guanXingWindowExists} (${qixing.guanXingWindowMethods} methods); installedClasses=${qixing.installedClasses}.`);
    lines.push(`  - Observed targets: targetWindows=${qixing.targetWindows}; visibleTargetWindows=${qixing.visibleTargetWindows}; visibleWindowCards=${qixing.visibleWindowCards}; battleScenes=${qixing.battleScenes}; publicGeneralCards=${qixing.publicGeneralCards}.`);
    if (qixing.visibleTargetWindows > 0 || qixing.visibleWindowCards > 0 || qixing.publicGeneralCards > 0) {
      lines.push("- The focused watcher has live target evidence; inspect the sidecar for card identities and cleanup/protocol records.");
    } else {
      lines.push("- This run is a safe baseline: hooks are live and reversible, but no Qixing/GuanXing window or public-general card was visible in the current scene.");
    }
  }
  lines.push("");

  lines.push("## Card Selection / Auto Choose");
  lines.push("");
  lines.push("- `SelectCardWindow.autoSelect()` selects available cards according to `Skill.SelectCardCountWhenResponse` and card UI `CanBeSelected`.");
  lines.push("- `confirmClick()` is the send/confirm path; `cancelClick()` may call `fKt.Seat_Cancel(fKt.SelfSeatIndex)` before closing.");
  lines.push("- Card UI movement and hover are handled inside the window through card UI lists and Laya mouse events; stable monitor points are `onTouchCard`, `onTouchEnsure`, `confirmClick`, and protocol send methods.");
  lines.push("");

  lines.push("## Hover / Popup Windows");
  lines.push("");
  lines.push("- `SelectCardWindow` exposes card touch/ensure paths for normal selection windows.");
  lines.push("- `SkillSelectorWindow.cardRollOver(t)` clears the previous over-card state, sets the current card UI over state, and records `currentOverCardUI`; `cardRollOut()` and `showOverCard()` are the paired cleanup/display hooks.");
  lines.push("- `SkillSelectorWindow.layoutCardUis(...)` lays out the visible card UI list, so hover overlays should attach after this method or after the containing window becomes visible.");
  lines.push("- `SkillPopUpWindow.initBg(...)` and `layoutTxt()` are the stable skill-description popup drawing hooks; use the registered class name rather than the minified constructor name.");
  if (tooltipLifecycle) {
    const tooltipLife = summarizeTooltipLifecycleSample(tooltipLifecycle);
    lines.push(`- Tooltip lifecycle sample: ${tooltipLife.path}`);
    lines.push(`  - Scene=${tooltipLife.scene}; target=${tooltipLife.targetLabel} ${tooltipLife.targetPath}; mouseOver=${tooltipLife.mouseOverOk}; mouseOut=${tooltipLife.mouseOutOk}; call=${tooltipLife.callOk}; returned=${tooltipLife.returnedLabel}; cleanup=${tooltipLife.cleanupOk}.`);
    lines.push(`  - Stage tip counts before/mouseover/mouseout/direct/cleanup=${tooltipLife.tipsBefore}/${tooltipLife.tipsAfterMouseOver}/${tooltipLife.tipsAfterMouseOut}/${tooltipLife.tipsAfterDirectCreate}/${tooltipLife.tipsAfterCleanup}; direct tooltip object creation/cleanup is proved, while mouse-only stage attachment was not observed in this sample.`);
  }
  if (hoverFieldTooltip) {
    const fieldTip = summarizeHoverFieldTooltipSample(hoverFieldTooltip);
    lines.push(`- Field-bound tooltip hover sample: ${fieldTip.path}`);
    lines.push(`  - Scene=${fieldTip.scene}; candidates=${fieldTip.candidates}; sampledTargets=${fieldTip.sampledTargets}; mouseRecords=${fieldTip.mouseRecords}; eventRecords=${fieldTip.eventRecords}; methodRecords=${fieldTip.methodRecords}.`);
    lines.push(`  - Visible tip/window/stage delta observed=${fieldTip.visibleTipDeltaObserved}; maxTipDelta cdp/direct/final=${fieldTip.maxCdpDelta}/${fieldTip.maxDirectDelta}/${fieldTip.maxFinalDelta}; maxWindowDelta=${fieldTip.maxCdpWindowDelta}/${fieldTip.maxDirectWindowDelta}; maxTooltipNodeDelta=${fieldTip.maxCdpTooltipNodeDelta}/${fieldTip.maxDirectTooltipNodeDelta}; maxStageChildDelta=${fieldTip.maxCdpStageChildDelta}/${fieldTip.maxDirectStageChildDelta}; sampled tooltips=${fieldTip.sampledTooltips.join(" / ") || "(none)"}.`);
  }
  if (hoverHandlerFieldTransition?.length) {
    const hoverFields = summarizeHoverHandlerFieldTransitionSample(hoverHandlerFieldTransition);
    lines.push(`- Hover-handler field transition sample: ${hoverFields.path}`);
    lines.push(`  - Scene=${hoverFields.scene}; runs=${hoverFields.runCount}; offsets=${hoverFields.sampleOffsets.join("/")}; candidates=${hoverFields.candidates}; sampledTargets=${hoverFields.sampledTargets}; fieldDeltaTargets=${hoverFields.fieldDeltaTargets}; visibleDeltaTargets=${hoverFields.visibleDeltaTargets}; proxyLBlocked=${hoverFields.proxyLBlockedCalls}.`);
    lines.push(`  - Changed fields=${hoverFields.changedKeys.join(" / ") || "(none)"}; targets=${hoverFields.targets.join(" / ") || "(none)"}. This proves current hover handlers toggle button hover state fields even when no new popup/window node is attached.`);
  }
  if (hoverStageDelta) {
    const stageDelta = summarizeHoverStageDeltaSample(hoverStageDelta);
    lines.push(`- Lightweight hover stage-delta sample: ${stageDelta.path}`);
    lines.push(`  - Scene=${stageDelta.scene}; candidates=${stageDelta.candidates}; sampledTargets=${stageDelta.sampledTargets}; cdpHoverOk=${stageDelta.cdpHoverOk}; cdpHoverTimeouts=${stageDelta.cdpHoverTimeouts}; directOk=${stageDelta.directOk}; cleanup=${stageDelta.cleanupOk}.`);
    lines.push(`  - CDP delta observed=${stageDelta.cdpDeltaObserved}; direct-event delta observed=${stageDelta.directDeltaObserved}; maxTipLikeDelta=${stageDelta.maxTipLikeDelta}; maxWindowLayerChildDelta=${stageDelta.maxWindowLayerChildDelta}; targets=${stageDelta.sampledTexts.join(" / ") || "(none)"}.`);
  }
  if (rogueTooltipInspect) {
    const tooltip = summarizeRogueTooltipInspect(rogueTooltipInspect);
    lines.push(`- Rogue tooltip inspect: ${tooltip.path}`);
    lines.push(`  - Scene=${tooltip.scene}; inspectedNodes=${tooltip.inspectedNodes}; tooltipNodes=${tooltip.tooltipNodes}; activeTooltipNodes=${tooltip.activeTooltipNodes}; RogueFightWindowMethods=${tooltip.rogueFightMethods}.`);
    lines.push("  - `RogueFightWindow.createSkillBtn()` binds skill buttons to `showTipHandler`; `showTipHandler()` creates `UWi.ShowToolTip`; `showGeneralTipHandler()` creates `ujt.ShowToolTip` for enemy/general tips.");
  }
  lines.push("- A monitor should combine method hooks with visible `WindowLayer` inspection, because stale window registry entries can exist after close.");
  lines.push("");

  lines.push("## Auto Operation Surfaces");
  lines.push("");
  lines.push("- Card auto-select: `SelectCardWindow.autoSelect()` -> user-visible selected card state -> `confirmClick()` or `onTouchEnsure()`.");
  lines.push("- Multi-card spell selection: `SpellMultiSelectorWindow.enterWindow()` and `onTouch()` are the safe hooks to observe before any send path.");
  lines.push("- Skill-related card windows include `SkillSelectorWindow`, `SkillBiFaWindow`, `MilitaryOrdersSelectWindow`, and `MilitaryOrdersExecutionWindow`; use method hooks and visible-window checks before sending operations.");
  lines.push("- Auto play/discard/skill can be implemented only after the visible window, seat, selectable card list, and protocol send method are proven for that exact prompt. Do not call purchase or hidden-state paths while probing.");
  lines.push("");

  lines.push("## Battle / TableGameScene / RogueLikeGameScene");
  lines.push("");
  lines.push("- Battle UI truth source is `Laya.stage -> LBi -> TableGameScene` for normal battles, or `Laya.stage -> LBi -> RogueLikeGameScene` for current Rogue battles, then the scene's `manager/seats/seatContainer/stackCardContainer` objects.");
  lines.push("- Important methods captured: `gameStart`, `gameOverHandler`, `addCardsHandler`, `playNextCardMotion`, `UpdateCardByUseSpell`, and effect/card motion helpers.");
  lines.push("- Card tracker display should bind to effective visibility of a battle scene with `manager.seats`, and remove/hide immediately when no such visible battle scene remains.");
  lines.push("- For known-card facts, use public events/logs/visible player hand only; hidden opponent `handCards` is not a valid source.");
  lines.push("");

  lines.push("## Battle Entry Live Samples / 武将试炼进入战斗");
  lines.push("");
  if (battleSamples?.activityNextPage) {
    const action = battleSamples.activityNextPage.action?.action || {};
    lines.push(`- Activity page sample: ${battleSamples.activityNextPage.__path}`);
    lines.push(`  - ${action.called || ""}; page ${action.beforePage?.curPage || ""}/${action.beforePage?.maxPage || ""} -> ${action.afterPage?.curPage || ""}/${action.afterPage?.maxPage || ""}.`);
  }
  if (battleSamples?.enterGeneralTrial) {
    const action = battleSamples.enterGeneralTrial.action?.action || {};
    const records = battleSamples.enterGeneralTrial.dump?.value?.records || [];
    const switchRecord = records.find((record) => record.name === "SceneManager.SwitchScene");
    lines.push(`- Enter GeneralTrial sample: ${battleSamples.enterGeneralTrial.__path}`);
    lines.push(`  - Called ${action.called || ""} on \`${action.target?.label || ""}\`; target modeId=${action.target?.fields?.modeId || action.target?.mode147?.value || ""}.`);
    lines.push(`  - Switch record: ${switchRecord ? JSON.stringify(switchRecord.args) : "(none)"}.`);
    lines.push("  - Scene transition requires both `isSceneResCompele` and `isOutCompele`; when one is late, `nextScene` can exist before `GeneralTrialScene` is attached.");
  }
  if (battleSamples?.openChallenge) {
    const action = battleSamples.openChallenge.action?.action || {};
    const win = (battleSamples.openChallenge.after?.windows || []).find((item) => /GeneralTrialChallengeWin/.test(item.label || ""));
    lines.push(`- Open challenge sample: ${battleSamples.openChallenge.__path}`);
    lines.push(`  - Called ${action.called || ""} on \`${action.target?.label || ""}\`; visible window=${!!win}, isCanTiaoZhan=${win?.fields?.isCanTiaoZhan}.`);
  }
  if (battleSamples?.startChallenge) {
    const action = battleSamples.startChallenge.action?.action || {};
    const records = battleSamples.startChallenge.dump?.value?.records || [];
    lines.push(`- Start challenge sample: ${battleSamples.startChallenge.__path}`);
    lines.push(`  - Called ${action.called || ""}; first records include ${compactRecords(records, ["SHOW_FULL_MASK_LOADING", "ClientEnterpage", "AddTable", "UpdateTable"]).map((record) => `#${record.seq}:${record.displayName}`).join(", ")}.`);
    lines.push("  - The immediate post-click state may still be `GeneralTrialScene`/`TableScene`; final battle proof is not the click return value.");
  }
  if (tableTransitionSample) {
    const records = tableTransitionSample.dump?.records || [];
    const switchRecord = records.find((record) => record.name === "SceneManager.executeSwitchScene");
    const gameRecords = compactRecords(records, ["SceneManager.executeSwitchScene", "HIDE_CHALLENGE_GAME_START", "decodeGameRecordInitInfo", "MsgGamePlayCardNtf", "PubGsCMoveCard", "MsgGameShowFigure"]);
    lines.push(`- TableScene -> TableGameScene monitor: ${tableTransitionSample.__path}`);
    lines.push(`  - Final monitor scene: ${tableTransitionSample.dump?.status?.scene?.sceneName || ""}, isGameScene=${tableTransitionSample.dump?.status?.scene?.isGameScene}.`);
    lines.push(`  - Switch target: ${switchRecord?.args?.[0]?.className || switchRecord?.args?.[0]?.SceneName || switchRecord?.args?.[0]?.sceneName || "(not captured)"}.`);
    for (const record of gameRecords) {
      lines.push(`  - #${record.seq} ${record.kind} ${record.displayName} scene=${record.scene}`);
    }
  }
  if (battleSamples?.finalTableScan) {
    const proof = battleSamples.finalTableScan.after?.tableProofs?.[0];
    lines.push(`- Final TableGameScene proof: ${battleSamples.finalTableScan.__path}`);
    lines.push(`  - visible=${proof?.effectiveVisible}, hasManager=${proof?.tableProof?.hasManager}, hasSeats=${proof?.tableProof?.hasSeats}, seatCount=${proof?.tableProof?.seatCount}, selfSeatIndex=${proof?.tableProof?.selfSeatIndex}.`);
  }
  lines.push("- Conclusion: battle entry is observed through GED/proxy events plus `SceneManager` and a visible battle scene (`TableGameScene` for normal battle, `RogueLikeGameScene` for current Rogue battle); console text/log strings are auxiliary diagnostics, not the authoritative event bus.");
  lines.push("");

  lines.push("## TableGameScene Runtime UI / 战斗内 UI");
  lines.push("");
  if (tablegameInspection) {
    const manager = tablegameInspection.manager || {};
    const selfSeatIndex = Number(manager.selfSeatIndex);
    const selfSeat = (tablegameInspection.seats || []).find((seat) => seat.index === selfSeatIndex);
    lines.push(`- Sample: ${tablegameInspection.__path}`);
    lines.push(`- Current scene: ${tablegameInspection.currentScene?.label || ""}, effectiveVisible=${tablegameInspection.currentScene?.effectiveVisible}.`);
    lines.push(`- Manager: ctor=${manager.ctor || ""}, seatCount=${manager.seatCount}, selfSeatIndex=${manager.selfSeatIndex}, gameRound=${manager.fields?.gameRound}, gameTurn=${manager.fields?.gameTurn}, currentRoundSeatID=${manager.fields?.currentRoundSeatID}, cardPileCardCount=${manager.fields?.cardPileCardCount}, isGameOver=${manager.fields?.isGameOver}.`);
    lines.push(`- Self seat: index=${selfSeat?.index}, isDead=${selfSeat?.fields?.isDead}, currentHp=${selfSeat?.fields?.currentHp}, selfHandCount=${selfSeat?.selfHandCount}. If self is dead, treat hand count as 0 for tracker display even if stale hand objects remain.`);
    lines.push(`- Visible interesting nodes=${tablegameInspection.visibleNodes?.length || 0}, button-like nodes=${tablegameInspection.buttonNodes?.length || 0}, card-like nodes=${tablegameInspection.cardUiNodes?.length || 0}, window nodes=${tablegameInspection.windowNodes?.length || 0}.`);
    lines.push("- Main scene methods prove the implementation surface for battle UI and effects: `StartGame`, `ServerProxy_StartGame`, `gameStart`, `gameOverHandler`, `addCardsHandler`, `ShowCardMotion`, `UpdateCardByUseSpell`, `AddCardByCardIds`, `AddDisCardByCardIds`, `ClearAllCards`, `PlayGameEffectBySys`, `PlayJudgeAnimation`, `leaveGameHandler*`.");
    lines.push("- Seat container path: `TableGameScene -> Uxt`; avatar mapping path: `Uxt -> seatAvatarSprite -> pWt`, with each `pWt` carrying/relating to a seat. This is the anchor for avatar overlays.");
    lines.push("- Current-player area path: `TableGameScene -> Uxt -> NBi`; skill button list appears under `pBt` / `_6i` nodes, and hand/card area under `uBt` with methods such as `AllSelectHandCards`, `UnSelectAllCards`, `Cancel`, `Select`, `UseHandCard`, and skill/equip helpers.");
    lines.push("- Stack/public card path: `TableGameScene -> Bxt`; visible card UI nodes are `T6i` with `theCard`, `descText`, `CardUI_Click`, `CardUI_MouseDown`, `CardUI_MouseRollOver`, `CardUI_MouseOut`, `Select`, `UnSelect`, and tag/effect methods.");
    if (tablegameFocusReport) {
      const focus = tablegameFocusReport.value?.focus || {};
      const focusManager = tablegameFocusReport.value?.table?.manager || {};
      lines.push(`- Focus report: ${tablegameFocusReport.__path}; isGameOver=${focusManager.isGameOver}, NBi=${focus.nbi?.length || 0}, uBt=${focus.ubt?.length || 0}, pBt=${focus.pbt?.length || 0}, skillButtons=${focus.skillButtons?.length || 0}, Bxt=${focus.bxt?.length || 0}, stackCards=${focus.stackCards?.length || 0}, windows=${focus.windows?.length || 0}.`);
      const skillTexts = (focus.skillButtons || []).map((item) => item.text).filter(Boolean).slice(0, 20);
      const stackTexts = (focus.stackCards || []).map((item) => item.text).filter(Boolean).slice(0, 12);
      lines.push(`- Focus texts: skill/buttons=${skillTexts.join("/") || "(none)"}; stack/public=${stackTexts.join("/") || "(none)"}.`);
    }
    const keyProxyEvents = (tablegameInspection.proxyEvents || []).filter((name) => /^(GsC|Msg|Pub|Smsg|ClientGeneralTrial|ClientTableinfo|decodeClientGsSelectCardsSync)/.test(name)).slice(0, 80);
    lines.push(`- Relevant proxy event names observed: ${keyProxyEvents.join(", ")}.`);
    lines.push("- This capture intentionally did not read opponent `handCards`; only self hand cards were summarized through `manager.selfSeatIndex`.");
  } else {
    lines.push("- No TableGameScene inspection sample found.");
  }
  lines.push("");

  lines.push("## RogueLikeGameScene Runtime UI / 山河图战斗内 UI");
  lines.push("");
  if (rogueGameSceneInspect) {
    const rogueGame = summarizeRogueGameSceneInspect(rogueGameSceneInspect);
    lines.push(`- Sample: ${rogueGame.path}`);
    lines.push(`- Scene=${rogueGame.scene}; effectiveVisible=${rogueGame.effectiveVisible}; manager=${rogueGame.managerCtor}; seatCount=${rogueGame.seatCount}; selfSeatIndex=${rogueGame.selfSeatIndex}; gameTurn=${rogueGame.gameTurn}; isGameOver=${rogueGame.isGameOver}.`);
    lines.push(`- Battle managers: roleSpellInterfaces=${rogueGame.roleSpellInterfaces}; moveFromFuncs=${rogueGame.moveFromFuncs}; moveToFuncs=${rogueGame.moveToFuncs}; gameRoundStarted=${rogueGame.gameRoundStarted}; gameStartPlay=${rogueGame.gameStartPlay}.`);
    lines.push(`- Self seat safe fields: general=${rogueGame.selfGeneralName}(${rogueGame.selfGeneralId}); handCardCount=${rogueGame.selfHandCount}; canViewHandCard=${rogueGame.selfCanViewHandCard}. Opponent hand contents were not read.`);
    lines.push(`- Visible UI counts: interestingNodes=${rogueGame.interestingNodes}; buttonNodes=${rogueGame.buttonNodes}; cardNodes=${rogueGame.cardNodes}; selectNodes=${rogueGame.selectNodes}; windowNodes=${rogueGame.windowNodes}; proxyEvents=${rogueGame.proxyEvents}.`);
    lines.push(`- Class source methods present: RogueLikeGameScene=${rogueGame.rogueLikeGameSceneMethods}; TableGameScene=${rogueGame.tableGameSceneMethods}; SelectCardWindow=${rogueGame.selectCardWindowMethods}; SkillSelectorWindow=${rogueGame.skillSelectorWindowMethods}; SkillBiFaRogueWindow=${rogueGame.skillBiFaRogueWindowMethods}.`);
    lines.push("- This is the delayed accept proof after the active Rogue fight-confirm sample: the 12s click sample did not catch the transition, but the later current-scene inspection proves the page is in `RogueLikeGameScene` with a normal game manager and seats.");
  } else {
    lines.push("- No RogueLikeGameScene inspection sample found.");
  }
  lines.push("");

  lines.push("## Rogue Battle Action Surface / 山河图战斗动作面");
  lines.push("");
  if (rogueBattleActionSurface) {
    const actionSurface = summarizeRogueBattleActionSurface(rogueBattleActionSurface);
    lines.push(`- Sample: ${actionSurface.path}`);
    lines.push(`- Scene=${actionSurface.scene}; manager=${actionSurface.managerCtor}; seats=${actionSurface.seatCount}; selfSeatIndex=${actionSurface.selfSeatIndex}; selfHandCards=${actionSurface.selfHandCards}; isGameOver=${actionSurface.isGameOver}; GameResultWindow=${actionSurface.hasGameResultWindow}.`);
    lines.push(`- Surface counts: currentPlayerAreas=${actionSurface.currentPlayerAreas}; skillPanels=${actionSurface.skillPanels}; handAreas=${actionSurface.handAreas}; stackAreas=${actionSurface.stackAreas}; cardUiNodes=${actionSurface.cardUiNodes}; buttonNodes=${actionSurface.buttonNodes}; promptNodes=${actionSurface.promptNodes}; actionNodes=${actionSurface.actionNodes}; visibleWindows=${actionSurface.visibleWindows}.`);
    lines.push(`- Manager/protocol sources: managerMethodSources=${actionSurface.managerMethodSources}; proxyEvents=${actionSurface.proxyEvents}; registered action node classes=${actionSurface.registeredActionNames.join(", ") || "(none)"}.`);
    lines.push(`- Current skill button texts sampled from \`pBt/_6i\`: ${actionSurface.skillButtonTexts.join(", ") || "(none)"}. Zhanfa/item labels sampled near \`FWi/g6i\`: ${actionSurface.zhanfaTexts.join(", ") || "(none)"}.`);
    lines.push(`- Selection/prompt class sources present: SelectCardWindow=${actionSurface.selectCardWindowMethods}; SkillSelectorWindow=${actionSurface.skillSelectorWindowMethods}; SkillBiFaWindow=${actionSurface.skillBiFaWindowMethods}; SkillBiFaRogueWindow=${actionSurface.skillBiFaRogueWindowMethods}; SpellMultiSelectorWindow=${actionSurface.spellMultiSelectorWindowMethods}.`);
    lines.push("- Main node anchors from this sample: `NBi` current-player area handles skill/card selection events; `pBt` skill panel contains `_6i` skill buttons such as `幻惑`, `倾世`, `急救`; `uBt` hand/card area exposes card click/select/use helpers; `fHt` exposes quick/all-select button paths; `FWi/g6i` nodes carry Rogue zhanfa/item click and tooltip handlers.");
    lines.push("- This sample proves monitor anchors and field/method meanings, not automatic use. Active skill use, card confirm, discard, or auto-select still requires a prompt-specific active sample.");
  } else {
    lines.push("- No Rogue battle action surface sample found.");
  }
  if (rogueCurrentActionHandlerReport) {
    const currentAction = summarizeRogueCurrentActionHandlerReport(rogueCurrentActionHandlerReport);
    lines.push(`- Current Rogue action handler report: ${currentAction.mdPath}`);
    lines.push(`  - scene=${currentAction.scene}; manager=${currentAction.managerCtor}; isGameOver=${currentAction.isGameOver}; actionNodes=${currentAction.nodeCount}; eventNodes=${currentAction.eventNodeCount}; handlers=${currentAction.eventHandlerCount}; sendOrConfirm=${currentAction.sendOrConfirmHandlers}; purchaseRisk=${currentAction.purchaseRiskHandlers}.`);
    lines.push(`  - node types: skill=${currentAction.actionNodeTypeCounts.skill || 0}; hover=${currentAction.actionNodeTypeCounts["hover-tooltip"] || 0}; cardSelection=${currentAction.actionNodeTypeCounts["card-selection"] || 0}; topTexts=${currentAction.topTexts.join(", ") || "(none)"}.`);
    lines.push(`  - TSV outputs: ${currentAction.nodesTsvPath}, ${currentAction.handlersTsvPath}.`);
  }
  if (rogueCurrentSkillButtonDetailReport) {
    const skillDetail = summarizeRogueCurrentSkillButtonDetailReport(rogueCurrentSkillButtonDetailReport);
    lines.push(`- Current Rogue skill-button detail report: ${skillDetail.mdPath}`);
    lines.push(`  - scene=${skillDetail.scene}; isGameOver=${skillDetail.isGameOver}; buttons=${skillDetail.skillButtonTexts.join(", ") || "(none)"}; currentPlayerAnchors=${skillDetail.currentPlayerAnchors}; cardContainers=${skillDetail.cardContainers}; selectPanels=${skillDetail.selectPanels}; methodRows=${skillDetail.methodRows}; eventRows=${skillDetail.eventRows}; autoEvidence=${skillDetail.autoEvidenceRows}; sendOrConfirm=${skillDetail.sendOrConfirmRows}; debugLog=${skillDetail.debugLogRows}.`);
    lines.push("  - Mechanism: `_6i.onMouse` changes visual state and re-dispatches through `eventDispatcher`; `uBt` emits `touchSkill`; `NBi.CardUI_TouchSkill` owns repeat-confirm (`LastActivateSpell -> SpellTouch_ConfirmResult(BUTTON_OK)`) and AI auto-select (`IsOpenAiAutoSelect` / `aiHelpOptDatas`) branches. Its `console.log` is diagnostic, not the event mechanism.");
    lines.push(`  - outputs=${skillDetail.focusNodesTsvPath}, ${skillDetail.methodEvidenceTsvPath}, ${skillDetail.eventHandlerEvidenceTsvPath}.`);
  }
  if (rogueHandlerFieldJoinReport) {
    const join = summarizeRogueHandlerFieldJoinReport(rogueHandlerFieldJoinReport);
    lines.push(`- Rogue handler-field join report: ${join.mdPath}`);
    lines.push(`  - fieldRows=${join.fieldRows}; semanticMatched=${join.semanticMatchedFields}; triageMatched=${join.triageMatchedFields}; needsLiveWithHandlerEvidence=${join.needsLiveRowsSampledByCurrentHandlers}; evidenceLevels=${Object.entries(join.evidenceLevels).map(([key, count]) => `${key}:${count}`).join(",") || "(none)"}.`);
    lines.push(`  - outputs=${join.fieldJoinTsvPath}, ${join.handlerSurfaceTsvPath}, ${join.needsLiveStrengthenedTsvPath}.`);
  }
  if (rogueEndedExitReport) {
    const endedExit = summarizeRogueEndedExitReport(rogueEndedExitReport);
    lines.push(`- Rogue ended-state exit source report: ${endedExit.path}`);
    lines.push(`  - isGameOver=${endedExit.isGameOver}; methods=${endedExit.methodCount}; confirmGated=${endedExit.confirmGatedMethods.join(", ") || "(none)"}; sendOrLeave=${endedExit.sendOrLeaveMethods.join(", ") || "(none)"}; sceneSwitch=${endedExit.sceneSwitchMethods.join(", ") || "(none)"}; purchaseRisk=${endedExit.purchaseRiskMethods.join(", ") || "(none)"}.`);
  }
  lines.push("");

  lines.push("## KanShu / FaCaiShu");
  lines.push("");
  lines.push("- Entry page is `SumRecommendGiftWindow / UYi -> tab 10160 -> viewStack child xZt`; the actual reward window is visible under `Laya.stage -> mWt -> KanShuWindow / wXi`.");
  lines.push("- Stable open/action path from the old automation and current class source: `xZt.tryKanshu()` or `ms.I().i(\"KanShuWindow\")`, then operate the `KanShuWindow` instance.");
  lines.push("- State fields to record: `jbpUserData.Status`, `Level`, `Exp`, `UpgradeExp`, `AllCoinNum`, `HasTriggerEvent`, `EventId`, `EventRewards`, plus `jbpawardVo` and `JbpYbItemArr`.");
  if (kanshuStateSample) {
    const sample = kanshuStateSample.value || {};
    const state = sample.sampledState || {};
    lines.push(`- Read-only state sample: ${kanshuStateSample.__path}`);
    lines.push(`  - mode=${sample.mode}, createdHidden=${!!sample.createdHidden}, cleanedHidden=${!!sample.cleanedHidden}, guardHits=${sample.guardHits?.length || 0}.`);
    lines.push(`  - status=${state.status}, level=${state.level}, exp=${state.exp}, upgradeExp=${state.upgradeExp}, allCoin=${state.allCoin}, peachCount=${state.peachCount}, openItemNums=${state.openItemNums}.`);
    lines.push(`  - award=${state.award?.name || ""}, buyItem=${state.buyItem}, rewardRange=${state.award?.rewardRange || ""}, freeBlessItemEnough=${state.freeBlessItemEnough}.`);
    lines.push("  - Since `freeBlessItemEnough=false` in this sample, reward-claim automation must not continue into `trueReqJbpAwd()` without explicit allow-buy/payment handling.");
  }
  lines.push("- Action flow: `onKanShuClick()` sends tree-use request, `autoClickAllPeach()` opens one unopened peach item at a time, and `trueReqJbpAwd()` performs the final award request.");
  lines.push("- Paid/purchase paths are explicitly unsafe unless allowed: avoid or guard `buyPorpItem`, `gotoPay`, and shop/payment manager calls such as `ITt.I().O`.");
  lines.push("- `onShowEvent()` can branch to `trueReqJbpAwd()` only when `FreeBlessItemEnough` is true; otherwise it shows a go-pay confirmation. This is the trigger condition to check before automation.");
  lines.push("");

  lines.push("## Battle End / Cleanup");
  lines.push("");
  if (battleEndScan) {
    const before = battleEndScan.action?.before || {};
    lines.push(`- End-state scan: ${battleEndScan.__path}`);
    lines.push(`  - scene=${before.currentScene?.sceneName || before.currentScene?.className || ""}, manager.isGameOver=${before.manager?.isGameOver}, hasGameOverData=${before.manager?.hasGameOverData}, resultWindows=${before.resultWindows?.length || 0}.`);
  }
  if (battleEndClose) {
    const before = battleEndClose.action?.before || {};
    const after = battleEndClose.after || {};
    const records = battleEndClose.dump?.value?.records || [];
    lines.push(`- Result-window close sample: ${battleEndClose.__path}`);
    lines.push(`  - Called ${battleEndClose.action?.action?.called || ""}; resultWindows ${before.resultWindows?.length || 0} -> ${after.resultWindows?.length || 0}.`);
    lines.push(`  - Scene after close remains ${after.currentScene?.sceneName || after.currentScene?.className || ""}; manager.isGameOver remains ${after.manager?.isGameOver}.`);
    lines.push(`  - Events: ${compactRecords(records, ["windowClosed", "HIDE_GUIDE_WAITING_EVENT", "TIPS_STAY_STATES_CHNAGED_EVENT2"]).map((record) => `#${record.seq}:${record.displayName}`).join(", ")}.`);
  }
  if (battleEndConfirmLeave) {
    const before = battleEndConfirmLeave.action?.before || {};
    const after = battleEndConfirmLeave.after || {};
    const action = battleEndConfirmLeave.action?.action || {};
    const records = battleEndConfirmLeave.dump?.value?.records || [];
    const leaveRecords = compactRecords(records, [
      "SentencodeClientMsgLeaveTableReq",
      "CONFIRMWINDOW_CLOSE_BEFORE",
      "CONFIRMWINDOW_CLOSE",
      "decodeClientMsgLeaveTableRep",
      "LEAVE_TABLE",
      "SceneManager"
    ]);
    lines.push(`- Confirm-leave sample: ${battleEndConfirmLeave.__path}`);
    lines.push(`  - Called ${action.called || ""}; confirmWindows ${before.confirmWindows?.length || 0} -> ${after.confirmWindows?.length || 0}; scene ${before.currentScene?.sceneName || ""} -> ${after.currentScene?.sceneName || ""}.`);
    lines.push(`  - Confirm title/content: ${action.target?.confirmDetails?.title || ""} / ${action.target?.confirmDetails?.content || ""}`);
    lines.push(`  - Confirm button callback: ${action.target?.confirmDetails?.buttons?.[0]?.callBackName || ""}; source: \`${shortSource(action.target?.confirmDetails?.buttons?.[0]?.callBackSource || "", 180).replaceAll("|", "\\|")}\`.`);
    lines.push(`  - Events: ${leaveRecords.map((record) => `#${record.seq}:${record.displayName}`).join(", ")}.`);
    lines.push("  - No `decodeClientMsgLeaveTableRep` or scene switch was captured in this sample, so this proves the leave request and confirm cleanup, not a completed scene exit.");
  }
  if (currentBackSample?.action?.before?.sceneName === "TableGameScene") {
    const records = currentBackSample.dump?.value?.records || [];
    const confirmEvent = records.find((record) => record.name === "ged.event" && record.args?.[0] === "ON_SHOW_COMFIRM_TIPS_EVENT");
    lines.push(`- Back-button after result close: ${currentBackSample.__path}`);
    lines.push(`  - Called ${currentBackSample.action?.called || ""}; result=${currentBackSample.action?.result}; final scene=${currentBackSample.dump?.value?.status?.scene?.sceneName || ""}.`);
    lines.push(`  - Confirm event emitted=${!!confirmEvent}; post-action inspection shows the confirm text: "是否确定离开房间？阵亡后离开房间不影响牌局结果".`);
  }
  if (!battleEndScan && !battleEndClose) {
    lines.push("- No battle-end sample found.");
  }
  lines.push("- Conclusion: do not wait for scene removal to stop battle drawing. Stop drawing when the visible battle scene's `manager.isGameOver === true` or `GameResultWindow` becomes visible; then remove/destroy overlay roots when no effective visible battle scene remains. The confirm leave path can clear the confirm window and send `encodeClientMsgLeaveTableReq` without an immediate scene switch.");
  lines.push("");

  lines.push("## Rogue / 山河图");
  lines.push("");
  lines.push("- Visible scene hook: `RogueSmallMapScene`; data path remains `scene.PveMgr` and visible `cityView` nodes.");
  lines.push("- Event selection hook: `TriggerCurEvent()` / `TriggerEvent(t)`; event type controls award/adventure/camp/window branches.");
  lines.push("- Shop window class exists as `RogueJiShiWindow`, but purchase-safe data should still prefer `PveMgr.ShopData` and avoid buy methods.");
  lines.push("- Reward/label overlay should be a non-interactive overlay tied to effective `RogueSmallMapScene` visibility.");
  if (rogueTooltipInspect) {
    const tooltip = summarizeRogueTooltipInspect(rogueTooltipInspect);
    lines.push(`- Rogue live tooltip/buttons: ${tooltip.tooltipNodes} tooltip nodes (${tooltip.activeTooltipNodes} effectively visible) are saved in ${tooltip.path}; current skill buttons include function-bound tooltip handlers and empty slots carry string hints.`);
  }
  if (rogueActionSurface) {
    const action = summarizeRogueActionSurfaceInspect(rogueActionSurface);
    lines.push(`- Rogue fight/action surface: ${action.path}`);
    lines.push(`  - Scene=${action.scene}; fightWindows=${action.fightWindows}; fightId=${action.fightId}; startBtnEvents=${action.startBtnEvents.join(",") || "(none)"}; bottomSkillButtons=${action.bottomSkillButtons}; zhanfaButtons=${action.zhanfaButtons}.`);
    lines.push(`  - \`RogueFightWindow.startbtnClick()\` source=${action.rogueFightHasStartSource ? "present" : "missing"}; \`PveMgr.RogueLikeEventSelectReq\` source=${action.pveMgrHasEventSelectReq ? "present" : "missing"}; \`ChangeSKillWindow.onChange()\` source=${action.changeSkillHasSendSource ? "present" : "missing"}.`);
    lines.push("  - This sample is read-only; it proves the guard/monitor points for fight confirm and current skill/zhanfa buttons.");
  }
  if (rogueActiveSample) {
    const active = summarizeRogueActiveSample(rogueActiveSample);
    lines.push(`- Rogue active non-purchase fight-confirm sample: ${active.path}`);
    lines.push(`  - Called=${active.called}; ok=${active.actionOk}; fightId=${active.fightId}; scene ${active.beforeScene} -> ${active.afterScene}; tableGame=${active.tableGame}; purchaseBlockedCalls=${active.purchaseBlockedCalls}.`);
    lines.push(`  - Send chain: eventId=${active.eventId}; eventType=${active.eventType}; proxy protocol=${active.protocolId}; fullMaskMs=${active.fullMaskMs}; records=${active.recordCount}.`);
    lines.push("  - This proves `checkStart -> startbtnClick -> PveMgr.RogueLikeEventSelectReq -> proxy.L` for the current fight window. The immediate 12s sample did not catch scene acceptance, but the later `RogueLikeGameScene` inspection is the delayed accept proof.");
  }
  if (rogueGameSceneInspect) {
    const rogueGame = summarizeRogueGameSceneInspect(rogueGameSceneInspect);
    lines.push(`- Rogue delayed battle scene inspection: ${rogueGame.path}`);
    lines.push(`  - scene=${rogueGame.scene}; manager=${rogueGame.managerCtor}; seats=${rogueGame.seatCount}; selfSeatIndex=${rogueGame.selfSeatIndex}; buttons=${rogueGame.buttonNodes}; cards=${rogueGame.cardNodes}; selectNodes=${rogueGame.selectNodes}; windows=${rogueGame.windowNodes}.`);
    lines.push(`  - methods: RogueLikeGameScene=${rogueGame.rogueLikeGameSceneMethods}; SelectCardWindow=${rogueGame.selectCardWindowMethods}; SkillSelectorWindow=${rogueGame.skillSelectorWindowMethods}; SkillBiFaRogueWindow=${rogueGame.skillBiFaRogueWindowMethods}.`);
  }
  if (rogueSkillZhanfaProbe) {
    const skillZhanfa = summarizeRogueSkillZhanfaProbe(rogueSkillZhanfaProbe);
    lines.push(`- Rogue skill/zhanfa source probe: ${skillZhanfa.path}`);
    lines.push(`  - scene=${skillZhanfa.scene}; visible button count in this scene=${skillZhanfa.buttonCount}; RogueFightWindow methods=${skillZhanfa.rogueFightMethods}; ChangeSkill=${skillZhanfa.changeSkillMethods}; Rogue1v1ChangeSkill=${skillZhanfa.rogue1v1ChangeSkillMethods}; ChangeZhanFa=${skillZhanfa.changeZhanFaMethods}; DeleteZhanFa=${skillZhanfa.deleteZhanFaMethods}; SkillBiFaRogue=${skillZhanfa.skillBiFaRogueMethods}.`);
  }
  if (rogueBattleActionSurface) {
    const actionSurface = summarizeRogueBattleActionSurface(rogueBattleActionSurface);
    lines.push(`- Rogue battle action surface: ${actionSurface.path}`);
    lines.push(`  - NBi/pBt/uBt/fHt/FWi/g6i anchors sampled; skillPanels=${actionSurface.skillPanels}; handAreas=${actionSurface.handAreas}; cardUiNodes=${actionSurface.cardUiNodes}; buttonNodes=${actionSurface.buttonNodes}; promptNodes=${actionSurface.promptNodes}; managerSources=${actionSurface.managerMethodSources}.`);
    lines.push(`  - End-state proof in same sample: isGameOver=${actionSurface.isGameOver}; GameResultWindow=${actionSurface.hasGameResultWindow}.`);
  }
  if (rogueBattlePromptInspect) {
    const prompt = summarizeRogueBattlePromptInspect(rogueBattlePromptInspect);
    lines.push(`- Rogue battle prompt/action detail: ${prompt.path}`);
    lines.push(`  - scene=${prompt.scene}; manager=${prompt.managerCtor}; seats=${prompt.seatCount}; self=${prompt.selfSeatIndex}; currentRoundSeatID=${prompt.currentRoundSeatID}; round=${prompt.gameRound}; turn=${prompt.gameTurn}; isGameOver=${prompt.isGameOver}.`);
    lines.push(`  - self hand via selfSeatIndex only: count=${prompt.selfHandCards}; names=${prompt.selfHandNames.join(", ") || "(none)"}; roundState=${prompt.selfRoundState}; sha=${prompt.selfShaCount}/${prompt.selfShaMaxCount}.`);
    lines.push(`  - UI surfaces: currentPlayer=${prompt.currentPlayerAreas}; handAreas=${prompt.handAreas}; selectAreas=${prompt.selectAreas}; buttons=${prompt.visibleButtons}; skills=${prompt.skillNodes}; promptCandidates=${prompt.promptCandidates}; selfHandCardUis=${prompt.selfHandCardUis}.`);
    lines.push(`  - prompt class sources: SelectCardWindow=${prompt.selectCardWindowMethods}; SkillSelectorWindow=${prompt.skillSelectorWindowMethods}; SkillBiFa=${prompt.skillBiFaWindowMethods}; SkillBiFaRogue=${prompt.skillBiFaRogueWindowMethods}; SpellMulti=${prompt.spellMultiSelectorWindowMethods}; MilitaryOrders=${prompt.militaryOrdersSelectWindowMethods}/${prompt.militaryOrdersExecutionWindowMethods}.`);
  }
  if (rogueCurrentActionHandlerReport) {
    const currentAction = summarizeRogueCurrentActionHandlerReport(rogueCurrentActionHandlerReport);
    lines.push(`- Rogue current action handlers: ${currentAction.mdPath}`);
    lines.push(`  - Current ended ${currentAction.scene} sample records visible nodes and event handler previews only: nodes=${currentAction.nodeCount}; eventNodes=${currentAction.eventNodeCount}; handlers=${currentAction.eventHandlerCount}; sendOrConfirm=${currentAction.sendOrConfirmHandlers}; purchaseRisk=${currentAction.purchaseRiskHandlers}.`);
    lines.push(`  - Type counts: skill=${currentAction.actionNodeTypeCounts.skill || 0}; hover=${currentAction.actionNodeTypeCounts["hover-tooltip"] || 0}; cardSelection=${currentAction.actionNodeTypeCounts["card-selection"] || 0}; outputs=${currentAction.nodesTsvPath}, ${currentAction.handlersTsvPath}.`);
  }
  if (rogueCurrentSkillButtonDetailReport) {
    const skillDetail = summarizeRogueCurrentSkillButtonDetailReport(rogueCurrentSkillButtonDetailReport);
    lines.push(`- Rogue current skill-button detail: ${skillDetail.mdPath}`);
    lines.push(`  - Buttons=${skillDetail.skillButtonTexts.join(", ") || "(none)"}; methodRows=${skillDetail.methodRows}; eventRows=${skillDetail.eventRows}; autoEvidence=${skillDetail.autoEvidenceRows}; sendOrConfirm=${skillDetail.sendOrConfirmRows}; purchaseRisk=${skillDetail.purchaseRiskRows}.`);
    lines.push("  - This narrows the current ended Rogue sample to NBi/pBt/_6i/uBt/fHt: skill buttons dispatch to NBi/card-selector logic; the auto-skill console output is only a log on the auto branch.");
  }
  if (rogueHandlerFieldJoinReport) {
    const join = summarizeRogueHandlerFieldJoinReport(rogueHandlerFieldJoinReport);
    lines.push(`- Rogue handler-field join: ${join.mdPath}`);
    lines.push(`  - Joined current action handlers to live field semantics and triage: handlers=${join.handlerRows}; fieldRows=${join.fieldRows}; semanticMatched=${join.semanticMatchedFields}; triageMatched=${join.triageMatchedFields}; needsLiveWithHandlerEvidence=${join.needsLiveRowsSampledByCurrentHandlers}.`);
    lines.push(`  - This is read-only field-meaning evidence for NBi/pBt/uBt/skill-button/hover surfaces; exact value transitions still require prompt-specific samples.`);
  }
  if (rogueEndedExitReport) {
    const endedExit = summarizeRogueEndedExitReport(rogueEndedExitReport);
    lines.push(`- Rogue ended-state exit path report: ${endedExit.path}`);
    lines.push(`  - scene=${endedExit.scene}; isGameOver=${endedExit.isGameOver}; visibleWindows=${endedExit.visibleWindows}; methods=${endedExit.methodCount}; confirmGated=${endedExit.confirmGatedMethods.join(", ") || "(none)"}; sendOrLeave=${endedExit.sendOrLeaveMethods.join(", ") || "(none)"}.`);
    lines.push("  - No purchase-risk method was classified, but the remaining leave/restart candidates are not passive UI inspection paths; keep them behind explicit active-sample permission.");
  }
  if (rogueSamples?.enterMode) {
    const records = rogueSamples.enterMode.dump?.value?.records || [];
    const switchRecord = records.find((record) => record.name === "SceneManager.SwitchScene");
    lines.push(`- ModeScene -> BigMap sample: ${rogueSamples.enterMode.__path}`);
    lines.push(`  - Called ${rogueSamples.enterMode.action?.action?.called || ""}; switch=${switchRecord ? JSON.stringify(switchRecord.args) : "(none)"}.`);
  }
  if (rogueSamples?.bigmapJoin) {
    const records = rogueSamples.bigmapJoin.dump?.value?.records || [];
    const switchRecord = records.find((record) => record.name === "SceneManager.SwitchScene");
    lines.push(`- BigMap join sample: ${rogueSamples.bigmapJoin.__path}`);
    lines.push(`  - Called ${rogueSamples.bigmapJoin.action?.action?.called || ""}; switch=${switchRecord ? JSON.stringify(switchRecord.args) : "(none)"}.`);
    lines.push("  - `RogueLikeBigMapScene.joinBtnClick()` checks level/power/ban-general/newbie/multi-line/difficulty, then `ReadyEnter()` can call `joinMap()` -> `SceneManager.SwitchScene(\"RogueSmallMapScene\")`.");
  }
  if (rogueSamples?.bigmapConfirmWarning) {
    const action = rogueSamples.bigmapConfirmWarning.action?.action || {};
    const target = action.target || {};
    const records = rogueSamples.bigmapConfirmWarning.dump?.value?.records || [];
    const related = compactRecords(records, ["SHOW_COMFIRM_TIPS_EVENT", "ON_SHOW_COMFIRM_TIPS_EVENT", "OPEN_WINDOW", "decodeRogueLikeDataSync"]);
    lines.push(`- BigMap initial-zhanfa confirm sample: ${rogueSamples.bigmapConfirmWarning.__path}`);
    lines.push(`  - Called ${action.called || ""}; content=${JSON.stringify(target.content || "")}; buttons=${(target.buttons || []).map((button) => `${button.label}${button.isCancel ? "(cancel)" : ""}`).join(", ") || "(none)"}.`);
    lines.push(`  - OK callback source=${JSON.stringify((target.buttons || []).find((button) => !button.isCancel)?.callBackSource || "")}; note=${action.note || ""}`);
    for (const record of related.slice(0, 8)) {
      lines.push(`  - #${record.seq} ${record.kind} ${record.displayName} args=${JSON.stringify(record.args).slice(0, 260)}`);
    }
  }
  if (rogueSamples?.selectGeneralConfirm) {
    const action = rogueSamples.selectGeneralConfirm.action?.action || {};
    const target = action.target || {};
    const records = rogueSamples.selectGeneralConfirm.dump?.value?.records || [];
    const proxySend = records.find((record) => record.name === "proxy.L");
    const switchRecord = records.find((record) => record.name === "SceneManager.SwitchScene");
    const closeRecord = records.find((record) => record.name === "WindowManager.CloseWindow" || record.name === "GED.CloseWindow");
    lines.push(`- Rogue select-general confirm sample: ${rogueSamples.selectGeneralConfirm.__path}`);
    lines.push(`  - Called ${action.called || ""}; season=${target.seasonId ?? ""}; diff=${target.diffId ?? ""}; selectedGeneral=${target.selectedCard?.generalId ?? ""}; selectedCard=${target.selectedCard?.cardId ?? ""}.`);
    lines.push(`  - Send/transition: proxy=${proxySend ? JSON.stringify(proxySend.args).slice(0, 220) : "(none)"}; close=${closeRecord ? JSON.stringify(closeRecord.args) : "(none)"}; switch=${switchRecord ? JSON.stringify(switchRecord.args) : "(none)"}.`);
  }
  if (rogueSamples?.scan) {
    const after = rogueSamples.scan.after || {};
    const chapter = after.pveMgr?.chapterDetails;
    const cityItems = after.cityDetails?.cityItems || [];
    const activeCities = cityItems.filter((item) => item.data);
    lines.push(`- SmallMap scan sample: ${rogueSamples.scan.__path}`);
    lines.push(`  - scene=${after.currentScene?.sceneName || ""}, PveMgr=${after.pveMgr?.ctor || ""}, cityItems=${cityItems.length}, activeCityItems=${activeCities.length}.`);
    lines.push(`  - chapter=${chapter?.fields?.chapterId || ""}, curEvent=${chapter?.curEventData?.eventId || ""}, curEventType=${chapter?.curEventData?.eventType || ""}, isSelect=${chapter?.curEventData?.isSelect}.`);
    lines.push(`  - locations: ${(chapter?.locations || []).map((item) => `${item.fields?.location}:${item.fields?.event}`).join(", ")}.`);
    lines.push("  - `RogueSmallMapScene.createChildren()` builds `cityView/top/left/bottom/chat`, calls `UpdateRogueData()`, then `TriggerCurEvent()` and emits `TRIGGER_ROGUE_CHANGE_UI`.");
    lines.push("  - `TriggerEvent(t)` dispatches by `eventType`: awards open award/select windows; adventure opens adventure windows; gamble calls `sendGotoGambleMsg`; fight opens `RogueFightWindow` or shows `SHOW_ROGUE_CHANGE_UI` before `sendGotoFightMsg`.");
  }
  if (rogueSamples?.requestShopData) {
    const action = rogueSamples.requestShopData.action?.action || {};
    const after = rogueSamples.requestShopData.after || {};
    const records = rogueSamples.requestShopData.dump?.value?.records || [];
    const goods = after.pveMgr?.shopGoods || {};
    const goodsCounts = Object.fromEntries(Object.entries(goods).map(([type, rows]) => [type, Array.isArray(rows) ? rows.length : null]));
    const riskyRecords = records
      .map((record) => record.name || "")
      .filter((name) => /buy|Buy|Pay|refresh|Fresh|confirmBuy|refreshBtnClick|SendClientRoguoLikeBuyShopItem/.test(name));
    lines.push(`- Shop data request sample: ${rogueSamples.requestShopData.__path}`);
    lines.push(`  - Called ${action.called || ""}; resulting shopGoods=${after.pveMgr?.shopGoods ? JSON.stringify(goodsCounts) : "null"}.`);
    lines.push(`  - Recorded calls: ${(records || []).map((record) => record.name).join(", ") || "(none)"}; purchase-risk calls: ${riskyRecords.join(", ") || "(none)"}.`);
    lines.push("  - `RogueLikeDataReq(16)` is confirmed as the safe shop-data request method; goods are read through `PveMgr.ShopData.getGoodsListByType(type)`, not by clicking buy/refresh paths.");
  }
  if (rogueSamples?.clickFirstCity) {
    const action = rogueSamples.clickFirstCity.action?.action || {};
    const records = rogueSamples.clickFirstCity.dump?.value?.records || [];
    const sendRecords = compactRecords(records, ["ClientRogueLikeSelectMoveReq", "proxy.L", "CLIENT_ROGUE_MOVE_REQ", "decodeClientRogueMineStateNtf"]);
    lines.push(`- City click sample: ${rogueSamples.clickFirstCity.__path}`);
    lines.push(`  - Called ${action.called || ""}; target location=${action.target?.data?.location || ""}, event=${action.target?.rogueEventId || ""}, eventType=${action.target?.rogueEventType || ""}.`);
    for (const record of sendRecords) {
      lines.push(`  - #${record.seq} ${record.kind} ${record.displayName} args=${JSON.stringify(record.args).slice(0, 260)}`);
    }
    lines.push("  - `RogueCityItemUI.OnClickCity()` requires `HasEvent && levelVo && !InGrabEvent`; non-current city path sends `PveMgr.ClientRogueLikeSelectMoveReq(cityId)`, observed as `proxy.L(102055,{cityId})`.");
  }
  lines.push("");

  lines.push("## Bless / QiFu Effects");
  lines.push("");
  lines.push("- Live close sample proved the visible window class can be `BlessNewWindowView / nZt`; legacy code may also register `BlessNewWindow`.");
  lines.push("- Safe close path is `Close()`. Purchase/draw/shop paths to avoid during probing are `blessBtnClick`, `confirmBuy`, and `shopBtnClick`.");
  lines.push("- Effect surfaces are `addEffect(t)`, `effectStop()`, and for the view class `UpdateUpperCanvas()`, `UpdateButtonUI()`, and `updateSkipAnim()`.");
  lines.push("- A credible effect-block implementation is to hook the visible Bless window class, no-op or fast-forward `addEffect(...)`, then call `effectStop()` / clear effect sprites after state changes.");
  if (blessOpenSample) {
    const blessOpen = summarizeBlessOpenSample(blessOpenSample);
    lines.push(`- Open sample: ${blessOpen.path}`);
    lines.push(`  - Open: ok=${blessOpen.openOk}, called=${blessOpen.openCalled}, window=${blessOpen.windowName}, scene=${blessOpen.scene}, openedBySample=${blessOpen.openedBySample}.`);
    lines.push(`  - Close: ok=${blessOpen.closeOk}, called=${blessOpen.closeCalled}, before=${blessOpen.closeBeforePath}, destroyed=${blessOpen.closeDestroyed}, finalVisible=${blessOpen.visibleBlessWindows}.`);
    lines.push(`  - Guard: wrappers=${blessOpen.wrappers}, records=${blessOpen.records}, blocked purchase/draw/shop calls=${blessOpen.blockedCalls}, blocked addEffect calls=${blessOpen.blockedEffects}, errors=${blessOpen.errors}.`);
    if (blessOpen.blockedEffects > 0) {
      lines.push("- Current live sample proves open, close, and effect blocking without purchase/draw side effects.");
    } else {
      lines.push("- Current live sample proves safe open/close lifecycle without purchase/draw side effects; it did not trigger `addEffect`, so full animation-block behavior still needs a Bless animation sample.");
    }
  } else {
    lines.push("- Current live sample only proves close/destruction and GED close events; open trigger and full effect-block behavior still need a live QiFu action sample.");
  }
  if (blessEffectBlockProbe) {
    const blessEffect = summarizeBlessEffectBlockProbe(blessEffectBlockProbe);
    lines.push(`- Effect-block probe: ${blessEffect.path}`);
    lines.push(`  - OpenedByProbe=${blessEffect.openedByProbe}; directAddEffectOk=${blessEffect.directEffectOk}; target=${blessEffect.directEffectTarget}; blockedDelta=${blessEffect.blockedDelta}; blockedEffects=${blessEffect.blockedEffects}; blocked purchase/draw/shop calls=${blessEffect.blockedCalls}; finalVisible=${blessEffect.visibleBlessWindows}; errors=${blessEffect.errors}.`);
    if (blessEffect.directEffectOk) {
      lines.push("- The `addEffect` entry itself is live-proven blockable without invoking `blessBtnClick`, `confirmBuy`, `shopBtnClick`, or a draw request. Natural draw-response animation variants remain permission/free-branch gated.");
    }
  }
  lines.push("");

  lines.push("## Bless / QiFu Window Close Sample");
  lines.push("");
  if (closeSample) {
    const records = closeSample.dump?.value?.records || [];
    lines.push(`- Sample: ${closeSample.__path}`);
    lines.push(`- Action: ${closeSample.action?.called || ""}, ok=${!!closeSample.action?.ok}`);
    lines.push(`- Before: ${closeSample.action?.before?.path || ""}`);
    lines.push(`- After immediate: destroyed=${closeSample.action?.afterImmediate?.destroyed}`);
    lines.push(`- Records: ${records.length}`);
    for (const record of records) {
      lines.push(`  - #${record.seq} ${record.kind} ${record.name} scene=${record.scene?.sceneName || ""}`);
    }
  } else {
    lines.push("- No close sample found.");
  }
  lines.push("");

  lines.push("## Scene Navigation Sample");
  lines.push("");
  if (currentBackSample) {
    const records = currentBackSample.dump?.value?.records || [];
    const switchRecord = records.find((record) => record.name === "SceneManager.SwitchScene");
    lines.push(`- Sample: ${currentBackSample.__path}`);
    lines.push(`- Action: ${currentBackSample.action?.called || ""}, ok=${!!currentBackSample.action?.ok}, result=${currentBackSample.action?.result}`);
    lines.push(`- Before scene: ${currentBackSample.action?.before?.sceneName || ""}`);
    lines.push(`- Recorded switch call: ${switchRecord ? JSON.stringify(switchRecord.args) : "(none)"}`);
    lines.push(`- Final sampled scene: ${currentBackSample.dump?.value?.status?.scene?.sceneName || ""}`);
    if (currentBackSample.action?.before?.sceneName === "TableGameScene") {
      lines.push("- Note: in a finished battle, this button path emitted `ON_SHOW_COMFIRM_TIPS_EVENT` and did not immediately leave `TableGameScene`.");
    } else {
      lines.push("- Note: this sample proves the transition request; completion of the transition may need a longer or follow-up monitor.");
    }
    lines.push("");
    for (const record of records.slice(0, 40)) {
      lines.push(`  - #${record.seq} ${record.kind} ${record.name} scene=${record.scene?.sceneName || ""}`);
    }
  } else {
    lines.push("- No current-back sample found.");
  }
  if (sceneEnterNextSample) {
    const records = sceneEnterNextSample.dump?.value?.records || [];
    lines.push("");
    lines.push(`- Follow-up sample: ${sceneEnterNextSample.__path}`);
    lines.push(`- Follow-up final scene: ${sceneEnterNextSample.dump?.value?.status?.scene?.sceneName || ""}`);
    for (const record of records.slice(0, 20)) {
      lines.push(`  - #${record.seq} ${record.kind} ${record.name} scene=${record.scene?.sceneName || ""}`);
    }
  }
  lines.push("");

  lines.push("## Selected Method Evidence");
  lines.push("");
  for (const className of Object.keys(methodSelections)) {
    writeMethodTable(lines, evidence, className);
  }

  return `${lines.join("\n")}\n`;
}

function buildCoverageAudit({
  dump,
  closeSample,
  battleSamples,
  tableTransitionSample,
  tablegameInspection,
  tablegameFocusReport,
  battleEndScan,
  battleEndClose,
  battleEndConfirmLeave,
  kanshuStateSample,
  allNamesReport,
  oldScriptMap,
  yanJiaoReport,
  yanJiaoListWatch,
  yanJiaoCandidateReport,
  objectiveCoverageReport,
  fieldContextReport,
  allSourceContextReport,
  semanticInheritanceReport,
  liveObjectState,
  liveFieldSourceJoin,
  classUtilsInspect,
  modeSceneSurfaceReport,
  liveFieldGapReport,
  liveFieldGapTriageReport,
  liveOwnerSourceReport,
  liveFieldSemanticsReport,
  fieldSemanticIndexReport,
  goalRemainingAuditReport,
  liveProofPlaybookReport,
  triggerMonitoringReport,
  surfaceMonitorSample,
  liveGapWatch,
  eventFieldTransitionWatch,
  currentWindowAction,
  uiStateTransitionSample,
  uiStateDirectEventSample,
  rightPanelToggleSample,
  promptAutomationMonitor,
  hoverFieldTooltip,
  hoverHandlerFieldTransition,
  hoverStageDelta,
  tooltipLifecycle,
  rogueTooltipInspect,
  rogueActionSurface,
  rogueActiveSample,
  rogueGameSceneInspect,
  rogueSkillZhanfaProbe,
  rogueBattleActionSurface,
  rogueBattlePromptInspect,
  rogueCurrentActionHandlerReport,
  rogueCurrentSkillButtonDetailReport,
  rogueHandlerFieldJoinReport,
  rogueEndedExitReport,
  blessOpenSample,
  blessEffectBlockProbe,
  qixingWatch,
  resourceReplacementProbe,
  resourceLoadSchemeProof,
  rogueSamples
}) {
  const lines = [];
  lines.push("# Goal Coverage Audit");
  lines.push("");
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Focus source: ${dump.__path || ""}`);
  lines.push(`- ResourceVersion: ${dump.value.runtime?.resourceVersion || ""}`);
  lines.push(`- Current scene at source dump: ${dump.value.runtime?.scene?.sceneName || ""}`);
  lines.push("- Status: active / not complete.");
  lines.push("");
  lines.push("## Strong Evidence");
  lines.push("");
  lines.push("- Class inventory and stable class strings: `Laya.ClassUtils._classMap`, 5527 registered names in the latest inventory/followup set.");
  lines.push("- Battle entry and tracker visibility: GED/proxy events plus `SceneManager`, visible `TableGameScene` or Rogue `RogueLikeGameScene`, and `manager.seats`; battle drawing should stop on `manager.isGameOver` or visible `GameResultWindow`, then clean up when the battle scene leaves.");
  lines.push("- TableGameScene/RogueLikeGameScene UI: sampled manager/seats/current-player area/stack card area, button-like nodes, card UI nodes, proxy event names, current Rogue action surface, and no hidden opponent hand read.");
  if (tablegameFocusReport) {
    const focus = tablegameFocusReport.value?.focus || {};
    const focusManager = tablegameFocusReport.value?.table?.manager || {};
    lines.push(`- TableGameScene focus report: isGameOver=${focusManager.isGameOver}, NBi=${focus.nbi?.length || 0}, uBt=${focus.ubt?.length || 0}, skillButtons=${focus.skillButtons?.length || 0}, Bxt=${focus.bxt?.length || 0}, stackCards=${focus.stackCards?.length || 0}, windows=${focus.windows?.length || 0} in ${tablegameFocusReport.__path}.`);
  }
  lines.push("- Rogue/山河图: visible `RogueSmallMapScene`, `PveMgr`, city items, event dispatch, safe shop-data request method, city-click move request, active fight-confirm send chain, delayed `RogueLikeGameScene` battle state, current NBi/pBt/uBt/fHt/FWi/g6i action anchors, and ended-state exit source boundaries are sampled.");
  lines.push("- Resource drawing/replacement: separate supplement plus live probe prove current path-based manifest, Laya drawTexture rendering, and Laya URL hook replacement scheme.");
  if (modeSceneSurfaceReport) {
    const modeScene = summarizeModeSceneSurfaceReport(modeSceneSurfaceReport);
    lines.push(`- ModeScene surface report: scene=${modeScene.scene}, nodes=${modeScene.nodes}, buttons=${modeScene.buttons}, entries=${modeScene.entries}, resourceNodes=${modeScene.resourceNodes}, registeredMatches=${modeScene.registeredNodeMatches}, purchaseRiskButtons=${modeScene.purchaseRiskButtons} in ${modeScene.path}.`);
  }
  if (oldScriptMap) {
    lines.push(`- Old script behavior map: ${oldScriptMap.scripts} backup scripts scanned, ${oldScriptMap.behaviors} behavior groups summarized, ${oldScriptMap.methods} interesting methods indexed in ${oldScriptMap.dir}.`);
  }
  if (allNamesReport) {
    lines.push(`- All names/index: ${allNamesReport.classes} registered class rows, ${allNamesReport.gedEvents} GED events, ${allNamesReport.proxyEvents} proxy events, and ${allNamesReport.fieldGlossary} inferred field/name rows are saved in ${allNamesReport.dir}.`);
  }
  if (fieldContextReport) {
    const summary = fieldContextReport.summary || {};
    lines.push(`- Focused field context: ${summary.sourceClassCount || 0} focused classes, ${summary.ownSourceDiscoveredFields || 0} own-source instance fields, ${summary.eventBindings || 0} source event bindings in ${fieldContextReport.dir}.`);
  }
  if (allSourceContextReport) {
    lines.push(`- All-source context: ${allSourceContextReport.capturedClasses} classes, ${allSourceContextReport.methodContexts} method contexts, ${allSourceContextReport.sourceFieldRows} source field rows, ${allSourceContextReport.eventBindings} source event bindings, ${allSourceContextReport.chunkCount} source chunks in ${allSourceContextReport.dir}.`);
  }
  if (semanticInheritanceReport) {
    const summary = semanticInheritanceReport.summary || {};
    lines.push(`- Semantic inheritance / enum values: ${summary.exactEnumValues || 0} exact enum/static constants, ${summary.enumClassCount || 0} enum-like classes, ${summary.inheritedMethodRefs || 0} inherited method refs, ${summary.fieldOwnerRows || 0} field-owner rows in ${semanticInheritanceReport.dir}.`);
  }
  if (classUtilsInspect) {
    lines.push(`- Live ClassUtils registry: keys=${classUtilsInspect.classUtilsKeys}, classMap=${classUtilsInspect.classMapCount}, functionEntries=${classUtilsInspect.functionEntryCount}, aliasGroups=${classUtilsInspect.aliasGroupCount}, aliasEntries=${classUtilsInspect.aliasEntryCount}, Laya=${classUtilsInspect.layaVersion} in ${classUtilsInspect.dir}.`);
  }
  if (modeSceneSurfaceReport) {
    const modeScene = summarizeModeSceneSurfaceReport(modeSceneSurfaceReport);
    lines.push(`- ModeScene live surface: scene=${modeScene.scene}, nodes=${modeScene.nodes}, buttons=${modeScene.buttons}, entries=${modeScene.entries}, resourceNodes=${modeScene.resourceNodes}, windows=${modeScene.windows}, purchaseRiskButtons=${modeScene.purchaseRiskButtons}, classMapSize=${modeScene.classMapSize} in ${modeScene.path}.`);
  }
  if (liveObjectState) {
    const groups = Object.entries(liveObjectState.groups || {}).map(([group, count]) => `${group}:${count}`).join(",") || "(none)";
    lines.push(`- Live object-state field audit: scene=${liveObjectState.scene}, samples=${liveObjectState.sampleCount}, fieldRows=${liveObjectState.fieldRows}, groups=${groups}, manager=${liveObjectState.managerCtor}, isGameOver=${liveObjectState.isGameOver}, selfSeatIndex=${liveObjectState.selfSeatIndex}, selfHandCards=${liveObjectState.selfHandCards} in ${liveObjectState.dir}.`);
  }
  if (liveFieldSourceJoin) {
    lines.push(`- Live field/source join: liveRows=${liveFieldSourceJoin.liveRows}, sourceMatched=${liveFieldSourceJoin.sourceMatchedRows}, semanticMatched=${liveFieldSourceJoin.semanticMatchedRows}, owner+field=${liveFieldSourceJoin.exactMatches}, purchaseRiskRows=${liveFieldSourceJoin.purchaseRiskRows} in ${liveFieldSourceJoin.dir}.`);
  }
  if (liveFieldGapReport) {
    lines.push(`- Live field gap worklist: rawWeak=${liveFieldGapReport.rawWeakRows}, dedupedWeak=${liveFieldGapReport.weakRows}, purchaseRiskWeak=${liveFieldGapReport.purchaseRiskRows}, topSurfaces=${liveFieldGapReport.topSurfaces.join(",") || "(none)"} in ${liveFieldGapReport.dir}.`);
  }
  if (liveFieldGapTriageReport) {
    lines.push(`- Live field gap triage: inputWeak=${liveFieldGapTriageReport.inputWeakRows}, explainedOrGeneric=${liveFieldGapTriageReport.explainedRows}, needsLive=${liveFieldGapTriageReport.needsLiveRows}, permissionGated=${liveFieldGapTriageReport.permissionGatedRows}, needsLiveBuckets=${liveFieldGapTriageReport.topNeedsLiveBuckets.join(",") || "(none)"} in ${liveFieldGapTriageReport.dir}.`);
  }
  if (liveOwnerSourceReport) {
    lines.push(`- Live owner source refs: targets=${liveOwnerSourceReport.targetCount}, exactPath=${liveOwnerSourceReport.exactPath}, fieldRefTargets=${liveOwnerSourceReport.targetsWithFieldRefs}, fieldRefMethods=${liveOwnerSourceReport.fieldRefMethods}, matches=${Object.entries(liveOwnerSourceReport.matchCounts || {}).map(([match, count]) => `${match}:${count}`).join(",") || "(none)"} in ${liveOwnerSourceReport.dir}.`);
  }
  if (liveFieldSemanticsReport) {
    lines.push(`- Live field semantics: owners=${liveFieldSemanticsReport.owners}, fieldRows=${liveFieldSemanticsReport.fieldRows}, uniqueFields=${liveFieldSemanticsReport.uniqueFields}, highConfidence=${liveFieldSemanticsReport.highConfidenceRows}, methodRefs=${liveFieldSemanticsReport.fieldsWithMethodRefs}, joinedMeaning=${liveFieldSemanticsReport.fieldsWithJoinedMeaning}, topSurfaces=${liveFieldSemanticsReport.topSurfaces.join(",") || "(none)"} in ${liveFieldSemanticsReport.dir}.`);
  }
  if (fieldSemanticIndexReport) {
    lines.push(`- Field semantic index: fieldRows=${fieldSemanticIndexReport.fieldIndexRows}, classes=${fieldSemanticIndexReport.classSummaryRows}, triggerRefs=${fieldSemanticIndexReport.triggerFieldRefs}, liveMapped=${fieldSemanticIndexReport.liveMappedRows}, handlerMapped=${fieldSemanticIndexReport.handlerMappedRows}, triageMapped=${fieldSemanticIndexReport.triageMappedRows}, evidence=${fieldSemanticIndexReport.evidenceCounts.join(",") || "(none)"}, unresolved=${fieldSemanticIndexReport.unresolvedRows}, needsLive=${fieldSemanticIndexReport.needsLiveRows}, permissionGated=${fieldSemanticIndexReport.permissionGatedRows} in ${fieldSemanticIndexReport.dir}.`);
  }
  if (goalRemainingAuditReport) {
    lines.push(`- Goal remaining audit: cases=${goalRemainingAuditReport.cases}, scriptCoverage=${goalRemainingAuditReport.scriptsOkCases}/${goalRemainingAuditReport.cases}, unresolved=${goalRemainingAuditReport.unresolvedRows}, needsLive=${goalRemainingAuditReport.needsLiveRows}, permissionGated=${goalRemainingAuditReport.permissionGatedRows}, buckets=${goalRemainingAuditReport.unresolvedBuckets.join(",") || "(none)"} in ${goalRemainingAuditReport.dir}.`);
  }
  if (liveProofPlaybookReport) {
    lines.push(`- Live proof playbook: rows=${liveProofPlaybookReport.playbookRows}, cases=${liveProofPlaybookReport.caseCount}, needsLive=${liveProofPlaybookReport.needsLiveRows}, permissionGated=${liveProofPlaybookReport.permissionGatedRows}, purchaseRisk=${liveProofPlaybookReport.purchaseRiskRows}, topCases=${liveProofPlaybookReport.topCases.join(",") || "(none)"} in ${liveProofPlaybookReport.dir}.`);
  }
  if (triggerMonitoringReport) {
    const summary = triggerMonitoringReport.summary || {};
    lines.push(`- Trigger monitoring matrix: ${summary.triggerRows || 0} trigger rows, ${summary.triggerClasses || 0} classes, ${summary.methodRowsScanned || 0} scanned method rows, purchaseRiskRows=${summary.purchaseRiskRows || 0} in ${triggerMonitoringReport.dir}.`);
    lines.push(`- Trigger surfaces: ${[
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
    ].map((surface) => triggerSurfaceText(triggerMonitoringReport, surface)).join("; ")}.`);
  }
  if (yanJiaoReport) {
    lines.push(`- YanJiao/严教 implementation: ${yanJiaoReport.yanJiaoMethods} skill methods and ${yanJiaoReport.windowMethods} window methods are source-proven in ${yanJiaoReport.dir}.`);
  }
  if (yanJiaoListWatch) {
    const watch = summarizeYanJiaoListWatch(yanJiaoListWatch);
    lines.push(`- YanJiao/严教 list watcher: class=${watch.classExists}, wrappers=${watch.wrappers}, visibleWindows=${watch.windows}, renderRecords=${watch.renderRecords}, previewOnly=${watch.previewOnly}, restoredWrappers=${watch.restoredWrappers} in ${watch.path}.`);
  }
  if (yanJiaoCandidateReport) {
    const candidate = summarizeYanJiaoCandidateReport(yanJiaoCandidateReport);
    lines.push(`- YanJiao/严教 candidate-list implementation: ${candidate.level}, methods=${candidate.methodRows}, fields=${candidate.fieldRows}, flowSteps=${candidate.flowSteps}, watcherLiveInstallable=${candidate.watcherLiveInstallable}, realWindowSample=${candidate.realWindowSample} in ${candidate.mdPath}.`);
  }
  if (objectiveCoverageReport) {
    const statusText = Object.entries(objectiveCoverageReport.statusCounts)
      .map(([status, count]) => `${status}:${count}`)
      .join("; ");
    lines.push(`- Objective coverage matrix: ${objectiveCoverageReport.requirements} explicit requirement rows and ${objectiveCoverageReport.monitoringMethods} monitoring rows in ${objectiveCoverageReport.dir}; ${statusText}.`);
  }
  if (surfaceMonitorSample) {
    const status = surfaceMonitorSample.dump?.value?.status || {};
    lines.push(`- Live surface monitor: reversible hooks installed for ${status.hookClasses || 0} classes / ${status.wrapperCount || 0} methods with purchase-risk blocking and no errors in latest sample.`);
  }
  if (liveGapWatch) {
    const gap = summarizeLiveGapWatch(liveGapWatch);
    lines.push(`- Live gap watcher: passive remaining-gap monitor ran in scene=${gap.scene}, wrappers=${gap.wrappers}, snapshots=${gap.snapshots}, blockedCalls=${gap.blockedCalls}, targetMax=${Object.entries(gap.tagMax).map(([tag, count]) => `${tag}:${count}`).join(",") || "(none)"} in ${gap.path}.`);
  }
  if (eventFieldTransitionWatch) {
    const eventField = summarizeEventFieldTransitionWatch(eventFieldTransitionWatch);
    lines.push(`- Event-field transition watcher: before/after field diff monitor ran in scene=${eventField.scene}, wrappers=${eventField.wrappers}, records=${eventField.records}, changed=${eventField.changedRecords}, snapshots=${eventField.snapshots}, blockedCalls=${eventField.blockedCalls}, labels=${eventField.topLabels.join(",") || "(none)"} in ${eventField.path}.`);
  }
  if (currentWindowAction) {
    const currentWindow = summarizeCurrentWindowAction(currentWindowAction);
    lines.push(`- Current visible window/button action surface: scene=${currentWindow.scene}, windows=${currentWindow.visibleWindows}/${currentWindow.windows}, buttons=${currentWindow.buttonCandidates}, purchaseRisk=${currentWindow.purchaseRiskButtons}, closeBack=${currentWindow.closeBackButtons}, confirmAction=${currentWindow.confirmActionButtons}, tooltipHover=${currentWindow.tooltipHoverButtons}, labels=${currentWindow.windowLabels.join(",") || "(none)"} in ${currentWindow.path}.`);
  }
  if (rightPanelToggleSample) {
    lines.push(`- Right-panel toggle safe sample: firstChanged=${rightPanelToggleSample.judgement?.firstChanged === true}, secondChanged=${rightPanelToggleSample.judgement?.secondChanged === true}, finalRestored=${rightPanelToggleSample.judgement?.finalRestored === true} in ${rightPanelToggleSample.__path}.`);
  }
  if (uiStateTransitionSample) {
    const sample = summarizeUiStateTransitionSample(uiStateTransitionSample);
    lines.push(`- UI tab state source sample: attempts=${sample.attempts}, skipped=${sample.skipped}, directAllowed=${sample.directEventAllowed}, selectTabAllowed=${sample.selectTabAllowed}, finalSelected=${sample.finalSelected.join(",") || "(none)"} in ${sample.path}.`);
  }
  if (uiStateDirectEventSample) {
    const direct = summarizeUiStateTransitionSample(uiStateDirectEventSample);
    lines.push(`- UI tab direct-event sample: clicked=${direct.clicked}/${direct.attempts}, selectedChanged=${direct.selectedChanged}, proxyBlocked=${direct.proxyLBlockedCalls}, sceneSwitchBlocked=${direct.sceneSwitchBlockedCalls} in ${direct.path}.`);
  }
  if (promptAutomationMonitor) {
    const summary = promptAutomationMonitor.summary || {};
    lines.push(`- Prompt automation monitor: scene=${summary.scene || ""}, isGameOver=${summary.isGameOver === true}, wrappers=${summary.wrapperCount || 0}, classHooks=${summary.classHookCount || 0}, instanceHooks=${summary.instanceHookCount || 0}, sendHooks=${summary.sendHookCount || 0}, promptNodes=${summary.promptNodes || 0}, visiblePromptWindows=${summary.visiblePromptWindows || 0} in ${promptAutomationMonitor.__path}.`);
  }
  if (tooltipLifecycle) {
    const tooltipLife = summarizeTooltipLifecycleSample(tooltipLifecycle);
    lines.push(`- Tooltip lifecycle: target=${tooltipLife.targetLabel}, callOk=${tooltipLife.callOk}, returned=${tooltipLife.returnedLabel}, cleanupOk=${tooltipLife.cleanupOk}; visible stage tip counts ${tooltipLife.tipsBefore}/${tooltipLife.tipsAfterMouseOver}/${tooltipLife.tipsAfterDirectCreate}/${tooltipLife.tipsAfterCleanup} in ${tooltipLife.path}.`);
  }
  if (hoverFieldTooltip) {
    const fieldTip = summarizeHoverFieldTooltipSample(hoverFieldTooltip);
    lines.push(`- Field-bound tooltip hover: candidates=${fieldTip.candidates}, sampled=${fieldTip.sampledTargets}, mouseRecords=${fieldTip.mouseRecords}, visibleTipDelta=${fieldTip.visibleTipDeltaObserved}, maxTipDelta=${fieldTip.maxCdpDelta}/${fieldTip.maxDirectDelta}/${fieldTip.maxFinalDelta}, maxWindowDelta=${fieldTip.maxCdpWindowDelta}/${fieldTip.maxDirectWindowDelta}, maxStageChildDelta=${fieldTip.maxCdpStageChildDelta}/${fieldTip.maxDirectStageChildDelta} in ${fieldTip.path}.`);
  }
  if (hoverHandlerFieldTransition?.length) {
    const hoverFields = summarizeHoverHandlerFieldTransitionSample(hoverHandlerFieldTransition);
    lines.push(`- Hover-handler field transitions: runs=${hoverFields.runCount}, sampled=${hoverFields.sampledTargets}, fieldDeltaTargets=${hoverFields.fieldDeltaTargets}, changedKeys=${hoverFields.changedKeys.join("/") || "(none)"}, targets=${hoverFields.targets.join("/") || "(none)"}, proxyBlocked=${hoverFields.proxyLBlockedCalls} in ${hoverFields.path}.`);
  }
  if (hoverStageDelta) {
    const stageDelta = summarizeHoverStageDeltaSample(hoverStageDelta);
    lines.push(`- Hover stage-delta sample: scene=${stageDelta.scene}, candidates=${stageDelta.candidates}, sampled=${stageDelta.sampledTargets}, cdpHoverOk=${stageDelta.cdpHoverOk}, cdpHoverTimeouts=${stageDelta.cdpHoverTimeouts}, cdpDelta=${stageDelta.cdpDeltaObserved}, directDelta=${stageDelta.directDeltaObserved}, cleanup=${stageDelta.cleanupOk} in ${stageDelta.path}.`);
  }
  if (rogueTooltipInspect) {
    const tooltip = summarizeRogueTooltipInspect(rogueTooltipInspect);
    lines.push(`- Rogue tooltip/skill buttons: current ${tooltip.scene} sample inspected ${tooltip.inspectedNodes} nodes and found ${tooltip.tooltipNodes} tooltip nodes (${tooltip.activeTooltipNodes} effectively visible); RogueFightWindow tooltip methods=${tooltip.rogueFightMethods} in ${tooltip.path}.`);
  }
  if (rogueActionSurface) {
    const action = summarizeRogueActionSurfaceInspect(rogueActionSurface);
    lines.push(`- Rogue fight/action surface: current ${action.scene} sample found fightId=${action.fightId}, startBtnEvents=${action.startBtnEvents.join(",") || "(none)"}, bottomSkillButtons=${action.bottomSkillButtons}, zhanfaButtons=${action.zhanfaButtons}, and the event-select send source in ${action.path}.`);
  }
  if (rogueActiveSample) {
    const active = summarizeRogueActiveSample(rogueActiveSample);
    lines.push(`- Rogue active fight confirm: ${active.called}, ok=${active.actionOk}, protocol=${active.protocolId}, eventId=${active.eventId}, eventType=${active.eventType}, fullMaskMs=${active.fullMaskMs}, purchaseBlockedCalls=${active.purchaseBlockedCalls} in ${active.path}.`);
  }
  if (rogueGameSceneInspect) {
    const rogueGame = summarizeRogueGameSceneInspect(rogueGameSceneInspect);
    lines.push(`- RogueLikeGameScene battle UI: scene=${rogueGame.scene}, manager=${rogueGame.managerCtor}, seats=${rogueGame.seatCount}, selfSeatIndex=${rogueGame.selfSeatIndex}, buttons=${rogueGame.buttonNodes}, cards=${rogueGame.cardNodes}, selectNodes=${rogueGame.selectNodes}, windows=${rogueGame.windowNodes} in ${rogueGame.path}.`);
  }
  if (rogueSkillZhanfaProbe) {
    const skillZhanfa = summarizeRogueSkillZhanfaProbe(rogueSkillZhanfaProbe);
    lines.push(`- Rogue skill/zhanfa source probe: RogueFightWindow=${skillZhanfa.rogueFightMethods}, ChangeSkill=${skillZhanfa.changeSkillMethods}, ChangeZhanFa=${skillZhanfa.changeZhanFaMethods}, SkillBiFaRogue=${skillZhanfa.skillBiFaRogueMethods} in ${skillZhanfa.path}.`);
  }
  if (rogueBattleActionSurface) {
    const actionSurface = summarizeRogueBattleActionSurface(rogueBattleActionSurface);
    lines.push(`- Rogue battle action surface: isGameOver=${actionSurface.isGameOver}, GameResultWindow=${actionSurface.hasGameResultWindow}, skillPanels=${actionSurface.skillPanels}, handAreas=${actionSurface.handAreas}, cardUiNodes=${actionSurface.cardUiNodes}, buttonNodes=${actionSurface.buttonNodes}, promptNodes=${actionSurface.promptNodes}, managerSources=${actionSurface.managerMethodSources} in ${actionSurface.path}.`);
  }
  if (rogueBattlePromptInspect) {
    const prompt = summarizeRogueBattlePromptInspect(rogueBattlePromptInspect);
    lines.push(`- Rogue battle prompt/action detail: selfHandCards=${prompt.selfHandCards}, currentRoundSeatID=${prompt.currentRoundSeatID}, roundState=${prompt.selfRoundState}, selectAreas=${prompt.selectAreas}, visibleButtons=${prompt.visibleButtons}, promptCandidates=${prompt.promptCandidates}, classMethods SelectCard=${prompt.selectCardWindowMethods}/SkillBiFa=${prompt.skillBiFaWindowMethods}/SpellMulti=${prompt.spellMultiSelectorWindowMethods} in ${prompt.path}.`);
  }
  if (rogueCurrentActionHandlerReport) {
    const currentAction = summarizeRogueCurrentActionHandlerReport(rogueCurrentActionHandlerReport);
    lines.push(`- Rogue current action handlers: scene=${currentAction.scene}, isGameOver=${currentAction.isGameOver}, nodes=${currentAction.nodeCount}, eventNodes=${currentAction.eventNodeCount}, handlers=${currentAction.eventHandlerCount}, sendOrConfirm=${currentAction.sendOrConfirmHandlers}, purchaseRisk=${currentAction.purchaseRiskHandlers}, nodeTypes=${Object.entries(currentAction.actionNodeTypeCounts).map(([key, count]) => `${key}:${count}`).join(",") || "(none)"} in ${currentAction.path}.`);
  }
  if (rogueCurrentSkillButtonDetailReport) {
    const skillDetail = summarizeRogueCurrentSkillButtonDetailReport(rogueCurrentSkillButtonDetailReport);
    lines.push(`- Rogue current skill-button detail: buttons=${skillDetail.skillButtonTexts.join("/") || "(none)"}, currentPlayerAnchors=${skillDetail.currentPlayerAnchors}, cardContainers=${skillDetail.cardContainers}, selectPanels=${skillDetail.selectPanels}, methods=${skillDetail.methodRows}, events=${skillDetail.eventRows}, autoEvidence=${skillDetail.autoEvidenceRows}, sendOrConfirm=${skillDetail.sendOrConfirmRows}, debugLog=${skillDetail.debugLogRows} in ${skillDetail.path}.`);
  }
  if (rogueHandlerFieldJoinReport) {
    const join = summarizeRogueHandlerFieldJoinReport(rogueHandlerFieldJoinReport);
    lines.push(`- Rogue handler-field join: fieldRows=${join.fieldRows}, semanticMatched=${join.semanticMatchedFields}, triageMatched=${join.triageMatchedFields}, needsLiveWithHandlerEvidence=${join.needsLiveRowsSampledByCurrentHandlers}, evidenceLevels=${Object.entries(join.evidenceLevels).map(([key, count]) => `${key}:${count}`).join(",") || "(none)"} in ${join.path}.`);
  }
  if (rogueEndedExitReport) {
    const endedExit = summarizeRogueEndedExitReport(rogueEndedExitReport);
    lines.push(`- Rogue ended-state exit boundaries: isGameOver=${endedExit.isGameOver}, methods=${endedExit.methodCount}, confirmGated=${endedExit.confirmGatedMethods.join(",") || "(none)"}, sendOrLeave=${endedExit.sendOrLeaveMethods.join(",") || "(none)"}, sceneSwitch=${endedExit.sceneSwitchMethods.join(",") || "(none)"} in ${endedExit.path}.`);
  }
  if (blessEffectBlockProbe) {
    const blessEffect = summarizeBlessEffectBlockProbe(blessEffectBlockProbe);
    lines.push(`- Bless/QiFu effect-block probe: directAddEffectOk=${blessEffect.directEffectOk}, blockedDelta=${blessEffect.blockedDelta}, blockedEffects=${blessEffect.blockedEffects}, blockedCalls=${blessEffect.blockedCalls}, finalVisible=${blessEffect.visibleBlessWindows} in ${blessEffect.path}.`);
  }
  if (qixingWatch) {
    const qixing = summarizeQixingWatch(qixingWatch);
    lines.push(`- Qixing/Shen Zhuge watcher: wrappers=${qixing.wrappers}, QiXingWindowMethods=${qixing.qixingWindowMethods}, GuanXingWindowMethods=${qixing.guanXingWindowMethods}, targetWindows=${qixing.targetWindows}, visibleWindowCards=${qixing.visibleWindowCards}, publicGeneralCards=${qixing.publicGeneralCards} in ${qixing.path}.`);
  }
  if (resourceReplacementProbe) {
    const resource = summarizeResourceReplacementProbe(resourceReplacementProbe);
    lines.push(`- Resource live probe: drawOk=${resource.drawOk}, resourceVersion=${resource.resourceVersion}, manifestSize=${resource.manifestSize}, URL.customFormat=${resource.customFormatType}, formatURLResult=${resource.formatURLResult} in ${resource.path}.`);
  }
  if (resourceLoadSchemeProof) {
    const schemes = summarizeResourceLoadSchemeProof(resourceLoadSchemeProof);
    lines.push(`- Resource load schemes: file=${schemes.statuses["file-url"] || ""}, local-http=${schemes.statuses["local-http"] || ""}, same-origin-https=${schemes.statuses["same-origin-https"] || ""}, data=${schemes.statuses["data-url"] || ""} in ${schemes.path}.`);
  }
  if (modeSceneSurfaceReport) {
    const modeScene = summarizeModeSceneSurfaceReport(modeSceneSurfaceReport);
    lines.push(`- ModeScene surface/resource sample: scene=${modeScene.scene}, nodes=${modeScene.nodes}, resourceNodes=${modeScene.resourceNodes}, buttons=${modeScene.buttons}, windows=${modeScene.windows}, registeredMatches=${modeScene.registeredNodeMatches} in ${modeScene.path}.`);
  }
  if (kanshuStateSample) {
    const sample = kanshuStateSample.value || {};
    const state = sample.sampledState || {};
    lines.push(`- KanShu/发财树: read-only hidden-window sample loaded status=${state.status}, level=${state.level}, rewardRange=${state.award?.rewardRange || ""}, freeBlessItemEnough=${state.freeBlessItemEnough}; guardHits=${sample.guardHits?.length || 0}.`);
  }
  lines.push("");
  lines.push("## Source-Proven / Needs Live Sample");
  lines.push("");
  lines.push("- KanShu/发财树: state sampling is now live-proven, but reward action flow still needs explicit permission because the latest sample would branch toward payment confirmation.");
  lines.push("- Shen Zhuge/七星: skill audit maps `七星` to `deck.top.put` + `public.general`, and `GuanXing*` classes are dumped; a live popup/general-card sample is still needed.");
  if (blessEffectBlockProbe && summarizeBlessEffectBlockProbe(blessEffectBlockProbe).directEffectOk) {
    lines.push("- Bless/QiFu effects: open/close and `addEffect` entry blocking are live-proven without draw/buy/shop calls; natural draw-response animation variants remain permission/free-branch gated.");
  } else {
    lines.push("- Bless/QiFu effects: close sample exists and effect methods are dumped; live open trigger plus effect-block sample is still needed.");
  }
  lines.push(`- Hover/popup windows: \`SkillSelectorWindow\` and \`SkillPopUpWindow\` method surfaces are dumped, CDP mouse-move has been observed through Laya, current Rogue skill tooltip object creation/cleanup is live-inspected, hover-handler field transition is sampled (${hoverHandlerFieldTransition?.length ? summarizeHoverHandlerFieldTransitionSample(hoverHandlerFieldTransition).fieldDeltaTargets : 0} target(s)), and the latest lightweight stage-delta sample covered ${hoverStageDelta ? summarizeHoverStageDeltaSample(hoverStageDelta).sampledTargets : 0} visible targets; a pure mouse-hover stage-attached popup delta is still not observed.`);
  lines.push("- Auto play/select/discard/skill: method surfaces are mapped, current Rogue fight confirm is active-sampled, delayed Rogue battle UI and NBi/pBt/_6i/uBt/fHt action anchors are inspected, and current skill buttons now show the `_6i -> eventDispatcher -> uBt touchSkill -> NBi.CardUI_TouchSkill` chain; per-prompt skill/card send paths still need safe active samples before automation.");
  lines.push("- Trigger matrix: stable hook targets are source-proven, but actual active behavior still needs per-surface live samples before enabling automation.");
  lines.push(liveFieldSourceJoin
    ? (liveFieldGapReport
        ? `- All-name field semantics: names, ClassUtils registry anchors, exact enum/static constants, inherited owner prefixes, current live field samples, live/source joins (${liveFieldSourceJoin.sourceMatchedRows} source-matched rows, ${liveFieldSourceJoin.exactMatches} owner+field exact rows), live owner source refs (${liveOwnerSourceReport?.targetsWithFieldRefs || 0} target owners / ${liveOwnerSourceReport?.fieldRefMethods || 0} field-ref methods), live field semantics (${liveFieldSemanticsReport?.fieldRows || 0} rows / ${liveFieldSemanticsReport?.highConfidenceRows || 0} high-confidence), merged field semantic index (${fieldSemanticIndexReport?.fieldIndexRows || 0} rows / ${fieldSemanticIndexReport?.unresolvedRows ?? "unknown"} unresolved), remaining audit (${goalRemainingAuditReport?.cases || 0} cases / ${goalRemainingAuditReport?.scriptsOkCases || 0} script-complete monitor paths), live proof playbook (${liveProofPlaybookReport?.playbookRows || 0} unresolved rows / ${liveProofPlaybookReport?.caseCount || 0} activation-success cases), event-field transition watcher (${eventFieldTransitionWatch ? summarizeEventFieldTransitionWatch(eventFieldTransitionWatch).wrappers : 0} wrappers / ${eventFieldTransitionWatch ? summarizeEventFieldTransitionWatch(eventFieldTransitionWatch).records : 0} records / ${eventFieldTransitionWatch ? summarizeEventFieldTransitionWatch(eventFieldTransitionWatch).changedRecords : 0} changed), current Rogue handler-field evidence (${rogueHandlerFieldJoinReport ? summarizeRogueHandlerFieldJoinReport(rogueHandlerFieldJoinReport).fieldRows : 0} field rows / ${rogueHandlerFieldJoinReport ? summarizeRogueHandlerFieldJoinReport(rogueHandlerFieldJoinReport).needsLiveRowsSampledByCurrentHandlers : 0} needs-live rows with handler evidence), and a triaged weak-field worklist (${liveFieldGapReport.weakRows} deduped rows; ${liveFieldGapTriageReport?.explainedRows ?? "unknown"} explained/generic, ${liveFieldGapTriageReport?.needsLiveRows ?? "unknown"} needs-live, ${liveFieldGapTriageReport?.permissionGatedRows ?? "unknown"} permission-gated) are indexed; the needs-live rows plus other scene/window/event states still need targeted transition proof.`
        : `- All-name field semantics: names, exact enum/static constants, inherited owner prefixes, current live field samples, and live/source joins are indexed (${liveFieldSourceJoin.sourceMatchedRows} source-matched rows, ${liveFieldSourceJoin.exactMatches} owner+field exact rows); unmatched live-only fields and other scene/window/event states still need targeted proof.`)
    : (liveObjectState
        ? "- All-name field semantics: names, exact enum/static constants, inherited owner prefixes, and the current RogueLikeGameScene live ending-state field sample are indexed; other scene/window/event-specific live states still need targeted proof."
        : "- All-name field semantics: names are enumerated, exact enum/static constants and inherited owner prefixes are indexed, but live-only state meanings still need targeted proof."));
  lines.push("");
  lines.push("## Latest Evidence Files");
  lines.push("");
  lines.push(`- Battle activity page: ${battleSamples.activityNextPage?.__path || "(none)"}`);
  lines.push(`- Battle enter trial: ${battleSamples.enterGeneralTrial?.__path || "(none)"}`);
  lines.push(`- Battle start challenge: ${battleSamples.startChallenge?.__path || "(none)"}`);
  lines.push(`- Table transition monitor: ${tableTransitionSample?.__path || "(none)"}`);
  lines.push(`- TableGameScene inspection: ${tablegameInspection?.__path || "(none)"}`);
  lines.push(`- Battle-end scan: ${battleEndScan?.__path || "(none)"}`);
  lines.push(`- Battle-end result close: ${battleEndClose?.__path || "(none)"}`);
  lines.push(`- Battle-end confirm leave: ${battleEndConfirmLeave?.__path || "(none)"}`);
  lines.push(`- KanShu state sample: ${kanshuStateSample?.__path || "(none)"}`);
  lines.push(`- All names report: ${allNamesReport?.dir || "(none)"}`);
  lines.push(`- Focused field context report: ${fieldContextReport?.mdPath || "(none)"}`);
  lines.push(`- All-source context report: ${allSourceContextReport?.mdPath || "(none)"}`);
  lines.push(`- Semantic inheritance report: ${semanticInheritanceReport?.mdPath || "(none)"}`);
  lines.push(`- Semantic enum values TSV: ${semanticInheritanceReport?.enumValuesTsv || "(none)"}`);
  lines.push(`- Live ClassUtils inspect: ${classUtilsInspect?.mdPath || "(none)"}`);
  lines.push(`- Live field/source join: ${liveFieldSourceJoin?.mdPath || "(none)"}`);
  lines.push(`- Live field gap worklist: ${liveFieldGapReport?.mdPath || "(none)"}`);
  lines.push(`- Live field gap triage: ${liveFieldGapTriageReport?.mdPath || "(none)"}`);
  lines.push(`- Live owner source report: ${liveOwnerSourceReport?.mdPath || "(none)"}`);
  lines.push(`- Live field semantics report: ${liveFieldSemanticsReport?.mdPath || "(none)"}`);
  lines.push(`- Field semantic index report: ${fieldSemanticIndexReport?.mdPath || "(none)"}`);
  lines.push(`- Goal remaining audit: ${goalRemainingAuditReport?.mdPath || "(none)"}`);
  lines.push(`- Live proof playbook: ${liveProofPlaybookReport?.mdPath || "(none)"}`);
  lines.push(`- Trigger monitoring report: ${triggerMonitoringReport?.mdPath || "(none)"}`);
  lines.push(`- Trigger monitoring index: ${triggerMonitoringReport?.indexPath || "(none)"}`);
  lines.push(`- Old script behavior map: ${oldScriptMap?.mdPath || "(none)"}`);
  lines.push(`- YanJiao implementation report: ${yanJiaoReport?.mdPath || "(none)"}`);
  lines.push(`- YanJiao list watcher: ${yanJiaoListWatch?.__path || "(none)"}`);
  lines.push(`- YanJiao candidate-list implementation: ${yanJiaoCandidateReport?.__dir ? path.join(yanJiaoCandidateReport.__dir, "README.md") : "(none)"}`);
  lines.push(`- Objective coverage report: ${objectiveCoverageReport?.mdPath || "(none)"}`);
  lines.push(`- Surface monitor sample: ${surfaceMonitorSample?.__path || "(none)"}`);
  lines.push(`- Live gap watcher: ${liveGapWatch?.__path || "(none)"}`);
  lines.push(`- Hover field tooltip sample: ${hoverFieldTooltip?.__path || "(none)"}`);
  lines.push(`- Right-panel toggle sample: ${rightPanelToggleSample?.__path || "(none)"}`);
  lines.push(`- Tooltip lifecycle sample: ${tooltipLifecycle?.__path || "(none)"}`);
  lines.push(`- Rogue tooltip inspect: ${rogueTooltipInspect?.__path || "(none)"}`);
  lines.push(`- Rogue action surface inspect: ${rogueActionSurface?.__path || "(none)"}`);
  lines.push(`- Rogue active fight-confirm sample: ${rogueActiveSample?.__path || "(none)"}`);
  lines.push(`- RogueLikeGameScene inspect: ${rogueGameSceneInspect?.__path || "(none)"}`);
  lines.push(`- Rogue skill/zhanfa probe: ${rogueSkillZhanfaProbe?.__path || "(none)"}`);
  lines.push(`- Rogue battle action surface: ${rogueBattleActionSurface?.__path || "(none)"}`);
  lines.push(`- Rogue battle prompt/action detail: ${rogueBattlePromptInspect?.__path || "(none)"}`);
  lines.push(`- Prompt automation monitor: ${promptAutomationMonitor?.__path || "(none)"}`);
  lines.push(`- Rogue current action handler report: ${rogueCurrentActionHandlerReport?.__path || "(none)"}`);
  lines.push(`- Rogue current skill-button detail report: ${rogueCurrentSkillButtonDetailReport?.__path || "(none)"}`);
  lines.push(`- Rogue handler-field join report: ${rogueHandlerFieldJoinReport?.__path || "(none)"}`);
  lines.push(`- Rogue ended-state exit report: ${rogueEndedExitReport?.__path || "(none)"}`);
  lines.push(`- Rogue BigMap warning confirm: ${rogueSamples.bigmapConfirmWarning?.__path || "(none)"}`);
  lines.push(`- Rogue select-general confirm: ${rogueSamples.selectGeneralConfirm?.__path || "(none)"}`);
  lines.push(`- Rogue scan: ${rogueSamples.scan?.__path || "(none)"}`);
  lines.push(`- Rogue shop-data request: ${rogueSamples.requestShopData?.__path || "(none)"}`);
  lines.push(`- Rogue city click: ${rogueSamples.clickFirstCity?.__path || "(none)"}`);
  lines.push(`- Bless close: ${closeSample?.__path || "(none)"}`);
  lines.push(`- Bless open: ${blessOpenSample?.__path || "(none)"}`);
  lines.push(`- Bless effect-block probe: ${blessEffectBlockProbe?.__path || "(none)"}`);
  lines.push(`- Qixing/Shen Zhuge watch: ${qixingWatch?.__path || "(none)"}`);
  lines.push(`- ModeScene surface report: ${modeSceneSurfaceReport?.__path || "(none)"}`);
  lines.push(`- Resource supplement: ${path.join(explorationRoot, "resource-drawing-and-replacement.md")}`);
  lines.push(`- Resource replacement probe: ${resourceReplacementProbe?.__path || "(none)"}`);
  lines.push(`- Resource load scheme proof: ${resourceLoadSchemeProof?.__path || "(none)"}`);
  lines.push("");
  lines.push("## Remaining Completion Gaps");
  lines.push("");
  lines.push("- KanShu reward action sample only if the branch is free or explicit allow-buy/payment confirmation is granted.");
  if (qixingWatch && (summarizeQixingWatch(qixingWatch).visibleTargetWindows > 0 || summarizeQixingWatch(qixingWatch).publicGeneralCards > 0)) {
    lines.push("- Qixing/Shen Zhuge watcher has live target evidence; still reconcile cleanup/protocol/public-general records before marking complete.");
  } else if (qixingWatch) {
    lines.push("- Qixing/Shen Zhuge watcher is implemented and live-hooked; remaining gap is a real `七星` popup/general-card sample proving exact public-general field and cleanup lifecycle.");
  } else {
    lines.push("- Live `七星` popup/general-card sample proving exact public-general field and cleanup lifecycle.");
  }
  if ((blessOpenSample && summarizeBlessOpenSample(blessOpenSample).blockedEffects > 0) || (blessEffectBlockProbe && summarizeBlessEffectBlockProbe(blessEffectBlockProbe).directEffectOk)) {
    lines.push("- Bless/QiFu open, close, and `addEffect` entry blocking have a live sample; natural draw-response animation variants remain gated by free-branch proof or explicit permission.");
  } else if (blessOpenSample) {
    lines.push("- Bless/QiFu open/close has a live sample; remaining gap is a real `addEffect` animation sample proving blocking/fast-forward behavior without `blessBtnClick` purchase/draw side effects.");
  } else {
    lines.push("- Live QiFu open/effect sample proving `addEffect` blocking/fast-forward behavior without `blessBtnClick` purchase/draw side effects.");
  }
  lines.push(`- Pure mouse-hover stage-attached popup delta is still not observed; current Rogue skill tooltip object creation/cleanup (\`SkillToolTip\`) plus field-bound hover targets, hover-handler field transitions (${hoverHandlerFieldTransition?.length ? summarizeHoverHandlerFieldTransitionSample(hoverHandlerFieldTransition).fieldDeltaTargets : 0} target(s)), lightweight stage-delta targets (${hoverStageDelta ? summarizeHoverStageDeltaSample(hoverStageDelta).sampledTargets : 0}), CDP mouse delivery, and passive live-gap watcher baseline are sampled.`);
  lines.push("- Explicit active Rogue skill auto-confirm/use sample; fight confirm send chain, delayed Rogue battle scene, current battle action anchors, and preview-only prompt hooks are now sampled, but a non-ended per-skill prompt is still needed before active auto-confirm/use.");
  lines.push(liveFieldSourceJoin
    ? (liveFieldGapReport
        ? `- ${liveFieldGapReport.weakRows} deduped weak live fields are triaged: ${liveFieldGapTriageReport?.explainedRows ?? "unknown"} explained/generic, ${liveFieldGapTriageReport?.needsLiveRows ?? "unknown"} still needs live samples, and ${liveFieldGapTriageReport?.permissionGatedRows ?? "unknown"} permission-gated; scene/window/event states outside the latest Rogue ending-state sample still need targeted samples.`
        : "- Live-only state meanings not matched by the live field/source join, plus scene/window/event states outside the latest Rogue ending-state sample.")
    : "- Live-only state meanings beyond the generated all-source, semantic-inheritance, and trigger-monitoring rows.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const followupDir = process.env.SGS_RUNTIME_FOLLOWUP_DIR || await latestDir("-followup-report");
  if (!followupDir) throw new Error("No followup report found.");
  const sourcePath = path.join(followupDir, "focused-source-dump.json");
  const dump = await readJson(sourcePath);
  dump.__path = sourcePath;
  const evidence = methodEvidence(dump);

  const closeDir = await latestDir("-close-bless-sample");
  let closeSample = null;
  if (closeDir) {
    const closePath = path.join(closeDir, "safe-action-sample.json");
    closeSample = await readJson(closePath);
    closeSample.__path = closePath;
  }

  const currentBackDir = await latestDir("-current-back-sample");
  let currentBackSample = null;
  if (currentBackDir) {
    const currentBackPath = path.join(currentBackDir, "safe-action-sample.json");
    currentBackSample = await readJson(currentBackPath);
    currentBackSample.__path = currentBackPath;
  }

  const sceneEnterNextDir = await latestDir("-scene-enter-next-sample");
  let sceneEnterNextSample = null;
  if (sceneEnterNextDir) {
    const sceneEnterNextPath = path.join(sceneEnterNextDir, "safe-action-sample.json");
    sceneEnterNextSample = await readJson(sceneEnterNextPath);
    sceneEnterNextSample.__path = sceneEnterNextPath;
  }

  const battleSamples = {
    activityNextPage: await latestJson("-activity-next-page-battle-entry", "battle-entry-sample.json"),
    enterGeneralTrial: await latestJson("-enter-general-trial-battle-entry", "battle-entry-sample.json"),
    openChallenge: await latestJson("-open-challenge-battle-entry", "battle-entry-sample.json"),
    startChallenge: await latestJson("-start-challenge-battle-entry", "battle-entry-sample.json"),
    finalTableScan: await latestJson("-scan-battle-entry", "battle-entry-sample.json")
  };
  const tableTransitionSample = await latestEventMonitorJson();
  const tablegameInspection = await latestJson("-tablegame-inspect", "tablegame-inspection.json");
  const tablegameFocusReport = await latestJson("-tablegame-focus-report", "tablegame-focus-report.json");
  const battleEndScan = await latestJson("-scan-battle-end", "battle-end-sample.json");
  const battleEndClose = await latestJson("-close-game-result-battle-end", "battle-end-sample.json");
  const battleEndConfirmLeave = await latestJson("-confirm-leave-battle-end", "battle-end-sample.json");
  const kanshuStateSample = await latestJson("-kanshu-state-sample", "kanshu-state-sample.json");
  const allNamesReport = await latestAllNamesReport();
  const oldScriptMap = await latestOldScriptMap();
  const yanJiaoReport = await latestYanJiaoReport();
  const yanJiaoListWatch = await latestJson("-yanjiao-list-watch", "yanjiao-list-watch.json");
  const yanJiaoCandidateReport = await latestJson("-yanjiao-candidate-list-implementation-report", "yanjiao-candidate-list-implementation-report.json");
  const objectiveCoverageReport = await latestObjectiveCoverageReport();
  const fieldContextReport = await latestFieldContextReport();
  const allSourceContextReport = await latestAllSourceContextReport();
  const semanticInheritanceReport = await latestSemanticInheritanceReport();
  const liveObjectState = await latestLiveObjectStateAudit();
  const liveFieldSourceJoin = await latestLiveFieldSourceJoinReport();
  const classUtilsInspect = await latestClassUtilsInspect();
  const modeSceneSurfaceReport = await latestJson("-mode-scene-surface-report", "mode-scene-surface.json");
  const liveFieldGapReport = await latestLiveFieldGapReport();
  const liveFieldGapTriageReport = await latestLiveFieldGapTriageReport();
  const liveOwnerSourceReport = await latestLiveOwnerSourceReport();
  const liveFieldSemanticsReport = await latestLiveFieldSemanticsReport();
  const fieldSemanticIndexReport = await latestFieldSemanticIndexReport();
  const goalRemainingAuditReport = await latestGoalRemainingAuditReport();
  const liveProofPlaybookReport = await latestLiveProofPlaybookReport();
  const triggerMonitoringReport = await latestTriggerMonitoringReport();
  const surfaceMonitorSample = await latestJson("-surface-monitor", "surface-monitor.json");
  const liveGapWatch = await latestJson("-live-gap-watch", "live-gap-watch.json");
  const eventFieldTransitionWatch = await latestJson("-event-field-transition-watch", "event-field-transition-watch.json");
  const currentWindowAction = await latestJson("-current-window-action-report", "current-window-action-report.json");
  const uiStateTransitionSample = await latestJson("-ui-state-transition-sample", "ui-state-transition-sample.json");
  const uiStateDirectEventSample = await latestUiStateDirectEventSample();
  const rightPanelToggleSample = await latestJson("-right-panel-toggle-sample", "right-panel-toggle-sample.json");
  const promptAutomationMonitor = await latestJson("-prompt-automation-monitor", "prompt-automation-monitor.json");
  const hoverFieldTooltip = await latestJson("-hover-field-tooltip-sample", "hover-field-tooltip-sample.json");
  const hoverHandlerFieldTransition = await latestHoverHandlerFieldTransitionReports();
  const hoverStageDelta = await latestJson("-hover-stage-delta-sample", "hover-stage-delta-sample.json");
  const tooltipLifecycle = await latestJson("-tooltip-lifecycle-sample", "tooltip-lifecycle-sample.json");
  const rogueTooltipInspect = await latestJson("-rogue-tooltip-inspect", "rogue-tooltip-inspect.json");
  const rogueActionSurface = await latestJson("-rogue-action-surface-inspect", "rogue-action-surface-inspect.json");
  const rogueActiveSample = await latestJson("-rogue-active-sample", "rogue-active-sample.json");
  const rogueGameSceneInspect = await latestJson("-rogue-game-scene-inspect", "rogue-game-scene-inspection.json");
  const rogueSkillZhanfaProbe = await latestJson("-rogue-skill-zhanfa-probe", "rogue-skill-zhanfa-probe.json");
  const rogueBattleActionSurface = await latestJson("-rogue-battle-action-surface", "rogue-battle-action-surface.json");
  const rogueBattlePromptInspect = await latestJson("-rogue-battle-prompt-inspect", "rogue-battle-prompt-inspect.json");
  const rogueCurrentActionHandlerReport = await latestJson("-rogue-current-action-handler-report", "rogue-current-action-handler-report.json");
  const rogueCurrentSkillButtonDetailReport = await latestJson("-rogue-current-skill-button-detail-report", "rogue-current-skill-button-detail-report.json");
  const rogueHandlerFieldJoinReport = await latestJson("-rogue-handler-field-join-report", "rogue-handler-field-join-report.json");
  const rogueEndedExitReport = await latestJson("-rogue-ended-exit-report", "rogue-ended-exit-report.json");
  const blessOpenSample = await latestJson("-bless-open-sample", "bless-open-sample.json");
  const blessEffectBlockProbe = await latestJson("-bless-effect-block-probe", "bless-effect-block-probe.json");
  const qixingWatch = await latestJson("-qixing-shen-zhuge-watch", "qixing-shen-zhuge-watch.json");
  const resourceReplacementProbe = await latestJson("-resource-replacement-probe", "resource-replacement-probe.json");
  const resourceLoadSchemeProof = await latestJson("-resource-load-scheme-proof", "resource-load-scheme-proof.json");
  const rogueSamples = {
    enterMode: await latestJson("-enter-mode-rogue-sample", "rogue-sample.json"),
    bigmapJoin: await latestJson("-bigmap-join-rogue-sample", "rogue-sample.json"),
    bigmapConfirmWarning: await latestJson("-bigmap-confirm-warning-rogue-sample", "rogue-sample.json"),
    selectGeneralConfirm: await latestJson("-select-general-confirm-rogue-sample", "rogue-sample.json"),
    scan: await latestJson("-scan-rogue-sample", "rogue-sample.json"),
    requestShopData: await latestJson("-request-shop-data-rogue-sample", "rogue-sample.json"),
    clickFirstCity: await latestJson("-smallmap-click-first-city-rogue-sample", "rogue-sample.json")
  };

  const outDir = path.resolve(
    process.env.SGS_RUNTIME_MECHANISM_DIR ||
      path.join(explorationRoot, `${timestampName()}-mechanism-findings`)
  );
  await mkdir(outDir, { recursive: true });
  await writeJson(path.join(outDir, "selected-method-evidence.json"), evidence);
  await writeFile(path.join(outDir, "mechanism-findings.md"), buildMarkdown({
    dump,
    evidence,
    closeSample,
    currentBackSample,
    sceneEnterNextSample,
    battleSamples,
    tableTransitionSample,
    tablegameInspection,
    tablegameFocusReport,
    battleEndScan,
    battleEndClose,
    battleEndConfirmLeave,
    kanshuStateSample,
    allNamesReport,
    oldScriptMap,
    yanJiaoReport,
    yanJiaoListWatch,
    yanJiaoCandidateReport,
    objectiveCoverageReport,
    fieldContextReport,
    allSourceContextReport,
    semanticInheritanceReport,
    liveObjectState,
    liveFieldSourceJoin,
    classUtilsInspect,
    modeSceneSurfaceReport,
    liveFieldGapReport,
    liveFieldGapTriageReport,
    liveOwnerSourceReport,
    liveFieldSemanticsReport,
    fieldSemanticIndexReport,
    goalRemainingAuditReport,
    liveProofPlaybookReport,
    triggerMonitoringReport,
    surfaceMonitorSample,
    liveGapWatch,
    eventFieldTransitionWatch,
    currentWindowAction,
    uiStateTransitionSample,
    uiStateDirectEventSample,
    rightPanelToggleSample,
    promptAutomationMonitor,
    hoverFieldTooltip,
    hoverHandlerFieldTransition,
    hoverStageDelta,
    tooltipLifecycle,
    rogueTooltipInspect,
    rogueActionSurface,
    rogueActiveSample,
    rogueGameSceneInspect,
    rogueSkillZhanfaProbe,
    rogueBattleActionSurface,
    rogueBattlePromptInspect,
    rogueCurrentActionHandlerReport,
    rogueCurrentSkillButtonDetailReport,
    rogueHandlerFieldJoinReport,
    rogueEndedExitReport,
    blessOpenSample,
    blessEffectBlockProbe,
    qixingWatch,
    resourceReplacementProbe,
    resourceLoadSchemeProof,
    rogueSamples
  }), "utf8");
  await writeFile(path.join(outDir, "goal-coverage-audit.md"), buildCoverageAudit({
    dump,
    closeSample,
    battleSamples,
    tableTransitionSample,
    tablegameInspection,
    tablegameFocusReport,
    battleEndScan,
    battleEndClose,
    battleEndConfirmLeave,
    kanshuStateSample,
    allNamesReport,
    oldScriptMap,
    yanJiaoReport,
    yanJiaoListWatch,
    yanJiaoCandidateReport,
    objectiveCoverageReport,
    fieldContextReport,
    allSourceContextReport,
    semanticInheritanceReport,
    liveObjectState,
    liveFieldSourceJoin,
    classUtilsInspect,
    modeSceneSurfaceReport,
    liveFieldGapReport,
    liveFieldGapTriageReport,
    liveOwnerSourceReport,
    liveFieldSemanticsReport,
    fieldSemanticIndexReport,
    goalRemainingAuditReport,
    liveProofPlaybookReport,
    triggerMonitoringReport,
    surfaceMonitorSample,
    liveGapWatch,
    eventFieldTransitionWatch,
    currentWindowAction,
    uiStateTransitionSample,
    uiStateDirectEventSample,
    rightPanelToggleSample,
    promptAutomationMonitor,
    hoverFieldTooltip,
    hoverHandlerFieldTransition,
    hoverStageDelta,
    tooltipLifecycle,
    rogueTooltipInspect,
    rogueActionSurface,
    rogueActiveSample,
    rogueGameSceneInspect,
    rogueSkillZhanfaProbe,
    rogueBattleActionSurface,
    rogueBattlePromptInspect,
    rogueCurrentActionHandlerReport,
    rogueCurrentSkillButtonDetailReport,
    rogueHandlerFieldJoinReport,
    rogueEndedExitReport,
    blessOpenSample,
    blessEffectBlockProbe,
    qixingWatch,
    resourceReplacementProbe,
    resourceLoadSchemeProof,
    rogueSamples
  }), "utf8");
  await writeFile(path.join(outDir, "README.md"), [
    "# Runtime Mechanism Findings",
    "",
    `- Source dump: ${sourcePath}`,
    `- Close sample: ${closeSample?.__path || "(none)"}`,
    `- Current-back sample: ${currentBackSample?.__path || "(none)"}`,
    `- Scene-enter-next sample: ${sceneEnterNextSample?.__path || "(none)"}`,
    `- Activity-next-page battle sample: ${battleSamples.activityNextPage?.__path || "(none)"}`,
    `- Enter-GeneralTrial battle sample: ${battleSamples.enterGeneralTrial?.__path || "(none)"}`,
    `- Open-challenge battle sample: ${battleSamples.openChallenge?.__path || "(none)"}`,
    `- Start-challenge battle sample: ${battleSamples.startChallenge?.__path || "(none)"}`,
    `- Final TableGameScene scan sample: ${battleSamples.finalTableScan?.__path || "(none)"}`,
    `- Table transition monitor: ${tableTransitionSample?.__path || "(none)"}`,
    `- TableGameScene inspection: ${tablegameInspection?.__path || "(none)"}`,
    `- TableGameScene focus report: ${tablegameFocusReport?.__path || "(none)"}`,
    `- Battle-end scan: ${battleEndScan?.__path || "(none)"}`,
    `- Battle-end result close: ${battleEndClose?.__path || "(none)"}`,
    `- Battle-end confirm leave: ${battleEndConfirmLeave?.__path || "(none)"}`,
    `- KanShu state sample: ${kanshuStateSample?.__path || "(none)"}`,
    `- All names report: ${allNamesReport?.dir || "(none)"}`,
    `- Old script behavior map: ${oldScriptMap?.mdPath || "(none)"}`,
    `- YanJiao implementation report: ${yanJiaoReport?.mdPath || "(none)"}`,
    `- YanJiao list watcher: ${yanJiaoListWatch?.__path || "(none)"}`,
    `- YanJiao candidate-list implementation: ${yanJiaoCandidateReport?.__dir ? path.join(yanJiaoCandidateReport.__dir, "README.md") : "(none)"}`,
    `- Objective coverage report: ${objectiveCoverageReport?.mdPath || "(none)"}`,
    `- Focused field context report: ${fieldContextReport?.mdPath || "(none)"}`,
    `- All-source context report: ${allSourceContextReport?.mdPath || "(none)"}`,
    `- Semantic inheritance report: ${semanticInheritanceReport?.mdPath || "(none)"}`,
    `- Semantic enum values TSV: ${semanticInheritanceReport?.enumValuesTsv || "(none)"}`,
    `- Live object-state audit: ${liveObjectState?.mdPath || "(none)"}`,
    `- Live field/source join: ${liveFieldSourceJoin?.mdPath || "(none)"}`,
    `- Live ClassUtils inspect: ${classUtilsInspect?.mdPath || "(none)"}`,
    `- ModeScene surface report: ${modeSceneSurfaceReport?.__path || "(none)"}`,
    `- Live field gap worklist: ${liveFieldGapReport?.mdPath || "(none)"}`,
    `- Live field gap triage: ${liveFieldGapTriageReport?.mdPath || "(none)"}`,
    `- Live owner source report: ${liveOwnerSourceReport?.mdPath || "(none)"}`,
    `- Live field semantics report: ${liveFieldSemanticsReport?.mdPath || "(none)"}`,
    `- Field semantic index report: ${fieldSemanticIndexReport?.mdPath || "(none)"}`,
    `- Goal remaining audit: ${goalRemainingAuditReport?.mdPath || "(none)"}`,
    `- Live proof playbook: ${liveProofPlaybookReport?.mdPath || "(none)"}`,
    `- Trigger monitoring report: ${triggerMonitoringReport?.mdPath || "(none)"}`,
    `- Trigger monitoring index: ${triggerMonitoringReport?.indexPath || "(none)"}`,
    `- Surface monitor sample: ${surfaceMonitorSample?.__path || "(none)"}`,
    `- Live gap watcher: ${liveGapWatch?.__path || "(none)"}`,
    `- Event-field transition watcher: ${eventFieldTransitionWatch?.__path || "(none)"}`,
    `- Current window action report: ${currentWindowAction?.__path || "(none)"}`,
    `- UI state transition sample: ${uiStateTransitionSample?.__path || "(none)"}`,
    `- UI state direct-event sample: ${uiStateDirectEventSample?.__path || "(none)"}`,
    `- Right-panel toggle sample: ${rightPanelToggleSample?.__path || "(none)"}`,
    `- Prompt automation monitor: ${promptAutomationMonitor?.__path || "(none)"}`,
    `- Hover field tooltip sample: ${hoverFieldTooltip?.__path || "(none)"}`,
    `- Hover handler field transition sample: ${hoverHandlerFieldTransition?.[0]?.__path || "(none)"}`,
    `- Hover stage-delta sample: ${hoverStageDelta?.__path || "(none)"}`,
    `- Tooltip lifecycle sample: ${tooltipLifecycle?.__path || "(none)"}`,
    `- Rogue tooltip inspect: ${rogueTooltipInspect?.__path || "(none)"}`,
    `- Rogue action surface inspect: ${rogueActionSurface?.__path || "(none)"}`,
    `- Rogue active fight-confirm sample: ${rogueActiveSample?.__path || "(none)"}`,
    `- RogueLikeGameScene inspect: ${rogueGameSceneInspect?.__path || "(none)"}`,
    `- Rogue skill/zhanfa probe: ${rogueSkillZhanfaProbe?.__path || "(none)"}`,
    `- Rogue battle action surface: ${rogueBattleActionSurface?.__path || "(none)"}`,
    `- Rogue battle prompt/action detail: ${rogueBattlePromptInspect?.__path || "(none)"}`,
    `- Rogue current action handler report: ${rogueCurrentActionHandlerReport?.__path || "(none)"}`,
    `- Rogue current skill-button detail report: ${rogueCurrentSkillButtonDetailReport?.__path || "(none)"}`,
    `- Rogue handler-field join report: ${rogueHandlerFieldJoinReport?.__path || "(none)"}`,
    `- Rogue ended-state exit report: ${rogueEndedExitReport?.__path || "(none)"}`,
    `- Bless open sample: ${blessOpenSample?.__path || "(none)"}`,
    `- Bless effect-block probe: ${blessEffectBlockProbe?.__path || "(none)"}`,
    `- Qixing/Shen Zhuge watch: ${qixingWatch?.__path || "(none)"}`,
    `- Rogue enter-mode: ${rogueSamples.enterMode?.__path || "(none)"}`,
    `- Rogue BigMap join: ${rogueSamples.bigmapJoin?.__path || "(none)"}`,
    `- Rogue BigMap warning confirm: ${rogueSamples.bigmapConfirmWarning?.__path || "(none)"}`,
    `- Rogue select-general confirm: ${rogueSamples.selectGeneralConfirm?.__path || "(none)"}`,
    `- Rogue latest scan: ${rogueSamples.scan?.__path || "(none)"}`,
    `- Rogue shop-data request: ${rogueSamples.requestShopData?.__path || "(none)"}`,
    `- Rogue city click: ${rogueSamples.clickFirstCity?.__path || "(none)"}`,
    `- Resource replacement probe: ${resourceReplacementProbe?.__path || "(none)"}`,
    `- Resource load scheme proof: ${resourceLoadSchemeProof?.__path || "(none)"}`,
    "",
    "## Files",
    "",
    "- `mechanism-findings.md`: human-readable findings, trigger conditions, field notes, and selected method evidence.",
    "- `selected-method-evidence.json`: selected full method sources keyed by registered class.",
    "- `goal-coverage-audit.md`: current objective coverage and remaining live-sample gaps.",
    ""
  ].join("\n"), "utf8");

  console.log(JSON.stringify({
    outDir,
    sourcePath,
    closeSample: closeSample?.__path || null,
    currentBackSample: currentBackSample?.__path || null,
    sceneEnterNextSample: sceneEnterNextSample?.__path || null,
    battleSamples: Object.fromEntries(Object.entries(battleSamples).map(([key, value]) => [key, value?.__path || null])),
    tableTransitionSample: tableTransitionSample?.__path || null,
    tablegameInspection: tablegameInspection?.__path || null,
    tablegameFocusReport: tablegameFocusReport?.__path || null,
    battleEndScan: battleEndScan?.__path || null,
    battleEndClose: battleEndClose?.__path || null,
    battleEndConfirmLeave: battleEndConfirmLeave?.__path || null,
    kanshuStateSample: kanshuStateSample?.__path || null,
    allNamesReport: allNamesReport?.dir || null,
    oldScriptMap: oldScriptMap?.mdPath || null,
    yanJiaoReport: yanJiaoReport?.mdPath || null,
    yanJiaoListWatch: yanJiaoListWatch?.__path || null,
    yanJiaoCandidateReport: yanJiaoCandidateReport?.__path || null,
    objectiveCoverageReport: objectiveCoverageReport?.mdPath || null,
    fieldContextReport: fieldContextReport?.mdPath || null,
    allSourceContextReport: allSourceContextReport?.mdPath || null,
    semanticInheritanceReport: semanticInheritanceReport?.mdPath || null,
    liveObjectState: liveObjectState?.mdPath || null,
    liveFieldSourceJoin: liveFieldSourceJoin?.mdPath || null,
    classUtilsInspect: classUtilsInspect?.mdPath || null,
    modeSceneSurfaceReport: modeSceneSurfaceReport?.__path || null,
    liveFieldGapReport: liveFieldGapReport?.mdPath || null,
    liveFieldGapTriageReport: liveFieldGapTriageReport?.mdPath || null,
    liveOwnerSourceReport: liveOwnerSourceReport?.mdPath || null,
    liveFieldSemanticsReport: liveFieldSemanticsReport?.mdPath || null,
    fieldSemanticIndexReport: fieldSemanticIndexReport?.mdPath || null,
    goalRemainingAuditReport: goalRemainingAuditReport?.mdPath || null,
    liveProofPlaybookReport: liveProofPlaybookReport?.mdPath || null,
    triggerMonitoringReport: triggerMonitoringReport?.mdPath || null,
    surfaceMonitorSample: surfaceMonitorSample?.__path || null,
    eventFieldTransitionWatch: eventFieldTransitionWatch?.__path || null,
    currentWindowAction: currentWindowAction?.__path || null,
    uiStateTransitionSample: uiStateTransitionSample?.__path || null,
    uiStateDirectEventSample: uiStateDirectEventSample?.__path || null,
    rightPanelToggleSample: rightPanelToggleSample?.__path || null,
    promptAutomationMonitor: promptAutomationMonitor?.__path || null,
    hoverFieldTooltip: hoverFieldTooltip?.__path || null,
    hoverHandlerFieldTransition: hoverHandlerFieldTransition?.[0]?.__path || null,
    hoverStageDelta: hoverStageDelta?.__path || null,
    tooltipLifecycle: tooltipLifecycle?.__path || null,
    rogueTooltipInspect: rogueTooltipInspect?.__path || null,
    rogueActionSurface: rogueActionSurface?.__path || null,
    rogueActiveSample: rogueActiveSample?.__path || null,
    rogueGameSceneInspect: rogueGameSceneInspect?.__path || null,
    rogueSkillZhanfaProbe: rogueSkillZhanfaProbe?.__path || null,
    rogueBattleActionSurface: rogueBattleActionSurface?.__path || null,
    rogueBattlePromptInspect: rogueBattlePromptInspect?.__path || null,
    rogueCurrentActionHandlerReport: rogueCurrentActionHandlerReport?.__path || null,
    rogueCurrentSkillButtonDetailReport: rogueCurrentSkillButtonDetailReport?.__path || null,
    rogueHandlerFieldJoinReport: rogueHandlerFieldJoinReport?.__path || null,
    rogueEndedExitReport: rogueEndedExitReport?.__path || null,
    blessOpenSample: blessOpenSample?.__path || null,
    blessEffectBlockProbe: blessEffectBlockProbe?.__path || null,
    qixingWatch: qixingWatch?.__path || null,
    resourceReplacementProbe: resourceReplacementProbe?.__path || null,
    resourceLoadSchemeProof: resourceLoadSchemeProof?.__path || null,
    rogueSamples: Object.fromEntries(Object.entries(rogueSamples).map(([key, value]) => [key, value?.__path || null])),
    classes: Object.keys(evidence).length
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
