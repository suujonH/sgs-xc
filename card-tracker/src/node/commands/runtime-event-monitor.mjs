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

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function outputDir() {
  return path.resolve(
    process.env.SGS_RUNTIME_EXPLORATION_DIR ||
      path.join(projectRoot, "work", "runtime-exploration", `${timestampName()}-event-monitor`)
  );
}

export function installExpression() {
  const maxRecords = Number(process.env.SGS_RUNTIME_EVENT_MAX_RECORDS || 10000);
  const listenProxy = process.env.SGS_RUNTIME_MONITOR_PROXY !== "0";
  return `(() => {
    const MAX_RECORDS = ${JSON.stringify(maxRecords)};
    const LISTEN_PROXY = ${JSON.stringify(listenProxy)};
    const own = (o) => { try { return Object.getOwnPropertyNames(o || {}).sort(); } catch { return []; } };
    const toArray = (v) => Array.isArray(v) ? v : v ? [v] : [];
    const ctor = (o) => { try { return o && o.constructor && o.constructor.name || ""; } catch { return ""; } };
    const now = () => new Date().toISOString();
    const simple = (v, depth = 0) => {
      const t = typeof v;
      if (v == null || t === "string" || t === "number" || t === "boolean") return v;
      if (t === "function") return { kind: "function", name: v.name || "", arity: v.length };
      if (Array.isArray(v)) return { kind: "array", length: v.length, sample: depth >= 2 ? [] : v.slice(0, 8).map((x) => simple(x, depth + 1)) };
      if (v instanceof Map) return { kind: "map", size: v.size, keys: Array.from(v.keys()).slice(0, 20).map((x) => String(x)) };
      const keys = own(v).slice(0, 35);
      const out = {
        kind: "object",
        ctor: ctor(v),
        name: v.name || "",
        sceneName: v.sceneName || "",
        SceneName: v.SceneName || "",
        className: v._className_ || "",
        resName: v._resName || "",
        uiid: v._uiid || "",
        keys
      };
      if (depth < 2) {
        out.values = {};
        for (const key of keys.slice(0, 12)) {
          if (/handCards|HandCards|cards|Cards/i.test(key)) continue;
          try { out.values[key] = simple(v[key], depth + 1); } catch (error) { out.values[key] = "[throws]"; }
        }
      }
      return out;
    };
    const locate = () => {
      const L = window.Laya;
      const CU = L && L.ClassUtils;
      let popup = null, ged = null, windowManager = null, proxy = null, sceneManager = null;
      try { popup = CU && CU.getInstance && CU.getInstance("PopUpWindow") || null; } catch {}
      try { ged = popup && popup.ged || null; } catch {}
      try { windowManager = toArray(ged && ged._events && ged._events.HIDE_WINDOW)[0]?.caller || null; } catch {}
      try { proxy = windowManager && windowManager.proxy || null; } catch {}
      try {
        sceneManager = toArray(ged && ged._events && ged._events.SWITCH_SCENE)
          .map((h) => h && h.caller)
          .find((candidate) => candidate && ("CurrentScene" in candidate || "IsGameScene" in candidate || typeof candidate.executeSwitchScene === "function")) || null;
      } catch {}
      if (!sceneManager) {
        try {
          sceneManager = windowManager && windowManager.constructor && windowManager.constructor.managerList &&
            windowManager.constructor.managerList.filter(Boolean).find((candidate) => candidate && ("CurrentScene" in candidate || "IsGameScene" in candidate || typeof candidate.executeSwitchScene === "function")) || null;
        } catch {}
      }
      return { L, CU, popup, ged, windowManager, proxy, sceneManager, currentScene: sceneManager && sceneManager.CurrentScene || null };
    };
    const sceneState = () => {
      const refs = locate();
      const scene = refs.currentScene;
      return {
        sceneName: scene && (scene.sceneName || scene.SceneName || scene.name || "") || "",
        className: scene && scene._className_ || "",
        ctor: ctor(scene),
        isGameScene: !!(refs.sceneManager && refs.sceneManager.IsGameScene),
        isTableScene: !!(refs.sceneManager && refs.sceneManager.IsTableScene)
      };
    };
    if (window.__codexSgsExploreMonitor && window.__codexSgsExploreMonitor.installed) {
      return window.__codexSgsExploreMonitor.status();
    }
    const state = {
      installedAt: now(),
      maxRecords: MAX_RECORDS,
      records: [],
      listeners: [],
      wrappers: [],
      errors: [],
      nextSeq: 0
    };
    const record = (kind, name, args) => {
      try {
        state.records.push({
          seq: state.nextSeq++,
          time: now(),
          kind,
          name,
          scene: sceneState(),
          args: Array.from(args || []).slice(0, 8).map((arg) => simple(arg))
        });
        if (state.records.length > state.maxRecords) state.records.splice(0, state.records.length - state.maxRecords);
      } catch (error) {
        state.errors.push({ time: now(), at: "record", error: String(error && error.message || error) });
      }
    };
    const listen = (target, eventNames, kind) => {
      if (!target || typeof target.on !== "function") return 0;
      let count = 0;
      for (const name of eventNames) {
        try {
          const fn = function (...args) { record(kind, name, args); };
          target.on(name, state, fn);
          state.listeners.push({ target, name, fn, kind });
          count++;
        } catch (error) {
          state.errors.push({ time: now(), at: "listen:" + kind + ":" + name, error: String(error && error.message || error) });
        }
      }
      return count;
    };
    const wrap = (obj, prop, label) => {
      try {
        if (!obj || typeof obj[prop] !== "function") return false;
        const original = obj[prop];
        if (original.__codexSgsExploreWrapped) return false;
        const wrapped = function (...args) {
          record("call", label || prop, args);
          return original.apply(this, args);
        };
        Object.defineProperty(wrapped, "__codexSgsExploreWrapped", { value: true });
        Object.defineProperty(obj, prop, { value: wrapped, configurable: true });
        state.wrappers.push({ obj, prop, original, label: label || prop });
        return true;
      } catch (error) {
        state.errors.push({ time: now(), at: "wrap:" + (label || prop), error: String(error && error.message || error) });
        return false;
      }
    };
    const refs = locate();
    const gedEventNames = refs.ged && refs.ged._events ? Object.keys(refs.ged._events).sort() : [];
    const proxyEventNames = refs.proxy && refs.proxy._events ? Object.keys(refs.proxy._events).sort() : [];
    const installed = {
      gedListeners: listen(refs.ged, gedEventNames, "ged"),
      proxyListeners: LISTEN_PROXY ? listen(refs.proxy, proxyEventNames, "proxy") : 0,
      wrappers: []
    };
    for (const [obj, prop, label] of [
      [refs.ged, "event", "ged.event"],
      [refs.proxy, "event", "proxy.event"],
      [refs.proxy, "L", "proxy.L"],
      [refs.sceneManager, "executeSwitchScene", "SceneManager.executeSwitchScene"],
      [refs.sceneManager, "SwitchScene", "SceneManager.SwitchScene"],
      [refs.sceneManager, "SwitchSceneByModeId", "SceneManager.SwitchSceneByModeId"],
      [refs.sceneManager, "enterNextScene", "SceneManager.enterNextScene"],
      [refs.windowManager, "ShowLastWindow", "WindowManager.ShowLastWindow"],
      [refs.windowManager, "CloseWindow", "WindowManager.CloseWindow"],
      [refs.windowManager, "CloseWindowByName", "WindowManager.CloseWindowByName"],
      [refs.windowManager, "GetWindow", "WindowManager.GetWindow"],
      [refs.windowManager, "GetWindowByName", "WindowManager.GetWindowByName"],
      [refs.windowManager, "GetInstanceWindow", "WindowManager.GetInstanceWindow"],
      [refs.windowManager, "showWindowHandler", "WindowManager.showWindowHandler"],
      [refs.windowManager, "hideWindowHandler", "WindowManager.hideWindowHandler"],
      [refs.windowManager, "removeWindowHandler", "WindowManager.removeWindowHandler"],
      [refs.windowManager, "updateWindowHandler", "WindowManager.updateWindowHandler"],
      [refs.ged, "ShowWindow", "GED.ShowWindow"],
      [refs.ged, "CloseWindow", "GED.CloseWindow"],
      [refs.currentScene, "ServerProxy_StartGame", "CurrentScene.ServerProxy_StartGame"],
      [refs.currentScene, "StartGame", "CurrentScene.StartGame"],
      [refs.currentScene, "BackBtnClickHandler", "CurrentScene.BackBtnClickHandler"],
      [refs.currentScene && refs.currentScene.PveMgr, "ClientRogueLikeSelectMoveReq", "PveMgr.ClientRogueLikeSelectMoveReq"],
      [refs.currentScene && refs.currentScene.PveMgr, "RogueLikeEventSelectReq", "PveMgr.RogueLikeEventSelectReq"],
      [refs.currentScene && refs.currentScene.PveMgr, "RogueLikeDataReq", "PveMgr.RogueLikeDataReq"],
      [refs.currentScene && refs.currentScene.PveMgr && refs.currentScene.PveMgr.proxy, "L", "PveMgr.proxy.L"]
    ]) {
      if (wrap(obj, prop, label)) installed.wrappers.push(label);
    }
    const monitor = {
      installed: true,
      state,
      status() {
        return {
          installed: true,
          installedAt: state.installedAt,
          recordCount: state.records.length,
          listenerCount: state.listeners.length,
          wrapperCount: state.wrappers.length,
          errors: state.errors.slice(-20),
          scene: sceneState(),
          installed
        };
      },
      dump() {
        return {
          ok: true,
          status: this.status(),
          records: state.records.slice(),
          errors: state.errors.slice()
        };
      },
      stop() {
        for (const item of state.listeners.splice(0)) {
          try { item.target.off(item.name, state, item.fn); } catch (error) { state.errors.push({ time: now(), at: "off:" + item.name, error: String(error && error.message || error) }); }
        }
        for (const item of state.wrappers.splice(0)) {
          try { Object.defineProperty(item.obj, item.prop, { value: item.original, configurable: true }); } catch (error) { state.errors.push({ time: now(), at: "restore:" + item.label, error: String(error && error.message || error) }); }
        }
        this.installed = false;
        return this.dump();
      }
    };
    window.__codexSgsExploreMonitor = monitor;
    record("monitor", "install", [installed]);
    return monitor.status();
  })()`;
}

