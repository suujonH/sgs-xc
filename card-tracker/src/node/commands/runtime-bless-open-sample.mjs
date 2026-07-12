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
    process.env.SGS_BLESS_OPEN_SAMPLE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-bless-open-sample`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function browserInstallGuard(options) {
  const now = () => new Date().toISOString();
  const own = (o) => {
    try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; }
  };
  const ctor = (o) => {
    try { return o?.constructor?.name || ""; } catch { return ""; }
  };
  const toArray = (v) => Array.isArray(v) ? v : v ? [v] : [];
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
  const isVisible = (node) => !!node && hiddenReasons(node).length === 0;
  const simple = (value, depth = 0) => {
    const type = typeof value;
    if (value == null || type === "string" || type === "number" || type === "boolean") return value;
    if (type === "function") return { kind: "function", name: value.name || "", arity: value.length };
    if (Array.isArray(value)) return { kind: "array", length: value.length, sample: depth ? [] : value.slice(0, 8).map((item) => simple(item, depth + 1)) };
    const keys = own(value).filter((key) => !/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)).slice(0, 28);
    const out = {
      kind: "object",
      ctor: ctor(value),
      name: value.name || "",
      className: value._className_ || "",
      sceneName: value.sceneName || value.SceneName || "",
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
  const getRefs = () => {
    const CU = window.Laya?.ClassUtils;
    const popup = CU?.getInstance?.("PopUpWindow") || null;
    const ged = popup?.ged || null;
    const windowManager = toArray(ged?._events?.HIDE_WINDOW).map((handler) => handler?.caller).find((candidate) => candidate?.proxy) || null;
    return { CU, popup, ged, windowManager, proxy: windowManager?.proxy || null };
  };
  const getScene = () => {
    const children = [];
    for (let i = 0; i < (Laya.stage?.numChildren || 0); i++) {
      try { children.push(Laya.stage.getChildAt(i)); } catch {}
    }
    const sceneLayer = children.find((node) => /LBi|SceneLayer/.test([node?.name, ctor(node)].join(" ")));
    let scene = null;
    if (sceneLayer) {
      for (let i = (sceneLayer.numChildren || 0) - 1; i >= 0; i--) {
        const candidate = sceneLayer.getChildAt(i);
        if (isVisible(candidate)) {
          scene = candidate;
          break;
        }
      }
    }
    return scene;
  };
  const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, seen = new Set()) => {
    if (!root || depth > 14 || seen.has(root)) return;
    seen.add(root);
    visitor(root, nodePath, depth);
    for (let i = 0; i < (root.numChildren || 0); i++) {
      let child = null;
      try { child = root.getChildAt(i); } catch {}
      const childLabel = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
      walk(child, visitor, nodePath + "/" + childLabel + "#" + i, depth + 1, seen);
    }
  };
  const safeFields = (node) => {
    const out = {};
    const pattern = /(selectId|mode|needCtn|lastIsOneGet|effect|Effect|addEffectSp|loading|inited|visible|name|resName|btn|Btn|button|Button|shop|Shop|checkBox|skip|Skip|time|Time|data|Data|state|State|status|Status|count|Count|id|ID)/;
    for (const key of own(node).slice(0, 900)) {
      if (!pattern.test(key)) continue;
      try { out[key] = simple(node[key]); } catch { out[key] = "[throws]"; }
      if (Object.keys(out).length >= 80) break;
    }
    return out;
  };
  const methodNames = (node) => {
    const names = [];
    const seen = new Set();
    let proto = Object.getPrototypeOf(node || {});
    while (proto && proto !== Object.prototype) {
      for (const key of own(proto)) {
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          if (typeof node[key] === "function" && /(Show|Close|Init|Update|effect|Effect|bless|Bless|shop|Shop|Buy|buy|click|Click|skip|Skip|Time|enter|Enter)/.test(key)) names.push(key);
        } catch {}
      }
      proto = Object.getPrototypeOf(proto);
    }
    return names.sort().slice(0, 120);
  };
  const eventSummary = (node) => {
    const events = node?._events;
    const out = {};
    if (!events || typeof events !== "object") return out;
    for (const key of own(events).slice(0, 40)) {
      try {
        out[key] = toArray(events[key]).filter(Boolean).map((handler) => ({
          caller: labelOf(handler.caller),
          callerCtor: ctor(handler.caller),
          method: handler.method?.name || "",
          once: handler.once,
          args: Array.isArray(handler.args) ? handler.args.map((arg) => simple(arg)).slice(0, 6) : simple(handler.args)
        })).slice(0, 12);
      } catch {
        out[key] = "[throws]";
      }
    }
    return out;
  };
  const nodeSummary = (node, nodePath) => ({
    path: nodePath,
    label: labelOf(node),
    ctor: ctor(node),
    name: node?.name || "",
    className: node?._className_ || "",
    sceneName: node?.sceneName || node?.SceneName || "",
    visible: node?.visible,
    alpha: node?.alpha,
    effectiveVisible: isVisible(node),
    hiddenReasons: hiddenReasons(node),
    x: node?.x,
    y: node?.y,
    width: node?.width,
    height: node?.height,
    childCount: node?.numChildren || 0,
    fields: safeFields(node),
    methods: methodNames(node),
    events: eventSummary(node)
  });
  const visibleBlessWindows = () => {
    const out = [];
    walk(Laya.stage, (node, nodePath) => {
      const label = labelOf(node);
      if (/BlessNewWindowView|BlessNewWindow/.test(label) && isVisible(node)) out.push(nodeSummary(node, nodePath));
    });
    return out;
  };
  const sceneState = () => {
    const scene = getScene();
    return {
      sceneName: scene?.sceneName || scene?.SceneName || scene?.name || "",
      className: scene?._className_ || "",
      ctor: ctor(scene)
    };
  };
  if (window.__codexSgsBlessOpenSample?.installed) return window.__codexSgsBlessOpenSample.status();
  const state = {
    installed: true,
    installedAt: now(),
    records: [],
    wrappers: [],
    errors: [],
    blockedCalls: 0,
    blockedEffects: 0
  };
  const record = (kind, label, args, extra = {}) => {
    try {
      state.records.push({
        seq: state.records.length,
        time: now(),
        kind,
        label,
        scene: sceneState(),
        args: Array.from(args || []).slice(0, 8).map((arg) => simple(arg)),
        blessWindows: visibleBlessWindows(),
        ...extra
      });
      if (state.records.length > options.maxRecords) state.records.splice(0, state.records.length - options.maxRecords);
    } catch (error) {
      state.errors.push({ time: now(), at: "record:" + label, error: String(error?.message || error) });
    }
  };
  const wrap = (owner, prop, label, mode = "record") => {
    try {
      if (!owner || typeof owner[prop] !== "function") return false;
      const original = owner[prop];
      if (original.__codexSgsBlessOpenWrapped) return false;
      const wrapped = function (...args) {
        record(mode === "block-effect" ? "blocked-effect" : mode === "block" ? "blocked-call" : "call", label, args, { thisNode: simple(this) });
        if (mode === "block") {
          state.blockedCalls++;
          return undefined;
        }
        if (mode === "block-effect") {
          state.blockedEffects++;
          try { if (typeof this.effectStop === "function") this.effectStop(); } catch {}
          return undefined;
        }
        return original.apply(this, args);
      };
      Object.defineProperty(wrapped, "__codexSgsBlessOpenWrapped", { value: true });
      Object.defineProperty(owner, prop, { value: wrapped, configurable: true });
      state.wrappers.push({ owner, prop, original, label });
      return true;
    } catch (error) {
      state.errors.push({ time: now(), at: "wrap:" + label, error: String(error?.message || error) });
      return false;
    }
  };
  const refs = getRefs();
  const classNames = ["BlessNewWindowView", "BlessNewWindow"];
  const hookSummary = [];
  for (const className of classNames) {
    const cls = refs.CU?.getClass?.(className) || refs.CU?._classMap?.[className] || null;
    const installed = [];
    const missing = [];
    for (const method of ["Show", "enterWindow", "Init", "InitData", "UpdateAllUI", "UpdateButtonUI", "UpdateUpperCanvas", "updateSkipAnim", "Close", "addEffect", "effectStop", "blessBtnClick", "confirmBuy", "shopBtnClick"]) {
      const mode = /(blessBtnClick|confirmBuy|shopBtnClick)/.test(method)
        ? "block"
        : options.blockEffect && method === "addEffect"
          ? "block-effect"
          : "record";
      if (wrap(cls?.prototype, method, className + "." + method, mode)) installed.push({ method, mode });
      else missing.push(method);
    }
    hookSummary.push({ className, classExists: !!cls, functionName: cls?.name || "", installed, missing });
  }
  for (const [owner, prop, label] of [
    [refs.ged, "event", "GED.event"],
    [refs.ged, "i", "GED.i"],
    [refs.ged, "CloseWindow", "GED.CloseWindow"],
    [refs.windowManager, "showWindowHandler", "WindowManager.showWindowHandler"],
    [refs.windowManager, "GetWindow", "WindowManager.GetWindow"],
    [refs.windowManager, "CloseWindow", "WindowManager.CloseWindow"]
  ]) {
    wrap(owner, prop, label, "record");
  }
  const monitor = {
    installed: true,
    status() {
      return {
        installed: true,
        installedAt: state.installedAt,
        scene: sceneState(),
        visibleBlessWindows: visibleBlessWindows(),
        wrapperCount: state.wrappers.length,
        recordCount: state.records.length,
        blockedCalls: state.blockedCalls,
        blockedEffects: state.blockedEffects,
        hookSummary,
        errors: state.errors.slice(-20)
      };
    },
    dump() {
      return { ok: true, status: this.status(), records: state.records.slice(), errors: state.errors.slice() };
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
  window.__codexSgsBlessOpenSample = monitor;
  record("monitor", "bless-open.install", [monitor.status()]);
  return monitor.status();
}

function browserOpenBlessWindow(windowName) {
  const ctor = (o) => {
    try { return o?.constructor?.name || ""; } catch { return ""; }
  };
  const toArray = (v) => Array.isArray(v) ? v : v ? [v] : [];
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
  const isVisible = (node) => !!node && hiddenReasons(node).length === 0;
  const walk = (root, visitor, nodePath = "Laya.stage", depth = 0, seen = new Set()) => {
    if (!root || depth > 14 || seen.has(root)) return;
    seen.add(root);
    visitor(root, nodePath, depth);
    for (let i = 0; i < (root.numChildren || 0); i++) {
      let child = null;
      try { child = root.getChildAt(i); } catch {}
      const childLabel = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
      walk(child, visitor, nodePath + "/" + childLabel + "#" + i, depth + 1, seen);
    }
  };
  const visibleBlessWindows = () => {
    const out = [];
    walk(Laya.stage, (node, path) => {
      if (/BlessNewWindowView|BlessNewWindow/.test(labelOf(node)) && isVisible(node)) {
        out.push({ path, label: labelOf(node), ctor: ctor(node), name: node.name || "", visible: node.visible, childCount: node.numChildren || 0 });
      }
    });
    return out;
  };
  const before = visibleBlessWindows();
  if (before.length) return { ok: false, action: "open-bless", reason: "Bless window already visible; not opening another one", before, openedBySample: false };
  const CU = Laya.ClassUtils;
  const popup = CU.getInstance("PopUpWindow");
  const ged = popup?.ged;
  if (!ged || typeof ged.i !== "function") return { ok: false, action: "open-bless", reason: "GED.i not found", before, openedBySample: false };
  ged.i(windowName);
  return { ok: true, action: "open-bless", called: "GED.i", windowName, before, openedBySample: true };
}

function browserCloseOpenedBlessWindow() {
  const ctor = (o) => {
    try { return o?.constructor?.name || ""; } catch { return ""; }
  };
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
  const isVisible = (node) => !!node && hiddenReasons(node).length === 0;
  const targets = [];
  const walk = (root, nodePath = "Laya.stage", depth = 0, seen = new Set()) => {
    if (!root || depth > 14 || seen.has(root)) return;
    seen.add(root);
    if (/BlessNewWindowView|BlessNewWindow/.test(labelOf(root)) && isVisible(root) && typeof root.Close === "function") {
      targets.push({ node: root, path: nodePath, label: labelOf(root), ctor: ctor(root), name: root.name || "" });
    }
    for (let i = 0; i < (root.numChildren || 0); i++) {
      let child = null;
      try { child = root.getChildAt(i); } catch {}
      const childLabel = child && (child.name || child._className_ || child.sceneName || child.SceneName || ctor(child)) || ("#" + i);
      walk(child, nodePath + "/" + childLabel + "#" + i, depth + 1, seen);
    }
  };
  walk(Laya.stage);
  if (!targets.length) return { ok: false, action: "close-opened-bless", reason: "No visible Bless window found" };
  const target = targets[0];
  const before = { path: target.path, label: target.label, ctor: target.ctor, name: target.name, parentCtor: ctor(target.node.parent), parentChildren: target.node.parent?.numChildren || 0 };
  target.node.Close();
  return {
    ok: true,
    action: "close-opened-bless",
    called: "BlessWindow.Close()",
    before,
    afterImmediate: {
      destroyed: !!target.node.destroyed,
      visible: target.node.visible,
      parentCtor: ctor(target.node.parent),
      parentChildren: target.node.parent?.numChildren || 0
    }
  };
}

function expressionFor(fn, ...args) {
  return `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(",")})`;
}

function installExpression(options) {
  return expressionFor(browserInstallGuard, options);
}

function openExpression(windowName) {
  return expressionFor(browserOpenBlessWindow, windowName);
}

function closeExpression() {
  return expressionFor(browserCloseOpenedBlessWindow);
}

function dumpExpression() {
  return "(() => window.__codexSgsBlessOpenSample ? window.__codexSgsBlessOpenSample.dump() : { ok: false, error: 'bless-open sample is not installed' })()";
}

function stopExpression() {
  return "(() => window.__codexSgsBlessOpenSample ? window.__codexSgsBlessOpenSample.stop() : { ok: false, error: 'bless-open sample is not installed' })()";
}

function readmeText(payload) {
  const status = payload.dump?.value?.status || {};
  const records = payload.dump?.value?.records || [];
  return [
    "# Runtime Bless Open Sample",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Window name: ${payload.windowName}`,
    `- Open ok: ${!!payload.open?.value?.ok}`,
    `- Close ok: ${!!payload.close?.value?.ok}`,
    `- Final scene: ${status.scene?.sceneName || status.scene?.className || ""}`,
    `- Wrappers: ${status.wrapperCount || 0}`,
    `- Records: ${status.recordCount || 0}`,
    `- Blocked purchase/draw calls: ${status.blockedCalls || 0}`,
    `- Blocked addEffect calls: ${status.blockedEffects || 0}`,
    `- Visible Bless windows after close: ${(status.visibleBlessWindows || []).length}`,
    "",
    "This sample opens the Bless/QiFu window through the game's normal window event, records lifecycle/effect methods, blocks draw/purchase/shop button paths, and then closes only the opened Bless window.",
    "",
    "## Records",
    "",
    ...records.slice(0, 120).map((record) => `- #${record.seq} ${record.kind} ${record.label} scene=${record.scene?.sceneName || ""} windows=${record.blessWindows?.length || 0}`),
    ""
  ].join("\n");
}

