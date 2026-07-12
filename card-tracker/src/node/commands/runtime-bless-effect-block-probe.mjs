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
    process.env.SGS_BLESS_EFFECT_BLOCK_PROBE_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-bless-effect-block-probe`)
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function expressionFor(fn, ...args) {
  return `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(",")})`;
}

function browserInstallProbe(options) {
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
    const keys = own(value).filter((key) => !/handCards|HandCards|watchCards|WatchCards|cardsInHand|hidden/i.test(key)).slice(0, 18);
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
      for (const key of keys.slice(0, 8)) {
        try { out.values[key] = simple(value[key], depth + 1); } catch { out.values[key] = "[throws]"; }
      }
    }
    return out;
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
  const visibleBlessWindows = () => {
    const out = [];
    walk(Laya.stage, (node, nodePath) => {
      if (/BlessNewWindowView|BlessNewWindow/.test(labelOf(node)) && isVisible(node)) {
        out.push({
          path: nodePath,
          label: labelOf(node),
          ctor: ctor(node),
          name: node.name || "",
          className: node._className_ || "",
          visible: node.visible,
          effectiveVisible: true,
          childCount: node.numChildren || 0,
          addEffectWrapped: node.addEffect?.__codexSgsBlessEffectBlockWrapped === true,
          closeAvailable: typeof node.Close === "function"
        });
      }
    });
    return out;
  };
  const sceneState = () => {
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
    return {
      sceneName: scene?.sceneName || scene?.SceneName || scene?.name || "",
      className: scene?._className_ || "",
      ctor: ctor(scene)
    };
  };
  const getRefs = () => {
    const CU = window.Laya?.ClassUtils;
    const popup = CU?.getInstance?.("PopUpWindow") || null;
    const ged = popup?.ged || null;
    return { CU, popup, ged };
  };
  if (window.__codexSgsBlessEffectBlockProbe?.installed) return window.__codexSgsBlessEffectBlockProbe.status();
  const state = {
    installed: true,
    installedAt: now(),
    records: [],
    wrappers: [],
    blessInstances: [],
    errors: [],
    blockedCalls: 0,
    blockedEffects: 0,
    directEffectAttempts: 0,
    directEffectBlocked: 0
  };
  const rememberBlessInstance = (node, reason) => {
    if (!node || !/BlessNewWindowView|BlessNewWindow/.test(labelOf(node))) return;
    if (!state.blessInstances.some((item) => item.node === node)) {
      state.blessInstances.push({ node, reason, firstSeenAt: now() });
      if (state.blessInstances.length > 20) state.blessInstances.shift();
    }
  };
  const knownBlessInstances = () => state.blessInstances.map((item) => ({
    reason: item.reason,
    firstSeenAt: item.firstSeenAt,
    label: labelOf(item.node),
    ctor: ctor(item.node),
    name: item.node?.name || "",
    className: item.node?._className_ || "",
    visible: item.node?.visible,
    effectiveVisible: isVisible(item.node),
    parentLabel: labelOf(item.node?.parent),
    destroyed: !!item.node?.destroyed,
    addEffectWrapped: item.node?.addEffect?.__codexSgsBlessEffectBlockWrapped === true,
    closeAvailable: typeof item.node?.Close === "function"
  }));
  const record = (kind, label, args, extra = {}) => {
    try {
      state.records.push({
        seq: state.records.length,
        time: now(),
        kind,
        label,
        scene: sceneState(),
        args: Array.from(args || []).slice(0, 8).map((arg) => simple(arg)),
        visibleBlessWindows: visibleBlessWindows(),
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
      if (original.__codexSgsBlessEffectBlockWrapped) return false;
      const wrapped = function (...args) {
        rememberBlessInstance(this, label);
        record(mode === "block-effect" ? "blocked-effect" : mode === "block" ? "blocked-call" : "call", label, args, {
          thisNode: {
            label: labelOf(this),
            ctor: ctor(this),
            name: this?.name || "",
            className: this?._className_ || "",
            visible: this?.visible,
            effectiveVisible: isVisible(this)
          }
        });
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
      Object.defineProperty(wrapped, "__codexSgsBlessEffectBlockWrapped", { value: true });
      Object.defineProperty(owner, prop, { value: wrapped, configurable: true });
      state.wrappers.push({ owner, prop, original, label });
      return true;
    } catch (error) {
      state.errors.push({ time: now(), at: "wrap:" + label, error: String(error?.message || error) });
      return false;
    }
  };
  const refs = getRefs();
  const hookSummary = [];
  for (const className of ["BlessNewWindowView", "BlessNewWindow"]) {
    const cls = refs.CU?.getClass?.(className) || refs.CU?._classMap?.[className] || null;
    const installed = [];
    const missing = [];
    for (const method of ["Show", "enterWindow", "Init", "InitData", "UpdateAllUI", "UpdateButtonUI", "UpdateUpperCanvas", "updateSkipAnim", "Close", "addEffect", "effectStop", "blessBtnClick", "confirmBuy", "shopBtnClick"]) {
      const mode = /(blessBtnClick|confirmBuy|shopBtnClick)/.test(method)
        ? "block"
        : method === "addEffect"
          ? "block-effect"
          : "record";
      if (wrap(cls?.prototype, method, className + "." + method, mode)) installed.push({ method, mode });
      else missing.push(method);
    }
    hookSummary.push({ className, classExists: !!cls, functionName: cls?.name || "", installed, missing });
  }
  for (const [owner, prop, label] of [
    [refs.ged, "i", "GED.i"],
    [refs.ged, "CloseWindow", "GED.CloseWindow"]
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
        knownBlessInstances: knownBlessInstances(),
        wrapperCount: state.wrappers.length,
        recordCount: state.records.length,
        blockedCalls: state.blockedCalls,
        blockedEffects: state.blockedEffects,
        directEffectAttempts: state.directEffectAttempts,
        directEffectBlocked: state.directEffectBlocked,
        hookSummary,
        errors: state.errors.slice(-20)
      };
    },
    directEffectProbe(effectArg) {
      const targets = [];
      walk(Laya.stage, (node, nodePath) => {
        if (/BlessNewWindowView|BlessNewWindow/.test(labelOf(node)) && isVisible(node)) {
          targets.push({ node, nodePath, label: labelOf(node), ctor: ctor(node), name: node.name || "" });
        }
      });
      for (const item of state.blessInstances) {
        if (!item.node || targets.some((target) => target.node === item.node)) continue;
        targets.push({
          node: item.node,
          nodePath: `(known-instance:${item.reason})`,
          label: labelOf(item.node),
          ctor: ctor(item.node),
          name: item.node?.name || ""
        });
      }
      const target = targets.find((item) => item.node.addEffect?.__codexSgsBlessEffectBlockWrapped === true && !item.node.destroyed);
      const before = this.status();
      state.directEffectAttempts++;
      if (!target) {
        const result = { ok: false, reason: "No visible Bless window with wrapped addEffect", before };
        record("probe-skip", "Bless.addEffect.directProbe", [effectArg], result);
        return result;
      }
      try {
        target.node.addEffect(effectArg);
        const after = this.status();
        const blockedDelta = after.blockedEffects - before.blockedEffects;
        if (blockedDelta > 0) state.directEffectBlocked += blockedDelta;
        return {
          ok: blockedDelta > 0,
          called: "wrapped addEffect",
          target: { path: target.nodePath, label: target.label, ctor: target.ctor, name: target.name },
          effectArg,
          beforeBlockedEffects: before.blockedEffects,
          afterBlockedEffects: after.blockedEffects,
          blockedDelta,
          afterVisibleBlessWindows: after.visibleBlessWindows
        };
      } catch (error) {
        const result = {
          ok: false,
          reason: "direct wrapped addEffect threw",
          target: { path: target.nodePath, label: target.label, ctor: target.ctor, name: target.name },
          error: String(error?.stack || error?.message || error)
        };
        state.errors.push({ time: now(), at: "directEffectProbe", error: result.error });
        return result;
      }
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
  window.__codexSgsBlessEffectBlockProbe = monitor;
  record("monitor", "bless-effect-block.install", [monitor.status()]);
  return monitor.status();
}

function browserOpenBlessWindow(windowName) {
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
    walk(Laya.stage, (node, nodePath) => {
      if (/BlessNewWindowView|BlessNewWindow/.test(labelOf(node)) && isVisible(node)) {
        out.push({ path: nodePath, label: labelOf(node), ctor: ctor(node), name: node.name || "" });
      }
    });
    return out;
  };
  const before = visibleBlessWindows();
  if (before.length) return { ok: false, action: "open-bless", reason: "Bless window already visible; not touching user-opened window", before, openedBySample: false };
  const CU = Laya.ClassUtils;
  const popup = CU.getInstance("PopUpWindow");
  const ged = popup?.ged;
  if (!ged || typeof ged.i !== "function") return { ok: false, action: "open-bless", reason: "GED.i not found", before, openedBySample: false };
  ged.i(windowName);
  return { ok: true, action: "open-bless", called: "GED.i", windowName, before, openedBySample: true };
}

function browserDirectEffectProbe(effectArg, requireOpenedBySample) {
  const monitor = window.__codexSgsBlessEffectBlockProbe;
  if (!monitor) return { ok: false, reason: "probe monitor is not installed" };
  if (requireOpenedBySample && !window.__codexSgsBlessEffectBlockProbeOpenedBySample) {
    return { ok: false, skipped: true, reason: "Bless window was not opened by this probe" };
  }
  return monitor.directEffectProbe(effectArg);
}

function browserMarkOpenedBySample(opened) {
  window.__codexSgsBlessEffectBlockProbeOpenedBySample = !!opened;
  return { ok: true, openedBySample: !!opened };
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
  const before = { path: target.path, label: target.label, ctor: target.ctor, name: target.name };
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

function dumpExpression() {
  return "(() => window.__codexSgsBlessEffectBlockProbe ? window.__codexSgsBlessEffectBlockProbe.dump() : { ok: false, error: 'bless-effect-block probe is not installed' })()";
}

function stopExpression() {
  return "(() => window.__codexSgsBlessEffectBlockProbe ? window.__codexSgsBlessEffectBlockProbe.stop() : { ok: false, error: 'bless-effect-block probe is not installed' })()";
}

function readmeText(payload) {
  const status = payload.dump?.value?.status || {};
  const records = payload.dump?.value?.records || [];
  const directOk = !!payload.directEffect?.value?.ok;
  return [
    "# Runtime Bless Effect Block Probe",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Window name: ${payload.windowName}`,
    `- Opened by probe: ${!!payload.open?.value?.openedBySample}`,
    `- Direct addEffect probe ok: ${!!payload.directEffect?.value?.ok}`,
    `- Blocked addEffect calls: ${status.blockedEffects || 0}`,
    `- Blocked purchase/draw calls: ${status.blockedCalls || 0}`,
    `- Visible Bless windows after close: ${(status.visibleBlessWindows || []).length}`,
    "",
    directOk
      ? "This probe proves the Bless/QiFu visual-effect entry can be blocked without calling draw/buy/shop paths. It opens the window through GED only when no Bless window is already visible, calls `addEffect` only after the method is wrapped, closes the window it opened, and restores all wrappers."
      : "This probe attempted to prove Bless/QiFu visual-effect blocking, but the direct wrapped `addEffect` call did not produce a blocked-effect record. Treat this sample as setup/open/close evidence only.",
    "",
    "## Records",
    "",
    ...records.slice(0, 140).map((record) => `- #${record.seq} ${record.kind} ${record.label} scene=${record.scene?.sceneName || ""} windows=${record.visibleBlessWindows?.length || 0}`),
    ""
  ].join("\n");
}

