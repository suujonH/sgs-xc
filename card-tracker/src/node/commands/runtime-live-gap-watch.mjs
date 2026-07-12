import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

const hookSpecs = {
  BlessNewWindow: ["enterWindow", "Close", "blessBtnClick", "confirmBuy", "shopBtnClick", "addEffect", "effectStop"],
  BlessNewWindowView: ["enterWindow", "Close", "blessBtnClick", "confirmBuy", "shopBtnClick", "addEffect", "effectStop", "UpdateUpperCanvas", "UpdateButtonUI", "updateSkipAnim"],
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
  SkillBiFaWindow: ["Init", "addHandCard", "onHandCardClicked", "SelectOptEvent"],
  SkillBiFaRogueWindow: ["enterWindow", "sendMsgInSkillWindow", "confirmClick", "cancelClick", "autoSelect"],
  SpellMultiSelectorWindow: ["enterWindow", "onTouch", "Close"],
  KanShuWindow: ["updateReqInfo", "onKanShuClick", "autoClickAllPeach", "trueReqJbpAwd", "onShowKanShuEffect", "gotoPay", "buyPorpItem"],
  RogueFightWindow: ["enterWindow", "showTipHandler", "showGeneralTipHandler", "createSkillBtn", "startbtnClick", "checkStart", "gotoJishi"],
  RogueJiShiWindow: ["enterWindow", "refreshBtnClick", "buyBtnClick", "shopBtnClick"],
  TableGameScene: ["gameStart", "gameOverHandler", "addCardsHandler", "playNextCardMotion", "UpdateCardByUseSpell", "ShowCardMotion", "PlayGameEffectBySys", "showGameResultWindow"],
  RogueLikeGameScene: ["gameStart", "gameOverHandler", "addCardsHandler", "playNextCardMotion", "UpdateCardByUseSpell", "ShowCardMotion", "PlayGameEffectBySys", "showSelectGeneral", "showGameResultWindow", "rogueOverGame"]
};

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outputDir() {
  return path.resolve(
    process.env.SGS_LIVE_GAP_WATCH_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-live-gap-watch`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function installExpression(options) {
  return `(${String.raw`(options) => {
    const hookSpecs = options.hookSpecs || {};
    const maxRecords = options.maxRecords || 8000;
    const blockPurchase = options.blockPurchase !== false;
    const blockPattern = /(confirmBuy|blessBtnClick|shopBtnClick|gotoPay|buyPorpItem|buyBtnClick|refreshBtnClick|Recharge|Pay|Buy|YuanBao)/i;
    const now = () => new Date().toISOString();
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    const labelOf = (node) => [node?.name, node?._className_, node?.sceneName, node?.SceneName, ctor(node)].filter(Boolean).join(":");
    const toArray = (value) => Array.isArray(value) ? value : value ? [value] : [];
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
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth >= 1 ? [] : value.slice(0, 8).map((item) => simple(item, depth + 1)) };
      if (value instanceof Map) return { kind: "map", size: value.size, keys: Array.from(value.keys()).slice(0, 20).map(String) };
      if (value instanceof Set) return { kind: "set", size: value.size, values: Array.from(value.values()).slice(0, 20).map(String) };
      const keys = own(value).filter((key) => !/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)).slice(0, 30);
      const out = {
        kind: "object",
        ctor: ctor(value),
        name: value.name || "",
        className: value._className_ || "",
        sceneName: value.sceneName || value.SceneName || "",
        uiid: value._uiid || "",
        keys
      };
      if (depth < 1) {
        out.values = {};
        for (const key of keys.slice(0, 10)) {
          try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const methodNames = (obj, pattern, limit = 80) => {
      const names = [];
      const seen = new Set();
      let proto = Object.getPrototypeOf(obj || {});
      while (proto && proto !== Object.prototype) {
        for (const key of own(proto)) {
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            if (typeof obj[key] === "function" && (!pattern || pattern.test(key))) names.push(key);
          } catch {}
        }
        proto = Object.getPrototypeOf(proto);
      }
      return names.sort().slice(0, limit);
    };
    const safeFields = (obj, limit = 48) => {
      const fields = {};
      if (!obj) return fields;
      const pattern = /(card|Card|ids|IDs|skill|Skill|spell|Spell|window|Window|protocol|Protocol|msg|Msg|zone|Zone|type|Type|name|Name|text|Text|desc|Desc|title|Title|split|Split|auto|Auto|select|Select|status|Status|state|State|effect|Effect|tip|Tip|data|Data|id|ID|count|Count|index|Index|button|Button|btn|Btn)/;
      for (const key of own(obj).slice(0, 1200)) {
        if (/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)) continue;
        if (!pattern.test(key)) continue;
        try { fields[key] = simple(obj[key]); } catch { fields[key] = "[throws]"; }
        if (Object.keys(fields).length >= limit) break;
      }
      return fields;
    };
    const eventSummary = (node) => {
      const out = {};
      const events = node && node._events;
      if (!events || typeof events !== "object") return out;
      for (const name of own(events).slice(0, 40)) {
        try {
          out[name] = toArray(events[name]).filter(Boolean).map((handler) => ({
            caller: labelOf(handler.caller),
            callerCtor: ctor(handler.caller),
            method: handler.method?.name || "",
            once: handler.once,
            args: Array.isArray(handler.args) ? handler.args.map((arg) => simple(arg)).slice(0, 6) : simple(handler.args)
          })).slice(0, 12);
        } catch {
          out[name] = "[throws]";
        }
      }
      return out;
    };
    const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, maxDepth = 16, seen = new Set()) => {
      if (!root || depth > maxDepth || seen.has(root)) return;
      seen.add(root);
      visitor(root, nodePath, depth);
      for (let i = 0; i < (root.numChildren || 0); i++) {
        let child = null;
        try { child = root.getChildAt(i); } catch {}
        const childLabel = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
        walk(child, visitor, nodePath + "/" + childLabel + "#" + i, depth + 1, maxDepth, seen);
      }
    };
    const getLayers = () => {
      const children = [];
      for (let i = 0; i < (Laya.stage?.numChildren || 0); i++) {
        try { children.push(Laya.stage.getChildAt(i)); } catch {}
      }
      const sceneLayer = children.find((node) => /LBi|SceneLayer/.test([node?.name, ctor(node)].join(" ")));
      const windowLayer = children.find((node) => /mWt|WindowLayer/.test([node?.name, ctor(node)].join(" ")));
      let currentScene = null;
      if (sceneLayer) {
        for (let i = (sceneLayer.numChildren || 0) - 1; i >= 0; i--) {
          let candidate = null;
          try { candidate = sceneLayer.getChildAt(i); } catch {}
          if (isVisible(candidate)) {
            currentScene = candidate;
            break;
          }
        }
      }
      return { children, sceneLayer, windowLayer, currentScene };
    };
    const nodeSummary = (node, nodePath, includeMethods = false) => ({
      path: nodePath,
      label: labelOf(node),
      ctor: ctor(node),
      name: node?.name || "",
      className: node?._className_ || "",
      sceneName: node?.sceneName || node?.SceneName || "",
      uiid: node?._uiid || "",
      resName: node?._resName || "",
      visible: node?.visible,
      alpha: node?.alpha,
      effectiveVisible: isVisible(node),
      hiddenReasons: hiddenReasons(node),
      x: node?.x,
      y: node?.y,
      width: node?.width,
      height: node?.height,
      text: node?.text || node?._text || node?.label || node?._label || "",
      mouseEnabled: node?.mouseEnabled,
      mouseThrough: node?.mouseThrough,
      childCount: node?.numChildren || 0,
      fields: safeFields(node),
      events: eventSummary(node),
      methods: includeMethods ? methodNames(node, /(enter|show|Show|hide|Hide|Close|close|click|Click|touch|Touch|card|Card|skill|Skill|select|Select|move|Move|auto|Auto|effect|Effect|tip|Tip|confirm|Confirm|cancel|Cancel|update|Update|layout|Layout|send|Send)/, 90) : []
    });
    const classify = (summary) => {
      const hay = [summary.path, summary.label, summary.text, Object.keys(summary.fields || {}).join(" "), Object.keys(summary.events || {}).join(" "), (summary.methods || []).join(" ")].join(" ");
      const tags = [];
      if (/BlessNewWindow|BlessNewWindowView|QiFu|qifu|bless/i.test(hay)) tags.push("qifu-bless");
      if (/GuanXing|QiXing|Qixing|七星|观星|OutsideCard|MoveCardToZone/i.test(hay)) tags.push("qixing-guanxing");
      if (/YanJiao|严教|genSplit|showSplit|AutoChoose/i.test(hay)) tags.push("yanjiao");
      if (/SkillPopUpWindow|SkillSelectorWindow|CommonPropTip|CardPopWindow|GamePopUpWindow|cardRollOver|cardRollOut|showOverCard|layoutTxt|initBg/i.test(hay)) tags.push("hover-popup");
      else if (/(^|[._])toolTip|tooltip|tipsZorder|tipPos/i.test(hay)) tags.push("hover-capable");
      if (/SelectCardWindow|SpellMultiSelector|SkillBiFa|confirmClick|autoSelect|onTouchCard/i.test(hay)) tags.push("select-prompt");
      if (/TableGameScene|RogueLikeGameScene|manager|seats|GameResultWindow/i.test(hay)) tags.push("battle");
      return tags;
    };
    const currentSceneState = () => {
      const { currentScene } = getLayers();
      const manager = currentScene && (currentScene.manager || currentScene.gameManager || currentScene._manager || null);
      const seats = Array.isArray(manager?.seats) ? manager.seats : [];
      const selfSeatIndex = Number.isInteger(manager?.selfSeatIndex) ? manager.selfSeatIndex : Number.isInteger(manager?.SelfSeatIndex) ? manager.SelfSeatIndex : null;
      const selfSeat = Number.isInteger(selfSeatIndex) ? seats[selfSeatIndex] : null;
      return {
        scene: currentScene ? nodeSummary(currentScene, "currentScene", true) : null,
        manager: manager ? {
          ctor: ctor(manager),
          seatCount: seats.length,
          selfSeatIndex,
          isGameOver: !!manager.isGameOver,
          gameRoundStarted: !!manager.gameRoundStarted,
          gameStartPlay: !!manager.gameStartPlay,
          fields: safeFields(manager, 60)
        } : null,
        selfSeat: selfSeat ? {
          index: selfSeatIndex,
          ctor: ctor(selfSeat),
          handCardsCount: Array.isArray(selfSeat.handCards) ? selfSeat.handCards.length : null,
          fields: safeFields(selfSeat, 60)
        } : null
      };
    };
    const classAvailability = () => {
      const CU = window.Laya?.ClassUtils || {};
      const out = {};
      for (const name of Object.keys(hookSpecs)) {
        let cls = null;
        try { cls = CU.getClass?.(name) || CU._classMap?.[name] || null; } catch {}
        out[name] = {
          exists: !!cls,
          functionName: cls?.name || "",
          methods: (hookSpecs[name] || []).filter((method) => {
            try { return typeof cls?.prototype?.[method] === "function"; } catch { return false; }
          })
        };
      }
      return out;
    };
    if (window.__codexSgsLiveGapWatch?.installed) return window.__codexSgsLiveGapWatch.status();
    const state = {
      installed: true,
      installedAt: now(),
      records: [],
      snapshots: [],
      wrappers: [],
      errors: [],
      blockedCalls: 0,
      hookSummary: []
    };
    const record = (kind, label, args, extra = {}) => {
      try {
        state.records.push({
          seq: state.records.length,
          time: now(),
          kind,
          label,
          scene: currentSceneState(),
          args: Array.from(args || []).slice(0, 8).map((arg) => simple(arg)),
          ...extra
        });
        if (state.records.length > maxRecords) state.records.splice(0, state.records.length - maxRecords);
      } catch (error) {
        state.errors.push({ time: now(), at: "record:" + label, error: String(error?.message || error) });
      }
    };
    const wrap = (owner, prop, label, block = false) => {
      try {
        if (!owner || typeof owner[prop] !== "function") return false;
        const original = owner[prop];
        if (original.__codexSgsLiveGapWrapped) return false;
        const wrapped = function (...args) {
          record(block ? "blocked-call" : "call", label, args, { thisNode: simple(this) });
          if (block) {
            state.blockedCalls++;
            return undefined;
          }
          return original.apply(this, args);
        };
        Object.defineProperty(wrapped, "__codexSgsLiveGapWrapped", { value: true });
        Object.defineProperty(owner, prop, { value: wrapped, configurable: true });
        state.wrappers.push({ owner, prop, original, label });
        return true;
      } catch (error) {
        state.errors.push({ time: now(), at: "wrap:" + label, error: String(error?.message || error) });
        return false;
      }
    };
    const CU = window.Laya?.ClassUtils || {};
    for (const [className, methods] of Object.entries(hookSpecs)) {
      let cls = null;
      try { cls = CU.getClass?.(className) || CU._classMap?.[className] || null; } catch {}
      const installed = [];
      const missing = [];
      for (const method of methods) {
        const label = className + "." + method;
        const block = blockPurchase && blockPattern.test(label);
        if (wrap(cls?.prototype, method, label, block)) installed.push({ method, block });
        else missing.push(method);
      }
      state.hookSummary.push({ className, classExists: !!cls, functionName: cls?.name || "", installed, missing });
    }
    try {
      const popup = CU.getInstance?.("PopUpWindow");
      const ged = popup?.ged;
      const windowManager = toArray(ged?._events?.HIDE_WINDOW).map((handler) => handler?.caller).find((candidate) => candidate?.proxy) || null;
      const proxy = windowManager?.proxy || null;
      for (const [owner, prop, label] of [
        [ged, "event", "GED.event"],
        [ged, "ShowWindow", "GED.ShowWindow"],
        [ged, "CloseWindow", "GED.CloseWindow"],
        [windowManager, "showWindowHandler", "WindowManager.showWindowHandler"],
        [windowManager, "hideWindowHandler", "WindowManager.hideWindowHandler"],
        [windowManager, "updateWindowHandler", "WindowManager.updateWindowHandler"],
        [proxy, "L", "proxy.L"],
        [proxy, "event", "proxy.event"]
      ]) wrap(owner, prop, label, false);
    } catch (error) {
      state.errors.push({ time: now(), at: "manager-wrap", error: String(error?.message || error) });
    }
    const buildSnapshot = (reason = "sample") => {
      const layers = getLayers();
      const targets = [];
      const countsByTag = {};
      const roots = [layers.windowLayer, layers.currentScene].filter(Boolean);
      for (const root of roots) {
        walk(root, (node, nodePath) => {
          if (!isVisible(node)) return;
          const summary = nodeSummary(node, nodePath, true);
          const tags = classify(summary);
          if (!tags.length) return;
          for (const tag of tags) countsByTag[tag] = (countsByTag[tag] || 0) + 1;
          targets.push({ ...summary, tags });
        }, root === layers.windowLayer ? "WindowLayer" : "CurrentScene", 0, 16);
      }
      const snapshot = {
        seq: state.snapshots.length,
        time: now(),
        reason,
        page: { title: document.title, url: location.href },
        resourceVersion: window.resourceVersion || "",
        sceneState: currentSceneState(),
        stage: { width: Laya.stage?.width || 0, height: Laya.stage?.height || 0, children: Laya.stage?.numChildren || 0 },
        windowLayer: layers.windowLayer ? nodeSummary(layers.windowLayer, "WindowLayer", false) : null,
        countsByTag,
        targetNodes: targets.slice(0, 120)
      };
      state.snapshots.push(snapshot);
      if (state.snapshots.length > 120) state.snapshots.splice(0, state.snapshots.length - 120);
      return snapshot;
    };
    const watch = {
      installed: true,
      status() {
        return {
          installed: true,
          installedAt: state.installedAt,
          sceneState: currentSceneState(),
          wrapperCount: state.wrappers.length,
          recordCount: state.records.length,
          snapshotCount: state.snapshots.length,
          blockedCalls: state.blockedCalls,
          errors: state.errors.slice(-20),
          hookSummary: state.hookSummary,
          classAvailability: classAvailability()
        };
      },
      sample(reason) {
        return buildSnapshot(reason || "manual");
      },
      dump() {
        return { ok: true, status: this.status(), records: state.records.slice(), snapshots: state.snapshots.slice(), errors: state.errors.slice() };
      },
      stop() {
        for (const item of state.wrappers.splice(0)) {
          try { Object.defineProperty(item.owner, item.prop, { value: item.original, configurable: true }); }
          catch (error) { state.errors.push({ time: now(), at: "restore:" + item.label, error: String(error?.message || error) }); }
        }
        this.installed = false;
        state.installed = false;
        return this.dump();
      }
    };
    window.__codexSgsLiveGapWatch = watch;
    record("monitor", "live-gap-watch.install", [watch.status()]);
    buildSnapshot("install");
    return watch.status();
  }`})(${JSON.stringify(options)})`;
}

function sampleExpression(reason) {
  return `(() => window.__codexSgsLiveGapWatch ? window.__codexSgsLiveGapWatch.sample(${JSON.stringify(reason)}) : { ok: false, error: "live gap watch is not installed" })()`;
}

function dumpExpression() {
  return "(() => window.__codexSgsLiveGapWatch ? window.__codexSgsLiveGapWatch.dump() : { ok: false, error: 'live gap watch is not installed' })()";
}

function stopExpression() {
  return "(() => window.__codexSgsLiveGapWatch ? window.__codexSgsLiveGapWatch.stop() : { ok: false, error: 'live gap watch is not installed' })()";
}

function readmeText(payload) {
  const status = payload.dump?.value?.status || {};
  const snapshots = payload.dump?.value?.snapshots || [];
  const tagTotals = {};
  for (const snapshot of snapshots) {
    for (const [tag, count] of Object.entries(snapshot.countsByTag || {})) tagTotals[tag] = Math.max(tagTotals[tag] || 0, count);
  }
  const installed = (status.hookSummary || []).filter((item) => item.installed?.length);
  return [
    "# Runtime Live Gap Watch",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Duration ms: ${payload.durationMs}`,
    `- Interval ms: ${payload.intervalMs}`,
    `- Final scene: ${status.sceneState?.scene?.sceneName || status.sceneState?.scene?.className || ""}`,
    `- Hooked classes: ${installed.length}`,
    `- Wrappers: ${status.wrapperCount || 0}`,
    `- Records: ${status.recordCount || 0}`,
    `- Snapshots: ${snapshots.length}`,
    `- Blocked purchase/draw calls: ${status.blockedCalls || 0}`,
    `- Max visible target counts: ${Object.entries(tagTotals).map(([tag, count]) => `${tag}=${count}`).join(", ") || "(none)"}`,
    "",
    "This watcher is passive. It installs reversible wrappers, blocks purchase/draw-like calls while active, and periodically scans visible Laya nodes for live gap targets.",
    "",
    "Target tags: qifu-bless, qixing-guanxing, yanjiao, hover-popup, hover-capable, select-prompt, battle.",
    ""
  ].join("\n");
}