export function dumpExpression() {
  return "(() => window.__codexSgsExploreMonitor ? window.__codexSgsExploreMonitor.dump() : { ok: false, error: 'monitor is not installed' })()";
}

export function stopExpression() {
  return "(() => window.__codexSgsExploreMonitor ? window.__codexSgsExploreMonitor.stop() : { ok: false, error: 'monitor is not installed' })()";
}

function readmeText(value, durationMs) {
  const status = value.status || {};
  return [
    "# SGS Runtime Event Monitor",
    "",
    `- Captured: ${new Date().toISOString()}`,
    `- Duration ms: ${durationMs}`,
    `- Records: ${value.records?.length || 0}`,
    `- GED listeners: ${status.installed?.gedListeners || 0}`,
    `- Proxy listeners: ${status.installed?.proxyListeners || 0}`,
    `- Wrappers: ${(status.installed?.wrappers || []).join(", ")}`,
    `- Scene: ${status.scene?.sceneName || ""} (${status.scene?.className || status.scene?.ctor || ""})`,
    "",
    "This monitor records event/method trigger chains only. It does not call purchase, play, discard, confirm, or skill methods by itself.",
    ""
  ].join("\n");
}

export async function runRuntimeEventMonitor() {
  const mode = process.argv[2] || "capture";
  if (mode === "install") {
    const result = await evaluateOnSgs(installExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
    console.log(JSON.stringify(result.value, null, 2));
    return;
  }
  if (mode === "dump") {
    const result = await evaluateOnSgs(dumpExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
    console.log(JSON.stringify(result.value, null, 2));
    return;
  }
  if (mode === "stop") {
    const result = await evaluateOnSgs(stopExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
    console.log(JSON.stringify(result.value, null, 2));
    return;
  }

  const durationMs = Number(process.env.SGS_RUNTIME_EVENT_MS || process.argv[2] || 15000);
  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const install = await evaluateOnSgs(installExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  await sleep(durationMs);
  const dump = await evaluateOnSgs(dumpExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });
  const stop = process.env.SGS_RUNTIME_EVENT_KEEP_INSTALLED === "1"
    ? { value: { skipped: true } }
    : await evaluateOnSgs(stopExpression(), { timeoutMs: 30000, cdpTimeoutMs: 45000 });

  const eventPath = path.join(dir, "event-monitor.json");
  const readmePath = path.join(dir, "README.md");
  const payload = {
    ok: true,
    target: dump.target,
    durationMs,
    install: install.value,
    dump: dump.value,
    stop: stop.value
  };
  await writeJson(eventPath, payload);
  await writeFile(readmePath, readmeText(dump.value, durationMs), "utf8");
  console.log(JSON.stringify({
    ok: true,
    dir,
    eventPath,
    readmePath,
    recordCount: dump.value?.records?.length || 0,
    scene: dump.value?.status?.scene || null
  }, null, 2));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  runRuntimeEventMonitor().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