async function main() {
  const windowName = process.env.SGS_BLESS_OPEN_WINDOW || process.argv[2] || "BlessNewWindowView";
  const waitMs = Number(process.env.SGS_BLESS_OPEN_WAIT_MS || 2600);
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const install = await evaluateOnSgs(installExpression({
    maxRecords: Number(process.env.SGS_BLESS_OPEN_MAX_RECORDS || 8000),
    blockEffect: process.env.SGS_BLESS_OPEN_BLOCK_EFFECT !== "0"
  }), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const open = await evaluateOnSgs(openExpression(windowName), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  await sleep(waitMs);
  const afterOpenDump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const close = open.value?.openedBySample
    ? await evaluateOnSgs(closeExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 })
    : { value: { skipped: true, reason: "Window was not opened by this sample" } };
  await sleep(Number(process.env.SGS_BLESS_CLOSE_WAIT_MS || 1200));
  const dump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const stop = await evaluateOnSgs(stopExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const payload = { target: install.target, windowName, waitMs, install, open, afterOpenDump, close, dump, stop };
  await writeJson(path.join(dir, "bless-open-sample.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
  console.log(JSON.stringify({
    ok: true,
    dir,
    windowName,
    open: open.value,
    close: close.value,
    scene: dump.value?.status?.scene || null,
    wrappers: dump.value?.status?.wrapperCount || 0,
    records: dump.value?.records?.length || 0,
    blockedCalls: dump.value?.status?.blockedCalls || 0,
    blockedEffects: dump.value?.status?.blockedEffects || 0,
    visibleBlessWindows: dump.value?.status?.visibleBlessWindows?.length || 0,
    errors: dump.value?.errors?.length || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
