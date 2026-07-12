import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

const classHookSpecs = {
  BlessNewWindow: ["enterWindow", "Close", "blessBtnClick", "confirmBuy", "shopBtnClick", "addEffect", "effectStop"],
  BlessNewWindowView: ["enterWindow", "Close", "blessBtnClick", "confirmBuy", "shopBtnClick", "addEffect", "effectStop", "UpdateButtonUI", "updateSkipAnim"],
  YanJiao: ["GetResponser", "OnMsgMoveCard", "MoveCardToZoneResponse"],
  YanJiaoWindow: ["enterWindow", "UpdateWindow", "showWindow", "genSplitCard", "layoutCardUIs", "showSplitCard", "updateAutoChooseSatate", "autoChooseClick", "sendAutoChooseMoveOpt", "sendMoveOpt", "confirmBtmClick", "onCardDown", "onStageUp", "Close"],
  GuanXing: ["MoveCardToZoneResponse", "MoveCardFromeZoneResponse", "MoveCardToBottomOrTop"],
  GuanXingPo: ["AutoUseSkillID", "GetDefensiveSelectCardContext"],
  GuanXingPoker: ["GetPokerSkillWindowDesc", "IsAllowCardInWindow", "SelectCardCountWhenResponse", "SendMsgInSelectCardWindow"],
  GuanXingRace: ["CardCountMax", "CardCountMin", "CardSelector", "MoveCardFromeZoneResponse", "MoveCardToZoneResponse", "OutsideCards", "OutsideCnt", "OutsideCardName", "OutsidePopWinTitleByKey", "NeedShowVirtualCard"],
  GuanXingWindow: ["enterWindow", "Init", "updateTitle", "Close"],
  SkillSelectorWindow: ["enterWindow", "layoutCardUis", "cardRollOver", "cardRollOut", "showOverCard", "ShowAiHelpCards", "Close"],
  SkillPopUpWindow: ["initBg", "layoutTxt", "Close"],
  SelectCardWindow: ["enterWindow", "addSelectCardNormalUi", "onTouchCard", "onTouchEnsure", "autoSelect", "confirmClick", "cancelClick", "Close"],
  SkillBiFaWindow: ["enterWindow", "Init", "addHandCard", "onHandCardClicked", "SelectOptEvent", "Close"],
  SkillBiFaRogueWindow: ["enterWindow", "sendMsgInSkillWindow", "confirmClick", "cancelClick", "autoSelect", "Close"],
  SpellMultiSelectorWindow: ["enterWindow", "onTouch", "Close"],
  KanShuWindow: ["updateReqInfo", "onKanShuClick", "autoClickAllPeach", "trueReqJbpAwd", "onShowKanShuEffect", "gotoPay", "buyPorpItem"],
  RogueFightWindow: ["enterWindow", "showTipHandler", "showGeneralTipHandler", "createSkillBtn", "startbtnClick", "checkStart", "gotoJishi"],
  RogueJiShiWindow: ["enterWindow", "refreshBtnClick", "buyBtnClick", "shopBtnClick"],
  TableGameScene: ["gameStart", "gameOverHandler", "addCardsHandler", "playNextCardMotion", "UpdateCardByUseSpell", "ShowCardMotion", "PlayGameEffectBySys", "showGameResultWindow"],
  RogueLikeGameScene: ["gameStart", "gameOverHandler", "addCardsHandler", "playNextCardMotion", "UpdateCardByUseSpell", "ShowCardMotion", "PlayGameEffectBySys", "showSelectGeneral", "showGameResultWindow", "rogueOverGame"]
};

