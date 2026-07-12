import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOnSgs } from "../cdp/client.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandDir, "..", "..", "..", "..");

const hookSpecs = {
  QiXing: [
    "GetResponser",
    "MoveCardToStackZone",
    "MoveCardFromeZoneResponse",
    "MoveCardToZoneResponse",
    "UpdateRoleDataResponse",
    "Use"
  ],
  HongJu: ["GetResponser", "MoveCardFromeZoneResponse", "MoveCardToZoneResponse"],
  TianHou: ["GetResponser", "MoveCardFromeZoneResponse", "MoveCardToZoneResponse"],
  TongBo: ["GetResponser", "MoveCardFromeZoneResponse", "MoveCardToZoneResponse"],
  YiCheng: ["GetResponser", "MoveCardToStackZone"],
  ZongXuan: ["GetResponser", "MoveCardToZoneResponse"],
  ZongXuanPo: ["GetResponser", "Use", "MoveCardToZoneResponse"],
  GuanXing: ["MoveCardToZoneResponse", "MoveCardFromeZoneResponse", "MoveCardToBottomOrTop"],
  GuanXingPo: ["AutoUseSkillID", "GetDefensiveSelectCardContext"],
  GuanXingPoker: ["GetPokerSkillWindowDesc", "IsAllowCardInWindow", "SelectCardCountWhenResponse", "SendMsgInSelectCardWindow"],
  GuanXingRace: [
    "CardCountMax",
    "CardCountMin",
    "CardSelector",
    "MoveCardFromeZoneResponse",
    "MoveCardToZoneResponse",
    "OutsideCards",
    "OutsideCnt",
    "OutsideCardName",
    "OutsidePopWinTitleByKey",
    "NeedShowVirtualCard"
  ],
  GuanXingWindow: [
    "enterWindow",
    "Init",
    "UpdateWindow",
    "updateTitle",
    "showCards",
    "layoutCards",
    "layoutCardUis",
    "cardRollOver",
    "cardRollOut",
    "showOverCard",
    "StartTouchMoveCard",
    "StopTouchMoveCard",
    "sendInGameNtf",
    "sendMoveCard",
    "sendMoveCardOpt",
    "Close"
  ],
  QiXingWindow: [
    "enterWindow",
    "Init",
    "Show",
    "showCardList",
    "showCardList1",
    "updateWindow",
    "createCardUI",
    "createCardUi",
    "layoutCardUis",
    "layoutTxt",
    "CardPositionChange",
    "StartTouchMoveCard",
    "StopTouchMoveCard",
    "cardDownHandler",
    "cardUpHandler",
    "cardRollOver",
    "cardRollOut",
    "showOverCard",
    "zxCardOverHandler",
    "zxCardOutHandler",
    "swapCard",
    "zxSwapHandCard",
    "onBtnClick",
    "onBtnNormalClick",
    "cancelOperate",
    "sendInGameNtf",
    "Close",
    "destroy"
  ],
  TableGameScene: ["gameStart", "gameOverHandler", "addCardsHandler", "showSelectGeneral", "showHuaShenCardMove"],
  RogueLikeGameScene: ["gameStart", "gameOverHandler", "addCardsHandler", "showSelectGeneral", "rogueOverGame"]
};

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outputDir() {
  return path.resolve(
    process.env.SGS_QIXING_WATCH_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-qixing-shen-zhuge-watch`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function installExpression(options) {
  return `(${String.raw`(options) => {
    const hookSpecs = options.hookSpecs || {};
    const maxRecords = options.maxRecords || 10000;
    const blockSend = options.blockSend === true;
    const now = () => new Date().toISOString();
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    const labelOf = (node) => [node?.name, node?._className_, node?.sceneName, node?.SceneName, ctor(node)].filter(Boolean).join(":");
    const safeKey = (key) => !/handCards|HandCards|handCardList|handCardUi|handCardUis|watchCards|WatchCards|cardsInHand|hidden/i.test(key);
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
    const toArray = (value) => Array.isArray(value) ? value : value ? [value] : [];
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
    const simple = (value, depth = 0) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return { kind: "function", name: value.name || "", arity: value.length };
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth >= 1 ? [] : value.slice(0, 8).map((item) => simple(item, depth + 1)) };
      if (value instanceof Map) return { kind: "map", size: value.size, keys: Array.from(value.keys()).slice(0, 20).map(String) };
      if (value instanceof Set) return { kind: "set", size: value.size, values: Array.from(value.values()).slice(0, 20).map((item) => simple(item, depth + 1)) };
      const keys = own(value).filter(safeKey).slice(0, 40);
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
        for (const key of keys.slice(0, 14)) {
          try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const safeFields = (obj, limit = 64) => {
      const fields = {};
      if (!obj) return fields;
      const pattern = /(CardIDs|cardIds|cardID|CardID|CardId|cardId|CardCount|cardCount|Card|card|Skill|skill|Spell|spell|SeatID|seatID|SrcSeatID|srcSeat|FromZone|ToZone|Zone|zone|Type|type|MsgID|msg|MData|Params|Param|Window|window|Name|name|Title|title|Desc|desc|Text|text|List|list|qx|Qx|xing|Xing|general|General|outside|Outside|pile|Pile|mark|Mark|select|Select|count|Count|index|Index|state|State|status|Status|isSelf|IsSelf|self|Self)/;
      for (const key of own(obj).slice(0, 1400)) {
        if (!safeKey(key) || !pattern.test(key)) continue;
        try { fields[key] = simple(obj[key]); } catch { fields[key] = "[throws]"; }
        if (Object.keys(fields).length >= limit) break;
      }
      return fields;
    };
    const methodNames = (obj, pattern, limit = 90) => {
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
    const cardValue = (raw) => {
      const card = raw?.Card || raw?.card || raw?.data?.Card || raw?.data?.card || raw;
      if (!card || typeof card !== "object") {
        if (Number.isFinite(Number(card))) return { id: Number(card), sourceKind: "number" };
        return null;
      }
      const id = card.CardId ?? card.cardId ?? card.CardID ?? card.cardID ?? card.ID ?? card.id ?? null;
      const name = card.CardName || card.cardName || card.Name || card.name || "";
      const suit = card.CardFlower ?? card.cardFlower ?? card.Suit ?? card.suit ?? "";
      const rank = card.CardNumber ?? card.cardNumber ?? card.cardNumberOri ?? card.Number ?? card.number ?? card.rank ?? "";
      const text = card.text || card.ncn || [name, suit, rank].filter(Boolean).join("");
      if (id == null && !text) return null;
      return { id: id == null ? null : Number(id), name, suit, rank, text, ctor: ctor(card) };
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
      childCount: node?.numChildren || 0,
      fields: safeFields(node),
      methods: includeMethods ? methodNames(node, /(enter|show|Show|close|Close|destroy|card|Card|skill|Skill|select|Select|move|Move|swap|Swap|auto|Auto|touch|Touch|click|Click|roll|Roll|over|Over|out|Out|send|Send|update|Update|layout|Layout|confirm|Confirm|cancel|Cancel)/, 120) : []
    });
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
      return { sceneLayer, windowLayer, currentScene };
    };
    const publicFieldNames = [
      "generalCards",
      "generalCardList",
      "publicGeneralCards",
      "generalPileCards",
      "markCards",
      "marksCards",
      "pileCards",
      "piles",
      "outsideCards"
    ];
    const extractCards = (value, ctx, depth = 0, out = [], seen = new Set()) => {
      if (value == null || depth > 4) return out;
      if (Array.isArray(value) || value instanceof Set) {
        Array.from(value).forEach((item, index) => extractCards(item, { ...ctx, cardIndex: index }, depth + 1, out, seen));
        return out;
      }
      if (value instanceof Map) {
        Array.from(value.values()).forEach((item, index) => extractCards(item, { ...ctx, cardIndex: index }, depth + 1, out, seen));
        return out;
      }
      const normalized = cardValue(value);
      if (normalized) {
        const key = normalized.id != null
          ? ctx.zoneName + ":id:" + normalized.id
          : ctx.zoneName + ":text:" + normalized.text + ":" + ctx.fieldName + ":" + (ctx.cardIndex ?? "");
        if (!seen.has(key)) {
          seen.add(key);
          out.push({
            ...normalized,
            source: {
              rule: "public-general-runtime",
              origin: "runtime-public-field",
              zoneName: ctx.zoneName,
              fieldName: ctx.fieldName,
              seatIndex: ctx.seatIndex,
              cardIndex: ctx.cardIndex ?? null
            }
          });
        }
        return out;
      }
      if (typeof value === "object") {
        for (const key of ["card", "Card", "data", "vo", "info", "item", "value", "cards", "Cards", "list", "items"]) {
          if (key in value && safeKey(key)) extractCards(value[key], ctx, depth + 1, out, seen);
        }
      }
      return out;
    };
    const battleSceneState = () => {
      const scenes = [];
      walk(Laya.stage, (node, nodePath) => {
        const label = labelOf(node);
        if (!/TableGameScene|RogueLikeGameScene/.test(label) || !isVisible(node)) return;
        const manager = node.manager || node.gameManager || node._manager || null;
        const seats = Array.isArray(manager?.seats) ? manager.seats : [];
        const selfSeatIndex = Number.isInteger(manager?.selfSeatIndex) ? manager.selfSeatIndex : Number.isInteger(manager?.SelfSeatIndex) ? manager.SelfSeatIndex : null;
        const publicGeneral = [];
        seats.forEach((seat, seatIndex) => {
          const zones = [];
          for (const fieldName of publicFieldNames) {
            if (!seat || !(fieldName in seat)) continue;
            const cards = extractCards(seat[fieldName], { zoneName: "general", fieldName, seatIndex });
            if (cards.length) zones.push({ fieldName, count: cards.length, cards: cards.slice(0, 40) });
          }
          if (zones.length) publicGeneral.push({ seatIndex, zones });
        });
        scenes.push({
          path: nodePath,
          label,
          sceneName: node.sceneName || node.SceneName || "",
          manager: manager ? {
            ctor: ctor(manager),
            seatCount: seats.length,
            selfSeatIndex,
            isGameOver: manager.isGameOver === true,
            fields: safeFields(manager, 50)
          } : null,
          publicGeneral
        });
      }, "Laya.stage", 0, 14);
      return scenes;
    };
    const collectTargetWindows = () => {
      const windows = [];
      const windowCards = [];
      walk(Laya.stage, (node, nodePath) => {
        const label = labelOf(node);
        if (!/QiXingWindow|GuanXingWindow/.test(label)) return;
        const summary = nodeSummary(node, nodePath, true);
        windows.push(summary);
        if (!summary.effectiveVisible) return;
        walk(node, (child, childPath) => {
          if (!isVisible(child)) return;
          const card = cardValue(child?.Card || child?.card || child?.dataSource?.Card || child?.dataSource?.card || child);
          if (!card) return;
          windowCards.push({
            ...card,
            source: {
              rule: "visible-qixing-window-card",
              origin: "visible-window-node",
              windowPath: nodePath,
              nodePath: childPath,
              nodeLabel: labelOf(child)
            }
          });
        }, nodePath, 0, 10);
      }, "Laya.stage", 0, 16);
      return { windows, windowCards };
    };
    const currentSceneState = () => {
      const layers = getLayers();
      return {
        scene: layers.currentScene ? nodeSummary(layers.currentScene, "currentScene", true) : null,
        battleScenes: battleSceneState()
      };
    };
    const classAvailability = () => {
      const CU = window.Laya?.ClassUtils || {};
      const out = {};
      for (const [name, methods] of Object.entries(hookSpecs)) {
        let cls = null;
        try { cls = CU.getClass?.(name) || CU._classMap?.[name] || null; } catch {}
        out[name] = {
          exists: !!cls,
          functionName: cls?.name || "",
          methods: (methods || []).filter((method) => {
            try { return typeof cls?.prototype?.[method] === "function"; } catch { return false; }
          })
        };
      }
      return out;
    };
    if (window.__codexSgsQixingWatch?.installed && options.reset !== false) {
      try { window.__codexSgsQixingWatch.stop(); } catch {}
    }
    if (window.__codexSgsQixingWatch?.installed) return window.__codexSgsQixingWatch.status();
    const state = {
      installed: true,
      installedAt: now(),
      wrappers: [],
      records: [],
      snapshots: [],
      errors: [],
      blockedSends: 0,
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
          target: collectTargetWindows(),
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
        if (original.__codexSgsQixingWatchWrapped) return false;
        const wrapped = function (...args) {
          record(block ? "blocked-send" : "call", label, args, { thisNode: simple(this) });
          if (block) {
            state.blockedSends++;
            return undefined;
          }
          return original.apply(this, args);
        };
        Object.defineProperty(wrapped, "__codexSgsQixingWatchWrapped", { value: true });
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
        const block = blockSend && /sendInGameNtf|sendMoveCard|sendMoveCardOpt|SendMsgInSelectCardWindow/.test(method);
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
        [ged, "i", "GED.i"],
        [ged, "ShowWindow", "GED.ShowWindow"],
        [ged, "CloseWindow", "GED.CloseWindow"],
        [windowManager, "showWindowHandler", "WindowManager.showWindowHandler"],
        [windowManager, "updateWindowHandler", "WindowManager.updateWindowHandler"],
        [windowManager, "hideWindowHandler", "WindowManager.hideWindowHandler"],
        [proxy, "L", "proxy.L"],
        [proxy, "event", "proxy.event"]
      ]) wrap(owner, prop, label, false);
    } catch (error) {
      state.errors.push({ time: now(), at: "manager-wrap", error: String(error?.message || error) });
    }
    const buildSnapshot = (reason = "sample") => {
      const target = collectTargetWindows();
      const battleScenes = battleSceneState();
      const publicGeneralCards = battleScenes.flatMap((scene) =>
        scene.publicGeneral.flatMap((seat) =>
          seat.zones.flatMap((zone) => zone.cards || [])
        )
      );
      const snapshot = {
        seq: state.snapshots.length,
        time: now(),
        reason,
        page: { title: document.title, url: location.href },
        resourceVersion: window.resourceVersion || "",
        scene: currentSceneState().scene,
        targetWindows: target.windows,
        visibleWindowCards: target.windowCards,
        battleScenes,
        publicGeneralCards,
        counts: {
          targetWindows: target.windows.length,
          visibleTargetWindows: target.windows.filter((item) => item.effectiveVisible).length,
          visibleWindowCards: target.windowCards.length,
          battleScenes: battleScenes.length,
          publicGeneralCards: publicGeneralCards.length
        }
      };
      state.snapshots.push(snapshot);
      if (state.snapshots.length > 120) state.snapshots.splice(0, state.snapshots.length - 120);
      return snapshot;
    };
    const watch = {
      installed: true,
      status() {
        const last = state.snapshots[state.snapshots.length - 1] || buildSnapshot("status");
        return {
          installed: true,
          installedAt: state.installedAt,
          scene: currentSceneState().scene,
          wrapperCount: state.wrappers.length,
          recordCount: state.records.length,
          snapshotCount: state.snapshots.length,
          blockedSends: state.blockedSends,
          lastCounts: last.counts,
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
    window.__codexSgsQixingWatch = watch;
    record("monitor", "qixing-watch.install", [watch.status()]);
    buildSnapshot("install");
    return watch.status();
  }`})(${JSON.stringify(options)})`;
}

function sampleExpression(reason) {
  return `(() => window.__codexSgsQixingWatch ? window.__codexSgsQixingWatch.sample(${JSON.stringify(reason)}) : { ok: false, error: "qixing watch is not installed" })()`;
}

function dumpExpression() {
  return "(() => window.__codexSgsQixingWatch ? window.__codexSgsQixingWatch.dump() : { ok: false, error: 'qixing watch is not installed' })()";
}

function stopExpression() {
  return "(() => window.__codexSgsQixingWatch ? window.__codexSgsQixingWatch.stop() : { ok: false, error: 'qixing watch is not installed' })()";
}

function readmeText(payload) {
  const status = payload.dump?.value?.status || {};
  const snapshots = payload.dump?.value?.snapshots || [];
  const maxCounts = {};
  for (const snapshot of snapshots) {
    for (const [key, value] of Object.entries(snapshot.counts || {})) {
      maxCounts[key] = Math.max(maxCounts[key] || 0, Number(value || 0));
    }
  }
  const installed = (status.hookSummary || []).filter((item) => item.installed?.length);
  return [
    "# Runtime Qixing / Shen Zhuge Watch",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Duration ms: ${payload.durationMs}`,
    `- Interval ms: ${payload.intervalMs}`,
    `- Final scene: ${status.scene?.sceneName || status.scene?.className || ""}`,
    `- Hooked classes: ${installed.length}`,
    `- Wrappers: ${status.wrapperCount || 0}`,
    `- Records: ${status.recordCount || 0}`,
    `- Snapshots: ${snapshots.length}`,
    `- Blocked sends: ${status.blockedSends || 0}`,
    `- Max counts: ${Object.entries(maxCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "(none)"}`,
    "",
    "This watcher is passive. It records Qixing/GuanXing/Shen-Zhuge related windows, visible window card UI, public general-zone runtime fields, GED/window events, and related skill methods.",
    "",
    "It does not click, open windows, buy, or read hidden opponent hand fields. Non-purchase send methods are recorded by default; set `SGS_QIXING_WATCH_BLOCK_SEND=1` to block them while probing.",
    ""
  ].join("\n");
}

