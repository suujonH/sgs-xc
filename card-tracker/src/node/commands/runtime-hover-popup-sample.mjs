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
    process.env.SGS_HOVER_POPUP_SAMPLE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-hover-popup-sample`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function browserHoverPopupInstaller(options) {
    const maxRecords = options.maxRecords || 3000;
    const mouseIntervalMs = options.mouseIntervalMs || 180;
    const recordAllMouse = options.recordAllMouse === true;
    const now = () => new Date().toISOString();
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const ctor = (o) => { try { return o?.constructor?.name || ""; } catch { return ""; } };
    const labelOf = (node) => [node?.name, node?._className_, node?.sceneName, node?.SceneName, ctor(node)].filter(Boolean).join(":");
    const hiddenReasons = (node) => {
      const out = [];
      for (let cur = node; cur; cur = cur.parent || cur._parent || null) {
        const label = labelOf(cur) || "(anonymous)";
        if (cur.visible === false || cur._visible === false) out.push(label + ":visible=false");
        if (cur.alpha === 0) out.push(label + ":alpha=0");
      }
      return out;
    };
    const effectiveVisible = (node) => hiddenReasons(node).length === 0;
    const safeValue = (value, depth = 0) => {
      const type = typeof value;
      if (value == null || type === "string" || type === "number" || type === "boolean") return value;
      if (type === "function") return { kind: "function", name: value.name || "", arity: value.length };
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth ? [] : value.slice(0, 4).map((item) => safeValue(item, depth + 1)) };
      const keys = own(value)
        .filter((key) => !/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key))
        .slice(0, 20);
      const out = { kind: "object", ctor: ctor(value), name: value.name || "", className: value._className_ || "", sceneName: value.sceneName || value.SceneName || "", keys };
      if (depth < 1) {
        out.values = {};
        for (const key of keys.slice(0, 8)) {
          try { out.values[key] = safeValue(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const nodeSummary = (node, nodePath = "") => {
      if (!node) return null;
      const text = (() => { try { return typeof node.text === "string" ? node.text.slice(0, 120) : ""; } catch { return ""; } })();
      const bounds = (() => {
        try {
          const p = node.localToGlobal ? node.localToGlobal(new Laya.Point(0, 0)) : null;
          return p ? { x: p.x, y: p.y, width: node.width, height: node.height } : null;
        } catch { return null; }
      })();
      const keys = own(node)
        .filter((key) => /(card|Card|skill|Skill|tip|Tip|popup|Popup|pop|Pop|window|Window|desc|Desc|text|Text|name|Name|data|Data|select|Select|over|Over|hover|Hover)/.test(key))
        .filter((key) => !/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key))
        .slice(0, 24);
      const fields = {};
      for (const key of keys.slice(0, 10)) {
        try { fields[key] = safeValue(node[key], 1); } catch { fields[key] = "[throws]"; }
      }
      return {
        path: nodePath,
        label: labelOf(node),
        ctor: ctor(node),
        name: node.name || "",
        className: node._className_ || "",
        sceneName: node.sceneName || node.SceneName || "",
        uiid: node._uiid || "",
        resName: node._resName || "",
        visible: node.visible,
        alpha: node.alpha,
        effectiveVisible: effectiveVisible(node),
        hiddenReasons: hiddenReasons(node),
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        childCount: node.numChildren || 0,
        text,
        bounds,
        fields
      };
    };
    const stageChildren = () => {
      const out = [];
      try {
        for (let i = 0; i < (Laya.stage?.numChildren || 0); i++) out.push(Laya.stage.getChildAt(i));
      } catch {}
      return out;
    };
    const sceneState = () => {
      const children = stageChildren();
      const sceneLayer = children.find((node) => /LBi|SceneLayer/.test([node?.name, ctor(node)].join(" ")));
      let scene = null;
      if (sceneLayer) {
        for (let i = (sceneLayer.numChildren || 0) - 1; i >= 0; i--) {
          const candidate = sceneLayer.getChildAt(i);
          if (effectiveVisible(candidate)) { scene = candidate; break; }
        }
      }
      return {
        sceneName: scene?.sceneName || scene?.SceneName || scene?.name || "",
        className: scene?._className_ || "",
        ctor: ctor(scene)
      };
    };
    const visibleWindowSnapshot = () => {
      const children = stageChildren();
      const windowLayer = children.find((node) => /mWt|WindowLayer/.test([node?.name, ctor(node)].join(" ")));
      const out = [];
      const collect = (node, nodePath, depth) => {
        if (!node || depth > 5 || out.length >= 80) return;
        const label = labelOf(node);
        if (/Window|Popup|PopUp|Tip|Tips|Skill|Card|Select|mWt|Dialog|modal/i.test(label) || node === windowLayer) {
          const item = nodeSummary(node, nodePath);
          if (item && item.effectiveVisible) out.push(item);
        }
        for (let i = 0; i < (node.numChildren || 0); i++) {
          let child = null;
          try { child = node.getChildAt(i); } catch {}
          collect(child, `${nodePath}/${child?.name || child?._className_ || child?.sceneName || ctor(child) || ("#" + i)}#${i}`, depth + 1);
        }
      };
      if (windowLayer) collect(windowLayer, "WindowLayer", 0);
      return out;
    };
    const hitChainAt = (x, y) => {
      const hits = [];
      const visit = (node, nodePath, depth) => {
        if (!node || depth > 12 || hits.length >= 60 || !effectiveVisible(node)) return;
        let contains = false;
        try {
          const p = node.localToGlobal ? node.localToGlobal(new Laya.Point(0, 0)) : null;
          const width = Number(node.width) || 0;
          const height = Number(node.height) || 0;
          contains = !!p && width > 0 && height > 0 && x >= p.x && y >= p.y && x <= p.x + width && y <= p.y + height;
        } catch {}
        if (contains || depth === 0) {
          const summary = nodeSummary(node, nodePath);
          if (summary) hits.push(summary);
          for (let i = 0; i < (node.numChildren || 0); i++) {
            let child = null;
            try { child = node.getChildAt(i); } catch {}
            visit(child, `${nodePath}/${child?.name || child?._className_ || child?.sceneName || ctor(child) || ("#" + i)}#${i}`, depth + 1);
          }
        }
      };
      visit(Laya.stage, "Laya.stage", 0);
      return hits;
    };
    if (window.__codexSgsHoverPopupSample?.installed) return window.__codexSgsHoverPopupSample.status();
    const state = {
      installed: true,
      installedAt: now(),
      records: [],
      wrappers: [],
      listeners: [],
      errors: [],
      hookSummary: [],
      lastMouseRecord: 0
    };
    const record = (kind, label, args = [], extra = {}) => {
      try {
        state.records.push({
          seq: state.records.length,
          time: now(),
          kind,
          label,
          scene: sceneState(),
          mouse: { x: Laya.stage?.mouseX, y: Laya.stage?.mouseY },
          windows: visibleWindowSnapshot().slice(0, 12),
          args: Array.from(args || []).slice(0, 4).map((arg) => safeValue(arg)),
          ...extra
        });
        if (state.records.length > maxRecords) state.records.splice(0, state.records.length - maxRecords);
      } catch (error) {
        state.errors.push({ time: now(), at: "record:" + label, error: String(error?.message || error) });
      }
    };
    const wrap = (owner, prop, label) => {
      try {
        if (!owner || typeof owner[prop] !== "function") return false;
        const original = owner[prop];
        if (original.__codexSgsHoverPopupWrapped) return false;
        const wrapped = function (...args) {
          record("method", label, args, {
            thisNode: nodeSummary(this, "this"),
            currentOverCardUI: safeValue(this?.currentOverCardUI),
            overCard: safeValue(this?.overCard || this?.overCardUI)
          });
          return original.apply(this, args);
        };
        Object.defineProperty(wrapped, "__codexSgsHoverPopupWrapped", { value: true });
        Object.defineProperty(owner, prop, { value: wrapped, configurable: true });
        state.wrappers.push({ owner, prop, original, label });
        return true;
      } catch (error) {
        state.errors.push({ time: now(), at: "wrap:" + label, error: String(error?.message || error) });
        return false;
      }
    };
    const classSpecs = {
      SkillSelectorWindow: ["layoutCardUis", "cardRollOver", "cardRollOut", "showOverCard", "ShowAiHelpCards"],
      SkillPopUpWindow: ["constructor", "initBg", "layoutTxt"],
      SelectCardWindow: ["enterWindow", "addSelectCardNormalUi", "onTouchCard", "onTouchEnsure", "autoSelect"],
      CardPopWindow: ["enterWindow", "Close"],
      GetCardPop: ["Show", "Close"],
      GamePopUpWindow: ["enterWindow", "Close"],
      GameFlowerTips: ["show", "hide", "Close"],
      GameFlowerTipsWindow: ["enterWindow", "Close"],
      RogueFightWindow: ["showTipHandler", "showGeneralTipHandler", "createSkillBtn", "startbtnClick"],
      ChangeSKillWindow: ["showTipHandler", "showSkillPanel", "onSelect", "onChange", "forgetChange"],
      Rogue1v1ChangeSkillWindow: ["showTipHandler", "showSkillPanel", "onSelect", "onChange", "forgetChange"]
    };
    const CU = Laya.ClassUtils;
    for (const [className, methods] of Object.entries(classSpecs)) {
      let cls = null;
      try { cls = CU?.getClass?.(className) || CU?._classMap?.[className] || null; } catch {}
      const installed = [];
      const missing = [];
      for (const method of methods) {
        if (wrap(cls?.prototype, method, `${className}.${method}`)) installed.push(method);
        else missing.push(method);
      }
      state.hookSummary.push({ className, classExists: !!cls, functionName: cls?.name || "", installed, missing });
    }
    const eventProto = Laya.EventDispatcher?.prototype;
    if (eventProto && typeof eventProto.event === "function" && !eventProto.event.__codexSgsHoverPopupWrapped) {
      const original = eventProto.event;
      const wrapped = function (...args) {
        const eventName = args[0];
        if (/mouse|roll|over|out|tip|Tips/i.test(String(eventName))) {
          const label = labelOf(this);
          if (/Skill|Card|Window|Tip|Popup|PopUp|Select/i.test(label)) {
            record("laya-event", `EventDispatcher.event:${eventName}`, args.slice(1), { targetNode: nodeSummary(this, "eventTarget") });
          }
        }
        return original.apply(this, args);
      };
      Object.defineProperty(wrapped, "__codexSgsHoverPopupWrapped", { value: true });
      Object.defineProperty(eventProto, "event", { value: wrapped, configurable: true });
      state.wrappers.push({ owner: eventProto, prop: "event", original, label: "Laya.EventDispatcher.event" });
    }
    const mouseMove = function () {
      const time = Date.now();
      if (time - state.lastMouseRecord < mouseIntervalMs) return;
      state.lastMouseRecord = time;
      const x = Laya.stage?.mouseX || 0;
      const y = Laya.stage?.mouseY || 0;
      const hitChain = hitChainAt(x, y);
      const interesting = hitChain.some((node) => {
        const hay = [node.path, node.label, node.text, Object.keys(node.fields || {}).join(" ")].join(" ");
        return /Skill|Card|Window|Tip|Popup|PopUp|Select|Button|Btn|Desc|Text/i.test(hay);
      });
      if (recordAllMouse || interesting) record("mouse", "Laya.stage.MOUSE_MOVE", [], { hitChain: hitChain.slice(-16), interesting });
    };
    try {
      Laya.stage.on(Laya.Event.MOUSE_MOVE, state, mouseMove);
      state.listeners.push({ target: Laya.stage, name: Laya.Event.MOUSE_MOVE, fn: mouseMove });
    } catch (error) {
      state.errors.push({ time: now(), at: "listen:stage.MOUSE_MOVE", error: String(error?.message || error) });
    }
    const monitor = {
      installed: true,
      status() {
        const methodRecords = state.records.filter((record) => record.kind === "method");
        const mouseRecords = state.records.filter((record) => record.kind === "mouse");
        const eventRecords = state.records.filter((record) => record.kind === "laya-event");
        return {
          installed: true,
          installedAt: state.installedAt,
          scene: sceneState(),
          hookSummary: state.hookSummary,
          wrapperCount: state.wrappers.length,
          listenerCount: state.listeners.length,
          recordCount: state.records.length,
          methodRecords: methodRecords.length,
          mouseRecords: mouseRecords.length,
          eventRecords: eventRecords.length,
          currentWindows: visibleWindowSnapshot().slice(0, 24),
          errors: state.errors.slice(-20)
        };
      },
      dump() {
        return { ok: true, status: this.status(), records: state.records.slice(), errors: state.errors.slice() };
      },
      stop() {
        for (const item of state.listeners.splice(0)) {
          try { item.target.off(item.name, state, item.fn); } catch (error) { state.errors.push({ time: now(), at: "off:" + item.name, error: String(error?.message || error) }); }
        }
        for (const item of state.wrappers.splice(0)) {
          try { Object.defineProperty(item.owner, item.prop, { value: item.original, configurable: true }); } catch (error) { state.errors.push({ time: now(), at: "restore:" + item.label, error: String(error?.message || error) }); }
        }
        this.installed = false;
        state.installed = false;
        return this.dump();
      }
    };
    window.__codexSgsHoverPopupSample = monitor;
    record("monitor", "hover-popup.install", [monitor.status()]);
    return monitor.status();
}

