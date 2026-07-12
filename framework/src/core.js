// ==SgsCore==
// @version      0.3.5
// const version = "0.3.5";
// ==/SgsCore==

(() => {
  "use strict";

  const win = window;
  const version = "0.3.5";
  const capabilities = JSON.parse("[\"core.lifecycle\",\"core.disposer\",\"core.events\",\"core.plugins\",\"core.plugin-config\",\"core.hot-reload\",\"core.developer-mode\",\"core.logger\",\"browser.fetch\",\"browser.local-storage\",\"browser.dom-overlay\",\"browser.open-url\",\"browser.public-method-hook\",\"laya.stage-ready\",\"laya.stage-scan\",\"laya.public-node-inspect\",\"runtime.battle-events\",\"runtime.window-events\",\"runtime.log-events\"]");
  const previous = win.SgsFramework || win.__SgsFramework;

  if (previous && typeof previous.dispose === "function" && !previous.disposed) {
    previous.dispose("framework-replaced");
  }

  const startedAt = Date.now();
  const disposers = [];
  const plugins = new Map();
  const eventBus = createEventBus();
  const logger = createLogger(eventBus);
  const storage = createStorage("sgs.framework.");
  migrateStorageKeys();
  let developerMode = storage.get("core.developer-mode", "false") === "true";
  const api = {
    name: "sgs-framework",
    version,
    capabilities: capabilities.slice(),
    startedAt,
    disposed: false,
    events: eventBus,
    logger,
    storage,
    timers: null,
    hooks: null,
    dom: null,
    browser: null,
    laya: null,
    plugins: null,
    runtime: null,
    update: null,
    ui: null,
    addDisposer,
    dispose,
    status
  };

  Object.defineProperty(api, "developerMode", {
    enumerable: true,
    get() {
      return developerMode;
    }
  });

  api.timers = createTimerApi();
  api.hooks = createHookApi();
  api.dom = createDomApi();
  api.browser = createBrowserApi();
  api.laya = createLayaApi();
  api.plugins = createPluginApi();
  api.runtime = createRuntimeApi();
  api.update = createUpdateApi();
  api.ui = createUiApi();

  defineGlobal("SgsFramework", api);
  defineGlobal("__SgsFramework", api);
  showLoginVersionInfo();
  api.ui.mount();
  api.runtime.start();
  eventBus.emit("framework:ready", status());
  api.plugins.restore()
    .then(() => api.plugins.checkUpdates({ silent: true }))
    .catch((error) => logger.error("plugin restore failed", error));
  api.update.check({ silent: true }).catch((error) => logger.warn("core update check failed", error));

  function defineGlobal(name, value) {
    try {
      Object.defineProperty(win, name, {
        configurable: true,
        enumerable: false,
        value
      });
    } catch {
      win[name] = value;
    }
  }

  function showLoginVersionInfo() {
    if (!isLoginIndexPage()) return;
    const elementId = "sgs-framework-login-version";
    const render = () => {
      if (api.disposed) return;
      const host = document.body || document.documentElement;
      const container = document.querySelector(".container");
      if (!host || !container) {
        win.setTimeout(render, 16);
        return;
      }
      document.getElementById(elementId)?.remove();
      const badge = document.createElement("div");
      badge.id = elementId;
      badge.textContent = `SGS Framework Core ${version}`;
      badge.title = `SGS Framework core loaded at ${new Date(startedAt).toISOString()}`;
      badge.style.cssText = "position:relative;z-index:1;box-sizing:border-box;width:max-content;max-width:calc(100% - 24px);margin:0 auto 8px;padding:4px 10px;border:1px solid rgba(255,217,144,.55);background:rgba(0,0,0,.72);color:#ffd990;font:12px/1.4 Arial,'Microsoft YaHei',sans-serif;text-align:center;pointer-events:none";
      container.insertBefore(badge, container.firstChild);
      addDisposer(() => badge.remove(), "login:version-info");
    };
    render();
  }

  function isLoginIndexPage() {
    return location.protocol === "https:" &&
      location.host === "web.sanguosha.com" &&
      location.pathname === "/login/index.html";
  }

  function addDisposer(fn, label = "anonymous") {
    if (typeof fn !== "function") throw new Error("Disposer must be a function.");
    const item = { fn, label, disposed: false };
    disposers.push(item);
    return () => disposeItem(item);
  }

  function disposeItem(item) {
    if (!item || item.disposed) return;
    item.disposed = true;
    try {
      item.fn();
    } catch (error) {
      logger.warn("dispose failed", item.label, error);
    }
  }

  function dispose(reason = "manual") {
    if (api.disposed) return;
    eventBus.emit("framework:disposing", { reason });
    for (const id of Array.from(plugins.keys())) {
      api.plugins.stop(id, reason);
    }
    for (const item of disposers.slice().reverse()) {
      disposeItem(item);
    }
    disposers.length = 0;
    api.disposed = true;
    eventBus.clear();
    try {
      if (win.SgsFramework === api) delete win.SgsFramework;
      if (win.__SgsFramework === api) delete win.__SgsFramework;
    } catch {
      win.SgsFramework = undefined;
      win.__SgsFramework = undefined;
    }
  }

  function status() {
    return {
      name: api.name,
      version,
      developerMode,
      disposed: api.disposed,
      ageMs: Date.now() - startedAt,
      capabilities: capabilities.slice(),
      plugins: api.plugins.list(),
      disposerCount: disposers.filter((item) => !item.disposed).length,
      page: {
        href: location.href,
        title: document.title
      },
      laya: api.laya.status(),
      runtime: api.runtime?.status?.() || null,
      update: api.update?.status?.() || null,
      ui: api.ui?.status?.() || null
    };
  }

  function setDeveloperMode(value) {
    const enabled = value === true;
    if (enabled === developerMode) return developerMode;
    storage.set("core.developer-mode", enabled);
    const previous = developerMode;
    developerMode = enabled;
    eventBus.emit("core:developer-mode-changed", { enabled, previous });
    api.ui?.refresh?.();
    return developerMode;
  }

  function createEventBus() {
    const listeners = new Map();
    function on(type, handler) {
      if (!type || typeof handler !== "function") throw new Error("Event type and handler are required.");
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
      return () => off(type, handler);
    }
    function once(type, handler) {
      const remove = on(type, (payload) => {
        remove();
        handler(payload);
      });
      return remove;
    }
    function off(type, handler) {
      listeners.get(type)?.delete(handler);
    }
    function emit(type, payload) {
      const direct = Array.from(listeners.get(type) || []);
      const wildcard = Array.from(listeners.get("*") || []);
      for (const handler of [...direct, ...wildcard]) {
        try {
          handler(payload, type);
        } catch (error) {
          console.warn("[sgs-framework] event handler failed", type, error);
        }
      }
    }
    function clear() {
      listeners.clear();
    }
    function listenerCount(type) {
      if (type) return listeners.get(type)?.size || 0;
      let count = 0;
      for (const set of listeners.values()) count += set.size;
      return count;
    }
    return { on, once, off, emit, clear, listenerCount };
  }

  function createLogger(events, scope = "core") {
    function write(level, args) {
      const payload = {
        level,
        scope,
        at: new Date().toISOString(),
        args: Array.from(args)
      };
      events.emit("log", payload);
      const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
      console[method](`[sgs-framework:${scope}]`, ...payload.args);
    }
    return {
      scope(nextScope) {
        return createLogger(events, nextScope);
      },
      info(...args) {
        write("info", args);
      },
      warn(...args) {
        write("warn", args);
      },
      error(...args) {
        write("error", args);
      }
    };
  }

  function createStorage(prefix) {
    function key(name) {
      return `${prefix}${name}`;
    }
    return {
      scope(name) {
        const segment = String(name ?? "").replace(/^\.+|\.+$/g, "");
        return segment ? createStorage(key(`${segment}.`)) : createStorage(prefix);
      },
      get(name, fallback = null) {
        try {
          const value = win.localStorage?.getItem(key(name));
          return value == null ? fallback : value;
        } catch {
          return fallback;
        }
      },
      set(name, value) {
        win.localStorage?.setItem(key(name), String(value ?? ""));
      },
      remove(name) {
        win.localStorage?.removeItem(key(name));
      },
      getJson(name, fallback = null) {
        const value = this.get(name, "");
        if (!value) return fallback;
        try {
          return JSON.parse(value);
        } catch {
          return fallback;
        }
      },
      setJson(name, value) {
        this.set(name, JSON.stringify(value));
      },
      keys() {
        const out = [];
        try {
          for (let index = 0; index < (win.localStorage?.length || 0); index += 1) {
            const item = win.localStorage.key(index);
            if (item?.startsWith(prefix)) out.push(item.slice(prefix.length));
          }
        } catch {
          return [];
        }
        return out.sort();
      }
    };
  }

  function migrateStorageKeys() {
    const moves = [];
    try {
      for (let index = 0; index < (win.localStorage?.length || 0); index += 1) {
        const sourceKey = win.localStorage.key(index);
        if (!sourceKey?.startsWith("sgs.framework.") || !sourceKey.includes("..")) continue;
        const targetKey = sourceKey.replace(/\.{2,}/g, ".");
        if (targetKey !== sourceKey) moves.push({ sourceKey, targetKey });
      }
      for (const { sourceKey, targetKey } of moves) {
        if (win.localStorage.getItem(targetKey) == null) {
          win.localStorage.setItem(targetKey, win.localStorage.getItem(sourceKey) ?? "");
        }
        win.localStorage.removeItem(sourceKey);
      }
    } catch (error) {
      console.warn("[sgs-framework] LocalStorage key migration failed", error);
    }
  }

  function createTimerApi() {
    return {
      setTimeout(fn, ms, label = "timeout") {
        const id = win.setTimeout(fn, ms);
        return addDisposer(() => win.clearTimeout(id), `timer:${label}`);
      },
      setInterval(fn, ms, label = "interval") {
        const id = win.setInterval(fn, ms);
        return addDisposer(() => win.clearInterval(id), `timer:${label}`);
      }
    };
  }

  function createHookApi() {
    return {
      wrapMethod(owner, methodName, handler, options = {}) {
        if (!owner) throw new Error("Hook owner is required.");
        const original = owner[methodName];
        if (typeof original !== "function") throw new Error(`Hook target is not a function: ${String(methodName)}`);
        const label = options.label || `hook:${String(methodName)}`;
        const wrapped = function wrappedFrameworkHook(...args) {
          const thisArg = this;
          return handler.call(this, {
            owner,
            methodName,
            label,
            original,
            args,
            thisArg,
            callOriginal(nextArgs = args) {
              return original.apply(thisArg, nextArgs);
            }
          });
        };
        owner[methodName] = wrapped;
        return addDisposer(() => {
          if (owner[methodName] === wrapped) owner[methodName] = original;
        }, label);
      }
    };
  }

  function createDomApi() {
    const overlayPrefix = "sgs-framework-overlay-";
    function appendWhenReady(node) {
      const host = document.body || document.documentElement;
      if (!host) throw new Error("Document root is not ready.");
      host.appendChild(node);
    }
    function createOverlay(options = {}) {
      const id = options.id || `overlay-${Date.now()}`;
      const elementId = id.startsWith(overlayPrefix) ? id : `${overlayPrefix}${id}`;
      const existing = document.getElementById(elementId);
      if (existing && options.replace !== false) existing.remove();
      const element = document.createElement("div");
      element.id = elementId;
      element.dataset.sgsFrameworkOverlay = "true";
      Object.assign(element.style, {
        position: "fixed",
        inset: options.inset || "0",
        zIndex: String(options.zIndex ?? 2147483000),
        pointerEvents: options.pointerEvents || "none",
        color: options.color || "#fff",
        fontFamily: options.fontFamily || "Arial, sans-serif"
      });
      appendWhenReady(element);
      const remove = addDisposer(() => element.remove(), `overlay:${elementId}`);
      return {
        id: elementId,
        element,
        remove
      };
    }
    function createPanel(options = {}) {
      const overlay = createOverlay({
        id: options.id || "panel",
        inset: "auto",
        pointerEvents: "auto",
        zIndex: options.zIndex
      });
      Object.assign(overlay.element.style, {
        left: `${options.left ?? 16}px`,
        top: `${options.top ?? 16}px`,
        minWidth: `${options.minWidth ?? 220}px`,
        maxWidth: `${options.maxWidth ?? 420}px`,
        background: options.background || "rgba(20, 20, 20, 0.86)",
        border: options.border || "1px solid rgba(255, 255, 255, 0.28)",
        padding: options.padding || "10px",
        boxSizing: "border-box"
      });
      if (options.title) {
        const title = document.createElement("div");
        title.textContent = options.title;
        title.style.cssText = "font-weight:700;margin-bottom:8px;";
        overlay.element.appendChild(title);
      }
      return overlay;
    }
    function createButton(options = {}) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = options.text || "Button";
      button.title = options.title || "";
      Object.assign(button.style, {
        minWidth: `${options.minWidth ?? 80}px`,
        height: `${options.height ?? 30}px`,
        cursor: "pointer"
      });
      if (typeof options.onClick === "function") {
        button.addEventListener("click", options.onClick);
      }
      (options.parent || document.body || document.documentElement).appendChild(button);
      const remove = addDisposer(() => button.remove(), options.label || "dom:button");
      return { element: button, remove };
    }
    function toast(message, options = {}) {
      const overlay = createOverlay({
        id: options.id || "toast",
        pointerEvents: "none",
        zIndex: options.zIndex
      });
      Object.assign(overlay.element.style, {
        inset: "auto 16px 16px auto",
        padding: "8px 12px",
        background: "rgba(0,0,0,0.72)",
        border: "1px solid rgba(255,255,255,0.22)"
      });
      overlay.element.textContent = String(message || "");
      win.setTimeout(overlay.remove, options.ms ?? 2500);
      return overlay;
    }
    return { createOverlay, createPanel, createButton, toast };
  }

  function createBrowserApi() {
    async function request(url, options = {}) {
      const timeoutMs = options.timeoutMs ?? 5000;
      const controller = new AbortController();
      const timeoutId = win.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await win.fetch(url, {
          method: options.method || "GET",
          headers: options.headers,
          cache: "no-store",
          credentials: options.credentials || "omit",
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`${options.method || "GET"} ${url} failed with HTTP ${response.status}.`);
        return response;
      } catch (error) {
        if (error?.name === "AbortError") throw new Error(`${options.method || "GET"} ${url} timed out after ${timeoutMs} ms.`);
        throw error;
      } finally {
        win.clearTimeout(timeoutId);
      }
    }
    return {
      openUrl(url, target = "_blank", features = "noopener,noreferrer") {
        return win.open(url, target, features);
      },
      request,
      async requestText(url, options = {}) {
        const response = await request(url, options);
        return { response, text: await response.text() };
      },
      async requestJson(url, options = {}) {
        const response = await request(url, options);
        return { response, data: await response.json() };
      },
      async requestHeaders(url, options = {}) {
        const response = await request(url, { ...options, method: "HEAD" });
        return { response, headers: response.headers };
      }
    };
  }

  function createLayaApi() {
    function getLaya() {
      return win.Laya || null;
    }
    function getStage() {
      return getLaya()?.stage || null;
    }
    function status() {
      const stage = getStage();
      return {
        ready: !!stage,
        laya: !!getLaya(),
        stageClass: stage ? nodeClassName(stage) : "",
        stageChildren: childNodes(stage).length
      };
    }
    function whenReady(callback, options = {}) {
      const intervalMs = options.intervalMs ?? 50;
      const timeoutMs = options.timeoutMs ?? 0;
      const started = Date.now();
      const tick = () => {
        const stage = getStage();
        if (stage) {
          cancel();
          callback(stage, getLaya());
          return;
        }
        if (timeoutMs > 0 && Date.now() - started >= timeoutMs) {
          cancel();
          if (typeof options.onTimeout === "function") options.onTimeout();
        }
      };
      const id = win.setInterval(tick, intervalMs);
      const cancel = addDisposer(() => win.clearInterval(id), "laya:when-ready");
      tick();
      return cancel;
    }
    function snapshot(options = {}) {
      const root = options.root || getStage();
      if (!root) return [];
      return walk(root, options).map((entry) => entry.info);
    }
    function walk(root = getStage(), options = {}) {
      const maxDepth = options.maxDepth ?? 8;
      const includeHidden = options.includeHidden === true;
      const out = [];
      const seen = new WeakSet();
      function visit(node, depth, parentVisible, path) {
        if (!node || seen.has(node) || depth > maxDepth) return;
        seen.add(node);
        const info = nodeInfo(node, depth, parentVisible, path);
        if (includeHidden || info.effectiveVisible) out.push({ node, info });
        const children = childNodes(node);
        for (let index = 0; index < children.length; index += 1) {
          visit(children[index], depth + 1, info.effectiveVisible, `${path}/${index}:${nodeClassName(children[index])}`);
        }
      }
      visit(root, 0, true, `0:${nodeClassName(root)}`);
      return out;
    }
    function find(predicate, options = {}) {
      return walk(options.root || getStage(), options)
        .filter((entry) => predicate(entry.node, entry.info))
        .map((entry) => entry.node);
    }
    return { getLaya, getStage, status, whenReady, walk, snapshot, find };
  }

  function childNodes(node) {
    if (!node) return [];
    if (typeof node.numChildren === "number" && typeof node.getChildAt === "function") {
      const out = [];
      for (let index = 0; index < node.numChildren; index += 1) {
        const child = safeCall(() => node.getChildAt(index), null);
        if (child) out.push(child);
      }
      return out;
    }
    if (Array.isArray(node._children)) return node._children.filter(Boolean);
    if (Array.isArray(node.children)) return node.children.filter(Boolean);
    return [];
  }

  function nodeInfo(node, depth, parentVisible, path) {
    const visible = node.visible !== false &&
      Number(node.alpha == null ? 1 : node.alpha) !== 0 &&
      Number(node.scaleX == null ? 1 : node.scaleX) !== 0 &&
      Number(node.scaleY == null ? 1 : node.scaleY) !== 0 &&
      !node.destroyed;
    return {
      path,
      depth,
      className: nodeClassName(node),
      name: stringValue(node.name),
      sceneName: stringValue(node.sceneName),
      uiid: stringValue(node._uiid),
      resName: stringValue(node._resName),
      visible,
      effectiveVisible: parentVisible && visible,
      x: numberValue(node.x),
      y: numberValue(node.y),
      width: numberValue(node.width),
      height: numberValue(node.height),
      childCount: childNodes(node).length
    };
  }

  function nodeClassName(node) {
    return stringValue(node?._className_) ||
      stringValue(node?.sceneName) ||
      stringValue(node?.constructor?.name) ||
      stringValue(node?.name) ||
      "";
  }

  function stringValue(value) {
    return typeof value === "string" ? value : "";
  }

  function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  function safeCall(fn, fallback) {
    try {
      return fn();
    } catch {
      return fallback;
    }
  }

  function cloneJson(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function compareVersions(left, right) {
    const normalize = (value) => String(value || "0")
      .trim()
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .map((part) => /^\d+$/.test(part) ? Number(part) : part.toLowerCase());
    const a = normalize(left);
    const b = normalize(right);
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      const av = a[index] ?? 0;
      const bv = b[index] ?? 0;
      if (av === bv) continue;
      if (typeof av === "number" && typeof bv === "number") return av > bv ? 1 : -1;
      return String(av).localeCompare(String(bv), undefined, { numeric: true });
    }
    return 0;
  }

  function createRuntimeApi() {
    const state = {
      running: false,
      startedAt: 0,
      pollCount: 0,
      battle: null,
      windowCount: 0,
      logCount: 0,
      lastError: ""
    };
    const objectIds = new WeakMap();
    const openWindows = new Map();
    const seenLogs = new Set();
    let nextObjectId = 1;
    let cancelPoll = null;

    function objectId(value) {
      if (!value || (typeof value !== "object" && typeof value !== "function")) return 0;
      if (!objectIds.has(value)) objectIds.set(value, nextObjectId++);
      return objectIds.get(value);
    }

    function sceneLabel(node, info = {}) {
      return [info.className, info.sceneName, info.name, node?._className_, node?.sceneName, node?.constructor?.name]
        .filter(Boolean)
        .join(" ");
    }

    function isBattleEntry(entry) {
      const label = sceneLabel(entry.node, entry.info);
      if (!/(^|\s)(TableGameScene|RogueLikeGameScene)(\s|$)/.test(label)) return false;
      return entry.info.effectiveVisible && Array.isArray(entry.node?.manager?.seats);
    }

    function isWindowEntry(entry) {
      if (!entry.info.effectiveVisible) return false;
      const label = sceneLabel(entry.node, entry.info);
      return /(Window|Dialog|Popup)(\s|$)/i.test(label);
    }

    function stripHtml(value) {
      const div = document.createElement("div");
      div.innerHTML = String(value || "");
      return (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim();
    }

    function readLogEntries(scene) {
      let bestBox = null;
      let bestCount = 0;
      for (const entry of api.laya.walk(scene, { includeHidden: true, maxDepth: 14 })) {
        const children = childNodes(entry.node);
        let count = 0;
        for (const child of children) {
          const html = String(child?._innerHTML || "");
          if (/<font\b/i.test(html) && /(手牌区|摸牌堆|牌堆顶|牌堆底|使用|弃置|重铸|装备|获得|置于|打出|展示|观看|亮出|判定)/.test(html)) count += 1;
        }
        if (count > bestCount) {
          bestCount = count;
          bestBox = entry.node;
        }
      }
      if (!bestBox) return [];
      return childNodes(bestBox).map((node, index) => {
        const html = String(node?._innerHTML || "");
        return { index, html, text: stripHtml(html), node };
      }).filter((entry) => entry.html && /<font\b/i.test(entry.html));
    }

    function emitBattleEnd(reason) {
      if (!state.battle) return;
      const previousBattle = state.battle;
      state.battle = null;
      seenLogs.clear();
      eventBus.emit("battle:end", {
        reason,
        scene: previousBattle.scene,
        manager: previousBattle.manager,
        sceneName: previousBattle.sceneName,
        startedAt: previousBattle.startedAt,
        endedAt: new Date().toISOString()
      });
    }

    function syncBattle(entry) {
      if (!entry) {
        emitBattleEnd("scene-not-visible");
        return;
      }
      const id = objectId(entry.node);
      if (state.battle?.id === id) return;
      emitBattleEnd("scene-replaced");
      seenLogs.clear();
      state.battle = {
        id,
        scene: entry.node,
        manager: entry.node.manager,
        sceneName: sceneLabel(entry.node, entry.info),
        startedAt: new Date().toISOString()
      };
      eventBus.emit("battle:start", {
        scene: entry.node,
        manager: entry.node.manager,
        sceneName: state.battle.sceneName,
        startedAt: state.battle.startedAt
      });
    }

    function syncWindows(entries) {
      const current = new Map();
      for (const entry of entries.filter(isWindowEntry)) {
        const id = objectId(entry.node);
        current.set(id, entry);
        if (!openWindows.has(id)) {
          eventBus.emit("window:open", {
            id,
            node: entry.node,
            info: entry.info,
            name: sceneLabel(entry.node, entry.info),
            openedAt: new Date().toISOString()
          });
        }
      }
      for (const [id, entry] of openWindows) {
        if (current.has(id)) continue;
        eventBus.emit("window:close", {
          id,
          node: entry.node,
          info: entry.info,
          name: sceneLabel(entry.node, entry.info),
          closedAt: new Date().toISOString()
        });
      }
      openWindows.clear();
      for (const item of current) openWindows.set(...item);
      state.windowCount = openWindows.size;
    }

    function syncLogs() {
      if (!state.battle?.scene) return;
      for (const entry of readLogEntries(state.battle.scene)) {
        const signature = `${entry.index}:${entry.html}`;
        if (seenLogs.has(signature)) continue;
        seenLogs.add(signature);
        state.logCount += 1;
        eventBus.emit("battle:log", {
          index: entry.index,
          html: entry.html,
          text: entry.text,
          node: entry.node,
          scene: state.battle.scene,
          at: new Date().toISOString()
        });
      }
    }

    function poll() {
      if (api.disposed || !state.running) return;
      state.pollCount += 1;
      try {
        const stage = api.laya.getStage();
        const entries = stage ? api.laya.walk(stage, { includeHidden: true, maxDepth: 14 }) : [];
        syncBattle(entries.find(isBattleEntry) || null);
        syncWindows(entries);
        syncLogs();
        state.lastError = "";
      } catch (error) {
        state.lastError = String(error?.stack || error?.message || error);
      }
    }

    function start() {
      if (state.running) return;
      state.running = true;
      state.startedAt = Date.now();
      cancelPoll = api.timers.setInterval(poll, 200, "runtime-events");
      poll();
    }

    function stop() {
      if (!state.running) return;
      state.running = false;
      cancelPoll?.();
      cancelPoll = null;
      emitBattleEnd("runtime-stopped");
      syncWindows([]);
    }

    function status() {
      return {
        running: state.running,
        ageMs: state.startedAt ? Date.now() - state.startedAt : 0,
        pollCount: state.pollCount,
        battle: state.battle ? { id: state.battle.id, sceneName: state.battle.sceneName, startedAt: state.battle.startedAt } : null,
        windowCount: state.windowCount,
        logCount: state.logCount,
        lastError: state.lastError
      };
    }

    return { start, stop, poll, status, getBattle: () => state.battle };
  }

  function createUpdateApi() {
    const urls = [
      "https://sgs.senrax.com/script/core.mjs",
      "https://raw.githubusercontent.com/suujonH/sgs-xc/main/framework/core.mjs"
    ];
    const state = {
      checking: false,
      checkedAt: "",
      currentVersion: version,
      remoteVersion: "",
      available: false,
      url: "",
      source: "",
      error: ""
    };

    function extractVersion(source) {
      const text = String(source || "");
      return text.match(/^\/\/\s*@version\s+([^\s]+)\s*$/m)?.[1]
        || text.match(/\bconst\s+version\s*=\s*["']([^"']+)["']/)?.[1]
        || "";
    }

    async function check(options = {}) {
      if (state.checking) return status();
      state.checking = true;
      const errors = [];
      try {
        for (const url of urls) {
          try {
            const { text } = await api.browser.requestText(url, { timeoutMs: 5000 });
            const remoteVersion = extractVersion(text);
            if (!remoteVersion) throw new Error(`Core source at ${url} has no version.`);
            state.checkedAt = new Date().toISOString();
            state.remoteVersion = remoteVersion;
            state.available = compareVersions(remoteVersion, version) > 0;
            state.url = url;
            state.source = text;
            state.error = "";
            state.checking = false;
            api.ui?.refresh?.();
            return status();
          } catch (error) {
            errors.push(String(error?.message || error));
          }
        }
        throw new Error(errors.join("\n"));
      } catch (error) {
        state.checkedAt = new Date().toISOString();
        state.error = String(error?.message || error);
        if (!options.silent) logger.warn("core update check failed", error);
        state.checking = false;
        api.ui?.refresh?.();
        return status();
      } finally {
        state.checking = false;
      }
    }

    async function reload() {
      if (!state.source) await check();
      if (!state.available || !state.source) return false;
      const script = document.createElement("script");
      script.type = "text/javascript";
      script.textContent = `${state.source}\n//# sourceURL=sgs-framework-hot-reload://${encodeURIComponent(state.remoteVersion)}/core.mjs`;
      (document.head || document.documentElement || document.body).appendChild(script);
      script.remove();
      return true;
    }

    function status() {
      return {
        checking: state.checking,
        checkedAt: state.checkedAt,
        currentVersion: version,
        remoteVersion: state.remoteVersion,
        available: state.available,
        url: state.url,
        error: state.error
      };
    }

    return { check, reload, status, urls: urls.slice() };
  }

  function createUiApi() {
    const uiStorage = storage.scope("ui");
    const state = {
      mounted: false,
      activeTab: "plugins",
      menuOpen: false,
      windowOpen: false,
      dockVisible: false,
      showOrphans: false,
      dock: uiStorage.getJson("dock", { side: "right", y: 180, autoHide: true }),
      window: uiStorage.getJson("window", null)
    };
    const nodes = {};
    let hideTimer = 0;
    let mountTimer = 0;

    function createElement(tag, className = "", text = "") {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text) element.textContent = text;
      return element;
    }

    function button(text, onClick, options = {}) {
      const element = createElement("button", options.className || "sgs-fw-button", text);
      element.type = "button";
      if (options.title) element.title = options.title;
      if (options.danger) element.dataset.kind = "danger";
      if (options.primary) element.dataset.kind = "primary";
      if (options.disabled) element.disabled = true;
      if (typeof onClick === "function") element.addEventListener("click", onClick);
      return element;
    }

    function installStyles() {
      const style = document.createElement("style");
      style.id = "sgs-framework-core-style";
      style.textContent = `
        #sgs-framework-core-ui, #sgs-framework-core-ui * { box-sizing: border-box; letter-spacing: 0; }
        #sgs-framework-core-ui { position: fixed; inset: 0; z-index: 2147483600; pointer-events: none; font: 13px/1.45 Arial, "Microsoft YaHei", sans-serif; color: #e8edf2; }
        #sgs-framework-core-ui button, #sgs-framework-core-ui input, #sgs-framework-core-ui select { font: inherit; letter-spacing: 0; }
        .sgs-fw-edge-sensor { position: fixed; top: 0; bottom: 0; width: 14px; pointer-events: auto; }
        .sgs-fw-edge-sensor[data-active="false"] { pointer-events: none; }
        .sgs-fw-edge-sensor[data-side="left"] { left: 0; }
        .sgs-fw-edge-sensor[data-side="right"] { right: 0; }
        .sgs-fw-dock { position: fixed; width: 38px; height: 72px; border: 1px solid #65717c; background: #171a1f; color: #f2f4f7; cursor: grab; pointer-events: auto; transition: transform 140ms ease, border-color 140ms ease; user-select: none; border-radius: 6px; font-weight: 700; }
        .sgs-fw-dock:hover, .sgs-fw-dock:focus-visible { border-color: #48a98d; outline: none; }
        .sgs-fw-dock[data-side="left"] { left: 0; border-left: 0; border-radius: 0 6px 6px 0; }
        .sgs-fw-dock[data-side="right"] { right: 0; border-right: 0; border-radius: 6px 0 0 6px; }
        .sgs-fw-dock[data-hidden="true"][data-side="left"] { transform: translateX(calc(-100% + 7px)); }
        .sgs-fw-dock[data-hidden="true"][data-side="right"] { transform: translateX(calc(100% - 7px)); }
        .sgs-fw-menu { position: fixed; width: 188px; border: 1px solid #65717c; background: #20252b; box-shadow: 0 12px 28px rgba(0,0,0,.36); padding: 6px; pointer-events: auto; border-radius: 6px; }
        .sgs-fw-menu[hidden] { display: none; }
        .sgs-fw-menu .sgs-fw-button { width: 100%; justify-content: flex-start; margin: 0 0 4px; }
        .sgs-fw-version { padding: 7px 9px; border-top: 1px solid #3b444d; color: #aeb8c2; user-select: text; }
        .sgs-fw-window { position: fixed; display: flex; flex-direction: column; min-width: 20vw; min-height: 20vh; max-width: 100vw; max-height: 100vh; overflow: hidden; border: 1px solid #65717c; background: #171a1f; box-shadow: 0 18px 48px rgba(0,0,0,.46); pointer-events: auto; border-radius: 6px; }
        .sgs-fw-window[hidden] { display: none; }
        .sgs-fw-titlebar { flex: 0 0 42px; display: flex; align-items: center; gap: 10px; padding: 0 10px 0 14px; background: #20252b; border-bottom: 1px solid #3b444d; cursor: move; user-select: none; }
        .sgs-fw-titlebar strong { flex: 1; font-size: 14px; }
        .sgs-fw-icon-button { width: 30px; height: 30px; border: 1px solid transparent; background: transparent; color: #d8dee5; cursor: pointer; border-radius: 4px; font-size: 21px; line-height: 1; }
        .sgs-fw-icon-button:hover { border-color: #65717c; background: #2a3138; }
        .sgs-fw-tabs { flex: 0 0 40px; display: flex; align-items: end; gap: 2px; padding: 0 10px; border-bottom: 1px solid #3b444d; background: #1b2025; }
        .sgs-fw-tab { height: 34px; padding: 0 14px; border: 0; border-bottom: 3px solid transparent; background: transparent; color: #aeb8c2; cursor: pointer; }
        .sgs-fw-tab[aria-selected="true"] { color: #f2f4f7; border-bottom-color: #48a98d; }
        .sgs-fw-content { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 12px; background: #171a1f; }
        .sgs-fw-resize-handle { position: absolute; right: 0; bottom: 0; width: 22px; height: 22px; cursor: nwse-resize; pointer-events: auto; touch-action: none; }
        .sgs-fw-resize-handle::before { content: ""; position: absolute; right: 4px; bottom: 4px; width: 9px; height: 9px; border-right: 2px solid #8d99a5; border-bottom: 2px solid #8d99a5; }
        .sgs-fw-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
        .sgs-fw-toolbar .sgs-fw-spacer { flex: 1; }
        .sgs-fw-button { display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 5px 10px; border: 1px solid #65717c; background: #2a3138; color: #edf1f5; cursor: pointer; border-radius: 4px; white-space: normal; }
        .sgs-fw-button:hover:not(:disabled) { border-color: #48a98d; background: #303941; }
        .sgs-fw-button:disabled { opacity: .5; cursor: default; }
        .sgs-fw-button[data-kind="primary"] { border-color: #31846e; background: #236d5b; }
        .sgs-fw-button[data-kind="danger"] { border-color: #a4444c; background: #7e3037; }
        .sgs-fw-group { margin: 0 0 10px; border: 1px solid #3b444d; border-radius: 6px; overflow: hidden; }
        .sgs-fw-group > summary { min-height: 38px; padding: 9px 12px; background: #20252b; cursor: pointer; font-weight: 700; }
        .sgs-fw-group-body { padding: 0 12px; }
        .sgs-fw-row { display: grid; grid-template-columns: minmax(150px,1fr) auto; gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px solid #303840; }
        .sgs-fw-row:last-child { border-bottom: 0; }
        .sgs-fw-row-title { font-weight: 700; overflow-wrap: anywhere; }
        .sgs-fw-row-meta { margin-top: 3px; color: #aeb8c2; font-size: 12px; overflow-wrap: anywhere; }
        .sgs-fw-row-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
        .sgs-fw-permissions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
        .sgs-fw-permission { padding: 2px 6px; border: 1px solid #53606b; color: #c9d3dd; background: #252c33; border-radius: 4px; font-size: 11px; overflow-wrap: anywhere; }
        .sgs-fw-status { color: #71c7aa; }
        .sgs-fw-error { color: #ef9a9f; white-space: pre-wrap; overflow-wrap: anywhere; }
        .sgs-fw-setting-group { margin: 10px 0 14px; padding: 0; border: 0; }
        .sgs-fw-setting-group legend { padding: 0 0 6px; font-weight: 700; color: #dce3ea; }
        .sgs-fw-setting { display: grid; grid-template-columns: minmax(130px, .75fr) minmax(160px, 1fr); gap: 12px; align-items: center; min-height: 44px; border-top: 1px solid #303840; }
        .sgs-fw-setting-control { min-width: 0; }
        .sgs-fw-input, .sgs-fw-select { width: 100%; min-height: 32px; border: 1px solid #65717c; background: #111418; color: #edf1f5; padding: 5px 8px; border-radius: 4px; }
        .sgs-fw-toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
        .sgs-fw-toggle input { width: 18px; height: 18px; accent-color: #48a98d; }
        .sgs-fw-empty { padding: 16px 0; color: #aeb8c2; text-align: center; }
        .sgs-fw-center-actions { display: flex; justify-content: center; padding: 12px 0; }
        .sgs-fw-modal-layer { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,.58); pointer-events: auto; }
        .sgs-fw-modal { width: min(520px, 100%); max-height: calc(100vh - 32px); overflow: auto; border: 1px solid #65717c; background: #20252b; box-shadow: 0 18px 48px rgba(0,0,0,.5); padding: 16px; border-radius: 6px; }
        .sgs-fw-modal h2 { margin: 0 0 12px; font-size: 17px; }
        .sgs-fw-field { display: block; margin: 0 0 12px; }
        .sgs-fw-field > span { display: block; margin-bottom: 5px; color: #cbd4dc; }
        .sgs-fw-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
        .sgs-fw-toast { position: fixed; right: 16px; bottom: 16px; max-width: min(420px, calc(100vw - 32px)); padding: 9px 12px; border: 1px solid #65717c; background: #20252b; color: #edf1f5; pointer-events: none; border-radius: 4px; }
        @media (max-width: 620px) {
          .sgs-fw-window { min-width: 70vw; min-height: 36vh; }
          .sgs-fw-row, .sgs-fw-setting { grid-template-columns: 1fr; }
          .sgs-fw-row-actions { justify-content: flex-start; }
          .sgs-fw-tabs { overflow-x: auto; }
          .sgs-fw-tab { flex: 0 0 auto; }
        }
      `;
      document.head.appendChild(style);
      addDisposer(() => style.remove(), "ui:style");
    }

    function normalizeDock() {
      state.dock.side = state.dock.side === "left" ? "left" : "right";
      state.dock.autoHide = state.dock.autoHide !== false;
      state.dock.y = Math.max(0, Math.min(win.innerHeight - 72, Number(state.dock.y) || Math.round(win.innerHeight * .35)));
    }

    function defaultWindowGeometry() {
      const width = Math.round(win.innerWidth * .5);
      const height = Math.round(win.innerHeight * .5);
      return {
        width,
        height,
        left: Math.round((win.innerWidth - width) / 2),
        top: Math.round((win.innerHeight - height) / 2)
      };
    }

    function normalizeWindowGeometry() {
      const geometry = state.window && typeof state.window === "object" ? state.window : defaultWindowGeometry();
      const minWidth = Math.max(260, Math.round(win.innerWidth * .2));
      const minHeight = Math.max(180, Math.round(win.innerHeight * .2));
      geometry.width = Math.max(minWidth, Math.min(win.innerWidth, Number(geometry.width) || Math.round(win.innerWidth * .5)));
      geometry.height = Math.max(minHeight, Math.min(win.innerHeight, Number(geometry.height) || Math.round(win.innerHeight * .5)));
      geometry.left = Math.max(0, Math.min(win.innerWidth - geometry.width, Number(geometry.left) || 0));
      geometry.top = Math.max(0, Math.min(win.innerHeight - geometry.height, Number(geometry.top) || 0));
      state.window = geometry;
    }

    function saveDock() {
      normalizeDock();
      uiStorage.setJson("dock", state.dock);
    }

    function saveWindowGeometry() {
      if (nodes.window && !nodes.window.hidden) {
        state.window = {
          left: nodes.window.offsetLeft,
          top: nodes.window.offsetTop,
          width: nodes.window.offsetWidth,
          height: nodes.window.offsetHeight
        };
      }
      normalizeWindowGeometry();
      uiStorage.setJson("window", state.window);
    }

    function applyDock() {
      if (!nodes.dock) return;
      normalizeDock();
      nodes.dock.dataset.side = state.dock.side;
      nodes.dock.dataset.hidden = String(state.dock.autoHide && !state.dockVisible && !state.menuOpen);
      nodes.dock.style.top = `${state.dock.y}px`;
      for (const [side, sensor] of nodes.sensors || []) {
        sensor.dataset.active = String(side === state.dock.side);
      }
      positionMenu();
    }

    function applyWindowGeometry() {
      if (!nodes.window) return;
      normalizeWindowGeometry();
      Object.assign(nodes.window.style, {
        left: `${state.window.left}px`,
        top: `${state.window.top}px`,
        width: `${state.window.width}px`,
        height: `${state.window.height}px`
      });
    }

    function showDock() {
      win.clearTimeout(hideTimer);
      state.dockVisible = true;
      applyDock();
    }

    function scheduleHideDock() {
      win.clearTimeout(hideTimer);
      hideTimer = win.setTimeout(() => {
        if (state.menuOpen || !state.dock.autoHide) return;
        state.dockVisible = false;
        applyDock();
      }, 240);
    }

    function positionMenu() {
      if (!nodes.menu || !nodes.dock) return;
      nodes.menu.style.top = `${Math.max(8, Math.min(win.innerHeight - 150, state.dock.y))}px`;
      nodes.menu.style.left = state.dock.side === "left" ? "44px" : "auto";
      nodes.menu.style.right = state.dock.side === "right" ? "44px" : "auto";
    }

    function toggleMenu(force) {
      state.menuOpen = typeof force === "boolean" ? force : !state.menuOpen;
      nodes.menu.hidden = !state.menuOpen;
      if (state.menuOpen) showDock();
      refreshMenu();
      applyDock();
    }

    function refreshMenu() {
      if (!nodes.menu) return;
      nodes.menu.replaceChildren();
      nodes.menu.appendChild(button("选项", () => {
        toggleMenu(false);
        openWindow("plugins");
      }));
      nodes.menu.appendChild(button(`隐藏/显示：${state.dock.autoHide ? "自动隐藏" : "保持显示"}`, () => {
        state.dock.autoHide = !state.dock.autoHide;
        state.dockVisible = true;
        saveDock();
        refreshMenu();
        applyDock();
      }));
      nodes.menu.appendChild(createElement("div", "sgs-fw-version", `Core ${version}`));
    }

    function bindDockDrag() {
      let drag = null;
      let moved = false;
      nodes.dock.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        moved = false;
        drag = { x: event.clientX, y: event.clientY, top: state.dock.y };
        nodes.dock.setPointerCapture?.(event.pointerId);
      });
      nodes.dock.addEventListener("pointermove", (event) => {
        if (!drag) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        state.dock.y = drag.top + dy;
        state.dock.side = event.clientX < win.innerWidth / 2 ? "left" : "right";
        applyDock();
      });
      nodes.dock.addEventListener("pointerup", () => {
        if (!drag) return;
        drag = null;
        saveDock();
        applyDock();
        if (!moved) toggleMenu();
        else if (state.dock.autoHide) scheduleHideDock();
        else showDock();
      });
      nodes.dock.addEventListener("pointercancel", () => {
        drag = null;
        saveDock();
        if (state.dock.autoHide) scheduleHideDock();
      });
    }

    function bindWindowDrag() {
      let drag = null;
      nodes.titlebar.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("button")) return;
        drag = { x: event.clientX, y: event.clientY, left: nodes.window.offsetLeft, top: nodes.window.offsetTop };
        nodes.titlebar.setPointerCapture?.(event.pointerId);
      });
      const moveDrag = (event) => {
        if (!drag) return;
        const left = drag.left + event.clientX - drag.x;
        const top = drag.top + event.clientY - drag.y;
        nodes.window.style.left = `${Math.max(0, Math.min(win.innerWidth - nodes.window.offsetWidth, left))}px`;
        nodes.window.style.top = `${Math.max(0, Math.min(win.innerHeight - nodes.window.offsetHeight, top))}px`;
      };
      const finishDrag = () => {
        if (!drag) return;
        drag = null;
        saveWindowGeometry();
        applyWindowGeometry();
      };
      win.addEventListener("pointermove", moveDrag);
      win.addEventListener("pointerup", finishDrag);
      win.addEventListener("pointercancel", finishDrag);
      addDisposer(() => {
        win.removeEventListener("pointermove", moveDrag);
        win.removeEventListener("pointerup", finishDrag);
        win.removeEventListener("pointercancel", finishDrag);
      }, "ui:window-drag");
    }

    function bindWindowResize() {
      let resize = null;
      nodes.resizeHandle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        resize = {
          x: event.clientX,
          y: event.clientY,
          width: nodes.window.offsetWidth,
          height: nodes.window.offsetHeight
        };
        nodes.resizeHandle.setPointerCapture?.(event.pointerId);
      });
      const moveResize = (event) => {
        if (!resize) return;
        const minWidth = Math.max(260, Math.round(win.innerWidth * .2));
        const minHeight = Math.max(180, Math.round(win.innerHeight * .2));
        const maxWidth = win.innerWidth - nodes.window.offsetLeft;
        const maxHeight = win.innerHeight - nodes.window.offsetTop;
        nodes.window.style.width = `${Math.max(minWidth, Math.min(maxWidth, resize.width + event.clientX - resize.x))}px`;
        nodes.window.style.height = `${Math.max(minHeight, Math.min(maxHeight, resize.height + event.clientY - resize.y))}px`;
      };
      const finishResize = () => {
        if (!resize) return;
        resize = null;
        saveWindowGeometry();
        applyWindowGeometry();
      };
      win.addEventListener("pointermove", moveResize);
      win.addEventListener("pointerup", finishResize);
      win.addEventListener("pointercancel", finishResize);
      addDisposer(() => {
        win.removeEventListener("pointermove", moveResize);
        win.removeEventListener("pointerup", finishResize);
        win.removeEventListener("pointercancel", finishResize);
      }, "ui:window-resize");
    }

    function buildWindow() {
      const windowElement = createElement("section", "sgs-fw-window");
      windowElement.hidden = true;
      const titlebar = createElement("header", "sgs-fw-titlebar");
      titlebar.appendChild(createElement("strong", "", "SGS Framework"));
      const closeButton = button("×", closeWindow, { className: "sgs-fw-icon-button", title: "关闭" });
      titlebar.appendChild(closeButton);
      const tabs = createElement("div", "sgs-fw-tabs");
      const tabDefinitions = [
        ["plugins", "插件管理"],
        ["settings", "插件配置"],
        ["core", "Core"]
      ];
      nodes.tabs = new Map();
      for (const [id, label] of tabDefinitions) {
        const tab = button(label, () => selectTab(id), { className: "sgs-fw-tab" });
        tab.setAttribute("role", "tab");
        tabs.appendChild(tab);
        nodes.tabs.set(id, tab);
      }
      const content = createElement("main", "sgs-fw-content");
      const resizeHandle = createElement("div", "sgs-fw-resize-handle");
      resizeHandle.setAttribute("role", "separator");
      resizeHandle.setAttribute("aria-label", "调整窗口大小");
      resizeHandle.title = "调整窗口大小";
      windowElement.append(titlebar, tabs, content, resizeHandle);
      nodes.root.appendChild(windowElement);
      nodes.window = windowElement;
      nodes.titlebar = titlebar;
      nodes.content = content;
      nodes.resizeHandle = resizeHandle;
      applyWindowGeometry();
      bindWindowDrag();
      bindWindowResize();
    }

    function selectTab(id) {
      state.activeTab = id;
      for (const [tabId, tab] of nodes.tabs) tab.setAttribute("aria-selected", String(tabId === id));
      renderActiveTab();
    }

    function openWindow(tab = state.activeTab) {
      state.windowOpen = true;
      nodes.window.hidden = false;
      applyWindowGeometry();
      selectTab(tab);
    }

    function closeWindow() {
      saveWindowGeometry();
      state.windowOpen = false;
      nodes.window.hidden = true;
    }

    function renderActiveTab() {
      if (!nodes.content || nodes.window.hidden) return;
      nodes.content.replaceChildren();
      if (state.activeTab === "settings") renderSettingsTab();
      else if (state.activeTab === "core") renderCoreTab();
      else renderPluginsTab();
    }

    function pluginMeta(plugin) {
      const fragment = document.createDocumentFragment();
      fragment.appendChild(createElement("div", "sgs-fw-row-title", `${plugin.manifest?.name || plugin.id} ${plugin.installedVersion || plugin.manifest?.version || ""}`.trim()));
      fragment.appendChild(createElement("div", "sgs-fw-row-meta", plugin.id));
      if (plugin.manifest?.description) fragment.appendChild(createElement("div", "sgs-fw-row-meta", plugin.manifest.description));
      if (plugin.error || plugin.update?.error) fragment.appendChild(createElement("div", "sgs-fw-error", plugin.error || plugin.update.error));
      return fragment;
    }

    function renderInstalledPlugin(plugin) {
      const row = createElement("div", "sgs-fw-row");
      const info = createElement("div");
      info.appendChild(pluginMeta(plugin));
      const actions = createElement("div", "sgs-fw-row-actions");
      if (plugin.update?.available) {
        actions.appendChild(button(`更新到 ${plugin.update.remoteVersion}`, async () => {
          try {
            await api.plugins.update(plugin.id);
            toast(`${plugin.manifest?.name || plugin.id} 已更新`);
          } catch (error) {
            toast(String(error?.message || error), true);
          }
        }, { primary: true }));
      }
      const toggle = createElement("label", "sgs-fw-toggle");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = plugin.enabled !== false;
      checkbox.addEventListener("change", async () => {
        checkbox.disabled = true;
        try {
          if (checkbox.checked) await api.plugins.enable(plugin.id);
          else api.plugins.disable(plugin.id);
        } catch (error) {
          checkbox.checked = !checkbox.checked;
          toast(String(error?.message || error), true);
        } finally {
          checkbox.disabled = false;
          refresh();
        }
      });
      toggle.append(checkbox, document.createTextNode(checkbox.checked ? "启动" : "禁用"));
      actions.appendChild(toggle);
      actions.appendChild(button("删除", async () => {
        if (await confirmAction("删除插件", `删除 ${plugin.manifest?.name || plugin.id}？插件配置会保留，可在 Core 页清理。`, "删除")) {
          api.plugins.remove(plugin.id);
          refresh();
        }
      }, { danger: true }));
      row.append(info, actions);
      return row;
    }

    function renderPluginsTab() {
      const toolbar = createElement("div", "sgs-fw-toolbar");
      toolbar.appendChild(button("检测插件更新", async () => {
        await api.plugins.checkUpdates();
        toast("插件版本检测完成");
        refresh();
      }));
      nodes.content.appendChild(toolbar);
      const installedById = new Map(api.plugins.list().map((plugin) => [plugin.id, plugin]));
      for (const group of api.plugins.catalogGroups()) {
        const details = createElement("details", "sgs-fw-group");
        details.open = true;
        const count = new Set([...group.installed.map((item) => item.id), ...group.catalog.plugins.map((item) => item.id)]).size;
        details.appendChild(createElement("summary", "", `${group.source.name} (${count})`));
        const body = createElement("div", "sgs-fw-group-body");
        if (group.catalog.error) body.appendChild(createElement("div", "sgs-fw-error", group.catalog.error));
        for (const plugin of group.installed) body.appendChild(renderInstalledPlugin(plugin));
        for (const item of group.catalog.plugins) {
          const installedPlugin = installedById.get(item.id);
          if (installedPlugin && !group.installed.some((plugin) => plugin.id === item.id)) {
            const row = createElement("div", "sgs-fw-row");
            const info = createElement("div");
            info.append(createElement("div", "sgs-fw-row-title", item.id), createElement("div", "sgs-fw-row-meta", `已通过其他来源安装：${installedPlugin.sourceId}`));
            row.append(info, createElement("div", "sgs-fw-status", "已安装"));
            body.appendChild(row);
            continue;
          }
          if (installedPlugin) continue;
          const row = createElement("div", "sgs-fw-row");
          const info = createElement("div");
          info.append(createElement("div", "sgs-fw-row-title", item.id), createElement("div", "sgs-fw-row-meta", item.url));
          const actions = createElement("div", "sgs-fw-row-actions");
          actions.appendChild(button("安装", async () => {
            try {
              await api.plugins.addFromUrl(item.url, { sourceId: group.source.id });
              refresh();
            } catch (error) {
              toast(String(error?.message || error), true);
            }
          }, { primary: true }));
          row.append(info, actions);
          body.appendChild(row);
        }
        if (!body.childNodes.length) body.appendChild(createElement("div", "sgs-fw-empty", "此来源暂无插件"));
        details.appendChild(body);
        nodes.content.appendChild(details);
      }
      const bottom = createElement("div", "sgs-fw-center-actions");
      bottom.appendChild(button("添加插件", addPluginFlow, { primary: true }));
      nodes.content.appendChild(bottom);
    }

    function normalizeSettingGroups(settings) {
      if (!Array.isArray(settings)) return [];
      if (settings.some((item) => Array.isArray(item?.items))) return settings;
      return [{ id: "default", name: "配置", items: settings }];
    }

    function validatePatterns(value, patterns) {
      for (const pattern of Array.isArray(patterns) ? patterns : []) {
        try {
          if (!new RegExp(pattern).test(String(value))) return `输入不符合规则：${pattern}`;
        } catch {
          return `无效正则：${pattern}`;
        }
      }
      return "";
    }

    function renderSettingControl(plugin, item, config) {
      const host = createElement("div", "sgs-fw-setting-control");
      const value = item.key ? config.get(item.key, item.default ?? null) : null;
      const active = plugin.status === "active";
      if (item.type === "toggle") {
        const label = createElement("label", "sgs-fw-toggle");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !!value;
        input.addEventListener("change", async () => {
          try {
            await config.set(item.key, input.checked, { action: item.onChange });
          } catch (error) {
            input.checked = !input.checked;
            toast(String(error?.message || error), true);
          }
        });
        label.append(input, document.createTextNode(input.checked ? "开启" : "关闭"));
        host.appendChild(label);
      } else if (item.type === "button") {
        host.appendChild(button(item.buttonText || item.name || "执行", async () => {
          try {
            await api.plugins.invokeAction(plugin.id, item.action || item.onClick);
          } catch (error) {
            toast(String(error?.message || error), true);
          }
        }, { disabled: !active }));
      } else if (item.type === "select") {
        const select = createElement("select", "sgs-fw-select");
        for (const option of item.options || []) {
          const optionElement = document.createElement("option");
          optionElement.value = String(option.value);
          optionElement.textContent = String(option.label ?? option.value);
          optionElement.selected = String(value) === String(option.value);
          select.appendChild(optionElement);
        }
        select.addEventListener("change", async () => {
          try {
            await config.set(item.key, select.value, { action: item.onChange });
          } catch (error) {
            toast(String(error?.message || error), true);
          }
        });
        host.appendChild(select);
      } else if (item.type === "custom") {
        if (active && (item.render || item.action)) {
          Promise.resolve(api.plugins.invokeAction(plugin.id, item.render || item.action, host)).catch((error) => {
            host.appendChild(createElement("div", "sgs-fw-error", String(error?.message || error)));
          });
        } else {
          host.appendChild(createElement("div", "sgs-fw-row-meta", "插件启动后可用"));
        }
      } else {
        const input = createElement("input", "sgs-fw-input");
        input.type = item.inputType || "text";
        input.value = value == null ? "" : String(value);
        if (item.min != null) input.min = String(item.min);
        if (item.max != null) input.max = String(item.max);
        if (item.minLength != null) input.minLength = Number(item.minLength);
        if (item.maxLength != null) input.maxLength = Number(item.maxLength);
        input.addEventListener("change", async () => {
          input.setCustomValidity("");
          const error = validatePatterns(input.value, item.patterns);
          input.setCustomValidity(error);
          if (error || !input.checkValidity()) {
            input.reportValidity();
            return;
          }
          const nextValue = input.type === "number" ? Number(input.value) : input.value;
          try {
            await config.set(item.key, nextValue, { action: item.onChange });
          } catch (saveError) {
            input.setCustomValidity(String(saveError?.message || saveError));
            input.reportValidity();
          }
        });
        host.appendChild(input);
      }
      return host;
    }

    function renderSettingsTab() {
      const pluginsList = api.plugins.list();
      if (!pluginsList.length) {
        nodes.content.appendChild(createElement("div", "sgs-fw-empty", "尚未安装插件"));
        return;
      }
      for (const plugin of pluginsList) {
        const details = createElement("details", "sgs-fw-group");
        details.open = true;
        details.appendChild(createElement("summary", "", `${plugin.manifest?.name || plugin.id} · ${plugin.status === "active" ? "运行中" : plugin.status === "disabled" ? "已禁用" : plugin.status}`));
        const body = createElement("div", "sgs-fw-group-body");
        const settings = api.plugins.settings(plugin.id);
        const config = api.plugins.config(plugin.id);
        if (!settings.length || !config) {
          body.appendChild(createElement("div", "sgs-fw-empty", "无可配置项"));
        } else {
          for (const group of normalizeSettingGroups(settings)) {
            const fieldset = createElement("fieldset", "sgs-fw-setting-group");
            fieldset.appendChild(createElement("legend", "", group.name || group.id || "配置"));
            for (const item of group.items || []) {
              const row = createElement("div", "sgs-fw-setting");
              row.append(createElement("div", "", item.name || item.key || item.type), renderSettingControl(plugin, item, config));
              fieldset.appendChild(row);
            }
            body.appendChild(fieldset);
          }
          const reset = createElement("div", "sgs-fw-center-actions");
          reset.appendChild(button("重置插件配置", async () => {
            if (await confirmAction("重置配置", `恢复 ${plugin.manifest?.name || plugin.id} 的默认配置？`, "重置")) {
              await config.reset();
              refresh();
            }
          }));
          body.appendChild(reset);
        }
        details.appendChild(body);
        nodes.content.appendChild(details);
      }
    }

    function renderCoreTab() {
      const updateState = api.update.status();
      const coreGroup = createElement("details", "sgs-fw-group");
      coreGroup.open = true;
      coreGroup.appendChild(createElement("summary", "", "Core 版本"));
      const coreBody = createElement("div", "sgs-fw-group-body");
      const coreRow = createElement("div", "sgs-fw-row");
      const coreInfo = createElement("div");
      coreInfo.append(createElement("div", "sgs-fw-row-title", `当前版本 ${version}`), createElement("div", "sgs-fw-row-meta", updateState.checkedAt ? `最近检测 ${updateState.checkedAt}` : "尚未检测"));
      if (updateState.error) coreInfo.appendChild(createElement("div", "sgs-fw-error", updateState.error));
      const coreActions = createElement("div", "sgs-fw-row-actions");
      coreActions.appendChild(button("检测更新", async () => {
        await api.update.check();
        refresh();
      }));
      if (updateState.available) coreActions.appendChild(button(`热重载 ${updateState.remoteVersion}`, () => api.update.reload(), { primary: true }));
      coreRow.append(coreInfo, coreActions);
      coreBody.appendChild(coreRow);

      const developerRow = createElement("div", "sgs-fw-row");
      const developerInfo = createElement("div");
      developerInfo.append(
        createElement("div", "sgs-fw-row-title", "开发者模式"),
        createElement("div", "sgs-fw-row-meta", "插件可通过 context.framework.developerMode 实时读取，并监听 core:developer-mode-changed。")
      );
      const developerActions = createElement("div", "sgs-fw-row-actions");
      const developerToggle = createElement("label", "sgs-fw-toggle");
      const developerCheckbox = document.createElement("input");
      developerCheckbox.type = "checkbox";
      developerCheckbox.checked = api.developerMode;
      developerCheckbox.addEventListener("change", () => {
        try {
          setDeveloperMode(developerCheckbox.checked);
        } catch (error) {
          developerCheckbox.checked = api.developerMode;
          logger.warn("developer mode update failed", error);
          toast("开发者模式保存失败", true);
        }
      });
      developerToggle.append(developerCheckbox, document.createTextNode("启用"));
      developerActions.appendChild(developerToggle);
      developerRow.append(developerInfo, developerActions);
      coreBody.appendChild(developerRow);
      coreGroup.appendChild(coreBody);
      nodes.content.appendChild(coreGroup);

      const sourceGroup = createElement("details", "sgs-fw-group");
      sourceGroup.open = true;
      sourceGroup.appendChild(createElement("summary", "", "插件第三方源"));
      const sourceBody = createElement("div", "sgs-fw-group-body");
      for (const source of api.plugins.listSources().filter((item) => !item.official)) {
        const row = createElement("div", "sgs-fw-row");
        const info = createElement("div");
        info.append(createElement("div", "sgs-fw-row-title", source.name), createElement("div", "sgs-fw-row-meta", source.url));
        const actions = createElement("div", "sgs-fw-row-actions");
        const toggle = createElement("label", "sgs-fw-toggle");
        const enabled = document.createElement("input");
        enabled.type = "checkbox";
        enabled.checked = source.enabled;
        enabled.addEventListener("change", async () => {
          api.plugins.setSourceEnabled(source.id, enabled.checked);
          if (enabled.checked) await api.plugins.refreshSources({ silent: true });
          refresh();
        });
        toggle.append(enabled, document.createTextNode("启用"));
        actions.append(toggle, button("编辑名称", () => editSourceFlow(source)), button("删除", async () => {
          if (await confirmAction("删除第三方源", `删除来源 ${source.name}？已安装插件不会被删除。`, "删除")) {
            api.plugins.removeSource(source.id);
            refresh();
          }
        }, { danger: true }));
        row.append(info, actions);
        sourceBody.appendChild(row);
      }
      if (!sourceBody.childNodes.length) sourceBody.appendChild(createElement("div", "sgs-fw-empty", "尚未添加第三方源"));
      const addSource = createElement("div", "sgs-fw-center-actions");
      addSource.appendChild(button("添加插件第三方源", addSourceFlow, { primary: true }));
      sourceBody.appendChild(addSource);
      sourceGroup.appendChild(sourceBody);
      nodes.content.appendChild(sourceGroup);

      const cleanupGroup = createElement("details", "sgs-fw-group");
      cleanupGroup.open = state.showOrphans;
      cleanupGroup.appendChild(createElement("summary", "", "清理配置"));
      const cleanupBody = createElement("div", "sgs-fw-group-body");
      const cleanupActions = createElement("div", "sgs-fw-center-actions");
      cleanupActions.appendChild(button("检查已删除插件配置", () => {
        state.showOrphans = true;
        refresh();
      }));
      cleanupBody.appendChild(cleanupActions);
      if (state.showOrphans) {
        const orphans = api.plugins.orphanedConfigs();
        if (!orphans.length) cleanupBody.appendChild(createElement("div", "sgs-fw-empty", "没有残留插件配置"));
        for (const orphan of orphans) {
          const row = createElement("div", "sgs-fw-row");
          const info = createElement("div");
          info.append(
            createElement("div", "sgs-fw-row-title", orphan.id),
            createElement("div", "sgs-fw-row-meta", `${orphan.keys.length} 个存储项 · ${orphan.size} 字符`)
          );
          row.append(info, button("删除配置", () => {
            api.plugins.deleteOrphanConfig(orphan.id);
            refresh();
          }, { danger: true }));
          cleanupBody.appendChild(row);
        }
      }
      cleanupGroup.appendChild(cleanupBody);
      nodes.content.appendChild(cleanupGroup);
    }

    function modal(title, renderBody, confirmText = "确认") {
      return new Promise((resolve) => {
        const layer = createElement("div", "sgs-fw-modal-layer");
        const box = createElement("section", "sgs-fw-modal");
        box.appendChild(createElement("h2", "", title));
        const body = createElement("div");
        const getValue = renderBody(body) || (() => true);
        const actions = createElement("div", "sgs-fw-modal-actions");
        const close = (value) => {
          layer.remove();
          resolve(value);
        };
        actions.append(button("取消", () => close(null)), button(confirmText, async () => {
          try {
            const value = await getValue();
            if (value !== undefined) close(value);
          } catch (error) {
            toast(String(error?.message || error), true);
          }
        }, { primary: true }));
        box.append(body, actions);
        layer.appendChild(box);
        nodes.root.appendChild(layer);
      });
    }

    function textField(label, value = "", type = "text") {
      const wrapper = createElement("label", "sgs-fw-field");
      wrapper.appendChild(createElement("span", "", label));
      const input = createElement("input", "sgs-fw-input");
      input.type = type;
      input.value = value;
      wrapper.appendChild(input);
      return { wrapper, input };
    }

    async function addPluginFlow() {
      const result = await modal("添加插件", (body) => {
        const url = textField("插件 URL", "", "url");
        body.appendChild(url.wrapper);
        return () => {
          if (!url.input.reportValidity() || !url.input.value.trim()) return undefined;
          return url.input.value.trim();
        };
      }, "读取插件");
      if (!result) return;
      try {
        await api.plugins.addFromUrl(result);
        refresh();
      } catch (error) {
        toast(String(error?.message || error), true);
      }
    }

    function confirmPluginInstall(inspection) {
      return modal("确认安装插件", (body) => {
        body.append(createElement("div", "sgs-fw-row-title", `${inspection.meta.name} ${inspection.meta.version}`), createElement("div", "sgs-fw-row-meta", inspection.meta.description || "无简介"), createElement("div", "sgs-fw-row-meta", inspection.url));
        const permissions = createElement("div", "sgs-fw-permissions");
        if (inspection.meta.permissions.length) {
          for (const permission of inspection.meta.permissions) permissions.appendChild(createElement("span", "sgs-fw-permission", permission));
        } else {
          permissions.appendChild(createElement("span", "sgs-fw-permission", "未声明权限"));
        }
        body.append(createElement("div", "sgs-fw-row-meta", "插件代码不在沙箱中运行，以下权限仅用于向用户披露。"), permissions);
        return () => true;
      }, "安装").then(Boolean);
    }

    function confirmAction(title, message, confirmText) {
      return modal(title, (body) => {
        body.appendChild(createElement("div", "", message));
        return () => true;
      }, confirmText).then(Boolean);
    }

    async function addSourceFlow() {
      const result = await modal("添加插件第三方源", (body) => {
        const name = textField("来源名称");
        const url = textField("Catalog URL", "", "url");
        body.append(name.wrapper, url.wrapper);
        return () => {
          if (!name.input.value.trim() || !url.input.reportValidity() || !url.input.value.trim()) return undefined;
          return { name: name.input.value.trim(), url: url.input.value.trim() };
        };
      }, "添加");
      if (!result) return;
      const source = api.plugins.addSource(result.name, result.url);
      await api.plugins.refreshSources();
      toast(`已添加 ${source.name}`);
      refresh();
    }

    async function editSourceFlow(source) {
      const result = await modal("编辑来源名称", (body) => {
        const name = textField("来源名称", source.name);
        body.appendChild(name.wrapper);
        return () => name.input.value.trim() || undefined;
      }, "保存");
      if (!result) return;
      api.plugins.renameSource(source.id, result);
      refresh();
    }

    function toast(message, isError = false) {
      nodes.toast?.remove();
      const element = createElement("div", `sgs-fw-toast${isError ? " sgs-fw-error" : ""}`, String(message || ""));
      nodes.root.appendChild(element);
      nodes.toast = element;
      win.setTimeout(() => {
        if (nodes.toast === element) nodes.toast = null;
        element.remove();
      }, 2800);
    }

    function handleViewportResize() {
      normalizeDock();
      applyDock();
      saveWindowGeometry();
      applyWindowGeometry();
    }

    function mount() {
      if (state.mounted || api.disposed) return;
      const host = document.body || document.documentElement;
      if (!host || !document.head) {
        mountTimer = win.setTimeout(mount, 16);
        return;
      }
      installStyles();
      normalizeDock();
      normalizeWindowGeometry();
      const root = createElement("div");
      root.id = "sgs-framework-core-ui";
      nodes.root = root;
      nodes.sensors = new Map();
      for (const side of ["left", "right"]) {
        const sensor = createElement("div", "sgs-fw-edge-sensor");
        sensor.dataset.side = side;
        sensor.addEventListener("pointerenter", () => {
          if (state.dock.side === side) showDock();
        });
        nodes.sensors.set(side, sensor);
        root.appendChild(sensor);
      }
      const dock = button("SGS", null, { className: "sgs-fw-dock", title: "SGS Framework" });
      dock.addEventListener("pointerenter", showDock);
      dock.addEventListener("pointerleave", scheduleHideDock);
      root.appendChild(dock);
      nodes.dock = dock;
      const menu = createElement("div", "sgs-fw-menu");
      menu.hidden = true;
      menu.addEventListener("pointerenter", showDock);
      menu.addEventListener("pointerleave", scheduleHideDock);
      root.appendChild(menu);
      nodes.menu = menu;
      host.appendChild(root);
      buildWindow();
      bindDockDrag();
      refreshMenu();
      applyDock();
      state.mounted = true;
      const resizeHandler = () => handleViewportResize();
      win.addEventListener("resize", resizeHandler);
      addDisposer(() => win.removeEventListener("resize", resizeHandler), "ui:resize");
      addDisposer(() => {
        win.clearTimeout(hideTimer);
        win.clearTimeout(mountTimer);
        root.remove();
        state.mounted = false;
      }, "ui:root");
    }

    function refresh() {
      refreshMenu();
      applyDock();
      renderActiveTab();
    }

    function status() {
      return {
        mounted: state.mounted,
        activeTab: state.activeTab,
        menuOpen: state.menuOpen,
        windowOpen: state.windowOpen,
        dock: { ...state.dock },
        window: state.window ? { ...state.window } : null
      };
    }

    return { mount, refresh, openWindow, closeWindow, selectTab, confirmPluginInstall, confirmAction, toast, status };
  }

  function createPluginApi() {
    const registryKey = "plugins.registry";
    const sourcesKey = "plugins.sources";
    const catalogCacheKey = "plugins.catalog-cache";
    const officialSource = {
      id: "official",
      name: "SGS Framework Official",
      url: "https://sgs.senrax.com/script/plugin/index.json",
      enabled: true,
      official: true
    };
    const records = new Map();
    const definitions = new Map();
    const configStates = new Map();
    const updates = new Map();
    const catalogs = new Map();
    let definitionCapture = null;
    let customSources = normalizeSources(storage.getJson(sourcesKey, []));

    for (const record of normalizeRecords(storage.getJson(registryKey, []))) {
      records.set(record.id, record);
    }
    const cachedCatalogs = storage.getJson(catalogCacheKey, {});
    if (cachedCatalogs && typeof cachedCatalogs === "object") {
      for (const [id, value] of Object.entries(cachedCatalogs)) catalogs.set(id, value);
    }

    function normalizeRecords(input) {
      if (!Array.isArray(input)) return [];
      return input.filter((item) => item && typeof item.id === "string").map((item) => ({
        ...item,
        enabled: item.enabled !== false,
        sourceId: item.sourceId || "manual",
        manifest: item.manifest && typeof item.manifest === "object" ? item.manifest : {}
      }));
    }

    function normalizeSources(input) {
      if (!Array.isArray(input)) return [];
      return input.filter((item) => item && item.id && item.url).map((item) => ({
        id: String(item.id),
        name: String(item.name || item.id),
        url: String(item.url),
        enabled: item.enabled !== false,
        official: false
      }));
    }

    function saveRecords() {
      storage.setJson(registryKey, Array.from(records.values()));
      api.ui?.refresh?.();
    }

    function saveSources() {
      storage.setJson(sourcesKey, customSources);
      api.ui?.refresh?.();
    }

    function saveCatalogs() {
      storage.setJson(catalogCacheKey, Object.fromEntries(catalogs));
    }

    function codeKey(id) {
      return `plugins.${id}.code`;
    }

    function readCode(id) {
      return storage.get(codeKey(id), "");
    }

    function writeCode(id, source) {
      storage.set(codeKey(id), source);
    }

    function parseHeader(source) {
      const block = String(source || "").match(/\/\/\s*==SgsPlugin==([\s\S]*?)\/\/\s*==\/SgsPlugin==/i);
      if (!block) throw new Error("Plugin header ==SgsPlugin== is missing.");
      const fields = {};
      for (const line of block[1].split(/\r?\n/)) {
        const match = line.match(/^\s*\/\/\s*@([A-Za-z][\w-]*)\s+(.+?)\s*$/);
        if (match) fields[match[1].toLowerCase()] = match[2];
      }
      const id = String(fields.id || "").trim();
      const versionValue = String(fields.version || "").trim();
      if (!id) throw new Error("Plugin header @id is required.");
      if (!versionValue) throw new Error("Plugin header @version is required.");
      const requestedUpdateMode = String(fields.updatemode || "default").trim().toLowerCase();
      const updateMode = ["default", "header", "api"].includes(requestedUpdateMode) ? requestedUpdateMode : "default";
      return {
        id,
        name: String(fields.name || id).trim(),
        version: versionValue,
        description: String(fields.description || "").trim(),
        permissions: String(fields.permissions || "").split(",").map((item) => item.trim()).filter(Boolean),
        updateMode,
        versionHeader: String(fields.versionheader || "x-sgs-plugin-version").trim().toLowerCase(),
        versionApi: String(fields.versionapi || "").trim()
      };
    }

    async function inspect(url) {
      const normalizedUrl = new URL(String(url), location.href).href;
      const { source, response } = await fetchPluginSource(normalizedUrl);
      return { url: normalizedUrl, source, response, meta: parseHeader(source) };
    }

    async function fetchPluginSource(url) {
      const { response, text } = await api.browser.requestText(url, { timeoutMs: 5000 });
      return { response, source: text };
    }

    function evaluateSource(record, source) {
      const capture = [];
      definitionCapture = capture;
      const script = document.createElement("script");
      script.type = "text/javascript";
      script.textContent = `${String(source || "")}\n//# sourceURL=sgs-plugin://${encodeURIComponent(record.id)}/${encodeURIComponent(record.manifest?.version || "unknown")}`;
      try {
        (document.head || document.documentElement || document.body).appendChild(script);
      } finally {
        script.remove();
        definitionCapture = null;
      }
      const definition = capture.find((item) => (item.id || item.name) === record.id) || capture[0];
      if (!definition) throw new Error(`Plugin ${record.id} did not call SgsFramework.plugins.define().`);
      const definitionId = definition.id || definition.name;
      if (definitionId !== record.id) throw new Error(`Plugin id mismatch: expected ${record.id}, received ${definitionId}.`);
      definitions.set(record.id, definition);
      return definition;
    }

    function define(plugin) {
      if (!plugin || typeof plugin !== "object") throw new Error("Plugin object is required.");
      const id = plugin.id || plugin.name;
      if (!id) throw new Error("Plugin id is required.");
      if (definitionCapture) definitionCapture.push(plugin);
      else definitions.set(id, plugin);
      return plugin;
    }

    function settingItems(definition) {
      const settings = Array.isArray(definition?.settings) ? definition.settings : [];
      const items = [];
      for (const entry of settings) {
        if (Array.isArray(entry?.items)) items.push(...entry.items);
        else if (entry && typeof entry === "object") items.push(entry);
      }
      return items;
    }

    function validateConfigValue(definition, name, value) {
      const item = settingItems(definition).find((entry) => entry?.key === name);
      if (!item) return "";
      const text = value == null ? "" : String(value);
      const numeric = item.inputType === "number" || item.type === "number" || item.min != null || item.max != null;
      if (numeric && !Number.isFinite(Number(value))) return `${item.name || name} 必须是有效数字`;
      if (item.minLength != null && text.length < Number(item.minLength)) return `${item.name || name} 长度不能小于 ${item.minLength}`;
      if (item.maxLength != null && text.length > Number(item.maxLength)) return `${item.name || name} 长度不能大于 ${item.maxLength}`;
      if (item.min != null && Number(value) < Number(item.min)) return `${item.name || name} 不能小于 ${item.min}`;
      if (item.max != null && Number(value) > Number(item.max)) return `${item.name || name} 不能大于 ${item.max}`;
      for (const pattern of Array.isArray(item.patterns) ? item.patterns : []) {
        let expression;
        try {
          expression = pattern instanceof RegExp ? pattern : new RegExp(String(pattern));
        } catch {
          return `${item.name || name} 声明了无效正则：${String(pattern)}`;
        }
        expression.lastIndex = 0;
        if (!expression.test(text)) return `${item.name || name} 不符合规则：${String(pattern)}`;
      }
      return "";
    }

    function createPluginConfig(id, definition) {
      const cached = configStates.get(id);
      if (cached?.definition === definition) return cached.api;
      const configKey = `plugins.${id}.config`;
      const defaults = cloneJson(definition.defaults || {});
      let values = storage.getJson(configKey, null);
      if (!values || typeof values !== "object" || Array.isArray(values)) {
        values = cloneJson(defaults);
        storage.setJson(configKey, values);
      } else {
        values = { ...cloneJson(defaults), ...values };
      }
      function save() {
        storage.setJson(configKey, values);
        api.ui?.refresh?.();
      }
      const configApi = {
        get(name, fallback = null) {
          if (name == null) return cloneJson(values);
          return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : fallback;
        },
        async set(name, value, options = {}) {
          const validationError = validateConfigValue(definition, name, value);
          if (validationError) throw new Error(validationError);
          values[name] = value;
          save();
          eventBus.emit("plugin:config-changed", { id, name, value });
          if (options.action) await invokeAction(id, options.action, value, name);
          return value;
        },
        async reset() {
          values = cloneJson(defaults);
          save();
          eventBus.emit("plugin:config-reset", { id, values: cloneJson(values) });
          if (definition.actions?.onReset) await invokeAction(id, "onReset", cloneJson(values));
          return cloneJson(values);
        },
        defaults() {
          return cloneJson(defaults);
        }
      };
      configStates.set(id, { definition, api: configApi });
      return configApi;
    }

    function createContext(record, definition, state) {
      const id = record.id;
      return {
        framework: api,
        id,
        manifest: record.manifest,
        sourceUrl: record.url || "",
        events: eventBus,
        logger: logger.scope(`plugin:${id}`),
        storage: storage.scope(`plugins.${id}.data`),
        config: createPluginConfig(id, definition),
        timers: api.timers,
        hooks: api.hooks,
        dom: api.dom,
        browser: api.browser,
        laya: api.laya,
        runtime: api.runtime,
        addDisposer(fn, label) {
          const remove = addDisposer(fn, `plugin:${id}:${label || "disposer"}`);
          state.disposers.push(remove);
          return remove;
        }
      };
    }

    async function activateDefinition(record, definition) {
      stop(record.id, "replace");
      const state = {
        id: record.id,
        manifest: record.manifest,
        definition,
        installedAt: record.installedAt,
        activatedAt: new Date().toISOString(),
        disposers: [],
        status: "starting",
        context: null,
        error: ""
      };
      plugins.set(record.id, state);
      const context = createContext(record, definition, state);
      state.context = context;
      try {
        if (typeof definition.install === "function") {
          const result = await definition.install(context);
          if (typeof result === "function") context.addDisposer(result, "install-return");
        }
        state.status = "active";
        eventBus.emit("plugin:started", { id: record.id, manifest: record.manifest });
        api.ui?.refresh?.();
        return state;
      } catch (error) {
        state.status = "failed";
        state.error = String(error?.stack || error?.message || error);
        stop(record.id, "start-failed");
        throw error;
      }
    }

    async function install(plugin) {
      const definition = define(plugin);
      const id = definition.id || definition.name;
      const manifest = { ...(definition.manifest || {}), name: definition.manifest?.name || id };
      const record = {
        id,
        url: "",
        sourceId: "manual",
        enabled: true,
        installedVersion: manifest.version || "0.0.0",
        manifest,
        updateMode: "default",
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      records.set(id, record);
      saveRecords();
      return activateDefinition(record, definition);
    }

    async function installFromInspection(inspection, options = {}) {
      const { meta, source, url } = inspection;
      const existing = records.get(meta.id);
      const record = {
        ...existing,
        id: meta.id,
        url,
        sourceId: options.sourceId || existing?.sourceId || "manual",
        enabled: true,
        installedVersion: meta.version,
        manifest: {
          name: meta.name,
          version: meta.version,
          description: meta.description,
          permissions: meta.permissions
        },
        updateMode: meta.updateMode,
        versionHeader: meta.versionHeader,
        versionApi: meta.versionApi ? new URL(meta.versionApi, url).href : "",
        installedAt: existing?.installedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      records.set(record.id, record);
      writeCode(record.id, source);
      saveRecords();
      const definition = evaluateSource(record, source);
      await activateDefinition(record, definition);
      eventBus.emit("plugin:installed", { id: record.id, manifest: record.manifest, url });
      return record;
    }

    async function addFromUrl(url, options = {}) {
      const inspection = await inspect(url);
      if (!options.confirmed) {
        const allowed = await api.ui.confirmPluginInstall(inspection);
        if (!allowed) return null;
      }
      return installFromInspection(inspection, options);
    }

    function stop(id, reason = "manual") {
      const state = plugins.get(id);
      if (!state) return false;
      for (const remove of state.disposers.slice().reverse()) {
        try {
          remove();
        } catch (error) {
          logger.warn("plugin disposer failed", id, error);
        }
      }
      plugins.delete(id);
      eventBus.emit("plugin:stopped", { id, reason });
      api.ui?.refresh?.();
      return true;
    }

    async function enable(id) {
      const record = records.get(id);
      if (!record) throw new Error(`Unknown plugin: ${id}`);
      record.enabled = true;
      saveRecords();
      let definition = definitions.get(id);
      if (!definition) {
        let source = readCode(id);
        if (!source) source = (await fetchPluginSource(record.url)).source;
        writeCode(id, source);
        definition = evaluateSource(record, source);
      }
      return activateDefinition(record, definition);
    }

    function disable(id) {
      const record = records.get(id);
      if (!record) return false;
      record.enabled = false;
      saveRecords();
      stop(id, "disabled");
      return true;
    }

    function remove(id) {
      const record = records.get(id);
      if (!record) return false;
      stop(id, "removed");
      records.delete(id);
      definitions.delete(id);
      configStates.delete(id);
      updates.delete(id);
      storage.remove(codeKey(id));
      saveRecords();
      eventBus.emit("plugin:removed", { id });
      return true;
    }

    async function restore() {
      await refreshSources({ silent: true });
      for (const record of records.values()) {
        try {
          let source = readCode(record.id);
          if (!source && record.url) {
            source = (await fetchPluginSource(record.url)).source;
            writeCode(record.id, source);
          }
          if (!source) throw new Error(`No cached source exists for ${record.id}.`);
          const definition = evaluateSource(record, source);
          if (record.enabled) await activateDefinition(record, definition);
        } catch (error) {
          record.error = String(error?.stack || error?.message || error);
          logger.warn("plugin restore item failed", record.id, error);
        }
      }
      saveRecords();
      return list();
    }

    async function checkOne(id) {
      const record = records.get(id);
      if (!record?.url) throw new Error(`Plugin ${id} has no update URL.`);
      const mode = record.updateMode || "default";
      let remoteVersion = "";
      let downloadUrl = record.url;
      let source = "";
      if (mode === "header") {
        const { headers } = await api.browser.requestHeaders(record.url, { timeoutMs: 5000 });
        remoteVersion = String(headers.get(record.versionHeader || "x-sgs-plugin-version") || "").trim();
      } else if (mode === "api") {
        if (!record.versionApi) throw new Error(`Plugin ${id} has no version API URL.`);
        const { data } = await api.browser.requestJson(record.versionApi, { timeoutMs: 5000 });
        remoteVersion = String(data?.version || "").trim();
        if (data?.url) downloadUrl = new URL(String(data.url), record.versionApi).href;
      } else {
        const fetched = await fetchPluginSource(record.url);
        source = fetched.source;
        remoteVersion = parseHeader(source).version;
      }
      if (!remoteVersion) throw new Error(`Plugin ${id} update response did not provide a version.`);
      const result = {
        id,
        checkedAt: new Date().toISOString(),
        currentVersion: record.installedVersion || record.manifest?.version || "0.0.0",
        remoteVersion,
        available: compareVersions(remoteVersion, record.installedVersion || record.manifest?.version || "0.0.0") > 0,
        downloadUrl,
        source,
        mode,
        error: ""
      };
      updates.set(id, result);
      delete record.error;
      saveRecords();
      return result;
    }

    async function checkUpdates(options = {}) {
      const results = [];
      await refreshSources({ silent: true });
      for (const record of records.values()) {
        if (!record.url) continue;
        try {
          results.push(await checkOne(record.id));
        } catch (error) {
          const result = {
            id: record.id,
            checkedAt: new Date().toISOString(),
            available: false,
            error: String(error?.message || error)
          };
          updates.set(record.id, result);
          results.push(result);
          if (!options.silent) logger.warn("plugin update check failed", record.id, error);
        }
      }
      api.ui?.refresh?.();
      return results;
    }

    async function update(id) {
      const record = records.get(id);
      if (!record) throw new Error(`Unknown plugin: ${id}`);
      const updateState = updates.get(id) || await checkOne(id);
      if (!updateState.available) return false;
      let source = updateState.source;
      if (!source) source = (await fetchPluginSource(updateState.downloadUrl || record.url)).source;
      const meta = parseHeader(source);
      if (meta.id !== id) throw new Error(`Plugin update id mismatch: expected ${id}, received ${meta.id}.`);
      record.installedVersion = meta.version;
      record.url = updateState.downloadUrl || record.url;
      record.manifest = {
        name: meta.name,
        version: meta.version,
        description: meta.description,
        permissions: meta.permissions
      };
      record.updateMode = meta.updateMode;
      record.versionHeader = meta.versionHeader;
      record.versionApi = meta.versionApi ? new URL(meta.versionApi, record.url).href : "";
      record.updatedAt = new Date().toISOString();
      writeCode(id, source);
      const definition = evaluateSource(record, source);
      definitions.set(id, definition);
      updates.delete(id);
      saveRecords();
      if (record.enabled) await activateDefinition(record, definition);
      eventBus.emit("plugin:updated", { id, version: meta.version });
      return true;
    }

    async function invokeAction(id, action, ...args) {
      const state = plugins.get(id);
      const definition = definitions.get(id) || state?.definition;
      const handler = typeof action === "function" ? action : definition?.actions?.[action] || definition?.[action];
      if (typeof handler !== "function") throw new Error(`Plugin ${id} action is not defined: ${String(action)}`);
      return handler(state?.context || createContext(records.get(id), definition, { disposers: [] }), ...args);
    }

    function settings(id) {
      const definition = definitions.get(id);
      return Array.isArray(definition?.settings) ? definition.settings : [];
    }

    function config(id) {
      const definition = definitions.get(id);
      if (!definition) return null;
      return plugins.get(id)?.context?.config || configStates.get(id)?.api || createPluginConfig(id, definition);
    }

    function list() {
      return Array.from(records.values()).map((record) => {
        const active = plugins.get(record.id);
        return {
          ...record,
          status: active?.status || (record.enabled ? "stopped" : "disabled"),
          error: active?.error || record.error || "",
          update: updates.get(record.id) || null,
          hasSettings: settings(record.id).length > 0
        };
      });
    }

    function listSources() {
      return [officialSource, ...customSources.map((item) => ({ ...item }))];
    }

    async function refreshSource(source) {
      if (!source.enabled) return catalogs.get(source.id) || null;
      const { data } = await api.browser.requestJson(source.url, { timeoutMs: 5000 });
      if (!data || !Array.isArray(data.plugins)) throw new Error(`Plugin source ${source.name} returned an invalid catalog.`);
      const catalog = {
        name: String(data.name || source.name),
        plugins: data.plugins.filter((item) => item?.id && item?.url).map((item) => ({
          id: String(item.id),
          url: new URL(String(item.url), source.url).href
        })),
        checkedAt: new Date().toISOString(),
        error: ""
      };
      catalogs.set(source.id, catalog);
      saveCatalogs();
      return catalog;
    }

    async function refreshSources(options = {}) {
      for (const source of listSources()) {
        if (!source.enabled) continue;
        try {
          await refreshSource(source);
        } catch (error) {
          const previousCatalog = catalogs.get(source.id) || { name: source.name, plugins: [] };
          catalogs.set(source.id, { ...previousCatalog, error: String(error?.message || error) });
          if (!options.silent) logger.warn("plugin source refresh failed", source.id, error);
        }
      }
      saveCatalogs();
      api.ui?.refresh?.();
      return catalogGroups();
    }

    function catalogGroups() {
      const installed = list();
      const groups = listSources().map((source) => ({
        source,
        catalog: catalogs.get(source.id) || { name: source.name, plugins: [], error: "" },
        installed: installed.filter((plugin) => plugin.sourceId === source.id)
      }));
      const manual = installed.filter((plugin) => plugin.sourceId === "manual" || !groups.some((group) => group.source.id === plugin.sourceId));
      if (manual.length) {
        groups.push({
          source: { id: "manual", name: "Manual Install", enabled: true, official: true, url: "" },
          catalog: { name: "Manual Install", plugins: [], error: "" },
          installed: manual
        });
      }
      return groups;
    }

    function addSource(name, url) {
      const source = {
        id: `source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: String(name || "Third-party Source").trim(),
        url: new URL(String(url), location.href).href,
        enabled: true,
        official: false
      };
      customSources.push(source);
      saveSources();
      return source;
    }

    function renameSource(id, name) {
      const source = customSources.find((item) => item.id === id);
      if (!source) return false;
      source.name = String(name || source.name).trim();
      saveSources();
      return true;
    }

    function setSourceEnabled(id, enabled) {
      const source = customSources.find((item) => item.id === id);
      if (!source) return false;
      source.enabled = !!enabled;
      saveSources();
      return true;
    }

    function removeSource(id) {
      const length = customSources.length;
      customSources = customSources.filter((item) => item.id !== id);
      catalogs.delete(id);
      saveSources();
      saveCatalogs();
      return customSources.length !== length;
    }

    function orphanedConfigs() {
      const ids = new Set(records.keys());
      const groups = new Map();
      for (const key of storage.keys()) {
        const id = key.match(/^plugins\.(.+)\.config$/)?.[1] || key.match(/^plugins\.(.+)\.data\..+$/)?.[1] || "";
        if (!id || ids.has(id)) continue;
        if (!groups.has(id)) groups.set(id, { id, keys: [], size: 0 });
        const group = groups.get(id);
        group.keys.push(key);
        group.size += storage.get(key, "").length;
      }
      return Array.from(groups.values()).sort((left, right) => left.id.localeCompare(right.id));
    }

    function deleteOrphanConfig(id) {
      if (records.has(id)) return false;
      let deleted = false;
      for (const key of storage.keys()) {
        if (key === `plugins.${id}.config` || key.startsWith(`plugins.${id}.data.`)) {
          storage.remove(key);
          deleted = true;
        }
      }
      api.ui?.refresh?.();
      return deleted;
    }

    return {
      define,
      install,
      inspect,
      addFromUrl,
      installFromInspection,
      restore,
      start: enable,
      enable,
      stop,
      disable,
      remove,
      uninstall: remove,
      update,
      checkOne,
      checkUpdates,
      invokeAction,
      settings,
      config,
      list,
      listSources,
      addSource,
      renameSource,
      setSourceEnabled,
      removeSource,
      refreshSources,
      catalogGroups,
      orphanedConfigs,
      deleteOrphanConfig,
      parseHeader
    };
  }
})();