async function main() {
  const durationMs = Number(process.env.SGS_QIXING_WATCH_MS || process.argv[2] || 18000);
  const intervalMs = Number(process.env.SGS_QIXING_WATCH_INTERVAL_MS || 2000);
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const options = {
    hookSpecs,
    maxRecords: Number(process.env.SGS_QIXING_WATCH_MAX_RECORDS || 10000),
    blockSend: process.env.SGS_QIXING_WATCH_BLOCK_SEND === "1",
    reset: true
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
  const stop = process.env.SGS_QIXING_WATCH_KEEP_INSTALLED === "1"
    ? { value: { skipped: true } }
    : await evaluateOnSgs(stopExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const payload = { target: install.target, durationMs, intervalMs, install, samples, dump, stop };
  await writeJson(path.join(dir, "qixing-shen-zhuge-watch.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
  const snapshots = dump.value?.snapshots || [];
  const maxCounts = {};
  for (const snapshot of snapshots) {
    for (const [key, value] of Object.entries(snapshot.counts || {})) {
      maxCounts[key] = Math.max(maxCounts[key] || 0, Number(value || 0));
    }
  }
  console.log(JSON.stringify({
    ok: true,
    dir,
    durationMs,
    intervalMs,
    scene: dump.value?.status?.scene?.sceneName || dump.value?.status?.scene?.className || null,
    wrappers: dump.value?.status?.wrapperCount || 0,
    records: dump.value?.records?.length || 0,
    snapshots: snapshots.length,
    blockedSends: dump.value?.status?.blockedSends || 0,
    maxCounts,
    errors: dump.value?.errors?.length || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
