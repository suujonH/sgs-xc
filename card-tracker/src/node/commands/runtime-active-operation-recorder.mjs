import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outputDir() {
  return path.resolve(
    process.env.SGS_ACTIVE_OPERATION_RECORDER_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-active-operation-recorder`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const instanceHookMethods = [
  "ApplyActivateSpell",
  "ApplyLastSpellContext",
  "ApplyRoundState",
  "ApplyTriggerSpell",
  "ButtonBar_Skill_UpdateCallback",
  "ButtonBar_TargetUpdateCallback",
  "ButtonBar_UpdateCallback",
  "Cancel",
  "CardMultiSkillSelectOne",
  "CardUI_EndSkill",
  "CardUI_SelectedChanged",
  "CardUI_TouchSkill",
  "ClearSelfOpertate",
  "ClearSkillAutoSkip",
  "DiscardRequest",
  "Discard_Result",
  "EndSelectTargetSeat",
  "EndSelector",
  "HideCountdownTimer",
  "OnTouchSkill",
  "OptTarget_Result",
  "Pindian_Result",
  "PlayCard_Result",
  "SelectCardResult",
  "SelectCardResultCompleted",
  "Seat_SelectedChanged",
  "Seat_TriggerSpell",
  "ShowButtonBar",
  "SpellAutoUse",
  "SpellTouch_ConfirmResult",
  "StartSelectCard",
  "StartSelectCardOverLoad",
  "StartSelectSkillInhand",
  "StartSelectSkillItem",
  "StartSelectTargetSeatOverload",
  "TouchSkillItem",
  "autoSelect",
  "cancelClick",
  "confirmClick",
  "onTouchCard",
  "onTouchEnsure"
];

const classHookSpecs = {
  SelectCardWindow: ["enterWindow", "autoSelect", "confirmClick", "cancelClick", "onTouchCard", "onTouchEnsure", "Close"],
  SpellMultiSelectorWindow: ["enterWindow", "onTouch", "Close"],
  SkillBiFaWindow: ["enterWindow", "Init", "addHandCard", "onHandCardClicked", "SelectOptEvent", "Close"],
  SkillBiFaRogueWindow: ["enterWindow", "sendMsgInSkillWindow", "confirmClick", "cancelClick", "autoSelect", "Close"],
  MilitaryOrdersSelectWindow: ["enterWindow", "cardClickHandler", "Close"],
  MilitaryOrdersExecutionWindow: ["enterWindow", "executeClickHandler", "Close"],
  GongXinWindow: ["enterWindow", "onTouchCard", "confirmClick", "cancelClick", "Close"],
  GuZhengSelectCardWindow: ["enterWindow", "onTouchCard", "confirmClick", "cancelClick", "Close"],
  SwapCardWindow: ["enterWindow", "confirmClick", "cancelClick", "Close"],
  SwapTopCardWindow: ["enterWindow", "confirmClick", "cancelClick", "Close"],
  SwitchCardWindow: ["enterWindow", "confirmClick", "cancelClick", "Close"],
  PoXiCardWindow: ["enterWindow", "confirmClick", "cancelClick", "Close"],
  PinDianWindow: ["enterWindow", "confirmClick", "cancelClick", "Close"],
  PinDianMultiWindow: ["enterWindow", "confirmClick", "cancelClick", "Close"]
};

function installExpression(options) {
  return `(${String.raw`(options) => {
    const CLASS_HOOK_SPECS = options.classHookSpecs || {};
    const INSTANCE_HOOK_METHODS = options.instanceHookMethods || [];
    const MAX_RECORDS = options.maxRecords || 12000;
    const MAX_WRAPPERS = options.maxWrappers || 800;
    const blockPurchase = options.blockPurchase !== false;
    const purchasePattern = /(buy|Buy|pay|Pay|recharge|Recharge|yuanbao|YuanBao|confirmBuy|shopBtnClick|refreshBtnClick|gotoPay|buyPorpItem|购买|充值|刷新)/;
    const eventNamePattern = /(click|touch|selected|select|skill|spell|card|discard|confirm|cancel|close|show|hide|move|mouse|over|out|button|timer|prompt|operate|role|opt|use|play|deal|phase|round|turn|window|scene)/i;
    const now = () => new Date().toISOString();
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const labelOf = (node) => {
      try { return [node && node.name, node && node._className_, node && node.sceneName, node && node.SceneName, ctor(node)].filter(Boolean).join(":"); }
      catch { return ""; }
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
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth ? [] : value.slice(0, 8).map((item) => simple(item, depth + 1)) };
      if (value instanceof Map) return { kind: "map", size: value.size, keys: Array.from(value.keys()).slice(0, 16).map(String) };
      if (value instanceof Set) return { kind: "set", size: value.size, values: Array.from(value.values()).slice(0, 16).map(String) };
      const keys = own(value).filter((key) => !/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)).slice(0, 24);
      const cardKeys = [
        "cardId", "CardId", "cardID", "CardID",
        "cardName", "CardName",
        "spellId", "SpellId", "SpellID", "resName", "ResName",
        "canSelected", "CanSelected", "selected", "Selected",
        "isInHand", "IsInHand", "isFromHandCard", "IsFromHandCard",
        "cardFlower", "CardFlower", "cardNumber", "CardNumber",
        "cardZoneType", "CardZoneType", "CardBaseType", "CardOriginType"
      ];
      const out = { kind: "object", ctor: ctor(value), label: labelOf(value), name: value.name || "", className: value._className_ || "", sceneName: value.sceneName || value.SceneName || "", keys };
      if (cardKeys.some((key) => key in Object(value))) {
        out.values = {};
        for (const key of cardKeys) {
          if (!(key in Object(value))) continue;
          try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
        return out;
      }
      if (depth < 1) {
        out.values = {};
        for (const key of keys.slice(0, 10)) {
          try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const safeFields = (obj, pattern, limit = 80) => {
      const out = {};
      for (const key of own(obj).slice(0, 1200)) {
        if (/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)) continue;
        if (pattern && !pattern.test(key)) continue;
        try { out[key] = simple(obj[key]); } catch { out[key] = "[throws]"; }
        if (Object.keys(out).length >= limit) break;
      }
      return out;
    };
    const selectedContext = (node) => {
      const context = {};
      try {
        const cc = node && (node.cardContainer || node.CardContainer || node.uBt || null);
        const sc = cc && (cc.SelectContext || cc.selectContext || null);
        if (cc) {
          context.cardContainer = {
            label: labelOf(cc),
            selectedCardIds: sc && Array.isArray(sc.SelectedCardIds) ? sc.SelectedCardIds.slice(0, 30) : null,
            selectedCount: sc && sc.CardSelector ? sc.CardSelector.SelectedCount : null,
            selectComplete: sc && sc.CardSelector ? sc.CardSelector.SelectComplete : null,
            selectContextKeys: sc ? own(sc).slice(0, 30) : []
          };
        }
        if (node && node.selectSeatContext) {
          const sctx = node.selectSeatContext;
          context.seatContext = {
            selectedTargetSeatIDs: Array.isArray(sctx.SelectedTargetSeatIDs) ? sctx.SelectedTargetSeatIDs.slice(0, 20) : null,
            selectedSeatCount: sctx.TargetSelector ? sctx.TargetSelector.SelectedSeatCount : null,
            selectComplete: sctx.TargetSelector ? sctx.TargetSelector.SelectComplete : null,
            keys: own(sctx).slice(0, 30)
          };
        }
        if (node && node.Ot) {
          context.buttonBar = safeFields(node.Ot, /(visible|Visible|btn|Btn|button|Button|text|Text|enable|Enable|ok|OK|cancel|Cancel|discard|Discard|select|Select|quick|Quick)/, 30);
        }
      } catch (error) {
        context.error = String(error && error.message || error);
      }
      return context;
    };
    const findLayers = () => {
      const children = [];
      try {
        for (let i = 0; i < (Laya.stage && Laya.stage.numChildren || 0); i++) children.push(Laya.stage.getChildAt(i));
      } catch {}
      return {
        sceneLayer: children.find((node) => /LBi|SceneLayer/.test([node && node.name, ctor(node)].join(" "))) || null,
        windowLayer: children.find((node) => /mWt|WindowLayer/.test([node && node.name, ctor(node)].join(" "))) || null
      };
    };
    const currentScene = () => {
      const layer = findLayers().sceneLayer;
      if (!layer) return null;
      for (let i = (layer.numChildren || 0) - 1; i >= 0; i--) {
        const node = layer.getChildAt(i);
        if (isVisible(node)) return node;
      }
      return layer.numChildren ? layer.getChildAt(layer.numChildren - 1) : null;
    };
    const walk = (root, visitor, nodePath = "node", depth = 0, seen = new Set()) => {
      if (!root || seen.has(root) || depth > 14 || seen.size > 9000) return;
      seen.add(root);
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const childName = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
        walk(child, visitor, nodePath + "/" + childName + "#" + i, depth + 1, seen);
      }
    };
    const managerRefs = () => {
      const toArray = (v) => Array.isArray(v) ? v : v ? [v] : [];
      const CU = window.Laya && Laya.ClassUtils;
      let popup = null, ged = null, windowManager = null, proxy = null;
      try { popup = CU && CU.getInstance && CU.getInstance("PopUpWindow") || null; } catch {}
      try { ged = popup && popup.ged || null; } catch {}
      try { windowManager = toArray(ged && ged._events && ged._events.HIDE_WINDOW)[0]?.caller || null; } catch {}
      try { proxy = windowManager && windowManager.proxy || null; } catch {}
      return { CU, popup, ged, windowManager, proxy };
    };
    const sceneState = () => {
      const scene = currentScene();
      const manager = scene && (scene.manager || scene.gameManager || scene._manager || null);
      const seats = Array.isArray(manager && manager.seats) ? manager.seats : [];
      const selfSeatIndex = Number.isInteger(manager && manager.selfSeatIndex) ? manager.selfSeatIndex : Number.isInteger(manager && manager.SelfSeatIndex) ? manager.SelfSeatIndex : null;
      const selfSeat = Number.isInteger(selfSeatIndex) ? seats[selfSeatIndex] : null;
      const promptTexts = [];
      try {
        walk(scene, (node) => {
          const text = typeof node.text === "string" ? node.text : typeof node._text === "string" ? node._text : "";
          if (text && /出牌|弃牌|使用|发动|选择|确定|取消|摸牌|响应|正在|思考/.test(text)) promptTexts.push(text);
        }, "CurrentScene", 0, new Set());
      } catch {}
      return {
        scene: scene ? (scene.sceneName || scene._className_ || labelOf(scene)) : "",
        sceneLabel: labelOf(scene),
        managerCtor: ctor(manager),
        isGameOver: manager && manager.isGameOver === true,
        currentRoundSeatID: manager ? manager.currentRoundSeatID : null,
        gameRound: manager ? manager.gameRound : null,
        gameTurn: manager ? manager.gameTurn : null,
        selfSeatIndex,
        selfHandCardCount: selfSeat && Array.isArray(selfSeat.handCards) ? selfSeat.handCards.length : null,
        visibleWindowCount: (() => {
          const layer = findLayers().windowLayer;
          let count = 0;
          if (!layer) return 0;
          for (let i = 0; i < (layer.numChildren || 0); i++) if (isVisible(layer.getChildAt(i))) count++;
          return count;
        })(),
        promptTexts: Array.from(new Set(promptTexts)).slice(0, 12)
      };
    };
    const methodPathFor = (obj) => {
      try {
        const scene = currentScene();
        let found = "";
        walk(scene, (node, path) => {
          if (!found && node === obj) found = path;
        }, "CurrentScene", 0, new Set());
        if (found) return found;
        const wl = findLayers().windowLayer;
        walk(wl, (node, path) => {
          if (!found && node === obj) found = path;
        }, "WindowLayer", 0, new Set());
        return found;
      } catch {
        return "";
      }
    };
    const state = window.__codexActiveOperationRecorder?.state || {
      installed: false,
      installedAt: now(),
      records: [],
      wrappers: [],
      errors: [],
      blockedCalls: [],
      hookSummary: [],
      sampleCount: 0,
      activeMethods: new Set()
    };
    const pushRecord = (record) => {
      state.records.push({ seq: state.records.length, time: now(), ...record });
      if (state.records.length > MAX_RECORDS) state.records.splice(0, state.records.length - MAX_RECORDS);
    };
    const recordCall = (kind, label, args, extra = {}) => {
      try {
        pushRecord({
          kind,
          label,
          sceneBefore: sceneState(),
          args: Array.from(args || []).slice(0, 8).map((arg) => simple(arg)),
          ...extra
        });
      } catch (error) {
        state.errors.push({ time: now(), at: "record:" + label, error: String(error && error.message || error) });
      }
    };
    const wrap = (owner, prop, label, targetType, block = false) => {
      try {
        if (!owner || typeof owner[prop] !== "function") return false;
        const original = owner[prop];
        if (original.__codexActiveOperationWrapped) return false;
        if (state.wrappers.length >= MAX_WRAPPERS) return false;
        const wrapped = function (...args) {
          const thisPath = methodPathFor(this);
          const beforeSelection = selectedContext(this);
          const beforeScene = sceneState();
          if (block) {
            const item = { time: now(), label, targetType, thisLabel: labelOf(this), args: args.slice(0, 8).map((arg) => simple(arg)) };
            state.blockedCalls.push(item);
            pushRecord({ kind: "blocked-call", label, targetType, thisLabel: labelOf(this), thisPath, args: item.args, sceneBefore: beforeScene, beforeSelection });
            return undefined;
          }
          let result;
          let threw = false;
          let errorText = "";
          try {
            result = original.apply(this, args);
            return result;
          } catch (error) {
            threw = true;
            errorText = String(error && error.stack || error && error.message || error);
            throw error;
          } finally {
            let afterScene = null;
            let afterSelection = null;
            try { afterScene = sceneState(); } catch {}
            try { afterSelection = selectedContext(this); } catch {}
            pushRecord({
              kind: "call",
              label,
              targetType,
              thisLabel: labelOf(this),
              thisPath,
              args: args.slice(0, 8).map((arg) => simple(arg)),
              result: simple(result),
              threw,
              errorText,
              sceneBefore: beforeScene,
              sceneAfter: afterScene,
              beforeSelection,
              afterSelection
            });
          }
        };
        Object.defineProperty(wrapped, "__codexActiveOperationWrapped", { value: true });
        Object.defineProperty(owner, prop, { value: wrapped, configurable: true });
        state.wrappers.push({ owner, prop, original, label, targetType });
        state.activeMethods.add(label);
        return true;
      } catch (error) {
        state.errors.push({ time: now(), at: "wrap:" + label, error: String(error && error.message || error) });
        return false;
      }
    };
    const hookClassPrototypes = () => {
      const refs = managerRefs();
      const rows = [];
      for (const [className, methods] of Object.entries(CLASS_HOOK_SPECS)) {
        let cls = null;
        try { cls = refs.CU && (refs.CU.getClass && refs.CU.getClass(className) || refs.CU._classMap && refs.CU._classMap[className]) || null; } catch {}
        const installed = [];
        for (const method of methods) {
          const label = className + "." + method;
          const shouldBlock = blockPurchase && purchasePattern.test(label);
          if (wrap(cls && cls.prototype, method, label, "class-prototype", shouldBlock)) installed.push(method);
        }
        rows.push({ className, classExists: !!cls, functionName: cls && cls.name || "", installed });
      }
      return rows;
    };
    const hookManager = () => {
      const refs = managerRefs();
      const scene = currentScene();
      const manager = scene && (scene.manager || scene.gameManager || scene._manager || null);
      const rows = [];
      for (const [owner, prop, label] of [
        [refs.ged, "event", "GED.event"],
        [refs.ged, "ShowWindow", "GED.ShowWindow"],
        [refs.ged, "CloseWindow", "GED.CloseWindow"],
        [refs.proxy, "event", "proxy.event"],
        [refs.proxy, "L", "proxy.L"],
        [refs.windowManager, "showWindowHandler", "WindowManager.showWindowHandler"],
        [refs.windowManager, "updateWindowHandler", "WindowManager.updateWindowHandler"],
        [refs.windowManager, "hideWindowHandler", "WindowManager.hideWindowHandler"],
        [refs.windowManager, "CloseWindow", "WindowManager.CloseWindow"],
        [refs.windowManager, "CloseWindowByName", "WindowManager.CloseWindowByName"]
      ]) {
        if (wrap(owner, prop, label, "manager-proxy-window", blockPurchase && purchasePattern.test(label))) rows.push(label);
      }
      const methodPattern = /(Send|send|Req|Rep|Ntf|Client|ServerProxy|RoleOpt|Select|Card|Skill|Spell|Use|Move|Deal|Discard|Cancel|Confirm|Game|Play|Trigger|Operate|Opt)/;
      for (const key of own(manager).slice(0, 1200)) {
        let value;
        try { value = manager && manager[key]; } catch {}
        if (typeof value === "function" && methodPattern.test(key)) {
          const label = "manager." + key;
          if (wrap(manager, key, label, "manager-instance", blockPurchase && purchasePattern.test(label))) rows.push(label);
        }
      }
      return rows;
    };
    const hookInstances = () => {
      const rows = [];
      const roots = [];
      const scene = currentScene();
      const wl = findLayers().windowLayer;
      if (scene) roots.push({ node: scene, path: "CurrentScene" });
      if (wl) roots.push({ node: wl, path: "WindowLayer" });
      const interestingNode = (node, nodePath) => {
        const label = labelOf(node);
        const keys = own(node).join(" ");
        return /TableGameScene|RogueLikeGameScene|NBi|uBt|fHt|pBt|_6i|Select|Skill|Spell|Card|Button|Btn|Window|Bxt|T6i/i.test([nodePath, label, keys].join(" "));
      };
      for (const root of roots) {
        walk(root.node, (node, nodePath) => {
          if (!interestingNode(node, nodePath)) return;
          const installed = [];
          for (const method of INSTANCE_HOOK_METHODS) {
            if (wrap(node, method, nodePath + "." + method, "current-instance", blockPurchase && purchasePattern.test(method))) installed.push(method);
          }
          if (installed.length) rows.push({ path: nodePath, label: labelOf(node), ctor: ctor(node), installed });
        }, root.path, 0, new Set());
      }
      return rows;
    };
    const hookLayaEvents = () => {
      try {
        const proto = Laya && Laya.EventDispatcher && Laya.EventDispatcher.prototype;
        if (!proto) return false;
        return wrap(proto, "event", "Laya.EventDispatcher.event", "laya-event", false);
      } catch (error) {
        state.errors.push({ time: now(), at: "hookLayaEvents", error: String(error && error.message || error) });
        return false;
      }
    };
    const sample = (reason) => {
      const classRows = hookClassPrototypes();
      const managerRows = hookManager();
      const instanceRows = hookInstances();
      const layaEvent = hookLayaEvents();
      state.sampleCount++;
      pushRecord({
        kind: "sample",
        label: reason || "sample",
        sceneAfter: sceneState(),
        hookUpdate: {
          classes: classRows.filter((row) => row.installed.length),
          managerRows,
          instanceRows,
          layaEvent,
          wrapperCount: state.wrappers.length
        }
      });
      return status();
    };
    const status = () => ({
      installed: true,
      installedAt: state.installedAt,
      scene: sceneState(),
      recordCount: state.records.length,
      wrapperCount: state.wrappers.length,
      sampleCount: state.sampleCount,
      blockedCalls: state.blockedCalls.length,
      errors: state.errors.slice(-20),
      activeMethodCount: state.activeMethods.size,
      activeMethods: Array.from(state.activeMethods).slice(0, 200)
    });
    const dump = () => ({
      ok: true,
      status: status(),
      records: state.records.slice(),
      blockedCalls: state.blockedCalls.slice(),
      errors: state.errors.slice()
    });
    const stop = () => {
      for (const item of state.wrappers.splice(0).reverse()) {
        try { Object.defineProperty(item.owner, item.prop, { value: item.original, configurable: true }); }
        catch (error) { state.errors.push({ time: now(), at: "restore:" + item.label, error: String(error && error.message || error) }); }
      }
      const out = dump();
      out.status.wrapperCount = 0;
      try { delete window.__codexActiveOperationRecorder; } catch { window.__codexActiveOperationRecorder = null; }
      return out;
    };
    const api = { installed: true, state, sample, status, dump, stop };
    window.__codexActiveOperationRecorder = api;
    state.installed = true;
    sample("install");
    return status();
  }`})(${JSON.stringify(options)})`;
}

function sampleExpression(reason) {
  return `(() => {
    const api = window.__codexActiveOperationRecorder;
    if (!api) return { ok: false, error: "active operation recorder is not installed" };
    api.sample(${JSON.stringify(reason)});
    return api.dump();
  })()`;
}

function dumpExpression() {
  return "(() => window.__codexActiveOperationRecorder ? window.__codexActiveOperationRecorder.dump() : { ok: false, error: 'active operation recorder is not installed' })()";
}

function stopExpression() {
  return "(() => window.__codexActiveOperationRecorder ? window.__codexActiveOperationRecorder.stop() : { ok: true, reason: 'not installed' })()";
}

function tsvEscape(value) {
  if (Array.isArray(value)) return value.map(String).join("|").replace(/\t|\r?\n/g, " ");
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value).replace(/\t|\r?\n/g, " ");
  return String(value).replace(/\t|\r?\n/g, " ");
}

function recordRows(payload) {
  const sources = [
    ...(payload.samples || []).map((sample) => sample?.value || sample).filter((value) => value?.records),
    payload.dump?.value?.records ? payload.dump.value : null
  ].filter(Boolean);
  const seen = new Set();
  const records = [];
  sources.forEach((source, sourceIndex) => {
    const installedAt = source.status?.installedAt || "";
    for (const record of source.records || []) {
      const key = [installedAt, record.seq, record.time, record.label].join("\t");
      if (seen.has(key)) continue;
      seen.add(key);
      records.push({ ...record, __installedAt: installedAt, __sourceIndex: sourceIndex });
    }
  });
  records.sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")) || a.__sourceIndex - b.__sourceIndex || a.seq - b.seq);
  return records.map((record) => ({
    seq: record.seq,
    installedAt: record.__installedAt || "",
    time: record.time,
    kind: record.kind,
    label: record.label,
    targetType: record.targetType || "",
    sceneBefore: record.sceneBefore?.scene || "",
    sceneAfter: record.sceneAfter?.scene || "",
    promptBefore: (record.sceneBefore?.promptTexts || []).join("|"),
    promptAfter: (record.sceneAfter?.promptTexts || []).join("|"),
    thisLabel: record.thisLabel || "",
    thisPath: record.thisPath || "",
    selectedBefore: record.beforeSelection ? JSON.stringify(record.beforeSelection).slice(0, 800) : "",
    selectedAfter: record.afterSelection ? JSON.stringify(record.afterSelection).slice(0, 800) : "",
    args: record.args ? JSON.stringify(record.args).slice(0, 900) : "",
    result: record.result ? JSON.stringify(record.result).slice(0, 500) : "",
    threw: record.threw === true,
    blocked: record.kind === "blocked-call"
  }));
}

function buildTsv(rows) {
  const headers = [
    "seq",
    "installedAt",
    "time",
    "kind",
    "label",
    "targetType",
    "sceneBefore",
    "sceneAfter",
    "promptBefore",
    "promptAfter",
    "thisLabel",
    "thisPath",
    "selectedBefore",
    "selectedAfter",
    "args",
    "result",
    "threw",
    "blocked"
  ];
  return `${headers.join("\t")}\n${rows.map((row) => headers.map((header) => tsvEscape(row[header])).join("\t")).join("\n")}\n`;
}

function summarizeRecords(rows) {
  const byLabel = {};
  const byTarget = {};
  for (const row of rows) {
    byLabel[row.label] = (byLabel[row.label] || 0) + 1;
    byTarget[row.targetType] = (byTarget[row.targetType] || 0) + 1;
  }
  return { byLabel, byTarget };
}

function topText(counts, limit = 12) {
  return Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => `${key}:${count}`)
    .join(", ");
}

function readmeText(payload, rows) {
  const latestSample = (payload.samples || []).map((sample) => sample?.value || sample).filter((value) => value?.status).at(-1);
  const status = payload.dump?.value?.status || latestSample?.status || payload.install?.value || {};
  const summary = summarizeRecords(rows);
  const activeRows = rows.filter((row) => row.kind === "call");
  const sendRows = activeRows.filter((row) => /proxy\.L|Send|send|Req|Rep|Ntf|RoleOpt|Select|Card|Skill|Spell|Use|Move|Deal|Discard|Confirm|Play|Trigger|Opt/.test(row.label));
  return [
    "# Runtime Active Operation Recorder",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Duration ms: ${payload.durationMs}`,
    `- Interval ms: ${payload.intervalMs}`,
    `- Final scene: ${status.scene?.scene || ""}`,
    `- Records: ${rows.length}`,
    `- Calls: ${activeRows.length}`,
    `- Send/confirm-like calls: ${sendRows.length}`,
    `- Samples: ${status.sampleCount || 0}`,
    `- Active methods: ${status.activeMethodCount || 0}`,
    `- Wrappers before stop: ${payload.dump?.value?.status?.wrapperCount || 0}`,
    `- Reinstalls: ${payload.reinstalls?.length || 0}`,
    `- Blocked purchase-like calls: ${status.blockedCalls || 0}`,
    `- Errors: ${status.errors?.length || 0}`,
    "",
    "This recorder is passive. It records user-triggered runtime calls and safe before/after prompt/selection state. It does not click, confirm, use, discard, play, buy, refresh, pay, or read hidden opponent hand fields.",
    "",
    "## Top Labels",
    "",
    `- ${topText(summary.byLabel) || "(none)"}`,
    "",
    "## Target Types",
    "",
    `- ${topText(summary.byTarget) || "(none)"}`,
    "",
    "## Send / Confirm-Like Rows",
    "",
    ...(sendRows.slice(0, 120).map((row) => `- #${row.seq} ${row.label} scene=${row.sceneBefore}->${row.sceneAfter} prompt=${row.promptBefore || row.promptAfter || ""}`)),
    ""
  ].join("\n");
}