async function main() {
  const windowName = process.env.SGS_BLESS_EFFECT_WINDOW || process.argv[2] || "BlessNewWindowView";
  const effectArg = process.env.SGS_BLESS_EFFECT_ARG ? JSON.parse(process.env.SGS_BLESS_EFFECT_ARG) : 1;
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const install = await evaluateOnSgs(expressionFor(browserInstallProbe, {
    maxRecords: Number(process.env.SGS_BLESS_EFFECT_MAX_RECORDS || 8000)
  }), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const open = await evaluateOnSgs(expressionFor(browserOpenBlessWindow, windowName), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  await evaluateOnSgs(expressionFor(browserMarkOpenedBySample, !!open.value?.openedBySample), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  await sleep(Number(process.env.SGS_BLESS_EFFECT_OPEN_WAIT_MS || 1600));
  const afterOpenDump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const directEffect = await evaluateOnSgs(expressionFor(browserDirectEffectProbe, effectArg, true), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  await sleep(Number(process.env.SGS_BLESS_EFFECT_AFTER_WAIT_MS || 300));
  const close = open.value?.openedBySample
    ? await evaluateOnSgs(expressionFor(browserCloseOpenedBlessWindow), { timeoutMs: 45000, cdpTimeoutMs: 70000 })
    : { value: { skipped: true, reason: "Window was not opened by this probe" } };
  await sleep(Number(process.env.SGS_BLESS_EFFECT_CLOSE_WAIT_MS || 900));
  const dump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const stop = await evaluateOnSgs(stopExpression(), { timeoutMs: 45000, cdpTimeoutMs: 70000 });
  const payload = { target: install.target, windowName, effectArg, install, open, afterOpenDump, directEffect, close, dump, stop };
  await writeJson(path.join(dir, "bless-effect-block-probe.json"), payload);
  await writeFile(path.join(dir, "README.md"), readmeText(payload), "utf8");
  console.log(JSON.stringify({
    ok: true,
    dir,
    windowName,
    openedByProbe: !!open.value?.openedBySample,
    directEffectOk: !!directEffect.value?.ok,
    blockedDelta: directEffect.value?.blockedDelta || 0,
    blockedEffects: dump.value?.status?.blockedEffects || 0,
    blockedCalls: dump.value?.status?.blockedCalls || 0,
    visibleBlessWindows: dump.value?.status?.visibleBlessWindows?.length || 0,
    errors: dump.value?.errors?.length || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