const instanceHookMethods = [
  "ApplyActivateSpell",
  "ApplyTriggerSpell",
  "ButtonBar_Skill_UpdateCallback",
  "Cancel",
  "CardUI_EndSkill",
  "CardUI_SelectedChanged",
  "CardUI_TouchSkill",
  "DiscardRequest",
  "Discard_Result",
  "EndSelector",
  "OnTouchSkill",
  "PlayCard_Result",
  "SelectCardResult",
  "SelectCardResultCompleted",
  "ShowButtonBar",
  "SpellTouch_ConfirmResult",
  "TouchSkillItem",
  "onSelectSeat",
  "Seat_SelectedChanged"
];

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outputDir() {
  return path.resolve(
    process.env.SGS_EVENT_FIELD_TRANSITION_WATCH_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-event-field-transition-watch`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function escapeTsv(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\t/g, " ");
}

function installExpression(options) {
  return `(${String.raw`(options) => {
    const classHookSpecs = options.classHookSpecs || {};
    const instanceHookMethods = options.instanceHookMethods || [];
    const maxRecords = options.maxRecords || 8000;
    const blockPurchase = options.blockPurchase !== false;
    const wrapLayaEventDispatcher = options.wrapLayaEventDispatcher !== false;
    const blockPattern = /(confirmBuy|blessBtnClick|shopBtnClick|gotoPay|buyPorpItem|buyBtnClick|refreshBtnClick|Recharge|Pay|Buy|YuanBao|购买|充值|刷新)/i;
    const eventNamePattern = /(click|touch|select|selected|skill|spell|card|discard|confirm|cancel|close|show|hide|window|scene|move|roll|over|out|mouse|effect|game|round|turn|GuanXing|QiXing|YanJiao|Bless|KanShu|Rogue)/i;
    const fieldPattern = /(card|Card|ids|IDs|skill|Skill|spell|Spell|window|Window|protocol|Protocol|msg|Msg|zone|Zone|type|Type|name|Name|text|Text|desc|Desc|title|Title|split|Split|auto|Auto|select|Select|status|Status|state|State|phase|Phase|effect|Effect|tip|Tip|data|Data|id|ID|count|Count|index|Index|button|Button|btn|Btn|enabled|Enabled|visible|Visible|alpha|Alpha|mouse|Mouse|round|Round|turn|Turn|seat|Seat|manager|Manager)/;
    const blockedFieldPattern = /handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i;
    const now = () => new Date().toISOString();
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const labelOf = (node) => {
      try {
        return [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":");
      } catch {
        return "";
      }
    };
    const hiddenReasons = (node) => {
      const out = [];
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        const label = labelOf(cur) || "(anonymous)";
        if (cur.visible === false || cur._visible === false) out.push(label + ":visible=false");
        if (cur.alpha === 0) out.push(label + ":alpha=0");
      }
      return out;
    };
    const isVisible = (node) => !!node && hiddenReasons(node).length === 0;
    const simple = (value, depth = 0) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return { kind: "function", name: value.name || "", arity: value.length };
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth ? [] : value.slice(0, 6).map((item) => simple(item, depth + 1)) };
      if (value instanceof Map) return { kind: "map", size: value.size, keys: Array.from(value.keys()).slice(0, 12).map(String) };
      if (value instanceof Set) return { kind: "set", size: value.size, values: Array.from(value.values()).slice(0, 12).map(String) };
      const keys = own(value).filter((key) => !blockedFieldPattern.test(key)).slice(0, 24);
      const out = {
        kind: "object",
        ctor: ctor(value),
        label: labelOf(value),
        name: value && value.name || "",
        className: value && value._className_ || "",
        sceneName: value && (value.sceneName || value.SceneName) || "",
        uiid: value && value._uiid || "",
        keys
      };
      if (depth < 1) {
        out.values = {};
        for (const key of keys.slice(0, 8)) {
          try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const fieldsOf = (obj, limit = 80) => {
      const fields = {};
      if (!obj) return fields;
      for (const key of own(obj).slice(0, 1500)) {
        if (blockedFieldPattern.test(key) || !fieldPattern.test(key)) continue;
        try { fields[key] = simple(obj[key]); } catch { fields[key] = "[throws]"; }
        if (Object.keys(fields).length >= limit) break;
      }
      return fields;
    };
    const diffFields = (before, after, limit = 80) => {
      const keys = Array.from(new Set(Object.keys(before || {}).concat(Object.keys(after || {})))).sort();
      const out = [];
      for (const key of keys) {
        const oldValue = before && before[key];
        const newValue = after && after[key];
        if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
        out.push({ key, before: oldValue, after: newValue });
        if (out.length >= limit) break;
      }
      return out;
    };
    const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, seen = new Set()) => {
      if (!root || depth > 14 || seen.has(root) || seen.size > 3500) return;
      seen.add(root);
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const childLabel = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
        walk(child, visitor, nodePath + "/" + childLabel + "#" + i, depth + 1, seen);
      }
    };
    const stageChildren = () => {
      const out = [];
      for (let i = 0; i < (Laya.stage && Laya.stage.numChildren || 0); i++) {
        try { out.push(Laya.stage.getChildAt(i)); } catch {}
      }
      return out;
    };
    const sceneLayer = () => stageChildren().find((node) => /LBi|SceneLayer/.test([node && node.name, ctor(node)].join(" "))) || null;
    const windowLayer = () => stageChildren().find((node) => /mWt|WindowLayer/.test([node && node.name, ctor(node)].join(" "))) || null;
    const currentScene = () => {
      const layer = sceneLayer();
      if (!layer) return null;
      for (let i = (layer.numChildren || 0) - 1; i >= 0; i--) {
        let candidate = null;
        try { candidate = layer.getChildAt(i); } catch {}
        if (isVisible(candidate)) return candidate;
      }
      return null;
    };
    const nodeTiny = (node, path = "") => ({
      path,
      label: labelOf(node),
      ctor: ctor(node),
      name: node && node.name || "",
      className: node && node._className_ || "",
      sceneName: node && (node.sceneName || node.SceneName) || "",
      text: node && (node.text || node._text || node.label || node._label) || "",
      uiid: node && node._uiid || "",
      visible: node && node.visible,
      alpha: node && node.alpha,
      childCount: node && node.numChildren || 0
    });
    const contextSnapshot = (reason = "sample") => {
      const scene = currentScene();
      const manager = scene && (scene.manager || scene.Manager || scene.gameManager || scene._manager || null);
      const winLayer = windowLayer();
      const visibleWindows = [];
      const promptNodes = [];
      for (const root of [winLayer, scene].filter(Boolean)) {
        walk(root, (node, nodePath) => {
          if (!isVisible(node)) return;
          const label = labelOf(node);
          const text = node && (node.text || node._text || node.label || node._label) || "";
          if (/Window|Select|Spell|Skill|BiFa|Military|PinDian|GongXin|GuZheng|Swap|PoXi|GuanXing|QiXing|YanJiao|Bless|KanShu/i.test(label)) {
            visibleWindows.push(nodeTiny(node, nodePath));
          }
          if (/确定|取消|出牌|弃牌|使用|发动|确认|选择|摸牌/.test(String(text)) || /(Select|Skill|Card|Button|btn|confirm|cancel)/i.test(label)) {
            promptNodes.push(nodeTiny(node, nodePath));
          }
        }, root === winLayer ? "WindowLayer" : "CurrentScene", 0);
      }
      return {
        reason,
        time: now(),
        page: { title: document.title, url: location.href },
        resourceVersion: window.resourceVersion || "",
        scene: nodeTiny(scene, "CurrentScene"),
        manager: manager ? {
          ctor: ctor(manager),
          isGameOver: manager.isGameOver === true || manager.IsGameOver === true,
          currentRoundSeatID: manager.currentRoundSeatID ?? null,
          gameRound: manager.gameRound ?? null,
          gameTurn: manager.gameTurn ?? null,
          seatCount: Array.isArray(manager.seats) ? manager.seats.length : null,
          selfSeatIndex: manager.selfSeatIndex ?? manager.SelfSeatIndex ?? null,
          fields: fieldsOf(manager, 40)
        } : null,
        windowLayer: nodeTiny(winLayer, "WindowLayer"),
        visibleWindows: visibleWindows.slice(0, 80),
        promptNodes: promptNodes.slice(0, 120)
      };
    };
    const contextBrief = (snapshot) => ({
      scene: snapshot && snapshot.scene && (snapshot.scene.sceneName || snapshot.scene.className || snapshot.scene.ctor) || "",
      managerCtor: snapshot && snapshot.manager && snapshot.manager.ctor || "",
      isGameOver: snapshot && snapshot.manager && snapshot.manager.isGameOver === true,
      currentRoundSeatID: snapshot && snapshot.manager && snapshot.manager.currentRoundSeatID,
      visibleWindowCount: snapshot && snapshot.visibleWindows && snapshot.visibleWindows.length || 0,
      promptNodeCount: snapshot && snapshot.promptNodes && snapshot.promptNodes.length || 0,
      visibleWindowLabels: (snapshot && snapshot.visibleWindows || []).slice(0, 10).map((item) => item.label || item.text).filter(Boolean),
      promptTexts: (snapshot && snapshot.promptNodes || []).map((item) => item.text).filter(Boolean).slice(0, 12)
    });
    if (window.__codexEventFieldTransitionWatch && window.__codexEventFieldTransitionWatch.installed) {
      return window.__codexEventFieldTransitionWatch.status();
    }
    const state = {
      installed: true,
      installedAt: now(),
      records: [],
      snapshots: [],
      wrappers: [],
      hookSummary: [],
      errors: [],
      blockedCalls: 0
    };
    const pushRecord = (record) => {
      state.records.push({ seq: state.records.length, time: now(), ...record });
      if (state.records.length > maxRecords) state.records.splice(0, state.records.length - maxRecords);
    };
    const recordError = (at, error) => {
      state.errors.push({ time: now(), at, error: String(error && (error.stack || error.message) || error) });
      if (state.errors.length > 100) state.errors.splice(0, state.errors.length - 100);
    };
    const recordCall = (kind, label, thisObj, args, beforeFields, afterFields, beforeContext, afterContext, extra = {}) => {
      const fieldDiffs = diffFields(beforeFields, afterFields);
      const contextDiffs = diffFields(contextBrief(beforeContext), contextBrief(afterContext), 40);
      pushRecord({
        kind,
        label,
        scene: contextBrief(afterContext),
        thisNode: simple(thisObj, 0),
        argSummary: Array.from(args || []).slice(0, 8).map((arg) => simple(arg, 0)),
        fieldDiffs,
        contextDiffs,
        fieldDiffCount: fieldDiffs.length,
        contextDiffCount: contextDiffs.length,
        ...extra
      });
    };
    const wrap = (owner, prop, label, opts = {}) => {
      try {
        if (!owner || typeof owner[prop] !== "function") return false;
        const original = owner[prop];
        if (original.__codexEventFieldTransitionWrapped) return false;
        const ownDescriptor = Object.prototype.hasOwnProperty.call(owner, prop) ? Object.getOwnPropertyDescriptor(owner, prop) : null;
        const block = opts.block === true || (blockPurchase && blockPattern.test(label));
        const filter = opts.filter || null;
        const wrapped = function (...args) {
          if (filter && !filter(this, args)) return original.apply(this, args);
          const beforeFields = fieldsOf(this);
          const beforeContext = contextSnapshot("before:" + label);
          if (block) {
            state.blockedCalls++;
            const afterContext = contextSnapshot("blocked:" + label);
            recordCall("blocked-call", label, this, args, beforeFields, beforeFields, beforeContext, afterContext, { blocked: true });
            return undefined;
          }
          let result;
          try {
            result = original.apply(this, args);
          } catch (error) {
            const afterFields = fieldsOf(this);
            const afterContext = contextSnapshot("throw:" + label);
            recordCall("throw", label, this, args, beforeFields, afterFields, beforeContext, afterContext, { error: String(error && error.message || error) });
            throw error;
          }
          const afterFields = fieldsOf(this);
          const afterContext = contextSnapshot("after:" + label);
          recordCall("call", label, this, args, beforeFields, afterFields, beforeContext, afterContext, { result: simple(result, 0) });
          return result;
        };
        Object.defineProperty(wrapped, "__codexEventFieldTransitionWrapped", { value: true });
        Object.defineProperty(owner, prop, { value: wrapped, configurable: true, writable: true });
        state.wrappers.push({ owner, prop, original, ownDescriptor, label });
        return true;
      } catch (error) {
        recordError("wrap:" + label, error);
        return false;
      }
    };
    const installClassHooks = () => {
      const CU = window.Laya && Laya.ClassUtils || {};
      const summary = [];
      for (const className of Object.keys(classHookSpecs)) {
        let cls = null;
        try { cls = CU.getClass && CU.getClass(className) || CU._classMap && CU._classMap[className] || null; } catch {}
        const installed = [];
        const missing = [];
        for (const method of classHookSpecs[className] || []) {
          const label = className + "." + method;
          if (wrap(cls && cls.prototype, method, label)) installed.push({ method, blocked: blockPattern.test(label) });
          else missing.push(method);
        }
        summary.push({ className, classExists: !!cls, functionName: cls && cls.name || "", installed, missing });
      }
      return summary;
    };
    const installManagerHooks = () => {
      const CU = window.Laya && Laya.ClassUtils || {};
      const toArray = (value) => Array.isArray(value) ? value : value ? [value] : [];
      let popup = null, ged = null, windowManager = null, proxy = null;
      try { popup = CU.getInstance && CU.getInstance("PopUpWindow") || null; } catch {}
      try { ged = popup && popup.ged || null; } catch {}
      try { windowManager = toArray(ged && ged._events && ged._events.HIDE_WINDOW).map((handler) => handler && handler.caller).find((candidate) => candidate && candidate.proxy) || null; } catch {}
      try { proxy = windowManager && windowManager.proxy || null; } catch {}
      const targets = [
        [ged, "event", "GED.event"],
        [ged, "ShowWindow", "GED.ShowWindow"],
        [ged, "CloseWindow", "GED.CloseWindow"],
        [windowManager, "showWindowHandler", "WindowManager.showWindowHandler"],
        [windowManager, "hideWindowHandler", "WindowManager.hideWindowHandler"],
        [windowManager, "updateWindowHandler", "WindowManager.updateWindowHandler"],
        [proxy, "L", "proxy.L"],
        [proxy, "event", "proxy.event"]
      ];
      return targets.map(([owner, prop, label]) => ({ label, installed: wrap(owner, prop, label) }));
    };
    const installInstanceHooks = () => {
      const installed = [];
      const roots = [windowLayer(), currentScene()].filter(Boolean);
      for (const root of roots) {
        walk(root, (node, nodePath) => {
          if (!isVisible(node)) return;
          const hasInteresting = instanceHookMethods.some((method) => {
            try { return typeof node[method] === "function"; } catch { return false; }
          });
          if (!hasInteresting) return;
          for (const method of instanceHookMethods) {
            try {
              if (typeof node[method] !== "function") continue;
              const label = "instance:" + (labelOf(node) || nodePath) + "." + method;
              if (wrap(node, method, label)) installed.push({ path: nodePath, label: labelOf(node), method });
            } catch (error) {
              recordError("instance:" + nodePath + "." + method, error);
            }
          }
        }, "LiveRoot", 0);
      }
      return installed;
    };
    const installLayaEventHook = () => {
      if (!wrapLayaEventDispatcher) return { installed: false, skipped: true };
      const proto = window.Laya && Laya.EventDispatcher && Laya.EventDispatcher.prototype || null;
      const installed = wrap(proto, "event", "Laya.EventDispatcher.event", {
        filter: (self, args) => eventNamePattern.test(String(args && args[0] || "")) || /NBi|uBt|pBt|_6i|fHt|Window|Scene|Skill|Card|Button|btn/.test(labelOf(self))
      });
      return { installed };
    };
    state.hookSummary = [
      { group: "class", hooks: installClassHooks() },
      { group: "manager", hooks: installManagerHooks() },
      { group: "instance", hooks: installInstanceHooks() },
      { group: "laya-event", hooks: [installLayaEventHook()] }
    ];
    const buildSnapshot = (reason = "sample") => {
      const extraInstanceHooks = installInstanceHooks();
      const snapshot = contextSnapshot(reason);
      snapshot.seq = state.snapshots.length;
      snapshot.wrapperCount = state.wrappers.length;
      snapshot.recordCount = state.records.length;
      snapshot.extraInstanceHooks = extraInstanceHooks.length;
      state.snapshots.push(snapshot);
      if (state.snapshots.length > 120) state.snapshots.splice(0, state.snapshots.length - 120);
      return snapshot;
    };
    const api = {
      installed: true,
      status() {
        return {
          installed: state.installed,
          installedAt: state.installedAt,
          wrapperCount: state.wrappers.length,
          recordCount: state.records.length,
          snapshotCount: state.snapshots.length,
          blockedCalls: state.blockedCalls,
          errors: state.errors.slice(-20),
          current: contextBrief(contextSnapshot("status")),
          hookSummary: state.hookSummary.map((group) => ({
            group: group.group,
            installed: Array.isArray(group.hooks) ? group.hooks.reduce((sum, item) => sum + (Array.isArray(item.installed) ? item.installed.length : item.installed ? 1 : 0), 0) : 0
          }))
        };
      },
      sample(reason) {
        return buildSnapshot(reason || "manual");
      },
      dump() {
        return { ok: true, status: this.status(), records: state.records.slice(), snapshots: state.snapshots.slice(), hookSummary: state.hookSummary, errors: state.errors.slice() };
      },
      stop() {
        for (const item of state.wrappers.splice(0).reverse()) {
          try {
            if (item.ownDescriptor) Object.defineProperty(item.owner, item.prop, item.ownDescriptor);
            else delete item.owner[item.prop];
          } catch (error) {
            recordError("restore:" + item.label, error);
          }
        }
        state.installed = false;
        this.installed = false;
        return this.dump();
      }
    };
    window.__codexEventFieldTransitionWatch = api;
    buildSnapshot("install");
    return api.status();
  }`})(${JSON.stringify(options)})`;
}

function sampleExpression(reason) {
  return `(() => window.__codexEventFieldTransitionWatch ? window.__codexEventFieldTransitionWatch.sample(${JSON.stringify(reason)}) : { ok: false, error: "event-field-transition-watch is not installed" })()`;
}

function dumpExpression() {
  return "(() => window.__codexEventFieldTransitionWatch ? window.__codexEventFieldTransitionWatch.dump() : { ok: false, error: 'event-field-transition-watch is not installed' })()";
}

function stopExpression() {
  return "(() => window.__codexEventFieldTransitionWatch ? window.__codexEventFieldTransitionWatch.stop() : { ok: false, error: 'event-field-transition-watch is not installed' })()";
}

function recordRows(payload) {
  const records = payload.dump?.value?.records || [];
  return records.map((record) => ({
    seq: record.seq,
    time: record.time,
    kind: record.kind,
    label: record.label,
    scene: record.scene?.scene || "",
    isGameOver: record.scene?.isGameOver === true,
    visibleWindowCount: record.scene?.visibleWindowCount ?? "",
    promptNodeCount: record.scene?.promptNodeCount ?? "",
    fieldDiffCount: record.fieldDiffCount || 0,
    contextDiffCount: record.contextDiffCount || 0,
    fieldKeys: (record.fieldDiffs || []).map((item) => item.key).join(","),
    contextKeys: (record.contextDiffs || []).map((item) => item.key).join(","),
    blocked: record.blocked === true,
    thisLabel: record.thisNode?.label || record.thisNode?.name || record.thisNode?.ctor || ""
  }));
}

function buildTsv(rows) {
  const headers = [
    "seq",
    "time",
    "kind",
    "label",
    "scene",
    "isGameOver",
    "visibleWindowCount",
    "promptNodeCount",
    "fieldDiffCount",
    "contextDiffCount",
    "fieldKeys",
    "contextKeys",
    "blocked",
    "thisLabel"
  ];
  return `${headers.join("\t")}\n${rows.map((row) => headers.map((header) => escapeTsv(row[header])).join("\t")).join("\n")}\n`;
}

function readmeText(payload) {
  const status = payload.dump?.value?.status || {};
  const records = payload.dump?.value?.records || [];
  const snapshots = payload.dump?.value?.snapshots || [];
  const rows = recordRows(payload);
  const changedRows = rows.filter((row) => row.fieldDiffCount > 0 || row.contextDiffCount > 0);
  const topLabels = {};
  for (const row of rows) topLabels[row.label] = (topLabels[row.label] || 0) + 1;
  const labelText = Object.entries(topLabels)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([label, count]) => `${label}:${count}`)
    .join(", ");
  const scenes = Array.from(new Set(rows.map((row) => row.scene).filter(Boolean)));
  return [
    "# Runtime Event Field Transition Watch",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Duration ms: ${payload.durationMs}`,
    `- Interval ms: ${payload.intervalMs}`,
    `- Final scene: ${status.current?.scene || ""}`,
    `- Wrappers: ${status.wrapperCount || 0}`,
    `- Records: ${records.length}`,
    `- Changed records: ${changedRows.length}`,
    `- Snapshots: ${snapshots.length}`,
    `- Blocked purchase-like calls: ${status.blockedCalls || 0}`,
    `- Scenes observed: ${scenes.join(", ") || "(none)"}`,
    `- Top labels: ${labelText || "(none)"}`,
    "",
    "This watcher is passive except for blocking purchase/payment/refresh-like methods while installed. It records before/after safe field snapshots and scene/window/prompt context diffs for hooked runtime calls.",
    "",
    "Hidden hand/watch-card fields are excluded from snapshots.",
    ""
  ].join("\n");
}