async function main() {
  const durationMs = Number(process.env.SGS_ACTIVE_OPERATION_RECORDER_MS || process.argv[2] || 180000);
  const intervalMs = Number(process.env.SGS_ACTIVE_OPERATION_RECORDER_INTERVAL_MS || 1500);
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  await evaluateOnSgs(stopExpression()).catch(() => null);
  const options = {
    classHookSpecs,
    instanceHookMethods,
    maxRecords: Number(process.env.SGS_ACTIVE_OPERATION_MAX_RECORDS || 12000),
    maxWrappers: Number(process.env.SGS_ACTIVE_OPERATION_MAX_WRAPPERS || 800),
    blockPurchase: process.env.SGS_ACTIVE_OPERATION_BLOCK_PURCHASE !== "0"
  };
  const install = await evaluateOnSgs(installExpression(options), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const samples = [];
  const reinstalls = [];
  const started = Date.now();
  let index = 0;
  while (Date.now() - started < durationMs) {
    await sleep(Math.min(intervalMs, Math.max(0, durationMs - (Date.now() - started))));
    const reason = `tick-${index++}`;
    let sample = await evaluateOnSgs(sampleExpression(reason), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
    if (sample.value?.ok === false && /not installed/i.test(sample.value?.error || "")) {
      const reinstall = await evaluateOnSgs(installExpression(options), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
      reinstalls.push({ reason, install: reinstall.value, target: reinstall.target });
      sample = await evaluateOnSgs(sampleExpression(`${reason}-after-reinstall`), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
    }
    samples.push(sample.value);
  }
  let dump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  if (dump.value?.ok === false) {
    const lastSample = samples.filter((sample) => sample?.records).at(-1);
    if (lastSample) dump = { ...dump, value: { ...lastSample, finalDumpFrom: "last-sample" } };
  }
  const stop = process.env.SGS_ACTIVE_OPERATION_KEEP_INSTALLED === "1"
    ? { value: { skipped: true } }
    : await evaluateOnSgs(stopExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const payload = { target: install.target, durationMs, intervalMs, install, reinstalls, samples, dump, stop };
  const rows = recordRows(payload);
  await writeJson(path.join(dir, "active-operation-recorder.json"), payload);
  await writeFile(path.join(dir, "active-operation-records.tsv"), buildTsv(rows), "utf8");
  await writeFile(path.join(dir, "README.md"), readmeText(payload, rows), "utf8");
  console.log(JSON.stringify({
    ok: true,
    dir,
    durationMs,
    intervalMs,
    scene: dump.value?.status?.scene?.scene || "",
    records: rows.length,
    calls: rows.filter((row) => row.kind === "call").length,
    sendOrConfirmLikeCalls: rows.filter((row) => /proxy\\.L|Send|send|Req|Rep|Ntf|RoleOpt|Select|Card|Skill|Spell|Use|Move|Deal|Discard|Confirm|Play|Trigger|Opt/.test(row.label)).length,
    samples: dump.value?.status?.sampleCount || 0,
    wrappers: dump.value?.status?.wrapperCount || 0,
    reinstalls: reinstalls.length,
    blockedCalls: dump.value?.status?.blockedCalls || 0,
    errors: dump.value?.status?.errors?.length || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
