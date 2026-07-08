(() => {
  "use strict";

  const win = window;
  const version = "0.1.2";
  const capabilities = JSON.parse("[\"core.lifecycle\",\"core.disposer\",\"core.events\",\"core.plugins\",\"core.logger\",\"browser.local-storage\",\"browser.dom-overlay\",\"browser.open-url\",\"browser.public-method-hook\",\"laya.stage-ready\",\"laya.stage-scan\",\"laya.public-node-inspect\"]");
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
    addDisposer,
    dispose,
    status
  };

  api.timers = createTimerApi();
  api.hooks = createHookApi();
  api.dom = createDomApi();
  api.browser = createBrowserApi();
  api.laya = createLayaApi();
  api.plugins = createPluginApi();

  defineGlobal("SgsFramework", api);
  defineGlobal("__SgsFramework", api);
  showLoginVersionInfo();
  eventBus.emit("framework:ready", status());

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
      api.plugins.uninstall(id, reason);
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
      disposed: api.disposed,
      ageMs: Date.now() - startedAt,
      capabilities: capabilities.slice(),
      plugins: api.plugins.list(),
      disposerCount: disposers.filter((item) => !item.disposed).length,
      page: {
        href: location.href,
        title: document.title
      },
      laya: api.laya.status()
    };
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
        return createStorage(key(`${name}.`));
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
      }
    };
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
    return {
      openUrl(url, target = "_blank", features = "noopener,noreferrer") {
        return win.open(url, target, features);
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
    const visible = node.visible !== false && node.alpha !== 0;
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

  function createPluginApi() {
    async function install(plugin) {
      if (!plugin || typeof plugin !== "object") throw new Error("Plugin object is required.");
      const id = plugin.id || plugin.name;
      if (!id) throw new Error("Plugin id is required.");
      if (plugins.has(id)) uninstall(id, "replace");
      const state = {
        id,
        manifest: plugin.manifest || {},
        installedAt: new Date().toISOString(),
        disposers: [],
        status: "installing"
      };
      plugins.set(id, state);
      const pluginLogger = logger.scope(`plugin:${id}`);
      const context = {
        framework: api,
        id,
        events: eventBus,
        logger: pluginLogger,
        storage: storage.scope(`plugins.${id}`),
        timers: api.timers,
        hooks: api.hooks,
        dom: api.dom,
        browser: api.browser,
        laya: api.laya,
        addDisposer(fn, label) {
          const remove = addDisposer(fn, `plugin:${id}:${label || "disposer"}`);
          state.disposers.push(remove);
          return remove;
        }
      };
      try {
        if (typeof plugin.install === "function") {
          const result = await plugin.install(context);
          if (typeof result === "function") context.addDisposer(result, "install-return");
        }
        state.status = "installed";
        eventBus.emit("plugin:installed", { id, manifest: state.manifest });
      } catch (error) {
        state.status = "failed";
        state.error = String(error?.stack || error?.message || error);
        uninstall(id, "install-failed");
        throw error;
      }
      return state;
    }
    function uninstall(id, reason = "manual") {
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
      eventBus.emit("plugin:uninstalled", { id, reason });
      return true;
    }
    function list() {
      return Array.from(plugins.values()).map((plugin) => ({
        id: plugin.id,
        status: plugin.status,
        installedAt: plugin.installedAt,
        manifest: plugin.manifest,
        error: plugin.error || ""
      }));
    }
    return { install, uninstall, list };
  }
})();