async function main() {
  const durationMs = Number(process.env.SGS_EVENT_FIELD_TRANSITION_WATCH_MS || process.argv[2] || 20000);
  const intervalMs = Number(process.env.SGS_EVENT_FIELD_TRANSITION_WATCH_INTERVAL_MS || 2000);
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const options = {
    classHookSpecs,
    instanceHookMethods,
    maxRecords: Number(process.env.SGS_EVENT_FIELD_TRANSITION_WATCH_MAX_RECORDS || 8000),
    blockPurchase: process.env.SGS_EVENT_FIELD_TRANSITION_WATCH_BLOCK_PURCHASE !== "0",
    wrapLayaEventDispatcher: process.env.SGS_EVENT_FIELD_WRAP_LAYA_EVENT !== "0"
  };
  const install = await evaluateOnSgs(installExpression(options), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const samples = [];
  const started = Date.now();
  let index = 0;
  while (Date.now() - started < durationMs) {
    await sleep(Math.min(intervalMs, Math.max(0, durationMs - (Date.now() - started))));
    const sample = await evaluateOnSgs(sampleExpression(`tick-${index++}`), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
    samples.push(sample.value);
  }
  const dump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const stop = process.env.SGS_EVENT_FIELD_TRANSITION_WATCH_KEEP_INSTALLED === "1"
    ? { value: { skipped: true } }
    : await evaluateOnSgs(stopExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const payload = { target: install.target, durationMs, intervalMs, install, samples, dump, stop };
  const rows = recordRows(payload);
  await writeJson(path.join(dir, "event-field-transition-watch.json"), payload);
  await writeFile(path.join(dir, "event-field-transition-records.tsv"), buildTsv(rows), "utf8");
  await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
  console.log(JSON.stringify({
    ok: true,
    dir,
    durationMs,
    intervalMs,
    scene: dump.value?.status?.current?.scene || "",
    wrappers: dump.value?.status?.wrapperCount || 0,
    records: rows.length,
    changedRecords: rows.filter((row) => row.fieldDiffCount > 0 || row.contextDiffCount > 0).length,
    blockedCalls: dump.value?.status?.blockedCalls || 0,
    snapshots: dump.value?.snapshots?.length || 0,
    errors: dump.value?.status?.errors?.length || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