async function main() {
  const durationMs = Number(process.env.SGS_LIVE_GAP_WATCH_MS || process.argv[2] || 20000);
  const intervalMs = Number(process.env.SGS_LIVE_GAP_WATCH_INTERVAL_MS || 2000);
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const options = {
    hookSpecs,
    maxRecords: Number(process.env.SGS_LIVE_GAP_WATCH_MAX_RECORDS || 8000),
    blockPurchase: process.env.SGS_LIVE_GAP_WATCH_BLOCK_PURCHASE !== "0"
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
  const stop = process.env.SGS_LIVE_GAP_WATCH_KEEP_INSTALLED === "1"
    ? { value: { skipped: true } }
    : await evaluateOnSgs(stopExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const payload = { target: install.target, durationMs, intervalMs, install, samples, dump, stop };
  await writeJson(path.join(dir, "live-gap-watch.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
  const snapshots = dump.value?.snapshots || [];
  const tagTotals = {};
  for (const snapshot of snapshots) {
    for (const [tag, count] of Object.entries(snapshot.countsByTag || {})) tagTotals[tag] = Math.max(tagTotals[tag] || 0, count);
  }
  console.log(JSON.stringify({
    ok: true,
    dir,
    durationMs,
    intervalMs,
    scene: dump.value?.status?.sceneState?.scene?.sceneName || dump.value?.status?.sceneState?.scene?.className || null,
    wrappers: dump.value?.status?.wrapperCount || 0,
    records: dump.value?.records?.length || 0,
    snapshots: snapshots.length,
    blockedCalls: dump.value?.status?.blockedCalls || 0,
    tagTotals,
    errors: dump.value?.errors?.length || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
