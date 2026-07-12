(() => {
  const root = window.__SgsScripts;
  const normalizer = root.modules.protocolNormalizerCore;

  const state = {
    installed: false,
    installError: "",
    hookTarget: "",
    counts: {},
    records: [],
    consoleHookInstalled: false,
    consoleHookError: "",
    consoleCounts: {},
    consoleRecords: [],
    consoleMaxRecords: 500,
    nextConsoleRecordIndex: 0,
    recentSkillEvents: [],
    nextRecordIndex: 0,
    maxRecords: 500,
    context: normalizer.createProtocolContext()
  };

  function readGed() {
    try {
      return window.Laya?.ClassUtils?.getInstance?.("PopUpWindow")?.ged || null;
    } catch {
      return null;
    }
  }

  function readWindowManager() {
    try {
      const ged = readGed();
      const event = ged?._events?.HIDE_WINDOW;
      return (Array.isArray(event) ? event[0] : event)?.caller || null;
    } catch {
      return null;
    }
  }

  function readProxy() {
    try {
      return readWindowManager()?.proxy || null;
    } catch {
      return null;
    }
  }

  function parseProtocol(name, wrapper) {
    return normalizer.parseProtocol(name, wrapper, {
      context: state.context,
      cardInfo: (id) => root.sources.cardInfo?.(id),
      skillRule: (skillId) => root.sources.skillRuleInfo?.(skillId),
      seatCount: 0
    });
  }

  function recordProtocol(name, wrapper) {
    state.counts[name] = (state.counts[name] || 0) + 1;
    const parsed = parseProtocol(name, wrapper);
    const record = {
      index: state.nextRecordIndex++,
      time: Date.now(),
      name,
      parsed
    };
    state.records.push(record);
    if (state.records.length > state.maxRecords) state.records.splice(0, state.records.length - state.maxRecords);
    try {
      root.sources.appendStorageLog?.("protocol", record);
    } catch {}
    if (parsed?.skillId) {
      state.recentSkillEvents.push({
        time: record.time,
        protocol: name,
        type: parsed.type,
        skillId: parsed.skillId,
        skillRule: parsed.skillRule || null
      });
      if (state.recentSkillEvents.length > 100) {
        state.recentSkillEvents.splice(0, state.recentSkillEvents.length - 100);
      }
    }
    try {
      root.tracker.protocolZoneLedger?.handleProtocolRecord?.(record);
      root.tracker.knownHandLedger?.handleProtocolRecord?.(record);
      root.tracker.rulePlanner?.handleProtocolRecord?.(record);
      root.tracker.handleGameModelProtocolRecord?.(record);
    } catch (error) {
      state.installError = String(error?.stack || error);
    }
  }

  function recordConsoleProtocol(name, wrapper, sourceInfo) {
    state.consoleCounts[name] = (state.consoleCounts[name] || 0) + 1;
    const parsed = parseProtocol(name, wrapper);
    const record = {
      index: state.nextConsoleRecordIndex++,
      time: Date.now(),
      name,
      source: "console",
      sourceInfo: sourceInfo || null,
      parsed
    };
    state.consoleRecords.push(record);
    if (state.consoleRecords.length > state.consoleMaxRecords) {
      state.consoleRecords.splice(0, state.consoleRecords.length - state.consoleMaxRecords);
    }
    try {
      root.sources.appendStorageLog?.("protocol:console", record);
    } catch {}
  }

  function installConsoleHook() {
    if (state.consoleHookInstalled) return state;
    try {
      const target = window.console;
      if (!target) {
        state.consoleHookError = "console is not available";
        return state;
      }
      if (target.__sgsScriptsConsoleHooked && target.__sgsScriptsOriginalLogDesc) {
        Object.defineProperty(target, "log", target.__sgsScriptsOriginalLogDesc);
        try {
          delete target.__sgsScriptsConsoleHooked;
          delete target.__sgsScriptsOriginalLogDesc;
        } catch {}
      } else if (target.__sgsScriptsConsoleHooked) {
        state.consoleHookError = "existing console hook cannot be restored";
        return state;
      }

      const originalDesc = Object.getOwnPropertyDescriptor(target, "log");
      const original = typeof originalDesc?.value === "function"
        ? originalDesc.value
        : (typeof target.log === "function" ? target.log : null);
      if (!original) {
        state.consoleHookError = "console.log is not a function";
        return state;
      }
      const savedDesc = originalDesc || {
        configurable: true,
        writable: true,
        value: original
      };
      Object.defineProperty(target, "__sgsScriptsOriginalLogDesc", {
        value: savedDesc,
        configurable: true
      });
      Object.defineProperty(target, "__sgsScriptsConsoleHooked", {
        value: true,
        configurable: true
      });
      Object.defineProperty(target, "log", {
        configurable: true,
        value: function logWithSgsScriptsAudit() {
          try {
            captureConsoleArgs(arguments);
          } catch (error) {
            state.consoleHookError = String(error?.stack || error);
          }
          return original.apply(this, arguments);
        }
      });
      state.consoleHookInstalled = true;
      state.consoleHookError = "";
    } catch (error) {
      state.consoleHookError = String(error?.stack || error);
    }
    return state;
  }

  function captureConsoleArgs(args) {
    const found = findConsoleProtocol(args);
    if (!found) return;
    const wrapper = consoleProtocolWrapper(found.obj, found.proto);
    const name =
      wrapper?.msg?.ClassName ||
      found.obj?.ClassName ||
      found.obj?._className_ ||
      found.obj?.className ||
      found.obj?.msg?.ClassName ||
      found.obj?.msg?._className_ ||
      found.proto?._className_ ||
      "(unknown)";
    recordConsoleProtocol(name, wrapper, {
      className: name,
      hasProto: !!found.proto
    });
  }

  function findConsoleProtocol(value, depth = 0, seen = new Set()) {
    if (depth > 3 || value == null) return null;
    if (typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);

    if (Array.isArray(value) || typeof value.length === "number") {
      for (let index = 0; index < value.length; index++) {
        const found = findConsoleProtocol(value[index], depth + 1, seen);
        if (found) return found;
      }
      return null;
    }

    const proto = value.ProtoObj || value.Protocol || value.msg?.ProtoObj || value.msg?.Protocol || null;
    const hasProtocolShape =
      proto ||
      value.ClassName ||
      value._className_ ||
      value.className ||
      typeof value.GetJsonObj === "function" ||
      value.msg?.ClassName ||
      value.msg?._className_;
    if (hasProtocolShape) return { obj: value, proto };

    for (const key of Object.keys(value).slice(0, 20)) {
      const found = findConsoleProtocol(value[key], depth + 1, seen);
      if (found) return found;
    }
    return null;
  }

  function consoleProtocolWrapper(obj, proto) {
    const raw = proto || obj?.ProtoObj || obj?.Protocol || obj?.msg?.ProtoObj || obj?.msg?.Protocol || obj || {};
    return {
      msg: {
        id: obj?.msg?.id || obj?.id,
        ClassName: obj?.ClassName || obj?._className_ || obj?.className || obj?.msg?.ClassName || obj?.msg?._className_ || raw?._className_ || "",
        ProtoObj: raw
      }
    };
  }

  function installProtocolHook() {
    if (state.installed) return state;
    installConsoleHook();
    const proxy = readProxy();
    if (!proxy || typeof proxy.event !== "function") {
      state.installError = "proxy.event not available";
      return state;
    }

    const target = Object.prototype.hasOwnProperty.call(proxy, "event") ? proxy : Object.getPrototypeOf(proxy);
    if (!target || typeof target.event !== "function") {
      state.installError = "proxy.event target not available";
      return state;
    }
    if (target.__sgsScriptsProtocolHooked && typeof target.__sgsScriptsOriginalEvent === "function") {
      Object.defineProperty(target, "event", {
        configurable: true,
        value: target.__sgsScriptsOriginalEvent
      });
      try {
        delete target.__sgsScriptsOriginalEvent;
        delete target.__sgsScriptsProtocolHooked;
      } catch {}
    } else if (target.__sgsScriptsProtocolHooked) {
      state.installError = "existing protocol hook cannot be restored";
      return state;
    }

    const original = target.event;
    Object.defineProperty(target, "__sgsScriptsOriginalEvent", {
      value: original,
      configurable: true
    });
    Object.defineProperty(target, "__sgsScriptsProtocolHooked", {
      value: true,
      configurable: true
    });
    Object.defineProperty(target, "event", {
      configurable: true,
      value: function eventWithSgsScriptsRecord(type, data) {
        const result = original.apply(this, arguments);
        try {
          recordProtocol(type, data);
        } catch (error) {
          state.installError = String(error?.stack || error);
        }
        return result;
      }
    });
    state.installed = true;
    state.installError = "";
    state.hookTarget = target === proxy ? "instance" : "prototype";
    return state;
  }

  Object.assign(root.sources, {
    protocolState: state,
    installProtocolHook,
    installConsoleHook,
    readProxy
  });
})();