export function installExpression(options) {
  return `(${browserHoverPopupInstaller.toString()})(${JSON.stringify(options)})`;
}

export function dumpExpression() {
  return "(() => window.__codexSgsHoverPopupSample ? window.__codexSgsHoverPopupSample.dump() : { ok: false, error: 'hover popup sample is not installed' })()";
}

export function stopExpression() {
  return "(() => window.__codexSgsHoverPopupSample ? window.__codexSgsHoverPopupSample.stop() : { ok: false, error: 'hover popup sample is not installed' })()";
}

function readmeText(payload, durationMs) {
  const status = payload.dump?.value?.status || {};
  const hooks = status.hookSummary || [];
  const installedClasses = hooks.filter((item) => item.installed?.length).map((item) => `${item.className}(${item.installed.join(",")})`);
  return [
    "# Runtime Hover / Popup Sample",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Duration ms: ${durationMs}`,
    `- Scene: ${status.scene?.sceneName || ""}`,
    `- Wrappers: ${status.wrapperCount || 0}`,
    `- Listeners: ${status.listenerCount || 0}`,
    `- Records: ${status.recordCount || 0}`,
    `- Method records: ${status.methodRecords || 0}`,
    `- Mouse records: ${status.mouseRecords || 0}`,
    `- Laya event records: ${status.eventRecords || 0}`,
    `- Installed classes: ${installedClasses.join("; ") || "(none)"}`,
    "",
    "This sample is passive. It records hover/popup methods, Laya mouse/roll events, current visible window nodes, and mouse hit chains without clicking, confirming, discarding, using skills, or buying anything.",
    "",
    "A live proof requires at least one method, mouse, or Laya event record tied to a visible popup/card/skill node. If only the install record exists, the hook method is prepared but a live hover action has not been observed yet.",
    ""
  ].join("\n");
}

async function main() {
  const durationMs = Number(process.env.SGS_HOVER_POPUP_MS || process.argv[2] || 12000);
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const options = {
    maxRecords: Number(process.env.SGS_HOVER_POPUP_MAX_RECORDS || 3000),
    mouseIntervalMs: Number(process.env.SGS_HOVER_POPUP_MOUSE_INTERVAL_MS || 180)
  };
  const install = await evaluateOnSgs(installExpression(options), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  await sleep(durationMs);
  const dump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  const stop = process.env.SGS_HOVER_POPUP_KEEP_INSTALLED === "1"
    ? { value: { skipped: true } }
    : await evaluateOnSgs(stopExpression(), { timeoutMs: 45000, cdpTimeoutMs: 60000 });
  const payload = { target: install.target, durationMs, install, dump, stop };
  await writeJson(path.join(dir, "hover-popup-sample.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(payload, durationMs), "utf8");
  console.log(JSON.stringify({
    dir,
    durationMs,
    scene: dump.value?.status?.scene || null,
    wrappers: dump.value?.status?.wrapperCount || 0,
    listeners: dump.value?.status?.listenerCount || 0,
    records: dump.value?.records?.length || 0,
    methodRecords: dump.value?.status?.methodRecords || 0,
    mouseRecords: dump.value?.status?.mouseRecords || 0,
    eventRecords: dump.value?.status?.eventRecords || 0,
    errors: dump.value?.errors?.length || 0
  }, null, 2));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
